// OWNER: board & themes editor (IDEA-027/030/031, dev-only).
// The lil-gui control pane for BOARD mode: a base-theme picker (loads a deep
// working COPY of one of the 6 MAZE_THEMES — never mutates the registry
// object itself, see main.ts's loadBaseTheme) plus one folder per logical
// palette slot (Atmosphere / Walls / Floor / Biscuits / Blooms / Specks) —
// this is the "board slots" the tree pane (boardTree.ts) lists, and
// selecting a tree row opens/scrolls to the matching folder here (see
// focusSlot). Color fields follow inspector.ts's established `{ color:
// "#hexstring" }` proxy pattern (lil-gui's addColor also accepts a bare
// number property, but the codebase's one existing convention already reads
// via `.getHexString()` — matching it keeps the two inspectors consistent
// rather than introducing a second color-binding idiom).
//
// Two different LIVE-APPLY paths, per the brief:
//   - Walls/Floor/Biscuits/Atmosphere: mutate the shared materials/lights
//     directly (via `ctx.materials`/`ctx.lights`, handles main.ts hands us
//     off the live board/atmosphere) — cheap, no decor rebuild.
//   - Blooms/Specks: these change the SET of decorated wall tiles (not just
//     a color), so every change calls `cb.onDecorChange()`, which re-runs
//     applyBoardTheme with the current working theme.
//   - Placement folder: its own `onFieldEdited` callback (passed per-call to
//     setPlacementSelection, NOT part of the `cb` bundle above — see that
//     method's doc comment) routes to the exact same
//     rebuildBoardFromWorkingTheme main.ts wires onDecorChange to, so the
//     live-apply MECHANISM is identical even though the wiring path differs.
//
// v4.1 "Set Dressing" (IDEA-030/031) REWORK: the old density-population
// "Props" folder (one subfolder per theme.props entry, each a kind/density/
// scale/colors bundle) is GONE — MazeTheme.props no longer exists in
// themes.ts. In its place: a single "Placement" folder that shows controls
// for WHATEVER SLOT IS CURRENTLY SELECTED on the board (see
// boardPlacement.ts — the 3D raycast/slot-marker module main.ts wires this
// folder to via setPlacementSelection below). This is a materially
// different UI shape than every other folder here: Atmosphere/Walls/Floor/
// Biscuits/Blooms/Specks are always-present, theme-level controls; the
// Placement folder's very EXISTENCE depends on whether a slot is currently
// selected in the 3D view — no slot selected, no folder at all (there is
// nothing to edit). This mirrors inspector.ts's own "selection drives what
// the pane shows" pattern (character mode's part inspector is empty until
// you click a mesh) more than it mirrors the old Props folder's "always
// present, structurally rebuilt on every array change" shape.
//
// Same lil-gui gotchas this codebase has already hit apply here too:
//   - No explicit `step` on any control whose range is symmetric around a
//     value that isn't the range MIN (lil-gui anchors its step grid at the
//     range min) — none of our sliders need a step tighter than the
//     default, so this is avoidance-by-omission, but documented here so a
//     future intensity/chance slider addition remembers the trap.
//   - lil-gui swallows keydown on a focused widget (text/slider) — Ctrl+Z
//     while a color picker or number field has focus needs a blur first;
//     board mode has no undo (see main.ts's note), so this doesn't bite
//     TODAY, but if undo is added later, follow inspector.ts's blur-before-
//     history pattern in main.ts's keydown handler.
import GUI from "lil-gui";
import * as THREE from "three";
import { type BoardSlotId } from "./boardTree";
import type { WorkingTheme, WorkingPropPlacement, WorkingWallDecorPlacement } from "./boardCodegen";
import { propOptionsFor, type PlacementSelection } from "./boardPlacement";
import { MAZE_THEMES } from "../game/themes";

const MAX_BLOOM_COLORS = 4;
const DEFAULT_NEW_BLOOM_COLOR = 0xffffff;

