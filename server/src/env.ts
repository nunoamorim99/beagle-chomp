// OWNER: backend
//
// Environment configuration, validated once at startup.
//
// STACK.md §2.6: "Secrets via environment variables, set in Dokploy's UI. Never
// commit secrets to git." This module is the single place env vars are read —
// everything else imports the parsed `env` object, so a typo in a variable name
// is a compile error rather than a silent `undefined` at 3am.
//
// Deliberately FAIL FAST: a missing DATABASE_URL should crash the container at
// boot with a readable message, not surface as a connection error on the first
// request. Dokploy will show the crash loop immediately.

import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  PORT: z.coerce.number().int().positive().default(3000),

  /** Postgres connection string for this project's OWN database (`beaglechomp`).
   *  One Postgres container is shared across projects, one database per project
   *  — see STACK.md §1. */
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  /** Comma-separated CORS allowlist. NEVER "*" (STACK.md §2.5). In production
   *  this is the Cloudflare Pages origin; in dev the Vite server is added
   *  automatically below so it doesn't have to be set by hand. */
  CORS_ORIGINS: z
    .string()
    .default("")
    .transform((s) =>
      s
        .split(",")
        .map((o) => o.trim())
        .filter((o) => o.length > 0),
    ),

  /** Bearer token lifetime. Sliding — see auth/tokens.ts (Increment 1). */
  TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(90),

  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  // --- IDEA-039 P1: request timing ------------------------------------------

  /** How often the p95-per-route table is written to the container log. */
  METRICS_LOG_INTERVAL_MIN: z.coerce.number().int().positive().default(10),

  /** A single request at or above this is logged the moment it finishes,
   *  instead of waiting for the next flush. 1000 ms rather than something
   *  tighter because a legitimate login spends real time in argon2 by design
   *  (auth/hash.ts) — a 200 ms threshold here would cry wolf on every sign-in.
   *  The p95 table, not this warning, is what shows a route drifting. */
  SLOW_REQUEST_MS: z.coerce.number().int().positive().default(1000),

  /** A single SQL statement at or above this is logged (text only, never
   *  params). 200 ms deliberately: STACK.md §6 names "a query measurably
   *  exceeds ~200 ms" as one of the two triggers for adding Redis, so this is
   *  the line that tells us the trigger fired rather than us guessing. */
  SLOW_QUERY_MS: z.coerce.number().int().positive().default(200),

  /** Bearer token for GET /metrics. UNSET (the default) means the endpoint does
   *  not exist at all — it 404s exactly like any unknown path, so nothing about
   *  the API's internals is advertised until you deliberately turn it on. */
  METRICS_TOKEN: z.string().min(16, "METRICS_TOKEN must be at least 16 characters").optional(),

  // --- IDEA-039 P2: game_sessions retention ---------------------------------

  /** Days an ABANDONED session is kept before deletion. 0 disables the purge.
   *
   *  Only 'abandoned' rows are ever eligible — see repo/gameSessions.ts
   *  deleteOldAbandonedSessions for why 'accepted' and 'rejected' must not be.
   *  90 days is absurdly generous next to the 4-hour window in which an
   *  abandoned session could still be resurrected by a late finish
   *  (MAX_RUN_HOURS), which is the point: at today's volume this deletes
   *  nothing, and it starts working on its own if volume ever arrives. */
  SESSION_RETENTION_DAYS: z.coerce.number().int().min(0).default(90),
});

function parseEnv() {
  const parsed = EnvSchema.safeParse(process.env);

  if (!parsed.success) {
    // Print every problem at once rather than one-per-restart.
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    console.error(`Invalid environment configuration:\n${issues}\n`);
    console.error("See server/.env.example for the full list of variables.");
    process.exit(1);
  }

  const env = parsed.data;
  const isProd = env.NODE_ENV === "production";

  // The Vite dev server is always allowed outside production. We deliberately
  // do NOT use a dev proxy (see the plan): the client talks to the API
  // cross-origin in dev exactly as it will in production, so CORS is exercised
  // locally and can't surprise us on deploy.
  //
  // A range of ports rather than just 5173, because Vite walks upward when a
  // port is taken — and on this machine another project already holds
  // 5173/5174, so Beagle Chomp's dev server routinely lands on 5175. Without
  // these, dev would fail CORS in a way that looks like a server bug.
  const devOrigins = [5173, 5174, 5175, 5176, 5177].flatMap((port) => [
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
  ]);

  const corsOrigins = isProd
    ? env.CORS_ORIGINS
    : [...new Set([...env.CORS_ORIGINS, ...devOrigins])];

  if (isProd && corsOrigins.length === 0) {
    console.error(
      "CORS_ORIGINS must list at least one origin in production — refusing to " +
        "start with an empty allowlist (STACK.md §2.5: allowlist, never '*').",
    );
    process.exit(1);
  }

  return { ...env, CORS_ORIGINS: corsOrigins, isProd } as const;
}

export const env = parseEnv();

export type Env = typeof env;
