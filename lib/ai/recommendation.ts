import { getStressEventDetail, setAiRecommendation, type StressEventDetail } from "@/db/stressEvents";
import { listNotesForPrompt } from "@/db/fieldNotes";
import { retrieveSimilarEvents, type EvidenceCandidate } from "../retrieval";
import { generateText } from "./groq";
import { NOTES_GUIDANCE, buildNotesSection } from "./notesPrompt";

const SYSTEM_PROMPT = `You are an agronomy assistant for Daiisi, a satellite + weather monitoring tool for small farms.
Given the current week's data for one field and a short history of similar past situations on that same field, write a SHORT recommendation for a busy farmer, in plain everyday words:
1. One priority line stating urgency plainly (e.g. "High priority — irrigate within 2 days." or "No action needed right now.")
2. At most 2 short sentences saying why, using only the one or two numbers that matter most. No jargon, no lists, no restating every signal. Mention the seasonal outlook or a past event only if it changes what the farmer should do.
Keep the whole answer under 50 words. Never invent a number you weren't given. If data is missing or a satellite scene is stale, say so in a few words.

${NOTES_GUIDANCE}`;

function formatEvidence(evidence: EvidenceCandidate[]): string {
  if (evidence.length === 0) return "No comparable past events recorded yet for this field.";
  return evidence
    .map((e, i) => `${i + 1}. [week of ${e.weekStart}] ${e.summary} ${e.verdict ? `Outcome: ${e.verdict}.` : "Outcome not recorded."}`)
    .join("\n");
}

function pct(value: number | null): string {
  return value === null ? "unknown" : `${Math.round(value * 100)}%`;
}

function formatSeasonalOutlook(outlook: StressEventDetail["seasonalOutlook"]): string {
  if (!outlook) return "no seasonal outlook available";
  const precip =
    outlook.precipLean === "near_normal"
      ? "near-normal rainfall expected"
      : `leaning ${outlook.precipLean} than normal rainfall (${Math.round(outlook.precipConfidence * 100)}% of forecast ensemble members agree)`;
  const temp =
    outlook.tempLean === "near_normal"
      ? "near-normal temperatures expected"
      : `leaning ${outlook.tempLean} than normal (${Math.round(outlook.tempConfidence * 100)}% of forecast ensemble members agree)`;
  return `next ${outlook.windowDays} days — ${precip}; ${temp}`;
}

// Cached on the stress_events row — generating this again for the same
// event just returns what was already written the first time it was asked
// for, rather than re-calling the model.
export async function generateAiRecommendation(stressEventId: string): Promise<string> {
  const event = await getStressEventDetail(stressEventId);
  if (!event) throw new Error("Stress event not found");
  if (event.aiRecommendation) return event.aiRecommendation;

  const evidence = await retrieveSimilarEvents(stressEventId, 3);
  // The farmer's own voice notes for this field. Extra context only, so a problem reading them must never
  // stop the recommendation. Saving or deleting a note clears this row's cached text (db/fieldNotes.ts), so
  // the next request lands here and regenerates with the change.
  const notes = await listNotesForPrompt(event.fieldId).catch(() => []);
  const notesSection = buildNotesSection(notes, new Date().toISOString().slice(0, 10));

  const userPrompt = `Field: "${event.fieldName}" (${event.crop || "crop not specified"})
Week of: ${event.weekStart}
Severity: ${event.severity.toUpperCase()}

Current signals (each labeled with its own time window — do not mix them up):
- PAST 30 DAYS — water balance: rainfall replaced ${pct(event.waterRatio)} of water lost (${event.rain30 ?? "unknown"}mm rain vs. ${event.et030 ?? "unknown"}mm evapotranspiration)
- PAST 30 DAYS — vs. this same calendar window's 5-year historical average: ${event.rainAnomalyRatio !== null ? `${pct(event.rainAnomalyRatio)} of the historical normal` : "no historical baseline available"}
- NEXT 16 DAYS — forecast: ${event.forecastRain16 ?? "unknown"}mm of rain expected
- PAST 7 DAYS — heat: ${event.heatDays7 ?? "unknown"} day(s) above 32°C
- LATEST — NDVI (satellite greenness): ${event.ndviMean !== null ? event.ndviMean.toFixed(3) : "no valid reading"}, 90-day trend: ${event.ndviTrend ?? "unknown"}
- DATA FRESHNESS: ${event.daysSinceClear !== null ? `last clear satellite scene was ${event.daysSinceClear} days ago (cloud cover ${event.cloudCover ?? "?"}%)` : "no clear scene in the last 60 days"}
- SEASONAL OUTLOOK — ${formatSeasonalOutlook(event.seasonalOutlook)}

${notesSection}Similar past events on this field:
${formatEvidence(evidence)}

Write the recommendation now.`;

  const text = await generateText(SYSTEM_PROMPT, userPrompt);
  await setAiRecommendation(stressEventId, text);
  return text;
}
