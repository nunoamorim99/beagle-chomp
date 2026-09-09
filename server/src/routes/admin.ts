// OWNER: backend
//
// /api/v1/admin/* — the metrics portal's read API (IDEA-051).
//
// MOUNT ORDER IS LOAD-BEARING. This sub-app is mounted at its OWN prefix
// (/api/v1/admin) and registered BEFORE profileRoutes and sessionRoutes, which
// are both mounted at "/" under /api/v1 and each declare their own `use("*")`.
// In Hono those become `ALL /api/v1/*` middleware running in registration
// order — which is why a /sessions request currently authenticates TWICE. An
// admin app mounted after them would silently inherit the profile rate limiter
// (120/min, sized for a game client) and a redundant auth round trip on every
// dashboard panel. See http/metrics-middleware.ts for the same shape biting
// route labelling.
//
// Every route here is READ-ONLY. The portal shows numbers; it does not change
// the game. The one write the portal will eventually need — publishing an
// announcement (IDEA-052) — gets its own explicit route rather than being
// slipped in beside these.
//
// Nothing here is under the p95 metrics' concern either way, but note these
// queries are the most expensive in the codebase by some margin, and they are
// deliberately un-cached: see repo/analytics.ts for why, and what would change
// that.

import { Hono } from "hono";
import { requireAuth, type AuthVars } from "../http/auth-middleware.js";
import { requireAdmin } from "../http/admin-middleware.js";
import { rateLimit } from "../http/rate-limit.js";
import * as analytics from "../repo/analytics.js";
import {
  buildCohortMatrix,
  headlineRetention,
  challengeStandings,
  hardestChallenges,
  tallySlots,
  topSlot,
  shares,
  rejectionHealth,
} from "../analytics/aggregate.js";
import { snapshot } from "../http/metrics.js";
import { ENEMY_SLOT_LABELS, FRUIT_LABELS } from "../catalog.generated.js";
import { APP_VERSION } from "../version.js";
import * as announcements from "../repo/announcements.js";
import { parseAnnouncement, PROBLEM_MESSAGE } from "../validation/announcement.js";
import { readBody } from "../http/body.js";
import { badRequest, notFound } from "../http/errors.js";

export const adminRoutes = new Hono<{ Variables: AuthVars }>();

// requireAuth first (401 for no token), THEN requireAdmin (404 for everyone
// else). A rate limit sits in front of both: these are the heaviest queries the
// API runs, and one operator refreshing a dashboard needs nowhere near 120/min.
adminRoutes.use("*", rateLimit({ name: "admin", limit: 60, windowMs: 60_000 }));
adminRoutes.use("*", requireAuth);
adminRoutes.use("*", requireAdmin);

/** Clamp a `?days=`/`?weeks=` style window. Untrusted input reaching an
 *  interval cast, so it is coerced to an integer and bounded — not because a
 *  parameterised interval is injectable, but because `?days=100000` is a table
 *  scan anyone with the flag could trigger by typo. */
function window(raw: string | undefined, fallback: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), 1), max);
}

/** Headline tiles plus the daily activity series. */
adminRoutes.get("/overview", async (c) => {
  const days = window(c.req.query("days"), 30, 365);
  const [totals, activity] = await Promise.all([
    analytics.overviewTotals(),
    analytics.dailyActivity(days),
  ]);
  return c.json({
    totals,
    activity: activity.map((row) => ({
      day: row.day.toISOString().slice(0, 10),
      players: row.players,
      runs: row.runs,
      playSeconds: row.play_seconds,
    })),
  });
});

/** Signup cohorts, zero-filled into a dense grid by the pure layer. */
adminRoutes.get("/retention", async (c) => {
  const weeks = window(c.req.query("weeks"), 8, 52);
  const maxOffset = window(c.req.query("maxOffset"), 30, 90);
  const rows = await analytics.retentionCohorts(weeks);
  const matrix = buildCohortMatrix(rows, maxOffset);
  return c.json({ matrix, headline: headlineRetention(matrix) });
});

