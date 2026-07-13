// OWNER: board & themes editor (IDEA-030/031, dev-only).
// The placement-interaction layer for board mode: renders SLOT MARKERS on
// every candidate tile (the apron ring for props, wall ('#') tops for
// wall-top components), raycast-picks a slot on click, and owns the
// create/select/edit/remove flow against the current WorkingTheme's
// `placements`/`wallDecor` arrays. boardInspector.ts's "Placement" folder
// (built by main.ts wiring this module's selection callback) is the other
// half of the UX — this module is the 3D/interaction side, the inspector is
// the form side; main.ts glues the two together (see its "board mode"
// section).
//
// TEACHING NOTE — why individual meshes, not one InstancedMesh per slot
// state: board.ts's walls/hedge-decor use InstancedMesh because there are
// hundreds of THEM and they're static for a level's lifetime. Slot markers
// are a dev-tool overlay over a SMALL candidate set (an apron ring around a
// 19x21 maze is ~78 tiles minus a handful of tunnel exclusions; wall tiles
// are ~198) that needs PER-TILE identity for raycasting (which tile did I
// click?) and PER-TILE state that changes constantly as placements are
// added/removed/edited (empty vs filled vs selected, a different color each)
// — an InstancedMesh's per-instance color buffer CAN express that, but
// keeping ~300 addressable individual meshes in a `Map<"tx,ty", Mesh>` (the
// same key idiom board.ts's pelletMeshes already uses) is far simpler to
// reason about, and at this tile count (a dev-only tool, never shipped) the
// draw-call cost is irrelevant — this is a case where "the simplest correct
// thing" beats "the fastest possible thing" because the fast version buys
// nothing observable here.
//
// TEACHING NOTE — raycast gotcha #1 (stale matrices): THREE.Raycaster reads
// each object's `matrixWorld`, which three.js only recomputes on render (or
// via an explicit `updateMatrixWorld()`). Every marker here is a CHILD of
// `markerRoot`, which is added to `boardStage.boardRoot` once and never
// itself moved/scaled/rotated after creation — so as long as the marker's
// own local `position` was set before the NEXT render tick (true for every
// path in this module: markers are (re)built synchronously, never mid-frame
// after a render already ran), raycasting against them the same frame a
// click handler fires is safe without an extra manual updateMatrixWorld()
// call. Flagging this explicitly because it's the #1 raycast bug in a
// dynamically-rebuilt-marker scene: if a future change ever mutates a
// marker's position/parent chain and THEN immediately raycasts before any
// render happens, results will be stale.
//
// TEACHING NOTE — raycast gotcha #2 (click vs. drag): the editor's orbit
// camera (stage.ts's OrbitControls) fires the same pointerdown/pointerup
// sequence a marker click does — a user dragging to orbit must never
// register as a slot pick. picking.ts (character mode) already solved this
// with a small pixel-slop threshold between pointerdown and pointerup; this
// module reuses the exact same threshold/approach rather than inventing a
// second idiom, since both are raycast-driven single-click selections on the
// same canvas/camera.
import * as THREE from "three";
import { Grid, COLS, ROWS, worldX, worldZ } from "../game/grid";
import { isWallTopProp, DEFAULT_PROP_ID, WALL_TOP_SHAPES, PROP_LIBRARY } from "../game/props";
import type { WorkingTheme, WorkingPropPlacement, WorkingWallDecorPlacement } from "./boardCodegen";

const CLICK_SLOP_PX = 5;

/** Apron slot markers: a small flat SOLID disc laid on the apron floor. Wall
 *  slot markers: a smaller solid disc on the wall top — deliberately kept
 *  SOLID (not the visually-tempting annulus/ring shape, which would read as
 *  a more distinct "wall-top" affordance) because a raycast aimed at the
 *  dead center of a tile — exactly where tileToClientXY/every click in this
 *  module targets — passes straight through an annulus's hollow middle and
 *  MISSES it entirely (RingGeometry has no geometry in its inner radius);
 *  a solid CircleGeometry has no such hole, so a center-of-tile click always
 *  lands on it. (This cost a real debugging session to track down — a
 *  future reader tempted to swap this for a ring/donut for visual variety
 *  should keep this raycast gotcha in mind, or add a separate invisible
 *  solid disc underneath purely as the raycast target.) The two marker
 *  KINDS still read as visually distinct via a smaller radius for wall
 *  markers (0.11 vs apron's 0.16) — enough size difference to tell them
 *  apart without needing a shape that breaks raycasting. Kept as
 *  module-level shared geometries (not per-marker) — only their MATERIAL
 *  differs per state (empty/filled/selected), matching board.ts's own
 *  "shared geometry, per-state material" idiom for pellets.
 *
 *  IDEA-034 ("strong valid-slot highlighting"): an EMPTY marker additionally
 *  gets a slow opacity PULSE (see updatePulse below) driven by the same
 *  per-frame tick main.ts already threads through stage.onFrame for
 *  character-mode idle/highlight — "here's where you can put something" has
 *  to be unmistakable even against a busy themed floor/hedge texture, and a
 *  static, low-opacity dot (the pre-v4.2 look) reads as "faint scenery" more
 *  than "actionable slot". A FILLED marker does NOT pulse (it already reads
 *  as solid gold — motion is reserved for "you can act here", not "here's
 *  what already exists") and a SELECTED marker doesn't either (constant full
 *  opacity is itself already the strongest possible affordance). */
