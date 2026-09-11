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
import { type WallTextureKind } from "../render/wallTexture";
import { type FloorTextureKind } from "../render/floorTexture";
import { type FenceKind } from "../render/fence";
import { type GroundDetailKind } from "../render/groundDetail";


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
  /**
   * Which procedural SURFACE the walls wear (src/render/wallTexture.ts).
   *
   * A theme's concept was only ever carried by its colours, so a hedge maze, a
   * beach and a night city were the same moulded box in three tints. This is
   * the slot that lets a theme say what its walls are MADE of.
   *
   * The texture is luminance-only and multiplies `wall` below, so it carves
   * relief into the theme's colour rather than replacing it — changing this
   * never changes a theme's hue.
   */
  wallTexture: WallTextureKind;
  wallEmissive: number;
  wallEmissiveIntensity: number;
  /**
   * IDEA-060: the railing that stands in FRONT of the wall, if the theme has
   * one (src/render/fence.ts).
   *
   * This is the one board surface that is geometry rather than a texture, and
   * it has to be: a picket fence is a row of separate uprights with daylight
   * between them, and daylight between things is the one thing a map cannot
   * draw. A wall is also a single box wearing one material on all six sides,
   * so a fence painted into `wallTexture` would appear on the wall's TOP.
   *
   * "none" costs nothing at all — no geometry, no instanced mesh, no draw.
   */
  fence: FenceKind;
  /** Fence timber colour. Read only when `fence` is not "none". */
  fenceColor: number;
  /**
   * IDEA-060 v2: loose dressing scattered ON the ground
   * (src/render/groundDetail.ts) — the second board surface that is geometry
   * rather than a texture.
   *
   * The garden's stepping stones were painted into `floorTexture` first, and
   * that took three separate concessions to keep them from competing with the
   * biscuit trail, every one of them a constraint of PAINTING a floor rather
   * than of the stones. As meshes they separate on FORM instead — silhouette,
   * lit top, shaded side, contact shadow — and the floor goes back to grass.
   */
  groundDetail: GroundDetailKind;
  /** Stone colour. Read only when `groundDetail` is not "none". */
  groundDetailColor: number;
  floor: number;
  /**
   * Which procedural GROUND the floor wears (src/render/floorTexture.ts).
   *
   * Unlike the wall surface, several of these are painted FROM THE MAZE GRID —
   * a garden path, a park's gravel walk and a road's lane markings all follow
   * the corridors rather than tiling uniformly.
   */
  floorTexture: FloorTextureKind;
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
  /** One line for the shop — see cosmetics.ts's BeagleSkin.blurb. */
  blurb: string;
  /**
   * IDEA-064: hidden from the shop until the player has earned the right to
   * see it. Mirrors EnemySkin.secret exactly, including the rule that
   * ownership is still the real gate — this only controls LISTING, so a secret
   * theme somebody already bought stays visible to them.
   *
   * Only Arcade Night carries it, and it is revealed by the same purchase that
   * reveals the Ghost: the two tributes to the arcade game this one descends
   * from are unlocked together, by the coat that is a tribute to it.
   */
  secret?: boolean;
  /** Shop price in coins (IDEA-026). 0 means "owned from the start, never
   *  purchasable" — the default garden theme, and (IDEA-064) Arcade Night,
   *  which is not bought at all but GRANTED by the Pac-Beagle coat. */
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
    blurb: "Hedges and lawn · a bright afternoon",
    price: 0,
    palette: {
      bg: 0x9ecbe8,
      backdropTop: 0xcfe9f7,
      wall: 0x3f8f3a,
      wallTexture: "hedgeFlower",
      wallEmissive: 0x0e2a0e,
      wallEmissiveIntensity: 0.2,
      fence: "picket",
      fenceColor: 0xa9743f,
      groundDetail: "rocks",
      groundDetailColor: 0x9c9a90,
      floor: 0x6b4a2f,
      floorTexture: "lawn",
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
      { propId: "treehouse", tile: [-1, -1], offset: [-0.18, -0.2], rotationY: 0.42, scale: 1 },
      { propId: "garden-shrub", tile: [19, 4], offset: [-0.24, -0.162], rotationY: 5.691, scale: 0.949 },
      { propId: "garden-shrub", tile: [7, -1], offset: [0.184, -0.163], rotationY: 6.188, scale: 1.074 },
      { propId: "garden-shrub", tile: [0, -1], offset: [-0.22, -0.111], rotationY: 1.294, scale: 0.962 },
      { propId: "garden-shrub", tile: [14, 21], offset: [0.143, 0.131], rotationY: 2.155, scale: 1.132 },
      { propId: "garden-shrub", tile: [15, 21], offset: [-0.176, 0.148], rotationY: 3.487, scale: 1.163 },
      { propId: "garden-shrub", tile: [5, -1], offset: [0.217, 0.075], rotationY: 5.538, scale: 0.911 },
      { propId: "garden-shrub", tile: [19, 6], offset: [-0.007, -0.091], rotationY: 2.731, scale: 0.81 },
      { propId: "garden-shrub", tile: [11, -1], offset: [-0.037, -0.143], rotationY: 6.276, scale: 1.021 },
      { propId: "garden-shrub", tile: [4, -1], offset: [-0.065, 0.152], rotationY: 5.757, scale: 1.083 },
      { propId: "garden-shrub", tile: [8, -1], offset: [0.144, -0.125], rotationY: 4.636, scale: 1.206 },
      { propId: "garden-shrub", tile: [10, -1], offset: [-0.17, 0.032], rotationY: 3.87, scale: 1.111 },
      { propId: "garden-shrub", tile: [9, -1], offset: [-0.236, -0.048], rotationY: 3.852, scale: 1.068 },
      { propId: "garden-shrub", tile: [-1, -1], offset: [-0.152, 0.121], rotationY: 0.948, scale: 1.004 },
      { propId: "garden-shrub", tile: [1, -1], offset: [-0.038, -0.119], rotationY: 0.911, scale: 1.128 },
      { propId: "garden-shrub", tile: [-1, 15], offset: [-0.182, 0.25], rotationY: 5.075, scale: 0.931 },
      { propId: "garden-shrub", tile: [11, 21], offset: [0.107, -0.13], rotationY: 3.967, scale: 1.124 },
      { propId: "garden-shrub", tile: [19, 5], offset: [-0.242, 0.123], rotationY: 0.269, scale: 0.975 },
      { propId: "garden-shrub", tile: [19, 11], offset: [0.132, 0.154], rotationY: 3.038, scale: 1.132 },
      { propId: "garden-shrub", tile: [-1, 16], offset: [0.121, -0.157], rotationY: 2.239, scale: 0.855 },
      { propId: "garden-shrub", tile: [17, -1], offset: [-0.035, 0.01], rotationY: 2.977, scale: 1.164 },
      { propId: "garden-shrub", tile: [18, -1], offset: [-0.185, 0.249], rotationY: 5.882, scale: 0.928 },
      { propId: "garden-shrub", tile: [19, 7], offset: [0.026, -0.144], rotationY: 0.013, scale: 1.069 },
      { propId: "garden-shrub", tile: [19, 16], offset: [-0.036, -0.164], rotationY: 4.991, scale: 0.906 },
      { propId: "garden-tree", tile: [-1, 17], offset: [-0.114, -0.047], rotationY: 4.742, scale: 1.149 },
      { propId: "garden-tree", tile: [19, 1], offset: [-0.066, 0.227], rotationY: 3.638, scale: 0.981 },
      { propId: "garden-tree", tile: [-1, 2], offset: [-0.218, 0.056], rotationY: 2.902, scale: 1.056 },
      { propId: "garden-tree", tile: [19, 2], offset: [0.178, -0.196], rotationY: 4.689, scale: 1.092 },
      { propId: "garden-tree", tile: [-1, 3], offset: [-0.001, 0.245], rotationY: 1.083, scale: 1.068 },
      { propId: "garden-tree", tile: [19, 3], offset: [-0.131, 0.085], rotationY: 4.418, scale: 1.097 },
      { propId: "treehouse", tile: [19, -1], offset: [0, 0], rotationY: 5.807363914339822, scale: 1 },
    ],
    // IDEA-060 v3: BIRDHOUSES ONLY — the 29 flower props that used to stand up
    // here went when the wall itself became a flowering hedge. It must not
    // become EMPTY: that would switch the palette's density blooms back on.
    // See board.ts's buildWallTopDecor. (Notes here do not survive a save from
    // the board editor; the durable copy is there and in test-garden-props.ts.)
    wallDecor: [
      { propId: "birdhouse", tile: [2, 2], rotationY: 2.628, scale: 0.62 },
      { propId: "birdhouse", tile: [2, 6], rotationY: 6.132, scale: 0.62 },
      { propId: "birdhouse", tile: [8, 10], rotationY: 4.406, scale: 0.62 },
      { propId: "birdhouse", tile: [0, 15], rotationY: 3.208, scale: 0.62 },
      { propId: "birdhouse", tile: [3, 20], rotationY: 0.088, scale: 0.62 },
    ],
  },


  {
    id: "classic",
    name: "Arcade Night",
    blurb: "Neon walls on black · the classic look",
    // The v1.0 throwback (Nuno: "the classic one black and blue") — the
    // exact pre-garden palette recovered from git history (bg/wall/
    // wallEmissive/floor from the original config.ts), with the neon-night
    // emissive intensity the hedges had before the daylight retune (0.72)
    // and the cool lavender/indigo light rig the garden pass replaced.
    // No blooms: the classic board is clean neon walls, nothing planted.
    //
    // IDEA-064: no longer a 50-coin theme on the shelf. It is the Pac-Beagle's
    // other half — the arcade coat unlocks the arcade enemy and the arcade
    // BOARD, and a tribute you can assemble by buying its three pieces
    // separately is not much of a tribute. Free and secret, granted by
    // profileStore.buyBeagleSkin exactly the way the Ghost is, which needs no
    // special purchase path: price 0 means the ordinary buy always succeeds and
    // the server's own catalog agrees with it.
    //
    // Anyone who already paid 50 for it keeps it and keeps seeing it —
    // visibleMazeThemes lists a secret theme the player owns.
    secret: true,
    price: 0,
    palette: {
      bg: 0x0b0b16,
      backdropTop: 0x232348,
      wall: 0x2b2b6b,
      wallTexture: "flat",
      wallEmissive: 0x14143a,
      wallEmissiveIntensity: 0.72,
      fence: "none",
      fenceColor: 0xa9743f,
      groundDetail: "none",
      groundDetailColor: 0x9c9a90,
      floor: 0x111120,
      floorTexture: "flat",
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
    blurb: "Deep pines and leaf litter · low light",
    // Moodier and denser than the garden: misty sage sky, deep pine walls,
    // dark loam floor, dappled softer sun. Blooms read as forest-floor
    // flora — wood anemone white, bluebell, a red toadstool — with mossy
    // specks, denser than the garden's tidy beds.
    price: 50,
    palette: {
      bg: 0x87a998,
      backdropTop: 0xc8dcc8,
      wall: 0x2e6b34,
      wallTexture: "hedge",
      wallEmissive: 0x0a2210,
      wallEmissiveIntensity: 0.25,
      fence: "none",
      fenceColor: 0xa9743f,
      groundDetail: "none",
      groundDetailColor: 0x9c9a90,
      floor: 0x4a3524,
      floorTexture: "earth",
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
    blurb: "Wind-rippled sand · sea air",
    // Bright seaside noon: warm sky, sandy dune walls, darker wet-sand floor
    // (kept well below the biscuit tone so the trail stays readable), the
    // brightest sun of any theme. Blooms are shoreline finds — shell white,
    // seafoam, coral — with seagrass specks.
    price: 50,
    palette: {
      bg: 0xa8d8ef,
      backdropTop: 0xd8f0fa,
      wall: 0xd4b078,
      wallTexture: "sand",
      wallEmissive: 0x4a3a18,
      wallEmissiveIntensity: 0.15,
      fence: "none",
      fenceColor: 0xa9743f,
      groundDetail: "none",
      groundDetailColor: 0x9c9a90,
      floor: 0x9a8258,
      floorTexture: "sand",
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
    blurb: "A gravel walk through mown grass",
    // The garden's manicured cousin: same daytime sky family, lighter
    // trimmed-hedge green, gravel-path floor, and noticeably LUSHER
    // flowerbeds (highest bloom density of any theme, plus a purple joining
    // the garden's palette) under a slightly brighter sun.
    price: 50,
    palette: {
      bg: 0x9ecbe8,
      backdropTop: 0xd4ecfa,
      wall: 0x5aa348,
      wallTexture: "hedge",
      wallEmissive: 0x143a12,
      wallEmissiveIntensity: 0.2,
      fence: "none",
      fenceColor: 0xa9743f,
      groundDetail: "none",
      groundDetailColor: 0x9c9a90,
      floor: 0x8a7a5e,
      floorTexture: "parkGrass",
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
    blurb: "Wet asphalt and lit windows · after dark",
    // Twilight downtown: dusk sky, concrete-block walls with a cool window
    // glow, asphalt floor, biscuits as warm streetlight dots. The "blooms"
    // are rooftop LIGHTS — warm windows, cyan and pink neon — glowing far
    // stronger than any flower, with sparse cool-grey vents as specks.
    price: 50,
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
      wallTexture: "brick",
      wallEmissive: 0x3a5aaa,
      wallEmissiveIntensity: 0.28,
      fence: "none",
      fenceColor: 0xa9743f,
      groundDetail: "none",
      groundDetailColor: 0x9c9a90,
      floor: 0x3a3640,
      floorTexture: "road",
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
    // IDEA-060 moved all five of these. They were authored against tiles that
    // are wall in 0 to 4 of the eighteen mazes — the one at (9, 9) has never
    // been on a wall in ANY of them — so before buildWallDecor learned to skip
    // a non-wall tile they hung in mid-air over open corridor, and after it
    // they would simply never have appeared. Found by the audit that came with
    // the garden's own wall-top flowers (scripts/_scratch-walldecor-audit.ts,
    // now guarded by scripts/test-garden-props.ts). The replacements are all
    // wall in 15+ of the 18, and the city is otherwise untouched — its own
    // rebuild is a later session's job.
    wallDecor: [
      { propId: "lamp-post", tile: [2, 2], rotationY: 0, scale: 1 },
      { propId: "transit-sign", tile: [16, 2], rotationY: 1.571, scale: 1 },
      { propId: "lamp-post", tile: [3, 12], rotationY: 0, scale: 1 },
      { propId: "transit-sign", tile: [15, 12], rotationY: 0, scale: 1 },
      { propId: "lamp-post", tile: [6, 18], rotationY: 0, scale: 1 },
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

/**
 * IDEA-064: the theme the tribute coat unlocks.
 *
 * Held here, next to the registry it names, for the same reason
 * cosmetics.ts's TRIBUTE_ENEMY_SKIN_ID is held next to that one: "owning X
 * grants Y" has to hold however the purchase was made, and the shop is only
 * one caller. profileStore.buyBeagleSkin does the granting; ui/shop.ts does the
 * revealing.
 */
export const TRIBUTE_MAZE_THEME_ID = "classic";

/**
 * The maze themes a player can SEE, given what they own.
 *
 * Mirrors cosmetics.ts's visibleEnemySkins field for field, including the
 * second clause: a secret theme the player already owns stays listed, which is
 * what stops a 50-coin Arcade Night bought before IDEA-064 from looking as
 * though it had been taken away.
 */
export function visibleMazeThemes(
  ownsTributeCoat: boolean,
  isOwned: (id: string) => boolean,
): readonly MazeTheme[] {
  return MAZE_THEMES.filter((t) => !t.secret || ownsTributeCoat || isOwned(t.id));
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
