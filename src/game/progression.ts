// OWNER: gameplay-engineer (IDEA-040 — stages and bonus levels;
//         IDEA-061 — 30 maps, 6 stages, and a map number that never resets)
//
// THE single source of truth for what a classic level is: which maze, how many
// enemies, and what to call it on screen.
//
// Pure and three-free (CLAUDE.md's layer rule) for two reasons: it is unit
// testable in Node, and — more importantly — the SERVER vendors a generated
// copy of it. The score validator has to know how many ghosts a level had,
// because the per-level score ceiling depends on it (a 4-ghost level can yield
// far more than a 3-ghost one). If the two ever disagreed, honest runs would
// start being rejected: exactly the class of bug that cost real players their
// scores in v5.0-v5.1. So this file is generated into the server catalog by
// server/scripts/sync-game-constants.ts and pinned by the drift test.
//
// Classic mode only. Challenge mode (challenges.ts) picks its own mazeIdx per
// level and never consults this.

import { MAZE_COUNT } from "./mazes";

/** Numbered maps per stage. */
export const MAPS_PER_STAGE = 5;

/** Six stages of five, each followed by one bonus level. */
export const STAGE_COUNT = 6;

/** 30 numbered maps + 6 bonus levels = one full lap. */
export const LEVELS_PER_LAP = STAGE_COUNT * (MAPS_PER_STAGE + 1);

/** Numbered maps in a lap (excludes the bonus levels). */
export const MAPS_PER_LAP = STAGE_COUNT * MAPS_PER_STAGE;

// Ghost counts. The engine's GHOST_DEFS has 5 entries, so 1..5 are all real
// personalities — a bonus level's single ghost is GHOST_DEFS[0], the same
// chaser the player already knows.
//
// Six stages ramp 3 -> 4 -> 5, two stages at each count, and that is the whole
// difficulty curve. Maps 1-15 are deliberately left exactly where IDEA-040 had
// them (3 / 3 / 4): the fifteen maps a player already knows must not change
// difficulty underneath them, so the new stages EXTEND the ramp rather than
// redistribute it. Stages 5-6 field the violet and leaf enemies, which classic
// mode had never used — ENEMY_SLOTS has always had five entries and classic
// took a slice of three or four from the front.
export const GHOSTS_STAGE_1_2 = 3;
export const GHOSTS_STAGE_3_4 = 4;
export const GHOSTS_STAGE_5_6 = 5;
export const GHOSTS_BONUS_FIRST_LAP = 1;
export const GHOSTS_BONUS_LATER_LAPS = 2;

/** Enemies on a numbered map in the given 0-based stage, on lap 1. */
export function ghostsForStage(stageIdx: number): number {
  if (stageIdx >= 4) return GHOSTS_STAGE_5_6;
  if (stageIdx >= 2) return GHOSTS_STAGE_3_4;
  return GHOSTS_STAGE_1_2;
}

export interface LevelPlan {
  /** Index into MAZES. */
  mazeIdx: number;
  /** How many of GHOST_DEFS to spawn. */
  ghostCount: number;
  /** Bonus levels are wide-open, low-pressure point farms between stages. */
  isBonus: boolean;
  /**
   * The number the HUD shows, or null for a bonus level.
   *
   * It NEVER RESETS (IDEA-061, Nuno): the first map of lap 2 is Map 31, not
   * Map 1 again. A player who has cleared the whole cycle is still making
   * progress, and a HUD that drops back to "Map 1" reads as having lost it.
   * The MAZE repeats — Map 31 is maze 0 a second time — but the count does not,
   * so this is NOT an index into anything.
   */
  mapNumber: number | null;
  /** 1-based. Lap 2 onward is the "pro" cycle: 5 enemies on every numbered map. */
  lap: number;
  /** 1..6 for numbered maps; the stage a bonus level closes out. */
  stage: number;
}

/**
 * Where the bonus mazes live in MAZES.
 *
 * Laid out as [0..29] numbered maps then [30..35] bonus, so a numbered map's
 * maze index is simply its 0-based position. Keeping mazes 0-4 exactly where
 * they were means the five original maps are untouched, and challenge mode —
 * which hardcodes mazeIdx 0-4 — keeps working with no changes at all.
 *
 * IDEA-061 moved the three original bonus mazes from [15..17] to [30..32] to
 * make room for maps 16-30. Nothing stores a bonus maze by index, so the move
 * is invisible: a submitted run's mazeIdxSequence is CHECKED against what
 * planLevel() says it must be, never compared with an older run's.
 */
export const BONUS_MAZE_START = MAPS_PER_LAP;

