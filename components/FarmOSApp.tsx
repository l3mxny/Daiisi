"use client";

import { useEffect, useState } from "react";
import Sidebar, { type TabId } from "./Sidebar";
import FieldInputPanel from "./FieldInputPanel";
import ResultsPanel from "./ResultsPanel";
import GeneralInfoPanel from "./GeneralInfoPanel";
import type { MapMode } from "./MapModeControls";
import type { FlyTarget } from "./FieldMap";
import type { FieldDetailsPatch } from "./FieldSidebar";
import { getCurrentLocation } from "@/lib/geoLocation";
import type { Bbox } from "@/lib/geo";
import type { FieldApiResponse, Plot } from "@/lib/types";

const PLOT_COLORS = ["#2563eb", "#d97706", "#7c3aed", "#059669", "#db2777", "#0891b2"];

function makeId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `plot-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function emptyDetails() {
  return { name: "", crop: "", plantedOn: null, soilType: null };
}

export default function FarmOSApp() {
  const [plots, setPlots] = useState<Plot[]>([]);
  const [selectedPlotId, setSelectedPlotId] = useState<string | null>(null);
  const [ndviOpacity, setNdviOpacity] = useState(0.7);
  const [plotCount, setPlotCount] = useState(0);
  const [activeTab, setActiveTab] = useState<TabId>("input");
  const [mapMode, setMapMode] = useState<MapMode>("cursor");
  const [flyTo, setFlyTo] = useState<FlyTarget | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  useEffect(() => {
    // Center on the farmer's own location as soon as we can. The map starts
    // on its Central Valley default while this resolves. Silent on failure
    // here (no user gesture triggered this attempt, so no visible control
    // to attach an error to) — handleFindLocation surfaces failures instead.
    getCurrentLocation()
      .then((loc) => setFlyTo({ lat: loc.lat, lng: loc.lng, zoom: 15 }))
      .catch(() => {});
  }, []);

  function handleFindLocation() {
    setLocating(true);
    setLocationError(null);
    getCurrentLocation()
      .then((loc) => setFlyTo({ lat: loc.lat, lng: loc.lng, zoom: 15 }))
      .catch((err: Error) => setLocationError(err.message))
      .finally(() => setLocating(false));
  }

  function handleSelectSearchLocation(loc: { lat: number; lng: number }) {
    setFlyTo({ lat: loc.lat, lng: loc.lng, zoom: 15 });
  }

  async function fetchPlotStats(id: string, bbox: Bbox) {
    try {
      const res = await fetch("/api/field", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bbox }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error ?? `Request failed: ${res.status}`);
      }
      setPlots((prev) =>
        prev.map((p) =>
          p.id === id
            ? { ...p, status: "ready", data: json as FieldApiResponse, previousData: p.data, error: null }
            : p
        )
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setPlots((prev) => prev.map((p) => (p.id === id ? { ...p, status: "error", error: message } : p)));
    }
  }

  function handleNewField() {
    setMapMode("draw");
  }

  function handleDrawComplete(bbox: Bbox) {
    const id = makeId();
    const index = plotCount;
    setPlotCount((n) => n + 1);
    const plot: Plot = {
      id,
      label: `Field ${index + 1}`,
      bbox,
      color: PLOT_COLORS[index % PLOT_COLORS.length],
      status: "draft",
      saved: false,
      details: emptyDetails(),
      data: null,
      previousData: null,
      error: null,
    };
    setPlots((prev) => [...prev, plot]);
    setSelectedPlotId(id);
  }

  function handleBboxEdit(id: string, bbox: Bbox) {
    const plot = plots.find((p) => p.id === id);
    if (!plot) return;
    setPlots((prev) =>
      prev.map((p) => (p.id === id ? { ...p, bbox, status: p.saved ? "loading" : p.status } : p))
    );
    if (plot.saved) {
      persistField({ ...plot, bbox });
      fetchPlotStats(id, bbox);
    }
  }

  // Mirrors a saved field into Postgres (see db/fields.ts) so the weekly
  // background job has something to iterate over — best-effort: a failure
  // here shouldn't block the farmer from seeing their field's stats, which
  // come from fetchPlotStats regardless.
  async function persistField(plot: Plot) {
    try {
      await fetch("/api/fields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: plot.id,
          name: plot.details.name || plot.label,
          crop: plot.details.crop,
          soilType: plot.details.soilType,
          plantedOn: plot.details.plantedOn,
          bbox: plot.bbox,
        }),
      });
    } catch (err) {
      console.error("Failed to save field to the database:", err);
    }
  }

  function handleUpdateDetails(id: string, patch: FieldDetailsPatch) {
    setPlots((prev) => prev.map((p) => (p.id === id ? { ...p, details: { ...p.details, ...patch } } : p)));
  }

  function handleSaveField(id: string) {
    const plot = plots.find((p) => p.id === id);
    if (!plot) return;
    setPlots((prev) =>
      prev.map((p) => (p.id === id ? { ...p, saved: true, label: p.details.name || p.label, status: "loading" } : p))
    );
    setMapMode("cursor");
    persistField(plot);
    fetchPlotStats(id, plot.bbox);
  }

  function handleRemovePlot(id: string) {
    setPlots((prev) => prev.filter((p) => p.id !== id));
    setSelectedPlotId((current) => (current === id ? null : current));
  }

  function handleRefreshPlot(id: string) {
    const plot = plots.find((p) => p.id === id);
    if (!plot) return;
    setPlots((prev) => prev.map((p) => (p.id === id ? { ...p, status: "loading", error: null } : p)));
    fetchPlotStats(id, plot.bbox);
  }

  return (
    <div className="flex h-screen w-screen bg-[#f7f3ea]">
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} plots={plots} />
      <main className="h-full min-w-0 flex-1">
        {activeTab === "input" && (
          <FieldInputPanel
            plots={plots}
            selectedPlotId={selectedPlotId}
            ndviOpacity={ndviOpacity}
            mapMode={mapMode}
            flyTo={flyTo}
            locating={locating}
            locationError={locationError}
            onFlyToHandled={() => setFlyTo(null)}
            onNdviOpacityChange={setNdviOpacity}
            onSelectPlot={setSelectedPlotId}
            onMapModeChange={setMapMode}
            onDrawComplete={handleDrawComplete}
            onBboxEdit={handleBboxEdit}
            onFindLocation={handleFindLocation}
            onSelectSearchLocation={handleSelectSearchLocation}
            onNewField={handleNewField}
            onUpdateDetails={handleUpdateDetails}
            onSaveField={handleSaveField}
            onRemovePlot={handleRemovePlot}
          />
        )}
        {activeTab === "results" && (
          <ResultsPanel plots={plots.filter((p) => p.saved)} onRefreshPlot={handleRefreshPlot} />
        )}
        {activeTab === "info" && <GeneralInfoPanel />}
      </main>
    </div>
  );
}
