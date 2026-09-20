import { NextRequest, NextResponse } from "next/server";
import { groqComplete } from "@/lib/noteLlm";
import { parseNote } from "@/lib/noteParser";
import type { LlmCall } from "@/lib/noteLlm";

// Satellite, weather and AI calls can be slow on a cold start; Vercel cuts a function off at this many seconds.
export const maxDuration = 30;

// POST /api/note/parse: works out what a transcript means. JSON body:
//   transcript, defaultFieldId (the field whose panel is open), fields [{ id, label }],
//   capturedAt (ISO time the note was recorded), tzOffsetMinutes (the browser's Date.getTimezoneOffset())
// Always answers with a ParsedNote. If the language model is unavailable or answers badly, that is a plain
// observation on the open field (usedFallback: true), never an error, so a note can always be reviewed and
// saved. Nothing is stored here, and the transcript is not logged.

const MAX_TRANSCRIPT_CHARS = 2_000;
const MAX_FIELDS = 100;
const MAX_LABEL_CHARS = 120;
const MAX_ID_CHARS = 200;

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return bad("Send a JSON body.");

  const { transcript, defaultFieldId, fields, capturedAt, tzOffsetMinutes } = body as Record<string, unknown>;
  if (typeof transcript !== "string" || transcript.trim() === "" || transcript.length > MAX_TRANSCRIPT_CHARS) return bad("transcript is required.");
  if (typeof defaultFieldId !== "string" || defaultFieldId === "" || defaultFieldId.length > MAX_ID_CHARS) return bad("defaultFieldId is required.");
  if (
    !Array.isArray(fields) ||
    fields.length > MAX_FIELDS ||
    !fields.every(
      (f) => f && typeof f.id === "string" && f.id.length <= MAX_ID_CHARS && typeof f.label === "string" && f.label.length <= MAX_LABEL_CHARS
    )
  ) {
    return bad("fields must be a list of { id, label }.");
  }
  if (typeof capturedAt !== "string" || Number.isNaN(Date.parse(capturedAt))) return bad("capturedAt must be an ISO time.");
  if (typeof tzOffsetMinutes !== "number" || !Number.isFinite(tzOffsetMinutes) || Math.abs(tzOffsetMinutes) > 840) return bad("tzOffsetMinutes must be a number of minutes.");

  const apiKey = process.env.GROQ_API_KEY;
  const llm: LlmCall = apiKey
    ? (system, user) => groqComplete(system, user, { apiKey, model: process.env.GROQ_MODEL || undefined })
    : async () => {
        throw new Error("GROQ_API_KEY is not set");
      };

  try {
    const parsed = await parseNote(
      { transcript, defaultFieldId, fields: fields as Array<{ id: string; label: string }>, capturedAt, tzOffsetMinutes },
      llm
    );
    if (parsed.usedFallback) {
      console.error(`[/api/note/parse] used the plain-observation fallback (${apiKey ? "model failed or answered badly" : "GROQ_API_KEY is not set"})`);
      if (!apiKey) parsed.fallbackReason = "Automatic interpretation isn't set up on the server";
    }
    return NextResponse.json(parsed);
  } catch {
    console.error("[/api/note/parse] unexpected error");
    return NextResponse.json({ error: "Something went wrong interpreting the note." }, { status: 500 });
  }
}
