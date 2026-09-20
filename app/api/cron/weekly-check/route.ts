import { NextRequest, NextResponse } from "next/server";
import { listFields } from "@/db/fields";
import { recordStressEvent } from "@/db/stressEvents";
import { evaluatePendingOutcome } from "@/db/outcomes";
import { computeFieldSnapshot } from "@/lib/fieldSnapshot";
import { getWeekStart } from "@/lib/week";
import { isCronAuthorized } from "@/lib/cronAuth";

// Vercel Cron calls this on a schedule (see vercel.ts). It only runs for a caller that presents CRON_SECRET (Vercel
// Cron sends it as a bearer token once the env var is set); with no secret configured it refuses everyone outside
// `next dev`. See lib/cronAuth.ts.
// https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs

// The job walks every saved field, so it needs far longer than a normal request.
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req.headers.get("authorization"))) {
    if (!process.env.CRON_SECRET && process.env.NODE_ENV !== "development") {
      console.error("[cron] CRON_SECRET is not set, so the weekly job is refusing every request. Set it in the environment.");
    }
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
