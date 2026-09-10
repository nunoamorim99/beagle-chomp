// Scratch: measure the burger's NAMED PARTS.
//
// IDEA-054/056/057's lesson, third time: when the ENVELOPE is wrong you need
// to know WHICH PART is doing it, and the render will not tell you — a model
// that is 0.13 too wide looks exactly like a model that is not. Prints every
// mesh's world AABB sorted by how far it reaches on the axis you ask about.
//
//   npx tsx scripts/_scratch-burger-probe.ts [x|y|z] [skin]
import * as THREE from "three";
import { makeEnemy } from "../src/render/characters";

const axis = (process.argv[2] ?? "x") as "x" | "y" | "z";
const skin = process.argv[3] ?? "burger";

const g = makeEnemy(skin, 0xe8615f);
g.updateMatrixWorld(true);

type Row = { name: string; reach: number; min: number; max: number; box: THREE.Box3 };
const rows: Row[] = [];
g.traverse((o) => {
  if (!(o instanceof THREE.Mesh)) return;
  const b = new THREE.Box3().setFromObject(o);
  rows.push({
    name: o.name || "(unnamed)",
    reach: Math.max(Math.abs(b.min[axis]), Math.abs(b.max[axis])),
    min: b.min[axis],
    max: b.max[axis],
    box: b,
  });
});
rows.sort((a, b) => b.reach - a.reach);

const whole = new THREE.Box3().setFromObject(g);
const s = whole.getSize(new THREE.Vector3());
console.log(
  `${skin}: w ${s.x.toFixed(3)}  h ${s.y.toFixed(3)}  l ${s.z.toFixed(3)}` +
    `  floor ${whole.min.y.toFixed(3)}  crown ${whole.max.y.toFixed(3)}`,
);
console.log(`\ntop 18 parts by |${axis}| reach:`);
for (const r of rows.slice(0, 18)) {
  console.log(
    `  ${r.name.padEnd(16)} ${axis} ${r.min.toFixed(3)}..${r.max.toFixed(3)}` +
      `   reach ${r.reach.toFixed(3)}   y ${r.box.min.y.toFixed(3)}..${r.box.max.y.toFixed(3)}`,
  );
}
