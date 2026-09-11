// OWNER: character editor (IDEA-025, dev-only).
// Bootstrap + orchestration for /editor/: wires the stage, character
// registry, part tree, picking, highlight, inspector, edit log, code panel
// and source view together. This module owns the editor's state and the
// select/build/edit flows; each imported module owns one responsibility.
//
// NOTE: no `virtual:pwa-register` import here — the game page (src/main.ts)
// owns service-worker registration; the editor must never register one.
import "./editor.css";
import * as THREE from "three";
import { createStage } from "./stage";
import {
  getCharacter,
  getPickup,
  disposeGroup,
  ENEMY_COLORS,
  CHARACTERS,
  PICKUPS,
  type CharacterDef,
  type AnimMode,
} from "./registry";
import { buildPartList, createPartTreeView, type PartNode } from "./partTree";
import {
  EditLog,
  collectMaterials,
  type MaterialInfo,
  type PrimKind,
  type AddedPartRecord,
  type Vec3Tuple,
} from "./editLog";
import { generateCode, buildPrimitiveGeometry, GEOMETRY_DEFAULTS } from "./codegen";
import { generateFullFile, applyEditsInPlace } from "./fileExport";
import { applyGhostState } from "../render/characters";
import { saveEditorFile } from "./saveFile";
import { onSourceChanged } from "./sourceStore";
import { History } from "./history";
import {
  createInspector,
  type EditorState,
  type TransformChannel,
  type MaterialSnapshot,
} from "./inspector";
import { createSourceView } from "./sourceView";
import { attachPicking } from "./picking";
// Direct manipulation: the viewport transform gizmo. Ported from the three.js
// editor's Viewport.js interaction contract, but committing through this
// file's own pushTransformHistory so a drag and a typed coordinate are the
// same edit downstream — see gizmo.ts's header.
import { createGizmo, GIZMO_MODES, type GizmoMode } from "./gizmo";
import { createPlacementGizmo } from "./placementGizmo";
import { createBalanceInspector } from "./balanceInspector";
import { createWorldInspector } from "./worldInspector";
import { allWorldFields, type WorldField } from "./worldFields";
import { FENCE_PARAMS } from "../render/fence";
import { GROUND_DETAIL_PARAMS } from "../render/groundDetail";
import { applyConfigEdits, type ConfigEdit } from "./configRewrite";
import {
  startSessionRecorder,
  readStoredSession,
  clearStoredSession,
  showRestoreBar,
  sessionHasContent,
  type EditorSession,
} from "./session";
// Viewport furniture: the scene readout + solid/wireframe/normals shading.
import { createViewportExtras, SHADING_MODES, type ShadingMode } from "./viewportExtras";
// Play/scrub the REAL procedural animation, with sampled per-channel tracks.
import { createTimeline } from "./timeline";
// glTF out (export the character) and in (a reference model to build
// against — see assets.ts's header for why it can never be saved).
import { exportGLB, loadReference, isGltfFile, type ReferenceModel } from "./assets";
import { Highlighter } from "./highlight";
import { applyBeagleSkin, type GhostUserData } from "../render/characters";
import { getBeagleSkin, DEFAULT_BEAGLE_SKIN_ID } from "../game/cosmetics";
// IDEA-027 (board & themes, dev-only): a second workbench mode alongside the
// character one above — see the "--- board mode (IDEA-027) ---" block near
// the bottom of this file for everything it adds. Imports grouped separately
// so the character-mode wiring above stays exactly as IDEA-025/v2 left it.
import { createBoardStage } from "./boardStage";
import { createBoardTreeView, isPlacementRow, type BoardTreeRowId } from "./boardTree";
import { createBoardInspector, type BoardMaterialHandles } from "./boardInspector";
import { cloneWorkingTheme, formatThemeEntry, generateFullThemesFile, type WorkingTheme } from "./boardCodegen";
import { buildBoard, applyBoardTheme, type Board } from "../render/board";
// IDEA-030/031 (on-board placement editor, dev-only): the raycast/slot-
// marker/placement-CRUD module — see boardPlacement.ts's own header for the
// full design. Imported alongside the rest of board mode's wiring (not a
// fourth top-level import group) since it's a genuine PART of board mode,
// not a sibling workbench mode the way Props (below) is.
import { createBoardPlacement, type PlacementSelection } from "./boardPlacement";
// computeFitDistance is scene.ts's own board-AABB camera-fit math (pure,
// canvas-free) — reused here rather than reimplemented so board mode frames
// MAZES[0] with the SAME proven fit the real game uses (default `corners`
// param resolves to scene.ts's own BOARD_CORNERS, built from the same COLS/
// ROWS/TILE/WALL_H this stage's board also uses, so it's correct for this
// exact maze with no extra wiring). This is NOT createScene (which owns a
// second canvas/renderer/camera-resize-loop this tool must never spin up) —
// see boardStage.ts's header for why the rest of the atmosphere is ported
// rather than imported.
import { computeFitDistance } from "../render/scene";
import { Grid, COLS, ROWS, worldX, worldZ } from "../game/grid";
import { MAZES } from "../game/mazes";
import { getMazeTheme, setEquippedMazeThemeId, DEFAULT_MAZE_THEME_ID, MAZE_THEMES } from "../game/themes";
import { CAM_FOV, CAM_POS, CAM_LOOK, CAM_MIN_DISTANCE, CAM_MAX_DISTANCE } from "./stage";
// IDEA-029 (props library, dev-only): a THIRD workbench mode alongside
// character/board — see the "--- props mode (IDEA-029) ---" block near the
// bottom of this file. Imports grouped separately, same convention the board
// block above already established, so the character-mode wiring at the top
// of this file stays untouched.
import { makePropFromDef } from "../render/board";
import { formatPropLibrary } from "./propsCodegen";
import { createPropsTreeView } from "./propsTree";
import { createPropsInspector } from "./propsInspector";
import {
  cloneWorkingLibrary,
  clonePropPartLayer,
  defaultWorkingPropDef,
  duplicateWorkingPropDef,
  nextPropId,
  uniquifyPropId,
  type WorkingPropDef,
} from "./propsWorking";
// IDEA-033 (props as editable part-assemblies, dev-only): props gain the
// SAME per-component editing story the character workbench already has —
// see the "--- props part editing (IDEA-033) ---" block inside the props-
// mode section below. Reuses partTree.ts/picking.ts's GENERIC machinery
// directly (buildPartList/createPartTreeView/attachPicking operate on any
// THREE.Object3D root — nothing about them is character-specific); only the
// per-part INSPECTOR folder and the edit bookkeeping are prop-specific new
// modules (propsPartInspector.ts / propPartEditLog.ts), since
// inspector.ts/editLog.ts are wired to characters.ts-only concepts (shared
// coat/body materials, idle animation, skin/team-color globals) this tab has
// no equivalent for — see propPartEditLog.ts's own header for the full
// rationale.
import { createPropsPartInspector } from "./propsPartInspector";
import { PropPartEditLog, nextAddedPartId, type LiveAddedPropPart } from "./propPartEditLog";
import { PROP_PART_GEOMETRY_DEFAULTS, buildPropPartPrimitiveGeometry } from "./propsPartCodegen";
import { generateFullPropsFile } from "./propsFileExport";
import { type PropPrimKind, type PropPartLayer, type PropPartEdit } from "../game/props";
import { hasEmissive, isEditableMaterial, roughnessOf, toon } from "../render/toon";
import { materialDeclsByColor } from "./sourceRewrite";
import { sourceTextFor } from "./sources";
import { type SavableFile } from "./saveFile";

// --- DOM ---
function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`editor: missing #${id}`);
  return el as T;
}
const canvas = byId<HTMLCanvasElement>("viewport");
const treeContainer = byId<HTMLDivElement>("partTree");
const treePaneTitle = byId<HTMLHeadingElement>("treePaneTitle");
const charGuiHost = byId<HTMLDivElement>("charGuiHost");
const boardGuiHost = byId<HTMLDivElement>("boardGuiHost");
const propsGuiHost = byId<HTMLDivElement>("propsGuiHost");
const balanceGuiHost = byId<HTMLDivElement>("balanceGuiHost");
const worldGuiHost = byId<HTMLDivElement>("worldGuiHost");
const generatedPre = byId<HTMLPreElement>("generatedView");
const sourcePre = byId<HTMLPreElement>("sourceView");
const codeTitle = byId<HTMLSpanElement>("codeTitle");
const copyBtn = byId<HTMLButtonElement>("copyBtn");
const copyFileBtn = byId<HTMLButtonElement>("copyFileBtn");
const saveFileBtn = byId<HTMLButtonElement>("saveFileBtn");
const editorApp = byId<HTMLDivElement>("editorApp");
const modeCharacterBtn = byId<HTMLButtonElement>("modeCharacterBtn");
const modeBoardBtn = byId<HTMLButtonElement>("modeBoardBtn");
const modePropsBtn = byId<HTMLButtonElement>("modePropsBtn");
const modeBalanceBtn = byId<HTMLButtonElement>("modeBalanceBtn");
const modeWorldBtn = byId<HTMLButtonElement>("modeWorldBtn");
const modePickupsBtn = byId<HTMLButtonElement>("modePickupsBtn");
const viewportHint = byId<HTMLDivElement>("viewportHint");
// IDEA-062: see the chip's own note in editor/index.html and the wiring
// further down (onSourceChanged).
const staleChip = byId<HTMLDivElement>("staleChip");
const staleChipText = byId<HTMLSpanElement>("staleChipText");
const staleChipReload = byId<HTMLButtonElement>("staleChipReload");
const gizmoBar = byId<HTMLDivElement>("gizmoBar");
const gizmoSpaceBtn = byId<HTMLButtonElement>("gizmoSpaceBtn");
const gizmoSnapBtn = byId<HTMLButtonElement>("gizmoSnapBtn");
const gizmoOffBtn = byId<HTMLButtonElement>("gizmoOffBtn");
const focusBtn = byId<HTMLButtonElement>("focusBtn");
const shadingSelect = byId<HTMLSelectElement>("shadingSelect");
const viewCubeBtn = byId<HTMLButtonElement>("viewCubeBtn");
const infoBtn = byId<HTMLButtonElement>("infoBtn");
const viewportInfo = byId<HTMLDivElement>("viewportInfo");
// IDEA-033: Props mode's second tree pane (the selected prop's own component
// list) — see editor/index.html's own note on why this is a SEPARATE DOM
// node from #partTree rather than a second view fighting for the same one.
const propsPartTreeContainer = byId<HTMLDivElement>("propsPartTree");
const propsPartTreeTitle = byId<HTMLHeadingElement>("propsPartTreeTitle");

// --- state ---
const state: EditorState = {
  characterId: "beagle",
  beagleSkinId: DEFAULT_BEAGLE_SKIN_ID,
  enemyColor: "rose",
  turntable: false, // you orbit the camera yourself now (drag the viewport)
  animation: "idle",
  grid: false,
  highlight: true,
};

const stage = createStage(canvas);
const highlighter = new Highlighter(stage.scene);
const sourceView = createSourceView(sourcePre);

let def: CharacterDef = getCharacter(state.characterId);
let group: THREE.Group | null = null;
let nodes: PartNode[] = [];
let nodeByObject = new Map<THREE.Object3D, PartNode>();
let materials: MaterialInfo[] = [];
let materialByUuid = new Map<string, MaterialInfo>();
let selected: PartNode | null = null;
let log = new EditLog();
let generatedText = "";
const history = new History();

// --- transform gizmo ---
// Set by the gizmo's per-drag-frame callback and flushed once in the render
// loop below. The reference editor dispatches `objectChanged` on every drag
// frame and lets each panel decide; we coalesce instead, because our
// inspector is a lil-gui folder whose refresh is a full rebuild — doing that
// 60x a second during a drag is what would make the gizmo feel worse than
// the arrow keys, not better.
let gizmoDirty = false;

/** Which EditLog channel the current gizmo mode writes. */
function gizmoChannel(): TransformChannel {
  const m = gizmo.getMode();
  return m === "translate" ? "position" : m === "rotate" ? "rotation" : "scale";
}

/**
 * IDEA-062: which mode's selection the gizmo is currently driving.
 *
 * The gizmo was wired to character mode alone — `gizmoBar.hidden = !meshMode`
 * — even though `createGizmo` has always been generic (`attach(objects[])`,
 * `onCommit(channel, changes)`). That was the single biggest reason Board and
 * Props felt like a preview rather than a workbench: both already had a
 * selection and a full transform-commit path, and neither had a handle.
 *
 * Props parts are ordinary Object3Ds, so they take the gizmo directly. Board
 * PLACEMENTS do not — see placementGizmo.ts for why they are driven through a
 * proxy instead of the live prop mesh.
 */
type GizmoTarget =
  | { kind: "character"; nodes: PartNode[] }
  | { kind: "propPart"; nodes: PartNode[] }
  | { kind: "placement"; selection: PlacementSelection };

function currentGizmoTarget(): GizmoTarget | null {
  if (mode === "character" || mode === "pickups") {
    // The root (path "") is excluded for the same reason it always was: Save
    // never writes its transform, so a handle on it would be a lie.
    const nodes = selection.filter((n) => n.path !== "");
    return nodes.length > 0 ? { kind: "character", nodes } : null;
  }
  if (mode === "props") {
    return selectedPropPart && selectedPropPart.path !== ""
      ? { kind: "propPart", nodes: [selectedPropPart] }
      : null;
  }
  const sel = boardPlacement.getSelection();
  return sel?.existing ? { kind: "placement", selection: sel } : null;
}

/** Points the gizmo at whatever the active mode has selected, and shows or
 *  hides the toolbar accordingly. Called from every selection path plus
 *  setMode — one function so no mode can forget a case. */
function syncGizmo(): void {
  const target = currentGizmoTarget();
  // The BAR stays up whenever the viewport does, in EVERY mode, and nothing
  // on it is disabled. Two attempts were wrong before this one, and both are
  // worth recording because they look reasonable:
  //
  //  - Hiding the strip when nothing is selected. Most of what is on it
  //    (shading, the orientation cube, the scene readout, Focus) controls how
  //    you are LOOKING, not what is selected — so it took away five working
  //    controls to hide three idle ones.
  //  - Disabling just the three transform buttons. Also wrong: the gizmo MODE
  //    is a persistent setting, not an action on the current selection.
  //    Picking "rotate" with nothing selected is a perfectly sensible thing to
  //    do — it is the mode the next part you click will get — and disabling it
  //    makes the tool argue with you over a preference.
  //
  // What genuinely depends on the selection is the HANDLE, and that is
  // already handled: gizmo.attach([]) below removes it.
  gizmoBar.hidden = false;
  // Export/Ref act on the CHARACTER group, which board and props modes do not
  // have — those two really would be wired to nothing (IDEA-041's rule).
  const meshMode = mode === "character" || mode === "pickups";
  exportGlbBtn.hidden = !meshMode;
  refLoadBtn.hidden = !meshMode;
  if (!meshMode) refClearBtn.hidden = true;
  if (!target) {
    gizmo.attach([]);
    placementGizmo.detach();
    return;
  }
  if (target.kind === "placement") {
    placementGizmo.attachTo(target.selection);
    gizmo.attach([placementGizmo.proxy]);
    applyPlacementAxisLimits();
  } else {
    placementGizmo.detach();
    gizmo.attach(target.nodes.map((n) => n.object));
    gizmo.setAxes({ x: true, y: true, z: true });
  }
}

/** Board placements cannot express what a free gizmo offers, so the handle is
 *  cut down to what the DATA can hold rather than letting a drag silently
 *  discard two of its three axes. See placementGizmo.ts. */
function applyPlacementAxisLimits(): void {
  const sel = boardPlacement.getSelection();
  const m = gizmo.getMode();
  if (m === "rotate") {
    // rotationY only — one ring, not three.
    gizmo.setAxes({ x: false, y: true, z: false });
  } else if (m === "translate") {
    // Apron placements have an `offset` in X/Z; wall-top ones sit dead-centre
    // on their tile and have no offset field at all, so there is nothing to
    // drag and the handle says so by not being there.
    const apron = sel?.subMode === "apron";
    gizmo.setAxes({ x: apron, y: false, z: apron });
  } else {
    // Scale is UNIFORM. TransformControls only shows its uniform (XYZE) handle
    // when all three axis flags are true (TransformControls.js:1475 at r169),
    // so this deliberately does NOT restrict them — placementGizmo collapses
    // the result to one number on commit.
    gizmo.setAxes({ x: true, y: true, z: true });
  }
}

const gizmo = createGizmo({
  camera: stage.camera,
  canvas,
  scene: stage.scene,
  orbit: stage.orbit,
  onCommit: (channel, changes) => {
    const target = currentGizmoTarget();
    if (target?.kind === "placement") {
      commitPlacementGizmo();
      return;
    }
    if (target?.kind === "propPart") {
      commitPropPartGizmo(channel, changes);
      return;
    }
    // One drag = one undo entry, however many parts moved. The single-part
    // case routes through the SAME pushTransformHistory the inspector's
    // number fields use, so a drag and a typed coordinate stay identical
    // downstream; the multi-part case wraps N of them in one transaction.
    //
    // No coalesceKey either way: a drag is already one gesture, and sharing
    // a key with the typed field would let a drag swallow a later nudge.
    const moved = changes
      .map((c) => ({ node: nodeByObject.get(c.object), change: c }))
      .filter((m): m is { node: PartNode; change: (typeof changes)[number] } => m.node !== undefined);
    if (moved.length === 0) return;

    // The per-frame drag flush only touches the PRIMARY (it is the one the
    // gizmo handle is on), so the followers' edits have to be registered
    // here or they would not reach codegen until an undo/redo ran.
    for (const m of moved) log.touchTransform(m.node, channel);

    if (moved.length === 1) {
      pushTransformHistory(moved[0].node, channel, moved[0].change.before, moved[0].change.after);
    } else {
      history.begin();
      for (const m of moved) pushTransformHistory(m.node, channel, m.change.before, m.change.after);
      history.commit(`${channel} ${moved.length} parts`);
    }
    // Catch the inspector's number fields up to where the drag left the part.
    afterHistoryApply(selected);
  },
  onDrag: () => {
    gizmoDirty = true;
  },
  onModeChange: (m) => syncGizmoBar(m),
});

/** Reflects the gizmo's mode back onto the toolbar, so the keyboard
 *  shortcuts and the buttons can never disagree about which one is live —
 *  the same "toolbar subscribes to the mode signal" arrangement the three.js
 *  editor uses, minus the signal bus (one call site does not need one). */
function syncGizmoBar(mode: GizmoMode): void {
  for (const btn of document.querySelectorAll<HTMLButtonElement>(".gizmo-btn")) {
    btn.classList.toggle("active", btn.dataset.gizmo === mode);
  }
  // IDEA-062: which axes a board placement can accept depends on the MODE
  // (translate -> X/Z, rotate -> Y, scale -> uniform), so the limits have to
  // be re-applied every time the mode changes, not only on selection.
  if (currentGizmoTarget()?.kind === "placement") applyPlacementAxisLimits();
}

for (const btn of document.querySelectorAll<HTMLButtonElement>(".gizmo-btn")) {
  btn.addEventListener("click", () => {
    const mode = btn.dataset.gizmo as GizmoMode | undefined;
    if (mode && (GIZMO_MODES as readonly string[]).includes(mode)) gizmo.setMode(mode);
  });
}

let gizmoWorldSpace = false;
gizmoSpaceBtn.addEventListener("click", () => {
  gizmoWorldSpace = !gizmoWorldSpace;
  gizmo.setSpace(gizmoWorldSpace ? "world" : "local");
  gizmoSpaceBtn.textContent = gizmoWorldSpace ? "World" : "Local";
  gizmoSpaceBtn.classList.toggle("active", gizmoWorldSpace);
});

let gizmoSnap = false;
gizmoSnapBtn.addEventListener("click", () => {
  gizmoSnap = !gizmoSnap;
  gizmo.setSnap(gizmoSnap);
  gizmoSnapBtn.classList.toggle("active", gizmoSnap);
});

function setGizmoEnabled(on: boolean): void {
  gizmo.setEnabled(on);
  gizmoOffBtn.textContent = on ? "Hide" : "Show";
  gizmoOffBtn.classList.toggle("active", !on);
}
gizmoOffBtn.addEventListener("click", () => setGizmoEnabled(!gizmo.isEnabled()));

// --- viewport furniture: focus, shading, orientation cube, info ---
const viewportExtras = createViewportExtras({ info: viewportInfo, renderer: stage.renderer });

/** Frames the current selection, or the whole character when nothing is
 *  selected — "F with nothing selected does nothing" is a dead key. */
function focusSelection(): void {
  const target = selected?.object ?? group;
  if (target) stage.focusOn(target);
}
focusBtn.addEventListener("click", focusSelection);

shadingSelect.addEventListener("change", () => {
  const mode = shadingSelect.value as ShadingMode;
  if (!(SHADING_MODES as readonly string[]).includes(mode)) return;
  viewportExtras.setShading(mode);
  viewportExtras.reapply(group);
});

viewCubeBtn.addEventListener("click", () => {
  const on = !viewCubeBtn.classList.contains("active");
  viewCubeBtn.classList.toggle("active", on);
  stage.setViewHelper(on);
});

infoBtn.addEventListener("click", () => {
  const on = !infoBtn.classList.contains("active");
  infoBtn.classList.toggle("active", on);
  viewportExtras.setInfoVisible(on);
});

// --- glTF export + reference model ---
const exportGlbBtn = byId<HTMLButtonElement>("exportGlbBtn");
const refLoadBtn = byId<HTMLButtonElement>("refLoadBtn");
const refClearBtn = byId<HTMLButtonElement>("refClearBtn");
const refFileInput = byId<HTMLInputElement>("refFileInput");

let reference: ReferenceModel | null = null;

exportGlbBtn.addEventListener("click", () => {
  if (!group) return;
  void exportGLB(group, `${def.builderName}.glb`)
    .then(() => flash(exportGlbBtn, "Saved ✓", true))
    .catch((err: unknown) => {
      console.error("GLB export failed", err);
      flash(exportGlbBtn, "Failed", false);
    });
});

function clearReference(): void {
  reference?.dispose();
  reference = null;
  refClearBtn.hidden = true;
  refLoadBtn.classList.remove("active");
  refLoadBtn.textContent = "Ref";
}

