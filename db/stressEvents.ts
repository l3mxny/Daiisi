import { getDb } from "./index";
import { toVectorLiteral } from "@/lib/embeddings";
import type { Severity, NdviTrend } from "@/lib/stressEvent";

export interface StressEventInput {
  fieldId: string;
  weekStart: string; // yyyy-mm-dd
  severity: Severity;
  waterRatio: number | null;
  rain30: number | null;
  et030: number | null;
  forecastRain16: number | null;
  heatDays7: number | null;
  rain30Normal: number | null;
  rainAnomalyRatio: number | null;
  ndviMean: number | null;
  ndviDelta: number | null;
  ndviTrend: NdviTrend | null;
  cloudCover: number | null;
  daysSinceClear: number | null;
  summary: string;
  embedding: number[];
}

// One row per field per calendar week (see the UNIQUE(field_id, week_start)
// constraint) — re-running the weekly job for the same week updates that
// week's snapshot instead of duplicating it.
export async function upsertStressEvent(input: StressEventInput): Promise<string> {
  const db = getDb();
  const { rows } = await db.query(
    `INSERT INTO stress_events (
       field_id, week_start, severity,
       water_ratio, rain_30, et0_30, forecast_rain_16, heat_days_7, rain_30_normal, rain_anomaly_ratio,
       ndvi_mean, ndvi_delta, ndvi_trend, cloud_cover, days_since_clear,
       summary, embedding
     ) VALUES (
       $1, $2, $3,
       $4, $5, $6, $7, $8, $9, $10,
       $11, $12, $13, $14, $15,
       $16, $17::vector
     )
     ON CONFLICT (field_id, week_start) DO UPDATE SET
       severity = EXCLUDED.severity,
       water_ratio = EXCLUDED.water_ratio,
       rain_30 = EXCLUDED.rain_30,
       et0_30 = EXCLUDED.et0_30,
       forecast_rain_16 = EXCLUDED.forecast_rain_16,
       heat_days_7 = EXCLUDED.heat_days_7,
       rain_30_normal = EXCLUDED.rain_30_normal,
       rain_anomaly_ratio = EXCLUDED.rain_anomaly_ratio,
       ndvi_mean = EXCLUDED.ndvi_mean,
       ndvi_delta = EXCLUDED.ndvi_delta,
       ndvi_trend = EXCLUDED.ndvi_trend,
       cloud_cover = EXCLUDED.cloud_cover,
       days_since_clear = EXCLUDED.days_since_clear,
       summary = EXCLUDED.summary,
       embedding = EXCLUDED.embedding
     RETURNING id`,
    [
      input.fieldId,
      input.weekStart,
      input.severity,
      input.waterRatio,
      input.rain30,
      input.et030,
      input.forecastRain16,
      input.heatDays7,
      input.rain30Normal,
      input.rainAnomalyRatio,
      input.ndviMean,
      input.ndviDelta,
      input.ndviTrend,
      input.cloudCover,
      input.daysSinceClear,
      input.summary,
      toVectorLiteral(input.embedding),
    ]
  );
  return rows[0].id;
}
