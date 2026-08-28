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
  planLevel,
  COIN_THRESHOLDS,
  LIFE_THRESHOLDS,
  FRUIT_THRESHOLDS,
  MAX_FRUIT_POINTS,
  MIN_FRUIT_POINTS,
  POWERUP_THRESHOLDS,
  POWERUP_IDS,
  POWERUP_MULTIPLIER,
  SCORE_DOUBLING_POWERUPS,
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
  | "LEVEL_PLAN_MISMATCH"
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
  /**
   * The 0-based CLASSIC LEVEL INDEX of every level played, in order — parallel
   * to mazeIdxSequence (IDEA-040).
   *
   * Needed because a level's score ceiling depends on its ghost count, which
   * varies by level: stage 3 has 4 ghosts, a bonus level has 1. Sizing a
   * 4-ghost level at 3 would reject an honest run.
   *
   * Untrusted like everything else here — it is CHECKED against planLevel(),
   * which independently derives the maze each level index must use. Claiming a
   * 4-ghost level index while playing a 3-ghost maze fails LEVEL_PLAN_MISMATCH.
   *
   * OPTIONAL for backward compatibility: a client from before IDEA-040 (or a
   * run queued on a device before the update) omits it, and the validator falls
   * back to the classic 3-ghost assumption. Those runs are all stage 1-2, where
   * 3 is the correct count anyway, so no queued run is lost by the deploy.
   */
  levelIdxSequence?: number[];
  pelletsEaten: number;
  bonesEaten: number;
  fruitEaten: number;
  /**
   * IDEA-045: the total points those fruits were worth.
   *
   * Fruit used to have one price, so the count WAS the value. It now ranges
   * from 100 (apple) to 500 (mango), and without this the score check would
   * have to allow the full spread on every run — a 5x window that a cheat
   * could hide a fabricated 1600 inside.
   *
   * Untrusted like everything else: it is bounded against
   * fruitEaten * MAX_FRUIT_POINTS above and fruitEaten * MIN_FRUIT_POINTS
   * below, so claiming four mangos requires having reported four fruits.
   *
   * OPTIONAL, for the same backward-compatibility reason as levelIdxSequence:
   * a run queued on a device before IDEA-045 shipped omits it, and the checks
   * below fall back to the wide bound rather than dropping the run. Those runs
   * pre-date the ladder and only ever ate 100-point fruit, so the wide bound
   * costs nothing in practice.
   */
  fruitPoints?: number;
  /**
   * IDEA-046: how many power-ups were collected, and which kinds.
   *
   * Two of the five DOUBLE SCORE, so the per-level ceiling has to know whether
   * one was held. Reporting them is what keeps that honest: without the list
   * the ceiling would have to assume a doubler on every run, which hands every
   * faked score twice the headroom — including on the runs that never saw one.
   *
   * Both OPTIONAL, for the usual backward-compatibility reason. An absent list
   * means no power-ups, which is exactly what a pre-IDEA-046 run was.
   */
  powerupsCollected?: number;
  powerupIds?: string[];
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
 *  look like it had time to happen.
 *
 *  EXPORTED because the session sweeper must never run AHEAD of this bound:
 *  any open session younger than this might be a run still being played, and
 *  sweeping it mid-game was exactly the bug that silently ate every score over
 *  ~10 minutes (v5.1 era). Deriving the sweeper's threshold from this constant
 *  makes that divergence structurally impossible. */
