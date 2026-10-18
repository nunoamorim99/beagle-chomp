// SCRATCH (IDEA-065 v30): where can the squirrel's tail GO?
//
// The plume is being reshaped into an S whose tip curls forward over the
// back, so the question is what it would curl INTO. Measured on the prop AS
// IT SHIPS, in the body's own frame — `makeForestCritter` gives every
// instance a random yaw, so world x/z means nothing here (the deer's leg
// check, v8).
import * as THREE from "three";
import { makePropById } from "../src/render/board";

const sq = makePropById("critter-squirrel", 0.29);
sq.updateMatrixWorld(true);
const inner = sq.children[0];
const toLocal = new THREE.Matrix4().copy(inner.matrixWorld).invert();

type Row = { name: string; b: THREE.Box3 };
const rows: Row[] = [];
sq.traverse((o) => {
  const m = o as THREE.Mesh;
  if (!m.isMesh) return;
  const p = m.geometry.getAttribute("position");
  const b = new THREE.Box3();
  for (let i = 0; i < p.count; i++) {
    b.expandByPoint(new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld).applyMatrix4(toLocal));
  }
  rows.push({ name: m.name || "(unnamed)", b });
});
rows.sort((a, b) => b.b.max.y - a.b.max.y);
for (const { name, b } of rows) {
  console.log(
    `${name.padEnd(14)} y ${b.min.y.toFixed(2)}..${b.max.y.toFixed(2)}   z ${b.min.z.toFixed(2)}..${b.max.z.toFixed(2)}   |x| ${Math.max(Math.abs(b.min.x), Math.abs(b.max.x)).toFixed(2)}`,
  );
}

// The free corridor BEHIND and ABOVE everything but the tail, by height band:
// how far forward (+z) can a tail of radius r reach without touching a part?
console.log("\nclearance behind the body, ignoring the tail — the most +z a tail centre may reach:");
for (let y = 1.2; y <= 3.2; y += 0.2) {
  let front = -99;
  for (const { name, b } of rows) {
    if (name === "tail") continue;
    if (y < b.min.y || y > b.max.y) continue;
    front = Math.max(front, b.min.z);
  }
  console.log(`  y ${y.toFixed(1)}   nearest part's BACK face at z ${front === -99 ? "(nothing here)" : front.toFixed(2)}`);
}
