// OWNER: backend
//
// The Hono app + server bootstrap for the Beagle Chomp API.
//
// Increment 1 scope: auth (signup/login/recover/logout/me), profile
// (read/equip/purchase/delete) and the classic-mode leaderboard. Game sessions
// and score submission arrive in Increment 2.
//
// Conventions enforced here (STACK.md §2):
//   §2.1 JSON only, including errors and 404s — see notFound/onError below.
//   §2.4 Versioned paths: everything product-facing under /api/v1.
//        /health is the deliberate exception (infrastructure, never versioned).
//   §2.5 CORS allowlist, never "*".

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { env } from "./env.js";
import { closeDb } from "./db.js";
import { corsMiddleware } from "./http/cors.js";
import { ApiError } from "./http/errors.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { profileRoutes } from "./routes/profile.js";
import { sessionRoutes } from "./routes/sessions.js";
import { sweepStaleSessions } from "./services/scoreService.js";
import { APP_VERSION } from "./version.js";

const app = new Hono();

app.use("*", corsMiddleware);

// Reject oversized bodies early. Nothing this API accepts is large; a cap keeps
// a malformed or hostile request from turning into memory pressure on a VPS
// that also runs Postgres for other projects.
const MAX_BODY_BYTES = 8 * 1024;
app.use("*", async (c, next) => {
  const declared = c.req.header("content-length");
  if (declared && Number(declared) > MAX_BODY_BYTES) {
    return c.json(
      {
        error: {
          code: "VALIDATION_FAILED",
          message: "Request body too large.",
        },
      },
      413,
    );
  }
  await next();
  return undefined;
});

// --- Routes -----------------------------------------------------------------

// Infrastructure. Not versioned, on purpose (STACK.md §2.8).
app.route("/", healthRoutes);

// Product surface. Versioned so installed apps keep working when v2 ships
// (STACK.md §2.4).
const v1 = new Hono();
v1.get("/", (c) => c.json({ api: "beagle-chomp", version: APP_VERSION }));
v1.route("/auth", authRoutes);
// profileRoutes and sessionRoutes declare their own full paths (/profile,
// /leaderboard, /sessions/*) because each shares one auth+rate-limit middleware
// stack across paths that sit at different roots.
v1.route("/", profileRoutes);
v1.route("/", sessionRoutes);
app.route("/api/v1", v1);

// --- JSON-only error handling (STACK.md §2.1) -------------------------------

app.notFound((c) =>
  c.json(
    { error: { code: "NOT_FOUND", message: "Not found." } },
    404,
  ),
);

app.onError((err, c) => {
  if (err instanceof ApiError) {
    // Expected, handled failures. Log only the server-side detail, never send it.
    if (err.status >= 500) {
      console.error(`[api] ${err.code}:`, err.message, err.detail ?? "");
    }
    return c.json(err.toBody(), err.status);
  }

  // Anything else is a bug. Log it fully; tell the client nothing about it —
  // stack traces and driver messages can leak schema and file paths.
  console.error("[api] unhandled error:", err);
  return c.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Something went wrong. Please try again.",
      },
    },
    500,
  );
});

// --- Server bootstrap -------------------------------------------------------

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(
    `[api] beagle-chomp ${APP_VERSION} listening on :${info.port} ` +
      `(${env.NODE_ENV}) · CORS: ${env.CORS_ORIGINS.join(", ") || "(none)"}`,
  );
});

// Abandon runs whose players never came back — a quit-to-menu deliberately
// never finishes its session (a quit isn't a score), so without this they'd
// accumulate forever.
//
// The THRESHOLD (in scoreService) is 4 hours, matching the validator's
// SESSION_TOO_OLD bound — an open session younger than that might be a run
// still being played, and sweeping one mid-game was the bug that silently ate
// every score over ~10 minutes. The interval below is only how often the GC
// looks, not how old a session must be; and even a wrongly swept session is
// recoverable, because a finish resurrects it (see finishSession).
const SWEEP_INTERVAL_MS = 10 * 60_000;
const sweeper = setInterval(() => {
  void sweepStaleSessions()
    .then((count) => {
      if (count > 0) console.log(`[sweep] abandoned ${count} stale session(s)`);
    })
    .catch((err: unknown) => {
      // Housekeeping only: a failed sweep is not worth crashing the API over.
      console.error("[sweep] failed:", err);
    });
}, SWEEP_INTERVAL_MS);
sweeper.unref();

// Docker sends SIGTERM on `docker stop` and on every Dokploy redeploy. Draining
// the HTTP server and the pg pool avoids killing in-flight requests mid-write —
// which matters most for the transactional flows (recovery-code consumption,
// purchases) that land in Increment 1.
let shuttingDown = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[api] ${signal} received, shutting down…`);

    // Don't hang forever if a connection refuses to close.
    const forceExit = setTimeout(() => {
      console.error("[api] graceful shutdown timed out, exiting");
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    server.close(() => {
      void closeDb().then(
        () => process.exit(0),
        (err: unknown) => {
          console.error("[api] error closing db:", err);
          process.exit(1);
        },
      );
    });
  });
}
