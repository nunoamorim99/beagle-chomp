// IDEA-078: the challenge LADDER and the screen's view layer.
//
// Headless — it imports the real modules and runs in `npm run test`.
//
// server/scripts/test-challenges.ts tests the same shape from the other side,
// and the overlap is deliberate rather than accidental: that one reads the
// GENERATED catalog, so it can only see what a `npm run sync` has already
// carried across. This one reads the SOURCE table, so a bad entry fails the
// build the moment it is written rather than one sync later. They also diverge
// where it matters — the economy band and `viewChallenges` exist only here, and
// the per-map ceilings are checked against config.ts by IMPORT here where the
// server has to parse the file as text.
//
// THREE THINGS IT EXISTS FOR:
//
//  1. THE ECONOMY. A challenge reward is real money in a game whose entire
//     shop costs about 550 coins at one coin a pickup. Nothing crashes if the
//     ladder quietly starts paying four times that — the shop just stops being
//     something anyone has to play for. The band below is bounded at BOTH ends
//     for this project's own reason: a "not too generous" check passes happily
//     on a ladder that pays nothing at all.
//
//  2. THE "ALL OF THEM" TARGETS. Four challenges promise every coin or every
//     fruit on a board. Those counts are COIN_THRESHOLDS.length and
//     FRUIT_THRESHOLDS.length — five and FOUR, which is the pair everybody
//     guesses wrong — so a balance change to either table must move the
//     challenge with it or the goal becomes literally uncompletable and the
//     only symptom is a player who never finishes it.
//
//  3. THE VIEW LAYER. `viewChallenges` joins the server's rows to the local
//     definitions, and both halves can legitimately be ahead of the other
//     during a deploy. Getting that wrong is a card with no name, or a bar
//     drawn against a target the server is not applying.
import {
  CHALLENGES,
  CHALLENGE_CATEGORIES,
  CATEGORY_LABELS,
  COINS_PER_MAP,
  FRUIT_PER_MAP,
  JOURNEY_GHOST_TARGET,
  MODE_LABELS,
  claimableCoins,
  claimableCount,
  getChallenge,
  viewChallenges,
  type ChallengeRow,
} from "../src/game/challenges";
import { COIN_THRESHOLDS, FRUIT_THRESHOLDS } from "../src/game/config";
import { BEAGLE_SKINS, ENEMY_SKINS } from "../src/game/cosmetics";
import { MAZE_THEMES } from "../src/game/themes";

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

// ---------------------------------------------------------------------------
section("The table is well formed");

{
  const ids = CHALLENGES.map((c) => c.id);
  ok("every id is unique", new Set(ids).size === ids.length, `${new Set(ids).size} of ${ids.length}`);

  const badId = CHALLENGES.find((c) => !/^[a-z0-9-]+$/.test(c.id));
  ok("every id is kebab-case", !badId, badId?.id);

  const badNum = CHALLENGES.find((c) => c.target <= 0 || c.reward <= 0);
  ok("every target and reward is positive", !badNum, badNum?.id);

  const noName = CHALLENGES.find((c) => !c.name.trim() || !c.blurb.trim());
  ok("every one has a name and a blurb", !noName, noName?.id);

  const badCat = CHALLENGES.find((c) => !CHALLENGE_CATEGORIES.includes(c.category));
  ok("every category is one the screen has a tab for", !badCat, badCat?.id);

  // Every tab must have something in it. A category with no challenges is an
  // empty tab, which is worse than not having the tab.
  for (const c of CHALLENGE_CATEGORIES) {
    const n = CHALLENGES.filter((x) => x.category === c).length;
    ok(`the "${CATEGORY_LABELS[c]}" tab has cards`, n > 0, n);
  }

  ok("getChallenge finds a real one", getChallenge(CHALLENGES[0].id)?.id === CHALLENGES[0].id);
  ok("…and returns undefined for one that does not exist", getChallenge("nope") === undefined);
}

// Both modes carry challenges — Nuno's own requirement, and the thing that
// makes the mode tag on every card worth drawing.
{
  const classic = CHALLENGES.filter((c) => c.mode === "classic").length;
  const journey = CHALLENGES.filter((c) => c.mode === "journey").length;
  ok("classic has its own set", classic > 0, classic);
  ok("the Journey has its own set", journey > 0, journey);
  ok("every mode has a label for the card", CHALLENGES.every((c) => Boolean(MODE_LABELS[c.mode])));
}

