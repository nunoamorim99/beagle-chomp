// OWNER: backend
//
// Score plausibility validation. PURE — no database, no clock, no randomness —
// which is what makes it the most heavily tested code in the backend
// (scripts/test-plausibility.ts).
//
// The brief: "Client-submitted scores are untrusted. The server validates
// plausibility before accepting... Reject implausible submissions rather than
// silently clamping them. Do NOT build full server-side simulation."
//
// WHAT THIS CATCHES: fabricated scores, zero-time runs, replayed sessions,
// forged client clocks, impossible item counts, and unlocking challenge levels
// by POST.
//
// WHAT IT DOES NOT CATCH, stated honestly: someone who plays slowly and reports
// a plausible-but-fake score. Only full server-side simulation would, and the
// brief rules that out as overkill for this project's scale. Every bound below
// is a HARD ceiling derived from what the game can physically produce — never a
// guess about how well a human plays — so a real player can never trip one.

import {
  SCORING,
  MAZE_FACTS,
  MAZE_COUNT,
  CHALLENGE_LEVELS,
  CLASSIC_MODIFIERS,
  COIN_THRESHOLDS,
  LIFE_THRESHOLDS,
  FRUIT_THRESHOLDS,
  type ChallengeLevelFacts,
} from "../catalog.generated.js";

export type RejectionReason =
  | "LEVEL_SCORE_CAP_EXCEEDED"
  | "RUN_TOO_FAST"
  | "SCORE_RATE_EXCEEDED"
  | "ITEM_COUNT_IMPOSSIBLE"
  | "SCORE_ITEM_MISMATCH"
  | "LIVES_IMPOSSIBLE"
  | "CHALLENGE_MAZE_MISMATCH"
  | "LEVEL_LOCKED"
  | "SESSION_TOO_OLD"
  | "MALFORMED_SUBMISSION";

/** What the client reports at the end of a run. Everything here is untrusted. */
export interface RunSubmission {
  score: number;
  levelsCleared: number;
  /** The resolved maze index of every level PLAYED, in order. Its length is the
   *  number of levels played (cleared + the one in progress when the run
   *  ended), which is what every per-level bound multiplies by. */
  mazeIdxSequence: number[];
  pelletsEaten: number;
  bonesEaten: number;
  fruitEaten: number;
  ghostsEaten: number;
  coinsCollected: number;
  livesLost: number;
  /** The client's own accumulated play time. ADVISORY ONLY — it may tighten a
   *  bound, never loosen one, because it is trivially forgeable. */
  playSeconds: number;
}

export interface RunContext {
  /** finished_at - started_at, both from the SERVER's clock. This is the number
   *  that cannot be forged, and the reason sessions are server-issued. */
  elapsedServerSeconds: number;
  mode: "classic" | "challenge";
  /** 0..7 for challenge, null for classic. */
  challengeIdx: number | null;
  /** The player's current challenge_progress, to reject clears for levels they
   *  haven't unlocked. */
  currentChallengeProgress: number;
}

export type ValidationResult =
  | { accepted: true; coinsAwarded: number; detail: Record<string, unknown> }
  | { accepted: false; reasonCode: RejectionReason; detail: Record<string, unknown> };

/** No run legitimately lasts this long. A larger elapsed time means a session id
 *  was created and stashed, then finished much later to make an absurd score
 *  look like it had time to happen. */
const MAX_RUN_HOURS = 4;

/** Slack on the time floor, for clock skew and frame-time jitter. The floor is
 *  already generous (see minLevelSeconds), so this only has to absorb noise. */
const TIME_FLOOR_SLACK = 0.85;

/** Ghost points double per ghost eaten within one fright window, capped at the
 *  4th (200 → 400 → 800 → 1600 → 1600 …). Mirrors game.ts's
 *  `SCORE.ghostBase * 2^min(chain-1, 3)` exactly. */
function ghostPointsForChainPosition(position: number): number {
  return SCORING.ghostBase * Math.pow(2, Math.min(position - 1, 3));
}

/** The most a player can score from ghosts in one level: every bone eaten, and
 *  every ghost caught within each of those fright windows. */
export function maxGhostPointsPerLevel(bones: number, ghostCount: number): number {
  let perFright = 0;
  for (let i = 1; i <= ghostCount; i++) perFright += ghostPointsForChainPosition(i);
  return bones * perFright;
}

/**
 * MAX-1 — the per-level absolute score ceiling.
 *
 * Every point in the game comes from eating something that exists on the board:
 * biscuits, bones and fruit are finite per maze, and ghost points are bounded by
 * (bones × ghostCount) with the chain multiplier capped. So this is not a
 * heuristic — it is the arithmetic maximum a level can yield.
 *
 * This is what solves the endless-classic problem: a classic run's TOTAL score
 * is unbounded, but its score PER LEVEL is not, and the number of levels is
 * bounded by elapsed time (MAX-2).
 */
