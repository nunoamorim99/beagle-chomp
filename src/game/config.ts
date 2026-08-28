// Central tunables. Keep gameplay numbers here so they're easy to balance.
export const SPEEDS = {
  beagle: 5.2,
  ghost: 4.6,
  frightened: 3.0,
  eaten: 9.0,
} as const;

export const SCORE = {
  biscuit: 10,
  bone: 50,
  ghostBase: 200,   // doubles per ghost eaten within one fright window
} as const;
// NOTE: fruit is deliberately NOT here — since IDEA-045 there is no single
// fruit value. See FRUITS below.

export const TIMING = {
  frightSeconds: 7,
  readySeconds: 1.6,
  deathSeconds: 1.3,
  // global scatter/chase schedule (seconds); last entry is "chase forever"
  schedule: [7, 20, 7, 20, 5, 1e9],
} as const;

export const START_LIVES = 3;

// IDEA-045: the fruit basket. There used to be one fruit worth a flat
// SCORE.fruit (100); there are now five, and which one turns up is a weighted
// roll (see rollFruit in src/game/fruits.ts) rather than a fixed rotation.
//
// The point of the ladder is that a Mango is worth FIVE biscuit-runs and shows
// up about one spawn in twenty, so seeing one is a reason to change what you
// were about to do — cut across the maze for it instead of finishing the
// corridor you're in. An Apple is not: it's the common case, and at 100 it is
// worth exactly what the single old fruit was, so the floor of the feature is
// the game people already know.
//
// WEIGHTS ARE RELATIVE, not percentages — rollFruit sums them itself, so a
// sixth fruit can be added here without rebalancing the other five. They
// happen to total 100 today, which makes them readable as percentages, and
// scripts/test-fruits.ts asserts the distribution rather than the total.
//
// The SERVER prices these too (see server/src/validation/plausibility.ts): the
// score ceiling uses the largest value here and the floor the smallest, so
// changing a number in this table WITHOUT running `npm run sync` in server/
// starts rejecting honest runs. That is what npm run test:catalog fails on.
export const FRUITS = [
  { id: "apple", label: "Apple", points: 100, weight: 40 },
  { id: "banana", label: "Banana", points: 200, weight: 25 },
  { id: "carrot", label: "Carrot", points: 300, weight: 18 },
  { id: "strawberry", label: "Strawberry", points: 400, weight: 12 },
  { id: "mango", label: "Mango", points: 500, weight: 5 },
] as const;

export type FruitId = (typeof FRUITS)[number]["id"];
export type Fruit = (typeof FRUITS)[number];

// IDEA-045: pellets-eaten thresholds at which a fruit appears — FOUR per level
// now, up from the two (70/140) that lived in game.ts as a module-local const
// since v1.0. Moved here because the value table above is here, and because
// the server's sync step reads both out of this one file.
//
// Four rather than two because five tiers need enough rolls to be READABLE: at
// two spawns a level, a 5%-weight Mango is a once-every-ten-maps event and the
// ladder never registers as a ladder. At four it lands often enough to be a
// thing players talk about, without fruit becoming ambient.
//
// Spaced 40 apart across a ~179-pellet map, and offset from every other gate
// the same way those are offset from each other — COIN_THRESHOLDS is
// 20/60/105/150 and LIFE_THRESHOLDS is 130, so no two pickups can ever fire on
// the same eaten-pellet tick. scripts/test-fruits.ts pins that.
export const FRUIT_THRESHOLDS = [40, 80, 120, 160] as const;

// IDEA-016/IDEA-017: coin currency (v2.0 shop wallet).
export const COINS = {
  // IDEA-016: every 1000 points earned in a run banks 1 coin (persisted
  // immediately — see coinsDueFromScore in src/game/coins.ts).
  perPoints: 1000,
  // IDEA-017: a maze coin pickup grants this many coins directly (no points).
  pickupValue: 1,
  // IDEA-017 follow-up: the maze coin auto-despawns if not grabbed in time —
  // a "grab it quick" bonus rather than a permanent fixture like the fruit.
  // Set to 18s: long enough that a coin appearing somewhere random on the map
  // is actually reachable before it vanishes (9s was too short — a coin could
  // spawn across the maze and expire before the player ever got near it), while
  // still clearing well before the next coin/fruit so they don't pile up.
  lifespanSeconds: 18,
} as const;