const APRON_MARKER_GEO = new THREE.CircleGeometry(0.16, 16);
const WALL_MARKER_GEO = new THREE.CircleGeometry(0.11, 16);
// A thin ring OUTLINE around each marker — MeshBasicMaterial disc fills alone
// still read a little soft against a similarly-toned floor/wall texture at a
// glance; a crisp white-ish rim (LineLoop, so it never falls into the
// raycast-gotcha above — it's decoration, not the click target) gives every
// slot a hard edge that reads instantly regardless of what's underneath.
const APRON_RING_GEO = new THREE.RingGeometry(0.16, 0.195, 20);
const WALL_RING_GEO = new THREE.RingGeometry(0.11, 0.135, 20);

const MARKER_Y_APRON = 0.02; // just proud of the floor plane (which sits at y=-0.01)
const MARKER_Y_WALL = 1.02; // WALL_H (1) + a hair, so it sits visibly on the hedge top, not embedded

// IDEA-034 follow-up (Nuno: "I just don't see the highlight places to add a
// new prop on the board"): the flat floor discs above are the CLICK TARGET,
// but from the board's steep top-down camera a disc lying flat on the ground
// is edge-compressed to a near-invisible sliver AND gets occluded by any prop
// standing on a neighbouring tile — so an empty slot was effectively
// invisible. The fix is a raised BEACON: a small bright upright diamond
// (octahedron) that HOVERS well above each EMPTY slot, standing up off the
// floor so it reads unmistakably from above and can never be hidden behind a
// prop. It shows only while a slot is empty (the "put something here" invite),
// pulses + bobs, and vanishes the instant the slot is filled/selected. Purely
// a visibility affordance — it is NOT raycastable (the flat disc under it
// stays the click target, keeping the click math and the raycast-hole gotcha
// fix above unchanged).
const BEACON_GEO = new THREE.OctahedronGeometry(0.12, 0);
const BEACON_Y_APRON = 0.62; // floats well clear of the floor + any low shrub
const BEACON_Y_WALL = 1.62; // same clearance above the hedge top
const BEACON_BOB = 0.09; // vertical bob amplitude (adds motion the eye catches from across the board)
// Rings sit a hair above their disc (both markers already erase z-fighting
// via depthWrite:false, but a tiny Y offset also keeps draw-order sane if
// depthWrite is ever revisited).
const MARKER_Y_APRON_RING = MARKER_Y_APRON + 0.001;
const MARKER_Y_WALL_RING = MARKER_Y_WALL + 0.001;

const COLOR_EMPTY = 0xbfe0ff; // bright, cool "you can place something here" — brightened from v4.1's faint 0x8fa0b8 so it reads as an actionable affordance, not background scenery
const COLOR_FILLED = 0xf2d43a; // warm gold — "something is planted here"
const COLOR_SELECTED = 0xff37a6; // the editor's one shared selection-pink (matches highlight.ts's HIGHLIGHT_COLOR)
const RING_COLOR = 0xffffff; // shared crisp white outline for every marker state (empty/filled/selected all get one — only the FILL differs)

// Empty-marker pulse: opacity oscillates between these two bounds — never
// fully transparent (it must stay findable even at the pulse's dim end) and
// never fully opaque (the peak still reads as "less solid" than a filled
// marker's constant OPACITY_FILLED, so the two states never trade places at
// the top of the pulse).
const OPACITY_EMPTY_MIN = 0.35;
const OPACITY_EMPTY_MAX = 0.68;
const PULSE_SPEED = 2.4; // rad/s — a calm, unmistakable breathe, not a strobe
const OPACITY_FILLED = 0.8;
const OPACITY_SELECTED = 1.0;
const RING_OPACITY_EMPTY = 0.85;
const RING_OPACITY_FILLED = 0.9;
const RING_OPACITY_SELECTED = 1.0;

// Empty markers are also drawn noticeably LARGER than their filled/selected
// scale (an enlarged, pulsing dot is the "you can put something here"
// affordance; once filled, the marker settles to its normal footprint so it
// reads as "this IS the planted thing's marker", not still inviting a click
// to swap it out from a distance). Applied as a uniform mesh.scale, not a
// second geometry, so paintMarker can flip it with the same per-tile mesh
// lookup every other state change already uses.
const EMPTY_MARKER_SCALE = 1.35;
const FILLED_MARKER_SCALE = 1.0;
const SELECTED_MARKER_SCALE = 1.15; // slightly larger than filled too — a selection should never be the smallest-reading state on the board

function markerMaterial(color: number, opacity: number): THREE.MeshBasicMaterial {
  // MeshBasicMaterial (unlit) rather than Standard — these are UI markers,
  // not scene-lit geometry, so they must read as a constant flat color
  // regardless of the atmosphere rig's current sun/hemi values (a themed
  // relighting must never make a marker unreadable).
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false, // markers sit ON TOP of the floor/wall visually but must never z-fight it
    side: THREE.DoubleSide,
  });
}

function ringMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: RING_COLOR,
    transparent: true,
    opacity: RING_OPACITY_EMPTY,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

function beaconMaterial(): THREE.MeshBasicMaterial {
  // Same unlit-UI rationale as markerMaterial: a themed relight must never
  // dim the beacon. depthTest stays ON (unlike the flat markers' depthWrite:
  // false) so a beacon is correctly hidden when it happens to pass behind a
  // taller wall/building from some orbit angle — it's a floating object in
  // the scene, not a screen-space overlay.
  return new THREE.MeshBasicMaterial({
    color: COLOR_EMPTY,
    transparent: true,
    opacity: OPACITY_EMPTY_MAX,
  });
}

export type PlacementSubMode = "apron" | "wall";

