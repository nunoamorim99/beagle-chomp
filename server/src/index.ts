// OWNER: backend
//
// The Hono app + server bootstrap for the Beagle Chomp API.
//
// Increment 0 scope: GET /health ONLY. This exists to prove the deployment path
// end-to-end — Dokploy builds the subfolder Dockerfile, Traefik routes it, the
// Cloudflare Origin Certificate terminates TLS behind the orange cloud — before
// any product code is at stake. Auth, profile, sessions and leaderboard routes
// land in later increments (see the approved plan).
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
// (STACK.md §2.4). Empty in Increment 0 beyond this identifying stub.
const v1 = new Hono();
v1.get("/", (c) => c.json({ api: "beagle-chomp", version: APP_VERSION }));
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
