// OWNER: gameplay-engineer (IDEA-026 maze themes — pure theme registry for
// v4.0 "New Territory")
//
// Pure data + in-memory "equipped theme" state for maze themes. Mirrors
// cosmetics.ts's structure exactly (registry / default / getters / in-memory
// equipped state), and keeps the same layering rules: NO `three` import
// (src/render/* owns turning a ThemePalette into materials/lights — see
// board.ts's applyBoardTheme and scene.ts's applySceneTheme) and NO
// localStorage/persistence here either — that's profileStore.ts's job
// (equippedMazeThemeId / ownedMazeThemeIds / buyMazeTheme / equipMazeTheme),
// kept separate so this module stays trivially unit-testable in Node.
//
// A theme re-skins the WORLD (board + atmosphere), never the actors: beagle
// coats are BeagleSkins, enemy forms are EnemySkins, and the pickups (bones,
// fruit, coin, golden bone) keep their fixed identity colors in every theme
// so their gameplay meaning stays instantly readable.

/** Every color/lighting slot a maze theme controls. All colors are hex
 *  numbers (0xRRGGBB) like config.ts's COLORS; intensities/chances are plain
 *  numbers. The slots deliberately mirror where the render layer already has
 *  a tunable — board.ts materials (wall/floor/biscuit + hedge decor) and
 *  scene.ts atmosphere (background, backdrop dome, fog, the three lights) —
 *  so applying a theme is a value swap, never a structural change. */
export interface ThemePalette {
  /** Scene background + fog color (scene.ts reads both from this one slot,
   *  as they must always match for the fog to read as clean depth). */
  bg: number;
  /** Top color of the backdrop sky dome (bottom is always `bg`). */
  backdropTop: number;

  // --- board materials (board.ts) ---
  wall: number;
  wallEmissive: number;
  wallEmissiveIntensity: number;
  floor: number;
  floorEmissive: number;
  floorEmissiveIntensity: number;
  biscuit: number;
  biscuitEmissive: number;
  biscuitEmissiveIntensity: number;

  // --- lights (scene.ts) ---
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  sunColor: number;
  sunIntensity: number;
  rimColor: number;
  rimIntensity: number;

  // --- hedge-top decor (board.ts buildHedgeDecor) ---
  /** Bloom accent colors (1-4 entries). In the garden these are flowers; a
   *  theme is free to re-read them (city: lit windows/neon signs). An empty
   *  array plus bloomChance 0 means a clean, undecorated wall top. */
  bloomColors: readonly number[];
  bloomEmissiveIntensity: number;
  /** Fraction of wall tiles that get a bloom (0 disables decor entirely). */
  bloomChance: number;
  speckColor: number;
  speckEmissive: number;
  /** Of the bloomed tiles, the fraction that also get a speck. */
  speckChance: number;
}

export interface MazeTheme {
  id: string;
  name: string;
  /** Shop price in coins (IDEA-026). 0 means "owned from the start, never
   *  purchasable" — true only for the default garden theme. */
  price: number;
  palette: ThemePalette;
}

