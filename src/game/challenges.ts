// OWNER: gameplay-engineer (IDEA-013 Challenge Mode)
//
// Pure data + helpers for CHALLENGE MODE: 8 fixed levels that layer
// per-level "modifiers" (speed tiers, extra ghosts, shorter fright windows)
// on top of the exact same proven classic engine (grid.ts / movement.ts /
// ghostAI.ts) — no new gameplay rules, just different dials on the existing
// ones. Three-free and DOM-free, like cosmetics.ts/coins.ts/pickups.ts, so
// it's unit-testable in Node (see scripts/test-cosmetics.ts) and importable
// from game.ts without pulling in any render dependency.
//
// CLASSIC MODE MUST REMAIN BYTE-FOR-BYTE IDENTICAL: CLASSIC_MODIFIERS below
// is the exact baseline classic already runs on today (speedMult 1,
// ghostSpeedMult 1, ghostCount 3, frightSeconds === config.ts's
// TIMING.frightSeconds) — game.ts's Play button path sets
// activeModifiers = CLASSIC_MODIFIERS, so classic gameplay is mathematically
// a no-op application of this same modifier system, not a separate code path.
import { TIMING } from "./config";

/**
 * The full set of dials a challenge level can turn. Every field is a
 * multiplier/count/duration applied on top of the SAME base balance numbers
 * in config.ts (SPEEDS.beagle/ghost/frightened/eaten, TIMING.frightSeconds) —
 * challenges never introduce new balance constants of their own.
 *
 * `speedMult` scales the beagle's own SPEEDS.beagle.
 * `ghostSpeedMult` scales every ghost speed tier (SPEEDS.ghost/frightened/
 * eaten) — kept as a SEPARATE field from speedMult (rather than always
 * reusing the same number) so a future level could, in principle, detune the
 * ratio; in practice every CHALLENGE_LEVELS entry below sets
 * ghostSpeedMult === speedMult (see each level's comment) so the beagle/ghost
 * speed RATIO stays exactly what it is in classic — a faster level is
 * uniformly faster, not suddenly easier or harder relative to the ghosts.
 * `ghostCount` is how many of the (now five) GHOST_DEFS entries game.ts's
 * resetActors() builds for that level — always 3 in classic.
 * `frightSeconds` replaces TIMING.frightSeconds for the fright window
 * triggered by eating a bone on that level.
 */
export interface ChallengeModifiers {
  speedMult: number;
  ghostSpeedMult: number;
  ghostCount: 3 | 4 | 5;
  frightSeconds: number;
}

/**
 * The baseline classic runs on. Every multiplier is 1 (i.e. "no change from
 * config.ts's raw SPEEDS"), ghostCount is 3 (today's fixed GHOST_DEFS count),
 * and frightSeconds is read directly from TIMING.frightSeconds rather than a
 * hardcoded literal so this can never silently drift from what classic mode
 * has always used. game.ts's Play button handler sets
 * `activeModifiers = CLASSIC_MODIFIERS` (and `gameKind = "classic"`) so every
 * classic run — including the headless sim in scripts/sim-logic.ts, which
 * exercises the engine directly rather than through Game — is provably
 * running the exact same numbers it always has.
 */
export const CLASSIC_MODIFIERS: ChallengeModifiers = {
  speedMult: 1,
  ghostSpeedMult: 1,
  ghostCount: 3,
  frightSeconds: TIMING.frightSeconds,
};

/** One challenge level: which maze it uses, which modifiers apply, and the
 *  player-facing name/blurb shown on the level-complete panel (see game.ts's
 *  challenge levelclear flow). `mazeIdx` is an index into MAZES (mazes.ts) —
 *  always in [0, MAZE_COUNT-1] (5 mazes today) since challenge levels reuse
 *  the exact same validated maze pool as classic, never their own mazes. */
export interface ChallengeLevel {
  name: string;
  mazeIdx: number;
  modifiers: ChallengeModifiers;
  blurb: string;
}

/**
 * The 8 fixed challenge levels, difficulty arc confirmed by design: speed
 * tiers and extra ghosts ramp up gradually, fright windows shorten once the
 * pace picks up (a full 7s fright at 2x speed would trivialize the ghosts),
 * and the finale (L8) stacks every twist at once. mazeIdx cycles through the
 * 5-maze pool (0-4) rather than inventing new maps — level-designer's
 * validated mazes are reused, just re-skinned with different pace/pressure.
 *
 * Every level after L1 sets ghostSpeedMult === speedMult (see
 * ChallengeModifiers' own doc comment) so a faster level is uniformly
 * faster for both sides, not a relative buff/nerf to either.
 */
