// OWNER: gameplay-engineer
// Top-level game state machine types. The loop transitions between these.
export type GameMode = "ready" | "play" | "dying" | "levelclear" | "over";

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