function adoptReference(model: ReferenceModel): void {
  clearReference();
  reference = model;
  // Parented to contentRoot, NOT the scene: the turntable should swing the
  // reference and the character together, or they stop lining up the moment
  // you spin the view.
  stage.contentRoot.add(model.root);
  refClearBtn.hidden = false;
  refLoadBtn.classList.add("active");
  refLoadBtn.textContent = "Ref ✓";
  refLoadBtn.title =
    `${model.name} — ${model.size.toFixed(2)} units across. Reference only: it is never saved into ${def.sourceFile}.`;
}

function loadReferenceFile(file: File): void {
  if (!isGltfFile(file)) {
    flash(refLoadBtn, "Not glTF", false);
    return;
  }
  void loadReference(file)
    .then(adoptReference)
    .catch((err: unknown) => {
      console.error("reference load failed", err);
      flash(refLoadBtn, "Failed", false);
    });
}

refLoadBtn.addEventListener("click", () => refFileInput.click());
refClearBtn.addEventListener("click", clearReference);
refFileInput.addEventListener("change", () => {
  const file = refFileInput.files?.[0];
  if (file) loadReferenceFile(file);
  refFileInput.value = ""; // so re-picking the same file fires change again
});

// Drag a .glb straight onto the viewport. preventDefault on dragover is what
// makes the canvas a drop target at all; without it the browser navigates
// away to the file, taking the editor (and any unsaved edits) with it.
canvas.addEventListener("dragover", (e) => {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
});
canvas.addEventListener("drop", (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (file) loadReferenceFile(file);
});

// --- code panel ---
function renderGenerated(text: string): void {
  const code = generatedPre.querySelector("code");
  if (!code) return;
  code.textContent = "";
  for (const line of text.split("\n")) {
    const el = document.createElement("span");
    el.className = "code-line";
    if (line.trimStart().startsWith("//")) el.classList.add("code-comment");
    el.textContent = line;
    code.appendChild(el);
  }
}

function updateGenerated(): void {
  generatedText = generateCode(log, def.builderName);
  renderGenerated(generatedText);
}

// --- part list bookkeeping (tree, maps, materials) ---
const tree = createPartTreeView(
  treeContainer,
  // Ctrl/Cmd/Shift-click toggles the part in or out of the selection;
  // a plain click replaces it.
  (node, intent) => (intent.toggle ? toggleSelection(node) : select(node)),
  {
    onFocus: (node) => stage.focusOn(node.object),
    onReparent: (node, newParent) => reparentAddedPart(node, newParent),
  },
);

/**
 * Moves an editor-ADDED part under a new parent (drag-and-drop in the tree).
 *
 * Restricted to added parts by partTree.ts, and this function re-checks
 * rather than trusting it: an ORIGINAL part's parent is decided by the
 * builder in characters.ts, and codegen has no line it could emit to
 * re-attach it — moving one would look right in the viewport and then vanish
 * on save, which is the exact failure mode the editor-residue incidents were
 * about. An added part codegen's as `<parentVar>.add(<name>)`, so a reparent
 * is representable: change the record's parentVar and the emitted line
 * follows.
 */
function reparentAddedPart(node: PartNode, newParent: PartNode): void {
  const record = log.findAddedPart(node.object);
  if (!record) return; // not an added part — nothing we could persist
  const fromParent = node.object.parent;
  if (!fromParent || fromParent === newParent.object) return;
  const fromVar = record.parentVar;

  const move = (parent: THREE.Object3D, parentVar: string) => (): void => {
    parent.add(record.object);
    record.parentVar = parentVar;
    refreshParts();
    // The moved row is at a new path, so re-select by OBJECT rather than
    // trying to carry the stale path across.
    const moved = nodeByObject.get(record.object);
    select(moved ?? null);
    updateGenerated();
  };

  move(newParent.object, newParent.varName)();
  history.push({
    undo: move(fromParent, fromVar),
    redo: move(newParent.object, newParent.varName),
    label: `reparent ${record.name} → ${newParent.varName}`,
  });
}

/** materialDeclsByColor is a parse of the whole builder source; refreshParts
 *  runs on every scene change, so the result is cached per builder. */
const materialDeclsCache = new Map<string, Map<number, string>>();
function materialDeclsFor(d: { sourceFile: SavableFile; builderName: string }): Map<number, string> {
  const key = `${d.sourceFile}::${d.builderName}`;
  let decls = materialDeclsCache.get(key);
  if (!decls) {
    decls = materialDeclsByColor(sourceTextFor(d.sourceFile), d.builderName);
    materialDeclsCache.set(key, decls);
  }
  return decls;
}

function refreshParts(): void {
  if (!group) return;
  nodes = buildPartList(group, def.label);
  nodeByObject = new Map(nodes.map((n) => [n.object, n]));
  // The material registry must be built from the character's OWN materials.
  // In "normals" shading every mesh is temporarily wearing one shared
  // MeshNormalMaterial, so collect with the real ones put back — see
  // withRealMaterials' doc comment for what goes wrong otherwise.
  materials = viewportExtras.withRealMaterials(group, () => collectMaterials(group!, nodes, materialDeclsFor(def)));
  materialByUuid = new Map(materials.map((m) => [m.material.uuid, m]));
  tree.render(nodes);
}

function materialForMesh(mesh: THREE.Mesh): MaterialInfo | undefined {
  const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  return materialByUuid.get(mat.uuid);
}

// --- animation preview / authored pose ---
function setAnimation(mode: AnimMode): void {
  state.animation = mode;
  inspector.setAnimation(mode);
  // Restore unconditionally on "off" rather than only when something WAS
  // playing: lil-gui writes the bound property before it calls onChange, so by
  // the time this runs `state.animation` already reads "off" and any
  // was-it-playing test is guaranteed false. Restoring twice is harmless — it
  // just re-applies the authored pose over itself.
  if (mode === "off" && group) {
    // Snap every animated channel back to authored values (baseline + user
    // edits) instead of freezing mid-stride — the GUI and codegen then read the
    // pose the user actually authored, not wherever the animation happened to
    // leave it. This restores ALL nodes rather than a per-character list of
    // "idle targets": the real animation touches far more than the old
    // hand-rolled idle did (hem pieces, skirt scale, pupil pivots, six legs),
    // and a list would be one more thing to keep in sync with characters.ts.
    // ORDER MATTERS. applyGhostState runs FIRST: it restores visibility and
    // material colour ("eaten" hides every child but the eyes), but it also
    // writes the pupil dart — so running it last would re-rotate the pupils
    // straight after the restore had just centred them, which is exactly the
    // bug where an "off" preview still showed the eyes glancing sideways.
    if (def.isEnemy) applyGhostState(group, "chase", { x: 0, y: 0 });
    for (const node of nodes) log.restoreAuthoredTransform(node);
  }
}

// --- selection ---
//
// `selection` is the full set; `selected` is its PRIMARY — selection[0], the
// most recently clicked part. Everything that edits ONE thing (the inspector,
// the source-view marker, the code panel's "Selected:" folder) keys off the
// primary, exactly as it did when single selection was all there was.
// Everything that can sensibly act on MANY (the gizmo, Delete) reads the
// whole set. That split is what let multi-select land without touching the
// inspector at all.
let selection: PartNode[] = [];

/** Replaces the selection with `node` (or clears it). */
function select(node: PartNode | null): void {
  setSelection(node ? [node] : []);
}

/** Ctrl/Shift-click: add the part if it is out, drop it if it is in. The
 *  newly added part becomes the primary, so the inspector follows the thing
 *  you just clicked. */
function toggleSelection(node: PartNode): void {
  const without = selection.filter((n) => n.path !== node.path);
  setSelection(without.length === selection.length ? [node, ...selection] : without);
}

/** Every editable part — the root is excluded for the same reason the gizmo
 *  skips it: it is not a part Save can write. */
function selectAllParts(): void {
  setSelection(nodes.filter((n) => n.path !== ""));
}

function setSelection(next: PartNode[]): void {
  selection = next;
  const node = selection[0] ?? null;
  selected = node;
  tree.setSelected(selection.map((n) => n.path));
  highlighter.set(state.highlight ? selection : []);
  if (node && state.animation !== "off") setAnimation("off"); // hold still while editing
  // IDEA-062: the gizmo is now mode-routed — syncGizmo resolves the target
  // from `mode` plus that mode's own selection, so character, props and board
  // cannot drift onto three different attach paths. The root (path "") is
  // still excluded there: Save never writes its transform, so a gizmo on it
  // would be a control wired to nothing (IDEA-041's rule).
  syncGizmo();
  inspector.setSelection(node, node ? selectionContext() : null);
  sourceView.markVar(node && !node.isAutoNamed && !node.isAdded ? node.varName : null);
}

function selectionContext() {
  return {
    log,
    // IDEA-041: the inspector needs to know which builder this character comes
    // from to look up the channels the runtime overwrites.
    builderName: def.builderName,
    materialFor: materialForMesh,
    addedRecord: selected ? log.findAddedPart(selected.object) : undefined,
    onEdit: updateGenerated,
    onMaterialReplaced: () => {
      // Re-derive the registry from the live scene graph: a shading swap gives
      // every affected mesh a NEW material with a new uuid, and the old map
      // would resolve none of them.
      if (!group) return;
      materials = collectMaterials(group, nodes, materialDeclsFor(def));
      materialByUuid = new Map(materials.map((m) => [m.material.uuid, m]));
    },
    onGeometryRebuilt: (node: PartNode) => {
      // The wireframe overlay shares the mesh's geometry — refresh it.
      if (selected === node) highlighter.set(state.highlight ? selection : []);
    },
    onDelete: deleteNode,
    onTransformCommitted: pushTransformHistory,
    onVisibleCommitted: (node: PartNode, before: boolean, after: boolean) => {
      const apply = (value: boolean) => (): void => {
        node.object.visible = value;
        log.touchVisible(node);
        afterHistoryApply(node);
      };
      history.push({
        undo: apply(before),
        redo: apply(after),
        label: `${after ? "show" : "hide"} ${node.varName}`,
      });
    },
    onMaterialCommitted: (info: MaterialInfo, before: MaterialSnapshot, after: MaterialSnapshot) => {
      const apply = (value: MaterialSnapshot) => (): void => {
        info.material.color.setHex(value.color);
        // Toon materials have no roughness to restore.
        if (roughnessOf(info.material) !== null) {
          (info.material as THREE.MeshStandardMaterial).roughness = value.roughness;
        }
        log.touchMaterial(info);
        afterHistoryApply(null);
      };
      history.push({
        undo: apply(before),
        redo: apply(after),
        coalesceKey: `mat:${info.material.uuid}`,
        label: `material ${info.varName}`,
      });
    },
    onParamCommitted: (record: AddedPartRecord, key: string, before: number, after: number) => {
      const apply = (value: number) => (): void => {
        record.params[key] = value;
        record.object.geometry.dispose();
        record.object.geometry = buildPrimitiveGeometry(record.kind, record.params);
        const node = nodeByObject.get(record.object);
        if (node && selected === node) highlighter.set(state.highlight ? selection : []); // overlay shares the geometry
        afterHistoryApply(node ?? null);
      };
      history.push({
        undo: apply(before),
        redo: apply(after),
        coalesceKey: `param:${record.name}:${key}`,
        label: `${record.name} ${key}`,
      });
    },
  };
}

// --- undo/redo plumbing ---
function applyChannel(object: THREE.Object3D, channel: TransformChannel, v: Vec3Tuple): void {
  if (channel === "rotation") object.rotation.set(v[0], v[1], v[2]);
  else object[channel].set(v[0], v[1], v[2]);
}

/** After a history entry mutated the scene: refresh code panel + inspector
 *  widgets (full folder rebuild — re-inits gesture snapshots and the color
 *  proxy, which a plain updateDisplay would leave stale). */
function afterHistoryApply(node: PartNode | null): void {
  updateGenerated();
  if (selected && (node === null || node === selected)) {
    inspector.setSelection(selected, selectionContext());
  }
}

function pushTransformHistory(
  node: PartNode,
  channel: TransformChannel,
  before: Vec3Tuple,
  after: Vec3Tuple,
  coalesceKey?: string,
): void {
  const apply = (v: Vec3Tuple) => (): void => {
    applyChannel(node.object, channel, v);
    log.touchTransform(node, channel);
    afterHistoryApply(node);
  };
  history.push({ undo: apply(before), redo: apply(after), coalesceKey, label: `${channel} ${node.varName}` });
}

// --- character build / switch ---
function buildCharacter(): void {
  select(null);
  history.clear(); // old entries point at the outgoing character's objects
  if (group) disposeGroup(group);
  // Which registry depends on the tab: Character mode edits characters.ts,
  // Pickups mode edits the maze items in board.ts. Everything below is
  // identical for both — the part tree, inspector, generated code, source
  // panel and Save all work off the def, not off a hard-coded file.
  def = mode === "pickups" ? getPickup(state.characterId) : getCharacter(state.characterId);
  group = def.build(state);
  stage.contentRoot.rotation.y = 0;
  stage.contentRoot.add(group);
  // Pickups are authored centred on the ORIGIN, because in the game
  // spawnBone/spawnFruit/spawnCoin set their height when they place them.
  // Dropped straight onto the editor's ground plane that leaves every one of
  // them half sunk through the floor, with the bottom half unreachable.
  //
  // So the preview LIFTS the item until it rests on the ground. This is a
  // display-only offset on the group's own transform — the geometry the game
  // receives is untouched, and the offset is never written by Save (it lives
  // on the root, which is not an editable part).
  if (def.isPickup) {
    group.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(group);
    if (Number.isFinite(bounds.min.y)) group.position.y = -bounds.min.y;
  }
  log = new EditLog();
  refreshParts();
  log.snapshot(nodes, materials);
  inspector.setCharacterMode(def.isBeagle, def.modes, def.isPickup);
  sourceView.showBuilder(def.builderName, def.sourceFile);
  // The button names the file it will actually write — it said "characters.ts"
  // on every tab, which is a lie the moment a second file is editable.
  const shortFile = def.sourceFile.split("/").pop() ?? def.sourceFile;
  saveFileBtn.textContent = `💾 Save to ${shortFile}`;
  saveFileBtn.title = `Write your edits straight into ${def.sourceFile} (dev server only). The safe way — no copy-paste.`;
  codeTitle.textContent = `${def.builderName}() — ${def.sourceFile}`;
  // A shading override is a property of the VIEW, not the character, so it
  // has to be re-applied to the meshes the rebuild just created.
  viewportExtras.reapply(group);
  if (animationTabOpen) timeline.rebuild();
  updateGenerated();
}

// --- add / delete parts ---

/** Inserts `object` into `parent.children` at a specific index instead of
 *  three.js's own `add()`, which only ever appends. Mirrors add()'s own
 *  bookkeeping (removeFromParent() first, parent pointer, added/child-added
 *  events) so nothing downstream (raycasting, matrix updates) can tell the
 *  difference — this is how undo restores an original part's sibling
 *  position instead of moving it to the end of the list. `index` is clamped
 *  to the current child count so a stale index (e.g. an earlier sibling was
 *  ALSO deleted and not yet restored) degrades to append rather than throw. */
function insertChildAt(parent: THREE.Object3D, object: THREE.Object3D, index: number): void {
  object.removeFromParent();
  object.parent = parent;
  const at = Math.max(0, Math.min(index, parent.children.length));
  parent.children.splice(at, 0, object);
  object.dispatchEvent({ type: "added" });
  parent.dispatchEvent({ type: "childadded", child: object });
}

function sanitizeName(raw: string, kind: PrimKind): string {
  let name = raw.replace(/[^a-zA-Z0-9_]/g, "");
  if (!/^[a-zA-Z_]/.test(name)) name = kind;
  const taken = new Set(nodes.map((n) => n.varName));
  if (!taken.has(name)) return name;
  let i = 2;
  while (taken.has(`${name}${i}`)) i++;
  return `${name}${i}`;
}

/** (Re)attach an added part — shared by add, redo-of-add and undo-of-delete. */
function attachAdded(record: AddedPartRecord, parent: THREE.Object3D): void {
  parent.add(record.object);
  log.addPart(record);
  refreshParts();
  updateGenerated();
}

/** Detach an added part WITHOUT disposing it — undo may bring it back. The
 *  history entry's onDiscard does the disposal once undo is impossible. */
function detachAdded(record: AddedPartRecord): void {
  if (selected?.object === record.object) select(null);
  record.object.removeFromParent();
  log.removePart(record.object);
  refreshParts();
  updateGenerated();
}

/** Disposal hook for add/delete history entries: when the entry leaves
 *  history and the part is not in the scene, nothing can revive it. */
function discardAdded(record: AddedPartRecord): () => void {
  return () => {
    if (!record.object.parent) {
      record.object.geometry.dispose();
      record.material.dispose();
    }
  };
}

function addPart(kind: PrimKind, rawName: string): void {
  if (!group) return;
  const name = sanitizeName(rawName.trim() || kind, kind);
  const parentNode = selected ?? nodeByObject.get(group);
  if (!parentNode) return;

  const params = { ...GEOMETRY_DEFAULTS[kind] };
  const material = new THREE.MeshStandardMaterial({ color: 0xe8a23d, roughness: 0.6 });
  const mesh = new THREE.Mesh(buildPrimitiveGeometry(kind, params), material);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.position.set(0, 0.2, 0); // pop out of the parent so it's immediately visible
  mesh.userData.editorAdded = true;

  const record: AddedPartRecord = { name, kind, parentVar: parentNode.varName, object: mesh, material, params };
  const parent = parentNode.object;
  attachAdded(record, parent);
  history.push({
    undo: () => detachAdded(record),
    redo: () => attachAdded(record, parent),
    onDiscard: discardAdded(record),
    label: `add ${name}`,
  });
  const node = nodeByObject.get(mesh);
  if (node) select(node); // straight into tweaking it
}

function deletePart(node: PartNode): void {
  const record = log.findAddedPart(node.object);
  const parent = node.object.parent;
  if (!record || !parent) return;
  detachAdded(record);
  history.push({
    undo: () => attachAdded(record, parent),
    redo: () => detachAdded(record),
    onDiscard: discardAdded(record),
    label: `delete ${record.name}`,
  });
}

/** What deleteOriginalPart needs to reverse itself — captured once at delete
 *  time so undo/redo never re-derive it from a PartNode that may no longer
 *  exist (refreshParts() rebuilds the node list on every scene change). */
interface OriginalDeleteRecord {
  object: THREE.Object3D;
  parent: THREE.Object3D;
  path: string;
  varName: string;
  isAutoNamed: boolean;
  /** Sibling index at the moment of THIS delete — see deleteOriginalPart. */
  index: number;
}

/** (Re)attach an ORIGINAL part at its recorded sibling index — shared by
 *  delete's undo and redo-of-delete. Unlike attachAdded, this does NOT touch
 *  the EditLog's added-parts bookkeeping; it clears the deleted-original
 *  mark instead (see EditLog.unmarkOriginalDeleted) so codegen stops
 *  emitting removeFromParent() for it. No disposal concern either way: the
 *  geometry/material are owned by the character build (registry.ts's
 *  disposeGroup reclaims them on character switch), never by the editor. */
function attachOriginalAt(rec: OriginalDeleteRecord): void {
  insertChildAt(rec.parent, rec.object, rec.index);
  log.unmarkOriginalDeleted(rec.path);
  refreshParts();
  updateGenerated();
  const node = nodeByObject.get(rec.object);
  if (node) select(node); // land back on the restored part, like a fresh pick
}

/** Detach an ORIGINAL part WITHOUT disposing anything (see attachOriginalAt).
 *  `removeFromParent()` also drops the whole subtree for a group — that's
 *  the deliberate "delete a group deletes its children too" behavior the
 *  inspector's confirm-free copy warns about before the click. */
function detachOriginal(rec: OriginalDeleteRecord): void {
  if (selected?.object === rec.object) select(null);
  // Locator captured BEFORE removeFromParent(): local position is unaffected
  // by reparenting, but reading it off a still-attached object is simplest.
  log.markOriginalDeleted(rec);
  rec.object.removeFromParent();
  refreshParts();
  updateGenerated();
}

function deleteOriginalPart(node: PartNode): void {
  if (node.path === "") return; // the character root is never deletable
  const parent = node.object.parent;
  if (!parent) return;
  const rec: OriginalDeleteRecord = {
    object: node.object,
    parent,
    path: node.path,
    varName: node.varName,
    isAutoNamed: node.isAutoNamed,
    // Sibling index BEFORE detaching — indexOf reads parent.children's
    // CURRENT live layout, so this stays correct even if an earlier sibling
    // is also mid-delete; insertChildAt clamps defensively on the way back.
    index: parent.children.indexOf(node.object),
  };
  detachOriginal(rec);
  history.push({
    undo: () => attachOriginalAt(rec),
    redo: () => detachOriginal(rec),
    label: `delete ${rec.varName}`,
    // No onDiscard: nothing to dispose. If the redo stack is wiped (a new
    // action after undo) the part simply stays in the scene, un-deleted —
    // exactly as if the delete had never happened, which is correct: the
    // object is owned by the character build, not this history entry.
  });
}

/** Single delete entry point (the Delete key AND the inspector's 🗑 button
 *  both call this) — routes to the added-part path or the original-part path
 *  depending on what's selected, mirroring the root guard both underlying
 *  functions already enforce on their own. */
function deleteNode(node: PartNode): void {
  if (log.findAddedPart(node.object)) deletePart(node);
  else deleteOriginalPart(node);
}

/**
 * Deletes the WHOLE selection as one undoable step.
 *
 * Deepest-first, so deleting a group and something inside it in the same
 * gesture cannot have the child's delete run against a parent that has
 * already left the scene graph. Descendants of an already-deleted group are
 * skipped outright — the group's own delete took the entire subtree with it,
 * and deleting a child again would push a second entry for a part that is
 * already gone.
 */
function deleteSelection(): void {
  const doomed = selection
    .filter((n) => n.path !== "")
    .sort((a, b) => b.path.split("/").length - a.path.split("/").length);
  if (doomed.length === 0) return;
  if (doomed.length === 1) {
    deleteNode(doomed[0]);
    return;
  }
  const gone = new Set<string>();
  history.begin();
  for (const node of doomed) {
    if ([...gone].some((p) => node.path === p || node.path.startsWith(`${p}/`))) continue;
    gone.add(node.path);
    deleteNode(node);
  }
  history.commit(`delete ${gone.size} parts`);
}

