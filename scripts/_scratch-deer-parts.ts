// SCRATCH: the deer's part tree as the Props tab addresses it — index path,
// name and material — so a question about "can I edit just the deer's eye"
// has an answer you can click rather than one you have to take on trust.
import * as THREE from "three";
import { makePropById } from "../src/render/board";

const id = process.argv[2] ?? "critter-deer";
const prop = makePropById(id, 0.17);
const filter = process.argv[3];
const walk = (o: THREE.Object3D, path: string) => {
  o.children.forEach((c, i) => {
    const p = path ? `${path}/${i}` : String(i);
    const m = c as THREE.Mesh;
    const mat = m.isMesh
      ? (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshToonMaterial
      : undefined;
    const line = `${p.padEnd(8)} ${(c.name || "(unnamed)").padEnd(18)} ${
      mat?.color ? "#" + mat.color.getHex().toString(16).padStart(6, "0") : ""
    }`;
    if (!filter || c.name.toLowerCase().includes(filter.toLowerCase())) console.log(line);
    walk(c, p);
  });
};
console.log(`${id}:`);
walk(prop, "");
