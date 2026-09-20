import type { StressEventDetail } from "@/db/stressEvents";
import type { EvidenceCandidate } from "../retrieval";
import type { StoredNote } from "../noteTypes";

// A guard between the language model and the farmer. Every figure in the AI's answer must be one that was
// given to it (in the same digits, or rounded to a whole number), and its opening line must agree with the
// verdict the rules reached. When either fails the app asks once more, and if that fails too it writes the
// text itself from the data, so an invented or inverted number never reaches the screen.

// Numbers that are part of how the app describes itself rather than data about the field.
const FIXED_NUMBERS = [5, 7, 16, 30, 32, 60, 90];

function withoutDates(text: string): string {
  return text
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(/\b\d{1,2}:\d{2}\b/g, " ")
    .replace(/\b(19|20)\d{2}\b/g, " ");
}

export function numbersIn(text: string): number[] {
  return [...withoutDates(text).matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
}

// Every value the model was shown, plus the forms it may reasonably restate them in (percent of a ratio,
// the gap to 100%, rounded).
export function allowedNumbers(event: StressEventDetail, evidence: EvidenceCandidate[], notes: StoredNote[]): number[] {
  const out: number[] = [...FIXED_NUMBERS];
  const push = (v: number | null | undefined, ...scales: number[]) => {
    if (v === null || v === undefined || !Number.isFinite(Number(v))) return;
    for (const s of scales) out.push(Number(v) * s);
  };
  push(event.waterRatio, 1, 100);
  push(event.rain30, 1);
  push(event.et030, 1);
  push(event.forecastRain16, 1);
  push(event.heatDays7, 1);
  push(event.rain30Normal, 1);
  push(event.rainAnomalyRatio, 100);
  if (event.rainAnomalyRatio !== null) out.push(Math.abs(1 - Number(event.rainAnomalyRatio)) * 100); // "X% below/above normal"
  push(event.ndviMean, 1);
  push(event.ndviDelta, 1);
  push(event.daysSinceClear, 1);
  push(event.cloudCover, 1);
  const so = event.seasonalOutlook;
  if (so) {
    push(so.windowDays, 1);
    push(so.precipConfidence, 100);
    push(so.tempConfidence, 100);
  }
  for (const e of evidence) out.push(...numbersIn(e.summary));
  for (const n of notes) out.push(...numbersIn(n.detail));
  return out;
}

function isGrounded(n: number, allowed: number[]): boolean {
  const isWhole = Number.isInteger(n);
  return allowed.some((a) => Math.abs(n - a) < 0.005 || (isWhole && (Math.round(a) === n || Math.floor(a) === n)) || Math.abs(n - a) < 0.051 && !isWhole);
}

export function ungroundedNumbers(text: string, allowed: number[]): number[] {
  return numbersIn(text).filter((n) => !isGrounded(n, allowed));
}

// The first line is the priority line. It must not say the opposite of the verdict.
export function verdictConflict(text: string, severity: StressEventDetail["severity"]): string | null {
  const first = text.split("\n")[0].replace(/\*\*/g, "");
  if (severity === "act" && /no action (is )?needed|all good|nothing to do/i.test(first)) {
    return "the verdict is ACT, but the priority line says no action is needed";
  }
  if (severity === "ok" && /high priority|urgent|irrigate (now|today|soon|within)/i.test(first)) {
    return "the verdict is OK, but the priority line asks for urgent action";
  }
  return null;
}

export interface Problems {
  numbers: number[];
  verdict: string | null;
}

export function checkAnswer(
  text: string,
  event: StressEventDetail,
  evidence: EvidenceCandidate[],
  notes: StoredNote[]
): Problems | null {
  const numbers = ungroundedNumbers(text, allowedNumbers(event, evidence, notes));
  const verdict = verdictConflict(text, event.severity);
  return numbers.length === 0 && !verdict ? null : { numbers, verdict };
}

export function describeProblems(p: Problems): string {
  const parts: string[] = [];
  if (p.numbers.length) parts.push(`these figures are not in the data you were given: ${p.numbers.join(", ")}`);
  if (p.verdict) parts.push(p.verdict);
  return parts.join("; ");
}

// Plain text written from the data alone, used when the model cannot be made to stay accurate.
export function groundedFallback(event: StressEventDetail): string {
  const headline =
    event.severity === "act"
      ? "**Act now.**"
      : event.severity === "watch"
        ? "**Keep a close eye on this field.**"
        : "**No action needed right now.**";
  const facts: string[] = [];
  if (event.rain30 !== null && event.et030 !== null) {
    facts.push(`Rain over the past 30 days was ${round1(event.rain30)} mm against ${round1(event.et030)} mm of crop water use.`);
  }
  if (event.forecastRain16 !== null) facts.push(`${round1(event.forecastRain16)} mm of rain is forecast in the next 16 days.`);
  if (event.ndviMean !== null) {
    const trend = event.ndviTrend === "declining" ? " and falling" : event.ndviTrend === "improving" ? " and rising" : "";
    facts.push(`Crop greenness (NDVI) is ${Number(event.ndviMean).toFixed(2)}${trend}.`);
  } else {
    facts.push("There is no clear satellite reading of the crop right now.");
  }
  return `${headline} ${facts.join(" ")}`;
}

const round1 = (v: number) => String(Math.round(Number(v) * 10) / 10);
