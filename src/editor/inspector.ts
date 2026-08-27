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
import { CHARACTERS, BEAGLE_MODES, ENEMY_MODES, type EnemyColorKey, type AnimMode } from "./registry";
import { runtimeOwnerFor, shortNote, type Channel } from "./runtimeOwned";
import {
  isEditableMaterial,
  reshade,
  roughnessOf,
  SHADING_KINDS,
  shadingKindOf,
  type ShadingKind,
} from "../render/toon";

export interface EditorState {
  characterId: string;
  beagleSkinId: string;
  enemyColor: EnemyColorKey;
  turntable: boolean;
  /** Which animation the viewport is playing — see registry.ts's AnimMode. */
  animation: AnimMode;
  grid: boolean;
  highlight: boolean;
}

export interface InspectorCallbacks {
  onCharacter(id: string): void;
  onSkin(id: string): void;
  onEnemyColor(key: EnemyColorKey): void;
  onTurntable(on: boolean): void;
  onAnimation(mode: AnimMode): void;
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
  /** The builder this character comes from ("makeBeagle", "makeGhost", …) —
   *  IDEA-041 uses it to look up which channels the runtime owns. */
  builderName: string;
  /** Resolves a mesh's material to its friendly-name info (shared-awareness). */
  materialFor(mesh: THREE.Mesh): MaterialInfo | undefined;
  /** The added-part record when the selection was created in the editor. */
  addedRecord: AddedPartRecord | undefined;
  /** Called after every edit so the code panel refreshes. */
  onEdit(): void;
  /** A part's material was REPLACED (shading model switched), so the editor's
   *  uuid-keyed material registry has to be rebuilt — it would otherwise still
   *  point at the disposed one and the material panel would vanish. */
  onMaterialReplaced(): void;
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
  /** Reflects the dropdown when main auto-pauses on selection. */
  setAnimation(mode: AnimMode): void;
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
  // Animation preview. Enemies get the two state looks as well, so a
  // frightened or eaten enemy can be inspected without playing a whole game.
  let animCtrl = gui
    .add(state, "animation", [...BEAGLE_MODES])
    .name("animation")
    .onChange((m: AnimMode) => cb.onAnimation(m));
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

    const visibleCtrl = folder.add(o, "visible").onChange(() => {
      ctx.log.touchVisible(node);
      ctx.onEdit();
      ctx.onVisibleCommitted(node, committedVisible, o.visible);
      committedVisible = o.visible;
    });

    // IDEA-041: a control the RUNTIME overwrites is disabled and labelled with
    // what drives it. Previously these accepted an edit, saved it correctly,
    // and were overwritten on the next frame — which read as "saving is
    // broken". The label doubles as the three.js lesson the editor exists to
    // teach: this value is animated, so it belongs in the animation, not here.
    const markRuntimeOwned = (
      target: { title(t: string): unknown; domElement: HTMLElement; controllers?: unknown[] },
      channel: Channel,
      label: string,
    ): void => {
      const owned = runtimeOwnerFor(ctx.builderName, node.varName, channel);
      if (!owned) return;
      target.title(`${label} 🔒 ${shortNote(owned)}`);
      target.domElement.classList.add("runtime-owned");
      target.domElement.title = owned.owner
        ? `${owned.reason}\n\nChange it in: ${owned.owner}`
        : owned.reason;
      for (const c of (target.controllers ?? []) as Array<{ disable(): void }>) c.disable();
    };

    markRuntimeOwned(pos, "position", "position");
    markRuntimeOwned(rot, "rotation", "rotation");
    markRuntimeOwned(scl, "scale", "scale");