// --- inspector (right pane) ---
const inspector = createInspector(charGuiHost, state, {
  onCharacter: () => buildCharacter(),
  onSkin: (id: string) => {
    if (!group || !def.isBeagle) return;
    applyBeagleSkin(group, getBeagleSkin(id));
    // The new coat is the new "unedited" — re-base the 4 coat materials so
    // stale color edits don't linger in the generated code.
    for (const info of materials) log.refreshMaterialBaseline(info);
    inspector.setSelection(selected, selected ? selectionContext() : null);
    updateGenerated();
  },
  onEnemyColor: (key) => {
    if (!group || def.isBeagle) return;
    const ud = group.userData as GhostUserData;
    ud.bodyMat.color.setHex(ENEMY_COLORS[key]);
    ud.baseColor = ENEMY_COLORS[key]; // applyGhostState restores this in-game
    const info = materialByUuid.get(ud.bodyMat.uuid);
    if (info) log.refreshMaterialBaseline(info);
    inspector.setSelection(selected, selected ? selectionContext() : null);
    updateGenerated();
  },
  onTurntable: (on) => stage.setTurntable(on),
  onAnimation: (mode) => setAnimation(mode),
  onGrid: (on) => stage.setGrid(on),
  // Hide the pink wireframe to judge the result cleanly; selection itself
  // (tree row, controls, code marker) stays active.
  onHighlight: (on) => highlighter.set(on ? selection : []),
  onAddPart: (kind, name) => addPart(kind, name),
});

// --- picking (click a part in the 3D view) ---
// IDEA-027: getRoot() returns null while board mode is active so a viewport
// click never tries to raycast/select a (hidden, but still scene-resident)
// character part — board mode has its own click story deferred to a later
// version (see the "no per-mesh picking needed for v1" note in boardTree.ts).
attachPicking(
  canvas,
  stage.camera,
  () => (mode === "character" || mode === "pickups" ? group : null),
  (object) => nodeByObject.get(object),
  (node) => select(node),
  // Releasing a gizmo handle must not land as a click on the part behind it.
  // …and neither may a click on the orientation cube, which sits over the
  // viewport and would otherwise also select whatever part is behind it.
  () => gizmo.isBlocking() || stage.viewHelperConsumedClick(),
);

// IDEA-033: a SECOND attachPicking instance, scoped to Props mode's own
// preview root — attachPicking's getRoot()/onPick callbacks are read fresh
// on every pointerup (see picking.ts), so two independent instances sharing
// the same canvas/camera never race: whichever one's getRoot() returns
// non-null for the CURRENTLY active mode is the only one that ever resolves
// a hit (the character instance above already gates itself the same way).
// propPartNodeByObject/selectPropPart are declared further below (in the
// "--- props part editing ---" section) — safe to reference here since
// picking only invokes these closures on a REAL click, always after the
// whole module (including that section) has finished initializing.
attachPicking(
  canvas,
  stage.camera,
  () => (mode === "props" ? propsPreview.currentMesh : null),
  (object) => propPartNodeByObject.get(object),
  (node) => selectPropPart(node),
);

// --- per-frame ---
// IDEA-034: this callback references `boardPlacement`, a module-level const
// declared FURTHER DOWN in this file (in the "--- board mode ---" section) —
// safe despite that ordering because stage.ts's render loop only ever
// invokes this closure from inside a `renderer.setAnimationLoop` tick, and
// the very FIRST such tick can only fire after this entire module has
// finished its synchronous top-to-bottom initialization (module-level code
// runs to completion before any callback/event/animation-frame it registered
// along the way can execute) — the exact same TDZ-safety argument boardTree's
// own onSelect callback already documents for the identical "closure defined
// before, reads a const declared after" shape.
stage.onFrame((_dt, t) => {
  // IDEA-027: idle animation + the pink selection wireframe are both
  // character-mode-only concerns — gating on `mode` avoids animating a
  // hidden character's tail/ears every frame while board mode is active (the
  // highlighter itself is already empty in board mode since select(null) ran
  // on the way in, but the explicit gate documents the intent either way).
  if (mode === "character" || mode === "pickups") {
    // Exactly one driver for the animation: the timeline when its tab is
    // open (it owns play/pause/scrub), the free-running preview otherwise.
    if (animationTabOpen) timeline.update(_dt);
    else if (group && state.animation !== "off") def.animate(group, state.animation, _dt);
    // Flush one drag's worth of gizmo movement (see gizmoDirty's note): mark
    // the channel edited so the generated code follows the handle live. The
    // inspector's own fields are left until mouseUp — a full lil-gui rebuild
    // per frame is the one thing that would make dragging feel worse.
    if (gizmoDirty) {
      gizmoDirty = false;
      if (selected) {
        log.touchTransform(selected, gizmoChannel());
        updateGenerated();
      }
    }
    viewportExtras.update(group, _dt);
    highlighter.update();
  }
  // IDEA-034: the empty-slot marker PULSE (see boardPlacement.ts's
  // updatePulse doc comment) only needs to animate while board mode is
  // actually the visible workbench — gated the same way idle/highlighter are
  // above, for the same reason (no point animating markers under a hidden
  // boardStage.boardRoot). updatePulse itself is also a no-op whenever no
  // marker is currently in the "empty" state (see its own early return), so
  // this gate is a belt-and-braces skip, not the only thing preventing waste.
  if (mode === "board") boardPlacement.updatePulse(t);
});

// --- code panel chrome: tabs + copy ---
/** data-tab value → the view element it shows. */
const CODE_VIEWS: Record<string, string> = {
  generated: "generatedView",
  source: "sourceView",
  history: "historyView",
  animation: "animationView",
};

/** True while the Animation tab is the visible code view — it owns the
 *  animation frame while open (see the frame callback). */
let animationTabOpen = false;

for (const tab of document.querySelectorAll<HTMLButtonElement>(".code-tab")) {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".code-tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".code-view").forEach((v) => v.classList.remove("active"));
    tab.classList.add("active");
    byId(CODE_VIEWS[tab.dataset.tab ?? "generated"] ?? "generatedView").classList.add("active");
    // The timeline DRIVES the animation while its tab is open (see the frame
    // callback) — two drivers stepping the same character would double its
    // speed. Re-scan on open so the tracks match the current mode.
    animationTabOpen = tab.dataset.tab === "animation";
    if (animationTabOpen) timeline.rebuild();
  });
}

// --- history panel (click a step to jump to that state) ---
const historyView = byId<HTMLDivElement>("historyView");

function renderHistoryPanel(): void {
  const steps = history.list();
  const position = history.position();
  historyView.textContent = "";

  // Row 0 is the ORIGINAL state — without it there is no way to click your
  // way back to "before any edit", only to keep pressing Ctrl+Z.
  const rows: Array<{ label: string; target: number; done: boolean }> = [
    { label: "original build", target: 0, done: true },
    ...steps.map((s, i) => ({ label: s.label, target: i + 1, done: s.done })),
  ];

  for (const row of rows) {
    const el = document.createElement("div");
    el.className = "history-row";
    if (!row.done) el.classList.add("undone");
    if (row.target === position) el.classList.add("current");
    const n = document.createElement("span");
    n.className = "history-index";
    n.textContent = row.target === 0 ? "·" : String(row.target);
    const label = document.createElement("span");
    label.className = "history-label";
    label.textContent = row.label;
    el.append(n, label);
    el.addEventListener("click", () => {
      history.goTo(row.target);
      // The jump ran undo()/redo() closures, which already repaint the code
      // panel and inspector via afterHistoryApply — but the SELECTION may
      // now point at a part those closures added or removed, so re-derive
      // the part list rather than trusting the stale one.
      refreshParts();
      const stillThere = selected && nodes.some((n2) => n2.path === selected?.path);
      if (!stillThere) select(null);
      updateGenerated();
    });
    historyView.appendChild(el);
  }
  if (steps.length === 0) {
    const hint = document.createElement("div");
    hint.className = "history-hint";
    hint.textContent = "No edits yet — every change you make lists here, click one to jump back to it.";
    historyView.appendChild(hint);
  }
}

history.onChange = renderHistoryPanel;
renderHistoryPanel();

// --- animation timeline ---
// The host is deliberately thin: the timeline never touches the character
// itself, it asks main.ts to reset or step the REAL animation. reset() is
// the same setAnimation("off") restore path the GUI dropdown uses, so a
// scrub back to zero and choosing "off" from the menu land on identical
// poses — no second definition of "the authored pose".
const timeline = createTimeline(byId<HTMLDivElement>("animationView"), {
  reset: () => {
    if (!group) return;
    const playing = state.animation;
    setAnimation("off");
    state.animation = playing; // keep the CHOSEN mode; only the pose was reset
    inspector.setAnimation(playing);
  },
  step: (dt) => {
    if (group && state.animation !== "off") def.animate(group, state.animation, dt);
  },
  nodes: () => nodes,
  isAnimating: () => state.animation !== "off",
});

function flash(btn: HTMLButtonElement, message: string, ok: boolean): void {
  const original = btn.dataset.label ?? btn.textContent ?? "";
  btn.dataset.label = original;
  btn.classList.toggle("copied", ok);
  btn.textContent = message;
  window.setTimeout(() => {
    btn.classList.remove("copied");
    btn.textContent = btn.dataset.label ?? original;
  }, 1600);
}

copyBtn.addEventListener("click", () => {
  void navigator.clipboard.writeText(generatedText).then(() => flash(copyBtn, "Copied ✓", true));
});

// "Copy full file": the whole characters.ts with this session's edits already
// injected into the current builder — paste it over src/render/characters.ts.
copyFileBtn.addEventListener("click", () => {
  if (log.isEmpty) {
    flash(copyFileBtn, "No edits yet", false);
    return;
  }
  const full = generateFullFile(log, def.builderName, def.sourceFile);
  if (!full) {
    flash(copyFileBtn, "Failed — use Copy edits", false);
    return;
  }
  void navigator.clipboard
    .writeText(full)
    .then(() => flash(copyFileBtn, "Copied ✓ paste over characters.ts", true));
});

// IDEA-025 v3: "Save to characters.ts" now edits the REAL definitions.
// Moving the haunch changes the haunch's own `position.set(...)` line;
// deleting a part removes its `const` block and its comment. Nothing is
// appended, so the file keeps reading like code someone wrote and the
// editor-residue hazard has no way to recur.
//
// IDEA-032 (the dev-only /__save-file middleware) still does the writing —
// what changed is WHAT gets written. Anything that cannot be expressed as an
// edit to a real line (a mirrored part built inside a loop, a coat colour the
// equipped skin owns, a node with no variable name) is REPORTED, never
// silently dropped and never faked as an override block.
function saveReportText(report: ReturnType<typeof applyEditsInPlace>, saved: boolean): string {
  const lines: string[] = [];
  lines.push(
    saved
      ? `// Saved to src/render/characters.ts — ${report.applied.length} change(s) written`
      : `// NOT saved — nothing could be written to src/render/characters.ts`,
  );
  if (report.applied.length > 0) {
    lines.push("//", "// Written in place:");
    for (const what of report.applied) lines.push(`//   ✓ ${what}`);
  }
  if (report.blocked.length > 0) {
    lines.push("//", `// NOT saved (${report.blocked.length}) — these need a decision:`);
    for (const b of report.blocked) {
      lines.push(`//   ✗ ${b.what}`);
      for (const chunk of b.reason.match(/.{1,72}(\s|$)/g) ?? [b.reason]) {
        lines.push(`//       ${chunk.trim()}`);
      }
    }
  }
  return lines.join("\n");
}

// Writing characters.ts makes Vite hot-reload this page (the editor imports
// that very module, twice — as code and as ?raw). That reload is GOOD: the
// workbench comes back rebuilt from the file that is now on disk, which is the
// honest confirmation that the save landed, and it re-baselines the EditLog so
// edits can never stack. What the reload used to destroy was the FEEDBACK —
// the button flash and the report, gone in a blink, which is a large part of
// why saving felt like nothing happened. So the report is stashed just before
// the write and re-shown on the way back up.
const SAVE_REPORT_KEY = "beagle-editor:last-save-report";
const SAVE_REPORT_TTL_MS = 15_000;

function stashSaveReport(text: string, flashText: string, ok: boolean): void {
  try {
    window.sessionStorage.setItem(
      SAVE_REPORT_KEY,
      JSON.stringify({ text, flashText, ok, at: Date.now() }),
    );
  } catch {
    // Dev-only convenience; a browser refusing sessionStorage just means the
    // report is lost to the reload, exactly as before.
  }
}

function restorePendingSaveReport(): void {
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(SAVE_REPORT_KEY);
    if (raw) window.sessionStorage.removeItem(SAVE_REPORT_KEY);
  } catch {
    return;
  }
  if (!raw) return;
  try {
    const saved = JSON.parse(raw) as { text: string; flashText: string; ok: boolean; at: number };
    if (Date.now() - saved.at > SAVE_REPORT_TTL_MS) return; // a stale tab, not this save
    renderGenerated(saved.text);
    flash(saveFileBtn, saved.flashText, saved.ok);
  } catch {
    /* malformed — nothing to show */
  }
}

saveFileBtn.addEventListener("click", () => {
  if (log.isEmpty) {
    flash(saveFileBtn, "No edits yet", false);
    return;
  }
  const report = applyEditsInPlace(log, def.builderName, def.sourceFile);

  if (report.applied.length === 0) {
    // Everything was blocked — say so loudly rather than writing an unchanged
    // file and flashing a green tick over it. No write, so no reload either.
    flash(saveFileBtn, `Nothing saved — ${report.blocked.length} blocked ↓`, false);
    renderGenerated(saveReportText(report, false));
    return;
  }

  const n = report.applied.length;
  const flashText =
    report.blocked.length > 0
      ? `Saved ${n} ✓ · ${report.blocked.length} not saved ↓`
      : `Saved ✓ ${n} change(s)`;
  const text = saveReportText(report, true);

  // Stashed BEFORE the write: the hot-reload that the write triggers can tear
  // this page down before the promise below ever resolves.
  stashSaveReport(text, flashText, report.blocked.length === 0);

  void saveEditorFile(def.sourceFile, report.src).then((r) => {
    if (!r.ok) {
      try {
        window.sessionStorage.removeItem(SAVE_REPORT_KEY);
      } catch {
        /* nothing to clear */
      }
      flash(saveFileBtn, "Save failed — use Copy full file", false);
      return;
    }
    flash(saveFileBtn, flashText, report.blocked.length === 0);
    // Re-baseline FIRST, then render the report — rebaselineAfterSave calls
    // updateGenerated() (the log is empty now, so that prints "No edits
    // yet"), and doing it afterwards would wipe the account of what was just
    // written out from under the user.
    rebaselineAfterSave();
    renderGenerated(text);
  });
});

// IDEA-062: the stale-module chip.
//
// Suppressing the save-triggered reload is what stops a Props save from
// destroying the Board tab's unsaved placements. Its one cost is that for the
// MESH tabs the imported module now lags the file on disk: buildCharacter()
// rebuilds from the characters.ts the page loaded, so switching characters
// after a save would show the pre-save mesh and read as "my save was lost".
//
// Board and Props are unaffected — their working theme / working library ARE
// the truth — so the chip names the files that actually went stale rather
// than nagging generically. Reloading is offered, never taken: the whole
// point of this pass is that the editor stops throwing your work away on its
// own initiative.
const staleFiles = new Set<SavableFile>();
onSourceChanged((file) => {
  staleFiles.add(file);
  const names = [...staleFiles].map((f) => f.split("/").pop()).join(", ");
  staleChipText.textContent =
    `Saved to disk: ${names}. The live scene is still the pre-save build — ` +
    "reload to re-read it (your unsaved work in other tabs is NOT restored by a reload).";
  staleChip.hidden = false;
});
staleChipReload.addEventListener("click", () => window.location.reload());

/**
 * IDEA-062: do the work the page reload used to do, now that saves no longer
 * reload (vite.config.ts's handleHotUpdate).
 *
 * A save writes this session's edits into the REAL definitions in
 * characters.ts/board.ts, so after it lands those edits are AUTHORED, not
 * pending. Without re-baselining, the log still believes it owes them — and
 * the next save would apply them a second time on top of source that already
 * has them (re-inserting every added part, re-writing every transform). The
 * reload used to make that impossible by throwing the whole log away.
 *
 * Clearing `editorAdded` is the part that is easy to miss and silent when
 * missed: EditLog.touchTransform early-returns on an added node (its whole
 * construction block IS its transform), so a part that stays flagged after
 * being written into the source would stop recording ANY further move —
 * you would drag it and nothing at all would happen to the generated code.
 * Once saved it is an ordinary authored part, named by its own `const`.
 */
function rebaselineAfterSave(): void {
  if (!group) return;
  for (const rec of log.addedParts) delete rec.object.userData.editorAdded;
  refreshParts(); // re-walks the tree so the rows lose their "added" badge
  log.snapshot(nodes, materials);
  // refreshParts rebuilt every PartNode, so the old `selected` object is a
  // stale node for the same mesh — re-resolve it through the fresh map so the
  // inspector and the source marker key off the node the tree now holds.
  select(selected ? nodeByObject.get(selected.object) ?? null : null);
  updateGenerated();
  // The "Real source" panel is showing the pre-save text; sourceTextFor now
  // returns the bytes just written, so re-point it at the same builder.
  sourceView.showBuilder(def.builderName, def.sourceFile);
}

// --- keyboard: Ctrl+Z / Ctrl+Y, arrow nudging, Escape, Delete ---
const NUDGE_STEP = 0.01;
const NUDGE_COARSE = 0.1; // Shift
const NUDGE_FINE = 0.001; // Alt

function nudgeSelected(key: string, step: number, depthAxis: boolean): void {
  if (!selected) return;
  const node = selected;
  const before: Vec3Tuple = [node.object.position.x, node.object.position.y, node.object.position.z];
  const p = node.object.position;
  if (key === "ArrowLeft") p.x -= step;
  else if (key === "ArrowRight") p.x += step;
  else if (key === "ArrowUp") depthAxis ? (p.z -= step) : (p.y += step);
  else if (key === "ArrowDown") depthAxis ? (p.z += step) : (p.y -= step);
  log.touchTransform(node, "position");
  updateGenerated();
  inspector.refreshDisplays(); // position widgets bind the object directly
  // One Ctrl+Z reverts the whole arrow-key run (entries coalesce per part).
  pushTransformHistory(node, "position", before, [p.x, p.y, p.z], `nudge:${node.path}`);
}

/** Hold S + arrows: uniform scale nudge (↑/→ grow, ↓/← shrink) — precise
 *  scaling that the sliders make fiddly. Same step modifiers as position. */
function nudgeScaleSelected(key: string, step: number): void {
  if (!selected) return;
  const node = selected;
  const s = node.object.scale;
  const before: Vec3Tuple = [s.x, s.y, s.z];
  const delta = key === "ArrowUp" || key === "ArrowRight" ? step : -step;
  s.x = Math.max(0.01, s.x + delta);
  s.y = Math.max(0.01, s.y + delta);
  s.z = Math.max(0.01, s.z + delta);
  log.touchTransform(node, "scale");
  updateGenerated();
  inspector.refreshDisplays();
  pushTransformHistory(node, "scale", before, [s.x, s.y, s.z], `nudgescale:${node.path}`);
}

/** Hold R + arrows: rotation nudge in radians — ←/→ = yaw (y), ↑/↓ = pitch
 *  (x), Ctrl+↑/↓ = roll (z). Same step modifiers as position/scale. */
function nudgeRotateSelected(key: string, step: number, rollAxis: boolean): void {
  if (!selected) return;
  const node = selected;
  const r = node.object.rotation;
  const before: Vec3Tuple = [r.x, r.y, r.z];
  if (key === "ArrowLeft") r.y -= step;
  else if (key === "ArrowRight") r.y += step;
  else if (key === "ArrowUp") rollAxis ? (r.z += step) : (r.x -= step);
  else if (key === "ArrowDown") rollAxis ? (r.z -= step) : (r.x += step);
  log.touchTransform(node, "rotation");
  updateGenerated();
  inspector.refreshDisplays();
  pushTransformHistory(node, "rotation", before, [r.x, r.y, r.z], `nudgerot:${node.path}`);
}

// Capture phase: lil-gui stops keydown propagation on its focused widgets
// (buttons, sliders), so a bubble-phase listener would miss Ctrl+Z right
// after clicking "add part". Capture fires regardless; the inTextField /
// select guards below still leave typing and dropdown arrows to the widgets.
let scaleKeyHeld = false; // S held → arrows nudge SCALE instead of position
let rotateKeyHeld = false; // R held → arrows nudge ROTATION instead of position

