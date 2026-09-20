import { NextRequest, NextResponse } from "next/server";

// Satellite, weather and AI calls can be slow on a cold start; Vercel cuts a function off at this many seconds.
export const maxDuration = 30;

const GOOGLE_TRANSLATE_URL = "https://translation.googleapis.com/language/translate/v2";

// Only the languages the picker offers; anything else is rejected before it can cost money.
const TARGETS = new Set(["sw", "fr", "es", "pt", "hi"]);

// Per-request limits, and a per-day budget so a bug (or abuse) can't run up a bill. The counter
// lives in memory, so it resets when the server restarts; the Google Cloud budget alert is the
// real backstop. Override the daily limit with TRANSLATE_DAILY_CHAR_LIMIT.
const MAX_STRINGS = 100;
const MAX_STRING_CHARS = 2_000;
const MAX_REQUEST_CHARS = 20_000;
const DAILY_CHAR_LIMIT = Number(process.env.TRANSLATE_DAILY_CHAR_LIMIT) || 200_000;

// Every string is translated once per language and remembered, so repeat visits cost nothing.
const cache = new Map<string, string>();
const spent = { day: "", chars: 0 };

interface GoogleResponse {
  data?: { translations?: Array<{ translatedText: string }> };
}

// Google can return HTML-escaped text (l&#39;agriculteur); the page shows it as plain text.
function decodeEntities(text: string): string {
  return text
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// Body: { target: "sw", texts: ["Results", ...] }. Returns { translations: [...] } in the same order.
// The API key stays on the server (GOOGLE_API_KEY) and is never included in a response or error.
export async function POST(req: NextRequest) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Translation is not configured on the server" }, { status: 503 });
  }

  const body = await req.json().catch(() => null);
  const target: unknown = body?.target;
  const texts: unknown = body?.texts;
  if (typeof target !== "string" || !TARGETS.has(target)) {
    return NextResponse.json({ error: "Unsupported target language" }, { status: 400 });
  }
  if (!Array.isArray(texts) || texts.length === 0 || !texts.every((t) => typeof t === "string")) {
    return NextResponse.json({ error: "texts must be a non-empty array of strings" }, { status: 400 });
  }
  const strings = texts as string[];
  const totalChars = strings.reduce((n, t) => n + t.length, 0);
  if (strings.length > MAX_STRINGS || totalChars > MAX_REQUEST_CHARS || strings.some((t) => t.length > MAX_STRING_CHARS)) {
    return NextResponse.json({ error: "Request too large" }, { status: 400 });
  }

  const missing = [...new Set(strings)].filter((t) => !cache.has(`${target}|${t}`));
  if (missing.length > 0) {
    const today = new Date().toISOString().slice(0, 10);
    if (spent.day !== today) {
      spent.day = today;
      spent.chars = 0;
    }
    const cost = missing.reduce((n, t) => n + t.length, 0);
    if (spent.chars + cost > DAILY_CHAR_LIMIT) {
      return NextResponse.json({ error: "Daily translation limit reached" }, { status: 429 });
    }

    const res = await fetch(`${GOOGLE_TRANSLATE_URL}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: missing, source: "en", target, format: "text" }),
    });
    if (!res.ok) {
      // Log the status only; the response body and URL are never echoed, so the key can't leak.
      console.error(`[/api/translate] Google Translate request failed: ${res.status}`);
      return NextResponse.json({ error: "Translation service unavailable" }, { status: 502 });
    }
    const json: GoogleResponse = await res.json();
    const translated = json.data?.translations ?? [];
    if (translated.length !== missing.length) {
      return NextResponse.json({ error: "Unexpected response from translation service" }, { status: 502 });
    }
    spent.chars += cost;
    missing.forEach((text, i) => cache.set(`${target}|${text}`, decodeEntities(translated[i].translatedText)));
  }

  return NextResponse.json({ translations: strings.map((t) => cache.get(`${target}|${t}`) ?? t) });
}
