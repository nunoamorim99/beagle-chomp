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
import { getCharacter, disposeGroup, ENEMY_COLORS, type CharacterDef } from "./registry";
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
import { generateFullFile } from "./fileExport";
import { saveEditorFile } from "./saveFile";
import { History } from "./history";
import {
  createInspector,
  type EditorState,
  type TransformChannel,
  type MaterialSnapshot,
} from "./inspector";
import { createSourceView } from "./sourceView";
import { attachPicking } from "./picking";
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
import { cloneWorkingTheme, formatThemeEntry, type WorkingTheme } from "./boardCodegen";
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
  defaultWorkingPropDef,
  duplicateWorkingPropDef,
  nextPropId,
  uniquifyPropId,
  type WorkingPropDef,
} from "./propsWorking";

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

// --- state ---
const state: EditorState = {
  characterId: "beagle",
  beagleSkinId: DEFAULT_BEAGLE_SKIN_ID,
  enemyColor: "rose",
  turntable: false, // you orbit the camera yourself now (drag the viewport)
  idle: true,
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
const tree = createPartTreeView(treeContainer, (node) => select(node));

function refreshParts(): void {
  if (!group) return;
  nodes = buildPartList(group, def.label);
  nodeByObject = new Map(nodes.map((n) => [n.object, n]));
  materials = collectMaterials(group, nodes);
  materialByUuid = new Map(materials.map((m) => [m.material.uuid, m]));
  tree.render(nodes);
}

function materialForMesh(mesh: THREE.Mesh): MaterialInfo | undefined {
  const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  return materialByUuid.get(mat.uuid);
}

// --- idle / authored pose ---
function setIdle(on: boolean): void {
  state.idle = on;
  inspector.setIdleChecked(on);
  if (!on && group) {
    // Snap idle-driven channels back to authored values (baseline + user
    // edits) instead of freezing mid-wag — the GUI and codegen then read the
    // pose the user actually authored.
    for (const object of def.idleTargets(group)) {
      const node = nodeByObject.get(object);
      if (node) log.restoreAuthoredTransform(node);
    }
  }
}

// --- selection ---
function select(node: PartNode | null): void {
  selected = node;
  tree.setSelected(node?.path ?? null);
  highlighter.set(state.highlight ? node : null);
  if (node && state.idle && def.idle) setIdle(false); // hold still while editing
  inspector.setSelection(node, node ? selectionContext() : null);
  sourceView.markVar(node && !node.isAutoNamed && !node.isAdded ? node.varName : null);
}

function selectionContext() {
  return {
    log,
    materialFor: materialForMesh,
    addedRecord: selected ? log.findAddedPart(selected.object) : undefined,
    onEdit: updateGenerated,
    onGeometryRebuilt: (node: PartNode) => {
      // The wireframe overlay shares the mesh's geometry — refresh it.
      if (selected === node) highlighter.set(state.highlight ? node : null);
    },
    onDelete: deleteNode,
    onTransformCommitted: pushTransformHistory,
    onVisibleCommitted: (node: PartNode, before: boolean, after: boolean) => {
      const apply = (value: boolean) => (): void => {
        node.object.visible = value;
        log.touchVisible(node);
        afterHistoryApply(node);
      };
      history.push({ undo: apply(before), redo: apply(after) });
    },
    onMaterialCommitted: (info: MaterialInfo, before: MaterialSnapshot, after: MaterialSnapshot) => {
      const apply = (value: MaterialSnapshot) => (): void => {
        info.material.color.setHex(value.color);
        info.material.roughness = value.roughness;
        log.touchMaterial(info);
        afterHistoryApply(null);
      };
      history.push({ undo: apply(before), redo: apply(after), coalesceKey: `mat:${info.material.uuid}` });
    },
    onParamCommitted: (record: AddedPartRecord, key: string, before: number, after: number) => {
      const apply = (value: number) => (): void => {
        record.params[key] = value;
        record.object.geometry.dispose();
        record.object.geometry = buildPrimitiveGeometry(record.kind, record.params);
        const node = nodeByObject.get(record.object);
        if (node && selected === node) highlighter.set(state.highlight ? node : null); // overlay shares the geometry
        afterHistoryApply(node ?? null);
      };
      history.push({ undo: apply(before), redo: apply(after), coalesceKey: `param:${record.name}:${key}` });
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
  history.push({ undo: apply(before), redo: apply(after), coalesceKey });
}

// --- character build / switch ---
function buildCharacter(): void {
  select(null);
  history.clear(); // old entries point at the outgoing character's objects
  if (group) disposeGroup(group);
  def = getCharacter(state.characterId);
  group = def.build(state);
  stage.contentRoot.rotation.y = 0;
  stage.contentRoot.add(group);
  log = new EditLog();
  refreshParts();
  log.snapshot(nodes, materials);
  inspector.setCharacterMode(def.isBeagle);
  sourceView.showBuilder(def.builderName);
  codeTitle.textContent = `${def.builderName}() — src/render/characters.ts`;
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
  onIdle: (on) => setIdle(on),
  onGrid: (on) => stage.setGrid(on),
  // Hide the pink wireframe to judge the result cleanly; selection itself
  // (tree row, controls, code marker) stays active.
  onHighlight: (on) => highlighter.set(on ? selected : null),
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
  () => (mode === "character" ? group : null),
  (object) => nodeByObject.get(object),
  (node) => select(node),
);

// --- per-frame ---
stage.onFrame((_dt, t) => {
  // IDEA-027: idle animation + the pink selection wireframe are both
  // character-mode-only concerns — gating on `mode` avoids animating a
  // hidden character's tail/ears every frame while board mode is active (the
  // highlighter itself is already empty in board mode since select(null) ran
  // on the way in, but the explicit gate documents the intent either way).
  if (mode === "character") {
    if (group && state.idle && def.idle) def.idle(group, t);
    highlighter.update();
  }
});

// --- code panel chrome: tabs + copy ---
for (const tab of document.querySelectorAll<HTMLButtonElement>(".code-tab")) {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".code-tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".code-view").forEach((v) => v.classList.remove("active"));
    tab.classList.add("active");
    byId(tab.dataset.tab === "source" ? "sourceView" : "generatedView").classList.add("active");
  });
}

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
  const full = generateFullFile(log, def.builderName);
  if (!full) {
    flash(copyFileBtn, "Failed — use Copy edits", false);
    return;
  }
  void navigator.clipboard
    .writeText(full)
    .then(() => flash(copyFileBtn, "Copied ✓ paste over characters.ts", true));
});

