// OWNER: backend
//
// /api/v1/auth/* — signup, login, recover, logout, me.
//
// Routes stay thin: parse the body, call the service, shape the response. All
// rules live in services/authService.ts.
//
// Rate limits here are the primary brute-force defence (see http/rate-limit.ts
// for why they matter more than argon2's cost parameters). /auth/recover gets
// the tightest limit because a recovery code is a complete credential — it
// bypasses the password entirely.

import { Hono } from "hono";
import * as authService from "../services/authService.js";
import { requireAuth, type AuthVars } from "../http/auth-middleware.js";
import { rateLimit, bodyField } from "../http/rate-limit.js";
import { toPublicProfile, toPublicUser } from "../repo/types.js";
import { readBody } from "../http/body.js";

export const authRoutes = new Hono<{ Variables: AuthVars }>();

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// --- signup -----------------------------------------------------------------

authRoutes.post(
  "/signup",
  rateLimit({ name: "signup", limit: 5, windowMs: HOUR }),
  async (c) => {
    const body = await readBody(c);
    const result = await authService.signup(body.username, body.password);

    // 201: the only response that ever carries a plaintext recoveryCode.
    return c.json(result, 201);
  },
);

// --- login ------------------------------------------------------------------

authRoutes.post(
  "/login",
  // Keyed by IP *and* username: one IP can't grind every account, and one
  // account can't be ground from a botnet.
  rateLimit({
    name: "login",
    limit: 10,
    windowMs: 15 * MINUTE,
    keyFrom: bodyField("username"),
  }),
  async (c) => {
    const body = await readBody(c);
    const result = await authService.login(body.username, body.password);
    return c.json(result, 200);
  },
);

// --- recover ----------------------------------------------------------------

authRoutes.post(
  "/recover",
  // The tightest limit in the API. A recovery code is a full credential and
  // this endpoint is the only way to use one, so it's the single most valuable
  // thing to brute-force. 60 bits of entropy makes guessing hopeless anyway;
  // this makes it hopeless *and* cheap to refuse.
  rateLimit({
    name: "recover",
    limit: 5,
    windowMs: HOUR,
    keyFrom: bodyField("username"),
  }),
  async (c) => {
    const body = await readBody(c);
    const result = await authService.recover(
      body.username,
      body.recoveryCode,
      body.newPassword,
    );
    // Carries the NEW single-use code — the client must display it with the
    // same prominence as the original, on the same blocking screen.
    return c.json(result, 200);
  },
);

// --- logout -----------------------------------------------------------------

authRoutes.post("/logout", requireAuth, async (c) => {
  await authService.logout(c.get("tokenPlaintext"));
  return c.body(null, 204);
});

// --- me ---------------------------------------------------------------------

/** Boot-time token check: the client calls this on load to decide between
 *  "restore the session" and "show the auth gate". */
authRoutes.get("/me", requireAuth, (c) => {
  const user = c.get("user");
  return c.json({ user: toPublicUser(user), profile: toPublicProfile(user) });
});