export const CHALLENGE_LEVELS: readonly ChallengeLevel[] = [
  {
    // L1: baseline warm-up — literally CLASSIC_MODIFIERS, so the very first
    // challenge level plays identically to a classic run on map 1. Lets a
    // player learn the challenge-mode UI (level-complete panel, "next level"
    // flow) before any twist shows up.
    name: "Warm-Up Walkies",
    mazeIdx: 0,
    modifiers: { speedMult: 1, ghostSpeedMult: 1, ghostCount: 3, frightSeconds: TIMING.frightSeconds },
    blurb: "Just a classic lap around the garden — get your paws warmed up.",
  },
  {
    // L2: first twist — pure speed, everything else untouched.
    name: "Squirrel Sprint",
    mazeIdx: 1,
    modifiers: { speedMult: 1.3, ghostSpeedMult: 1.3, ghostCount: 3, frightSeconds: TIMING.frightSeconds },
    blurb: "Everything's faster! A squirrel darted through and revved the whole yard up.",
  },
  {
    // L3: first extra-ghost twist — speed back to normal so the player can
    // focus on the new fourth ghost in the pack.
    name: "Pack Mentality",
    mazeIdx: 2,
    modifiers: { speedMult: 1, ghostSpeedMult: 1, ghostCount: 4, frightSeconds: TIMING.frightSeconds },
    blurb: "A fourth ghost joins the chase — the pack just got bigger.",
  },
  {
    // L4: speed + a shortened fright window (first time bones feel risky).
    name: "Short Fuse",
    mazeIdx: 3,
    modifiers: { speedMult: 1.5, ghostSpeedMult: 1.5, ghostCount: 3, frightSeconds: 3 },
    blurb: "Bones don't last long here — chomp fast, the fright fuse is short.",
  },
  {
    // L5: combine the two twists introduced so far (extra ghost + speed).
    name: "Four on the Floor",
    mazeIdx: 4,
    modifiers: { speedMult: 1.4, ghostSpeedMult: 1.4, ghostCount: 4, frightSeconds: TIMING.frightSeconds },
    blurb: "Four ghosts, no brakes — the whole pack is running hot.",
  },
  {
    // L6: first five-ghost level, paired with a short fright (mirrors L3's
    // "isolate the new twist" pacing — speed is back to normal).
    name: "Full House",
    mazeIdx: 2,
    modifiers: { speedMult: 1, ghostSpeedMult: 1, ghostCount: 5, frightSeconds: 3 },
    blurb: "All five ghosts are home tonight — and the fright window's tight.",
  },
  {
    // L7: heavy speed + four ghosts, full fright window (the fright is the
    // one bit of breathing room left before the finale stacks everything).
    name: "Hound Dash",
    mazeIdx: 3,
    modifiers: { speedMult: 1.8, ghostSpeedMult: 1.8, ghostCount: 4, frightSeconds: TIMING.frightSeconds },
    blurb: "Full sprint, four ghosts on your tail — this is a proper hound dash.",
  },
  {
    // L8: the finale — every twist maxed out at once.
    name: "Top Dog",
    mazeIdx: 4,
    modifiers: { speedMult: 2.0, ghostSpeedMult: 2.0, ghostCount: 5, frightSeconds: 3 },
    blurb: "Double speed, all five ghosts, a fright window that barely blinks. Prove you're top dog.",
  },
] as const;

/** How many challenge levels exist (8 today). Callers should use this rather
 *  than hardcoding 8, so a future level added/removed here can't silently
 *  desync from profileStore.ts's challengeProgress convention (see its own
 *  doc comment: `challengeProgress === CHALLENGE_LEVEL_COUNT` means "every
 *  level cleared"). */
export const CHALLENGE_LEVEL_COUNT = CHALLENGE_LEVELS.length;

/**
 * Looks up a challenge level by index, clamped into [0, CHALLENGE_LEVEL_COUNT
 * - 1] — never throws or returns undefined, even for a garbage/out-of-range
 * idx (e.g. a corrupt persisted challengeProgress, or challengeIdx+1 called
 * past the last level before the "all clear" panel branch in game.ts checks
 * for it). Negative/NaN/non-finite indices clamp to 0 (the first level).
 */
export function getChallengeLevel(idx: number): ChallengeLevel {
  const safe = Number.isFinite(idx) ? Math.floor(idx) : 0;
  const clamped = Math.max(0, Math.min(safe, CHALLENGE_LEVEL_COUNT - 1));
  return CHALLENGE_LEVELS[clamped];
}
