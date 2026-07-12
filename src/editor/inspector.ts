// OWNER: character editor (IDEA-025, dev-only).
// The lil-gui control pane: global controls (character / skin / team color /
// turntable / idle / grid + Add part) plus a per-selection folder rebuilt on
// every select — transform channels, visibility, the (possibly shared)
// material, geometry params for editor-added parts, and Delete. Every
// onChange writes the live object AND records the touched channel in the
// EditLog (the explicit dirty-map that keeps idle animation out of codegen).
// Delete (IDEA-025 v2) works on ANY part except the character root — both
// editor-added primitives and ORIGINAL mesh/group parts from the builder;
// main.ts's onDelete dispatches to the right removal path (see its
// deletePart/deleteOriginalPart) so this file stays agnostic to which kind
// it's deleting.
import GUI from "lil-gui";
import * as THREE from "three";
import { type PartNode } from "./partTree";
import {
  EditLog,
  type MaterialInfo,
  type AddedPartRecord,
  type PrimKind,
  type Vec3Tuple,
} from "./editLog";
import { buildPrimitiveGeometry } from "./codegen";
import { BEAGLE_SKINS } from "../game/cosmetics";
import { CHARACTERS, type EnemyColorKey } from "./registry";

export interface EditorState {
  characterId: string;
  beagleSkinId: string;
  enemyColor: EnemyColorKey;
  turntable: boolean;
  idle: boolean;
  grid: boolean;
  highlight: boolean;
}

export interface InspectorCallbacks {
  onCharacter(id: string): void;
  onSkin(id: string): void;
  onEnemyColor(key: EnemyColorKey): void;
  onTurntable(on: boolean): void;
  onIdle(on: boolean): void;
  onGrid(on: boolean): void;
  onHighlight(on: boolean): void;
  onAddPart(kind: PrimKind, name: string): void;
}

export type TransformChannel = "position" | "rotation" | "scale";

export interface MaterialSnapshot {
  color: number;
  roughness: number;
}

export interface SelectionContext {
  log: EditLog;
  /** Resolves a mesh's material to its friendly-name info (shared-awareness). */
  materialFor(mesh: THREE.Mesh): MaterialInfo | undefined;
  /** The added-part record when the selection was created in the editor. */
  addedRecord: AddedPartRecord | undefined;
  /** Called after every edit so the code panel refreshes. */
  onEdit(): void;
  /** Geometry params of an added part changed (geometry was rebuilt). */
  onGeometryRebuilt(node: PartNode): void;
  onDelete(node: PartNode): void;
  // Commit hooks (fired once per finished gesture, not per drag tick) — main
  // turns these into undo/redo history entries.
  onTransformCommitted(node: PartNode, channel: TransformChannel, before: Vec3Tuple, after: Vec3Tuple): void;
  onVisibleCommitted(node: PartNode, before: boolean, after: boolean): void;
  onMaterialCommitted(info: MaterialInfo, before: MaterialSnapshot, after: MaterialSnapshot): void;
  onParamCommitted(record: AddedPartRecord, key: string, before: number, after: number): void;
}

export interface Inspector {
  setSelection(node: PartNode | null, ctx: SelectionContext | null): void;
  /** Reflects the idle checkbox when main auto-pauses it on selection. */
  setIdleChecked(on: boolean): void;
  /** Shows the skin dropdown for the beagle, the team color for enemies. */
  setCharacterMode(isBeagle: boolean): void;
  /** Re-reads every bound value into the widgets (after undo/redo/nudge). */
  refreshDisplays(): void;
}

const POS_RANGE = 2.5;
const SCALE_MAX = 3;

/** Total number of REAL descendants under `object` (not counting itself, and
 *  skipping the editor's own wireframe/BoxHelper overlay — same
 *  userData.editorOverlay filter partTree.ts's buildPartList uses) — used
 *  only to warn "delete part + N inside" on a group before the click, since
 *  deleting a group takes its whole subtree with it and there is no confirm
 *  dialog. Cheap; only computed for the currently selected part. */
