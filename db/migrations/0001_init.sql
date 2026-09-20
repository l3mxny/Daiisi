-- FarmOS knowledge graph schema (Phase 0)
--
-- Maps the graph the user described onto plain relational tables:
--   Field --experienced--> StressEvent --followed by--> Intervention --led to--> Outcome
--   StressEvent --matches--> WeatherPattern
--   Field --correlates with--> Neighbor (field_neighbors)
--
-- Run against the DIRECT (unpooled) connection string — DDL and extension
-- creation should not go through the pooled PgBouncer connection.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";        -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS lakebase_vector CASCADE; -- pulls in pgvector

-- One row per saved field (mirrors the app's Plot once it's saved).
CREATE TABLE IF NOT EXISTS fields (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  crop         text NOT NULL DEFAULT '',
  soil_type    text,
  planted_on   date,
  bbox_west    double precision NOT NULL,
  bbox_south   double precision NOT NULL,
  bbox_east    double precision NOT NULL,
  bbox_north   double precision NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Field <-> Neighbor: which fields are near enough to correlate with each
-- other (e.g. same farm, same microclimate). Symmetric relationship stored
-- as two directed rows so either side can query "my neighbors" directly.
CREATE TABLE IF NOT EXISTS field_neighbors (
  field_id          uuid NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
  neighbor_field_id uuid NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
  correlation       double precision,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (field_id, neighbor_field_id),
  CHECK (field_id <> neighbor_field_id)
);

-- Reusable, named weather "situations" (e.g. "early-summer heat + drought")
-- that a stress event can be classified against, so similar events across
-- different fields/times can be grouped without recomputing similarity from
-- scratch every time.
CREATE TABLE IF NOT EXISTS weather_patterns (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label       text NOT NULL,
  description text,
  signature   jsonb NOT NULL DEFAULT '{}'::jsonb, -- numeric fingerprint: water_ratio range, ndvi_trend, heat_days, rain_anomaly_ratio, etc.
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- One row per weekly computed snapshot for a field: the current signals
-- (weather + NDVI + seasonal outlook) at that point in time, classified
-- into a severity, with a short text summary embedded for semantic
-- retrieval later.
--
-- embedding dimension (1536) assumes an OpenAI text-embedding-3-small-class
-- model via the AI Gateway; change this column (and re-embed) if a
-- different model/dimension is chosen later.
CREATE TABLE IF NOT EXISTS stress_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  field_id            uuid NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
  week_start          date NOT NULL,
  severity            text NOT NULL CHECK (severity IN ('ok', 'watch', 'act')),

  -- weather signals (mirrors lib/weather.ts / lib/climate.ts today)
  water_ratio         double precision,
  rain_30             double precision,
  et0_30              double precision,
  forecast_rain_16    double precision,
  heat_days_7         integer,
  rain_30_normal      double precision,
  rain_anomaly_ratio  double precision,

  -- NOAA CPC seasonal outlook attached at computation time
  seasonal_outlook    jsonb,  -- e.g. {"precip_tercile": "below", "temp_tercile": "above", "confidence": 0.6}

  -- satellite signals (mirrors lib/sentinelHub.ts / stressEvent.ts today)
  ndvi_mean           double precision,
  ndvi_delta          double precision,
  ndvi_trend          text CHECK (ndvi_trend IN ('declining', 'stable', 'improving', 'unknown')),
  cloud_cover         double precision,
  days_since_clear    integer,

  weather_pattern_id  uuid REFERENCES weather_patterns(id),

  summary             text,        -- short human/AI-readable description of this event, used to build the embedding
  embedding           vector(1536),

  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (field_id, week_start)
);

CREATE INDEX IF NOT EXISTS stress_events_field_week_idx ON stress_events (field_id, week_start DESC);

CREATE INDEX IF NOT EXISTS stress_events_embedding_ann ON stress_events
  USING lakebase_ann (embedding vector_cosine_ops);

-- StressEvent --followed by--> Intervention: what the farmer says they did
-- (or didn't do) in response. This is the piece that makes outcome
-- attribution meaningful — without it, "intervention -> outcome" is a
-- guess, not a recorded fact.
CREATE TABLE IF NOT EXISTS interventions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stress_event_id uuid NOT NULL REFERENCES stress_events(id) ON DELETE CASCADE,
  action          text NOT NULL, -- e.g. 'irrigated', 'inspected', 'did_nothing', 'other'
  notes           text,
  logged_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS interventions_stress_event_idx ON interventions (stress_event_id);

-- Intervention --led to--> Outcome: the following week's job evaluates
-- what actually happened (NDVI delta + actual rainfall, not forecast) and
-- records a verdict. intervention_id is nullable so a stress event with no
-- logged intervention can still get an outcome (e.g. "field recovered on
-- its own" is useful information too).
CREATE TABLE IF NOT EXISTS outcomes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stress_event_id    uuid NOT NULL REFERENCES stress_events(id) ON DELETE CASCADE,
  intervention_id    uuid REFERENCES interventions(id) ON DELETE SET NULL,
  ndvi_delta_after   double precision,
  rain_during_period double precision,   -- actual rainfall observed, not the forecast used at recommendation time
  verdict            text CHECK (verdict IN ('improved', 'worsened', 'unchanged', 'insufficient_imagery')),
  notes              text,
  evaluated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS outcomes_stress_event_idx ON outcomes (stress_event_id);
CREATE INDEX IF NOT EXISTS outcomes_intervention_idx ON outcomes (intervention_id);
