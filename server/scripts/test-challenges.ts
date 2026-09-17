// OWNER: backend (IDEA-078)
//
// The challenge evaluator, tested with NO DATABASE.
//
// That is the whole reason validation/challenges.ts is pure. This project has
// already paid once for a rule that lived in a module which opened a connection
// pool on import: `levelIdxSequence` went un-sent AND un-read for a full
// release because no DB-free test could reach the code that would have noticed
// (IDEA-040 v3). A challenge evaluator is the same shape of risk — it decides
// who gets paid — so it is reachable from here.
//
// Run: npm run test:challenges
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CHALLENGES, type ChallengeFacts } from "../src/catalog.generated.js";
import {
  canClaim,
  challengeValue,
  emptyChallengeStats,
  emptyModeStats,
  evaluateChallenges,
  type ChallengeStats,
} from "../src/validation/challenges.js";

const GAME_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "game");

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    console.log(`  FAIL ${label}${detail === undefined ? "" : ` — ${String(detail)}`}`);
  }
}
function section(t: string): void {
  console.log(`\n${t}`);
}

/** A stats bag with one field set, so a test says exactly what it depends on. */
function statsWith(patch: Partial<ChallengeStats>): ChallengeStats {
  return { ...emptyChallengeStats(), ...patch };
}

// ---------------------------------------------------------------------------
section("The shipped table is well formed");

ok("the catalog carries challenges at all", CHALLENGES.length > 0, CHALLENGES.length);

{
  const ids = new Set(CHALLENGES.map((c) => c.id));
  ok("every id is unique", ids.size === CHALLENGES.length, `${ids.size} of ${CHALLENGES.length}`);

  const badId = CHALLENGES.find((c) => !/^[a-z0-9-]+$/.test(c.id));
  ok("every id is kebab-case", !badId, badId?.id);

  // A zero target is met before the player does anything and a zero reward is a
  // button that pays nothing. Both ship as a perfectly valid catalog.
  const badNum = CHALLENGES.find((c) => c.target <= 0 || c.reward <= 0);
  ok("every target and reward is positive", !badNum, badNum?.id);

  const badMode = CHALLENGES.find((c) => !["classic", "journey", "both"].includes(c.mode));
  ok("every mode is a known one", !badMode, badMode?.id);
}

// EVERY metric must resolve. challengeValue returns 0 for an unknown metric
// rather than throwing (a broken sync must not 500 the list for every player),
// which means a typo would look exactly like "you have not started yet" — so
// the typo is caught here instead.
{
  // A bag where every field is distinctly non-zero. If a metric resolves to 0
  // against this, it resolved to nothing at all.
  const loud: ChallengeStats = {
    classic: { ...emptyModeStats() },
    journey: { ...emptyModeStats() },
    journeyUnlocked: 7,
    journeyDeathless: 7,
    journeyAllCoins: 7,
    journeyAllFruit: 7,
    journeyGhosts: 7,
  };
  for (const k of Object.keys(loud.classic) as Array<keyof typeof loud.classic>) {
    loud.classic[k] = 7;
    loud.journey[k] = 7;
  }
  const dead = CHALLENGES.filter((c) => challengeValue(c, loud) === 0);
  ok("every shipped metric resolves to a real field", dead.length === 0, dead.map((d) => `${d.id}:${d.metric}`).join(", "));
}

// "The harder the challenge better the reward" — Nuno's own rule, and the one
// quality property of a ladder that can be checked mechanically. Within one
// (mode, metric) family a bigger target must never pay less.
{
  const families = new Map<string, ChallengeFacts[]>();
  for (const c of CHALLENGES) {
    const key = `${c.mode}:${c.metric}`;
    const list = families.get(key) ?? [];
    list.push(c);
    families.set(key, list);
  }
  const broken: string[] = [];
  for (const [key, list] of families) {
    const sorted = [...list].sort((a, b) => a.target - b.target);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].reward < sorted[i - 1].reward) {
        broken.push(`${key}: ${sorted[i].id} pays less than ${sorted[i - 1].id}`);
      }
      if (sorted[i].target === sorted[i - 1].target) {
        broken.push(`${key}: ${sorted[i].id} and ${sorted[i - 1].id} share a target`);
      }
    }
  }
  ok("a harder tier never pays less than an easier one", broken.length === 0, broken.join(" · "));
}

// ---------------------------------------------------------------------------
section("Mode scoping: a classic goal does not count Journey runs");

