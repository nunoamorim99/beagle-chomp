// OWNER: gameplay-engineer
//
// Pure helper for the "pellets-eaten threshold" pickup-spawn gate shared by
// ALL THREE maze pickups (coin, IDEA-017; bonus life, IDEA-018; fruit,
// v1.0/IDEA-015) — kept as its own tiny three/DOM-free module (mirroring
// coins.ts's coinsDueFromScore) so the gate logic is unit testable in Node
// without constructing a Game. See scripts/test-cosmetics.ts.
//
// BUG FIXED HERE (live-verified farming exploit, all three pickups): the
// original gate was `THRESHOLDS.includes(eaten)`, checked on every beagle
// arrival. Because EATING a pickup doesn't change `eaten` (pellets consumed),
// the very same arrival that eats a pickup immediately re-passes the gate on
// the next maybeSpawn* call (the mesh is null again, `eaten` still equals the
// threshold) — so the pickup respawns on the spot and can be farmed by
// oscillating over the tile. shouldFireThreshold below fixes this by making
// each threshold fire EXACTLY ONCE per level via a monotonically-advancing
// index pointer, regardless of how many times a pickup is spawned/eaten
// in between.

/**
 * Whether the NEXT not-yet-fired threshold in `thresholds` (a threshold list
 * sorted ascending, e.g. config.ts's COIN_THRESHOLDS/LIFE_THRESHOLDS or
 * game.ts's FRUIT_THRESHOLDS) should fire now, given how many pellets have
 * been eaten so far (`eaten`) and how many thresholds have already fired
 * this level (`nextIdx` — the index into `thresholds` of the next one still
 * pending; starts at 0 for a fresh level).
 *
 * Uses `>=` rather than `===` so a threshold still fires even if a tick is
 * ever skipped past it (e.g. a big multi-pellet-in-one-frame edge case) —
 * each threshold fires exactly once regardless. Once `nextIdx` reaches
 * `thresholds.length`, every threshold for this level has already fired and
 * this always returns false (no out-of-bounds access, no re-firing).
 *
 * Pure and stateless: callers (game.ts) own the actual `nextIdx` counter
 * (level-scoped — reset once per fresh level, NOT on a same-level
 * death-respawn, since `eaten` itself doesn't reset on death — see
 * LevelAssets.nextCoinThresholdIdx/nextLifeThresholdIdx/
 * nextFruitThresholdIdx in game.ts) and are responsible for incrementing it
 * (`nextIdx++`) exactly when this returns true and a spawn actually happens.
 */
export function shouldFireThreshold(
  eaten: number,
  thresholds: readonly number[],
  nextIdx: number,
): boolean {
  if (nextIdx < 0 || nextIdx >= thresholds.length) return false;
  return eaten >= thresholds[nextIdx];
}
