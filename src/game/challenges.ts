// OWNER: gameplay-engineer (IDEA-013 Challenge Mode · IDEA-063 the 40-level ladder)
//
// Pure data + helpers for CHALLENGE MODE: 40 fixed levels in two chapters that
// layer per-level "modifiers" (speed tiers, extra ghosts, shorter or longer
// fright windows) and a FORCED MAZE THEME on top of the exact same proven
// classic engine (grid.ts / movement.ts / ghostAI.ts) — no new gameplay rules,
// just different dials on the existing ones. Three-free and DOM-free, like
// cosmetics.ts/coins.ts/pickups.ts, so it's unit-testable in Node (see
// scripts/test-cosmetics.ts) and importable from game.ts without pulling in any
// render dependency.
//
// THE LADDER IS TWO CHAPTERS, AND THE FIRST ONE HAS NO TWISTS AT ALL (IDEA-063,
// Nuno). Levels 1-30 are THE GRAND TOUR: one level per playable maze, in maze
// order, at literally CLASSIC_MODIFIERS — three enemies, classic pace, the full
// fright window, the same fruit and golden bones classic has. They exist for one
// reason: classic mode only ever shows a player the maps its progression hands
// out, in that order, so most players will never meet maze 23. The tour is how
// you meet all thirty, one short self-contained run at a time.
//
// Levels 31-40 are THE TWISTS: the eight levels IDEA-013 shipped, unchanged, plus
// two new ones. That is where speed tiers and extra ghosts live.
//
// EVERY LEVEL FORCES A THEME, AND OWNING IT IS NOT REQUIRED. A challenge level
// is dressed by its own themeId regardless of what the player has bought or
// equipped in the shop (game.ts's startChallengeLevel applies it, and restores
// the equipped theme when a classic run starts). That is the second half of the
// tour's job: the shop sells six maze themes and a player who owns one has never
// seen the other five. Across the thirty tour levels each theme appears exactly
// five times, because the cycle is THEME_CYCLE[idx % 6] and 30 divides by 6.
//
// NO POWER-UPS, IN EITHER CHAPTER. game.ts's maybeSpawnPowerup refuses to spawn
// them outside classic, and plausibility.ts rejects any challenge run that
// reports one outright — every challenge score already on the board was set
// without them. The dial a future twist level would turn is a power-up GRANTED
// by the level itself, not one lying on the floor to be found.
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
 * triggered by eating a bone on that level. It is NOT bounded by
 * TIMING.frightSeconds in either direction — L39 runs a deliberately LONGER
 * window than classic has ever had, which is the one dial direction the
 * original eight never explored.
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
 *
 * All thirty TOUR levels below are field-for-field equal to this. That is the
 * chapter's whole design: the maze and the theme are the only things that
 * change, so a tour level is a classic map played on its own, and nothing a
 * player learns there is a lie about how the game handles.
 */
export const CLASSIC_MODIFIERS: ChallengeModifiers = {
  speedMult: 1,
  ghostSpeedMult: 1,
  ghostCount: 3,
  frightSeconds: TIMING.frightSeconds,
};

/** Which chapter a level belongs to. "tour" levels are the thirty
 *  classic-pace maze showcases (levels 1-30); "twist" levels are the ten that
 *  actually turn the dials (levels 31-40). The UI reads this rather than
 *  comparing an index against 30, so the boundary lives in the data. */
export type ChallengeKind = "tour" | "twist";

/** One challenge level: which maze it uses, which modifiers apply, which maze
 *  theme it FORCES (owned or not — see the module comment), and the
 *  player-facing name/blurb shown on the level map and the level-complete
 *  panel (see game.ts's challenge levelclear flow).
 *
 *  `mazeIdx` is an index into MAZES (mazes.ts) and is always in
 *  [0, MAPS_PER_LAP-1] — i.e. one of the thirty PLAYABLE mazes. The six BONUS
 *  mazes (indices 30-35, see progression.ts's BONUS_MAZE_START) are
 *  deliberately never used here: a bonus board is a wide-open one-enemy point
 *  farm designed as a reward between classic stages, and a whole challenge
 *  level of one would be a level with nothing in it.
 *
 *  `themeId` is a MAZE_THEMES id from themes.ts. Deliberately a plain string
 *  rather than an import of that registry: this module is the one the SERVER's
 *  sync script parses as TEXT, and themes.ts is ~700 lines of palettes and prop
 *  placements that the server has no use for. scripts/test-cosmetics.ts checks
 *  every id written here actually resolves against MAZE_THEMES. */
