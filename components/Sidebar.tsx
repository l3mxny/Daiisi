"use client";

import type { Plot } from "@/lib/types";

export type TabId = "input" | "results" | "info";

const TABS: { id: TabId; label: string }[] = [
  { id: "input", label: "Field input" },
  { id: "results", label: "Results" },
  { id: "info", label: "General info" },
];

function TabIcon({ id }: { id: TabId }) {
  if (id === "input") {
    return (
      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4">
        <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
      </svg>
    );
  }
  if (id === "results") {
    return (
      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4">
        <rect x="4" y="4" width="8" height="8" rx="1.2" transform="rotate(45 8 8)" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path
        d="M4.6 11.5a2.4 2.4 0 0 1-.4-4.77 2.9 2.9 0 0 1 5.5-1.63 2.4 2.4 0 0 1 2.2 4.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function Sidebar({
  activeTab,
  onTabChange,
  plots,
}: {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  plots: Plot[];
}) {
  const readyPlots = plots.filter((p) => p.status === "ready" && p.data);
  const lastPassDate = readyPlots.reduce<string | null>((latest, p) => {
    const d = p.data!.observation.date;
    if (!d) return latest;
    return !latest || d > latest ? d : latest;
  }, null);

  return (
    <aside className="flex h-full w-56 shrink-0 flex-col justify-between bg-zinc-950 px-4 py-5">
      <div className="flex flex-col gap-8">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-green-600 text-sm font-bold text-white">
            F
          </span>
          <span className="font-serif text-lg text-white">FarmOS</span>
        </div>

        <nav className="flex flex-col gap-1">
          {TABS.map((tab) => {
            const active = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                  active ? "bg-green-800/90 text-white" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                }`}
              >
                <TabIcon id={tab.id} />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="rounded-md bg-zinc-900 px-3 py-2.5 text-xs">
        <div className="font-medium uppercase tracking-wide text-zinc-500">Satellite</div>
        <div className="mt-1 text-zinc-300">{lastPassDate ? `Last pass ${lastPassDate}` : "No imagery yet"}</div>
      </div>
    </aside>
  );
}
