// Country code (e.g. "ke") for a coordinate, via our own /api/reverse route. Returns null when
// there is no country there or the lookup fails: this only feeds language suggestions, so a
// failure should quietly mean "no suggestion", never an error shown to the farmer.
export async function fetchCountryCode(lat: number, lng: number): Promise<string | null> {
  try {
    const res = await fetch(`/api/reverse?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`);
    if (!res.ok) return null;
    const json: { countryCode?: string | null } = await res.json();
    return json.countryCode ?? null;
  } catch {
    return null;
  }
}
