import { getDb } from "@/db/index";

export interface EvidenceCandidate {
  id: string;
  weekStart: string;
  severity: string;
  summary: string;
  ndviTrend: string | null;
  waterRatio: number | null;
  heatDays7: number | null;
  rainAnomalyRatio: number | null;
  verdict: string | null; // from outcomes, if this event was ever evaluated
}

interface Signature {
  embedding: number[];
  waterRatio: number | null;
  ndviTrend: string | null;
  heatDays7: number | null;
  rainAnomalyRatio: number | null;
}

interface ScoredCandidate extends EvidenceCandidate {
  embedding: number[];
  relevance: number;
}

// pgvector's text output is "[0.1,0.2,...]" — no special pg type parser is
// registered for it, so it comes back as a plain string to parse by hand.
function parseVector(text: string): number[] {
  return text
    .slice(1, -1)
    .split(",")
    .map(Number);
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Blends four independent [0,1]-ish signals into one relevance score.
// Missing data contributes a neutral 0.5 rather than dragging the score to
// either extreme.
const RELEVANCE_WEIGHTS = { semantic: 0.4, structured: 0.35, recency: 0.15 };
const OUTCOME_BONUS = 0.15; // a case we actually know the outcome of is more useful evidence than a guess
const RECENCY_HALF_LIFE_DAYS = 180;

function structuredSimilarity(query: Signature, candidate: Signature): number {
  const waterSim =
    query.waterRatio !== null && candidate.waterRatio !== null
      ? 1 - Math.min(1, Math.abs(query.waterRatio - candidate.waterRatio))
      : 0.5;
  const trendSim = query.ndviTrend === null || candidate.ndviTrend === null ? 0.5 : query.ndviTrend === candidate.ndviTrend ? 1 : 0;
  const heatSim =
    query.heatDays7 !== null && candidate.heatDays7 !== null
      ? 1 - Math.min(1, Math.abs(query.heatDays7 - candidate.heatDays7) / 7)
      : 0.5;
  const rainAnomalySim =
    query.rainAnomalyRatio !== null && candidate.rainAnomalyRatio !== null
      ? 1 - Math.min(1, Math.abs(query.rainAnomalyRatio - candidate.rainAnomalyRatio) / 2)
      : 0.5;
  return (waterSim + trendSim + heatSim + rainAnomalySim) / 4;
}

function computeRelevance(query: Signature, candidate: Signature, candidateWeekStart: string, hasOutcome: boolean, now: number): number {
  const semantic = cosineSimilarity(query.embedding, candidate.embedding);
  const structured = structuredSimilarity(query, candidate);
  const ageDays = (now - new Date(`${candidateWeekStart}T00:00:00Z`).getTime()) / 86_400_000;
  const recency = Math.exp((-Math.LN2 * ageDays) / RECENCY_HALF_LIFE_DAYS);

  return (
    RELEVANCE_WEIGHTS.semantic * semantic +
    RELEVANCE_WEIGHTS.structured * structured +
    RELEVANCE_WEIGHTS.recency * recency +
    (hasOutcome ? OUTCOME_BONUS : 0)
  );
}

// Greedy maximization of a relevance-weighted facility-location objective:
//   F(S) = sum over every candidate i of relevance(i) * max(j in S) sim(i, j)
// This is monotone submodular (a non-negative weighted sum of per-item
// coverage terms, each of which is itself monotone submodular in S), so
// greedily adding the candidate with the largest marginal gain at each step
// gives a (1 - 1/e) approximation to the optimal k-subset — the standard
// justification for using greedy here rather than an exhaustive search.
// In plain terms: this avoids handing back k near-duplicates of the same
// event by rewarding candidates that cover ground the current selection
// doesn't already cover, not just whichever candidates score highest alone.
function selectDiverseEvidence(candidates: ScoredCandidate[], k: number): ScoredCandidate[] {
  const n = candidates.length;
  const coverage = new Array(n).fill(0); // best similarity to anything already selected, per candidate i
  const simCache: number[][] = Array.from({ length: n }, () => new Array(n).fill(-1));
  function sim(i: number, j: number): number {
    if (simCache[i][j] === -1) {
      const s = cosineSimilarity(candidates[i].embedding, candidates[j].embedding);
      simCache[i][j] = s;
      simCache[j][i] = s;
    }
    return simCache[i][j];
  }

  const selected: number[] = [];
  const remaining = new Set(candidates.map((_, i) => i));

  while (selected.length < Math.min(k, n) && remaining.size > 0) {
    let bestIdx = -1;
    let bestGain = -Infinity;
    for (const c of remaining) {
      let gain = 0;
      for (let i = 0; i < n; i++) {
        gain += candidates[i].relevance * Math.max(0, sim(i, c) - coverage[i]);
      }
      if (gain > bestGain) {
        bestGain = gain;
        bestIdx = c;
      }
    }
    selected.push(bestIdx);
    remaining.delete(bestIdx);
    for (let i = 0; i < n; i++) {
      coverage[i] = Math.max(coverage[i], sim(i, bestIdx));
    }
  }

  return selected.map((i) => candidates[i]);
}

// The evidence-retrieval step for the (future) AI decision layer: given the
// stress event currently being reasoned about, find the k most useful past
// cases for this same field — relevant, but deliberately non-redundant with
// each other.
export async function retrieveSimilarEvents(stressEventId: string, k = 3): Promise<EvidenceCandidate[]> {
  const db = getDb();

  const { rows: queryRows } = await db.query(
    `SELECT field_id, embedding::text AS embedding, water_ratio, ndvi_trend, heat_days_7, rain_anomaly_ratio
     FROM stress_events WHERE id = $1`,
    [stressEventId]
  );
  const query = queryRows[0];
  if (!query || !query.embedding) return [];

  const { rows: candidateRows } = await db.query(
    `SELECT se.id, se.week_start, se.severity, se.summary, se.ndvi_trend, se.water_ratio, se.heat_days_7,
            se.rain_anomaly_ratio, se.embedding::text AS embedding, o.verdict
     FROM stress_events se
     LEFT JOIN outcomes o ON o.stress_event_id = se.id
     WHERE se.field_id = $1 AND se.id != $2 AND se.embedding IS NOT NULL
     ORDER BY se.week_start DESC`,
    [query.field_id, stressEventId]
  );
  if (candidateRows.length === 0) return [];

  const querySignature: Signature = {
    embedding: parseVector(query.embedding),
    waterRatio: query.water_ratio,
    ndviTrend: query.ndvi_trend,
    heatDays7: query.heat_days_7,
    rainAnomalyRatio: query.rain_anomaly_ratio,
  };
  const now = Date.now();

  const scored: ScoredCandidate[] = candidateRows.map((row) => {
    const embedding = parseVector(row.embedding);
    const candidateSignature: Signature = {
      embedding,
      waterRatio: row.water_ratio,
      ndviTrend: row.ndvi_trend,
      heatDays7: row.heat_days_7,
      rainAnomalyRatio: row.rain_anomaly_ratio,
    };
    return {
      id: row.id,
      weekStart: row.week_start,
      severity: row.severity,
      summary: row.summary,
      ndviTrend: row.ndvi_trend,
      waterRatio: row.water_ratio,
      heatDays7: row.heat_days_7,
      rainAnomalyRatio: row.rain_anomaly_ratio,
      verdict: row.verdict,
      embedding,
      relevance: computeRelevance(querySignature, candidateSignature, row.week_start, row.verdict !== null, now),
    };
  });

  return selectDiverseEvidence(scored, k).map((c) => ({
    id: c.id,
    weekStart: c.weekStart,
    severity: c.severity,
    summary: c.summary,
    ndviTrend: c.ndviTrend,
    waterRatio: c.waterRatio,
    heatDays7: c.heatDays7,
    rainAnomalyRatio: c.rainAnomalyRatio,
    verdict: c.verdict,
  }));
}
