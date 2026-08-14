// OWNER: backend
//
// /api/v1/sessions/* — server-issued run tickets and score submission.

import { Hono } from "hono";
import * as scoreService from "../services/scoreService.js";
import { requireAuth, type AuthVars } from "../http/auth-middleware.js";
import { rateLimit } from "../http/rate-limit.js";
import { readBody } from "../http/body.js";

export const sessionRoutes = new Hono<{ Variables: AuthVars }>();

sessionRoutes.use("*", requireAuth);

/** Start a run. The response's session id is the ONLY thing that makes a later
 *  score submittable, and its start time is written by Postgres — so a client
 *  cannot backdate a run to make an impossible score look like it had time to
 *  happen. */
sessionRoutes.post(
  "/sessions/start",
  // A generous ceiling on runs per hour: enough that quitting and restarting
  // repeatedly is fine, low enough to stop a script farming session ids.
  rateLimit({ name: "session-start", limit: 60, windowMs: 60 * 60_000 }),
  async (c) => {
    const body = await readBody(c);
    const result = await scoreService.startSession(
      c.get("user"),
      body.mode,
      body.challengeIdx,
    );
    return c.json(result, 201);
  },
);

/** Finish a run and submit its score.
 *
 *  A rejected score returns HTTP 200 with `accepted: false`, deliberately: an
 *  implausible run is a normal outcome here, not a malformed request. 4xx is
 *  reserved for actual client errors (unknown session, already finished). */
sessionRoutes.post("/sessions/:id/finish", async (c) => {
  const body = await readBody(c);
  const result = await scoreService.finishSession(
    c.get("user"),
    c.req.param("id"),
    body,
  );
  return c.json(result, 200);
});
