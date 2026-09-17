// Scratch: the beagle's real envelope, measured from VERTICES (never
// Box3.setFromObject — see _scratch-exact-cast.ts's header). The shield
// bubble has to enclose the dog without swallowing the corridor, so both
// the radius and the centre height come from here rather than from taste.
import * as THREE from "three";
import { makeBeagle } from "../src/render/characters";

const g = makeBeagle();
g.updateMatrixWorld(true);
const box = new THREE.Box3();
const v = new THREE.Vector3();
let far = 0;
const pts: THREE.Vector3[] = [];
g.traverse((o) => {
  if (!(o instanceof THREE.Mesh)) return;
  const pos = o.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
    box.expandByPoint(v);
    pts.push(v.clone());
  }
});
const size = box.getSize(new THREE.Vector3());
const c = box.getCenter(new THREE.Vector3());
console.log("bbox size  x/y/z:", size.x.toFixed(3), size.y.toFixed(3), size.z.toFixed(3));
console.log("bbox min y:", box.min.y.toFixed(3), " max y:", box.max.y.toFixed(3));
console.log("centre     x/y/z:", c.x.toFixed(3), c.y.toFixed(3), c.z.toFixed(3));
// Smallest sphere about a few candidate centres, so the bubble can be sized
// from the tightest one that still contains every vertex.
for (const cy of [c.y, 0.3, 0.32, 0.34, 0.36, 0.4]) {
  far = 0;
  const o = new THREE.Vector3(0, cy, 0);
  for (const p of pts) far = Math.max(far, p.distanceTo(o));
  console.log(`  centre y=${cy.toFixed(3)} -> enclosing radius ${far.toFixed(3)}`);
}

// --- the ellipsoid the bubble actually has to be -----------------------------
// A SPHERE that contains the dog is 1.106 tiles across, i.e. wider than the
// corridor it runs down, so it would clip both hedges for the whole run. The
// bubble is therefore an ellipsoid aimed along the dog's heading: narrow ACROSS
// the corridor (where there is no room) and long ALONG it (where there is).
console.log("\n--- ellipsoid fit, centre y = 0.43 ---");
const CY = 0.43;
for (const rx of [0.40, 0.42, 0.45, 0.48]) {
  // Smallest ry/rz (kept in the same ratio as the dog's own y/z extents) that
  // still contains every vertex at this rx.
  let k = 0;
  const ry0 = 0.47, rz0 = 0.50;
  for (const p of pts) {
    const ax = (p.x / rx) ** 2;
    const rest = ((p.y - CY) / ry0) ** 2 + (p.z / rz0) ** 2;
    if (ax >= 1) { k = Infinity; break; }
    k = Math.max(k, rest / (1 - ax));
  }
  const s = Math.sqrt(k);
  console.log(`  rx=${rx.toFixed(2)} -> ry=${(ry0 * s).toFixed(3)} rz=${(rz0 * s).toFixed(3)}`);
}

// Wall clearance: hedge tiles bulge OUTWARD with height (IDEA-068), up to
// 0.105 at the crown on a ramp of t^1.7, so the free half-width of a corridor
// shrinks as you go up. Compare it against the bubble's own half-width.
console.log("\n--- corridor clearance, rx=0.42 ry=0.60 (WALL_H = 1) ---");
for (const y of [0.1, 0.3, 0.43, 0.6, 0.8, 1.0]) {
  const wall = 0.5 - 0.105 * Math.pow(Math.min(1, Math.max(0, y)), 1.7);
  const t = (y - CY) / 0.60;
  const half = Math.abs(t) >= 1 ? 0 : 0.42 * Math.sqrt(1 - t * t);
  console.log(`  y=${y.toFixed(2)}  bubble ${half.toFixed(3)}  free ${wall.toFixed(3)}  gap ${(wall - half).toFixed(3)}`);
}
