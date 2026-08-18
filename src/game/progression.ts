// OWNER: gameplay-engineer (IDEA-040 — 15 maps, 3 stages, bonus levels)
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

/** Three stages of five, each followed by one bonus level. */
export const STAGE_COUNT = 3;

/** 15 numbered maps + 3 bonus levels = one full lap. */
export const LEVELS_PER_LAP = STAGE_COUNT * (MAPS_PER_STAGE + 1);

/** Numbered maps in a lap (excludes the bonus levels). */
export const MAPS_PER_LAP = STAGE_COUNT * MAPS_PER_STAGE;

/** Ghost counts. The engine's GHOST_DEFS has 5 entries, so 1..5 are all real
 *  personalities — a bonus level's single ghost is GHOST_DEFS[0], the same
 *  chaser the player already knows. */
export const GHOSTS_STAGE_1_2 = 3;
export const GHOSTS_STAGE_3 = 4;
export const GHOSTS_BONUS_FIRST_LAP = 1;
export const GHOSTS_BONUS_LATER_LAPS = 2;

export interface LevelPlan {
  /** Index into MAZES. */
  mazeIdx: number;
  /** How many of GHOST_DEFS to spawn. */
  ghostCount: number;
  /** Bonus levels are wide-open, low-pressure point farms between stages. */
  isBonus: boolean;
  /** 1..15 for a numbered map, null for a bonus level. */
  mapNumber: number | null;
  /** 1-based. Lap 2 onward is the "pro" cycle: 4 enemies on every numbered map. */
  lap: number;
  /** 1..3 for numbered maps; the stage a bonus level closes out. */
  stage: number;
}

/**
 * Where the bonus mazes live in MAZES.
 *
 * Laid out as [0..14] numbered maps then [15..17] bonus, so a numbered map's
 * maze index is simply its 0-based position. Keeping mazes 0-4 exactly where
 * they were means the five original maps are untouched, and challenge mode —
 * which hardcodes mazeIdx 0-4 — keeps working with no changes at all.
 */
export const BONUS_MAZE_START = MAPS_PER_LAP;

/**
 * Plan a classic level from its 0-based index.
 *
 * The whole progression lives here, so difficulty is tuned in ONE place:
 *
 *   idx 0-4    Maps 1-5     mazes 0-4     3 ghosts
 *   idx 5      Bonus        maze 15       1 ghost (2 from lap 2)
 *   idx 6-10   Maps 6-10    mazes 5-9     3 ghosts
 *   idx 11     Bonus        maze 16       1 ghost (2 from lap 2)
 *   idx 12-16  Maps 11-15   mazes 10-14   4 ghosts
 *   idx 17     Bonus        maze 17       1 ghost (2 from lap 2)
 *   idx 18+    lap 2+       same mazes    4 ghosts on EVERY numbered map
 *
 * From lap 2 the whole cycle runs at 4 enemies — the endless "pro" mode. A
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

  const mapIdx = stageIdx * MAPS_PER_STAGE + withinStage; // 0..14

  return {
    mazeIdx: mapIdx,
    // Stage 3 introduces the 4th enemy; from lap 2 every numbered map has it.
    // Deliberately NOT compensated for with easier mazes — the extra enemy IS
    // the added difficulty (Nuno, 2026-08-18).
    ghostCount: lap > 1 || stageIdx === STAGE_COUNT - 1 ? GHOSTS_STAGE_3 : GHOSTS_STAGE_1_2,
    isBonus: false,
    mapNumber: mapIdx + 1,
    lap,
    stage: stageIdx + 1,
  };
}

/** The HUD label: "Map 7", "Bonus", or "Map 3 ·2" once past the first lap. */
export function levelLabel(levelIdx: number): string {
  const plan = planLevel(levelIdx);
  const lapSuffix = plan.lap > 1 ? ` ·${plan.lap}` : "";
  return plan.isBonus ? `Bonus${lapSuffix}` : `Map ${plan.mapNumber}${lapSuffix}`;
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
export const REQUIRED_MAZE_COUNT = MAPS_PER_LAP + STAGE_COUNT; // 18

/** True once mazes.json actually holds every maze the progression references. */
export function hasAllMazes(): boolean {
  return MAZE_COUNT >= REQUIRED_MAZE_COUNT;
}
