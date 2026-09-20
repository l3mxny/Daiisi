"use client";

import { useState } from "react";
import FieldNotes from "./FieldNotes";
import NdviChart from "./NdviChart";
import AiRecommendation from "./AiRecommendation";
import SpeakButton from "./SpeakButton";
import { useAiRecommendation } from "@/lib/ai/useAiRecommendation";
import type { FieldApiResponse, Plot } from "@/lib/types";
import type { Severity } from "@/lib/stressEvent";
import { formatArea, MIN_RELIABLE_HECTARES } from "@/lib/geo";
import { buildPlotRecommendation, type PlotRecommendation } from "@/lib/recommendations";

const SEVERITY_DOT: Record<Severity, string> = {
  ok: "bg-green-400",
  watch: "bg-amber-400",
  act: "bg-rose-400",
};

const SEVERITY_BADGE: Record<Severity, string> = {
  ok: "bg-green-50 text-green-700",
  watch: "bg-amber-50 text-amber-700",
  act: "bg-rose-50 text-rose-700",
};

function badgeText(severity: Severity): string {
  if (severity === "act") return "Act now";
  if (severity === "watch") return "Within 3 days";
  return "All good";
}

// Includes plots currently re-fetching (status "loading" but still holding
// their last-known-good data) so a refresh doesn't yank the card out from
// under the farmer mid-read — only plots with no data yet drop out.
function rankPlots(plots: Plot[]): Array<{ plot: Plot; recommendation: PlotRecommendation }> {
  return plots
    .filter((p) => p.data !== null)
    .map((plot) => ({
      plot,
      recommendation: buildPlotRecommendation(plot.data!),
    }))
    .sort((a, b) => b.recommendation.priorityScore - a.recommendation.priorityScore);
}

function PlantIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 17.5V10" />
      <path d="M10 10C10 6.5 7 5 4.5 5c0 3.5 2.5 5 5.5 5z" />
      <path d="M10 8c0-3 2.5-4.5 5.5-4.5C15.5 6.8 13.2 8.5 10 8z" />
    </svg>
  );
}

function RainIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 8.5a3.5 3.5 0 010-7 4 4 0 017.6 1.3A3.25 3.25 0 0116.5 8.5z" />
      <path d="M6.5 12l-1 2.5M10 12l-1 2.5M13.5 12l-1 2.5" />
    </svg>
  );
}

function SunIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="3.5" />
      <path d="M10 2.5v2M10 15.5v2M17.5 10h-2M4.5 10h-2M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4M15.3 15.3l-1.4-1.4M6.1 6.1L4.7 4.7" />
    </svg>
  );
}

function WarningIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 3.5l7.5 13h-15z" strokeLinejoin="round" />
      <path d="M10 8.3v3.4" />
      <circle cx="10" cy="14.3" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

function SummaryTiles({ readyPlots }: { readyPlots: Plot[] }) {
  const n = readyPlots.length;
  if (n === 0) return null;

  // Plots can be in different places, so an average across them describes none of them: show the spread.
  const spread = (values: number[], unit: string) => {
    const lo = Math.round(Math.min(...values));
    const hi = Math.round(Math.max(...values));
    return lo === hi ? `${lo}${unit}` : `${lo}–${hi}${unit}`;
  };
  const maxHeatDays = Math.max(...readyPlots.map((p) => p.data!.weather.heatDays7));
  const needAttention = readyPlots.filter((p) => p.data!.stressEvent.severity !== "ok").length;

  const tiles = [
    { label: "Crop water need met by rain (30d)", value: spread(readyPlots.map((p) => p.data!.weather.waterRatio * 100), "%"), Icon: PlantIcon },
    { label: "Rain in next 16 days", value: spread(readyPlots.map((p) => p.data!.weather.forecastRain16), " mm"), Icon: RainIcon },
    { label: "Most hot days (7d, >32°C)", value: String(maxHeatDays), Icon: SunIcon },
    { label: "Fields need you", value: `${needAttention} of ${n}`, Icon: WarningIcon },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className="flex items-center gap-3 rounded-2xl border border-zinc-100 bg-white px-4 py-3 shadow-sm">
          {t.Icon && <t.Icon className="h-9 w-9 shrink-0 text-zinc-400" />}
          <div>
            <div className="font-serif text-2xl text-zinc-900">{t.value}</div>
            <div className="text-xs text-zinc-500">{t.label}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-600">
      <span className="font-medium text-zinc-800">{value}</span> {label}
    </span>
  );
}

