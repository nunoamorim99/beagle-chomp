// OWNER: gameplay-engineer (IDEA-016 points->coins)
//
// Pure helper for the score->coins bookkeeping (IDEA-016: every COINS.perPoints
// points earned in a run banks 1 coin). Kept as its own tiny three/DOM-free
// module (rather than inline in game.ts) so the threshold math is unit
// testable in Node without constructing a Game — see scripts/test-cosmetics.ts.

/**
 * How many coins a given cumulative `score` has earned in total, at
 * `perPoints` points per coin. Pure `Math.floor` division — callers (game.ts)
 * track how many have already been "awarded" and bank the difference each
 * time score changes, so a single scoring event that crosses multiple
 * thresholds at once (e.g. a big ghost-eat chain) banks all of them together.
 *
 * Guards against a negative/garbage `perPoints` (shouldn't happen given
 * config.ts's COINS.perPoints const, but keeps this safe to call with any
 * number without producing Infinity/NaN/negative results).
 */
export function coinsDueFromScore(score: number, perPoints: number): number {
  if (!Number.isFinite(score) || score <= 0) return 0;
  if (!Number.isFinite(perPoints) || perPoints <= 0) return 0;
  return Math.floor(score / perPoints);
}
