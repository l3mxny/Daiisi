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

  return { rain30, et030, waterRatio, forecastRain16, daysSinceRain, heatDays7 };
}

// No API key, no auth. Throws on any failure — weather has no cloud
// dependency and exists for every coordinate, so callers must treat a
// failure here as a real error rather than falling back silently.
export async function getWeatherMetrics(lat: number, lng: number): Promise<WeatherMetrics> {
  const url = new URL(OPEN_METEO_URL);
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lng));
  url.searchParams.set("daily", "precipitation_sum,et0_fao_evapotranspiration,temperature_2m_max");
  url.searchParams.set("past_days", String(PAST_DAYS));
  url.searchParams.set("forecast_days", String(FORECAST_DAYS));
  url.searchParams.set("timezone", "auto");

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Open-Meteo request failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  return parseWeatherMetrics(json);
}
