// OWNER: render-artist
// Beagle + ghost meshes built from primitives (grouped). Later can be swapped
// for glTF models (see PROJECT_PLAN M6). Reference: prototype makeBeagle/makeGhost.
// Contract: makeBeagle(): THREE.Group ; makeGhost(colorHex): THREE.Group with
// userData { bodyMat, eyes, pups, pupM, baseColor } for state-driven recolouring.
import * as THREE from "three";

export function makeBeagle(): THREE.Group {
  throw new Error("makeBeagle not implemented — see /prototype");
}
export function makeGhost(_color: number): THREE.Group {
  throw new Error("makeGhost not implemented — see /prototype");
}
