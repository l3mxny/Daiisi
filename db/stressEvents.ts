import { getDb } from "./index";
import { getEmbedding, toVectorLiteral } from "@/lib/embeddings";
import { buildStressEventSummary, type FieldSnapshot } from "@/lib/fieldSnapshot";
import type { Severity, NdviTrend } from "@/lib/stressEvent";
import type { FieldRow } from "./fields";

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

export interface StressEventRow {
  id: string;
  fieldId: string;
  weekStart: string;
  ndviMean: number | null;
}

export async function getStressEventForWeek(fieldId: string, weekStart: string): Promise<StressEventRow | null> {
  const db = getDb();
  const { rows } = await db.query(
    "SELECT id, field_id, week_start, ndvi_mean FROM stress_events WHERE field_id = $1 AND week_start = $2",
    [fieldId, weekStart]
  );
  if (!rows[0]) return null;
  return { id: rows[0].id, fieldId: rows[0].field_id, weekStart: rows[0].week_start, ndviMean: rows[0].ndvi_mean };
}

// Builds the summary + embedding and upserts in one call — used by both the
// scheduled weekly job and a manual "refresh this field" fetch, so either
// one landing keeps that week's row current.
export async function recordStressEvent(field: FieldRow, snapshot: FieldSnapshot, weekStart: string): Promise<string> {
  const summary = buildStressEventSummary(field.name, field.crop, snapshot);
  const embedding = await getEmbedding(summary);

  return upsertStressEvent({
    fieldId: field.id,
    weekStart,
    severity: snapshot.stressEvent.severity,
    waterRatio: snapshot.weather.waterRatio,
    rain30: snapshot.weather.rain30,
    et030: snapshot.weather.et030,
    forecastRain16: snapshot.weather.forecastRain16,
    heatDays7: snapshot.weather.heatDays7,
    rain30Normal: snapshot.climateNormal?.rain30Normal ?? null,
    rainAnomalyRatio: snapshot.stressEvent.signature.rainAnomalyRatio,
    ndviMean: snapshot.observation.ndviMean,
    ndviDelta: snapshot.stressEvent.signature.ndviDelta,
    ndviTrend: snapshot.stressEvent.signature.ndviTrend,
    cloudCover: snapshot.observation.cloudCover,
    daysSinceClear: snapshot.observation.daysSinceClear,
    summary,
    embedding,
  });
}
