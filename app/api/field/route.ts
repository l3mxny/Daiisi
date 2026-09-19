import { NextRequest, NextResponse } from "next/server";
import type { Bbox } from "@/lib/geo";
import { bboxCentroid, bboxFromPoint } from "@/lib/geo";
import { findLatestClearScene, getNdviImage, getNdviTimeSeries, getTrueColorImage } from "@/lib/sentinelHub";
import { buildFallbackObservation } from "@/lib/fallback";
import { getWeatherMetrics } from "@/lib/weather";
import { getClimateNormal } from "@/lib/climate";
import { buildStressEvent, computeNdviDelta } from "@/lib/stressEvent";
import type { FieldApiResponse, ObservationResult } from "@/lib/types";

function isValidBbox(value: unknown): value is Bbox {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((n) => typeof n === "number" && Number.isFinite(n)) &&
    value[0] < value[2] &&
    value[1] < value[3]
  );
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);

  let bbox: Bbox;
  if (body && isValidBbox(body.bbox)) {
    // Custom, user-drawn plot bounds.
    bbox = body.bbox;
  } else if (body && typeof body.lat === "number" && typeof body.lng === "number") {
    // Legacy point click: derive a small fixed-size box around it.
    bbox = bboxFromPoint(body.lat, body.lng);
  } else {
    return NextResponse.json(
      { error: "Either bbox ([west, south, east, north]) or lat/lng (numbers) are required" },
      { status: 400 }
    );
  }

  const [lat, lng] = bboxCentroid(bbox);

  // Weather has no cloud dependency and exists for every coordinate on
  // Earth, so unlike Sentinel-2 imagery, a failure here is a real error —
  // never silently swapped for fixture data. The climate normal is pure
  // enrichment (getClimateNormal never rejects — it degrades to null), so it
  // rides along on the same Promise.all without affecting error handling.
  let weather;
  let climateNormal;
  try {
    [weather, climateNormal] = await Promise.all([getWeatherMetrics(lat, lng), getClimateNormal(lat, lng)]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/field] weather request failed:", message);
    return NextResponse.json({ error: `Weather data unavailable: ${message}` }, { status: 502 });
  }

  let observation: ObservationResult;
  let usedFallback = false;
  try {
    observation = await buildLiveObservation(bbox);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/field] Sentinel-2 request failed, falling back to fixtures:", message);
    observation = await buildFallbackObservation();
    usedFallback = true;
  }

  const ndviDelta = computeNdviDelta(observation.timeseries);
  const stressEvent = buildStressEvent(weather, ndviDelta, climateNormal);

  const response: FieldApiResponse = {
    field: { bbox, centroid: [lat, lng] },
    observation,
    weather,
    stressEvent,
    usedFallback,
  };
  return NextResponse.json(response);
}

async function buildLiveObservation(bbox: Bbox): Promise<ObservationResult> {
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
    getTrueColorImage(bbox, scene.date),
    getNdviImage(bbox, scene.date),
    getNdviTimeSeries(bbox),
  ]);

  const date = scene.date.slice(0, 10);
  const daysSinceClear = Math.round((Date.now() - new Date(scene.date).getTime()) / 86_400_000);
  // Statistics coverage is sparse (cloud-masked days are dropped), so the
  // exact scene date rarely has its own stats entry — use the most recent
  // valid point instead.
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
