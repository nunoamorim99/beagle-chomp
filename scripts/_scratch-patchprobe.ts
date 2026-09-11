import * as THREE from "three";
import { TOP_BUN_STATIONS, smilePatch, bandNormal, onBand, stationRadius } from "../src/render/burgerSculpt";

const BUN_R = 0.330, BUN_H = 0.329, CROWN = 0.805;
const geo = smilePatch({
  stations: TOP_BUN_STATIONS, maxRadius: BUN_R, height: BUN_H, topY: CROWN,
  halfPhi: 0.32, tCentre: 0.764, tHeight: 0.20, lift: 0.0015,
  vFrom: 0, vTo: 1, segments: 26, rows: 8,
});
const pos = geo.attributes.position;
const idx = geo.index!;
const a = new THREE.Vector3().fromBufferAttribute(pos, idx.getX(0));
const b = new THREE.Vector3().fromBufferAttribute(pos, idx.getX(1));
const c = new THREE.Vector3().fromBufferAttribute(pos, idx.getX(2));
const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
const outward = bandNormal(TOP_BUN_STATIONS, 0.764, 0, BUN_R, BUN_H);
console.log("tri normal   ", n.toArray().map((v) => v.toFixed(3)).join(", "));
console.log("band outward ", outward.toArray().map((v) => v.toFixed(3)).join(", "));
console.log("dot =", n.dot(outward).toFixed(3), n.dot(outward) > 0 ? "FACES OUT (good)" : "FACES IN (culled)");

// Is the patch outside the bun's own analytic surface?
const t = 0.764;
const surfR = stationRadius(TOP_BUN_STATIONS, t) * BUN_R;
const p = onBand(TOP_BUN_STATIONS, t, 0, BUN_R, BUN_H, CROWN);
console.log(`\nbun surface at t=${t}: r=${surfR.toFixed(4)} z=${p.z.toFixed(4)}`);
let minGap = Infinity;
for (let i = 0; i < pos.count; i++) {
  const v = new THREE.Vector3().fromBufferAttribute(pos, i);
  const tt = (CROWN - v.y) / BUN_H;
  const r = Math.hypot(v.x, v.z);
  minGap = Math.min(minGap, r - stationRadius(TOP_BUN_STATIONS, tt) * BUN_R);
}
console.log("min radial gap patch-vs-bun:", minGap.toFixed(5), minGap > 0 ? "(outside)" : "(INSIDE THE BUN)");
