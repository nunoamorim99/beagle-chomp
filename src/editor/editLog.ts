// OWNER: character editor (IDEA-025, dev-only).
// The record of what the user actually changed — an explicit dirty-map keyed
// by part path, written only from the inspector's onChange handlers. This is
// deliberately NOT a blind baseline-vs-scene diff: the idle animation writes
// tail/ear rotations and the breathing scale every frame, and a blind diff
// would report all of that as "edits". Only channels the user touched enter
// the log, with the values captured at touch time so codegen stays stable
// even while the model animates.
import * as THREE from "three";
import { type PartNode } from "./partTree";

export type Vec3Tuple = [number, number, number];

const EPS = 1e-4;

interface TransformBaseline {
  position: Vec3Tuple;
  rotation: Vec3Tuple;
  scale: Vec3Tuple;
  visible: boolean;
}

export interface MaterialInfo {
  material: THREE.MeshStandardMaterial;
  /** Name generated code refers to — "tan"/"white"/"black"/"ear" (beagle
   *  coat), "bodyMat" (enemies), or "<firstMeshName>Mat" as fallback. */
  varName: string;
  /** True when varName matches a real variable in characters.ts (coat mats,
   *  bodyMat); false for the "<meshName>Mat" fallback, which needs a locator
   *  comment in generated code. */
  isKnownVar: boolean;
  /** How many meshes of the current character share this material. */
  shareCount: number;
  /** varName of the first mesh using it (for locator comments). */
  firstUserVar: string;
}

export interface TransformEditRecord {
  path: string;
  varName: string;
  isAutoNamed: boolean;
  /** Human locator for auto-named parts ("sphere at (0, 0.3, -0.2)"). */
  locator: string;
  position?: Vec3Tuple;
  rotation?: Vec3Tuple;
  scale?: Vec3Tuple;
  visible?: boolean;
}

export interface MaterialEditRecord {
  info: MaterialInfo;
  color?: number;
  roughness?: number;
}

export type PrimKind = "sphere" | "box" | "cylinder" | "cone" | "capsule";

export interface AddedPartRecord {
  name: string;
  kind: PrimKind;
  parentVar: string;
  object: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  /** Geometry constructor params, in the order the codegen emits them. */
  params: Record<string, number>;
}

/** An ORIGINAL model part (mesh or group the character builder itself
 *  constructs) the user deleted in the editor. Unlike AddedPartRecord, there
 *  is no geometry/material to own or dispose — those belong to the character
 *  build (see registry.ts's disposeGroup, which reclaims them on character
 *  switch) — this record exists purely so codegen can emit a
 *  `<varName>.removeFromParent();` line while the part is gone. */
export interface DeletedOriginalRecord {
  path: string;
  varName: string;
  isAutoNamed: boolean;
  locator: string;
}

function tuple(v: { x: number; y: number; z: number }): Vec3Tuple {
  return [v.x, v.y, v.z];
}

function near(a: Vec3Tuple, b: Vec3Tuple): boolean {
  return Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS && Math.abs(a[2] - b[2]) < EPS;
}

function describeLocator(object: THREE.Object3D): string {
  const kind =
    object instanceof THREE.Mesh
      ? (object.geometry as THREE.BufferGeometry).type
      : "Group";
  const p = object.position;
  const f = (n: number): string => String(Math.round(n * 1000) / 1000);
  return `${kind} at (${f(p.x)}, ${f(p.y)}, ${f(p.z)})`;
}

/**
 * One EditLog instance per loaded character. Baselines are snapshotted right
 * after the character is built (its authored pose); edits overwrite live
 * objects AND are recorded here. Cleared wholesale on character switch.
 */
export class EditLog {
  private baselines = new Map<string, TransformBaseline>();
  private materialBaselines = new Map<string, { color: number; roughness: number }>();
  readonly transformEdits = new Map<string, TransformEditRecord>();
  readonly materialEdits = new Map<string, MaterialEditRecord>();
  readonly addedParts: AddedPartRecord[] = [];
  /** Keyed by path (the same stable identity transformEdits uses) — an
   *  original part currently deleted from the scene. Undo removes its entry
   *  again (no removeFromParent() line once restored); a part re-deleted via
   *  redo re-adds it with the same path. */
  readonly deletedOriginals = new Map<string, DeletedOriginalRecord>();

