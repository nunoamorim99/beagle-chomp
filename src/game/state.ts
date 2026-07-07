// OWNER: gameplay-engineer
// Top-level game state machine types. The loop transitions between these.
import { START_LIVES } from "./config";

// "start" is the boot-only idle mode: shows the Start panel and poses the
// preview scene without counting down or auto-transitioning. The loop only
// ever leaves it via the Start button's click handler calling startLevel(0),
// which sets mode="ready" with a real stateTimer. Distinct from "ready" (a
// real countdown-to-play banner state entered from startLevel/dying) so the
// switch in game.ts can never accidentally race stateTimer=0 into "play"
// before the player has clicked anything.
export type GameMode = "start" | "ready" | "play" | "dying" | "levelclear" | "over";

export interface GameState {
  mode: GameMode;
  score: number;
  lives: number;
  level: number;          // 0-based; map = level % MAZE_COUNT
  stateTimer: number;     // countdown for ready/dying/levelclear
  frightTimer: number;
  ghostEatChain: number;
  globalMode: "scatter" | "chase";
  modeClock: number;
  scheduleIdx: number;
}

/**
 * Fresh GameState for a brand-new run (boot / "Play again"). Kept here (pure,
 * three/DOM-free) so game.ts doesn't scatter the same literal defaults across
 * its constructor and game-over handler. `level`/`stateTimer` start at 0 —
 * the caller (Game.startLevel) sets the real values immediately after.
 */
export function createInitialGameState(): GameState {
  return {
    mode: "start",
    score: 0,
    lives: START_LIVES,
    level: 0,
    stateTimer: 0,
    frightTimer: 0,
    ghostEatChain: 0,
    globalMode: "scatter",
    modeClock: 0,
    scheduleIdx: 0,
  };
}
