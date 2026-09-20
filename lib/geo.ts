export type Bbox = [number, number, number, number]; // [west, south, east, north]

const HALF_SIZE_DEG = 0.0025;

export function bboxFromPoint(lat: number, lng: number): Bbox {
  return [lng - HALF_SIZE_DEG, lat - HALF_SIZE_DEG, lng + HALF_SIZE_DEG, lat + HALF_SIZE_DEG];
}

// Builds a bbox from two arbitrary corner points (any drag direction).
export function bboxFromCorners(a: [number, number], b: [number, number]): Bbox {
  const [latA, lngA] = a;
  const [latB, lngB] = b;
  return [Math.min(lngA, lngB), Math.min(latA, latB), Math.max(lngA, lngB), Math.max(latA, latB)];
}

export function bboxCentroid(bbox: Bbox): [number, number] {
  const [west, south, east, north] = bbox;
  return [(south + north) / 2, (west + east) / 2];
}

export function bboxToLeafletBounds(bbox: Bbox): [[number, number], [number, number]] {
  const [west, south, east, north] = bbox;
  return [
    [south, west],
    [north, east],
  ];
}

const EARTH_RADIUS_M = 6_378_137;

// Equirectangular approximation — plenty accurate at the plot scale these
// bboxes are drawn at, and avoids pulling in a geodesy library.
export function bboxAreaHectares(bbox: Bbox): number {
  const [west, south, east, north] = bbox;
  const latMidRad = ((south + north) / 2) * (Math.PI / 180);
  const widthM = (east - west) * (Math.PI / 180) * EARTH_RADIUS_M * Math.cos(latMidRad);
  const heightM = (north - south) * (Math.PI / 180) * EARTH_RADIUS_M;
  return Math.abs(widthM * heightM) / 10_000;
}

// Area for people: tiny plots in square metres (a "0.0 ha" field reads as a bug), everything else in hectares.
export function formatArea(hectares: number): string {
  if (hectares < 0.1) return `${Math.round(hectares * 10_000).toLocaleString("en-US")} m²`;
  return `${hectares < 10 ? hectares.toFixed(2) : hectares.toFixed(1)} ha`;
}

// Sentinel-2 pixels are 10 m (0.01 ha), so a plot this small is only a handful of pixels and its greenness
// reading is a rough guide, not a measurement.
export const MIN_RELIABLE_HECTARES = 0.1;
