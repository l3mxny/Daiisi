"use client";

import LanguagePicker from "./LanguagePicker";
import Logo from "./Logo";
import type { Plot } from "@/lib/types";

export type TabId = "input" | "results";

const TABS: { id: TabId; label: string }[] = [
  { id: "input", label: "My fields" },
  { id: "results", label: "My results" },
];

function TabIcon({ id }: { id: TabId }) {
  const common = { viewBox: "0 0 20 20", className: "h-[18px] w-[18px]", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  if (id === "input") {
    return (
      <svg {...common}>
        <circle cx="10" cy="7" r="3" />
        <path d="M4 16.5c.8-3 3.2-4.5 6-4.5s5.2 1.5 6 4.5" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M4.5 16.5V10M10 16.5V4.5M15.5 16.5V8" />
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
  const needAttention = plots.filter((p) => p.saved && p.data && p.data.stressEvent.severity !== "ok").length;
  const badge: Partial<Record<TabId, number>> = { results: needAttention };

  return (
    <aside className="flex h-full w-52 shrink-0 flex-col justify-between bg-olive px-4 py-7 font-[family-name:var(--font-mono-ui)]">
      <div className="flex flex-col gap-9">
        <div className="flex justify-center">
          <Logo className="h-28 w-auto text-lime" />
        </div>

        <nav className="flex flex-col gap-1.5">
          {TABS.map((tab) => {
            const active = tab.id === activeTab;
            const count = badge[tab.id] ?? 0;
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2.5 px-3 py-2.5 text-left text-sm font-semibold tracking-wide uppercase transition-colors ${
                  active ? "bg-lime text-olive" : "text-white hover:bg-white/10"
                }`}
              >
                <span className={active ? "text-olive" : "text-coral"}>
                  <TabIcon id={tab.id} />
                </span>
                <span className="flex-1">{tab.label}</span>
                {count > 0 && (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-coral px-1.5 text-[11px] font-semibold text-white">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="flex flex-col gap-4">
        <LanguagePicker />
        <div className="border-t border-white/20 pt-4">
          <button
            type="button"
            onClick={onSwitchNumber}
            title="Switch number"
            className="flex w-full items-center gap-2.5 text-left"
          >
            <span className="flex h-10 w-10 shrink-0 items-end justify-center overflow-hidden bg-zinc-300 text-zinc-500">
              <svg viewBox="0 0 24 24" className="h-8 w-8" fill="currentColor" aria-hidden="true">
                <circle cx="12" cy="8.5" r="4" />
                <path d="M3 24c.6-5.5 4.4-8 9-8s8.4 2.5 9 8z" />
              </svg>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold tracking-wide text-white uppercase">{phone}</span>
              <span className="block truncate text-[11px] text-white/60">Switch number</span>
            </span>
            <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0 text-coral" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3.5 6l4.5 4.5L12.5 6" />
            </svg>
          </button>
        </div>
      </div>
    </aside>
  );
}
