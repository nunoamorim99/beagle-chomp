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
