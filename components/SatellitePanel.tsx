"use client";

import type { DigestResult } from "@/lib/smsDigest";
import type { Severity } from "@/lib/stressEvent";
import type { Plot } from "@/lib/types";
import { whyFor } from "./PlotComparison";

// The pictures behind the text: the latest clear satellite photo and greenness map
// for each field, in the same order as the message. Only reads what the app already
// fetched for each plot; nothing here changes how fields are analysed.

const SEVERITY_BADGE: Record<Severity, string> = {
  ok: "bg-green-100 text-green-800",
  watch: "bg-amber-100 text-amber-800",
  act: "bg-red-100 text-red-800",
};
const SEVERITY_LABEL: Record<Severity, string> = { ok: "OK", watch: "WATCH", act: "ACT NOW" };

// The colors the greenness map uses (see NDVI_COLOR_EVALSCRIPT in lib/evalscripts.ts).
const GREENNESS_GRADIENT =
  "linear-gradient(to right, rgb(139,69,19), rgb(206,184,139), rgb(255,255,191), rgb(217,239,139), rgb(102,189,99), rgb(26,152,80), rgb(0,90,50))";

const RANK_STYLE = { worst: "bg-rose-50 text-rose-700", best: "bg-green-50 text-green-800", "": "bg-zinc-50 text-zinc-600" } as const;

// "worst" / "best" greenness among the plots, only when they actually differ.
function ndviRank(value: number | null, all: number[]): "worst" | "best" | "" {
  if (value === null || all.length < 2) return "";
  const min = Math.min(...all);
  const max = Math.max(...all);
  if (min === max) return "";
  return value === min ? "worst" : value === max ? "best" : "";
}

function Picture({ src, alt, label }: { src: string | null; alt: string; label: string }) {
  return (
    <figure>
      <div className="aspect-square overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={alt} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center p-3 text-center text-xs text-zinc-500">
            No picture available yet
          </div>
        )}
      </div>
      <figcaption className="mt-1 text-center text-xs text-zinc-500">{label}</figcaption>
    </figure>
  );
}

// One plain sentence about what the crop looks like, from the app's own trend reading.
function cropSentence(plot: Plot): string {
  const data = plot.data!;
  if (!data.observation.ndviValid) {
    return "Clouds blocked a clear view, so there is no fresh reading of the crop.";
  }
  switch (data.stressEvent.signature.ndviTrend) {
    case "declining":
      return "Greenness has been falling over the last 90 days: the crop may already be stressed.";
    case "improving":
      return "Greenness has been rising over the last 90 days: the crop is still growing.";
    case "stable":
      return "Greenness has held steady over the last 90 days: the crop looks the same as before.";
    default:
      return "Not enough history yet to say whether the crop is changing.";
  }
}

export default function SatellitePanel({ plots, digest }: { plots: Plot[]; digest: DigestResult }) {
  // Same order as the text (most urgent first); fields that need no text follow.
  const lineById = new Map(digest.lines.map((l) => [l.id, l]));
  const ordered = [
    ...digest.lines.map((l) => plots.find((p) => p.id === l.id)).filter((p): p is Plot => p !== undefined),
    ...plots.filter((p) => !lineById.has(p.id)),
  ];
  if (ordered.length === 0) return null;
  const allNdvi = ordered.flatMap((p) => {
    const o = p.data!.observation;
    return o.ndviValid && o.ndviMean !== null ? [o.ndviMean] : [];
  });

  return (
    <section>
      <h2 className="font-[family-name:var(--font-display)] text-xl font-bold tracking-tight text-olive uppercase">What the satellite saw</h2>
      <p className="mt-1 max-w-2xl text-sm text-zinc-500">
        The most recent clear picture of each field side by side, in the same order as the text. A lack of rain can&apos;t be seen from
        space, so these show how the crops are responding.
      </p>

      <div className="mt-3 max-w-md">
        <div className="h-2.5 rounded-full" style={{ background: GREENNESS_GRADIENT }} />
        <div className="mt-1 flex justify-between text-[11px] text-zinc-500">
          <span>bare or stressed</span>
          <span>healthy crop</span>
        </div>
      </div>

      {/* One column per plot so the pictures line up: compare photos, greenness maps and reasons across. */}
      <div className="mt-4">
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(21rem, 26rem))" }}>
          {ordered.map((plot) => {
            const data = plot.data!;
            const obs = data.observation;
            const line = lineById.get(plot.id);
            const severity = data.stressEvent.severity;
            const why = whyFor(plot);
            const rank = ndviRank(obs.ndviValid ? obs.ndviMean : null, allNdvi);
            return (
              <div key={plot.id} className="flex min-w-0 flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-3">
                <div className="flex items-start justify-between gap-2">
                  <div translate="no" className="min-w-0 truncate font-serif text-base text-zinc-900">
                    {plot.label}
                  </div>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${SEVERITY_BADGE[severity]}`}>
                    {SEVERITY_LABEL[severity]}
                  </span>
                </div>
                <div translate="no" className="font-mono text-[11px] leading-snug text-zinc-600">
                  {line ? (line.shown ? line.text : `${line.text}  (counted in "+more")`) : "Not in the text: nothing to do"}
                </div>

                {data.usedFallback && (
                  <div className="rounded-md border border-zinc-300 bg-zinc-50 p-1.5 text-[11px] text-zinc-700">
                    Sample pictures, not this field (live satellite access failed).
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <Picture src={obs.trueColorImage} alt={`${plot.label}: satellite photo`} label="Photo (true color)" />
                  <Picture src={obs.ndviImage} alt={`${plot.label}: crop greenness map`} label="Crop greenness map" />
                </div>

                <div className={`rounded-md px-2 py-1 text-xs ${RANK_STYLE[rank]}`}>
                  Greenness index{" "}
                  <span className="font-semibold">{obs.ndviValid && obs.ndviMean !== null ? obs.ndviMean.toFixed(2) : "no clear view"}</span>
                  {rank === "worst" && " · lowest"}
                  {rank === "best" && " · highest"}
                </div>
                <div className="text-[11px] text-zinc-500">
                  {obs.date ? (
                    <>
                      Taken {obs.date}
                      {obs.daysSinceClear !== null ? ` (${obs.daysSinceClear}d ago)` : ""}
                      {obs.cloudCover !== null ? ` · ${Math.round(obs.cloudCover)}% cloud` : ""}
                    </>
                  ) : (
                    "No clear picture in the last 60 days."
                  )}
                </div>
                <p className="text-xs text-zinc-700">{cropSentence(plot)}</p>
                <div className="mt-auto flex flex-wrap gap-1 border-t border-zinc-100 pt-2">
                  {why.length === 0 ? (
                    <span className="text-[11px] text-zinc-400">Nothing wrong</span>
                  ) : (
                    why.map((w) => (
                      <span key={w} className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600">
                        {w}
                      </span>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
