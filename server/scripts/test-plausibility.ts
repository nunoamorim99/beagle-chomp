// OWNER: backend
//
// Tests for the score plausibility validator. Pure — no database, no clock, no
// network — so it runs anywhere and fast. `npm run test:plausibility`.
//
// This is the highest-value test file in the backend, for an asymmetric reason:
// a bound that is too LOOSE lets a cheated score onto the leaderboard, which is
// annoying. A bound that is too TIGHT rejects an honest player's best-ever run,
// which is infuriating and looks like the game is broken. The golden-accept
// cases below exist mostly to guard the second failure mode.
//
// The regression guards at the end are the ones that pay for themselves: they
// pin the derived ceilings to exact numbers, so a maze edit or a config.ts
// rebalance fails HERE rather than silently shifting what counts as plausible.

import {
  validateRun,
  maxLevelScore,
  maxGhostPointsPerLevel,
  minLevelSeconds,
  type RunSubmission,
  type RunContext,
  type RejectionReason,
} from "../src/validation/plausibility.js";
import { MAZE_FACTS, SCORING, CHALLENGE_LEVELS } from "../src/catalog.generated.js";

let passed = 0;
let failed = 0;

function ok(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    console.log(`  FAIL ${label}${detail === undefined ? "" : ` — ${String(detail)}`}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

/** A submission that is internally consistent by construction: the score is
 *  computed FROM the item counts, so tests can vary one thing at a time without
 *  accidentally tripping SCORE_ITEM_MISMATCH. */
function makeRun(over: Partial<RunSubmission> = {}): RunSubmission {
  const base: RunSubmission = {
    score: 0,
    levelsCleared: 1,
    mazeIdxSequence: [0],
    pelletsEaten: 175,
    bonesEaten: 4,
    fruitEaten: 2,
    ghostsEaten: 6,
    coinsCollected: 2,
    livesLost: 1,
    playSeconds: 120,
  };
  const merged = { ...base, ...over };

  if (over.score === undefined) {
    // Ghosts valued at the chain minimum keeps us inside [floor, ceiling].
    merged.score =
      merged.pelletsEaten * SCORING.biscuit +
      merged.bonesEaten * SCORING.bone +
      merged.fruitEaten * SCORING.fruit +
      merged.ghostsEaten * SCORING.ghostBase;
  }
  return merged;
}

function classicCtx(over: Partial<RunContext> = {}): RunContext {
  return {
    elapsedServerSeconds: 300,
    mode: "classic",
    challengeIdx: null,
    currentChallengeProgress: 0,
    ...over,
  };
}

function expectAccept(label: string, run: RunSubmission, ctx: RunContext): void {
  const result = validateRun(run, ctx);
  ok(
    label,
    result.accepted,
    result.accepted ? undefined : `rejected: ${result.reasonCode}`,
  );
}

function expectReject(
  label: string,
  reason: RejectionReason,
  run: RunSubmission,
  ctx: RunContext,
): void {
  const result = validateRun(run, ctx);
  if (result.accepted) {
    ok(label, false, "expected a rejection, got accepted");
  } else {
    ok(label, result.reasonCode === reason, `expected ${reason}, got ${result.reasonCode}`);
  }
}

// ===========================================================================
section("Derived ceilings — REGRESSION GUARDS");
// These pin the numbers the whole validator rests on. If a maze is edited or
// config.ts is rebalanced WITHOUT regenerating the catalog, these fail loudly
// instead of silently changing what counts as a plausible score.

ok("maze 0 has 175 biscuits", MAZE_FACTS[0].biscuits === 175, MAZE_FACTS[0].biscuits);
ok("maze 2 has 200 biscuits (the biggest)", MAZE_FACTS[2].biscuits === 200, MAZE_FACTS[2].biscuits);
ok("maze 3 has 198 biscuits", MAZE_FACTS[3].biscuits === 198, MAZE_FACTS[3].biscuits);
ok("maze 4 has 176 biscuits", MAZE_FACTS[4].biscuits === 176, MAZE_FACTS[4].biscuits);
ok("every maze has exactly 4 bones", MAZE_FACTS.every((f) => f.bones === 4));
ok("every maze has exactly 2 fruit tiles", MAZE_FACTS.every((f) => f.fruitTiles === 2));

// 3 ghosts: 200+400+800 = 1400 per fright, × 4 bones = 5600
ok("3-ghost level yields at most 5600 ghost points", maxGhostPointsPerLevel(4, 3) === 5600, maxGhostPointsPerLevel(4, 3));
// 4 ghosts: +1600 → 3000 per fright, × 4 = 12000
ok("4-ghost level yields at most 12000", maxGhostPointsPerLevel(4, 4) === 12000, maxGhostPointsPerLevel(4, 4));
// 5 ghosts: the chain multiplier CAPS at 1600, so the 5th is also 1600
ok("5-ghost level yields at most 18400 (chain caps at 1600)", maxGhostPointsPerLevel(4, 5) === 18400, maxGhostPointsPerLevel(4, 5));

// maze 2, classic: 200*10 + 4*50 + 2*100 + 5600 = 8000. THE canonical number.
ok("maxLevelScore(maze 2, 3 ghosts) === 8000", maxLevelScore(2, 3) === 8000, maxLevelScore(2, 3));
// maze 0: 175*10 + 4*50 + 2*100 + 5600 = 1750 + 200 + 200 + 5600 = 7750
ok("maxLevelScore(maze 0, 3 ghosts) === 7750", maxLevelScore(0, 3) === 7750, maxLevelScore(0, 3));
// Same maze on a 5-ghost challenge level: 2400 + 18400
ok("maxLevelScore(maze 2, 5 ghosts) === 20800", maxLevelScore(2, 5) === 20800, maxLevelScore(2, 5));

// 179 pellets / 5.2 tiles-per-sec + 1.6 + 1.3 ≈ 37.3s
const m0Min = minLevelSeconds(0, 1);
ok("minLevelSeconds(maze 0, 1x) is ~37s", m0Min > 36 && m0Min < 39, m0Min);
// Double speed roughly halves the traversal part
ok("2x speed lowers the floor", minLevelSeconds(0, 2) < m0Min);

// ===========================================================================
section("Golden accepts — real runs must NEVER be rejected");

expectAccept(
  "a modest single-level classic run",
  makeRun({ pelletsEaten: 100, bonesEaten: 2, fruitEaten: 1, ghostsEaten: 3, levelsCleared: 0 }),
  classicCtx({ elapsedServerSeconds: 180 }),
);

expectAccept(
  "a full 6-level classic run",
  makeRun({
    mazeIdxSequence: [0, 1, 2, 3, 4, 0],
    levelsCleared: 5,
    pelletsEaten: 900,
    bonesEaten: 20,
    fruitEaten: 10,
    ghostsEaten: 40,
    coinsCollected: 14,
    livesLost: 3,
  }),
  classicCtx({ elapsedServerSeconds: 900 }),
);

// The single most important accept: a PERFECT level, exactly at the ceiling.
// If this ever rejects, the best possible honest run is being thrown away.
expectAccept(
  "a PERFECT level at exactly the MAX-1 ceiling",
  makeRun({
    mazeIdxSequence: [2],
    levelsCleared: 1,
    pelletsEaten: 200,
    bonesEaten: 4,
    fruitEaten: 2,
    ghostsEaten: 12,
    score: maxLevelScore(2, 3),
    livesLost: 0,
  }),
  classicCtx({ elapsedServerSeconds: 300 }),
);

expectAccept(
  "a challenge L8 clear (5 ghosts, x2 speed)",
  makeRun({
    mazeIdxSequence: [CHALLENGE_LEVELS[7].mazeIdx],
    levelsCleared: 1,
    pelletsEaten: 176,
    bonesEaten: 4,
    fruitEaten: 2,
    ghostsEaten: 18,
    livesLost: 2,
  }),
  classicCtx({ mode: "challenge", challengeIdx: 7, currentChallengeProgress: 7, elapsedServerSeconds: 200 }),
);

expectAccept(
  "a death-heavy run that cleared nothing",
  makeRun({
    mazeIdxSequence: [0],
    levelsCleared: 0,
    pelletsEaten: 20,
    bonesEaten: 0,
    fruitEaten: 0,
    ghostsEaten: 0,
    coinsCollected: 0,
    livesLost: 3,
  }),
  classicCtx({ elapsedServerSeconds: 45 }),
);

// ===========================================================================
section("MAX-1 — per-level score ceiling");

expectAccept(
  "score exactly AT the ceiling is accepted",
  makeRun({ mazeIdxSequence: [2], pelletsEaten: 200, bonesEaten: 4, fruitEaten: 2, ghostsEaten: 12, score: 8000 }),
  classicCtx(),
);

expectReject(
  "score ONE point over the ceiling is rejected",
  "LEVEL_SCORE_CAP_EXCEEDED",
  makeRun({ mazeIdxSequence: [2], pelletsEaten: 200, bonesEaten: 4, fruitEaten: 2, ghostsEaten: 12, score: 8001 }),
  classicCtx(),
);

expectReject(
  "a fabricated huge score on one level",
  "LEVEL_SCORE_CAP_EXCEEDED",
  makeRun({ mazeIdxSequence: [0], score: 999_999 }),
  classicCtx({ elapsedServerSeconds: 3000 }),
);

// ===========================================================================
section("MAX-2 — the time floor");

expectReject(
  "6 levels cleared in 40 seconds",
  "RUN_TOO_FAST",
  makeRun({
    mazeIdxSequence: [0, 1, 2, 3, 4, 0],
    levelsCleared: 6,
    pelletsEaten: 900,
    bonesEaten: 20,
    fruitEaten: 10,
    ghostsEaten: 40,
    coinsCollected: 14,
    livesLost: 0,
  }),
  classicCtx({ elapsedServerSeconds: 40 }),
);

expectReject(
  "a level cleared in zero time",
  "RUN_TOO_FAST",
  makeRun({ mazeIdxSequence: [0], levelsCleared: 1, livesLost: 0 }),
  classicCtx({ elapsedServerSeconds: 0 }),
);

{
  // Boundary pair around the floor for a single cleared level.
  const run = makeRun({ mazeIdxSequence: [0], levelsCleared: 1, livesLost: 0 });
  const floor = minLevelSeconds(0, 1) * 0.85;
  expectAccept("elapsed just ABOVE the floor is accepted", run, classicCtx({ elapsedServerSeconds: floor + 1 }));
  expectReject("elapsed just BELOW the floor is rejected", "RUN_TOO_FAST", run, classicCtx({ elapsedServerSeconds: floor - 1 }));
}

// ===========================================================================
section("MAX-4 — item counts vs what the maze contains");

expectReject(
  "ate more pellets than the maze has",
  "ITEM_COUNT_IMPOSSIBLE",
  makeRun({ mazeIdxSequence: [0], pelletsEaten: 500 }),
  classicCtx(),
);

expectReject(
  "ate more bones than exist",
  "ITEM_COUNT_IMPOSSIBLE",
  makeRun({ mazeIdxSequence: [0], bonesEaten: 20 }),
  classicCtx(),
);

expectReject(
  "ate more fruit than can spawn",
  "ITEM_COUNT_IMPOSSIBLE",
  makeRun({ mazeIdxSequence: [0], fruitEaten: 9 }),
  classicCtx(),
);

expectReject(
  "ate more ghosts than the bones allow",
  "ITEM_COUNT_IMPOSSIBLE",
  makeRun({ mazeIdxSequence: [0], bonesEaten: 1, ghostsEaten: 20 }),
  classicCtx(),
);

expectReject(
  "collected more coins than can spawn per level",
  "ITEM_COUNT_IMPOSSIBLE",
  makeRun({ mazeIdxSequence: [0], coinsCollected: 40 }),
  classicCtx(),
);

expectReject(
  "lost more lives than could ever be held",
  "LIVES_IMPOSSIBLE",
  makeRun({ mazeIdxSequence: [0], livesLost: 50 }),
  classicCtx(),
);

// ===========================================================================
section("MAX-5 — score must be reachable from the reported items");

expectReject(
  "score far below what the items imply",
  "SCORE_ITEM_MISMATCH",
  makeRun({ mazeIdxSequence: [0], pelletsEaten: 150, score: 10 }),
  classicCtx(),
);

expectReject(
  "score above even the best ghost-chain valuation",
  "SCORE_ITEM_MISMATCH",
  makeRun({ mazeIdxSequence: [0], pelletsEaten: 10, bonesEaten: 0, fruitEaten: 0, ghostsEaten: 0, score: 5000 }),
  classicCtx(),
);

expectAccept(
  "ghosts valued at the 1600 chain cap is still reachable",
  makeRun({
    mazeIdxSequence: [0],
    pelletsEaten: 100,
    bonesEaten: 4,
    fruitEaten: 0,
    ghostsEaten: 4,
    score: 100 * 10 + 4 * 50 + 4 * 1600,
  }),
  classicCtx(),
);

// ===========================================================================
section("MAX-6/7 — challenge mode");

expectReject(
  "a challenge clear on the WRONG maze",
  "CHALLENGE_MAZE_MISMATCH",
  makeRun({ mazeIdxSequence: [1], levelsCleared: 1 }),
  classicCtx({ mode: "challenge", challengeIdx: 0, currentChallengeProgress: 7, elapsedServerSeconds: 200 }),
);

expectReject(
  "a challenge run spanning multiple levels",
  "CHALLENGE_MAZE_MISMATCH",
  makeRun({ mazeIdxSequence: [0, 1], levelsCleared: 2 }),
  classicCtx({ mode: "challenge", challengeIdx: 0, currentChallengeProgress: 7, elapsedServerSeconds: 400 }),
);

// The hole a naive port of advanceChallengeProgress would leave wide open.
expectReject(
  "clearing a level the player hasn't unlocked",
  "LEVEL_LOCKED",
  makeRun({ mazeIdxSequence: [CHALLENGE_LEVELS[7].mazeIdx], levelsCleared: 1, pelletsEaten: 176 }),
  classicCtx({ mode: "challenge", challengeIdx: 7, currentChallengeProgress: 0, elapsedServerSeconds: 300 }),
);

expectAccept(
  "clearing the NEXT unlocked level is fine",
  makeRun({ mazeIdxSequence: [CHALLENGE_LEVELS[3].mazeIdx], levelsCleared: 1, pelletsEaten: 198, livesLost: 1 }),
  classicCtx({ mode: "challenge", challengeIdx: 3, currentChallengeProgress: 3, elapsedServerSeconds: 300 }),
);

// ===========================================================================
section("Replay / stashed sessions");

expectReject(
  "a session finished 5 hours after it started",
  "SESSION_TOO_OLD",
  makeRun(),
  classicCtx({ elapsedServerSeconds: 5 * 3600 }),
);

// ===========================================================================
section("Malformed submissions");

for (const [label, over] of [
  ["negative score", { score: -100 }],
  ["fractional pellets", { pelletsEaten: 12.5 }],
  ["NaN score", { score: NaN }],
  ["Infinity score", { score: Infinity }],
  ["empty maze sequence", { mazeIdxSequence: [] }],
  ["out-of-range maze index", { mazeIdxSequence: [99] }],
  ["cleared more levels than played", { mazeIdxSequence: [0], levelsCleared: 5 }],
] as Array<[string, Partial<RunSubmission>]>) {
  expectReject(label, "MALFORMED_SUBMISSION", makeRun(over), classicCtx());
}

// ===========================================================================
section("Coin awards — recomputed server-side, never trusted");

{
  const result = validateRun(
    makeRun({
      mazeIdxSequence: [0],
      pelletsEaten: 175,
      bonesEaten: 4,
      fruitEaten: 2,
      ghostsEaten: 6,
      coinsCollected: 3,
    }),
    classicCtx(),
  );

  if (!result.accepted) {
    ok("coin award case is accepted", false, result.reasonCode);
  } else {
    // 175*10 + 4*50 + 2*100 + 6*200 = 1750+200+200+1200 = 3350
    // floor(3350/1000) = 3 milestone coins, + 3 collected = 6
    ok("coins = score milestones + pickups", result.coinsAwarded === 6, result.coinsAwarded);
  }
}

{
  const result = validateRun(
    makeRun({ mazeIdxSequence: [0], pelletsEaten: 10, bonesEaten: 0, fruitEaten: 0, ghostsEaten: 0, coinsCollected: 0, livesLost: 0 }),
    classicCtx({ elapsedServerSeconds: 60 }),
  );
  ok("a tiny run earns 0 coins", result.accepted && result.coinsAwarded === 0, result.accepted ? result.coinsAwarded : result.reasonCode);
}

console.log(`\n${"-".repeat(60)}`);
console.log(`PLAUSIBILITY: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
