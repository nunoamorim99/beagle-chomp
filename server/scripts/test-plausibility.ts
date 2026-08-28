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
import { readSubmission } from "../src/validation/wire.js";
import {
  planLevel,
  MAZE_FACTS,
  SCORING,
  CHALLENGE_LEVELS,
  FRUIT_THRESHOLDS,
  MAX_FRUIT_POINTS,
  MIN_FRUIT_POINTS,
  POWERUP_THRESHOLDS,
  POWERUP_MULTIPLIER,
} from "../src/catalog.generated.js";

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
    // IDEA-045: fruit has five prices now, so a self-consistent run has to say
    // what its fruit was worth. Cheapest-possible (all apples) by default,
    // which keeps the constructed score at the FLOOR of what the validator
    // allows — the same reason ghosts are valued at the chain minimum below.
    fruitPoints: 2 * MIN_FRUIT_POINTS,
    ghostsEaten: 6,
    coinsCollected: 2,
    livesLost: 1,
    playSeconds: 120,
  };
  const merged = { ...base, ...over };

  // Keep fruitPoints consistent with fruitEaten unless a test is deliberately
  // setting it — otherwise every `fruitEaten:` override would trip MAX-4c and
  // the test would be measuring the wrong rejection.
  if (over.fruitPoints === undefined) {
    merged.fruitPoints = merged.fruitEaten * MIN_FRUIT_POINTS;
  }

  if (over.score === undefined) {
    // Ghosts valued at the chain minimum keeps us inside [floor, ceiling].
    merged.score =
      merged.pelletsEaten * SCORING.biscuit +
      merged.bonesEaten * SCORING.bone +
      (merged.fruitPoints ?? merged.fruitEaten * MIN_FRUIT_POINTS) +
      merged.ghostsEaten * SCORING.ghostBase;
  }
  return merged;
}

/** The 1600 the ghost chain caps at — mirrors ghostPointsForChainPosition(4).
 *  Local to the tests because the validator keeps that function private. */
const ghostChainCap = SCORING.ghostBase * 8;

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
// IDEA-040: every NUMBERED map has 4 bones; the three BONUS maps have none.
// A bone opens a fright window, and on a bonus level that means eating the
// lone enemy for a free life on top of an already generous point haul — the
// golden bone already covers "earn a life here". With 0 bones the ceiling
// loses all ghost points there, which is exactly right.
ok(
  "the 15 numbered maps have exactly 4 bones",
  MAZE_FACTS.slice(0, 15).every((f) => f.bones === 4),
  MAZE_FACTS.slice(0, 15).map((f) => f.bones).join(","),
);
ok(
  "the 3 bonus maps have NO bones",
  MAZE_FACTS.slice(15).every((f) => f.bones === 0),
  MAZE_FACTS.slice(15).map((f) => f.bones).join(","),
);
// A bonus level therefore has no reachable ghost points at all.
ok(
  "a bonus level's ceiling contains no ghost points",
  maxLevelScore(15, 1) ===
    MAZE_FACTS[15].biscuits * SCORING.biscuit + FRUIT_THRESHOLDS.length * MAX_FRUIT_POINTS,
  maxLevelScore(15, 1),
);
// Still true, and still worth pinning — but note it is NOT what bounds fruit
// per level any more (IDEA-045). Only one fruit is on the board at a time and
// spawnFruit replaces it, so four thresholds yield four fruits from two tiles.
ok("every maze has exactly 2 fruit tiles", MAZE_FACTS.every((f) => f.fruitTiles === 2));
ok(
  "…and a level can still yield one fruit per threshold, tiles notwithstanding",
  maxLevelScore(0, 3) - maxLevelScore(0, 3) === 0 &&
    FRUIT_THRESHOLDS.length === 4 &&
    MAX_FRUIT_POINTS === 500 &&
    MIN_FRUIT_POINTS === 100,
  `${FRUIT_THRESHOLDS.length} thresholds, ${MIN_FRUIT_POINTS}..${MAX_FRUIT_POINTS}`,
);