/** The challenge ladder — which level is actually the wall. */
adminRoutes.get("/challenges", async (c) => {
  const rows = await analytics.challengeFunnel();
  const standings = challengeStandings(rows);
  // `insufficient` is returned SEPARATELY rather than merged and sorted, so the
  // portal can grey those rows instead of showing a level nobody has attempted
  // at the top of a "hardest" list on no evidence.
  const { ranked, insufficient } = hardestChallenges(standings);
  return c.json({ standings, ranked, insufficient, depth: await analytics.classicDepth() });
});

/** Gameplay texture: who kills you, what you eat. */
adminRoutes.get("/gameplay", async (c) => {
  const [deaths, fruit] = await Promise.all([
    analytics.deathsByEnemy(),
    analytics.fruitTaste(),
  ]);
  const enemies = tallySlots(
    deaths.map((r) => ({ slot: r.slot, count: r.deaths })),
    ENEMY_SLOT_LABELS,
  );
  const fruits = tallySlots(
    fruit.map((r) => ({ slot: r.slot, count: r.eaten })),
    FRUIT_LABELS,
  );
  return c.json({
    enemies,
    fruits,
    // null on a tie or no data — the portal must show nothing rather than pick.
    nemesis: topSlot(enemies),
    favouriteFruit: topSlot(fruits),
  });
});

/** What players actually WEAR and how they control the beagle. */
adminRoutes.get("/content", async (c) => {
  const [beagle, enemy, theme, control] = await Promise.all([
    analytics.equippedShare("beagle_skin_id"),
    analytics.equippedShare("enemy_skin_id"),
    analytics.equippedShare("maze_theme_id"),
    analytics.equippedShare("control_scheme"),
  ]);
  return c.json({
    beagleSkins: shares(beagle),
    enemySkins: shares(enemy),
    mazeThemes: shares(theme),
    controlSchemes: shares(control),
  });
});

/**
 * Is the API healthy, and is it refusing honest runs?
 *
 * Serves the p95 table IDEA-039 has been collecting into a log nobody reads,
 * beside the rejection board. `snapshot()` never resets — the 10-minute logger
 * owns `resetWindow()`, and calling it here would silently empty the window the
 * container log is about to print.
 */
adminRoutes.get("/health", async (c) => {
  const days = window(c.req.query("days"), 14, 90);
  const [reasons, acceptance] = await Promise.all([
    analytics.rejectionReasons(days),
    analytics.acceptanceByDay(days),
  ]);
  return c.json({
    version: APP_VERSION,
    uptimeSeconds: Math.round(process.uptime()),
    requests: snapshot(),
    rejections: {
      reasons,
      byDay: acceptance.map((row) => ({
        day: row.day.toISOString().slice(0, 10),
        accepted: row.accepted,
        rejected: row.rejected,
      })),
      ...rejectionHealth(acceptance),
    },
  });
});

/** The player list the portal browses. */
adminRoutes.get("/players", async (c) => {
  const q = c.req.query("q")?.trim() || null;
  const limit = window(c.req.query("limit"), 50, 200);
  return c.json({ players: await analytics.playerList(q, limit) });
});

/**
 * One player's year — the Rewind.
 *
 * Named by username rather than id: the portal browses by name, and the id is
 * an internal detail there is no reason to surface. A username that does not
 * exist returns 404 with no distinction from one that does but has never
 * played, which keeps this from being a membership oracle.
 */
