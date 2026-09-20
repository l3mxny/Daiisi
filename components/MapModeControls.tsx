"use client";

export type MapMode = "cursor" | "draw";

function DrawIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M13.5 3.5l3 3-9 9-3.7.7.7-3.7z" />
    </svg>
  );
}

function MoveIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 2.5v15M2.5 10h15M10 2.5l-2.2 2.2M10 2.5l2.2 2.2M10 17.5l-2.2-2.2M10 17.5l2.2-2.2M2.5 10l2.2-2.2M2.5 10l2.2 2.2M17.5 10l-2.2-2.2M17.5 10l-2.2 2.2" />
    </svg>
  );
}

function EraseIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.5 4.5l3 3-8 8h-3.5v-3.5z" />
      <path d="M9.5 7.5l3 3" />
    </svg>
  );
}

// Draw = draw and reshape a field. Move = pan the map and pick a field. Erase = throw away the field you are
// still drawing (a saved field is removed from the Saved fields list instead, so it can't be lost by a stray click).
export default function MapModeControls({
  mode,
  onChange,
  canErase,
  onErase,
}: {
  mode: MapMode;
  onChange: (mode: MapMode) => void;
  canErase: boolean;
  onErase: () => void;
}) {
  const base = "flex items-center gap-1.5 px-4 py-2 text-xs font-semibold transition-colors";
  return (
    <div className="absolute top-3 right-3 z-[1000] flex overflow-hidden bg-white/95 shadow-md">
      <button
        type="button"
        onClick={() => onChange("draw")}
        title="Draw or reshape a field"
        aria-pressed={mode === "draw"}
        className={`${base} ${mode === "draw" ? "bg-olive text-white" : "text-olive hover:bg-zinc-100"}`}
      >
        <DrawIcon />
        Draw
      </button>
      <button
        type="button"
        onClick={() => onChange("cursor")}
        title="Pan the map and select a field"
        aria-pressed={mode === "cursor"}
        className={`${base} ${mode === "cursor" ? "bg-olive text-white" : "text-olive hover:bg-zinc-100"}`}
      >
        <MoveIcon />
        Move
      </button>
      <button
        type="button"
        onClick={onErase}
        disabled={!canErase}
        title={canErase ? "Discard the field you are drawing" : "Nothing to erase"}
        className={`${base} text-olive hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent`}
      >
        <EraseIcon />
        Erase
      </button>
    </div>
  );
}