function PlotCard({
  plot,
  data,
  recommendation,
  onRefresh,
  fieldChoices,
}: {
  plot: Plot;
  data: FieldApiResponse;
  recommendation: PlotRecommendation;
  onRefresh: () => void;
  fieldChoices: Array<{ id: string; label: string }>;
}) {
  const [pinned, setPinned] = useState(false);
  const [notesVersion, setNotesVersion] = useState(0); // bumped when a voice note is saved or deleted
  const severity = data.stressEvent.severity;
  const ai = useAiRecommendation(data.stressEventId, notesVersion);

  const open = pinned; // CSS handles the hover-only preview; this forces it open once clicked

  return (
    <li
      className={`group overflow-hidden rounded-3xl border bg-white shadow-sm transition-all hover:shadow-md ${
        pinned ? "border-zinc-200" : "border-zinc-100"
      }`}
    >
      <button onClick={() => setPinned((p) => !p)} className="flex w-full items-start gap-3 p-4 text-left">
        <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT[severity]}`} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-serif text-lg text-zinc-900">{plot.details.name || plot.label}</div>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${SEVERITY_BADGE[severity]}`}>
          {badgeText(severity)}
        </span>
      </button>

      {/* Hover preview — always mounted (so useAiRecommendation fetches once
          up front and hovering feels instant), just visually collapsed via
          the CSS grid-rows animation trick until hovered or pinned open. */}
      <div
        className={`grid px-4 transition-[grid-template-rows] duration-300 ease-out ${
          open ? "grid-rows-[1fr] pb-4" : "grid-rows-[0fr] group-hover:grid-rows-[1fr] group-hover:pb-4"
        }`}
      >
        <div className="overflow-hidden">
          <div className="flex flex-col gap-2 border-t border-zinc-100 pt-3">
            <div className="flex flex-wrap gap-1.5">
              <StatPill label="of crop water need met by rain" value={`${Math.round(data.weather.waterRatio * 100)}%`} />
              <StatPill label="rain in 16d" value={`${Math.round(data.weather.forecastRain16)}mm`} />
              <StatPill label="hot days" value={String(data.weather.heatDays7)} />
              {recommendation.irrigationMm !== null && (
                <StatPill label="of irrigation to close the gap" value={`${recommendation.irrigationMm} mm`} />
              )}
            </div>
            {!pinned && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setPinned(true);
                }}
                className="self-start text-xs font-medium text-green-700 hover:text-green-800"
              >
                View full details →
              </button>
            )}
          </div>
        </div>
      </div>

      {pinned && (
        <div className="border-t border-zinc-100 bg-zinc-50 px-4 py-4">
          <div className="mb-3 flex justify-end">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRefresh();
              }}
              disabled={plot.status === "loading"}
              className="text-xs text-zinc-500 hover:text-zinc-800 disabled:opacity-50"
            >
              {plot.status === "loading" ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          {plot.status === "error" && (
            <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              Refresh failed: {plot.error} — showing the last-known reading below.
            </div>
          )}
          {data.usedFallback && (
            <div className="mb-4 rounded-2xl border border-zinc-200 bg-white p-3 text-sm text-zinc-700">
              Live Sentinel Hub request failed — showing cached sample imagery.
            </div>
          )}

          {recommendation.areaHectares < MIN_RELIABLE_HECTARES && (
            <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              This plot is only {formatArea(recommendation.areaHectares)}. Satellite pixels are 10 m across, so the
              greenness reading covers just a few of them and is a rough guide. Draw a larger area for a reliable one.
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="min-w-0">
              <div>
                <AiRecommendation
                  loading={ai.loading}
                  error={ai.error}
                  recommendation={ai.recommendation}
                  evidence={ai.evidence}
                />
              </div>

              {/* Same box, padding and header row as the AI take above, so the two Listen buttons line up */}
              <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50/50 p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold tracking-wide text-blue-800 uppercase">Recommended action</div>
                  <SpeakButton text={recommendation.actions.join(" ")} />
                </div>
                <ul className="flex flex-col gap-1.5">
                  {recommendation.actions.map((action, i) => (
                    <li key={i} className="rounded-xl border border-blue-100 bg-white p-2.5 text-sm text-blue-900">
                      {action}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="min-w-0">
              {data.observation.timeseries.length > 0 && (
                <div>
                  <div className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">
                    NDVI — week by week, last 90 days
                  </div>
                  <div className="mt-1 rounded-2xl border border-zinc-200 bg-white p-2">
                    <NdviChart data={data.observation.timeseries} />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Full width, under both columns, so opening it fills the card instead of leaving blank space beside it */}
          <div className="mt-2">
            <FieldNotes
              fieldId={plot.id}
              fieldLabel={plot.label}
              fieldChoices={fieldChoices}
              onNotesChanged={() => setNotesVersion((v) => v + 1)}
            />
          </div>

          <div className="mt-3 flex justify-center">
            <span className="text-xs text-zinc-400">
              {plot.label} · {formatArea(recommendation.areaHectares)}
            </span>
          </div>
        </div>
      )}
    </li>
  );
}

export default function ResultsPanel({ plots, onRefreshPlot }: { plots: Plot[]; onRefreshPlot: (id: string) => void }) {
  const readyPlots = plots.filter((p) => p.data !== null);
  const pendingPlots = plots.filter((p) => p.status === "loading" && !p.data);
  const errorPlots = plots.filter((p) => p.status === "error" && !p.data);
  const ranked = rankPlots(plots);
  const fieldChoices = plots.map((p) => ({ id: p.id, label: p.label })); // so a voice note can name a different field

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="h-full overflow-y-auto bg-[#f7f3ea] p-8">
      <header>
        <h1 className="font-serif text-3xl text-zinc-900">Results</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {today} · {plots.length} plot{plots.length === 1 ? "" : "s"} tracked
        </p>
      </header>

      <div className="mt-5">
        <SummaryTiles readyPlots={readyPlots} />
      </div>

      <div className="mt-6">
        {plots.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-zinc-300 bg-white p-10 text-center text-sm text-zinc-500">
            No plots yet. Draw a bounding box on the Field input tab to start tracking a field.
          </div>
        ) : (
          <ul className="flex flex-col gap-4">
            {ranked.map(({ plot, recommendation }) => (
              <PlotCard
                key={plot.id}
                plot={plot}
                data={plot.data!}
                recommendation={recommendation}
                onRefresh={() => onRefreshPlot(plot.id)}
                fieldChoices={fieldChoices}
              />
            ))}
          </ul>
        )}

        {(pendingPlots.length > 0 || errorPlots.length > 0) && (
          <ul className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
            {pendingPlots.map((plot) => (
              <li key={plot.id} className="rounded-2xl border border-zinc-200 bg-white p-3 text-sm text-zinc-500">
                {plot.label} — loading…
              </li>
            ))}
            {errorPlots.map((plot) => (
              <li key={plot.id} className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {plot.label} — {plot.error}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
