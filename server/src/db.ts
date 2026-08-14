// OWNER: backend
//
// The Postgres connection pool. One pool per process.
//
// STACK.md §2.7: "Data access behind a service/repository layer, so adding a
// cache later is a one-file change." That means: NOTHING outside src/repo/*
// should import `query` or `pool` directly. Routes call services, services call
// repos, repos call this. Keeping that discipline is what makes a future cache
// (or a read replica, or query logging) a single-layer change.

import pg from "pg";
import { env } from "./env.js";

const { Pool } = pg;

/** Small pool: this is a personal game on a shared VPS, not a busy service.
 *  Postgres is shared with other projects (STACK.md §1), so holding a large
 *  idle pool would be antisocial. */
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// A pool error (e.g. Postgres restarted) is emitted on the pool, not on a
// query. Without this listener Node treats it as an unhandled 'error' event and
// kills the process. Log it and let the pool reconnect on the next query.
pool.on("error", (err) => {
  console.error("[db] idle client error:", err.message);
});

/** Run a parameterised query. Always pass values as `params` — never
 *  interpolate into the SQL string. */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params as unknown[]);
}

/** Run `fn` inside a transaction on a single dedicated client, committing on
 *  success and rolling back on any throw.
 *
 *  Several flows REQUIRE this rather than separate queries — most importantly
 *  recovery-code consumption (verify + reissue must be atomic under a
 *  `SELECT ... FOR UPDATE`, or a race could let one code be used twice) and
 *  purchases (deduct coins + grant the item, mirroring the atomicity the
 *  existing client-side `trySpend` guarantees). */
export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      // Rollback failing usually means the connection is already gone; the
      // original error is the useful one, so log and rethrow that.
      console.error("[db] rollback failed:", rollbackErr);
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Liveness probe for GET /health. Deliberately cheap and bounded: a health
 *  check that can hang is worse than one that fails. */
export async function pingDb(timeoutMs = 1_000): Promise<boolean> {
  try {
    await Promise.race([
      pool.query("SELECT 1"),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("db ping timeout")), timeoutMs),
      ),
    ]);
    return true;
  } catch {
    return false;
  }
}

export async function closeDb(): Promise<void> {
  await pool.end();
}
