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

/** IDEA-030: one explicit prop placement on the board's apron ring. Replaces
 *  IDEA-026's density-scatter — every prop now sits at a HAND-CHOSEN spot the
 *  editor lets you place, move, and save (Nuno: "select the place, choose the
 *  props, adjust the position and save"). `propId` references a reusable
 *  definition in the prop library (src/game/props.ts); `tile` is an apron
 *  tile coord (worldX/worldZ map it), `offset` is a fine ±tile nudge within
 *  it, `rotationY` in radians, `scale` a per-placement multiplier on top of
 *  the def's own height/width. Props stay OUTSIDE the maze (apron only — the
 *  editor only offers apron tiles), and the render layer still applies the
 *  per-side height cap so a placement can't tower between the camera and the
 *  play area. */
export interface PropPlacement {
  propId: string;
  tile: readonly [number, number];
  offset: readonly [number, number];
  rotationY: number;
  scale: number;
}

/** IDEA-031: one wall-top component placement. Same shape as PropPlacement
 *  (references a library prop by id — blooms, lamps, transit signals…) but
 *  sits on a WALL tile's top rather than an apron floor tile: `tile` is a
 *  wall ('#') tile coord, and the render layer seats the component at wall
 *  height. Supersedes IDEA-011's density blooms with explicit per-tile
 *  choice — the editor lets you pick which walls carry what (Nuno: "add
 *  components in the place of the blooms... choose on the maze wall where to
 *  place it"). */
export interface WallDecorPlacement {
  propId: string;
  tile: readonly [number, number];
  rotationY: number;
  scale: number;
}

