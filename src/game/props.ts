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

// ---------------------------------------------------------------------------
// IDEA-033 "Props as editable part-assemblies" — an OPTIONAL part-edit layer
// on top of the parametric shape+params above. Nuno: "I should be able to
// select one component of the prop and edit, like the beagle" — today a
// PropDef is a slider bundle only ("that doesn't give much more
// possibilities"); this lets the editor's Props tab select an individual
// MESH/GROUP inside the built shape (a building's rooftop, one window, a
// tree's second crown sphere…) and move/scale/recolor/hide it, or bolt on
// brand new primitive parts, exactly like the character editor already does
// for the beagle (src/editor/inspector.ts's per-part folder).
//
// Deliberately modeled as PLAIN SERIALIZABLE DATA (no `three` import here —
// this file stays a pure, Node-testable data module, same discipline as
// PropParams above) rather than a live EditLog: `parts` round-trips through
// props.ts source text (the editor's "Save to props.ts" button emits it,
// board.ts's makePropFromDef reads it back), so it has to survive a
// stringify/parse (well, a hand-written codegen/eval) cycle unchanged. The
// EDITOR's live bookkeeping (src/editor/propPartEditLog.ts) is a THREE-aware
// recorder that produces exactly this shape from user gestures — mirrors how
// src/editor/editLog.ts's TransformEditRecord/MaterialEditRecord/
// AddedPartRecord record character edits, just addressed at a prop's base
// parts instead of characters.ts's authored ones.
//
// `path` addressing: identical scheme to src/editor/partTree.ts's PartNode —
// slash-joined child indices from the prop's root Group ("" = the root
// itself, "0" = its first child, "2/1" = the second child of its third
// child). board.ts's applyPropParts (see that file) builds the SAME
// depth-first path map right after constructing the base shape, so an edit
// authored against the base shape's CURRENT child order always resolves to
// the right node — the base factories must keep a stable child-append order
// for this to hold (documented at each factory in board.ts).

/** The 4 primitive kinds the Props part-editor can bolt on — same set
 *  characters.ts's editor offers minus "capsule" (props are all
 *  hard-surface/foliage silhouettes; a capsule reads as organic/character-
 *  scale and has no natural home among trees/buildings/lamps — trivially
 *  addable later if a prop ever wants one). */
export type PropPrimKind = "box" | "sphere" | "cylinder" | "cone";

/** An override applied to an EXISTING base part (addressed by `path`) after
 *  the shape factory builds it. Every field is optional — a `PropPartEdit`
 *  only lists what actually changed, same "sparse override" discipline as
 *  PropParams itself. `visible: false` IS the "delete a base part" operation
 *  (per the task brief: "base part → hidden+omitted from output") — a base
 *  part can never be structurally removed from the factory's own child list
 *  (the factory is regenerated fresh on every build), so hiding it is the
 *  only sound way to make it disappear while keeping every OTHER edit's
 *  path addressing stable (removing an array element would shift every
 *  sibling path after it). */
export interface PropPartEdit {
  path: string;
  position?: readonly [number, number, number];
  rotation?: readonly [number, number, number];
  scale?: readonly [number, number, number];
  /** Overrides the part's material color (mesh parts only; ignored on a
   *  Group path). */
  color?: number;
  /** Overrides the material's emissive color — meaningful only on parts the
   *  base factory already built emissive (windows, lamp/bloom/sign glow
   *  faces); applying it to a non-emissive part is a no-op in
   *  applyPropParts (matching+only-if-emissive already set), not an error. */
  emissive?: number;
  /** `false` hides the part (see the class doc above); `true` is only ever
   *  emitted to UN-hide a part the def previously hid (a fresh part is
   *  visible by construction, so `true` is never the FIRST edit on a path). */
  visible?: boolean;
}

/** A brand-new primitive the editor bolted onto a prop, attached under an
 *  existing part (`parentPath` — "" for the prop's own root Group). Mirrors
 *  characters.ts editor's AddedPartRecord in spirit (kind + transform +
 *  color), simplified to what a prop actually needs: no named-variable
 *  bookkeeping (props.ts never emits per-part `const` locals — the whole
 *  parts array is data, not code) and one color (props' primitive parts are
 *  plain MeshStandardMaterial, not glowing unless `emissive` is set). */
