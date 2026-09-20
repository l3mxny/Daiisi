import { DeepgramError } from "./deepgram";

// Reads text aloud with Deepgram's text-to-speech (Aura). Server-side only, like transcription: the API key
// never reaches the browser. Kept apart from the route so it can be tested with a mocked fetch.

const DEEPGRAM_SPEAK_URL = "https://api.deepgram.com/v1/speak";
export const SPEAK_MODEL = "aura-2-thalia-en";
export const MAX_SPEAK_CHARS = 600; // synthesis time grows with length (1000 characters can pass 20 s); also caps what a stray request can spend
const DEFAULT_TIMEOUT_MS = 30_000;

// What is worth saying out loud: no markdown, no line breaks, no runs of spaces.
export function cleanForSpeech(text: string): string {
  return text.replace(/\*\*/g, "").replace(/[#`_]/g, "").replace(/\s+/g, " ").trim();
}

// Longer text is cut at the last full sentence that fits, so a long recommendation is read in part
// rather than refused.
export function limitForSpeech(text: string, max = MAX_SPEAK_CHARS): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return end > max / 2 ? cut.slice(0, end + 1) : cut;
}

function errorForUpstream(status: number): DeepgramError {
  switch (status) {
    case 401:
    case 403:
      return new DeepgramError("The voice service rejected the server's API key, or the key can't use text-to-speech.", 502, status);
    case 402:
      return new DeepgramError("The voice service account is out of credit.", 502, status);
    case 429:
      return new DeepgramError("The voice service is busy. Try again in a moment.", 429, status);
    default:
      return new DeepgramError("The voice service had a problem. Try again in a moment.", 502, status);
  }
}

export async function synthesizeSpeech(
  text: string,
  options: { apiKey: string; fetchImpl?: typeof fetch; timeoutMs?: number; baseUrl?: string }
): Promise<ArrayBuffer> {
  const url = new URL(options.baseUrl ?? DEEPGRAM_SPEAK_URL);
  url.searchParams.set("model", SPEAK_MODEL);
  url.searchParams.set("encoding", "mp3");

  const signal = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let res: Response;
  try {
    res = await (options.fetchImpl ?? fetch)(url.toString(), {
      method: "POST",
      headers: { Authorization: `Token ${options.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal,
    });
  } catch {
    throw new DeepgramError("The voice service can't be reached right now.", 502);
  }
  if (!res.ok) throw errorForUpstream(res.status);
  try {
    return await res.arrayBuffer(); // the timeout also covers reading the audio
  } catch {
    throw new DeepgramError("The voice service took too long. Try again.", 504);
  }
}