{
  const classicOnly = statsWith({ classic: { ...emptyModeStats(), runCoins: 30 } });
  const journeyOnly = statsWith({ journey: { ...emptyModeStats(), runCoins: 30 } });

  const def: ChallengeFacts = { id: "x", mode: "classic", metric: "runCoins", target: 30, reward: 1 };
  ok("a classic goal reads the classic bag", challengeValue(def, classicOnly) === 30);
  ok("…and ignores the Journey bag entirely", challengeValue(def, journeyOnly) === 0);

  const jdef: ChallengeFacts = { id: "y", mode: "journey", metric: "runCoins", target: 30, reward: 1 };
  ok("a Journey goal reads the Journey bag", challengeValue(jdef, journeyOnly) === 30);
  ok("…and ignores the classic bag entirely", challengeValue(jdef, classicOnly) === 0);
}

// `both` is DERIVED rather than queried, and the two halves fold differently:
// a personal best is the better of the two, a lifetime total is the sum. Get
// that backwards and "collect 200 in total" becomes "collect 200 in one mode".
{
  const mixed = statsWith({
    classic: { ...emptyModeStats(), runCoins: 12, totalCoins: 120 },
    journey: { ...emptyModeStats(), runCoins: 20, totalCoins: 90 },
  });
  const best: ChallengeFacts = { id: "a", mode: "both", metric: "runCoins", target: 1, reward: 1 };
  const total: ChallengeFacts = { id: "b", mode: "both", metric: "totalCoins", target: 1, reward: 1 };
  ok("both takes the BETTER single run, not the sum", challengeValue(best, mixed) === 20, challengeValue(best, mixed));
  ok("both SUMS the lifetime totals", challengeValue(total, mixed) === 210, challengeValue(total, mixed));
}

// The Journey per-level metrics are reachable from Journey runs by
// construction, so they must not be scoped a second time — a bug there would
// silently zero four ladders.
{
  const s = statsWith({ journeyDeathless: 4, journeyAllCoins: 3, journeyAllFruit: 2, journeyGhosts: 1, journeyUnlocked: 9 });
  const mk = (metric: string): ChallengeFacts => ({ id: metric, mode: "journey", metric, target: 1, reward: 1 });
  ok("journeyUnlocked resolves", challengeValue(mk("journeyUnlocked"), s) === 9);
  ok("journeyDeathless resolves", challengeValue(mk("journeyDeathless"), s) === 4);
  ok("journeyAllCoins resolves", challengeValue(mk("journeyAllCoins"), s) === 3);
  ok("journeyAllFruit resolves", challengeValue(mk("journeyAllFruit"), s) === 2);
  ok("journeyGhosts resolves", challengeValue(mk("journeyGhosts"), s) === 1);
}

// ---------------------------------------------------------------------------
section("Evaluation: done, clamped, and claimed");

{
  const first = CHALLENGES.find((c) => c.mode === "classic" && c.metric === "runCoins");
  if (!first) throw new Error("expected a classic runCoins challenge to exist");

  const exact = statsWith({ classic: { ...emptyModeStats(), runCoins: first.target } });
  const rowExact = evaluateChallenges(exact, []).find((r) => r.id === first.id)!;
  ok("reaching the target exactly is DONE (>=, not >)", rowExact.done);

  const under = statsWith({ classic: { ...emptyModeStats(), runCoins: first.target - 1 } });
  const rowUnder = evaluateChallenges(under, []).find((r) => r.id === first.id)!;
  ok("one short is not done", !rowUnder.done);
  ok("…and its value is the real figure", rowUnder.value === first.target - 1, rowUnder.value);

  // A bar cannot overfill and a label cannot read "247 / 200".
  const over = statsWith({ classic: { ...emptyModeStats(), runCoins: first.target * 10 } });
  const rowOver = evaluateChallenges(over, []).find((r) => r.id === first.id)!;
  ok("value is clamped to the target", rowOver.value === first.target, rowOver.value);
  ok("…and it is still done", rowOver.done);

  ok("the target it was judged against is echoed back", rowOver.target === first.target);
  ok("…and so is the reward", rowOver.reward === first.reward);

  const claimedRow = evaluateChallenges(over, [first.id]).find((r) => r.id === first.id)!;
  ok("a claimed challenge says so", claimedRow.claimed);
  ok("…and is still in the list", evaluateChallenges(over, [first.id]).length === CHALLENGES.length);
}

ok(
  "a brand-new player gets every row, all at zero",
  evaluateChallenges(emptyChallengeStats(), []).every((r) => r.value === 0 && !r.done && !r.claimed),
);

