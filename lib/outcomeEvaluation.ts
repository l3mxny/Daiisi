export type OutcomeVerdict = "improved" | "worsened" | "unchanged" | "insufficient_imagery";

// A single week's NDVI move is naturally much smaller than the 90-day trend
// thresholds in stressEvent.ts (±0.05) — these are a starting-point guess
// for "did this week's reading move enough to call it a real change" and
// worth tuning once real weekly deltas are on hand.
const NDVI_IMPROVE_THRESHOLD = 0.02;
const NDVI_WORSEN_THRESHOLD = -0.02;

export function determineOutcomeVerdict(
  priorNdvi: number | null,
  currentNdvi: number | null
): { verdict: OutcomeVerdict; ndviDelta: number | null } {
  if (priorNdvi === null || currentNdvi === null) {
    // No clear scene on one side or the other — cloud cover blocked the
    // comparison, not the crop being fine. Don't force a verdict.
    return { verdict: "insufficient_imagery", ndviDelta: null };
  }

  const delta = currentNdvi - priorNdvi;
  if (delta >= NDVI_IMPROVE_THRESHOLD) return { verdict: "improved", ndviDelta: delta };
  if (delta <= NDVI_WORSEN_THRESHOLD) return { verdict: "worsened", ndviDelta: delta };
  return { verdict: "unchanged", ndviDelta: delta };
}
