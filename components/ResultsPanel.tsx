"use client";

import { useState } from "react";
import NdviChart from "./NdviChart";
import InterventionLogger from "./InterventionLogger";
import AiRecommendation from "./AiRecommendation";
import { useAiRecommendation, firstLine } from "@/lib/ai/useAiRecommendation";
import type { FieldApiResponse, Plot } from "@/lib/types";
import type { Severity } from "@/lib/stressEvent";
import type { SeasonalOutlook } from "@/lib/seasonalOutlook";
import { buildChangeSinceLastCheck, buildPlotRecommendation, type PlotRecommendation } from "@/lib/recommendations";

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

function cardTitle(severity: Severity, actions: string[]): string {
  if (severity === "ok") return "Nothing to do";
  if (severity === "act") {
    return actions.some((a) => /irrigat|water/i.test(a)) ? "Water this field" : "Act on this field";
  }
  return "Walk this field and check it";
}

function describeSeasonalOutlook(outlook: SeasonalOutlook | null): string | null {
  if (!outlook || (outlook.precipLean === "near_normal" && outlook.tempLean === "near_normal")) return null;
  const parts: string[] = [];
  if (outlook.precipLean !== "near_normal") {
    parts.push(`${outlook.precipLean} than normal rainfall (${Math.round(outlook.precipConfidence * 100)}% confidence)`);
  }
  if (outlook.tempLean !== "near_normal") {
    parts.push(`${outlook.tempLean} than normal temperatures (${Math.round(outlook.tempConfidence * 100)}% confidence)`);
  }
  return `Next ${outlook.windowDays} days: ${parts.join(", ")}.`;
}

// Includes plots currently re-fetching (status "loading" but still holding
// their last-known-good data) so a refresh doesn't yank the card out from
// under the farmer mid-read — only plots with no data yet drop out.
function rankPlots(plots: Plot[]): Array<{ plot: Plot; recommendation: PlotRecommendation }> {
  return plots
    .filter((p) => p.data !== null)
    .map((plot) => ({ plot, recommendation: buildPlotRecommendation(plot.data!) }))
    .sort((a, b) => b.recommendation.priorityScore - a.recommendation.priorityScore);
}

function SummaryTiles({ readyPlots }: { readyPlots: Plot[] }) {
  const n = readyPlots.length;
  if (n === 0) return null;

  const avgWaterPct = Math.round((readyPlots.reduce((sum, p) => sum + p.data!.weather.waterRatio, 0) / n) * 100);
  const avgForecastRain = Math.round(readyPlots.reduce((sum, p) => sum + p.data!.weather.forecastRain16, 0) / n);
  const maxHeatDays = Math.max(...readyPlots.map((p) => p.data!.weather.heatDays7));
  const needAttention = readyPlots.filter((p) => p.data!.stressEvent.severity !== "ok").length;

  const tiles = [
    { label: "Water in the soil", value: `${avgWaterPct}%` },
    { label: "Rain in 16 days", value: `${avgForecastRain} mm` },
    { label: "Heat days (7d, >32°C)", value: String(maxHeatDays) },
    { label: "Fields need you", value: `${needAttention} of ${n}` },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-2xl border border-zinc-100 bg-white px-4 py-3 shadow-sm">
          <div className="font-serif text-2xl text-zinc-900">{t.value}</div>
          <div className="text-xs text-zinc-500">{t.label}</div>
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

function PlotThumbnail({ plot }: { plot: Plot }) {
  const image = plot.data?.observation.trueColorImage;
  if (image) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={image} alt={`${plot.label} satellite view`} className="h-full w-full object-cover" />;
  }
  return <div className="h-full w-full" style={{ backgroundColor: plot.color, opacity: 0.5 }} />;
}

function PlotCard({
  plot,
  data,
  recommendation,
  onRefresh,
}: {
  plot: Plot;
  data: FieldApiResponse;
  recommendation: PlotRecommendation;
  onRefresh: () => void;
}) {
  const [pinned, setPinned] = useState(false);
  const severity = data.stressEvent.severity;
  const seasonalNote = describeSeasonalOutlook(data.seasonalOutlook);
  const ai = useAiRecommendation(data.stressEventId);

  const headline = ai.recommendation ? firstLine(ai.recommendation) : cardTitle(severity, recommendation.actions);
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
          <div className="truncate text-sm text-zinc-500">{headline}</div>
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
            <p className="text-sm text-zinc-600">
              {ai.loading ? "Thinking it through…" : ai.recommendation || data.stressEvent.message}
            </p>
            <div className="flex flex-wrap gap-1.5">
              <StatPill label="soil water" value={`${Math.round(data.weather.waterRatio * 100)}%`} />
              <StatPill label="rain in 16d" value={`${Math.round(data.weather.forecastRain16)}mm`} />
              <StatPill label="hot days" value={String(data.weather.heatDays7)} />
              {recommendation.irrigationLiters !== null && (
                <StatPill label="to close deficit" value={`${recommendation.irrigationLiters.toLocaleString()}L`} />
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

          <div className="h-40 w-full overflow-hidden rounded-2xl bg-zinc-100">
            <PlotThumbnail plot={plot} />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <div className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">What the satellite sees</div>
              <p className="mt-1 text-sm text-zinc-700">{recommendation.satelliteOutlook}</p>
            </div>
            <div>
              <div className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">Why it is happening</div>
              <p className="mt-1 text-sm text-zinc-700">{data.stressEvent.message}</p>
            </div>
            <div>
              <div className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">Last time</div>
              <p className="mt-1 text-sm text-zinc-700">
                {plot.previousData ? buildChangeSinceLastCheck(plot.previousData, data) : "No previous check yet this session."}
              </p>
            </div>
          </div>

          {seasonalNote && (
            <p className="mt-3 rounded-2xl border border-amber-100 bg-amber-50 p-3 text-xs text-amber-900">{seasonalNote}</p>
          )}

          <div className="mt-4">
            <AiRecommendation
              loading={ai.loading}
              error={ai.error}
              recommendation={ai.recommendation}
              evidence={ai.evidence}
            />
          </div>

          <div className="mt-4">
            <div className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">Recommended action</div>
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {recommendation.actions.map((action, i) => (
                <li key={i} className="rounded-2xl border border-blue-100 bg-blue-50 p-2.5 text-sm text-blue-900">
                  {action}
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-4">
            <InterventionLogger stressEventId={data.stressEventId} />
          </div>

          {data.observation.timeseries.length > 0 && (
            <div className="mt-4">
              <div className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">NDVI — last 90 days</div>
              <div className="mt-1 rounded-2xl border border-zinc-200 bg-white p-2">
                <NdviChart data={data.observation.timeseries} />
              </div>
            </div>
          )}

          <div className="mt-3 flex justify-center">
            <span className="text-xs text-zinc-400">{plot.label} · {recommendation.areaHectares.toFixed(1)} ha</span>
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

  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

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
          <ul className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
            {ranked.map(({ plot, recommendation }) => (
              <PlotCard key={plot.id} plot={plot} data={plot.data!} recommendation={recommendation} onRefresh={() => onRefreshPlot(plot.id)} />
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
