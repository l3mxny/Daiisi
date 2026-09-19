-- Switch stress_events.embedding from the placeholder 1536-dim assumption
-- to 384-dim, matching sentence-transformers/all-MiniLM-L6-v2 (served
-- locally, e.g. via `ollama pull all-minilm`). Table is empty, so this is a
-- plain drop/recreate rather than a data migration.

DROP INDEX IF EXISTS stress_events_embedding_ann;

ALTER TABLE stress_events DROP COLUMN embedding;
ALTER TABLE stress_events ADD COLUMN embedding vector(384);

CREATE INDEX stress_events_embedding_ann ON stress_events
  USING lakebase_ann (embedding vector_cosine_ops);
