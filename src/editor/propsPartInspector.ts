// OWNER: props part editor (IDEA-033, dev-only).
// The lil-gui PER-PART folder for a selected component inside a prop's live
// preview — transform (position/rotation/scale), visibility, material
// (color + emissive-if-applicable), geometry params for an editor-added
// primitive, and Delete. Mirrors src/editor/inspector.ts's
// buildSelectionFolder idiom closely (same three sub-folders, same
// committed-value gesture tracking so undo gets ONE entry per finished drag,
// not per drag tick) but is its OWN module rather than a reuse of
// createInspector: that function is wired to CHARACTER-only globals
// (character/skin/enemy-color dropdowns, idle animation, turntable) this tab
// has no use for — Props mode already offers its own base-shape controls via
// propsInspector.ts's "Selected: <name>" folder, and this module supplies
// only the NEW per-part folder that sits alongside it (see main.ts's Props-
// mode wiring for how the two folders coexist in #propsGuiHost).
import GUI from "lil-gui";
import * as THREE from "three";
import { type PartNode } from "./partTree";
import { PropPartEditLog, type Vec3Tuple, type LiveAddedPropPart } from "./propPartEditLog";
import { buildPropPartPrimitiveGeometry } from "./propsPartCodegen";
import { type PropPrimKind } from "../game/props";

const POS_RANGE = 1.5; // props are apron/wall-top scale — a touch tighter than the character's ±2.5
const SCALE_MAX = 3;

export type PropTransformChannel = "position" | "rotation" | "scale";

export interface PropMaterialSnapshot {
  color: number;
  emissive?: number;
}

export interface PropSelectionContext {
  log: PropPartEditLog;
  addedRecord: LiveAddedPropPart | undefined;
  /** Called after every edit so the caller can refresh any dependent UI
   *  (Props mode has no bottom code panel to update, unlike character mode —
   *  see main.ts's note — so today this only exists for symmetry/future use,
   *  but keeping the shape identical to inspector.ts's SelectionContext
   *  means the two inspectors stay trivially comparable side by side). */
  onEdit(): void;
  onGeometryRebuilt(node: PartNode): void;
  onDelete(node: PartNode): void;
  onTransformCommitted(node: PartNode, channel: PropTransformChannel, before: Vec3Tuple, after: Vec3Tuple): void;
  onVisibleCommitted(node: PartNode, before: boolean, after: boolean): void;
  onMaterialCommitted(node: PartNode, channel: "color" | "emissive", before: number, after: number): void;
  onParamCommitted(record: LiveAddedPropPart, key: string, before: number, after: number): void;
}

export interface PropsPartInspectorCallbacks {
  /** "add to selected part ➕" clicked — same shape as
   *  inspector.ts's InspectorCallbacks.onAddPart. */
  onAddPart(kind: PropPrimKind, name: string): void;
}

export interface PropsPartInspector {
  setSelection(node: PartNode | null, ctx: PropSelectionContext | null): void;
  refreshDisplays(): void;
  destroy(): void;
}

/** Total REAL descendants under `object` — same "warn before an unconfirmed
 *  group-delete" purpose as inspector.ts's countDescendants, ported
 *  verbatim (the editorOverlay filter matters here too: the highlight
 *  wireframe/BoxHelper this tab's own highlighter.ts attaches must not
 *  inflate the count). */
function countDescendants(object: THREE.Object3D): number {
  let count = 0;
  object.traverse((o) => {
    if (o !== object && !o.userData.editorOverlay) count++;
  });
  return count;
}

/** Builds the per-part folder into `host` (a plain container GUI — see
 *  main.ts, which creates one small dedicated lil-gui panel for this so it
 *  can sit BELOW propsInspector.ts's existing "Selected: <name>" base-shape
 *  folder without either module needing to know about the other's GUI
 *  instance). Returns a controller object the caller drives per selection
 *  change, mirroring createInspector's own return shape. */
