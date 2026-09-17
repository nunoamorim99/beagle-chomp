// OWNER: backend (IDEA-078)
//
// /api/v1/challenges — the goals-and-rewards ladder. Bearer token required.
//
// Two endpoints and a deliberately small surface: the list, and a claim. There
// is no "progress" write anywhere, because progress is DERIVED from run_stats
// (see repo/challenges.ts) — the client never tells the server how far along a
// challenge is, it asks.

import { Hono } from "hono";
import * as challengeService from "../services/challengeService.js";
import { requireAuth, type AuthVars } from "../http/auth-middleware.js";
import { rateLimit } from "../http/rate-limit.js";

export const challengeRoutes = new Hono<{ Variables: AuthVars }>();

// The list is one aggregate over one player's run_stats rows, so it is cheap
// but not free, and the screen refetches it on every open. The ceiling is sized
// like profile's: high enough that normal play never notices, low enough that a
// client stuck in a render loop cannot hammer the database.
challengeRoutes.use("*", rateLimit({ name: "challenges", limit: 120, windowMs: 60_000 }));
challengeRoutes.use("*", requireAuth);

challengeRoutes.get("/challenges", async (c) =>
  c.json(await challengeService.list(c.get("user"))),
);

/**
 * Take one reward.
 *
 * The id is a PATH parameter and the body is ignored entirely: there is nothing
 * a client could usefully say about a claim beyond which one, and accepting a
 * body would invite a future version to start trusting a number in it.
 */
challengeRoutes.post("/challenges/:id/claim", async (c) => {
  const result = await challengeService.claim(c.get("user").id, c.req.param("id"));
  return c.json(result);
});
