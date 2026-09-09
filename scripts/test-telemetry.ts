// OWNER: qa-test-engineer (IDEA-050)
//
// The run telemetry's INVARIANTS — the two sums the server refuses a run for
// breaking.
//
// This suite exists because those sums are enforced in two places that cannot
// see each other: `runTelemetry.ts` builds them on the client, and
// `plausibility.ts` checks them on the server. The server's own suite proves
// it rejects a contradictory run; this one proves the client cannot PRODUCE
// one. Without it, a bug in `bump()` would ship as "some players' runs stopped
// counting", which is the failure mode this project has already paid for twice
// (IDEA-020 v2/v3, IDEA-040 v3).
//
// Pure and headless: runTelemetry.ts imports nothing at all, and fruits.ts
// imports only config.ts, so neither drags in three.js or the DOM.

import {
  createRunTelemetry,
  recordFruit,
  recordDeath,
  recordPellet,
  recordBone,
  recordGhost,
  recordCoin,
} from "../src/game/runTelemetry";
import { fruitIndexById, rollFruit } from "../src/game/fruits";
import { FRUITS, ENEMY_SLOTS, COLORS } from "../src/game/config";

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

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

// ---------------------------------------------------------------------------
section("A fresh run reports nothing");

{
  const t = createRunTelemetry();
  ok("no deaths", t.livesLost === 0 && t.deathsByGhost.length === 0);
  ok("no fruit", t.fruitEaten === 0 && t.fruitKindCounts.length === 0);
  // An EMPTY array is what a zero-death run legitimately sends, and the server
  // treats absent and empty differently — so this must not be undefined.
  ok("the arrays exist rather than being undefined", Array.isArray(t.deathsByGhost));
}

// ---------------------------------------------------------------------------
section("deathsByGhost always sums to livesLost");

{
  const t = createRunTelemetry();
  // A plausible run: caught by the rose one twice, the amber one once.
  recordDeath(t, 0);
  recordDeath(t, 2);
  recordDeath(t, 0);
  ok("three deaths counted", t.livesLost === 3);
  ok("…and they sum", sum(t.deathsByGhost) === t.livesLost, JSON.stringify(t.deathsByGhost));
  ok("…attributed to the right enemies", t.deathsByGhost[0] === 2 && t.deathsByGhost[2] === 1);
  // The gap must be a real zero, not a hole: JSON.stringify turns an empty
  // slot into `null`, which the server reads as malformed.
  ok("the gap is 0, not an empty slot", t.deathsByGhost[1] === 0);
  ok("…and survives JSON", JSON.parse(JSON.stringify(t.deathsByGhost))[1] === 0);
}

{
  // Only as long as the array needs to be — a classic run never sees enemy 4,
  // and padding it to five would claim slots the run never fielded.
  const t = createRunTelemetry();
  recordDeath(t, 1);
  ok("the array grows only to the enemy seen", t.deathsByGhost.length === 2);
}

{
  // A garbage index must not corrupt the array. It is DROPPED, which breaks
  // the sum on purpose: the server then rejects the run loudly instead of
  // silently banking a wrong nemesis.
  const t = createRunTelemetry();
  recordDeath(t, -1);
  ok("a negative index is dropped", t.deathsByGhost.length === 0);
  ok("…and the mismatch is visible", sum(t.deathsByGhost) !== t.livesLost);
}

// ---------------------------------------------------------------------------
section("fruitKindCounts always sums to fruitEaten and prices to fruitPoints");

{
  const t = createRunTelemetry();
  for (const id of ["apple", "mango", "mango"] as const) {
    const fruit = FRUITS[fruitIndexById(id)];
    recordFruit(t, fruit.points, fruitIndexById(id));
  }
  ok("three fruits counted", t.fruitEaten === 3);
  ok("…and the kinds sum", sum(t.fruitKindCounts) === t.fruitEaten);
  const priced = t.fruitKindCounts.reduce((acc, n, i) => acc + n * FRUITS[i].points, 0);
  ok("…and price to exactly fruitPoints", priced === t.fruitPoints, `${priced} vs ${t.fruitPoints}`);
  ok("…which is 100 + 500 + 500", t.fruitPoints === 1100, String(t.fruitPoints));
}

