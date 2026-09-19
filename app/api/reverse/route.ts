import { NextRequest, NextResponse } from "next/server";

const NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse";

interface NominatimReverse {
  address?: { country_code?: string };
  error?: string;
}

// Turns coordinates into a country code, so the app can suggest languages for where the farmer
// is. Same free, no-key service as /api/geocode and proxied for the same reason (Nominatim's
// usage policy requires a descriptive User-Agent, which browsers won't let fetch() set).
// The coordinates are sent to Nominatim (OpenStreetMap) to look up the country; only the country
// code is returned to the browser.
export async function GET(req: NextRequest) {
  const lat = Number(req.nextUrl.searchParams.get("lat"));
  const lng = Number(req.nextUrl.searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json({ error: "lat and lng must be valid coordinates" }, { status: 400 });
  }

  const url = new URL(NOMINATIM_REVERSE_URL);
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("zoom", "3"); // country level is all we need
  url.searchParams.set("addressdetails", "1");

  const res = await fetch(url.toString(), { headers: { "User-Agent": "FarmOS/0.1 (hackathon prototype)" } });
  if (!res.ok) {
    return NextResponse.json({ error: `Reverse lookup failed: ${res.status}` }, { status: 502 });
  }

  const json: NominatimReverse = await res.json();
  // Open water and other unmapped spots come back as an error body; that's "no country", not a failure.
  return NextResponse.json({ countryCode: json.address?.country_code?.toLowerCase() ?? null });
}
