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
  // IDEA-016 v2: there is NO points-to-coins conversion any more.
  //
  // Every 1000 points used to bank a coin on top of the maze pickups, and by
  // v7.0 that made the shop trivial — a decent run bought an item outright, so
  // nothing in it was ever a decision. Coins are now earned ONE way: by going
  // and getting the coins that appear in the maze. That makes them a thing you
  // detour for, which is what a currency has to be.
  //
  // Removing it here is only half: the SERVER is the authority on coins (it
  // recomputes the award from the accepted run and the client's local balance
  // is reconciled to whatever it returns), so plausibility.ts had to stop
  // adding the milestone term at the same time or the mechanic would have kept
  // running from the other side.
  //
  // IDEA-017: a maze coin pickup grants this many coins directly (no points).
  // This is now the ONLY source. If earning turns out too slow at 5 pickups a
  // level, THIS is the number to raise — not a reinstated milestone.
  pickupValue: 1,
  // IDEA-017 follow-up: the maze coin auto-despawns if not grabbed in time —
  // a "grab it quick" bonus rather than a permanent fixture like the fruit.
  // Set to 18s: long enough that a coin appearing somewhere random on the map
  // is actually reachable before it vanishes (9s was too short — a coin could
  // spawn across the maze and expire before the player ever got near it), while
  // still clearing well before the next coin/fruit so they don't pile up.
  lifespanSeconds: 18,
} as const;

// IDEA-017 follow-up: pellets-eaten thresholds at which a bonus coin appears —
// FIVE per level (was four at 20/60/105/150), spaced ~35 pellets apart across a
// ~179-pellet map.
//
// The original four were chosen to start EARLY, because players were finishing
// whole levels without seeing one. That reasoning still holds; this is the same
// argument applied once more after live play (2026-08-28), alongside the
// power-ups going to four. First coin at 15 so one shows up almost immediately.
//
// The whole pickup schedule is now interleaved, and NOTHING may share a tick
// with anything else — coins 15/55/90/125/155, power-ups 30/70/105/145, fruit
// 40/80/120/160, the golden bone 130. scripts/test-fruits.ts and
// scripts/test-powerups.ts both check that against the real lists rather than a
// copy of them, so a future retune of any one list fails loudly instead of
// quietly racing two spawns into the same frame.
//
// One consequence worth knowing: at ~35 pellets apart these are now closer
// together than COINS.lifespanSeconds (18s) takes to expire, so an ungrabbed
// coin can still be on the board when the next threshold arrives. That does not
// lose the spawn — maybeSpawnCoin's board-occupied guard sits BEFORE the
// threshold check, so the threshold simply waits rather than being consumed.
export const COIN_THRESHOLDS = [15, 55, 90, 125, 155] as const;

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
  // Every 10000 points of cumulative run score grants 1 life. This is the ONE
  // points-milestone left in the game (IDEA-016 v2 removed the coins one), and
  // it is deliberately coarse: at 5000 a decent run banked the LIVES.max cap
  // before the difficulty had a chance to bite, so the milestone stopped being
  // a reward and became a floor. Doubling it keeps the extra life something a
  // long run earns rather than something every run collects.
  milestonePoints: 10000,
  // The golden-bone pickup auto-despawns if not grabbed in time, same
  // "grab it quick" urgency as the maze coin (COINS.lifespanSeconds).
  pickupLifespanSeconds: 18,
} as const;

// IDEA-018: pellets-eaten threshold for the maze life pickup — ONE golden
// bone per level (rarer than coins by design: bonus lives are a stronger
// reward than bonus currency). 130 is deliberately offset from both
// COIN_THRESHOLDS (15/55/90/125/155) and FRUIT_THRESHOLDS (40/80/120/160) so nothing
// collides on the same eaten-pellet tick, and late enough (comfortably past
// every coin/fruit threshold) that it reads as a rarer, later-game bonus
// rather than competing with the earlier pickups for attention. Every
// validated maze has 179+ pellets (see mazes.json), so 130 is always
// reachable with room to spare before the level clears.
export const LIFE_THRESHOLDS = [130] as const;