// ---------------------------------------------------------------------------
section("Claiming: the client's opinion never reaches the decision");

{
  const target = CHALLENGES.find((c) => c.mode === "classic" && c.metric === "runCoins")!;
  const done = statsWith({ classic: { ...emptyModeStats(), runCoins: target.target } });

  const good = canClaim(target.id, done, []);
  ok("a finished, unclaimed challenge can be claimed", good.ok);
  ok("…and it hands back the SERVER's definition", good.ok && good.def.reward === target.reward);

  const unknown = canClaim("no-such-challenge", done, []);
  ok("an id nobody has heard of is refused", !unknown.ok && unknown.reason === "UNKNOWN_CHALLENGE");

  const twice = canClaim(target.id, done, [target.id]);
  ok("claiming twice is refused", !twice.ok && twice.reason === "ALREADY_CLAIMED");

  const notYet = canClaim(target.id, emptyChallengeStats(), []);
  ok("an unfinished challenge is refused", !notYet.ok && notYet.reason === "NOT_COMPLETE");

  // The order matters: a claimed challenge that is ALSO somehow unfinished
  // (a rebalance raised the target after somebody claimed it) must report
  // ALREADY_CLAIMED, not NOT_COMPLETE — the reward is spent either way, and
  // "not finished yet" would be a lie about a thing they already did.
  const rebalanced = canClaim(target.id, emptyChallengeStats(), [target.id]);
  ok("already-claimed beats not-complete", !rebalanced.ok && rebalanced.reason === "ALREADY_CLAIMED");
}

// ---------------------------------------------------------------------------
section("The per-level thresholds are the game's own numbers");

// repo/challenges.ts hand-copies three numbers that give three metrics their
// meaning — "all the coins", "all the fruit", "a good hunt". They are not part
// of any challenge DEFINITION, so the sync script does not carry them; this is
// what stops the copy drifting. FRUIT is the one that catches people: a map
// holds FIVE coins and FOUR fruit.
{
  const clientSrc = readFileSync(join(GAME_DIR, "challenges.ts"), "utf-8");
  const repoSrc = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "src", "repo", "challenges.ts"),
    "utf-8",
  );
  const pick = (src: string, name: string): number | null => {
    const m = new RegExp(`${name}\\s*=\\s*(\\d+)`).exec(src);
    return m ? Number(m[1]) : null;
  };
  const pairs: Array<[string, string]> = [
    ["COINS_PER_MAP", "JOURNEY_ALL_COINS"],
    ["FRUIT_PER_MAP", "JOURNEY_ALL_FRUIT"],
    ["JOURNEY_GHOST_TARGET", "JOURNEY_GHOSTS"],
  ];
  for (const [clientName, serverName] of pairs) {
    const a = pick(clientSrc, clientName);
    const b = pick(repoSrc, serverName);
    ok(`${clientName} (${a}) === ${serverName} (${b})`, a !== null && a === b);
  }

  // And those two are measured off config.ts itself, so a balance change that
  // added a fifth fruit would make "eat all 4" wrong without touching anything
  // here.
  const configSrc = readFileSync(join(GAME_DIR, "config.ts"), "utf-8");
  // ANCHORED ON `export const`, and that is not fussiness. The first version
  // was `${name}[^=]*=` and it matched the COMMENT forty lines above the
  // declaration, then ran forward to the next `=` it could find and counted a
  // DIFFERENT ARRAY — reporting five coin thresholds as four against a config
  // that was perfectly correct. Same lesson the sync script's maskComments
  // exists for: in this codebase a constant's name appears in prose far more
  // often than it appears in code.
  const countArray = (name: string): number => {
    const m = new RegExp(`export const ${name}[^=]*=\\s*\\[([^\\]]*)\\]`).exec(configSrc);
    return m ? m[1].split(",").filter((s) => s.trim().length > 0).length : -1;
  };
  ok("COINS_PER_MAP matches COIN_THRESHOLDS' length", pick(clientSrc, "COINS_PER_MAP") === countArray("COIN_THRESHOLDS"), countArray("COIN_THRESHOLDS"));
  ok("FRUIT_PER_MAP matches FRUIT_THRESHOLDS' length", pick(clientSrc, "FRUIT_PER_MAP") === countArray("FRUIT_THRESHOLDS"), countArray("FRUIT_THRESHOLDS"));
}

console.log(`\n${"-".repeat(60)}`);
console.log(`CHALLENGES: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
