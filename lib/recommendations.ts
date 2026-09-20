import { bboxAreaHectares } from "./geo";
import type { WeatherMetrics } from "./weather";
import type { StressEvent, Severity } from "./stressEvent";
import type { FieldApiResponse, ObservationResult } from "./types";

// Kept separate from stressEvent.ts's buildMessage on purpose (see that
// file's comment): buildMessage states the raw signal readings, this module
// turns those signals into "how urgent" (score), "what the imagery implies"
// (outlook), and "what to actually do" (actions) — one source of advice.

export interface PlotRecommendation {
  priorityScore: number; // higher = needs attention sooner; for ranking plots against each other
  satelliteOutlook: string;
  actions: string[];
  areaHectares: number;
  irrigationLiters: number | null; // estimated liters to close the 30-day water deficit; null when no deficit
  irrigationMm: number | null; // the same deficit as depth of water (mm), which is how irrigation is specified
}

const SEVERITY_BASE_SCORE: Record<Severity, number> = { ok: 0, watch: 50, act: 100 };

function computePriorityScore(stressEvent: StressEvent): number {
  const sig = stressEvent.signature;
  let score = SEVERITY_BASE_SCORE[stressEvent.severity];

  // The further waterRatio falls below the "watch" line, the more urgent.
  score += Math.max(0, 0.75 - sig.waterRatio) * 40;

  if (sig.ndviDelta !== null && sig.ndviDelta < 0) {
    score += Math.min(20, -sig.ndviDelta * 200);
  }

  if (sig.rainAnomalyRatio !== null && sig.rainAnomalyRatio < 1) {
    score += (1 - Math.min(1, sig.rainAnomalyRatio)) * 15;
  }

  score += Math.min(10, sig.heatDays7 * 1.5);

  return Math.round(score);
}

function buildSatelliteOutlook(observation: ObservationResult, stressEvent: StressEvent): string {
  if (!observation.ndviValid) {
    return observation.daysSinceClear !== null
      ? `Cloud cover has blocked a clear scene for ${observation.daysSinceClear}d — no fresh imagery to confirm ground conditions, so this reading leans on weather data alone.`
      : "No clear satellite scene in the last 60 days — this reading leans on weather data alone.";
  }

  switch (stressEvent.signature.ndviTrend) {
    case "declining":
      return "NDVI (greenness) has been trending down over the last 90 days, which can be an early sign of crop stress.";
    case "improving":
      return "NDVI has been trending up over the last 90 days — the canopy is recovering or actively growing.";
    case "stable":
      return "NDVI has held steady over the last 90 days — no canopy-visible stress yet, even where weather signals are marginal.";
    default:
      return "Not enough NDVI history yet to read a trend.";
  }
}

function buildActions(weather: WeatherMetrics, stressEvent: StressEvent): string[] {
  const sig = stressEvent.signature;
  const actions: string[] = [];
  const deficitMm = Math.round(weather.et030 - weather.rain30);
  const forecastMm = Math.round(weather.forecastRain16);
  const covered = weather.forecastRain16 >= weather.et030 - weather.rain30;

  // Every line below is gated on the FINAL verdict, so a plot the rules call OK is never told anything
  // that reads as a warning (the dry-spell line used to print under "Hold off irrigating").
  if (stressEvent.severity === "ok") {
    if (sig.waterRatio < 0.75 && covered) {
      actions.push(`Hold off irrigating for now — ${forecastMm}mm of rain is forecast in the next 16 days, more than the ${deficitMm}mm gap; recheck once it lands.`);
    }
  } else {
    if (sig.waterRatio < 0.4) {
      // "Hold off" is only true when the forecast actually covers the gap; a little rain does not.
      actions.push(
        covered
          ? `Hold off irrigating for now — ${forecastMm}mm of rain is forecast in the next 16 days, more than the ${deficitMm}mm gap; recheck once it lands.`
          : `Irrigate soon — only ${forecastMm}mm of rain is forecast in the next 16 days against a ${deficitMm}mm gap.`
      );
    } else if (sig.waterRatio < 0.75) {
      actions.push("Monitor soil moisture; a light irrigation may be worth it if the dry stretch continues.");
    }

    if (sig.ndviTrend === "declining" && sig.waterRatio >= 0.75) {
      actions.push("Water supply looks adequate, so the NDVI drop may not be water-driven — inspect in person for pests, disease, or a nutrient deficiency.");
    }

    if (sig.rainAnomalyRatio !== null && sig.rainAnomalyRatio < 0.5) {
      actions.push("This dry spell is unusually severe for the season (well below the historical normal) — worth checking even if the absolute numbers seem borderline.");
    }
  }

  if (sig.heatDays7 >= 3) {
    actions.push(`Shift irrigation to early morning or evening — ${sig.heatDays7} of the last 7 days topped 32°C.`);
  }

  if (actions.length === 0) {
    actions.push("No action needed right now — keep this plot on routine monitoring.");
  }

  return actions;
}