export interface ChallengeLevel {
  name: string;
  mazeIdx: number;
  modifiers: ChallengeModifiers;
  themeId: string;
  kind: ChallengeKind;
  blurb: string;
}

/** How many levels the GRAND TOUR chapter has — one per playable maze. */
export const TOUR_LEVEL_COUNT = 30;

/** The theme rotation the tour walks, in MAZE_THEMES order. Six themes over
 *  thirty levels is exactly five full laps, so every theme is shown the same
 *  number of times — see the module comment. Exported so the test can assert
 *  the cycle actually holds in the literal table below rather than trusting it
 *  was typed correctly thirty times. */
export const THEME_CYCLE: readonly string[] = ["garden", "classic", "forest", "beach", "park", "city"];

/**
 * The 40 challenge levels.
 *
 * Written out as forty LITERAL entries rather than generated by a loop, and
 * that is load-bearing rather than stylistic: server/scripts/sync-game-constants.ts
 * parses THIS FILE AS TEXT (it cannot import across the frontend's bundler
 * moduleResolution boundary — see its own header) to vendor each level's
 * ghostCount and speedMult into the score validator. A generated array would
 * regex to nothing, the catalog would ship zero challenge levels, and every
 * honest challenge run would start failing validation with MALFORMED_SUBMISSION.
 * If you change the shape of an entry, keep `mazeIdx:` on its own line
 * immediately followed by `modifiers: { ... }` on ONE line, and run
 * `npm run sync` in server/.
 */
