// OWNER: backend
//
// Bearer-token authentication. Resolves `Authorization: Bearer <token>` to a
// user row and hangs it on the context for downstream handlers.

import type { Context, MiddlewareHandler } from "hono";
import { parseBearerHeader, hashToken } from "../auth/tokens.js";
import * as tokensRepo from "../repo/tokens.js";
import type { UserRow } from "../repo/types.js";
import { unauthorized } from "./errors.js";
import { env } from "../env.js";

export interface AuthVars {
  user: UserRow;
  /** The presenting token, so logout can revoke exactly this session. */
  tokenPlaintext: string;
}

export type AuthedContext = Context<{ Variables: AuthVars }>;

export const requireAuth: MiddlewareHandler<{ Variables: AuthVars }> = async (
  c,
  next,
) => {
  const token = parseBearerHeader(c.req.header("Authorization"));
  if (!token) throw unauthorized();

  const user = await tokensRepo.findUserByToken(hashToken(token));
  // Covers unknown, revoked AND expired tokens — the lookup filters on
  // expires_at in SQL, so an expired token can never authenticate.
  if (!user) throw unauthorized("Your session has expired. Please sign in again.");

  c.set("user", user);
  c.set("tokenPlaintext", token);

  await next();

  // Sliding expiry, after the response is produced so it never delays a
  // request. The repo throttles this to at most one write per day per token.
  void tokensRepo.touchToken(hashToken(token), env.TOKEN_TTL_DAYS).catch(() => {
    // Best-effort: failing to extend a token is not worth failing a request the
    // user already got an answer to.
  });
};