export interface AddedPropPart {
  /** Stable id within this def, distinct from any base `path` — the codegen/
   *  applyPropParts pairing key; auto-generated by the editor
   *  (`added-<kind>-<n>`) and never re-derived from tree position, so a
   *  reorder of base parts (e.g. a future factory change) can't collide with
   *  it the way an index-based path could. */
  id: string;
  parentPath: string;
  kind: PropPrimKind;
  /** Geometry constructor params, keyed exactly like
   *  src/editor/codegen.ts's GEOMETRY_DEFAULTS (radius / width+height+depth /
   *  radiusTop+radiusBottom+height / radius+height). */
  params: Record<string, number>;
  position: readonly [number, number, number];
  rotation?: readonly [number, number, number];
  scale?: readonly [number, number, number];
  color: number;
  emissive?: number;
}

/** The part-edit layer for one PropDef — absent entirely on every
 *  hand-authored library def (the 10 starters ship with NO `parts` field at
 *  all), so `makePropFromDef`'s no-parts path stays byte-identical to pre-
 *  IDEA-033 output (see board.ts's applyPropParts call site: `if
 *  (def.parts)` guards the whole thing). Only a def someone has actually
 *  part-edited in the Props tab carries this. */
export interface PropPartLayer {
  edits: readonly PropPartEdit[];
  added: readonly AddedPropPart[];
}

export interface PropDef {
  id: string;
  name: string;
  shape: PropBaseShape;
  params: PropParams;
  /** IDEA-033: optional per-part edits + added primitives layered on top of
   *  the base shape (see PropPartLayer above). Omitted (undefined) for every
   *  shipped def today. */
  parts?: PropPartLayer;
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
  {
    id: "shrub",
    name: "Shrub",
    shape: "shrub",
    params: {
      height: 1,
      width: 1,
      segments: 3,
      foliageColors: [0x4e9a3e, 0x3f8f3a, 0x5fae4d],
    },
  },
  {
    id: "oak",
    name: "Oak Tree",
    shape: "tree",
    params: {
      height: 1,
      width: 1,
      segments: 2,
      foliageColors: [0x4e9a3e, 0x5fae4d],
      trunkColor: 0x6b4a2f,
    },
  },
  {
    id: "pine",
    name: "Pine",
    shape: "pine",
    params: {
      height: 1,
      width: 1,
      segments: 3,
      foliageColors: [0x2e6b34, 0x24552a, 0x3a7a40],
      trunkColor: 0x6b4a2f,
    },
  },
  {
    id: "palm",
    name: "Palm",
    shape: "palm",
    params: {
      height: 1,
      width: 1,
      tilt: 0.22,
      foliageColors: [0x5fae4d, 0x4e9a3e],
      trunkColor: 0x6b4a2f,
    },
    parts: {
      edits: [
      { path: "0", position: [0.15, 0.2, 0] },
      { path: "4", position: [-0.296, 0.92, -0.32], rotation: [0, 2.412, 0.25] },
      { path: "3", position: [0.07, 0.93, -0.454], rotation: [0, 1.521, 0.25] },
      { path: "5", position: [0.37, 0.92, 0.264], rotation: [0, 5.562, 0.25] },
      { path: "2", position: [-0.244, 1.01, 0.28] },
      { path: "7", position: [0.1, 0.72, -0.05] },
      { path: "6", color: 0x905423, emissive: 0x342d28 },
    ],
      added: [],
    },
  },
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
    params: {
      glowColor: 0xf4d060,
      glowIntensity: 0.9,
    },
  },
  {
    id: "umbrella",
    name: "Beach Umbrella",
    shape: "umbrella",
    params: {
      tilt: 0.12,
      foliageColors: [0xf29a8a, 0x5fc8c0, 0xf2d43a, 0xf4efe6],
    },
  },
  {
    id: "bloom",
    name: "Flower Bloom",
    shape: "bloom",
    params: {
      width: 1,
      glowColor: 0xf2d43a,
      glowIntensity: 0.25,
    },
  },
  {
    id: "lamp-post",
    name: "Wall Lamp",
    shape: "sign",
    params: {
      height: 0.7,
      glowColor: 0xf4d060,
      glowIntensity: 0.85,
      signBoardColor: 0x2a2a30,
    },
  },
  {
    id: "transit-sign",
    name: "Transit Signal",
    shape: "sign",
    params: {
      height: 0.85,
      glowColor: 0x5fc8e8,
      glowIntensity: 0.8,
      signBoardColor: 0x33333c,
    },
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