window.addEventListener(
  "keydown",
  (e) => {
    // IDEA-027: this whole handler is character-mode machinery (undo/redo,
    // delete, transform nudging — all keyed on the character `selected`/
    // `history`, neither of which board mode touches). Board mode has no
    // undo (see the "--- board mode ---" block's note), so letting Ctrl+Z
    // through here would silently undo a STALE character edit invisibly —
    // guard the entire handler behind the MESH modes instead of trying to
    // thread a mode check through every branch below.
    //
    // Pickups mode is included because it drives the very same `selected`,
    // `history` and `log` as Character mode — it is the same machinery over a
    // different registry. Excluding it left the tab with a part tree you could
    // select in but not nudge, and Save reporting "No edits yet".
    if (mode !== "character" && mode !== "pickups") return;
    const active = document.activeElement;
    const inTextField = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
    const key = e.key.toLowerCase();

    if ((e.ctrlKey || e.metaKey) && (key === "z" || key === "y")) {
      e.preventDefault();
      // Blur a focused field first: that commits its pending value (pushing
      // its history entry), so the undo below acts on the finished edit.
      if (inTextField) active.blur();
      if (key === "y" || (key === "z" && e.shiftKey)) history.redo();
      else history.undo();
      return;
    }

    // Arrows inside a number field / dropdown belong to the widget.
    if (inTextField || active instanceof HTMLSelectElement) return;

    // Gizmo modes. Deliberately NOT the reference editor's w/e/r: `r` and `s`
    // are already taken HERE as held modifiers for arrow-key rotate/scale
    // nudging (scaleKeyHeld/rotateKeyHeld, just below), so binding `r` to
    // "rotate mode" would fire every time you reached for a rotate nudge and
    // silently change the gizmo out from under you. `t` takes scale's slot.
    if (key === "w" || key === "e" || key === "t") {
      gizmo.setMode(key === "w" ? "translate" : key === "e" ? "rotate" : "scale");
      return;
    }
    if (key === "q") {
      setGizmoEnabled(!gizmo.isEnabled());
      return;
    }
    if (key === "f") {
      focusSelection();
      return;
    }

    if (key === "s") scaleKeyHeld = true;
    if (key === "r") rotateKeyHeld = true;

    if (e.key === "Escape") {
      select(null);
      return;
    }
    // Delete removes the current selection — same dispatch as the
    // inspector's 🗑 button. Root is excluded (path === "") so this can never
    // wipe the whole character; deleteNode's own guards no-op safely anyway,
    // but checking here avoids preventDefault() on an inert keypress. (Not
    // Backspace: that's the browser's "navigate back" key outside a text
    // field, and it wasn't part of the spec — Delete only.)
    if (selected && selected.path !== "" && e.key === "Delete") {
      e.preventDefault();
      deleteSelection();
      return;
    }
    // Select-all / deselect toggle. Plain `a` (no Ctrl): Ctrl+A is the
    // browser's select-all and taking it over inside a dev tool that also
    // has text fields is more annoying than it is worth.
    if (key === "a" && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (selection.length > 0) select(null);
      else selectAllParts();
      return;
    }
    // Up/Down inside the focused part tree NAVIGATE it (partTree.ts owns that
    // handler) — they must not also nudge the selected part's transform, or
    // one keypress would move the selection AND move the model. Left/Right
    // are not tree keys, so they keep nudging even while the tree has focus.
    const treeNavigating =
      active === treeContainer && (e.key === "ArrowUp" || e.key === "ArrowDown");
    if (
      selected &&
      !treeNavigating &&
      (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight")
    ) {
      e.preventDefault();
      const step = e.shiftKey ? NUDGE_COARSE : e.altKey ? NUDGE_FINE : NUDGE_STEP;
      if (scaleKeyHeld) nudgeScaleSelected(e.key, step);
      else if (rotateKeyHeld) nudgeRotateSelected(e.key, step, e.ctrlKey); // Ctrl = roll (z)
      else nudgeSelected(e.key, step, e.ctrlKey); // Ctrl swaps Up/Down onto the z axis
    }
  },
  true,
);

window.addEventListener("keyup", (e) => {
  const key = e.key.toLowerCase();
  if (key === "s") scaleKeyHeld = false;
  if (key === "r") rotateKeyHeld = false;
}, true);
window.addEventListener("blur", () => {
  // key releases outside the window never arrive
  scaleKeyHeld = false;
  rotateKeyHeld = false;
});

// IDEA-033: Props mode's OWN keyboard story — Ctrl+Z/Y undo/redo (against
// `propHistory`, its own independent stack — see that variable's own doc
// comment), arrow-key position/scale/rotation nudge (reusing the SAME
// scaleKeyHeld/rotateKeyHeld modifier state the character listener above
// sets — these are just "is S/R currently held", not mode-specific, and only
// one mode's keydown handler ever runs its OWN branch per keypress since
// each is gated behind its own `mode !== "…"` early return, so sharing the
// two booleans is safe), Escape deselect, Delete hides/removes the selected
// component (deletePropPartNode's own dispatch — see its doc comment for
// why Delete means something slightly different per part kind here).
// Mirrors the character listener's shape line-for-line, scoped to
// `selectedPropPart`/`propPartLog`/`propHistory` instead of
// `selected`/`log`/`history`.
function nudgePropSelected(key: string, step: number, depthAxis: boolean): void {
  if (!selectedPropPart) return;
  const node = selectedPropPart;
  const p = node.object.position;
  const before: Vec3Tuple = [p.x, p.y, p.z];
  if (key === "ArrowLeft") p.x -= step;
  else if (key === "ArrowRight") p.x += step;
  else if (key === "ArrowUp") depthAxis ? (p.z -= step) : (p.y += step);
  else if (key === "ArrowDown") depthAxis ? (p.z += step) : (p.y -= step);
  propPartLog.touchTransform(node, "position");
  propsPartInspector.refreshDisplays();
  pushPropTransformHistory(node, "position", before, [p.x, p.y, p.z], `propnudge:${node.path}`);
}

function nudgePropScaleSelected(key: string, step: number): void {
  if (!selectedPropPart) return;
  const node = selectedPropPart;
  const s = node.object.scale;
  const before: Vec3Tuple = [s.x, s.y, s.z];
  const delta = key === "ArrowUp" || key === "ArrowRight" ? step : -step;
  s.x = Math.max(0.01, s.x + delta);
  s.y = Math.max(0.01, s.y + delta);
  s.z = Math.max(0.01, s.z + delta);
  propPartLog.touchTransform(node, "scale");
  propsPartInspector.refreshDisplays();
  pushPropTransformHistory(node, "scale", before, [s.x, s.y, s.z], `propnudgescale:${node.path}`);
}

function nudgePropRotateSelected(key: string, step: number, rollAxis: boolean): void {
  if (!selectedPropPart) return;
  const node = selectedPropPart;
  const r = node.object.rotation;
  const before: Vec3Tuple = [r.x, r.y, r.z];
  if (key === "ArrowLeft") r.y -= step;
  else if (key === "ArrowRight") r.y += step;
  else if (key === "ArrowUp") rollAxis ? (r.z += step) : (r.x -= step);
  else if (key === "ArrowDown") rollAxis ? (r.z -= step) : (r.x += step);
  propPartLog.touchTransform(node, "rotation");
  propsPartInspector.refreshDisplays();
  pushPropTransformHistory(node, "rotation", before, [r.x, r.y, r.z], `propnudgerot:${node.path}`);
}

window.addEventListener(
  "keydown",
  (e) => {
    if (mode !== "props") return;
    const active = document.activeElement;
    const inTextField = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
    const key = e.key.toLowerCase();

    if ((e.ctrlKey || e.metaKey) && (key === "z" || key === "y")) {
      e.preventDefault();
      if (inTextField) active.blur();
      if (key === "y" || (key === "z" && e.shiftKey)) propHistory.redo();
      else propHistory.undo();
      return;
    }

    if (inTextField || active instanceof HTMLSelectElement) return;

    // IDEA-062: the gizmo mode keys, the same W/E/T the character workbench
    // uses (deliberately not the reference editor's W/E/R — R and S are held
    // modifiers in this project, see the character listener's own note). Must
    // come BEFORE the `s`/`r` modifier handling below, and `t` cannot collide
    // with anything here.
    if (!e.ctrlKey && !e.metaKey && !e.altKey && (key === "w" || key === "e" || key === "t")) {
      e.preventDefault();
      gizmo.setMode(key === "w" ? "translate" : key === "e" ? "rotate" : "scale");
      return;
    }

    if (key === "s") scaleKeyHeld = true;
    if (key === "r") rotateKeyHeld = true;

    if (e.key === "Escape") {
      selectPropPart(null);
      return;
    }
    if (selectedPropPart && selectedPropPart.path !== "" && e.key === "Delete") {
      e.preventDefault();
      deletePropPartNode(selectedPropPart);
      return;
    }
    if (
      selectedPropPart &&
      (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight")
    ) {
      e.preventDefault();
      const step = e.shiftKey ? NUDGE_COARSE : e.altKey ? NUDGE_FINE : NUDGE_STEP;
      if (scaleKeyHeld) nudgePropScaleSelected(e.key, step);
      else if (rotateKeyHeld) nudgePropRotateSelected(e.key, step, e.ctrlKey);
      else nudgePropSelected(e.key, step, e.ctrlKey);
    }
  },
  true,
);

// ===========================================================================
// --- board mode (IDEA-027, dev-only) ---
// A second workbench alongside everything above: pick a base theme (one of
// the 6 MAZE_THEMES), see a REAL validated maze (MAZES[0]) rendered under
// that theme's atmosphere, tweak every palette slot live, "Copy theme code"
// a ready-to-paste MAZE_THEMES entry. Shares the character workbench's one
// canvas/renderer/OrbitControls (stage.ts) — switching modes swaps which
// content is VISIBLE and which tree/gui pane is live, never tears down or
// rebuilds the character session (see setMode below: the outgoing mode's
// state is simply hidden, not disposed, so returning to it needs no rebuild
// at all — that IS how "restore the character workbench exactly" is
// satisfied here, trivially, by never having torn it down).
//
// UNDO DECISION: board mode ships WITHOUT undo/redo. history.ts's model is
// gesture-level closures over TRANSFORM CHANNELS on scene objects (position/
// rotation/scale/visible) and MATERIAL color/roughness on a fixed, small set
// of known materials — coalesced by a `coalesceKey` string per part+channel.
// A palette edit doesn't fit that shape cleanly: (a) many board edits are
// STRUCTURAL, not a channel value — adding/removing a bloom color changes
// the number of lil-gui controls that exist, which the transform/material
// undo entries never had to handle (they mutate a value, they don't add or
// remove controllers); (b) a base-theme SWAP discards the entire working
// palette and rebuilds every folder from scratch, which would need its own
// bespoke "restore a whole WorkingTheme snapshot" entry type, doubling
// history.ts's entry vocabulary for a dev tool where re-picking the base
// theme (one dropdown click) already IS a full, instant "undo everything."
// Given the existing History class's coalesceKey shape is a genuine mismatch
// rather than a small extension, and board mode already offers a trivial
// full-reset (reload the base theme dropdown), this ships without undo — a
// future pass COULD add a coarser "snapshot the whole WorkingTheme on every
// committed gesture" history entry if that's ever worth the complexity.
//
// IDEA-062 — IT WAS WORTH THE COMPLEXITY, AND THE EXIT THIS NOTE NAMES IS THE
// ONE TAKEN. Board mode now has undo, via exactly the "snapshot the whole
// WorkingTheme" entry the paragraph above describes. Both objections stand and
// both are answered by that shape rather than argued with: a STRUCTURAL edit
// (add/remove a bloom colour) and a base-theme SWAP are just two more
// snapshots, because a snapshot does not care what changed. `cloneWorkingTheme`
// already existed as the deep-copy primitive, so there is no new vocabulary in
// history.ts at all — an entry is still a pair of closures.
//
// What changed the cost/benefit: Nuno's own account of using this tab was "I
// save one change and he deleted the previous ones I made, and never can reach
// a final result that I like". Re-picking the base theme IS a full reset, and
// that is the problem — the only way to take back one bad nudge was to throw
// away every good one with it. A theme is a palette plus ~50 small placement
// objects: a few kB per snapshot, a few hundred at the 200-entry cap.
// See pushBoardSnapshot/restoreWorkingTheme below.
// IDEA-029: widened from "character" | "board" to add "props" — every OTHER
// reference to Mode/mode in this board-mode block (the keydown guard, the
// per-frame character-only gate, boardTest hook) already tests `mode ===
// "character"` or `mode !== "character"` rather than branching on the OLD
// binary directly, so none of them need editing for a third mode to slot in
// safely — see setMode below (rewritten as a real 3-way switch) for the one
// place that DID need updating.
// "pickups" is a second CHARACTER-shaped mode: same panes, same machinery,
// different registry and source file. It is a separate tab rather than more
// entries in the character dropdown because a bone has no skin, no team
// colour and no walk cycle — different things to reason about, same tools.
type Mode = "character" | "pickups" | "board" | "props" | "balance" | "world";
let mode: Mode = "character";

// IDEA-030/031: onTreeSelect now branches on WHICH KIND of row was clicked —
// the six palette-slot rows (Atmosphere/Walls/.../Specks) still just
// open/scroll to their existing lil-gui folder via focusSlot (unchanged
// behavior), but the two placement rows ("Props (apron)"/"Wall components")
// instead SWITCH boardPlacement's active sub-mode (which candidate tiles
// show slot markers and are clickable) — see boardTree.ts's own header for
// why these two rows don't map to a static folder at all. `boardPlacement`
// itself is constructed further below (after boardStage/boardGrid exist),
// so this callback reads it through a mutable `let` set once at the bottom
// of the board-mode section — declared here, ASSIGNED there (TDZ-safe: this
// callback only ever RUNS after a user click, always after module init has
// finished and the assignment below has already run).
const boardTreeContainer = treeContainer; // #partTree — same DOM node, one view owns it at a time
const boardTree = createBoardTreeView(boardTreeContainer, (id: BoardTreeRowId) => {
  boardTree.setSelected(id);
  if (isPlacementRow(id)) {
    boardPlacement.setSubMode(id === "placementApron" ? "apron" : "wall");
    return;
  }
  boardInspector.focusSlot(id);
});

const boardStage = createBoardStage(stage.scene, getMazeTheme(DEFAULT_MAZE_THEME_ID).palette);
boardStage.setVisible(false);

// --- board-mode camera framing ---
// stage.ts's camera/orbit are tuned for CHARACTER scale (a ~1-unit-tall
// beagle, orbit distance capped at CAM_MAX_DISTANCE = 12) — reused as-is for
// a 19x21 tile board, the maze would fill only a tiny corner of frame (or,
// at min distance, the camera would sit INSIDE a wall). Board mode re-targets
// the SAME camera/orbit instance (see stage.ts's `orbit` export) to frame the
// whole board instead, and setMode's toChar branch restores the exact
// character defaults (CAM_POS/CAM_LOOK/CAM_FOV/orbit distance limits,
// imported from stage.ts) on the way back — see setCharacterCameraFraming.
const BOARD_LOOK = new THREE.Vector3(0, 0, -0.5); // matches scene.ts's BASE_LOOK — a hair toward the far wall
const BOARD_DIR = new THREE.Vector3(0, 27, 15.5).normalize(); // matches scene.ts's BASE_POS direction (angled top-down)
const BOARD_MIN_DISTANCE = 4;
// COLS/ROWS ~19x21 tiles; a generous ceiling so the orbit can pull back
// further than the board's own default fit distance if the user wants to.
const BOARD_MAX_DISTANCE = Math.max(COLS, ROWS) * 4;

function setBoardCameraFraming(): void {
  const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
  const dist = computeFitDistance(BOARD_DIR, BOARD_LOOK, CAM_FOV, aspect, BOARD_MIN_DISTANCE);
  stage.camera.fov = CAM_FOV;
  stage.camera.position.copy(BOARD_LOOK).addScaledVector(BOARD_DIR, dist);
  stage.camera.lookAt(BOARD_LOOK);
  stage.camera.updateProjectionMatrix();
  stage.orbit.target.copy(BOARD_LOOK);
  stage.orbit.minDistance = BOARD_MIN_DISTANCE;
  stage.orbit.maxDistance = BOARD_MAX_DISTANCE;
  stage.orbit.update();
}

function setCharacterCameraFraming(): void {
  stage.camera.fov = CAM_FOV;
  stage.camera.position.copy(CAM_POS);
  stage.camera.lookAt(CAM_LOOK);
  stage.camera.updateProjectionMatrix();
  stage.orbit.target.copy(CAM_LOOK);
  stage.orbit.minDistance = CAM_MIN_DISTANCE;
  stage.orbit.maxDistance = CAM_MAX_DISTANCE;
  stage.orbit.update();
}

// MAZES[0] — the "REAL validated maze" the brief asks for (npm run validate
// guards it: connected, every pellet reachable, ghosts can leave the pen).
// One Grid instance for board mode's whole lifetime: the maze layout never
// changes here (only its THEME does), and Grid is cheap but there is no
// reason to reconstruct it on every color-drag tick either.
const boardGrid = new Grid(MAZES[0]);

let board: Board | null = null;
let workingTheme: WorkingTheme = cloneWorkingTheme(getMazeTheme(DEFAULT_MAZE_THEME_ID));
let loadedBaseThemeId: string = DEFAULT_MAZE_THEME_ID;
let boardMaterials: BoardMaterialHandles | null = null;

/** Builds (once) or re-themes (every subsequent call) the live board from
 *  `workingTheme` — buildBoard reads whatever theme is currently "equipped"
 *  (an in-memory-only module flag in src/game/themes.ts; mutating it here has
 *  NO effect on any real game session, since /editor/ is a wholly separate
 *  page load with its own module graph — see themes.ts's own doc comment on
 *  setEquippedMazeThemeId), so the first build seeds the equipped id from
 *  whatever base theme was picked, then applyBoardTheme immediately pushes
 *  the actual (possibly already-edited) working palette on top — the same
 *  two-step a real re-theme-mid-run does in game.ts, just against this
 *  stage's own grid/scene instead of the game's. */
function rebuildBoardFromWorkingTheme(): void {
  if (!board) {
    setEquippedMazeThemeId(loadedBaseThemeId);
    board = buildBoard(boardStage.boardRoot, boardGrid);
    const wallMat = board.walls.material;
    const floorMat = board.floor.material;
    const biscuitEntry = [...board.pelletMeshes.values()].find((p) => p.kind === "biscuit");
    if (Array.isArray(wallMat) || Array.isArray(floorMat) || !biscuitEntry) {
      throw new Error("editor: board mode expected single shared materials — buildBoard's contract changed?");
    }
    boardMaterials = {
      wall: wallMat as THREE.MeshStandardMaterial,
      floor: floorMat as THREE.MeshStandardMaterial,
      biscuit: (biscuitEntry.mesh as THREE.Mesh).material as THREE.MeshStandardMaterial,
    };
  }
  // applyBoardTheme reads `theme.palette` AND `theme.props` (see board.ts) —
  // id/name/price are irrelevant to it, so passing `workingTheme` directly (a
  // WorkingTheme, structurally a MazeTheme since WorkingPalette satisfies
  // ThemePalette and WorkingThemeProp satisfies ThemeProp) is safe without
  // constructing a throwaway object. This is also the ONE live-apply path the
  // Props folder's every control (add/remove/kind/density/scale/color) routes
  // through via `onDecorChange` — see boardInspector.ts's header note.
  applyBoardTheme(board, boardStage.boardRoot, boardGrid, workingTheme);
  boardStage.applyPalette(workingTheme.palette);
  boardStage.setSky(workingTheme.palette.bg, workingTheme.palette.backdropTop);
}

// IDEA-062: the proxy the transform gizmo drives in board mode. Parented to
// boardStage.boardRoot so it shares the board's coordinate space (worldX/
// worldZ already account for the OX/OZ centring). See placementGizmo.ts for
// why a proxy and not the prop mesh itself — the short version is that
// buildProps CLAMPS a tall prop's scale, so reading it back off the mesh
// would destroy an authored 1.8 on any drag, including a pure rotate.
const placementGizmo = createPlacementGizmo(boardStage.boardRoot);

/** Commits a board placement gizmo drag: proxy -> placement data (clamped),
 *  one board rebuild, one undo step. */
function commitPlacementGizmo(): void {
  const sel = boardPlacement.getSelection();
  if (!sel?.existing) return;
  const m = gizmo.getMode();
  if (!placementGizmo.commit(sel, m)) return; // clamped to where it already was
  rebuildBoardFromWorkingTheme();
  boardPlacement.refreshMarkerFor(sel.tile);
  boardInspector.refreshPlacementDisplays(); // the number fields must follow the handle
  // No coalesce key: a drag is already one complete gesture, and sharing a key
  // with the inspector's sliders would let a drag swallow a later typed value.
  recordBoardEdit(`${m} placement`);
}

/** Commits a props-mode part gizmo drag. A near-literal mirror of the
 *  character branch — props already had `propHistory`, the commit function and
 *  a viewport picker; all that was missing was the handle. */
function commitPropPartGizmo(
  channel: TransformChannel,
  changes: readonly { object: THREE.Object3D; before: Vec3Tuple; after: Vec3Tuple }[],
): void {
  const moved = changes
    .map((c) => ({ node: propPartNodeByObject.get(c.object), change: c }))
    .filter((m): m is { node: PartNode; change: (typeof changes)[number] } => m.node !== undefined);
  if (moved.length === 0) return;
  for (const m of moved) propPartLog.touchTransform(m.node, channel);
  if (moved.length === 1) {
    pushPropTransformHistory(moved[0].node, channel, moved[0].change.before, moved[0].change.after);
  } else {
    propHistory.begin();
    for (const m of moved) pushPropTransformHistory(m.node, channel, m.change.before, m.change.after);
    propHistory.commit(`${channel} ${moved.length} parts`);
  }
  afterPropHistoryApply(selectedPropPart);
}

// ---------------------------------------------------------------------------
// IDEA-062: board undo/redo — coarse WorkingTheme snapshots.
//
// See the UNDO DECISION note above for why this shape, and why it is the one
// that note itself proposed. The whole mechanism is three functions and no new
// history.ts vocabulary.
const boardHistory = new History();

/** Replaces the working theme with a snapshot and re-applies everything that
 *  reads it.
 *
 *  Clones on EVERY apply rather than adopting the stored object: an undo entry
 *  can be replayed any number of times (undo, redo, undo again), and handing
 *  out the same object twice would let the second replay be mutated by edits
 *  made after the first — the stored snapshot would stop being a snapshot. */
function restoreWorkingTheme(snap: WorkingTheme): void {
  workingTheme = cloneWorkingTheme(snap);
  // The restored state is now the "before" for whatever is edited next —
  // without this, the edit after an undo would record a before/after pair
  // spanning the undo itself and one Ctrl+Z would jump two steps.
  boardBaseline = cloneWorkingTheme(snap);
  rebuildBoardFromWorkingTheme();
  if (boardMaterials) {
    boardInspector.setTheme(workingTheme, loadedBaseThemeId, boardMaterials, boardStage.lights);
  }
  // A full marker resync is right here for the same reason loadBaseTheme does
  // it: after a restore, every marker's empty/filled state and the current
  // selection may both be stale — the placement the user had selected can
  // simply not exist in the snapshot being restored.
  //
  // But losing the selection on every undo is its own annoyance: undo one
  // nudge and you are dropped back to nothing selected, unable to carry on
  // adjusting the thing you were adjusting. So the tile is re-selected if it
  // still carries a placement — and honestly NOT if it does not (undoing the
  // creation of a placement leaves an empty slot, and faking a selection on
  // one would be inventing a click the user never made).
  const keep = boardPlacement.getSelection();
  boardPlacement.syncFromTheme(workingTheme);
  if (keep) boardPlacement.reselect(keep.subMode, keep.tile);
  syncGizmo();
}

/**
 * The last state this history knows about — i.e. the "before" for whatever
 * edit happens next.
 *
 * This is what lets board undo work WITHOUT touching boardInspector.ts at all.
 * lil-gui binds its controllers straight to `workingTheme`, so by the time an
 * `onChange` reaches main.ts the object has ALREADY been mutated and there is
 * no pre-edit value left to capture. Carrying a baseline forward sidesteps
 * that entirely: nothing else mutates `workingTheme` between commits, so the
 * baseline IS the pre-edit state, for a palette slider and a placement nudge
 * alike. The alternative — threading an onGestureStart/onGestureEnd pair
 * through every one of the inspector's several dozen controls — would be a
 * large surgery with a new way to be wrong at each call site.
 */
let boardBaseline: WorkingTheme = cloneWorkingTheme(workingTheme);

/**
 * Records one committed board gesture and advances the baseline.
 *
 * `coalesceKey` folds a continuous gesture into one entry — a slider drag, or
 * a run of arrow-key nudges on one tile — the same way the character
 * workbench's own nudges coalesce. history.ts keeps the OLDER entry's undo and
 * adopts the newer redo, which is exactly right for a snapshot pair: you undo
 * to where the drag started and redo to where it ended.
 */
function recordBoardEdit(label: string, coalesceKey?: string): void {
  const before = boardBaseline;
  const after = cloneWorkingTheme(workingTheme);
  boardBaseline = after;
  boardHistory.push({
    undo: () => restoreWorkingTheme(before),
    redo: () => restoreWorkingTheme(after),
    coalesceKey,
    label,
  });
}

/** Loads a fresh working copy of a MAZE_THEMES entry — the ONLY place
 *  `workingTheme` is reassigned to a new object (every other board edit
 *  mutates the existing one in place), so this is also the natural
 *  "reset/undo everything" action (see the UNDO DECISION note above).
 *
 *  IDEA-030/031: also re-syncs boardPlacement's slot markers from the fresh
 *  `workingTheme` — DELIBERATELY here, not inside rebuildBoardFromWorkingTheme
 *  itself, even though that function also runs on every placement edit: a
 *  base-theme swap is the one moment marker state should be FULLY rebuilt
 *  (every marker's empty/filled color re-derived from the fresh theme's
 *  placements/wallDecor, and any stale selection cleared — the OLD theme's
 *  selected placement no longer exists once workingTheme is a whole new
 *  object). A single placement edit's own onChange, by contrast, must NOT
 *  clear the very selection that triggered it — see boardPlacement's
 *  syncFromTheme doc comment ("Clears the current selection") and the
 *  createBoardPlacement call site above, whose onChange calls
 *  rebuildBoardFromWorkingTheme WITHOUT ever calling syncFromTheme. */
function loadBaseTheme(id: string, recordUndo = true): void {
  // IDEA-062: a base-theme swap is itself undoable now. It used to BE the undo
  // ("re-picking the base theme is a full reset"), which was the problem: the
  // only way to take back one bad nudge was to throw away every good one with
  // it. `recordUndo` is false only for the first entry into board mode, where
  // there is no prior state to return to.
  const before = boardBaseline;
  loadedBaseThemeId = id;
  workingTheme = cloneWorkingTheme(getMazeTheme(id));
  boardBaseline = cloneWorkingTheme(workingTheme);
  rebuildBoardFromWorkingTheme();
  if (!boardMaterials) throw new Error("editor: board materials not captured after buildBoard");
  boardInspector.setTheme(workingTheme, loadedBaseThemeId, boardMaterials, boardStage.lights);
  boardPlacement.syncFromTheme(workingTheme);
  syncGizmo();
  if (recordUndo) {
    const after = cloneWorkingTheme(workingTheme);
    boardHistory.push({
      undo: () => restoreWorkingTheme(before),
      redo: () => restoreWorkingTheme(after),
      label: `load theme ${workingTheme.name}`,
    });
  }
}

const boardInspector = createBoardInspector(boardGuiHost, {
  onBaseTheme: (id) => loadBaseTheme(id),
  onAtmosphereBg: () => {
    boardStage.setSky(workingTheme.palette.bg, workingTheme.palette.backdropTop);
    recordBoardEdit("sky", "board:atmosphere");
  },
  onDecorChange: () => {
    rebuildBoardFromWorkingTheme();
    // IDEA-062: ONE coalesce key for every palette/decor control, deliberately.
    // history.ts merges same-key entries pushed within COALESCE_MS, so a
    // slider drag collapses to a single step — which is what you want — and
    // two different sliders touched a second apart stay separate steps, which
    // is also what you want. A per-control key would be more precise and buy
    // nothing: a snapshot restores the whole theme either way, so splitting
    // two edits made inside the same second into two entries would only make
    // Ctrl+Z feel slower without making it more accurate.
    recordBoardEdit("board edit", "board:decor");
  },
  onMetaChange: () => recordBoardEdit("theme details", "board:meta"),
  onCopyCode: () => {
    const code = formatThemeEntry(workingTheme, 2);
    return navigator.clipboard.writeText(code);
  },
  // IDEA-034: "💾 Save to themes.ts" — generateFullThemesFile splices
  // `workingTheme`'s formatted entry back into the REAL themes.ts's raw
  // source (replacing whichever entry's id matches `loadedBaseThemeId` — the
  // registry id this working copy started from, NOT necessarily
  // `workingTheme.id`, since that field is free-text-editable — see
  // loadBaseTheme's own bookkeeping and generateFullThemesFile's doc comment
  // on why the base id, not the current id, is the right lookup key), then
  // saveEditorFile writes the result to disk via the SAME dev-only endpoint
  // characters.ts's own "Save to characters.ts" button already uses (see
  // saveFile.ts — src/game/themes.ts is already on vite.config.ts's
  // EDITOR_SAVABLE_FILES whitelist). Never throws: a null from
  // generateFullThemesFile (MAZE_THEMES's own delimiters unrecognizable) or a
  // failed fetch both resolve to `{ ok: false, error }` for the button to
  // flash, exactly mirroring saveEditorFile's own "never throws" contract.
  onSaveFile: async () => {
    const full = generateFullThemesFile(workingTheme, loadedBaseThemeId);
    if (!full) return { ok: false, error: "could not locate MAZE_THEMES in themes.ts" };
    return saveEditorFile("src/game/themes.ts", full);
  },
});

// IDEA-030/031: the placement-interaction controller — ONE instance for
// board mode's whole lifetime (mirrors boardStage/boardInspector's own
// "created once, reused across every base-theme swap" shape). Constructed
// here (after boardStage.boardRoot/boardGrid/stage.camera/canvas all
// already exist) — `boardTree`'s onSelect callback ABOVE already reads this
// variable, but only from inside a click handler that can't fire before
// this line runs (module init is synchronous top-to-bottom; DOM click
// events can't interleave mid-script) — see boardTree's construction site
// for the TDZ-safety note.
//
// onChange -> rebuildBoardFromWorkingTheme: every placement mutation
// (create/swap/nudge/remove) re-applies the live board EXACTLY like a
// palette edit's onDecorChange does — same shared function, so a placement
// edit and a bloom-color edit can never drift onto two different rebuild
// paths.
//
// onSelectionChange -> keeps boardTree's row highlight in sync (a filled/
// empty MARKER click doesn't change which TREE ROW is "selected" — that
// stays on "Props (apron)"/"Wall components" for as long as that sub-mode
// is active — so this callback does NOT touch boardTree.setSelected; it
// only forwards the selection to boardInspector's "Placement" folder).
const boardPlacement = createBoardPlacement(
  canvas,
  stage.camera,
  boardStage.boardRoot,
  boardGrid,
  () => {
    rebuildBoardFromWorkingTheme();
    // Every placement mutation boardPlacement performs — create, prop swap,
    // remove, keyboard nudge — funnels through this one onChange, so it is
    // also the one place a placement undo step needs to be recorded. The
    // nudge coalesce is handled by the shared key: a run of arrow presses
    // inside a second becomes one step.
    recordBoardEdit("placement", "board:placement");
    // IDEA-062: the gizmo handle must follow a keyboard nudge or an inspector
    // slider, not sit where the last drag left it — otherwise the next drag
    // starts from a pose the board is not actually in.
    const sel = boardPlacement.getSelection();
    if (sel?.existing) placementGizmo.sync(sel);
  },
  (selection: PlacementSelection | null) => {
    syncGizmo(); // a placement selection is a gizmo target (IDEA-062)
    boardInspector.setPlacementSelection(selection, () => {
      rebuildBoardFromWorkingTheme();
      // A field edit (offset/rotation/scale/prop swap) changes what this ONE
      // marker should show (still filled, but e.g. a different prop) —
      // repaint just it rather than a full syncFromTheme (which would also
      // clear the very selection whose field we're editing).
      if (boardPlacement.getSelection()) boardPlacement.refreshMarkerFor(boardPlacement.getSelection()!.tile);
    });
  },
);
boardInspector.bindPlacementActions({
  assignProp: (propId) => boardPlacement.assignProp(propId),
  removeSelected: () => boardPlacement.removeSelected(),
});

// IDEA-030/031/034: keyboard editing for the selected placement — offset
// (arrows), rotation (`[`/`]`), scale (`-`/`=`), and delete (Delete key), all
// in ONE listener since they share the exact same mode/focus guards. Reusing
// the editor's existing arrow-nudge convention (the task brief) — same
// NUDGE_STEP/NUDGE_COARSE(Shift)/NUDGE_FINE(Alt) constants the character-mode
// position nudge above already uses, and the same capture-phase +
// inTextField/HTMLSelectElement guard so typing in a lil-gui number field or
// using a dropdown's own arrow keys is never hijacked. Kept as its OWN
// listener (not folded into the character-mode one above) because that
// handler's very first line is `if (mode !== "character") return;` — adding
// a board-mode branch there would mean threading a second mode check through
// every line below it; a second listener scoped to `mode === "board"` is a
// direct, minimal addition instead, mirroring how the character listener is
// itself scoped to character mode via its own early return.
//
// Left/Right nudge offset X; Up/Down nudge offset Z (matches grid.ts's own
// `up = -Z, down = +Z` convention documented in CLAUDE.md, so "down" on the
// keyboard moves the marker visually toward the camera, same as the
// character-mode position nudge's un-Ctrl'd Up/Down-on-Y vs Ctrl'd
// Up/Down-on-Z split does for its own depth axis). No Ctrl-axis-swap here
// (unlike the character nudge, which reassigns Up/Down from Y to Z under
// Ctrl) — an apron placement's only two nudgeable axes ARE offset X/Z, so
// there is no third axis to make room for.
//
// IDEA-034 ROTATION-FIRST-CLASS: Nuno's brief specifically calls out rotation
// ("I need to rotate them") — `[`/`]` (a mnemonic-free but keyboard-ergonomic
// pair sitting right next to Enter, unclaimed by any browser/OS shortcut, and
// already precedented as a "rotate the current selection" idiom in other
// editors, e.g. many level/scene tools bind bracket keys to yaw) rotate the
// CURRENTLY SELECTED placement (either sub-mode — see
// boardPlacement.nudgeSelectedRotation's own doc comment for why rotation,
// unlike offset, isn't apron-only) counter-/clockwise. Arrow keys were
// already fully claimed by offset nudging above, and reusing the character
// mode's "hold R + arrows" scheme here would collide with board mode's OWN
// arrow-key meaning (offset, not rotation) — bracket keys sidestep that
// collision entirely rather than needing a modifier-held state variable.
// `-`/`=` (the unshifted keys immediately left of Backspace — no Shift needed
// for either, so this never fights the Shift-for-coarse-step convention every
// other nudge here already uses) scale it up/down. The viewport hint (see
// editor/index.html) documents both for a first-time user.
const BOARD_ROTATE_STEP = 0.12; // radians per keypress — a clearly visible turn, not the slider-drag-grain 0.01 boardInspector.ts's own ROTATION_STEP uses
const BOARD_ROTATE_COARSE = Math.PI / 4; // Shift: quarter-turn snaps
const BOARD_ROTATE_FINE = 0.02; // Alt: fine adjustment
const BOARD_SCALE_STEP = 0.04;
const BOARD_SCALE_COARSE = 0.2;
const BOARD_SCALE_FINE = 0.01;

window.addEventListener(
  "keydown",
  (e) => {
    if (mode !== "board") return;
    const active = document.activeElement;
    const inTextField = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
    if (inTextField || active instanceof HTMLSelectElement) return; // arrows/typing inside a widget belong to it

    // IDEA-062: board undo/redo. Its own listener rather than the character
    // one's, because that listener early-returns on `mode !== "character"`
    // and the two histories are genuinely separate stacks — a Ctrl+Z in
    // board mode must never reach into the character's.
    if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) {
      e.preventDefault();
      if (e.shiftKey) boardHistory.redo();
      else boardHistory.undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === "y" || e.key === "Y")) {
      e.preventDefault();
      boardHistory.redo();
      return;
    }

    // IDEA-062: the gizmo mode keys, matching the character workbench's own
    // W/E/T (deliberately not the reference editor's W/E/R — see that
    // listener's note: R and S are held modifiers here).
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === "w" || k === "e" || k === "t") {
        e.preventDefault();
        gizmo.setMode(k === "w" ? "translate" : k === "e" ? "rotate" : "scale");
        return;
      }
      if (k === "q") {
        e.preventDefault();
        setGizmoEnabled(!gizmo.isEnabled());
        return;
      }
    }

    if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const step = e.shiftKey ? NUDGE_COARSE : e.altKey ? NUDGE_FINE : NUDGE_STEP;
      let dx = 0;
      let dz = 0;
      if (e.key === "ArrowLeft") dx = -step;
      else if (e.key === "ArrowRight") dx = step;
      else if (e.key === "ArrowUp") dz = -step;
      else if (e.key === "ArrowDown") dz = step;

      const nudged = boardPlacement.nudgeSelectedOffset(dx, dz);
      if (!nudged) return; // no selection, wall-mode selection, or empty slot — nothing to nudge
      e.preventDefault();
      // nudgeSelectedOffset already called boardPlacement's own onChange
      // (rebuildBoardFromWorkingTheme) internally — but it does NOT rebuild
      // the inspector's Placement folder (unlike assignProp/removeSelected,
      // it deliberately does not re-fire setSelection on every single nudge
      // tick, so a fast arrow-key run doesn't thrash the folder's DOM while
      // the offset sliders are mid-drag-equivalent) — refresh just the
      // slider DISPLAYS so they reflect the nudged value without a full
      // folder rebuild, the same "updateDisplay, don't rebuild" idiom
      // inspector.ts's own arrow-nudge path uses for position widgets.
      boardInspector.refreshPlacementDisplays();
      return;
    }

    // IDEA-034 gotcha: matched on `e.code` (the PHYSICAL key, e.g.
    // "BracketRight"), not `e.key` — `e.key` reflects what the key actually
    // PRODUCES, which changes under Shift on a standard layout
    // (Shift+"]" -> "}", Shift+"-" -> "_", Shift+"=" -> "+") — matching on
    // `e.key === "]"` would silently stop working the instant Shift is held,
    // exactly the moment BOARD_ROTATE_COARSE/BOARD_SCALE_COARSE are supposed
    // to kick in. `e.code` identifies the physical key regardless of
    // Shift/Alt/layout, so "hold Shift for the coarse step" (the same
    // modifier convention every other nudge in this file already uses) keeps
    // working correctly.
    if (e.code === "BracketLeft" || e.code === "BracketRight") {
      const step = e.shiftKey ? BOARD_ROTATE_COARSE : e.altKey ? BOARD_ROTATE_FINE : BOARD_ROTATE_STEP;
      const delta = e.code === "BracketLeft" ? -step : step;
      const rotated = boardPlacement.nudgeSelectedRotation(delta);
      if (!rotated) return;
      e.preventDefault();
      boardInspector.refreshPlacementDisplays(); // same "updateDisplay, don't rebuild" idiom as the offset nudge above
      return;
    }

    if (e.code === "Minus" || e.code === "Equal") {
      const step = e.shiftKey ? BOARD_SCALE_COARSE : e.altKey ? BOARD_SCALE_FINE : BOARD_SCALE_STEP;
      const delta = e.code === "Minus" ? -step : step;
      const scaled = boardPlacement.nudgeSelectedScale(delta);
      if (!scaled) return;
      e.preventDefault();
      boardInspector.refreshPlacementDisplays();
      return;
    }

    // IDEA-034: Delete removes the selected placement — the same dispatch
    // path the inspector's own "remove this placement 🗑" button already
    // uses (boardPlacement.removeSelected() drives the marker repaint + live
    // board re-apply + folder teardown via the SAME onSelectionChange chain
    // every other removal already goes through — see
    // boardPlacement.ts:removeSelected's own doc comment). A no-op (not an
    // error) when nothing is selected or the selection is already an empty
    // slot, mirroring removeSelected's own guard — so this is safe to fire
    // on every Delete keypress in board mode without a manual "is there
    // something to delete" pre-check duplicating removeSelected's own.
    if (e.key === "Delete") {
      e.preventDefault();
      boardPlacement.removeSelected();
    }
  },
  true,
);