export function maxLevelScore(mazeIdx: number, ghostCount: number): number {
  const facts = MAZE_FACTS[mazeIdx];
  if (!facts) return 0;

  return (
    facts.biscuits * SCORING.biscuit +
    facts.bones * SCORING.bone +
    // At most one fruit per FRUIT_THRESHOLDS entry, each firing once per level.
    Math.min(facts.fruitTiles, FRUIT_THRESHOLDS.length) * SCORING.fruit +
    maxGhostPointsPerLevel(facts.bones, ghostCount)
  );
}

/**
 * MAX-2 — the minimum time a level can take.
 *
 * Clearing a level means eating every pellet, which means visiting every pellet
 * tile: at least `pellets` tile-steps at the beagle's speed. Real mazes force
 * backtracking, so the true minimum is comfortably higher — this bound is
 * generous by roughly 1.5–2×, which is exactly what a validator wants.
 */
export function minLevelSeconds(mazeIdx: number, speedMult: number): number {
  const facts = MAZE_FACTS[mazeIdx];
  if (!facts) return 0;

  const pellets = facts.biscuits + facts.bones;
  const tilesPerSecond = SCORING.beagleSpeed * speedMult;

  return (
    pellets / tilesPerSecond +
    // The state machine's fixed costs: the "READY" pause entering a level, and
    // the level-clear beat leaving it.
    SCORING.readySeconds +
    SCORING.deathSeconds
  );
}

function modifiersFor(ctx: RunContext): ChallengeLevelFacts {
  if (ctx.mode === "challenge" && ctx.challengeIdx !== null) {
    return CHALLENGE_LEVELS[ctx.challengeIdx] ?? CLASSIC_MODIFIERS;
  }
  return CLASSIC_MODIFIERS;
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && Number.isInteger(value);
}

/**
 * Validate a completed run.
 *
 * Deliberately returns a REASON rather than clamping. A clamped score is a
 * silent lie in the leaderboard, and it also hides the fact that something is
 * wrong — either a cheat, or a bug in these bounds that needs fixing.
 */
