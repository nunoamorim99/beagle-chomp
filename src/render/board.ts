// OWNER: render-artist
// Builds maze meshes for a level: instanced walls, floor, biscuits, bones, fruit.
// Reference: /prototype/beagle-chomp.html (buildBoard, makeBone, makeFruit).
// Contract: buildBoard(scene, grid) -> { pelletMeshes: Map<string, {...}>, ... }
// Keep walls as a single InstancedMesh (performance requirement).
import * as THREE from "three";
import { Grid } from "../game/grid";

export function buildBoard(_scene: THREE.Object3D, _grid: Grid) {
  // TODO(render-artist)
  throw new Error("buildBoard not implemented — see /prototype and ARCHITECTURE.md");
}
