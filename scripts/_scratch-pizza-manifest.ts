// Scratch: dump the pizza mascot's built part tree as an img2threejs parts
// manifest, so check_part_coverage.py can compare what was SPECIFIED against
// what was BUILT. Every other gate scores pixels; this one scores the tree,
// because a component that was specified and then quietly never built leaves
// no trace in a render taken from the reference angle.
import * as THREE from "three";
import { writeFileSync, mkdirSync } from "node:fs";
import { makeEnemy } from "../src/render/characters";

const g = makeEnemy("pizza", 0xe8615f);
g.name = "root";

interface Part {
  id: string;
  name: string;
  type: "mesh" | "group";
  parent: string;
}
const parts: Part[] = [];
g.traverse((o) => {
  if (o === g || !o.name) return;
  let p: THREE.Object3D | null = o.parent;
  while (p && !p.name) p = p.parent;
  parts.push({
    id: o.name,
    name: o.name,
    type: o instanceof THREE.Mesh ? "mesh" : "group",
    parent: p?.name ?? "root",
  });
});

mkdirSync(".img2threejs/pizza", { recursive: true });
writeFileSync(".img2threejs/pizza/parts.json", JSON.stringify({ parts }, null, 1));
console.log(`wrote ${parts.length} parts`);
