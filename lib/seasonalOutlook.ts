const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";
const SEASONAL_URL = "https://seasonal-api.open-meteo.com/v1/seasonal";

// A full season (~3 months) ahead — long enough to read as "seasonal"
// rather than duplicating the app's existing 16-day/30-day windows.
const OUTLOOK_WINDOW_DAYS = 90;
const NORMAL_YEARS = 5;

// How far a member has to land from the historical normal before it counts
// as a real lean rather than noise. Precip uses a ratio (rainfall totals
// scale with climate, e.g. 10% "wetter" means something different in a
// desert vs. a rainforest); temperature uses a fixed °C band since a
// temperature difference is meaningful in absolute terms regardless of
// baseline.
const PRECIP_NEAR_NORMAL_BAND = 0.1;
const TEMP_NEAR_NORMAL_BAND_C = 0.5;

export type PrecipLean = "wetter" | "drier" | "near_normal";
export type TempLean = "hotter" | "cooler" | "near_normal";

export interface SeasonalOutlook {
  windowDays: number;
  precipLean: PrecipLean;
  precipConfidence: number; // fraction of ensemble members agreeing with the lean, 0-1
  tempLean: TempLean;
  tempConfidence: number;
  forecastRainTotal: number; // ensemble-mean total rainfall over the window, mm
  normalRainTotal: number | null;
  forecastTempMean: number; // ensemble-mean average temperature over the window, °C
  normalTempMean: number | null;
  yearsOfNormal: number;
}

function sum(values: Array<number | null | undefined>): number {
  return values.reduce<number>((total, v) => total + (typeof v === "number" ? v : 0), 0);
}

function mean(values: Array<number | null | undefined>): number {
  const nums = values.filter((v): v is number => typeof v === "number");
  return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

// Historical baseline: what actually happened during this same forward
// calendar window (today -> today+90d) in each of the past NORMAL_YEARS
// years — the same "5-year normal" idea as lib/climate.ts, but forward- not
// backward-looking, since it's compared against a forecast, not a
// just-elapsed window.
async function fetchHistoricalYearWindow(
  lat: number,
  lng: number,
  yearsAgo: number
): Promise<{ rainTotal: number; tempMean: number } | null> {
  const start = new Date();
  start.setUTCFullYear(start.getUTCFullYear() - yearsAgo);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + OUTLOOK_WINDOW_DAYS);

  const url = new URL(ARCHIVE_URL);
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lng));
  url.searchParams.set("start_date", start.toISOString().slice(0, 10));
  url.searchParams.set("end_date", end.toISOString().slice(0, 10));
  url.searchParams.set("daily", "precipitation_sum,temperature_2m_mean");
  url.searchParams.set("timezone", "auto");

  const res = await fetch(url.toString());
  if (!res.ok) return null;
  const json = await res.json();
  const daily = json.daily;
  if (!daily?.precipitation_sum || !daily?.temperature_2m_mean) return null;
  return { rainTotal: sum(daily.precipitation_sum), tempMean: mean(daily.temperature_2m_mean) };
}

async function getHistoricalNormal(
  lat: number,
  lng: number
): Promise<{ rainTotal: number | null; tempMean: number | null; years: number }> {
  const settled = await Promise.allSettled(
    Array.from({ length: NORMAL_YEARS }, (_, i) => fetchHistoricalYearWindow(lat, lng, i + 1))
  );
  const rains: number[] = [];
  const temps: number[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled" && r.value) {
      rains.push(r.value.rainTotal);
      temps.push(r.value.tempMean);
    }
  }
  return {
    rainTotal: rains.length > 0 ? rains.reduce((a, b) => a + b, 0) / rains.length : null,
    tempMean: temps.length > 0 ? temps.reduce((a, b) => a + b, 0) / temps.length : null,
    years: rains.length,
  };
}

// The seasonal API returns one column per ensemble member
// ("precipitation_sum", "precipitation_sum_member01", ... "_member50") —
// this pulls all of them out as parallel daily arrays.
function extractMemberSeries(daily: Record<string, Array<number | null>>, baseKey: string): Array<number | null>[] {
  return Object.keys(daily)
    .filter((k) => k === baseKey || k.startsWith(`${baseKey}_member`))
    .map((k) => daily[k]);
}

// No API key, no auth (same as lib/weather.ts / lib/climate.ts). Returns
// null on failure — this is enrichment, not a required signal, so callers
// should degrade gracefully rather than treat it as a hard error.
export async function getSeasonalOutlook(lat: number, lng: number): Promise<SeasonalOutlook | null> {
  const url = new URL(SEASONAL_URL);
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lng));
  url.searchParams.set("daily", "precipitation_sum,temperature_2m_mean");
  url.searchParams.set("forecast_days", String(OUTLOOK_WINDOW_DAYS));

  const [seasonalRes, normal] = await Promise.all([fetch(url.toString()), getHistoricalNormal(lat, lng)]);
  if (!seasonalRes.ok) return null;
  const json = await seasonalRes.json();
  const daily = json.daily;
  if (!daily?.time) return null;

  const precipMemberTotals = extractMemberSeries(daily, "precipitation_sum").map(sum);
  const tempMemberMeans = extractMemberSeries(daily, "temperature_2m_mean").map(mean);
  if (precipMemberTotals.length === 0 || tempMemberMeans.length === 0) return null;

  const forecastRainTotal = mean(precipMemberTotals);
  const forecastTempMean = mean(tempMemberMeans);

  let precipLean: PrecipLean = "near_normal";
  let precipConfidence = 0;
  if (normal.rainTotal !== null && normal.rainTotal > 0) {
    const wetter = precipMemberTotals.filter((v) => v > normal.rainTotal! * (1 + PRECIP_NEAR_NORMAL_BAND)).length;
    const drier = precipMemberTotals.filter((v) => v < normal.rainTotal! * (1 - PRECIP_NEAR_NORMAL_BAND)).length;
    const near = precipMemberTotals.length - wetter - drier;
    if (wetter >= drier && wetter >= near) [precipLean, precipConfidence] = ["wetter", wetter / precipMemberTotals.length];
    else if (drier >= wetter && drier >= near) [precipLean, precipConfidence] = ["drier", drier / precipMemberTotals.length];
    else precipConfidence = near / precipMemberTotals.length;
  }

  let tempLean: TempLean = "near_normal";
  let tempConfidence = 0;
  if (normal.tempMean !== null) {
    const hotter = tempMemberMeans.filter((v) => v > normal.tempMean! + TEMP_NEAR_NORMAL_BAND_C).length;
    const cooler = tempMemberMeans.filter((v) => v < normal.tempMean! - TEMP_NEAR_NORMAL_BAND_C).length;
    const near = tempMemberMeans.length - hotter - cooler;
    if (hotter >= cooler && hotter >= near) [tempLean, tempConfidence] = ["hotter", hotter / tempMemberMeans.length];
    else if (cooler >= hotter && cooler >= near) [tempLean, tempConfidence] = ["cooler", cooler / tempMemberMeans.length];
    else tempConfidence = near / tempMemberMeans.length;
  }

  return {
    windowDays: OUTLOOK_WINDOW_DAYS,
    precipLean,
    precipConfidence,
    tempLean,
    tempConfidence,
    forecastRainTotal,
    normalRainTotal: normal.rainTotal,
    forecastTempMean,
    normalTempMean: normal.tempMean,
    yearsOfNormal: normal.years,
  };
}
