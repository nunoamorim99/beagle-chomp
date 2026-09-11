// OWNER: backend
//
// Read-only analytics queries (IDEA-050). Per STACK.md §2.7, SQL lives only in
// repo/*.
//
// Two things shape every query in this file.
//
// 1. AGGREGATE ON READ. There are no rollup tables, no cron and no cache here,
//    because at this project's volume there is nothing to optimise yet — and
//    the project already owns an honest trigger for changing its mind rather
//    than a hunch: the `[slow-query]` line at SLOW_QUERY_MS (200 ms), which is
//    STACK.md §6's own Redis threshold. If one of these starts tripping it,
//    THAT is when a nightly rollup earns its place. Not before.
//
// 2. THE PRE-IDEA-050 ROWS ARE PARTIAL. 006_run_stats.sql backfilled every
//    finished run from game_sessions, so score, timing and mode are real
//    history all the way back — but the item counts were discarded before this
//    shipped and are ZERO on those rows, not unknown. Any query that reads
//    gameplay detail must therefore exclude them, and the ones below do it
//    explicitly rather than hoping a caller remembers. Retention and scoring
//    queries deliberately use the WHOLE table; that is the point of the
//    backfill.

import { query } from "../db.js";

/** The predicate that separates rows carrying real telemetry from the
 *  backfilled ones. A genuine run always ate at least one biscuit — clearing a
 *  map requires eating all of them, and even a run that died instantly ate
 *  something on the way. Kept as one constant so the rule cannot drift between
 *  queries. */
const HAS_TELEMETRY = `(pellets_eaten > 0 OR bones_eaten > 0 OR fruit_eaten > 0)`;

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export interface ActivityRow {
  day: Date;
  players: number;
  runs: number;
  play_seconds: number;
}

/** Daily active players and runs over the last `days` days.
 *
 *  Reads game_sessions rather than run_stats: a session exists the moment a run
 *  STARTS, so a player who opened the game and quit still counts as active.
 *  run_stats only knows about runs that finished, which is a different and
 *  narrower question. */
export async function dailyActivity(days: number): Promise<ActivityRow[]> {
  const { rows } = await query<ActivityRow>(
    `SELECT date_trunc('day', s.started_at)      AS day,
            count(DISTINCT s.user_id)::int       AS players,
            count(*)::int                        AS runs,
            COALESCE(sum(r.play_seconds), 0)::int AS play_seconds
       FROM game_sessions s
       LEFT JOIN run_stats r ON r.session_id = s.id
      WHERE s.started_at >= now() - ($1 || ' days')::interval
      GROUP BY 1
      ORDER BY 1`,
    [String(days)],
  );
  return rows;
}

export interface OverviewTotals {
  players_today: number;
  players_7d: number;
  players_30d: number;
  total_players: number;
  signups_7d: number;
  runs_7d: number;
  play_hours_7d: number;
}

