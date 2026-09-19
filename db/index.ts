import { Pool } from "pg";
import { attachDatabasePool } from "@vercel/functions";

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
