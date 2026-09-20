import { NextRequest, NextResponse } from "next/server";
import { DeepgramError, transcribeAudio } from "@/lib/deepgram";

// Satellite, weather and AI calls can be slow on a cold start; Vercel cuts a function off at this many seconds.
export const maxDuration = 60;

// POST /api/note: a voice note for one field. Multipart form data with
//   audio   - the recording (or an uploaded audio file)
//   fieldId - the field whose panel the farmer opened; the default target of the note
// Returns { fieldId, transcript, confidence, durationSeconds } straight away so the farmer can read it
// BEFORE anything is saved. This route does not store anything, and neither the audio nor the
// transcript is logged.

const MAX_AUDIO_BYTES = 20 * 1024 * 1024; // 60 s of browser audio is well under 1 MB; this leaves room for uploaded WAVs
const MAX_FIELD_ID_CHARS = 200;

function fail(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("Send multipart form data with an audio file and a fieldId.", 400);
  }

  const audio = form.get("audio");
  const fieldId = form.get("fieldId");
  if (typeof fieldId !== "string" || fieldId.trim() === "" || fieldId.length > MAX_FIELD_ID_CHARS) {
    return fail("fieldId is required.", 400);
  }
  if (!(audio instanceof Blob)) return fail("An audio file is required.", 400);
  if (audio.size === 0) return fail("The recording is empty. Try again.", 400);
  if (audio.size > MAX_AUDIO_BYTES) return fail("That audio file is too large (limit 20 MB).", 413);
  // Browsers label recordings audio/webm or audio/mp4; some uploaded files have no type at all.
  if (audio.type && !audio.type.startsWith("audio/") && audio.type !== "video/webm" && audio.type !== "application/octet-stream") {
    return fail("Upload an audio file (WAV, MP3, M4A, WebM or OGG).", 415);
  }

  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) return fail("Voice notes aren't set up on the server (DEEPGRAM_API_KEY is missing).", 503);

  try {
    const result = await transcribeAudio(await audio.arrayBuffer(), audio.type || "application/octet-stream", { apiKey });
    return NextResponse.json({ fieldId, ...result });
  } catch (err) {
    if (err instanceof DeepgramError) {
      console.error(`[/api/note] Deepgram request failed: ${err.upstreamStatus ?? err.status}`); // status only, never the key or content
      return fail(err.message, err.status);
    }
    console.error("[/api/note] unexpected error:", err instanceof Error ? err.name : "unknown");
    return fail("Something went wrong turning the recording into text.", 500);
  }
}