export const CHALLENGE_LEVELS: readonly ChallengeLevel[] = [
  // ---- Chapter 1: THE GRAND TOUR (levels 1-30) ----------------------------
  // One level per playable maze, in maze order, every one of them field-for-
  // field CLASSIC_MODIFIERS. The maze and the forced theme are the only things
  // that vary. Do not "improve" one of these with a twist: the chapter's value
  // is that it is the same game thirty times over, so the BOARD is the only
  // variable and a player can actually learn it.
  {
    name: "Classic Garden",
    mazeIdx: 0,
    modifiers: { speedMult: 1, ghostSpeedMult: 1, ghostCount: 3, frightSeconds: TIMING.frightSeconds },
    themeId: "garden",
    kind: "tour",
    blurb: "The board it all started on — twin loops above and below, hedges you already know by heart.",
  },
  {
    name: "The Back Garden",
    mazeIdx: 1,
    modifiers: { speedMult: 1, ghostSpeedMult: 1, ghostCount: 3, frightSeconds: TIMING.frightSeconds },
    themeId: "classic",
    kind: "tour",
    blurb: "The same bones, moved. Everything reads familiar right up until you reach for a bone that isn't there.",
  },
  {
    name: "The Courtyard",
    mazeIdx: 2,
    modifiers: { speedMult: 1, ghostSpeedMult: 1, ghostCount: 3, frightSeconds: TIMING.frightSeconds },
    themeId: "forest",
    kind: "tour",
    blurb: "An open plaza with almost nothing to hide behind. Wide is not the same as safe.",
  },
  {
    name: "The Warren",
    mazeIdx: 3,
    modifiers: { speedMult: 1, ghostSpeedMult: 1, ghostCount: 3, frightSeconds: TIMING.frightSeconds },
    themeId: "beach",
    kind: "tour",
    blurb: "A tight lattice of short hops and blind corners. Plan two turns ahead or don't plan at all.",
  },
  {
    name: "The Crossroads",
    mazeIdx: 4,
    modifiers: { speedMult: 1, ghostSpeedMult: 1, ghostCount: 3, frightSeconds: TIMING.frightSeconds },
    themeId: "park",
    kind: "tour",
    blurb: "Long straight arteries that run the whole board. Lovely for sprinting, terrible for hiding.",
  },
  {
    name: "The Potting Shed",
    mazeIdx: 5,
    modifiers: { speedMult: 1, ghostSpeedMult: 1, ghostCount: 3, frightSeconds: TIMING.frightSeconds },
    themeId: "city",
    kind: "tour",
    blurb: "Boxed-in compartments and a lopsided bottom end — the one board that isn't a mirror of itself.",
  },
  {
    name: "The Hedge Spiral",
    mazeIdx: 6,
    modifiers: { speedMult: 1, ghostSpeedMult: 1, ghostCount: 3, frightSeconds: TIMING.frightSeconds },
    themeId: "garden",
    kind: "tour",
    blurb: "Rings inside rings. Every lap looks like the last one until you notice you're further in.",
  },
  {
    name: "The Kennel Rows",
    mazeIdx: 7,
    modifiers: { speedMult: 1, ghostSpeedMult: 1, ghostCount: 3, frightSeconds: TIMING.frightSeconds },
    themeId: "classic",
    kind: "tour",
    blurb: "Paired blocks with gaps between them, like a row of kennels with the doors left open.",
  },
  {
    name: "The Trellis",
    mazeIdx: 8,
    modifiers: { speedMult: 1, ghostSpeedMult: 1, ghostCount: 3, frightSeconds: TIMING.frightSeconds },
    themeId: "forest",
    kind: "tour",
    blurb: "Tall vertical ladders top to bottom. The ghosts love a straight line; so should you.",
  },
  {
    name: "The Flowerbeds",
    mazeIdx: 9,
    modifiers: { speedMult: 1, ghostSpeedMult: 1, ghostCount: 3, frightSeconds: TIMING.frightSeconds },
    themeId: "beach",
    kind: "tour",
    blurb: "Neat rectangular beds with paths raked between them. Tidy, and full of dead reckoning.",
  },
  {
    name: "The Long Hedges",
    mazeIdx: 10,
    modifiers: { speedMult: 1, ghostSpeedMult: 1, ghostCount: 3, frightSeconds: TIMING.frightSeconds },
    themeId: "park",
    kind: "tour",
    blurb: "Two long spines down the middle and very few ways across them. Commit to a side.",
  },
  {
    name: "The Allotment",
    mazeIdx: 11,
    modifiers: { speedMult: 1, ghostSpeedMult: 1, ghostCount: 3, frightSeconds: TIMING.frightSeconds },
    themeId: "city",
    kind: "tour",
    blurb: "Small fenced plots, each with its own way in and its own way out. Usually.",
  },
  {
    name: "The Orchard Rows",
    mazeIdx: 12,
    modifiers: { speedMult: 1, ghostSpeedMult: 1, ghostCount: 3, frightSeconds: TIMING.frightSeconds },
    themeId: "garden",
    kind: "tour",
    blurb: "Planted in rows with wide avenues between. You can see a long way — so can they.",
  },
  {
    name: "The Butterfly",
    mazeIdx: 13,
    modifiers: { speedMult: 1, ghostSpeedMult: 1, ghostCount: 3, frightSeconds: TIMING.frightSeconds },
    themeId: "classic",
    kind: "tour",
    blurb: "Two matching wings around a narrow body. Whatever works on the left works on the right.",
  },
  {
    name: "The Greenhouse",
    mazeIdx: 14,
    modifiers: { speedMult: 1, ghostSpeedMult: 1, ghostCount: 3, frightSeconds: TIMING.frightSeconds },
    themeId: "forest",
    kind: "tour",
    blurb: "A pane-by-pane grid of small square rooms. Every junction offers four choices and none of them are obvious.",
  },
  {
    name: "The Terraces",
    mazeIdx: 15,
    modifiers: { speedMult: 1, ghostSpeedMult: 1, ghostCount: 3, frightSeconds: TIMING.frightSeconds },
    themeId: "beach",
    kind: "tour",
    blurb: "Wide horizontal bands stacked up the board, with a handful of ladders between them.",
  },
  {
    name: "The Picket Lines",
    mazeIdx: 16,
    modifiers: { speedMult: 1, ghostSpeedMult: 1, ghostCount: 3, frightSeconds: TIMING.frightSeconds },
    themeId: "park",
    kind: "tour",
    blurb: "Short uprights in rank and file. Simple to read, easy to get pinned against.",
  },
  {
    name: "The Knot Garden",
    mazeIdx: 17,
    modifiers: { speedMult: 1, ghostSpeedMult: 1, ghostCount: 3, frightSeconds: TIMING.frightSeconds },
    themeId: "city",
    kind: "tour",
    blurb: "Concentric rings knotted through each other. The centre is the prize and the trap.",
  },
  {
    name: "The Gravel Paths",
    mazeIdx: 18,
    modifiers: { speedMult: 1, ghostSpeedMult: 1, ghostCount: 3, frightSeconds: TIMING.frightSeconds },
    themeId: "garden",
    kind: "tour",
    blurb: "Loose, forking walks with no long runs anywhere. Nothing here rewards a sprint.",
  },
  {
    name: "The Rose Beds",
    mazeIdx: 19,
    modifiers: { speedMult: 1, ghostSpeedMult: 1, ghostCount: 3, frightSeconds: TIMING.frightSeconds },
    themeId: "classic",
    kind: "tour",
    blurb: "Round beds with a ring path each. Beautiful from above, awkward at ground level.",
  },
  {
    name: "The Cloisters",
    mazeIdx: 20,
    modifiers: { speedMult: 1, ghostSpeedMult: 1, ghostCount: 3, frightSeconds: TIMING.frightSeconds },
    themeId: "forest",
    kind: "tour",
    blurb: "Repeating arched cells around an open middle. Every cell looks the same from inside it.",
  },
  {
    name: "The Comb",
    mazeIdx: 21,
    modifiers: { speedMult: 1, ghostSpeedMult: 1, ghostCount: 3, frightSeconds: TIMING.frightSeconds },
    themeId: "beach",
    kind: "tour",
    blurb: "Vertical teeth with one long spine. Get caught between teeth and there is exactly one way out.",
  },
  {
    name: "The Fountain Court",
    mazeIdx: 22,
    modifiers: { speedMult: 1, ghostSpeedMult: 1, ghostCount: 3, frightSeconds: TIMING.frightSeconds },
    themeId: "park",
    kind: "tour",
    blurb: "A raised centrepiece with walks radiating from it, and the ghost pen right underneath.",
  },
  {
    name: "The Pergola",
    mazeIdx: 23,
    modifiers: { speedMult: 1, ghostSpeedMult: 1, ghostCount: 3, frightSeconds: TIMING.frightSeconds },
    themeId: "city",
    kind: "tour",
    blurb: "Covered walks crossing at right angles. Shade everywhere, cover nowhere.",
  },
  {
    name: "The Ivy Walls",
    mazeIdx: 24,
    modifiers: { speedMult: 1, ghostSpeedMult: 1, ghostCount: 3, frightSeconds: TIMING.frightSeconds },
    themeId: "garden",
    kind: "tour",
    blurb: "Thick walls with narrow slots cut through them. The slots are the whole game.",
  },
  {
    name: "The Walled Garden",
    mazeIdx: 25,
    modifiers: { speedMult: 1, ghostSpeedMult: 1, ghostCount: 3, frightSeconds: TIMING.frightSeconds },
    themeId: "classic",
    kind: "tour",
    blurb: "A hard outer wall, an inner wall, and a small number of gates. Learn the gates.",
  },
  {
    name: "The Lantern Walk",
    mazeIdx: 26,
    modifiers: { speedMult: 1, ghostSpeedMult: 1, ghostCount: 3, frightSeconds: TIMING.frightSeconds },
    themeId: "forest",
    kind: "tour",
    blurb: "A broad central avenue with side paths peeling off it. Fast down the middle, fiddly at the edges.",
  },
  {
    name: "The Vegetable Patch",
    mazeIdx: 27,
    modifiers: { speedMult: 1, ghostSpeedMult: 1, ghostCount: 3, frightSeconds: TIMING.frightSeconds },
    themeId: "beach",
    kind: "tour",
    blurb: "Dense rows with barely a paw's width between them. Turning around is a decision.",
  },
  {
    name: "The Willow Weave",
    mazeIdx: 28,
    modifiers: { speedMult: 1, ghostSpeedMult: 1, ghostCount: 3, frightSeconds: TIMING.frightSeconds },
    themeId: "park",
    kind: "tour",
    blurb: "Paths woven over and under each other. Two junctions that look identical are never the same junction.",
  },
  {
    name: "The Topiary Park",
    mazeIdx: 29,
    modifiers: { speedMult: 1, ghostSpeedMult: 1, ghostCount: 3, frightSeconds: TIMING.frightSeconds },
    themeId: "city",
    kind: "tour",
    blurb: "The last of the thirty: clipped shapes, open lawns, and everything you have learned so far.",
  },

  // ---- Chapter 2: THE TWISTS (levels 31-40) -------------------------------
  // The eight IDEA-013 shipped, byte-for-byte as they were (same names, same
  // mazes, same modifiers) — they are what every challenge score on the board
  // was set on — plus two new ones. They keep their original difficulty arc:
  // speed tiers and extra ghosts ramp up gradually, fright windows shorten once
  // the pace picks up (a full 7s fright at 2x speed would trivialize the
  // ghosts), and L38 stacks every twist at once.
  //
  // Every one of them sets ghostSpeedMult === speedMult (see
  // ChallengeModifiers' own doc comment) so a faster level is uniformly faster
  // for both sides, not a relative buff or nerf to either.
  //
  // Their themeId continues the SAME rotation the tour walks — idx 30 is a
  // multiple of 6, so the twists open on the garden again and run
  // garden/classic/forest/beach/park/city/garden/... through to idx 39. No
  // special case; THEME_CYCLE[idx % 6] holds for all forty.
  {
    // L31: baseline warm-up — literally CLASSIC_MODIFIERS. It opened the
    // original ladder and it opens the twist chapter: after thirty tour levels
    // the player knows the engine cold, so this reads as the calm before the
    // dials start turning rather than as a tutorial.
    name: "Warm-Up Walkies",
    mazeIdx: 0,
    modifiers: { speedMult: 1, ghostSpeedMult: 1, ghostCount: 3, frightSeconds: TIMING.frightSeconds },
    themeId: "garden",
    kind: "twist",
    blurb: "Just a classic lap around the garden — get your paws warmed up.",
  },
  {
    // L32: first twist — pure speed, everything else untouched.
    name: "Squirrel Sprint",
    mazeIdx: 1,
    modifiers: { speedMult: 1.3, ghostSpeedMult: 1.3, ghostCount: 3, frightSeconds: TIMING.frightSeconds },
    themeId: "classic",
    kind: "twist",
    blurb: "Everything's faster! A squirrel darted through and revved the whole yard up.",
  },
  {
    // L33: first extra-ghost twist — speed back to normal so the player can
    // focus on the new fourth ghost in the pack.
    name: "Pack Mentality",
    mazeIdx: 2,
    modifiers: { speedMult: 1, ghostSpeedMult: 1, ghostCount: 4, frightSeconds: TIMING.frightSeconds },
    themeId: "forest",
    kind: "twist",
    blurb: "A fourth ghost joins the chase — the pack just got bigger.",
  },
  {
    // L34: speed + a shortened fright window (first time bones feel risky).
    name: "Short Fuse",
    mazeIdx: 3,
    modifiers: { speedMult: 1.5, ghostSpeedMult: 1.5, ghostCount: 3, frightSeconds: 3 },
    themeId: "beach",
    kind: "twist",
    blurb: "Bones don't last long here — chomp fast, the fright fuse is short.",
  },
  {
    // L35: combine the two twists introduced so far (extra ghost + speed).
    name: "Four on the Floor",
    mazeIdx: 4,
    modifiers: { speedMult: 1.4, ghostSpeedMult: 1.4, ghostCount: 4, frightSeconds: TIMING.frightSeconds },
    themeId: "park",
    kind: "twist",
    blurb: "Four ghosts, no brakes — the whole pack is running hot.",
  },
  {
    // L36: first five-ghost level, paired with a short fright (mirrors L33's
    // "isolate the new twist" pacing — speed is back to normal).
    name: "Full House",
    mazeIdx: 2,
    modifiers: { speedMult: 1, ghostSpeedMult: 1, ghostCount: 5, frightSeconds: 3 },
    themeId: "city",
    kind: "twist",
    blurb: "All five ghosts are home tonight — and the fright window's tight.",
  },
  {
    // L37: heavy speed + four ghosts, full fright window (the fright is the
    // one bit of breathing room left before the finale stacks everything).
    name: "Hound Dash",
    mazeIdx: 3,
    modifiers: { speedMult: 1.8, ghostSpeedMult: 1.8, ghostCount: 4, frightSeconds: TIMING.frightSeconds },
    themeId: "garden",
    kind: "twist",
    blurb: "Full sprint, four ghosts on your tail — this is a proper hound dash.",
  },
  {
    // L38: the original finale — every twist maxed out at once. No longer the
    // last level, but still the top of the "faster and more of them" ramp; the
    // two below it go somewhere else rather than further up the same slope.
    name: "Top Dog",
    mazeIdx: 4,
    modifiers: { speedMult: 2.0, ghostSpeedMult: 2.0, ghostCount: 5, frightSeconds: 3 },
    themeId: "classic",
    kind: "twist",
    blurb: "Double speed, all five ghosts, a fright window that barely blinks. Prove you're top dog.",
  },
  {
    // L39 (IDEA-063, new): the only level in the game that runs BELOW classic
    // pace, and the only one with a fright window LONGER than classic's. Both
    // are directions the original eight never went, which is the point — with
    // three dials and eight levels already spending them on "faster, and more
    // of them", the honest way to add a ninth is to turn one the other way
    // rather than to nudge 2.0 up to 2.1.
    //
    // It is NOT easy, and not a breather in the sense of being free: the speed
    // ratio is untouched (ghostSpeedMult === speedMult, as everywhere), so the
    // ghosts are exactly as dangerous relative to the beagle as they always
    // are, and there are five of them. What changes is that everything takes
    // longer — a wrong turn at 0.7x costs real seconds, and the huge fright
    // window means a bone is a genuine plan rather than a panic button. Placed
    // after Top Dog deliberately: a change of texture before the finale reads
    // as a held breath, where a tenth speed step would just read as more of L38.
    name: "Dream Walk",
    mazeIdx: 13,
    modifiers: { speedMult: 0.7, ghostSpeedMult: 0.7, ghostCount: 5, frightSeconds: 12 },
    themeId: "forest",
    kind: "twist",
    blurb: "Everything slows to a dream. Five ghosts drift after you, and one bone frightens them for an age.",
  },
  {
    // L40 (IDEA-063, new): the new finale, and the fastest the game has ever
    // run. Top Dog's every dial pushed one notch past where it stopped —
    // 2.2x rather than 2.0, and a fright window half of its 3s. Deliberately
    // sited on maze 29, the last board of the grand tour, so finishing the
    // ladder finishes on the last map the tour taught.
    name: "Last Dog Standing",
    mazeIdx: 29,
    modifiers: { speedMult: 2.2, ghostSpeedMult: 2.2, ghostCount: 5, frightSeconds: 1.5 },
    themeId: "beach",
    kind: "twist",
    blurb: "The last board, at a pace nothing else in the game runs. Five ghosts, and a fright that lasts a blink.",
  },
] as const;

