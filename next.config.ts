import type { NextConfig } from "next";
import path from "path";

// The offline satellite fallback (lib/fallback.ts) reads these files by a computed path, which Vercel's file
// tracing cannot see, so without this they are missing in production and a satellite login failure would be an
// error instead of the sample imagery.
const FALLBACK_FIXTURES = ["./fixtures/ndvi-sample.json", "./fixtures/truecolor.png"];

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/field": FALLBACK_FIXTURES,
    "/api/cron/weekly-check": FALLBACK_FIXTURES,
  },
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
