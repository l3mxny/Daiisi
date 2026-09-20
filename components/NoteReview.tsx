"use client";

import { useState } from "react";
import { EVENT_LABELS, EVENT_TYPES, type EventType, type FieldRef, type ParsedNote } from "@/lib/noteTypes";

// The "here's what we understood, please check" step. The farmer can change the field, the kind of event
// and the date before anything is saved; what they said (the detail) is shown word for word.

export interface NoteDraft {
  fieldId: string;
  eventType: EventType;
  eventDate: string;
}

function todayLocal(): string {
  return new Date().toLocaleDateString("en-CA"); // yyyy-mm-dd in the farmer's own time zone
}

export default function NoteReview({
  parsed,
  fieldChoices,
  defaultFieldId,
  saving,
  error,
  onSave,
  onDiscard,
}: {
  parsed: ParsedNote;
  fieldChoices: FieldRef[];
  defaultFieldId: string;
  saving: boolean;
  error: string | null;
  onSave: (draft: NoteDraft) => void;
  onDiscard: () => void;
}) {
  const [draft, setDraft] = useState<NoteDraft>({ fieldId: parsed.fieldId, eventType: parsed.eventType, eventDate: parsed.date });
  const labelOf = (id: string) => fieldChoices.find((f) => f.id === id)?.label ?? "this field";
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(draft.eventDate) && draft.eventDate <= todayLocal();

  const hints: string[] = [];
  if (parsed.usedFallback) {
    hints.push(`${parsed.fallbackReason ?? "We couldn't work out the details automatically"}, so this is filled in as a plain observation. Please check the field, type and date.`);
  } else {
    if (parsed.fieldMatch === "overridden") hints.push(`You mentioned ${labelOf(parsed.fieldId)}, so we picked that field. Change it back if that's wrong.`);
    if (parsed.fieldMatch === "weak-kept-default") hints.push(`You may have mentioned another field, but we weren't sure, so we kept ${labelOf(defaultFieldId)}.`);
    if (parsed.dateAssumed) hints.push("No date was mentioned, so we used today.");
    if (parsed.confidence < 0.6) hints.push("We're not very sure about this one. Please check it.");
  }

  return (
    <div className="mt-3 rounded-lg border border-green-200 bg-green-50/40 p-4" data-testid="note-review">
      <div className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">Here&apos;s how we understood it</div>
      <p className="mt-1 text-xs text-zinc-500">Nothing is saved until you press Save note. Change anything that&apos;s wrong.</p>

      {hints.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1" data-testid="note-hints">
          {hints.map((hint) => (
            <li key={hint} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {hint}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="text-xs text-zinc-600">
          Field
          <select
            value={draft.fieldId}
            onChange={(e) => setDraft({ ...draft, fieldId: e.target.value })}
            data-testid="review-field"
            className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900"
          >
            {fieldChoices.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-zinc-600">
          What happened
          <select
            value={draft.eventType}
            onChange={(e) => setDraft({ ...draft, eventType: e.target.value as EventType })}
            data-testid="review-type"
            className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900"
          >
            {EVENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {EVENT_LABELS[type]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-zinc-600">
          Date
          <input
            type="date"
            value={draft.eventDate}
            max={todayLocal()}
            onChange={(e) => setDraft({ ...draft, eventDate: e.target.value })}
            data-testid="review-date"
            className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900"
          />
        </label>
      </div>

      <div className="mt-3 text-xs text-zinc-600">In your words</div>
      <blockquote className="mt-1 rounded-md border border-zinc-200 bg-white p-2 text-sm whitespace-pre-wrap text-zinc-900" data-testid="review-detail">
        {parsed.detail}
      </blockquote>

      {error && (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700" data-testid="save-error">
          {error}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => onSave(draft)}
          disabled={saving || !valid}
          data-testid="save-note"
          className="rounded-full bg-green-700 px-5 py-2 text-sm font-medium text-white hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save note"}
        </button>
        <button
          type="button"
          onClick={onDiscard}
          disabled={saving}
          data-testid="discard-note"
          className="text-sm text-zinc-600 underline hover:text-zinc-900 disabled:opacity-40"
        >
          Discard and start over
        </button>
        {!valid && <span className="text-xs text-red-600">Pick a date that is today or earlier.</span>}
      </div>
    </div>
  );
}
