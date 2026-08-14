// GENERATED FILE — DO NOT EDIT.
// Produced by server/scripts/sync-game-constants.ts from src/game/cosmetics.ts
// and src/game/themes.ts. Run `npm run sync` in server/ to regenerate.
//
// The server needs ids and PRICES so that POST /api/v1/profile/purchase can
// charge from its own copy rather than trusting a client-supplied price.
// scripts/test-catalog.ts fails if this drifts from the game source.

export interface CatalogItem {
  readonly id: string;
  readonly price: number;
}

export const BEAGLE_SKINS: readonly CatalogItem[] = [
  { id: "bagel", price: 0 },
  { id: "cookie", price: 5 },
  { id: "muffin", price: 5 },
  { id: "pepper", price: 5 },
];

export const ENEMY_SKINS: readonly CatalogItem[] = [
  { id: "ghost", price: 0 },
  { id: "beetle", price: 5 },
  { id: "bee", price: 5 },
  { id: "ladybug", price: 5 },
];

export const MAZE_THEMES: readonly CatalogItem[] = [
  { id: "garden", price: 0 },
  { id: "classic", price: 5 },
  { id: "forest", price: 10 },
  { id: "beach", price: 10 },
  { id: "park", price: 10 },
  { id: "city", price: 10 },
];

export const DEFAULT_BEAGLE_SKIN_ID = "bagel";
export const DEFAULT_ENEMY_SKIN_ID = "ghost";
export const DEFAULT_MAZE_THEME_ID = "garden";

/** Challenge level count — the upper bound on users.challenge_progress.
 *  The sentinel value itself (== this number) means "all levels cleared". */
export const CHALLENGE_LEVEL_COUNT = 8;

// ---------------------------------------------------------------------------
// Scoring + timing constants, mirrored from src/game/config.ts (and
// FRUIT_THRESHOLDS from game.ts). The plausibility validator scores every
// submitted run against these, so they MUST track the game: if the game
// rebalances and the server doesn't, honest runs start getting rejected.

export const SCORING = {
  biscuit: 10,
  bone: 50,
  fruit: 100,
  ghostBase: 200,
  /** Tiles per second at speedMult 1. */
  beagleSpeed: 5.2,
  readySeconds: 1.6,
  deathSeconds: 1.3,
  startLives: 3,
  coinsPerPoints: 1000,
  coinPickupValue: 1,
  livesMilestonePoints: 5000,
} as const;

/** Pellet-eaten counts at which a coin / bonus-life bone / fruit spawns. Each
 *  fires at most ONCE per level (see pickups.ts's shouldFireThreshold), so the
 *  array LENGTH is the per-level cap on each pickup. */
export const COIN_THRESHOLDS = [20,60,105,150] as const;
export const LIFE_THRESHOLDS = [130] as const;
export const FRUIT_THRESHOLDS = [70,140] as const;

/** What each maze actually CONTAINS, derived from mazes.json rather than
 *  hand-copied. These are the hard ceilings the validator rests on: a run
 *  cannot eat more pellets than exist. */
export interface MazeFacts {
  readonly biscuits: number;
  readonly bones: number;
  readonly fruitTiles: number;
}

export const MAZE_FACTS: readonly MazeFacts[] = [
  { biscuits: 175, bones: 4, fruitTiles: 2 },
  { biscuits: 175, bones: 4, fruitTiles: 2 },
  { biscuits: 200, bones: 4, fruitTiles: 2 },
  { biscuits: 198, bones: 4, fruitTiles: 2 },
  { biscuits: 176, bones: 4, fruitTiles: 2 },
];

export const MAZE_COUNT = MAZE_FACTS.length;

/** Per-level challenge modifiers. A challenge run's ghost count and speed
 *  change BOTH the score ceiling and the minimum time, so the validator needs
 *  them to judge a challenge submission at all. */
export interface ChallengeLevelFacts {
  readonly mazeIdx: number;
  readonly speedMult: number;
  readonly ghostCount: number;
  readonly frightSeconds: number;
}

export const CHALLENGE_LEVELS: readonly ChallengeLevelFacts[] = [
  { mazeIdx: 0, speedMult: 1, ghostCount: 3, frightSeconds: 7 },
  { mazeIdx: 1, speedMult: 1.3, ghostCount: 3, frightSeconds: 7 },
  { mazeIdx: 2, speedMult: 1, ghostCount: 4, frightSeconds: 7 },
  { mazeIdx: 3, speedMult: 1.5, ghostCount: 3, frightSeconds: 3 },
  { mazeIdx: 4, speedMult: 1.4, ghostCount: 4, frightSeconds: 7 },
  { mazeIdx: 2, speedMult: 1, ghostCount: 5, frightSeconds: 3 },
  { mazeIdx: 3, speedMult: 1.8, ghostCount: 4, frightSeconds: 7 },
  { mazeIdx: 4, speedMult: 2, ghostCount: 5, frightSeconds: 3 },
];

/** Classic mode's baseline — the explicit modifiers game.ts uses for a classic
 *  run (CLASSIC_MODIFIERS in challenges.ts). */
export const CLASSIC_MODIFIERS: ChallengeLevelFacts = {
  mazeIdx: -1,
  speedMult: 1,
  ghostCount: 3,
  frightSeconds: 7,
};
