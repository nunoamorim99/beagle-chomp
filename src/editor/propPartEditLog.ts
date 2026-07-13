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
import { type PropPartEdit, type AddedPropPart, type PropPrimKind } from "../game/props";

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
  material: THREE.MeshStandardMaterial;
  params: Record<string, number>;
}

function tuple(v: { x: number; y: number; z: number }): Vec3Tuple {
  return [v.x, v.y, v.z];
}

function near(a: Vec3Tuple, b: Vec3Tuple): boolean {
  return Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS && Math.abs(a[2] - b[2]) < EPS;
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

  /** Snapshot the as-built pose + material of every part. Call once per
   *  preview (re)build. `materialFor` resolves a mesh to its ONE owned
   *  material (props never share materials across parts — see this file's
   *  header) so the baseline can be captured without a separate "collect
   *  materials" pass the way editLog.ts's collectMaterials needs for
   *  characters.ts's shared coat/body materials. */
  snapshot(nodes: PartNode[]): void {
    this.baselines.clear();
    this.materialBaselines.clear();
    this.edits.clear();
    this.added.length = 0;
    this.dirty = false;
    for (const node of nodes) {
      this.baselines.set(node.path, {
        position: tuple(node.object.position),
        rotation: [node.object.rotation.x, node.object.rotation.y, node.object.rotation.z],
        scale: tuple(node.object.scale),
        visible: node.object.visible,
      });
      if (node.object instanceof THREE.Mesh) {
        const mat = Array.isArray(node.object.material) ? node.object.material[0] : node.object.material;
        if (mat instanceof THREE.MeshStandardMaterial) {
          this.materialBaselines.set(node.path, {
            color: mat.color.getHex(),
            emissive: mat.emissiveIntensity > 0 ? mat.emissive.getHex() : undefined,
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