/**
 * Plan a classic level from its 0-based index.
 *
 * The whole progression lives here, so difficulty is tuned in ONE place:
 *
 *   idx 0-4    Maps 1-5     mazes 0-4     3 ghosts
 *   idx 5      Bonus        maze 30       1 ghost (2 from lap 2)
 *   idx 6-10   Maps 6-10    mazes 5-9     3 ghosts
 *   idx 11     Bonus        maze 31       1 ghost (2 from lap 2)
 *   idx 12-16  Maps 11-15   mazes 10-14   4 ghosts
 *   idx 17     Bonus        maze 32       1 ghost (2 from lap 2)
 *   idx 18-22  Maps 16-20   mazes 15-19   4 ghosts
 *   idx 23     Bonus        maze 33       1 ghost (2 from lap 2)
 *   idx 24-28  Maps 21-25   mazes 20-24   5 ghosts
 *   idx 29     Bonus        maze 34       1 ghost (2 from lap 2)
 *   idx 30-34  Maps 26-30   mazes 25-29   5 ghosts
 *   idx 35     Bonus        maze 35       1 ghost (2 from lap 2)
 *   idx 36+    lap 2+       same mazes    5 ghosts on EVERY numbered map,
 *                                         numbered Map 31, Map 32, Map 33 …
 *
 * From lap 2 the whole cycle runs at 5 enemies — the endless "pro" mode. A
 * player who clears a full lap at that difficulty has effectively maxed the
 * game out, which is what the completion achievement recognises.
 */
export function planLevel(levelIdx: number): LevelPlan {
  const safeIdx = Number.isFinite(levelIdx) && levelIdx > 0 ? Math.floor(levelIdx) : 0;

  const lap = Math.floor(safeIdx / LEVELS_PER_LAP) + 1;
  const withinLap = safeIdx % LEVELS_PER_LAP;

  // Each stage is MAPS_PER_STAGE numbered maps followed by one bonus.
  const stageIdx = Math.floor(withinLap / (MAPS_PER_STAGE + 1));
  const withinStage = withinLap % (MAPS_PER_STAGE + 1);
  const isBonus = withinStage === MAPS_PER_STAGE;

  if (isBonus) {
    return {
      mazeIdx: BONUS_MAZE_START + stageIdx,
      // A bonus level is a reward, but from lap 2 a single ghost would make it
      // free life-farming for a strong player, so it gains a second.
      ghostCount: lap === 1 ? GHOSTS_BONUS_FIRST_LAP : GHOSTS_BONUS_LATER_LAPS,
      isBonus: true,
      mapNumber: null,
      lap,
      stage: stageIdx + 1,
    };
  }

  const mapIdx = stageIdx * MAPS_PER_STAGE + withinStage; // 0..29

  return {
    mazeIdx: mapIdx,
    // Stages 3-4 introduce the 4th enemy and stages 5-6 the 5th; from lap 2
    // every numbered map runs at the ceiling. Deliberately NOT compensated for
    // with easier mazes — the extra enemy IS the added difficulty (Nuno,
    // 2026-08-18).
    ghostCount: lap > 1 ? GHOSTS_STAGE_5_6 : ghostsForStage(stageIdx),
    isBonus: false,
    // The RUNNING count, not the position within the lap (IDEA-061): lap 2's
    // first numbered map is Map 31.
    mapNumber: (lap - 1) * MAPS_PER_LAP + mapIdx + 1,
    lap,
    stage: stageIdx + 1,
  };
}

/**
 * The HUD label: "Map 7", "Map 31", or "Bonus".
 *
 * There is no lap suffix any more (IDEA-061). It only existed to disambiguate a
 * map number that wrapped, and the number no longer wraps — "Map 3 ·2" became
 * "Map 33", which says the same thing with one figure instead of two. Bonus
 * levels stay unnumbered: the map count already shows how far in the player is.
 */
export function levelLabel(levelIdx: number): string {
  const plan = planLevel(levelIdx);
  return plan.isBonus ? "Bonus" : `Map ${plan.mapNumber}`;
}

/**
 * True when finishing this level completes a full lap at maximum difficulty
 * (every numbered map at 4 enemies) — the completion achievement.
 *
 * Lap 1 doesn't count: its first two stages are 3-enemy. The first qualifying
 * moment is the end of lap 2, i.e. clearing levelIdx LEVELS_PER_LAP*2 - 1.
 */
export function completesMaxDifficultyLap(levelIdx: number): boolean {
  const plan = planLevel(levelIdx);
  return plan.lap > 1 && (levelIdx % LEVELS_PER_LAP) === LEVELS_PER_LAP - 1;
}

/** How many mazes the progression needs. Asserted by the maze validator so a
 *  missing maze fails loudly rather than wrapping to the wrong map. */
export const REQUIRED_MAZE_COUNT = MAPS_PER_LAP + STAGE_COUNT; // 36

/** True once mazes.json actually holds every maze the progression references. */
export function hasAllMazes(): boolean {
  return MAZE_COUNT >= REQUIRED_MAZE_COUNT;
}
