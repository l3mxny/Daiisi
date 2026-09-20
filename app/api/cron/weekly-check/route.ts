import { NextRequest, NextResponse } from "next/server";
import { listFields } from "@/db/fields";
import { recordStressEvent } from "@/db/stressEvents";
import { evaluatePendingOutcome } from "@/db/outcomes";
import { computeFieldSnapshot } from "@/lib/fieldSnapshot";
import { getWeekStart } from "@/lib/week";

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
      await evaluatePendingOutcome(field, snapshot, weekStart);
      await recordStressEvent(field, snapshot, weekStart);
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
