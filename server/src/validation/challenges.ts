// OWNER: backend (IDEA-078)
//
// The challenge evaluator. PURE — and pure ON PURPOSE, for exactly the reason
// wire.ts is: it has no database import, so a test can reach every rule in it
// without a Postgres container. That mattered enough to be worth stating twice
// in this codebase (see wire.ts's header, and what it cost when
// `levelIdxSequence` went un-read for a whole release because the only module
// that could see it opened a connection pool on import).
//
// ---------------------------------------------------------------------------
// WHY THE SERVER OWNS THIS AND THE CLIENT DOES NOT
// ---------------------------------------------------------------------------
//
// Two halves of one answer:
//
//   * The INPUTS are server-only. Every number a challenge reads comes from
//     `run_stats` — one row per finished run carrying the validated telemetry
//     (IDEA-050, migration 006). The client has never seen that table and
//     cannot be given it: the whole point of it is that the SERVER decides what
//     a run really did.
//
//   * The OUTPUT is money. The reward is coins, and coins are
//     server-authoritative (IDEA-016 v2): plausibility.ts recomputes every
//     award and the client reconciles its optimistic balance to the profile the
//     server returns. A challenge the client judged complete would be a coin
//     the client minted.
//
// So there is exactly ONE evaluator and it is this one. src/game/challenges.ts
// holds the definition TABLE (which is where the generated list below comes
// from) and the names and blurbs the screen draws — no second copy of the rule.
//
// ---------------------------------------------------------------------------
// DERIVED, NEVER ACCUMULATED
// ---------------------------------------------------------------------------
//
// There is no per-challenge progress counter anywhere, and there must not be.
// A lifetime total is a SUM over `run_stats` and a personal best is a MAX; a
// counter maintained at run finish would be a second copy of a truth that table
// already holds, free to drift from it. The ONLY state this feature adds is
// which rewards have been claimed (`challenge_claims`, migration 014).
//
// Two honest costs of deriving, both acceptable and both worth knowing:
//   (a) `run_stats` is written AFTER the finish transaction commits,
//       best-effort, because IDEA-050's invariant is that writing statistics
//       must never cost a player their score. A process that dies in that
//       window loses one row, so one run's items do not count toward a total.
//   (b) Rows backfilled by migration 006 carry score and time but ZEROED item
//       counts, so runs from before it contribute nothing to a lifetime total.
//       Players start their totals at 006 rather than at their first ever game.

import { CHALLENGES, type ChallengeFacts } from "../catalog.generated.js";

/**
 * Everything one MODE's accepted runs say about a player.
 *
 * `run*` are maxima over single runs; `total*` are lifetime sums. Produced by
 * one conditional-aggregate query grouped by mode — see repo/challenges.ts.
 */
export interface ModeStats {
  runCoins: number;
  runGhosts: number;
  runFruit: number;
  runBones: number;
  runScore: number;
  runLevels: number;
  /**
   * The most levels cleared in a run that lost NO lives.
   *
   * `lives_lost` is a whole-run total, so this is "got this far and never died
   * once" rather than "N of the maps happened to be clean". That is the
   * stronger reading and the one the blurbs promise.
   */
  runDeathlessLevels: number;
  totalCoins: number;
  totalGhosts: number;
  totalFruit: number;
  totalBones: number;
  totalScore: number;
  totalLevels: number;
}

export function emptyModeStats(): ModeStats {
  return {
    runCoins: 0,
    runGhosts: 0,
    runFruit: 0,
    runBones: 0,
    runScore: 0,
    runLevels: 0,
    runDeathlessLevels: 0,
    totalCoins: 0,
    totalGhosts: 0,
    totalFruit: 0,
    totalBones: 0,
    totalScore: 0,
    totalLevels: 0,
  };
}

/**
 * The whole bag: two mode-scoped halves plus the Journey per-level counts.
 *
 * There is deliberately NO `both` half. It is DERIVED here — `max` for a
 * personal best, `+` for a lifetime total — so the SQL stays one GROUP BY and
 * the arithmetic lives somewhere a test can reach it. Querying a third bag
 * would also be a third chance for the three to disagree.
 */
export interface ChallengeStats {
  classic: ModeStats;
  journey: ModeStats;
  /** users.challenge_progress. Read off the profile rather than counted from
   *  runs because that column is the canonical "how far up the ladder" and is
   *  written max-write by scoreService — a replay of an earlier level can
   *  never walk it backwards. */
  journeyUnlocked: number;
  journeyDeathless: number;
  journeyAllCoins: number;
  journeyAllFruit: number;
  journeyGhosts: number;
}

export function emptyChallengeStats(): ChallengeStats {
  return {
    classic: emptyModeStats(),
    journey: emptyModeStats(),
    journeyUnlocked: 0,
    journeyDeathless: 0,
    journeyAllCoins: 0,
    journeyAllFruit: 0,
    journeyGhosts: 0,
  };
}

