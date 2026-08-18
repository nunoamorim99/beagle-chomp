// OWNER: backend
//
// /api/v1/profile/* and /api/v1/leaderboard — everything tied to an account.
// All of it requires a bearer token.

import { Hono } from "hono";
import * as profileService from "../services/profileService.js";
import { requireAuth, type AuthVars } from "../http/auth-middleware.js";
import { rateLimit } from "../http/rate-limit.js";
import { readBody } from "../http/body.js";
import { ApiError } from "../http/errors.js";

export const profileRoutes = new Hono<{ Variables: AuthVars }>();

// Generous ceiling: enough that normal play never notices, low enough that a
// runaway client loop can't hammer the database.
profileRoutes.use("*", rateLimit({ name: "profile", limit: 120, windowMs: 60_000 }));
profileRoutes.use("*", requireAuth);

// --- read -------------------------------------------------------------------

profileRoutes.get("/profile", (c) =>
  c.json({ profile: profileService.getProfile(c.get("user")) }),
);

// --- equip ------------------------------------------------------------------

profileRoutes.patch("/profile/equipped", async (c) => {
  const body = await readBody(c);
  const profile = await profileService.equip(c.get("user"), {
    beagleSkinId: body.beagleSkinId,
    enemySkinId: body.enemySkinId,
    mazeThemeId: body.mazeThemeId,
  });
  return c.json({ profile });
});

// --- settings ---------------------------------------------------------------

/** IDEA-038: swipe vs on-screen D-pad. A per-account preference, so it follows
 *  the player to any device they sign in from. */
profileRoutes.patch("/profile/settings", async (c) => {
  const body = await readBody(c);
  const userId = c.get("user").id;

  // Both settings share one endpoint and each is optional, so a client can
  // send either without clobbering the other.
  let profile = null;
  if (body.controlScheme !== undefined) {
    profile = await profileService.setControlScheme(userId, body.controlScheme);
  }
  if (body.tutorialDone !== undefined) {
    profile = await profileService.setTutorialDone(userId, body.tutorialDone);
  }
  if (profile === null) {
    throw new ApiError(400, "VALIDATION_FAILED", "No settings supplied.");
  }
  return c.json({ profile });
});

// --- purchase ---------------------------------------------------------------

/** The client sends only WHAT it wants, never what it costs — the price comes
 *  from the server's own catalog. */
profileRoutes.post("/profile/purchase", async (c) => {
  const body = await readBody(c);
  const profile = await profileService.purchase(
    c.get("user").id,
    body.kind,
    body.id,
  );
  return c.json({ profile });
});

// --- delete account ---------------------------------------------------------

profileRoutes.delete("/profile", async (c) => {
  const body = await readBody(c);
  await profileService.deleteAccount(c.get("user"), body.confirmUsername);
  return c.body(null, 204);
});

// --- leaderboard ------------------------------------------------------------

/** Classic mode only — challenge runs never write high_score. */
profileRoutes.get("/leaderboard", async (c) => {
  const result = await profileService.leaderboard(
    c.get("user"),
    c.req.query("limit"),
  );
  return c.json(result);
});

/** Every accepted classic RUN, one row per attempt — so a player can hold
 *  several places, podium included. Separate from /leaderboard, which folds
 *  each player down to their personal best. */
profileRoutes.get("/leaderboard/runs", async (c) => {
  const result = await profileService.runBoard(
    c.get("user"),
    c.req.query("limit"),
  );
  return c.json(result);
});
