// OWNER: character editor (IDEA-025, dev-only).
// Click-to-select in the viewport: raycast from the pointer into the current
// character and resolve the hit mesh to its PartNode (same select() path as a
// tree click). A small movement threshold distinguishes a click from an
// (accidental) drag. Editor overlay objects are skipped.
import * as THREE from "three";
import { type PartNode } from "./partTree";

const CLICK_SLOP_PX = 5;

export function attachPicking(
  canvas: HTMLCanvasElement,
  camera: THREE.PerspectiveCamera,
  getRoot: () => THREE.Object3D | null,
  getNodeFor: (object: THREE.Object3D) => PartNode | undefined,
  onPick: (node: PartNode) => void,
): () => void {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let downX = 0;
  let downY = 0;

  function onPointerDown(e: PointerEvent): void {
    downX = e.clientX;
    downY = e.clientY;
  }

  function onPointerUp(e: PointerEvent): void {
    if (Math.abs(e.clientX - downX) > CLICK_SLOP_PX || Math.abs(e.clientY - downY) > CLICK_SLOP_PX)
      return;
    const root = getRoot();
    if (!root) return;

    const rect = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    for (const hit of raycaster.intersectObject(root, true)) {
      if (hit.object.userData.editorOverlay) continue;
      // Walk up until we find an object the part tree knows (in practice the
      // hit mesh itself; the walk covers any future non-tree helper children).
      let o: THREE.Object3D | null = hit.object;
      while (o) {
        const node = getNodeFor(o);
        if (node) {
          onPick(node);
          return;
        }
        o = o.parent;
      }
    }
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointerup", onPointerUp);
  return () => {
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointerup", onPointerUp);
  };
}