// IDEA-032: "Save to characters.ts" — the SAFE path. Writes the complete
// generated file straight to disk via the dev-only middleware, so the user
// never copy-pastes it into the wrong place (which stacked edit blocks and
// shipped a broken beagle — see editor-residue-hazard). Falls back to a clear
// "use Copy full file" message if the dev endpoint isn't reachable.
saveFileBtn.addEventListener("click", () => {
  if (log.isEmpty) {
    flash(saveFileBtn, "No edits yet", false);
    return;
  }
  const full = generateFullFile(log, def.builderName);
  if (!full) {
    flash(saveFileBtn, "Failed — use Copy edits", false);
    return;
  }
  void saveEditorFile("src/render/characters.ts", full).then((r) => {
    if (r.ok) flash(saveFileBtn, "Saved ✓ characters.ts", true);
    else flash(saveFileBtn, "Save failed — use Copy full file", false);
  });
});

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
    // guard the entire handler behind character mode instead of trying to
    // thread a mode check through every branch below.
    if (mode !== "character") return;
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
      deleteNode(selected);
      return;
    }
    if (selected && (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight")) {
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
// IDEA-029: widened from "character" | "board" to add "props" — every OTHER
// reference to Mode/mode in this board-mode block (the keydown guard, the
// per-frame character-only gate, boardTest hook) already tests `mode ===
// "character"` or `mode !== "character"` rather than branching on the OLD
// binary directly, so none of them need editing for a third mode to slot in
// safely — see setMode below (rewritten as a real 3-way switch) for the one
// place that DID need updating.
type Mode = "character" | "board" | "props";
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
function loadBaseTheme(id: string): void {
  loadedBaseThemeId = id;
  workingTheme = cloneWorkingTheme(getMazeTheme(id));
  rebuildBoardFromWorkingTheme();
  if (!boardMaterials) throw new Error("editor: board materials not captured after buildBoard");
  boardInspector.setTheme(workingTheme, loadedBaseThemeId, boardMaterials, boardStage.lights);
  boardPlacement.syncFromTheme(workingTheme);
}

const boardInspector = createBoardInspector(boardGuiHost, {
  onBaseTheme: (id) => loadBaseTheme(id),
  onAtmosphereBg: () => boardStage.setSky(workingTheme.palette.bg, workingTheme.palette.backdropTop),
  onDecorChange: () => rebuildBoardFromWorkingTheme(),
  onMetaChange: () => {}, // no live visual effect — codegen just reads `workingTheme` fresh each copy
  onCopyCode: () => {
    const code = formatThemeEntry(workingTheme, 2);
    return navigator.clipboard.writeText(code);
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
  () => rebuildBoardFromWorkingTheme(),
  (selection: PlacementSelection | null) => {
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

// IDEA-030/031: arrow-key nudge for the selected APRON placement's offset —
// "reusing the editor's existing arrow-nudge convention" (the task brief) —
// same NUDGE_STEP/NUDGE_COARSE(Shift)/NUDGE_FINE(Alt) constants the
// character-mode position nudge above already uses, and the same capture-
// phase + inTextField/HTMLSelectElement guard so typing in a lil-gui number
// field or using a dropdown's own arrow keys is never hijacked. Kept as its
// OWN listener (not folded into the character-mode one above) because that
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
window.addEventListener(
  "keydown",
  (e) => {
    if (mode !== "board") return;
    const active = document.activeElement;
    const inTextField = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
    if (inTextField || active instanceof HTMLSelectElement) return; // arrows inside a widget belong to it

    if (e.key !== "ArrowUp" && e.key !== "ArrowDown" && e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;

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

function rebuildPropsPreview(): void {
  disposePropsPreview();
  const def = selectedPropId ? workingLibrary.find((d) => d.id === selectedPropId) : undefined;
  if (!def) return;
  // makePropFromDef takes a PropDef (params fields are `readonly number[]`
  // where present) — a WorkingPropDef's params satisfy that structurally
  // (mutable arrays are assignable to readonly ones), so no conversion is
  // needed beyond the type-level widen already expressed in propsWorking.ts.
  const mesh = makePropFromDef(def, PREVIEW_INSTANCE_HASH);
  mesh.traverse((o) => { o.castShadow = true; });
  propsPreviewRoot.add(mesh);
  propsPreview.currentMesh = mesh;
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
propsGuiHost.prepend(copyLibraryBtn);
copyLibraryBtn.addEventListener("click", () => {
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
  mode = next;

  modeCharacterBtn.classList.toggle("active", next === "character");
  modeBoardBtn.classList.toggle("active", next === "board");
  modePropsBtn.classList.toggle("active", next === "props");
  // Board mode and Props mode share the same "no bottom code panel" layout
  // (see editor.css's `#editorApp.mode-board, #editorApp.mode-props` rule) —
  // both classes are applied/removed together so either non-character mode
  // gets the two-row grid.
  editorApp.classList.toggle("mode-board", next === "board");
  editorApp.classList.toggle("mode-props", next === "props");
  treePaneTitle.textContent = next === "character" ? "Parts" : next === "board" ? "Board slots" : "Prop library";
  charGuiHost.hidden = next !== "character";
  boardGuiHost.hidden = next !== "board";
  propsGuiHost.hidden = next !== "props";
  byId<HTMLElement>("codePane").style.display = next === "character" ? "" : "none";

  // Every mode's OWN tree view must release #partTree before another mode's
  // view claims it (all three render into the same shared DOM node — see
  // propsTree.ts's/boardTree.ts's header notes) — destroy whichever of the
  // two non-active tree views might currently own it. Both destroy() calls
  // are no-ops if that view never rendered into the container in the first
  // place (textContent = "" on an already-empty node), so calling both
  // unconditionally on every transition is simplest and always correct.
  if (next !== "board") boardTree.destroy();
  if (next !== "props") propsTree.destroy();

  if (next === "character") {
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
    if (!board) loadBaseTheme(loadedBaseThemeId); // first entry into board mode
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
}

modeCharacterBtn.addEventListener("click", () => setMode("character"));
modeBoardBtn.addEventListener("click", () => setMode("board"));
modePropsBtn.addEventListener("click", () => setMode("props"));

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
};

// TEST-SUPPORT ONLY: same rationale as __boardTestHook above, scoped to
// scripts/test-editor-props.ts — the live PREVIEW mesh's child count (a
// selected prop rendered) has no DOM surface of its own, unlike everything
// else Props mode exposes (tree rows, lil-gui labels, clipboard text), which
// that suite reads exactly as a person would.
declare global {
  interface Window {
    __propsTestHook?: {
      /** The live preview group's child count — 0 if nothing is selected/
       *  built yet, >0 once a def is selected and makePropFromDef ran. */
      previewMeshCount(): number;
      libraryLength(): number;
      selectedPropId(): string | null;
    };
  }
}
window.__propsTestHook = {
  previewMeshCount: () => propsPreview.currentMesh?.children.length ?? 0,
  libraryLength: () => workingLibrary.length,
  selectedPropId: () => selectedPropId,
};

// --- go ---
buildCharacter();
