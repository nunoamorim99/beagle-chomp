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

/** Collapse a multi-line SQL literal to one log-friendly line, truncated. The
 *  statements in repo/* are written across many indented lines for readability;
 *  dumped raw they would each be a dozen log lines. */
function oneLine(sql: string, max = 160): string {
  const flat = sql.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** Run a parameterised query. Always pass values as `params` — never
 *  interpolate into the SQL string.
 *
 *  IDEA-039 P1: also the one place every statement in the app passes through,
 *  so it is where slow-query detection belongs. This module's own header
 *  promised the seam — "adding a cache later (or a read replica, or QUERY
 *  LOGGING) is a single-layer change" — and this is that change.
 *
 *  Only the SQL TEXT is logged, never `params`: those carry usernames, token
 *  hashes and recovery codes, and a log line is the last place any of them
 *  should appear. The text alone identifies the statement uniquely enough. */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<pg.QueryResult<T>> {
  const startedAt = Date.now();
  try {
    return await pool.query<T>(text, params as unknown[]);
  } finally {
    const durationMs = Date.now() - startedAt;
    if (durationMs >= env.SLOW_QUERY_MS) {
      // STACK.md §6 trigger #1 for Redis is "a query measurably exceeds
      // ~200 ms". If this line starts appearing regularly, that is the
      // evidence — not a hunch.
      console.warn(`[slow-query] ${durationMs}ms · ${oneLine(text)}`);
    }
  }
}

/** Wrap a pooled client so statements run inside a transaction are timed too.
 *
 *  Without this, slow-query logging would have a hole exactly where the
 *  heaviest work happens: the transactional flows (recovery-code consumption
 *  under FOR UPDATE, purchases, score finishing) never touch `query()` above —
 *  they call `client.query` directly.
 *
 *  Every member other than `query` is forwarded BOUND TO THE REAL CLIENT rather
 *  than to the proxy. That matters: pg's internals (and `release`) must see
 *  their own object as `this`, not a wrapper. */
function timed(client: pg.PoolClient): pg.PoolClient {
  return new Proxy(client, {
    get(target, prop) {
      if (prop === "query") {
        return (text: unknown, ...rest: unknown[]) => {
          const startedAt = Date.now();
          const done = () => {
            const durationMs = Date.now() - startedAt;
            if (durationMs >= env.SLOW_QUERY_MS && typeof text === "string") {
              console.warn(`[slow-query·tx] ${durationMs}ms · ${oneLine(text)}`);
            }
          };
          // pg supports both a promise and a callback form. Only the promise
          // form is used in this codebase, but returning a non-promise
          // untouched keeps the proxy honest if that ever changes.
          const result = (target.query as (...a: unknown[]) => unknown)(text, ...rest);
          if (result instanceof Promise) return result.finally(done);
          done();
          return result;
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
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
    const result = await fn(timed(client));
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
