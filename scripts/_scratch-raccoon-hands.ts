// SCRATCH (IDEA-065 v26): where are the raccoon's hands against its bib?
//
// Measured on the prop AS IT SHIPS — `makePropById` applies props.ts's saved
// part edits, and Nuno has authored both the arms and the bib. Solving against
// the AUTHORED numbers instead is the trap the fox's neck fell into in v13:
// "a number you solve against has to be the number that ships".
import * as THREE from "three";
import { makePropById } from "../src/render/board";

const rac = makePropById("critter-raccoon", 0.29);
rac.updateMatrixWorld(true);
const inner = rac.children[0];
const toLocal = new THREE.Matrix4().copy(inner.matrixWorld).invert();

const named = (n: string): THREE.Object3D | undefined => {
  let hit: THREE.Object3D | undefined;
  rac.traverse((o) => {
    if (o.name === n && !hit) hit = o;
  });
  return hit;
};

/** A mesh's vertices in the BODY's frame — the one the builder writes in. */
function pts(o: THREE.Object3D): THREE.Vector3[] {
  const m = o as THREE.Mesh;
  if (!m.isMesh) return [];
  const pos = m.geometry.getAttribute("position");
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < pos.count; i++) {
    out.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).applyMatrix4(toLocal));
  }
  return out;
}

const bibMesh = named("bib") as THREE.Mesh | undefined;
const bibInv = new THREE.Matrix4();
const bibR = new THREE.Vector3(1, 1, 1);
if (bibMesh) {
  bibInv.copy(bibMesh.matrixWorld).invert();
  bibMesh.geometry.computeBoundingBox();
  const bb = bibMesh.geometry.boundingBox!;
  bibR.set((bb.max.x - bb.min.x) / 2, (bb.max.y - bb.min.y) / 2, (bb.max.z - bb.min.z) / 2);
}
const bib = named("bib");
if (bib) {
  const p = pts(bib);
  const zMax = Math.max(...p.map((v) => v.z));
  console.log(`bib front  z=${zMax.toFixed(3)}`);
  // The bib's surface at the heights and sides the hands occupy.
  for (const y of [1.0, 1.05, 1.1, 1.15]) {
    const near = p.filter((v) => Math.abs(v.y - y) < 0.04 && Math.abs(v.x) > 0.1 && Math.abs(v.x) < 0.34);
    if (near.length) {
      console.log(`  at y=${y.toFixed(2)}, |x| 0.10-0.34 : front z=${Math.max(...near.map((v) => v.z)).toFixed(3)}`);
    }
  }
}

for (const side of ["L", "R"]) {
  const palm = named(`palm${side}`);
  if (palm) {
    const p = pts(palm);
    const c = p.reduce((a, v) => a.add(v), new THREE.Vector3()).divideScalar(p.length);
    console.log(
      `palm${side}   centre (${c.x.toFixed(3)}, ${c.y.toFixed(3)}, ${c.z.toFixed(3)})  front z=${Math.max(...p.map((v) => v.z)).toFixed(3)}  back z=${Math.min(...p.map((v) => v.z)).toFixed(3)}`,
    );
  }
  for (let i = 0; i < 4; i++) {
    const f = named(`finger${side}${i}`);
    if (!f) continue;
    const p = pts(f);
    // The tip is the vertex furthest from the finger's own origin.
    const o = new THREE.Vector3().setFromMatrixPosition(f.matrixWorld).applyMatrix4(toLocal);
    let tip = p[0];
    let best = -1;
    for (const v of p) {
      const d = v.distanceTo(o);
      if (d > best) {
        best = d;
        tip = v;
      }
    }
    // **SIGNED DISTANCE TO THE BIB, IN THE BIB'S OWN FRAME.** Doing this by
    // hand against the authored ellipsoid is how three arithmetic slips got
    // made: the bib carries a saved position, rotation AND scale, and only
    // its matrix knows all three. <1 is inside the chest, 1 is the surface.
    let how = "";
    if (bibMesh) {
      const q = tip.clone().applyMatrix4(inner.matrixWorld).applyMatrix4(bibInv);
      how = ` | bib ${(Math.hypot(q.x / bibR.x, q.y / bibR.y, q.z / bibR.z)).toFixed(3)}`;
    }
    console.log(
      `finger${side}${i} tip  (${tip.x.toFixed(3)}, ${tip.y.toFixed(3)}, ${tip.z.toFixed(3)})${how}`,
    );
  }
}