// ===========================================================================
// --- props mode (IDEA-029, dev-only) ---
// A THIRD workbench alongside character/board: the reusable PROP LIBRARY
// (src/game/props.ts's PROP_LIBRARY) as its own editable surface — a list of
// every def (left, reusing #partTree exactly like board mode's slot list
// does), a live single-prop turntable preview (center, built via the SAME
// render/board.ts makePropFromDef the real game/board mode both use — never
// a re-implementation), and a lil-gui inspector (right) for the selected
// def's name/id/shape/params.
//
// Nuno's ask: "reuse the props on different themes… personalize the props
// later" — a PropDef is already the reusable, hand-tunable unit referenced
// BY ID from any theme's placements/wallDecor (see props.ts's own header);
// this tab is where that def gets AUTHORED/tuned, independent of any one
// theme's placements. This tab never edits WHERE a prop is placed (tile/
// offset/rotation/scale on a theme) — that's the placement editor inside
// board mode (a parallel piece of work) — only what the prop definition
// ITSELF looks like, shared by every theme that references its id.
//
// Working-copy discipline mirrors board mode exactly: `workingLibrary` is a
// deep copy of PROP_LIBRARY (see propsWorking.ts's cloneWorkingLibrary),
// taken ONCE on the FIRST entry into Props mode and never re-cloned on
// subsequent entries (same "the base-theme dropdown is the only reset" idea
// board mode uses, just there is no per-def "reset to registry" dropdown
// here — Props mode has no analogous "start over" affordance beyond a page
// reload, which is an acceptable v1 scope match for a dev-only tool with no
// undo in board mode either).
let workingLibrary: WorkingPropDef[] = [];
let libraryLoaded = false;
let selectedPropId: string | null = null;

/** The live single-prop preview: a small container Group holding exactly the
 *  CURRENT selection's mesh (rebuilt via makePropFromDef on every param
 *  change), added directly to the shared stage scene (not `stage.contentRoot`
 *  — that group is the CHARACTER turntable's own wrapper, entangled with
 *  character-mode's rotation/disposal; the props preview needs an
 *  independent lifetime) and toggled visible alongside the shared neutral
 *  ground disc (stage.ts's own `setGroundVisible`), so a selected prop reads
 *  on the exact same character-scale rig (ground + daylight) character mode
 *  already uses — no bespoke atmosphere needed for a single small object. */
const propsPreviewRoot = new THREE.Group();
stage.scene.add(propsPreviewRoot);
propsPreviewRoot.visible = false;

const propsPreview = {
  currentMesh: null as THREE.Group | null,
  setVisible(on: boolean): void {
    propsPreviewRoot.visible = on;
  },
};

/** Disposes the current preview mesh's geometries/materials (every
 *  makePropFromDef factory builds its OWN, per board.ts's doc comments —
 *  never a shared module-level material — so a full traverse-dispose is
 *  correct and complete, same shape as board.ts's own disposePropGroup). */
function disposePropsPreview(): void {
  if (!propsPreview.currentMesh) return;
  propsPreviewRoot.remove(propsPreview.currentMesh);
  propsPreview.currentMesh.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      const mat = o.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat.dispose();
    }
  });
  propsPreview.currentMesh = null;
}

/** Rebuilds the live preview from the currently selected working def — the
 *  ONE function every param/shape/name edit funnels through (propsInspector's
 *  onChange), so "every change rebuilds the preview live" (the brief) is a
 *  single code path, not one per field. A fixed instanceHash (0.5 — the
 *  midpoint of makePropFromDef's 0..1 variance range) keeps the preview
 *  visually STABLE across edits (a color-list edit shouldn't also reroll
 *  which color an instance happens to show), unlike the real board's
 *  per-tile deterministic hash. */
const PREVIEW_INSTANCE_HASH = 0.5;

/** IDEA-033: writes the LIVE part-edit log's current state back onto
 *  `def.parts` (undefined again if the user genuinely undid every edit back
 *  to nothing — see the isDirty guard below for exactly how that's told
 *  apart from "nothing to flush") — called right before rebuildPropsPreview
 *  tears down and rebuilds the mesh, so a rebuild triggered by an unrelated
 *  "Base" params/name/shape edit NEVER loses in-progress part edits: they
 *  flow def.parts -> (torn down) -> makePropFromDef re-applies them onto the
 *  fresh mesh -> propPartLog.snapshot() re-baselines against that (now
 *  identical) result. Also the ONLY place `def.parts` is written outside the
 *  inspector's own shape-swap reset (propsInspector.ts) — codegen/save both
 *  read `workingLibrary` directly, so this must run before either of THOSE
 *  too (see the copy/save button handlers below, which call it first).
 *
 *  Targets `propPartLogOwnerId` — NOT `selectedPropId` (see that variable's
 *  own doc comment for the exact bug this avoids: selectProp() already
 *  reassigns selectedPropId to the INCOMING def before rebuildPropsPreview
 *  ever calls this function, so flushing against selectedPropId would write
 *  the OUTGOING def's edits onto the wrong entry).
 *
 *  Skips ENTIRELY when `!propPartLog.isDirty` — a real bug found during
 *  testing: TWO back-to-back rebuilds of the SAME def with no genuine edit
 *  in between (e.g. leaving Props mode and re-entering it with the same
 *  selection still active — enterPropsMode() unconditionally calls
 *  rebuildPropsPreview()) would otherwise see an "empty" log on the SECOND
 *  flush (the first rebuild's own snapshot() already re-baselined it to
 *  match the just-saved def.parts) and misread that as "the user undid
 *  everything", silently deleting the def's own already-correct parts.
 *  isDirty (see propPartEditLog.ts's own doc comment) distinguishes
 *  "genuinely untouched since the last snapshot" from "touched, and now
 *  happens to read as empty because every edit was explicitly undone" —
 *  only the latter should ever clear def.parts. */
