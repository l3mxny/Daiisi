-- Links an intervention back to the voice note it came from, so deleting
-- the note also removes the intervention (ON DELETE CASCADE) instead of
-- leaving an orphaned row the farmer never actually confirmed. UNIQUE
-- because a given note produces at most one intervention.
ALTER TABLE interventions ADD COLUMN note_id uuid REFERENCES field_notes(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX interventions_note_id_key ON interventions (note_id);
