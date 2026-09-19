import { getDb } from "./index";

export interface InterventionRow {
  id: string;
  stressEventId: string;
  action: string;
  notes: string | null;
  loggedAt: string;
}

function toInterventionRow(row: {
  id: string;
  stress_event_id: string;
  action: string;
  notes: string | null;
  logged_at: string;
}): InterventionRow {
  return {
    id: row.id,
    stressEventId: row.stress_event_id,
    action: row.action,
    notes: row.notes,
    loggedAt: row.logged_at,
  };
}

export async function createIntervention(input: {
  stressEventId: string;
  action: string;
  notes: string | null;
}): Promise<InterventionRow> {
  const db = getDb();
  const { rows } = await db.query(
    `INSERT INTO interventions (stress_event_id, action, notes) VALUES ($1, $2, $3) RETURNING *`,
    [input.stressEventId, input.action, input.notes]
  );
  return toInterventionRow(rows[0]);
}

export async function listInterventionsForStressEvent(stressEventId: string): Promise<InterventionRow[]> {
  const db = getDb();
  const { rows } = await db.query(
    "SELECT * FROM interventions WHERE stress_event_id = $1 ORDER BY logged_at ASC",
    [stressEventId]
  );
  return rows.map(toInterventionRow);
}
