// OWNER: qa-test-engineer (IDEA-045)
//
// Headless tests for the fruit ladder. Imports the REAL modules — config.ts's
// FRUITS/FRUIT_THRESHOLDS and fruits.ts's rollFruit — so a rebalance is checked
// against the actual shipping numbers rather than a copy of them.
//
// Runs in Node with no browser: fruits.ts is three-free and DOM-free on purpose
// (CLAUDE.md's layer rule), which is what makes the distribution assertable at
// all. `npm run test:fruits`.

import {
  FRUITS,
  FRUIT_THRESHOLDS,
  FRUIT_LIFESPAN_SECONDS,
  COINS,
  COIN_THRESHOLDS,
  LIFE_THRESHOLDS,
  SCORE,
} from "../src/game/config";
import { rollFruit, fruitById, MAX_FRUIT_POINTS, MIN_FRUIT_POINTS } from "../src/game/fruits";
import { shouldFireThreshold } from "../src/game/pickups";

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

// ===========================================================================
section("The table");

ok("five fruits ship", FRUITS.length === 5, FRUITS.length);
ok(
  "every fruit has a positive value and weight",
  FRUITS.every((f) => f.points > 0 && f.weight > 0),
);
ok(
  "ids are unique",
  new Set(FRUITS.map((f) => f.id)).size === FRUITS.length,
);
// The ladder has to be monotonic or "rarer is worth more" is a lie: a player
// learns the ordering by sight, and one fruit out of order breaks the read for
// every fruit after it.
ok(
  "value rises as weight falls, entry by entry",
  FRUITS.every((f, i) => i === 0 || (f.points > FRUITS[i - 1].points && f.weight < FRUITS[i - 1].weight)),
);
ok("the cheapest is the old flat fruit value (100)", MIN_FRUIT_POINTS === 100, MIN_FRUIT_POINTS);
ok("the dearest is 500", MAX_FRUIT_POINTS === 500, MAX_FRUIT_POINTS);
// SCORE.fruit is gone; anything still reading it would get undefined and
// silently score NaN, so pin its absence rather than trusting the typechecker
// (the server reads config.ts as TEXT, where types don't help).
ok(
  "SCORE no longer carries a single fruit value",
  !("fruit" in SCORE),
  Object.keys(SCORE).join(","),
);

// ===========================================================================
section("The weighted roll");

// Exact boundaries rather than a statistical sample: with weights 40/25/18/12/5
// summing to 100, the cumulative edges are 0.40 / 0.65 / 0.83 / 0.95 / 1.00.
// Feeding rollFruit a fixed number makes those edges assertable to the point.
const boundaries: Array<[number, string]> = [
  [0, "apple"],
  [0.399, "apple"],
  [0.4, "banana"],
  [0.649, "banana"],
  [0.65, "carrot"],
  [0.829, "carrot"],
  [0.83, "strawberry"],
  [0.949, "strawberry"],
  [0.95, "mango"],
  [0.999, "mango"],
];
for (const [roll, expected] of boundaries) {
  const got = rollFruit(() => roll);
  ok(`roll ${roll} -> ${expected}`, got.id === expected, got.id);
}

// A generator that misbehaves must not be able to return undefined into the
// game loop — rollFruit clamps, so both ends stay inside the table.
ok("a rand() of exactly 1 still returns a fruit", rollFruit(() => 1).id === "mango");
ok("a negative rand() still returns a fruit", rollFruit(() => -5).id === "apple");

