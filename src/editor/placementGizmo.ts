// OWNER: board & themes editor (IDEA-062, dev-only).
// Lets the viewport transform gizmo drive a BOARD PLACEMENT — drag a prop
// around its tile, spin it, resize it — without ever letting the handle and
// the data disagree.
//
// WHY A PROXY, AND NOT THE PROP ITSELF
//
// The obvious thing is to attach TransformControls to the placed prop mesh.
// It is wrong here, for two independent reasons, and the second one destroys
// data silently:
//
//  1. The prop mesh does not survive an edit. Every placement change runs
//     `rebuildBoardFromWorkingTheme()`, which rebuilds the whole board group —
//     so the object the gizmo was holding is disposed mid-gesture.
//
//  2. `buildProps` (src/render/board.ts) CLAMPS the scale of "tall" props on
//     the south row and the east/west columns (SOUTH_ROW_TALL_SCALE_CAP /
//     EAST_WEST_TALL_SCALE_CAP), so a placement authored at scale 1.8 can be
//     standing there at 0.55. Read that back off the mesh on any drag — even a
//     pure ROTATE drag — and you would write 0.55 into the placement and lose
//     the 1.8 forever, with nothing on screen changing to tell you.
//
// So the gizmo drives a lightweight proxy Object3D that is positioned FROM the
// placement data, and every commit reads the proxy back INTO that data through
// the same clamps the inspector's sliders use. The proxy is then snapped to
// the clamped result, so the handle can never drift away from what was
// actually stored.
//
// WHAT A PLACEMENT CAN AND CANNOT EXPRESS
//
// `WorkingPropPlacement` is `{ propId, tile, offset:[x,z], rotationY, scale }`
// and the wall-top variant has no `offset` at all. So:
//   translate -> offset X/Z only, and NOTHING for a wall placement
//   rotate    -> rotationY only
//   scale     -> one uniform number
// main.ts's applyPlacementAxisLimits hides the axes that have nowhere to go,
// rather than letting a drag look like it worked and then discard two thirds
// of it (IDEA-041's rule: never a control wired to nothing).
import * as THREE from "three";
import { worldX, worldZ } from "../game/grid";
import {
  clampOffset,
  clampScale,
  wrapRotation,
  type PlacementSelection,
} from "./boardPlacement";

/** Wall-top components sit on the hedge crown. Matches boardPlacement.ts's own
 *  MARKER_Y_WALL, for the same reason its comment gives: WALL_H is 1, and a
 *  hair above it reads as "on the wall" rather than "inside it". */
const WALL_TOP_Y = 1.02;

export interface PlacementGizmo {
  /** The object the gizmo handle attaches to. Parented once, never removed —
   *  only moved and hidden, so nothing holds a disposed reference. */
  readonly proxy: THREE.Object3D;
  /** Point the proxy at a placement and show it. */
  attachTo(selection: PlacementSelection): void;
  /** No placement selected — park the proxy out of the way. */
  detach(): void;
  /** Read the proxy back into the placement, applying the inspector's own
   *  clamps, then snap the proxy to the stored result. Returns true if
   *  anything actually changed, so the caller can skip a no-op history entry
   *  and a no-op board rebuild. */
  commit(selection: PlacementSelection, mode: "translate" | "rotate" | "scale"): boolean;
  /** Re-read the placement into the proxy — after an undo, a keyboard nudge,
   *  or an inspector slider, so the handle follows the data rather than
   *  sitting where the last drag left it. */
  sync(selection: PlacementSelection): void;
  dispose(): void;
}

export function createPlacementGizmo(parent: THREE.Object3D): PlacementGizmo {
  const proxy = new THREE.Object3D();
  proxy.name = "editor:placementProxy";
  // picking.ts skips anything flagged editorOverlay, so this can never be
  // selected as if it were a real part.
  proxy.userData.editorOverlay = true;
  proxy.visible = false;
  parent.add(proxy);

  function sync(selection: PlacementSelection): void {
    const p = selection.existing;
    if (!p) return;
    const [tx, ty] = selection.tile;
    // An apron placement carries an in-tile offset; a wall-top one is always
    // dead-centre on its tile (themes.ts's WallDecorPlacement has no offset
    // field — that is the data model, not an omission).
    const offset = "offset" in p ? p.offset : ([0, 0] as const);
    proxy.position.set(
      worldX(tx) + offset[0],
      selection.subMode === "wall" ? WALL_TOP_Y : 0,
      worldZ(ty) + offset[1],
    );
    proxy.rotation.set(0, p.rotationY, 0);
    proxy.scale.setScalar(p.scale);
    proxy.updateMatrixWorld();
  }

  return {
    proxy,
    attachTo(selection: PlacementSelection): void {
      sync(selection);
      proxy.visible = true;
    },
    detach(): void {
      proxy.visible = false;
    },
    sync,
    commit(selection, mode): boolean {
      const p = selection.existing;
      if (!p) return false;
      const [tx, ty] = selection.tile;
      let changed = false;

      if (mode === "translate") {
        // Wall placements have no offset field, so a translate drag has
        // nothing to write. The handle is hidden for them (see main.ts), but
        // guard anyway — a hidden handle is a UI fact, not a type guarantee.
        if (!("offset" in p)) return false;
        const nx = clampOffset(proxy.position.x - worldX(tx));
        const nz = clampOffset(proxy.position.z - worldZ(ty));
        changed = nx !== p.offset[0] || nz !== p.offset[1];
        p.offset[0] = nx;
        p.offset[1] = nz;
      } else if (mode === "rotate") {
        // Y only. A gizmo can tilt about X and Z; a placement cannot store it,
        // so it is dropped here rather than silently half-applied.
        const ny = wrapRotation(proxy.rotation.y);
        changed = ny !== p.rotationY;
        p.rotationY = ny;
      } else {
        // Uniform. TransformControls' uniform handle scales all three axes
        // together, but a per-axis drag could still arrive if the handle set
        // changes — take X as the authority rather than averaging, so the
        // number matches the axis the user actually pulled.
        const ns = clampScale(proxy.scale.x);
        changed = ns !== p.scale;
        p.scale = ns;
      }

      // Snap the proxy onto the STORED value. Without this the handle keeps
      // whatever the drag left — past a clamp boundary, or with a Y offset
      // and an X/Z tilt the data never took — and the next drag would start
      // from a pose the board is not actually in.
      sync(selection);
      return changed;
    },
    dispose(): void {
      proxy.removeFromParent();
    },
  };
}
