"use client";

export type MapMode = "cursor" | "draw";

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
  const base = "px-4 py-2 text-xs font-semibold transition-colors";
  return (
    <div className="absolute top-3 right-3 z-[1000] flex overflow-hidden bg-white/95 shadow-md">
      <button
        type="button"
        onClick={() => onChange("draw")}
        title="Draw or reshape a field"
        aria-pressed={mode === "draw"}
        className={`${base} ${mode === "draw" ? "bg-olive text-white" : "text-olive hover:bg-zinc-100"}`}
      >
        Draw
      </button>
      <button
        type="button"
        onClick={() => onChange("cursor")}
        title="Pan the map and select a field"
        aria-pressed={mode === "cursor"}
        className={`${base} ${mode === "cursor" ? "bg-olive text-white" : "text-olive hover:bg-zinc-100"}`}
      >
        Move
      </button>
      <button
        type="button"
        onClick={onErase}
        disabled={!canErase}
        title={canErase ? "Discard the field you are drawing" : "Nothing to erase"}
        className={`${base} text-olive hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent`}
      >
        Erase
      </button>
    </div>
  );
}