/** How many challenge levels exist (40 today). Callers should use this rather
 *  than hardcoding a number, so a future level added/removed here can't
 *  silently desync from profileStore.ts's challengeProgress convention (see its
 *  own doc comment: `challengeProgress === CHALLENGE_LEVEL_COUNT` means "every
 *  level cleared") — or, worse, from the server's `challenge_progress` CHECK
 *  constraint, which is a MIGRATION (see server/migrations/006_*.sql). */
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

/**
 * One band of the level map's trail (IDEA-063).
 *
 * Forty stones on one scrolling trail is roughly 3 700px of scroll, which is a
 * journey rather than a menu — fine to walk down, impossible to navigate. So
 * the trail is broken into CHAPTERS with a banner between them and a row of
 * jump chips in the header (see src/ui/levelMap.ts).
 *
 * The six tour chapters are five levels each, matching classic's own stages
 * (progression.ts's MAPS_PER_STAGE) so the two modes describe the thirty maps
 * with the same vocabulary — "stage 4" means mazes 15-19 in both places. The
 * twists are one chapter of ten.
 *
 * `short` is what the header chip shows; it has to fit a ~34px chip at 390px,
 * so it is a figure and nothing else.
 */
export interface ChallengeChapter {
  /** Index of the chapter's first level in CHALLENGE_LEVELS. */
  from: number;
  /** How many levels it holds. */
  count: number;
  /** Full title, shown on the trail banner and read by screen readers. */
  title: string;
  /** One or two characters for the header jump chip. */
  short: string;
  kind: ChallengeKind;
}

