// OWNER: gameplay-engineer (IDEA-046)
//
// WHAT THE PLAYER IS CURRENTLY HOLDING, and when each of it goes away.
//
// Pure and three/DOM-free like fruits.ts / coins.ts / pickups.ts, so the rules
// below are asserted in Node rather than discovered in a browser — see
// scripts/test-powerups.ts.
//
// This module exists because the rule it encodes is small to say and easy to
// get wrong. Nuno's words: "when the user has power-up 1 and 2 and 5 but gets
// caught, they only lose the 5 and keep the others until they die." Read
// carefully, that says a SHIELDED HIT IS NOT A DEATH — it is a third outcome,
// sitting between "nothing happened" and "you lost a life", and the two
// doublers must survive it. Spread across game.ts's collision handler that
// distinction would be one `if` somebody later simplifies away; here it is a
// function with a return type that makes it impossible to ignore.
//
// The three lifetimes, and why they are three:
//
//   timed       — a countdown. The anchor and the star.
//   untilDeath  — survives a shielded hit AND survives clearing the map. The
//                 doublers. This is what makes a run feel owned: a x2 carried
//                 through three maps is something you are protecting.
//   untilHit    — spent converting the next contact into a bounce. The shield.
//
// game.ts owns one PowerupState per RUN (not per level — that is the whole
// point of untilDeath) and reads the derived multipliers off it every frame.
import {
  POWERUPS,
  POWERUP_MULTIPLIER,
  POWERUP_SLOW_MULT,
  POWERUP_STAR_SPEED_MULT,
  type Powerup,
  type PowerupId,
} from "./config";

/** One power-up the player is currently holding. `remaining` is only
 *  meaningful for the timed kinds; it stays 0 for the others so nothing has to
 *  branch on the kind just to read it. */
export interface ActivePowerup {
  id: PowerupId;
  label: string;
  kind: Powerup["kind"];
  /** Seconds left, for "timed" only. 0 for the others. */
  remaining: number;
  /** What `remaining` started at, so the HUD can draw a drain bar without
   *  needing to look the duration up in config. 0 for the others. */
  duration: number;
}

export interface PowerupState {
  active: ActivePowerup[];
}

/** What a contact with an enemy actually did. Deliberately a THREE-way result
 *  rather than a boolean: "shielded" is not a soft death, and typing it this
 *  way means a caller cannot accidentally treat it as one. */
export type CaughtOutcome = "shielded" | "died";

export function createPowerupState(): PowerupState {
  return { active: [] };
}

/** Total of every weight in POWERUPS. Computed, not hardcoded — same reason as
 *  fruits.ts: a sixth power-up must not require anyone to re-total by hand. */
const TOTAL_WEIGHT = POWERUPS.reduce((sum, p) => sum + p.weight, 0);

/**
 * Rolls which power-up spawns, from the weighted table.
 *
 * Same shape as fruits.ts's rollFruit, deliberately: `rand` is injected so the
 * test can assert the exact boundaries rather than sample a distribution, and
 * the walk is in POWERUPS order so reordering the table is a visible change
 * rather than a silent reshuffle.
 */
export function rollPowerup(rand: () => number = Math.random): Powerup {
  const roll = Math.min(Math.max(rand(), 0), 0.999999) * TOTAL_WEIGHT;
  let cumulative = 0;
  for (const p of POWERUPS) {
    cumulative += p.weight;
    if (roll < cumulative) return p;
  }
  return POWERUPS[POWERUPS.length - 1];
}

function defOf(id: PowerupId): Powerup {
  const found = POWERUPS.find((p) => p.id === id);
  // Non-null asserted via a throw rather than `!`: an unknown id here means the
  // registry and a caller have diverged, and failing loudly in a pure module is
  // far cheaper to trace than a silent undefined reaching the render layer.
  if (!found) throw new Error(`powerups: unknown id "${id}"`);
  return found;
}

/**
 * Collect one.
 *
 * Collecting a power-up you already hold REFRESHES it rather than stacking it:
 * a second anchor restarts the 8 seconds, and a second x2 does not become x4.
 * Stacking is tempting and wrong — it turns a lucky double spawn into a run
 * nobody can catch, and it would mean the server's score ceiling had to allow
 * for an unbounded multiplier, which is exactly the kind of bound that stops
 * bounding anything.
 */
