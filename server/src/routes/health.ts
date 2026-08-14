// OWNER: backend
//
// GET /health — required on every API by STACK.md §2.8, used by the Docker
// HEALTHCHECK, by Dokploy, and by UptimeRobot (STACK.md §3.7).
//
// Deliberately NOT under /api/v1: it is infrastructure, not product surface, so
// it must never be versioned away. Everything else lives under /api/v1 (§2.4).
//
// `version` exists for the client-side version handshake described in the plan:
// an installed PWA can be running a precached shell older than the deployed
// API, and comparing this against the frontend's build version lets the client
// prompt a reload instead of failing in confusing ways.

import { Hono } from "hono";
import { pingDb } from "../db.js";
import { APP_VERSION } from "../version.js";

export const healthRoutes = new Hono();

healthRoutes.get("/health", async (c) => {
  const dbUp = await pingDb();

  // 503 when the DB is down so UptimeRobot and Docker both see a real failure —
  // a 200 with {"db":"down"} would look healthy to every automated checker.
  return c.json(
    {
      ok: dbUp,
      db: dbUp ? "up" : "down",
      version: APP_VERSION,
    },
    dbUp ? 200 : 503,
  );
});
