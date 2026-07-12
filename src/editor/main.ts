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
import { createBoardTreeView } from "./boardTree";
import { createBoardInspector, type BoardMaterialHandles } from "./boardInspector";
import { cloneWorkingTheme, formatThemeEntry, type WorkingTheme } from "./boardCodegen";
import { buildBoard, applyBoardTheme, type Board } from "../render/board";
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
import { Grid, COLS, ROWS } from "../game/grid";
import { MAZES } from "../game/mazes";
import { getMazeTheme, setEquippedMazeThemeId, DEFAULT_MAZE_THEME_ID } from "../game/themes";
import { CAM_FOV, CAM_POS, CAM_LOOK, CAM_MIN_DISTANCE, CAM_MAX_DISTANCE } from "./stage";

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
const generatedPre = byId<HTMLPreElement>("generatedView");
const sourcePre = byId<HTMLPreElement>("sourceView");
const codeTitle = byId<HTMLSpanElement>("codeTitle");
const copyBtn = byId<HTMLButtonElement>("copyBtn");
const copyFileBtn = byId<HTMLButtonElement>("copyFileBtn");
const editorApp = byId<HTMLDivElement>("editorApp");
const modeCharacterBtn = byId<HTMLButtonElement>("modeCharacterBtn");
const modeBoardBtn = byId<HTMLButtonElement>("modeBoardBtn");

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
type Mode = "character" | "board";
let mode: Mode = "character";

const boardTreeContainer = treeContainer; // #partTree — same DOM node, one view owns it at a time
const boardTree = createBoardTreeView(boardTreeContainer, (id) => {
  boardTree.setSelected(id);
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
  // applyBoardTheme only reads `theme.palette` (see board.ts) — id/name/price
  // are irrelevant to it, so passing `workingTheme` directly (a WorkingTheme,
  // structurally a MazeTheme since WorkingPalette satisfies ThemePalette) is
  // safe without constructing a throwaway object.
  applyBoardTheme(board, boardStage.boardRoot, boardGrid, workingTheme);
  boardStage.applyPalette(workingTheme.palette);
  boardStage.setSky(workingTheme.palette.bg, workingTheme.palette.backdropTop);
}

/** Loads a fresh working copy of a MAZE_THEMES entry — the ONLY place
 *  `workingTheme` is reassigned to a new object (every other board edit
 *  mutates the existing one in place), so this is also the natural
 *  "reset/undo everything" action (see the UNDO DECISION note above). */
function loadBaseTheme(id: string): void {
  loadedBaseThemeId = id;
  workingTheme = cloneWorkingTheme(getMazeTheme(id));
  rebuildBoardFromWorkingTheme();
  if (!boardMaterials) throw new Error("editor: board materials not captured after buildBoard");
  boardInspector.setTheme(workingTheme, loadedBaseThemeId, boardMaterials, boardStage.lights);
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

function setMode(next: Mode): void {
  if (mode === next) return;
  mode = next;

  const toChar = next === "character";
  modeCharacterBtn.classList.toggle("active", toChar);
  modeBoardBtn.classList.toggle("active", !toChar);
  editorApp.classList.toggle("mode-board", !toChar);
  treePaneTitle.textContent = toChar ? "Parts" : "Board slots";
  charGuiHost.hidden = !toChar;
  boardGuiHost.hidden = toChar;
  byId<HTMLElement>("codePane").style.display = toChar ? "" : "none";

  if (toChar) {
    if (group) group.visible = true;
    boardStage.setVisible(false);
    boardTree.destroy(); // release the #partTree rows board mode owned
    refreshParts(); // re-render #partTree with the character's own rows
    // Re-running select() on the SAME node it already was (rather than a
    // narrower "just fix the highlighter" patch) is deliberate: select() is
    // the one place that knows everything a selection touches (tree row,
    // pink wireframe, inspector folder, idle-pause, source-view mark) — the
    // tree row and inspector folder survive the hide/show unchanged (their
    // DOM was never destroyed, just hidden), but the highlighter's wireframe
    // overlay was explicitly cleared on the way INTO board mode (see the
    // `else` branch's select(null) below) and has no such survival path, so
    // it needs a real re-set. Rebuilding the (already-correct) inspector
    // folder along the way is a harmless bit of redundant DOM churn, traded
    // for the guarantee that "restore exactly" can never silently miss a
    // future side effect select() grows.
    select(selected);
    stage.setGroundVisible(true);
    setCharacterCameraFraming();
  } else {
    select(null); // clears character selection/highlight/inspector folder
    if (group) group.visible = false;
    boardStage.setVisible(true);
    stage.setGroundVisible(false); // board.ts's own floor plane covers this job
    if (!board) loadBaseTheme(loadedBaseThemeId); // first entry into board mode
    boardTree.render();
    setBoardCameraFraming();
  }
}

modeCharacterBtn.addEventListener("click", () => setMode("character"));
modeBoardBtn.addEventListener("click", () => setMode("board"));

// TEST-SUPPORT ONLY: a minimal, explicitly-typed read hook for
// scripts/test-editor-board.ts's Playwright suite — the numbers the brief
// asks it to assert on (wall INSTANCE count, hedge-decor mesh count) have no
// DOM surface of their own (unlike the character suite's tree rows/lil-gui
// labels, which test-editor.ts reads exactly as a person would), and
// test-editor.ts's own established style is "no internal handle, assert on
// what a person sees" — this hook exists ONLY where that's genuinely not
// possible without reimplementing pixel-counting. Dev-only by the same
// construction as the whole /editor/ page (never a rollup input — see
// vite.config.ts's note — so this line never reaches dist/ either).
declare global {
  interface Window {
    __boardTestHook?: {
      wallCount(): number;
      hedgeDecorMeshCount(): number;
      mode(): Mode;
      workingThemeId(): string;
    };
  }
}
window.__boardTestHook = {
  wallCount: () => board?.walls.count ?? 0,
  hedgeDecorMeshCount: () => board?.hedgeDecor.length ?? 0,
  mode: () => mode,
  workingThemeId: () => workingTheme.id,
};

// --- go ---
buildCharacter();
