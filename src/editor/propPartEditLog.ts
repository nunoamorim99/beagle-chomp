// OWNER: props part editor (IDEA-033, dev-only).
// The prop-part analogue of src/editor/editLog.ts's EditLog: a live,
// THREE-aware dirty-map recorder that turns user gestures on a BUILT prop
// preview (a makePropFromDef() THREE.Group) into the plain serializable
// PropPartEdit[]/AddedPropPart[] shape src/game/props.ts's PropPartLayer
// expects. Kept as a PARALLEL module rather than reusing EditLog directly —
// EditLog's material model is characters.ts-specific (a "known variable
// name" lookup against the beagle's 4 shared coat mats / an enemy's shared
// bodyMat, see editLog.ts's collectMaterials), which has no equivalent here:
// every prop factory builds its OWN per-part material (board.ts's own doc
// comment: "every mesh gets its OWN material… never a shared module-level
// one"), so there is no "shared material, renamed" case to resolve — a prop
// part edit is always just "this ONE mesh's own color/emissive changed."
// Same "explicit dirty-map, not a blind diff" discipline as EditLog for the
// same reason: idle animation doesn't apply here (props don't animate in the
// preview), but re-selecting a part and reading its CURRENT transform must
// not itself count as an edit — only a value the user actually changed via
// the inspector enters the log.
import * as THREE from "three";
import { type PartNode } from "./partTree";
import {
  type PropPartEdit,
  type AddedPropPart,
  type PropPartLayer,
  type PropPrimKind,
} from "../game/props";
import { hasEmissive, isEditableMaterial } from "../render/toon";

export type Vec3Tuple = [number, number, number];

const EPS = 1e-4;

interface TransformBaseline {
  position: Vec3Tuple;
  rotation: Vec3Tuple;
  scale: Vec3Tuple;
  visible: boolean;
}

interface MaterialBaseline {
  color: number;
  /** Only present when the base part was already emissive (emissiveIntensity
   *  > 0) — mirrors board.ts's applyPropPartEdit, which only ever writes
   *  `emissive` onto a part the factory already lit. A part with no baseline
   *  emissive can never gain an `emissive` field in the log (there is no
   *  inspector control for it — see propsPartInspector.ts, which only shows
   *  an emissive swatch when this is defined). */
  emissive?: number;
}

/** One AddedPropPart under construction/edit in the live preview — the
 *  in-scene counterpart of the serializable AddedPropPart, carrying the
 *  actual THREE.Mesh + material so the inspector can rebuild its geometry on
 *  a param tweak (mirrors editLog.ts's AddedPartRecord exactly, minus the
 *  parentVar/name codegen bookkeeping, which props.ts's data-only export
 *  never needs — see AddedPropPart's own doc comment in props.ts). */
export interface LiveAddedPropPart {
  id: string;
  parentPath: string;
  kind: PropPrimKind;
  object: THREE.Mesh;
  /** IDEA-062: a MeshToonMaterial, not MeshStandardMaterial.
   *
   *  board.ts's addPropPart builds every added prop part with `toon()`, so
   *  an ADOPTED part (one a previous session saved, rebuilt by
   *  makePropFromDef) always arrives carrying one — and the editor used to
   *  build FRESH ones with `new THREE.MeshStandardMaterial(...)`, which meant
   *  the preview and the shipped game shaded the same part differently and
   *  quietly broke the project's one-material-model cel-shading rule. Both
   *  paths are toon now, so this is the honest type. It also keeps the
   *  `emissiveIntensity` read in toPropPartLayer sound — `EditableMaterial`
   *  would have widened this to include MeshBasicMaterial, which has no
   *  emissive channel at all. */
  material: THREE.MeshToonMaterial;
  params: Record<string, number>;
}

function tuple(v: { x: number; y: number; z: number }): Vec3Tuple {
  return [v.x, v.y, v.z];
}

function near(a: Vec3Tuple, b: Vec3Tuple): boolean {
  return Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS && Math.abs(a[2] - b[2]) < EPS;
}

/** IDEA-062: the CHANNELS a PropPartEdit can carry, besides its `path` key.
 *  Written out rather than derived with a `keyof` filter so the merge below
 *  is a plain loop over a literal list — a new optional field on
 *  PropPartEdit that is not added here is silently not merged, which is the
 *  same hand-written-field trap propsCodegen.ts's PARAM_FIELD_ORDER has.
 *  scripts/test-prop-part-merge.ts pins every entry. */
