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
 *  "shared geometry, per-state material" idiom for pellets. */
const APRON_MARKER_GEO = new THREE.CircleGeometry(0.16, 16);
const WALL_MARKER_GEO = new THREE.CircleGeometry(0.11, 16);

const MARKER_Y_APRON = 0.02; // just proud of the floor plane (which sits at y=-0.01)
const MARKER_Y_WALL = 1.02; // WALL_H (1) + a hair, so it sits visibly on the hedge top, not embedded

const COLOR_EMPTY = 0x8fa0b8; // faint neutral — "you can place something here"
const COLOR_FILLED = 0xf2d43a; // warm gold — "something is planted here"
const COLOR_SELECTED = 0xff37a6; // the editor's one shared selection-pink (matches highlight.ts's HIGHLIGHT_COLOR)
const OPACITY_EMPTY = 0.28;
const OPACITY_FILLED = 0.75;
const OPACITY_SELECTED = 1.0;

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

function clampOffset(v: number): number {
  return Math.max(OFFSET_MIN, Math.min(OFFSET_MAX, v));
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

  const apronTiles = apronCandidates(grid);
  const wallTiles = wallCandidates(grid);

  apronTiles.forEach(([tx, ty]) => {
    const mesh = new THREE.Mesh(APRON_MARKER_GEO, markerMaterial(COLOR_EMPTY, OPACITY_EMPTY));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(worldX(tx), MARKER_Y_APRON, worldZ(ty));
    mesh.userData.slotTile = [tx, ty];
    mesh.userData.slotSubMode = "apron";
    mesh.visible = false; // apron is the default sub-mode below, flipped on immediately
    markerRoot.add(mesh);
    apronMarkers.set(`${tx},${ty}`, mesh);
  });

  wallTiles.forEach(([tx, ty]) => {
    const mesh = new THREE.Mesh(WALL_MARKER_GEO, markerMaterial(COLOR_EMPTY, OPACITY_EMPTY));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(worldX(tx), MARKER_Y_WALL, worldZ(ty));
    mesh.userData.slotTile = [tx, ty];
    mesh.userData.slotSubMode = "wall";
    mesh.visible = false;
    markerRoot.add(mesh);
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

  /** Recolors ONE marker from the current theme's data — shared by the full
   *  syncFromTheme rebuild and refreshMarkerFor's targeted single-marker
   *  update. Selection takes priority over filled/empty (a selected marker
   *  is always pink, whether or not it holds a placement yet). */
  function paintMarker(mode: PlacementSubMode, tx: number, ty: number): void {
    const mesh = markersFor(mode).get(`${tx},${ty}`);
    if (!mesh || !currentTheme) return;
    const isSelected = selection !== null && selection.subMode === mode && selection.tile[0] === tx && selection.tile[1] === ty;
    const filled = findPlacement(currentTheme, mode, tx, ty) !== null;
    const mat = mesh.material as THREE.MeshBasicMaterial;
    if (isSelected) {
      mat.color.setHex(COLOR_SELECTED);
      mat.opacity = OPACITY_SELECTED;
    } else if (filled) {
      mat.color.setHex(COLOR_FILLED);
      mat.opacity = OPACITY_FILLED;
    } else {
      mat.color.setHex(COLOR_EMPTY);
      mat.opacity = OPACITY_EMPTY;
    }
  }

  function paintAll(): void {
    apronTiles.forEach(([tx, ty]) => paintMarker("apron", tx, ty));
    wallTiles.forEach(([tx, ty]) => paintMarker("wall", tx, ty));
  }

  function setVisibility(): void {
    apronMarkers.forEach((m) => { m.visible = subMode === "apron"; });
    wallMarkers.forEach((m) => { m.visible = subMode === "wall"; });
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
      paintAll();
      onSelectionChange(null);
    },
    setSubMode(mode: PlacementSubMode): void {
      if (subMode === mode) return;
      subMode = mode;
      setVisibility();
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
    refreshMarkerFor(tile: readonly [number, number]): void {
      if (!selection) return;
      paintMarker(selection.subMode, tile[0], tile[1]);
    },
    setPickingEnabled(on: boolean): void {
      pickingEnabled = on;
    },
    dispose(): void {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerup", onPointerUp);
    },
  };
}
