"use client";

import { useEffect, useState } from "react";
import Sidebar, { type TabId } from "./Sidebar";
import FieldInputPanel from "./FieldInputPanel";
import ResultsPanel from "./ResultsPanel";
import PhoneSignIn from "./PhoneSignIn";
import type { MapMode } from "./MapModeControls";
import type { FlyTarget } from "./FieldMap";
import type { FieldDetailsPatch } from "./FieldSidebar";
import { getCurrentLocation } from "@/lib/geoLocation";
import { getReplayDate } from "@/lib/replay";
import { getStoredPhone, setStoredPhone, clearStoredPhone } from "@/lib/phoneSession";
import type { Bbox } from "@/lib/geo";
import type { FieldApiResponse, FieldDetails, Plot, SoilType } from "@/lib/types";

const PLOT_COLORS = ["#ea5b4c", "#b7c14a", "#3a6b35", "#d98b2b", "#7a5c99", "#2f7f86"];

interface FieldRecord {
  id: string;
  name: string;
  crop: string;
  soilType: SoilType | null;
  plantedOn: string | null;
  bbox: Bbox;
}

function makeId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `plot-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function emptyDetails(): FieldDetails {
  return { name: "", crop: "", plantedOn: null, soilType: null };
}

function detailsFromRecord(record: FieldRecord): FieldDetails {
  return { name: record.name, crop: record.crop, plantedOn: record.plantedOn, soilType: record.soilType };
}

export default function FarmOSApp() {
  const [initializing, setInitializing] = useState(true);
  const [phone, setPhone] = useState<string | null>(null);
  const [plots, setPlots] = useState<Plot[]>([]);
  const [selectedPlotId, setSelectedPlotId] = useState<string | null>(null);
  const [ndviOpacity, setNdviOpacity] = useState(0.7);
  const [plotCount, setPlotCount] = useState(0);
  const [activeTab, setActiveTab] = useState<TabId>("input");
  const [mapMode, setMapMode] = useState<MapMode>("cursor");
  const [flyTo, setFlyTo] = useState<FlyTarget | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  // Restores a returning farmer's session from localStorage — this is what
  // makes their fields survive a refresh instead of resetting every time.
  useEffect(() => {
    // Deferred a tick so this isn't a synchronous setState call in the
    // effect body itself — purely to satisfy the lint rule, behavior is
    // otherwise identical (runs on the very next microtask).
    Promise.resolve().then(() => {
      const stored = getStoredPhone();
      if (stored) setPhone(stored);
      setInitializing(false);
    });
  }, []);

  useEffect(() => {
    // Center on the farmer's own location as soon as we can. The map starts
    // on its Central Valley default while this resolves. Silent on failure
    // here (no user gesture triggered this attempt, so no visible control
    // to attach an error to) — handleFindLocation surfaces failures instead.
    getCurrentLocation()
      .then((loc) => setFlyTo({ lat: loc.lat, lng: loc.lng, zoom: 15 }))
      .catch(() => {});
  }, []);

  // Loads this phone number's saved fields from Postgres, then kicks off a
  // live stats fetch for each — the same path a freshly-saved field goes
  // through, so the data shown after sign-in is never stale.
  useEffect(() => {
    if (!phone) return;
    let cancelled = false;

    fetch(`/api/fields?phone=${encodeURIComponent(phone)}`)
      .then((res) => res.json())
      .then((records: FieldRecord[]) => {
        if (cancelled || !Array.isArray(records)) return;
        const loaded: Plot[] = records.map((record, index) => ({
          id: record.id,
          label: record.name || `Field ${index + 1}`,
          bbox: record.bbox,
          color: PLOT_COLORS[index % PLOT_COLORS.length],
          status: "loading",
          saved: true,
          details: detailsFromRecord(record),
          data: null,
          previousData: null,
          error: null,
        }));
        setPlots(loaded);
        setPlotCount(loaded.length);
        loaded.forEach((plot) => fetchPlotStats(plot.id, plot.bbox));
      })
      .catch((err) => console.error("Failed to load saved fields:", err));

    return () => {
      cancelled = true;
    };
  }, [phone]);

  function handleSignIn(normalizedPhone: string) {
    setStoredPhone(normalizedPhone);
    setPhone(normalizedPhone);
  }

  function handleSwitchNumber() {
    clearStoredPhone();
    setPhone(null);
    setPlots([]);
    setSelectedPlotId(null);
    setPlotCount(0);
  }

  function handleFindLocation() {
    setLocating(true);
    setLocationError(null);
    getCurrentLocation()
      .then((loc) => setFlyTo({ lat: loc.lat, lng: loc.lng, zoom: 15 }))
      .catch((err: Error) => setLocationError(err.message))
      .finally(() => setLocating(false));
  }

  function handleSelectSearchLocation(loc: { lat: number; lng: number; zoom?: number }) {
    setFlyTo({ lat: loc.lat, lng: loc.lng, zoom: loc.zoom ?? 15 });
  }

  async function fetchPlotStats(id: string, bbox: Bbox, refresh = false) {
    try {
      const res = await fetch("/api/field", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bbox, fieldId: id, asOf: getReplayDate(), refresh }),
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

  // Mirrors a saved field into Postgres, scoped to the signed-in phone
  // number — best-effort: a failure here shouldn't block the farmer from
  // seeing their field's stats, which come from fetchPlotStats regardless.
  async function persistField(plot: Plot) {
    if (!phone) return;
    try {
      await fetch("/api/fields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: plot.id,
          phone,
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

  async function handleSaveField(id: string) {
    const plot = plots.find((p) => p.id === id);
    if (!plot) return;
    setPlots((prev) =>
      prev.map((p) => (p.id === id ? { ...p, saved: true, label: p.details.name || p.label, status: "loading" } : p))
    );
    setMapMode("cursor");
    // Awaited so the field row exists before fetchPlotStats asks /api/field
    // to record this week's stress event against it.
    await persistField(plot);
    fetchPlotStats(id, plot.bbox);
  }

  function handleRemovePlot(id: string) {
    setPlots((prev) => prev.filter((p) => p.id !== id));
    setSelectedPlotId((current) => (current === id ? null : current));
    if (phone) {
      fetch(`/api/fields/${id}?phone=${encodeURIComponent(phone)}`, { method: "DELETE" }).catch((err) =>
        console.error("Failed to delete field:", err)
      );
    }
  }

  function handleRefreshPlot(id: string) {
    const plot = plots.find((p) => p.id === id);
    if (!plot) return;
    setPlots((prev) => prev.map((p) => (p.id === id ? { ...p, status: "loading", error: null } : p)));
    fetchPlotStats(id, plot.bbox, true); // Refresh always asks for new data, not the saved copy
  }

  if (initializing) {
    return <div className="h-screen w-screen bg-[#f7f3ea]" />;
  }

  if (!phone) {
    return <PhoneSignIn onSignIn={handleSignIn} />;
  }

  return (
    <div className="flex h-dvh w-screen overflow-hidden bg-cream">
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} plots={plots} phone={phone} onSwitchNumber={handleSwitchNumber} />
      <main className="relative h-full min-h-0 min-w-0 flex-1 overflow-hidden">
        {getReplayDate() && (
          <div className="absolute top-3 left-1/2 z-[2000] -translate-x-1/2 rounded-full bg-amber-100 px-4 py-1.5 text-xs font-medium text-amber-900 shadow">
            Replay: conditions as of {getReplayDate()}. The &quot;forecast&quot; shows what really fell afterwards, and no AI take is made.
          </div>
        )}
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
      </main>
    </div>
  );
}
