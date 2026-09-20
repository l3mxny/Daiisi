"use client";

import type { Plot } from "@/lib/types";
import type { NdviTrend, Severity } from "@/lib/stressEvent";

// All the plots side by side, most urgent first, so the differences and the reasons a plot needs action are
// visible at a glance. Read-only: it only reformats what each plot already loaded. In every column the worst
// value is shaded red and the best green (only when the plots actually differ), and the "Why" column lists
// the same signals that raise a plot's status in lib/stressEvent.ts.

const SEVERITY_BADGE: Record<Severity, string> = {
  ok: "bg-green-50 text-green-700",
  watch: "bg-amber-50 text-amber-700",
  act: "bg-rose-50 text-rose-700",
};
const SEVERITY_LABEL: Record<Severity, string> = { ok: "All good", watch: "Watch", act: "Act now" };
const TREND: Record<NdviTrend, { arrow: string; label: string }> = {
  declining: { arrow: "↓", label: "falling" },
  improving: { arrow: "↑", label: "rising" },
  stable: { arrow: "→", label: "steady" },
  unknown: { arrow: "?", label: "unknown" },
};

interface Row {
  plot: Plot;
  severity: Severity;
  soilWater: number; // 0-1+, share of the water lost that rain replaced
  rainVsNormal: number | null; // 0-1+, last 30 days as a share of the usual rain
  rainNext16: number; // mm
  heatDays: number;
  ndvi: number | null;
  trend: NdviTrend;
  daysSinceClear: number | null;
  why: string[];
}

// The tags shown for a plot are gated on the FINAL verdict (the status chip). A plot the rules call OK never
// shows a warning tag, because "All good" next to "Very little rain lately" reads as a contradiction; it shows
// what made it fine instead. Watch and Act plots show the signals pushing them up, using the same cut-offs as
// lib/stressEvent.ts.
export function whyFor(plot: Plot): string[] {
  const d = plot.data!;
  const sig = d.stressEvent.signature;
  const covered = d.weather.forecastRain16 >= d.weather.et030 - d.weather.rain30;

  if (d.stressEvent.severity === "ok") {
    const fine: string[] = [];
    if (sig.waterRatio < 0.75 && covered) fine.push("Forecast rain covers the gap");
    if (sig.ndviTrend === "improving") fine.push("Crop is greening up");
    return fine;
  }

  const why: string[] = [];
  if (sig.waterRatio < 0.4) why.push("Very little rain lately");
  else if (sig.waterRatio < 0.75) why.push("Rain is running short");
  if (sig.waterRatio < 0.75) {
    if (covered) why.push("Forecast rain should cover it");
    else if (d.weather.forecastRain16 < 10) why.push("Little rain coming");
  }
  if (sig.ndviTrend === "declining") why.push("Crop greenness is falling");
  if (sig.rainAnomalyRatio !== null && sig.rainAnomalyRatio < 0.5) why.push("Far less rain than usual");
  if (d.observation.daysSinceClear === null || d.observation.daysSinceClear > 14) why.push("Satellite view is old");
  return why;
}

function buildRow(plot: Plot): Row {
  const d = plot.data!;
  const sig = d.stressEvent.signature;
  return {
    plot,
    severity: d.stressEvent.severity,
    soilWater: d.weather.waterRatio,
    rainVsNormal: sig.rainAnomalyRatio,
    rainNext16: d.weather.forecastRain16,
    heatDays: d.weather.heatDays7,
    ndvi: d.observation.ndviValid ? d.observation.ndviMean : null,
    trend: sig.ndviTrend,
    daysSinceClear: d.observation.daysSinceClear,
    why: whyFor(plot),
  };
}

// "worst" / "best" / "" for one cell, given every plot's value in that column.
function rank(value: number | null, all: Array<number | null>, higherIsBetter: boolean): "worst" | "best" | "" {
  const nums = all.filter((v): v is number => v !== null);
  if (value === null || nums.length < 2) return "";
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  if (min === max) return "";
  const best = higherIsBetter ? max : min;
  const worst = higherIsBetter ? min : max;
  return value === worst ? "worst" : value === best ? "best" : "";
}
const CELL = { worst: "bg-rose-50 font-semibold text-rose-700", best: "bg-green-50 text-green-800", "": "" } as const;