const EDIT_CHANNELS = ["position", "rotation", "scale", "color", "emissive", "visible"] as const;

/** Copies every channel `next` actually carries onto `base`, leaving the rest
 *  of `base` alone — the per-channel half of IDEA-062's merge. Written as an
 *  explicit switch rather than an index-signature cast so `strict` checks
 *  every assignment: a new optional field on PropPartEdit that is added to
 *  EDIT_CHANNELS but not here is a COMPILE error rather than a silent drop,
 *  which is the opposite of how propsCodegen's hand-written field list
 *  behaves and the reason this one is safe to hand-write. */
function mergeEdit(base: PropPartEdit, next: PropPartEdit): PropPartEdit {
  const out: PropPartEdit = { ...base };
  for (const channel of EDIT_CHANNELS) {
    if (next[channel] === undefined) continue;
    switch (channel) {
      case "position": out.position = next.position; break;
      case "rotation": out.rotation = next.rotation; break;
      case "scale": out.scale = next.scale; break;
      case "color": out.color = next.color; break;
      case "emissive": out.emissive = next.emissive; break;
      case "visible": out.visible = next.visible; break;
    }
  }
  return out;
}

/** Deep-copies a PropPartLayer so the log can hold the def's saved layer
 *  without aliasing the working library's arrays (same contract as
 *  propsWorking.ts's clonePropPartLayer, duplicated here rather than
 *  imported because that module is the WORKING-COPY shape's owner and this
 *  one must not depend on it — propPartEditLog is used by the pure merge
 *  test with no working library in sight). Tuple fields are never mutated in
 *  place (every edit REPLACES the whole tuple), so a per-entry spread is a
 *  genuine deep copy. */
function cloneLayer(layer: PropPartLayer | undefined): PropPartLayer | undefined {
  if (!layer) return undefined;
  return {
    edits: layer.edits.map((e) => ({ ...e })),
    added: layer.added.map((a) => ({ ...a, params: { ...a.params } })),
  };
}

let addedPartCounter = 0;
/** A fresh, session-unique id for a newly-added prop part — "added-<kind>-N"
 *  (props.ts's AddedPropPart doc: "auto-generated… never re-derived from
 *  tree position"). The counter is MODULE-level (not per-log) so ids stay
 *  unique even across a prop switch mid-session — two different props each
 *  gaining an "added-box-1" would be harmless in isolation (they're scoped
 *  to different PropDefs), but a single counter costs nothing and rules out
 *  ever having to reason about cross-prop collisions at all. */
function nextAddedPartId(kind: PropPrimKind): string {
  addedPartCounter++;
  return `added-${kind}-${addedPartCounter}`;
}

/**
 * One PropPartEditLog instance per SELECTED prop def's live preview build
 * (main.ts constructs a fresh one every time rebuildPropsPreview() runs for
 * a newly-selected/rebuilt def, exactly like EditLog is rebuilt per
 * character switch). Baselines are snapshotted right after the preview
 * mesh is built (its as-built pose, i.e. base shape + any ALREADY-SAVED
 * def.parts already applied by makePropFromDef) — so touching a channel
 * back to what it already was (including a previously-saved edit) correctly
 * drops out of the "new edit" bucket, exactly like EditLog.touchTransform's
 * own near-baseline pruning.
 */
export class PropPartEditLog {
  private baselines = new Map<string, TransformBaseline>();
  private materialBaselines = new Map<string, MaterialBaseline>();
  readonly edits = new Map<string, PropPartEdit>();
  readonly added: LiveAddedPropPart[] = [];
  /** True once ANY touch-family call (or add/removePart) has run since the
   *  last snapshot() — deliberately distinct from "edits.size > 0 ||
   *  added.length > 0": a channel nudged and then nudged BACK to baseline
   *  correctly PRUNES its edit record (see touchTransform's own
   *  near-baseline pruning), leaving `edits` empty again even though the
   *  user genuinely interacted with this part — `dirty` still reflects
   *  that interaction happened, which main.ts's syncPartsIntoWorkingDef
   *  needs to tell "the user actively undid every edit back to nothing"
   *  (a real, deliberate all-clear — should update def.parts to reflect
   *  that) apart from "this log was simply re-baselined by a fresh
   *  rebuild and has never been touched since" (should NOT touch
   *  def.parts at all — see that function's own doc comment for the real
   *  bug this distinction fixes: two back-to-back rebuilds of the SAME
   *  untouched def were silently deleting its own already-saved parts). */
  private dirty = false;

