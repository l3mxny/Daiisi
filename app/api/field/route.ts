import { NextRequest, NextResponse } from "next/server";
import type { Bbox } from "@/lib/geo";
import { bboxCentroid, bboxFromPoint } from "@/lib/geo";
import { computeFieldSnapshot } from "@/lib/fieldSnapshot";
import { getFieldById } from "@/db/fields";
import { recordStressEvent } from "@/db/stressEvents";
import { evaluatePendingOutcome } from "@/db/outcomes";
import { getWeekStart } from "@/lib/week";
import type { FieldApiResponse } from "@/lib/types";

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

  let snapshot;
  try {
    snapshot = await computeFieldSnapshot(bbox, { withImages: true });
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
  if (typeof body?.fieldId === "string") {
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