export function createPropsPartInspector(container: HTMLElement, cb: PropsPartInspectorCallbacks): PropsPartInspector {
  const gui = new GUI({ container, title: "Selected Part" });

  // "Add part": a PERSISTENT folder (built once, never destroyed per
  // selection) — same placement as inspector.ts's own "Add part" folder,
  // just scoped to the 4 prop-relevant primitive kinds (see
  // src/game/props.ts's PropPrimKind doc comment on why "capsule" is
  // dropped here). Adds to whatever component is currently selected (or the
  // prop's own root if nothing is) — main.ts's addPropPart resolves that.
  const addFolder = gui.addFolder("Add part");
  const addState = { kind: "box" as PropPrimKind, name: "" };
  addFolder.add(addState, "kind", ["box", "sphere", "cylinder", "cone"]);
  addFolder.add(addState, "name");
  addFolder
    .add({ add: () => cb.onAddPart(addState.kind, addState.name) }, "add")
    .name("add to selected part ➕");

  let folder: GUI | null = null;

  function build(node: PartNode, ctx: PropSelectionContext): void {
    folder = gui.addFolder(`Part: ${node.displayName}`);
    const f = folder;
    const o = node.object;

    const readChannel = (channel: PropTransformChannel): Vec3Tuple =>
      channel === "rotation"
        ? [o.rotation.x, o.rotation.y, o.rotation.z]
        : [o[channel].x, o[channel].y, o[channel].z];
    const same = (a: Vec3Tuple, b: Vec3Tuple): boolean =>
      Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6 && Math.abs(a[2] - b[2]) < 1e-6;

    const committed: Record<PropTransformChannel, Vec3Tuple> = {
      position: readChannel("position"),
      rotation: readChannel("rotation"),
      scale: readChannel("scale"),
    };
    let committedVisible = o.visible;

    const touched = (channel: PropTransformChannel) => (): void => {
      ctx.log.touchTransform(node, channel);
      ctx.onEdit();
    };
    const commit = (channel: PropTransformChannel) => (): void => {
      const after = readChannel(channel);
      if (!same(committed[channel], after)) {
        ctx.onTransformCommitted(node, channel, committed[channel], after);
        committed[channel] = after;
      }
    };

    const pos = f.addFolder("position");
    const rot = f.addFolder("rotation");
    const scl = f.addFolder("scale");
    for (const axis of ["x", "y", "z"] as const) {
      pos
        .add(o.position, axis, -POS_RANGE, POS_RANGE, 0.005)
        .onChange(touched("position"))
        .onFinishChange(commit("position"));
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

    // The visible checkbox IS "delete this base part" (see props.ts's
    // PropPartEdit.visible doc comment) — but only for a BASE part. An
    // ADDED part has its own dedicated "delete part 🗑" button below
    // instead (propPartLog.touchVisible already no-ops for an added part's
    // object — see its own userData.editorAdded guard — so showing this
    // checkbox for one would silently do nothing while still claiming
    // "delete" in its label, which is worse than just omitting it).
    if (!ctx.addedRecord) {
      f.add(o, "visible")
        .name("visible (unchecked = delete this base part)")
        .onChange(() => {
          ctx.log.touchVisible(node);
          ctx.onEdit();
          ctx.onVisibleCommitted(node, committedVisible, o.visible);
          committedVisible = o.visible;
        });
    }

    // Material — every prop part owns its OWN material (board.ts never
    // shares one across parts — see propPartEditLog.ts's header), so there
    // is no "shared by N parts" note to show here, unlike inspector.ts's
    // character-mode material folder.
    if (o instanceof THREE.Mesh) {
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      if (mat instanceof THREE.MeshStandardMaterial) {
        const matFolder = f.addFolder("material");
        let committedMat: PropMaterialSnapshot = {
          color: mat.color.getHex(),
          emissive: mat.emissiveIntensity > 0 ? mat.emissive.getHex() : undefined,
        };
        const colorProxy = { color: `#${mat.color.getHexString()}` };
        matFolder
          .addColor(colorProxy, "color")
          .onChange((value: string) => {
            mat.color.set(value);
            ctx.log.touchMaterial(node, "color", mat.color.getHex());
            ctx.onEdit();
          })
          .onFinishChange(() => {
            const after = mat.color.getHex();
            if (after !== committedMat.color) {
              ctx.onMaterialCommitted(node, "color", committedMat.color, after);
              committedMat = { ...committedMat, color: after };
            }
          });

        // Emissive swatch ONLY when this part was already lit at baseline
        // (see propPartEditLog.ts's hasEmissiveBaseline doc comment) — a
        // plain facade/trunk/lobe never gains a glow control here; that
        // would be a different, more surprising feature ("make anything
        // glow") the brief didn't ask for.
        if (mat.emissiveIntensity > 0) {
          const emissiveProxy = { color: `#${mat.emissive.getHexString()}` };
          matFolder
            .addColor(emissiveProxy, "color")
            .name("emissive")
            .onChange((value: string) => {
              mat.emissive.set(value);
              ctx.log.touchMaterial(node, "emissive", mat.emissive.getHex());
              ctx.onEdit();
            })
            .onFinishChange(() => {
              const after = mat.emissive.getHex();
              if (after !== committedMat.emissive) {
                ctx.onMaterialCommitted(node, "emissive", committedMat.emissive ?? after, after);
                committedMat = { ...committedMat, emissive: after };
              }
            });
        }
      }
    }

    // Editor-added parts get live geometry params, same idiom as
    // inspector.ts's own "geometry" folder for character-added parts.
    const added = ctx.addedRecord;
    if (added) {
      const geo = f.addFolder("geometry");
      for (const key of Object.keys(added.params)) {
        let committedParam = added.params[key];
        geo
          .add(added.params, key, 0.01, 1.5, 0.005)
          .onChange(() => {
            added.object.geometry.dispose(); // solely owned by the added part
            added.object.geometry = buildPropPartPrimitiveGeometry(added.kind, added.params);
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

    // Delete: any part except the prop's own root (path === "") — a base
    // part becomes hidden+omitted (props.ts's PropPartEdit.visible=false —
    // "delete" for a part the factory always rebuilds), an added part is
    // truly removed from the scene. Same confirm-free "+N inside" warning
    // label as inspector.ts's own delete button.
    if (node.path !== "") {
      const subtreeCount = countDescendants(o);
      const label = subtreeCount > 0 ? `delete part + ${subtreeCount} inside 🗑` : "delete part 🗑";
      f.add({ del: () => ctx.onDelete(node) }, "del").name(label);
    }
  }

  return {
    setSelection(node: PartNode | null, ctx: PropSelectionContext | null): void {
      folder?.destroy();
      folder = null;
      if (node && ctx) build(node, ctx);
    },
    refreshDisplays(): void {
      gui.controllersRecursive().forEach((c) => c.updateDisplay());
    },
    destroy(): void {
      gui.destroy();
    },
  };
}

export type { PropPrimKind };
