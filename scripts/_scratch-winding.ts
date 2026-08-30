// Scratch diagnostic (delete before commit, or promote into the suite).
//
// Compares every triangle's GEOMETRIC face normal against its stored vertex
// normal. A mesh whose winding is inverted reports ~100% disagreement — which
// is a bug that renders as the object being see-through (FrontSide culls the
// near wall and you look at the far one) and is invisible from a single front
// render. It has shipped twice in this file: the banana's swept tube used
// +cos where TubeGeometry uses -cos, and the strawberry's lathe profile ran
// descending where LatheGeometry wants ascending.
import * as THREE from "three";
import { makeStrawberry, makeBanana, makeAnchor, makeShield, makeMango } from "../src/render/board";

const MESHES: readonly [string, () => THREE.Group][] = [
  ["strawberry", makeStrawberry],
  ["banana", makeBanana],
  ["mango", makeMango],
  ["anchor", makeAnchor],
  ["shield", makeShield],
];

const a = new THREE.Vector3();
const b = new THREE.Vector3();
const c = new THREE.Vector3();
const ab = new THREE.Vector3();
const ac = new THREE.Vector3();
const fn = new THREE.Vector3();
const vn = new THREE.Vector3();

let worst = 0;
for (const [label, make] of MESHES) {
  make().traverse((o: THREE.Object3D) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geo = mesh.geometry as THREE.BufferGeometry;
    const pos = geo.attributes.position;
    const nor = geo.attributes.normal;
    if (!pos || !nor) return;
    // ExtrudeGeometry and friends are NON-indexed, so fall back to reading
    // triangles straight off the position attribute — otherwise every extruded
    // mesh silently skips the check.
    const idx = geo.index;
    const count = idx ? idx.count : pos.count;
    const at = (k: number) => (idx ? idx.getX(k) : k);
    let bad = 0;
    let total = 0;
    for (let i = 0; i < count; i += 3) {
      a.fromBufferAttribute(pos, at(i));
      b.fromBufferAttribute(pos, at(i + 1));
      c.fromBufferAttribute(pos, at(i + 2));
      ab.subVectors(b, a);
      ac.subVectors(c, a);
      fn.crossVectors(ab, ac);
      if (fn.lengthSq() < 1e-12) continue;
      fn.normalize();
      vn.fromBufferAttribute(nor, at(i));
      total++;
      if (fn.dot(vn) < 0) bad++;
    }
    if (!total) return;
    const pct = Math.round((100 * bad) / total);
    worst = Math.max(worst, pct);
    console.log(`  ${pct > 10 ? "FAIL" : "ok  "} ${label}/${mesh.name}: ${bad}/${total} inverted (${pct}%)`);
  });
}
console.log(worst > 10 ? `\nWINDING CHECK FAILED (worst ${worst}%)` : "\nALL WINDING CHECKS PASSED");
process.exit(worst > 10 ? 1 : 0);
