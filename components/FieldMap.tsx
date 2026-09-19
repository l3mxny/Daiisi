"use client";

import { useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { ImageOverlay, MapContainer, Rectangle, TileLayer, useMap, useMapEvents } from "react-leaflet";
import type { Bbox } from "@/lib/geo";
import { MIN_DRAWN_SIZE_DEG, bboxFromCorners, bboxFromPoint, bboxToLeafletBounds } from "@/lib/geo";
import type { Plot } from "@/lib/types";

const CENTRAL_VALLEY_CENTER: [number, number] = [36.7378, -119.7871];

// Drag-to-draw a custom rectangle on the map. A drag below the minimum size
// is treated as a plain click and falls back to a small default-size plot,
// so quick single clicks still work the way they used to.
function DrawHandler({ onDrawComplete }: { onDrawComplete: (bbox: Bbox) => void }) {
  const map = useMap();
  const startRef = useRef<[number, number] | null>(null);
  const [preview, setPreview] = useState<[[number, number], [number, number]] | null>(null);

  useMapEvents({
    mousedown(e) {
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
      const dragged =
        Math.abs(start[0] - end[0]) > MIN_DRAWN_SIZE_DEG || Math.abs(start[1] - end[1]) > MIN_DRAWN_SIZE_DEG;
      const bbox = dragged ? bboxFromCorners(start, end) : bboxFromPoint(start[0], start[1]);
      onDrawComplete(bbox);
    },
  });

  if (!preview) return null;
  return (
    <Rectangle
      bounds={bboxToLeafletBounds(bboxFromCorners(preview[0], preview[1]))}
      pathOptions={{ color: "#2563eb", weight: 1, dashArray: "4 4", fillOpacity: 0.05 }}
    />
  );
}

export default function FieldMap({
  plots,
  selectedPlotId,
  ndviOpacity,
  onSelectPlot,
  onDrawComplete,
}: {
  plots: Plot[];
  selectedPlotId: string | null;
  ndviOpacity: number;
  onSelectPlot: (id: string) => void;
  onDrawComplete: (bbox: Bbox) => void;
}) {
  const selectedPlot = plots.find((p) => p.id === selectedPlotId) ?? null;

  return (
    <MapContainer center={CENTRAL_VALLEY_CENTER} zoom={13} className="h-full w-full">
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      />
      <DrawHandler onDrawComplete={onDrawComplete} />

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
            }}
            eventHandlers={{
              // Stop these from bubbling to the map so clicking/dragging an
              // existing plot selects it instead of starting a new draw.
              mousedown: (e) => L.DomEvent.stopPropagation(e),
              click: (e) => {
                L.DomEvent.stopPropagation(e);
                onSelectPlot(plot.id);
              },
            }}
          />
        );
      })}

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