const pct = (v: number) => `${Math.round(v * 100)}%`;

export default function PlotComparison({ plots }: { plots: Array<{ plot: Plot; priority: number }> }) {
  const rows = plots
    .filter(({ plot }) => plot.data !== null)
    .sort((a, b) => b.priority - a.priority)
    .map(({ plot }) => buildRow(plot));
  if (rows.length < 2) return null; // comparing needs at least two plots

  const col = (pick: (r: Row) => number | null) => rows.map(pick);
  const water = col((r) => r.soilWater);
  const normal = col((r) => r.rainVsNormal);
  const rain = col((r) => r.rainNext16);
  const heat = col((r) => r.heatDays);
  const ndvi = col((r) => r.ndvi);

  const th = "px-3 py-2 text-left text-[11px] font-semibold tracking-wide text-zinc-400 uppercase whitespace-nowrap";
  const td = "px-3 py-2.5 text-sm text-zinc-700 whitespace-nowrap";

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-serif text-xl text-zinc-900">Compare your plots</h2>
        <p className="text-xs text-zinc-500">
          <span className="rounded bg-rose-50 px-1.5 py-0.5 text-rose-700">worst</span>{" "}
          <span className="rounded bg-green-50 px-1.5 py-0.5 text-green-800">best</span> in each column
        </p>
      </div>
      <div className="overflow-x-auto rounded-3xl border border-zinc-100 bg-white shadow-sm">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-zinc-100">
              <th className={th}>Plot</th>
              <th className={th}>Status</th>
              <th className={th}>Rain vs crop need</th>
              <th className={th}>Rain vs usual</th>
              <th className={th}>Rain next 16d</th>
              <th className={th}>Hot days (7d)</th>
              <th className={th}>Crop greenness</th>
              <th className={th}>Why</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.plot.id} className="border-b border-zinc-50 last:border-0">
                <td className={`${td} font-serif text-base text-zinc-900`}>
                  <span translate="no">{r.plot.details.name || r.plot.label}</span>
                </td>
                <td className={td}>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${SEVERITY_BADGE[r.severity]}`}>
                    {SEVERITY_LABEL[r.severity]}
                  </span>
                </td>
                <td className={`${td} ${CELL[rank(r.soilWater, water, true)]}`}>
                  <div>{pct(r.soilWater)}</div>
                  <div className="mt-1 h-1 w-16 overflow-hidden rounded-full bg-zinc-200">
                    <div
                      className={`h-full rounded-full ${r.soilWater < 0.4 ? "bg-rose-400" : r.soilWater < 0.75 ? "bg-amber-400" : "bg-green-500"}`}
                      style={{ width: `${Math.min(100, Math.round(r.soilWater * 100))}%` }}
                    />
                  </div>
                </td>
                <td className={`${td} ${CELL[rank(r.rainVsNormal, normal, true)]}`}>
                  {r.rainVsNormal === null ? "n/a" : pct(r.rainVsNormal)}
                </td>
                <td className={`${td} ${CELL[rank(r.rainNext16, rain, true)]}`}>{Math.round(r.rainNext16)} mm</td>
                <td className={`${td} ${CELL[rank(r.heatDays, heat, false)]}`}>{r.heatDays}</td>
                <td className={`${td} ${CELL[rank(r.ndvi, ndvi, true)]}`}>
                  {r.ndvi === null ? "no clear view" : r.ndvi.toFixed(2)}{" "}
                  <span className="text-xs text-zinc-500">
                    {TREND[r.trend].arrow} {TREND[r.trend].label}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-xs text-zinc-600">
                  {r.why.length === 0 ? (
                    <span className="text-zinc-400">Nothing wrong</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {r.why.map((w) => (
                        <span key={w} className="rounded-full bg-zinc-100 px-2 py-0.5 whitespace-nowrap">
                          {w}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