/** What's currently selected, if anything. `tile` is always present (every
 *  selection originates from a slot click); `existing` is the placement
 *  object itself, so the inspector can bind controls straight to its
 *  fields. `existing` is normally non-null the instant a selection exists —
 *  clicking an EMPTY slot auto-creates a default placement there before
 *  selecting it (see onPointerUp/createDefaultPlacement) — the one moment
 *  it's genuinely null is right after removeSelected() clears a placement
 *  but leaves that same tile selected (so the inspector can show "empty —
 *  click a prop below to plant one" instead of snapping the selection away
 *  entirely), or transiently for a not-yet-created selection object
 *  constructed just before assignProp's create-if-absent branch runs. */
export interface PlacementSelection {
  subMode: PlacementSubMode;
  tile: readonly [number, number];
  existing: WorkingPropPlacement | WorkingWallDecorPlacement | null;
}

export interface BoardPlacementController {
  /** (Re)loads slot markers + selection for a freshly-loaded/cloned working
   *  theme — call after every base-theme swap (main.ts's loadBaseTheme) AND
   *  after any edit that adds/removes/changes a placement, so marker COLORS
   *  (empty/filled) always reflect `theme.placements`/`theme.wallDecor`
   *  exactly. Clears the current selection (a stale selection could
   *  reference a placement that a base-theme swap just discarded). */
  syncFromTheme(theme: WorkingTheme): void;
  /** Switches which candidate set is interactive/visible — "Props (apron)"
   *  vs "Wall components" (see boardTree.ts's two rows). Clears selection
   *  (a selection from one sub-mode is meaningless in the other — different
   *  candidate tiles, different placement array). */
  setSubMode(mode: PlacementSubMode): void;
  getSubMode(): PlacementSubMode;
  /** Current selection, or null if nothing is selected. */
  getSelection(): PlacementSelection | null;
  /** Programmatically clears the selection (e.g. leaving board mode
   *  entirely) without touching any marker's filled/empty state. */
  clearSelection(): void;
  /** Assigns `propId` to the CURRENT selection — the inspector's "prop"
   *  dropdown's onChange calls this to swap which library prop an already-
   *  selected placement uses. (An empty-slot click never reaches this path
   *  in practice — clicking an empty slot auto-creates a default placement
   *  immediately, see onPointerUp's createDefaultPlacement — but this
   *  method still creates-if-absent defensively so it stays a complete,
   *  correct primitive on its own rather than silently assuming that
   *  precondition.) Throws if nothing is selected at all. Returns the
   *  placement now selected, so the inspector can immediately rebind
   *  controls to it. */
  assignProp(propId: string): WorkingPropPlacement | WorkingWallDecorPlacement;
  /** Removes the currently-selected placement (splices it out of the
   *  working theme's array) and clears the selection. No-op if nothing is
   *  selected or the selection is already an empty slot. */
  removeSelected(): void;
  /** Nudges the CURRENTLY SELECTED apron placement's offset by (dx, dz),
   *  clamped to the editor's own -0.5..0.5 range (matches the inspector's
   *  slider bounds so a keyboard nudge can never desync from what the
   *  slider would show) — the brief's "keyboard nudge of the selected
   *  placement's offset (arrows)". No-op for a wall-mode selection (wall
   *  placements have no offset field) or when nothing is selected. Returns
   *  true if it actually nudged something (so the caller knows whether to
   *  refresh the inspector's displays). */
  nudgeSelectedOffset(dx: number, dz: number): boolean;
  /** IDEA-034: nudges the CURRENTLY SELECTED placement's `rotationY` by
   *  `delta` radians, wrapped into [0, 2π) (matches the inspector's
   *  rotation slider range exactly — see boardInspector.ts's ROTATION_MIN/
   *  MAX — so a keyboard nudge can never walk the value outside what the
   *  slider itself could ever show). Works for BOTH sub-modes (unlike
   *  nudgeSelectedOffset, which is apron-only — every placement, apron or
   *  wall, has a rotationY field). No-op (returns false) when nothing is
   *  selected or the selection is still an empty slot (no placement object
   *  to rotate yet). This is rotation's FIRST-CLASS keyboard path (Nuno:
   *  "I need to rotate them") — see main.ts's `[`/`]` handler, which is the
   *  one caller. */
  nudgeSelectedRotation(delta: number): boolean;
  /** IDEA-034: nudges the CURRENTLY SELECTED placement's `scale` by `delta`,
   *  clamped to the inspector's own 0.4..2 range (boardInspector.ts's
   *  SCALE_MIN/MAX) — same "keyboard nudge can never desync from the
   *  slider" discipline as the other two nudge methods. Works for both
   *  sub-modes (scale exists on both WorkingPropPlacement and
   *  WorkingWallDecorPlacement). No-op (returns false) when nothing is
   *  selected or the selection is an empty slot. */
  nudgeSelectedScale(delta: number): boolean;
  /** Call after ANY edit to the selected placement's fields (offset/
   *  rotationY/scale/propId) made through some OTHER path (e.g. the
   *  inspector's sliders writing directly into the placement object) —
   *  re-syncs just this one marker's filled color/visibility without a full
   *  syncFromTheme rebuild. Also re-triggers the live board rebuild via the
   *  `onChange` callback passed to create(). */
  refreshMarkerFor(tile: readonly [number, number]): void;
  /** Gates whether canvas clicks are interpreted as slot picks at all — set
   *  to `true` only while board mode is the ACTIVE workbench mode (main.ts
   *  flips this in its mode-switch, exactly mirroring how it already gates
   *  character-mode picking via attachPicking's `getRoot` callback
   *  returning null outside character mode). Necessary because the marker
   *  meshes live under `boardStage.boardRoot`, which is only ever toggled
   *  `visible = false` (not removed) when leaving board mode — and
   *  three.js's Raycaster does NOT consult `Object3D.visible` at all (only
   *  `.layers` — see Raycaster.js's `intersect()`), so an invisible marker
   *  is still perfectly raycastable; without this explicit gate, a click on
   *  the character-mode viewport at the same screen position a board slot
   *  happens to occupy would silently mutate the working theme while the
   *  user can't even see the board. */
  setPickingEnabled(on: boolean): void;
  /** IDEA-034: advances the empty-slot pulse animation — call once per
   *  render frame with a monotonically increasing clock `t` (seconds), same
   *  shape as stage.ts's own onFrame(dt, t) callback and Highlighter.update().
   *  Cheap even when board mode isn't active (main.ts calls this
   *  unconditionally from its single shared onFrame callback — see that
   *  callback's own "gate on mode" comment for why an explicit mode check
   *  there would be redundant defense-in-depth rather than a correctness
   *  requirement): every marker's opacity write is a few flops, and there are
   *  only ~300 of them total (apron + wall combined) — nowhere near enough to
   *  matter next to a real render call, so this needs no internal "is board
   *  mode even active" short-circuit of its own. */
  updatePulse(t: number): void;
  /** TEST-SUPPORT ONLY (also handy for future debugging): reads back one
   *  marker's CURRENT rendered visual state — disc opacity/color and uniform
   *  scale — so scripts/test-editor-board.ts can assert that an empty slot
   *  actually reads differently from a filled one (the brief's "Empty vs
   *  filled slots must read differently at a glance") without needing a
   *  bespoke pixel-level scene inspection from the test file itself (which
   *  would have to reach into this module's own private marker Maps to do
   *  the same lookup this method already performs internally in
   *  paintMarker). Returns null for a tile with no marker at all (shouldn't
   *  happen for any of apronCandidates()/wallCandidates()'s own tiles, but
   *  defensive against a stray test typo). */
  getMarkerState(tile: readonly [number, number], subMode: PlacementSubMode): { opacity: number; color: number; scale: number } | null;
  /** Attaches/detaches the canvas pointer listeners — call dispose() once,
   *  on... well, this editor page never tears down, but included for
   *  symmetry with the rest of this codebase's dispose-what-you-own
   *  discipline (mirrors boardStage.ts's own dispose()). */
  dispose(): void;
}