function combined(a: ModeStats, b: ModeStats): ModeStats {
  return {
    runCoins: Math.max(a.runCoins, b.runCoins),
    runGhosts: Math.max(a.runGhosts, b.runGhosts),
    runFruit: Math.max(a.runFruit, b.runFruit),
    runBones: Math.max(a.runBones, b.runBones),
    runScore: Math.max(a.runScore, b.runScore),
    runLevels: Math.max(a.runLevels, b.runLevels),
    runDeathlessLevels: Math.max(a.runDeathlessLevels, b.runDeathlessLevels),
    totalCoins: a.totalCoins + b.totalCoins,
    totalGhosts: a.totalGhosts + b.totalGhosts,
    totalFruit: a.totalFruit + b.totalFruit,
    totalBones: a.totalBones + b.totalBones,
    totalScore: a.totalScore + b.totalScore,
    totalLevels: a.totalLevels + b.totalLevels,
  };
}

const MODE_KEYS = new Set<keyof ModeStats>([
  "runCoins",
  "runGhosts",
  "runFruit",
  "runBones",
  "runScore",
  "runLevels",
  "runDeathlessLevels",
  "totalCoins",
  "totalGhosts",
  "totalFruit",
  "totalBones",
  "totalScore",
  "totalLevels",
]);

/**
 * How far along one challenge is.
 *
 * The Journey metrics ignore `mode`: they are only reachable from Journey runs
 * by construction (a classic run has no `challenge_idx`), so scoping them again
 * would be a second chance to get one rule wrong.
 *
 * An UNKNOWN metric returns 0 rather than throwing. The metric string arrives
 * from the generated catalog, which is machine-written from a typed table, so a
 * bad one means the sync is broken — and the safe failure there is a challenge
 * nobody can complete, not an endpoint that 500s for every player on the list.
 * `test-challenges.ts` asserts no shipped challenge takes this branch.
 */
export function challengeValue(def: ChallengeFacts, stats: ChallengeStats): number {
  switch (def.metric) {
    case "journeyUnlocked":
      return stats.journeyUnlocked;
    case "journeyDeathless":
      return stats.journeyDeathless;
    case "journeyAllCoins":
      return stats.journeyAllCoins;
    case "journeyAllFruit":
      return stats.journeyAllFruit;
    case "journeyGhosts":
      return stats.journeyGhosts;
    default:
      break;
  }
  if (!MODE_KEYS.has(def.metric as keyof ModeStats)) return 0;
  const key = def.metric as keyof ModeStats;
  const bag =
    def.mode === "classic"
      ? stats.classic
      : def.mode === "journey"
        ? stats.journey
        : combined(stats.classic, stats.journey);
  return bag[key];
}

/** One row as the API returns it. `target` and `reward` are echoed back
 *  deliberately: the client draws the bar from the numbers the server actually
 *  judged against, so an unsynced client cannot show a player a target that is
 *  not the one being applied. */
export interface ChallengeRow {
  id: string;
  value: number;
  target: number;
  reward: number;
  done: boolean;
  claimed: boolean;
}

/**
 * Evaluate the whole ladder.
 *
 * `value` is CLAMPED to the target, so a bar cannot overfill and a label cannot
 * read "247 / 200". The raw figure is nobody's business: the only question a
 * challenge asks is whether the target was reached.
 *
 * Returns every challenge including the claimed ones — a list that dropped what
 * you had finished would get emptier the better you played.
 */
export function evaluateChallenges(
  stats: ChallengeStats,
  claimedIds: readonly string[],
): ChallengeRow[] {
  const claimedSet = new Set(claimedIds);
  return CHALLENGES.map((def) => {
    const raw = challengeValue(def, stats);
    return {
      id: def.id,
      value: Math.min(raw, def.target),
      target: def.target,
      reward: def.reward,
      done: raw >= def.target,
      claimed: claimedSet.has(def.id),
    };
  });
}

/**
 * Can this challenge be claimed right now?
 *
 * The claim endpoint's whole decision, kept here rather than inline in the
 * route so it is testable without HTTP — and so the answer cannot differ from
 * the `done`/`claimed` the list endpoint reported a moment earlier.
 */
export type ClaimVerdict =
  | { ok: true; def: ChallengeFacts }
  | { ok: false; reason: "UNKNOWN_CHALLENGE" | "NOT_COMPLETE" | "ALREADY_CLAIMED" };

export function canClaim(
  id: string,
  stats: ChallengeStats,
  claimedIds: readonly string[],
): ClaimVerdict {
  const def = CHALLENGES.find((c) => c.id === id);
  if (!def) return { ok: false, reason: "UNKNOWN_CHALLENGE" };
  if (claimedIds.includes(id)) return { ok: false, reason: "ALREADY_CLAIMED" };
  if (challengeValue(def, stats) < def.target) return { ok: false, reason: "NOT_COMPLETE" };
  return { ok: true, def };
}
