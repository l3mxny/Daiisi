// Languages a farmer can pick, and the algorithm that decides which few to suggest first.
// Keep the list short on purpose: the picker shows three suggestions up front and tucks the
// rest behind "More languages", so it never overwhelms.

export type LanguageCode = "en" | "sw" | "fr" | "es" | "pt" | "hi";

export interface Language {
  code: LanguageCode;
  name: string; // in English, for us
  nativeName: string; // as the farmer would write it
  // Non-Latin scripts can't be sent in a standard 160-character SMS (they use the shorter
  // 70-character encoding), which matters once the text itself is translated.
  script: "latin" | "devanagari";
}

export const LANGUAGES: readonly Language[] = [
  { code: "en", name: "English", nativeName: "English", script: "latin" },
  { code: "sw", name: "Swahili", nativeName: "Kiswahili", script: "latin" },
  { code: "fr", name: "French", nativeName: "Français", script: "latin" },
  { code: "es", name: "Spanish", nativeName: "Español", script: "latin" },
  { code: "pt", name: "Portuguese", nativeName: "Português", script: "latin" },
  { code: "hi", name: "Hindi", nativeName: "हिन्दी", script: "devanagari" },
];

export const DEFAULT_LANGUAGE: LanguageCode = "en";

// When nothing favors one language over another, fill the suggestions with the most widely used
// first (so a farmer in Brazil is offered Spanish before Swahili).
const FILLER_ORDER: readonly LanguageCode[] = ["en", "fr", "es", "pt", "sw", "hi"];

export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === "string" && LANGUAGES.some((l) => l.code === value);
}

// How widely each language is used in a country, 0 to 1 (ISO 3166-1 alpha-2, lower case, as
// returned by the reverse-geocoding route). Rough on purpose: it only decides which few
// languages to suggest, and the farmer always makes the final choice.
const COUNTRY_LANGUAGES: Record<string, Partial<Record<LanguageCode, number>>> = {
  // East and Central Africa
  ke: { sw: 0.9, en: 0.8 },
  tz: { sw: 1, en: 0.5 },
  ug: { en: 0.8, sw: 0.3 },
  rw: { fr: 0.5, en: 0.5, sw: 0.3 },
  bi: { fr: 0.5, sw: 0.4 },
  cd: { fr: 1, sw: 0.5 },
  et: { en: 0.4 },
  // West Africa
  ng: { en: 1 },
  gh: { en: 1 },
  sn: { fr: 1 },
  ml: { fr: 1 },
  ci: { fr: 1 },
  bf: { fr: 1 },
  cm: { fr: 0.8, en: 0.5 },
  // Southern Africa
  za: { en: 1 },
  zm: { en: 1 },
  zw: { en: 1 },
  mw: { en: 1 },
  mz: { pt: 1 },
  ao: { pt: 1 },
  mg: { fr: 0.7 },
  // South Asia
  in: { hi: 0.8, en: 0.6 },
  // Latin America and Iberia
  mx: { es: 1 },
  gt: { es: 1 },
  co: { es: 1 },
  pe: { es: 1 },
  bo: { es: 1 },
  ec: { es: 1 },
  ar: { es: 1 },
  cl: { es: 1 },
  es: { es: 1 },
  br: { pt: 1 },
  pt: { pt: 1 },
  // Europe, North America
  fr: { fr: 1 },
  ht: { fr: 0.8 },
  us: { en: 0.9, es: 0.4 },
  ca: { en: 0.8, fr: 0.5 },
  gb: { en: 1 },
};

// Points each signal contributes. Location is the strongest hint about the farmer's language;
// what their browser is set to is next; a previous choice keeps that language near the top.
const COUNTRY_POINTS = 100; // multiplied by the 0-1 weight above
const BROWSER_POINTS = [40, 20, 10]; // 1st, 2nd, 3rd browser language preference
const SAVED_CHOICE_POINTS = 30;
const ENGLISH_FALLBACK_POINTS = 5; // so English is always on the list when nothing else is known

export interface RankInput {
  countryCode: string | null; // from the farmer's current location, if known
  browserLanguages: readonly LanguageCode[]; // in preference order
  savedChoice: LanguageCode | null; // what they picked before
}

export interface RankedLanguage {
  code: LanguageCode;
  score: number;
}

// Every supported language, best suggestion first. The picker shows the first three.
export function rankLanguages(input: RankInput): RankedLanguage[] {
  const scores = new Map<LanguageCode, number>(LANGUAGES.map((l) => [l.code, 0]));
  const add = (code: LanguageCode, points: number) => scores.set(code, (scores.get(code) ?? 0) + points);

  const weights = input.countryCode ? COUNTRY_LANGUAGES[input.countryCode.toLowerCase()] : undefined;
  if (weights) {
    for (const [code, weight] of Object.entries(weights)) add(code as LanguageCode, COUNTRY_POINTS * (weight ?? 0));
  }
  input.browserLanguages.forEach((code, i) => add(code, BROWSER_POINTS[i] ?? 0));
  if (input.savedChoice) add(input.savedChoice, SAVED_CHOICE_POINTS);
  add(DEFAULT_LANGUAGE, ENGLISH_FALLBACK_POINTS);

  const order = new Map(FILLER_ORDER.map((code, i) => [code, i]));
  return [...scores.entries()]
    .map(([code, score]) => ({ code, score }))
    .sort((a, b) => b.score - a.score || order.get(a.code)! - order.get(b.code)!);
}

// Turns browser language tags ("sw-KE", "fr-CA", "en-US") into supported codes, in order, deduplicated.
export function parseBrowserLanguages(tags: readonly string[]): LanguageCode[] {
  const out: LanguageCode[] = [];
  for (const tag of tags) {
    const base = tag.split("-")[0].toLowerCase();
    if (isLanguageCode(base) && !out.includes(base)) out.push(base);
  }
  return out;
}

export function languageByCode(code: LanguageCode): Language {
  return LANGUAGES.find((l) => l.code === code)!;
}