const OFFSET_MIN = -0.5;
const OFFSET_MAX = 0.5;
const OFFSET_STEP = 0.005;
const SCALE_MIN = 0.4;
const SCALE_MAX = 2;
const SCALE_STEP = 0.01;
const ROTATION_MIN = 0;
const ROTATION_MAX = Math.PI * 2;
const ROTATION_STEP = 0.01;

export interface BoardMaterialHandles {
  wall: THREE.MeshStandardMaterial;
  floor: THREE.MeshStandardMaterial;
  biscuit: THREE.MeshStandardMaterial;
}

export interface BoardLightHandles {
  hemi: THREE.HemisphereLight;
  sun: THREE.DirectionalLight;
  rim: THREE.DirectionalLight;
}

export interface BoardInspectorCallbacks {
  /** Base theme dropdown changed — id of the MAZE_THEMES entry to load a
   *  fresh working copy from (main.ts owns the deep-copy + full rebuild). */
  onBaseTheme(id: string): void;
  /** bg/backdropTop changed — main.ts applies to the boardStage + scene
   *  background color (no material handle for these two; boardStage owns
   *  them). */
  onAtmosphereBg(): void;
  /** Any bloom/speck field changed (color, add/remove, emissive, chance) —
   *  triggers applyBoardTheme (hedge-decor rebuild). Placement-folder edits
   *  (prop swap/offset/rotation/scale/remove) do NOT go through this bundle
   *  at all — setPlacementSelection takes its own `onFieldEdited` callback
   *  instead (main.ts passes rebuildBoardFromWorkingTheme there too), since
   *  the Placement folder is rebuilt per-SELECTION rather than being one of
   *  the always-present palette folders every other `cb.on*` here serves. */
  onDecorChange(): void;
  /** id/name/price text/number fields changed — no live visual effect, just
   *  keeps the "Copy theme code" output in sync (codegen reads the working
   *  theme directly, so this callback only exists for symmetry/logging). */
  onMetaChange(): void;
  /** Writes the formatted theme entry to the clipboard — returns a promise
   *  the button flashes success/failure off of (matches main.ts's copyBtn/
   *  copyFileBtn flash() pattern, scoped here to a lil-gui Controller's own
   *  .name() instead of a plain <button> element). */
  onCopyCode(): Promise<void>;
  /** IDEA-034: "💾 Save to themes.ts" — writes the COMPLETE, spliced
   *  themes.ts straight to disk via the dev-only save endpoint (main.ts's
   *  saveEditorFile, the SAME safe-save primitive characters.ts's own
   *  IDEA-032 "Save to characters.ts" button already uses). Returns
   *  `{ ok, error? }` (SaveResult's own shape — see saveFile.ts) rather than
   *  a bare Promise<void> like onCopyCode, since a failed save has a
   *  meaningful reason (endpoint unreachable / brace-matching couldn't
   *  locate MAZE_THEMES) worth surfacing in the button's flash text, not
   *  just a generic "failed". */
  onSaveFile(): Promise<{ ok: boolean; error?: string }>;
}

/** The two boardPlacement.ts operations the "Placement" folder's controls
 *  invoke — a small, stable bundle of closures over the ONE
 *  BoardPlacementController instance main.ts owns for board mode's whole
 *  lifetime, passed once via bindPlacementActions (below) rather than
 *  re-threaded through every setPlacementSelection call. Kept as an
 *  explicit named interface (not inlined) so main.ts's call site reads as
 *  "here are the two things this folder is allowed to do to the placement
 *  model", matching the same narrow-surface spirit as
 *  BoardInspectorCallbacks above. */
export interface PlacementActions {
  assignProp(propId: string): WorkingPropPlacement | WorkingWallDecorPlacement;
  removeSelected(): void;
}

