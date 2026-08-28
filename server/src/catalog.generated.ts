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
  { id: "cookie", price: 25 },
  { id: "muffin", price: 25 },
  { id: "pacbeagle", price: 50 },
  { id: "pepper", price: 25 },
];

export const ENEMY_SKINS: readonly CatalogItem[] = [
  { id: "beetle", price: 0 },
  { id: "bee", price: 25 },
  { id: "ladybug", price: 25 },
  { id: "ghost", price: 0 },
];

export const MAZE_THEMES: readonly CatalogItem[] = [
  { id: "garden", price: 0 },
  { id: "classic", price: 50 },
  { id: "forest", price: 50 },
  { id: "beach", price: 50 },
  { id: "park", price: 50 },
  { id: "city", price: 50 },
];

export const DEFAULT_BEAGLE_SKIN_ID = "bagel";
export const DEFAULT_ENEMY_SKIN_ID = "beetle";
export const DEFAULT_MAZE_THEME_ID = "garden";

/** Challenge level count — the upper bound on users.challenge_progress.
 *  The sentinel value itself (== this number) means "all levels cleared". */
export const CHALLENGE_LEVEL_COUNT = 8;

// ---------------------------------------------------------------------------
// Scoring + timing constants, mirrored from src/game/config.ts (and
// FRUIT_THRESHOLDS and FRUITS from config.ts). The plausibility validator scores every
// submitted run against these, so they MUST track the game: if the game
// rebalances and the server doesn't, honest runs start getting rejected.

export const SCORING = {
  biscuit: 10,
  bone: 50,
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
export const FRUIT_THRESHOLDS = [40,80,120,160] as const;

/** IDEA-045: every fruit value the game can pay out, in FRUITS order.
 *  MAX_FRUIT_POINTS sizes the score ceiling, MIN_FRUIT_POINTS the floor. */
export const FRUIT_VALUES = [100,200,300,400,500] as const;
export const MAX_FRUIT_POINTS = 500;
export const MIN_FRUIT_POINTS = 100;

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
  { biscuits: 187, bones: 4, fruitTiles: 2 },
  { biscuits: 183, bones: 4, fruitTiles: 2 },
  { biscuits: 189, bones: 4, fruitTiles: 2 },
  { biscuits: 186, bones: 4, fruitTiles: 2 },
  { biscuits: 190, bones: 4, fruitTiles: 2 },
  { biscuits: 191, bones: 4, fruitTiles: 2 },
  { biscuits: 190, bones: 4, fruitTiles: 2 },
  { biscuits: 193, bones: 4, fruitTiles: 2 },
  { biscuits: 190, bones: 4, fruitTiles: 2 },
  { biscuits: 186, bones: 4, fruitTiles: 2 },
  { biscuits: 262, bones: 0, fruitTiles: 2 },
  { biscuits: 270, bones: 0, fruitTiles: 2 },
  { biscuits: 248, bones: 0, fruitTiles: 2 },
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

// --- classic progression (IDEA-040) ------------------------------------------
//
// Mirrors src/game/progression.ts. The constants below are EXTRACTED from that
// file by the sync script, and scripts/test-catalog.ts asserts planLevel() here
// agrees with the game's planLevel() on every level of the first four laps.
//
// The validator needs this because a level's score ceiling depends on how many
// ghosts it had: a 4-ghost stage-3 level can legitimately yield far more points
// than a 3-ghost one. Sizing every level at 3 would reject honest runs.

export const MAPS_PER_STAGE = 5;
export const STAGE_COUNT = 3;
export const LEVELS_PER_LAP = 18;
export const MAPS_PER_LAP = 15;
export const BONUS_MAZE_START = 15;
export const GHOSTS_STAGE_1_2 = 3;
export const GHOSTS_STAGE_3 = 4;
export const GHOSTS_BONUS_FIRST_LAP = 1;
export const GHOSTS_BONUS_LATER_LAPS = 2;

export interface LevelPlan {
  readonly mazeIdx: number;
  readonly ghostCount: number;
  readonly isBonus: boolean;
  readonly mapNumber: number | null;
  readonly lap: number;
  readonly stage: number;
}

export function planLevel(levelIdx: number): LevelPlan {
  const safeIdx = Number.isFinite(levelIdx) && levelIdx > 0 ? Math.floor(levelIdx) : 0;

  const lap = Math.floor(safeIdx / LEVELS_PER_LAP) + 1;
  const withinLap = safeIdx % LEVELS_PER_LAP;

  const stageIdx = Math.floor(withinLap / (MAPS_PER_STAGE + 1));
  const withinStage = withinLap % (MAPS_PER_STAGE + 1);
  const isBonus = withinStage === MAPS_PER_STAGE;

  if (isBonus) {
    return {
      mazeIdx: BONUS_MAZE_START + stageIdx,
      ghostCount: lap === 1 ? GHOSTS_BONUS_FIRST_LAP : GHOSTS_BONUS_LATER_LAPS,
      isBonus: true,
      mapNumber: null,
      lap,
      stage: stageIdx + 1,
    };
  }

  const mapIdx = stageIdx * MAPS_PER_STAGE + withinStage;

  return {
    mazeIdx: mapIdx,
    ghostCount: lap > 1 || stageIdx === STAGE_COUNT - 1 ? GHOSTS_STAGE_3 : GHOSTS_STAGE_1_2,
    isBonus: false,
    mapNumber: mapIdx + 1,
    lap,
    stage: stageIdx + 1,
  };
}
