import { getDb } from "./index";

export async function getLastDigestKey(phone: string): Promise<string | null> {
  const db = getDb();
  const { rows } = await db.query("SELECT digest_key FROM sms_log WHERE phone = $1 ORDER BY sent_at DESC LIMIT 1", [phone]);
  return rows[0]?.digest_key ?? null;
}

export async function recordSmsSent(phone: string, digestKey: string, body: string, twilioSid: string | null): Promise<void> {
  const db = getDb();
  await db.query("INSERT INTO sms_log (phone, digest_key, body, twilio_sid) VALUES ($1, $2, $3, $4)", [phone, digestKey, body, twilioSid]);
}
