// OWNER: backend (IDEA-078)
//
// challenge_claims access, and the one aggregate that feeds the evaluator. Per
// STACK.md §2.7, SQL lives only in repo/*.
//
// ---------------------------------------------------------------------------
// ONE QUERY, TWO ROWS
// ---------------------------------------------------------------------------
//
// Every "in one run" personal best and every "in general" lifetime total for
// both modes comes back from a SINGLE indexed pass over one player's rows,
// grouped by mode. `run_stats` is indexed on (user_id, finished_at DESC), which
// is the access path, and the aggregate touches nothing else.
//
// That is the whole reason this feature needed no accumulator: the numbers were
// already being written, once per finished run, by IDEA-050.
//
// TWO FILTERS ARE LOAD-BEARING AND NEITHER IS OPTIONAL:
//
//   accepted = true   -- run_stats deliberately records REJECTED runs too, so
//                        the rejection RATE is measurable (it is the alarm for
//                        a forgotten `npm run sync`). A rejected run is a run
//                        the validator refused to believe; counting it toward a
//                        reward would pay out for exactly the submissions the
//                        anti-cheat path caught.
//
//   user_id = $1      -- scoped in the WHERE clause rather than filtered after,
//                        same discipline as findSessionForUser.

import { query } from "../db.js";
import type { QueryResultRow } from "pg";
import type { Executor } from "./types.js";
import {
  emptyChallengeStats,
  emptyModeStats,
  type ChallengeStats,
  type ModeStats,
} from "../validation/challenges.js";

/** Journey per-level thresholds. These MIRROR src/game/challenges.ts's
 *  COINS_PER_MAP / FRUIT_PER_MAP / JOURNEY_GHOST_TARGET, which are themselves
 *  measured off config.ts's COIN_THRESHOLDS (five) and FRUIT_THRESHOLDS
 *  (FOUR — not five, which is the number everyone guesses wrong).
 *
 *  They are hand-copied rather than synced because they are not part of any
 *  challenge DEFINITION — they are the meaning of three metrics. test-catalog
 *  asserts they agree with the client's constants, so the copy cannot drift
 *  silently; if a balance change ever moves them, that test fails first. */
const JOURNEY_ALL_COINS = 5;
const JOURNEY_ALL_FRUIT = 4;
const JOURNEY_GHOSTS = 5;

interface ModeAggRow {
  mode: string;
  run_coins: string | null;
  run_ghosts: string | null;
  run_fruit: string | null;
  run_bones: string | null;
  run_score: string | null;
  run_levels: string | null;
  run_powerups: string | null;
  run_deathless: string | null;
  total_coins: string | null;
  total_ghosts: string | null;
  total_fruit: string | null;
  total_bones: string | null;
  total_score: string | null;
  total_levels: string | null;
  total_powerups: string | null;
}

interface JourneyAggRow {
  deathless: string | null;
  all_coins: string | null;
  all_fruit: string | null;
  ghosts: string | null;
}

/** Postgres returns bigint aggregates as STRINGS through node-postgres, and
 *  MAX/SUM over an empty set returns NULL. Both would flow into the evaluator
 *  as `"12" >= 10` (true by luck, on string comparison) or `null >= 10`
 *  (false, silently) — so every column goes through here. */
const num = (v: string | null): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

function toModeStats(row: ModeAggRow): ModeStats {
  return {
    runCoins: num(row.run_coins),
    runGhosts: num(row.run_ghosts),
    runFruit: num(row.run_fruit),
    runBones: num(row.run_bones),
    runScore: num(row.run_score),
    runLevels: num(row.run_levels),
    runPowerups: num(row.run_powerups),
    runDeathlessLevels: num(row.run_deathless),
    totalCoins: num(row.total_coins),
    totalGhosts: num(row.total_ghosts),
    totalFruit: num(row.total_fruit),
    totalBones: num(row.total_bones),
    totalScore: num(row.total_score),
    totalLevels: num(row.total_levels),
    totalPowerups: num(row.total_powerups),
  };
}

/**
 * Everything the evaluator needs about one player.
 *
 * `journeyUnlocked` is passed IN rather than queried: it is
 * `users.challenge_progress`, the caller already holds the user row, and taking
 * it from there keeps one canonical source for "how far up the ladder" instead
 * of a second count that could disagree with the column scoreService writes.
 */