/** Every apron candidate tile — the 1-tile floor ring OUTSIDE the maze
 *  footprint, minus the tiles immediately flanking a tunnel-row exit. This
 *  is the EXACT enumeration board.ts's pre-v4.1 buildProps used for its own
 *  density-scatter candidate pool (see the v4.0 "New Territory" git history
 *  — this rule predates the v4.1 explicit-placement rework and is reused
 *  here verbatim, per the task brief: "reuse the same exclusion the old
 *  buildProps used"), so every hand-placeable apron slot in this editor is
 *  a spot the ORIGINAL density system would also have considered valid —
 *  no new "you can place a shrub in a tunnel mouth" surprise for a
 *  hand-authored theme.
 */
export function apronCandidates(grid: Grid): Array<[number, number]> {
  const excluded = new Set<string>();
  grid.tunnelRows.forEach((ty) => {
    ([-1, COLS] as const).forEach((tx) => {
      excluded.add(`${tx},${ty - 1}`);
      excluded.add(`${tx},${ty}`);
      excluded.add(`${tx},${ty + 1}`);
    });
  });

  const candidates: Array<[number, number]> = [];
  for (let ty = -1; ty <= ROWS; ty++) {
    for (let tx = -1; tx <= COLS; tx++) {
      const isInterior = tx >= 0 && tx < COLS && ty >= 0 && ty < ROWS;
      if (isInterior) continue;
      const key = `${tx},${ty}`;
      if (excluded.has(key)) continue;
      candidates.push([tx, ty]);
    }
  }
  return candidates;
}

/** Every wall ('#') tile — the candidate set for wall-top components
 *  (IDEA-031). Unlike the apron ring, there's no exclusion rule here: any
 *  wall tile can carry a lamp/sign/bloom (wall-top props are always in the
 *  "low" PROP_HEIGHT_CLASS per board.ts's buildWallDecor doc comment, so
 *  there's no camera-blocking concern the way tall apron props have). */
export function wallCandidates(grid: Grid): Array<[number, number]> {
  const candidates: Array<[number, number]> = [];
  grid.cells.forEach((row, ty) => row.forEach((c, tx) => {
    if (c === "#") candidates.push([tx, ty]);
  }));
  return candidates;
}

/** The default prop id a fresh placement gets — DEFAULT_PROP_ID ("shrub")
 *  for an apron slot (a sensible ground default, and already the library's
 *  own documented fallback def), or the first WALL_TOP_SHAPES-matching
 *  library entry for a wall slot (currently "bloom" — PROP_LIBRARY's first
 *  wall-top def, in library order, so this stays correct even if the
 *  library's wall-top entries are reordered). */
function defaultPropIdFor(subMode: PlacementSubMode): string {
  if (subMode === "apron") return DEFAULT_PROP_ID;
  const found = PROP_LIBRARY.find((d) => WALL_TOP_SHAPES.includes(d.shape));
  return found?.id ?? DEFAULT_PROP_ID;
}

/** Library prop ids valid for `subMode` — apron sub-mode offers every def
 *  whose shape is NOT a wall-top shape (a building/tree/streetlight makes no
 *  sense stacked on a hedge top the same size as a flower), wall sub-mode
 *  offers only WALL_TOP_SHAPES defs (bloom/sign) — mirrors props.ts's own
 *  `isWallTopProp` split exactly, just listing the OPPOSITE set for apron so
 *  the two dropdowns never overlap. */