// "The harder the challenge better the reward" — Nuno's rule, and the one
// quality property of a ladder a machine can check.
{
  const families = new Map<string, typeof CHALLENGES[number][]>();
  for (const c of CHALLENGES) {
    const key = `${c.mode}:${c.metric}`;
    families.set(key, [...(families.get(key) ?? []), c]);
  }
  const broken: string[] = [];
  for (const [key, list] of families) {
    const sorted = [...list].sort((a, b) => a.target - b.target);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].reward < sorted[i - 1].reward) broken.push(`${key}: ${sorted[i].id} pays less`);
      if (sorted[i].target === sorted[i - 1].target) broken.push(`${key}: ${sorted[i].id} duplicate target`);
    }
  }
  ok("a harder tier never pays less than an easier one", broken.length === 0, broken.join(" · "));
  ok("there is more than one ladder", families.size > 4, families.size);
}

// ---------------------------------------------------------------------------
section("The economy: rewards against what the shop costs");

{
  const shopCost =
    BEAGLE_SKINS.reduce((n, s) => n + s.price, 0) +
    ENEMY_SKINS.reduce((n, s) => n + s.price, 0) +
    MAZE_THEMES.reduce((n, t) => n + t.price, 0);
  const payout = CHALLENGES.reduce((n, c) => n + c.reward, 0);

  ok("the shop costs something", shopCost > 0, shopCost);

  // BOUNDED AT BOTH ENDS. The upper bound is the real risk — a ladder paying
  // several times the shop makes the five coins a map pointless, and the
  // pickups are the entire economy (IDEA-016 v2 deleted the points conversion
  // precisely so they would be worth detouring for). The lower bound matters
  // too: a ladder that pays a rounding error is a screen nobody opens twice,
  // and it is exactly what a well-meaning "let's not unbalance it" retune
  // produces.
  ok(
    `the whole ladder pays ${payout}, between half and twice the shop's ${shopCost}`,
    payout >= shopCost * 0.5 && payout <= shopCost * 2,
    `${payout} vs ${shopCost}`,
  );

  // The first rung of every ladder is the one a new player meets, and together
  // they should come to something worth having without buying anything outright.
  const firstTiers = new Map<string, typeof CHALLENGES[number]>();
  for (const c of CHALLENGES) {
    const key = `${c.mode}:${c.metric}`;
    const held = firstTiers.get(key);
    if (!held || c.target < held.target) firstTiers.set(key, c);
  }
  const starter = [...firstTiers.values()].reduce((n, c) => n + c.reward, 0);
  const cheapest = Math.min(
    ...[...BEAGLE_SKINS, ...ENEMY_SKINS, ...MAZE_THEMES].map((i) => i.price).filter((p) => p > 0),
  );
  ok(
    `the easiest rung of every ladder totals ${starter}, at least one shop item (${cheapest})`,
    starter >= cheapest,
    `${starter} vs ${cheapest}`,
  );
  // …and not so much that a player who has done nothing hard can buy the lot.
  ok("…but not the whole shop", starter < shopCost * 0.5, `${starter} vs ${shopCost}`);
}

// ---------------------------------------------------------------------------
section("The 'all of them' targets are the board's own counts");

ok(
  `COINS_PER_MAP (${COINS_PER_MAP}) === COIN_THRESHOLDS.length (${COIN_THRESHOLDS.length})`,
  COINS_PER_MAP === COIN_THRESHOLDS.length,
);
// FOUR, not five. This is the one everybody gets wrong, and Nuno's own list
// asked for "all 5 fruits in each level", which cannot be done.
ok(
  `FRUIT_PER_MAP (${FRUIT_PER_MAP}) === FRUIT_THRESHOLDS.length (${FRUIT_THRESHOLDS.length})`,
  FRUIT_PER_MAP === FRUIT_THRESHOLDS.length,
);
// Widened to number: with both sides literal types TypeScript decides the
// comparison "has no overlap" and refuses to compile the assertion that is
// meant to survive somebody making them equal. Second time in this branch —
// test-journey-naming.ts hit it on two ICON roles.
const coinsPerMap: number = COINS_PER_MAP;
const fruitPerMap: number = FRUIT_PER_MAP;
ok("…and they are genuinely different numbers", coinsPerMap !== fruitPerMap);
ok(
  "the Journey hunt target is reachable on a 3-enemy level with 4 bones",
  JOURNEY_GHOST_TARGET > 0 && JOURNEY_GHOST_TARGET <= 3 * 4,
  JOURNEY_GHOST_TARGET,
);

