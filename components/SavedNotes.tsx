"use client";

import { useEffect, useState } from "react";
import { EVENT_LABELS, type StoredNote } from "@/lib/noteTypes";

// The notes already saved for one field, newest first, each with a Delete button: a misheard note the
// farmer can't remove would be worse than no notes at all.

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function SavedNotes({ fieldId, refreshKey, onDeleted }: { fieldId: string; refreshKey: number; onDeleted?: () => void }) {
  const [notes, setNotes] = useState<StoredNote[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/notes?fieldId=${encodeURIComponent(fieldId)}&days=3650`) // all of them: a planting note is old by design
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.error ?? `Request failed: ${res.status}`);
        return json.notes as StoredNote[];
      })
      .then((list) => {
        if (cancelled) return;
        setNotes(list);
        setError(null);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [fieldId, refreshKey]);

  async function remove(id: string) {
    try {
      const res = await fetch(`/api/notes?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new Error("Couldn't delete that note. Try again.");
      setNotes((current) => (current ? current.filter((n) => n.id !== id) : current));
      setError(null);
      onDeleted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete that note.");
    }
  }

  return (
    <div className="mt-4 border-t border-zinc-100 pt-3" data-testid="saved-notes">
      <div className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">Saved notes for this field</div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {notes !== null && notes.length === 0 && !error && <p className="mt-2 text-sm text-zinc-500">No notes yet.</p>}
      {notes !== null && notes.length > 0 && (
        <ul className="mt-2 flex flex-col gap-2">
          {notes.map((note) => (
            <li key={note.id} className="flex items-start justify-between gap-3 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2" data-testid="saved-note">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-zinc-700">
                  {EVENT_LABELS[note.eventType]} · {formatDate(note.eventDate)}
                </div>
                <div className="mt-0.5 text-sm break-words text-zinc-900">{note.detail}</div>
              </div>
              <button
                type="button"
                onClick={() => remove(note.id)}
                aria-label={`Delete note: ${note.detail}`}
                data-testid="delete-note"
                className="shrink-0 text-xs text-red-600 underline hover:text-red-800"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