export const MAZE_THEMES: readonly MazeTheme[] = [
  {
    id: "garden",
    name: "The Garden",
    // Default theme: free and always owned (see profileStore.ts's
    // defaultProfile()).
    price: 0,
    // The shipped daytime-garden look — every value here MUST match the
    // constants the render layer used before themes existed (config.ts
    // COLORS.bg/wall/wallEmissive/floor/biscuit, board.ts's material
    // emissives + BLOOM_COLORS/LEAF_SPECK_COLOR/chances, scene.ts's
    // backdrop/light rig), so equipping the default theme is a visual no-op
    // and nothing regresses for players who never open the themes tab.
    // Guarded by a regression test in scripts/test-cosmetics.ts.
    palette: {
      bg: 0x9ecbe8,
      backdropTop: 0xcfe9f7,
      wall: 0x3f8f3a,
      wallEmissive: 0x0e2a0e,
      wallEmissiveIntensity: 0.2,
      floor: 0x6b4a2f,
      floorEmissive: 0x2a1a0c,
      floorEmissiveIntensity: 0.3,
      biscuit: 0xf0cf8e,
      biscuitEmissive: 0x6a4a18,
      biscuitEmissiveIntensity: 0.55,
      hemiSky: 0xd8f0ff,
      hemiGround: 0x4a3a20,
      hemiIntensity: 0.65,
      sunColor: 0xfff4e0,
      sunIntensity: 1.1,
      rimColor: 0xaed4f0,
      rimIntensity: 0.35,
      bloomColors: [0xf4efe6, 0xf2d43a, 0xe8709a, 0xd8483f],
      bloomEmissiveIntensity: 0.25,
      bloomChance: 0.2,
      speckColor: 0x8fd15c,
      speckEmissive: 0x1c3a18,
      speckChance: 0.35,
    },
  },
  {
    id: "classic",
    name: "Arcade Night",
    // The v1.0 throwback (Nuno: "the classic one black and blue") — the
    // exact pre-garden palette recovered from git history (bg/wall/
    // wallEmissive/floor from the original config.ts), with the neon-night
    // emissive intensity the hedges had before the daylight retune (0.72)
    // and the cool lavender/indigo light rig the garden pass replaced.
    // No blooms: the classic board is clean neon walls, nothing planted.
    price: 5,
    palette: {
      bg: 0x0b0b16,
      backdropTop: 0x232348,
      wall: 0x2b2b6b,
      wallEmissive: 0x14143a,
      wallEmissiveIntensity: 0.72,
      floor: 0x111120,
      floorEmissive: 0x0a0a18,
      floorEmissiveIntensity: 0.3,
      biscuit: 0xe3b778,
      biscuitEmissive: 0x6a4a18,
      biscuitEmissiveIntensity: 0.7,
      hemiSky: 0x8888c8,
      hemiGround: 0x1a1a2e,
      hemiIntensity: 0.5,
      sunColor: 0xffd9a0,
      sunIntensity: 0.85,
      rimColor: 0x6a7ade,
      rimIntensity: 0.4,
      bloomColors: [],
      bloomEmissiveIntensity: 0,
      bloomChance: 0,
      speckColor: 0x8fd15c,
      speckEmissive: 0x1c3a18,
      speckChance: 0,
    },
  },
  {
    id: "forest",
    name: "Deep Forest",
    // Moodier and denser than the garden: misty sage sky, deep pine walls,
    // dark loam floor, dappled softer sun. Blooms read as forest-floor
    // flora — wood anemone white, bluebell, a red toadstool — with mossy
    // specks, denser than the garden's tidy beds.
    price: 10,
    palette: {
      bg: 0x87a998,
      backdropTop: 0xc8dcc8,
      wall: 0x2e6b34,
      wallEmissive: 0x0a2210,
      wallEmissiveIntensity: 0.25,
      floor: 0x4a3524,
      floorEmissive: 0x1e1408,
      floorEmissiveIntensity: 0.3,
      biscuit: 0xf0cf8e,
      biscuitEmissive: 0x6a4a18,
      biscuitEmissiveIntensity: 0.6,
      hemiSky: 0xbcd8c8,
      hemiGround: 0x2e3a20,
      hemiIntensity: 0.55,
      sunColor: 0xf4e8c8,
      sunIntensity: 0.9,
      rimColor: 0x9ab8a8,
      rimIntensity: 0.35,
      bloomColors: [0xf4efe6, 0x8a9ae0, 0xd8483f],
      bloomEmissiveIntensity: 0.25,
      bloomChance: 0.25,
      speckColor: 0x6a9a4a,
      speckEmissive: 0x16300f,
      speckChance: 0.5,
    },
  },
  {
    id: "beach",
    name: "Sunny Beach",
    // Bright seaside noon: warm sky, sandy dune walls, darker wet-sand floor
    // (kept well below the biscuit tone so the trail stays readable), the
    // brightest sun of any theme. Blooms are shoreline finds — shell white,
    // seafoam, coral — with seagrass specks.
    price: 10,
    palette: {
      bg: 0xa8d8ef,
      backdropTop: 0xd8f0fa,
      wall: 0xd4b078,
      wallEmissive: 0x4a3a18,
      wallEmissiveIntensity: 0.15,
      floor: 0x9a8258,
      floorEmissive: 0x3a2e14,
      floorEmissiveIntensity: 0.25,
      biscuit: 0xf8f0e2,
      biscuitEmissive: 0x6a5a30,
      biscuitEmissiveIntensity: 0.6,
      hemiSky: 0xe8f6ff,
      hemiGround: 0x8a7448,
      hemiIntensity: 0.7,
      sunColor: 0xfff8e8,
      sunIntensity: 1.2,
      rimColor: 0xa8e0e8,
      rimIntensity: 0.35,
      bloomColors: [0xf8f0e2, 0x5fc8c0, 0xf29a8a],
      bloomEmissiveIntensity: 0.25,
      bloomChance: 0.18,
      speckColor: 0x8aa860,
      speckEmissive: 0x2a3a14,
      speckChance: 0.3,
    },
  },
  {
    id: "park",
    name: "City Park",
    // The garden's manicured cousin: same daytime sky family, lighter
    // trimmed-hedge green, gravel-path floor, and noticeably LUSHER
    // flowerbeds (highest bloom density of any theme, plus a purple joining
    // the garden's palette) under a slightly brighter sun.
    price: 10,
    palette: {
      bg: 0x9ecbe8,
      backdropTop: 0xd4ecfa,
      wall: 0x5aa348,
      wallEmissive: 0x143a12,
      wallEmissiveIntensity: 0.2,
      floor: 0x8a7a5e,
      floorEmissive: 0x342c1c,
      floorEmissiveIntensity: 0.28,
      biscuit: 0xf0cf8e,
      biscuitEmissive: 0x6a4a18,
      biscuitEmissiveIntensity: 0.55,
      hemiSky: 0xdcf2ff,
      hemiGround: 0x50452a,
      hemiIntensity: 0.68,
      sunColor: 0xfff6e4,
      sunIntensity: 1.15,
      rimColor: 0xaed4f0,
      rimIntensity: 0.35,
      bloomColors: [0xf2d43a, 0xe8709a, 0xd8483f, 0x8a6ae0],
      bloomEmissiveIntensity: 0.3,
      bloomChance: 0.35,
      speckColor: 0x8fd15c,
      speckEmissive: 0x1c3a18,
      speckChance: 0.4,
    },
  },
  {
    id: "city",
    name: "Night City",
    // Twilight downtown: dusk sky, concrete-block walls with a cool window
    // glow, asphalt floor, biscuits as warm streetlight dots. The "blooms"
    // are rooftop LIGHTS — warm windows, cyan and pink neon — glowing far
    // stronger than any flower, with sparse cool-grey vents as specks.
    price: 10,
    palette: {
      // Identity note (two tuning passes): the first cuts (cool grey walls +
      // blue window emissive under cool moonlight) kept collapsing into
      // "navy" on the board — near-indistinguishable from Arcade Night at a
      // glance. Night City's separation now comes from TEMPERATURE, not just
      // value: a purple-magenta dusk sky and a warm sodium-streetlight sun
      // over warm-grey concrete — no other theme pairs a purple sky with
      // amber light.
      bg: 0x332a52,
      backdropTop: 0x5a4a88,
      wall: 0x7a7480,
      wallEmissive: 0x3a5aaa,
      wallEmissiveIntensity: 0.28,
      floor: 0x3a3640,
      floorEmissive: 0x1c1a20,
      floorEmissiveIntensity: 0.3,
      biscuit: 0xf4d060,
      biscuitEmissive: 0x7a5a10,
      biscuitEmissiveIntensity: 0.75,
      hemiSky: 0x8a7ac8,
      hemiGround: 0x2e2a38,
      hemiIntensity: 0.55,
      sunColor: 0xffc8a0,
      sunIntensity: 0.7,
      rimColor: 0x7a8aff,
      rimIntensity: 0.5,
      bloomColors: [0xf4d060, 0x5fc8e8, 0xe860a8],
      bloomEmissiveIntensity: 0.8,
      bloomChance: 0.22,
      speckColor: 0xaaaacc,
      speckEmissive: 0x3a3a4a,
      speckChance: 0.15,
    },
  },
] as const;

