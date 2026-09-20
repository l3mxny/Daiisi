"use client";

import { useEffect, useState } from "react";

interface Intervention {
  id: string;
  stressEventId: string;
  action: string;
  notes: string | null;
  loggedAt: string;
}

const ACTIONS = [
  { value: "irrigated", label: "Irrigated" },
  { value: "inspected", label: "Inspected" },
  { value: "did_nothing", label: "Did nothing" },
];

function actionLabel(action: string): string {
  return ACTIONS.find((a) => a.value === action)?.label ?? action;
}

// Lets the farmer record what they actually did about a stress event — the
// piece that makes a future "did the intervention work" outcome check
// meaningful instead of guessed. Ties to this week's stress_events row
// (data.stressEventId), not the field in general.
export default function InterventionLogger({ stressEventId }: { stressEventId: string | null }) {
  const [interventions, setInterventions] = useState<Intervention[]>([]);
  const [showOther, setShowOther] = useState(false);
  const [otherNote, setOtherNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // Nothing to fetch without an id — the render below only shows the
    // interventions list once stressEventId is set, so there's no stale
    // state to clear here.
    if (!stressEventId) return;
    fetch(`/api/interventions?stressEventId=${stressEventId}`)
      .then((res) => res.json())
      .then((data) => setInterventions(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [stressEventId]);

  async function logAction(action: string, notes: string | null) {
    if (!stressEventId || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/interventions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stressEventId, action, notes }),
      });
      if (res.ok) {
        const created: Intervention = await res.json();
        setInterventions((prev) => [...prev, created]);
        setOtherNote("");
        setShowOther(false);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-zinc-400">What did you do?</div>

      {!stressEventId ? (
        <p className="mt-1.5 text-sm text-zinc-500">Refresh this field to enable logging.</p>
      ) : (
        <>
          {interventions.length > 0 && (
            <ul className="mt-1.5 flex flex-col gap-1">
              {interventions.map((iv) => (
                <li key={iv.id} className="text-sm text-zinc-600">
                  <span className="font-medium text-zinc-800">{actionLabel(iv.action)}</span>
                  {iv.notes ? ` — ${iv.notes}` : ""}{" "}
                  <span className="text-xs text-zinc-400">
                    ({new Date(iv.loggedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })})
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-2 flex flex-wrap gap-2">
            {ACTIONS.map((a) => (
              <button
                key={a.value}
                type="button"
                disabled={submitting}
                onClick={() => logAction(a.value, null)}
                className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-600 transition-colors hover:border-green-300 hover:bg-green-50 disabled:opacity-50"
              >
                {a.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setShowOther((v) => !v)}
              className="rounded-full border border-dashed border-zinc-300 px-3 py-1.5 text-sm text-zinc-500 hover:bg-zinc-50"
            >
              + Other
            </button>
          </div>

          {showOther && (
            <div className="mt-2 flex gap-2">
              <input
                value={otherNote}
                onChange={(e) => setOtherNote(e.target.value)}
                placeholder="What did you do?"
                className="flex-1 rounded-xl border border-zinc-200 px-3 py-1.5 text-sm outline-none focus:border-green-400"
              />
              <button
                type="button"
                disabled={submitting || !otherNote.trim()}
                onClick={() => logAction("other", otherNote.trim())}
                className="rounded-full bg-green-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                Log
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
