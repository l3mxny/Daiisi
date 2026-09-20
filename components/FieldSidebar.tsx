"use client";

import { useState } from "react";
import { bboxAreaHectares, formatArea } from "@/lib/geo";
import type { Plot, SoilType } from "@/lib/types";

export interface FieldDetailsPatch {
  name?: string;
  crop?: string;
  plantedOn?: string | null;
  soilType?: SoilType | null;
}

const CROPS = ["Maize", "Beans", "Kale"];
const SOILS: SoilType[] = ["Clay", "Loam", "Sandy"];

export default function FieldSidebar({
  plots,
  selectedPlotId,
  locating,
  locationError,
  onFindLocation,
  onNewField,
  onSelectPlot,
  onRemovePlot,
  onUpdateDetails,
  onSaveField,
}: {
  plots: Plot[];
  selectedPlotId: string | null;
  locating: boolean;
  locationError: string | null;
  onFindLocation: () => void;
  onNewField: () => void;
  onSelectPlot: (id: string) => void;
  onRemovePlot: (id: string) => void;
  onUpdateDetails: (id: string, patch: FieldDetailsPatch) => void;
  onSaveField: (id: string) => void;
}) {
  const [otherOpen, setOtherOpen] = useState<Record<string, boolean>>({});

  const draft = plots.find((p) => p.id === selectedPlotId && !p.saved) ?? null;
  const savedFields = plots.filter((p) => p.saved);
  const totalHa = savedFields.reduce((sum, p) => sum + bboxAreaHectares(p.bbox), 0);

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col gap-5 overflow-y-auto border-l border-zinc-100 bg-white p-5">
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={onFindLocation}
          className="flex items-center justify-center gap-2 rounded-full border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-600 shadow-sm transition-colors hover:border-green-300 hover:bg-green-50"
        >
          <LocationIcon />
          {locating ? "Finding you…" : "Find my location"}
        </button>
        {locationError && <p className="px-1 text-xs text-red-600">{locationError}</p>}
        <button
          type="button"
          onClick={onNewField}
          className="flex items-center justify-center gap-2 rounded-full bg-green-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-green-700"
        >
          + New field
        </button>
      </div>

      {draft && (
        <div className="flex flex-col gap-4 rounded-2xl border border-green-100 bg-green-50/60 p-4">
          <h2 className="text-xs font-semibold tracking-wide text-green-800 uppercase">Field details</h2>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm text-zinc-600">What do you call this field?</span>
            <input
              value={draft.details.name}
              onChange={(e) => onUpdateDetails(draft.id, { name: e.target.value })}
              placeholder="e.g. North field"
              className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 outline-none focus:border-green-400"
            />
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm text-zinc-600">What is planted here?</span>
            <div className="flex flex-wrap gap-2">
              {CROPS.map((crop) => (
                <button
                  key={crop}
                  type="button"
                  onClick={() => {
                    setOtherOpen((o) => ({ ...o, [draft.id]: false }));
                    onUpdateDetails(draft.id, { crop });
                  }}
                  className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                    draft.details.crop === crop
                      ? "border-green-600 bg-green-600 text-white"
                      : "border-zinc-200 bg-white text-zinc-600 hover:border-green-300"
                  }`}
                >
                  {crop}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setOtherOpen((o) => ({ ...o, [draft.id]: true }))}
                className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                  otherOpen[draft.id] || (draft.details.crop !== "" && !CROPS.includes(draft.details.crop))
                    ? "border-green-600 bg-green-600 text-white"
                    : "border-dashed border-zinc-300 text-zinc-500 hover:bg-zinc-50"
                }`}
              >
                + Other
              </button>
            </div>
            {(otherOpen[draft.id] || (draft.details.crop !== "" && !CROPS.includes(draft.details.crop))) && (
              <input
                value={CROPS.includes(draft.details.crop) ? "" : draft.details.crop}
                onChange={(e) => onUpdateDetails(draft.id, { crop: e.target.value })}
                placeholder="Name the crop"
                className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 outline-none focus:border-green-400"
              />
            )}
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm text-zinc-600">When did you plant?</span>
            <input
              type="date"
              value={draft.details.plantedOn ?? ""}
              onChange={(e) => onUpdateDetails(draft.id, { plantedOn: e.target.value || null })}
              className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 outline-none focus:border-green-400"
            />
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm text-zinc-600">Soil</span>
            <div className="flex flex-wrap gap-2">
              {SOILS.map((soil) => (
                <button
                  key={soil}
                  type="button"
                  onClick={() => onUpdateDetails(draft.id, { soilType: soil })}
                  className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                    draft.details.soilType === soil
                      ? "border-green-600 bg-green-600 text-white"
                      : "border-zinc-200 bg-white text-zinc-600 hover:border-green-300"
                  }`}
                >
                  {soil}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            disabled={!draft.details.name.trim()}
            onClick={() => onSaveField(draft.id)}
            className="mt-1 rounded-full bg-green-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
          >
            Save this field
          </button>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">Saved fields</h2>
        {savedFields.length === 0 ? (
          <p className="text-sm text-zinc-400">No fields saved yet.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {savedFields.map((plot) => (
              <li key={plot.id}>
                <button
                  type="button"
                  onClick={() => onSelectPlot(plot.id)}
                  className={`group flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors ${
                    plot.id === selectedPlotId ? "border-green-300 bg-green-50" : "border-zinc-100 hover:bg-zinc-50"
                  }`}
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: plot.color }} />
                  <span className="min-w-0 flex-1 truncate font-medium text-zinc-700">
                    {plot.details.name || plot.label}
                  </span>
                  <span className="shrink-0 text-xs text-zinc-400">{formatArea(bboxAreaHectares(plot.bbox))}</span>
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
                    className="shrink-0 rounded-full px-1.5 text-zinc-300 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-zinc-200 hover:text-zinc-600"
                    aria-label={`Remove ${plot.details.name || plot.label}`}
                  >
                    ×
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {savedFields.length > 0 && (
          <div className="mt-1 flex items-center justify-between rounded-xl bg-zinc-50 px-3 py-2 text-sm">
            <span className="font-medium text-zinc-500">Total</span>
            <span className="font-semibold text-zinc-700">{formatArea(totalHa)}</span>
          </div>
        )}
      </div>
    </aside>
  );
}

function LocationIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2" strokeLinecap="round" />
    </svg>
  );
}
