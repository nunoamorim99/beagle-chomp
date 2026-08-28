// OWNER: gameplay-engineer (IDEA-045)
//
// WHICH fruit spawns. Pure and three/DOM-free like coins.ts/pickups.ts, so the
// distribution can be asserted in Node without constructing a Game — see
// scripts/test-fruits.ts.
//
// The value table itself lives in config.ts with the other balance numbers
// (CLAUDE.md's rule); this module owns only the choosing.
import { FRUITS, type Fruit, type FruitId } from "./config";

/** Total of every weight in FRUITS. Computed once, not hardcoded to 100 — the
 *  weights are relative by design, so a sixth fruit must not require anyone to
 *  remember to re-total them. */
const TOTAL_WEIGHT = FRUITS.reduce((sum, f) => sum + f.weight, 0);

/**
 * The most any single fruit is worth (Mango, 500) and the least (Apple, 100).
 *
 * Derived rather than written down because the SERVER prices runs against
 * exactly these two numbers — the score ceiling uses the max and the floor the
 * min (see server/src/validation/plausibility.ts). A hardcoded 500 that drifted
 * from the table would start rejecting honest runs, silently, in production.
 */
export const MAX_FRUIT_POINTS = Math.max(...FRUITS.map((f) => f.points));
export const MIN_FRUIT_POINTS = Math.min(...FRUITS.map((f) => f.points));

/**
 * Rolls one fruit from the weighted table.
 *
 * `rand` is injected (defaulting to Math.random) purely so the test can feed a
 * deterministic sequence and assert the exact boundaries — with Math.random
 * baked in, the only honest test would be a statistical one over a large
 * sample, which is both slower and flakier than checking that 0.0 gives an
 * Apple and 0.999 gives a Mango.
 *
 * Walks the cumulative weights in FRUITS order, so the boundaries are stable
 * and reordering the table is a deliberate, visible change rather than a silent
 * reshuffle of what a given random value means.
 */
export function rollFruit(rand: () => number = Math.random): Fruit {
  // Clamped because a caller's rand() returning exactly 1 (or, through some
  // future seeded generator, slightly more) would otherwise fall off the end
  // of the loop and hit the fallback. The fallback is still there, but it
  // should be unreachable rather than load-bearing.
  const roll = Math.min(Math.max(rand(), 0), 0.999999) * TOTAL_WEIGHT;
  let cumulative = 0;
  for (const fruit of FRUITS) {
    cumulative += fruit.weight;
    if (roll < cumulative) return fruit;
  }
  return FRUITS[FRUITS.length - 1];
}

/**
 * Looks a fruit up by id.
 *
 * Falls back to the Apple rather than throwing: the only callers are the render
 * layer picking a mesh builder and the editor listing pickups, and a missing
 * mesh should degrade to the common fruit, not take the frame down.
 */
export function fruitById(id: FruitId): Fruit {
  return FRUITS.find((f) => f.id === id) ?? FRUITS[0];
}