export function propOptionsFor(subMode: PlacementSubMode): Array<{ id: string; name: string }> {
  return PROP_LIBRARY.filter((d) => (subMode === "wall") === isWallTopProp(d.id)).map((d) => ({ id: d.id, name: d.name }));
}

const OFFSET_MIN = -0.5;
const OFFSET_MAX = 0.5;
// IDEA-034: SAME bounds as boardInspector.ts's ROTATION_MIN(0)/MAX and
// SCALE_MIN/MAX sliders — duplicated here (not imported) because
// boardInspector.ts imports FROM this module (propOptionsFor/
// PlacementSelection), and this module must never import back from it (that
// would be a circular import between the two halves of the placement UX —
// see boardPlacement.ts's own header on the "3D/interaction vs form" split).
// Kept in exact numeric lockstep by convention + the doc comments on both
// sides cross-referencing each other; a future bounds change must edit both.
const ROTATION_MAX = Math.PI * 2;
const SCALE_MIN = 0.4;
const SCALE_MAX = 2;

function clampOffset(v: number): number {
  return Math.max(OFFSET_MIN, Math.min(OFFSET_MAX, v));
}

/** Wraps a rotation delta into [0, 2π) — matches the inspector's slider range
 *  exactly (see boardInspector.ts's `.add(placement, "rotationY", 0, 2π, …)`)
 *  so a keyboard nudge can spin all the way around in either direction
 *  without ever landing on a value the slider itself couldn't represent
 *  (unlike offset/scale, rotation is naturally circular — wrapping, not
 *  clamping, is the correct behavior: nudging past 2π should land just past
 *  0, not get stuck at the ceiling). */
function wrapRotation(v: number): number {
  const twoPi = ROTATION_MAX;
  return ((v % twoPi) + twoPi) % twoPi;
}

function clampScale(v: number): number {
  return Math.max(SCALE_MIN, Math.min(SCALE_MAX, v));
}

/** Builds the placement controller: slot markers on `boardStage.boardRoot`
 *  (the SAME parent buildBoard adds walls/floor/props into, so markers sit
 *  in the correct board-local coordinate space — worldX/worldZ already
 *  account for the OX/OZ centering offset), raycast picking against
 *  `canvas`/`camera`, and the create/select/edit/remove flow against
 *  whatever WorkingTheme `onChange` most recently synced in. `onChange` is
 *  called after every mutation that should re-apply the live board
 *  (main.ts's rebuildBoardFromWorkingTheme) — this module never touches
 *  THREE.Object3D board meshes directly, only the WorkingTheme's data
 *  arrays plus its OWN marker meshes, keeping the "logic vs render" split
 *  exactly where every other editor module already draws it (this module
 *  IS the render/interaction layer; the working theme IS the data). */
