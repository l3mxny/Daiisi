import { getDb } from "./index";
import { getStressEventForWeek } from "./stressEvents";
import { listInterventionsForStressEvent } from "./interventions";
import { determineOutcomeVerdict, type OutcomeVerdict } from "@/lib/outcomeEvaluation";
import { getPreviousWeekStart } from "@/lib/week";
import type { FieldSnapshot } from "@/lib/fieldSnapshot";
import type { FieldRow } from "./fields";

export interface OutcomeInput {
  stressEventId: string;
  interventionId: string | null;
  ndviDeltaAfter: number | null;
  rainDuringPeriod: number | null;
  verdict: OutcomeVerdict;
  notes: string | null;
}

export async function outcomeExistsForStressEvent(stressEventId: string): Promise<boolean> {
  const db = getDb();
  const { rows } = await db.query("SELECT 1 FROM outcomes WHERE stress_event_id = $1", [stressEventId]);
  return rows.length > 0;
}

export async function createOutcome(input: OutcomeInput): Promise<string> {
  const db = getDb();
  const { rows } = await db.query(
    `INSERT INTO outcomes (stress_event_id, intervention_id, ndvi_delta_after, rain_during_period, verdict, notes)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (stress_event_id) DO UPDATE SET
       intervention_id = EXCLUDED.intervention_id,
       ndvi_delta_after = EXCLUDED.ndvi_delta_after,
       rain_during_period = EXCLUDED.rain_during_period,
       verdict = EXCLUDED.verdict,
       notes = EXCLUDED.notes,
       evaluated_at = now()
     RETURNING id`,
    [input.stressEventId, input.interventionId, input.ndviDeltaAfter, input.rainDuringPeriod, input.verdict, input.notes]
  );
  return rows[0].id;
}

// Closes the loop on the *previous* week's stress event, if it hasn't been
// evaluated yet: compares that week's NDVI reading against the current one
// (already computed as part of this week's snapshot — no extra API calls)
// and records what actually happened, alongside whichever intervention was
// logged against it (first one, if more than one was logged that week).
// A no-op if there's no prior-week event yet (e.g. this field's first week)
// or it's already been evaluated.
export async function evaluatePendingOutcome(
  field: FieldRow,
  currentSnapshot: FieldSnapshot,
  weekStart: string
): Promise<void> {
  const previousWeekStart = getPreviousWeekStart(new Date(`${weekStart}T00:00:00Z`));
  const priorEvent = await getStressEventForWeek(field.id, previousWeekStart);
  if (!priorEvent) return;
  if (await outcomeExistsForStressEvent(priorEvent.id)) return;

  const { verdict, ndviDelta } = determineOutcomeVerdict(priorEvent.ndviMean, currentSnapshot.observation.ndviMean);
  const interventions = await listInterventionsForStressEvent(priorEvent.id);

  await createOutcome({
    stressEventId: priorEvent.id,
    interventionId: interventions[0]?.id ?? null,
    ndviDeltaAfter: ndviDelta,
    rainDuringPeriod: currentSnapshot.weather.rain7,
    verdict,
    notes: null,
  });
}