// 3 ghosts: 200+400+800 = 1400 per fright, × 4 bones = 5600
ok("3-ghost level yields at most 5600 ghost points", maxGhostPointsPerLevel(4, 3) === 5600, maxGhostPointsPerLevel(4, 3));
// 4 ghosts: +1600 → 3000 per fright, × 4 = 12000
ok("4-ghost level yields at most 12000", maxGhostPointsPerLevel(4, 4) === 12000, maxGhostPointsPerLevel(4, 4));
// 5 ghosts: the chain multiplier CAPS at 1600, so the 5th is also 1600
ok("5-ghost level yields at most 18400 (chain caps at 1600)", maxGhostPointsPerLevel(4, 5) === 18400, maxGhostPointsPerLevel(4, 5));

// IDEA-045 moved all three of these by exactly +1800: the fruit term went from
// 2 thresholds * 100 (one flat-priced fruit) to 4 * 500 (four spawns, each
// potentially a mango). They stay written as literals on purpose — the whole
// value of this block is that a rebalance has to come and change the number by
// hand, so nobody widens the ceiling by accident.
// maze 2, classic: 200*10 + 4*50 + 2000 + 5600 = 9800. THE canonical number.
ok("maxLevelScore(maze 2, 3 ghosts) === 9800", maxLevelScore(2, 3) === 9800, maxLevelScore(2, 3));
// maze 0: 175*10 + 4*50 + 2000 + 5600 = 1750 + 200 + 2000 + 5600 = 9550
ok("maxLevelScore(maze 0, 3 ghosts) === 9550", maxLevelScore(0, 3) === 9550, maxLevelScore(0, 3));
// Same maze on a 5-ghost challenge level: 4200 + 18400
ok("maxLevelScore(maze 2, 5 ghosts) === 22600", maxLevelScore(2, 5) === 22600, maxLevelScore(2, 5));

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

// Derived from maxLevelScore rather than written out as 9800, because these two
// are testing the BOUNDARY, not the value — pinning the value is the block
// above's job, and hardcoding it in both places means a rebalance has to be
// remembered twice or this pair silently stops testing the edge at all. Which
// is exactly what happened: 8001 against the new 9800 ceiling was accepted.
const maze2Ceiling = maxLevelScore(2, 3);

expectAccept(
  "score exactly AT the ceiling is accepted",
  makeRun({
    mazeIdxSequence: [2], pelletsEaten: 200, bonesEaten: 4,
    fruitEaten: 4, fruitPoints: 4 * MAX_FRUIT_POINTS,
    ghostsEaten: 12, score: maze2Ceiling,
  }),
  classicCtx(),
);

