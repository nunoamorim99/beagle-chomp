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
  | "sign"
  // IDEA-060, built from references (src/render/gardenProps.ts). These are
  // ADDITIONS rather than replacements for "shrub"/"tree": those two are
  // referenced 38 and 23 times across the garden, the forest and the park, and
  // rewriting them in place would silently re-dress two themes nobody has
  // reviewed. The garden's own placements are repointed here; the other two
  // keep what they have until their turn.
  | "leafShrub"
  | "broadleafTree"
  | "treehouse"
  | "flower"
  | "birdhouse"
  // IDEA-065, built from references (src/render/forestProps.ts). Additions
  // for the Deep Forest theme, on the same reasoning: `pine` is REWRITTEN in
  // place because the forest is the only theme that uses it and the only
  // theme under review, but everything else here is new.
  | "logCabin"
  | "critter"
  | "nestTree"
  | "perchedBird"
  | "flowerHead"
  // IDEA-067, built from a reference (src/render/archway.ts). The hedge
  // PORTAL that marks the tunnel mouth — the one place on the board where
  // the beagle crosses from one side to the other. It is a normal library
  // shape so it can be hand-placed anywhere, AND board.ts stands one at
  // every tunnel it finds in the GRID; see that module's rule 5.
  | "archway";

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

  // --- IDEA-060 garden props ---
  /** flower only: WHICH of the five garden flowers this is. Five defs share
   *  one shape because they share a stem, a leaf pair and a head socket — but
   *  the heads are genuinely different constructions, not one head in five
   *  colours (the rose and the tulip are both red in the reference, so shape
   *  is the only thing that can separate them). Default "daisy". */
  flowerKind?: "daisy" | "sunflower" | "rose" | "tulip" | "blossom";
  /** flower only: overrides the kind's own petal colour. */
  petalColor?: number;
  /** flower only: overrides the kind's own eye/throat colour. */
  centerColor?: number;
  /** birdhouse only: the bird perched on the ridge (default true). It is what
   *  makes the prop read as a birdhouse rather than a letterbox at play size,
   *  so turning it off is a deliberate choice, not a default. */
  showBird?: boolean;
  /** birdhouse only: the perched bird's plumage (default 0x3f9ede). */
  birdColor?: number;

  // --- IDEA-065 forest props ---
  /** logCabin only: the roof slabs and the chimney (default 0x4a3a33). Kept
   *  separate from `facadeColors` because a log cabin's roof and its walls
   *  are the one contrast the silhouette depends on, so a theme retinting one
   *  must be able to leave the other alone. */
  roofColor?: number;
  /** critter only: WHICH of the six woodland animals this is. Six defs share
   *  one shape for the reason the five flowers do — they share a body plan
   *  (body, head, ears, forelimbs, feet, tail) and differ in the SHAPES of
   *  those parts. See forestCritters.ts's header. Default "rabbit". */
  critterKind?: "deer" | "fox" | "rabbit" | "raccoon" | "squirrel" | "squirrelExplorer";
  /** critter only: the main coat (default per kind). */
  furColor?: number;
  /** critter only: the pale bib/underside/inner ear (default per kind). */
  bellyColor?: number;
  /** perchedBird only: the eye's iris RING (default the measured 0xe8c24a
   *  gold). It is a named param rather than a part edit because the eye is
   *  the bird's identity rank 1 and "recolour the eyes" is a thing a theme
   *  should be able to say — hunting for the right primitive in the part tree
   *  to do it is how a whole prop ended up white. */
  eyeColor?: number;
  /** critter only: whatever the kind's reference makes DARK — a fox's socks,
   *  a raccoon's mask and tail bands, a deer's antlers, a rabbit's inner ear
   *  (default per kind). */
  accentColor?: number;

  // --- IDEA-067 the hedge archway ---
  // Eight dials, and they exist so the arch is a THING TO TRY rather than a
  // thing that shipped. Nuno: "make the necessary changes to allow the edit
  // of that component to allow create other and try other things." Every one
  // is a ratio of HW (the portal wall's own height) rather than a world
  // number, so `height` stays the single scale control and no dial has to be
  // re-tuned after it moves. src/render/archway.ts's ARCH_DEFAULTS holds the
  // values and the measurement spec holds the reasons.
  /** archway only: WHICH KIND of arch this is (default "hedge").
   *
   *  "trees" is IDEA-067 v3 and it is the Deep Forest's own answer — Nuno:
   *  *"the tunnel arch on the deep forest we can make like a tunnel with like
   *  two trees one in each side and one branch from each tree making the
   *  arch."* A `kind` rather than a second PropBaseShape, following
   *  `flowerKind` and `critterKind`: the two share a brief (mark the one
   *  crossing the board has, readable in PLAN from 59 degrees) and almost
   *  every dial below means the same thing to both — `archOpening` is the gap
   *  the beagle walks through either way, `archRise`/`archCurve` draw the
   *  same superellipse, `archCrown` is the band's thickness at the crown. It
   *  also keeps the Board tab working for free: the Tunnel arch slot lists
   *  every library def whose SHAPE is `archway`, so a new shape would have
   *  been invisible there until someone widened that filter too.
   *
   *  The three dials that are REINTERPRETED rather than shared are named in
   *  `makeTreeArch`'s own doc comment: `archPier` is the trunk's girth,
   *  `archDepth` how far the pair spreads through the portal, and `archCrest`
   *  the leaf clusters riding the branches.
   *
   *  "rocks" is IDEA-080, the Sunny Beach's: a sea arch of stacked boulders
   *  with weathered caps, algae at the tide line, corals at the feet and a
   *  few crabs — Nuno: *"something like a rock arch with corals and beach
   *  flora, like algae, and some small crabs on the rocks."* `makeRockArch`
   *  names its three reinterpreted dials: `archCrest` sizes the cap stones,
   *  `archBlossoms` is coral clusters per foot, `foliageColors` the algae.
   *
   *  "neon" is IDEA-083, Night City's: two slim steel posts, a pink-and-cyan
   *  neon outline, marquee bulbs and a glowing bone sign on the crown.
   *  `makeNeonArch` lists its reinterpreted dials (`archPier` the post,
   *  `archCrown` the gap between the tubes, `archBlossoms` the bulbs,
   *  `archCrest` the sign's size). */
  archKind?: "hedge" | "trees" | "rocks" | "gate" | "neon";
  /** archway only: the opening's width as a fraction of the portal's height
   *  (default 0.5, which is 1.03 world units — ONE MAZE TILE, so the arch
   *  frames the tunnel corridor exactly). The reference measures 0.338; the
   *  shipped value is far wider because the play camera looks down 59 degrees
   *  and an arch has to be readable in PLAN. See archway.ts rule 6. */
  archOpening?: number;
  /** archway only: the arch head's rise over the opening's HALF-width
   *  (default 0.78). Below 1 is a segmental arch, 1 is a semicircle, above 1
   *  is pointed — so this and `archCurve` together are the two dials that
   *  decide what KIND of arch it is. */
  archRise?: number;
  /** archway only: the arch head's superellipse exponent (default 2.6).
   *  2 is a true ellipse, above 2 flattens the crown and sharpens the
   *  shoulders into the reference's basket handle, below 2 draws it up into
   *  a gothic point. */
  archCurve?: number;
  /** archway only: each pier's width / HW (default 0.22). The reference's
   *  mass is in the SIDES — its crown band is thinner than either pier — and
   *  an arch with an even band all round reads as a picture frame.
   *
   *  There is no pier HEIGHT dial and that is deliberate: the piers carry
   *  whatever the band does not (`H - rise - crown`), so the arch is always a
   *  closed figure of the authored height however the other three are turned.
   *  A fourth independent number would let them disagree. */
  archPier?: number;
  /** archway only: depth through the portal / HW (default 0.366, about
   *  three quarters of a maze tile). Not measurable from the reference; see
   *  the spec's hiddenByTheSingleView. */
  archDepth?: number;
  /** archway only: the arch BAND's thickness / HW (default 0.16) — the hedge
   *  above the opening. It and `archRise` between them decide how much of the
   *  portal is pier and how much is arch. */
  archCrown?: number;
  /** archway only: the band's depth as a fraction of the PIERS' depth
   *  (default 0.55). Below 1 so the band crosses the gap as a ribbon rather
   *  than lidding it — at 1 the arch is a wall with a hole in it, which from
   *  the play camera is a green slab. archway.ts rule 6. */
  archRibbon?: number;
  /** archway only: how much lighter, looser growth rides the arch's outer
   *  edge, 0..1 (default 0.55). At 0 the outline is smooth, which reads as
   *  topiary rather than as a hedge somebody has let go a little. */
  archCrest?: number;
  /** archway only: a picket fence round each foot (default true), built by
   *  fence.ts's own panel builder so it IS the maze wall's fence rather than
   *  a copy of it — same pickets, same pitch, same dark rails, and the World
   *  tab's dials move both together. Nuno asked for it by name: the arch
   *  stands where the maze wall's fence ends, and anything else at that
   *  junction reads as a different garden. */
  archFence?: boolean;
  /** archway only: the footing fence's timber (default 0xa9743f, the
   *  garden palette's own `fenceColor`). */
  fenceColor?: number;
  /** archway only: flower specks per pier face (default 9). The maze wall
   *  wears a flowering hedge texture, so an arch in plain green does not
   *  belong to the hedge it stands against. */
  archBlossoms?: number;
  /** archway only: the flush stone sill across the foot of the opening
   *  (default true). */
  archThreshold?: boolean;
  /** archway only: the flower specks (default 0xf4efe6 cream). */
  blossomColor?: number;
  /** archway only: the threshold slab (default 0x9c9a90, the garden's own
   *  groundDetail stone). */
  stoneColor?: number;
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
  // IDEA-060.
  leafShrub: ["height", "width", "foliageColors", "trunkColor"],
  broadleafTree: ["height", "width", "foliageColors", "trunkColor"],
  treehouse: ["height", "width", "foliageColors", "trunkColor"],
  flower: ["height", "width", "flowerKind", "petalColor", "centerColor"],
  birdhouse: ["height", "width", "trunkColor", "showBird", "birdColor"],
  // IDEA-065.
  logCabin: ["height", "width", "segments", "trunkColor", "roofColor", "windowColor", "windowEmissiveIntensity"],
  critter: ["height", "width", "critterKind", "furColor", "bellyColor", "accentColor"],
  nestTree: ["height", "width", "trunkColor", "foliageColors", "showBird", "birdColor"],
  perchedBird: ["height", "width", "birdColor", "bellyColor", "eyeColor", "trunkColor"],
  flowerHead: ["height", "width", "flowerKind", "petalColor", "centerColor"],
  // IDEA-067.
  archway: [
    "height",
    "width",
    "archKind",
    "archOpening",
    "archRise",
    "archCurve",
    "archPier",
    "archDepth",
    "archCrown",
    "archRibbon",
    "archCrest",
    "archBlossoms",
    "archThreshold",
    "archFence",
    "foliageColors",
    "blossomColor",
    "fenceColor",
    "stoneColor",
    // The tree arch's bark. Deliberately the SAME field the pine, the nest
    // tree and the log cabin use rather than an `archTrunkColor` of its own:
    // a second name for one idea is a second thing to keep in step, and a new
    // colour param would also need its own seed (IDEA-065's white-critter
    // defect). The hedge arch simply never sets it.
    "trunkColor",
  ],
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
      height: 1.5,
      width: 1.4,
      segments: 8,
      foliageColors: [0x285835, 0x2e6337, 0x24523a],
      trunkColor: 0x7a6142,
    },
    parts: {
      edits: [
      { path: "0", scale: [1, 6.197, 1] },
    ],
      added: [],
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
      height: 1,
      width: 1,
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
      height: 1,
      trunkColor: 0x6b4a2f,
      glowColor: 0xf4d060,
      glowIntensity: 0.9,
    },
  },
  {
    id: "umbrella",
    name: "Beach Umbrella",
    shape: "umbrella",
    params: {
      height: 1,
      width: 1,
      tilt: 0.12,
      foliageColors: [0xf29a8a, 0x5fc8c0, 0xf2d43a, 0xf4efe6],
      trunkColor: 0x6b4a2f,
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
  {
    id: "garden-shrub",
    name: "Garden Shrub",
    shape: "leafShrub",
    params: {
      height: 1,
      width: 1,
      foliageColors: [0x4e9a3e, 0x3f8f3a, 0x5fae4d, 0x56a343],
      trunkColor: 0x7a6250,
    },
  },
  {
    id: "garden-tree",
    name: "Garden Tree",
    shape: "broadleafTree",
    params: {
      height: 1,
      width: 1,
      foliageColors: [0x4e9a3e, 0x5fae4d, 0x46963c],
      trunkColor: 0x7d5535,
    },
  },
  {
    id: "treehouse",
    name: "Treehouse",
    shape: "treehouse",
    params: {
      height: 1,
      width: 1,
      foliageColors: [0x4e9a3e, 0x57a442],
      trunkColor: 0x7a5230,
    },
    parts: {
      edits: [
      { path: "1/2", position: [0, 0.98, 0.339], scale: [1, 1.95, 1] },
      { path: "1/1", position: [-0.237, 0.91, 0.339], scale: [1, 1.57, 1] },
      { path: "1/3", position: [0.237, 0.91, 0.339], scale: [1, 1.59, 1] },
      { path: "1/4", position: [0.004, 0.63, 0.334] },
      { path: "1/12", scale: [1.02, 1, 1.04] },
      { path: "5/4", position: [-0.861, 0.662, -0.091] },
      { path: "6", rotation: [-0.048, -0.042, 1.049], scale: [1, 1.1, 1] },
      { path: "0", scale: [1, 1.08, 1] },
      { path: "4", position: [0.494, 0.459, 0.078], rotation: [0, 0, 1.881], scale: [1, 1.245, 1] },
      { path: "3", position: [0.828, -0.03, 0.087] },
    ],
      added: [],
    },
  },
  {
    id: "birdhouse",
    name: "Birdhouse",
    shape: "birdhouse",
    params: {
      height: 1,
      width: 1,
      trunkColor: 0x6b4a2f,
      showBird: true,
      birdColor: 0x3f9ede,
    },
  },
  {
    id: "log-cabin",
    name: "Log Cabin",
    shape: "logCabin",
    params: {
      height: 1,
      width: 1,
      segments: 7,
      trunkColor: 0xc2804e,
      windowColor: 0xffc833,
      windowEmissiveIntensity: 0.6,
      roofColor: 0x6b5248,
    },
    parts: {
      edits: [
      { path: "2", scale: [1.032, 1, 1.049] },
      { path: "19", position: [0, 0.155, 0.526] },
      { path: "12", position: [-0.203, 0.27, 0.524] },
      { path: "11", position: [-0.203, 0.27, 0.516] },
      { path: "14", position: [0.203, 0.27, 0.524] },
      { path: "13", position: [0.203, 0.27, 0.516] },
      { path: "16", position: [0, 0.542, 0.524] },
      { path: "15", position: [0, 0.542, 0.516] },
    ],
      added: [],
    },
  },
  {
    id: "critter-deer",
    name: "Deer",
    shape: "critter",
    params: {
      height: 1,
      width: 1,
      critterKind: "deer",
      furColor: 0xc97f3e,
      bellyColor: 0xf2e2c8,
      accentColor: 0x6b4a2f,
    },
    parts: {
      edits: [
      { path: "0/10/4", position: [-0.185, 0.094, 0.266], rotation: [0, -0.331, 0], scale: [0.803, 0.775, 1] },
      { path: "0/10/5", position: [0.185, 0.094, 0.266], rotation: [0, 0.331, 0], scale: [0.803, 0.775, 1] },
      { path: "0/10/2", position: [0.001, -0.185, 0.359] },
      { path: "0/8", visible: false },
      { path: "0/9", position: [0, 2.409, 0.76], scale: [1, 1.766, 1] },
      { path: "0/10", position: [0, 2.87, 0.712] },
      { path: "0/10/3", position: [0, -0.045, 0.56] },
      { path: "0/1", position: [0, 1.29, 0.05], scale: [1, 1.156, 1] },
      { path: "0/10/4/0/1", scale: [1, 0.938, 1] },
      { path: "0/10/5/0/1", scale: [1, 0.938, 1] },
      { path: "0/10/4/0/2", position: [0.01, -0.01, 0] },
      { path: "0/10/5/0/2", position: [-0.01, -0.01, 0] },
      { path: "0/10/4/0/3", position: [-0.01, 0.01, 0] },
      { path: "0/10/5/0/3", position: [0.01, 0.01, 0] },
    ],
      added: [],
    },
  },
  {
    id: "critter-fox",
    name: "Fox",
    shape: "critter",
    params: {
      height: 1,
      width: 1,
      critterKind: "fox",
      furColor: 0xe07a2c,
      bellyColor: 0xf6efe2,
      accentColor: 0x2e2620,
    },
    parts: {
      edits: [
      { path: "0/7/10", position: [-0.123, -0.215, 0.183], rotation: [-0.282, -0.057, 1.205], scale: [1.251, 1.29, 1.359] },
      { path: "0/7/11", position: [0.186, -0.142, 0.111], rotation: [-0.251, 0.046, -1.334], scale: [1.154, 1.456, 1.688] },
      { path: "0/7/1", scale: [0.838, 0.774, 1.163] },
      { path: "0/7/0", scale: [1.152, 0.92, 1] },
      { path: "0/7/9", position: [-0.186, -0.142, 0.111], rotation: [-0.251, -0.046, 1.334], scale: [1.154, 1.456, 1.688] },
      { path: "0/7/12", position: [0.123, -0.215, 0.183], rotation: [-0.282, 0.057, -1.205], scale: [1.251, 1.314, 1.359] },
      { path: "0/7/5", position: [-0.163, 0.02, 0.307] },
      { path: "0/7/6", position: [0.166, 0.014, 0.248] },
      { path: "0/7/5/0", position: [-0.033, -0.006, -0.049], rotation: [-0.01, 0.221, -0.018] },
      { path: "0/7/6/0", rotation: [-0.01, -0.221, 0.018] },
      { path: "0/7/13", position: [-0.165, 0.08, -0.117], rotation: [-0.085, -0.179, 0.46] },
      { path: "0/7/14", position: [0.165, 0.08, -0.117], rotation: [-0.085, 0.179, -0.46] },
      { path: "0/7/2", position: [0.001, -0.018, -0.053] },
      { path: "0/4/1", position: [0.046, -1.15, 0.119], scale: [1, 0.824, 1.335] },
      { path: "0/2/1", position: [-0.046, -1.15, 0.119], scale: [1, 0.824, 1.335] },
      { path: "0/5/1", position: [0.077, -1.15, 0.085], scale: [1, 0.93, 1.244] },
      { path: "0/5/0", position: [0.076, 0, -0.002] },
      { path: "0/3/0", position: [-0.076, 0, -0.002] },
      { path: "0/3/1", position: [-0.077, -1.15, 0.085], scale: [1, 0.93, 1.244] },
      { path: "0/0", position: [-0.004, 0, -0.095], scale: [1, 1, 1.147] },
      { path: "0/8", position: [-0.029, 0, -0.701], rotation: [0.322, -0.002, -0.013] },
      { path: "0/4/0", position: [0.057, 0, -0.002] },
      { path: "0/2/0", position: [-0.057, 0, -0.002] },
    ],
      added: [],
    },
  },
  {
    id: "critter-rabbit",
    name: "Rabbit",
    shape: "critter",
    params: {
      height: 1,
      width: 1,
      critterKind: "rabbit",
      furColor: 0xd9a468,
      bellyColor: 0xf4e3c6,
      accentColor: 0xe8a3a0,
    },
    parts: {
      edits: [
      { path: "0/6", position: [-0.243, 0.064, 0.42], scale: [1.17, 1, 1.262] },
      { path: "0/7", position: [0.243, 0.064, 0.42], scale: [1.17, 1, 1.262] },
      { path: "0/4", position: [-0.371, 1.28, 0.506], rotation: [2.246, -0.863, -0.371] },
      { path: "0/5", position: [0.371, 1.28, 0.506], rotation: [2.246, 0.863, 0.371] },
      { path: "0/8", position: [-0.004, 0.62, -0.817], rotation: [-0.669, -0.009, 0.026], scale: [0.827, 1.404, 0.886] },
      { path: "0/3/5", scale: [1.237, 0.825, 1] },
      { path: "0/3/6", scale: [1.237, 0.825, 1] },
    ],
      added: [],
    },
  },
  {
    id: "critter-raccoon",
    name: "Raccoon",
    shape: "critter",
    params: {
      height: 1,
      width: 1,
      critterKind: "raccoon",
      furColor: 0x8d8a86,
      bellyColor: 0xc9c4bc,
      accentColor: 0x2f2c2a,
    },
    parts: {
      edits: [
      { path: "0/3/3", position: [-0.172, 0.077, 0.384], rotation: [0, -0.181, 0], scale: [1, 0.792, 1] },
      { path: "0/3/4", position: [0.172, 0.077, 0.384], rotation: [0, 0.181, 0], scale: [1, 0.792, 1] },
      { path: "0/4", position: [-0.344, 1.28, 0.464], rotation: [1.901, -1.02, -0.535] },
      { path: "0/5", position: [0.549, 1.401, 0.334], rotation: [-1.859, -0.739, -2.27] },
      { path: "0/2", position: [-0.002, 1, 0.371], rotation: [-0.14, 0, 0.006], scale: [1, 0.839, 0.721] },
      { path: "0/3/5", position: [-0.261, 0.3, -0.016], rotation: [-0.015, -0.231, 0.847] },
      { path: "0/3/6", position: [0.261, 0.3, -0.016], rotation: [-0.015, 0.231, -0.847] },
      { path: "0/1", scale: [1, 0.665, 0.796] },
      { path: "0/0", position: [0.003, 0.68, 0.025], scale: [0.899, 0.773, 0.806] },
      { path: "0/3/7", position: [0, -0.245, 0.325], scale: [1.005, 0.914, 1.358] },
      { path: "0/3/1", position: [0, -0.13, 0.37], scale: [0.868, 0.764, 1.179] },
      { path: "0/3/3/0", position: [-0.029, 0.029, 0.002], rotation: [0, 0.099, 0] },
      { path: "0/3/4/0", position: [0.029, 0.029, 0.002], rotation: [0, -0.099, 0] },
      { path: "0/3/0", scale: [1, 0.885, 1] },
      { path: "0/6/0", position: [0.143, 0, -0.138] },
      { path: "0/6/1", position: [0.112, -0.015, 0.058] },
      { path: "0/7/0", position: [-0.143, 0, -0.138] },
      { path: "0/7/1", position: [-0.112, -0.015, 0.058] },
    ],
      added: [],
    },
  },
  {
    id: "critter-squirrel",
    name: "Squirrel",
    shape: "critter",
    params: {
      height: 1,
      width: 1,
      critterKind: "squirrel",
    },
  },
  {
    id: "critter-squirrel-explorer",
    name: "Squirrel Explorer",
    shape: "critter",
    params: {
      height: 1,
      width: 1,
      critterKind: "squirrelExplorer",
    },
  },
  {
    id: "flower-daisy",
    name: "Daisy",
    shape: "flower",
    params: {
      height: 1,
      width: 1,
      flowerKind: "daisy",
      petalColor: 0xfaf6ec,
      centerColor: 0xf2b632,
    },
  },
  {
    id: "flower-sunflower",
    name: "Sunflower",
    shape: "flower",
    params: {
      height: 1,
      width: 1,
      flowerKind: "sunflower",
      petalColor: 0xf5c518,
      centerColor: 0x6b4526,
    },
  },
  {
    id: "flower-rose",
    name: "Rose",
    shape: "flower",
    params: {
      height: 1,
      width: 1,
      flowerKind: "rose",
      petalColor: 0xd8384a,
      centerColor: 0x9c2333,
    },
  },
  {
    id: "flower-tulip",
    name: "Tulip",
    shape: "flower",
    params: {
      height: 1,
      width: 1,
      flowerKind: "tulip",
      petalColor: 0xd42f4c,
      centerColor: 0xf09aa8,
    },
  },
  {
    id: "flower-blossom",
    name: "Blossom",
    shape: "flower",
    params: {
      height: 1,
      width: 1,
      flowerKind: "blossom",
      petalColor: 0xb289de,
      centerColor: 0xf3e46a,
    },
  },
  {
    id: "nest-tree",
    name: "Nest Tree",
    shape: "nestTree",
    params: {
      height: 1,
      width: 1,
      foliageColors: [0x2e6337, 0x38703c, 0x25552e],
      trunkColor: 0x7a5433,
      showBird: true,
      birdColor: 0xe8622a,
    },
  },
  {
    id: "perched-bird",
    name: "Perched Bird",
    shape: "perchedBird",
    params: {
      height: 1,
      width: 1,
      trunkColor: 0x7a5433,
      birdColor: 0x2f7fd6,
      eyeColor: 15254090,
      bellyColor: 0x8fc4ea,
    },
    parts: {
      edits: [
      { path: "3/8", position: [-0.001, 0.129, 0.164], scale: [1, 1.885, 1] },
      { path: "3/7/0", color: 0xffffff },
      { path: "3/7/1", color: 0x000000 },
      { path: "3/1", position: [0.004, -0.027, 0.083], rotation: [0.294, 0.008, 0.056], color: 0xffffff },
      { path: "3/9/0", position: [-0.038, 0.002, -0.013] },
      { path: "3/10", position: [0.164, 0.036, -0.029] },
      { path: "3/10/0", position: [0.06, 0.002, -0.017] },
      { path: "3/5", position: [0.037, 0.258, -0.01] },
      { path: "3/3", position: [-0.037, 0.256, -0.01] },
      { path: "3/4", position: [0, 0.256, -0.01] },
      { path: "3/6/1", position: [-0.003, 0.001, 0.023], scale: [1, 1, 0.803] },
      { path: "3/6/2", position: [0.005, 0.014, 0.044], scale: [1, 1.04, 0.732] },
    ],
      added: [],
    },
  },
  {
    id: "flower-head-daisy",
    name: "Daisy Head",
    shape: "flowerHead",
    params: {
      height: 1,
      width: 1,
      flowerKind: "daisy",
      petalColor: 0xfaf6ec,
      centerColor: 0xf2b632,
    },
  },
  {
    id: "flower-head-sunflower",
    name: "Sunflower Head",
    shape: "flowerHead",
    params: {
      height: 1,
      width: 1,
      flowerKind: "sunflower",
      petalColor: 0xf5c518,
      centerColor: 0x6b4526,
    },
  },
  {
    id: "flower-head-rose",
    name: "Rose Head",
    shape: "flowerHead",
    params: {
      height: 1,
      width: 1,
      flowerKind: "rose",
      petalColor: 0xd8384a,
      centerColor: 0x9c2333,
    },
  },
  {
    id: "flower-head-tulip",
    name: "Tulip Head",
    shape: "flowerHead",
    params: {
      height: 1,
      width: 1,
      flowerKind: "tulip",
      petalColor: 0xd42f4c,
      centerColor: 0xf09aa8,
    },
  },
  {
    id: "flower-head-blossom",
    name: "Blossom Head",
    shape: "flowerHead",
    params: {
      height: 1,
      width: 1,
      flowerKind: "blossom",
      petalColor: 0xb289de,
      centerColor: 0xf3e46a,
    },
  },
  {
    id: "hedge-arch",
    name: "Hedge Arch",
    shape: "archway",
    params: {
      height: 1,
      width: 1,
      foliageColors: [0x3f8f3a, 0x367f33, 0x47993f],
      archOpening: 0.458,
      archRise: 1.29,
      archCurve: 2.1,
      archPier: 0.208,
      archDepth: 0.354,
      archCrown: 0.142,
      archRibbon: 0.6,
      archCrest: 0.55,
      archBlossoms: 8,
      archThreshold: false,
      archFence: true,
      blossomColor: 0xf4efe6,
      fenceColor: 0xa9743f,
      stoneColor: 0x9c9a90,
    },
  },
  {
    id: "hedge-arch-gothic",
    name: "Gothic Arbour",
    shape: "archway",
    params: {
      height: 1.18,
      width: 0.88,
      foliageColors: [0x367f33, 0x2f7330],
      archOpening: 0.44,
      archRise: 1.75,
      archCurve: 1.45,
      archPier: 0.16,
      archDepth: 0.24,
      archCrown: 0.11,
      archRibbon: 0.7,
      archCrest: 0.8,
      archBlossoms: 9,
      archThreshold: false,
      archFence: true,
      blossomColor: 0xe8709a,
      fenceColor: 0x8a5f34,
      stoneColor: 0x9c9a90,
    },
  },
  {
    id: "hedge-arch-topiary",
    name: "Topiary Gate",
    shape: "archway",
    params: {
      height: 0.82,
      width: 1.2,
      foliageColors: [0x47993f, 0x3f8f3a],
      archOpening: 0.58,
      archRise: 0.7,
      archCurve: 3.4,
      archPier: 0.3,
      archDepth: 0.4,
      archCrown: 0.22,
      archRibbon: 0.85,
      archCrest: 0,
      archBlossoms: 0,
      archThreshold: true,
      archFence: true,
      blossomColor: 0xf4efe6,
      fenceColor: 0xb78450,
      stoneColor: 0xa8a69c,
    },
  },
  {
    // IDEA-067 v3 — the Deep Forest's tunnel mouth. Two trees and one branch
    // from each, which is Nuno's own description; `archKind: "trees"` is what
    // makes it a different plant rather than a different green.
    //
    // THE CROWNS ARE SMALL AND THE TREES ARE TALL, and that is forced rather
    // than chosen — a broad canopy just above the branch springing shadows
    // the far half of the corridor from a camera that descends at 59 degrees,
    // which is the green-slab defect IDEA-067 already paid for once. See
    // `makeTreeArch`.
    //
    // No fence (the forest's palette has `fence: "none"`), no stone sill on
    // leaf litter, and no blossoms: the bark gives this arch the value step
    // the garden's all-green one had to borrow daisies for.
    id: "forest-arch",
    name: "Forest Arch",
    shape: "archway",
    params: {
      height: 1,
      width: 1,
      archKind: "trees",
      foliageColors: [0x2e6337, 0x285835, 0x38703c],
      trunkColor: 0x7a6142,
      archOpening: 0.45,
      archRise: 1.7,
      archCurve: 1.9,
      archPier: 0.17,
      archDepth: 0.3,
      archCrown: 0.05,
      archRibbon: 0.72,
      archCrest: 0.6,
      archBlossoms: 0,
      archThreshold: false,
      archFence: false,
    },
  },
  {
    // IDEA-080 — the Sunny Beach's tunnel mouth. A sea arch: the hedge arch's
    // construction in stone (rule 6 is about mass, not material), so every
    // shared dial below means what it means there. No fence and no sill: the
    // beach has neither, and a picket footing on sand is a garden.
    id: "sea-arch",
    name: "Sea Arch",
    shape: "archway",
    params: {
      height: 1,
      width: 1,
      archKind: "rocks",
      foliageColors: [0x3f8a5a, 0x8fbf5a],
      stoneColor: 0xa07a58,
      blossomColor: 0xe8789a,
      archOpening: 0.458,
      archRise: 1.29,
      archCurve: 2.3,
      archPier: 0.12,
      archDepth: 0.33,
      archCrown: 0.15,
      archRibbon: 0.7,
      archCrest: 0.6,
      archBlossoms: 3,
      archThreshold: false,
      archFence: false,
    },
  },
  {
    // IDEA-081: the City Park's tunnel mouth. An OPEN garden gate under an
    // arch of the maze wall's own shrub, flowering with the library's daisy,
    // rose and tulip heads. `archKind: "gate"` is the hedge arch plus a gate
    // and real flowers, so every shared dial means what it does there.
    //
    // The opening is wider than the Hedge Arch's (0.56 against 0.458) because
    // the gate's leaves hang just outboard of it: at 0.56 they clear the
    // one-tile corridor, so the beagle runs between them. No fence footing
    // (the gate is the fence) and no sill (the park's walk runs straight on).
    id: "park-gate",
    name: "Park Gate",
    shape: "archway",
    params: {
      height: 1,
      width: 1,
      archKind: "gate",
      foliageColors: [0x5aa348],
      fenceColor: 0xf2eee4,
      archOpening: 0.56,
      archRise: 1.2,
      archCurve: 2.1,
      archPier: 0.1,
      archDepth: 0.3,
      archCrown: 0.14,
      archRibbon: 0.65,
      archCrest: 0.45,
      archBlossoms: 12,
      archThreshold: false,
      archFence: false,
    },
  },
  {
    // IDEA-083: Night City's tunnel mouth. A neon gateway — slim steel posts,
    // a pink outer and cyan inner tube, marquee bulbs and a glowing bone on the
    // crown. Thin rather than low is how it keeps the corridor in view from
    // the play camera (archway.ts rule 6); see `makeNeonArch`.
    id: "neon-gateway",
    name: "Neon Gateway",
    shape: "archway",
    params: {
      height: 1,
      width: 1,
      archKind: "neon",
      foliageColors: [0xe860a8, 0x5fc8e8],
      blossomColor: 0xf4d060,
      trunkColor: 0x2e2a36,
      stoneColor: 0x6e6a74,
      archOpening: 0.5,
      archRise: 1.15,
      archCurve: 2.2,
      archPier: 0.08,
      archCrown: 0.05,
      archCrest: 1,
      archBlossoms: 12,
      archThreshold: false,
      archFence: false,
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
export const WALL_TOP_SHAPES: readonly PropBaseShape[] = [
  "bloom",
  "sign",
  // IDEA-060: the birdhouse works either on a wall top or on the board, which
  // is why the post is part of the birdhouse prop rather than something it
  // stands on.
  "birdhouse",
  // IDEA-065. `flower` used to be here and has MOVED OUT, which is Nuno's own
  // observation about the garden set: a stemmed flower reads correctly
  // standing in soil and reads wrong on a hedge crown, where its stem has
  // nothing to come out of. So the stemmed five became board props and
  // `flowerHead` — the same five heads with no stem and no leaves — is what
  // goes on a wall.
  "flowerHead",
  "perchedBird",
];

export function isWallTopProp(id: string): boolean {
  return WALL_TOP_SHAPES.includes(getPropDef(id).shape);
}
