// SCRATCH: triangles and meshes per critter, and what the tail costs of it.
import * as THREE from "three";
import { makePropById } from "../src/render/board";
for (const id of ["critter-deer","critter-fox","critter-rabbit","critter-raccoon","critter-squirrel","critter-squirrel-explorer"]) {
  const p = makePropById(id, 0.29);
  let tris = 0, meshes = 0, tail = 0;
  p.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    meshes++;
    const n = (m.geometry.getIndex()?.count ?? m.geometry.getAttribute("position").count) / 3;
    tris += n;
    if (m.name === "tail") tail = n;
  });
  console.log(`${id.padEnd(26)} ${String(tris).padStart(6)} tris  ${String(meshes).padStart(3)} meshes   tail ${tail} (${((tail / tris) * 100).toFixed(0)}%)`);
}
