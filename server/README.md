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
                    metrics.ts — pure, framework-free request timings
                    metrics-middleware.ts — the Hono half of the above
  routes/           health.ts · metrics.ts (+ auth, profile, sessions, leaderboard)
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

## Observability (IDEA-039)

Every request is timed by the outermost middleware, so the number covers what a
player actually waits for — CORS, auth, argon2, the pool wait, the query, and
serialisation.

**In the log** (Dokploy → the service's Logs tab):

```
[metrics] last 10.0m — 1841 req lifetime, 3 slow
[metrics] route                             n      p50      p95      max  4xx/5xx
[metrics] GET /api/v1/leaderboard         412    1.0ms    4.0ms   31.0ms  0/0
[metrics] POST /api/v1/auth/login          38  188.0ms  241.0ms  502.0ms  6/0
[slow] POST /api/v1/sessions/:id/finish took 1204ms (status 200)
[slow-query] 243ms · SELECT s.id, s.user_id, u.username, s.accepted_score …
```

Route labels are Hono's matched PATTERN, never the raw path, so a session uuid
can never mint a metrics bucket. Unmatched paths (scanners probing `/.env`,
`/wp-admin`) share one `(unmatched)` bucket. Nothing is logged for a window with
no traffic.

`[slow-query]` uses a 200 ms threshold on purpose: STACK.md §6 names "a query
measurably exceeds ~200 ms" as one of the two triggers for adding Redis. If that
line starts appearing regularly, the trigger has fired — and until it does,
Redis stays deferred. The other trigger is a second replica, which is also what
would make the in-memory rate limiter and board cache per-process.

**As JSON**: `GET /metrics`, unversioned like `/health`. It only exists when
`METRICS_TOKEN` is set; without it the path 404s like any unknown one, and a
wrong token gets the same 404 rather than a 401 that would confirm it exists.

```bash
curl -H "Authorization: Bearer $METRICS_TOKEN" https://beaglechomp-api.nunoamorim.dev/metrics
```

Bounded memory by construction: at most 64 route keys × 512 samples (~256 KB),
regardless of uptime or traffic. Per request the cost is two `Date.now()` calls
and one array write.

### Session retention

The sweeper interval also purges `game_sessions` rows that have been
**abandoned** for longer than `SESSION_RETENTION_DAYS` (default 90).

Only `abandoned` rows are ever eligible, and that filter is the entire safety
argument — `scripts/test-sessions.ts` pins it:

| Status | Kept? | Why |
|---|---|---|
| `abandoned` | deleted past the window | A quit-to-menu. Nothing reads it again; past 4 hours (`MAX_RUN_HOURS`) it cannot even be resurrected by a late finish. |
| `accepted` | **forever** | These ARE the All-runs leaderboard. |
| `rejected` | **forever** | `score_rejections.session_id` is `ON DELETE CASCADE` — deleting one deletes its anti-cheat audit row. |
| `open` | **forever** | Possibly a live run; the sweeper decides when it is stale. |

At today's volume (~250 bytes per run played, including index entries) the purge
deletes nothing and is meant to. The p95 table above is what says when it — or
archiving `accepted` rows, which this deliberately does NOT do — actually
matters.

## Notes

- Base image is `node:22-bookworm-slim`, **not alpine**: `@node-rs/argon2` (Increment 1)
  ships prebuilt binaries for glibc only, and musl failures surface in the container
  rather than locally.
- Both `CMD`s use `exec` and call binaries directly rather than through `npx`. Without
  either, SIGTERM is absorbed before it reaches Node and Docker force-kills after the
  grace period — which on a Dokploy redeploy would cut off in-flight transactions.
