"use client";

import dynamic from "next/dynamic";
import LocationSearchBar from "./LocationSearchBar";
import MapModeControls, { type MapMode } from "./MapModeControls";
import FieldSidebar, { type FieldDetailsPatch } from "./FieldSidebar";
import type { FlyTarget } from "./FieldMap";
import type { Bbox } from "@/lib/geo";
import type { Plot } from "@/lib/types";

const FieldMap = dynamic(() => import("./FieldMap"), { ssr: false });

const CENTRAL_VALLEY_CENTER: [number, number] = [36.7378, -119.7871];

export default function FieldInputPanel({
  plots,
  selectedPlotId,
  ndviOpacity,
  mapMode,
  flyTo,
  locating,
  locationError,
  onFlyToHandled,
  onNdviOpacityChange,
  onSelectPlot,
  onMapModeChange,
  onDrawComplete,
  onBboxEdit,
  onFindLocation,
  onSelectSearchLocation,
  onNewField,
  onUpdateDetails,
  onSaveField,
  onRemovePlot,
}: {
  plots: Plot[];
  selectedPlotId: string | null;
  ndviOpacity: number;
  mapMode: MapMode;
  flyTo: FlyTarget | null;
  locating: boolean;
  locationError: string | null;
  onFlyToHandled: () => void;
  onNdviOpacityChange: (v: number) => void;
  onSelectPlot: (id: string) => void;
  onMapModeChange: (mode: MapMode) => void;
  onDrawComplete: (bbox: Bbox) => void;
  onBboxEdit: (id: string, bbox: Bbox) => void;
  onFindLocation: () => void;
  onSelectSearchLocation: (loc: { lat: number; lng: number; zoom?: number }) => void;
  onNewField: () => void;
  onUpdateDetails: (id: string, patch: FieldDetailsPatch) => void;
  onSaveField: (id: string) => void;
  onRemovePlot: (id: string) => void;
}) {
  const selectedPlot = plots.find((p) => p.id === selectedPlotId) ?? null;
  const draft = plots.find((p) => !p.saved) ?? null;
  const hasDraft = draft !== null;

  // Picking a saved field in the list also takes the map there, zoomed so the field fills a good part of the view.
  function focusPlot(id: string) {
    onSelectPlot(id);
    const plot = plots.find((p) => p.id === id);
    if (!plot) return;
    const [west, south, east, north] = plot.bbox;
    const span = Math.max(east - west, north - south, 1e-5);
    const zoom = Math.max(5, Math.min(18, Math.round(Math.log2(371 / span))));
    onSelectSearchLocation({ lat: (south + north) / 2, lng: (west + east) / 2, zoom });
  }

  return (
    <div className="flex h-full w-full gap-6 overflow-y-auto bg-cream p-8 font-[family-name:var(--font-mono-ui)]">
      {/* Middle: the map */}
      <div className="flex min-w-0 flex-1 flex-col">
        <h1 className="font-[family-name:var(--font-display)] text-4xl leading-tight font-extrabold tracking-tight text-olive uppercase">
          Mark your fields on the map
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-olive/80">
          Drag across the map to draw each plot. Rough estimates are fine, you can always readjust later.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onFindLocation}
            className="flex items-center gap-2 border border-olive bg-white px-4 py-2.5 text-xs font-semibold tracking-wide text-olive uppercase shadow-sm transition-colors hover:bg-lime/30"
          >
            <PinIcon />
            {locating ? "Finding you…" : "Find my location"}
          </button>
          <button
            type="button"
            onClick={onNewField}
            className="flex items-center gap-2 bg-olive px-5 py-2.5 text-xs font-semibold tracking-wide text-white uppercase shadow-sm transition-colors hover:bg-olive-soft"
          >
            <span className="text-base leading-none">+</span>
            Plot new field
          </button>
          {locationError && <p className="text-xs text-red-600">{locationError}</p>}
        </div>

        <div className="relative mt-5 min-h-[24rem] flex-1 overflow-hidden border border-olive/10 shadow-sm">
          <FieldMap
            plots={plots}
            selectedPlotId={selectedPlotId}
            ndviOpacity={ndviOpacity}
            mode={mapMode}
            initialCenter={CENTRAL_VALLEY_CENTER}
            flyTo={flyTo}
            onFlyToHandled={onFlyToHandled}
            onSelectPlot={onSelectPlot}
            onDrawComplete={onDrawComplete}
            onBboxEdit={onBboxEdit}
            onDiscardDraft={onRemovePlot}
          />

          <div className="absolute top-3 left-14 z-[1000] w-64">
            <LocationSearchBar onSelectLocation={onSelectSearchLocation} />
          </div>

          <MapModeControls
            mode={mapMode}
            onChange={onMapModeChange}
            canErase={hasDraft}
            onErase={() => draft && onRemovePlot(draft.id)}
          />

          {mapMode === "draw" && (
            <div className="pointer-events-none absolute bottom-3 left-3 z-[1000] flex max-w-sm items-start gap-2.5 bg-[#1b1b1b]/95 px-4 py-3 text-xs leading-snug text-white shadow-md">
              <span aria-hidden="true">☞</span>
              <span>
                {hasDraft
                  ? "Drag an edge to resize this field, or the middle to move it. Erase (top right) starts over."
                  : "Drag across the map to draw a field."}
              </span>
            </div>
          )}

          {selectedPlot?.data?.observation.ndviImage && (
            <div className="absolute right-3 bottom-3 z-[1000] w-56 bg-white/95 p-3 shadow-md">
              <label className="mb-1 flex justify-between text-xs text-zinc-500">
                <span>NDVI overlay</span>
                <span>{Math.round(ndviOpacity * 100)}%</span>
              </label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={ndviOpacity}
                onChange={(e) => onNdviOpacityChange(Number(e.target.value))}
                className="w-full accent-olive"
              />
            </div>
          )}
        </div>
      </div>

      {/* Right: field details and saved fields */}
      <FieldSidebar
        plots={plots}
        selectedPlotId={selectedPlotId}
        onSelectPlot={focusPlot}
        onRemovePlot={onRemovePlot}
        onUpdateDetails={onUpdateDetails}
        onSaveField={onSaveField}
      />
    </div>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 14.5s4.5-4 4.5-7.5a4.5 4.5 0 0 0-9 0c0 3.5 4.5 7.5 4.5 7.5z" />
      <circle cx="8" cy="7" r="1.6" />
    </svg>
  );
}
