// OWNER: backend
//
// CORS — an explicit allowlist, never "*" (STACK.md §2.5).
//
// Two things worth knowing, because both have bitten people before:
//
// 1. An `Origin` header is scheme + host + port ONLY. The frontend lives at
//    https://beaglechomp.nunoamorim.dev/ — the PATH is never part of the
//    Origin, which is why the allowlist is a list of bare origins.
//
//    That distinction used to matter a lot: the game was also published to
//    https://nunoamorim99.github.io/beagle-chomp/, and since the path is not
//    part of the Origin, allowing it meant allowing EVERY project on that
//    github.io account to call this API. That deploy is gone (the workflow
//    predated the move to Cloudflare Pages at v5.0 and was never removed; the
//    site is now unpublished), so CORS_ORIGINS should list the Cloudflare
//    origin and nothing else. If a github.io entry is still set in Dokploy's
//    env, remove it — it grants a shared origin nothing here needs.
//
// 2. `credentials` is deliberately NOT enabled. We use bearer tokens
//    (STACK.md §2.2), so cookies are never sent cross-origin, and leaving
//    Access-Control-Allow-Credentials off removes a whole class of foot-gun.

import { cors } from "hono/cors";
import { env } from "../env.js";

export const corsMiddleware = cors({
  origin: (origin) => {
    // Requests with no Origin header (curl, health checks, same-origin
    // navigations) are not CORS requests at all — let them through untouched.
    if (!origin) return undefined;
    return env.CORS_ORIGINS.includes(origin) ? origin : null;
  },
  allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
  maxAge: 86_400,
  credentials: false,
});
