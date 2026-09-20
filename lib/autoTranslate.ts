import type { LanguageCode } from "./languages";

// Helpers for translating the on-screen text through /api/translate (Google Translate on the
// server). Kept free of DOM code so they can be tested on their own.

export type TargetLanguage = Exclude<LanguageCode, "en">;

// Only text with real words is worth translating; numbers, dates and symbols are left alone.
export function shouldTranslate(text: string): boolean {
  return /[A-Za-zÀ-ɏ]{2,}/.test(text);
}

// React text nodes often carry leading or trailing spaces; keep them so layout doesn't shift.
export function splitPadding(raw: string): { lead: string; core: string; trail: string } {
  const core = raw.trim();
  if (core === "") return { lead: raw, core: "", trail: "" };
  const start = raw.indexOf(core);
  return { lead: raw.slice(0, start), core, trail: raw.slice(start + core.length) };
}

// Splits strings into requests the server will accept (it allows 100 strings / 20,000 characters).
export function chunkStrings(strings: string[], maxCount = 50, maxChars = 4_000): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let chars = 0;
  for (const s of strings) {
    if (current.length > 0 && (current.length >= maxCount || chars + s.length > maxChars)) {
      chunks.push(current);
      current = [];
      chars = 0;
    }
    current.push(s);
    chars += s.length;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

// --- Remembering translations in the browser ---------------------------------------------
// The server also caches, but remembering here means a repeat visit needs no network at all.
// Storage can be missing or throw, so it is only ever a convenience.

const STORAGE_KEY = "farmos.translations.v1";
const MAX_STORED_ENTRIES = 3_000;
const memory = new Map<string, string>();
let loaded = false;

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    for (const [key, value] of Object.entries(JSON.parse(raw) as Record<string, string>)) {
      if (typeof value === "string") memory.set(key, value);
    }
  } catch {
    // ignore: start with an empty cache
  }
}

// Wording we set ourselves for the labels Google gets wrong or renders awkwardly (for example it
// turns "characters" into "personnages", fictional characters, and "Field" into "sehemu", a part).
// These win over Google and cost nothing. Keys are the exact English text; add more here whenever
// a translation reads badly. DRAFT: to be checked by native speakers, like the message wording.
const OVERRIDES: Record<TargetLanguage, Record<string, string>> = {
  sw: {
    "Field input": "Ingiza shamba",
    Results: "Matokeo",
    "Text alerts": "Arifa za ujumbe",
    "My fields": "Mashamba yangu",
    "My results": "Matokeo yangu",
    "SMS updates": "Arifa za SMS",
    "General info": "Taarifa za jumla",
    "characters ·": "herufi ·",
  },
  fr: {
    "Field input": "Saisie des champs",
    Results: "Résultats",
    "Text alerts": "Alertes SMS",
    "My fields": "Mes champs",
    "My results": "Mes résultats",
    "SMS updates": "Mises à jour SMS",
    "General info": "Infos générales",
    "characters ·": "caractères ·",
  },
  es: {
    "Field input": "Datos del campo",
    Results: "Resultados",
    "Text alerts": "Alertas por mensaje",
    "My fields": "Mis campos",
    "My results": "Mis resultados",
    "SMS updates": "Novedades por SMS",
    "General info": "Información general",
    "characters ·": "caracteres ·",
  },
  pt: {
    "Field input": "Dados do campo",
    Results: "Resultados",
    "Text alerts": "Alertas por mensagem",
    "My fields": "Meus campos",
    "My results": "Meus resultados",
    "SMS updates": "Novidades por SMS",
    "General info": "Informações gerais",
    "characters ·": "caracteres ·",
  },
  hi: {
    "Field input": "खेत की जानकारी",
    Results: "नतीजे",
    "Text alerts": "टेक्स्ट अलर्ट",
    "My fields": "मेरे खेत",
    "My results": "मेरे परिणाम",
    "SMS updates": "एसएमएस अपडेट",
    "General info": "सामान्य जानकारी",
    "characters ·": "अक्षर ·",
  },
};

export function cachedTranslation(target: TargetLanguage, text: string): string | undefined {
  const override = OVERRIDES[target][text];
  if (override !== undefined) return override;
  ensureLoaded();
  return memory.get(`${target}|${text}`);
}

export function rememberTranslations(target: TargetLanguage, texts: string[], translations: string[]): void {
  ensureLoaded();
  texts.forEach((text, i) => memory.set(`${target}|${text}`, translations[i]));
  try {
    const entries = [...memory.entries()].slice(-MAX_STORED_ENTRIES);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // ignore: the translations just won't survive a reload
  }
}

// Throws when the server can't translate (not configured, limit reached, Google unavailable).
export async function requestTranslations(target: TargetLanguage, texts: string[]): Promise<string[]> {
  const res = await fetch("/api/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target, texts }),
  });
  if (!res.ok) throw new Error(`Translation failed: ${res.status}`);
  const json: { translations?: string[] } = await res.json();
  if (!Array.isArray(json.translations) || json.translations.length !== texts.length) {
    throw new Error("Translation failed: unexpected response");
  }
  return json.translations;
}
