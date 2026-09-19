import type { Bbox } from "./geo";
import type { NdviPoint } from "./sentinelHub";
import type { WeatherMetrics } from "./weather";
import type { StressEvent } from "./stressEvent";

export interface ObservationResult {
  date: string | null; // yyyy-mm-dd of the satellite scene
  ndviMean: number | null;
  ndviValid: boolean; // false when cloud cover blocked NDVI for this scene
  cloudCover: number | null;
  daysSinceClear: number | null;
  trueColorImage: string | null;
  ndviImage: string | null;
  timeseries: NdviPoint[];
}

export interface FieldApiResponse {
  field: { bbox: Bbox; centroid: [number, number] };
  observation: ObservationResult;
  weather: WeatherMetrics;
  stressEvent: StressEvent;
  usedFallback: boolean;
  error?: string;
}

// One user-selected plot on the map, tracked independently of the others so
// each can load, fail, or refresh without touching its siblings.
export interface Plot {
  id: string;
  label: string;
  bbox: Bbox;
  color: string;
  status: "loading" | "ready" | "error";
  data: FieldApiResponse | null;
  previousData: FieldApiResponse | null; // last-known-good snapshot before the current refresh, for "since last check"
  error: string | null;
}
