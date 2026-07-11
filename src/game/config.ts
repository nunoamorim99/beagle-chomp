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
  fruit: 100,
  ghostBase: 200,   // doubles per ghost eaten within one fright window
} as const;

export const TIMING = {
  frightSeconds: 7,
  readySeconds: 1.6,
  deathSeconds: 1.3,
  // global scatter/chase schedule (seconds); last entry is "chase forever"
  schedule: [7, 20, 7, 20, 5, 1e9],
} as const;

export const START_LIVES = 3;

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
//   - Offset from FRUIT_THRESHOLDS (70/140) so a coin and a fruit essentially
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
// COIN_THRESHOLDS (20/60/105/150) and FRUIT_THRESHOLDS (70/140) so nothing
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
  beagleTan: 0xc98a3c,
  beagleWhite: 0xf4efe6,
  beagleBlack: 0x2a2320,
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
