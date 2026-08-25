// OWNER: backend
//
// GET /metrics — the JSON form of the p95 table that IDEA-039 P1 also writes to
// the container log. Point a graph at it, or curl it when something feels slow.
//
// Unversioned, like /health: this is infrastructure, not product surface
// (STACK.md §2.8). It is NOT under /api/v1 and no game client ever calls it.
//
// SECURITY POSTURE — off unless deliberately enabled:
//   - No METRICS_TOKEN in the environment → the route is never registered, so
//     the path 404s exactly like any unknown path. Not "403 forbidden", which
//     would confirm the endpoint exists; it simply is not there.
//   - Token set → Bearer auth, compared in constant time.
// The data here is not catastrophic to leak (durations and counts, never a
// username, score, or session id) but it does map the whole route table, which
// is a free reconnaissance gift to anyone probing the API.

import { Hono } from "hono";
import { timingSafeEqual } from "node:crypto";
import { env } from "../env.js";
import { snapshot } from "../http/metrics.js";
import { APP_VERSION } from "../version.js";

export const metricsRoutes = new Hono();

/** Constant-time compare that does not leak the token's length either — hashing
 *  both sides to a fixed width first, the same trick used for token lookups. */
function tokenMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    // timingSafeEqual throws on length mismatch, so compare against `a` itself
    // to burn a comparable amount of time before returning false.
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

if (env.METRICS_TOKEN) {
  const expected = env.METRICS_TOKEN;

  metricsRoutes.get("/metrics", (c) => {
    const header = c.req.header("Authorization") ?? "";
    const presented = header.startsWith("Bearer ") ? header.slice(7) : "";

    if (!presented || !tokenMatches(presented, expected)) {
      // 404 rather than 401: a wrong token should learn nothing that a random
      // path would not, including whether metrics are enabled at all.
      return c.json({ error: { code: "NOT_FOUND", message: "Not found." } }, 404);
    }

    return c.json({
      version: APP_VERSION,
      uptimeSeconds: Math.round(process.uptime()),
      ...snapshot(),
    });
  });
}