{
  // The property that matters, over the real weighted roll rather than a
  // hand-picked basket: whatever rollFruit produces, the two stay in step.
  const t = createRunTelemetry();
  let seed = 0;
  const rand = (): number => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  for (let i = 0; i < 500; i++) {
    const fruit = rollFruit(rand);
    recordFruit(t, fruit.points, fruitIndexById(fruit.id));
  }
  ok("500 rolled fruits still sum", sum(t.fruitKindCounts) === t.fruitEaten);
  const priced = t.fruitKindCounts.reduce((acc, n, i) => acc + n * FRUITS[i].points, 0);
  ok("…and still price exactly", priced === t.fruitPoints, `${priced} vs ${t.fruitPoints}`);
  ok("…and never claim a fruit that does not exist", t.fruitKindCounts.length <= FRUITS.length);
}

// ---------------------------------------------------------------------------
section("fruitIndexById agrees with the table");

{
  ok(
    "every fruit resolves to its own position",
    FRUITS.every((f, i) => fruitIndexById(f.id) === i),
  );
  // -1 is the documented "unknown" answer, and recordFruit drops it — the
  // resulting sum mismatch is caught server-side rather than writing a hole.
  ok("an unknown id is -1", fruitIndexById("durian" as never) === -1);
}

// ---------------------------------------------------------------------------
section("ENEMY_SLOTS is the one ordering everything indexes by");

{
  // game.ts builds GHOST_DEFS from this list positionally, deathsByGhost is
  // indexed by it, plausibility.ts bounds the array length by the widest
  // ghostCount, and the portal names slots from it. If this list ever shrinks
  // below the number of enemies a challenge level can field, a legitimate death
  // becomes unrecordable.
  ok("five slots, one per enemy the game can field", ENEMY_SLOTS.length === 5);
  ok(
    "ids are unique",
    new Set(ENEMY_SLOTS.map((s) => s.id)).size === ENEMY_SLOTS.length,
  );
  ok(
    "every slot has a colour and a label",
    ENEMY_SLOTS.every((s) => typeof s.color === "number" && s.label.length > 0),
  );
  // The order is a STORAGE FORMAT: rows already in run_stats are indexed by it,
  // so reordering silently relabels history. Pin it.
  ok(
    "the order is rose, teal, amber, violet, leaf",
    ENEMY_SLOTS.map((s) => s.id).join(",") === "rose,teal,amber,violet,leaf",
    ENEMY_SLOTS.map((s) => s.id).join(","),
  );
  ok(
    "the colours are the palette's ghost hues, in that order",
    ENEMY_SLOTS[0].color === COLORS.ghostRose &&
      ENEMY_SLOTS[1].color === COLORS.ghostTeal &&
      ENEMY_SLOTS[2].color === COLORS.ghostAmber &&
      ENEMY_SLOTS[3].color === COLORS.ghostViolet &&
      ENEMY_SLOTS[4].color === COLORS.ghostLeaf,
  );
  // A death can be recorded against any slot the game can field.
  const t = createRunTelemetry();
  recordDeath(t, ENEMY_SLOTS.length - 1);
  ok("the last slot is recordable", sum(t.deathsByGhost) === 1);
  ok("…and does not overflow the list", t.deathsByGhost.length === ENEMY_SLOTS.length);
}

// ---------------------------------------------------------------------------
section("the other counters are untouched by this change");

{
  const t = createRunTelemetry();
  recordPellet(t);
  recordBone(t);
  recordGhost(t);
  recordCoin(t);
  ok(
    "pellets, bones, ghosts and coins still count",
    t.pelletsEaten === 1 && t.bonesEaten === 1 && t.ghostsEaten === 1 && t.coinsCollected === 1,
  );
}

console.log(`\n${"-".repeat(60)}`);
console.log(`TELEMETRY: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