// The blurbs QUOTE those counts, so a balance change has to move the prose too.
// Checking the text is blunt and it is the precise shape of the defect: a
// correct constant under a card that says "all 5 fruits" is still a lie.
{
  const allFruit = CHALLENGES.filter((c) => c.metric === "journeyAllFruit");
  ok("there are all-fruit challenges to check", allFruit.length > 0, allFruit.length);
  const wrong = allFruit.filter((c) => !c.blurb.includes(`all ${FRUIT_PER_MAP} fruit`));
  ok(`every all-fruit blurb says "all ${FRUIT_PER_MAP} fruits"`, wrong.length === 0, wrong.map((c) => c.id).join(", "));

  const allCoins = CHALLENGES.filter((c) => c.metric === "journeyAllCoins");
  const wrongC = allCoins.filter((c) => !c.blurb.includes(`all ${COINS_PER_MAP} coins`));
  ok(`every all-coins blurb says "all ${COINS_PER_MAP} coins"`, wrongC.length === 0, wrongC.map((c) => c.id).join(", "));
}

// ---------------------------------------------------------------------------
section("viewChallenges: joining the server's rows to the local table");

const rowFor = (id: string, over: Partial<ChallengeRow> = {}): ChallengeRow => {
  const def = getChallenge(id)!;
  return { id, value: 0, target: def.target, reward: def.reward, done: false, claimed: false, ...over };
};

{
  const first = CHALLENGES[0];

  // Nothing from the server at all: every row is shown at zero rather than the
  // list coming back empty. A player who has never played still needs to see
  // what there is to aim at.
  const none = viewChallenges([]);
  ok("no rows still lists the whole ladder", none.length === CHALLENGES.length, none.length);
  ok("…all at zero", none.every((r) => r.value === 0 && !r.done && !r.claimed && !r.claimable));

  // THE SERVER'S TARGET WINS. This is the one drift that could cost a player a
  // reward: drawing a bar to a local target while the server applies another.
  const drifted = viewChallenges([rowFor(first.id, { value: 3, target: 999, reward: 42 })]);
  const dr = drifted.find((r) => r.id === first.id)!;
  ok("the server's target is used, not the local one", dr.target === 999, dr.target);
  ok("…and the server's reward", dr.reward === 42, dr.reward);
  ok("…while the NAME still comes from the local table", dr.def.name === first.name);

  // Clamping, so a bar cannot overfill and a label cannot read "247 / 200".
  const over = viewChallenges([rowFor(first.id, { value: 9_999, done: true })]);
  const ov = over.find((r) => r.id === first.id)!;
  ok("value is clamped to the target", ov.value === first.target, ov.value);
  ok("…and it is claimable", ov.claimable);

  // Claimed is not claimable, and stays in the list.
  const claimed = viewChallenges([rowFor(first.id, { value: first.target, done: true, claimed: true })]);
  const cl = claimed.find((r) => r.id === first.id)!;
  ok("a claimed one is not claimable", cl.claimed && !cl.claimable);
  ok("…and is still listed", claimed.length === CHALLENGES.length);

  // A row for something this client has never heard of is DROPPED — the server
  // is ahead, and a card with no name is worse than no card.
  const alien = viewChallenges([
    { id: "from-the-future", value: 5, target: 5, reward: 5, done: true, claimed: false },
  ]);
  ok("an unknown id is dropped, not rendered nameless", alien.length === CHALLENGES.length);
  ok("…and it does not count as claimable", claimableCount(alien) === 0, claimableCount(alien));
}

// ---------------------------------------------------------------------------
section("What the badge and the lead line count");

{
  const a = CHALLENGES[0];
  const b = CHALLENGES.find((c) => c.id !== a.id)!;
  const rows = viewChallenges([
    rowFor(a.id, { value: a.target, done: true }),
    rowFor(b.id, { value: b.target, done: true }),
  ]);
  ok("two finished, unclaimed challenges count as two", claimableCount(rows) === 2, claimableCount(rows));
  ok(
    "…and the coins waiting are their rewards summed",
    claimableCoins(rows) === a.reward + b.reward,
    `${claimableCoins(rows)} vs ${a.reward + b.reward}`,
  );

  const half = viewChallenges([
    rowFor(a.id, { value: a.target, done: true, claimed: true }),
    rowFor(b.id, { value: b.target, done: true }),
  ]);
  ok("a claimed one stops counting", claimableCount(half) === 1, claimableCount(half));
  ok("…and stops adding coins", claimableCoins(half) === b.reward, claimableCoins(half));

  ok("nothing done means no badge", claimableCount(viewChallenges([])) === 0);
  ok("…and no coins waiting", claimableCoins(viewChallenges([])) === 0);
}

console.log(`\n${"-".repeat(60)}`);
console.log(`CHALLENGE LADDER: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
