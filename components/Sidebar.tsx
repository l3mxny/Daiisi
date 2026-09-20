"use client";

import LanguagePicker from "./LanguagePicker";
import type { Plot } from "@/lib/types";

export type TabId = "input" | "results" | "text";

const TABS: { id: TabId; label: string; hint: string }[] = [
  { id: "input", label: "Field input", hint: "Draw and save your fields" },
  { id: "results", label: "Results", hint: "Compare plots, see what to do" },
  { id: "text", label: "Text alerts", hint: "Preview the farmer's SMS" },
];

function TabIcon({ id }: { id: TabId }) {
  const common = { viewBox: "0 0 20 20", className: "h-[18px] w-[18px]", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  if (id === "input") {
    return (
      <svg {...common}>
        <path d="M2.5 5.5 7 3.5l6 2 4.5-2v11l-4.5 2-6-2-4.5 2z" />
        <path d="M7 3.5v11M13 5.5v11" />
      </svg>
    );
  }
  if (id === "results") {
    return (
      <svg {...common}>
        <path d="M3 16.5h14" />
        <path d="M5.5 16.5V10M10 16.5V4.5M14.5 16.5V8" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M3.5 4.5h13v9h-7l-3.5 3v-3h-2.5z" />
      <path d="M7 8h6M7 10.5h3.5" />
    </svg>
  );
}

export default function Sidebar({
  activeTab,
  onTabChange,
  plots,
  phone,
  onSwitchNumber,
}: {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  plots: Plot[];
  phone: string;
  onSwitchNumber: () => void;
}) {
  const readyPlots = plots.filter((p) => p.status === "ready" && p.data);
  const lastPassDate = readyPlots.reduce<string | null>((latest, p) => {
    const d = p.data!.observation.date;
    if (!d) return latest;
    return !latest || d > latest ? d : latest;
  }, null);
  const needAttention = plots.filter((p) => p.saved && p.data && p.data.stressEvent.severity !== "ok").length;
  const badge: Partial<Record<TabId, number>> = { results: needAttention };

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col justify-between bg-gradient-to-b from-[#1f2921] to-[#161c17] px-4 py-6">
      <div className="flex flex-col gap-7">
        <div className="flex items-center gap-3 px-2">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-green-500 to-green-700 font-serif text-lg font-bold text-white shadow-lg shadow-green-900/40">
            D
          </span>
          <div>
            <div className="font-serif text-xl leading-tight text-zinc-50">Daiisi</div>
            <div className="text-[11px] text-zinc-500">Field monitoring</div>
          </div>
        </div>

        <nav className="flex flex-col gap-1">
          <div className="mb-1 px-3 text-[10px] font-semibold tracking-[0.14em] text-zinc-600 uppercase">Menu</div>
          {TABS.map((tab) => {
            const active = tab.id === activeTab;
            const count = badge[tab.id] ?? 0;
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                aria-current={active ? "page" : undefined}
                className={`group relative flex items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors ${
                  active ? "bg-white/10" : "hover:bg-white/5"
                }`}
              >
                {active && <span className="absolute top-2.5 bottom-2.5 left-0 w-[3px] rounded-full bg-green-400" />}
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors ${
                    active ? "bg-green-600 text-white" : "bg-white/5 text-zinc-400 group-hover:text-zinc-100"
                  }`}
                >
                  <TabIcon id={tab.id} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm font-medium ${active ? "text-white" : "text-zinc-300 group-hover:text-white"}`}>
                    {tab.label}
                  </span>
                  <span className="block truncate text-[11px] text-zinc-500">{tab.hint}</span>
                </span>
                {count > 0 && (
                  <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[11px] font-semibold text-white">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="flex flex-col gap-3">
        <LanguagePicker />
        <div className="flex items-center gap-3 rounded-2xl bg-white/5 px-3.5 py-3 text-xs">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className={`absolute inline-flex h-full w-full rounded-full ${lastPassDate ? "animate-ping bg-green-400/60" : ""}`} />
            <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${lastPassDate ? "bg-green-400" : "bg-zinc-600"}`} />
          </span>
          <div className="min-w-0">
            <div className="font-medium tracking-wide text-zinc-500 uppercase">Satellite</div>
            <div className="mt-0.5 text-zinc-300">{lastPassDate ? `Last pass ${lastPassDate}` : "No imagery yet"}</div>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-2xl bg-white/5 px-3.5 py-3 text-xs">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-zinc-300">
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="10" cy="7" r="3" />
              <path d="M4 16.5c.8-3 3.2-4.5 6-4.5s5.2 1.5 6 4.5" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-medium tracking-wide text-zinc-500 uppercase">Signed in</div>
            <div className="mt-0.5 truncate text-zinc-300">{phone}</div>
          </div>
          <button
            onClick={onSwitchNumber}
            className="shrink-0 rounded-full border border-white/10 px-2.5 py-1 text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100"
          >
            Switch
          </button>
        </div>
      </div>
    </aside>
  );
}