/** The seven chapters, derived from TOUR_LEVEL_COUNT rather than written out,
 *  so adding a maze (and therefore a tour level) cannot leave a stone with no
 *  chapter to live in. The last tour chapter absorbs any remainder if the tour
 *  count ever stops dividing by five. */
export const CHALLENGE_CHAPTERS: readonly ChallengeChapter[] = buildChapters();

function buildChapters(): ChallengeChapter[] {
  const PER_STAGE = 5;
  const out: ChallengeChapter[] = [];
  const stages = Math.ceil(TOUR_LEVEL_COUNT / PER_STAGE);

  for (let s = 0; s < stages; s++) {
    const from = s * PER_STAGE;
    out.push({
      from,
      count: Math.min(PER_STAGE, TOUR_LEVEL_COUNT - from),
      title: `Stage ${s + 1}`,
      short: String(s + 1),
      kind: "tour",
    });
  }

  out.push({
    from: TOUR_LEVEL_COUNT,
    count: CHALLENGE_LEVEL_COUNT - TOUR_LEVEL_COUNT,
    title: "The Twists",
    // Not a figure, because it is not a numbered stage. The level map draws
    // this chip as a STAR GLYPH (see renderChapterRail) rather than as this
    // string — which stays as the text fallback, and as something a non-DOM
    // caller can print.
    short: "T",
    kind: "twist",
  });

  return out;
}