export interface BoardInspector {
  /** Rebuilds every folder from `theme` — called after a base-theme load
   *  (main.ts holds a fresh working copy + fresh material/light handles by
   *  then, since a new base theme means a full board rebuild). `baseThemeId`
   *  is the registry id the working copy was cloned FROM (main.ts's own
   *  record, not re-derived from `theme.id` — the working id is a free-text
   *  field the user may have already changed while authoring a new theme),
   *  purely so the base-theme dropdown reflects what's actually loaded. */
  setTheme(
    theme: WorkingTheme,
    baseThemeId: string,
    materials: BoardMaterialHandles,
    lights: BoardLightHandles,
  ): void;
  /** Opens (and scrolls to) the folder for a tree-pane slot selection —
   *  Atmosphere/Walls/Floor/Biscuits/Blooms/Specks only; boardTree.ts's two
   *  placement rows ("Props (apron)"/"Wall components") don't focus a
   *  static folder here at all — selecting them switches boardPlacement's
   *  active sub-mode instead (see main.ts's onTreeSelect), and the
   *  "Placement" folder that opens as a RESULT of then clicking a 3D slot
   *  is driven by setPlacementSelection below, not this method. */
  focusSlot(id: BoardSlotId): void;
  /** ONE-TIME wiring (call immediately after construction, alongside
   *  creating the matching BoardPlacementController) — stores `actions` so
   *  every subsequent setPlacementSelection call can build a fully
   *  functional "Placement" folder without main.ts having to re-pass the
   *  same two closures on every selection change. */
  bindPlacementActions(actions: PlacementActions): void;
  /** Rebuilds the "Placement" folder for the current 3D selection — `null`
   *  removes the folder entirely (nothing selected). Called by main.ts every
   *  time boardPlacement's onSelectionChange fires (a slot was picked,
   *  deselected, or a sub-mode switch cleared the prior selection).
   *  `onFieldEdited` is called after every control edit (prop swap/offset/
   *  rotation/scale/remove) — main.ts passes its own
   *  rebuildBoardFromWorkingTheme so the live board re-applies instantly,
   *  same "mutate then re-apply" shape as onDecorChange. */
  setPlacementSelection(selection: PlacementSelection | null, onFieldEdited: () => void): void;
  /** Refreshes the Placement folder's offset X/Z (and rotation/scale)
   *  controller DISPLAYS without rebuilding the folder — for a caller that
   *  just mutated the selected placement's fields through some path OTHER
   *  than this folder's own sliders (specifically: main.ts's arrow-key
   *  offset nudge, which calls boardPlacement.nudgeSelectedOffset directly
   *  rather than dragging a slider) and needs the visible slider position to
   *  catch up. No-op if no Placement folder currently exists. Mirrors
   *  inspector.ts's own `refreshDisplays()` (called after its own arrow-key
   *  position/scale/rotation nudges) — same "updateDisplay, don't rebuild"
   *  idiom, scoped to this one folder. */
  refreshPlacementDisplays(): void;
  destroy(): void;
}

/** A `{ color: "#hex" }` proxy bound to a get/set pair on a PLAIN number
 *  field (a palette slot with no live THREE.Color counterpart to bind
 *  directly, e.g. bg/backdropTop/speckColor — see colorProxy below for the
 *  THREE.Color-backed sibling used for material/light color properties). */
function hexProxy(get: () => number, set: (v: number) => void): { color: string } {
  return {
    get color(): string {
      return `#${get().toString(16).padStart(6, "0")}`;
    },
    set color(v: string) {
      set(new THREE.Color(v).getHex());
    },
  };
}

/** Builds a `{ color: "#hex" }` proxy bound to one axis of a THREE.Color
 *  instance (material.color / light.color / light.groundColor) — the exact
 *  shape inspector.ts's material folder already uses, generalized here since
 *  board mode has many more color slots than one material. */
function colorProxy(c: THREE.Color): { color: string } {
  return {
    get color(): string {
      return `#${c.getHexString()}`;
    },
    set color(v: string) {
      c.set(v);
    },
  };
}