  /** IDEA-062: the def's ALREADY-SAVED layer, as it stood when this log was
   *  snapshotted. Deep-copied on the way in so nothing here can alias — let
   *  alone mutate — the working library's own arrays.
   *
   *  This exists because of the single worst bug the editor has had. The
   *  baselines above are captured from the preview mesh, which
   *  makePropFromDef has ALREADY run applyPropParts over — so a saved edit is
   *  part of the baseline, and `toPropPartLayer()` can only ever describe
   *  THIS SESSION's deltas on top of it. main.ts used to assign that straight
   *  onto `def.parts`, which meant every previously-saved edit was deleted the
   *  moment you touched one part in a later session (the treehouse went from
   *  seven edits to one that way). `mergeIntoSaved()` below is the fix: the
   *  session layer is merged ONTO this, per path and per CHANNEL. */
  private savedLayer: PropPartLayer | undefined;

  /** Snapshot the as-built pose + material of every part. Call once per
   *  preview (re)build. `materialFor` resolves a mesh to its ONE owned
   *  material (props never share materials across parts — see this file's
   *  header) so the baseline can be captured without a separate "collect
   *  materials" pass the way editLog.ts's collectMaterials needs for
   *  characters.ts's shared coat/body materials.
   *
   *  IDEA-062: `saved` is the def's own `parts` field — the layer
   *  makePropFromDef already baked into the very mesh these baselines are
   *  read from. Pass it EVERY time, or the merge has nothing to merge onto
   *  and the destructive-replace bug comes straight back.
   *
   *  Note this clears `added`, so main.ts's adoption of previously-saved
   *  added parts (adoptSaved below) must run AFTER this, never before. */
  snapshot(nodes: PartNode[], saved?: PropPartLayer): void {
    this.baselines.clear();
    this.materialBaselines.clear();
    this.edits.clear();
    this.added.length = 0;
    this.dirty = false;
    this.savedLayer = cloneLayer(saved);
    for (const node of nodes) {
      this.baselines.set(node.path, {
        position: tuple(node.object.position),
        rotation: [node.object.rotation.x, node.object.rotation.y, node.object.rotation.z],
        scale: tuple(node.object.scale),
        visible: node.object.visible,
      });
      if (node.object instanceof THREE.Mesh) {
        const mat = Array.isArray(node.object.material) ? node.object.material[0] : node.object.material;
        if (isEditableMaterial(mat)) {
          this.materialBaselines.set(node.path, {
            color: mat.color.getHex(),
            emissive: hasEmissive(mat) && mat.emissiveIntensity > 0 ? mat.emissive.getHex() : undefined,
          });
        }
      }
    }
  }

  private ensureEdit(path: string): PropPartEdit {
    let edit = this.edits.get(path);
    if (!edit) {
      edit = { path };
      this.edits.set(path, edit);
    }
    return edit;
  }

  private pruneEdit(path: string, edit: PropPartEdit): void {
    if (
      edit.position === undefined &&
      edit.rotation === undefined &&
      edit.scale === undefined &&
      edit.color === undefined &&
      edit.emissive === undefined &&
      edit.visible === undefined
    ) {
      this.edits.delete(path);
    }
  }

  /** Record the current value of one transform channel the user just
   *  changed — a value wiggled back to baseline drops the field again (same
   *  idiom as EditLog.touchTransform). No-op for an ADDED part (its whole
   *  AddedPropPart record IS its transform — see readAddedTransform below),
   *  mirroring EditLog's own `if (node.object.userData.editorAdded) return`. */
  touchTransform(node: PartNode, channel: "position" | "rotation" | "scale"): void {
    if (node.object.userData.editorAdded) return;
    const base = this.baselines.get(node.path);
    if (!base) return;
    this.dirty = true;
    const o = node.object;
    const current: Vec3Tuple =
      channel === "rotation" ? [o.rotation.x, o.rotation.y, o.rotation.z] : tuple(o[channel]);
    const edit = this.ensureEdit(node.path);
    if (near(current, base[channel])) {
      delete edit[channel];
      this.pruneEdit(node.path, edit);
    } else {
      edit[channel] = current;
    }
  }

