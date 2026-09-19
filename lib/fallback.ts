import { readFile } from "fs/promises";
import path from "path";
import type { ObservationResult } from "./types";
import { parseNdviTimeSeries } from "./sentinelHub";

// Used when the live Sentinel-2 calls fail (auth outage, rate limit,
// network flake at demo time) so the UI still has something real to show
// instead of an error screen. This never applies to weather — a missing
// weather block is always a real failure (see app/api/field/route.ts).
export async function buildFallbackObservation(): Promise<ObservationResult> {
  const fixturesDir = path.join(process.cwd(), "fixtures");

  const [ndviSampleRaw, trueColorPng] = await Promise.all([
    readFile(path.join(fixturesDir, "ndvi-sample.json"), "utf-8"),
    readFile(path.join(fixturesDir, "truecolor.png")).catch(() => null),
  ]);

  const timeseries = parseNdviTimeSeries(JSON.parse(ndviSampleRaw), "fallback-fixture");
  const latest = timeseries[timeseries.length - 1] ?? null;

  const daysSinceClear = latest
    ? Math.round((Date.now() - new Date(latest.date).getTime()) / 86_400_000)
    : null;

  return {
    date: latest?.date ?? null,
    ndviMean: latest?.mean ?? null,
    ndviValid: latest !== null,
    cloudCover: null,
    daysSinceClear,
    trueColorImage: trueColorPng ? `data:image/png;base64,${trueColorPng.toString("base64")}` : null,
    ndviImage: null,
    timeseries,
  };
}
