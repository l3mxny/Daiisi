import type { Bbox } from "./geo";
import { computeFieldSnapshot, type FieldSnapshot } from "./fieldSnapshot";

// A field's snapshot (satellite, weather, climate) barely changes within minutes: weather is hourly and a new
// satellite scene arrives every few days. Reloading the page or switching tabs used to redo about two seconds
// of upstream calls per field; this keeps the last result for a short while and shares one in-flight request
// between callers. In memory only, so it resets whenever the server restarts.
const TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 50;

interface Entry {
  at: number;
  snapshot: Promise<FieldSnapshot>;
}

const cache = new Map<string, Entry>();

export function getCachedSnapshot(
  bbox: Bbox,
  options: { withImages: boolean; asOf?: Date; fresh?: boolean }, // fresh: the farmer pressed Refresh, skip the saved copy
  compute: typeof computeFieldSnapshot = computeFieldSnapshot,
  now: number = Date.now()
): Promise<FieldSnapshot> {
  const key = `${bbox.join(",")}|${options.withImages}|${options.asOf?.toISOString() ?? "now"}`;
  const hit = cache.get(key);
  if (hit && !options.fresh && now - hit.at < TTL_MS) return hit.snapshot;

  const snapshot = compute(bbox, { withImages: options.withImages, asOf: options.asOf });
  cache.set(key, { at: now, snapshot });
  // A failure must not be remembered: the next request should try again.
  snapshot.catch(() => {
    if (cache.get(key)?.snapshot === snapshot) cache.delete(key);
  });
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  return snapshot;
}

export function clearSnapshotCache(): void {
  cache.clear();
}