function countDescendants(object: THREE.Object3D): number {
  let count = 0;
  object.traverse((o) => {
    if (o !== object && !o.userData.editorOverlay) count++;
  });
  return count;
}

export function createInspector(
  container: HTMLElement,
  state: EditorState,
  cb: InspectorCallbacks,
): Inspector {
  const gui = new GUI({ container, title: "Character Editor" });

  // --- global controls ---
  const characterOptions: Record<string, string> = {};
  for (const c of CHARACTERS) characterOptions[c.label] = c.id;
  gui.add(state, "characterId", characterOptions).name("character").onChange((id: string) => {
    cb.onCharacter(id);
  });

  const skinOptions: Record<string, string> = {};
  for (const s of BEAGLE_SKINS) skinOptions[s.name] = s.id;
  const skinCtrl = gui
    .add(state, "beagleSkinId", skinOptions)
    .name("skin")
    .onChange((id: string) => cb.onSkin(id));

  const colorCtrl = gui
    .add(state, "enemyColor", { Rose: "rose", Teal: "teal", Amber: "amber" })
    .name("team color")
    .onChange((key: EnemyColorKey) => cb.onEnemyColor(key));

  gui.add(state, "turntable").onChange((on: boolean) => cb.onTurntable(on));
  const idleCtrl = gui.add(state, "idle").name("idle animation").onChange((on: boolean) => cb.onIdle(on));
  gui.add(state, "grid").onChange((on: boolean) => cb.onGrid(on));
  gui
    .add(state, "highlight")
    .name("selection highlight")
    .onChange((on: boolean) => cb.onHighlight(on));

  // --- add part ---
  const addFolder = gui.addFolder("Add part");
  const addState = { kind: "sphere" as PrimKind, name: "" };
  addFolder.add(addState, "kind", ["sphere", "box", "cylinder", "cone", "capsule"]);
  addFolder.add(addState, "name");
  addFolder
    .add({ add: () => cb.onAddPart(addState.kind, addState.name) }, "add")
    .name("add to selected part ➕");

  // --- selection folder (rebuilt per selection) ---
  let selectionFolder: GUI | null = null;

  function buildSelectionFolder(node: PartNode, ctx: SelectionContext): void {
    const folder = gui.addFolder(`Selected: ${node.displayName}`);
    selectionFolder = folder;
    const o = node.object;

    const readChannel = (channel: TransformChannel): Vec3Tuple =>
      channel === "rotation"
        ? [o.rotation.x, o.rotation.y, o.rotation.z]
        : [o[channel].x, o[channel].y, o[channel].z];
    const same = (a: Vec3Tuple, b: Vec3Tuple): boolean =>
      Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6 && Math.abs(a[2] - b[2]) < 1e-6;

    // "Committed" = the value when the current gesture started; one history
    // entry per finished gesture (drag release / Enter), never per drag tick.
    const committed: Record<TransformChannel, Vec3Tuple> = {
      position: readChannel("position"),
      rotation: readChannel("rotation"),
      scale: readChannel("scale"),
    };
    let committedVisible = o.visible;

    const touched = (channel: TransformChannel) => (): void => {
      ctx.log.touchTransform(node, channel);
      ctx.onEdit();
    };
    const commit = (channel: TransformChannel) => (): void => {
      const after = readChannel(channel);
      if (!same(committed[channel], after)) {
        ctx.onTransformCommitted(node, channel, committed[channel], after);
        committed[channel] = after;
      }
    };

    const pos = folder.addFolder("position");
    const rot = folder.addFolder("rotation");
    const scl = folder.addFolder("scale");
    for (const axis of ["x", "y", "z"] as const) {
      pos
        .add(o.position, axis, -POS_RANGE, POS_RANGE, 0.005)
        .onChange(touched("position"))
        .onFinishChange(commit("position"));
      // No explicit step on rotation: lil-gui anchors the step grid at the
      // range MIN, and -π is irrational — with a step, even a typed "0" snaps
      // to -0.0016 and the edit can never return to baseline. decimals() only
      // formats the display.
      rot
        .add(o.rotation, axis, -Math.PI, Math.PI)
        .decimals(3)
        .onChange(touched("rotation"))
        .onFinishChange(commit("rotation"));
      scl
        .add(o.scale, axis, 0.01, SCALE_MAX, 0.01)
        .onChange(touched("scale"))
        .onFinishChange(commit("scale"));
    }

    folder.add(o, "visible").onChange(() => {
      ctx.log.touchVisible(node);
      ctx.onEdit();
      ctx.onVisibleCommitted(node, committedVisible, o.visible);
      committedVisible = o.visible;
    });

    // Material — edits the REAL (possibly shared) material, exactly like the
    // real code does; the folder title teaches that sharing.
    if (o instanceof THREE.Mesh) {
      const info = ctx.materialFor(o);
      if (info) {
        const title =
          info.shareCount > 1
            ? `material: ${info.varName} (shared by ${info.shareCount} parts)`
            : `material: ${info.varName}`;
        const matFolder = folder.addFolder(title);
        let committedMat: MaterialSnapshot = {
          color: info.material.color.getHex(),
          roughness: info.material.roughness,
        };
        const commitMat = (): void => {
          const after: MaterialSnapshot = {
            color: info.material.color.getHex(),
            roughness: info.material.roughness,
          };
          if (after.color !== committedMat.color || Math.abs(after.roughness - committedMat.roughness) > 1e-6) {
            ctx.onMaterialCommitted(info, committedMat, after);
            committedMat = after;
          }
        };
        const proxy = { color: `#${info.material.color.getHexString()}` };
        matFolder
          .addColor(proxy, "color")
          .onChange((value: string) => {
            info.material.color.set(value);
            ctx.log.touchMaterial(info);
            ctx.onEdit();
          })
          .onFinishChange(commitMat);
        matFolder
          .add(info.material, "roughness", 0, 1, 0.01)
          .onChange(() => {
            ctx.log.touchMaterial(info);
            ctx.onEdit();
          })
          .onFinishChange(commitMat);
      }
    }

    // Editor-added parts get live geometry params on top of the transform/
    // material controls every part already has above.
    const added = ctx.addedRecord;
    if (added) {
      const geo = folder.addFolder("geometry");
      for (const key of Object.keys(added.params)) {
        let committedParam = added.params[key];
        geo
          .add(added.params, key, 0.01, 1.5, 0.005)
          .onChange(() => {
            added.object.geometry.dispose(); // solely owned by the added part
            added.object.geometry = buildPrimitiveGeometry(added.kind, added.params);
            ctx.onGeometryRebuilt(node);
            ctx.onEdit();
          })
          .onFinishChange(() => {
            if (Math.abs(added.params[key] - committedParam) > 1e-6) {
              ctx.onParamCommitted(added, key, committedParam, added.params[key]);
              committedParam = added.params[key];
            }
          });
      }
    }

    // Delete: available for ANY selected part — an editor-added primitive,
    // or an ORIGINAL mesh/group straight from the character builder — except
    // the character ROOT itself, which would leave nothing selected/editable
    // and has no "parent" to remove it from. Deleting a GROUP removes its
    // whole subtree (three.js's own removeFromParent() semantics); no
    // confirm dialog, so the label says so up front instead.
    if (node.path !== "") {
      const subtreeCount = countDescendants(o);
      const label =
        subtreeCount > 0 ? `delete part + ${subtreeCount} inside 🗑` : "delete part 🗑";
      folder.add({ del: () => ctx.onDelete(node) }, "del").name(label);
    }
  }

  return {
    setSelection(node: PartNode | null, ctx: SelectionContext | null): void {
      selectionFolder?.destroy();
      selectionFolder = null;
      if (node && ctx) buildSelectionFolder(node, ctx);
    },
    setIdleChecked(on: boolean): void {
      state.idle = on;
      idleCtrl.updateDisplay();
    },
    setCharacterMode(isBeagle: boolean): void {
      if (isBeagle) {
        skinCtrl.show();
        colorCtrl.hide();
      } else {
        skinCtrl.hide();
        colorCtrl.show();
      }
    },
    refreshDisplays(): void {
      gui.controllersRecursive().forEach((c) => c.updateDisplay());
    },
  };
}
