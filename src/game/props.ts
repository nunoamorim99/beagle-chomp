// OWNER: gameplay-engineer (IDEA-029 reusable prop library — pure data for
// v4.1 "Set Dressing")
//
// A prop LIBRARY: named, reusable, TUNABLE definitions of the decorative
// pieces that dress the board (trees, buildings, umbrellas, lamps, signals…).
// This module only DESCRIBES props as parameter bundles — src/render/board.ts
// owns turning a PropDef into a THREE.Group via one factory per baseShape.
// NO `three` import here and NO persistence (mirrors themes.ts / cosmetics.ts
// exactly), so the library stays trivially unit-testable in Node.
//
// The split vs. IDEA-026's original `ThemeProp`: that coupled a shape + a
// density + colors into a per-theme population scattered by hash. Now a
// PropDef is a REUSABLE, hand-tunable definition referenced BY ID from any
// theme's placements ([[IDEA-030]]) or wall-top components ([[IDEA-031]]), so
// "Oak" or "Skyscraper" can appear in many themes and be personalized once.

/** The primitive silhouettes the render layer knows how to build. Every
 *  PropDef picks exactly one; board.ts has one factory per entry and an
 *  exhaustive switch, so adding a shape here without a factory is a
 *  compile-time error there. These are the seven shapes IDEA-026 shipped,
 *  now parametric. "bloom" and "sign" are the small wall-top pieces
 *  ([[IDEA-031]]) — same PropDef/factory machinery, just placed on wall
 *  tops instead of the apron. */
export type PropBaseShape =
  | "shrub"
  | "tree"
  | "pine"
  | "palm"
  | "building"
  | "streetlight"
  | "umbrella"
  | "bloom"
  | "sign";

/** The full tunable parameter set across ALL base shapes. Every field is
 *  OPTIONAL with a documented default the render factory applies, so a
 *  PropDef only lists what it overrides and old/hand-authored defs stay
 *  valid as fields are added (same forward-compat discipline as
 *  StoredProfile). A given shape reads only the fields meaningful to it
 *  (a building ignores `foliageColors`, a tree ignores `windowColor`), and
 *  the editor's Props tab (IDEA-029) shows only the relevant controls per
 *  shape — see PROP_SHAPE_FIELDS below. */
export interface PropParams {
  // --- structure ---
  /** Overall height multiplier applied on top of the placement's own scale
   *  (default 1). Lets "Skyscraper" and "Cottage" share the building shape
   *  but stand at very different heights. */
  height?: number;
  /** Girth/footprint multiplier (default 1) — trunk+crown for foliage,
   *  footprint for a building, canopy for an umbrella. */
  width?: number;
  /** Foliage tiers for pine (2-4, default 3) / crown spheres for tree (1-3,
   *  default 2) / lobes for shrub (2-3, default 3). Ignored by other shapes. */
  segments?: number;
  /** Lean in radians (default per-shape: palm 0.22, umbrella 0.12, others 0)
   *  — the beach-casual / windswept tilt. */
  tilt?: number;

  // --- foliage / canopy color(s) ---
  /** Crown/foliage/canopy colors; the factory picks per-instance for variety
   *  (default per shape). Trees/pines/palms/shrubs/umbrellas read this. */
  foliageColors?: readonly number[];
  /** Trunk/pole color (default 0x6b4a2f wood for foliage, 0x2a2a30 for
   *  streetlight/sign poles, 0xdedede for umbrella poles). */
  trunkColor?: number;

  // --- building ---
  /** Facade colors, picked per instance (default greys). */
  facadeColors?: readonly number[];
  /** Window rows × cols grid on the two camera-facing facades (default 2×2 =
   *  8 lit windows; 0 rows or 0 cols → an unlit tower). */
  windowRows?: number;
  windowCols?: number;
  /** Lit-window color + glow (default 0xf4d060 warm). */
  windowColor?: number;
  windowEmissiveIntensity?: number;
  /** A smaller rooftop box on top (default true for building). */
  rooftop?: boolean;

  // --- glowing head (streetlight / bloom / sign) ---
  /** Emissive accent color for a lamp head, a bloom, or a sign face
   *  (default per shape). */
  glowColor?: number;
  glowIntensity?: number;
  /** sign only: the post-mounted board color behind the glow face
   *  (default 0x33333c dark). */
  signBoardColor?: number;
}

export interface PropDef {
  id: string;
  name: string;
  shape: PropBaseShape;
  params: PropParams;
}

/** Which PropParams fields the editor's Props tab exposes for each shape, in
 *  display order — keeps the inspector honest (no "window count" slider on a
 *  shrub). The render factories independently ignore irrelevant fields, so
 *  this is purely a UI concern; kept here beside PropParams so the two never
 *  drift. */
