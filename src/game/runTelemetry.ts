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
  /**
   * IDEA-045: the total POINTS those fruits were worth.
   *
   * The count alone stopped being enough the moment fruit stopped having one
   * price: two fruits can now be anything from 200 (two Apples) to 1000 (two
   * Mangos), and the server checks the reported score against the reported
   * items. Without this it would have to assume the widest possible range on
   * every run, which is exactly the kind of slack a validator exists to avoid.
   *
   * The server still does NOT trust it — it bounds this against
   * fruitEaten * MAX_FRUIT_POINTS and fruitEaten * MIN_FRUIT_POINTS, so a
   * client claiming four Mangos it never ate is caught by the same arithmetic
   * that catches every other inflated count.
   */
  fruitPoints: number;
  /** IDEA-046: how many power-ups were collected across the run. Bounded
   *  server-side by POWERUP_THRESHOLDS.length * levels played. */
  powerupsCollected: number;
  /**
   * Which power-ups were collected at least once, by id.
   *
   * The server needs this and not just the count, because two of the five
   * MULTIPLY THE SCORE: without knowing whether a doubler was ever picked up,
   * the score ceiling would have to assume one always was — which doubles the
   * headroom available to a faked score on every single run, including the
   * ones that never saw a power-up.
   */
  powerupIds: string[];
  /**
   * IDEA-045 v2 / IDEA-050: how many of each fruit was eaten, indexed by
   * position in FRUITS.
   *
   * Wanted by the year-end rewind ("your favourite fruit"), but it also PAYS
   * FOR ITSELF on the validation side: knowing the kinds lets the server price
   * the fruit contribution EXACTLY, instead of bounding it between
   * `fruitEaten * MIN_FRUIT_POINTS` and `fruitEaten * MAX_FRUIT_POINTS` — a
   * 5x-wide band on every run. A narrower honest bound is strictly better
   * anti-cheat than a wide one.
   *
   * Grows on demand rather than being pre-sized to FRUITS.length: this module
   * deliberately imports NOTHING (that is what keeps it trivially testable),
   * and a hardcoded 5 here would be a second copy of the table's length,
   * free to drift the moment a sixth fruit lands.
   */
  fruitKindCounts: number[];
  ghostsEaten: number;
  coinsCollected: number;
  livesLost: number;
  /**
   * IDEA-050: deaths per ENEMY, indexed by position in GHOST_DEFS (game.ts) —
   * rose, teal, amber, violet, leaf.
   *
   * That index is the only identity an enemy has: `Ghost` in ghostAI.ts
   * carries no id and no colour, and `resetActors` builds `this.ghosts` with
   * `GHOST_DEFS.slice(0, ghostCount).map(...)`, so a slice from 0 preserves
   * the original positions even on a challenge level that builds fewer than
   * five. `rebuildEnemySkins` maps in place and preserves them too.
   *
   * Sums to `livesLost` by construction — the server checks exactly that, so
   * a client inflating one cannot leave the other behind.
   */
  deathsByGhost: number[];
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
    fruitPoints: 0,
    powerupsCollected: 0,
    powerupIds: [],
    fruitKindCounts: [],
    ghostsEaten: 0,
    coinsCollected: 0,
    livesLost: 0,
    deathsByGhost: [],
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

/**
 * Bump a per-kind counter, growing the array to fit.
 *
 * Shared by the fruit and enemy tallies. Out-of-range or non-integer indices
 * are DROPPED rather than throwing or writing a hole: these arrays are summed
 * against another counter server-side, and a `[1, <2 empty items>, 1]` would
 * serialise to `[1, null, null, 1]` over JSON and read as malformed. A dropped
 * bump fails the sum check loudly, which is the outcome we want — a telemetry
 * bug must never be able to take down a live run.
 */
function bump(counts: number[], idx: number): void {
  if (!Number.isInteger(idx) || idx < 0) return;
  while (counts.length <= idx) counts.push(0);
  counts[idx]++;
}

/**
 * A fruit, what it was worth, and which kind it was (IDEA-045, IDEA-050).
 *
 * `points` is required rather than defaulted: every fruit in the game has a
 * price now, and a default would quietly let a future call site forget to pass
 * one and under-report the score, which the server would then reject as a
 * mismatch. Better a compile error here than a rejected run in production.
 *
 * `kindIdx` is required for the same reason — it is the index in FRUITS, and
 * the server cross-checks that the kinds add up to exactly `points`.
 */
export function recordFruit(t: RunTelemetry, points: number, kindIdx: number): void {
  t.fruitEaten++;
  t.fruitPoints += points;
  bump(t.fruitKindCounts, kindIdx);
}

/** A power-up pickup (IDEA-046). The id is recorded once — collecting the same
 *  one twice refreshes it rather than stacking (see powerups.ts), so a second
 *  pickup of the same id buys no extra score headroom and must not look to the
 *  server as though it did. */
export function recordPowerup(t: RunTelemetry, id: string): void {
  t.powerupsCollected++;
  if (!t.powerupIds.includes(id)) t.powerupIds.push(id);
}

export function recordGhost(t: RunTelemetry): void {
  t.ghostsEaten++;
}

/** A coin PICKUP from the maze. Deliberately not the coins earned from score
 *  milestones — the server recomputes those itself from the accepted score. */
export function recordCoin(t: RunTelemetry): void {
  t.coinsCollected++;
}

/**
 * A death, and WHICH enemy caused it (IDEA-050).
 *
 * `ghostIdx` is the index in GHOST_DEFS — required, not optional, because
 * there is exactly one caller (`beagleDies`) and it always has the enemy in
 * hand at the fatal branch of `checkCollisions`. Making it optional would only
 * create a way for a future call site to silently break the
 * `sum(deathsByGhost) === livesLost` invariant the server checks.
 *
 * A shielded hit is NOT a death and must never reach here (IDEA-046) — that
 * distinction is the whole reason `onCaught` returns three outcomes.
 */
export function recordDeath(t: RunTelemetry, ghostIdx: number): void {
  t.livesLost++;
  bump(t.deathsByGhost, ghostIdx);
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
