-- Fields become owned by a phone number (no password/OTP — see the app's
-- sign-in flow) instead of living only in browser state. Backfill existing
-- rows to a known number before enforcing NOT NULL so nothing is orphaned.
ALTER TABLE fields ADD COLUMN phone text;
UPDATE fields SET phone = '4257731990' WHERE phone IS NULL;
ALTER TABLE fields ALTER COLUMN phone SET NOT NULL;
CREATE INDEX fields_phone_idx ON fields (phone);
