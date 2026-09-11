// Scratch: dumps the SHIPPED flea's part tree as an img2threejs parts manifest,
// so the part-coverage gate measures the real mesh rather than the generated one.
import * as THREE from "three";
import { writeFileSync } from "node:fs";
import { makeEnemy } from "../src/render/characters";

const g = makeEnemy("flea", 0xe8615f);
const parts: Array<{ name: string; kind: string; module: string; triangles: number }> = [];
let unnamed = 0;

g.traverse((o) => {
  if (o === g) return;
  const name = o.name;
  if (!name) {
    if (o instanceof THREE.Mesh) unnamed++;
    return;
  }
  let tris = 0;
  if (o instanceof THREE.Mesh) {
    const geo = o.geometry;
    tris = Math.round(geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3);
  }
  parts.push({
    name,
    kind: o instanceof THREE.Mesh ? "part" : "pivot",
    module: name,
    triangles: tris,
  });
});

writeFileSync(
  ".img2threejs/flea/parts.json",
  JSON.stringify({ model: "cartoon-flea", source: "src/render/characters.ts makeFlea()", parts, unnamedMeshes: unnamed }, null, 1),
);
console.log(`parts ${parts.length}  unnamed meshes ${unnamed}`);