// IDEA-017 follow-up: pellets-eaten thresholds at which a bonus coin appears
// in the maze — 4 per level, starting EARLY so the player reliably encounters
// coins (across a ~179-pellet map; see LevelAssets.startPelletCount). Chosen
// as 20 / 60 / 105 / 150:
//   - First coin at just 20 pellets in, so one shows up soon after the level
//     starts rather than a third of the way through (the old 45 was too deep —
//     players finished a level or two without ever seeing one).
//   - Spaced ~40-45 pellets apart, comfortably more than the 18s lifespan
//     takes to expire at normal eating pace, so a prior coin has despawned (or
//     been grabbed) before the next threshold — maybeSpawnCoin's
//     `if (this.level.board.coin) return` guard never blocks a later spawn.
//   - Offset from FRUIT_THRESHOLDS (40/80/120/160) so a coin and a fruit
//     never appear on the exact same tick.
export const COIN_THRESHOLDS = [20, 60, 105, 150] as const;

// IDEA-018: bonus lives — same "earn a scarce resource" shape as COINS above,
// but for per-run lives instead of the persisted wallet. Three triggers all
// funnel through Game.grantLife(): a maze pickup (a golden bone, mirroring
// the coin/fruit pickups), a points milestone (mirrors COINS.perPoints via
// the same coinsDueFromScore helper — the math is identical, just a
// different divisor and a different in-memory counter), and a "perfect
// fright" (eating all 3 ghosts within one fright window).
export const LIVES = {
  // Lives are capped — unlike coins, which can accumulate without bound, a
  // run with unlimited extra lives would trivialize difficulty. 5 leaves
  // meaningful headroom above START_LIVES (3) without being effectively
  // infinite.
  max: 5,
  // Every 5000 points of cumulative run score grants 1 life (mirrors
  // COINS.perPoints's shape exactly, just a coarser divisor — lives should be
  // rarer than coins since they're a much stronger reward).
  milestonePoints: 5000,
  // The golden-bone pickup auto-despawns if not grabbed in time, same
  // "grab it quick" urgency as the maze coin (COINS.lifespanSeconds).
  pickupLifespanSeconds: 18,
} as const;

// IDEA-018: pellets-eaten threshold for the maze life pickup — ONE golden
// bone per level (rarer than coins by design: bonus lives are a stronger
// reward than bonus currency). 130 is deliberately offset from both
// COIN_THRESHOLDS (20/60/105/150) and FRUIT_THRESHOLDS (40/80/120/160) so nothing
// collides on the same eaten-pellet tick, and late enough (comfortably past
// every coin/fruit threshold) that it reads as a rarer, later-game bonus
// rather than competing with the earlier pickups for attention. Every
// validated maze has 179+ pellets (see mazes.json), so 130 is always
// reachable with room to spare before the level clears.
export const LIFE_THRESHOLDS = [130] as const;

// Palette (hex) — shared by renderer and UI
// Bright daytime garden (IDEA-008): soft sky, hedge-green walls, warm soil
// floor. Everything else in render/* reads these values, so a future theme
// system (IDEA-012) can swap the palette without touching this shape.
export const COLORS = {
  bg: 0x9ecbe8,
  wall: 0x3f8f3a,
  wallEmissive: 0x0e2a0e,
  floor: 0x6b4a2f,
  // The rebuilt model's coat (IDEA-024 v2). Warmer and lighter than the
  // original: a toon ramp quantises lighting into three hard bands, so a
  // coat tuned under smooth PBR falloff goes muddy in the lower band. The
  // white is a warm OFF-white on purpose — pure white blows out to a flat
  // silhouette in the top band and takes the muzzle's modelling with it.
  beagleTan: 0xd6934f,
  beagleWhite: 0xf0efec,
  // Actually BLACK. This was 0x4a2a1e, a dark brown, which on the nose (a
  // 5 cm sphere) passed for black but over the whole saddle plainly did not —
  // and a tricolour beagle's saddle and nose are the same true black. Not
  // 0x000000: the toon ramp's lowest band multiplies by ~0.27, so pure black
  // gives a shadow side with no information in it at all. This keeps just
  // enough warmth to hold the form.
  beagleBlack: 0x1b1815,
  biscuit: 0xf0cf8e,
  ghostRose: 0xe0577a,
  ghostTeal: 0x53c7c0,
  ghostAmber: 0xe8a23d,
  // IDEA-013 (Challenge Mode): two more team colors for the 4th/5th ghost
  // slots that only spawn when a challenge level's ghostCount is 4 or 5 —
  // never used in classic (GHOST_DEFS.slice(0, 3) there). Chosen to sit
  // comfortably in the same tasteful, garden-fitting palette as rose/teal/
  // amber (bright, saturated, but not neon) while staying visually distinct
  // from all three at a glance: a violet (cool, between the rose and teal in
  // hue) and a leaf-green (echoes the hedge-green wall color family without
  // matching it exactly, so a ghost never camouflages against a wall).
  ghostViolet: 0x9b6bd6,
  ghostLeaf: 0x6fb84a,
  frightened: 0x2537c8,
} as const;
