import type { StressEventDetail } from "@/db/stressEvents";
import type { EvidenceCandidate } from "../retrieval";
import type { StoredNote } from "../noteTypes";

// A guard between the language model and the farmer. Every figure in the AI's answer must be one that was
// given to it (in the same digits, or rounded to a whole number), and its opening line must agree with the
// verdict the rules reached. When either fails the app asks once more, and if that fails too it writes the
// text itself from the data, so an invented or inverted number never reaches the screen.

// Numbers that are part of how the app describes itself rather than data about the field.
const FIXED_NUMBERS = [5, 7, 16, 30, 32, 60, 90];

// Whole days since the farmer's planting date, or null when it is missing, unreadable or in the future.
export function cropAgeDays(plantedOn: string | null | undefined, now: Date = new Date()): number | null {
  if (!plantedOn) return null;
  const planted = Date.parse(`${plantedOn.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(planted)) return null;
  const days = Math.floor((now.getTime() - planted) / 86_400_000);
  return days >= 0 ? days : null;
}

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
  const age = cropAgeDays(event.plantedOn);
  if (age !== null) out.push(age, age / 7, Math.round(age / 7)); // "planted 63 days ago" / "about 9 weeks old"
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

// Past weeks are correlations. The model may say what happened, not that something caused or guarantees an outcome.
const CAUSAL = /\b(prove[sd]?|proven|guarantee[sd]?|definitely will|certain to)\b|\b(irrigation|watering|rain|spraying)\s+(worked|fixed|solved|caused|led to|resolved)\b|\brecovered (on its own|without (any )?(irrigation|intervention|help))\b|\bbecause (it|the field|the crop) (recovered|improved) (last|before|previously)\b/i;

// A past week only records the conditions and whether NDVI later rose or fell. It never says what the farmer did,
// so "improved after irrigation" is an invention unless the record itself mentions it.
const ACTION_ATTRIBUTION = /\b(improv\w*|recover\w*|got better|worsen\w*|got worse|declin\w*|fell|dropp?ed)\b[^.]{0,40}\b(after|with|following|thanks to|due to|from)\s+(the\s+)?(irrigat\w*|watering|spray\w*|treatment|fertili[sz]\w*)/i;

export function causalClaim(text: string, evidence: EvidenceCandidate[] = []): string | null {
  const m = text.match(CAUSAL);
  if (m) return `it states a cause or a certainty ("${m[0]}") that the data does not support`;
  const a = text.match(ACTION_ATTRIBUTION);
  const recorded = evidence.some((e) => /irrigat|water(ed|ing)|spray|fertili/i.test(e.summary));
  if (a && !recorded) return `it says a past outcome followed an action ("${a[0]}"), but the past weeks do not record any action`;
  return null;
}

// "You irrigated today" is only true if a note is dated today. The model has misread "3 days ago" as "today".
const TODAY_ACTION = /\b(irrigat\w*|spray\w*|harvest\w*)\b[^.]{0,40}\btoday\b|\btoday\b[^.]{0,40}\b(irrigat\w*|spray\w*|harvest\w*)\b/i;

export function staleTimeClaim(text: string, notes: StoredNote[], today: string): string | null {
  const m = text.match(TODAY_ACTION);
  if (m && !notes.some((n) => n.eventDate === today)) {
    return `it says "today" about something the farmer did ("${m[0]}"), but no note is dated today`;
  }
  return null;
}

export interface Problems {
  numbers: number[];
  verdict: string | null;
  causal: string | null;
  time: string | null;
}

export function checkAnswer(
  text: string,
  event: StressEventDetail,
  evidence: EvidenceCandidate[],
  notes: StoredNote[]
): Problems | null {
  const numbers = ungroundedNumbers(text, allowedNumbers(event, evidence, notes));
  const verdict = verdictConflict(text, event.severity);
  const causal = causalClaim(text, evidence);
  const time = staleTimeClaim(text, notes, new Date().toISOString().slice(0, 10));
  return numbers.length === 0 && !verdict && !causal && !time ? null : { numbers, verdict, causal, time };
}

export function describeProblems(p: Problems): string {
  const parts: string[] = [];
  if (p.numbers.length) parts.push(`these figures are not in the data you were given: ${p.numbers.join(", ")}`);
  if (p.verdict) parts.push(p.verdict);
  if (p.causal) parts.push(p.causal);
  if (p.time) parts.push(p.time);
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
