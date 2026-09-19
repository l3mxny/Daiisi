"use client";

import { useState } from "react";
import NdviChart from "./NdviChart";
import InterventionLogger from "./InterventionLogger";
import type { FieldApiResponse, Plot } from "@/lib/types";
import type { Severity } from "@/lib/stressEvent";
import { buildChangeSinceLastCheck, buildPlotRecommendation, type PlotRecommendation } from "@/lib/recommendations";

const SEVERITY_BORDER: Record<Severity, string> = {
  ok: "border-l-green-500",
  watch: "border-l-amber-500",
  act: "border-l-red-500",
};

const SEVERITY_RANK_TEXT: Record<Severity, string> = {
  ok: "text-green-700",
  watch: "text-amber-700",
  act: "text-red-700",
};

const SEVERITY_BADGE: Record<Severity, string> = {
  ok: "bg-green-100 text-green-800",
  watch: "bg-amber-100 text-amber-800",
  act: "bg-red-100 text-red-800",
};

function cardTitle(severity: Severity, actions: string[]): string {
  if (severity === "ok") return "Nothing to do";
  if (severity === "act") {
    return actions.some((a) => /irrigat|water/i.test(a)) ? "Water this field" : "Act on this field";
  }
  return "Walk this field and check it";
}

function badgeText(severity: Severity): string {
  if (severity === "act") return "ACT NOW";
  if (severity === "watch") return "WITHIN 3 DAYS";
  const next = new Date();
  next.setDate(next.getDate() + 7);
  return `NEXT CHECK ${next.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase()}`;
}

function statFor(recommendation: PlotRecommendation, data: FieldApiResponse): { value: string; sub: string } {
  if (recommendation.irrigationLiters !== null) {
    return { value: `${recommendation.irrigationLiters.toLocaleString()} L`, sub: "to close 30-day deficit" };
  }
  if (data.stressEvent.severity === "ok") {
    return { value: "Healthy", sub: `soil water ${Math.round(data.weather.waterRatio * 100)}%` };
  }
  return { value: `${Math.round(data.weather.waterRatio * 100)}%`, sub: "soil water" };
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

  const avgWaterPct = Math.round(
    (readyPlots.reduce((sum, p) => sum + p.data!.weather.waterRatio, 0) / n) * 100
  );
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
        <div key={t.label} className="rounded-lg border border-zinc-200 bg-white px-4 py-3">
          <div className="font-serif text-2xl text-zinc-900">{t.value}</div>
          <div className="text-xs text-zinc-500">{t.label}</div>
        </div>
      ))}
    </div>
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

function ResultCard({
  rank,
  plot,
  data,
  recommendation,
  expanded,
  onToggle,
  onRefresh,
}: {
  rank: number;
  plot: Plot;
  data: FieldApiResponse;
  recommendation: PlotRecommendation;
  expanded: boolean;
  onToggle: () => void;
  onRefresh: () => void;
}) {
  const severity = data.stressEvent.severity;
  const stat = statFor(recommendation, data);

  return (
    <li className={`overflow-hidden rounded-lg border border-l-4 bg-white shadow-sm ${SEVERITY_BORDER[severity]}`}>
      <button onClick={onToggle} className="flex w-full items-center gap-4 p-4 text-left">
        <span className={`w-6 shrink-0 font-serif text-2xl ${SEVERITY_RANK_TEXT[severity]}`}>{rank}</span>
        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md bg-zinc-100">
          <PlotThumbnail plot={plot} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-serif text-lg text-zinc-900">{cardTitle(severity, recommendation.actions)}</div>
          <div className="truncate text-sm text-zinc-500">
            {plot.label} · {recommendation.areaHectares.toFixed(1)} ha
          </div>
        </div>
        <div className="hidden shrink-0 text-right sm:block">
          <div className="font-serif text-xl text-zinc-900">{stat.value}</div>
          <div className="text-xs text-zinc-500">{stat.sub}</div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span className={`rounded px-2 py-1 text-[11px] font-semibold tracking-wide ${SEVERITY_BADGE[severity]}`}>
            {badgeText(severity)}
          </span>
          <span className="text-xs text-zinc-500">{expanded ? "Hide ▲" : "Why? ▼"}</span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-zinc-200 bg-zinc-50 px-4 py-4">
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
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              Refresh failed: {plot.error} — showing the last-known reading below.
            </div>
          )}

          {data.usedFallback && (
            <div className="mb-4 rounded-md border border-zinc-300 bg-white p-3 text-sm text-zinc-700">
              Live Sentinel Hub request failed — showing cached sample imagery.
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                What the satellite sees
              </div>
              <p className="mt-1 text-sm text-zinc-700">{recommendation.satelliteOutlook}</p>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Why it is happening</div>
              <p className="mt-1 text-sm text-zinc-700">{data.stressEvent.message}</p>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Last time</div>
              <p className="mt-1 text-sm text-zinc-700">
                {plot.previousData
                  ? buildChangeSinceLastCheck(plot.previousData, data)
                  : "No previous check yet this session."}
              </p>
            </div>
          </div>

          <div className="mt-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Recommended action</div>
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {recommendation.actions.map((action, i) => (
                <li key={i} className="rounded-md border border-blue-200 bg-blue-50 p-2 text-sm text-blue-900">
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
              <div className="text-xs font-semibold uppercase tracking-wide text-zinc-400">NDVI — last 90 days</div>
              <div className="mt-1 rounded-md border border-zinc-200 bg-white p-2">
                <NdviChart data={data.observation.timeseries} />
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export default function ResultsPanel({
  plots,
  onRefreshPlot,
}: {
  plots: Plot[];
  onRefreshPlot: (id: string) => void;
}) {
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  const readyPlots = plots.filter((p) => p.data !== null);
  const pendingPlots = plots.filter((p) => p.status === "loading" && !p.data);
  const errorPlots = plots.filter((p) => p.status === "error" && !p.data);
  const ranked = rankPlots(plots);

  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="h-full overflow-y-auto p-8">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="font-serif text-3xl text-zinc-900">Results</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {today} · {plots.length} plot{plots.length === 1 ? "" : "s"} tracked
          </p>
        </div>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-green-700 text-xs font-semibold text-white">
          VX
        </div>
      </header>

      <div className="mt-5">
        <SummaryTiles readyPlots={readyPlots} />
      </div>

      <div className="mt-6">
        {plots.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-500">
            No plots yet. Draw a bounding box on the Field input tab to start tracking a field.
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {ranked.map(({ plot, recommendation }, i) => (
              <ResultCard
                key={plot.id}
                rank={i + 1}
                plot={plot}
                data={plot.data!}
                recommendation={recommendation}
                expanded={overrides[plot.id] ?? i === 0}
                onToggle={() => setOverrides((o) => ({ ...o, [plot.id]: !(o[plot.id] ?? i === 0) }))}
                onRefresh={() => onRefreshPlot(plot.id)}
              />
            ))}
          </ul>
        )}

        {(pendingPlots.length > 0 || errorPlots.length > 0) && (
          <ul className="mt-3 flex flex-col gap-2">
            {pendingPlots.map((plot) => (
              <li key={plot.id} className="rounded-lg border border-zinc-200 bg-white p-3 text-sm text-zinc-500">
                {plot.label} — loading…
              </li>
            ))}
            {errorPlots.map((plot) => (
              <li key={plot.id} className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {plot.label} — {plot.error}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