/** The headline tiles, in one round trip rather than seven. */
export async function overviewTotals(): Promise<OverviewTotals> {
  const { rows } = await query<OverviewTotals>(
    `SELECT
       (SELECT count(DISTINCT user_id) FROM game_sessions
         WHERE started_at >= date_trunc('day', now()))::int          AS players_today,
       (SELECT count(DISTINCT user_id) FROM game_sessions
         WHERE started_at >= now() - interval '7 days')::int         AS players_7d,
       (SELECT count(DISTINCT user_id) FROM game_sessions
         WHERE started_at >= now() - interval '30 days')::int        AS players_30d,
       (SELECT count(*) FROM users)::int                             AS total_players,
       (SELECT count(*) FROM users
         WHERE created_at >= now() - interval '7 days')::int         AS signups_7d,
       (SELECT count(*) FROM game_sessions
         WHERE started_at >= now() - interval '7 days')::int         AS runs_7d,
       (SELECT COALESCE(round(sum(play_seconds) / 3600.0), 0) FROM run_stats
         WHERE finished_at >= now() - interval '7 days')::int        AS play_hours_7d`,
  );
  return rows[0];
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

export interface CohortCellRow {
  cohort_day: Date;
  cohort_size: number;
  day_offset: number;
  returned: number;
}

/**
 * Signup cohorts and how many of each came back on day N.
 *
 * One row per (cohort, offset) that actually has returners — the matrix is
 * assembled in the pure layer, which is where the empty cells belong. Doing it
 * here would mean a cross join against a generated series purely to produce
 * zeroes, which is more SQL for the same answer.
 *
 * "Returned on day N" means STARTED A RUN, not signed in. Signing in is
 * automatic on this client (the token is sliding and the game boots straight
 * into the menu), so counting sessions would flatter every cohort.
 */
export async function retentionCohorts(weeks: number): Promise<CohortCellRow[]> {
  const { rows } = await query<CohortCellRow>(
    `WITH cohort AS (
       SELECT id AS user_id, date_trunc('day', created_at) AS cohort_day
         FROM users
        WHERE created_at >= now() - ($1 || ' weeks')::interval
     ),
     sizes AS (
       SELECT cohort_day, count(*)::int AS cohort_size FROM cohort GROUP BY 1
     )
     SELECT c.cohort_day,
            z.cohort_size,
            (date_trunc('day', s.started_at)::date - c.cohort_day::date) AS day_offset,
            count(DISTINCT c.user_id)::int AS returned
       FROM cohort c
       JOIN sizes z  ON z.cohort_day = c.cohort_day
       JOIN game_sessions s ON s.user_id = c.user_id
      WHERE s.started_at >= c.cohort_day
      GROUP BY 1, 2, 3
      ORDER BY 1, 3`,
    [String(weeks)],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Difficulty
// ---------------------------------------------------------------------------

export interface ChallengeFunnelRow {
  challenge_idx: number;
  attempts: number;
  clears: number;
  players_attempted: number;
  players_cleared: number;
  median_clear_seconds: number | null;
  avg_deaths: number | null;
}

/**
 * The challenge ladder, level by level — which one is actually the wall.
 *
 * A "clear" is an accepted challenge run with at least one level cleared, which
 * is the same rule scoreService uses to advance challenge_progress, so this
 * table and the player's unlocked ladder can never tell different stories.
 */
export async function challengeFunnel(): Promise<ChallengeFunnelRow[]> {
  const { rows } = await query<ChallengeFunnelRow>(
    `SELECT r.challenge_idx::int AS challenge_idx,
            count(*)::int                                   AS attempts,
            count(*) FILTER (WHERE r.accepted
                               AND r.levels_cleared >= 1)::int AS clears,
            count(DISTINCT r.user_id)::int                  AS players_attempted,
            count(DISTINCT r.user_id) FILTER (WHERE r.accepted
                               AND r.levels_cleared >= 1)::int AS players_cleared,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY r.elapsed_seconds)
              FILTER (WHERE r.accepted AND r.levels_cleared >= 1) AS median_clear_seconds,
            avg(r.lives_lost) FILTER (WHERE ${HAS_TELEMETRY})     AS avg_deaths
       FROM run_stats r
      WHERE r.mode = 'challenge' AND r.challenge_idx IS NOT NULL
      GROUP BY 1
      ORDER BY 1`,
  );
  return rows;
}

export interface ClassicDepthRow {
  levels_played: number;
  runs: number;
}

/** Where classic runs END — the difficulty wall, as a histogram. */
export async function classicDepth(): Promise<ClassicDepthRow[]> {
  const { rows } = await query<ClassicDepthRow>(
    `SELECT levels_played::int AS levels_played, count(*)::int AS runs
       FROM run_stats
      WHERE mode = 'classic' AND accepted AND ${HAS_TELEMETRY}
      GROUP BY 1
      ORDER BY 1`,
  );
  return rows;
}

export interface DeathsByEnemyRow {
  slot: number;
  deaths: number;
}

/**
 * Deaths per enemy SLOT, across every run that reported them.
 *
 * `deaths_by_ghost` is a smallint[] indexed by position in ENEMY_SLOTS
 * (config.ts), so this unnests it and sums per index. `WITH ORDINALITY` gives
 * the 1-based position, turned 0-based here so the number the portal receives
 * is the same index the client recorded — converting in two places is how the
 * rose one ends up labelled teal.
 */
export async function deathsByEnemy(): Promise<DeathsByEnemyRow[]> {
  const { rows } = await query<DeathsByEnemyRow>(
    `SELECT (d.ord - 1)::int AS slot, sum(d.count)::int AS deaths
       FROM run_stats r,
            unnest(r.deaths_by_ghost) WITH ORDINALITY AS d(count, ord)
      WHERE r.deaths_by_ghost IS NOT NULL
      GROUP BY 1
      ORDER BY 1`,
  );
  return rows;
}

export interface FruitTasteRow {
  slot: number;
  eaten: number;
}

/** Fruit eaten per KIND, indexed by position in FRUITS. Same unnest shape and
 *  the same 0-based rule as deathsByEnemy. */
export async function fruitTaste(): Promise<FruitTasteRow[]> {
  const { rows } = await query<FruitTasteRow>(
    `SELECT (f.ord - 1)::int AS slot, sum(f.count)::int AS eaten
       FROM run_stats r,
            unnest(r.fruit_kind_counts) WITH ORDINALITY AS f(count, ord)
      WHERE r.fruit_kind_counts IS NOT NULL
      GROUP BY 1
      ORDER BY 1`,
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Content and economy
// ---------------------------------------------------------------------------

export interface ShareRow {
  value: string | null;
  runs: number;
  players: number;
}

/**
 * What was actually being WORN, over runs — not what is equipped right now.
 *
 * The column is validated against a fixed allowlist rather than interpolated,
 * because `query()` takes no identifier parameters and this is the one place in
 * the codebase tempted to build a column name from a caller's string. An
 * unknown key throws here rather than reaching Postgres.
 */
export type ShareColumn =
  | "beagle_skin_id"
  | "enemy_skin_id"
  | "maze_theme_id"
  | "control_scheme";

const SHARE_COLUMNS: readonly ShareColumn[] = [
  "beagle_skin_id",
  "enemy_skin_id",
  "maze_theme_id",
  "control_scheme",
];

/**
 * Optionally restrict to one mode.
 *
 * Added for the maze theme, and it is a correctness fix rather than a filter
 * for convenience. IDEA-063 made every one of the forty challenge levels FORCE
 * a theme, owned or not — that is the whole point of the Grand Tour, which
 * shows a player the five themes they did not buy. But `run_stats.maze_theme_id`
 * records what the player had EQUIPPED, so on a challenge run it names a theme
 * that was not on screen. Counting those into "which theme do they play in"
 * answers neither question: not what they chose (the tour overrode it) and not
 * what they saw (the tour picked it).
 *
 * Classic runs are the only ones where equipped and played are the same thing,
 * so that is where the theme question is asked. The coat, the enemy set and the
 * control scheme are NOT forced by any mode, so they stay across all runs.
 */
export async function equippedShare(
  column: ShareColumn,
  mode?: "classic" | "challenge",
): Promise<ShareRow[]> {
  if (!SHARE_COLUMNS.includes(column)) {
    throw new Error(`equippedShare: refusing unknown column ${column}`);
  }
  const params = mode ? [mode] : [];
  const { rows } = await query<ShareRow>(
    `SELECT ${column} AS value, count(*)::int AS runs,
            count(DISTINCT user_id)::int AS players
       FROM run_stats
      WHERE ${column} IS NOT NULL${mode ? " AND mode = $1" : ""}
      GROUP BY 1
      ORDER BY 2 DESC`,
    params,
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export interface RejectionRow {
  reason_code: string;
  count: number;
  players: number;
  last_seen: Date;
}

/**
 * Why runs are being refused, worst first.
 *
 * This is the panel that earns the portal its keep. A rejection rate that RISES
 * after a config.ts change is the signal that `npm run sync` was forgotten and
 * the validator is now refusing honest runs — the exact IDEA-040 v3 failure,
 * which cost real scores and was found by a player complaining rather than by
 * anyone looking.
 */
export async function rejectionReasons(days: number): Promise<RejectionRow[]> {
  const { rows } = await query<RejectionRow>(
    `SELECT reason_code,
            count(*)::int                AS count,
            count(DISTINCT user_id)::int AS players,
            max(rejected_at)             AS last_seen
       FROM score_rejections
      WHERE rejected_at >= now() - ($1 || ' days')::interval
      GROUP BY 1
      ORDER BY 2 DESC`,
    [String(days)],
  );
  return rows;
}

export interface AcceptanceRow {
  day: Date;
  accepted: number;
  rejected: number;
}

/** Accepted vs rejected finishes per day — the rate, not just the count. */
export async function acceptanceByDay(days: number): Promise<AcceptanceRow[]> {
  const { rows } = await query<AcceptanceRow>(
    `SELECT date_trunc('day', finished_at) AS day,
            count(*) FILTER (WHERE accepted)::int     AS accepted,
            count(*) FILTER (WHERE NOT accepted)::int AS rejected
       FROM run_stats
      WHERE finished_at >= now() - ($1 || ' days')::interval
      GROUP BY 1
      ORDER BY 1`,
    [String(days)],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Per player — the Rewind
// ---------------------------------------------------------------------------

export interface PlayerRewindRow {
  username: string;
  created_at: Date;
  high_score: number;
  coins: number;
  runs: number;
  days_played: number;
  play_seconds: number;
  longest_run_seconds: number;
  pellets_eaten: number;
  fruit_eaten: number;
  coins_collected: number;
  ghosts_eaten: number;
  lives_lost: number;
  levels_cleared: number;
  challenge_progress: number;
  deaths_by_ghost: number[] | null;
  fruit_kind_counts: number[] | null;
  favourite_theme: string | null;
  favourite_beagle_skin: string | null;
}

/**
 * One player's year, in a single row.
 *
 * The two arrays come back SUMMED across every run — Postgres has no built-in
 * element-wise array sum, so they are unnested, grouped by ordinal and
 * re-aggregated with array_agg in ordinal order. Doing it in the pure layer
 * instead would mean shipping every run's arrays over the wire to add them up.
 *
 * `since` bounds it to a period, which is what makes this a "2026 rewind"
 * rather than an all-time total.
 */
export async function playerRewind(
  username: string,
  since: Date,
): Promise<PlayerRewindRow | null> {
  const { rows } = await query<PlayerRewindRow>(
    `WITH u AS (
       SELECT id, username, created_at, high_score, coins, challenge_progress
         FROM users WHERE username_lower = lower($1)
     ),
     runs AS (
       SELECT r.* FROM run_stats r JOIN u ON u.id = r.user_id
        WHERE r.finished_at >= $2 AND r.accepted
     ),
     deaths AS (
       SELECT array_agg(total ORDER BY ord) AS arr FROM (
         SELECT d.ord, sum(d.count)::int AS total
           FROM runs r, unnest(r.deaths_by_ghost) WITH ORDINALITY AS d(count, ord)
          GROUP BY d.ord
       ) x
     ),
     fruits AS (
       SELECT array_agg(total ORDER BY ord) AS arr FROM (
         SELECT f.ord, sum(f.count)::int AS total
           FROM runs r, unnest(r.fruit_kind_counts) WITH ORDINALITY AS f(count, ord)
          GROUP BY f.ord
       ) y
     )
     SELECT u.username, u.created_at, u.high_score, u.coins, u.challenge_progress,
            (SELECT count(*) FROM runs)::int                                AS runs,
            (SELECT count(DISTINCT date_trunc('day', finished_at))
               FROM runs)::int                                              AS days_played,
            (SELECT COALESCE(sum(play_seconds), 0) FROM runs)::int          AS play_seconds,
            (SELECT COALESCE(max(elapsed_seconds), 0) FROM runs)::int       AS longest_run_seconds,
            (SELECT COALESCE(sum(pellets_eaten), 0) FROM runs)::int         AS pellets_eaten,
            (SELECT COALESCE(sum(fruit_eaten), 0) FROM runs)::int           AS fruit_eaten,
            (SELECT COALESCE(sum(coins_collected), 0) FROM runs)::int       AS coins_collected,
            (SELECT COALESCE(sum(ghosts_eaten), 0) FROM runs)::int          AS ghosts_eaten,
            (SELECT COALESCE(sum(lives_lost), 0) FROM runs)::int            AS lives_lost,
            (SELECT COALESCE(sum(levels_cleared), 0) FROM runs)::int        AS levels_cleared,
            (SELECT arr FROM deaths)                                        AS deaths_by_ghost,
            (SELECT arr FROM fruits)                                        AS fruit_kind_counts,
            (SELECT maze_theme_id FROM runs WHERE maze_theme_id IS NOT NULL
              GROUP BY maze_theme_id ORDER BY count(*) DESC LIMIT 1)         AS favourite_theme,
            (SELECT beagle_skin_id FROM runs WHERE beagle_skin_id IS NOT NULL
              GROUP BY beagle_skin_id ORDER BY count(*) DESC LIMIT 1)        AS favourite_beagle_skin
       FROM u`,
    [username, since],
  );
  return rows[0] ?? null;
}

export interface PlayerSummaryRow {
  username: string;
  created_at: Date;
  high_score: number;
  runs: number;
  last_played: Date | null;
}

/** The player list the portal browses. `q` is an optional case-insensitive
 *  prefix filter; the LIKE pattern is built from a parameter, never
 *  interpolated. */
export async function playerList(q: string | null, limit: number): Promise<PlayerSummaryRow[]> {
  const { rows } = await query<PlayerSummaryRow>(
    `SELECT u.username, u.created_at, u.high_score,
            count(s.id)::int AS runs,
            max(s.started_at) AS last_played
       FROM users u
       LEFT JOIN game_sessions s ON s.user_id = u.id
      WHERE ($1::text IS NULL OR u.username_lower LIKE lower($1) || '%')
      GROUP BY u.id, u.username, u.created_at, u.high_score
      ORDER BY max(s.started_at) DESC NULLS LAST
      LIMIT $2`,
    [q, limit],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Notifications (IDEA-052b)
// ---------------------------------------------------------------------------

export interface NotifyReachRow {
  players_total: number;
  players_subscribed: number;
  devices: number;
  wants_announcements: number;
  wants_rank: number;
  devices_healthy: number;
  devices_failing: number;
}

/**
 * How many people could actually be reached.
 *
 * "Subscribed" counts PLAYERS, not devices — one person with a phone and a
 * laptop is one person who can be told, and reporting devices as reach would
 * flatter the number. Both are returned so the difference is visible.
 *
 * `devices_healthy` is a subscription the push service has accepted something
 * for. A device that has never had a successful send is not counted as healthy,
 * because until one lands there is no evidence it works.
 */
export async function notifyReach(): Promise<NotifyReachRow> {
  const { rows } = await query<NotifyReachRow>(
    `SELECT
       (SELECT count(*) FROM users)::int                                  AS players_total,
       (SELECT count(DISTINCT user_id) FROM push_subscriptions)::int      AS players_subscribed,
       (SELECT count(*) FROM push_subscriptions)::int                     AS devices,
       (SELECT count(DISTINCT s.user_id) FROM push_subscriptions s
          JOIN users u ON u.id = s.user_id WHERE u.notify_announcements)::int AS wants_announcements,
       (SELECT count(DISTINCT s.user_id) FROM push_subscriptions s
          JOIN users u ON u.id = s.user_id WHERE u.notify_rank)::int      AS wants_rank,
       (SELECT count(*) FROM push_subscriptions WHERE last_ok_at IS NOT NULL)::int AS devices_healthy,
       (SELECT count(*) FROM push_subscriptions WHERE failure_count > 0)::int      AS devices_failing`,
  );
  return rows[0];
}

export interface AnnouncementReachRow {
  id: string;
  kind: string;
  version: string | null;
  title: string;
  published_at: Date;
  seen_by: number;
  audience: number;
}

/**
 * Per note: how many players have OPENED the News screen since it went live.
 *
 * BE HONEST ABOUT WHAT THIS MEASURES. There is one `announcements_seen_at` per
 * player, not a per-note receipt, so "seen" means "opened the News screen at
 * some point after this was published" — which does mean the card was on their
 * screen, since the feed shows the most recent 25 newest-first. It does NOT
 * mean they read it, and it cannot distinguish a note they scrolled past.
 *
 * `audience` is players who existed WHEN IT WAS PUBLISHED. Counting everyone
 * would make an old note look progressively less read every time somebody new
 * signs up, which is backwards — they were never its audience.
 */
export async function announcementReach(): Promise<AnnouncementReachRow[]> {
  const { rows } = await query<AnnouncementReachRow>(
    `SELECT a.id, a.kind, a.version, a.title, a.published_at,
            (SELECT count(*) FROM users u
              WHERE u.announcements_seen_at >= a.published_at)::int AS seen_by,
            (SELECT count(*) FROM users u
              WHERE u.created_at <= a.published_at)::int            AS audience
       FROM announcements a
      WHERE a.published_at IS NOT NULL
      ORDER BY a.published_at DESC
      LIMIT 50`,
  );
  return rows;
}

export interface NewsEngagementRow {
  opened_ever: number;
  opened_7d: number;
  never_opened: number;
}

/** How many players use the News screen at all. */
export async function newsEngagement(): Promise<NewsEngagementRow> {
  const { rows } = await query<NewsEngagementRow>(
    `SELECT
       count(*) FILTER (WHERE announcements_seen_at IS NOT NULL)::int AS opened_ever,
       count(*) FILTER (WHERE announcements_seen_at >= now() - interval '7 days')::int AS opened_7d,
       count(*) FILTER (WHERE announcements_seen_at IS NULL)::int     AS never_opened
       FROM users`,
  );
  return rows[0];
}
