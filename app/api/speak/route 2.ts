import { NextRequest, NextResponse } from "next/server";
import { DeepgramError } from "@/lib/deepgram";
import { cleanForSpeech, limitForSpeech, synthesizeSpeech } from "@/lib/deepgramSpeak";

// POST /api/speak { text } or GET /api/speak?text=... -> audio/mpeg. Reads a recommendation aloud. Nothing is stored, and neither the
// text nor the audio is logged.

function fail(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

// GET /api/speak?text=... is what the Listen button plays: an <audio> element can start it straight from
// the click, which Safari and phones require (they block sound that starts after an await).
export async function GET(req: NextRequest) {
  return speak(req.nextUrl.searchParams.get("text"));
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail('Send JSON like { "text": "..." }.', 400);
  }
  return speak((body as { text?: unknown } | null)?.text);
}

async function speak(raw: unknown) {
  if (typeof raw !== "string") return fail("text is required.", 400);
  const text = limitForSpeech(cleanForSpeech(raw));
  if (text === "") return fail("There is nothing to read.", 400);

  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) return fail("Reading aloud isn't set up on the server (DEEPGRAM_API_KEY is missing).", 503);

  try {
    const audio = await synthesizeSpeech(text, { apiKey });
    return new NextResponse(audio, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof DeepgramError) {
      console.error(`[/api/speak] Deepgram request failed: ${err.upstreamStatus ?? err.status}`);
      return fail(err.message, err.status);
    }
    console.error("[/api/speak] unexpected error:", err instanceof Error ? err.name : "unknown");
    return fail("Something went wrong reading that aloud.", 500);
  }
}