  /** Snapshot the authored pose of every part + material. Call once per build. */
  snapshot(nodes: PartNode[], materials: MaterialInfo[]): void {
    this.baselines.clear();
    this.materialBaselines.clear();
    this.transformEdits.clear();
    this.materialEdits.clear();
    this.addedParts.length = 0;
    this.deletedOriginals.clear();
    for (const node of nodes) {
      this.baselines.set(node.path, {
        position: tuple(node.object.position),
        rotation: [node.object.rotation.x, node.object.rotation.y, node.object.rotation.z],
        scale: tuple(node.object.scale),
        visible: node.object.visible,
      });
    }
    for (const info of materials) {
      this.materialBaselines.set(info.material.uuid, {
        color: info.material.color.getHex(),
        roughness: info.material.roughness,
      });
    }
  }

  /** Record the current value of one transform channel the user just changed.
   *  A value wiggled back to its baseline drops out of the log again. */
  touchTransform(node: PartNode, channel: "position" | "rotation" | "scale"): void {
    if (node.object.userData.editorAdded) return; // added parts emit their whole block
    const base = this.baselines.get(node.path);
    if (!base) return;
    const o = node.object;
    const current: Vec3Tuple =
      channel === "rotation" ? [o.rotation.x, o.rotation.y, o.rotation.z] : tuple(o[channel]);
    const record = this.ensureTransformRecord(node);
    if (near(current, base[channel])) {
      delete record[channel];
      this.pruneTransformRecord(node.path, record);
    } else {
      record[channel] = current;
    }
  }

  touchVisible(node: PartNode): void {
    if (node.object.userData.editorAdded) return;
    const base = this.baselines.get(node.path);
    if (!base) return;
    const record = this.ensureTransformRecord(node);
    if (node.object.visible === base.visible) {
      delete record.visible;
      this.pruneTransformRecord(node.path, record);
    } else {
      record.visible = node.object.visible;
    }
  }

  touchMaterial(info: MaterialInfo): void {
    const base = this.materialBaselines.get(info.material.uuid);
    if (!base) return;
    const record: MaterialEditRecord = this.materialEdits.get(info.material.uuid) ?? { info };
    const color = info.material.color.getHex();
    if (color === base.color) delete record.color;
    else record.color = color;
    if (Math.abs(info.material.roughness - base.roughness) < EPS) delete record.roughness;
    else record.roughness = info.material.roughness;
    if (record.color === undefined && record.roughness === undefined) {
      this.materialEdits.delete(info.material.uuid);
    } else {
      this.materialEdits.set(info.material.uuid, record);
    }
  }

  /** Restore a part's transform to baseline + user edits — used when pausing
   *  the idle animation so idle-driven channels snap back to authored values
   *  instead of freezing mid-wag. */
  restoreAuthoredTransform(node: PartNode): void {
    const base = this.baselines.get(node.path);
    if (!base) return;
    const edit = this.transformEdits.get(node.path);
    const pos = edit?.position ?? base.position;
    const rot = edit?.rotation ?? base.rotation;
    const scl = edit?.scale ?? base.scale;
    node.object.position.set(pos[0], pos[1], pos[2]);
    node.object.rotation.set(rot[0], rot[1], rot[2]);
    node.object.scale.set(scl[0], scl[1], scl[2]);
  }

  /** Re-bases one material to its CURRENT values and drops its edit record —
   *  used when a skin/team-color swap legitimately changes the material
   *  underneath the editor (the new coat becomes the new "unedited"). */
  refreshMaterialBaseline(info: MaterialInfo): void {
    this.materialBaselines.set(info.material.uuid, {
      color: info.material.color.getHex(),
      roughness: info.material.roughness,
    });
    this.materialEdits.delete(info.material.uuid);
  }

  addPart(record: AddedPartRecord): void {
    this.addedParts.push(record);
  }

  removePart(object: THREE.Object3D): AddedPartRecord | undefined {
    const idx = this.addedParts.findIndex((p) => p.object === object);
    if (idx === -1) return undefined;
    return this.addedParts.splice(idx, 1)[0];
  }