export function createBoardInspector(
  container: HTMLElement,
  cb: BoardInspectorCallbacks,
): BoardInspector {
  const gui = new GUI({ container, title: "Board & Themes" });

  const baseThemeOptions: Record<string, string> = {};
  for (const t of MAZE_THEMES) baseThemeOptions[t.name] = t.id;
  const baseState = { baseThemeId: MAZE_THEMES[0].id };
  const baseThemeCtrl = gui
    .add(baseState, "baseThemeId", baseThemeOptions)
    .name("base theme")
    .onChange((id: string) => cb.onBaseTheme(id));

  // --- meta (id/name/price) — always present. Each controller's `.object`/
  // `.property` are rebound to the CURRENT working theme by setTheme below
  // (see idCtrl/nameCtrl/priceCtrl there) — lil-gui's own setValue() already
  // writes `object[property] = value` before calling onChange (see
  // Controller.setValue in lil-gui's source), so these onChange handlers
  // exist ONLY to notify main.ts (onMetaChange), not to duplicate the write:
  // there is no separate "current theme" variable to keep in sync here.
  const metaFolder = gui.addFolder("Theme identity");
  metaFolder.add({ id: "" }, "id").name("id").onChange(() => cb.onMetaChange());
  // (name/price added right after id below — keeping the same `.controllers`
  // array reference so setTheme can re-bind all three by fixed index without
  // re-adding controllers on every theme load.)
  const metaCtrls = metaFolder.controllers;
  metaFolder.add({ name: "" }, "name").onChange(() => cb.onMetaChange());
  metaFolder.add({ price: 0 }, "price", 0, 999, 1).onChange(() => cb.onMetaChange());

  const COPY_LABEL = "Copy theme code 📋";
  const copyCtrl = gui
    .add({ copy: () => {
      void cb
        .onCopyCode()
        .then(() => flashCopyLabel("Copied ✓ paste into MAZE_THEMES"))
        .catch(() => flashCopyLabel("Copy failed — clipboard blocked"));
    } }, "copy")
    .name(COPY_LABEL);
  // TEST-SUPPORT ONLY: the button's own LABEL TEXT is transient (flashes to
  // "Copied ✓ ..." for 1.6s after every click — see flashCopyLabel below), so
  // a Playwright suite clicking it twice in quick succession (spot-checking
  // two different edits back to back) can't reliably find it by visible text
  // alone. A stable data-testid on the real DOM button gives
  // scripts/test-editor-board.ts a click target that survives the flash —
  // harmless to players (never rendered, never styled off).
  copyCtrl.domElement.dataset.testid = "copy-theme-code";

  function flashCopyLabel(message: string): void {
    copyCtrl.name(message);
    window.setTimeout(() => copyCtrl.name(COPY_LABEL), 1600);
  }

  // IDEA-034: "💾 Save to themes.ts" — the SAFE path, mirroring
  // characters.ts's own IDEA-032 saveFileBtn exactly (same emoji-prefixed
  // label convention, same "flash success/failure, no separate confirm
  // dialog" UX) but as a lil-gui button (this whole pane IS a lil-gui
  // instance, unlike the character mode's plain-HTML code panel) rather than
  // a DOM <button> — kept right next to "Copy theme code" so Copy stays the
  // documented fallback (per the brief: "Keep 'Copy theme code' as
  // fallback") if the dev endpoint isn't reachable for any reason.
  const SAVE_LABEL = "💾 Save to themes.ts";
  const saveCtrl = gui
    .add({ save: () => {
      void cb
        .onSaveFile()
        .then((r) => {
          if (r.ok) flashSaveLabel("Saved ✓ themes.ts");
          else flashSaveLabel(`Save failed — use Copy theme code`);
        })
        .catch(() => flashSaveLabel("Save failed — use Copy theme code"));
    } }, "save")
    .name(SAVE_LABEL);
  // TEST-SUPPORT ONLY: same rationale as copy-theme-code's own testid above
  // — the label flashes transiently, so a stable hook survives repeated
  // clicks within a test run.
  saveCtrl.domElement.dataset.testid = "save-theme-file";

  function flashSaveLabel(message: string): void {
    saveCtrl.name(message);
    window.setTimeout(() => saveCtrl.name(SAVE_LABEL), 1600);
  }

  const folders: Partial<Record<BoardSlotId, GUI>> = {};

  function clearSlotFolders(): void {
    for (const key of Object.keys(folders) as BoardSlotId[]) {
      folders[key]?.destroy();
      delete folders[key];
    }
  }

  function buildAtmosphereFolder(theme: WorkingTheme, lights: BoardLightHandles): void {
    const folder = gui.addFolder("Atmosphere");
    folders.atmosphere = folder;
    const p = theme.palette;

    folder
      .addColor(hexProxy(() => p.bg, (v) => { p.bg = v; }), "color")
      .name("sky (bg)")
      .onChange(() => cb.onAtmosphereBg());
    folder
      .addColor(hexProxy(() => p.backdropTop, (v) => { p.backdropTop = v; }), "color")
      .name("backdrop top")
      .onChange(() => cb.onAtmosphereBg());

    folder
      .addColor(colorProxy(lights.hemi.color), "color")
      .name("hemi sky")
      .onChange((v: string) => { p.hemiSky = new THREE.Color(v).getHex(); });
    folder
      .addColor(colorProxy(lights.hemi.groundColor), "color")
      .name("hemi ground")
      .onChange((v: string) => { p.hemiGround = new THREE.Color(v).getHex(); });
    folder
      .add(lights.hemi, "intensity", 0, 2, 0.01)
      .name("hemi intensity")
      .onChange((v: number) => { p.hemiIntensity = v; });

    folder
      .addColor(colorProxy(lights.sun.color), "color")
      .name("sun color")
      .onChange((v: string) => { p.sunColor = new THREE.Color(v).getHex(); });
    folder
      .add(lights.sun, "intensity", 0, 2, 0.01)
      .name("sun intensity")
      .onChange((v: number) => { p.sunIntensity = v; });

    folder
      .addColor(colorProxy(lights.rim.color), "color")
      .name("rim color")
      .onChange((v: string) => { p.rimColor = new THREE.Color(v).getHex(); });
    folder
      .add(lights.rim, "intensity", 0, 2, 0.01)
      .name("rim intensity")
      .onChange((v: number) => { p.rimIntensity = v; });
  }

  function buildWallsFolder(theme: WorkingTheme, wall: THREE.MeshStandardMaterial): void {
    const folder = gui.addFolder("Walls");
    folders.walls = folder;
    const p = theme.palette;
    folder
      .addColor(colorProxy(wall.color), "color")
      .name("wall color")
      .onChange((v: string) => { p.wall = new THREE.Color(v).getHex(); });
    folder
      .addColor(colorProxy(wall.emissive), "color")
      .name("wall emissive")
      .onChange((v: string) => { p.wallEmissive = new THREE.Color(v).getHex(); });
    folder
      .add(wall, "emissiveIntensity", 0, 2, 0.01)
      .name("emissive intensity")
      .onChange((v: number) => { p.wallEmissiveIntensity = v; });
  }

  function buildFloorFolder(theme: WorkingTheme, floor: THREE.MeshStandardMaterial): void {
    const folder = gui.addFolder("Floor");
    folders.floor = folder;
    const p = theme.palette;
    folder
      .addColor(colorProxy(floor.color), "color")
      .name("floor color")
      .onChange((v: string) => { p.floor = new THREE.Color(v).getHex(); });
    folder
      .addColor(colorProxy(floor.emissive), "color")
      .name("floor emissive")
      .onChange((v: string) => { p.floorEmissive = new THREE.Color(v).getHex(); });
    folder
      .add(floor, "emissiveIntensity", 0, 2, 0.01)
      .name("emissive intensity")
      .onChange((v: number) => { p.floorEmissiveIntensity = v; });
  }

  function buildBiscuitsFolder(theme: WorkingTheme, biscuit: THREE.MeshStandardMaterial): void {
    const folder = gui.addFolder("Biscuits");
    folders.biscuits = folder;
    const p = theme.palette;
    folder
      .addColor(colorProxy(biscuit.color), "color")
      .name("biscuit color")
      .onChange((v: string) => { p.biscuit = new THREE.Color(v).getHex(); });
    folder
      .addColor(colorProxy(biscuit.emissive), "color")
      .name("biscuit emissive")
      .onChange((v: string) => { p.biscuitEmissive = new THREE.Color(v).getHex(); });
    folder
      .add(biscuit, "emissiveIntensity", 0, 2, 0.01)
      .name("emissive intensity")
      .onChange((v: number) => { p.biscuitEmissiveIntensity = v; });
  }

  /** Rebuilds the Blooms folder's color-list controls from
   *  `theme.palette.bloomColors` — called on first build AND whenever a
   *  color is added/removed (the CONTROL COUNT changes, which lil-gui has no
   *  "insert one more addColor" primitive for, so the simplest correct
   *  approach is destroy-and-rebuild-this-one-folder, same shape as
   *  inspector.ts's whole-folder rebuild-per-selection).
   *
   *  v4.1 note: hand-placed `theme.wallDecor` OVERRIDES this palette-driven
   *  scatter entirely (see board.ts's buildWallTopDecor dispatch — a theme
   *  gets one or the other, never both), so these sliders only matter for a
   *  theme with an EMPTY wallDecor (garden/forest/beach/park still ship this
   *  way) — the folder stays present regardless (an author might clear all
   *  hand-placed wall components and fall back to the classic scatter), but
   *  its label makes that override relationship explicit. */
  function buildBloomsFolder(theme: WorkingTheme): void {
    folders.blooms?.destroy();
    const folder = gui.addFolder("Blooms");
    folders.blooms = folder;
    const p = theme.palette;
    const colors = p.bloomColors; // WorkingPalette's bloomColors is genuinely mutable (see boardCodegen.ts)

    if (theme.wallDecor.length > 0) {
      folder.add({ note: "overridden by hand-placed Wall components" }, "note").disable().name("note");
    }

    colors.forEach((_, i) => {
      folder
        .addColor(
          hexProxy(
            () => colors[i],
            (v) => { colors[i] = v; },
          ),
          "color",
        )
        .name(`bloom ${i + 1}`)
        .onChange(() => cb.onDecorChange());
    });

    if (colors.length < MAX_BLOOM_COLORS) {
      folder
        .add({ add: () => {
          colors.push(DEFAULT_NEW_BLOOM_COLOR);
          buildBloomsFolder(theme);
          cb.onDecorChange();
        } }, "add")
        .name(`add bloom color (${colors.length}/${MAX_BLOOM_COLORS}) ➕`);
    }
    if (colors.length > 0) {
      folder
        .add({ remove: () => {
          colors.pop();
          buildBloomsFolder(theme);
          cb.onDecorChange();
        } }, "remove")
        .name("remove last bloom color ➖");
    }

    folder
      .add(p, "bloomEmissiveIntensity", 0, 2, 0.01)
      .name("bloom emissive intensity")
      .onChange(() => cb.onDecorChange());
    folder
      .add(p, "bloomChance", 0, 0.5, 0.01)
      .name("bloom chance")
      .onChange(() => cb.onDecorChange());
  }

  function buildSpecksFolder(theme: WorkingTheme): void {
    const folder = gui.addFolder("Specks");
    folders.specks = folder;
    const p = theme.palette;
    folder
      .addColor(hexProxy(() => p.speckColor, (v) => { p.speckColor = v; }), "color")
      .name("speck color")
      .onChange(() => cb.onDecorChange());
    folder
      .addColor(hexProxy(() => p.speckEmissive, (v) => { p.speckEmissive = v; }), "color")
      .name("speck emissive")
      .onChange(() => cb.onDecorChange());
    folder
      .add(p, "speckChance", 0, 0.6, 0.01)
      .name("speck chance")
      .onChange(() => cb.onDecorChange());
  }

  // -------------------------------------------------------------------
  // "Placement" folder (IDEA-030/031): shows controls for whatever slot is
  // CURRENTLY SELECTED on the board (via boardPlacement.ts's raycast
  // picking) — main.ts calls setPlacementSelection every time that
  // selection changes. Unlike every folder above (always present, one per
  // theme-level palette slot), this folder is built ONLY when something is
  // selected, and destroyed the instant nothing is (see setPlacementSelection
  // below) — unlike Blooms' rebuild-on-color-count-change, which rebuilds
  // the SAME folder in place, this one is closer to inspector.ts's own
  // "selection drives the whole pane" shape.
  let placementFolder: GUI | null = null;

  function destroyPlacementFolder(): void {
    placementFolder?.destroy();
    placementFolder = null;
  }

  // The one PlacementActions bundle bindPlacementActions receives — a
  // stable pair of closures over main.ts's single BoardPlacementController
  // instance, set ONCE right after construction (see bindPlacementActions
  // below) and read by every subsequent buildPlacementFolder call, so
  // setPlacementSelection's own signature only needs the fast-changing bit
  // (the selection + a per-call onFieldEdited) rather than re-threading the
  // whole action bundle through every selection change.
  let placementActions: PlacementActions | null = null;

  /** Builds the "Placement" folder for `selection` — a prop dropdown (swap
   *  which library prop this slot uses; ALSO the "plant something here"
   *  affordance for the rare moment `selection.existing` is null, see
   *  PlacementSelection's own doc comment for when that happens), offset X/Z
   *  sliders (apron only — wall placements have no offset field),
   *  rotationY, scale, and a "remove" button.
   *
   *  TWO DIFFERENT live-apply paths inside this ONE folder, deliberately:
   *   - The prop dropdown and "remove" button call INTO boardPlacement
   *     (`actions.assignProp`/`actions.removeSelected`) and then do
   *     NOTHING else — those two methods already call boardPlacement's own
   *     `setSelection` internally, which fires main.ts's onSelectionChange,
   *     which calls THIS module's own setPlacementSelection, which calls
   *     buildPlacementFolder again (rebuilding this whole folder from the
   *     new selection state) AND (via the onFieldEdited closure main.ts
   *     passes through that same call) re-applies the live board. Calling
   *     onFieldEdited a SECOND time here, or rebuilding the folder a SECOND
   *     time here, would just redo both of those for no benefit — the
   *     selection-change callback chain already does it exactly once.
   *   - The offset/rotationY/scale sliders instead write DIRECTLY into
   *     `selection.existing`'s fields via lil-gui's own object/property
   *     binding (`.add(placement, "rotationY", ...)`) — bypassing
   *     boardPlacement entirely, so nothing else re-applies the live board
   *     unless THIS handler calls `onFieldEdited` itself. That's why only
   *     these three controls call it explicitly. */
  function buildPlacementFolder(selection: PlacementSelection, onFieldEdited: () => void): void {
    if (!placementActions) throw new Error("boardInspector: bindPlacementActions must be called before any selection");
    const actions = placementActions;

    destroyPlacementFolder();
    const folder = gui.addFolder(`Placement — ${selection.subMode === "apron" ? "prop" : "wall component"} @ (${selection.tile[0]}, ${selection.tile[1]})`);
    placementFolder = folder;

    const options: Record<string, string> = {};
    for (const opt of propOptionsFor(selection.subMode)) options[opt.name] = opt.id;

    const propState = { propId: selection.existing?.propId ?? "" };
    folder
      .add(propState, "propId", options)
      .name(selection.existing ? "prop" : "prop (click to plant)")
      .onChange((propId: string) => {
        // assignProp's own setSelection call drives the whole re-render
        // (folder rebuild + live board re-apply) via main.ts's
        // onSelectionChange -> setPlacementSelection chain — see this
        // function's own doc comment above for why nothing further is
        // needed here.
        actions.assignProp(propId);
      });

    if (!selection.existing) return; // nothing further to show until a prop is planted

    const placement = selection.existing;

    if (selection.subMode === "apron") {
      const apronPlacement = placement as WorkingPropPlacement;
      folder
        .add({ get x() { return apronPlacement.offset[0]; }, set x(v: number) { apronPlacement.offset[0] = v; } }, "x", OFFSET_MIN, OFFSET_MAX, OFFSET_STEP)
        .name("offset X")
        .onChange(() => onFieldEdited());
      folder
        .add({ get z() { return apronPlacement.offset[1]; }, set z(v: number) { apronPlacement.offset[1] = v; } }, "z", OFFSET_MIN, OFFSET_MAX, OFFSET_STEP)
        .name("offset Z")
        .onChange(() => onFieldEdited());
    }

    folder
      .add(placement, "rotationY", ROTATION_MIN, ROTATION_MAX, ROTATION_STEP)
      .name("rotation")
      .onChange(() => onFieldEdited());
    folder
      .add(placement, "scale", SCALE_MIN, SCALE_MAX, SCALE_STEP)
      .name("scale")
      .onChange(() => onFieldEdited());

    folder
      .add({ remove: () => {
        // removeSelected's own setSelection call drives the re-render
        // (folder destroy + live board re-apply) via the SAME
        // onSelectionChange chain the prop dropdown uses above — see this
        // function's own doc comment.
        actions.removeSelected();
      } }, "remove")
      .name("remove this placement 🗑");
  }

  return {
    setTheme(
      theme: WorkingTheme,
      baseThemeId: string,
      materials: BoardMaterialHandles,
      lights: BoardLightHandles,
    ): void {
      baseState.baseThemeId = baseThemeId;
      baseThemeCtrl.updateDisplay();

      // Re-bind the three meta text/number controllers to `theme`'s own
      // fields — lil-gui controllers stay bound to whatever object/property
      // they were constructed with, so a fresh working theme (a new object)
      // needs its `.object` swapped onto each controller directly (see the
      // "Theme identity" folder's construction above for why there's no
      // separate mirror variable to reassign here).
      const idCtrl = metaCtrls[0];
      const nameCtrl = metaCtrls[1];
      const priceCtrl = metaCtrls[2];
      idCtrl.object = theme;
      idCtrl.property = "id";
      nameCtrl.object = theme;
      nameCtrl.property = "name";
      priceCtrl.object = theme;
      priceCtrl.property = "price";
      idCtrl.updateDisplay();
      nameCtrl.updateDisplay();
      priceCtrl.updateDisplay();

      clearSlotFolders();
      destroyPlacementFolder();
      buildAtmosphereFolder(theme, lights);
      buildWallsFolder(theme, materials.wall);
      buildFloorFolder(theme, materials.floor);
      buildBiscuitsFolder(theme, materials.biscuit);
      buildBloomsFolder(theme);
      buildSpecksFolder(theme);
    },
    focusSlot(id: BoardSlotId): void {
      const folder = folders[id];
      if (!folder) return;
      folder.open();
      folder.domElement.scrollIntoView({ block: "nearest" });
    },
    bindPlacementActions(actions: PlacementActions): void {
      placementActions = actions;
    },
    setPlacementSelection(selection: PlacementSelection | null, onFieldEdited: () => void): void {
      if (!selection) {
        destroyPlacementFolder();
        return;
      }
      buildPlacementFolder(selection, onFieldEdited);
    },
    refreshPlacementDisplays(): void {
      placementFolder?.controllers.forEach((c) => c.updateDisplay());
    },
    destroy(): void {
      gui.destroy();
    },
  };
}
