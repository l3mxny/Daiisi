"use client";

import dynamic from "next/dynamic";
import type { Bbox } from "@/lib/geo";
import type { Plot } from "@/lib/types";

const FieldMap = dynamic(() => import("./FieldMap"), { ssr: false });

export default function FieldInputPanel({
  plots,
  selectedPlotId,
  ndviOpacity,
  onNdviOpacityChange,
  onSelectPlot,
  onDrawComplete,
  onRemovePlot,
  onClearAll,
}: {
  plots: Plot[];
  selectedPlotId: string | null;
  ndviOpacity: number;
  onNdviOpacityChange: (v: number) => void;
  onSelectPlot: (id: string) => void;
  onDrawComplete: (bbox: Bbox) => void;
  onRemovePlot: (id: string) => void;
  onClearAll: () => void;
}) {
  const selectedPlot = plots.find((p) => p.id === selectedPlotId) ?? null;

  return (
    <div className="flex h-full w-full">
      <div className="relative flex-1">
        <FieldMap
          plots={plots}
          selectedPlotId={selectedPlotId}
          ndviOpacity={ndviOpacity}
          onSelectPlot={onSelectPlot}
          onDrawComplete={onDrawComplete}
        />
        <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-white/90 px-3 py-2 text-xs text-zinc-600 shadow">
          Drag on the map to draw a plot (click for a small default plot). Click an existing plot to select it.
        </div>
      </div>

      <aside className="flex h-full w-72 shrink-0 flex-col gap-3 overflow-y-auto border-l border-zinc-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-zinc-500">Plots ({plots.length})</h2>
          {plots.length > 0 && (
            <button onClick={onClearAll} className="text-xs text-zinc-400 hover:text-red-600">
              Clear all
            </button>
          )}
        </div>

        {plots.length === 0 ? (
          <p className="text-sm text-zinc-500">Draw a bounding box on the map to add a plot.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {plots.map((plot) => (
              <li key={plot.id}>
                <button
                  onClick={() => onSelectPlot(plot.id)}
                  className={`flex w-full items-center gap-2 rounded-md border p-2 text-left text-sm transition-colors ${
                    plot.id === selectedPlotId ? "border-zinc-400 bg-zinc-100" : "border-zinc-200 hover:bg-zinc-50"
                  }`}
                >
                  <span
                    className="h-3 w-3 shrink-0 rounded-sm border border-black/10"
                    style={{ backgroundColor: plot.color }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{plot.label}</span>
                    <span className="block truncate text-xs text-zinc-500">
                      {plot.status === "loading" && "Loading…"}
                      {plot.status === "error" && <span className="text-red-600">{plot.error}</span>}
                      {plot.status === "ready" && "Ready — see Results tab"}
                    </span>
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemovePlot(plot.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.stopPropagation();
                        onRemovePlot(plot.id);
                      }
                    }}
                    className="shrink-0 rounded px-1 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700"
                    aria-label={`Remove ${plot.label}`}
                  >
                    ×
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {selectedPlot?.data?.observation.ndviImage && (
          <div className="border-t border-zinc-200 pt-3">
            <label className="mb-1 flex justify-between text-xs text-zinc-500">
              <span>NDVI overlay opacity</span>
              <span>{Math.round(ndviOpacity * 100)}%</span>
            </label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={ndviOpacity}
              onChange={(e) => onNdviOpacityChange(Number(e.target.value))}
              className="w-full"
            />
          </div>
        )}
      </aside>
    </div>
  );
}
