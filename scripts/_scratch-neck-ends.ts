// SCRATCH: a limb-style part's REAL endpoints after the def's saved edits.
//
// `limb`/`flaredLimb` place a mesh at the segment's midpoint with a
// quaternion, so a saved `position` MOVES the whole segment and a saved
// `scale.y` shortens or lengthens it about that midpoint. Solving anything
// against the authored endpoints is therefore solving against a segment that
// is not where it ships — which is exactly how v13's first bell came out
// through the shoulder.
import * as THREE from "three";
import { makePropById } from "../src/render/board";

const prop = makePropById("critter-deer", 0.17);
prop.updateMatrixWorld(true);
for (const name of process.argv.slice(2)) {
  let found: THREE.Mesh | undefined;
  prop.traverse((o) => {
    if (!found && (o as THREE.Mesh).isMesh && o.name === name) found = o as THREE.Mesh;
  });
  if (!found) { console.log(`${name}: not found`); continue; }
  const g = found.geometry.getAttribute("position");
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < g.count; i++) { lo = Math.min(lo, g.getY(i)); hi = Math.max(hi, g.getY(i)); }
  // Local Y extent -> the two ends, through position/quaternion/scale, but in
  // the BODY's frame (the parent of these parts), not the world.
  const a = new THREE.Vector3(0, lo * found.scale.y, 0).applyQuaternion(found.quaternion).add(found.position);
  const b = new THREE.Vector3(0, hi * found.scale.y, 0).applyQuaternion(found.quaternion).add(found.position);
  const f = (v: THREE.Vector3) => `[${v.x.toFixed(4)}, ${v.y.toFixed(4)}, ${v.z.toFixed(4)}]`;
  console.log(`${name.padEnd(10)} ${f(a)}  ->  ${f(b)}   (scale.y ${found.scale.y.toFixed(3)})`);
}
