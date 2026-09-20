// Turns a recording into text with Deepgram's pre-recorded speech-to-text API. Server-side only:
// the API key never reaches the browser. Kept separate from the route so it can be tested with a
// mocked fetch, without calling Deepgram.

const DEEPGRAM_LISTEN_URL = "https://api.deepgram.com/v1/listen";
export const DEEPGRAM_MODEL = "nova-3";
const DEFAULT_TIMEOUT_MS = 30_000;

export interface TranscribeResult {
  transcript: string; // "" when no speech was detected
  confidence: number | null; // 0 to 1, Deepgram's confidence in the transcript
  durationSeconds: number | null;
}

// `status` is the HTTP status our own route should answer with; `message` is safe to show the farmer
// (it never contains the API key or anything Deepgram sent back).
export class DeepgramError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly upstreamStatus?: number
  ) {
    super(message);
    this.name = "DeepgramError";
  }
}

function errorForUpstream(status: number): DeepgramError {
  switch (status) {
    case 400:
      return new DeepgramError("The voice service couldn't read this audio. Try recording again, or upload a WAV, MP3 or M4A file.", 422, status);
    case 401:
    case 403:
      return new DeepgramError("The voice service rejected the server's API key. Check DEEPGRAM_API_KEY.", 502, status);
    case 402:
      return new DeepgramError("The voice service account is out of credit.", 502, status);
    case 413:
      return new DeepgramError("That recording is too large for the voice service.", 413, status);
    case 429:
      return new DeepgramError("The voice service is busy. Try again in a moment.", 429, status);
    default:
      return new DeepgramError("The voice service had a problem. Try again in a moment.", 502, status);
  }
}

export async function transcribeAudio(
  audio: ArrayBuffer,
  contentType: string,
  options: { apiKey: string; fetchImpl?: typeof fetch; timeoutMs?: number; baseUrl?: string }
): Promise<TranscribeResult> {
  const url = new URL(options.baseUrl ?? DEEPGRAM_LISTEN_URL);
  url.searchParams.set("model", DEEPGRAM_MODEL);
  url.searchParams.set("smart_format", "true");

  let res: Response;
  try {
    res = await (options.fetchImpl ?? fetch)(url.toString(), {
      method: "POST",
      headers: { Authorization: `Token ${options.apiKey}`, "Content-Type": contentType },
      body: audio,
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new DeepgramError("The voice service took too long to answer. Try again.", 504);
    }
    throw new DeepgramError("Couldn't reach the voice service. Check the connection and try again.", 502);
  }

  if (!res.ok) throw errorForUpstream(res.status);

  // Defensive on purpose: a malformed answer should read as "no speech", never crash the request.
  const json: unknown = await res.json().catch(() => null);
  const best = (json as { results?: { channels?: Array<{ alternatives?: Array<{ transcript?: unknown; confidence?: unknown }> }> } })
    ?.results?.channels?.[0]?.alternatives?.[0];
  const duration = (json as { metadata?: { duration?: unknown } })?.metadata?.duration;

  return {
    transcript: typeof best?.transcript === "string" ? best.transcript.trim() : "",
    confidence: typeof best?.confidence === "number" ? best.confidence : null,
    durationSeconds: typeof duration === "number" ? duration : null,
  };
}