export async function statsForUser(
  userId: string,
  journeyUnlocked: number,
  client?: Executor,
): Promise<ChallengeStats> {
  const modeSql = `
    SELECT mode,
           MAX(coins_collected)                                   AS run_coins,
           MAX(ghosts_eaten)                                      AS run_ghosts,
           MAX(fruit_eaten)                                       AS run_fruit,
           MAX(bones_eaten)                                       AS run_bones,
           MAX(score)                                             AS run_score,
           MAX(levels_cleared)                                    AS run_levels,
           MAX(powerups_collected)                                AS run_powerups,
           -- A conditional MAX, not a count: lives_lost is a whole-run total,
           -- so this is "the longest run in which nothing killed you".
           MAX(CASE WHEN lives_lost = 0 THEN levels_cleared ELSE 0 END) AS run_deathless,
           SUM(coins_collected)                                   AS total_coins,
           SUM(ghosts_eaten)                                      AS total_ghosts,
           SUM(fruit_eaten)                                       AS total_fruit,
           SUM(bones_eaten)                                       AS total_bones,
           SUM(score)                                             AS total_score,
           SUM(levels_cleared)                                    AS total_levels,
           SUM(powerups_collected)                                AS total_powerups
      FROM run_stats
     WHERE user_id = $1 AND accepted
     GROUP BY mode`;

  // The per-level family. COUNT(DISTINCT challenge_idx) is what collapses "do
  // it in each level" from forty booleans into one ladder — and it is why these
  // cannot be folded into the query above, which groups by mode rather than by
  // level.
  const journeySql = `
    SELECT COUNT(DISTINCT challenge_idx) FILTER (WHERE lives_lost = 0 AND levels_cleared >= 1) AS deathless,
           COUNT(DISTINCT challenge_idx) FILTER (WHERE coins_collected >= $2)                  AS all_coins,
           COUNT(DISTINCT challenge_idx) FILTER (WHERE fruit_eaten     >= $3)                  AS all_fruit,
           COUNT(DISTINCT challenge_idx) FILTER (WHERE ghosts_eaten    >= $4)                  AS ghosts
      FROM run_stats
     WHERE user_id = $1 AND accepted AND mode = 'challenge' AND challenge_idx IS NOT NULL`;

  // pg's own row constraint, not Record<string, unknown>: an interface without
  // an index signature does not satisfy the latter, and widening the interface
  // to get past that would throw away the column names this file exists to
  // name.
  const run = async <T extends QueryResultRow>(sql: string, params: unknown[]) =>
    client
      ? (await client.query<T>(sql, params)).rows
      : (await query<T>(sql, params)).rows;

  // SEQUENTIAL WHEN THERE IS A TRANSACTION CLIENT, CONCURRENT OTHERWISE.
  //
  // A single PoolClient cannot run two queries at once — node-postgres queues
  // them and warns that it will throw in pg@9. The claim path passes its
  // transaction client here, so a Promise.all over both statements was exactly
  // that case, and it surfaced only as a DeprecationWarning in a passing test.
  // Off the pool (the list endpoint) each call takes its own connection, so
  // running them together is free and halves the latency of the screen's load.
  const [modeRows, journeyRows] = client
    ? [
        await run<ModeAggRow>(modeSql, [userId]),
        await run<JourneyAggRow>(journeySql, [userId, JOURNEY_ALL_COINS, JOURNEY_ALL_FRUIT, JOURNEY_GHOSTS]),
      ]
    : await Promise.all([
        run<ModeAggRow>(modeSql, [userId]),
        run<JourneyAggRow>(journeySql, [userId, JOURNEY_ALL_COINS, JOURNEY_ALL_FRUIT, JOURNEY_GHOSTS]),
      ]);

  const stats: ChallengeStats = emptyChallengeStats();
  stats.journeyUnlocked = Number.isFinite(journeyUnlocked) ? Math.max(0, journeyUnlocked) : 0;

  for (const row of modeRows) {
    // The wire/DB name for the Journey is still "challenge" — IDEA-077 renamed
    // what a player reads and nothing else. This is the one place the two
    // vocabularies meet, so it is the one place the mapping is written.
    if (row.mode === "classic") stats.classic = toModeStats(row);
    else if (row.mode === "challenge") stats.journey = toModeStats(row);
  }
  // A player with runs in only one mode gets no row for the other; the empty
  // bag above already covers that, but being explicit costs nothing.
  if (modeRows.length === 0) {
    stats.classic = emptyModeStats();
    stats.journey = emptyModeStats();
  }

  const j = journeyRows[0];
  if (j) {
    stats.journeyDeathless = num(j.deathless);
    stats.journeyAllCoins = num(j.all_coins);
    stats.journeyAllFruit = num(j.all_fruit);
    stats.journeyGhosts = num(j.ghosts);
  }

  return stats;
}

export interface ClaimRow {
  challenge_id: string;
  reward_coins: number;
  claimed_at: Date;
}

export async function claimsForUser(userId: string, client?: Executor): Promise<ClaimRow[]> {
  const sql = `SELECT challenge_id, reward_coins, claimed_at
                 FROM challenge_claims WHERE user_id = $1`;
  const res = client ? await client.query<ClaimRow>(sql, [userId]) : await query<ClaimRow>(sql, [userId]);
  return res.rows;
}

/**
 * Record a claim. Returns false if this player had already claimed it.
 *
 * ON CONFLICT DO NOTHING plus the row count is what makes a double-claim
 * impossible rather than unlikely: two requests racing each other both read
 * "not claimed" a moment earlier, and only the primary key decides which one
 * actually pays. The loser gets `false` and the caller turns that into
 * ALREADY_CLAIMED — no coins, no error the player has to understand.
 */
export async function insertClaim(
  userId: string,
  challengeId: string,
  rewardCoins: number,
  client: Executor,
): Promise<boolean> {
  const sql = `INSERT INTO challenge_claims (user_id, challenge_id, reward_coins)
               VALUES ($1, $2, $3)
               ON CONFLICT (user_id, challenge_id) DO NOTHING`;
  const params = [userId, challengeId, rewardCoins];
  const res = client ? await client.query(sql, params) : await query(sql, params);
  return (res.rowCount ?? 0) > 0;
}