/** Which chapter a level index belongs to. Clamps like getChallengeLevel does
 *  rather than returning undefined, for the same reason: every caller here is
 *  rendering UI from a possibly-stale index. */
export function chapterForLevel(idx: number): ChallengeChapter {
  const safe = Number.isFinite(idx) ? Math.floor(idx) : 0;
  const clamped = Math.max(0, Math.min(safe, CHALLENGE_LEVEL_COUNT - 1));
  for (const ch of CHALLENGE_CHAPTERS) {
    if (clamped < ch.from + ch.count) return ch;
  }
  return CHALLENGE_CHAPTERS[CHALLENGE_CHAPTERS.length - 1];
}

/**
 * IDEA-014 (Challenge Level Map) / IDEA-063 (all 36): player-facing display
 * names for the maze pool, indexed to match MAZES/mazeIdx exactly (mazes.ts) —
 * so `MAZE_NAMES[level.mazeIdx]` is always the right name for a given
 * ChallengeLevel. Pure data, no import of mazes.ts itself (this module already
 * has no dependency on mazes.ts/grid.ts, and doesn't need one just to label
 * indices — the length staying in step with MAZE_COUNT is asserted by
 * scripts/test-cosmetics.ts).
 *
 * Entries 0-29 are the PLAYABLE mazes, and each one is also the name of the
 * tour level that shows it off — a tour level IS its maze, so giving the two
 * different names would be inventing a distinction. Entries 30-35 are the
 * BONUS mazes (progression.ts's BONUS_MAZE_START onward), which no challenge
 * level uses; they are named anyway so nothing that indexes this array by a
 * classic level's resolved mazeIdx can fall off the end.
 *
 * Names 2/3/4 date from IDEA-015's naming pass and are unchanged. Index 1's
 * "Garden Two" placeholder is gone — the board is maze 0 with the bones moved,
 * which is what its name says now.
 */
export const MAZE_NAMES: readonly string[] = [
  "Classic Garden",
  "The Back Garden",
  "The Courtyard",
  "The Warren",
  "The Crossroads",
  "The Potting Shed",
  "The Hedge Spiral",
  "The Kennel Rows",
  "The Trellis",
  "The Flowerbeds",
  "The Long Hedges",
  "The Allotment",
  "The Orchard Rows",
  "The Butterfly",
  "The Greenhouse",
  "The Terraces",
  "The Picket Lines",
  "The Knot Garden",
  "The Gravel Paths",
  "The Rose Beds",
  "The Cloisters",
  "The Comb",
  "The Fountain Court",
  "The Pergola",
  "The Ivy Walls",
  "The Walled Garden",
  "The Lantern Walk",
  "The Vegetable Patch",
  "The Willow Weave",
  "The Topiary Park",
  "The Meadow", // bonus maze 30
  "The Clearing", // bonus maze 31
  "The Open Lawn", // bonus maze 32
  "The Picnic Field", // bonus maze 33
  "The Wildflower Bank", // bonus maze 34
  "The Sunny Paddock", // bonus maze 35
] as const;
