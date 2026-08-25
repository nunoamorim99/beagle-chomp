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
import { metricsRoutes } from "./routes/metrics.js";
import { authRoutes } from "./routes/auth.js";
import { profileRoutes } from "./routes/profile.js";
import { sessionRoutes } from "./routes/sessions.js";
import { sweepStaleSessions, purgeOldSessions } from "./services/scoreService.js";
import { metricsMiddleware } from "./http/metrics-middleware.js";
import { snapshot, resetWindow, formatSnapshotLines } from "./http/metrics.js";
import { APP_VERSION } from "./version.js";

const app = new Hono();

// FIRST, deliberately (IDEA-039 P1). Outermost means the timing covers
// everything the player actually waits for — CORS, the body cap, auth, argon2,
// the pool wait, the query, serialisation. A timer registered after any of
// those would report a number lower than the truth.
app.use("*", metricsMiddleware({ slowRequestMs: env.SLOW_REQUEST_MS }));

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
// Registers GET /metrics only when METRICS_TOKEN is set; otherwise this mounts
// nothing at all and the path 404s like any unknown one.
app.route("/", metricsRoutes);

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
  console.log(
    `[api] metrics: p95 table every ${env.METRICS_LOG_INTERVAL_MIN}m · ` +
      `slow request ≥${env.SLOW_REQUEST_MS}ms · slow query ≥${env.SLOW_QUERY_MS}ms · ` +
      `GET /metrics ${env.METRICS_TOKEN ? "enabled" : "disabled (no METRICS_TOKEN)"} · ` +
      `session retention ${
        env.SESSION_RETENTION_DAYS > 0 ? `${env.SESSION_RETENTION_DAYS}d` : "off"
      }`,
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
      // Sweep first, THEN collect: the sweep is what ages a quit-to-menu into
      // an abandoned row, and the purge only ever touches abandoned rows that
      // are already SESSION_RETENTION_DAYS old. Chained rather than run in
      // parallel so two housekeeping statements never contend for the same
      // rows.
      return purgeOldSessions();
    })
    .then((deleted) => {
      // Silent when it deletes nothing, which at today's volume is every time —
      // a 90-day window on a table measured in megabytes is meant to be inert
      // until it isn't (IDEA-039 P2).
      if (deleted > 0) {
        console.log(`[purge] deleted ${deleted} abandoned session(s) past retention`);
      }
    })
    .catch((err: unknown) => {
      // Housekeeping only: a failed sweep is not worth crashing the API over.
      console.error("[sweep] failed:", err);
    });
}, SWEEP_INTERVAL_MS);
sweeper.unref();

// IDEA-039 P1: the p95-per-route table. This is the piece the idea says to do
// FIRST — without it the first real bottleneck gets diagnosed by a player
// saying the game feels slow, and the OTHER two pieces have no evidence to
// trigger on.
const METRICS_INTERVAL_MS = env.METRICS_LOG_INTERVAL_MIN * 60_000;
const metricsLogger = setInterval(() => {
  const lines = formatSnapshotLines(snapshot());
  // Empty when no traffic — an idle API must not print a table every ten
  // minutes forever, or the log stops being read at all.
  for (const line of lines) console.log(line);
  resetWindow();
}, METRICS_INTERVAL_MS);
metricsLogger.unref();

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

    // Flush the partial window before the process goes. Dokploy redeploys on
    // every push, so without this the timings from the minutes right before a
    // deploy — often the ones you most want after changing something — would be
    // thrown away unlogged.
    for (const line of formatSnapshotLines(snapshot())) console.log(line);

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
