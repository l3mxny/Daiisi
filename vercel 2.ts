import type { VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  // Sundays at 00:00 UTC — recomputes each field's weather/NDVI/severity
  // and records a stress_events snapshot for the week.
  crons: [{ path: "/api/cron/weekly-check", schedule: "0 0 * * 0" }],
};
