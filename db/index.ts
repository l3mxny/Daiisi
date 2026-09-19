import { Pool, types } from "pg";
import { attachDatabasePool } from "@vercel/functions";

// node-postgres's default DATE (oid 1082) parser converts to a JS Date at
// local-timezone midnight, which then serializes back out shifted by the
// server's UTC offset (e.g. a stored "2026-03-14" round-tripping as
// "2026-03-14T04:00:00.000Z"), and breaks any plain string date math
// downstream. Keep it as the raw "yyyy-mm-dd" string Postgres sends instead.
types.setTypeParser(1082, (value) => value);

// Lazy singleton, not a Proxy (a Proxy around the pool breaks libraries that
// introspect the client object). DATABASE_URL is only read the first time a
// query actually runs, so importing this module doesn't crash `next build`
// before the env var exists.
let pool: Pool | null = null;

export function getDb(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    // Lets Fluid Compute keep this pool alive and reused across invocations
    // on the same instance instead of opening a fresh connection per request.
    attachDatabasePool(pool);
  }
  return pool;
}
