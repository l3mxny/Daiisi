-- Caches the AI-generated narrative per stress event so viewing it twice
-- doesn't re-call the model, and so a field's history keeps whatever
-- recommendation was actually shown at the time.
ALTER TABLE stress_events ADD COLUMN ai_recommendation text;
ALTER TABLE stress_events ADD COLUMN ai_recommendation_generated_at timestamptz;