export const PROP_SHAPE_FIELDS: Record<PropBaseShape, readonly (keyof PropParams)[]> = {
  shrub: ["height", "width", "segments", "foliageColors"],
  tree: ["height", "width", "segments", "foliageColors", "trunkColor"],
  pine: ["height", "width", "segments", "foliageColors", "trunkColor"],
  palm: ["height", "width", "tilt", "foliageColors", "trunkColor"],
  building: ["height", "width", "facadeColors", "windowRows", "windowCols", "windowColor", "windowEmissiveIntensity", "rooftop"],
  streetlight: ["height", "trunkColor", "glowColor", "glowIntensity"],
  umbrella: ["height", "width", "tilt", "foliageColors", "trunkColor"],
  bloom: ["width", "glowColor", "glowIntensity"],
  sign: ["height", "trunkColor", "glowColor", "glowIntensity", "signBoardColor"],
} as const;

/** The starter library — the props IDEA-026 shipped, now as named reusable
 *  defs, PLUS the wall-top pieces IDEA-031 needs (a bloom + a couple of
 *  street-furniture signs/lamps). Themes reference these by id. New defs are
 *  authored in the editor's Props tab and pasted back here. Ids are stable
 *  handles (placements store them) — renaming an id orphans placements, so
 *  treat them like the skin/theme ids. */
export const PROP_LIBRARY: readonly PropDef[] = [
  // --- foliage ---
  {
    id: "shrub",
    name: "Shrub",
    shape: "shrub",
    params: { foliageColors: [0x4e9a3e, 0x3f8f3a, 0x5fae4d], segments: 3 },
  },
  {
    id: "oak",
    name: "Oak Tree",
    shape: "tree",
    params: { foliageColors: [0x4e9a3e, 0x5fae4d], height: 1, width: 1, segments: 2 },
  },
  {
    id: "pine",
    name: "Pine",
    shape: "pine",
    params: { foliageColors: [0x2e6b34, 0x24552a, 0x3a7a40], segments: 3 },
  },
  {
    id: "palm",
    name: "Palm",
    shape: "palm",
    params: { foliageColors: [0x5fae4d, 0x4e9a3e], tilt: 0.22 },
  },
  // --- street / city ---
  {
    id: "tower",
    name: "City Tower",
    shape: "building",
    params: {
      facadeColors: [0x5a5a68, 0x6d6a78, 0x4a4a58, 0x7a7480],
      windowRows: 2,
      windowCols: 2,
      windowColor: 0xf4d060,
      windowEmissiveIntensity: 0.9,
      rooftop: true,
    },
  },
  {
    id: "streetlight",
    name: "Streetlight",
    shape: "streetlight",
    params: { glowColor: 0xf4d060, glowIntensity: 0.9 },
  },
  {
    id: "umbrella",
    name: "Beach Umbrella",
    shape: "umbrella",
    params: { foliageColors: [0xf29a8a, 0x5fc8c0, 0xf2d43a, 0xf4efe6], tilt: 0.12 },
  },
  // --- wall-top pieces (IDEA-031) ---
  {
    id: "bloom",
    name: "Flower Bloom",
    shape: "bloom",
    // The bloom's per-instance color variety historically came from a 4-color
    // set; a placement picks one color, so the def carries the "default"
    // garden bloom. A theme wanting different bloom colors clones this def.
    params: { glowColor: 0xf2d43a, glowIntensity: 0.25, width: 1 },
  },
  {
    id: "lamp-post",
    name: "Wall Lamp",
    shape: "sign",
    // A small post-top warm lamp for wall tops — reuses the sign shape (post
    // + glowing face), just a round warm glow rather than a colored board.
    params: { glowColor: 0xf4d060, glowIntensity: 0.85, signBoardColor: 0x2a2a30, height: 0.7 },
  },
  {
    id: "transit-sign",
    name: "Transit Signal",
    shape: "sign",
    params: { glowColor: 0x5fc8e8, glowIntensity: 0.8, signBoardColor: 0x33333c, height: 0.85 },
  },
] as const;

export const DEFAULT_PROP_ID = "shrub";

/** Looks up a prop def by id. Never throws — an unknown/stale id (e.g. a
 *  placement referencing a since-removed def) degrades to a small neutral
 *  fallback def rather than breaking the whole board build. Callers that
 *  care can check `isKnownPropId` first. */
export function getPropDef(id: string): PropDef {
  return PROP_LIBRARY.find((p) => p.id === id) ?? getFallbackPropDef();
}

export function isKnownPropId(id: string): boolean {
  return PROP_LIBRARY.some((p) => p.id === id);
}

function getFallbackPropDef(): PropDef {
  const found = PROP_LIBRARY.find((p) => p.id === DEFAULT_PROP_ID);
  if (!found) {
    throw new Error("props: DEFAULT_PROP_ID has no matching entry in PROP_LIBRARY");
  }
  return found;
}

/** Wall-top pieces vs. apron props: a small helper so the wall-component
 *  placement UI ([[IDEA-031]]) can offer only the shapes that make sense on a
 *  hedge/wall top (small pieces), while the apron placement UI ([[IDEA-030]])
 *  offers the ground props. Not a hard render constraint — just what each
 *  editor surface lists by default. */
export const WALL_TOP_SHAPES: readonly PropBaseShape[] = ["bloom", "sign"];

export function isWallTopProp(id: string): boolean {
  return WALL_TOP_SHAPES.includes(getPropDef(id).shape);
}
