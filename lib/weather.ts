const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";

// Single source of truth for the request window, since parsing needs to
// know where "today" falls in the returned arrays.
const PAST_DAYS = 92;
const FORECAST_DAYS = 16;
const RAIN_WINDOW_DAYS = 30;
const HEAT_WINDOW_DAYS = 7;
const RAIN_THRESHOLD_MM = 1;
const HEAT_THRESHOLD_C = 32;

export interface WeatherMetrics {
  rain30: number;
  et030: number;
  waterRatio: number;
  forecastRain16: number;
  daysSinceRain: number;
  heatDays7: number;
  rain7: number; // actual rainfall over the last 7 days — for checking what really happened, vs. the forecast used at recommendation time
}

interface OpenMeteoResponse {
  daily?: {
    time?: string[];
    precipitation_sum?: Array<number | null>;
    et0_fao_evapotranspiration?: Array<number | null>;
    temperature_2m_max?: Array<number | null>;
  };
}

function sum(values: Array<number | null>): number {
  return values.reduce<number>((total, v) => total + (typeof v === "number" ? v : 0), 0);
}

// Open-Meteo's `daily` arrays run [today - past_days, ..., today - 1, today,
// ..., today + forecast_days - 1]. We derive the "today" index from the
// actual array length and the forecast_days we requested (rather than
// trusting past_days was honored exactly), so entries before that index are
// observed and the index itself onward is forecast — including today.
export function parseWeatherMetrics(json: OpenMeteoResponse): WeatherMetrics {
  const daily = json.daily;
  const time = daily?.time ?? [];
  const precip = daily?.precipitation_sum ?? [];
  const et0 = daily?.et0_fao_evapotranspiration ?? [];
  const tempMax = daily?.temperature_2m_max ?? [];

  const todayIndex = Math.max(0, time.length - FORECAST_DAYS);

  const rainWindowStart = Math.max(0, todayIndex - RAIN_WINDOW_DAYS);
  const rain30 = sum(precip.slice(rainWindowStart, todayIndex));
  const et030 = sum(et0.slice(rainWindowStart, todayIndex));
  const waterRatio = et030 > 0 ? rain30 / et030 : 1;

  const forecastRain16 = sum(precip.slice(todayIndex));

  let daysSinceRain = todayIndex; // never rained above threshold in the observed record
  for (let i = todayIndex - 1; i >= 0; i--) {
    const v = precip[i];
    if (typeof v === "number" && v > RAIN_THRESHOLD_MM) {
      daysSinceRain = todayIndex - i;
      break;
    }
  }

  const heatWindowStart = Math.max(0, todayIndex - HEAT_WINDOW_DAYS);
  const heatDays7 = tempMax
    .slice(heatWindowStart, todayIndex)
    .filter((v): v is number => typeof v === "number" && v > HEAT_THRESHOLD_C).length;

  // Same 7-day window as heatDays7 — reused rather than a separate constant.
  const rain7 = sum(precip.slice(heatWindowStart, todayIndex));

  return { rain30, et030, waterRatio, forecastRain16, daysSinceRain, heatDays7, rain7 };
}

// Open-Meteo is free and shared, and now and then it stalls or answers with an error page that is not JSON
// (seen as "Unexpected token 'U', "Unexpected"... is not valid JSON" after a 30-60 s wait). Give each try a
// deadline and try again a couple of times before calling the weather unavailable.
const ATTEMPTS = 3;
const ATTEMPT_TIMEOUT_MS = 12_000;

export async function fetchWeatherJson(url: string, fetchImpl: typeof fetch = fetch, retryDelayMs = 500): Promise<OpenMeteoResponse> {
  let lastError = "no response";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS) });
      if (res.ok) return (await res.json()) as OpenMeteoResponse;
      lastError = `status ${res.status}`;
      if (res.status >= 400 && res.status < 500 && res.status !== 429) break; // our request is wrong; trying again won't help
    } catch (err) {
      lastError = err instanceof Error && err.name === "TimeoutError" ? "timed out" : "unreadable response";
    }
    if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, retryDelayMs * attempt));
  }
  throw new Error(`Open-Meteo did not give a usable answer (${lastError})`);
}

const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";
const DAY_MS = 86_400_000;

// Replay of a past date: the same window (92 days before, 16 after) read from Open-Meteo's archive of what
// really happened. The "forecast" for a replay is therefore what actually fell, which is hindsight, not a
// prediction; the replay screen says so. The archive lags a few days, so the window must end before that.
async function getReplayWeatherMetrics(lat: number, lng: number, asOf: Date): Promise<WeatherMetrics> {
  const start = new Date(asOf.getTime() - PAST_DAYS * DAY_MS);
  const end = new Date(asOf.getTime() + (FORECAST_DAYS - 1) * DAY_MS);
  if (end.getTime() > Date.now() - 6 * DAY_MS) {
    throw new Error("A replay date must be at least three weeks in the past.");
  }
  const url = new URL(ARCHIVE_URL);
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lng));
  url.searchParams.set("start_date", start.toISOString().slice(0, 10));
  url.searchParams.set("end_date", end.toISOString().slice(0, 10));
  url.searchParams.set("daily", "precipitation_sum,et0_fao_evapotranspiration,temperature_2m_max");
  url.searchParams.set("timezone", "auto");
  return parseWeatherMetrics(await fetchWeatherJson(url.toString()));
}

// No API key, no auth. Throws on any failure — weather has no cloud
// dependency and exists for every coordinate, so callers must treat a
// failure here as a real error rather than falling back silently.
export async function getWeatherMetrics(lat: number, lng: number, asOf?: Date): Promise<WeatherMetrics> {
  if (asOf) return getReplayWeatherMetrics(lat, lng, asOf);
  const url = new URL(OPEN_METEO_URL);
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lng));
  url.searchParams.set("daily", "precipitation_sum,et0_fao_evapotranspiration,temperature_2m_max");
  url.searchParams.set("past_days", String(PAST_DAYS));
  url.searchParams.set("forecast_days", String(FORECAST_DAYS));
  url.searchParams.set("timezone", "auto");

  const json = await fetchWeatherJson(url.toString());
  return parseWeatherMetrics(json);
}