export const MAX_RUN_HOURS = 4;

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
export function maxLevelScore(
  mazeIdx: number,
  ghostCount: number,
  /** IDEA-046: multipliers the run's collected power-ups permit. Both default
   *  to 1, so every existing caller keeps the pre-power-up ceiling exactly. */
  mult: { biscuit?: number; ghost?: number } = {},
): number {
  const facts = MAZE_FACTS[mazeIdx];
  if (!facts) return 0;

  const biscuitMult = mult.biscuit ?? 1;
  const ghostMult = mult.ghost ?? 1;

  return (
    // The biscuit doubler pays on bones too — a bone is a pellet (see game.ts's
    // eatAt), so the ceiling has to allow it on both or an honest run that ate
    // every bone under a doubler is rejected.
    facts.biscuits * SCORING.biscuit * biscuitMult +
    facts.bones * SCORING.bone * biscuitMult +
    // At most one fruit per FRUIT_THRESHOLDS entry, each firing once per level,
    // and at most the DEAREST fruit every time (IDEA-045 — a mango is 5x an
    // apple, and the ceiling has to survive the luckiest possible run).
    //
    // Deliberately NOT bounded by facts.fruitTiles as well. Only one fruit is
    // ever on the board and spawnFruit REPLACES it, so the number of `F` tiles
    // in a maze was never a limit on how many fruits a level can yield — it
    // just happened to equal the threshold count back when both were 2. At four
    // thresholds and two tiles, the old `Math.min` would have capped an honest
    // level at two fruits and rejected anyone who ate four.
    FRUIT_THRESHOLDS.length * MAX_FRUIT_POINTS +
    maxGhostPointsPerLevel(facts.bones, ghostCount) * ghostMult
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

  // --- IDEA-040: resolve each level's ghost count ---------------------------
  //
  // Classic levels no longer all have 3 ghosts: stage 3 has 4, a bonus level
  // has 1 (2 from lap 2). The ceiling must be sized per level, or an honest
  // stage-3 run is rejected for scoring more than a 3-ghost level could.
  //
  // levelIdxSequence is untrusted, so it is not believed — it is CHECKED:
  // planLevel() independently says which maze each level index must use, and a
  // claim that disagrees is refused. That makes "claim a 4-ghost level, play a
  // 3-ghost maze" impossible rather than merely unlikely.
  const levelIdxSequence = input.levelIdxSequence;
  let ghostCounts: number[];

  if (ctx.mode === "classic" && Array.isArray(levelIdxSequence) && levelIdxSequence.length > 0) {
    if (levelIdxSequence.length !== input.mazeIdxSequence.length) {
      return {
        accepted: false,
        reasonCode: "LEVEL_PLAN_MISMATCH",
        detail: { ...detail, reason: "levelIdxSequence length differs from mazeIdxSequence" },
      };
    }

    ghostCounts = [];
    for (let i = 0; i < levelIdxSequence.length; i++) {
      const levelIdx = levelIdxSequence[i];
      if (!Number.isInteger(levelIdx) || levelIdx < 0) {
        return {
          accepted: false,
          reasonCode: "MALFORMED_SUBMISSION",
          detail: { ...detail, field: "levelIdxSequence", levelIdx },
        };
      }

      const plan = planLevel(levelIdx);
      if (plan.mazeIdx !== input.mazeIdxSequence[i]) {
        return {
          accepted: false,
          reasonCode: "LEVEL_PLAN_MISMATCH",
          detail: {
            ...detail,
            position: i,
            levelIdx,
            claimedMaze: input.mazeIdxSequence[i],
            expectedMaze: plan.mazeIdx,
          },
        };
      }
      ghostCounts.push(plan.ghostCount);
    }
  } else {
    // Pre-IDEA-040 client, or challenge mode: one fixed count for the run.
    ghostCounts = input.mazeIdxSequence.map(() => mods.ghostCount);
  }

  // --- IDEA-046: what the reported power-ups permit -------------------------
  //
  // Checked BEFORE it is used, because it feeds the ceiling: an unrecognised id
  // must not be able to buy headroom, and a count higher than the game can
  // produce must not either.
  const powerupIds = input.powerupIds ?? [];
  if (!Array.isArray(powerupIds) || powerupIds.some((id) => typeof id !== "string")) {
    return {
      accepted: false,
      reasonCode: "MALFORMED_SUBMISSION",
      detail: { ...detail, field: "powerupIds" },
    };
  }
  const unknownPowerup = powerupIds.find(
    (id) => !(POWERUP_IDS as readonly string[]).includes(id),
  );
  if (unknownPowerup !== undefined) {
    return {
      accepted: false,
      reasonCode: "ITEM_COUNT_IMPOSSIBLE",
      detail: { ...detail, field: "powerupIds", unknown: unknownPowerup },
    };
  }

  // Challenge mode has no power-ups at all — game.ts refuses to spawn them
  // there, because a challenge level is meant to be the same engine with
  // different dials and every challenge score already on the board was set
  // without them. So a challenge run reporting one is not a close call.
  if (ctx.mode === "challenge" && (powerupIds.length > 0 || (input.powerupsCollected ?? 0) > 0)) {
    return {
      accepted: false,
      reasonCode: "ITEM_COUNT_IMPOSSIBLE",
      detail: { ...detail, field: "powerups in challenge mode" },
    };
  }

  const powerupsCollected = input.powerupsCollected ?? 0;
  if (!isNonNegativeInt(powerupsCollected)) {
    return {
      accepted: false,
      reasonCode: "MALFORMED_SUBMISSION",
      detail: { ...detail, field: "powerupsCollected" },
    };
  }
  const maxPowerups = POWERUP_THRESHOLDS.length * levelsPlayed;
  if (powerupsCollected > maxPowerups) {
    return {
      accepted: false,
      reasonCode: "ITEM_COUNT_IMPOSSIBLE",
      detail: { ...detail, field: "powerupsCollected", actual: powerupsCollected, max: maxPowerups },
    };
  }
  // You cannot have picked up more KINDS than pickups.
  if (powerupIds.length > powerupsCollected) {
    return {
      accepted: false,
      reasonCode: "ITEM_COUNT_IMPOSSIBLE",
      detail: { ...detail, field: "powerupIds", actual: powerupIds.length, max: powerupsCollected },
    };
  }

  // Generous ON PURPOSE, and worth being explicit about: a doubler is applied
  // for EVERY level of the run once it appears anywhere in the list, because
  // the client does not report which level it was collected on and a doubler
  // genuinely does survive a cleared map (that is the feature). So this is the
  // true arithmetic maximum, which is what every bound in this file is.
  const powerupMult = {
    biscuit: powerupIds.includes(SCORE_DOUBLING_POWERUPS.biscuit) ? POWERUP_MULTIPLIER : 1,
    ghost: powerupIds.includes(SCORE_DOUBLING_POWERUPS.ghost) ? POWERUP_MULTIPLIER : 1,
  };

  // --- MAX-1: per-level score ceiling ---------------------------------------
  let scoreCeiling = 0;
  for (let i = 0; i < input.mazeIdxSequence.length; i++) {
    scoreCeiling += maxLevelScore(input.mazeIdxSequence[i], ghostCounts[i], powerupMult);
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
    // Per LEVEL, not per maze: see maxLevelScore for why the `F` tile count is
    // not the limit it looks like.
    maxFruit += FRUIT_THRESHOLDS.length;
  }
  const maxCoins = COIN_THRESHOLDS.length * levelsPlayed;

  const itemChecks: Array<[string, number, number]> = [
    ["pelletsEaten", input.pelletsEaten, maxPellets],
    ["bonesEaten", input.bonesEaten, maxBones],
    ["fruitEaten", input.fruitEaten, maxFruit],
    ["coinsCollected", input.coinsCollected, maxCoins],
    // A ghost is only edible during a fright window, and each bone opens one.
    // Bounded by the LARGEST ghost count across the levels played: a run that
    // reached stage 3 could have eaten 4 per fright there, and attributing
    // bones to levels would need per-level bone counts the client doesn't send.
    // Generous by design — MAX-1 is the bound that actually binds.
    ["ghostsEaten", input.ghostsEaten, input.bonesEaten * Math.max(...ghostCounts)],
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

  // --- MAX-4c: the claimed fruit VALUE (IDEA-045) --------------------------
  //
  // Only meaningful when the client sent it. When it did, it is pinned from
  // both sides: you cannot claim more value than the fruits you reported could
  // possibly be worth, and you cannot claim less than they must have been worth
  // (under-reporting would drag the score floor down and buy room for invented
  // points elsewhere).
  if (input.fruitPoints !== undefined) {
    if (!isNonNegativeInt(input.fruitPoints)) {
      return {
        accepted: false,
        reasonCode: "MALFORMED_SUBMISSION",
        detail: { ...detail, field: "fruitPoints" },
      };
    }
    const maxFruitPoints = input.fruitEaten * MAX_FRUIT_POINTS;
    const minFruitPoints = input.fruitEaten * MIN_FRUIT_POINTS;
    if (input.fruitPoints > maxFruitPoints || input.fruitPoints < minFruitPoints) {
      return {
        accepted: false,
        reasonCode: "ITEM_COUNT_IMPOSSIBLE",
        detail: {
          ...detail,
          field: "fruitPoints",
          actual: input.fruitPoints,
          max: maxFruitPoints,
          min: minFruitPoints,
        },
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
  //
  // IDEA-045: the fruit term is the exact reported total when the client sent
  // one (already pinned to the reported count by MAX-4c above), and otherwise
  // the widest the ladder allows — cheapest for the floor, dearest for the
  // ceiling. A pre-IDEA-045 client only ever ate 100-point fruit, so it lands
  // comfortably inside that window rather than being rejected for being old.
  const fruitFloor = input.fruitPoints ?? input.fruitEaten * MIN_FRUIT_POINTS;
  const fruitCeiling = input.fruitPoints ?? input.fruitEaten * MAX_FRUIT_POINTS;
  //
  // IDEA-046: the FLOOR stays un-multiplied and the CEILING is multiplied. That
  // asymmetry is deliberate. A doubler can be collected part-way through a run,
  // so a player holding one may still have eaten most of their biscuits at
  // face value — raising the floor would reject exactly that honest run. The
  // ceiling has to allow the best case; the floor has to allow the worst.
  const itemFloor =
    input.pelletsEaten * SCORING.biscuit +
    input.bonesEaten * SCORING.bone +
    fruitFloor +
    input.ghostsEaten * SCORING.ghostBase;
  const itemCeiling =
    input.pelletsEaten * SCORING.biscuit * powerupMult.biscuit +
    input.bonesEaten * SCORING.bone * powerupMult.biscuit +
    fruitCeiling +
    input.ghostsEaten * ghostPointsForChainPosition(4) * powerupMult.ghost; // the 1600 cap
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