function syncPartsIntoWorkingDef(): void {
  if (!propPartLog || !propPartLogOwnerId || !propPartLog.isDirty) return;
  const def = workingLibrary.find((d) => d.id === propPartLogOwnerId);
  if (!def) return;
  // IDEA-062: MERGE onto the def's saved layer, never REPLACE it.
  //
  // This line used to read `def.parts = propPartLog.toPropPartLayer()`, and
  // it was the worst bug the editor has had. The log's baselines are taken
  // from a mesh makePropFromDef has ALREADY applied `def.parts` to, so
  // toPropPartLayer() can only ever describe this session's deltas — and
  // assigning those as the whole field deleted every previously-saved edit
  // the instant you touched one part in a later session. The treehouse went
  // from seven edits to one that way, in Nuno's own working tree.
  //
  // mergeIntoSaved() returns undefined for a genuinely empty result, which
  // is what keeps the "the user undid everything" path (guarded by isDirty
  // above) working exactly as its long comment describes.
  const layer = propPartLog.mergeIntoSaved();
  if (!layer) delete def.parts;
  else def.parts = layer;
}

function rebuildPropsPreview(): void {
  syncPartsIntoWorkingDef(); // flush any live part edits onto the OUTGOING def first
  selectPropPart(null); // clears selection/highlight before the old mesh is disposed
  disposePropsPreview();
  const def = selectedPropId ? workingLibrary.find((d) => d.id === selectedPropId) : undefined;
  if (!def) {
    propPartTree.render([]);
    propPartLogOwnerId = null; // nothing selected -> nothing for a future flush to target
    return;
  }
  // makePropFromDef takes a PropDef (params fields are `readonly number[]`
  // where present) — a WorkingPropDef's params satisfy that structurally
  // (mutable arrays are assignable to readonly ones), so no conversion is
  // needed beyond the type-level widen already expressed in propsWorking.ts.
  // IDEA-033: this call ALSO re-applies def.parts (if any) via board.ts's own
  // applyPropParts — the exact same function the real game uses — so the
  // editor's preview and the shipped board can never show a part-edited prop
  // differently.
  const mesh = makePropFromDef(def, PREVIEW_INSTANCE_HASH);
  mesh.traverse((o) => { o.castShadow = true; });
  // IDEA-062: hand every previously-SAVED added part its identity back
  // BEFORE the tree is walked, so buildPartList sees `userData.editorAdded`
  // and marks the row correctly. Doing it after the walk would leave the
  // tree calling a user-added part a base part for the rest of the session.
  tagSavedAddedParts(mesh, def.parts);
  propsPreviewRoot.add(mesh);
  propsPreview.currentMesh = mesh;
  // A genuinely NEW mesh — every part's authored pose/material must be
  // re-baselined against IT (a fresh PropPartEditLog), unlike
  // refreshPropParts' own re-walk below (called after add/delete, where the
  // mesh is the SAME live object with one child added/removed — see that
  // function's own doc comment on why it must NEVER replace the log).
  propPartLog = new PropPartEditLog();
  propPartLogOwnerId = def.id; // this log now belongs to THIS def — see its own doc comment
  refreshPropParts();
  // IDEA-062: the saved layer goes IN with the snapshot — it is the thing the
  // baselines were read through, and mergeIntoSaved has nothing to merge onto
  // without it. Adoption must come AFTER, because snapshot() clears `added`.
  propPartLog.snapshot(propPartNodes, def.parts);
  adoptSavedAddedParts(propPartLog, propPartNodes, def.parts);
}

/** IDEA-062: re-tag the meshes board.ts's addPropPart rebuilt from a def's
 *  saved `parts.added`, so the editor can tell them apart from base parts
 *  again.
 *
 *  No shipped render change was needed for this: addPropPart already does
 *  `mesh.name = added.id` (board.ts), and an AddedPropPart's `id` is
 *  deliberately a stable, non-positional key — so a name match IS the
 *  identity. Without this the editor treats a previously-added part as an
 *  ordinary base node, which costs two things at once: editing it records a
 *  path edit that applyPropParts will overwrite, and the log's `added` array
 *  comes back empty so the merge would drop the part from the def entirely. */
function tagSavedAddedParts(mesh: THREE.Object3D, parts: PropPartLayer | undefined): void {
  if (!parts || parts.added.length === 0) return;
  const byName = new Map<string, THREE.Object3D>();
  mesh.traverse((o) => { if (o.name) byName.set(o.name, o); });
  for (const saved of parts.added) {
    const object = byName.get(saved.id);
    if (!object) continue; // the factory's shape changed under it — degrade, never throw
    object.userData.editorAdded = true;
    object.userData.addedPropPartId = saved.id;
  }
}

/** IDEA-062: rebuild a LiveAddedPropPart record for each saved added part and
 *  hand it back to the log, so this session's merge carries them forward and
 *  editing one updates its own record rather than emitting a path edit.
 *
 *  Reads the live mesh rather than the saved record for pose and colour, so
 *  an added part that the factory's own transform happens to move stays
 *  described by what is actually on screen (the same "live read is the truth"
 *  reasoning toPropPartLayer already applies to added parts). */
function adoptSavedAddedParts(
  log: PropPartEditLog,
  nodes: PartNode[],
  parts: PropPartLayer | undefined,
): void {
  if (!parts || parts.added.length === 0) return;
  const byId = new Map<string, PartNode>();
  for (const node of nodes) {
    const id = node.object.userData.addedPropPartId;
    if (typeof id === "string") byId.set(id, node);
  }
  for (const saved of parts.added) {
    const node = byId.get(saved.id);
    if (!node || !(node.object instanceof THREE.Mesh)) continue;
    const mat = Array.isArray(node.object.material) ? node.object.material[0] : node.object.material;
    if (!(mat instanceof THREE.MeshToonMaterial)) continue; // board.ts builds these with toon()
    log.adoptSaved({
      id: saved.id,
      parentPath: saved.parentPath,
      kind: saved.kind,
      object: node.object,
      material: mat,
      params: { ...saved.params },
    });
  }
}

// ===========================================================================
// --- props part editing (IDEA-033, dev-only) ---
// Selecting a library prop no longer just tunes SLIDERS — click any of its
// built components (in the viewport or the new "Components" tree below the
// library list) to move/scale/recolor/hide it, add brand-new primitive
// parts, or delete one — exactly the same interaction the character
// workbench already offers for the beagle, layered on top of (never
// replacing) the existing parametric shape+params controls above.
//
// `propPartLog` is rebuilt fresh every time rebuildPropsPreview() runs (a NEW
// preview mesh means every part's baseline pose/material must be
// re-snapshotted against IT, not the disposed one) — see that function's own
// call site. refreshPropParts (below) re-walks the tree on every structural
// change but deliberately NEVER touches propPartLog itself — see its own
// doc comment for why replacing the log there was a real bug during
// development.
let propPartNodes: PartNode[] = [];
let propPartNodeByObject = new Map<THREE.Object3D, PartNode>();
let propPartLog: PropPartEditLog = new PropPartEditLog();
/** IDEA-033: which working-library def `propPartLog` is CURRENTLY tracking —
 *  deliberately NOT the same thing as `selectedPropId`. `selectProp(id)`
 *  (propsTree's onSelect callback) assigns `selectedPropId = id` and THEN
 *  calls rebuildPropsPreview(), which calls syncPartsIntoWorkingDef() as its
 *  very first line — by that point `selectedPropId` already points at the
 *  INCOMING def, not the outgoing one whose edits actually live in
 *  `propPartLog`. Flushing against `selectedPropId` there was a real bug
 *  found during testing: switching from "Palm" (edited) to "Flower Bloom"
 *  silently wrote Palm's edits onto BLOOM's def instead of Palm's own, and
 *  Palm's `parts` field was never populated at all. `propPartLogOwnerId` is
 *  set ONLY where a fresh log is actually created (rebuildPropsPreview,
 *  right after `propPartLog = new PropPartEditLog()`) and read ONLY by
 *  syncPartsIntoWorkingDef — so the flush target is always "whichever def
 *  this log was snapshotted against", independent of whatever
 *  `selectedPropId` has since been reassigned to. */
let propPartLogOwnerId: string | null = null;
let selectedPropPart: PartNode | null = null;
const propHistory = new History(); // IDEA-033: props get their OWN undo stack, independent of character mode's

const propPartTree = createPartTreeView(propsPartTreeContainer, (node) => selectPropPart(node));
const propsPartInspector = createPropsPartInspector(propsGuiHost, {
  onAddPart: (kind, name) => addPropPart(kind, name),
});

/** Re-walks propsPreview.currentMesh into a fresh propPartNodes/
 *  propPartNodeByObject + re-renders the Components tree — called after
 *  EVERY structural change to that SAME live mesh (add-part attach/detach,
 *  delete/undo/redo of either kind) so the tree/lookup map never go stale.
 *
 *  Deliberately does NOT touch `propPartLog` — unlike rebuildPropsPreview
 *  (which constructs a genuinely NEW mesh and correctly re-baselines with a
 *  fresh log), every caller of THIS function is mutating the mesh the log
 *  is ALREADY tracking edits/added-parts against (an add/delete just
 *  attaches/detaches one child) — replacing the log here would silently
 *  drop whatever addPropPart/deletePropPartNode just recorded (this was a
 *  real bug during development: attach() called propPartLog.addPart(record)
 *  immediately followed by this function, which used to re-snapshot the log
 *  and wipe that very record before it could ever be found again). See
 *  rebuildPropsPreview's own call site for the ONE place a fresh log is
 *  actually correct. */
function refreshPropParts(): void {
  const mesh = propsPreview.currentMesh;
  if (!mesh) {
    propPartNodes = [];
    propPartNodeByObject = new Map();
    propPartTree.render([]);
    return;
  }
  const def = selectedPropId ? workingLibrary.find((d) => d.id === selectedPropId) : undefined;
  propPartNodes = buildPartList(mesh, def?.name ?? "Prop");
  propPartNodeByObject = new Map(propPartNodes.map((n) => [n.object, n]));
  propPartTree.render(propPartNodes);
  if (selectedPropPart) propPartTree.setSelected([selectedPropPart.path]);
}

/** Selection for a prop's OWN component — the props-mode analogue of
 *  character-mode's select(). Reuses the SAME `highlighter` instance
 *  character mode owns (stage.scene is shared and only one mode is ever
 *  interactive at a time — see setMode, which already clears the character
 *  selection via select(null) before entering Props mode, so the wireframe
 *  overlay can never belong to two modes at once). */
function selectPropPart(node: PartNode | null): void {
  selectedPropPart = node;
  propPartTree.setSelected(node ? [node.path] : []);
  highlighter.set(state.highlight && node ? [node] : []);
  propsPartInspector.setSelection(node, node ? propPartSelectionContext() : null);
  syncGizmo(); // IDEA-062: a prop component is a gizmo target like any part
}

function propPartSelectionContext() {
  return {
    log: propPartLog,
    addedRecord: selectedPropPart ? propPartLog.findAddedPart(selectedPropPart.object) : undefined,
    onEdit: () => {}, // Props mode has no bottom code panel to refresh (see main.ts's setMode note)
    onGeometryRebuilt: (node: PartNode) => {
      if (selectedPropPart === node) highlighter.set(state.highlight ? [node] : []);
    },
    onDelete: deletePropPartNode,
    onResetToFactory: (node: PartNode) => resetPropPartToFactory(node),
    onTransformCommitted: (node: PartNode, channel: PropTransformChannel, before: Vec3Tuple, after: Vec3Tuple) => {
      pushPropTransformHistory(node, channel, before, after);
    },
    onVisibleCommitted: (node: PartNode, before: boolean, after: boolean) => {
      const apply = (value: boolean) => (): void => {
        node.object.visible = value;
        propPartLog.touchVisible(node);
        afterPropHistoryApply(node);
      };
      propHistory.push({ undo: apply(before), redo: apply(after) });
    },
    onMaterialCommitted: (node: PartNode, channel: "color" | "emissive", before: number, after: number) => {
      const apply = (value: number) => (): void => {
        if (node.object instanceof THREE.Mesh) {
          const mat = Array.isArray(node.object.material) ? node.object.material[0] : node.object.material;
          if (isEditableMaterial(mat)) {
            if (channel === "color") mat.color.setHex(value);
            else if (hasEmissive(mat)) mat.emissive.setHex(value);
          }
        }
        propPartLog.touchMaterial(node, channel, value);
        afterPropHistoryApply(node);
      };
      propHistory.push({ undo: apply(before), redo: apply(after), coalesceKey: `propmat:${node.path}:${channel}` });
    },
    onParamCommitted: (record: LiveAddedPropPart, key: string, before: number, after: number) => {
      const apply = (value: number) => (): void => {
        record.params[key] = value;
        record.object.geometry.dispose();
        record.object.geometry = buildPropPartPrimitiveGeometry(record.kind, record.params);
        const node = propPartNodeByObject.get(record.object);
        if (node && selectedPropPart === node) highlighter.set(state.highlight ? [node] : []);
        afterPropHistoryApply(node ?? null);
      };
      propHistory.push({ undo: apply(before), redo: apply(after), coalesceKey: `propparam:${record.id}:${key}` });
    },
  };
}

/** IDEA-062: discard one path's SAVED edit and rebuild the prop from the
 *  factory shape — the counterweight to the save path now MERGING rather
 *  than replacing (see syncPartsIntoWorkingDef).
 *
 *  Goes through the WORKING DEF, not just the log: the log's saved layer is
 *  a snapshot for merging, but the preview is rebuilt from `def.parts`, so
 *  clearing only the log would leave the part visibly unchanged until the
 *  next save. Both are cleared, then the preview is rebuilt.
 *
 *  Undoable, because "reset to factory" on the wrong part is exactly the
 *  kind of mistake a user makes once and needs to take back immediately.
 *  The undo restores the def's whole `parts` field rather than the single
 *  edit — a rebuild re-baselines the log anyway, so a finer-grained entry
 *  would buy nothing and could disagree with what is on screen. */
function resetPropPartToFactory(node: PartNode): void {
  const def = propPartLogOwnerId ? workingLibrary.find((d) => d.id === propPartLogOwnerId) : undefined;
  if (!def) return;
  syncPartsIntoWorkingDef(); // fold any in-flight edits in first, so `before` is the whole truth
  const before = clonePropPartLayer(def.parts);
  const after = clonePropPartLayer(def.parts);
  if (!after) return;
  const edits = after.edits.filter((e: PropPartEdit) => e.path !== node.path);
  if (edits.length === after.edits.length && after.added.length === 0) return; // nothing saved here

  const apply = (layer: PropPartLayer | undefined) => (): void => {
    const target = workingLibrary.find((d) => d.id === def.id);
    if (!target) return;
    const next = clonePropPartLayer(layer);
    if (next) target.parts = next;
    else delete target.parts;
    propPartLog.clearSavedEdit(node.path); // keep the live log in step with the def
    rebuildPropsPreview();
  };
  apply(edits.length === 0 && after.added.length === 0 ? undefined : { edits, added: after.added })();
  propHistory.push({ undo: apply(before), redo: apply({ edits, added: after.added }) });
}

type PropTransformChannel = "position" | "rotation" | "scale";

function applyPropChannel(object: THREE.Object3D, channel: PropTransformChannel, v: Vec3Tuple): void {
  if (channel === "rotation") object.rotation.set(v[0], v[1], v[2]);
  else object[channel].set(v[0], v[1], v[2]);
}

/** After a props-history entry mutated the scene: refresh the inspector
 *  folder's widgets (a full rebuild — same "re-init gesture snapshots"
 *  reasoning as character mode's own afterHistoryApply). */
function afterPropHistoryApply(node: PartNode | null): void {
  if (selectedPropPart && (node === null || node === selectedPropPart)) {
    propsPartInspector.setSelection(selectedPropPart, propPartSelectionContext());
  }
}

function pushPropTransformHistory(
  node: PartNode,
  channel: PropTransformChannel,
  before: Vec3Tuple,
  after: Vec3Tuple,
  coalesceKey?: string,
): void {
  const apply = (v: Vec3Tuple) => (): void => {
    applyPropChannel(node.object, channel, v);
    propPartLog.touchTransform(node, channel);
    afterPropHistoryApply(node);
  };
  propHistory.push({ undo: apply(before), redo: apply(after), coalesceKey });
}

/** Sanitizes a user-typed "Add part" name into something safe to show as a
 *  tree row label — same character-class filter as character-mode's own
 *  sanitizeName, minus its "must be a unique JS identifier" concern (props
 *  parts are never referenced by a generated LOCAL VARIABLE the way
 *  characters.ts's added parts are — see AddedPropPart's own doc comment on
 *  why `id` is a separate, auto-generated pairing key instead). Falls back
 *  to the raw `kind` when the typed name sanitizes to nothing. */
function sanitizePropPartName(raw: string, kind: PropPrimKind): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_ -]/g, "").trim();
  return cleaned.length > 0 ? cleaned : kind;
}

/** Add a primitive part to the SELECTED component (or the prop's own root if
 *  nothing is selected) — same "attach under the current selection" UX as
 *  character-mode's addPart. `kind`/`rawName` come from the "Add part"
 *  mini-form below the component tree (propsPartInspector.ts's persistent
 *  "Add part" folder) — `rawName` becomes the tree row's DISPLAY name
 *  (mesh.name, sanitized) while the actual codegen/pairing key is the
 *  separately auto-generated `id` (nextAddedPartId) — see
 *  sanitizePropPartName's own doc comment for why these are split. */
function addPropPart(kind: PropPrimKind, rawName: string): void {
  const mesh = propsPreview.currentMesh;
  if (!mesh) return;
  const parentNode = selectedPropPart ?? propPartNodeByObject.get(mesh);
  if (!parentNode) return;

  const id = nextAddedPartId(kind);
  const displayName = sanitizePropPartName(rawName, kind);
  const params = { ...PROP_PART_GEOMETRY_DEFAULTS[kind] };
  // IDEA-062: `toon()`, not `new THREE.MeshStandardMaterial(...)`.
  //
  // board.ts's addPropPart builds this same part with toon() when the game
  // (or the editor's own next preview rebuild) reconstructs it from the
  // saved record — so a standard material here meant the part you were
  // looking at while placing it was shaded differently from the one that
  // shipped, and it put a non-toon material into a scene the project's
  // cel-shading rule says is toon throughout. `roughness` does not exist on
  // a toon material, so it goes with it.
  const material = toon({ color: 0xe8a23d });
  const geomMesh = new THREE.Mesh(buildPropPartPrimitiveGeometry(kind, params), material);
  geomMesh.name = displayName;
  geomMesh.castShadow = true;
  geomMesh.position.set(0, 0.15, 0); // pop out of the parent so it's immediately visible
  geomMesh.userData.editorAdded = true;

  const record: LiveAddedPropPart = { id, parentPath: parentNode.path, kind, object: geomMesh, material, params };
  const parent = parentNode.object;

  function attach(): void {
    parent.add(geomMesh);
    propPartLog.addPart(record);
    refreshPropParts();
    // Land on the (re-)added part every time attach() runs — the initial
    // add below AND a later redo-of-undo both funnel through here, so both
    // get "straight into tweaking it" for free instead of needing their own
    // explicit selectPropPart call (see deletePropPartNode's undo closure,
    // fixed the same way, for the mirror-image case).
    const node = propPartNodeByObject.get(geomMesh);
    if (node) selectPropPart(node);
  }
  function detach(): void {
    if (selectedPropPart?.object === geomMesh) selectPropPart(null);
    geomMesh.removeFromParent();
    propPartLog.removePart(geomMesh);
    refreshPropParts();
  }

  attach();
  propHistory.push({
    undo: detach,
    redo: attach,
    onDiscard: () => {
      if (!geomMesh.parent) {
        geomMesh.geometry.dispose();
        material.dispose();
      }
    },
  });
}

/** Deletes the selected component — an ADDED part is fully removed from the
 *  scene (same "detach + dispose on discard" story as character-mode's
 *  deletePart); a BASE part (straight from the factory) is instead hidden
 *  (visible=false), which is what "delete" means for a part the factory
 *  always rebuilds fresh every time (see props.ts's PropPartEdit doc
 *  comment) — undo simply un-hides it again. */
function deletePropPartNode(node: PartNode): void {
  const added = propPartLog.findAddedPart(node.object);
  if (added) {
    if (selectedPropPart?.object === node.object) selectPropPart(null);
    const parent = node.object.parent;
    if (!parent) return;
    node.object.removeFromParent();
    propPartLog.removePart(node.object);
    refreshPropParts();
    propHistory.push({
      undo: () => {
        parent.add(node.object);
        propPartLog.addPart(added);
        refreshPropParts();
        // Land back on the restored part, same as character-mode's
        // attachOriginalAt/attachAdded — otherwise a follow-up "delete
        // part" click has no selected folder to find the button in.
        const restored = propPartNodeByObject.get(node.object);
        if (restored) selectPropPart(restored);
      },
      redo: () => {
        node.object.removeFromParent();
        propPartLog.removePart(node.object);
        refreshPropParts();
      },
      onDiscard: () => {
        if (!node.object.parent) {
          added.object.geometry.dispose();
          added.material.dispose();
        }
      },
    });
    return;
  }
  if (node.path === "") return; // the prop's own root is never deletable
  const before = node.object.visible;
  const apply = (visible: boolean) => (): void => {
    node.object.visible = visible;
    propPartLog.touchVisible(node);
    afterPropHistoryApply(node);
  };
  apply(false)();
  propHistory.push({ undo: apply(before), redo: apply(false) });
}

