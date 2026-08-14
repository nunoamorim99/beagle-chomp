# Project Stack & Conventions

> **How to use this file:** Drop it into the root of any of my projects (or paste it at the
> start of a Claude Code session). It describes the target infrastructure and the conventions
> every project must follow. Your job is to read the project you're in, compare it against these
> decisions, and make the changes needed to bring it into alignment. Ask before doing anything
> destructive. When something here doesn't apply to the current project (e.g. a static frontend
> has no backend section), say so and skip it.
>
> **Tag convention:** anything marked **`[OPTIONAL — LATER]`** is a deliberate future step, not a
> current requirement. Do **not** implement or scaffold it unless I explicitly ask. When auditing,
> you may note that a `[OPTIONAL — LATER]` piece is absent, but treat its absence as expected, not
> as a gap to fix.

---

## 0. Context

These are personal projects, self-hosted on a budget. There is one developer (me). Optimise for
**simplicity, low cost, and reliability**, not for scale. Do not introduce tools, abstractions, or
infrastructure beyond what is listed here unless I explicitly ask. If a change would add a new
moving part, flag it and explain the trade-off first.

**Project types:**
- **Static frontends** (portfolio, simple PWA) — no backend, hosted on GitHub Pages / Cloudflare Pages.
- **Full-stack projects** (e.g. Nibblr the game, História the couple's memory app) — static frontend
  on Cloudflare Pages + a containerised backend API on the VPS.

---

## 1. Infrastructure

| Concern | Decision |
|---|---|
| DNS | Cloudflare (free). One subdomain per frontend, one per API. |
| Edge / proxy | Cloudflare proxy (**orange cloud**) enabled on all app + API subdomains — hides VPS IP, DDoS protection. See §10 for the cert method that makes this work. |
| Static hosting | GitHub Pages **or** Cloudflare Pages. **Never serve a frontend from the VPS.** |
| Server | One Hetzner VPS (CX23, ~€6.75/mo incl. VAT), shared by all backends. Already provisioned & hardened — see §10. |
| Packaging | Docker. Every backend has a `Dockerfile`. |
| Local dev | Docker Compose — frontend + backend + Postgres, with hot reload. |
| Deploy | Dokploy on the VPS, connected to GitHub via a **GitHub App** → git-push auto-deploys. Live and working — see §10. |
| Reverse proxy | Traefik, managed by Dokploy. **No manual nginx on the VPS.** |
| HTTPS | **Cloudflare Origin Certificate** (15-yr) on app/API subdomains behind the orange cloud, with Cloudflare SSL mode **Full (strict)**. Let's Encrypt via Traefik only for any direct/grey-cloud hostname. See §10. |
| Database | **One Postgres service per project**, managed in that project's Dokploy panel. *(Amended 2026-08-14 — was "one Postgres container, one database per project". See the note below.)* |
| Persistence | Named Docker volumes for all persistent data. Never write persistent data inside a container's own filesystem. |
| File uploads | Cloudflare R2. File goes in R2, metadata row goes in Postgres. |
| Auth | Better Auth, self-hosted. **No Supabase.** Default = no-PII login (no email collected). Email flows are `[OPTIONAL — LATER]`. See §8. |
| Email sending | Resend, one account, single domain `nunoamorim.dev`, from `no-reply@nunoamorim.dev`. Free tier. Only wired up when email flows are implemented — see §8. |
| Excluded | No Supabase, no Vercel, no Kubernetes, no Redis (for now). |

> **Note — why one Postgres service per project (amended 2026-08-14).**
> The original decision was a single shared Postgres holding one database per project. In practice
> Dokploy has **no UI for adding a database or user to an existing Postgres service** — it provisions
> exactly one database + one user from the creation form. So the shared model requires SSH plus
> `CREATE DATABASE` / `CREATE USER` / `ALTER DATABASE ... OWNER` by hand for **every** new project,
> forever, and migrating the existing História instance onto it would mean a dump/restore of the one
> dataset that is explicitly irreplaceable.
>
> Measured cost of the alternative: a Postgres 16 container idles at **~21 MB RSS**, growing toward
> ~180 MB as `shared_buffers` (160 MB default) fills. On the CX23 that is ~4–5% of RAM each, and
> **€0** extra — Hetzner bills the VPS, not containers.
>
> For 2–3 projects that buys real value: everything managed in the panel, each project self-contained,
> independent restarts and upgrades, and a blast radius of one project. **Revisit at ~5–6 projects**,
> where ~1 GB of mostly-idle database processes stops being a good trade. Consolidating later is a
> `pg_dump`/`pg_restore` per project, not a rewrite.
>
> Two things this makes mandatory rather than optional:
> - **A memory limit on every database container** (§3.2). Without one, a runaway query in a project
>   can trigger the OOM killer against a *different* project's container — which would throw away the
>   isolation this model is bought for.
> - **Every new database added to the nightly `pg_dump`→R2 job** (§3.4). One shared instance was one
>   backup command; N instances is N, and the one you forget is the one that fails.

---

## 2. API conventions (apply to every backend)

These exist so the API can later serve native apps (Capacitor) without rework. Follow all of them.

1. **JSON only.** No endpoint returns HTML. Every response is JSON, including errors.
2. **Bearer token auth**, not cookie sessions. (Native apps handle cookies badly — this is the
   hardest thing to change later, so get it right from the start.)
3. **Own subdomain for the backend:** `api.projeto.dominio.com`, separate from the web frontend.
4. **Versioned paths:** all routes under `/api/v1/...`. Old versions must keep working when a new
   one ships (installed apps can't be force-updated).
5. **CORS allowlist**, never `*`. List the exact Pages domains that are allowed.
6. **Secrets via environment variables**, set in Dokploy's UI. Never commit secrets to git.
   Provide a `.env.example` with keys and dummy values.
7. **Data access behind a service/repository layer**, so adding a cache later is a one-file change.
8. **Health endpoint** on every API: `GET /health` returns `200` + JSON. Used by uptime monitoring
   and container healthchecks.

---

## 3. Reliability

| # | Decision | Cost |
|---|---|---|
| 1 | 2 GB swap file on the VPS (prevents OOM kills during builds). | free |
| 2 | Memory limits per container (one build can't starve Postgres). | free |
| 3 | `restart: unless-stopped` on every container. | free |
| 4 | Nightly `pg_dump` to R2 — **História** ✅ (03:30, custom `backup.js` as a Dokploy Schedule on the API service), **Beagle Chomp** ✅ (04:00, Dokploy's native Backups tab → `beaglechomp-backups`). **Restore verified 2026-08-14** — see below. | free |
| 5 | Hetzner snapshots once História has real content. | ~€1.10/mo |
| 6 | Separate copy of original photos outside R2 (human error is the real risk). | free |
| 7 | UptimeRobot on every public URL. | free |
| 8 | Dokploy dashboard at `panel.nunoamorim.dev`, protected by Cloudflare Access (email OTP, single allowed address). SSH tunnel kept as emergency fallback. See §10. | free |

### Restore drill (verified 2026-08-14 — §11 step 4 satisfied for História)

A backup is not proven until a restore has actually worked. This was run against the real
`historia-2026-08-14T03-30-00.dump.gz`, on a local throwaway container, touching nothing in production.

**Two backup formats are in play — using the wrong tool is the classic restore failure:**

| Project | Object name | Format | Restore with |
|---|---|---|---|
| História | `historia-<ts>.dump.gz` | custom (`PGDMP` magic, `pg_dump -Fc`) | **`pg_restore`** |
| Beagle Chomp | `<ts>.sql.gz` (under `beaglechomp-db-<id>/`) | plain SQL | **`psql`** |

```bash
# 1. Download the object from R2, then check integrity + format before anything else
gzip -t historia-<ts>.dump.gz                    # not truncated?
gunzip -c historia-<ts>.dump.gz | head -c 5      # "PGDMP" => custom format

# 2. Throwaway target (never restore into a live database)
docker run --rm -d --name pg-restore-test \
  -e POSTGRES_PASSWORD=test -e POSTGRES_DB=scratch postgres:17-alpine

# 3. Restore  (on Git Bash, MSYS_NO_PATHCONV=1 stops /var/... being rewritten to a Windows path)
gunzip -k historia-<ts>.dump.gz
docker cp historia-<ts>.dump pg-restore-test:/var/lib/postgresql/h.dump
MSYS_NO_PATHCONV=1 docker exec pg-restore-test \
  pg_restore -U postgres -d scratch --no-owner --no-privileges /var/lib/postgresql/h.dump

# 4. Verify DATA, not just tables — a schema-only restore looks like success
docker exec pg-restore-test psql -U postgres -d scratch \
  -c "SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC;"

# 5. Destroy the evidence
docker rm -f pg-restore-test
```

**2026-08-14 result:** 13 tables, 30 constraints, 29 indexes, and real rows —
`media=223 · fotos=145 · ilustracoes=78 · mensagens=1 · user=2`.
The `media` count matches the 223 objects in the `historia-media` R2 bucket exactly, so the metadata rows
and the stored files agree. **Re-run this drill after any change to a backup job**, and note that the
`--no-owner --no-privileges` flags are what let the dump land in a database with different role names.

---

## 4. Naming convention

```
projeto.dominio.com          → frontend  (Cloudflare Pages / GitHub Pages)
api.projeto.dominio.com      → backend   (VPS, via Traefik)
```

Examples:
```
nibblr.dominio.com           api.nibblr.dominio.com
historia.dominio.com         api.historia.dominio.com
```

Postgres databases are named after the project: `nibblr`, `historia`.

Both subdomain types sit behind the Cloudflare **orange cloud** (proxied). The origin server presents
a Cloudflare Origin Certificate; Cloudflare SSL mode is **Full (strict)**. See §10.

---

## 5. What I want you to do in a project

When I open a session with this file in a project, work through these steps and report findings
before making changes:

1. **Identify the project type** (static frontend / full-stack) and state it.
2. **Audit against this doc.** List every point where the project currently diverges from the
   conventions above. Group findings by section (Infrastructure / API / Reliability).
3. **Propose a change plan**, ordered by priority, with the effort/risk of each item noted.
   Call out anything that would touch auth or stored data (higher risk).
4. **Wait for my go-ahead** before editing. Then apply changes incrementally, one concern at a
   time, so I can review each.

Specific things to check for in a **backend** project:
- Is there a `Dockerfile`? Is there a `docker-compose.yml` for local dev (frontend + backend +
  Postgres, hot reload)?
- Are all responses JSON? Any HTML-returning endpoints?
- Is auth bearer-token based (not cookie sessions)?
- Are routes versioned under `/api/v1/`?
- Is CORS an explicit allowlist, not `*`?
- Is there a `/health` endpoint?
- Are secrets read from env vars, with a `.env.example` present?
- Is data access isolated behind a service/repository layer?
- For file uploads: does it use R2 with a **signed-URL** flow (browser uploads directly to R2,
  not through the API), with only metadata stored in Postgres?

Specific things to check for a **frontend** project:
- Does it build to static output suitable for Pages?
- Does it call the API at the `api.projeto.dominio.com` subdomain (configurable via env, not
  hardcoded)?
- No secrets in the frontend bundle.

---

## 6. Deferred (do NOT add unless I ask)

| Thing | Revisit when |
|---|---|
| Redis | A query measurably exceeds ~200 ms, or I run multiple backend instances. |
| Kubernetes | Never, at this scale. |
| CI/CD beyond Dokploy | I need automated tests gating deploys. |
| Push notifications | História actually goes native. |
| Second VPS | RAM on the first one runs out. |

---

## 7. Previously open items — now resolved

All former open items are decided. Kept here as pointers:

- **Email sending service** — Resend. See §8.
- **R2 signed-URL upload flow** — see §9.
- **Orange cloud + certs on app subdomains (old "decision #2")** — resolved: Cloudflare Origin
  Certificate + Full (strict). See §10.

---

## 8. Authentication strategy (per project)

Auth is always **Better Auth, self-hosted**. How it's configured differs by project.

### Default for games (Nibblr, Beagle Chomp) — no-PII login (implement now)

- **No personal data collected.** Username + password only, no email at signup. This deliberately
  keeps the GDPR surface small (an email address is personal data; not collecting one avoids that).
- **Bearer tokens**, per the API conventions in §2.
- **Accepted trade-off:** with no email there is **no self-service password recovery**. A forgotten
  password means the account — including credits and unlocked skins — is lost, with no recovery
  path. This is a conscious decision for the current phase. Do not add a recovery flow to "fix" it
  unless I ask.
- **GDPR note:** no-email lightens obligations but does not remove them entirely — IP addresses and
  persistent user IDs can still be personal data. A short privacy note becomes worthwhile once there
  are real users. Not a blocker for building.

### História (the couple's app) — closed, two fixed accounts

- **No public sign-up.** `disableSignUp: true` (or simply never expose a signup route).
- **Seed exactly two accounts** (mine + Catarina's) via a setup script.
- **No email, no self-service reset.** If a password is forgotten, reset the hash directly via a
  small script. Fine for two known users.

### `[OPTIONAL — LATER]` — full email-based auth for a "real app"

Implement this **only when I explicitly decide a project needs proper accounts** (self-service
password reset, email verification, cross-device recovery). Until then, do not scaffold it.

When that time comes, the decided setup is:

- **Provider:** Resend, one account for everything.
- **Sending domain:** single domain `nunoamorim.dev` (keeps Resend on the free tier — free tier
  allows one domain).
- **From address:** `no-reply@nunoamorim.dev` for both password-reset and account-validation emails.
- **Flows:** email verification at signup + password reset. Transactional only (no marketing).
- **DNS:** SPF, DKIM and DMARC records for the sending domain, configured in Cloudflare.
- **Secret:** Resend API key stored as an env var in Dokploy, never in git.
- **Integration:** Better Auth's `sendEmail` hook calls Resend. Provider-agnostic — swapping to
  another provider later is a few lines + DNS, nothing structural.

### Possible future escape hatches (also `[OPTIONAL — LATER]`)

If the no-recovery trade-off becomes a problem, the options — do not build unless I ask:

- **Optional email** — a nullable email field, collected only if a user opts into recovery. Keeps
  no-PII as the default while allowing recovery for those who want it.
- **Social login** (Google/GitHub) — offloads recovery to the provider, but shares identity data
  with them.

---

## 9. R2 file upload & serving flow (any project with user uploads)

Files go **browser → R2 directly** via presigned URLs. The API never handles the file bytes —
it only signs URLs and stores metadata. This applies wherever users upload files (História first).

### Upload (5 steps)

1. **Sign** — `POST /api/v1/uploads/sign`, auth required. Body: `{ entryId, filename, contentType, size }`.
   The API:
   - validates `contentType` against an allowlist (e.g. `image/jpeg`, `image/png`, `image/webp`,
     `application/pdf`) and `size` against a cap;
   - generates the object key **itself** — `historia/{entryId}/{uuid}.{ext}` — never the user's filename;
   - inserts a `media` row with `status = 'pending'`;
   - returns `{ mediaId, uploadUrl }` where `uploadUrl` is a presigned **PUT**, expiry ~5 min,
     content-type pinned.
2. **API → browser:** the presigned PUT URL.
3. **Browser → R2:** `PUT` the file bytes directly to R2. Does not touch the API.
4. **R2 → browser:** `200 OK`.
5. **Confirm** — `POST /api/v1/uploads/{mediaId}/confirm`, auth required. The API does a `HEAD` on
   the object to verify it exists and is within the size cap, then flips the row to `status = 'ready'`.

### Serving (reads)

- **Bucket is private.** No public URLs, ever (História holds intimate photos/letters).
- When a client loads an entry/gallery, the API returns **short-lived presigned GET URLs** (~1 h)
  for the media that authenticated user may see. These go straight into `<img src>` and expire.

### `media` table (Postgres)

`id` (uuid) · `entry_id` (fk) · `uploader_id` (fk) · `object_key` (text) · `content_type` ·
`size_bytes` · `original_filename` · `status` (`pending` | `ready`) · `created_at`.
(Optional later: `width`, `height`, `thumbnail_key`.)

### Rules / gotchas

- **R2 credentials live only on the API**, in Dokploy env vars. Never in the frontend bundle.
- **R2 bucket CORS** must allow the frontend origin (`https://historia.nunoamorim.dev`) with `PUT`
  (upload) and `GET` (serving). This is a bucket-level config, separate from the API's own CORS.
  It is the most common reason direct uploads fail the first time.
- **Object key is server-generated**, uuid-based, namespaced by entry. Original filename is stored
  as a column, not used as the key.
- **Orphan cleanup:** a cron job deletes `pending` rows (and their objects, if any) older than 24 h.
- **Deletion:** deleting an entry/photo removes the R2 object **and** the row.
- **Backups:** R2 is the working copy, not a backup. Keep a separate copy of original photos
  elsewhere (per §3). `pg_dump` covers the metadata rows.

### Threat model note

História = two trusted, authenticated users. Presigned **PUT** + a post-upload `HEAD` check is
enough here; do NOT reach for presigned-POST-with-policy or other hardening unless a project opens
uploads to the public.

### `[OPTIONAL — LATER]` extensions (do not build unless I ask)

- **Multipart upload** — for large files (video, >~100 MB): same signing idea, chunked + resumable.
  Add only when a project actually accepts large files.
- **Thumbnails** — generate a small variant at confirm time and store its key in `thumbnail_key`,
  so galleries don't load full-res originals. Worth it eventually; skippable for a first version.

---

## 10. The deployment platform (already built — this is the target environment)

This platform exists and works today. When a project is ready, it deploys onto this. Claude Code
does **not** need to set any of this up — it only needs to shape the project (Dockerfile, JSON API,
bearer auth, `/health`, env vars) so it slots in.

### What exists

- **Server:** one Hetzner VPS (CX23, x86, Ubuntu 24.04), in Germany. IP is proxied/hidden behind
  Cloudflare. Hardened: key-only SSH, non-root sudo user, `ufw` firewall (22/80/443 only), 2 GB swap.
- **Runtime:** Docker (Swarm mode, set up by Dokploy). Dokploy manages builds, containers, routing.
- **Reverse proxy:** Traefik (managed by Dokploy) terminates 80/443 and routes by hostname.
- **Deploy panel:** Dokploy at `https://panel.nunoamorim.dev`, protected by **Cloudflare Access**
  (email one-time-PIN, only my address is allowed). This is where projects, env vars, domains and
  deploys are configured.
- **Git integration:** a **GitHub App** (`dokploy-nunoamorim`) is connected. Pushing to a repo's
  tracked branch triggers an automatic build + deploy via webhook.
- **Webhook bypass:** Cloudflare Access has a **Bypass** policy on path `/api/deploy` for
  `panel.nunoamorim.dev`, so GitHub's deploy webhooks reach Dokploy without hitting the login wall.
  The dashboard itself stays protected. (Security comes from each app's unguessable webhook token.)

### The per-project deploy pattern (repeatable)

1. Repo has a `Dockerfile` at root, listens on a port (e.g. 3000), exposes `/health`.
2. In Dokploy: create/choose a **project**, add an **Application**, set provider to the **GitHub App**
   connection, pick the repo + branch, build type **Dockerfile**.
3. Add the **Domain**: `api.<project>.nunoamorim.dev`, container port, HTTPS on.
4. Set **env vars** in Dokploy (secrets never in git).
5. In Cloudflare: add an **A record** `api.<project>` → server IP. See cert step below for cloud colour.
6. Push to the branch → auto-build → live.

### Certificates behind the orange cloud (resolved "decision #2")

Because app/API subdomains are proxied (orange cloud), do **not** rely on Traefik's Let's Encrypt
HTTP-01 challenge (it fights with the proxy). Instead:

1. Generate a **Cloudflare Origin Certificate** (Cloudflare → SSL/TLS → Origin Server), 15-yr,
   covering `*.nunoamorim.dev`.
2. Install it in **Dokploy → Certificates** and assign it to the app's domain (or Traefik default).
3. Set Cloudflare **SSL/TLS mode** to **Full (strict)**.
4. Turn the subdomain's cloud **orange** (proxied).

Net result: visitors see Cloudflare's public cert; Cloudflare↔server leg is encrypted with the
Origin Certificate; the VPS IP stays hidden. No renewals for 15 years.

> **First real deploy note:** the very first app deployed to a proxied `api.*` subdomain is what
> proves this cert method end to end. Do it on a low-stakes app first if possible. For História,
> the cert/orange-cloud must be confirmed working **before** real photos are migrated.

### Daily access

- Manage deploys at `https://panel.nunoamorim.dev` (email PIN, then Dokploy login).
- Emergency fallback if Cloudflare Access is down:
  `ssh -N -L 4000:localhost:3000 nuno@<server-ip>` then open `http://localhost:4000`.

---

## 11. História migration — order of operations (protect the irreplaceable data)

História holds irreplaceable photos, letters and illustrations. The migration order matters more
than speed. Do **not** move real data until the pattern is proven with dummy data.

1. **Assess & rebuild the backend** to meet §1–§9 (JSON API, bearer auth, `/api/v1`, `/health`,
   Dockerfile, Better Auth with `disableSignUp`, R2 signed-upload flow per §9).
2. **Seed two accounts** (mine + Catarina's) via script; no public signup.
3. **Deploy to `api.historia.nunoamorim.dev`** and confirm the **orange-cloud + Origin Certificate**
   method (§10) works — with **dummy** entries and **test** photos only.
4. **Prove backups first:** nightly `pg_dump` to R2 **and** a separate copy of originals (§3). Do a
   test restore. Only proceed once a restore has actually worked.
5. **Then migrate the real data** — photos into R2, metadata into Postgres — and cut the frontend
   over to the new API.

Rule: **no real photo moves until steps 3 and 4 are green.**
