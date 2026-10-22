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
import type { AmbienceKind } from "../ui/ambience";
import { type WallTextureKind } from "../render/wallTexture";
import { type FloorTextureKind } from "../render/floorTexture";
import { type FenceKind } from "../render/fence";
import { type GroundDetailKind } from "../render/groundDetail";
import { type SurroundKind } from "../render/surround";


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
  /**
   * IDEA-066: fog near/far, in ABSOLUTE WORLD UNITS AT THE BASE DOLLY — i.e.
   * the numbers that apply at every landscape aspect, where `computeFitDistance`
   * floors the camera at `baseDist` and the rig is exactly (0, 27, 15.5).
   * `resize()` scales both by `dist / baseDist` on portrait, which is what makes
   * the two framings see the SAME fog at the same point in the frame — measured,
   * 62% at the top of frame on both at the old global 30/55.
   *
   * Per-theme because the surround made one global pair impossible: an open
   * garden wants to show you the neighbourhood, a deep forest wants to swallow
   * depth, and Arcade Night is propless on purpose so the fog IS its surround.
   *
   * Absolute units rather than multipliers on purpose — a multiplier is relative
   * to a base with no meaning of its own, and cannot be solved against the frame
   * geometry the way these can (`scripts/_scratch-surround-coverage.ts`).
   */
  fogNear: number;
  fogFar: number;

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
  /**
   * IDEA-066: which procedural NEIGHBOURHOOD grows beyond the board
   * (src/render/surround.ts) — the third board system that is geometry rather
   * than a texture, after the fence and the ground dressing.
   *
   * "none" costs nothing at all, and Arcade Night takes it deliberately: it was
   * always the clean, propless tribute board.
   */
  surround: SurroundKind;
  /**
   * Colour of the ground BEYOND the board's own floor plane.
   *
   * Defaults to matching `floor`, and should stay close to it: the board's
   * floor texture bakes `floor` in as its ground, so anything far from it draws
   * a visible ring around the maze. `scripts/_scratch-surround-seam.ts` measures
   * the join; a theme that wants today's void back sets this to its own `bg`.
   */
  surroundGround: number;
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
  /**
   * IDEA-073: which AMBIENCE BED plays while you are standing in this theme.
   *
   * REQUIRED, unlike `secret` and `tunnelArch`, and that is deliberate: a new
   * theme with no bed would be silent with nothing to tell you, which is the
   * same class of failure as `wallDecor` hanging Night City's lamps over open
   * corridor for two releases. Making it required means a sixth theme cannot
   * be added without someone deciding what the place sounds like -- and
   * "none" is a real answer (Arcade Night takes it, for the same reason its
   * `surround` is "none").
   *
   * A KIND, never a recipe. The theme answers WHICH, ambience.ts answers HOW
   * -- exactly the split `tunnelArch` draws for the arch at the tunnel mouth.
   */
  ambience: AmbienceKind;
  palette: ThemePalette;
  /** IDEA-030: explicit apron prop placements (was IDEA-026's `props`
   *  density populations). Empty = a bare apron (classic). Each references a
   *  library prop ([[props.ts]]) by id. */
  placements: readonly PropPlacement[];
  /**
   * IDEA-066: hand-placed props on the VERGE rings — two tiles out from the
   * apron, where the big stuff goes.
   *
   * The same element type as `placements`, and a SEPARATE array on purpose.
   * Reusing `placements` with out-of-apron tiles creates unreachable data
   * three ways: the editor builds a marker per tile from `apronCandidates`
   * and a marker is the only way to select a placement, so a verge tile could
   * be created by hand and never moved or deleted again; `buildProps`' height
   * caps key on `ty === ROWS` / `tx === -1 || tx === COLS`, so every tall
   * verge prop would be SILENTLY uncapped (the exact shape of the
   * buildWallDecor-never-checked-for-a-wall bug); and the two layers want
   * different shadow and merge treatment — the verge is collapsed by
   * SIGNATURE and casts nothing, the apron is collapsed per prop and casts.
   */
  verge: readonly PropPlacement[];
  /**
   * IDEA-067: the prop id of the arch that stands at this theme's TUNNEL
   * MOUTHS, or absent for a theme that wants none.
   *
   * An ID rather than an array of placements, and that is the whole design.
   * A tunnel is a property of the MAZE — there are 36 of them and every one
   * puts its two tunnels at row 9 — while a placement is a property of the
   * THEME. `buildTunnelArches` reads the grid and stands one arch at every
   * tunnel it finds, so the theme only has to answer "which arch", never
   * "where". Hand-placing the positions would be right on all 36 boards today
   * and would silently go wrong the first time a maze is authored with a
   * tunnel somewhere else — which is exactly how `wallDecor` ended up hanging
   * Night City's lamps over open corridor for two releases.
   *
   * Only the garden names one. The other five get their own art rather than
   * this one recoloured: a yew portal at a beach tunnel mouth is not a beach.
   */
  tunnelArch?: string;
  /**
   * IDEA-081: the biscuit trail is a deliberate DARK MARKING, so the shipped
   * style draws it from its INK set rather than snapping it like a surface.
   *
   * The high-key palette's darkest warm entry is `bark` (#b07d52), so a
   * biscuit authored dark brown still renders mid-brown — and on the City
   * Park's pale walk that measured 3.5:1 on a phone, where a biscuit is about
   * five pixels across. The ink set is the style's declared exception for
   * exactly this ("dark only as deliberate contrast accents"), and the
   * biscuit trail is the most important contrast accent in the game.
   *
   * A THEME FLAG rather than inferred from colour, for madboxStyle.ts's own
   * reason: colour cannot say what a dark thing is FOR, and inferring it here
   * would quietly repaint every theme whose biscuit happens to be brown.
   * Optional and only the park sets it; classic ignores it.
   */
  inkBiscuits?: boolean;
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
    ambience: "birds",
    tunnelArch: "hedge-arch",
    palette: {
      bg: 0x9ecbe8,
      backdropTop: 0xcfe9f7,
      fogNear: 34,
      fogFar: 92,
      wall: 0x3f8f3a,
      wallTexture: "hedgeFlower",
      wallEmissive: 0x0e2a0e,
      wallEmissiveIntensity: 0,
      fence: "picket",
      fenceColor: 0xa9743f,
      groundDetail: "rocks",
      groundDetailColor: 0x9c9a90,
      surround: "plots",
      surroundGround: 0x517a33,
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
      speckChance: 0,
    },
    placements: [
      { propId: "garden-shrub", tile: [-1, 20], offset: [0, 0.1270483582247568], rotationY: 0.84, scale: 2 },
      { propId: "garden-shrub", tile: [0, 21], offset: [-0.17038862911364383, 0], rotationY: 0, scale: 2 },
      { propId: "garden-shrub", tile: [-1, 21], offset: [0, 0], rotationY: 0, scale: 1.5 },
      { propId: "garden-shrub", tile: [19, 20], offset: [0, 0.13253337033606982], rotationY: 0, scale: 2 },
      { propId: "garden-shrub", tile: [19, 18], offset: [0, 0], rotationY: 0, scale: 2 },
      { propId: "garden-shrub", tile: [-1, 18], offset: [0, 0], rotationY: 0, scale: 2 },
      { propId: "garden-shrub", tile: [5, 21], offset: [0.179218601730339, 0], rotationY: 0, scale: 2 },
      { propId: "garden-shrub", tile: [7, 21], offset: [-0.29206965444680133, 0], rotationY: 0, scale: 2 },
      { propId: "garden-shrub", tile: [6, 21], offset: [0, 0], rotationY: 0, scale: 1 },
      { propId: "garden-shrub", tile: [19, 21], offset: [0, 0], rotationY: 0, scale: 1.5 },
      { propId: "garden-shrub", tile: [18, 21], offset: [0.16786334683974324, -0.0015449399414393383], rotationY: 0, scale: 2 },
      { propId: "garden-shrub", tile: [13, 21], offset: [0, 0], rotationY: 0, scale: 2 },
      { propId: "garden-shrub", tile: [12, 21], offset: [0, 0], rotationY: 0, scale: 1.5 },
      { propId: "garden-shrub", tile: [14, 21], offset: [0, 0], rotationY: 0, scale: 1.5 },
    ],
    verge: [
      { propId: "garden-tree", tile: [8, -2], offset: [-0.2, 0.1], rotationY: 0, scale: 3.2 },
      { propId: "garden-tree", tile: [14, -3], offset: [0, 0], rotationY: 0, scale: 3.8 },
      { propId: "garden-tree", tile: [-3, 4], offset: [0, 0], rotationY: 0, scale: 3.4 },
      { propId: "garden-tree", tile: [21, 8], offset: [0, 0], rotationY: 0, scale: 3.6 },
      { propId: "garden-tree", tile: [-2, 14], offset: [0.1, 0], rotationY: 0, scale: 3 },
      { propId: "garden-tree", tile: [20, 16], offset: [0, 0], rotationY: 0, scale: 3.2 },
      { propId: "garden-shrub", tile: [5, -2], offset: [0.2, 0], rotationY: 0, scale: 2.4 },
      { propId: "garden-shrub", tile: [11, -3], offset: [0, 0.1], rotationY: 0, scale: 2.8 },
      { propId: "garden-shrub", tile: [17, -2], offset: [-0.1, 0], rotationY: 0, scale: 2.2 },
      { propId: "garden-shrub", tile: [-3, 10], offset: [0, 0], rotationY: 0, scale: 2.5 },
      { propId: "garden-shrub", tile: [21, 3], offset: [0, 0], rotationY: 0, scale: 2.3 },
      { propId: "garden-shrub", tile: [-2, 19], offset: [0, 0], rotationY: 0, scale: 2.1 },
      { propId: "nest-tree", tile: [10, -2], offset: [0, 0], rotationY: 0, scale: 3 },
      { propId: "treehouse", tile: [0, -3], offset: [0, 0], rotationY: 0.36, scale: 3 },
      { propId: "treehouse", tile: [18, -3], offset: [0, 0], rotationY: 6.1, scale: 3 },
    ],
    wallDecor: [
      { propId: "birdhouse", tile: [0, 20], rotationY: 0.85, scale: 2 },
      { propId: "birdhouse", tile: [18, 20], rotationY: 5.6, scale: 2 },
      { propId: "birdhouse", tile: [9, 13], rotationY: 0, scale: 2 },
      { propId: "flower-head-rose", tile: [11, 10], rotationY: 0, scale: 1 },
      { propId: "birdhouse", tile: [9, 5], rotationY: 0, scale: 2 },
      { propId: "bloom", tile: [0, 8], rotationY: 0, scale: 1 },
      { propId: "perched-bird", tile: [9, 14], rotationY: 0, scale: 1.2 },
      { propId: "flower-head-sunflower", tile: [8, 12], rotationY: 0, scale: 1 },
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
    ambience: "none",
    tunnelArch: "warp-gate",
    palette: {
      bg: 0x0b0b16,
      backdropTop: 0x232348,
      fogNear: 26,
      fogFar: 46,
      wall: 0x2b2b6b,
      wallTexture: "flat",
      wallEmissive: 0x14143a,
      wallEmissiveIntensity: 0.72,
      fence: "none",
      fenceColor: 0xa9743f,
      groundDetail: "none",
      groundDetailColor: 0x9c9a90,
      surround: "none",
      surroundGround: 0x111120,
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
    verge: [],
    wallDecor: [],
  },
  {
    id: "forest",
    name: "Deep Forest",
    blurb: "Deep pines and leaf litter · low light",
    price: 50,
    ambience: "forest",
    tunnelArch: "forest-arch",
    palette: {
      bg: 0x87a998,
      backdropTop: 0xc8dcc8,
      fogNear: 30,
      fogFar: 60,
      wall: 0x215426,
      wallTexture: "hedge",
      wallEmissive: 0x0a2210,
      wallEmissiveIntensity: 0.25,
      fence: "none",
      fenceColor: 0xa9743f,
      groundDetail: "none",
      groundDetailColor: 0x9c9a90,
      surround: "woodland",
      surroundGround: 0x4a3524,
      floor: 0x4a3524,
      floorTexture: "earth",
      floorEmissive: 0x1e1408,
      floorEmissiveIntensity: 0,
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
      bloomEmissiveIntensity: 1,
      bloomChance: 0,
      speckColor: 0x6a9a4a,
      speckEmissive: 0x16300f,
      speckChance: 0.5,
    },
    placements: [
      { propId: "critter-deer", tile: [3, 21], offset: [0, 0], rotationY: 0.72, scale: 1.51 },
      { propId: "critter-fox", tile: [9, 21], offset: [0, 0.18], rotationY: 0, scale: 1.43 },
      { propId: "critter-raccoon", tile: [12, 21], offset: [0, 0], rotationY: 0, scale: 1.33 },
    ],
    verge: [
      { propId: "log-cabin", tile: [-1, -3], offset: [0, 0], rotationY: 0.36, scale: 3 },
      { propId: "log-cabin", tile: [19, -3], offset: [0, 0], rotationY: 5.92, scale: 3 },
      { propId: "pine", tile: [2, -3], offset: [0, 0], rotationY: 0, scale: 2.52 },
      { propId: "pine", tile: [4, -3], offset: [0, 0], rotationY: 0, scale: 1.94 },
      { propId: "pine", tile: [3, -2], offset: [0, 0], rotationY: 0, scale: 1.74 },
      { propId: "critter-deer", tile: [6, -3], offset: [0, 0], rotationY: 0, scale: 1.74 },
      { propId: "pine", tile: [-3, -1], offset: [0, 0], rotationY: 0, scale: 2.37 },
      { propId: "critter-fox", tile: [-2, 1], offset: [0, 0], rotationY: 0.54, scale: 1.43 },
      { propId: "critter-raccoon", tile: [15, -3], offset: [0, 0], rotationY: 0, scale: 1.56 },
      { propId: "pine", tile: [21, 0], offset: [0, 0], rotationY: 0, scale: 2.75 },
    ],
    wallDecor: [
      { propId: "flower-head-sunflower", tile: [0, 20], rotationY: 0, scale: 1 },
    ],
  },







  {
    id: "beach",
    name: "Sunny Beach",
    blurb: "Wind-rippled sand · sea air",
    // Bright seaside noon: warm sky, sandy dune walls, wet-sand floor, the
    // brightest sun of any theme. Blooms are shoreline finds — shell white,
    // seafoam, coral — with seagrass specks. The biscuits are BROWN here
    // (IDEA-080 v2): the shipped style lifts this floor to a pale sand, and a
    // cream biscuit on pale sand disappeared — so the trail is the one thing
    // on this board darker than the ground it lies on.
    price: 50,
    ambience: "surf",
    tunnelArch: "sea-arch",
    inkBiscuits: true,
    palette: {
      bg: 0xa8d8ef,
      backdropTop: 0xd8f0fa,
      fogNear: 38,
      fogFar: 104,
      wall: 0xd4b078,
      wallTexture: "sand",
      wallEmissive: 0x4a3a18,
      wallEmissiveIntensity: 0.15,
      fence: "none",
      fenceColor: 0xa9743f,
      groundDetail: "none",
      groundDetailColor: 0x9c9a90,
      surround: "dunes",
      surroundGround: 0x9a8258,
      floor: 0x9a8258,
      floorTexture: "sand",
      floorEmissive: 0x3a2e14,
      floorEmissiveIntensity: 0.25,
      biscuit: 0x8a5428,
      biscuitEmissive: 0x2a1608,
      biscuitEmissiveIntensity: 0.3,
      hemiSky: 0xe8f6ff,
      hemiGround: 0x8a7448,
      hemiIntensity: 0.7,
      sunColor: 0xfff8e8,
      sunIntensity: 1.2,
      rimColor: 0xa8e0e8,
      rimIntensity: 0.35,
      bloomColors: [0xf8f0e2, 0x5fc8c0, 0xf29a8a],
      bloomEmissiveIntensity: 0.25,
      bloomChance: 0.05,
      speckColor: 0x8aa860,
      speckEmissive: 0x2a3a14,
      speckChance: 0,
    },
    placements: [],
    verge: [],
    wallDecor: [],
  },
  {
    id: "park",
    name: "City Park",
    blurb: "A gravel walk through mown grass",
    // The garden's manicured cousin: same daytime sky family, lighter
    // trimmed-hedge green, gravel-path floor, and noticeably LUSHER
    // flowerbeds (highest bloom density of any theme, plus a purple joining
    // the garden's palette) under a slightly brighter sun. The biscuits are a
    // DARK brown (IDEA-081): the corridors are a pale gravel walk the cream
    // biscuit matched in hue and value. Darker than the beach's on purpose —
    // that one snaps to `wood`, which renders at this gravel's own value;
    // this lands a rung lower, on `bark`.
    price: 50,
    ambience: "park",
    tunnelArch: "park-gate",
    inkBiscuits: true,
    palette: {
      bg: 0x9ecbe8,
      backdropTop: 0xd4ecfa,
      fogNear: 34,
      fogFar: 85,
      wall: 0x5aa348,
      wallTexture: "hedge",
      wallEmissive: 0x143a12,
      wallEmissiveIntensity: 0.2,
      fence: "none",
      fenceColor: 0xa9743f,
      groundDetail: "none",
      groundDetailColor: 0x9c9a90,
      surround: "parkland",
      surroundGround: 0x5f7942,
      floor: 0x8a7a5e,
      floorTexture: "parkGrass",
      floorEmissive: 0x342c1c,
      floorEmissiveIntensity: 0.28,
      biscuit: 0x5a3820,
      biscuitEmissive: 0x2a1608,
      biscuitEmissiveIntensity: 0.3,
      hemiSky: 0xdcf2ff,
      hemiGround: 0x50452a,
      hemiIntensity: 0.68,
      sunColor: 0xfff6e4,
      sunIntensity: 1.15,
      rimColor: 0xaed4f0,
      rimIntensity: 0.35,
      bloomColors: [0xf2d43a, 0xe8709a, 0xd8483f, 0x8a6ae0],
      bloomEmissiveIntensity: 0.3,
      bloomChance: 0,
      speckColor: 0x8fd15c,
      speckEmissive: 0x1c3a18,
      speckChance: 0,
    },
    placements: [],
    verge: [],
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
    ambience: "city",
    tunnelArch: "neon-gateway",
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
      fogNear: 28,
      fogFar: 54,
      wall: 0x7a7480,
      wallTexture: "brick",
      wallEmissive: 0x3a5aaa,
      wallEmissiveIntensity: 0.28,
      fence: "none",
      fenceColor: 0xa9743f,
      groundDetail: "none",
      groundDetailColor: 0x9c9a90,
      surround: "cityblocks",
      surroundGround: 0x3a3640,
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
      bloomChance: 0,
      speckColor: 0xaaaacc,
      speckEmissive: 0x3a3a4a,
      speckChance: 0,
    },
    placements: [],
    verge: [],
    wallDecor: [],
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
