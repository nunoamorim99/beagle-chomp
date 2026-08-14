# Beagle Chomp API — multi-stage build for Dokploy (STACK.md §10).
#
# IMPORTANT — build context is the REPO ROOT, not server/.
# In Dokploy set:
#   Docker Context Path : .
#   Dockerfile Path     : server/Dockerfile
# The context must be the root so later increments can COPY src/game/* into
# vendor/ — the plausibility validator shares the game's real constants
# (SCORE, SPEEDS, TIMING, maze pellet counts) rather than a hand-copied
# duplicate that would silently drift on the next rebalance.
#
# Base image is bookworm-slim, NOT alpine, on purpose: @node-rs/argon2 (arriving
# in Increment 1) ships prebuilt binaries for glibc only. On musl it either
# fails to install or falls back to a slower build, and the failure shows up in
# the container rather than locally. ~80 MB extra removes that whole class of
# problem.

# ---------------------------------------------------------------------------
# deps — install once, cached until a lockfile changes
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS deps
WORKDIR /app

COPY server/package*.json ./
# `npm ci` needs a lockfile; fall back to `npm install` on first run before one
# is committed, so a fresh clone can build.
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# ---------------------------------------------------------------------------
# dev — hot reload, used by docker-compose only (never deployed)
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS dev
WORKDIR /app
ENV NODE_ENV=development

COPY --from=deps /app/node_modules ./node_modules
COPY server/package*.json ./
COPY server/tsconfig.json ./
COPY server/src ./src
COPY server/scripts ./scripts
COPY server/migrations ./migrations

EXPOSE 3000
# Migrations run before the server starts, so the schema is never behind the code.
#
# Two details that both affect signal handling:
#   `exec`  — without it the shell stays PID 1, swallows SIGTERM, and docker
#             stop waits out the grace period then SIGKILLs (exit 137).
#   direct binary instead of `npx` — npx wraps the child in another process that
#             intercepts SIGTERM and exits 1 ("npm error signal SIGTERM"), so
#             the app's own shutdown handler never runs.
CMD ["sh", "-c", "node_modules/.bin/tsx scripts/migrate.ts && exec node_modules/.bin/tsx watch src/index.ts"]

# ---------------------------------------------------------------------------
# build — typecheck + compile to dist/
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY server/package*.json ./
COPY server/tsconfig.json ./
COPY server/src ./src
COPY server/scripts ./scripts

# tsc emits dist/src/** and dist/scripts/** (rootDir is server/), so the
# runtime paths below are dist/src/index.js and dist/scripts/migrate.js.
RUN npx tsc

# Drop devDependencies for the runtime layer.
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

# ---------------------------------------------------------------------------
# prod — the deployed image
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS prod
WORKDIR /app
ENV NODE_ENV=production

# curl is used by HEALTHCHECK below. --no-install-recommends keeps it minimal.
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY server/package.json ./
# Migrations are read from disk at runtime by the migrate script — they are
# .sql, not compiled, so they must be copied separately.
COPY server/migrations ./migrations

# Run unprivileged. The `node` user ships with the base image.
USER node

EXPOSE 3000

# Container-level liveness. Dokploy/Traefik use this to know when a new deploy
# is actually ready to take traffic. start-period covers migration time.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/health || exit 1

# Migrate, then serve. If a migration fails the container exits non-zero and
# Dokploy keeps the previous version running rather than serving a broken schema.
#
# `exec` makes node PID 1 so it actually receives SIGTERM. Every Dokploy
# redeploy sends one; without exec the shell absorbs it and Docker SIGKILLs
# after the grace period (exit 137), cutting off in-flight requests — which
# would mean killing a recovery-code or purchase transaction mid-write.
CMD ["sh", "-c", "node dist/scripts/migrate.js && exec node dist/src/index.js"]
