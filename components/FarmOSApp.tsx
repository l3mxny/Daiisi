"use client";

import { useState } from "react";
import Sidebar, { type TabId } from "./Sidebar";
import FieldInputPanel from "./FieldInputPanel";
import ResultsPanel from "./ResultsPanel";
import GeneralInfoPanel from "./GeneralInfoPanel";
import type { Bbox } from "@/lib/geo";
import type { FieldApiResponse, Plot } from "@/lib/types";

const PLOT_COLORS = ["#2563eb", "#d97706", "#7c3aed", "#059669", "#db2777", "#0891b2"];

function makeId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `plot-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function FarmOSApp() {
  const [plots, setPlots] = useState<Plot[]>([]);
  const [selectedPlotId, setSelectedPlotId] = useState<string | null>(null);
  const [ndviOpacity, setNdviOpacity] = useState(0.7);
  const [plotCount, setPlotCount] = useState(0);
  const [activeTab, setActiveTab] = useState<TabId>("input");

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

  function handleDrawComplete(bbox: Bbox) {
    const id = makeId();
    const index = plotCount;
    setPlotCount((n) => n + 1);
    const plot: Plot = {
      id,
      label: `Plot ${index + 1}`,
      bbox,
      color: PLOT_COLORS[index % PLOT_COLORS.length],
      status: "loading",
      data: null,
      previousData: null,
      error: null,
    };
    setPlots((prev) => [...prev, plot]);
    setSelectedPlotId(id);
    fetchPlotStats(id, bbox);
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

  function handleClearAll() {
    setPlots([]);
    setSelectedPlotId(null);
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
            onNdviOpacityChange={setNdviOpacity}
            onSelectPlot={setSelectedPlotId}
            onDrawComplete={handleDrawComplete}
            onRemovePlot={handleRemovePlot}
            onClearAll={handleClearAll}
          />
        )}
        {activeTab === "results" && <ResultsPanel plots={plots} onRefreshPlot={handleRefreshPlot} />}
        {activeTab === "info" && <GeneralInfoPanel />}
      </main>
    </div>
  );
}
