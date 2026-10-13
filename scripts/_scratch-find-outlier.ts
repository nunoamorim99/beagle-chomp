// SCRATCH: which PART reaches furthest out on -X at a given height band?
// Measured from VERTICES (Box3.setFromObject over-reports a rotated child).
import * as THREE from "three";
import { makePropById } from "../src/render/board";

const prop = makePropById(process.argv[2] ?? "critter-deer", 0.17);
prop.updateMatrixWorld(true);
const yLo = Number(process.argv[3] ?? 1.1);
const yHi = Number(process.argv[4] ?? 1.7);
const rows: Array<[string, number, number, number]> = [];
const v = new THREE.Vector3();
prop.traverse((o) => {
  const m = o as THREE.Mesh;
  if (!m.isMesh) return;
  const pos = m.geometry.getAttribute("position");
  let minX = Infinity, lo = Infinity, hi = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos as THREE.BufferAttribute, i).applyMatrix4(m.matrixWorld);
    if (v.y < yLo || v.y > yHi) continue;
    if (v.x < minX) minX = v.x;
    if (v.y < lo) lo = v.y;
    if (v.y > hi) hi = v.y;
  }
  if (isFinite(minX)) rows.push([m.name || "(unnamed)", minX, lo, hi]);
});
rows.sort((a, b) => a[1] - b[1]);
console.log(`parts reaching furthest on -X between y ${yLo} and ${yHi}:`);
for (const [n, x, lo, hi] of rows.slice(0, 8)) {
  console.log(`  ${n.padEnd(16)} minX ${x.toFixed(3)}   y ${lo.toFixed(2)}..${hi.toFixed(2)}`);
}