    const ownedVisible = runtimeOwnerFor(ctx.builderName, node.varName, "visible");
    if (ownedVisible) {
      visibleCtrl.name(`visible 🔒 ${shortNote(ownedVisible)}`).disable();
      visibleCtrl.domElement.title = ownedVisible.reason;
      visibleCtrl.domElement.classList.add("runtime-owned");
    }

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
          roughness: roughnessOf(info.material) ?? 0,
        };
        const commitMat = (): void => {
          const after: MaterialSnapshot = {
            color: info.material.color.getHex(),
            roughness: roughnessOf(info.material) ?? 0,
          };
          if (after.color !== committedMat.color || Math.abs(after.roughness - committedMat.roughness) > 1e-6) {
            ctx.onMaterialCommitted(info, committedMat, after);
            committedMat = after;
          }
        };
        const proxy = { color: `#${info.material.color.getHexString()}` };
        const colorCtrl = matFolder
          .addColor(proxy, "color")
          .onChange((value: string) => {
            info.material.color.set(value);
            ctx.log.touchMaterial(info);
            ctx.onEdit();
          })
          .onFinishChange(commitMat);

        // IDEA-041: the beagle's coat colours belong to the equipped SKIN and
        // the enemies' to their state/base colour — both reset at runtime, so
        // colouring here could never stick. The control stays LIVE (previewing
        // a colour is genuinely useful) but says where the value really lives,
        // and the save path refuses it with the same explanation.
        const ownedColor = runtimeOwnerFor(ctx.builderName, info.varName, "color");
        if (ownedColor) {
          colorCtrl.name(`color 🔒 preview only`);
          colorCtrl.domElement.classList.add("runtime-owned");
          colorCtrl.domElement.title = ownedColor.owner
            ? `${ownedColor.reason}\n\nChange it in: ${ownedColor.owner}`
            : ownedColor.reason;
        }
        // SHADING MODEL — audition the same form under a different lighting
        // model. The game ships toon; seeing a part as standard/phong/lambert/
        // basic is the quickest way to understand what the shading is doing to
        // the geometry, which is what this workbench is for.
        //
        // It swaps by material IDENTITY, so a shared material (one `tan` for
        // the whole coat) changes everywhere at once — the same scope a colour
        // edit already has, and the folder title already says how many parts
        // that is.
        //
        // Preview only, and labelled so: the shading model is a scene-wide art
        // direction choice (src/render/toon.ts), not a per-part property, so
        // there is nowhere in the builder for Save to write it. Saying that on
        // the control is the IDEA-041 rule — never a control wired to nothing.
        const shadingProxy = { shading: shadingKindOf(info.material) as string };
        matFolder
          .add(shadingProxy, "shading", [...SHADING_KINDS])
          .name("shading 🔒 preview only")
          .onChange((kind: string) => {
            let root: THREE.Object3D = o;
            while (root.parent) root = root.parent;
            info.material = reshade(root, info.material, kind as ShadingKind) as typeof info.material;
            ctx.onMaterialReplaced();
            ctx.onEdit();
            // Rebuild: which controls belong here depends on the model that is
            // now selected (a toon material has no roughness), so the folder
            // has to be re-derived rather than left showing the old one's.
            //
            // DEFERRED to a task, not done inline: this runs from the
            // dropdown's own onChange, and tearing down the folder that owns
            // the controller currently dispatching leaves lil-gui mid-event
            // with a detached element — the next change then finds no dropdown
            // at all. Letting the event finish first fixes it.
            setTimeout(() => {
              selectionFolder?.destroy();
              selectionFolder = null;
              buildSelectionFolder(node, ctx);
            }, 0);
          })
          .domElement.classList.add("runtime-owned");

        // Roughness only exists on the PBR materials. A cel-shaded surface has
        // no such channel, so the control is omitted rather than shown wired to
        // nothing — which is exactly the class of dead control IDEA-041 is
        // about.
        if (isEditableMaterial(info.material) && roughnessOf(info.material) !== null) {
          matFolder
            .add(info.material as THREE.MeshStandardMaterial, "roughness", 0, 1, 0.01)
            .onChange(() => {
              ctx.log.touchMaterial(info);
              ctx.onEdit();
            })
            .onFinishChange(commitMat);
        }
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
    setAnimation(mode: AnimMode): void {
      state.animation = mode;
      animCtrl.updateDisplay();
    },
    setCharacterMode(isBeagle: boolean): void {
      if (isBeagle) {
        skinCtrl.show();
        colorCtrl.hide();
      } else {
        skinCtrl.hide();
        colorCtrl.show();
      }
      // Only enemies have frightened/eaten looks, so the dropdown offers them
      // only there. lil-gui's .options() DESTROYS the controller and returns a
      // fresh one, so the handler has to be re-attached and the reference kept
      // — otherwise setAnimation() below would be updating a dead widget.
      const modes = isBeagle ? BEAGLE_MODES : ENEMY_MODES;
      if (!modes.includes(state.animation)) state.animation = "idle";
      animCtrl = animCtrl
        .options([...modes])
        .name("animation")
        .onChange((m: AnimMode) => cb.onAnimation(m));
      animCtrl.setValue(state.animation);
    },
    refreshDisplays(): void {
      gui.controllersRecursive().forEach((c) => c.updateDisplay());
    },
  };
}