  touchVisible(node: PartNode): void {
    if (node.object.userData.editorAdded) return;
    const base = this.baselines.get(node.path);
    if (!base) return;
    this.dirty = true;
    const edit = this.ensureEdit(node.path);
    if (node.object.visible === base.visible) {
      delete edit.visible;
      this.pruneEdit(node.path, edit);
    } else {
      edit.visible = node.object.visible;
    }
  }

  /** Record a material color/emissive change on a BASE part's own mesh
   *  material (an added part's color lives on its AddedPropPart record
   *  instead — see touchAddedColor). `channel` distinguishes color vs.
   *  emissive since the inspector may show either, both, or neither swatch
   *  depending on whether the part was already emissive (see
   *  propsPartInspector.ts). */
  touchMaterial(node: PartNode, channel: "color" | "emissive", value: number): void {
    if (node.object.userData.editorAdded) return;
    const base = this.materialBaselines.get(node.path);
    if (!base) return;
    this.dirty = true;
    const edit = this.ensureEdit(node.path);
    const baseValue = channel === "color" ? base.color : base.emissive;
    if (baseValue === value) {
      delete edit[channel];
      this.pruneEdit(node.path, edit);
    } else {
      edit[channel] = value;
    }
  }

  /** Whether the base part at `path` was already emissive at snapshot time —
   *  drives whether propsPartInspector.ts shows an "emissive" swatch at all
   *  (see MaterialBaseline's own doc comment on why this can never gain the
   *  field otherwise). */
  hasEmissiveBaseline(path: string): boolean {
    return this.materialBaselines.get(path)?.emissive !== undefined;
  }

  addPart(record: LiveAddedPropPart): void {
    this.dirty = true;
    this.added.push(record);
  }

  /** IDEA-062: re-adopt a part that a PREVIOUS session added and saved.
   *
   *  makePropFromDef rebuilds every `parts.added` entry as an ordinary mesh
   *  (board.ts's addPropPart), so without this the log's `added` array comes
   *  back EMPTY on the next load and `mergeIntoSaved` would write
   *  `added: []` — every previously-added part deleted, in exactly the way
   *  the treehouse lost six edits. Adoption gives the rebuilt mesh its
   *  identity back, so the part is carried forward, and so editing it
   *  updates its own AddedPropPart record rather than emitting a path edit
   *  against a node applyPropParts will overwrite anyway.
   *
   *  Deliberately does NOT set `dirty`: adopting is bookkeeping that runs on
   *  every preview build, not a user gesture. Setting it here would make
   *  every prop selection look edited and defeat the `isDirty` guard
   *  main.ts's merge relies on. */
  adoptSaved(record: LiveAddedPropPart): void {
    this.added.push(record);
  }

  /** IDEA-062: drop a SAVED edit for `path` entirely — "reset this part to
   *  factory".
   *
   *  The merge made every saved edit sticky, which is right, but it also
   *  means dragging a part back to where it looks unedited only returns it
   *  to its SAVED pose: the baseline IS the saved value, so `touchTransform`
   *  prunes the session edit and the saved one survives. Without this there
   *  would be no way to undo a saved edit from inside the editor at all.
   *  The caller rebuilds the preview afterwards so the mesh actually returns
   *  to its factory pose. */
  clearSavedEdit(path: string): void {
    if (!this.savedLayer) return;
    const edits = this.savedLayer.edits.filter((e) => e.path !== path);
    if (edits.length === this.savedLayer.edits.length) return;
    this.savedLayer = { edits, added: this.savedLayer.added };
    this.dirty = true;
  }

  /** IDEA-062: whether `path` carries a saved edit — drives whether
   *  propsPartInspector.ts offers a "reset to factory" button at all
   *  (IDEA-041's rule: no control wired to nothing). */
  hasSavedEdit(path: string): boolean {
    return this.savedLayer?.edits.some((e) => e.path === path) ?? false;
  }

