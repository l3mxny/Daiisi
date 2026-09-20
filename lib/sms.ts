import crypto from "node:crypto";

// Real SMS send/receive via Twilio's REST API — plain fetch, same pattern as
// every other external service in this app (Groq, Open-Meteo, Sentinel Hub):
// no SDK dependency, just HTTP.

const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01";

export class TwilioError extends Error {}

// The app stores US numbers as bare digits (e.g. "4257731990" — see
// lib/phone.ts), but Twilio requires E.164 ("+14257731990"). US-only, per
// the current scope.
export function toE164US(phone: string): string | null {
  if (phone.startsWith("+")) return phone;
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

// The reverse, for an inbound webhook's `From` (always E.164) — strips the
// +1 so it matches what's stored in fields.phone.
export function usPhoneFromE164(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

export async function sendSms(to: string, body: string): Promise<{ sid: string }> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!accountSid || !authToken || !from) {
    throw new TwilioError("Twilio isn't configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER)");
  }

  const res = await fetch(`${TWILIO_API_BASE}/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
  });

  const json: { sid?: string; message?: string } | null = await res.json().catch(() => null);
  if (!res.ok) {
    throw new TwilioError(`Twilio send failed: ${res.status} ${json?.message ?? ""}`.trim());
  }
  if (!json?.sid) throw new TwilioError("Twilio accepted the request but returned no message sid");
  return { sid: json.sid };
}

// Confirms an inbound webhook request genuinely came from Twilio: HMAC-SHA1
// of (the exact webhook URL + every POST param, sorted by key and
// concatenated as key+value) using the auth token as the key, base64-encoded
// — must match the X-Twilio-Signature header.
// https://www.twilio.com/docs/usage/security#validating-requests
export function validateTwilioSignature(
  url: string,
  params: Record<string, string>,
  signatureHeader: string | null,
  authToken: string
): boolean {
  if (!signatureHeader) return false;
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  const expected = crypto.createHmac("sha1", authToken).update(data, "utf8").digest("base64");

  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