export function validateRun(input: RunSubmission, ctx: RunContext): ValidationResult {
  const mods = modifiersFor(ctx);
  const detail: Record<string, unknown> = { input, ctx };

  // --- shape ---------------------------------------------------------------
  const counts: Array<[string, unknown]> = [
    ["score", input.score],
    ["levelsCleared", input.levelsCleared],
    ["pelletsEaten", input.pelletsEaten],
    ["bonesEaten", input.bonesEaten],
    ["fruitEaten", input.fruitEaten],
    ["ghostsEaten", input.ghostsEaten],
    ["coinsCollected", input.coinsCollected],
    ["livesLost", input.livesLost],
  ];
  for (const [field, value] of counts) {
    if (!isNonNegativeInt(value)) {
      return { accepted: false, reasonCode: "MALFORMED_SUBMISSION", detail: { ...detail, field } };
    }
  }

  if (
    !Array.isArray(input.mazeIdxSequence) ||
    input.mazeIdxSequence.length === 0 ||
    input.mazeIdxSequence.some((idx) => !Number.isInteger(idx) || idx < 0 || idx >= MAZE_COUNT)
  ) {
    return {
      accepted: false,
      reasonCode: "MALFORMED_SUBMISSION",
      detail: { ...detail, field: "mazeIdxSequence" },
    };
  }

  const levelsPlayed = input.mazeIdxSequence.length;
  if (input.levelsCleared > levelsPlayed) {
    return {
      accepted: false,
      reasonCode: "MALFORMED_SUBMISSION",
      detail: { ...detail, field: "levelsCleared exceeds levels played" },
    };
  }

  // --- SESSION_TOO_OLD ------------------------------------------------------
  if (ctx.elapsedServerSeconds > MAX_RUN_HOURS * 3600) {
    return {
      accepted: false,
      reasonCode: "SESSION_TOO_OLD",
      detail: { ...detail, elapsed: ctx.elapsedServerSeconds },
    };
  }

  // --- MAX-6/7: challenge-specific ------------------------------------------
  if (ctx.mode === "challenge") {
    const idx = ctx.challengeIdx;
    if (idx === null || !CHALLENGE_LEVELS[idx]) {
      return { accepted: false, reasonCode: "MALFORMED_SUBMISSION", detail: { ...detail, field: "challengeIdx" } };
    }

    // A challenge run is exactly ONE level: game.ts panels between levels and
    // "next level" starts a NEW run (and so a new session).
    if (levelsPlayed !== 1 || input.mazeIdxSequence[0] !== CHALLENGE_LEVELS[idx].mazeIdx) {
      return {
        accepted: false,
        reasonCode: "CHALLENGE_MAZE_MISMATCH",
        detail: { ...detail, expectedMaze: CHALLENGE_LEVELS[idx].mazeIdx },
      };
    }

    // Closes the "unlock everything by POSTing a clear" hole a naive port of
    // advanceChallengeProgress would leave wide open.
    if (idx > ctx.currentChallengeProgress) {
      return {
        accepted: false,
        reasonCode: "LEVEL_LOCKED",
        detail: { ...detail, progress: ctx.currentChallengeProgress },
      };
    }
  }

  // --- MAX-1: per-level score ceiling ---------------------------------------
  let scoreCeiling = 0;
  for (const mazeIdx of input.mazeIdxSequence) {
    scoreCeiling += maxLevelScore(mazeIdx, mods.ghostCount);
  }
  if (input.score > scoreCeiling) {
    return {
      accepted: false,
      reasonCode: "LEVEL_SCORE_CAP_EXCEEDED",
      detail: { ...detail, scoreCeiling },
    };
  }

  // --- MAX-4: item counts vs what the mazes actually contain ----------------
  let maxPellets = 0;
  let maxBones = 0;
  let maxFruit = 0;
  for (const mazeIdx of input.mazeIdxSequence) {
    const facts = MAZE_FACTS[mazeIdx];
    maxPellets += facts.biscuits;
    maxBones += facts.bones;
    maxFruit += Math.min(facts.fruitTiles, FRUIT_THRESHOLDS.length);
  }
  const maxCoins = COIN_THRESHOLDS.length * levelsPlayed;

  const itemChecks: Array<[string, number, number]> = [
    ["pelletsEaten", input.pelletsEaten, maxPellets],
    ["bonesEaten", input.bonesEaten, maxBones],
    ["fruitEaten", input.fruitEaten, maxFruit],
    ["coinsCollected", input.coinsCollected, maxCoins],
    // A ghost is only edible during a fright window, and each bone opens one.
    ["ghostsEaten", input.ghostsEaten, input.bonesEaten * mods.ghostCount],
  ];
  for (const [field, actual, max] of itemChecks) {
    if (actual > max) {
      return {
        accepted: false,
        reasonCode: "ITEM_COUNT_IMPOSSIBLE",
        detail: { ...detail, field, actual, max },
      };
    }
  }

  // --- MAX-4b: lives -------------------------------------------------------
  // You can't lose more lives than you could ever have held: the starting
  // stock, plus every way the game grants one.
  const maxLives =
    SCORING.startLives +
    Math.floor(input.score / SCORING.livesMilestonePoints) +
    LIFE_THRESHOLDS.length * levelsPlayed +
    input.bonesEaten; // a perfect fright (all ghosts in one bone) grants a life
  if (input.livesLost > maxLives) {
    return {
      accepted: false,
      reasonCode: "LIVES_IMPOSSIBLE",
      detail: { ...detail, livesLost: input.livesLost, maxLives },
    };
  }

  // --- MAX-5: the score must be REACHABLE from the reported items -----------
  const itemFloor =
    input.pelletsEaten * SCORING.biscuit +
    input.bonesEaten * SCORING.bone +
    input.fruitEaten * SCORING.fruit +
    input.ghostsEaten * SCORING.ghostBase;
  const itemCeiling =
    input.pelletsEaten * SCORING.biscuit +
    input.bonesEaten * SCORING.bone +
    input.fruitEaten * SCORING.fruit +
    input.ghostsEaten * ghostPointsForChainPosition(4); // the 1600 cap
  if (input.score < itemFloor || input.score > itemCeiling) {
    return {
      accepted: false,
      reasonCode: "SCORE_ITEM_MISMATCH",
      detail: { ...detail, itemFloor, itemCeiling },
    };
  }

  // --- MAX-2: the run cannot have been faster than physically possible ------
  let minSeconds = 0;
  for (const mazeIdx of input.mazeIdxSequence) {
    minSeconds += minLevelSeconds(mazeIdx, mods.speedMult);
  }
  // Each death costs a death beat plus the READY pause on respawn.
  minSeconds += input.livesLost * (SCORING.deathSeconds + SCORING.readySeconds);

  // The final level may have ended part-way through, so only require the time
  // for levels actually CLEARED, plus a proportional share of the last one.
  const clearedFraction = levelsPlayed === 0 ? 0 : input.levelsCleared / levelsPlayed;
  const requiredSeconds = minSeconds * clearedFraction * TIME_FLOOR_SLACK;

  if (ctx.elapsedServerSeconds < requiredSeconds) {
    return {
      accepted: false,
      reasonCode: "RUN_TOO_FAST",
      detail: { ...detail, requiredSeconds, elapsed: ctx.elapsedServerSeconds },
    };
  }

  // --- MAX-3: coarse rate tripwire ------------------------------------------
  // Deliberately absurd: every tile-step landing a maximum-value ghost. MAX-1
  // always binds first in practice; this exists so a malformed sequence can't
  // disable the ceiling entirely.
  const theoreticalMaxRate =
    SCORING.beagleSpeed * mods.speedMult * ghostPointsForChainPosition(4);
  if (input.score > theoreticalMaxRate * (ctx.elapsedServerSeconds + 5)) {
    return {
      accepted: false,
      reasonCode: "SCORE_RATE_EXCEEDED",
      detail: { ...detail, theoreticalMaxRate },
    };
  }

  // --- accepted: award coins from the ACCEPTED values ------------------------
  // Recomputed server-side, never taken from the client — this is what stops a
  // client minting currency. Mirrors game.ts's coinsDueFromScore + pickups.
  const coinsAwarded =
    Math.floor(input.score / SCORING.coinsPerPoints) +
    input.coinsCollected * SCORING.coinPickupValue;

  return { accepted: true, coinsAwarded, detail: { ...detail, scoreCeiling } };
}