/** Counts, across every MAZE_THEMES entry's placements + wallDecor, how many
 *  reference `id` — the "used by N placements" signal the brief asks the
 *  library ops + id rename to surface. Reads the REAL registry (not
 *  workingLibrary or any board-mode working theme) since this warns about
 *  the SHIPPED game's dependencies on this id, which is what actually
 *  matters for "does removing/renaming this orphan something real." */
function usedByCount(id: string): number {
  let count = 0;
  for (const theme of MAZE_THEMES) {
    for (const p of theme.placements) if (p.propId === id) count++;
    for (const w of theme.wallDecor) if (w.propId === id) count++;
  }
  return count;
}

const propsTreeContainer = treeContainer; // #partTree — same DOM node, one view owns it at a time
const propsTree = createPropsTreeView(propsTreeContainer, (id) => selectProp(id));

const propsInspector = createPropsInspector(propsGuiHost, {
  onChange: () => {
    rebuildPropsPreview();
    propsInspector.setLibrary(workingLibrary, selectedPropId);
    propsTree.render(workingLibrary, usedByCount);
    if (selectedPropId) propsTree.setSelected(selectedPropId);
  },
  onIdChanged: (before, after) => {
    // The rename itself already happened (propsInspector.ts's id controller
    // uniquifies + writes def.id before calling this) — this callback exists
    // so the id itself becomes the tracked selection going forward (the tree
    // row/inspector folder both key off the CURRENT id) and so a rename that
    // orphans real placements is visible immediately, not just on the next
    // manual look at the "used by" note.
    if (selectedPropId === before) selectedPropId = after;
    const orphaned = usedByCount(before);
    if (orphaned > 0) {
      // eslint-disable-next-line no-console -- dev-only tool; a visible
      // console warning is the simplest honest signal here (the inspector's
      // "used by N" note already re-renders under the NEW id on the very
      // next rebuildDefFolder, which happens right after this callback
      // returns — see propsInspector.ts's onFinishChange handler).
      console.warn(
        `editor: renaming prop id "${before}" -> "${after}" — ${orphaned} theme placement(s) still reference "${before}" and will fall back to the default prop until updated.`,
      );
    }
  },
  onAdd: () => {
    const id = nextPropId(workingLibrary);
    const def = defaultWorkingPropDef(id);
    workingLibrary.push(def);
    selectedPropId = id;
    return id;
  },
  onDuplicate: () => {
    const source = selectedPropId ? workingLibrary.find((d) => d.id === selectedPropId) : undefined;
    if (!source) return selectedPropId ?? workingLibrary[0]?.id ?? "";
    const newId = uniquifyPropId(workingLibrary, `${source.id}-copy`);
    const clone = duplicateWorkingPropDef(source, newId, `${source.name} Copy`);
    workingLibrary.push(clone);
    selectedPropId = newId;
    return newId;
  },
  onRemove: () => {
    // Guard: never remove the last def (per the brief) — a props-less
    // library has nothing for the preview/inspector to show and no sensible
    // "add prop" starting point to recover from within this tab.
    if (workingLibrary.length <= 1) return null;
    const idx = selectedPropId ? workingLibrary.findIndex((d) => d.id === selectedPropId) : -1;
    if (idx === -1) return null;
    workingLibrary.splice(idx, 1);
    const nextIdx = Math.min(idx, workingLibrary.length - 1);
    selectedPropId = workingLibrary[nextIdx]?.id ?? null;
    return selectedPropId;
  },
  usedByCount,
});

function selectProp(id: string): void {
  selectedPropId = id;
  propsTree.setSelected(id);
  rebuildPropsPreview();
  propsInspector.setLibrary(workingLibrary, selectedPropId);
}

/** First entry into Props mode: deep-copy PROP_LIBRARY once (never again —
 *  see workingLibrary's own doc comment above), select the first def, render
 *  the list + inspector + preview. Subsequent entries just re-show what's
 *  already there (mirrors board mode's `if (!board) loadBaseTheme(...)`
 *  once-only guard in setMode's board branch). */
function enterPropsMode(): void {
  if (!libraryLoaded) {
    workingLibrary = cloneWorkingLibrary();
    libraryLoaded = true;
    selectedPropId = workingLibrary[0]?.id ?? null;
  }
  propsTree.render(workingLibrary, usedByCount);
  if (selectedPropId) propsTree.setSelected(selectedPropId);
  propsInspector.setLibrary(workingLibrary, selectedPropId);
  rebuildPropsPreview();
}

// TEST-SUPPORT ONLY: "Copy library code" — see propsCodegen.ts's
// formatPropLibrary for the emitted format contract. Not a lil-gui button
// (propsInspector.ts's Library folder owns add/duplicate/remove only, per
// the brief's own split of concerns) — this button lives in the SAME
// #propsGuiHost pane as a plain HTML button, mirroring how the character
// mode's copy buttons (copyBtn/copyFileBtn) are plain DOM buttons in the
// CODE panel rather than lil-gui controls, since "copy to clipboard" reads
// more like page chrome than a tunable. Created once, appended once, reused
// across every Props-mode entry (never destroyed/rebuilt — it doesn't depend
// on which def is selected).
const copyLibraryBtn = document.createElement("button");
copyLibraryBtn.id = "copyLibraryBtn";
copyLibraryBtn.className = "copy-btn";
copyLibraryBtn.textContent = "Copy library code 📋";
copyLibraryBtn.title = "Copy the whole PROP_LIBRARY export — paste over src/game/props.ts's own PROP_LIBRARY";
copyLibraryBtn.addEventListener("click", () => {
  syncPartsIntoWorkingDef(); // IDEA-033: flush any live part edits so the copy includes them
  const code = formatPropLibrary(workingLibrary, 2);
  void navigator.clipboard.writeText(code).then(() => {
    const original = copyLibraryBtn.textContent ?? "";
    copyLibraryBtn.classList.add("copied");
    copyLibraryBtn.textContent = "Copied ✓ paste over PROP_LIBRARY";
    window.setTimeout(() => {
      copyLibraryBtn.classList.remove("copied");
      copyLibraryBtn.textContent = original;
    }, 1600);
  });
});
propsGuiHost.prepend(copyLibraryBtn);

// IDEA-033/032: "Save to props.ts" — the SAFE path, mirroring
// character-mode's saveFileBtn (see editor/index.html's own button and
// characters.ts's save flow): writes the COMPLETE src/game/props.ts straight
// to disk via the dev-only /__save-file middleware (saveEditorFile — the
// same whitelisted endpoint characters.ts/themes.ts already use), so
// applying part edits/new props never risks a copy-paste-into-the-wrong-
// place mistake. Falls back to a clear failure flash if the dev endpoint
// isn't reachable (page not served under `vite`) — "use Copy library code"
// is the manual fallback either way. A plain HTML button (not lil-gui),
// matching copyLibraryBtn's own placement/rationale exactly.
const savePropsFileBtn = document.createElement("button");
savePropsFileBtn.id = "savePropsFileBtn";
savePropsFileBtn.className = "save-btn";
savePropsFileBtn.textContent = "💾 Save to props.ts";
savePropsFileBtn.title = "Write the whole prop library (including part edits) straight into src/game/props.ts (dev server only).";
savePropsFileBtn.addEventListener("click", () => {
  syncPartsIntoWorkingDef(); // flush any live part edits onto the working library first
  const full = generateFullPropsFile(workingLibrary);
  if (!full) {
    const original = savePropsFileBtn.textContent ?? "";
    savePropsFileBtn.textContent = "Failed — use Copy library code";
    window.setTimeout(() => { savePropsFileBtn.textContent = original; }, 1600);
    return;
  }
  void saveEditorFile("src/game/props.ts", full).then((r) => {
    const original = savePropsFileBtn.textContent ?? "";
    savePropsFileBtn.classList.toggle("copied", r.ok);
    savePropsFileBtn.textContent = r.ok ? "Saved ✓ props.ts" : "Save failed — use Copy library code";
    window.setTimeout(() => {
      savePropsFileBtn.classList.remove("copied");
      savePropsFileBtn.textContent = original;
    }, 1600);
  });
});

// Prepended LAST (copyLibraryBtn was already prepended above, right after
// its own addEventListener) so #propsGuiHost reads top-to-bottom exactly
// like the character-mode code panel's saveFileBtn/copyBtn/copyFileBtn trio
// does: `prepend` always inserts at the very front, so prepending
// savePropsFileBtn NOW — after copyLibraryBtn already claimed that spot —
// pushes IT to the front instead, yielding [save, copy, …lil-gui folders]
// in final DOM order (hero action first, fallback second).
propsGuiHost.prepend(savePropsFileBtn);

// IDEA-034: mode-specific viewport hints — the character-mode text is the
// exact string editor/index.html originally hard-coded (captured here so
// re-entering character mode restores it byte-for-byte); the board-mode text
// is NEW, documenting this task's additions (arrows nudge OFFSET now,
// `[`/`]` rotate, `-`/`=` scale, Delete removes) — "a clear on-screen hint"
// per the brief, since none of these keys have any other visible affordance
// the way a lil-gui slider label does. Props mode intentionally reuses the
// character-mode text below (unchanged from what it silently inherited
// before this task) — its own keyboard story isn't part of this task's
// scope, and leaving it as-is is the additive-only choice here.
const HINT_CHARACTER =
  "drag to orbit · scroll to zoom · click a part to select · " +
  "drag the gizmo to transform (W move · E rotate · T scale · Q hide · F focus) · " +
  "Ctrl/Shift-click to multi-select · A all/none · " +
  "arrows nudge position (hold S = scale · hold R = rotate · Shift = big · Alt = fine · " +
  "Ctrl = depth/roll) · Ctrl+Z undo · Esc deselect";
const HINT_BOARD =
  "drag to orbit · scroll to zoom · click a highlighted slot to select/plant a prop · " +
  "drag the gizmo to place it (W move · E rotate · T scale) · " +
  "arrows nudge offset · [ / ] rotate · - / = scale (Shift = big · Alt = fine) · " +
  "Ctrl+Z undo · Delete removes the selection";
// IDEA-033: Props mode's own hint — click a COMPONENT (viewport or the
// Components tree) rather than a "part" of a character, and Delete
// hides/removes it instead of always deleting outright (a base part is
// hidden, an added one is truly removed — see deletePropPartNode's own doc
// comment) — worth calling out explicitly rather than silently inheriting
// HINT_CHARACTER's character-flavored wording the way this mode used to.
const HINT_PROPS =
  "drag to orbit · scroll to zoom · click a component to select · " +
  "drag the gizmo to transform (W move · E rotate · T scale · Q hide) · " +
  "arrows nudge position (hold S = scale · hold R = rotate · Shift = big · Alt = fine · " +
  "Ctrl = depth/roll) · Ctrl+Z undo · Delete hides/removes · Esc deselect";

/** IDEA-029: rewritten from a binary `toChar`/`else` branch (the pre-Props
 *  shape, when "not character" only ever meant "board") into a real 3-way
 *  switch over `next` — the ONE necessarily-shared touch this task's brief
 *  calls out ("if main.ts mode-switch wiring forces a shared touch, keep it
 *  additive"). The character and board branches below are UNCHANGED in
 *  content from the pre-Props version (same calls, same order, same
 *  comments) — only the dispatch shape changed, so board mode's own
 *  placement-editing logic (owned by the parallel agent) is untouched. */
function setMode(next: Mode): void {
  if (mode === next) return;
  const previousMode = mode; // IDEA-033 needs "what we're LEAVING", captured before the reassignment below
  mode = next;

  modeCharacterBtn.classList.toggle("active", next === "character");
  modePickupsBtn.classList.toggle("active", next === "pickups");
  modeBoardBtn.classList.toggle("active", next === "board");
  modePropsBtn.classList.toggle("active", next === "props");
  modeBalanceBtn.classList.toggle("active", next === "balance");
  modeWorldBtn.classList.toggle("active", next === "world");
  // Pickups is a character-shaped mode: it keeps the part tree, the lil-gui
  // pane and the bottom code panel. Only the registry and the source file
  // differ, so it deliberately does NOT get board/props's two-row layout.
  const meshMode = next === "character" || next === "pickups";
  // Board mode and Props mode share the same "no bottom code panel" layout
  // (see editor.css's `#editorApp.mode-board, #editorApp.mode-props` rule) —
  // both classes are applied/removed together so either non-character mode
  // gets the two-row grid.
  editorApp.classList.toggle("mode-props", next === "props");
  // IDEA-062 v4: Balance is the first tab with NO tree and NO viewport — it is
  // a form over config.ts. Its own layout class, so editor.css can give the
  // GUI pane the whole width instead of leaving two empty columns.
  editorApp.classList.toggle("mode-balance", next === "balance");
  // World reuses BOARD mode's layout and stage — it is tuning what the board
  // draws, so it must be looking at a board.
  editorApp.classList.toggle("mode-board", next === "board" || next === "world");
  treePaneTitle.textContent = meshMode
    ? "Parts"
    : next === "board"
      ? "Board slots"
      : next === "balance"
        ? "Balance"
        : "Prop library";
  charGuiHost.hidden = !meshMode;
  boardGuiHost.hidden = next !== "board";
  propsGuiHost.hidden = next !== "props";
  balanceGuiHost.hidden = next !== "balance";
  worldGuiHost.hidden = next !== "world";
  byId<HTMLElement>("codePane").style.display = meshMode ? "" : "none";
  // IDEA-062: the bar follows whether THIS mode has something to transform,
  // not whether it is a mesh mode. Props parts and board placements are both
  // real gizmo targets now; syncGizmo is called at the END of setMode (after
  // each branch has established its selection) so the answer is computed from
  // the mode we have actually arrived in.
  // The readout counts the CHARACTER group, which only exists in the mesh
  // modes — leaving it up in board/props would report a permanent 0.
  viewportInfo.hidden = !meshMode || !infoBtn.classList.contains("active");
  // IDEA-034/033: swap the viewport hint's text to match whichever keyboard
  // story is actually live in the new mode.
  viewportHint.textContent = next === "board" ? HINT_BOARD : next === "props" ? HINT_PROPS : HINT_CHARACTER;
  // Entering a mesh mode: repoint the dropdown at that tab's registry and
  // rebuild, so the viewport shows something from the list actually on show.
  if (meshMode) {
    const defs = next === "pickups" ? PICKUPS : CHARACTERS;
    if (!defs.some((d) => d.id === state.characterId)) {
      inspector.setRegistry(defs, defs[0].id);
      buildCharacter();
    } else {
      inspector.setRegistry(defs, state.characterId);
    }
  }
  // IDEA-033: the "Components" sub-tree only makes sense in Props mode —
  // toggled alongside every other mode-scoped pane above.
  propsPartTreeContainer.hidden = next !== "props";
  propsPartTreeTitle.hidden = next !== "props";

  // Every mode's OWN tree view must release #partTree before another mode's
  // view claims it (all three render into the same shared DOM node — see
  // propsTree.ts's/boardTree.ts's header notes) — destroy whichever of the
  // two non-active tree views might currently own it. Both destroy() calls
  // are no-ops if that view never rendered into the container in the first
  // place (textContent = "" on an already-empty node), so calling both
  // unconditionally on every transition is simplest and always correct.
  if (next !== "board") boardTree.destroy();
  if (next !== "props") propsTree.destroy();
  // IDEA-033: leaving Props mode for either sibling — flush any in-progress
  // part edits onto the working library (so they're never silently lost by
  // switching tabs) and clear the props-part selection (selectPropPart(null)
  // clears propsPartInspector's own folder AND the highlighter, which is the
  // SAME shared instance character mode's select(null) below also drives —
  // whichever mode is entered next calls its own select(null) too, but only
  // AFTER this one, so clearing here first prevents a one-frame flash of a
  // stale prop wireframe under the character/board scene).
  if (previousMode === "props") {
    syncPartsIntoWorkingDef();
    selectPropPart(null);
  }

  // Pickups shares this branch with Character: same part tree, same
  // selection, same camera framing. Falling through to the props branch
  // instead rendered the PROP LIBRARY into the part tree, which is what the
  // first run of the new tab did.
  if (meshMode) {
    if (group) group.visible = true;
    boardStage.setVisible(false);
    refreshParts(); // re-render #partTree with the character's own rows
    // Re-running select() on the SAME node it already was (rather than a
    // narrower "just fix the highlighter" patch) is deliberate: select() is
    // the one place that knows everything a selection touches (tree row,
    // pink wireframe, inspector folder, idle-pause, source-view mark) — the
    // tree row and inspector folder survive the hide/show unchanged (their
    // DOM was never destroyed, just hidden), but the highlighter's wireframe
    // overlay was explicitly cleared on the way INTO board/props mode (see
    // the other two branches' select(null) below) and has no such survival
    // path, so it needs a real re-set. Rebuilding the (already-correct)
    // inspector folder along the way is a harmless bit of redundant DOM
    // churn, traded for the guarantee that "restore exactly" can never
    // silently miss a future side effect select() grows.
    select(selected);
    stage.setGroundVisible(true);
    propsPreview.setVisible(false);
    // IDEA-030/031: board mode's slot markers live under boardStage.boardRoot
    // (toggled invisible, never removed — see boardStage's own dispose note)
    // and three.js's Raycaster ignores `.visible` entirely (see
    // boardPlacement.ts's setPickingEnabled doc comment) — without this
    // explicit gate, a character-mode canvas click at the same screen
    // position a board slot marker occupies would silently create/select a
    // board placement while the user can't even see the board.
    boardPlacement.setPickingEnabled(false);
    setCharacterCameraFraming();
  } else if (next === "board") {
    select(null); // clears character selection/highlight/inspector folder
    if (group) group.visible = false;
    boardStage.setVisible(true);
    stage.setGroundVisible(false); // board.ts's own floor plane covers this job
    propsPreview.setVisible(false);
    if (!board) loadBaseTheme(loadedBaseThemeId, false); // first entry into board mode
    boardTree.render();
    boardPlacement.setPickingEnabled(true); // the only mode where slot clicks matter
    setBoardCameraFraming();
  } else {
    select(null); // clears character selection/highlight/inspector folder
    if (group) group.visible = false;
    boardStage.setVisible(false);
    boardPlacement.setPickingEnabled(false); // see the character branch's own note above
    stage.setGroundVisible(true); // props preview sits on the SAME neutral ground character mode uses
    propsPreview.setVisible(true);
    enterPropsMode();
    setCharacterCameraFraming(); // props are character-scale — reuse the exact same framing/orbit limits
  }

  // IDEA-062 v5: World tunes what the BOARD draws (the fence's picket geometry
  // and the ground dressing's scatter), so it borrows board mode's own stage
  // rather than building a second one — what you tune is literally what the
  // game renders. Board mode's lazy first build happens here too.
  if (next === "world") {
    select(null);
    selectPropPart(null);
    if (group) group.visible = false;
    boardStage.setVisible(true);
    stage.setGroundVisible(false);
    propsPreview.setVisible(false);
    // No slot markers: this tab is not about placements, and a click landing
    // on one would plant a prop you did not ask for.
    boardPlacement.setPickingEnabled(false);
    if (!board) loadBaseTheme(loadedBaseThemeId, false);
    worldInspector.rebuild();
    setBoardCameraFraming();
  }

  // IDEA-062 v4: Balance has no scene of its own. Everything visual is hidden
  // and the pane is a form — see balanceInspector.ts on why there is no
  // preview here rather than an idle one.
  if (next === "balance") {
    select(null);
    selectPropPart(null);
    if (group) group.visible = false;
    boardStage.setVisible(false);
    propsPreview.setVisible(false);
    boardPlacement.setPickingEnabled(false);
    // Rebuilt on every entry so the sliders show what the FILE says — it may
    // have been written by a save since you were last here, or hand-edited.
    balanceInspector.rebuild();
  }

  // IDEA-062: LAST, after every branch above has settled its own selection —
  // syncGizmo reads `mode` plus that mode's selection, so calling it earlier
  // would answer for the mode we are leaving.
  syncGizmo();
}

modeCharacterBtn.addEventListener("click", () => setMode("character"));
modeBalanceBtn.addEventListener("click", () => setMode("balance"));
modeWorldBtn.addEventListener("click", () => setMode("world"));
modeBoardBtn.addEventListener("click", () => setMode("board"));
modePropsBtn.addEventListener("click", () => setMode("props"));
modePickupsBtn.addEventListener("click", () => setMode("pickups"));

