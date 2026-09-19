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
  onSelectSearchLocation: (loc: { lat: number; lng: number }) => void;
  onNewField: () => void;
  onUpdateDetails: (id: string, patch: FieldDetailsPatch) => void;
  onSaveField: (id: string) => void;
  onRemovePlot: (id: string) => void;
}) {
  const selectedPlot = plots.find((p) => p.id === selectedPlotId) ?? null;
  const hasDraft = plots.some((p) => !p.saved);

  return (
    <div className="flex h-full w-full">
      <div className="relative flex-1">
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

        <div className="absolute left-3 top-3 z-[1000] w-72">
          <LocationSearchBar onSelectLocation={onSelectSearchLocation} />
        </div>

        <MapModeControls mode={mapMode} onChange={onMapModeChange} />

        {mapMode === "draw" && (
          <div className="pointer-events-none absolute bottom-3 left-1/2 z-[1000] -translate-x-1/2 rounded-full bg-white/95 px-4 py-2 text-xs text-zinc-600 shadow-md">
            {hasDraft
              ? "Drag an edge to resize this field, or the middle to move it. Tap the trash icon to start over."
              : "Drag on the map to draw a field."}
          </div>
        )}

        {selectedPlot?.data?.observation.ndviImage && (
          <div className="absolute bottom-3 right-3 z-[1000] w-56 rounded-2xl bg-white/95 p-3 shadow-md">
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
              className="w-full accent-green-600"
            />
          </div>
        )}
      </div>

      <FieldSidebar
        plots={plots}
        selectedPlotId={selectedPlotId}
        locating={locating}
        locationError={locationError}
        onFindLocation={onFindLocation}
        onNewField={onNewField}
        onSelectPlot={onSelectPlot}
        onRemovePlot={onRemovePlot}
        onUpdateDetails={onUpdateDetails}
        onSaveField={onSaveField}
      />
    </div>
  );
}
