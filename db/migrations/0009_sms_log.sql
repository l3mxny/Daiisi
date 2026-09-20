-- Tracks outbound weekly digest texts so a farmer isn't re-sent the exact
-- same message every week when nothing's changed (digest_key mirrors
-- lib/smsDigest.ts's DigestResult.key: the text without its date).
CREATE TABLE sms_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       text NOT NULL,
  digest_key  text NOT NULL,
  body        text NOT NULL,
  twilio_sid  text,
  sent_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sms_log_phone_idx ON sms_log (phone, sent_at DESC);
