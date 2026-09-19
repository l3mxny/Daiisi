import { buildPlotRecommendation } from "./recommendations";
import type { Severity } from "./stressEvent";
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

// --- Turning the app's analysis into short SMS phrases -----------------------

// The app's advice is a sentence ("Irrigate soon — the 16-day forecast..."), far
// too long for a text. This maps the first action to a short imperative code by
// keyword. If the wording is ever rewritten and nothing matches, it degrades to a
// generic code based on severity rather than breaking.
export function actionCodeFor(severity: Severity, actions: string[]): string {
  const first = (actions[0] ?? "").trim();
  if (/^hold off/i.test(first)) return "HOLD OFF";
  if (/^irrigate/i.test(first)) return severity === "act" ? "IRRIGATE NOW" : "IRRIGATE 3D";
  if (/^monitor/i.test(first)) return "MONITOR";
  if (/inspect/i.test(first)) return "INSPECT";
  return severity === "act" ? "ACT NOW" : "CHECK 3D";
}

// The single most decision-relevant fact, in plain words (the numbers stay in
// the app). Read from the app's structured signals, not from its sentences.
export function reasonFor(data: FieldApiResponse): string {
  const s = data.stressEvent.signature;
  const anomaly = s.rainAnomalyRatio;
  if (anomaly !== null && anomaly < 0.5) return "very dry";
  if (s.waterRatio < 0.75 || (anomaly !== null && anomaly < 0.75)) return "dry";
  // With fallback imagery the NDVI belongs to a different place; don't cite it.
  if (s.ndviTrend === "declining" && !data.usedFallback) return "crops fading";
  if (s.heatDays7 >= 3) return "hot spell";
  return "needs a look";
}

// --- The digest ----------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DEFAULT_MAX_LINES = 3;
const DEFAULT_GREETING = "Good morning!";

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
  chars: number;
  segments: number;
  totalActionable: number;
  lines: DigestLine[]; // every actionable plot, ranked
}

function cleanName(name: string): string {
  return toGsm7(name).split(/\s+/).filter(Boolean).join(" ") || "Plot";
}

function dateTag(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}${MONTHS[d.getMonth()]}`;
}

export function composeDigest(
  plots: DigestPlotInput[],
  options: { maxLines?: number; today?: Date; greeting?: string } = {}
): DigestResult {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const greeting = options.greeting ?? DEFAULT_GREETING;
  const hello = greeting ? `${greeting} ` : "";
  const tag = dateTag(options.today ?? new Date());

  // Same ordering as the Results tab: highest priority score first.
  const ranked = plots
    .filter((p) => p.data.stressEvent.severity !== "ok")
    .map((p) => ({ plot: p, rec: buildPlotRecommendation(p.data) }))
    .sort((a, b) => b.rec.priorityScore - a.rec.priorityScore);

  if (ranked.length === 0) {
    const text = toGsm7(`${hello}FarmOS ${tag}: all fields OK. No action.`);
    return { text, chars: text.length, segments: segmentCount(text), totalActionable: 0, lines: [] };
  }

  const n = ranked.length;
  const lines: DigestLine[] = ranked.map(({ plot, rec }, i) => {
    const severity = plot.data.stressEvent.severity;
    const name = cleanName(plot.name);
    const reason = reasonFor(plot.data);
    const action = actionCodeFor(severity, rec.actions);
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

  const out = [`${hello}FarmOS ${tag}: ${n} field${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} action.`];
  out.push(...lines.filter((l) => l.shown).map((l) => l.text));
  if (n > maxLines) out.push(`+${n - maxLines} more.`);

  const text = toGsm7(out.join("\n"));
  return { text, chars: text.length, segments: segmentCount(text), totalActionable: n, lines };
}
