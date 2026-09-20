import { getStressEventDetail, setAiRecommendation, type StressEventDetail } from "@/db/stressEvents";
import { retrieveSimilarEvents, type EvidenceCandidate } from "../retrieval";
import { generateText } from "./groq";

const SYSTEM_PROMPT = `You are an agronomy assistant for FarmOS, a satellite + weather monitoring tool for small farms.
Given the current week's data for one field and a short history of similar past situations on that same field (with their eventual outcomes, when known), write a recommendation with:
1. One priority line stating urgency plainly (e.g. "High priority — irrigate within 2 days." or "No action needed right now.")
2. A 2-4 sentence explanation citing the specific numbers you were given (water balance, rainfall vs. forecast/normal, NDVI trend, cloud cover / data freshness). Mention the seasonal outlook only when it reinforces or complicates the near-term picture — e.g. a dry week heading into a seasonal outlook that also leans drier is worth flagging; a near-normal outlook usually isn't worth a sentence.
3. If, and only if, a past event is genuinely relevant, one sentence referencing what happened last time.
Be concise and concrete. Never invent a number you weren't given. If data is missing or a satellite scene is stale, say so plainly rather than guessing around it.`;

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

Similar past events on this field:
${formatEvidence(evidence)}

Write the recommendation now.`;

  const text = await generateText(SYSTEM_PROMPT, userPrompt);
  await setAiRecommendation(stressEventId, text);
  return text;
}
