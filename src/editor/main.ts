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

// --- DOM ---
function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`editor: missing #${id}`);
  return el as T;
}
const canvas = byId<HTMLCanvasElement>("viewport");
const treeContainer = byId<HTMLDivElement>("partTree");
const guiPane = byId<HTMLDivElement>("guiPane");
const generatedPre = byId<HTMLPreElement>("generatedView");
const sourcePre = byId<HTMLPreElement>("sourceView");
const codeTitle = byId<HTMLSpanElement>("codeTitle");
const copyBtn = byId<HTMLButtonElement>("copyBtn");
const copyFileBtn = byId<HTMLButtonElement>("copyFileBtn");

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
    onDelete: deletePart,
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

// --- inspector (right pane) ---
const inspector = createInspector(guiPane, state, {
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
attachPicking(
  canvas,
  stage.camera,
  () => group,
  (object) => nodeByObject.get(object),
  (node) => select(node),
);

// --- per-frame ---
stage.onFrame((_dt, t) => {
  if (group && state.idle && def.idle) def.idle(group, t);
  highlighter.update();
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

// --- keyboard: Ctrl+Z / Ctrl+Y, arrow nudging, Escape ---
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

// --- go ---
buildCharacter();