adminRoutes.get("/players/:username/rewind", async (c) => {
  const since = c.req.query("since");
  const parsed = since ? new Date(since) : new Date(new Date().getFullYear(), 0, 1);
  const from = Number.isNaN(parsed.getTime())
    ? new Date(new Date().getFullYear(), 0, 1)
    : parsed;

  const row = await analytics.playerRewind(c.req.param("username"), from);
  if (!row) return c.json({ error: { code: "NOT_FOUND", message: "No such player." } }, 404);

  const enemies = tallySlots(
    (row.deaths_by_ghost ?? []).map((count, slot) => ({ slot, count })),
    ENEMY_SLOT_LABELS,
  );
  const fruits = tallySlots(
    (row.fruit_kind_counts ?? []).map((count, slot) => ({ slot, count })),
    FRUIT_LABELS,
  );

  return c.json({
    username: row.username,
    since: from.toISOString().slice(0, 10),
    joined: row.created_at.toISOString().slice(0, 10),
    highScore: row.high_score,
    coins: row.coins,
    challengeProgress: row.challenge_progress,
    runs: row.runs,
    daysPlayed: row.days_played,
    playSeconds: row.play_seconds,
    longestRunSeconds: row.longest_run_seconds,
    pelletsEaten: row.pellets_eaten,
    fruitEaten: row.fruit_eaten,
    coinsCollected: row.coins_collected,
    ghostsEaten: row.ghosts_eaten,
    livesLost: row.lives_lost,
    levelsCleared: row.levels_cleared,
    enemies,
    fruits,
    nemesis: topSlot(enemies),
    favouriteFruit: topSlot(fruits),
    favouriteTheme: row.favourite_theme,
    favouriteBeagleSkin: row.favourite_beagle_skin,
  });
});

// ---------------------------------------------------------------------------
// Announcements — the composer (IDEA-052)
//
// The ONLY writes in this file, and the only path anywhere that creates
// player-facing content. Everything above is read-only.
//
// Publishing is always a separate call from saving. `create` makes a draft and
// nothing else can; going live is an explicit POST to /publish. That means the
// composer's Save is never one mis-click away from every player's screen, which
// matters more here than the extra round trip costs.
// ---------------------------------------------------------------------------

adminRoutes.get("/announcements", async (c) => {
  const rows = await announcements.listAll(100);
  return c.json({ items: rows.map(toAdminDto) });
});

adminRoutes.post("/announcements", async (c) => {
  const parsed = parseAnnouncement(await readBody(c));
  if (!parsed.ok) throw badRequest(PROBLEM_MESSAGE[parsed.problem]);
  const row = await announcements.create(parsed.value);
  return c.json({ announcement: toAdminDto(row) }, 201);
});

adminRoutes.patch("/announcements/:id", async (c) => {
  const parsed = parseAnnouncement(await readBody(c));
  if (!parsed.ok) throw badRequest(PROBLEM_MESSAGE[parsed.problem]);
  const row = await announcements.update(c.req.param("id"), parsed.value);
  if (!row) throw notFound("No such announcement.");
  return c.json({ announcement: toAdminDto(row) });
});

/** Go live, or pull it back to draft. Body: `{ published: boolean }`. */
adminRoutes.post("/announcements/:id/publish", async (c) => {
  const body = await readBody(c);
  const published = body.published !== false; // absent means publish
  const row = await announcements.setPublished(c.req.param("id"), published);
  if (!row) throw notFound("No such announcement.");
  return c.json({ announcement: toAdminDto(row) });
});

adminRoutes.delete("/announcements/:id", async (c) => {
  const gone = await announcements.remove(c.req.param("id"));
  if (!gone) throw notFound("No such announcement.");
  return c.body(null, 204);
});

function toAdminDto(a: announcements.AnnouncementRow) {
  return {
    id: a.id,
    kind: a.kind,
    version: a.version,
    title: a.title,
    body: a.body,
    // The operator needs to see WHICH are drafts, so this is the full
    // timestamp rather than the date the players' feed shows.
    publishedAt: a.published_at ? a.published_at.toISOString() : null,
    isDraft: a.published_at === null,
    createdAt: a.created_at.toISOString(),
    updatedAt: a.updated_at.toISOString(),
  };
}
