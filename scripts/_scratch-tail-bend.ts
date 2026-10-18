// SCRATCH (IDEA-065 v30): is the squirrel's plume an S or a comma?
//
// An S is a change of SIGN in the curvature, not a longer arc. This walks the
// tail curve, prints the heading in the y-z plane at each station, and counts
// how many times the turn reverses. A comma turns one way the whole length
// and reports 0.
import * as THREE from "three";
import { makePropById } from "../src/render/board";

const sq = makePropById("critter-squirrel", 0.29);
sq.updateMatrixWorld(true);
const inner = sq.children[0];
const toLocal = new THREE.Matrix4().copy(inner.matrixWorld).invert();
let tail: THREE.Mesh | undefined;
sq.traverse((o) => {
  const m = o as THREE.Mesh;
  if (m.isMesh && m.name === "tail" && !tail) tail = m;
});
if (!tail) throw new Error("no tail");

// The ring centroids ARE the curve: `ringedTail` lays its vertices out
// ring-major and the fluff averages to nothing around a ring.
const info = tail.geometry.userData.tail as { rings: number; radial: number };
const pos = tail.geometry.getAttribute("position");
const pts: THREE.Vector3[] = [];
for (let i = 0; i <= info.rings; i++) {
  const c = new THREE.Vector3();
  for (let j = 0; j < info.radial; j++) {
    c.add(new THREE.Vector3().fromBufferAttribute(pos, i * info.radial + j));
  }
  pts.push(c.divideScalar(info.radial).applyMatrix4(tail.matrixWorld).applyMatrix4(toLocal));
}

const head: number[] = [];
for (let i = 0; i < pts.length - 1; i++) {
  const d = pts[i + 1].clone().sub(pts[i]);
  head.push((Math.atan2(d.y, d.z) * 180) / Math.PI);
}
let turns = 0;
let prev = 0;
const deltas: number[] = [];
for (let i = 1; i < head.length; i++) {
  let d = head[i] - head[i - 1];
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  deltas.push(d);
}
// Smooth over three stations so a single noisy step is not a reversal.
for (let i = 1; i < deltas.length - 1; i++) {
  const sm = deltas[i - 1] + deltas[i] + deltas[i + 1];
  if (Math.abs(sm) < 1) continue;
  const sign = sm > 0 ? 1 : -1;
  if (prev !== 0 && sign !== prev) turns++;
  prev = sign;
}
for (let i = 0; i < head.length; i += 4) {
  console.log(
    `t ${(i / head.length).toFixed(2)}  y ${pts[i].y.toFixed(2)}  z ${pts[i].z.toFixed(2)}  heading ${head[i].toFixed(0).padStart(5)} deg`,
  );
}
console.log(
  `\ntotal turn ${deltas.reduce((a, b) => a + b, 0).toFixed(0)} deg over ${head.length} stations, ` +
    `${turns} reversal(s) — an S has at least one, a comma has none`,
);
