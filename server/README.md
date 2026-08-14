# Beagle Chomp API

The backend for player accounts (IDEA-019) and the shared leaderboard (IDEA-020).
Deploys to the platform described in the repo-root `STACK.md`: Docker on the Hetzner
VPS, built and run by Dokploy, routed by Traefik, behind the Cloudflare orange cloud.

**Status: Increment 0 — `GET /health` only.** This exists to prove the deployment path
end to end (subfolder Dockerfile → Dokploy → Traefik → Origin Certificate) before any
product code is at stake. Auth, profile, sessions and leaderboard arrive in Increments 1–3.

## Stack

Hono · Node 22 · Postgres (`pg`, no ORM) · zod. No Redis, no ORM, no framework beyond
Hono — per `STACK.md` §0 and §6.

**Deviation from `STACK.md` §1, recorded deliberately:** auth is hand-rolled
(~250 lines: argon2id + opaque bearer tokens) rather than Better Auth. The single-use
recovery-code flow — the core of IDEA-019 — has no Better Auth equivalent, and
bearer-first is native here rather than adapted from its cookie-session model.

## Local development

```bash
# Postgres + API in containers; Vite on the host (fastest on Windows)
docker compose up db api      # from the REPO ROOT, not server/
npm run dev                   # separate terminal, repo root

# Everything in Docker instead
docker compose --profile full up
```

- API: **http://localhost:3001** (host 3001 → container 3000; host 3000 is taken by
  another project on this machine)
- Postgres: **localhost:5433** (5432 avoided so it can't collide with a local install)
- Migrations run automatically on container start, before the server binds.

Running the API outside Docker:

```bash
cd server
npm install
cp .env.example .env          # then edit DATABASE_URL
npm run migrate
npm run dev
```

## Layout

```
src/
  index.ts          Hono app, JSON-only error handling, graceful shutdown
  env.ts            zod-validated environment; fails fast at boot
  db.ts             pg Pool, query(), withTransaction(), pingDb()
  version.ts        APP_VERSION, reported by /health
  http/             cors.ts · errors.ts (the ApiError envelope)
  routes/           health.ts   (+ auth, profile, sessions, leaderboard later)
  repo/             the ONLY place SQL lives (STACK.md §2.7)   [Increment 1]
  services/         business logic between routes and repos     [Increment 1]
  auth/             hash.ts · tokens.ts · recoveryCode.ts       [Increment 1]
  validation/       plausibility.ts — pure, heavily tested      [Increment 2]
migrations/         NNN_description.sql, applied in filename order
scripts/migrate.ts  the migration runner
vendor/game/        game modules copied from ../src/game (gitignored, generated)
```

## Migrations

Numbered `.sql` files, each applied once inside its own transaction, tracked in
`schema_migrations` with a sha256 checksum.

**Never edit a migration that has been applied anywhere — add a new one.** The runner
compares checksums and refuses to start if an applied file changed, because otherwise
the database silently stops matching the repo and only diverges further on the next
fresh environment.

## Conventions this API follows (`STACK.md` §2)

| # | Rule | Where |
|---|---|---|
| 2.1 | JSON only, including errors and 404s | `src/index.ts` `notFound`/`onError` |
| 2.2 | Bearer tokens, not cookie sessions | `auth_tokens` table; no `credentials` in CORS |
| 2.3 | Own subdomain `beaglechomp-api.nunoamorim.dev` | Dokploy domain config |
| 2.4 | Versioned paths under `/api/v1` | `src/index.ts`; `/health` is the deliberate exception |
| 2.5 | CORS allowlist, never `*` | `src/http/cors.ts` + `CORS_ORIGINS` |
| 2.6 | Secrets via env vars, `.env.example` committed | `src/env.ts`, `.env.example` |
| 2.7 | Data access behind a repository layer | `src/repo/*` — nothing else imports `query` |
| 2.8 | `GET /health` returns 200 + JSON | `src/routes/health.ts` |

`/health` returns **503** when Postgres is unreachable, so Docker's HEALTHCHECK and
UptimeRobot both see a real failure instead of a false green.

## Deploying (Dokploy)

1. **Cloudflare:** A record `beaglechomp-api` → VPS IP, **orange cloud on**.
2. **Postgres:** in the `beagle-chomp` Dokploy project, create a **PostgreSQL service**
   (`STACK.md` §1, as amended 2026-08-14: one Postgres service per project, managed in
   the panel). Database `beaglechomp`, user `beaglechomp`, image `postgres:17-alpine` (matching História).
   Set a **512 MB memory limit** on it — without one, a runaway query here can get
   another project's container OOM-killed, defeating the point of the per-project split.
   Add the database to the nightly `pg_dump`→R2 job (§3.4).
3. **Dokploy → Application**, provider = the `dokploy-nunoamorim` GitHub App,
   repo `beagle-chomp`, branch `main`, build type **Dockerfile**:
   - **Docker Context Path:** `.`  ← repo root, *not* `server/`
   - **Dockerfile Path:** `server/Dockerfile`

   The context must be the root so later increments can copy `src/game/*` into
   `vendor/` — the plausibility validator shares the game's real constants rather
   than a duplicate that would drift on the next rebalance.
4. **Domain:** `beaglechomp-api.nunoamorim.dev`, container port **3000**, HTTPS on,
   certificate = the existing `*.nunoamorim.dev` **Cloudflare Origin Certificate**
   (Dokploy → Certificates). Cloudflare SSL mode **Full (strict)**.
5. **Env vars** (Dokploy UI, never git): `DATABASE_URL`, `NODE_ENV=production`,
   `PORT=3000`, `CORS_ORIGINS=https://beaglechomp.nunoamorim.dev`, `TOKEN_TTL_DAYS=90`.
6. **Reliability** (`STACK.md` §3): memory limit **384 MB**, `restart: unless-stopped`,
   add `beaglechomp` to the nightly `pg_dump`→R2 job, add
   `https://beaglechomp-api.nunoamorim.dev/health` to UptimeRobot.
7. Push to `main` → auto build → verify:
   ```bash
   curl https://beaglechomp-api.nunoamorim.dev/health
   # {"ok":true,"db":"up","version":"0.1.0"}
   ```

Per `STACK.md` §10, this is the low-stakes app that proves the orange-cloud + Origin
Certificate method **before** História's irreplaceable data migrates. Confirm step 7
returns JSON over HTTPS before moving on.

## Notes

- Base image is `node:22-bookworm-slim`, **not alpine**: `@node-rs/argon2` (Increment 1)
  ships prebuilt binaries for glibc only, and musl failures surface in the container
  rather than locally.
- Both `CMD`s use `exec` and call binaries directly rather than through `npx`. Without
  either, SIGTERM is absorbed before it reaches Node and Docker force-kills after the
  grace period — which on a Dokploy redeploy would cut off in-flight transactions.
