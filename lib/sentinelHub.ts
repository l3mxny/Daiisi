import type { Bbox } from "./geo";
import { NDVI_COLOR_EVALSCRIPT, NDVI_STATS_EVALSCRIPT, TRUE_COLOR_EVALSCRIPT } from "./evalscripts";

const IDENTITY_TOKEN_URL =
  "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token";
const SH_BASE_URL = "https://sh.dataspace.copernicus.eu";
const CRS_URI = "http://www.opengis.net/def/crs/EPSG/0/4326";

// Module-level cache so we mint one token and reuse it across requests
// instead of hitting the auth endpoint per call. Refreshed proactively
// once we're within 60s of the 1800s expiry.
let cachedToken: { accessToken: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - now > 60_000) {
    return cachedToken.accessToken;
  }

  const clientId = process.env.CDSE_CLIENT_ID;
  const clientSecret = process.env.CDSE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("CDSE_CLIENT_ID / CDSE_CLIENT_SECRET are not set");
  }

  const res = await fetch(IDENTITY_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    throw new Error(`CDSE auth failed: ${res.status} ${await res.text()}`);
  }

  const json = await res.json();
  const expiresInSec: number = json.expires_in ?? 1800;
  cachedToken = {
    accessToken: json.access_token,
    expiresAt: now + expiresInSec * 1000,
  };
  return cachedToken.accessToken;
}

async function shFetch(path: string, body: unknown, accept?: string): Promise<Response> {
  const token = await getAccessToken();
  const res = await fetch(`${SH_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(accept ? { Accept: accept } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`${path} failed: ${res.status} ${await res.text()}`);
  }
  return res;
}

export interface SceneInfo {
  date: string; // ISO datetime of the scene
  cloudCover: number | null;
}

// STAC-style Catalog API response: { features: [{ properties: { datetime,
// "eo:cloud_cover" }, ... } ] }. Finds the most recent scene in the last
// `lookbackDays` days with cloud cover under `maxCloudCover`.
export async function findLatestClearScene(
  bbox: Bbox,
  lookbackDays = 60,
  maxCloudCover = 20
): Promise<SceneInfo | null> {
  const to = new Date();
  const from = new Date(to.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

  const res = await shFetch("/api/v1/catalog/1.0.0/search", {
    collections: ["sentinel-2-l2a"],
    datetime: `${from.toISOString()}/${to.toISOString()}`,
    bbox,
    limit: 20,
  });
  const json = await res.json();

  const features: Array<{ properties?: Record<string, unknown> }> = Array.isArray(json?.features)
    ? json.features
    : [];

  const candidates = features
    .map((f) => {
      const props = f.properties ?? {};
      const datetime = props["datetime"];
      const cloudCoverRaw = props["eo:cloud_cover"];
      if (typeof datetime !== "string") return null;
      const cloudCover = typeof cloudCoverRaw === "number" ? cloudCoverRaw : null;
      return { date: datetime, cloudCover };
    })
    .filter((c): c is SceneInfo => c !== null)
    .filter((c) => c.cloudCover === null || c.cloudCover < maxCloudCover)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return candidates[0] ?? null;
}

function dayRangeFor(dateISO: string): { from: string; to: string } {
  const day = dateISO.slice(0, 10);
  return { from: `${day}T00:00:00Z`, to: `${day}T23:59:59Z` };
}

async function processImage(bbox: Bbox, sceneDateISO: string, evalscript: string): Promise<string> {
  const { from, to } = dayRangeFor(sceneDateISO);
  const res = await shFetch(
    "/api/v1/process",
    {
      input: {
        bounds: { bbox, properties: { crs: CRS_URI } },
        data: [
          {
            type: "sentinel-2-l2a",
            dataFilter: { timeRange: { from, to } },
          },
        ],
      },
      output: {
        width: 512,
        height: 512,
        responses: [{ identifier: "default", format: { type: "image/png" } }],
      },
      evalscript,
    },
    "image/png"
  );
  const buf = Buffer.from(await res.arrayBuffer());
  return `data:image/png;base64,${buf.toString("base64")}`;
}

export function getTrueColorImage(bbox: Bbox, sceneDateISO: string): Promise<string> {
  return processImage(bbox, sceneDateISO, TRUE_COLOR_EVALSCRIPT);
}

export function getNdviImage(bbox: Bbox, sceneDateISO: string): Promise<string> {
  return processImage(bbox, sceneDateISO, NDVI_COLOR_EVALSCRIPT);
}

export interface NdviPoint {
  date: string; // yyyy-mm-dd
  mean: number;
}

interface StatsInterval {
  interval: { from: string; to: string };
  outputs?: {
    ndvi?: {
      bands?: {
        B0?: {
          stats?: {
            mean: number | "NaN";
            sampleCount?: number;
            noDataCount?: number;
          };
        };
      };
    };
  };
}

// Drops intervals where mean is "NaN" (fully clouded) or where more than
// 30% of samples are no-data (partially masked mean is misleading).
export async function getNdviTimeSeries(bbox: Bbox, lookbackDays = 90): Promise<NdviPoint[]> {
  // aggregation.timeRange must land on UTC midnight boundaries. A "to" of
  // e.g. 02:14:37Z (whatever time the request happens to fire) instead of
  // 00:00:00Z shifts every P1D bucket by that offset and breaks the
  // backend's day bucketing for this aggregation — verified directly:
  // the same ~90-day window against the same bbox went from 19/22 valid
  // intervals (midnight-aligned) to 0/22 valid (misaligned by ~2h14m).
  const to = new Date();
  to.setUTCHours(0, 0, 0, 0);
  const from = new Date(to.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

  const requestBody = {
    input: {
      bounds: { bbox, properties: { crs: CRS_URI } },
      data: [{ type: "sentinel-2-l2a" }],
    },
    aggregation: {
      timeRange: { from: from.toISOString(), to: to.toISOString() },
      aggregationInterval: { of: "P1D" },
      resx: 0.0001,
      resy: 0.0001,
      evalscript: NDVI_STATS_EVALSCRIPT,
    },
  };
  console.log("[ndvi-stats] outgoing /api/v1/statistics body:", JSON.stringify(requestBody));

  const res = await shFetch("/api/v1/statistics", requestBody);
  const json = await res.json();
  return parseNdviTimeSeries(json, `bbox=${JSON.stringify(bbox)}`);
}

export function parseNdviTimeSeries(json: { data?: StatsInterval[] }, context = "unknown"): NdviPoint[] {
  const intervals = Array.isArray(json?.data) ? json.data : [];
  const points: NdviPoint[] = [];
  let droppedMissingStats = 0;
  let droppedNaN = 0;
  let droppedHighNoData = 0;

  for (const interval of intervals) {
    const stats = interval.outputs?.ndvi?.bands?.B0?.stats;
    if (!stats) {
      droppedMissingStats++;
      continue;
    }
    const { mean, sampleCount, noDataCount } = stats;
    if (typeof mean !== "number" || Number.isNaN(mean)) {
      droppedNaN++;
      continue;
    }
    if (
      typeof sampleCount === "number" &&
      typeof noDataCount === "number" &&
      sampleCount > 0 &&
      noDataCount / sampleCount > 0.3
    ) {
      droppedHighNoData++;
      continue;
    }
    points.push({ date: interval.interval.from.slice(0, 10), mean });
  }

  console.log(
    `[ndvi-stats] ${context}: raw intervals=${intervals.length}, kept=${points.length} ` +
      `(dropped: missingStats=${droppedMissingStats}, nan=${droppedNaN}, highNoData=${droppedHighNoData})`
  );

  return points;
}
