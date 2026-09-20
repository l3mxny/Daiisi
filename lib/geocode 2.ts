export interface GeocodeResult {
  label: string;
  lat: number;
  lng: number;
}

// Routed through our own /api/geocode (see that route for why) rather than
// calling Nominatim directly from the browser.
export async function searchLocations(query: string): Promise<GeocodeResult[]> {
  const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
  if (!res.ok) {
    throw new Error(`Location search failed: ${res.status}`);
  }
  return res.json();
}
