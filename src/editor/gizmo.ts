// OWNER: character editor (IDEA-025, dev-only).
// Direct manipulation in the viewport: a TransformControls gizmo on the
// selected part, committing exactly ONE undo entry per drag.
//
// Adapted in spirit (not verbatim) from the three.js editor's Viewport.js
// (MIT) — mrdoob/three.js. The event contract below is theirs; the commit
// path is ours, because our persistence model is codegen into real source
// (see editLog.ts), not a scene serialisation.
//
// Two things here are deliberately NOT the reference editor's design:
//
//  1. There is no separate `sceneHelpers` scene. The reference keeps one so
//     helper geometry can be lit independently and raycast separately; we
//     need neither — picking.ts raycasts the CHARACTER GROUP only, so a
//     helper parented to the stage scene is already unpickable by
//     construction, and TransformControls' own gizmo materials are unlit.
//
//  2. The gizmo reports drags through `onCommit(channel, before, after)`
//     rather than pushing a Command object. main.ts already owns
//     pushTransformHistory() — the same function the inspector's number
//     fields commit through — so routing the gizmo into it means a dragged
//     part and a typed coordinate produce the SAME history entry, the same
//     EditLog touch, and therefore the same generated code. A parallel
//     command path would have been a second way to say the one thing.
import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export const GIZMO_MODES = ["translate", "rotate", "scale"] as const;
export type GizmoMode = (typeof GIZMO_MODES)[number];

/** Which transform channel a mode writes — matches main.ts's TransformChannel
 *  and applyChannel(), so a gizmo drag and a typed field are indistinguishable
 *  to the history/codegen layers below. */
const CHANNEL: Record<GizmoMode, "position" | "rotation" | "scale"> = {
  translate: "position",
  rotate: "rotation",
  scale: "scale",
};

export type Vec3Tuple = [number, number, number];

/** Below this, a "drag" was a click that grazed an axis — committing it would
 *  put a no-op entry on the undo stack. Deliberately FAR smaller than the
 *  reference editor's 0.01 (see the parity spec's §9.5): our characters are
 *  authored in tile units where a real ear tweak is ~0.005, and 0.01 would
 *  silently discard genuine edits. This only has to beat float noise. */
const COMMIT_EPS = 1e-5;

/** Snap increments — same feel as the arrow-key nudge steps in main.ts. */
const SNAP_TRANSLATE = 0.01;
const SNAP_ROTATE = THREE.MathUtils.degToRad(5);
const SNAP_SCALE = 0.05;

/** What one object did over a drag — the pair a history entry needs. */
export interface GizmoChange {
  object: THREE.Object3D;
  before: Vec3Tuple;
  after: Vec3Tuple;
}

export interface GizmoOptions {
  camera: THREE.Camera;
  canvas: HTMLCanvasElement;
  /** Where the gizmo helper is parented. */
  scene: THREE.Scene;
  /** Disabled for the duration of a drag so orbiting can't fight the gizmo. */
  orbit: OrbitControls;
  /**
   * One call per completed drag, carrying EVERY object that moved.
   *
   * With a single selection that is one entry. With a multi-selection it is
   * one per selected part, and main.ts folds them into ONE history entry —
   * the reference editor's MultiCmdsCommand, minus the class.
   */
  onCommit(channel: "position" | "rotation" | "scale", changes: GizmoChange[]): void;
  /** Every drag frame — live inspector/code-panel feedback. */
  onDrag(): void;
  /** Mode changed (from a shortcut key) so the toolbar can re-sync. */
  onModeChange(mode: GizmoMode): void;
}

export interface Gizmo {
  /**
   * The objects the gizmo drives. The FIRST is the primary: the handle sits
   * on it, and whatever it does is mirrored onto the rest. An empty array
   * detaches.
   */
  attach(objects: THREE.Object3D[]): void;
  setMode(mode: GizmoMode): void;
  getMode(): GizmoMode;
  /** Master switch — off hides the gizmo without forgetting the selection. */
  setEnabled(on: boolean): void;
  isEnabled(): boolean;
  setSpace(space: "local" | "world"): void;
  setSnap(on: boolean): void;
  /** True while a drag is in flight OR the pointer is over an axis handle.
   *  picking.ts consults this so releasing the gizmo never re-picks the part
   *  behind it — the reference editor has no equivalent guard and suffers
   *  exactly that. */
  isBlocking(): boolean;
  dispose(): void;
}

function tupleOf(v: THREE.Vector3 | THREE.Euler): Vec3Tuple {
  return [v.x, v.y, v.z];
}

function changed(a: Vec3Tuple, b: Vec3Tuple): boolean {
  return (
    Math.abs(a[0] - b[0]) > COMMIT_EPS ||
    Math.abs(a[1] - b[1]) > COMMIT_EPS ||
    Math.abs(a[2] - b[2]) > COMMIT_EPS
  );
}