  findAddedPart(object: THREE.Object3D): AddedPartRecord | undefined {
    return this.addedParts.find((p) => p.object === object);
  }

  /** Record that an ORIGINAL part was deleted — varName/locator are captured
   *  NOW (accepts the same identifying fields a PartNode carries, but not a
   *  full PartNode: main.ts's undo/redo closures keep their own small record
   *  rather than one that can go stale when refreshParts() rebuilds the tree)
   *  so they still read correctly even after the object leaves the graph. */
  markOriginalDeleted(part: { path: string; varName: string; isAutoNamed: boolean; object: THREE.Object3D }): void {
    this.deletedOriginals.set(part.path, {
      path: part.path,
      varName: part.varName,
      isAutoNamed: part.isAutoNamed,
      locator: describeLocator(part.object),
    });
  }

  /** Undo of that delete — the part is back, so codegen must stop emitting
   *  removeFromParent() for it. */
  unmarkOriginalDeleted(path: string): void {
    this.deletedOriginals.delete(path);
  }

  isOriginalDeleted(path: string): boolean {
    return this.deletedOriginals.has(path);
  }

  get isEmpty(): boolean {
    return (
      this.transformEdits.size === 0 &&
      this.materialEdits.size === 0 &&
      this.addedParts.length === 0 &&
      this.deletedOriginals.size === 0
    );
  }

  private ensureTransformRecord(node: PartNode): TransformEditRecord {
    let record = this.transformEdits.get(node.path);
    if (!record) {
      record = {
        path: node.path,
        varName: node.varName,
        isAutoNamed: node.isAutoNamed,
        locator: describeLocator(node.object),
      };
      this.transformEdits.set(node.path, record);
    }
    return record;
  }

  private pruneTransformRecord(path: string, record: TransformEditRecord): void {
    if (
      record.position === undefined &&
      record.rotation === undefined &&
      record.scale === undefined &&
      record.visible === undefined
    ) {
      this.transformEdits.delete(path);
    }
  }
}

/**
 * Collects the unique MeshStandardMaterials of a character with friendly
 * names for codegen: the beagle's shared coat mats resolve to tan/white/
 * black/ear (via userData.coatMats), the enemies' shared body material to
 * bodyMat (via userData.bodyMat) — those are real variable names in
 * characters.ts. Anything else falls back to "<firstMeshName>Mat" and gets
 * flagged so codegen adds a locator comment.
 */
export function collectMaterials(root: THREE.Object3D, nodes: PartNode[]): MaterialInfo[] {
  const coatMats = root.userData.coatMats as
    | { tan: THREE.Material; white: THREE.Material; black: THREE.Material; ear: THREE.Material }
    | undefined;
  const bodyMat = root.userData.bodyMat as THREE.Material | undefined;

  const known = new Map<THREE.Material, string>();
  if (coatMats) {
    known.set(coatMats.tan, "tan");
    known.set(coatMats.white, "white");
    known.set(coatMats.black, "black");
    known.set(coatMats.ear, "earMat");
  }
  if (bodyMat) known.set(bodyMat, "bodyMat");

  const infos = new Map<string, MaterialInfo>();
  const varNameByObject = new Map<THREE.Object3D, string>();
  for (const n of nodes) varNameByObject.set(n.object, n.varName);

  for (const node of nodes) {
    if (!(node.object instanceof THREE.Mesh)) continue;
    const mats = Array.isArray(node.object.material)
      ? node.object.material
      : [node.object.material];
    for (const mat of mats) {
      if (!(mat instanceof THREE.MeshStandardMaterial)) continue;
      const existing = infos.get(mat.uuid);
      if (existing) {
        existing.shareCount++;
        continue;
      }
      const knownName = known.get(mat);
      infos.set(mat.uuid, {
        material: mat,
        varName: knownName ?? `${varNameByObject.get(node.object) ?? "part"}Mat`,
        isKnownVar: knownName !== undefined,
        shareCount: 1,
        firstUserVar: varNameByObject.get(node.object) ?? "?",
      });
    }
  }
  return [...infos.values()];
}
