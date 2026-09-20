"use client";

import { useState, type ReactNode } from "react";
import { bboxAreaHectares, formatArea } from "@/lib/geo";
import type { Plot, SoilType } from "@/lib/types";

export interface FieldDetailsPatch {
  name?: string;
  crop?: string;
  plantedOn?: string | null;
  soilType?: SoilType | null;
}

const CROPS = ["Maize", "Coffee", "Potato", "Yams"];
const SOILS: SoilType[] = ["Clay", "Loam", "Sandy"];

const icon = { viewBox: "0 0 20 20", className: "h-4 w-4 shrink-0", fill: "none", stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const CROP_ICONS: Record<string, ReactNode> = {
  Maize: (
    <svg {...icon}>
      <path d="M10 18V9M10 9c-3 0-4-3-3.5-6C9 3 10 6 10 9zM10 9c3 0 4-3 3.5-6C11 3 10 6 10 9zM10 13c-2.5 0-3.5-2-3-4 2 0 3 2 3 4zM10 13c2.5 0 3.5-2 3-4-2 0-3 2-3 4z" />
    </svg>
  ),
  Coffee: (
    <svg {...icon}>
      <ellipse cx="10" cy="10" rx="5" ry="7" />
      <path d="M10 3c-2 3 2 5 0 8s2 4 0 6" />
    </svg>
  ),
  Potato: (
    <svg {...icon}>
      <path d="M4 11c0-4 3-7 7-7 3 0 5 2 5 5 0 4-3 7-7 7-3 0-5-2-5-5z" />
      <path d="M8 9h.01M12 12h.01M10 14h.01" />
    </svg>
  ),
  Yams: (
    <svg {...icon}>
      <path d="M3 13c0-3 4-6 9-6 3 0 5 1 5 3 0 3-4 6-9 6-3 0-5-1-5-3z" />
      <path d="M6 12l2-1M10 13l2-1" />
    </svg>
  ),
};
const SOIL_ICONS: Record<SoilType, ReactNode> = {
  Clay: (
    <svg {...icon}>
      <path d="M3 8c2-2 4-2 7 0s5 2 7 0M3 13c2-2 4-2 7 0s5 2 7 0" />
    </svg>
  ),
  Loam: (
    <svg {...icon}>
      <path d="M3 15c2-2 4-3 7-3s5 1 7 3M6 9.5c1-1 2-1.5 4-1.5s3 .5 4 1.5M10 3v3" />
    </svg>
  ),
  Sandy: (
    <svg {...icon}>
      <path d="M2.5 15c2.5-4 4.5-6 7.5-6s5 2 7.5 6z" />
    </svg>
  ),
};

const chip = "flex items-center gap-1.5 border px-2.5 py-1.5 text-[11px] font-medium tracking-wide uppercase transition-colors";
const chipOn = "border-coral bg-coral text-white";
const chipOff = "border-zinc-200 bg-white text-olive hover:border-olive/50";
const input = "w-full border border-zinc-200 bg-zinc-100/70 px-3 py-2 text-xs text-olive outline-none placeholder:text-zinc-400 focus:border-olive";

// Right-hand column of the field screen: the details form for the field being drawn, and the saved fields.
export default function FieldSidebar({
  plots,
  selectedPlotId,
  onSelectPlot,
  onRemovePlot,
  onUpdateDetails,
  onSaveField,
}: {
  plots: Plot[];
  selectedPlotId: string | null;
  onSelectPlot: (id: string) => void;
  onRemovePlot: (id: string) => void;
  onUpdateDetails: (id: string, patch: FieldDetailsPatch) => void;
  onSaveField: (id: string) => void;
}) {
  const [otherOpen, setOtherOpen] = useState<Record<string, boolean>>({});

  const draft = plots.find((p) => p.id === selectedPlotId && !p.saved) ?? null;
  const savedFields = plots.filter((p) => p.saved);
  const totalHa = savedFields.reduce((sum, p) => sum + bboxAreaHectares(p.bbox), 0);
  const customCrop = draft !== null && draft.details.crop !== "" && !CROPS.includes(draft.details.crop);

  return (
    <aside className="flex w-80 shrink-0 flex-col gap-5 self-start">
      {draft ? (
        <div className="border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <h2 className="inline-block border-b border-olive pb-1 font-[family-name:var(--font-display)] text-sm font-bold tracking-wide text-olive uppercase">
              Field details
            </h2>
            <button
              type="button"
              onClick={() => onRemovePlot(draft.id)}
              aria-label="Discard this field"
              title="Discard this field"
              className="text-lg leading-none text-olive/70 hover:text-olive"
            >
              ×
            </button>
          </div>

          <div className="mt-4 flex flex-col gap-5">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-olive">What do you want to call this field?</span>
              <input
                value={draft.details.name}
                onChange={(e) => onUpdateDetails(draft.id, { name: e.target.value })}
                placeholder="e.g. Njoro strip"
                className={input}
              />
            </label>

            <div className="flex flex-col gap-2">
              <span className="text-xs text-olive">What is planted here?</span>
              <div className="flex flex-wrap gap-2">
                {CROPS.map((crop) => (
                  <button
                    key={crop}
                    type="button"
                    onClick={() => {
                      setOtherOpen((o) => ({ ...o, [draft.id]: false }));
                      onUpdateDetails(draft.id, { crop });
                    }}
                    className={`${chip} ${draft.details.crop === crop ? chipOn : chipOff}`}
                  >
                    {CROP_ICONS[crop]}
                    {crop}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setOtherOpen((o) => ({ ...o, [draft.id]: true }))}
                  className={`${chip} ${otherOpen[draft.id] || customCrop ? chipOn : chipOff}`}
                >
                  <span className="text-sm leading-none">+</span>
                  Other
                </button>
              </div>
              {(otherOpen[draft.id] || customCrop) && (
                <input
                  value={CROPS.includes(draft.details.crop) ? "" : draft.details.crop}
                  onChange={(e) => onUpdateDetails(draft.id, { crop: e.target.value })}
                  placeholder="Name the crop"
                  className={input}
                />
              )}
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-olive">When did you plant?</span>
              <input
                type="date"
                value={draft.details.plantedOn ?? ""}
                onChange={(e) => onUpdateDetails(draft.id, { plantedOn: e.target.value || null })}
                className={input}
              />
            </label>

            <div className="flex flex-col gap-2">
              <span className="text-xs text-olive">Soil type</span>
              <div className="flex flex-wrap gap-2">
                {SOILS.map((soil) => (
                  <button
                    key={soil}
                    type="button"
                    onClick={() => onUpdateDetails(draft.id, { soilType: soil })}
                    className={`${chip} ${draft.details.soilType === soil ? chipOn : chipOff}`}
                  >
                    {SOIL_ICONS[soil]}
                    {soil}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              disabled={!draft.details.name.trim()}
              onClick={() => onSaveField(draft.id)}
              className="mx-auto mt-1 bg-olive px-8 py-2.5 text-xs font-semibold tracking-wide text-white uppercase shadow-sm transition-colors hover:bg-olive-soft disabled:cursor-not-allowed disabled:bg-zinc-300"
            >
              Save this field
            </button>
          </div>
        </div>
      ) : (
        <div className="border border-dashed border-olive/30 bg-white/60 p-5 text-xs leading-relaxed text-olive/70">
          Press <span className="font-semibold">Plot new field</span>, then drag across the map. You will name the field
          and say what is planted here.
        </div>
      )}

      <div className="border border-olive bg-white p-5 shadow-sm">
        <h2 className="inline-block border-b border-olive pb-1 font-[family-name:var(--font-display)] text-sm font-bold tracking-wide text-olive uppercase">
          Saved fields
        </h2>
        {savedFields.length === 0 ? (
          <p className="mt-4 text-xs text-zinc-400">No fields saved yet.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-1">
            {savedFields.map((plot) => (
              <li key={plot.id}>
                <div
                  className={`group flex items-center gap-2.5 px-1.5 py-1.5 text-xs ${
                    plot.id === selectedPlotId ? "bg-lime/30" : "hover:bg-zinc-50"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelectPlot(plot.id)}
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                  >
                    <span className="h-3 w-3 shrink-0" style={{ backgroundColor: plot.color }} />
                    <span className="min-w-0 flex-1 truncate text-olive">{plot.details.name || plot.label}</span>
                    <span className="shrink-0 text-zinc-400">{formatArea(bboxAreaHectares(plot.bbox))}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemovePlot(plot.id)}
                    className="shrink-0 px-1 text-zinc-300 opacity-0 transition-opacity group-hover:opacity-100 hover:text-coral"
                    aria-label={`Remove ${plot.details.name || plot.label}`}
                  >
                    ×
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {savedFields.length > 0 && (
          <div className="mt-4 flex items-center justify-between border-t border-olive/60 pt-3 text-xs">
            <span className="font-semibold tracking-wide text-olive uppercase">Total</span>
            <span className="font-semibold text-olive">{formatArea(totalHa)}</span>
          </div>
        )}
      </div>
    </aside>
  );
}
