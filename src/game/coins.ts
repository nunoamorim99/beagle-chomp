// OWNER: gameplay-engineer
//
// Pure helper for POINTS-MILESTONE bookkeeping: how many times a cumulative
// score has crossed a "every N points" threshold. Three/DOM-free so the maths
// is unit testable in Node without constructing a Game — see
// scripts/test-cosmetics.ts.
//
// It was written for IDEA-016's points-to-coins conversion, and the name still
// says so. That mechanic is GONE (IDEA-016 v2 — it made the shop trivial), and
// the function survives because bonus LIVES use exactly the same maths on a
// different divisor (LIVES.milestonePoints). Kept under its old name rather
// than renamed: it is referenced by name across the tests and the ledger, and a
// rename would cost more in traceability than the stale word costs in clarity.

/**
 * How many times a cumulative `score` has crossed a `perPoints` threshold in
 * total. Pure `Math.floor` division — callers (game.ts) track how many have
 * already been "awarded" and act on the difference each time score changes, so
 * a single scoring event that crosses several thresholds at once (a big
 * ghost-eat chain) is handled in one go.
 *
 * Guards against a negative/garbage `perPoints` so this is safe to call with
 * any number without producing Infinity/NaN/negative results.
 */
export function coinsDueFromScore(score: number, perPoints: number): number {
  if (!Number.isFinite(score) || score <= 0) return 0;
  if (!Number.isFinite(perPoints) || perPoints <= 0) return 0;
  return Math.floor(score / perPoints);
}