// IDEA-046: POWER-UPS.
//
// Five pickups that change how the run plays rather than adding to the score.
// The table below is the whole design; powerups.ts owns the state machine and
// game.ts only reads the multipliers off it.
//
// What makes these different from every pickup before them is that they EXPIRE
// THREE DIFFERENT WAYS, which is the thing to get right:
//
//   "timed"      — a countdown. Loud, brief, and gone.
//   "untilDeath" — held until an enemy actually kills you, and SURVIVES
//                  clearing the map. This is the one that changes how a run
//                  feels: a doubler carried through three maps is a run you
//                  are protecting, not just a bonus you collected.
//   "untilHit"   — spent by the next contact, which it converts from a death
//                  into a bounce.
//
// Nuno's rule, and the reason those last two are separate kinds: "when the user
// has power-up 1 and 2 and 5 but gets caught, they only lose the 5 and keep the
// others until they die." A shielded hit is therefore NOT a death — it consumes
// the shield and the doublers live on. scripts/test-powerups.ts pins exactly
// that sentence, because it is the difference between a shield being a real
// decision and being a one-hit reprieve nobody notices.
//
// THE WEIGHTS ARE A FUNCTION OF LIFETIME, which is Nuno's rule from live play
// and reads backwards until you see it:
//
//   timed (26 each)      — the anchor and the star are gone in seconds, so a
//                          spawn is the ONLY way to ever have one. They should
//                          be the most common thing on the table.
//   shield (20)          — neutral.
//   doublers (14 each)   — you keep these until you die, possibly for several
//                          maps. A player who has one does not need another,
//                          and a duplicate spawn of one you already hold is a
//                          literal no-op (collect() refreshes a timer that is
//                          zero). Weighting them heavily spends spawns on
//                          nothing.
//
// The first cut had this exactly inverted (doublers 26/22, star 16, shield 14)
// and the symptom was immediate: two doublers in one map, and the star and
// anchor unseen across a whole session.
//
// CLASSIC ONLY. Challenge levels are deliberately pure dial-twists on the same
// engine (see challenges.ts), and letting power-ups in would make every
// challenge score already on the board incomparable. The server enforces it:
// a challenge run reporting any power-up is rejected outright.
export const POWERUPS = [
  {
    id: "doubleBiscuit",
    label: "Double biscuits",
    kind: "untilDeath",
    seconds: 0,
    weight: 14,
  },
  {
    id: "doubleGhost",
    label: "Double enemies",
    kind: "untilDeath",
    seconds: 0,
    weight: 14,
  },
  {
    // 8s at 0.6x. Long enough to actually spend — crossing the map takes a few
    // seconds — without being long enough to clear a whole level under.
    id: "slowGhosts",
    label: "Slow enemies",
    kind: "timed",
    seconds: 8,
    weight: 26,
  },
  {
    // Deliberately the same length as a bone's fright window (TIMING.frightSeconds)
    // rather than a number of its own: this IS a fright window, with the beagle
    // sped up on top, so two different durations would just be a second thing to
    // keep in sync for no gain.
    //
    // It was a glowing BONE at first, for exactly that reason — same effect,
    // so make it look like a charged version of the thing that already causes
    // it. In play that was the flaw: the maze is full of bones, so the one
    // pickup that should stop you in your tracks was the one that looked most
    // like scenery. It is a star now (Nuno's call, and the Mario reference he
    // reached for in the first place).
    id: "star",
    label: "Star",
    kind: "timed",
    seconds: TIMING.frightSeconds,
    weight: 26,
  },
  {
    // NEUTRAL weight, between the timed pair and the doublers. It was the
    // rarest at first, on the reasoning that it is the strongest thing here —
    // and in play that made it something a player might never meet at all,
    // which is worse than it being slightly too available.
    id: "shield",
    label: "Shield",
    kind: "untilHit",
    seconds: 0,
    weight: 20,
  },
] as const;

export type PowerupId = (typeof POWERUPS)[number]["id"];
export type PowerupKind = (typeof POWERUPS)[number]["kind"];
export type Powerup = (typeof POWERUPS)[number];

/** How much the two doublers double by. Named rather than inlined as `2` so a
 *  future "triple" is a number here and not a hunt through game.ts. */
export const POWERUP_MULTIPLIER = 2;

/** Enemy speed while the anchor is up. 0.6 is a big, obvious change — a subtle
 *  slow reads as lag rather than as a power-up you earned. */
export const POWERUP_SLOW_MULT = 0.6;

/** Beagle speed while the star is up. Deliberately modest next to the 0.6
 *  above: the star already frightens the whole pack, and stacking a large speed
 *  boost on top makes the beagle overshoot turns, which reads as losing control
 *  rather than gaining power. */
export const POWERUP_STAR_SPEED_MULT = 1.25;

// IDEA-046: pellets-eaten thresholds at which a power-up appears — FOUR per
// level, roughly one per quarter of the map.
//
// This has moved twice, and the reason is the same both times. It shipped at
// two (55/145), deliberately conservative — a power-up changes the rules for a
// while, and it seemed safer to be told it was stingy. Nuno played it: "only
// two looks a few". At three he played again and had still never seen the star
// or the anchor, while seeing both doublers twice in one map.
//
// That second report is the interesting one, because it is not really about the
// count. Each spawn is an INDEPENDENT weighted roll, so with only a handful of
// rolls per map the rarer entries genuinely may not appear for several maps
// running, and duplicates are common — which Nuno likes ("that is the kind of
// situation that makes you think"), so the independence stays. Four rolls a map
// is what makes the long tail actually show up.
//
// Still fewer than the coins (5) and level with the fruit (4): a power-up
// should be an event, just not one you can miss for three maps.
export const POWERUP_THRESHOLDS = [30, 70, 105, 145] as const;

/**
 * How long the beagle is untouchable after a shield absorbs a hit.
 *
 * WITHOUT THIS THE SHIELD IS A TRAP, and it shipped that way. Absorbing a hit
 * left the beagle still inside COLLISION_RADIUS of the ghost that hit it, so
 * checkCollisions ran again on the very next frame with no shield left and
 * killed the player anyway — spending the shield AND the life AND every other
 * power-up held. The head-on case is the worst: the ghost reverses into the
 * beagle's own direction of travel, and the beagle is FASTER than a ghost
 * (5.2 vs 4.6), so it closes on it and stays in contact rather than escaping.
 *
 * 1.5s is about seven tiles of ghost movement — enough to actually get out,
 * which is what "a second chance" has to mean to be worth crossing a maze for.
 */
export const POWERUP_SHIELD_GRACE_SECONDS = 1.5;

/** The power-up despawns if not grabbed, like the coin and the golden bone.
 *  Same 18s: long enough that one spawning across the map is still reachable,
 *  short enough that it clears before the next threshold. */
export const POWERUP_LIFESPAN_SECONDS = 18;

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
