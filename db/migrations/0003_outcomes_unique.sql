-- One outcome per stress event — the weekly job upserts on this so
-- re-running it (retries, manual re-triggers) doesn't create duplicates.
ALTER TABLE outcomes ADD CONSTRAINT outcomes_stress_event_unique UNIQUE (stress_event_id);