// 1mm of deficit depth over 1m² is 1L, so deficitMm * areaM2 gives liters
// directly. Only surfaced once soil water is already in watch/act territory
// (waterRatio < 0.75) — a positive deficit alone isn't reason enough to quote
// a volume.
function estimateIrrigationLiters(weather: WeatherMetrics, stressEvent: StressEvent, areaHectares: number): number | null {
  if (stressEvent.signature.waterRatio >= 0.75) return null;
  const deficitMm = weather.et030 - weather.rain30;
  if (deficitMm <= 0) return null;
  return Math.round(deficitMm * areaHectares * 10_000);
}

function estimateIrrigationMm(weather: WeatherMetrics, stressEvent: StressEvent): number | null {
  if (stressEvent.signature.waterRatio >= 0.75) return null;
  const deficitMm = weather.et030 - weather.rain30;
  return deficitMm > 0 ? Math.round(deficitMm) : null;
}

export function buildPlotRecommendation(data: FieldApiResponse): PlotRecommendation {
  const areaHectares = bboxAreaHectares(data.field.bbox);
  return {
    priorityScore: computePriorityScore(data.stressEvent),
    satelliteOutlook: buildSatelliteOutlook(data.observation, data.stressEvent),
    actions: buildActions(data.weather, data.stressEvent),
    areaHectares,
    irrigationLiters: estimateIrrigationLiters(data.weather, data.stressEvent, areaHectares),
    irrigationMm: estimateIrrigationMm(data.weather, data.stressEvent),
  };
}

// Best-effort "vs. last time you checked this plot" comparison. There's no
// persistence layer here, so this only has something to say once a plot has
// been refreshed at least once in the current session — the 90-day NDVI
// chart is the real documented history and is shown alongside this.
export function buildChangeSinceLastCheck(previous: FieldApiResponse, current: FieldApiResponse): string {
  const parts: string[] = [];

  if (previous.stressEvent.severity !== current.stressEvent.severity) {
    parts.push(`Severity moved ${previous.stressEvent.severity.toUpperCase()} → ${current.stressEvent.severity.toUpperCase()}`);
  }

  const waterDeltaPts = Math.round((current.weather.waterRatio - previous.weather.waterRatio) * 100);
  if (Math.abs(waterDeltaPts) >= 2) {
    parts.push(`Water ratio ${waterDeltaPts > 0 ? "up" : "down"} ${Math.abs(waterDeltaPts)}pts`);
  }

  if (current.observation.ndviMean !== null && previous.observation.ndviMean !== null) {
    const ndviDelta = current.observation.ndviMean - previous.observation.ndviMean;
    if (Math.abs(ndviDelta) >= 0.01) {
      parts.push(`NDVI ${ndviDelta > 0 ? "up" : "down"} ${Math.abs(ndviDelta).toFixed(2)}`);
    }
  }

  return parts.length > 0 ? parts.join(" · ") : "No meaningful change since your last check.";
}
