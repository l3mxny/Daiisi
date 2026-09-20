-- The farmer's own voice notes about a field ("irrigated north plot Tuesday", "leaves curling on the east
-- strip"). Each is interpreted from speech, then reviewed and confirmed by the farmer before it is saved.
-- Recent notes are shown to the AI recommendation (lib/ai/recommendation.ts), and saving or deleting a note
-- clears that field's cached recommendation for the week so the next one takes it into account.
--
-- Purely additive: a new table and index, nothing existing is changed. Run over the DIRECT connection
-- (DATABASE_URL_UNPOOLED).
CREATE TABLE IF NOT EXISTS field_notes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  field_id       uuid NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
  event_type     text NOT NULL CHECK (event_type IN ('planted', 'irrigated', 'sprayed', 'harvested', 'observation')),
  event_date     date NOT NULL,                 -- when it happened, resolved from what the farmer said
  detail         text NOT NULL,                 -- the farmer's own words, verbatim
  raw_transcript text NOT NULL DEFAULT '',      -- the full transcript the note came from
  confidence     double precision NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS field_notes_field_date_idx ON field_notes (field_id, event_date DESC);
