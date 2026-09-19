import { NextRequest, NextResponse } from "next/server";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
}

// Free, no-key geocoding (same "no auth" pattern as lib/weather.ts), proxied
// through our own route because Nominatim's usage policy requires a
// descriptive User-Agent identifying the calling app — a header the browser
// won't let client-side fetch() set.
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json([]);
  }

  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("q", q);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "5");

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": "FarmOS/0.1 (hackathon prototype)" },
  });
  if (!res.ok) {
    return NextResponse.json({ error: `Location search failed: ${res.status}` }, { status: 502 });
  }

  const results: NominatimResult[] = await res.json();
  return NextResponse.json(
    results.map((r) => ({ label: r.display_name, lat: parseFloat(r.lat), lng: parseFloat(r.lon) }))
  );
}