export function createBoardPlacement(
  canvas: HTMLCanvasElement,
  camera: THREE.PerspectiveCamera,
  parent: THREE.Object3D,
  grid: Grid,
  onChange: () => void,
  onSelectionChange: (sel: PlacementSelection | null) => void,
): BoardPlacementController {
  const markerRoot = new THREE.Group();
  markerRoot.userData.editorOverlay = true; // never selectable by character-mode picking if the roots ever overlapped
  parent.add(markerRoot);

  const apronMarkers = new Map<string, THREE.Mesh>();
  const wallMarkers = new Map<string, THREE.Mesh>();
  // IDEA-034: which markers are CURRENTLY in the "empty" state (and therefore
  // pulsing) — populated/pruned by paintMarker every time a marker's state
  // changes, so updatePulse's per-frame loop only ever touches the small live
  // subset of ~300 total markers that actually needs animating (a filled or
  // selected marker's opacity is constant, so paying a sin() + material write
  // for it every frame would be pure waste). Keyed the same "mode,tx,ty" way
  // `markersFor(mode)`'s own Maps are, so a single Set (not one per sub-mode)
  // is enough.
  const pulsingMarkers = new Set<string>();

  const apronTiles = apronCandidates(grid);
  const wallTiles = wallCandidates(grid);

  /** Builds one marker: the raycast-target disc (unchanged shape/role from
   *  v4.1) plus a non-raycast-target ring OUTLINE (IDEA-034 — see
   *  APRON_RING_GEO's doc comment for why it's a separate mesh rather than
   *  baked into the disc's own material). The ring is a SIBLING of the disc
   *  under `markerRoot` (both positioned independently in the same
   *  board-local space `worldX`/`worldZ` already resolve to) rather than a
   *  child of it — parenting the ring to the disc would mean composing the
   *  ring's own -90° flattening rotation through the disc's IDENTICAL -90°
   *  rotation a second time (net -180°, i.e. facing the wrong way) and would
   *  also silently up-scale the ring's tiny Y offset whenever paintMarker
   *  scales the disc for its empty/filled/selected state (EMPTY_MARKER_SCALE
   *  etc. — see that constant's doc comment) — two footguns a plain sibling
   *  avoids entirely, at the cost of nothing (the ring never needs to move
   *  independently of the disc once placed). Stashed on
   *  `mesh.userData.ring` so paintMarker/updatePulse can reach it via the
   *  SAME per-tile mesh lookup every other state change already uses (no
   *  second Map to keep in sync). */
  function buildMarker(geo: THREE.CircleGeometry, ringGeo: THREE.RingGeometry, ringY: number, tx: number, ty: number, subModeKind: PlacementSubMode, y: number, beaconY: number): THREE.Mesh {
    const mesh = new THREE.Mesh(geo, markerMaterial(COLOR_EMPTY, OPACITY_EMPTY_MIN));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(worldX(tx), y, worldZ(ty));
    mesh.userData.slotTile = [tx, ty];
    mesh.userData.slotSubMode = subModeKind;
    mesh.visible = false; // apron is the default sub-mode below, flipped on immediately

    const ring = new THREE.Mesh(ringGeo, ringMaterial());
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(worldX(tx), ringY, worldZ(ty));
    ring.userData.editorOverlay = true;
    ring.visible = false; // mirrors the disc's own visibility exactly (see setVisibility below)
    mesh.userData.ring = ring;

    // The raised empty-slot beacon (see BEACON_GEO's doc comment). A sibling
    // of the disc (not a child) for the same compose-avoidance reasons the
    // ring is — its own upright orientation must not inherit the disc's -90°
    // flatten. Its resting Y is stashed so updatePulse can bob it around that
    // baseline. Starts hidden; paintMarker shows it only for empty slots.
    const beacon = new THREE.Mesh(BEACON_GEO, beaconMaterial());
    beacon.position.set(worldX(tx), beaconY, worldZ(ty));
    beacon.userData.editorOverlay = true;
    beacon.userData.baseY = beaconY;
    beacon.visible = false;
    mesh.userData.beacon = beacon;
    return mesh;
  }

  apronTiles.forEach(([tx, ty]) => {
    const mesh = buildMarker(APRON_MARKER_GEO, APRON_RING_GEO, MARKER_Y_APRON_RING, tx, ty, "apron", MARKER_Y_APRON, BEACON_Y_APRON);
    markerRoot.add(mesh, mesh.userData.ring as THREE.Mesh, mesh.userData.beacon as THREE.Mesh);
    apronMarkers.set(`${tx},${ty}`, mesh);
  });

  wallTiles.forEach(([tx, ty]) => {
    const mesh = buildMarker(WALL_MARKER_GEO, WALL_RING_GEO, MARKER_Y_WALL_RING, tx, ty, "wall", MARKER_Y_WALL, BEACON_Y_WALL);
    markerRoot.add(mesh, mesh.userData.ring as THREE.Mesh, mesh.userData.beacon as THREE.Mesh);
    wallMarkers.set(`${tx},${ty}`, mesh);
  });

  let subMode: PlacementSubMode = "apron";
  let currentTheme: WorkingTheme | null = null;
  let selection: PlacementSelection | null = null;

  function markersFor(mode: PlacementSubMode): Map<string, THREE.Mesh> {
    return mode === "apron" ? apronMarkers : wallMarkers;
  }

  function findPlacement(theme: WorkingTheme, mode: PlacementSubMode, tx: number, ty: number): WorkingPropPlacement | WorkingWallDecorPlacement | null {
    if (mode === "apron") return theme.placements.find((p) => p.tile[0] === tx && p.tile[1] === ty) ?? null;
    return theme.wallDecor.find((p) => p.tile[0] === tx && p.tile[1] === ty) ?? null;
  }

  /** Recolors/rescales ONE marker (disc + ring) from the current theme's
   *  data — shared by the full syncFromTheme rebuild and refreshMarkerFor's
   *  targeted single-marker update. Selection takes priority over
   *  filled/empty (a selected marker is always pink, whether or not it
   *  holds a placement yet).
   *
   *  IDEA-034: also (a) sets the marker's uniform SCALE per-state (empty
   *  markers read larger — see EMPTY_MARKER_SCALE's doc comment) and (b)
   *  keeps `pulsingMarkers` in sync — added here on entering the empty
   *  state, removed on leaving it — rather than recomputed from scratch on
   *  every updatePulse tick, so the animation loop stays O(pulsing markers)
   *  instead of O(all markers) every single frame. */
  function paintMarker(mode: PlacementSubMode, tx: number, ty: number): void {
    const mesh = markersFor(mode).get(`${tx},${ty}`);
    if (!mesh || !currentTheme) return;
    const isSelected = selection !== null && selection.subMode === mode && selection.tile[0] === tx && selection.tile[1] === ty;
    const filled = findPlacement(currentTheme, mode, tx, ty) !== null;
    const mat = mesh.material as THREE.MeshBasicMaterial;
    const ring = mesh.userData.ring as THREE.Mesh;
    const ringMat = ring.material as THREE.MeshBasicMaterial;
    const beacon = mesh.userData.beacon as THREE.Mesh;
    const pulseKey = `${mode},${tx},${ty}`;

    if (isSelected) {
      mat.color.setHex(COLOR_SELECTED);
      mat.opacity = OPACITY_SELECTED;
      ringMat.opacity = RING_OPACITY_SELECTED;
      mesh.scale.setScalar(SELECTED_MARKER_SCALE);
      ring.scale.setScalar(SELECTED_MARKER_SCALE); // ring is a SIBLING, not a child (see buildMarker's doc comment) — its scale must be set independently to stay visually matched to the disc
      beacon.visible = false; // a selected slot is no longer "empty & inviting"
      pulsingMarkers.delete(pulseKey);
    } else if (filled) {
      mat.color.setHex(COLOR_FILLED);
      mat.opacity = OPACITY_FILLED;
      ringMat.opacity = RING_OPACITY_FILLED;
      mesh.scale.setScalar(FILLED_MARKER_SCALE);
      ring.scale.setScalar(FILLED_MARKER_SCALE);
      beacon.visible = false; // something's planted here — no invite beacon
      pulsingMarkers.delete(pulseKey);
    } else {
      mat.color.setHex(COLOR_EMPTY);
      mat.opacity = OPACITY_EMPTY_MAX; // updatePulse overwrites this every frame while pulsing is active; set to a sane default so a marker never flashes at a stale opacity for one frame before the next tick
      ringMat.opacity = RING_OPACITY_EMPTY;
      mesh.scale.setScalar(EMPTY_MARKER_SCALE);
      ring.scale.setScalar(EMPTY_MARKER_SCALE);
      // The raised beacon is the thing that actually makes an empty slot
      // visible from the top-down board camera — show it, but only while THIS
      // sub-mode's markers are the ones on screen. Computed from `subMode`
      // directly (NOT from `mesh.visible`, which may not have been flipped on
      // yet at paint time — paintAll can run before setVisibility on a fresh
      // theme sync), so an empty in-submode slot always gets its beacon
      // regardless of paint/visibility call order.
      beacon.visible = mode === subMode;
      pulsingMarkers.add(pulseKey);
    }
  }

  function paintAll(): void {
    apronTiles.forEach(([tx, ty]) => paintMarker("apron", tx, ty));
    wallTiles.forEach(([tx, ty]) => paintMarker("wall", tx, ty));
  }

  function setVisibility(): void {
    apronMarkers.forEach((m) => {
      m.visible = subMode === "apron";
      (m.userData.ring as THREE.Mesh).visible = m.visible; // ring is a sibling — must be toggled explicitly, not inherited
      // The beacon's own visibility is decided by paintMarker (empty-only) —
      // but it must ALSO be forced off whenever its disc is off (wrong
      // sub-mode). paintAll() runs right after this in every caller, so an
      // empty in-submode beacon gets re-shown there; here we only ever hide.
      if (!m.visible) (m.userData.beacon as THREE.Mesh).visible = false;
    });
    wallMarkers.forEach((m) => {
      m.visible = subMode === "wall";
      (m.userData.ring as THREE.Mesh).visible = m.visible;
      if (!m.visible) (m.userData.beacon as THREE.Mesh).visible = false;
    });
  }

  function setSelection(next: PlacementSelection | null): void {
    const prev = selection;
    selection = next;
    // Repaint the two markers whose "isSelected" state just changed (the
    // outgoing selection, if any, and the incoming one) rather than a full
    // paintAll() — cheap and correct, since selection can only ever move
    // between at most two tiles per call.
    if (prev) paintMarker(prev.subMode, prev.tile[0], prev.tile[1]);
    if (next) paintMarker(next.subMode, next.tile[0], next.tile[1]);
    onSelectionChange(selection);
  }

  // --- raycast picking (mirrors picking.ts's click-vs-drag threshold) ---
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let downX = 0;
  let downY = 0;
  // Starts false: markers exist (and are raycastable — see setPickingEnabled's
  // doc comment on the interface for why `.visible` alone can't gate this) the
  // instant this controller is constructed, which happens once, up front, in
  // main.ts's board-mode section — well before the user has ever switched
  // into board mode. main.ts's setMode flips this true/false in lockstep with
  // boardStage.setVisible.
  let pickingEnabled = false;

  function onPointerDown(e: PointerEvent): void {
    downX = e.clientX;
    downY = e.clientY;
  }

  function onPointerUp(e: PointerEvent): void {
    if (!pickingEnabled || !currentTheme) return;
    if (Math.abs(e.clientX - downX) > CLICK_SLOP_PX || Math.abs(e.clientY - downY) > CLICK_SLOP_PX) return;

    const rect = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    const active = markersFor(subMode);
    const hits = raycaster.intersectObjects([...active.values()], false);
    if (hits.length === 0) return;
    const hit = hits[0].object;
    const tile = hit.userData.slotTile as [number, number] | undefined;
    if (!tile) return;

    const existing = findPlacement(currentTheme, subMode, tile[0], tile[1]);
    if (existing) {
      // FILLED slot: select the existing placement for editing (the brief's
      // "Selecting a FILLED slot selects that placement for editing").
      setSelection({ subMode, tile, existing });
      return;
    }
    // EMPTY slot: auto-create a placement right here with a sensible default
    // prop + defaults (offset [0,0]/rotationY 0/scale 1) and select it — the
    // brief's "creates a placement at that tile with sensible defaults...
    // and renders it live". The inspector's "prop" dropdown (bound to this
    // same selection) is then how you swap which library prop it uses,
    // reusing assignProp for BOTH "the very first pick" and "swap it later"
    // rather than needing a separate two-step "pick empty, then pick a prop
    // from a dropdown before anything exists" flow.
    createDefaultPlacement(subMode, tile);
  }

  function createDefaultPlacement(mode: PlacementSubMode, tile: [number, number]): void {
    if (!currentTheme) return;
    const propId = defaultPropIdFor(mode);
    if (mode === "apron") {
      const placement: WorkingPropPlacement = { propId, tile, offset: [0, 0], rotationY: 0, scale: 1 };
      currentTheme.placements.push(placement);
      setSelection({ subMode: "apron", tile, existing: placement });
    } else {
      const placement: WorkingWallDecorPlacement = { propId, tile, rotationY: 0, scale: 1 };
      currentTheme.wallDecor.push(placement);
      setSelection({ subMode: "wall", tile, existing: placement });
    }
    paintMarker(mode, tile[0], tile[1]);
    onChange();
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointerup", onPointerUp);

  return {
    syncFromTheme(theme: WorkingTheme): void {
      currentTheme = theme;
      selection = null;
      setVisibility(); // ensure discs/rings match the current sub-mode BEFORE painting (paintMarker's beacon-visibility now reads subMode directly, but keep disc visibility correct too)
      paintAll();
      onSelectionChange(null);
    },
    setSubMode(mode: PlacementSubMode): void {
      if (subMode === mode) return;
      subMode = mode;
      setVisibility();
      // Repaint EVERY marker of the now-visible sub-mode so its empty-slot
      // beacons come back on (setVisibility only ever hides beacons; the
      // per-tile "show if empty" decision lives in paintMarker via paintAll).
      // Must run before setSelection(null), which then only touches the one
      // outgoing-selected tile.
      paintAll();
      setSelection(null);
    },
    getSubMode(): PlacementSubMode {
      return subMode;
    },
    getSelection(): PlacementSelection | null {
      return selection;
    },
    clearSelection(): void {
      setSelection(null);
    },
    assignProp(propId: string) {
      if (!selection || !currentTheme) throw new Error("boardPlacement: assignProp called with no selection");
      const [tx, ty] = selection.tile;

      if (selection.subMode === "apron") {
        let placement = selection.existing as WorkingPropPlacement | null;
        if (!placement) {
          placement = { propId, tile: [tx, ty], offset: [0, 0], rotationY: 0, scale: 1 };
          currentTheme.placements.push(placement);
        } else {
          placement.propId = propId;
        }
        setSelection({ subMode: "apron", tile: [tx, ty], existing: placement });
        paintMarker("apron", tx, ty);
        onChange();
        return placement;
      }

      let placement = selection.existing as WorkingWallDecorPlacement | null;
      if (!placement) {
        placement = { propId, tile: [tx, ty], rotationY: 0, scale: 1 };
        currentTheme.wallDecor.push(placement);
      } else {
        placement.propId = propId;
      }
      setSelection({ subMode: "wall", tile: [tx, ty], existing: placement });
      paintMarker("wall", tx, ty);
      onChange();
      return placement;
    },
    removeSelected(): void {
      if (!selection || !currentTheme || !selection.existing) return;
      const [tx, ty] = selection.tile;
      if (selection.subMode === "apron") {
        const idx = currentTheme.placements.indexOf(selection.existing as WorkingPropPlacement);
        if (idx >= 0) currentTheme.placements.splice(idx, 1);
      } else {
        const idx = currentTheme.wallDecor.indexOf(selection.existing as WorkingWallDecorPlacement);
        if (idx >= 0) currentTheme.wallDecor.splice(idx, 1);
      }
      setSelection({ subMode: selection.subMode, tile: [tx, ty], existing: null });
      paintMarker(selection.subMode, tx, ty);
      onChange();
    },
    nudgeSelectedOffset(dx: number, dz: number): boolean {
      if (!selection || selection.subMode !== "apron" || !selection.existing) return false;
      const placement = selection.existing as WorkingPropPlacement;
      placement.offset[0] = clampOffset(placement.offset[0] + dx);
      placement.offset[1] = clampOffset(placement.offset[1] + dz);
      onChange();
      return true;
    },
    nudgeSelectedRotation(delta: number): boolean {
      // Works for EITHER sub-mode — both placement shapes carry rotationY —
      // unlike nudgeSelectedOffset above, which is apron-only by necessity
      // (wall placements have no offset field at all).
      if (!selection || !selection.existing) return false;
      selection.existing.rotationY = wrapRotation(selection.existing.rotationY + delta);
      onChange();
      return true;
    },
    nudgeSelectedScale(delta: number): boolean {
      if (!selection || !selection.existing) return false;
      selection.existing.scale = clampScale(selection.existing.scale + delta);
      onChange();
      return true;
    },
    refreshMarkerFor(tile: readonly [number, number]): void {
      if (!selection) return;
      paintMarker(selection.subMode, tile[0], tile[1]);
    },
    setPickingEnabled(on: boolean): void {
      pickingEnabled = on;
    },
    getMarkerState(tile: readonly [number, number], subMode: PlacementSubMode) {
      const mesh = markersFor(subMode).get(`${tile[0]},${tile[1]}`);
      if (!mesh) return null;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      return { opacity: mat.opacity, color: mat.color.getHex(), scale: mesh.scale.x };
    },
    updatePulse(t: number): void {
      if (pulsingMarkers.size === 0) return;
      // A single sin() evaluated once per frame (not once per marker) — every
      // currently-empty marker breathes perfectly in PHASE with every other
      // one (a deliberate choice: a scene of independently-phased blinking
      // dots reads as noisy/distracting "twinkling", while a single shared
      // wave reads as one calm, coherent "these are all the same kind of
      // thing" pulse — exactly the affordance this feature needs).
      const wave = (Math.sin(t * PULSE_SPEED) + 1) / 2; // 0..1
      const opacity = OPACITY_EMPTY_MIN + wave * (OPACITY_EMPTY_MAX - OPACITY_EMPTY_MIN);
      // Beacon bob: a vertical offset on the same wave, so the disc's opacity
      // pulse and the beacon's rise/fall read as one coherent breath.
      const bob = BEACON_BOB * (wave - 0.5) * 2; // -BEACON_BOB .. +BEACON_BOB
      for (const key of pulsingMarkers) {
        const [modeStr, txStr, tyStr] = key.split(",");
        const mesh = markersFor(modeStr as PlacementSubMode).get(`${txStr},${tyStr}`);
        if (!mesh) continue;
        (mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
        const beacon = mesh.userData.beacon as THREE.Mesh;
        if (beacon.visible) {
          beacon.position.y = (beacon.userData.baseY as number) + bob;
          beacon.rotation.y = t * 1.5; // slow spin — a turning diamond is unmistakably "interactive", never mistaken for scenery
        }
      }
    },
    dispose(): void {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerup", onPointerUp);
    },
  };
}
