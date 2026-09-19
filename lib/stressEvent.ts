import type { WeatherMetrics } from "./weather";
import type { NdviPoint } from "./sentinelHub";
import type { ClimateNormal } from "./climate";

export type Severity = "ok" | "watch" | "act";
export type NdviTrend = "declining" | "stable" | "improving" | "unknown";

export interface StressEvent {
  detected: boolean;
  severity: Severity;
  message: string;
  signature: {
    waterRatio: number;
    rain30: number;
    et030: number;
    heatDays7: number;
    ndviDelta: number | null;
    ndviTrend: NdviTrend;
    rain30Normal: number | null;
    rainAnomalyRatio: number | null; // rain30 / rain30Normal, e.g. 0.5 = half the historical normal
  };
}

const SEVERITY_LEVELS: Severity[] = ["ok", "watch", "act"];

// A meaningful move in 90-day NDVI mean; smaller swings are noise.
const NDVI_DECLINE_THRESHOLD = -0.05;
const NDVI_IMPROVE_THRESHOLD = 0.05;

// Rainfall this dry/wet relative to the climate-normal window escalates or
// eases severity by one level.
const DRY_ANOMALY_RATIO = 0.5;
const WET_ANOMALY_RATIO = 1.5;

function clampLevel(index: number): Severity {
  return SEVERITY_LEVELS[Math.max(0, Math.min(SEVERITY_LEVELS.length - 1, index))];
}

export function computeNdviDelta(timeseries: NdviPoint[]): number | null {
  if (timeseries.length < 2) return null;
  return timeseries[timeseries.length - 1].mean - timeseries[0].mean;
}

function classifyNdviTrend(ndviDelta: number | null): NdviTrend {
  if (ndviDelta === null) return "unknown";
  if (ndviDelta <= NDVI_DECLINE_THRESHOLD) return "declining";
  if (ndviDelta >= NDVI_IMPROVE_THRESHOLD) return "improving";
  return "stable";
}

// Severity starts from waterRatio (the fraction of ET water replaced by
// rain, not absolute mm — a fixed millimeter threshold doesn't transfer
// between arid and temperate climates), then is nudged by two corroborating
// signals: a declining NDVI trend (the crop itself showing stress) escalates
// by a level, and rainfall well below its multi-year climate-normal for this
// same calendar window escalates too (well above normal eases it back down).
function classifySeverity(
  weather: WeatherMetrics,
  ndviTrend: NdviTrend,
  rainAnomalyRatio: number | null
): Severity {
  let level = 0;
  if (weather.waterRatio < 0.4) {
    level = weather.forecastRain16 < 10 ? 2 : 1;
  } else if (weather.waterRatio < 0.75) {
    level = 1;
  }

  if (ndviTrend === "declining") level += 1;

  if (rainAnomalyRatio !== null) {
    if (rainAnomalyRatio < DRY_ANOMALY_RATIO) level += 1;
    else if (rainAnomalyRatio > WET_ANOMALY_RATIO) level -= 1;
  }

  return clampLevel(level);
}

// One short factual sentence per active signal. No recommendations — a
// separate component generates recommendation text, and two sources of
// advice would conflict.
function buildMessage(
  weather: WeatherMetrics,
  ndviTrend: NdviTrend,
  rainAnomalyRatio: number | null,
  climateNormal: ClimateNormal | null
): string {
  const pct = Math.round(weather.waterRatio * 100);
  const forecastMm = Math.round(weather.forecastRain16);
  let message = `Rainfall replaced ${pct}% of water lost over 30 days; ${forecastMm}mm forecast in 16 days.`;

  if (rainAnomalyRatio !== null && climateNormal) {
    message += ` 30-day rainfall is ${Math.round(rainAnomalyRatio * 100)}% of the ${climateNormal.years}-year normal for this window.`;
  }

  if (ndviTrend === "declining") {
    message += " NDVI has been declining over the last 90 days.";
  } else if (ndviTrend === "improving") {
    message += " NDVI has been improving over the last 90 days.";
  }

  return message;
}

export function buildStressEvent(
  weather: WeatherMetrics,
  ndviDelta: number | null,
  climateNormal: ClimateNormal | null
): StressEvent {
  const ndviTrend = classifyNdviTrend(ndviDelta);
  const rainAnomalyRatio =
    climateNormal && climateNormal.rain30Normal > 0 ? weather.rain30 / climateNormal.rain30Normal : null;
  const severity = classifySeverity(weather, ndviTrend, rainAnomalyRatio);

  return {
    detected: severity !== "ok",
    severity,
    message: buildMessage(weather, ndviTrend, rainAnomalyRatio, climateNormal),
    signature: {
      waterRatio: weather.waterRatio,
      rain30: weather.rain30,
      et030: weather.et030,
      heatDays7: weather.heatDays7,
      ndviDelta,
      ndviTrend,
      rain30Normal: climateNormal?.rain30Normal ?? null,
      rainAnomalyRatio,
    },
  };
}