// The distribution over a large deterministic sweep. Not a random sample: it
// walks the unit interval evenly, so the counts ARE the weights and this can
// never flake.
{
  const N = 100000;
  const counts = new Map<string, number>();
  for (let i = 0; i < N; i++) {
    const id = rollFruit(() => i / N).id;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const total = FRUITS.reduce((sum, f) => sum + f.weight, 0);
  for (const fruit of FRUITS) {
    const share = (counts.get(fruit.id) ?? 0) / N;
    const want = fruit.weight / total;
    ok(
      `${fruit.id} lands ~${Math.round(want * 100)}% of the time`,
      Math.abs(share - want) < 0.002,
      `${(share * 100).toFixed(2)}%`,
    );
  }
}

// ===========================================================================
section("Lookup");

for (const fruit of FRUITS) {
  ok(`fruitById("${fruit.id}") round-trips`, fruitById(fruit.id).points === fruit.points);
}

// ===========================================================================
section("Spawn thresholds");

ok("four fruits per level", FRUIT_THRESHOLDS.length === 4, FRUIT_THRESHOLDS.length);
ok(
  "thresholds are sorted ascending",
  FRUIT_THRESHOLDS.every((t, i) => i === 0 || t > FRUIT_THRESHOLDS[i - 1]),
  FRUIT_THRESHOLDS.join(","),
);
// Every validated maze has 175+ biscuits (see mazes.json / MAZE_FACTS), so the
// last threshold has to be reachable before the level clears or the fourth
// fruit would never appear on any map.
ok(
  "the last threshold is reachable on the thinnest maze (175 biscuits)",
  FRUIT_THRESHOLDS[FRUIT_THRESHOLDS.length - 1] < 175,
  FRUIT_THRESHOLDS[FRUIT_THRESHOLDS.length - 1],
);

// The offset rule config.ts states for every pickup gate: no two pickups may
// fire on the same eaten-pellet tick. It was true of 70/140 by hand; with four
// entries it is worth a machine checking.
{
  // Widened to number[] because each list is an `as const` tuple of its own
  // literal types, and TypeScript would otherwise refuse the comparison
  // outright — which is a very confident way of not checking anything.
  const others: number[] = [...COIN_THRESHOLDS, ...LIFE_THRESHOLDS];
  const fruit: number[] = [...FRUIT_THRESHOLDS];
  const clash = fruit.filter((t) => others.includes(t));
  ok(
    "no fruit threshold collides with a coin or bonus-life threshold",
    clash.length === 0,
    clash.join(","),
  );
}

// ===========================================================================
section("Each threshold still fires exactly once (the v1.0 farming exploit)");

// The bug this guards is the reason shouldFireThreshold exists: eating a fruit
// does not change the pellet count, so a gate written as `includes(eaten)`
// re-fires on the very same beagle arrival and can be farmed by oscillating on
// the tile. At 100 points that was bad; with a 500-point mango on the table it
// would be the whole scoreboard.
{
  let idx = 0;
  let fired = 0;
  // Walk a whole level's worth of pellets, asking on EVERY tick — and asking
  // repeatedly on the threshold ticks, which is what the exploit did.
  for (let eaten = 0; eaten <= 179; eaten++) {
    for (let repeat = 0; repeat < 3; repeat++) {
      if (shouldFireThreshold(eaten, FRUIT_THRESHOLDS, idx)) {
        fired++;
        idx++;
      }
    }
  }
  ok(
    "a full level fires exactly four fruit spawns, however often it is asked",
    fired === FRUIT_THRESHOLDS.length,
    fired,
  );
}

// ===========================================================================
section("The fruit is time-limited (it no longer waits until eaten)");

ok(
  "FRUIT_LIFESPAN_SECONDS is a positive, finite number of seconds",
  Number.isFinite(FRUIT_LIFESPAN_SECONDS) && FRUIT_LIFESPAN_SECONDS > 0,
  FRUIT_LIFESPAN_SECONDS,
);
// The fruit lands on the maze's fixed `F` tiles rather than "wherever the
// beagle isn't", so the player gets no say in how far away it appears — and it
// is the pickup most worth a long detour. It must never be the tightest window
// of the timed pickups.
ok(
  "the fruit gets at least as long as the coin does",
  FRUIT_LIFESPAN_SECONDS >= COINS.lifespanSeconds,
  `${FRUIT_LIFESPAN_SECONDS} vs coin ${COINS.lifespanSeconds}`,
);

// game.ts's fruit lifecycle, modelled: maybeSpawnFruit's board-occupied guard
// sits BEFORE the threshold check, and tickFruitLifespan despawns at <= 0.
// Modelled rather than driven through Game because Game needs three.js and a
// DOM; the two functions below are a line-for-line mirror of those methods.
type FruitSim = { onBoard: boolean; timer: number; idx: number; spawns: number; expired: number };

function simSpawn(f: FruitSim, eaten: number): void {
  if (f.onBoard) return; // the occupied guard, BEFORE the threshold check
  if (!shouldFireThreshold(eaten, FRUIT_THRESHOLDS, f.idx)) return;
  f.idx++;
  f.onBoard = true;
  f.timer = FRUIT_LIFESPAN_SECONDS;
  f.spawns++;
}

function simTick(f: FruitSim, dt: number): void {
  if (!f.onBoard) return;
  f.timer -= dt;
  if (f.timer <= 0) {
    f.onBoard = false;
    f.timer = 0;
    f.expired++;
  }
}

{
  const f: FruitSim = { onBoard: false, timer: 0, idx: 0, spawns: 0, expired: 0 };
  simSpawn(f, FRUIT_THRESHOLDS[0]);
  ok("the first threshold puts a fruit on the board", f.onBoard && f.spawns === 1);

  // One frame short of the window: still there. This is the boundary that
  // matters — an off-by-one here is a fruit vanishing under the player's nose,
  // which is indistinguishable from a bug in the pickup check.
  simTick(f, FRUIT_LIFESPAN_SECONDS - 0.05);
  ok("still on the board just before the window closes", f.onBoard && f.expired === 0, f.timer);

  // 0.1 rather than the 0.05 left on the clock: floating-point subtraction
  // leaves 7e-16 on the counter at exactly 0, and a test that asserts a frame
  // lands on precisely zero is testing IEEE 754, not the fruit. The real loop
  // is fed wall-clock dt, which never lines up either — expiry happens on the
  // frame that CROSSES the window, which is what this asserts.
  simTick(f, 0.1);
  ok("gone once the window closes, awarding nothing", !f.onBoard && f.expired === 1);
  ok("expiry leaves no stale countdown behind", f.timer === 0, f.timer);

  // THE RULE WORTH PINNING: an expired fruit must not cost the level a spawn.
  // The index advanced when it spawned, so the NEXT threshold is the next
  // fruit — the map still gets four, the player just doesn't get to eat one
  // they ignored.
  simSpawn(f, FRUIT_THRESHOLDS[1]);
  ok("the next threshold still spawns after one expired", f.onBoard && f.spawns === 2);
}

{
  // A whole level in which the player eats none of them: four spawns, four
  // expiries, and never two fruits on the board at once.
  const f: FruitSim = { onBoard: false, timer: 0, idx: 0, spawns: 0, expired: 0 };
  let doubled = false;
  for (let eaten = 0; eaten <= 179; eaten++) {
    simSpawn(f, eaten);
    if (f.spawns - f.expired > 1) doubled = true;
    // ~1s of play per pellet; the point is only that the window closes
    // somewhere between two thresholds ~40 pellets apart.
    simTick(f, 1);
  }
  ok(
    "a level of ignored fruit spawns all four and expires all four",
    f.spawns === FRUIT_THRESHOLDS.length && f.expired === FRUIT_THRESHOLDS.length,
    `${f.spawns} spawned / ${f.expired} expired`,
  );
  ok("never two fruits on the board at once", !doubled);
}

// A fruit still lingering when the next threshold arrives DEFERS that spawn
// rather than burning it — the same guard order, from the other side.
{
  const f: FruitSim = { onBoard: false, timer: 0, idx: 0, spawns: 0, expired: 0 };
  simSpawn(f, FRUIT_THRESHOLDS[0]);
  simSpawn(f, FRUIT_THRESHOLDS[1]); // still on the board, no clock has run
  ok("a lingering fruit blocks the next spawn", f.spawns === 1 && f.idx === 1);
  simTick(f, FRUIT_LIFESPAN_SECONDS);
  simSpawn(f, FRUIT_THRESHOLDS[1] + 1);
  ok("...and the deferred threshold fires as soon as the board is clear", f.spawns === 2, f.spawns);
}

console.log(`\n${"-".repeat(60)}`);
console.log(`FRUITS: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