export function createGizmo(opts: GizmoOptions): Gizmo {
  // r169: the canvas goes to the CONSTRUCTOR. `connect()` takes no argument
  // at this revision (it does at r185) — verified against
  // node_modules/three/examples/jsm/controls/TransformControls.js.
  const controls = new TransformControls(opts.camera, opts.canvas);
  const helper = controls.getHelper();
  helper.userData.editorOverlay = true; // picking.ts skips these
  opts.scene.add(helper);

  /** Primary first; the rest follow it. */
  let targets: THREE.Object3D[] = [];
  let enabled = true;
  let dragging = false;
  let snapOn = false;

  /** The pose of every target at mouseDown — the "before" half of the entry,
   *  and the baseline the follower deltas are measured from. */
  interface Pose {
    position: Vec3Tuple;
    rotation: Vec3Tuple;
    scale: Vec3Tuple;
  }
  let poseDown: Pose[] = [];

  function poseOf(o: THREE.Object3D): Pose {
    return { position: tupleOf(o.position), rotation: tupleOf(o.rotation), scale: tupleOf(o.scale) };
  }

  function primary(): THREE.Object3D | null {
    return targets[0] ?? null;
  }

  function syncVisible(): void {
    const on = enabled && targets.length > 0;
    helper.visible = on;
    controls.enabled = on;
  }

  function onMouseDown(): void {
    if (targets.length === 0) return;
    dragging = true;
    poseDown = targets.map(poseOf);
    opts.orbit.enabled = false;
  }

  /**
   * Mirrors the primary's movement onto the rest of the selection.
   *
   * Translation and rotation are applied as a DELTA and scale as a RATIO,
   * each relative to that object's own pose at mouseDown — so dragging with
   * both ears selected moves each ear by the same amount from where it was,
   * rather than collapsing them onto one another (which is what setting them
   * to the primary's absolute value would do).
   *
   * Rotation mirrors the EULER delta rather than composing quaternions. For
   * sibling parts on a character rig that is what "rotate both ears by 10°"
   * is expected to mean; a true quaternion delta would also swing each
   * follower's axes around the primary's, which reads as a bug when you are
   * just tilting a matched pair.
   */
  function mirrorToFollowers(): void {
    const lead = primary();
    if (!lead || targets.length < 2 || poseDown.length !== targets.length) return;
    const leadDown = poseDown[0];
    const mode = controls.getMode() as GizmoMode;
    for (let i = 1; i < targets.length; i++) {
      const obj = targets[i];
      const down = poseDown[i];
      if (mode === "translate") {
        obj.position.set(
          down.position[0] + (lead.position.x - leadDown.position[0]),
          down.position[1] + (lead.position.y - leadDown.position[1]),
          down.position[2] + (lead.position.z - leadDown.position[2]),
        );
      } else if (mode === "rotate") {
        obj.rotation.set(
          down.rotation[0] + (lead.rotation.x - leadDown.rotation[0]),
          down.rotation[1] + (lead.rotation.y - leadDown.rotation[1]),
          down.rotation[2] + (lead.rotation.z - leadDown.rotation[2]),
        );
      } else {
        // Ratio, not delta: scaling a big part and a small one by "+0.2"
        // deforms them differently, by "×1.2" it does not. Guard the
        // degenerate baseline — a part authored at scale 0 has no ratio.
        const rx = leadDown.scale[0] === 0 ? 1 : lead.scale.x / leadDown.scale[0];
        const ry = leadDown.scale[1] === 0 ? 1 : lead.scale.y / leadDown.scale[1];
        const rz = leadDown.scale[2] === 0 ? 1 : lead.scale.z / leadDown.scale[2];
        obj.scale.set(down.scale[0] * rx, down.scale[1] * ry, down.scale[2] * rz);
      }
    }
  }

  function onMouseUp(): void {
    opts.orbit.enabled = true;
    if (targets.length === 0 || !dragging) {
      dragging = false;
      return;
    }
    dragging = false;
    const mode = controls.getMode() as GizmoMode;
    const key = CHANNEL[mode];
    // Only the channel this mode drives can have moved — checking just that
    // one keeps a rotate drag from also pushing a position entry when a
    // float wobbled in the last bit.
    const changes: GizmoChange[] = [];
    targets.forEach((object, i) => {
      const before = poseDown[i]?.[key];
      if (!before) return;
      const after = tupleOf(
        key === "position" ? object.position : key === "rotation" ? object.rotation : object.scale,
      );
      if (changed(before, after)) changes.push({ object, before, after });
    });
    if (changes.length > 0) opts.onCommit(key, changes);
  }

  function onObjectChange(): void {
    mirrorToFollowers();
    opts.onDrag();
  }

  controls.addEventListener("mouseDown", onMouseDown);
  controls.addEventListener("mouseUp", onMouseUp);
  controls.addEventListener("objectChange", onObjectChange);

  function applySnap(): void {
    controls.setTranslationSnap(snapOn ? SNAP_TRANSLATE : null);
    controls.setRotationSnap(snapOn ? SNAP_ROTATE : null);
    controls.setScaleSnap(snapOn ? SNAP_SCALE : null);
  }

  syncVisible();

  return {
    attach(objects: THREE.Object3D[]): void {
      targets = objects;
      const lead = primary();
      if (lead) controls.attach(lead);
      else controls.detach();
      syncVisible();
    },
    setMode(mode: GizmoMode): void {
      controls.setMode(mode);
      opts.onModeChange(mode);
    },
    getMode(): GizmoMode {
      return controls.getMode() as GizmoMode;
    },
    setEnabled(on: boolean): void {
      enabled = on;
      syncVisible();
    },
    isEnabled(): boolean {
      return enabled;
    },
    setSpace(space: "local" | "world"): void {
      controls.setSpace(space);
    },
    setSnap(on: boolean): void {
      snapOn = on;
      applySnap();
    },
    isBlocking(): boolean {
      return dragging || (enabled && targets.length > 0 && controls.axis !== null);
    },
    dispose(): void {
      controls.removeEventListener("mouseDown", onMouseDown);
      controls.removeEventListener("mouseUp", onMouseUp);
      controls.removeEventListener("objectChange", onObjectChange);
      controls.detach();
      helper.removeFromParent();
      controls.dispose();
    },
  };
}
