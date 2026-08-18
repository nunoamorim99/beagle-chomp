// OWNER: gameplay-engineer (IDEA-019/IDEA-020, Increment 2)
//
// Accumulates what actually happened during a run, so the server can check the
// reported score against the reported actions.
//
// Pure and three-free per CLAUDE.md's layer rule: no DOM, no network, no
// imports beyond types. game.ts owns one instance per run and calls the
// record* helpers at the points where the game already changes the score.
//
// This is NOT an anti-cheat measure on its own — a determined client can lie
// about all of it. Its job is to make the numbers CHECKABLE: the server knows
// how many pellets each maze holds, so a score that doesn't match the items
// (or items that can't exist) is caught. What the client cannot fake is the
// elapsed time, which the server measures itself.

export interface RunTelemetry {
  pelletsEaten: number;
  bonesEaten: number;
  fruitEaten: number;
  ghostsEaten: number;
  coinsCollected: number;
  livesLost: number;
  levelsCleared: number;
  /** Accumulated REAL play time. Advisory only — the server measures elapsed
   *  time itself; this is here so a future diagnostic can compare them. */
  playSeconds: number;
  /** The resolved maze index of every level played, in order. Its length is the
   *  number of levels played, which bounds every per-level check server-side. */
  mazeIdxSequence: number[];
  /** IDEA-040: the 0-based CLASSIC LEVEL index of each level played, parallel
   *  to mazeIdxSequence. The server needs it because a level's score ceiling
   *  depends on its ghost count (stage 3 has 4, a bonus level 1), and it
   *  re-derives the maze from this index to check the two agree. Empty for
   *  challenge runs, which carry their own fixed modifiers. */
  levelIdxSequence: number[];
}

export function createRunTelemetry(): RunTelemetry {
  return {
    pelletsEaten: 0,
    bonesEaten: 0,
    fruitEaten: 0,
    ghostsEaten: 0,
    coinsCollected: 0,
    livesLost: 0,
    levelsCleared: 0,
    playSeconds: 0,
    mazeIdxSequence: [],
    levelIdxSequence: [],
  };
}

/** A biscuit — the `.` tiles. Counted separately from bones because the server
 *  values them differently (10 vs 50) and bounds them separately. */
export function recordPellet(t: RunTelemetry): void {
  t.pelletsEaten++;
}

/** A bone (power pellet) — the `o` tiles. Also opens a fright window, which is
 *  what bounds how many ghosts can be eaten. */
export function recordBone(t: RunTelemetry): void {
  t.bonesEaten++;
}

export function recordFruit(t: RunTelemetry): void {
  t.fruitEaten++;
}

export function recordGhost(t: RunTelemetry): void {
  t.ghostsEaten++;
}

/** A coin PICKUP from the maze. Deliberately not the coins earned from score
 *  milestones — the server recomputes those itself from the accepted score. */
export function recordCoin(t: RunTelemetry): void {
  t.coinsCollected++;
}

export function recordDeath(t: RunTelemetry): void {
  t.livesLost++;
}

export function recordLevelCleared(t: RunTelemetry): void {
  t.levelsCleared++;
}

/**
 * Called when a level starts, with the maze index it resolved to.
 *
 * `levelIdx` is the 0-based CLASSIC level index (IDEA-040) and is omitted for
 * challenge runs, whose modifiers come from CHALLENGE_LEVELS rather than the
 * classic progression. The two arrays stay parallel: the server pairs them by
 * position to check each claimed level really uses the maze it says.
 */
export function recordLevelStarted(t: RunTelemetry, mazeIdx: number, levelIdx?: number): void {
  t.mazeIdxSequence.push(mazeIdx);
  if (levelIdx !== undefined) t.levelIdxSequence.push(levelIdx);
}

/**
 * Accumulate play time.
 *
 * MUST be called from updatePlay(), NOT from tick(): tick() skips update(dt)
 * entirely while the shop is open (game.ts), so wall-clock time would count
 * shop browsing as gameplay. Only real play should land here.
 */
export function accumulatePlayTime(t: RunTelemetry, dt: number): void {
  if (Number.isFinite(dt) && dt > 0) t.playSeconds += dt;
}
