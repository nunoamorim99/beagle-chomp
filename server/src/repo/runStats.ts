// OWNER: backend
//
// run_stats access (IDEA-050). Per STACK.md §2.7, SQL lives only in repo/*.
//
// The invariant this module protects: WRITING STATISTICS MUST NEVER COST A
// PLAYER THEIR SCORE.
//
// That is why the insert happens AFTER the finish transaction commits, not
// inside it, and why scoreService wraps the call in a try/catch. Inside the
// transaction the row would be perfectly consistent with game_sessions — and
// any bug in it (a bad array cast, a column that drifted from the schema, a
// constraint nobody predicted) would roll back the banked score, the coins and
// the high score along with it. This project has already shipped three separate
// causes of vanished runs and spent most of v5.1 and v6.0 hunting them; an
// analytics by-product is not allowed to become a fourth.
//
// The cost of that choice is bounded and acceptable: a process that dies in the
// window between COMMIT and this insert loses one row of statistics. Nobody
// loses a score. ON CONFLICT DO NOTHING makes the write idempotent, so a retry
// or a resurrected session cannot double-count.

import { query } from "../db.js";
import type { Executor } from "./types.js";

export interface RunStatsInsert {
  sessionId: string;
  userId: string;
  accepted: boolean;
  mode: "classic" | "challenge";
  challengeIdx: number | null;
  score: number;
  elapsedSeconds: number;

  levelsPlayed: number;
  levelsCleared: number;
  /** Highest classic level index reached, or null on a challenge run (whose
   *  levels are named by challengeIdx instead). */
  maxLevelIdx: number | null;
  pelletsEaten: number;
  bonesEaten: number;
  fruitEaten: number;
  fruitPoints: number;
  /** null when the client predates the field — distinct from [], which means
   *  the run ate no fruit. Preserved rather than collapsed so a later query can
   *  tell "unknown" from "none". */
  fruitKindCounts: number[] | null;
  powerupsCollected: number;
  powerupIds: string[];
  ghostsEaten: number;
  coinsCollected: number;
  livesLost: number;
  deathsByGhost: number[] | null;
  playSeconds: number;

  beagleSkinId: string | null;
  enemySkinId: string | null;
  mazeThemeId: string | null;
  controlScheme: string | null;
}

const INSERT_SQL = `
  INSERT INTO run_stats (
    session_id, user_id, finished_at, accepted, mode, challenge_idx,
    score, elapsed_seconds,
    levels_played, levels_cleared, max_level_idx,
    pellets_eaten, bones_eaten, fruit_eaten, fruit_points, fruit_kind_counts,
    powerups_collected, powerup_ids, ghosts_eaten, coins_collected,
    lives_lost, deaths_by_ghost, play_seconds,
    beagle_skin_id, enemy_skin_id, maze_theme_id, control_scheme
  )
  VALUES (
    $1, $2, now(), $3, $4, $5,
    $6, $7,
    $8, $9, $10,
    $11, $12, $13, $14, $15,
    $16, $17, $18, $19,
    $20, $21, $22,
    $23, $24, $25, $26
  )
  ON CONFLICT (session_id) DO NOTHING
`;

/**
 * Record one finished run.
 *
 * `finished_at` is `now()` rather than a passed-in timestamp for the same
 * reason `game_sessions.started_at` is: the server's clock is the only one that
 * cannot be forged. It lands a few milliseconds after the transaction's own
 * `finished_at`, which no query here cares about.
 *
 * ON CONFLICT DO NOTHING covers the resurrection path in scoreService — an
 * `abandoned` session that a late finish revives could, in principle, already
 * have a row. Silently keeping the first one is right: a run happened once,
 * however many times its finish was delivered.
 *
 * `client` exists for the DB-backed tests, which drive this inside their own
 * transaction to keep cleanup simple. Production calls it on the pool, after
 * the finish has committed.
 */
export async function insertRunStats(row: RunStatsInsert, client?: Executor): Promise<void> {
  const params = [
    row.sessionId,
    row.userId,
    row.accepted,
    row.mode,
    row.challengeIdx,
    row.score,
    row.elapsedSeconds,
    row.levelsPlayed,
    row.levelsCleared,
    row.maxLevelIdx,
    row.pelletsEaten,
    row.bonesEaten,
    row.fruitEaten,
    row.fruitPoints,
    row.fruitKindCounts,
    row.powerupsCollected,
    row.powerupIds,
    row.ghostsEaten,
    row.coinsCollected,
    row.livesLost,
    row.deathsByGhost,
    row.playSeconds,
    row.beagleSkinId,
    row.enemySkinId,
    row.mazeThemeId,
    row.controlScheme,
  ];

  if (client) await client.query(INSERT_SQL, params);
  else await query(INSERT_SQL, params);
}
