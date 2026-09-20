import { buildPlotRecommendation } from "./recommendations";
import type { Severity } from "./stressEvent";
import { languageByCode, type LanguageCode } from "./languages";
import { smsMonth, smsPhrase, type SmsPhraseKey } from "./smsPhrases";
import type { FieldApiResponse } from "./types";

// The farmer's SMS digest, built ON TOP of the app's own analysis: which plots
// need attention, in what order, and what to do all come from
// buildPlotRecommendation / stressEvent, so the text always agrees with the
// Results tab and follows any change to how plots are analysed. This file only
// decides how that analysis is shortened and formatted for a text message.
//
// Nothing is sent from here; it produces the message string plus its SMS size.

// --- GSM-7 -----------------------------------------------------------------
// A single SMS segment holds 160 GSM-7 characters. Any character outside
// GSM-7 (emoji, curly quotes, dashes, degree sign...) silently switches the
// whole message to UCS-2, which drops the limit to 70 per segment, so the text
// is sanitised to GSM-7 before it is measured or shown.

const GSM7_BASIC = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"
);
// Valid GSM-7, but each costs 2 septets (an escape plus the character).
const GSM7_EXTENSION = new Set("^{}\\[~]|€\f");

const TYPOGRAPHIC: Record<string, string> = {
  "—": "-", // em dash
  "–": "-", // en dash
  "−": "-", // minus sign
  "‘": "'",
  "’": "'",
  "‚": "'",
  "‛": "'",
  "“": '"',
  "”": '"',
  "„": '"',
  "…": "...", // ellipsis
  " ": " ", // non-breaking space
  "°": "", // degree symbol is stripped
};

const SINGLE_SEGMENT = 160;
const MULTI_SEGMENT = 153; // concatenated segments lose 7 septets to the header

function inGsm7(ch: string): boolean {
  return GSM7_BASIC.has(ch) || GSM7_EXTENSION.has(ch);
}

export function toGsm7(text: string): string {
  let out = "";
  for (const raw of text) {
    const ch = raw in TYPOGRAPHIC ? TYPOGRAPHIC[raw] : raw;
    for (const c of ch) {
      if (inGsm7(c)) {
        out += c;
        continue;
      }
      // Fold unsupported accented letters (ç -> c); emoji and the rest are dropped.
      for (const folded of c.normalize("NFKD").replace(/[̀-ͯ]/g, "")) {
        if (inGsm7(folded)) out += folded;
      }
    }
  }
  return out;
}

export function gsm7Length(text: string): number {
  let n = 0;
  for (const ch of text) n += GSM7_EXTENSION.has(ch) ? 2 : 1;
  return n;
}

export function segmentCount(text: string): number {
  const n = gsm7Length(text);
  if (n === 0) return 0;
  return n <= SINGLE_SEGMENT ? 1 : Math.ceil(n / MULTI_SEGMENT);
}

// Languages written in other scripts (Hindi...) can't use GSM-7 at all. They go out as Unicode
// (UCS-2), where a segment holds only 70 characters (67 when a message is split), so their texts
// split sooner. Latin-script languages are always folded down to GSM-7 (accents dropped where
// GSM-7 has no equivalent) so they keep the full 160 characters.
const UCS2_SINGLE_SEGMENT = 70;
const UCS2_MULTI_SEGMENT = 67;

export type SmsEncoding = "gsm7" | "ucs2";

export interface SmsSize {
  encoding: SmsEncoding;
  chars: number;
  segments: number;
  perSegment: number; // how many characters fit in one segment for this encoding
}

export function smsSize(text: string): SmsSize {
  if ([...text].every(inGsm7)) {
    const n = gsm7Length(text);
    const segments = n === 0 ? 0 : n <= SINGLE_SEGMENT ? 1 : Math.ceil(n / MULTI_SEGMENT);
    return { encoding: "gsm7", chars: text.length, segments, perSegment: SINGLE_SEGMENT };
  }
  const n = text.length; // UTF-16 units, which is what UCS-2 counts
  const segments = n === 0 ? 0 : n <= UCS2_SINGLE_SEGMENT ? 1 : Math.ceil(n / UCS2_MULTI_SEGMENT);
  return { encoding: "ucs2", chars: n, segments, perSegment: UCS2_SINGLE_SEGMENT };
}

function sanitizeForSms(text: string, allowUnicode: boolean): string {
  if (!allowUnicode) return toGsm7(text);
  let out = "";
  for (const ch of text) out += ch in TYPOGRAPHIC ? TYPOGRAPHIC[ch] : ch;
  return out;
}

// --- Turning the app's analysis into short SMS phrases -----------------------