  /**
   * IDEA-062: the def's saved layer with this session's edits merged ON TOP
   * — the value main.ts writes back to `def.parts`, replacing the straight
   * `def.parts = toPropPartLayer()` that was deleting saved work.
   *
   * Merge rules, and each one is load-bearing:
   *
   *  - **Per CHANNEL, not per path.** A saved `{ path:"6", rotation, scale }`
   *    where this session only moved position must come out carrying all
   *    three. Replacing the whole entry is the bug one level down.
   *  - **`added` comes wholesale from the log**, never from the saved layer:
   *    adoptSaved has already put every previously-saved added part back
   *    into it, so the log is the complete picture and a union would double
   *    every one of them. A part deleted this session is correctly absent.
   *  - **A saved edit whose path belongs to an adopted added part is
   *    dropped**, with a warning. applyPropParts runs `edits` BEFORE `added`
   *    and then rebuilds the added part from its own record, so such an edit
   *    never had any effect — it is residue from the pre-fix editor, which
   *    could not tell an added part from a base one.
   *
   * Returns `undefined` when the result is empty in both arrays, so the
   * caller can `delete def.parts` and a never-edited def stays byte-identical
   * to its hand-authored form.
   */
  mergeIntoSaved(): PropPartLayer | undefined {
    const session = this.toPropPartLayer();

    const merged = new Map<string, PropPartEdit>();
    for (const saved of this.savedLayer?.edits ?? []) merged.set(saved.path, { ...saved });
    for (const edit of session.edits) {
      // `undefined` on a channel means "this session did not touch it",
      // which must leave the saved value alone. Only a value the session
      // actually recorded overwrites — and touchTransform has already pruned
      // any channel wiggled back to baseline. Spreading `edit` wholesale
      // would NOT do: an absent optional field is still absent from the
      // spread, but `{ ...saved, ...edit }` is only correct because of that
      // — and it silently stops being correct the day a channel is ever set
      // to an explicit undefined. Assigning per channel says what is meant.
      merged.set(edit.path, mergeEdit(merged.get(edit.path) ?? { path: edit.path }, edit));
    }

    const addedPaths = new Set<string>();
    for (const node of this.added) addedPaths.add(node.id);
    for (const path of merged.keys()) {
      if (!addedPaths.has(path)) continue;
      console.warn(
        `propPartEditLog: dropping a saved edit for "${path}", which is an ADDED part's id — ` +
          "applyPropParts rebuilds added parts from their own record, so this edit never applied.",
      );
      merged.delete(path);
    }

    const edits = [...merged.values()];
    if (edits.length === 0 && session.added.length === 0) return undefined;
    return { edits, added: session.added };
  }

  removePart(object: THREE.Object3D): LiveAddedPropPart | undefined {
    const idx = this.added.findIndex((p) => p.object === object);
    if (idx === -1) return undefined;
    this.dirty = true;
    return this.added.splice(idx, 1)[0];
  }

  findAddedPart(object: THREE.Object3D): LiveAddedPropPart | undefined {
    return this.added.find((p) => p.object === object);
  }

  get isEmpty(): boolean {
    return this.edits.size === 0 && this.added.length === 0;
  }

  /** True once ANY touch-family call (or add/removePart) has run since the
   *  last snapshot() — see the `dirty` field's own doc comment for exactly
   *  what distinction this draws and why main.ts's syncPartsIntoWorkingDef
   *  needs it instead of `!isEmpty`. */
  get isDirty(): boolean {
    return this.dirty;
  }

  /** Serializes the log's current state into the plain PropPartEdit[]/
   *  AddedPropPart[] shape props.ts's PropPartLayer expects — read live off
   *  each LiveAddedPropPart's object/material (added parts never animate, so
   *  a live read is stable, same reasoning as codegen.ts's addedPartLines). */
  toPropPartLayer(): { edits: PropPartEdit[]; added: AddedPropPart[] } {
    const edits = [...this.edits.values()].map((e) => ({ ...e }));
    const added: AddedPropPart[] = this.added.map((a) => {
      const p = a.object.position;
      const r = a.object.rotation;
      const s = a.object.scale;
      const rotation: Vec3Tuple = [r.x, r.y, r.z];
      const scale: Vec3Tuple = [s.x, s.y, s.z];
      const hasRotation = Math.abs(r.x) > EPS || Math.abs(r.y) > EPS || Math.abs(r.z) > EPS;
      const hasScale = Math.abs(s.x - 1) > EPS || Math.abs(s.y - 1) > EPS || Math.abs(s.z - 1) > EPS;
      return {
        id: a.id,
        parentPath: a.parentPath,
        kind: a.kind,
        params: { ...a.params },
        position: [p.x, p.y, p.z] as const,
        ...(hasRotation ? { rotation } : {}),
        ...(hasScale ? { scale } : {}),
        color: a.material.color.getHex(),
        ...(a.material.emissiveIntensity > 0 ? { emissive: a.material.emissive.getHex() } : {}),
      };
    });
    return { edits, added };
  }
}

export { nextAddedPartId };
