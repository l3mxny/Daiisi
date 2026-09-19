import { NextRequest, NextResponse } from "next/server";
import { listFields } from "@/db/fields";
import { upsertStressEvent } from "@/db/stressEvents";
import { computeFieldSnapshot } from "@/lib/fieldSnapshot";
import { getEmbedding } from "@/lib/embeddings";
import { getWeekStart } from "@/lib/week";

function buildSummary(fieldName: string, crop: string, snapshot: Awaited<ReturnType<typeof computeFieldSnapshot>>): string {
  const label = crop ? `${crop} field "${fieldName}"` : `Field "${fieldName}"`;
  return `${label} — ${snapshot.stressEvent.severity.toUpperCase()}: ${snapshot.stressEvent.message}`;
}

// Vercel Cron calls this on a schedule (see vercel.ts). Guarded by
// CRON_SECRET so it can't be triggered by an arbitrary request — Vercel
// Cron sends it as a bearer token automatically once the env var is set.
// https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // not configured yet (e.g. local dev) — allow
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const weekStart = getWeekStart();
  const fields = await listFields();

  const results = await Promise.allSettled(
    fields.map(async (field) => {
      const snapshot = await computeFieldSnapshot(field.bbox, { withImages: false });
      const summary = buildSummary(field.name, field.crop, snapshot);
      const embedding = await getEmbedding(summary);

      await upsertStressEvent({
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

      return field.id;
    })
  );

  const succeeded = results.filter((r) => r.status === "fulfilled").length;
  const failed = results
    .map((r, i) => (r.status === "rejected" ? { fieldId: fields[i].id, error: String(r.reason) } : null))
    .filter((f): f is { fieldId: string; error: string } => f !== null);

  if (failed.length > 0) {
    console.error("[cron/weekly-check] some fields failed:", failed);
  }

  return NextResponse.json({ weekStart, total: fields.length, succeeded, failed });
}
