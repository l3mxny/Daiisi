import { NextRequest, NextResponse } from "next/server";
import { validateTwilioSignature, usPhoneFromE164 } from "@/lib/sms";
import { listFieldsByPhone, type FieldRow } from "@/db/fields";
import { getDb } from "@/db/index";
import { getNoteStore } from "@/lib/notesStore";
import { parseNote } from "@/lib/noteParser";
import { groqComplete, type LlmCall } from "@/lib/noteLlm";
import { EVENT_LABELS } from "@/lib/noteTypes";

// Twilio webhook for an inbound SMS reply to the weekly digest. Configure
// this route's full URL (https://<your-deployment>/api/sms/inbound) as the
// "A message comes in" webhook on the Twilio phone number in the console.
//
// Runs the reply through the exact same transcript -> structured note
// pipeline as a voice note (lib/noteParser.ts), then saves it the same way
// (db/fieldNotes.ts) — which is what turns an actionable reply ("irrigated
// this morning") into an `interventions` row linked to that field's current
// stress event, same as before.

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function twiml(message?: string): NextResponse {
  const body = `<?xml version="1.0" encoding="UTF-8"?><Response>${message ? `<Message>${xmlEscape(message)}</Message>` : ""}</Response>`;
  return new NextResponse(body, { status: 200, headers: { "Content-Type": "text/xml" } });
}

const SEVERITY_RANK: Record<string, number> = { act: 2, watch: 1, ok: 0 };

// No "currently open field panel" exists for an SMS the way there is in the
// UI — default to whichever field most recently needed the most attention.
// parseNote can still override this if the reply names a different field.
async function pickDefaultField(fields: FieldRow[]): Promise<string> {
  if (fields.length <= 1) return fields[0].id;
  const db = getDb();
  const { rows } = await db.query<{ field_id: string; severity: string }>(
    `SELECT DISTINCT ON (field_id) field_id, severity
     FROM stress_events
     WHERE field_id = ANY($1)
     ORDER BY field_id, week_start DESC`,
    [fields.map((f) => f.id)]
  );
  let best = fields[0].id;
  let bestRank = -1;
  for (const row of rows) {
    const rank = SEVERITY_RANK[row.severity] ?? -1;
    if (rank > bestRank) {
      bestRank = rank;
      best = row.field_id;
    }
  }
  return best;
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const params = Object.fromEntries(new URLSearchParams(raw));

  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (authToken) {
    const signature = req.headers.get("X-Twilio-Signature");
    // Must be the exact public URL Twilio POSTed to (what you set in the
    // console) — if signature checks ever fail in production, this is the
    // first thing to compare against Twilio's debugger.
    if (!validateTwilioSignature(req.nextUrl.toString(), params, signature, authToken)) {
      console.error("[/api/sms/inbound] rejected: invalid Twilio signature");
      return new NextResponse("Invalid signature", { status: 403 });
    }
  } else {
    console.warn("[/api/sms/inbound] TWILIO_AUTH_TOKEN not set — accepting without signature verification");
  }

  const from = params.From;
  const body = (params.Body ?? "").trim();
  if (!from || !body) return twiml();

  const phone = usPhoneFromE164(from);
  const fields = await listFieldsByPhone(phone);
  if (fields.length === 0) {
    return twiml("We couldn't find a Daiisi account for this number.");
  }

  const defaultFieldId = await pickDefaultField(fields);

  const apiKey = process.env.GROQ_API_KEY;
  const llm: LlmCall = apiKey
    ? (system, user) => groqComplete(system, user, { apiKey, model: process.env.GROQ_MODEL || undefined })
    : async () => {
        throw new Error("GROQ_API_KEY is not set");
      };

  const parsed = await parseNote(
    {
      transcript: body,
      defaultFieldId,
      fields: fields.map((f) => ({ id: f.id, label: f.name })),
      capturedAt: new Date().toISOString(),
      // No client timezone available over SMS. Replies mostly use relative
      // words ("today", "yesterday") so this is a reasonable approximation,
      // not a precise farmer-local timestamp.
      tzOffsetMinutes: 0,
    },
    llm
  );

  const store = getNoteStore();
  await store.add({
    fieldId: parsed.fieldId,
    eventType: parsed.eventType,
    eventDate: parsed.date,
    detail: parsed.detail,
    rawTranscript: parsed.rawTranscript,
    confidence: parsed.confidence,
  });

  const fieldName = fields.find((f) => f.id === parsed.fieldId)?.name ?? "your field";
  return twiml(`Got it - logged "${EVENT_LABELS[parsed.eventType]}" for ${fieldName}. Thanks!`);
}