// TEST-SUPPORT ONLY: a minimal, explicitly-typed read hook for
// scripts/test-editor-board.ts's Playwright suite — the numbers the brief
// asks it to assert on (wall INSTANCE count, hedge-decor mesh count, prop
// GROUP CHILD count) have no DOM surface of their own (unlike the character
// suite's tree rows/lil-gui labels, which test-editor.ts reads exactly as a
// person would), and test-editor.ts's own established style is "no internal
// handle, assert on what a person sees" — this hook exists ONLY where that's
// genuinely not possible without reimplementing pixel-counting. Dev-only by
// the same construction as the whole /editor/ page (never a rollup input —
// see vite.config.ts's note — so this line never reaches dist/ either).
declare global {
  interface Window {
    __boardTestHook?: {
      wallCount(): number;
      hedgeDecorMeshCount(): number;
      /** Total mesh COUNT across every planted apron prop (board.props'
       *  Group child count — 0 for both "no props built yet" and a
       *  genuinely propless theme, e.g. classic; a live edit's before/after
       *  DELTA is what the suite asserts on, not the absolute number, so
       *  that ambiguity is harmless — see test-editor-board.ts). */
      propMeshCount(): number;
      /** IDEA-030/031: mesh count across every planted WALL-TOP component —
       *  the wall-decor analogue of propMeshCount above. Board.hedgeDecor
       *  holds either the density-scatter InstancedMeshes (empty wallDecor)
       *  OR one wall-decor Group (non-empty wallDecor), never both (see
       *  board.ts's Board.hedgeDecor doc comment) — this reads children off
       *  that ONE Group specifically when it's the wall-decor kind, 0
       *  otherwise (including "using the density fallback right now",
       *  which is a legitimate, distinct state from "wall components
       *  planted" — the suite tells the two apart via workingTheme's own
       *  wallDecor.length, not this count alone). */
      wallDecorMeshCount(): number;
      mode(): Mode;
      workingThemeId(): string;
      /** IDEA-030/031: the working theme's raw placements/wallDecor ARRAY
       *  LENGTHS — the most direct "did an add/remove actually mutate the
       *  data" signal, independent of whatever the render layer chose to
       *  build from it (a rebuild bug could leave meshCount stale while the
       *  data itself is correct, or vice versa — asserting on BOTH is what
       *  proves the whole pipeline, data through render, actually works). */
      placementsLength(): number;
      wallDecorLength(): number;
      /** IDEA-030/031: boardPlacement's current sub-mode + selection state —
       *  lets the suite verify a tree-row click actually switched sub-modes,
       *  and read back exactly which tile/propId is selected after a slot
       *  pick without re-deriving it from marker colors (which would need
       *  pixel-level scene inspection Playwright can't easily do headless). */
      placementSubMode(): "apron" | "wall";
      placementSelection(): { tile: [number, number]; propId: string | null } | null;
      /** IDEA-030/031: projects a board tile to CLIENT-VIEWPORT pixel
       *  coordinates using the live camera + canvas rect — the exact inverse
       *  of boardPlacement.ts's own raycast unprojection. A Playwright suite
       *  driving the raycast-click UX (as opposed to a lil-gui DOM control)
       *  has no other reliable way to know WHERE on screen a given apron/
       *  wall tile currently renders (the camera's angle/distance/canvas
       *  size all affect it, and re-deriving that math independently in the
       *  test file would risk silently drifting from boardPlacement's own —
       *  reusing the SAME camera instance here is what keeps the two
       *  perfectly in sync). Returns null if the tile projects behind the
       *  camera (`w <= 0` after projection) — should never happen for any
       *  real apron/wall tile at this rig's fixed framing, but defensive
       *  regardless. `mode` picks the same Y-seating boardPlacement.ts uses
       *  (MARKER_Y_APRON vs MARKER_Y_WALL) so the projected point lands
       *  exactly on the marker's own render position, not the tile's floor
       *  level. */
      tileToClientXY(tile: [number, number], mode: "apron" | "wall"): { x: number; y: number } | null;
      /** IDEA-034: reads back one slot marker's CURRENT rendered visual
       *  state (disc opacity/color, uniform scale) — see
       *  boardPlacement.ts's getMarkerState doc comment for why this is a
       *  test hook rather than something the suite re-derives from a raw
       *  scene traversal. Returns null for an out-of-range tile (shouldn't
       *  happen for any real apron/wall candidate). */
      markerState(tile: [number, number], mode: "apron" | "wall"): { opacity: number; color: number; scale: number } | null;
      /** IDEA-062: the tile of the Nth existing apron placement, so a suite
       *  can click a FILLED slot without hard-coding a theme's own layout. */
      placementTile(index: number): [number, number] | null;
      /** IDEA-062: which gizmo axis handles are currently shown, plus whether
       *  the bar is up at all. A board placement cannot express free rotation
       *  or a Y offset, so the handle is cut down to what the DATA holds —
       *  this is how a suite proves that rather than eyeballing a render. */
      gizmoAxes(): { x: boolean; y: boolean; z: boolean; mode: string; barVisible: boolean };
      /** IDEA-062: the live placement values, for asserting that a gizmo drag
       *  wrote what it should — and, for a TALL prop on a clamped row, that a
       *  rotate drag did not quietly overwrite its authored scale. */
      placementValues(index: number): { propId: string; offset: [number, number]; rotationY: number; scale: number } | null;
      /** IDEA-062: board undo/redo depth, so a suite can prove a gesture
       *  produced exactly ONE step rather than none or sixty. */
      boardHistoryDepth(): { undo: number; redo: number };
      /** IDEA-062: where the placement gizmo's proxy projects on screen, so a
       *  suite can aim a real drag at its handles rather than guessing. */
      proxyScreenXY(): { x: number; y: number } | null;
      /** IDEA-062: which axis the gizmo is currently hovering/dragging (null
       *  when none) — lets a suite FIND a handle by probing instead of
       *  hard-coding pixel offsets that break with the camera. */
      gizmoAxis(): string | null;
    };
  }
}
window.__boardTestHook = {
  wallCount: () => board?.walls.count ?? 0,
  hedgeDecorMeshCount: () => board?.hedgeDecor.length ?? 0,
  propMeshCount: () => board?.props?.children.length ?? 0,
  wallDecorMeshCount: () => {
    // board.hedgeDecor is ALWAYS either N density-scatter InstancedMeshes or
    // exactly ONE wall-decor Group (see board.ts's Board.hedgeDecor doc
    // comment) — a Group is the wall-decor kind; an InstancedMesh is the
    // density fallback. Sum any Group entries' children (there's at most
    // one in practice, but summing is correct even if that ever changes).
    if (!board) return 0;
    let count = 0;
    for (const entry of board.hedgeDecor) {
      if (entry instanceof THREE.Group) count += entry.children.length;
    }
    return count;
  },
  mode: () => mode,
  workingThemeId: () => workingTheme.id,
  placementsLength: () => workingTheme.placements.length,
  wallDecorLength: () => workingTheme.wallDecor.length,
  placementSubMode: () => boardPlacement.getSubMode(),
  tileToClientXY: (tile, submode) => {
    const y = submode === "apron" ? 0.02 : 1.02; // mirrors boardPlacement.ts's MARKER_Y_APRON/MARKER_Y_WALL
    const world = new THREE.Vector3(worldX(tile[0]), y, worldZ(tile[1]));
    const ndc = world.clone().project(stage.camera);
    if (ndc.z > 1 || ndc.z < -1) return null; // outside the camera's near/far range entirely
    const rect = canvas.getBoundingClientRect();
    const x = ((ndc.x + 1) / 2) * rect.width + rect.left;
    const yPix = ((1 - ndc.y) / 2) * rect.height + rect.top;
    return { x, y: yPix };
  },
  placementSelection: () => {
    const sel = boardPlacement.getSelection();
    if (!sel) return null;
    return { tile: [sel.tile[0], sel.tile[1]], propId: sel.existing?.propId ?? null };
  },
  markerState: (tile, mode) => boardPlacement.getMarkerState(tile, mode),
  placementTile: (index) => {
    const p = workingTheme.placements[index];
    return p ? [p.tile[0], p.tile[1]] : null;
  },
  gizmoAxes: () => ({
    x: gizmo.showsAxis("x"),
    y: gizmo.showsAxis("y"),
    z: gizmo.showsAxis("z"),
    mode: gizmo.getMode(),
    barVisible: !gizmoBar.hidden,
  }),
  placementValues: (index) => {
    const p = workingTheme.placements[index];
    if (!p) return null;
    return { propId: p.propId, offset: [p.offset[0], p.offset[1]], rotationY: p.rotationY, scale: p.scale };
  },
  boardHistoryDepth: () => boardHistory.depth(),
  proxyScreenXY: () => {
    if (!placementGizmo.proxy.visible) return null;
    const world = new THREE.Vector3();
    placementGizmo.proxy.getWorldPosition(world);
    const ndc = world.project(stage.camera);
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((ndc.x + 1) / 2) * rect.width + rect.left,
      y: ((1 - ndc.y) / 2) * rect.height + rect.top,
    };
  },
  gizmoAxis: () => gizmo.hoveredAxis(),
};

// TEST-SUPPORT ONLY: same rationale as __boardTestHook above, scoped to
// scripts/test-editor-props.ts — the live PREVIEW mesh's child count (a
// selected prop rendered) has no DOM surface of its own, unlike everything
// else Props mode exposes (tree rows, lil-gui labels, clipboard text), which
// that suite reads exactly as a person would.
//
// IDEA-033: extended with the part-editing surface — `selectedPartPath`/
// `componentCount` fill the same "no DOM surface of its own" gap for the
// NEW Components tree/selection (a tree row's `.selected` class already
// proves WHICH row is selected — see componentTreeRows in the test file —
// but not what PATH main.ts's own selectedPropPart currently points at,
// which matters for asserting undo/redo landed on the right node, not just
// "a row is highlighted"). Everything else (did a transform/color/geometry
// edit actually APPLY) is asserted the same way the rest of this suite
// already does: through "Copy library code"'s real clipboard text, which
// now includes the emitted `parts` field — see the new test sections below.
declare global {
  interface Window {
    __propsTestHook?: {
      /** The live preview group's child count — 0 if nothing is selected/
       *  built yet, >0 once a def is selected and makePropFromDef ran. */
      previewMeshCount(): number;
      libraryLength(): number;
      selectedPropId(): string | null;
      /** IDEA-033: the CURRENTLY selected component's tree path ("" for the
       *  prop's own root, "0" for its first child, etc.) — null if nothing
       *  is selected. The stable identity propPartLog/codegen key on. */
      selectedPartPath(): string | null;
      /** IDEA-033: total nodes in the Components tree right now (root +
       *  every base part + every added primitive) — the same count
       *  componentTreeRows(page) would report by counting DOM rows, exposed
       *  here too so a test can assert on it without a DOM round-trip when
       *  it's the ONLY thing being checked. */
      componentCount(): number;
      /** IDEA-033: whether the CURRENTLY selected working def has a `parts`
       *  layer at all (undefined until the first flush — see
       *  livePartEditCount below for the LIVE, pre-flush signal instead).
       *  A pure read of `workingLibrary`'s current state; does NOT flush
       *  propPartLog first (an earlier version of this hook did, which was
       *  itself a real bug — see syncPartsIntoWorkingDef's own doc comment
       *  on why an incidental flush right after a fresh rebuild can
       *  incorrectly clear an already-correct def.parts). */
      selectedDefHasParts(): boolean;
      /** IDEA-033: the LIVE, unflushed edit count on the CURRENT
       *  propPartLog (edits.size + added.length) — unlike
       *  selectedDefHasParts (which reads workingLibrary's last-FLUSHED
       *  state), this reads the in-memory log directly, so it reflects a
       *  transform/material edit the instant it's made, before any mode
       *  switch/copy/save has had a chance to flush it onto the working
       *  def. */
      livePartEditCount(): number;
    };
  }
}
window.__propsTestHook = {
  previewMeshCount: () => propsPreview.currentMesh?.children.length ?? 0,
  libraryLength: () => workingLibrary.length,
  selectedPropId: () => selectedPropId,
  selectedPartPath: () => selectedPropPart?.path ?? null,
  componentCount: () => propPartNodes.length,
  // IDEA-033: deliberately does NOT call syncPartsIntoWorkingDef() — this is
  // a passive READ, and calling the flush from here was a genuine bug found
  // during development: right after rebuildPropsPreview's OWN internal
  // flush+rebuild+re-snapshot sequence, propPartLog legitimately has ZERO
  // pending deltas (snapshot() just re-baselined it to MATCH the already-
  // correct def.parts that was written moments earlier) — an empty log at
  // that exact moment means "nothing NEW since the last save", not "the
  // parts were removed". syncPartsIntoWorkingDef's own "empty log -> delete
  // def.parts" rule is only correct when called from a genuine outgoing-
  // def transition (mode switch, def switch, explicit save/copy) — never
  // from an incidental read that happens to run moments after a fresh
  // rebuild. def.parts is already kept correctly in sync by those real
  // call sites; this hook only ever needs to READ it.
  selectedDefHasParts: () => {
    const def = selectedPropId ? workingLibrary.find((d) => d.id === selectedPropId) : undefined;
    return def?.parts !== undefined;
  },
  livePartEditCount: () => propPartLog.edits.size + propPartLog.added.length,
};

// TEST-SUPPORT ONLY: same rationale as __boardTestHook / __propsTestHook
// above, scoped to the character workbench's animation preview. A suite cannot
// assert "the walk cycle is actually moving the legs" from the DOM — the whole
// thing happens on a canvas — and pixel-diffing a render would be far more
// brittle than reading the transform the animation just wrote. Dev-only by the
// same construction as the rest of /editor/ (never a rollup input).
declare global {
  interface Window {
    __charTestHook?: {
      /** Euler angles of a named part, or null when it isn't in this model. */
      partRotation(name: string): { x: number; y: number; z: number } | null;
      partPosition(name: string): { x: number; y: number; z: number } | null;
      partScale(name: string): { x: number; y: number; z: number } | null;
      /** Whether a named part currently renders (applyGhostState's "eaten"
       *  hides everything but the eyes, and hides via ANCESTORS too — so this
       *  walks up the chain rather than reading the part's own flag). */
      partVisible(name: string): boolean | null;
      /** Body material colour as a hex number — frightened turns it blue. */
      bodyColor(): number | null;
      /** A part's material opacity — the eaten "spirit" drops it below 1. */
      partOpacity(name: string): number | null;
      animation(): string;
    };
  }
}

function findPart(name: string): THREE.Object3D | null {
  if (!group) return null;
  let found: THREE.Object3D | null = null;
  group.traverse((o) => {
    if (!found && o.name === name) found = o;
  });
  return found;
}

window.__charTestHook = {
  partRotation: (name) => {
    const o = findPart(name);
    return o ? { x: o.rotation.x, y: o.rotation.y, z: o.rotation.z } : null;
  },
  partPosition: (name) => {
    const o = findPart(name);
    return o ? { x: o.position.x, y: o.position.y, z: o.position.z } : null;
  },
  partScale: (name) => {
    const o = findPart(name);
    return o ? { x: o.scale.x, y: o.scale.y, z: o.scale.z } : null;
  },
  partVisible: (name) => {
    let o = findPart(name) as THREE.Object3D | null;
    if (!o) return null;
    while (o) {
      if (!o.visible) return false;
      o = o.parent;
    }
    return true;
  },
  partOpacity: (name) => {
    const o = findPart(name);
    if (!(o instanceof THREE.Mesh)) return null;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    return (mat as THREE.MeshStandardMaterial).opacity;
  },
  bodyColor: () => {
    const mat = group?.userData.bodyMat as THREE.MeshStandardMaterial | undefined;
    return mat ? mat.color.getHex() : null;
  },
  animation: () => state.animation,
};

// ===========================================================================
// --- IDEA-062 v5: the World tab (fence.ts + groundDetail.ts) ---
//
// The IDEA-060 garden machinery no theme palette can reach. Unlike Balance,
// edits here apply LIVE — every number is judged by looking at the board, so
// the feedback loop IS the point — and the params objects are mutated in place
// (see fence.ts's FENCE_PARAMS note on why a mutable table beats threading an
// override through three signatures for one dev-only pane).
//
// `worldBaseline` is what "Revert unsaved" restores to: the values as the
// FILE has them, captured at load. Without it, reverting would need to
// re-parse the source on every field, and a field whose file had since been
// saved would revert to the wrong number.
const WORLD_PARAM_OBJECTS: Record<string, Record<string, number>> = {
  FENCE_PARAMS: FENCE_PARAMS as unknown as Record<string, number>,
  GROUND_DETAIL_PARAMS: GROUND_DETAIL_PARAMS as unknown as Record<string, number>,
};

const worldBaseline = new Map<string, number>();
for (const field of allWorldFields()) {
  const obj = WORLD_PARAM_OBJECTS[String(field.path[0])];
  if (obj) worldBaseline.set(field.path.join("."), obj[String(field.path[1])]);
}

function worldLiveValue(field: WorldField): number {
  const obj = WORLD_PARAM_OBJECTS[String(field.path[0])];
  return obj?.[String(field.path[1])] ?? 0;
}

const worldInspector = createWorldInspector(worldGuiHost, {
  source: (file) => sourceTextFor(file),
  liveValue: worldLiveValue,
  onEdit: (field, value) => {
    const obj = WORLD_PARAM_OBJECTS[String(field.path[0])];
    if (!obj) return;
    obj[String(field.path[1])] = value;
    // The fence and the ground detail are both rebuilt by applyBoardTheme, so
    // the existing board rebuild is the whole live-preview mechanism — no
    // second path to drift from what the game does.
    if (board) rebuildBoardFromWorkingTheme();
    sessionDirty();
  },
  onRevert: () => {
    for (const field of allWorldFields()) {
      const obj = WORLD_PARAM_OBJECTS[String(field.path[0])];
      const was = worldBaseline.get(field.path.join("."));
      if (obj && was !== undefined) obj[String(field.path[1])] = was;
    }
    if (board) rebuildBoardFromWorkingTheme();
  },
  onSave: async () => {
    // One write per FILE, with every field targeting that file batched into
    // it — two saves to the same file would race the source store.
    const byFile = new Map<SavableFile, ConfigEdit[]>();
    for (const field of allWorldFields()) {
      const list = byFile.get(field.file) ?? [];
      list.push({ path: field.path, value: worldLiveValue(field) });
      byFile.set(field.file, list);
    }
    let applied = 0;
    const blocked: string[] = [];
    for (const [file, edits] of byFile) {
      const result = applyConfigEdits(sourceTextFor(file), edits);
      for (const b of result.blocked) blocked.push(`${b.path.join(".")} — ${b.reason}`);
      if (result.applied.length === 0) continue;
      const saved = await saveEditorFile(file, result.src);
      if (!saved.ok) return { ok: false, error: saved.error, applied, blocked };
      applied += result.applied.length;
      // What is on disk is the new baseline — reverting after a save must go
      // back to what was SAVED, not to what shipped.
      for (const path of result.applied) {
        const field = allWorldFields().find((f) => f.path.join(".") === path.join("."));
        if (field) worldBaseline.set(path.join("."), worldLiveValue(field));
      }
    }
    return { ok: true, applied, blocked };
  },
});

// ===========================================================================
// --- IDEA-062 v4: the Balance tab (src/game/config.ts) ---
//
// The first tab that edits the GAME's numbers rather than its meshes, and the
// only one whose mistakes are invisible locally: config.ts feeds the server's
// plausibility bounds through `npm run sync`, so an unsynced change makes
// honest runs start failing SCORE_ITEM_MISMATCH in production while
// everything here still looks fine. The tab cannot enforce the sync, so it
// makes it impossible to miss — see balanceInspector.ts's sync panel.
//
// Pending edits live in the inspector until Save; nothing is written to disk
// per slider tick. That is the opposite of the other tabs (which mutate a
// working copy live and rebuild a preview) and it is right here: there is no
// preview to drive, and a half-dragged slider writing a real game number on
// every frame would be the worst possible behaviour for a file this load-
// bearing.
const pendingConfigEdits = new Map<string, ConfigEdit>();

const balanceInspector = createBalanceInspector(balanceGuiHost, {
  source: () => sourceTextFor("src/game/config.ts"),
  onEdit: (path, value) => {
    pendingConfigEdits.set(path.join("."), { path, value });
    sessionDirty();
  },
  onRevert: () => pendingConfigEdits.clear(),
  onSave: async () => {
    const edits = [...pendingConfigEdits.values()];
    if (edits.length === 0) {
      return { ok: false, error: "no changes to save", applied: 0, blocked: [] };
    }
    const result = applyConfigEdits(sourceTextFor("src/game/config.ts"), edits);
    if (result.applied.length === 0) {
      return { ok: false, error: "nothing could be written", applied: 0, blocked: result.blocked };
    }
    const saved = await saveEditorFile("src/game/config.ts", result.src);
    if (!saved.ok) return { ok: false, error: saved.error, applied: 0, blocked: result.blocked };
    pendingConfigEdits.clear();
    return { ok: true, applied: result.applied.length, blocked: result.blocked };
  },
});

// ===========================================================================
// --- IDEA-062 v3: rolling autosave + the Restore / Discard bar ---
//
// Saves no longer reload the page (v1), but a reload is still one Ctrl+R, one
// crashed tab, one hand-edit to a game file (which SHOULD still hot-reload —
// the HMR suppression is deliberately narrow) or one stale-chip Reload click
// away. Every one of those used to cost an afternoon of prop tuning silently.
// See session.ts's header for exactly what is and is not stored, and why the
// character EditLog is a follow-up rather than a half-measure here.
const sessionRecorder = startSessionRecorder({
  mode: () => mode,
  props: () => (libraryLoaded ? { library: workingLibrary, selectedId: selectedPropId } : null),
  board: () => (board ? { baseThemeId: loadedBaseThemeId, theme: workingTheme } : null),
  character: () => ({ id: state.characterId }),
});

/** Marks the session dirty. Wired to every history's onChange plus the paths
 *  that legitimately change state without pushing one (a mode switch, a prop
 *  selection). Cheap — it only arms a trailing timer. */
function sessionDirty(): void {
  sessionRecorder.touch();
}

// Chain onto whatever each history already had rather than replacing it —
// the history PANELS are driven by these, and silently stealing the hook
// would blank them.
for (const h of [history, propHistory, boardHistory]) {
  const prev = h.onChange;
  h.onChange = () => {
    prev?.();
    sessionDirty();
  };
}

/** Applies a stored session. Deliberately does NOT touch the character
 *  EditLog (see session.ts) — it selects the model and leaves it at that,
 *  which the restore bar says out loud. */
function applyStoredSession(stored: EditorSession): void {
  if (stored.props) {
    workingLibrary = stored.props.library;
    libraryLoaded = true;
    selectedPropId = stored.props.selectedId;
  }
  if (stored.board) {
    loadedBaseThemeId = stored.board.baseThemeId;
    workingTheme = stored.board.theme;
    boardBaseline = cloneWorkingTheme(workingTheme);
    // Board mode builds lazily on first entry; if it has already been built
    // this page life, re-apply now so the restore is visible immediately.
    if (board) {
      rebuildBoardFromWorkingTheme();
      if (boardMaterials) {
        boardInspector.setTheme(workingTheme, loadedBaseThemeId, boardMaterials, boardStage.lights);
      }
      boardPlacement.syncFromTheme(workingTheme);
    }
  }
  if (stored.character && CHARACTERS.some((d) => d.id === stored.character!.id)) {
    state.characterId = stored.character.id;
    inspector.setRegistry(CHARACTERS, state.characterId);
    buildCharacter();
  }
  setMode(stored.mode);
}

// --- go ---
buildCharacter();
restorePendingSaveReport();

// The offer goes up AFTER the editor has booted, so Restore lands on a live
// page rather than racing module init.
{
  const stored = readStoredSession();
  if (stored && sessionHasContent(stored)) {
    showRestoreBar(
      editorApp,
      stored,
      () => applyStoredSession(stored),
      () => clearStoredSession(),
    );
  }
}