export interface MazeTheme {
  id: string;
  name: string;
  /** Shop price in coins (IDEA-026). 0 means "owned from the start, never
   *  purchasable" — true only for the default garden theme. */
  price: number;
  palette: ThemePalette;
  /** IDEA-030: explicit apron prop placements (was IDEA-026's `props`
   *  density populations). Empty = a bare apron (classic). Each references a
   *  library prop ([[props.ts]]) by id. */
  placements: readonly PropPlacement[];
  /** IDEA-031: explicit wall-top component placements (generalizes IDEA-011's
   *  density blooms — the palette still carries bloom COLORS as a fallback for
   *  themes that keep the classic scattered garden look via bloomChance, but a
   *  theme may instead hand-place lamps/signals/blooms per wall tile here).
   *  Empty = fall back to the palette's density blooms. */
  wallDecor: readonly WallDecorPlacement[];
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
    placements: [
      { propId: "shrub", tile: [19, 4], offset: [-0.24, -0.162], rotationY: 5.691, scale: 0.949 },
      { propId: "shrub", tile: [7, -1], offset: [0.184, -0.163], rotationY: 6.188, scale: 1.074 },
      { propId: "shrub", tile: [0, -1], offset: [-0.22, -0.111], rotationY: 1.294, scale: 0.962 },
      { propId: "shrub", tile: [14, 21], offset: [0.143, 0.131], rotationY: 2.155, scale: 1.132 },
      { propId: "shrub", tile: [15, 21], offset: [-0.176, 0.148], rotationY: 3.487, scale: 1.163 },
      { propId: "shrub", tile: [5, -1], offset: [0.217, 0.075], rotationY: 5.538, scale: 0.911 },
      { propId: "shrub", tile: [19, 6], offset: [-0.007, -0.091], rotationY: 2.731, scale: 0.81 },
      { propId: "shrub", tile: [11, -1], offset: [-0.037, -0.143], rotationY: 6.276, scale: 1.021 },
      { propId: "shrub", tile: [4, -1], offset: [-0.065, 0.152], rotationY: 5.757, scale: 1.083 },
      { propId: "shrub", tile: [8, -1], offset: [0.144, -0.125], rotationY: 4.636, scale: 1.206 },
      { propId: "shrub", tile: [10, -1], offset: [-0.17, 0.032], rotationY: 3.87, scale: 1.111 },
      { propId: "shrub", tile: [9, -1], offset: [-0.236, -0.048], rotationY: 3.852, scale: 1.068 },
      { propId: "shrub", tile: [-1, -1], offset: [-0.152, 0.121], rotationY: 0.948, scale: 1.004 },
      { propId: "shrub", tile: [1, -1], offset: [-0.038, -0.119], rotationY: 0.911, scale: 1.128 },
      { propId: "shrub", tile: [-1, 15], offset: [-0.182, 0.25], rotationY: 5.075, scale: 0.931 },
      { propId: "shrub", tile: [11, 21], offset: [0.107, -0.13], rotationY: 3.967, scale: 1.124 },
      { propId: "shrub", tile: [19, 5], offset: [-0.242, 0.123], rotationY: 0.269, scale: 0.975 },
      { propId: "shrub", tile: [19, 11], offset: [0.132, 0.154], rotationY: 3.038, scale: 1.132 },
      { propId: "shrub", tile: [-1, 16], offset: [0.121, -0.157], rotationY: 2.239, scale: 0.855 },
      { propId: "shrub", tile: [17, -1], offset: [-0.035, 0.01], rotationY: 2.977, scale: 1.164 },
      { propId: "shrub", tile: [18, -1], offset: [-0.185, 0.249], rotationY: 5.882, scale: 0.928 },
      { propId: "shrub", tile: [19, 7], offset: [0.026, -0.144], rotationY: 0.013, scale: 1.069 },
      { propId: "shrub", tile: [19, 16], offset: [-0.036, -0.164], rotationY: 4.991, scale: 0.906 },
      { propId: "oak", tile: [-1, 17], offset: [-0.114, -0.047], rotationY: 4.742, scale: 1.149 },
      { propId: "oak", tile: [19, 1], offset: [-0.066, 0.227], rotationY: 3.638, scale: 0.981 },
      { propId: "oak", tile: [-1, 2], offset: [-0.218, 0.056], rotationY: 2.902, scale: 1.056 },
      { propId: "oak", tile: [19, 2], offset: [0.178, -0.196], rotationY: 4.689, scale: 1.092 },
      { propId: "oak", tile: [-1, 3], offset: [-0.001, 0.245], rotationY: 1.083, scale: 1.068 },
      { propId: "oak", tile: [19, 3], offset: [-0.131, 0.085], rotationY: 4.418, scale: 1.097 },
    ],
    wallDecor: [],
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
    },    // Deliberately propless: the v1.0 throwback is a clean neon board in a
    // black void — anything planted around it would break the retro read.
    placements: [],
    wallDecor: [],
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
    placements: [
      { propId: "pine", tile: [19, 4], offset: [-0.24, -0.162], rotationY: 5.691, scale: 1 },
      { propId: "pine", tile: [7, -1], offset: [0.184, -0.163], rotationY: 6.188, scale: 1.296 },
      { propId: "pine", tile: [0, -1], offset: [-0.22, -0.111], rotationY: 1.294, scale: 1.133 },
      { propId: "pine", tile: [5, -1], offset: [0.217, 0.075], rotationY: 5.538, scale: 1.06 },
      { propId: "pine", tile: [19, 6], offset: [-0.007, -0.091], rotationY: 2.731, scale: 0.914 },
      { propId: "pine", tile: [11, -1], offset: [-0.037, -0.143], rotationY: 6.276, scale: 1.219 },
      { propId: "pine", tile: [4, -1], offset: [-0.065, 0.152], rotationY: 5.757, scale: 1.309 },
      { propId: "pine", tile: [8, -1], offset: [0.144, -0.125], rotationY: 4.636, scale: 1.487 },
      { propId: "pine", tile: [10, -1], offset: [-0.17, 0.032], rotationY: 3.87, scale: 1.349 },
      { propId: "pine", tile: [9, -1], offset: [-0.236, -0.048], rotationY: 3.852, scale: 1.287 },
      { propId: "pine", tile: [-1, -1], offset: [-0.152, 0.121], rotationY: 0.948, scale: 1.195 },
      { propId: "pine", tile: [1, -1], offset: [-0.038, -0.119], rotationY: 0.911, scale: 1.374 },
      { propId: "pine", tile: [-1, 15], offset: [-0.182, 0.25], rotationY: 5.075, scale: 1 },
      { propId: "pine", tile: [19, 5], offset: [-0.242, 0.123], rotationY: 0.269, scale: 1 },
      { propId: "pine", tile: [19, 11], offset: [0.132, 0.154], rotationY: 3.038, scale: 1 },
      { propId: "pine", tile: [-1, 16], offset: [0.121, -0.157], rotationY: 2.239, scale: 0.98 },
      { propId: "pine", tile: [17, -1], offset: [-0.035, 0.01], rotationY: 2.977, scale: 1.426 },
      { propId: "pine", tile: [18, -1], offset: [-0.185, 0.249], rotationY: 5.882, scale: 1.085 },
      { propId: "pine", tile: [19, 7], offset: [0.026, -0.144], rotationY: 0.013, scale: 1 },
      { propId: "pine", tile: [19, 16], offset: [-0.036, -0.164], rotationY: 4.991, scale: 1 },
      { propId: "pine", tile: [-1, 17], offset: [-0.114, -0.047], rotationY: 4.742, scale: 1 },
      { propId: "pine", tile: [19, 1], offset: [-0.066, 0.227], rotationY: 3.638, scale: 1 },
      { propId: "pine", tile: [-1, 2], offset: [-0.218, 0.056], rotationY: 2.902, scale: 1 },
      { propId: "pine", tile: [19, 2], offset: [0.178, -0.196], rotationY: 4.689, scale: 1 },
      { propId: "pine", tile: [-1, 3], offset: [-0.001, 0.245], rotationY: 1.083, scale: 1 },
      { propId: "pine", tile: [19, 3], offset: [-0.131, 0.085], rotationY: 4.418, scale: 1 },
      { propId: "pine", tile: [3, -1], offset: [0.198, 0.017], rotationY: 4.434, scale: 1.07 },
      { propId: "pine", tile: [19, 15], offset: [-0.17, -0.128], rotationY: 5.99, scale: 1 },
      { propId: "pine", tile: [14, -1], offset: [0.063, -0.094], rotationY: 5.201, scale: 1.518 },
      { propId: "pine", tile: [-1, 5], offset: [0.095, 0.224], rotationY: 2.701, scale: 1 },
      { propId: "pine", tile: [2, -1], offset: [-0.073, -0.126], rotationY: 2.816, scale: 0.96 },
      { propId: "pine", tile: [19, -1], offset: [-0.227, 0.089], rotationY: 1.579, scale: 1.166 },
      { propId: "pine", tile: [-1, 7], offset: [0.197, -0.04], rotationY: 2.341, scale: 1 },
      { propId: "pine", tile: [15, -1], offset: [0.029, 0.202], rotationY: 3.5, scale: 1.286 },
      { propId: "pine", tile: [19, 14], offset: [0.017, -0.132], rotationY: 4.627, scale: 1 },
      { propId: "pine", tile: [-1, 11], offset: [-0.183, 0.008], rotationY: 0.287, scale: 1 },
      { propId: "pine", tile: [-1, 12], offset: [0.02, -0.024], rotationY: 1.648, scale: 1 },
      { propId: "pine", tile: [-1, 1], offset: [0.088, -0.241], rotationY: 0.581, scale: 1 },
      { propId: "pine", tile: [-1, 13], offset: [-0.186, -0.206], rotationY: 6.08, scale: 1 },
      { propId: "shrub", tile: [19, 12], offset: [-0.134, 0.002], rotationY: 1.942, scale: 0.977 },
    ],
    wallDecor: [],
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
    placements: [
      { propId: "umbrella", tile: [19, 4], offset: [-0.24, -0.162], rotationY: 5.691, scale: 1 },
      { propId: "umbrella", tile: [7, -1], offset: [0.184, -0.163], rotationY: 6.188, scale: 1.083 },
      { propId: "umbrella", tile: [0, -1], offset: [-0.22, -0.111], rotationY: 1.294, scale: 1.008 },
      { propId: "umbrella", tile: [5, -1], offset: [0.217, 0.075], rotationY: 5.538, scale: 0.974 },
      { propId: "umbrella", tile: [19, 6], offset: [-0.007, -0.091], rotationY: 2.731, scale: 0.906 },
      { propId: "umbrella", tile: [11, -1], offset: [-0.037, -0.143], rotationY: 6.276, scale: 1.047 },
      { propId: "umbrella", tile: [4, -1], offset: [-0.065, 0.152], rotationY: 5.757, scale: 1.089 },
      { propId: "umbrella", tile: [8, -1], offset: [0.144, -0.125], rotationY: 4.636, scale: 1.171 },
      { propId: "umbrella", tile: [10, -1], offset: [-0.17, 0.032], rotationY: 3.87, scale: 1.107 },
      { propId: "umbrella", tile: [9, -1], offset: [-0.236, -0.048], rotationY: 3.852, scale: 1.079 },
      { propId: "umbrella", tile: [-1, -1], offset: [-0.152, 0.121], rotationY: 0.948, scale: 1.036 },
      { propId: "umbrella", tile: [1, -1], offset: [-0.038, -0.119], rotationY: 0.911, scale: 1.119 },
      { propId: "palm", tile: [-1, 15], offset: [-0.182, 0.25], rotationY: 5.075, scale: 1 },
      { propId: "palm", tile: [19, 5], offset: [-0.242, 0.123], rotationY: 0.269, scale: 1 },
      { propId: "palm", tile: [19, 11], offset: [0.132, 0.154], rotationY: 3.038, scale: 1 },
      { propId: "palm", tile: [-1, 16], offset: [0.121, -0.157], rotationY: 2.239, scale: 0.955 },
      { propId: "palm", tile: [17, -1], offset: [-0.035, 0.01], rotationY: 2.977, scale: 1.264 },
      { propId: "palm", tile: [18, -1], offset: [-0.185, 0.249], rotationY: 5.882, scale: 1.028 },
      { propId: "palm", tile: [19, 7], offset: [0.026, -0.144], rotationY: 0.013, scale: 1 },
      { propId: "palm", tile: [19, 16], offset: [-0.036, -0.164], rotationY: 4.991, scale: 1 },
      { propId: "palm", tile: [-1, 17], offset: [-0.114, -0.047], rotationY: 4.742, scale: 1 },
      { propId: "palm", tile: [19, 1], offset: [-0.066, 0.227], rotationY: 3.638, scale: 1 },
      { propId: "palm", tile: [-1, 2], offset: [-0.218, 0.056], rotationY: 2.902, scale: 1 },
    ],
    wallDecor: [],
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
    placements: [
      { propId: "oak", tile: [19, 4], offset: [-0.24, -0.162], rotationY: 5.691, scale: 1.033 },
      { propId: "oak", tile: [7, -1], offset: [0.184, -0.163], rotationY: 6.188, scale: 1.143 },
      { propId: "oak", tile: [0, -1], offset: [-0.22, -0.111], rotationY: 1.294, scale: 1.044 },
      { propId: "oak", tile: [5, -1], offset: [0.217, 0.075], rotationY: 5.538, scale: 0.999 },
      { propId: "oak", tile: [19, 6], offset: [-0.007, -0.091], rotationY: 2.731, scale: 0.908 },
      { propId: "oak", tile: [11, -1], offset: [-0.037, -0.143], rotationY: 6.276, scale: 1.096 },
      { propId: "oak", tile: [4, -1], offset: [-0.065, 0.152], rotationY: 5.757, scale: 1.152 },
      { propId: "oak", tile: [8, -1], offset: [0.144, -0.125], rotationY: 4.636, scale: 1.261 },
      { propId: "oak", tile: [10, -1], offset: [-0.17, 0.032], rotationY: 3.87, scale: 1.176 },
      { propId: "oak", tile: [9, -1], offset: [-0.236, -0.048], rotationY: 3.852, scale: 1.138 },
      { propId: "oak", tile: [-1, -1], offset: [-0.152, 0.121], rotationY: 0.948, scale: 1.081 },
      { propId: "oak", tile: [1, -1], offset: [-0.038, -0.119], rotationY: 0.911, scale: 1.192 },
      { propId: "oak", tile: [-1, 15], offset: [-0.182, 0.25], rotationY: 5.075, scale: 1.017 },
      { propId: "oak", tile: [19, 5], offset: [-0.242, 0.123], rotationY: 0.269, scale: 1.055 },
      { propId: "oak", tile: [19, 11], offset: [0.132, 0.154], rotationY: 3.038, scale: 1.195 },
      { propId: "oak", tile: [-1, 16], offset: [0.121, -0.157], rotationY: 2.239, scale: 0.949 },
      { propId: "oak", tile: [17, -1], offset: [-0.035, 0.01], rotationY: 2.977, scale: 1.224 },
      { propId: "shrub", tile: [18, -1], offset: [-0.185, 0.249], rotationY: 5.882, scale: 0.864 },
      { propId: "shrub", tile: [19, 7], offset: [0.026, -0.144], rotationY: 0.013, scale: 0.989 },
      { propId: "shrub", tile: [19, 16], offset: [-0.036, -0.164], rotationY: 4.991, scale: 0.844 },
      { propId: "shrub", tile: [-1, 17], offset: [-0.114, -0.047], rotationY: 4.742, scale: 1.148 },
      { propId: "shrub", tile: [18, 21], offset: [0.051, -0.062], rotationY: 0.902, scale: 1.092 },
      { propId: "shrub", tile: [19, 1], offset: [-0.066, 0.227], rotationY: 3.638, scale: 0.879 },
      { propId: "shrub", tile: [-1, 2], offset: [-0.218, 0.056], rotationY: 2.902, scale: 1 },
      { propId: "shrub", tile: [19, 2], offset: [0.178, -0.196], rotationY: 4.689, scale: 1.057 },
      { propId: "shrub", tile: [-1, 3], offset: [-0.001, 0.245], rotationY: 1.083, scale: 1.018 },
      { propId: "shrub", tile: [19, 3], offset: [-0.131, 0.085], rotationY: 4.418, scale: 1.065 },
      { propId: "shrub", tile: [3, -1], offset: [0.198, 0.017], rotationY: 4.434, scale: 0.854 },
      { propId: "shrub", tile: [19, 15], offset: [-0.17, -0.128], rotationY: 5.99, scale: 0.962 },
      { propId: "shrub", tile: [14, -1], offset: [0.063, -0.094], rotationY: 5.201, scale: 1.13 },
      { propId: "shrub", tile: [-1, 5], offset: [0.095, 0.224], rotationY: 2.701, scale: 0.834 },
      { propId: "streetlight", tile: [2, -1], offset: [-0.073, -0.126], rotationY: 2.816, scale: 0.964 },
      { propId: "streetlight", tile: [19, -1], offset: [-0.227, 0.089], rotationY: 1.579, scale: 1.011 },
      { propId: "streetlight", tile: [-1, 7], offset: [0.197, -0.04], rotationY: 2.341, scale: 1.076 },
      { propId: "streetlight", tile: [15, -1], offset: [0.029, 0.202], rotationY: 3.5, scale: 1.039 },
      { propId: "streetlight", tile: [19, 14], offset: [0.017, -0.132], rotationY: 4.627, scale: 1.028 },
      { propId: "streetlight", tile: [-1, 11], offset: [-0.183, 0.008], rotationY: 0.287, scale: 1.049 },
      { propId: "streetlight", tile: [-1, 12], offset: [0.02, -0.024], rotationY: 1.648, scale: 1.043 },
      { propId: "streetlight", tile: [-1, 1], offset: [0.088, -0.241], rotationY: 0.581, scale: 1.09 },
      { propId: "streetlight", tile: [-1, 13], offset: [-0.186, -0.206], rotationY: 6.08, scale: 1.062 },
    ],
    wallDecor: [],
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
    placements: [
      { propId: "tower", tile: [19, 4], offset: [-0.24, -0.162], rotationY: 5.691, scale: 1 },
      { propId: "tower", tile: [7, -1], offset: [0.184, -0.163], rotationY: 6.188, scale: 1.307 },
      { propId: "tower", tile: [0, -1], offset: [-0.22, -0.111], rotationY: 1.294, scale: 1.119 },
      { propId: "tower", tile: [5, -1], offset: [0.217, 0.075], rotationY: 5.538, scale: 1.035 },
      { propId: "tower", tile: [19, 6], offset: [-0.007, -0.091], rotationY: 2.731, scale: 0.866 },
      { propId: "tower", tile: [11, -1], offset: [-0.037, -0.143], rotationY: 6.276, scale: 1.218 },
      { propId: "tower", tile: [4, -1], offset: [-0.065, 0.152], rotationY: 5.757, scale: 1.322 },
      { propId: "tower", tile: [8, -1], offset: [0.144, -0.125], rotationY: 4.636, scale: 1.527 },
      { propId: "tower", tile: [10, -1], offset: [-0.17, 0.032], rotationY: 3.87, scale: 1.368 },
      { propId: "tower", tile: [9, -1], offset: [-0.236, -0.048], rotationY: 3.852, scale: 1.296 },
      { propId: "tower", tile: [-1, -1], offset: [-0.152, 0.121], rotationY: 0.948, scale: 1.19 },
      { propId: "tower", tile: [1, -1], offset: [-0.038, -0.119], rotationY: 0.911, scale: 1.397 },
      { propId: "tower", tile: [-1, 15], offset: [-0.182, 0.25], rotationY: 5.075, scale: 1 },
      { propId: "tower", tile: [19, 5], offset: [-0.242, 0.123], rotationY: 0.269, scale: 1 },
      { propId: "tower", tile: [19, 11], offset: [0.132, 0.154], rotationY: 3.038, scale: 1 },
      { propId: "tower", tile: [-1, 16], offset: [0.121, -0.157], rotationY: 2.239, scale: 0.942 },
      { propId: "tower", tile: [17, -1], offset: [-0.035, 0.01], rotationY: 2.977, scale: 1.457 },
      { propId: "tower", tile: [18, -1], offset: [-0.185, 0.249], rotationY: 5.882, scale: 1.064 },
      { propId: "tower", tile: [19, 7], offset: [0.026, -0.144], rotationY: 0.013, scale: 1 },
      { propId: "tower", tile: [19, 16], offset: [-0.036, -0.164], rotationY: 4.991, scale: 1 },
      { propId: "tower", tile: [-1, 17], offset: [-0.114, -0.047], rotationY: 4.742, scale: 1 },
      { propId: "tower", tile: [19, 1], offset: [-0.066, 0.227], rotationY: 3.638, scale: 1 },
      { propId: "tower", tile: [-1, 2], offset: [-0.218, 0.056], rotationY: 2.902, scale: 1 },
      { propId: "tower", tile: [19, 2], offset: [0.178, -0.196], rotationY: 4.689, scale: 1 },
      { propId: "tower", tile: [-1, 3], offset: [-0.001, 0.245], rotationY: 1.083, scale: 1 },
      { propId: "tower", tile: [19, 3], offset: [-0.131, 0.085], rotationY: 4.418, scale: 1 },
      { propId: "tower", tile: [3, -1], offset: [0.198, 0.017], rotationY: 4.434, scale: 1.046 },
      { propId: "tower", tile: [19, 15], offset: [-0.17, -0.128], rotationY: 5.99, scale: 1 },
      { propId: "tower", tile: [14, -1], offset: [0.063, -0.094], rotationY: 5.201, scale: 1.563 },
      { propId: "tower", tile: [-1, 5], offset: [0.095, 0.224], rotationY: 2.701, scale: 1 },
      { propId: "streetlight", tile: [2, -1], offset: [-0.073, -0.126], rotationY: 2.816, scale: 0.969 },
      { propId: "streetlight", tile: [19, -1], offset: [-0.227, 0.089], rotationY: 1.579, scale: 1.032 },
      { propId: "streetlight", tile: [-1, 7], offset: [0.197, -0.04], rotationY: 2.341, scale: 1.118 },
      { propId: "streetlight", tile: [15, -1], offset: [0.029, 0.202], rotationY: 3.5, scale: 1.069 },
      { propId: "streetlight", tile: [19, 14], offset: [0.017, -0.132], rotationY: 4.627, scale: 1.054 },
      { propId: "streetlight", tile: [-1, 11], offset: [-0.183, 0.008], rotationY: 0.287, scale: 1.082 },
      { propId: "streetlight", tile: [-1, 12], offset: [0.02, -0.024], rotationY: 1.648, scale: 1.074 },
      { propId: "streetlight", tile: [-1, 1], offset: [0.088, -0.241], rotationY: 0.581, scale: 1.137 },
      { propId: "streetlight", tile: [-1, 13], offset: [-0.186, -0.206], rotationY: 6.08, scale: 1.1 },
      { propId: "streetlight", tile: [19, 12], offset: [-0.134, 0.002], rotationY: 1.942, scale: 1.089 },
    ],
    wallDecor: [
      { propId: "lamp-post", tile: [3, 3], rotationY: 0, scale: 1 },
      { propId: "transit-sign", tile: [15, 3], rotationY: 1.571, scale: 1 },
      { propId: "lamp-post", tile: [9, 9], rotationY: 0, scale: 1 },
      { propId: "transit-sign", tile: [3, 15], rotationY: 0, scale: 1 },
      { propId: "lamp-post", tile: [15, 15], rotationY: 0, scale: 1 },
    ],
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