export function collect(state: PowerupState, id: PowerupId): void {
  const def = defOf(id);
  const existing = state.active.find((a) => a.id === id);

  if (existing) {
    existing.remaining = def.seconds;
    existing.duration = def.seconds;
    return;
  }

  state.active.push({
    id: def.id,
    label: def.label,
    kind: def.kind,
    remaining: def.seconds,
    duration: def.seconds,
  });
}

/**
 * Advance the timed ones. Called only from updatePlay (never from tick), for
 * the same reason play time is: a power-up must not burn down while the shop
 * or the pause panel is open.
 */
export function tick(state: PowerupState, dt: number): void {
  if (!Number.isFinite(dt) || dt <= 0) return;
  for (const a of state.active) {
    if (a.kind === "timed") a.remaining -= dt;
  }
  state.active = state.active.filter((a) => a.kind !== "timed" || a.remaining > 0);
}

/**
 * An enemy touched the beagle.
 *
 * Returns "shielded" if a shield absorbed it — the shield is consumed, and
 * EVERYTHING ELSE IS LEFT ALONE, which is the rule this module exists for. A
 * shielded hit is not a death, so the doublers are not cleared and the timed
 * ones keep running.
 *
 * Returns "died" otherwise, WITHOUT clearing anything: the caller decides when
 * the death actually resolves (there is a dying animation between the contact
 * and the respawn) and calls onDeath() then. Keeping those separate means this
 * function can be asked "what would happen" without side effects on the state
 * it reports about.
 */
export function onCaught(state: PowerupState): CaughtOutcome {
  const shieldIdx = state.active.findIndex((a) => a.kind === "untilHit");
  if (shieldIdx === -1) return "died";
  state.active.splice(shieldIdx, 1);
  return "shielded";
}

/**
 * A life was actually lost. Everything goes — the doublers by definition
 * ("until you die"), and the timed ones because the death beat and the READY
 * pause would otherwise eat most of a countdown the player cannot use anyway.
 */
export function onDeath(state: PowerupState): void {
  state.active = [];
}

/**
 * The map was cleared.
 *
 * The doublers and the shield CARRY OVER; the timed ones do not. That asymmetry
 * is deliberate and is the whole reason `kind` exists rather than a plain
 * `seconds > 0` check: carrying a countdown across the level-clear beat and the
 * next READY pause would hand the player two or three seconds of an eight
 * second power-up, which reads as a bug rather than a bonus.
 */
export function onLevelClear(state: PowerupState): void {
  state.active = state.active.filter((a) => a.kind !== "timed");
}

// ---------------------------------------------------------------------------
// Derived values. game.ts reads these every frame and never inspects `active`
// directly, so how the state is stored stays this module's business.

function has(state: PowerupState, id: PowerupId): boolean {
  return state.active.some((a) => a.id === id);
}

/** Multiplier on every biscuit and bone eaten. */
export function biscuitMult(state: PowerupState): number {
  return has(state, "doubleBiscuit") ? POWERUP_MULTIPLIER : 1;
}

/** Multiplier on every enemy eaten, applied AFTER the fright chain doubling —
 *  so a 4th ghost in a chain under this is 1600 * 2, not a 5th chain step. */
export function ghostMult(state: PowerupState): number {
  return has(state, "doubleGhost") ? POWERUP_MULTIPLIER : 1;
}

/** Multiplier on every enemy speed tier while the anchor is up. */
export function ghostSpeedMult(state: PowerupState): number {
  return has(state, "slowGhosts") ? POWERUP_SLOW_MULT : 1;
}

/** Multiplier on the beagle's speed while the star is up. */
export function beagleSpeedMult(state: PowerupState): number {
  return has(state, "star") ? POWERUP_STAR_SPEED_MULT : 1;
}

/** True while the star is up. game.ts keeps the fright window topped up from
 *  this, so the pack cannot un-frighten mid-star. */
export function starActive(state: PowerupState): boolean {
  return has(state, "star");
}

/** True while a shield is held — for the HUD and for the beagle's bubble. */
export function hasShield(state: PowerupState): boolean {
  return has(state, "shield");
}
