// OWNER: backend
//
// CORS — an explicit allowlist, never "*" (STACK.md §2.5).
//
// Two things worth knowing, because both have bitten people before:
//
// 1. An `Origin` header is scheme + host + port ONLY. The Pages deploy lives at
//    https://beagle-chomp.nunoamorim.dev/ and (historically) at
//    https://nunoamorim99.github.io/beagle-chomp/ — but the PATH is never part
//    of the Origin. So the github.io allowlist entry is the bare origin, and it
//    would also allow any OTHER project on that same github.io account. That is
//    one more reason the plan moves the frontend to its own subdomain.
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
