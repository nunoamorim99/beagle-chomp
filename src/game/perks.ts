// OWNER: gameplay-engineer (IDEA-064)
//
// WHAT THE EQUIPPED BEAGLE DOES, and when it is allowed to do it.
//
// Pure and three/DOM-free like powerups.ts / fruits.ts / coins.ts, so the rules
// below are asserted in Node rather than discovered in a browser — see
// scripts/test-perks.ts.
//
// This module exists for the same reason powerups.ts does: the rule it encodes
// is small to say and easy to get wrong in several places at once. There are
// two halves.
//
// 1. THE MAPPING IS SPLIT ACROSS TWO FILES AND NEITHER IS THE WHOLE ANSWER.
//    Which coat carries which perk is an identity of the coat and lives in
//    cosmetics.ts; how much each perk is worth is a balance number and lives in
//    config.ts's BEAGLE_PERKS. Joining them is this module's job, and nothing
//    else may do it — game.ts asking `equipped === "muffin" ? 2 : 1` anywhere
//    would put a third copy of the mapping in the codebase, and the one that
//    drifts is never the one you are looking at.
//
// 2. PERKS ARE CLASSIC ONLY, AND THAT RULE LIVES HERE ONCE.
//    Every challenge score already on the board was set without them, exactly
//    as it was set without power-ups (IDEA-046). So every accessor below takes
//    the run's `kind` and returns the NEUTRAL value for a challenge run — not
//    because a caller remembered to ask, but because there is no way to ask
//    without saying which mode is running. The server enforces the same rule
//    from its own side (see server/src/validation/plausibility.ts), and the two
//    have to agree: if one applied a perk the other did not, an honest run
//    would be rejected as SCORE_ITEM_MISMATCH.
//
// A perk is looked up by SKIN ID rather than handed a BeagleSkin, so callers
// can pass whatever they have — the equipped id from cosmetics.ts, or (on the
// server's side of the same design) an id read off a session row.
import { BEAGLE_PERKS } from "./config";
import { getBeagleSkin, type BeaglePerkId } from "./cosmetics";

/**
 * Which mode the run is in.
 *
 * Spelled out as its own type rather than a boolean: `perkCoinMultiplier(id,
 * true)` reads as though the `true` might mean "apply the perk", and the value
 * that switches the rule off must never be the one that looks like "yes".
 */
export type RunKind = "classic" | "challenge";

/** The perk the given coat carries. Never throws — getBeagleSkin already
 *  degrades an unknown/stale id to the default coat, so a profile carrying a
 *  renamed skin gets Bagel's perk rather than a crash. */
export function perkIdOf(skinId: string): BeaglePerkId {
  return getBeagleSkin(skinId).perk.id;
}

/** True when `skinId` carries `perk` AND the run is one perks apply to. The
 *  single gate every accessor below goes through, so the classic-only rule is
 *  written once. */
function active(skinId: string, kind: RunKind, perk: BeaglePerkId): boolean {
  return kind === "classic" && perkIdOf(skinId) === perk;
}

/**
 * Shields the run starts holding (Bagel).
 *
 * ONCE per run, not per life and not per map: game.ts grants these in
 * startClassicRun, which is the one way a classic run may begin. Spend it and
 * it is gone, which is what leaves the rest of the run playing by the ordinary
 * rules — Nuno's words, "then follow the normal behaviour of the game".
 *
 * Granted through powerups.ts's own `collect`, so the shield behaves as a
 * shield in every respect, and deliberately NOT recorded in the run telemetry:
 * it was not picked up off the floor, it cannot add a point, and a run
 * reporting a power-up it did not collect is a run the server would have to
 * price for one.
 */
export function perkStartShields(skinId: string, kind: RunKind): number {
  return active(skinId, kind, "startShield") ? BEAGLE_PERKS.startShields : 0;
}

/**
 * Lives granted at the start of each MAP (Cookie) — the first map included, so
 * a run opens on START_LIVES + this.
 *
 * Per map rather than per run is the whole perk: it is what turns a coat that
 * gives you one more mistake into one that keeps giving you one, and LIVES.max
 * is what stops that becoming immortality (the grant is simply wasted at the
 * cap, exactly like every other bonus life).
 */
export function perkExtraLivesPerMap(skinId: string, kind: RunKind): number {
  return active(skinId, kind, "extraLifePerMap") ? BEAGLE_PERKS.extraLivesPerMap : 0;
}

/**
 * Multiplier on every coin PICKUP (Muffin). 1 when the perk is not in play, so
 * callers multiply unconditionally rather than branching.
 *
 * The SERVER is the authority on coins — it recomputes the award from the
 * accepted run and the client reconciles its optimistic balance to whatever
 * comes back — so this number existing on the client only makes the HUD honest
 * during the run. It has to match the server's, or the balance visibly jumps
 * when the run is submitted.
 */
export function perkCoinMultiplier(skinId: string, kind: RunKind): number {
  return active(skinId, kind, "doubleCoins") ? BEAGLE_PERKS.coinMultiplier : 1;
}

/**
 * Points added to EACH fruit eaten (Pepper). 0 when the perk is not in play.
 *
 * This is the one perk that moves the SCORE, which means the server has to know
 * about it to the point: a run reports both the exact fruit total it scored and
 * which fruits it ate, and plausibility.ts collapses those to a single expected
 * number. A bonus the server does not add is a rejected run, not a quiet
 * mismatch.
 */
export function perkFruitBonusPoints(skinId: string, kind: RunKind): number {
  return active(skinId, kind, "fruitBonus") ? BEAGLE_PERKS.fruitBonusPoints : 0;
}
