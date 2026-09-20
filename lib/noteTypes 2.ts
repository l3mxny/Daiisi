// Shared shapes for voice field notes. Types and constants only (no Node or browser APIs), so both the
// server routes and the client components can import this.

export const EVENT_TYPES = ["planted", "irrigated", "sprayed", "harvested", "observation"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_LABELS: Record<EventType, string> = {
  planted: "Planted",
  irrigated: "Irrigated",
  sprayed: "Sprayed",
  harvested: "Harvested",
  observation: "Observation",
};

export function isEventType(value: unknown): value is EventType {
  return typeof value === "string" && (EVENT_TYPES as readonly string[]).includes(value);
}

export interface FieldRef {
  id: string;
  label: string;
}

// How the farmer's words were understood. `detail` is always the farmer's own words, verbatim.
export interface ParsedNote {
  fieldId: string; // the default (open panel) unless the speech clearly named another field
  eventType: EventType;
  date: string; // yyyy-mm-dd, resolved relative to when the note was CAPTURED
  dateAssumed: boolean; // true when no usable date was spoken and today was filled in
  detail: string;
  confidence: number; // 0 to 1
  rawTranscript: string;
  fieldMatch: "default" | "overridden" | "weak-kept-default";
  usedFallback: boolean; // true when the extraction failed and this is a plain observation
  fallbackReason?: string;
}

export interface NewNote {
  fieldId: string;
  eventType: EventType;
  eventDate: string; // yyyy-mm-dd
  detail: string;
  rawTranscript: string;
  confidence: number;
}

export interface StoredNote extends NewNote {
  id: string;
  createdAt: string; // ISO timestamp
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
