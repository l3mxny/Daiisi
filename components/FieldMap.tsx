"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";
import L from "leaflet";

// Leaflet-Geoman's build expects a global `L` (the classic Leaflet-plugin
// pattern) rather than importing "leaflet" itself, so it has to be set
// before the plugin's own module body runs.
if (typeof window !== "undefined") {
  (window as typeof window & { L?: typeof L }).L = L;
}
import "@geoman-io/leaflet-geoman-free";

import { ImageOverlay, MapContainer, Marker, Rectangle, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import type { Bbox } from "@/lib/geo";
import { bboxAreaHectares, bboxFromCorners, bboxFromPoint, bboxToLeafletBounds, formatArea } from "@/lib/geo";

// A drag shorter than this (in screen pixels) is treated as a plain click.
// This has to be a pixel distance, not a fixed lat/lng delta — the same
// on-screen drag covers far fewer degrees at a deep zoom (e.g. right after
// "Find my location") than at a shallow one, so a fixed-degree threshold
// misclassified small deliberate drags as clicks and replaced them with the
// much larger default click-box.
const MIN_DRAG_PIXELS = 6;
import type { Plot } from "@/lib/types";
import type { MapMode } from "./MapModeControls";

export interface FlyTarget {
  lat: number;
  lng: number;
  zoom?: number;
}

function boundsToBbox(bounds: L.LatLngBounds): Bbox {
  return [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
}

// Geoman's own Rectangle tool is click-click (place a corner, move, click
// again) — it never disables map panning, so a drag gesture just pans the
// map instead of drawing. Creation is handled here by hand, the same
// mousedown/mousemove/mouseup approach the map used before Geoman; Geoman
// is only responsible for editing (resize/move) shapes once they exist.
function DrawHandler({ active, onDrawComplete }: { active: boolean; onDrawComplete: (bbox: Bbox) => void }) {
  const map = useMap();
  const startRef = useRef<[number, number] | null>(null);
  const [preview, setPreview] = useState<[[number, number], [number, number]] | null>(null);

  useMapEvents({
    mousedown(e) {
      if (!active) return;
      // Leaflet's own Draggable (used by Geoman's resize handles) never
      // calls stopPropagation on mousedown, so grabbing a handle or an
      // existing shape would otherwise also bubble up here and start a
      // second, unwanted rectangle. Bail out for anything that isn't a
      // plain click on the map background.
      const target = e.originalEvent.target as Element | null;
      if (target?.closest(".leaflet-marker-icon, .leaflet-interactive")) return;
      startRef.current = [e.latlng.lat, e.latlng.lng];
      setPreview([startRef.current, startRef.current]);
      map.dragging.disable();
    },
    mousemove(e) {
      if (!startRef.current) return;
      setPreview([startRef.current, [e.latlng.lat, e.latlng.lng]]);
    },
    mouseup(e) {
      const start = startRef.current;
      startRef.current = null;
      map.dragging.enable();
      setPreview(null);
      if (!start) return;

      const end: [number, number] = [e.latlng.lat, e.latlng.lng];
      const startPoint = map.latLngToContainerPoint(L.latLng(start[0], start[1]));
      const endPoint = map.latLngToContainerPoint(e.latlng);
      const dragged = startPoint.distanceTo(endPoint) > MIN_DRAG_PIXELS;
      const bbox = dragged ? bboxFromCorners(start, end) : bboxFromPoint(start[0], start[1]);
      onDrawComplete(bbox);
    },
  });

  if (!preview) return null;
  return (
    <Rectangle
      bounds={bboxToLeafletBounds(bboxFromCorners(preview[0], preview[1]))}
      pathOptions={{ color: "#16a34a", weight: 1, dashArray: "4 4", fillOpacity: 0.05 }}
    />
  );
}

// Drives Geoman's edit mode (drag-to-move, drag-handles-to-resize) for every
// plot rectangle currently on the map — it isn't a react-leaflet component,
// so it's driven imperatively off the Leaflet map instance from here.
function GeomanEditController({ mode }: { mode: MapMode }) {
  const map = useMap();

  useEffect(() => {
    map.pm.setGlobalOptions({ pathOptions: { color: "#16a34a", weight: 2 }, allowSelfIntersection: false });
  }, [map]);

  useEffect(() => {
    // Geoman's disableGlobalEditMode() assumes enableGlobalEditMode() already
    // ran — calling it when edit mode was never enabled (e.g. on first
    // mount, which starts in "cursor" mode) trips an internal listener
    // lookup and logs "wrong listener type: undefined" to the console.
    if (mode === "draw") {
      if (!map.pm.globalEditModeEnabled()) map.pm.enableGlobalEditMode();
    } else if (map.pm.globalEditModeEnabled()) {
      map.pm.disableGlobalEditMode();
    }
  }, [mode, map]);

  return null;
}

const TRASH_ICON = L.divIcon({
  className: "",
  html:
    '<div style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;' +
    'border-radius:9999px;background:white;box-shadow:0 1px 4px rgba(0,0,0,0.35);cursor:pointer;">' +
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="#dc2626" stroke-width="1.4" ' +
    'stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5h10M6 4.5V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5' +
    'M4.5 4.5l.6 8.2a1 1 0 0 0 1 .8h3.8a1 1 0 0 0 1-.8l.6-8.2"/></svg></div>',
  iconSize: [26, 26],
  iconAnchor: [-4, -4],
});

// Lets you abandon a field you're still drawing (before it's saved) instead
// of only being able to resize/move it — sits just past the SE corner so it
// doesn't overlap Geoman's own resize handle sitting exactly on that corner.
function DraftDiscardButton({ plot, onDiscard }: { plot: Plot; onDiscard: (id: string) => void }) {
  const [, south, east] = plot.bbox;
  return (
    <Marker
      position={[south, east]}
      icon={TRASH_ICON}
      eventHandlers={{
        mousedown: (e) => L.DomEvent.stopPropagation(e),
        click: (e) => {
          L.DomEvent.stopPropagation(e);
          onDiscard(plot.id);
        },
      }}
    />
  );
}

function FlyToController({ target, onHandled }: { target: FlyTarget | null; onHandled: () => void }) {
  const map = useMap();
  useEffect(() => {
    if (!target) return;
    map.flyTo([target.lat, target.lng], target.zoom ?? 15, { duration: 1.1 });
    onHandled();
    // onHandled intentionally excluded — it's a state setter identity that
    // would otherwise re-run this on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, map]);
  return null;
}

// 0°21'S 36°04'E style readout of where the map is centred, plus the imagery it will be judged with.
function toDms(value: number, pos: string, neg: string): string {
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const min = Math.floor((abs - deg) * 60);
  return `${deg}°${String(min).padStart(2, "0")}'${value >= 0 ? pos : neg}`;
}

function CenterReadout() {
  const map = useMap();
  const [center, setCenter] = useState(() => map.getCenter());
  useMapEvents({ moveend: () => setCenter(map.getCenter()) });
  return (
    <div className="pointer-events-none absolute top-14 right-3 z-[1000] bg-white/95 px-3 py-2 text-[11px] leading-snug text-zinc-600 shadow-md">
      <div>
        {toDms(center.lat, "N", "S")} {toDms(center.lng, "E", "W")}
      </div>
      <div className="text-zinc-400">Sentinel-2 · 10 m/px</div>
    </div>
  );
}

export default function FieldMap({
  plots,
  selectedPlotId,
  ndviOpacity,
  mode,
  initialCenter,
  flyTo,
  onFlyToHandled,
  onSelectPlot,
  onDrawComplete,
  onBboxEdit,
  onDiscardDraft,
}: {
  plots: Plot[];
  selectedPlotId: string | null;
  ndviOpacity: number;
  mode: MapMode;
  initialCenter: [number, number];
  flyTo: FlyTarget | null;
  onFlyToHandled: () => void;
  onSelectPlot: (id: string) => void;
  onDrawComplete: (bbox: Bbox) => void;
  onBboxEdit: (id: string, bbox: Bbox) => void;
  onDiscardDraft: (id: string) => void;
}) {
  const selectedPlot = plots.find((p) => p.id === selectedPlotId) ?? null;
  // Only one field can be mid-creation at a time — once a draft box exists,
  // further drags only resize/move it (via Geoman) rather than starting
  // another one. Save or discard it to draw a new field.
  const hasDraft = plots.some((p) => !p.saved);

  return (
    <MapContainer center={initialCenter} zoom={13} className="field-map h-full w-full">
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      />
      <CenterReadout />
      <GeomanEditController mode={mode} />
      <DrawHandler active={mode === "draw" && !hasDraft} onDrawComplete={onDrawComplete} />
      <FlyToController target={flyTo} onHandled={onFlyToHandled} />

      {plots.map((plot) => {
        const isSelected = plot.id === selectedPlotId;
        return (
          <Rectangle
            key={plot.id}
            bounds={bboxToLeafletBounds(plot.bbox)}
            pathOptions={{
              color: plot.color,
              weight: isSelected ? 3 : 2,
              fillOpacity: isSelected ? 0.15 : 0.04,
              dashArray: plot.saved ? undefined : "6 4",
            }}
            eventHandlers={{
              mousedown: (e) => L.DomEvent.stopPropagation(e),
              click: (e) => {
                L.DomEvent.stopPropagation(e);
                onSelectPlot(plot.id);
              },
              "pm:edit": (e) => onBboxEdit(plot.id, boundsToBbox((e.layer as L.Rectangle).getBounds())),
              "pm:dragend": (e) => onBboxEdit(plot.id, boundsToBbox((e.layer as L.Rectangle).getBounds())),
            }}
          >
            <Tooltip permanent direction="bottom" offset={[0, -6]} className="field-tag" interactive={false}>
              {plot.details.name || plot.label} · {formatArea(bboxAreaHectares(plot.bbox))}
            </Tooltip>
          </Rectangle>
        );
      })}

      {plots
        .filter((plot) => !plot.saved)
        .map((plot) => (
          <DraftDiscardButton key={`discard-${plot.id}`} plot={plot} onDiscard={onDiscardDraft} />
        ))}

      {selectedPlot?.data?.observation.trueColorImage && (
        <ImageOverlay
          url={selectedPlot.data.observation.trueColorImage}
          bounds={bboxToLeafletBounds(selectedPlot.bbox)}
          opacity={1}
        />
      )}
      {selectedPlot?.data?.observation.ndviImage && (
        <ImageOverlay
          url={selectedPlot.data.observation.ndviImage}
          bounds={bboxToLeafletBounds(selectedPlot.bbox)}
          opacity={ndviOpacity}
        />
      )}
    </MapContainer>
  );
}