expectReject(
  "score ONE point over the ceiling is rejected",
  "LEVEL_SCORE_CAP_EXCEEDED",
  makeRun({
    mazeIdxSequence: [2], pelletsEaten: 200, bonesEaten: 4,
    fruitEaten: 4, fruitPoints: 4 * MAX_FRUIT_POINTS,
    ghostsEaten: 12, score: maze2Ceiling + 1,
  }),
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

// IDEA-016 v2: maze PICKUPS ONLY.
//
// The award used to be floor(score / coinsPerPoints) + pickups, and between
// that and the client's own matching milestone the shop had stopped being a
// place where anything was a decision — a good run bought an item outright.
//
// The score term is gone from BOTH sides, and it had to be: THIS is the
// authority. scoreService adds whatever comes back from here, and the client
// reconciles its optimistic local balance to the returned profile, so deleting
// the client's half alone would have left the mechanic running from the server.
{
  const result = validateRun(
    makeRun({ mazeIdxSequence: [0], coinsCollected: 3, score: 5000 }),
    classicCtx(),
  );
  ok(
    "coins = pickups only",
    result.accepted && result.coinsAwarded === 3,
    result.accepted ? result.coinsAwarded : result.reasonCode,
  );
}

// The property that makes the change real rather than cosmetic: scoring well
// no longer earns currency at all.
{
  const tiny = validateRun(
    makeRun({
      mazeIdxSequence: [0], coinsCollected: 2,
      pelletsEaten: 20, bonesEaten: 0, fruitEaten: 0, fruitPoints: 0,
      ghostsEaten: 0, livesLost: 0,
    }),
    classicCtx({ elapsedServerSeconds: 600 }),
  );
  const huge = validateRun(
    makeRun({
      mazeIdxSequence: [0], coinsCollected: 2,
      pelletsEaten: 175, bonesEaten: 4,
      fruitEaten: 4, fruitPoints: 4 * MAX_FRUIT_POINTS,
      ghostsEaten: 12, livesLost: 0,
    }),
    classicCtx({ elapsedServerSeconds: 600 }),
  );
  ok(
    "a huge run and a tiny one earn the same coins for the same pickups",
    tiny.accepted && huge.accepted && tiny.coinsAwarded === 2 && huge.coinsAwarded === 2,
    `${tiny.accepted ? tiny.coinsAwarded : tiny.reasonCode} vs ${huge.accepted ? huge.coinsAwarded : huge.reasonCode}`,
  );
}

{
  const result = validateRun(
    makeRun({
      mazeIdxSequence: [0], coinsCollected: 0,
      pelletsEaten: 175, bonesEaten: 4,
      fruitEaten: 4, fruitPoints: 4 * MAX_FRUIT_POINTS,
      ghostsEaten: 12, livesLost: 0,
    }),
    classicCtx({ elapsedServerSeconds: 600 }),
  );
  ok(
    "a run that grabs no coins earns none, however well it scored",
    result.accepted && result.coinsAwarded === 0,
    result.accepted ? result.coinsAwarded : result.reasonCode,
  );
}

{
  const result = validateRun(
    makeRun({ mazeIdxSequence: [0], pelletsEaten: 10, bonesEaten: 0, fruitEaten: 0, fruitPoints: 0, ghostsEaten: 0, coinsCollected: 0, livesLost: 0 }),
    classicCtx({ elapsedServerSeconds: 60 }),
  );
  ok("a tiny run earns 0 coins", result.accepted && result.coinsAwarded === 0, result.accepted ? result.coinsAwarded : result.reasonCode);
}

section("IDEA-040 — per-level ghost counts");

// THE assertion this whole design exists for: a legitimate stage-3 run scores
// more than three ghosts could ever yield, and must still be ACCEPTED. Sizing
// every level at 3 ghosts would reject it — the failure that cost real players
// their scores in v5.0-v5.1, which is why the server derives the count itself.
{
  // Level 12 is map 11 (stage 3, 4 ghosts) on maze 10. Only 5 mazes exist
  // today, so use a stage-1 level and check the ARITHMETIC difference instead:
  // the same maze, scored at 3 ghosts vs 4, has two different ceilings.
  const at3 = maxLevelScore(0, 3);
  const at4 = maxLevelScore(0, 4);
  ok("a 4-ghost level has a higher ceiling than a 3-ghost one", at4 > at3, `${at3} vs ${at4}`);

  // A score between the two ceilings: impossible at 3 ghosts, fine at 4.
  const between = at3 + Math.floor((at4 - at3) / 2);

  const asStage1 = validateRun(
    makeRun({
      score: between,
      mazeIdxSequence: [0],
      levelIdxSequence: [0], // map 1 — 3 ghosts
      pelletsEaten: 175, bonesEaten: 4, fruitEaten: 2, ghostsEaten: 12,
      coinsCollected: 0, livesLost: 0,
    }),
    classicCtx({ elapsedServerSeconds: 600 }),
  );
  ok(
    "a 4-ghost score on a 3-ghost level is REJECTED",
    !asStage1.accepted && asStage1.reasonCode === "LEVEL_SCORE_CAP_EXCEEDED",
    asStage1.accepted ? "accepted" : asStage1.reasonCode,
  );
}

// A claimed level index must match the maze actually played.
{
  const result = validateRun(
    makeRun({
      mazeIdxSequence: [4],      // maze 4
      levelIdxSequence: [0],      // but level 0 is maze 0
      pelletsEaten: 100, bonesEaten: 2, fruitEaten: 1, ghostsEaten: 2,
    }),
    classicCtx({ elapsedServerSeconds: 600 }),
  );
  ok(
    "claiming a level index that doesn't match the maze is rejected",
    !result.accepted && result.reasonCode === "LEVEL_PLAN_MISMATCH",
    result.accepted ? "accepted" : result.reasonCode,
  );
}

{
  const result = validateRun(
    makeRun({
      mazeIdxSequence: [0, 1],
      levelIdxSequence: [0],  // wrong length
      pelletsEaten: 100, bonesEaten: 2, fruitEaten: 1, ghostsEaten: 2,
    }),
    classicCtx({ elapsedServerSeconds: 600 }),
  );
  ok(
    "a levelIdxSequence of the wrong length is rejected",
    !result.accepted && result.reasonCode === "LEVEL_PLAN_MISMATCH",
    result.accepted ? "accepted" : result.reasonCode,
  );
}

{
  const result = validateRun(
    makeRun({
      mazeIdxSequence: [0],
      levelIdxSequence: [-1],
      pelletsEaten: 100, bonesEaten: 2, fruitEaten: 1, ghostsEaten: 2,
    }),
    classicCtx({ elapsedServerSeconds: 600 }),
  );
  ok(
    "a negative level index is malformed",
    !result.accepted && result.reasonCode === "MALFORMED_SUBMISSION",
    result.accepted ? "accepted" : result.reasonCode,
  );
}

// BACKWARD COMPATIBILITY: a client from before IDEA-040 sends no
// levelIdxSequence at all. Those runs must still validate exactly as they did,
// or the deploy would reject every run already queued on a player's device.
{
  const legacy = validateRun(
    makeRun({
      mazeIdxSequence: [0, 1, 2],
      pelletsEaten: 500, bonesEaten: 8, fruitEaten: 4, ghostsEaten: 10,
      coinsCollected: 2, livesLost: 2,
    }),
    classicCtx({ elapsedServerSeconds: 900 }),
  );
  ok(
    "a submission with no levelIdxSequence still validates (old client)",
    legacy.accepted,
    legacy.accepted ? "" : legacy.reasonCode,
  );
}

// A correctly-claimed multi-level run across a stage boundary.
{
  const result = validateRun(
    makeRun({
      mazeIdxSequence: [0, 1, 2, 3, 4],
      levelIdxSequence: [0, 1, 2, 3, 4],
      pelletsEaten: 700, bonesEaten: 12, fruitEaten: 6, ghostsEaten: 20,
      coinsCollected: 4, livesLost: 2,
    }),
    classicCtx({ elapsedServerSeconds: 1500 }),
  );
  ok(
    "an honest 5-level stage-1 run with level indices is accepted",
    result.accepted,
    result.accepted ? "" : result.reasonCode,
  );
}

// ---------------------------------------------------------------------------
section("IDEA-045 — the fruit ladder");

// The whole point of reporting fruitPoints: a run that really did eat four
// mangos scores 2000 from fruit alone, and must be accepted.
{
  const allMangos = makeRun({
    mazeIdxSequence: [0],
    fruitEaten: 4,
    fruitPoints: 4 * MAX_FRUIT_POINTS,
  });
  const result = validateRun(allMangos, classicCtx());
  ok(
    "a level of four mangos is ACCEPTED",
    result.accepted,
    result.accepted ? "" : result.reasonCode,
  );
}

// …and the mirror image: claiming mango money for fruit you did not report.
expectReject(
  "claiming more fruit value than the reported fruit could be worth",
  "ITEM_COUNT_IMPOSSIBLE",
  makeRun({ mazeIdxSequence: [0], fruitEaten: 1, fruitPoints: MAX_FRUIT_POINTS + 1 }),
  classicCtx(),
);

// Under-reporting is rejected too. It looks harmless, but a low fruit total
// drags the score FLOOR down and buys room to invent points somewhere else.
expectReject(
  "claiming less fruit value than the cheapest fruit costs",
  "ITEM_COUNT_IMPOSSIBLE",
  makeRun({ mazeIdxSequence: [0], fruitEaten: 2, fruitPoints: MIN_FRUIT_POINTS }),
  classicCtx(),
);

expectReject(
  "a non-integer fruit value",
  "MALFORMED_SUBMISSION",
  makeRun({ mazeIdxSequence: [0], fruitEaten: 1, fruitPoints: 150.5 }),
  classicCtx(),
);

// BACKWARD COMPATIBILITY. This is the case that decides whether the deploy
// eats anyone's score: a run queued on a phone before IDEA-045 shipped has no
// fruitPoints at all, and every one of those ate 100-point fruit.
{
  const old = makeRun({ mazeIdxSequence: [0], fruitEaten: 2 });
  delete (old as { fruitPoints?: number }).fruitPoints;
  old.score =
    old.pelletsEaten * SCORING.biscuit +
    old.bonesEaten * SCORING.bone +
    2 * 100 +
    old.ghostsEaten * SCORING.ghostBase;
  const result = validateRun(old, classicCtx());
  ok(
    "a pre-IDEA-045 run with no fruitPoints is still ACCEPTED",
    result.accepted,
    result.accepted ? "" : result.reasonCode,
  );
}

// The old client's wide window must not become a hiding place either: without
// fruitPoints the ceiling allows 500 a fruit, and a point over that is caught.
{
  const old = makeRun({ mazeIdxSequence: [0], fruitEaten: 2 });
  delete (old as { fruitPoints?: number }).fruitPoints;
  old.score =
    old.pelletsEaten * SCORING.biscuit +
    old.bonesEaten * SCORING.bone +
    2 * MAX_FRUIT_POINTS +
    old.ghostsEaten * ghostChainCap +
    1;
  const result = validateRun(old, classicCtx());
  ok(
    "…but a score above even the all-mango reading is REJECTED",
    !result.accepted,
    result.accepted ? "accepted" : result.reasonCode,
  );
}

// The four thresholds are what bounds fruit per level now, not the 2 `F` tiles.
expectReject(
  "five fruits on a one-level run (only four thresholds fire)",
  "ITEM_COUNT_IMPOSSIBLE",
  makeRun({ mazeIdxSequence: [0], fruitEaten: 5, fruitPoints: 5 * MIN_FRUIT_POINTS }),
  classicCtx(),
);

// ===========================================================================
section("IDEA-040 v3 — the wire format");

// The regression this exists for: `levelIdxSequence` was collected by the
// client, typed in the payload, and understood by the validator — and was
// neither SENT by the client nor READ by the server. It went unnoticed for a
// whole release because the parser lived in a module that opens a Postgres pool
// on import, so no DB-free test could reach it.
//
// The guard is a round trip: build the exact body the client posts, parse it,
// and require every field to survive. A field added to RunSubmission and
// forgotten in the parser fails HERE.
{
  const body: Record<string, unknown> = {
    score: 12345,
    levelsCleared: 3,
    mazeIdxSequence: [0, 1, 2],
    levelIdxSequence: [10, 11, 12],
    pelletsEaten: 500,
    bonesEaten: 8,
    fruitEaten: 6,
    fruitPoints: 1400,
    ghostsEaten: 14,
    coinsCollected: 5,
    livesLost: 2,
    playSeconds: 640,
  };
  const parsed = readSubmission(body);

  // Every key the client sends must come out the other side with its value.
  const dropped = Object.keys(body).filter((key) => {
    const got = (parsed as unknown as Record<string, unknown>)[key];
    const want = body[key];
    return Array.isArray(want)
      ? JSON.stringify(got) !== JSON.stringify(want)
      : got !== want;
  });
  ok("every field the client sends survives the parse", dropped.length === 0, dropped.join(","));

  // And the sequence has to arrive intact, because it is what the validator
  // sizes each level's ghost count from. Dropped here, every classic run is
  // judged as though it had three enemies.
  ok(
    "…and the parsed levelIdxSequence reaches the validator",
    parsed.levelIdxSequence !== undefined && parsed.levelIdxSequence.length === 3,
    JSON.stringify(parsed.levelIdxSequence),
  );
}

// ABSENT and EMPTY are different things and must stay different: absent means
// "old client, assume 3 ghosts", empty is what a challenge run legitimately
// sends. Collapsing them would throw away the only signal that tells them apart.
{
  const withoutIt = readSubmission({ score: 0, mazeIdxSequence: [0] });
  ok("an absent levelIdxSequence stays undefined", withoutIt.levelIdxSequence === undefined);

  const withEmpty = readSubmission({ score: 0, mazeIdxSequence: [0], levelIdxSequence: [] });
  ok(
    "an empty one stays an empty array, not undefined",
    Array.isArray(withEmpty.levelIdxSequence) && withEmpty.levelIdxSequence.length === 0,
  );
}

// A junk body must shape into something the validator REJECTS, not something
// that throws on the way in — parsing judges nothing, it only shapes.
{
  const junk = readSubmission({ score: "lots", mazeIdxSequence: "everywhere" });
  ok("a non-numeric score becomes NaN rather than throwing", Number.isNaN(junk.score));
  ok("a non-array maze sequence becomes []", Array.isArray(junk.mazeIdxSequence) && junk.mazeIdxSequence.length === 0);
  const verdict = validateRun(junk, classicCtx());
  ok(
    "…and the validator refuses it",
    !verdict.accepted && verdict.reasonCode === "MALFORMED_SUBMISSION",
    verdict.accepted ? "accepted" : verdict.reasonCode,
  );
}

// The end-to-end shape of the bug: the SAME maze, sized with and without the
// level indices. planLevel says which stage a classic level index lands in, and
// stage 3 has four enemies — so the sequence buys a higher ceiling than the
// 3-ghost fallback, and that difference IS the honest score the fix recovers.
{
  const stage3 = planLevel(12);
  ok("classic level 12 really is a 4-enemy level", stage3.ghostCount === 4, stage3.ghostCount);
  const sized = maxLevelScore(stage3.mazeIdx, stage3.ghostCount);
  const fallback = maxLevelScore(stage3.mazeIdx, 3);
  ok(
    "sizing it at 4 enemies raises the ceiling above the 3-enemy fallback",
    sized > fallback,
    `${fallback} -> ${sized}`,
  );
  // A score in that gap is exactly what used to be thrown away: legitimate on
  // the level actually played, impossible under the fallback.
  const inTheGap = fallback + Math.floor((sized - fallback) / 2);
  const run = makeRun({
    score: inTheGap,
    mazeIdxSequence: [stage3.mazeIdx],
    levelIdxSequence: [12],
    pelletsEaten: 175, bonesEaten: 4,
    fruitEaten: 4, fruitPoints: 4 * MAX_FRUIT_POINTS,
    // 12, not 16: without the sequence the item bound is bones * 3 = 12, and
    // exceeding THAT would reject the stripped run for the wrong reason —
    // ITEM_COUNT_IMPOSSIBLE rather than the ceiling this test is about.
    ghostsEaten: 12, coinsCollected: 0, livesLost: 0,
  });
  const withSeq = validateRun(run, classicCtx({ elapsedServerSeconds: 600 }));
  ok(
    "a stage-3 score in that gap is ACCEPTED when the sequence is sent",
    withSeq.accepted,
    withSeq.accepted ? "" : withSeq.reasonCode,
  );

  const stripped = { ...run };
  delete (stripped as { levelIdxSequence?: number[] }).levelIdxSequence;
  const withoutSeq = validateRun(stripped, classicCtx({ elapsedServerSeconds: 600 }));
  ok(
    "…and REJECTED without it — the bug, reproduced",
    !withoutSeq.accepted && withoutSeq.reasonCode === "LEVEL_SCORE_CAP_EXCEEDED",
    withoutSeq.accepted ? "accepted" : withoutSeq.reasonCode,
  );
}


// ===========================================================================
section("IDEA-046 — power-ups");

// The ceiling has to RISE when a doubler is reported, or an honest run that
// held one is rejected for scoring more than a level "can" produce.
{
  const plain = maxLevelScore(0, 3);
  const doubled = maxLevelScore(0, 3, { biscuit: POWERUP_MULTIPLIER });
  ok("a biscuit doubler raises the level ceiling", doubled > plain, `${plain} -> ${doubled}`);

  // It must lift the BONES too. A bone is a pellet you have to clear, and
  // game.ts pays the doubler on both — a ceiling that only doubled the biscuits
  // would reject a run that ate every bone under one.
  const facts = MAZE_FACTS[0];
  const expected = plain + (facts.biscuits * SCORING.biscuit + facts.bones * SCORING.bone);
  ok("…and it lifts the bones as well as the biscuits", doubled === expected, `${doubled} vs ${expected}`);

  const ghostDoubled = maxLevelScore(0, 3, { ghost: POWERUP_MULTIPLIER });
  ok("an enemy doubler raises the ceiling by the ghost term", ghostDoubled > plain);
  ok(
    "the two doublers are independent",
    maxLevelScore(0, 3, { biscuit: POWERUP_MULTIPLIER, ghost: POWERUP_MULTIPLIER }) >
      Math.max(doubled, ghostDoubled),
  );
  // Defaults matter: every pre-IDEA-046 call site passes two arguments.
  ok("no multipliers means the old ceiling exactly", maxLevelScore(0, 3) === plain);
}

// The pair that makes reporting worth anything. Both halves use a score AT the
// doubled ceiling, not merely a doubled-looking score: MAX-1 is generous by
// design (it allows four mangos and a full 1600 chain on every ghost whatever
// actually happened), so a modest doubled run fits comfortably inside the
// UNDOUBLED bounds and proves nothing either way. The declaration only buys
// headroom at the edge, so the edge is where it has to be tested.
{
  const doubledCeiling = maxLevelScore(0, 3, { biscuit: POWERUP_MULTIPLIER });

  const maxedOut = (): RunSubmission =>
    makeRun({
      mazeIdxSequence: [0],
      score: doubledCeiling,
      pelletsEaten: MAZE_FACTS[0].biscuits,
      bonesEaten: MAZE_FACTS[0].bones,
      fruitEaten: FRUIT_THRESHOLDS.length,
      fruitPoints: FRUIT_THRESHOLDS.length * MAX_FRUIT_POINTS,
      // 4 bones x 3 enemies — the most the item bound allows.
      ghostsEaten: MAZE_FACTS[0].bones * 3,
      coinsCollected: 0,
      livesLost: 0,
    });

  const declared = maxedOut();
  declared.powerupsCollected = 1;
  declared.powerupIds = ["doubleBiscuit"];
  const withDoubler = validateRun(declared, classicCtx({ elapsedServerSeconds: 600 }));
  ok(
    "a run at the DOUBLED ceiling is accepted when it reports its doubler",
    withDoubler.accepted,
    withDoubler.accepted ? "" : withDoubler.reasonCode,
  );

  const undeclared = maxedOut();
  const withoutDoubler = validateRun(undeclared, classicCtx({ elapsedServerSeconds: 600 }));
  ok(
    "…and the very same score is REJECTED when it does not",
    !withoutDoubler.accepted && withoutDoubler.reasonCode === "LEVEL_SCORE_CAP_EXCEEDED",
    withoutDoubler.accepted ? "accepted" : withoutDoubler.reasonCode,
  );
}

// The floor is deliberately NOT multiplied: a doubler can be collected halfway
// through, so a player holding one may still have eaten most of their biscuits
// at face value. Raising the floor would reject exactly that honest run.
{
  const run = makeRun({
    mazeIdxSequence: [0],
    powerupsCollected: 1,
    powerupIds: ["doubleBiscuit"],
    pelletsEaten: 175,
    bonesEaten: 4,
    fruitEaten: 2,
    fruitPoints: 2 * MIN_FRUIT_POINTS,
    ghostsEaten: 6,
    livesLost: 0,
  });
  // Scored as though the doubler arrived on the very last pellet.
  run.score =
    175 * SCORING.biscuit +
    4 * SCORING.bone +
    2 * MIN_FRUIT_POINTS +
    6 * SCORING.ghostBase;
  const result = validateRun(run, classicCtx({ elapsedServerSeconds: 300 }));
  ok(
    "holding a doubler but scoring as if not is still accepted (collected late)",
    result.accepted,
    result.accepted ? "" : result.reasonCode,
  );
}

expectReject(
  "a power-up id that does not exist",
  "ITEM_COUNT_IMPOSSIBLE",
  makeRun({ mazeIdxSequence: [0], powerupsCollected: 1, powerupIds: ["invincibility"] }),
  classicCtx(),
);

expectReject(
  "more power-ups than the thresholds can spawn",
  "ITEM_COUNT_IMPOSSIBLE",
  makeRun({
    mazeIdxSequence: [0],
    powerupsCollected: POWERUP_THRESHOLDS.length + 1,
    powerupIds: ["doubleBiscuit"],
  }),
  classicCtx(),
);

expectReject(
  "more KINDS than pickups",
  "ITEM_COUNT_IMPOSSIBLE",
  makeRun({
    mazeIdxSequence: [0],
    powerupsCollected: 1,
    powerupIds: ["doubleBiscuit", "doubleGhost"],
  }),
  classicCtx(),
);

// Challenge mode has none at all, so this needs no judgement call.
expectReject(
  "a power-up reported on a challenge run",
  "ITEM_COUNT_IMPOSSIBLE",
  makeRun({
    mazeIdxSequence: [CHALLENGE_LEVELS[0].mazeIdx],
    levelsCleared: 1,
    powerupsCollected: 1,
    powerupIds: ["shield"],
  }),
  { elapsedServerSeconds: 300, mode: "challenge", challengeIdx: 0, currentChallengeProgress: 0 },
);

// Backward compatibility, same shape as IDEA-045's: a run from before this
// shipped reports neither field, and truthfully had no power-ups.
{
  const old = makeRun({ mazeIdxSequence: [0] });
  delete (old as { powerupsCollected?: number }).powerupsCollected;
  delete (old as { powerupIds?: string[] }).powerupIds;
  const result = validateRun(old, classicCtx());
  ok(
    "a pre-IDEA-046 run with no power-up fields is accepted",
    result.accepted,
    result.accepted ? "" : result.reasonCode,
  );
}

// The wire parser has to carry both, or the ceiling never rises and every
// doubled run is rejected — the IDEA-040 v3 failure, repeated.
{
  const parsed = readSubmission({
    score: 100,
    mazeIdxSequence: [0],
    powerupsCollected: 2,
    powerupIds: ["doubleBiscuit", "shield"],
  });
  ok("readSubmission carries powerupsCollected", parsed.powerupsCollected === 2);
  ok(
    "…and powerupIds",
    JSON.stringify(parsed.powerupIds) === JSON.stringify(["doubleBiscuit", "shield"]),
    JSON.stringify(parsed.powerupIds),
  );
  const absent = readSubmission({ score: 0, mazeIdxSequence: [0] });
  ok("…and leaves them undefined when absent", absent.powerupsCollected === undefined && absent.powerupIds === undefined);
}

console.log(`\n${"-".repeat(60)}`);
console.log(`PLAUSIBILITY: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