// The app's advice is a sentence ("Irrigate soon — the 16-day forecast..."), far
// too long for a text. This maps the first action to a short imperative by keyword,
// as a phrase key the chosen language then turns into words (see smsPhrases.ts).
// If the wording is ever rewritten and nothing matches, it degrades to a generic
// action based on severity rather than breaking.
export function actionKeyFor(severity: Severity, actions: string[]): SmsPhraseKey {
  const first = (actions[0] ?? "").trim();
  if (/^hold off/i.test(first)) return "holdOff";
  if (/^irrigate/i.test(first)) return severity === "act" ? "irrigateNow" : "irrigate3d";
  if (/^monitor/i.test(first)) return "monitor";
  if (/inspect/i.test(first)) return "inspect";
  return severity === "act" ? "actNow" : "check3d";
}

// The single most decision-relevant fact, as a phrase key (plain words, numbers stay in
// the app). Read from the app's structured signals, not from its sentences.
export function reasonKeyFor(data: FieldApiResponse): SmsPhraseKey {
  const s = data.stressEvent.signature;
  const anomaly = s.rainAnomalyRatio;
  if (anomaly !== null && anomaly < 0.5) return "veryDry";
  if (s.waterRatio < 0.75 || (anomaly !== null && anomaly < 0.75)) return "dry";
  // With fallback imagery the NDVI belongs to a different place; don't cite it.
  if (s.ndviTrend === "declining" && !data.usedFallback) return "cropsFading";
  if (s.heatDays7 >= 3) return "hotSpell";
  return "needsLook";
}

// --- The digest ----------------------------------------------------------------

const DEFAULT_MAX_LINES = 3;

export interface DigestPlotInput {
  id?: string; // optional, echoed back on the line so a UI can match lines to plots
  name: string; // the farmer's own label, printed in full
  data: FieldApiResponse;
}

export interface DigestLine {
  id?: string;
  rank: number;
  name: string;
  reason: string;
  action: string;
  severity: Severity;
  priorityScore: number;
  shown: boolean; // false when it fell beyond maxLines and is counted in "+K more"
  text: string;
}

export interface DigestResult {
  text: string;
  key: string; // the text without today's date: two texts with the same key say the same thing
  chars: number;
  segments: number;
  encoding: SmsEncoding;
  perSegment: number;
  totalActionable: number;
  lines: DigestLine[]; // every actionable plot, ranked
}

function cleanName(name: string, allowUnicode: boolean): string {
  return sanitizeForSms(name, allowUnicode).split(/\s+/).filter(Boolean).join(" ") || "Plot";
}

export function composeDigest(
  plots: DigestPlotInput[],
  options: { maxLines?: number; today?: Date; language?: LanguageCode } = {}
): DigestResult {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const language = options.language ?? "en";
  const allowUnicode = languageByCode(language).script !== "latin";
  const today = options.today ?? new Date();
  const p = (key: SmsPhraseKey, params?: Record<string, string | number>) => smsPhrase(language, key, params);
  const dateTag = `${String(today.getDate()).padStart(2, "0")}${smsMonth(language, today.getMonth())}`;

  // Same ordering as the Results tab: highest priority score first.
  const ranked = plots
    .filter((pl) => pl.data.stressEvent.severity !== "ok")
    .map((pl) => ({ plot: pl, rec: buildPlotRecommendation(pl.data) }))
    .sort((a, b) => b.rec.priorityScore - a.rec.priorityScore);

  const finish = (lines: DigestLine[], render: (date: string) => string): DigestResult => {
    const text = sanitizeForSms(render(dateTag), allowUnicode);
    const size = smsSize(text);
    return {
      text,
      key: sanitizeForSms(render(""), allowUnicode),
      chars: size.chars,
      segments: size.segments,
      encoding: size.encoding,
      perSegment: size.perSegment,
      totalActionable: lines.length,
      lines,
    };
  };

  if (ranked.length === 0) {
    return finish([], (date) => `${p("greeting")} ${p("allOk", { date })}`);
  }

  const n = ranked.length;
  const lines: DigestLine[] = ranked.map(({ plot, rec }, i) => {
    const severity = plot.data.stressEvent.severity;
    const name = cleanName(plot.name, allowUnicode);
    const reason = p(reasonKeyFor(plot.data));
    const action = p(actionKeyFor(severity, rec.actions));
    return {
      id: plot.id,
      rank: i + 1,
      name,
      reason,
      action,
      severity,
      priorityScore: rec.priorityScore,
      shown: i < maxLines,
      text: `${i + 1}.${name} ${reason} ${action}`,
    };
  });

  return finish(lines, (date) => {
    const header = n === 1 ? p("headerOne", { date }) : p("headerMany", { date, n });
    const out = [`${p("greeting")} ${header}`, ...lines.filter((l) => l.shown).map((l) => l.text)];
    if (n > maxLines) out.push(p("more", { k: n - maxLines }));
    return out.join("\n");
  });
}
