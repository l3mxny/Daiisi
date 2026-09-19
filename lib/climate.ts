const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";

// How many prior years to average for a "normal" 30-day rain/ET0 baseline
// for this calendar window. Small on purpose: each year is its own request
// against a free, unauthenticated API.
const NORMAL_YEARS = 5;
const WINDOW_DAYS = 30;

export interface ClimateNormal {
  rain30Normal: number;
  et030Normal: number;
  years: number; // years that actually returned data, <= NORMAL_YEARS
}

interface ArchiveResponse {
  daily?: {
    precipitation_sum?: Array<number | null>;
    et0_fao_evapotranspiration?: Array<number | null>;
  };
}

function sum(values: Array<number | null>): number {
  return values.reduce<number>((total, v) => total + (typeof v === "number" ? v : 0), 0);
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function fetchYearWindow(
  lat: number,
  lng: number,
  yearsAgo: number
): Promise<{ rain: number; et0: number } | null> {
  const end = new Date();
  end.setUTCFullYear(end.getUTCFullYear() - yearsAgo);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - WINDOW_DAYS);

  const url = new URL(ARCHIVE_URL);
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lng));
  url.searchParams.set("start_date", toDateStr(start));
  url.searchParams.set("end_date", toDateStr(end));
  url.searchParams.set("daily", "precipitation_sum,et0_fao_evapotranspiration");
  url.searchParams.set("timezone", "auto");

  const res = await fetch(url.toString());
  if (!res.ok) return null;
  const json: ArchiveResponse = await res.json();
  const daily = json.daily;
  if (!daily?.precipitation_sum || !daily?.et0_fao_evapotranspiration) return null;

  return {
    rain: sum(daily.precipitation_sum),
    et0: sum(daily.et0_fao_evapotranspiration),
  };
}

// Purely enrichment data (a "how unusual is this" baseline) — unlike
// weather.ts's getWeatherMetrics, callers should treat a failure here as
// "no baseline available" rather than a hard error.
export async function getClimateNormal(lat: number, lng: number): Promise<ClimateNormal | null> {
  const settled = await Promise.allSettled(
    Array.from({ length: NORMAL_YEARS }, (_, i) => fetchYearWindow(lat, lng, i + 1))
  );

  const rains: number[] = [];
  const et0s: number[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled" && result.value) {
      rains.push(result.value.rain);
      et0s.push(result.value.et0);
    }
  }

  if (rains.length === 0) return null;

  return {
    rain30Normal: rains.reduce((a, b) => a + b, 0) / rains.length,
    et030Normal: et0s.reduce((a, b) => a + b, 0) / et0s.length,
    years: rains.length,
  };
}
