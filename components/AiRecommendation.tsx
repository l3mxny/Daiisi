import type { ReactNode } from "react";
import type { EvidenceCandidate } from "@/lib/retrieval";
import SpeakButton from "./SpeakButton";

const VERDICT_LABEL: Record<string, string> = {
  improved: "Improved after this",
  worsened: "Worsened after this",
  unchanged: "No change after this",
  insufficient_imagery: "Outcome unclear (cloud cover)",
};

function renderBold(text: string, key: number): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return (
    <p key={key} className="text-sm text-zinc-600">
      {parts.map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <strong key={i} className="font-semibold text-zinc-900">
            {part.slice(2, -2)}
          </strong>
        ) : (
          part
        )
      )}
    </p>
  );
}

function formatWeekOf(weekStart: string): string {
  return new Date(`${weekStart}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

// The full AI panel — recommendation text plus the retrieved evidence it
// drew on. Presentational only; data comes from useAiRecommendation so it's
// shared with the compact hover preview instead of fetched twice.
export default function AiRecommendation({
  loading,
  error,
  recommendation,
  evidence,
}: {
  loading: boolean;
  error: string | null;
  recommendation: string | null;
  evidence: EvidenceCandidate[];
}) {
  return (
    <div className="rounded-2xl border border-green-100 bg-green-50/50 p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-green-800 uppercase">
          <SparkleIcon />
          AI take
        </div>
        {recommendation && <SpeakButton text={recommendation} />}
      </div>

      {loading && <p className="text-sm text-zinc-500">Thinking it through…</p>}
      {error && <p className="text-sm text-red-600">Couldn&apos;t generate a recommendation: {error}</p>}

      {recommendation && (
        <div className="flex flex-col gap-1.5">
          {recommendation
            .split("\n\n")
            .map((p) => p.trim())
            .filter(Boolean)
            .map((para, i) => renderBold(para, i))}
        </div>
      )}

      {evidence.length > 0 && (
        <details className="mt-3 border-t border-green-200 pt-3">
          <summary className="mb-1.5 cursor-pointer text-xs font-semibold tracking-wide text-green-800/70 uppercase">
            Based on {evidence.length} similar past situation{evidence.length === 1 ? "" : "s"}
          </summary>
          <ul className="flex flex-col gap-1">
            {evidence.map((e) => (
              <li key={e.id} className="text-xs text-zinc-600">
                <span className="font-medium text-zinc-700">{formatWeekOf(e.weekStart)}:</span> {e.summary}
                {e.verdict && (
                  <span className="ml-1.5 rounded-full bg-white px-1.5 py-0.5 text-[10px] font-medium text-zinc-500">
                    {VERDICT_LABEL[e.verdict] ?? e.verdict}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function SparkleIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor">
      <path d="M8 1l1.2 3.8L13 6l-3.8 1.2L8 11l-1.2-3.8L3 6l3.8-1.2z" />
    </svg>
  );
}