export const DEFAULT_MAZE_THEME_ID = "garden";

/** Returns a maze theme's shop price, 0 for the default/unknown id. Never
 *  throws — mirrors getMazeTheme's fallback-to-default behaviour. */
export function getMazeThemePrice(id: string): number {
  return getMazeTheme(id).price;
}

/** Looks up a theme by id. Never throws — an unknown/stale id (e.g. read
 *  back from storage after a theme was renamed/removed) degrades to the
 *  default theme instead of breaking rendering. */
export function getMazeTheme(id: string): MazeTheme {
  return MAZE_THEMES.find((t) => t.id === id) ?? getDefaultMazeTheme();
}

function getDefaultMazeTheme(): MazeTheme {
  // MAZE_THEMES is a non-empty readonly const above, and its first entry is
  // DEFAULT_MAZE_THEME_ID by construction, but look it up by id rather than
  // index so the two can never silently drift apart (same guard shape as
  // cosmetics.ts's getDefaultBeagleSkin).
  const found = MAZE_THEMES.find((t) => t.id === DEFAULT_MAZE_THEME_ID);
  if (!found) {
    throw new Error("themes: DEFAULT_MAZE_THEME_ID has no matching entry in MAZE_THEMES");
  }
  return found;
}

// ---------------------------------------------------------------------------
// In-memory equipped state. Module-level, not persisted here — see
// src/game/profileStore.ts for the localStorage bridge (initProfileFromStorage
// reads it in; equipMazeTheme there is the persisting wrapper UI code calls).

let equippedMazeThemeId: string = DEFAULT_MAZE_THEME_ID;

export function getEquippedMazeThemeId(): string {
  return equippedMazeThemeId;
}

/** Sets the equipped theme id, in memory only (no persistence — see
 *  `equipMazeTheme` in profileStore.ts for the persisting wrapper). Ignores
 *  unknown ids (clamps to the default) so callers can never leave the module
 *  in a state where getEquippedMazeTheme() would need to guess. */
export function setEquippedMazeThemeId(id: string): void {
  equippedMazeThemeId = MAZE_THEMES.some((t) => t.id === id) ? id : DEFAULT_MAZE_THEME_ID;
}

export function getEquippedMazeTheme(): MazeTheme {
  return getMazeTheme(getEquippedMazeThemeId());
}
