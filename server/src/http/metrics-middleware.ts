// OWNER: backend
//
// The Hono half of IDEA-039 P1. Kept separate from metrics.ts so that module
// stays framework-free and unit-testable in isolation (same split as
// auth-middleware.ts vs the services it calls).
//
// Register this FIRST in index.ts. Outermost means the measurement includes
// everything a player waits for: CORS, the body cap, auth, argon2, the pool
// wait, the query, and JSON serialisation. A timer installed further in would
// report a number smaller than the truth, which is the one failure mode that
// makes metrics worse than none.

import type { Context, MiddlewareHandler } from "hono";
import { matchedRoutes } from "hono/route";
import { recordRequest, countSlowRequest, UNMATCHED_KEY } from "./metrics.js";

/** A pattern that only ever matched as middleware — `*`, `/*`, `/api/v1/*`. */
function isWildcard(path: string): boolean {
  return path === "" || path === "*" || path === "/*" || path.endsWith("/*");
}

/**
 * A bounded-cardinality label for the route that handled this request.
 *
 * Uses Hono's matched PATTERN, never `c.req.path` — the raw path contains
 * session uuids (`/api/v1/sessions/<uuid>/finish`), so keying on it would mint
 * a new metrics bucket per run played.
 *
 * WHY NOT `routePath(c, -1)`, which is the obvious call for this: "the last
 * root that matched" is not the handler once sibling sub-apps are mounted at
 * the same prefix. index.ts mounts profileRoutes AND sessionRoutes at `/` under
 * `/api/v1`, and each declares its own `use("*")` auth+rate-limit stack, so a
 * request to `/api/v1/profile` matches:
 *
 *     ALL:/*  |  ALL:/api/v1/*  |  ALL:/api/v1/*  |  GET:/api/v1/profile  |  ALL:/api/v1/*
 *                                                                            ^ .at(-1)
 *
 * The real handler sits in the MIDDLE, and the last entry is the OTHER
 * sub-app's wildcard. Taking `.at(-1)` filed `/api/v1/profile`, the leaderboard
 * and every login under `(unmatched)` — found by curling a running server, not
 * by the unit tests, because a test app without sibling mounts does not
 * reproduce it. The tests now build the real shape.
 *
 * So: scan matchedRoutes from the end for the last CONCRETE pattern. Nothing
 * concrete means nothing but wildcard middleware ran — a genuine 404.
 */
export function routeKey(c: Context): string {
  let pattern = "";
  try {
    const routes = matchedRoutes(c);
    for (let i = routes.length - 1; i >= 0; i--) {
      const path = routes[i]?.path ?? "";
      if (!isWildcard(path)) {
        pattern = path;
        break;
      }
    }
  } catch {
    // Defensive: a Hono version that cannot resolve the match must degrade to
    // one bucket, never to a raw path.
    return `${c.req.method} ${UNMATCHED_KEY}`;
  }

  // A 404, a scanner, a probe. Bucketed together so a bot walking /wp-admin,
  // /.env and friends cannot mint a key each.
  if (pattern === "") return `${c.req.method} ${UNMATCHED_KEY}`;

  // Hono normalises a bare mount to "/" — collapse "/api/v1/" to "/api/v1".
  const normalised =
    pattern.length > 1 && pattern.endsWith("/") ? pattern.slice(0, -1) : pattern;

  return `${c.req.method} ${normalised}`;
}

export interface MetricsMiddlewareOptions {
  /** A single request slower than this is logged immediately, rather than
   *  waiting for the next flush. Tuned via SLOW_REQUEST_MS. */
  slowRequestMs: number;
}

export function metricsMiddleware(
  options: MetricsMiddlewareOptions,
): MiddlewareHandler {
  return async (c, next) => {
    const startedAt = Date.now();
    try {
      await next();
    } finally {
      // Verified against Hono 4.13: `next()` does NOT rethrow into outer
      // middleware — the app-level onError runs INSIDE the chain and converts
      // the error to a response first. So by the time this runs, `c.res.status`
      // is already the real final status: 500 for an unhandled throw, and the
      // ApiError's own 404/409/429 for a handled one. That is exactly what the
      // 4xx/5xx columns need; deriving the status from a caught error instead
      // would have filed every ApiError as a 5xx and made the error columns
      // lie. Still a `finally` rather than a plain sequence, so that a future
      // middleware registered outside this one cannot make an early return
      // skip the measurement.
      const durationMs = Date.now() - startedAt;
      const status = c.res?.status ?? 500;
      recordRequest(routeKey(c), status, durationMs);

      if (durationMs >= options.slowRequestMs) {
        countSlowRequest();
        // Method + PATTERN, never the raw path or query — the path carries
        // session ids and the query could carry anything.
        console.warn(
          `[slow] ${routeKey(c)} took ${durationMs}ms (status ${status})`,
        );
      }
    }
  };
}
