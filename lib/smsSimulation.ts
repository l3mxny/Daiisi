import type { DigestResult } from "./smsDigest";
import type { Severity } from "./stressEvent";

// Simulates what an upgraded Twilio account would do with the digest: validate the
// number, decide whether a text is worth sending, and walk a message through
// queued -> sent -> delivered. Nothing here touches the network.

const E164 = /^\+[1-9]\d{6,14}$/; // leading +, country code, digits only, 7-15 digits

export function isValidE164(number: string): boolean {
  return E164.test(number);
}

export type MessageStatus = "queued" | "sent" | "delivered";

export interface SimulatedMessage {
  id: string; // "SIM..." on purpose: a simulated id, never mistaken for a real Twilio SID
  to: string;
  body: string;
  chars: number;
  segments: number;
  createdAt: number;
  status: MessageStatus;
  key: string; // the body without its date, to tell whether a new text has anything new to say
  topSeverity: Severity;
  imageUrl: string | null; // satellite photo attached as an MMS, if any
}

export interface SendDecision {
  send: boolean;
  reason: string;
}

const SEVERITY_LEVEL: Record<Severity, number> = { ok: 0, watch: 1, act: 2 };

// Simplified for a live session: the full rules (in the Python sender) also apply a
// 1/3/7-day cooldown by urgency and back off repeats; here the point is to show that
// the farmer is not texted twice for the same news.
export function decideSimulatedSend(digest: DigestResult, last: SimulatedMessage | undefined): SendDecision {
  if (digest.totalActionable === 0) {
    return { send: false, reason: "Nothing needs action, so the farmer isn't texted." };
  }
  if (!last) return { send: true, reason: "First text to this farmer." };
  if (SEVERITY_LEVEL[digest.lines[0].severity] > SEVERITY_LEVEL[last.topSeverity]) {
    return { send: true, reason: "More urgent than the last text." };
  }
  if (last.key === digest.key) {
    return { send: false, reason: "Held back: same as the last text, nothing new to say." };
  }
  return { send: true, reason: "The situation changed since the last text." };
}

export function makeSimulatedMessage(
  to: string,
  digest: DigestResult,
  now: number,
  imageUrl: string | null = null
): SimulatedMessage {
  const hex = Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return {
    id: `SIM${hex}`,
    to,
    body: digest.text,
    key: digest.key,
    chars: digest.chars,
    segments: digest.segments,
    createdAt: now,
    status: "queued",
    topSeverity: digest.lines[0].severity,
    imageUrl,
  };
}
