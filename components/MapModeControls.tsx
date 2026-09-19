"use client";

export type MapMode = "cursor" | "draw";

export default function MapModeControls({ mode, onChange }: { mode: MapMode; onChange: (mode: MapMode) => void }) {
  return (
    <div className="absolute right-3 top-3 z-[1000] flex gap-1 rounded-full bg-white/95 p-1 shadow-md">
      <button
        type="button"
        onClick={() => onChange("cursor")}
        title="Pan and select"
        aria-pressed={mode === "cursor"}
        className={`flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium transition-colors ${
          mode === "cursor" ? "bg-green-600 text-white" : "text-zinc-500 hover:bg-zinc-100"
        }`}
      >
        <CursorIcon />
        Cursor
      </button>
      <button
        type="button"
        onClick={() => onChange("draw")}
        title="Draw a field"
        aria-pressed={mode === "draw"}
        className={`flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium transition-colors ${
          mode === "draw" ? "bg-green-600 text-white" : "text-zinc-500 hover:bg-zinc-100"
        }`}
      >
        <DrawIcon />
        Draw
      </button>
    </div>
  );
}

function CursorIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0" fill="currentColor">
      <path d="M3 1.5l9.5 6-3.9.9 2.2 4-1.7.9-2.2-4-2.9 2.7z" />
    </svg>
  );
}

function DrawIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="3" y="3" width="10" height="10" rx="1.5" strokeDasharray="2.3 2" />
    </svg>
  );
}
