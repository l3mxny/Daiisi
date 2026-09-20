import type { Bbox } from "./geo";
import { bboxCentroid } from "./geo";
import { findLatestClearScene, getNdviImage, getNdviTimeSeries, getTrueColorImage } from "./sentinelHub";
import { buildFallbackObservation } from "./fallback";
import { getWeatherMetrics, type WeatherMetrics } from "./weather";
import { getClimateNormal, type ClimateNormal } from "./climate";
import { getSeasonalOutlook, type SeasonalOutlook } from "./seasonalOutlook";
import { buildStressEvent, computeNdviDelta, type StressEvent } from "./stressEvent";
import type { ObservationResult } from "./types";

// Shared by the interactive /api/field route (wants map imagery) and the
// weekly background job (only wants the numeric/text signals) — pulled out
// so both compute a field's condition the same way instead of drifting.
export async function computeObservation(bbox: Bbox, options: { withImages: boolean }): Promise<ObservationResult> {
  const scene = await findLatestClearScene(bbox);

  if (!scene) {
    return {
      date: null,
      ndviMean: null,
      ndviValid: false,
      cloudCover: null,
      daysSinceClear: null,
      trueColorImage: null,
      ndviImage: null,
      timeseries: await getNdviTimeSeries(bbox),
    };
  }

  const [trueColorImage, ndviImage, timeseries] = await Promise.all([
    options.withImages ? getTrueColorImage(bbox, scene.date) : Promise.resolve(null),
    options.withImages ? getNdviImage(bbox, scene.date) : Promise.resolve(null),
    getNdviTimeSeries(bbox),
  ]);

  const date = scene.date.slice(0, 10);
  const daysSinceClear = Math.round((Date.now() - new Date(scene.date).getTime()) / 86_400_000);
  const latestSeriesPoint = timeseries[timeseries.length - 1] ?? null;

  return {
    date,
    ndviMean: latestSeriesPoint?.mean ?? null,
    ndviValid: latestSeriesPoint !== null,
    cloudCover: scene.cloudCover,
    daysSinceClear,
    trueColorImage,
    ndviImage,
    timeseries,
  };
}

export interface FieldSnapshot {
  observation: ObservationResult;
  weather: WeatherMetrics;
  climateNormal: ClimateNormal | null;
  seasonalOutlook: SeasonalOutlook | null;
  stressEvent: StressEvent;
  usedFallback: boolean;
}

// Throws on weather failure (a real error — see lib/weather.ts), falls back
// to fixture imagery on a Sentinel Hub failure (see lib/fallback.ts). The
// seasonal outlook is pure enrichment like climateNormal — getSeasonalOutlook
// degrades to null on failure rather than rejecting.
export async function computeFieldSnapshot(bbox: Bbox, options: { withImages: boolean }): Promise<FieldSnapshot> {
  const [lat, lng] = bboxCentroid(bbox);

  const [weather, climateNormal, seasonalOutlook] = await Promise.all([
    getWeatherMetrics(lat, lng),
    getClimateNormal(lat, lng),
    getSeasonalOutlook(lat, lng).catch(() => null),
  ]);

  let observation: ObservationResult;
  let usedFallback = false;
  try {
    observation = await computeObservation(bbox, options);
  } catch (err) {
    console.error("[fieldSnapshot] Sentinel-2 request failed, falling back to fixtures:", err);
    observation = await buildFallbackObservation();
    usedFallback = true;
  }

  const ndviDelta = computeNdviDelta(observation.timeseries);
  const stressEvent = buildStressEvent(weather, ndviDelta, climateNormal);

  return { observation, weather, climateNormal, seasonalOutlook, stressEvent, usedFallback };
}

// The short text a stress_events row is embedded from — shared so a manual
// refresh and the scheduled weekly job describe the same snapshot the same
// way, since both write into the same table.
export function buildStressEventSummary(fieldName: string, crop: string, snapshot: FieldSnapshot): string {
  const label = crop ? `${crop} field "${fieldName}"` : `Field "${fieldName}"`;
  let summary = `${label} — ${snapshot.stressEvent.severity.toUpperCase()}: ${snapshot.stressEvent.message}`;

  const outlook = snapshot.seasonalOutlook;
  if (outlook && (outlook.precipLean !== "near_normal" || outlook.tempLean !== "near_normal")) {
    const parts: string[] = [];
    if (outlook.precipLean !== "near_normal") {
      parts.push(`${outlook.precipLean} than normal (${Math.round(outlook.precipConfidence * 100)}% of outlook members)`);
    }
    if (outlook.tempLean !== "near_normal") {
      parts.push(`${outlook.tempLean} than normal (${Math.round(outlook.tempConfidence * 100)}% of outlook members)`);
    }
    summary += ` Seasonal outlook for the next ${outlook.windowDays} days: ${parts.join(", ")}.`;
  }

  return summary;
}
