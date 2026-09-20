import { NextRequest, NextResponse } from "next/server";
import { listFields, type FieldRow } from "@/db/fields";
import { recordStressEvent } from "@/db/stressEvents";
import { evaluatePendingOutcome } from "@/db/outcomes";
import { getLastDigestKey, recordSmsSent } from "@/db/smsLog";
import { computeFieldSnapshot } from "@/lib/fieldSnapshot";
import { getWeekStart } from "@/lib/week";
import { composeDigest, type DigestPlotInput } from "@/lib/smsDigest";
import { sendSms, toE164US } from "@/lib/sms";
import { bboxCentroid } from "@/lib/geo";
import type { FieldApiResponse } from "@/lib/types";

// Vercel Cron calls this on a schedule (see vercel.ts). Guarded by
// CRON_SECRET so it can't be triggered by an arbitrary request — Vercel
// Cron sends it as a bearer token automatically once the env var is set.
// https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // not configured yet (e.g. local dev) — allow
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

interface FieldResult {
  field: FieldRow;
  data: FieldApiResponse;
}

// One text per farmer (not per field): every one of their fields that needs
// attention, ranked, in a single message — composeDigest already does the
// ranking/formatting. Skipped entirely if nothing's actionable, or if
// nothing's changed since the last text (db/smsLog.ts) so a farmer isn't
// re-sent an identical message every week.
async function sendDigests(results: FieldResult[]): Promise<Array<{ phone: string; sent: boolean; reason: string }>> {
  const byPhone = new Map<string, DigestPlotInput[]>();
  for (const { field, data } of results) {
    const list = byPhone.get(field.phone) ?? [];
    list.push({ id: field.id, name: field.name, data });
    byPhone.set(field.phone, list);
  }

  const outcomes: Array<{ phone: string; sent: boolean; reason: string }> = [];
  for (const [phone, plots] of byPhone) {
    const digest = composeDigest(plots);
    if (digest.totalActionable === 0) {
      outcomes.push({ phone, sent: false, reason: "Nothing needs action" });
      continue;
    }

    const lastKey = await getLastDigestKey(phone).catch(() => null);
    if (lastKey === digest.key) {
      outcomes.push({ phone, sent: false, reason: "Same as the last text, nothing new to say" });
      continue;
    }

    const to = toE164US(phone);
    if (!to) {
      outcomes.push({ phone, sent: false, reason: "Not a valid US number" });
      continue;
    }

    try {
      const { sid } = await sendSms(to, digest.text);
      await recordSmsSent(phone, digest.key, digest.text, sid);
      outcomes.push({ phone, sent: true, reason: "Sent" });
    } catch (err) {
      console.error(`[cron/weekly-check] SMS to ${phone} failed:`, err);
      outcomes.push({ phone, sent: false, reason: err instanceof Error ? err.message : "Send failed" });
    }
  }
  return outcomes;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const weekStart = getWeekStart();
  const fields = await listFields();

  const results = await Promise.allSettled(
    fields.map(async (field): Promise<FieldResult> => {
      const snapshot = await computeFieldSnapshot(field.bbox, { withImages: false });
      await evaluatePendingOutcome(field, snapshot, weekStart);
      const stressEventId = await recordStressEvent(field, snapshot, weekStart);
      const data: FieldApiResponse = {
        field: { bbox: field.bbox, centroid: bboxCentroid(field.bbox) },
        observation: snapshot.observation,
        weather: snapshot.weather,
        stressEvent: snapshot.stressEvent,
        seasonalOutlook: snapshot.seasonalOutlook,
        usedFallback: snapshot.usedFallback,
        stressEventId,
      };
      return { field, data };
    })
  );

  const succeeded = results.filter((r): r is PromiseFulfilledResult<FieldResult> => r.status === "fulfilled").map((r) => r.value);
  const failed = results
    .map((r, i) => (r.status === "rejected" ? { fieldId: fields[i].id, error: String(r.reason) } : null))
    .filter((f): f is { fieldId: string; error: string } => f !== null);

  if (failed.length > 0) {
    console.error("[cron/weekly-check] some fields failed:", failed);
  }

  const sms = await sendDigests(succeeded);

  return NextResponse.json({ weekStart, total: fields.length, succeeded: succeeded.length, failed, sms });
}
