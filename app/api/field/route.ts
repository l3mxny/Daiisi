import { NextRequest, NextResponse } from "next/server";
import type { Bbox } from "@/lib/geo";
import { bboxCentroid, bboxFromPoint } from "@/lib/geo";
import { getCachedSnapshot } from "@/lib/snapshotCache";
import { getFieldById } from "@/db/fields";
import { recordStressEvent } from "@/db/stressEvents";
import { evaluatePendingOutcome } from "@/db/outcomes";
import { getWeekStart } from "@/lib/week";
import type { FieldApiResponse } from "@/lib/types";

// Satellite, weather and AI calls can be slow on a cold start; Vercel cuts a function off at this many seconds.
export const maxDuration = 60;

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

  // Replay: show the field as it was on a past date (yyyy-mm-dd). Nothing is recorded for a replay.
  let asOf: Date | undefined;
  if (body && body.asOf !== undefined && body.asOf !== null) {
    const parsed = typeof body.asOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.asOf) ? new Date(`${body.asOf}T00:00:00Z`) : null;
    if (!parsed || Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: "asOf must be a date like 2023-09-01" }, { status: 400 });
    }
    if (parsed.getTime() > Date.now() - 22 * 86_400_000) {
      return NextResponse.json({ error: "A replay date must be at least three weeks in the past." }, { status: 400 });
    }
    asOf = parsed;
  }

  let snapshot;
  try {
    snapshot = await getCachedSnapshot(bbox, { withImages: true, asOf, fresh: body?.refresh === true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/field] weather request failed:", message);
    return NextResponse.json({ error: `Weather data unavailable: ${message}` }, { status: 502 });
  }

  // When this request is for a saved field, record this check-in as this
  // week's stress_events row (same table the scheduled job writes to) —
  // best-effort: a failure here shouldn't block the farmer from seeing
  // their field's stats.
  let stressEventId: string | null = null;
  if (!asOf && typeof body?.fieldId === "string") {
    try {
      const field = await getFieldById(body.fieldId);
      if (field) {
        const weekStart = getWeekStart();
        await evaluatePendingOutcome(field, snapshot, weekStart);
        stressEventId = await recordStressEvent(field, snapshot, weekStart);
      }
    } catch (err) {
      console.error("[/api/field] failed to record stress event:", err);
    }
  }

  const response: FieldApiResponse = {
    field: { bbox, centroid: [lat, lng] },
    observation: snapshot.observation,
    weather: snapshot.weather,
    stressEvent: snapshot.stressEvent,
    seasonalOutlook: snapshot.seasonalOutlook,
    usedFallback: snapshot.usedFallback,
    stressEventId,
  };
  return NextResponse.json(response);
}
