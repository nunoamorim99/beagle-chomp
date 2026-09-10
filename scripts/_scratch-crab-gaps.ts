// Scratch: proves every joint of makeCrab() is CONTAINED IN A SOLID.
//
// The crab folds at 34 joints — eight walking legs of three segments, two
// chelipeds of four, and two eyestalks. The flea shipped with three of its hind
// leg's segments visibly separated because each was sized as a FRACTION of its
// joint distance and the round capsule caps were left to cover the rest, which
// holds only while the radius is large relative to the segment. That defect was
// found by eye, from a screenshot, after every gate had passed.
//
// makeCrab is built so the defect is unrepresentable: every segment is a
// cylinder spanning EXACTLY from joint to joint, and a knuckle ball sits AT each
// joint. This test is what makes that claim checkable after a retune.
//
// IT IS A CONTAINMENT TEST, ON PURPOSE. The obvious alternative — measure the
// distance from each joint to the nearest vertex — cannot tell inside from
// outside, and on a model with a ball centred on every joint it reports that
// ball's own radius as a "gap" at all 34 of them.
//
// The method is a PARITY count over the union, not a look at the first face
// hit. Fire a ray outward and walk every crossing, counting +1 for a back face
// (leaving a solid) and -1 for a front face (entering one). A point inside k
// solids yields back - front = k, so the joint is contained when that total is
// positive in every direction.
//
// Looking at the first face alone was the first version of this test and it was
// WRONG in a way that produced confident false alarms: it reported 18 of the 34
// joints open, every one of them a socket, because a NEIGHBOURING solid's outer
// surface lies between the socket and its own knuckle ball's far side. The first
// face is then that neighbour's front face and the joint reads as open while
// being solidly enclosed. Parity does not care what is in the way.
import * as THREE from "three";
import { makeEnemy } from "../src/render/characters";

const g = makeEnemy("crab", 0xe8615f);
g.updateMatrixWorld(true);

// Raycasting honours material.side, and every material here is FrontSide, so a
// back face would simply be skipped and every joint would look like open air.
g.traverse((o) => {
  if (!(o instanceof THREE.Mesh)) return;
  const mats = Array.isArray(o.material) ? o.material : [o.material];
  for (const m of mats) m.side = THREE.DoubleSide;
});

// 26 directions: the 6 axes, 12 edge diagonals and 8 corner diagonals of a cube
// — then TILTED off the axes by an arbitrary small rotation.
//
// The tilt is not cosmetic. A sphere or cylinder built by SphereGeometry /
// CylinderGeometry has a degenerate triangle fan at each pole, and a ray fired
// exactly along +Y or -Y from the centre exits through that shared vertex, where
// a ray-triangle test can be missed by every adjacent triangle at once. Without
// the tilt both cheliped wrists reported "parity 0" straight down while sitting
// dead centre in a 0.055-radius ball.
const TILT = new THREE.Euler(0.137, 0.211, 0.089);
const DIRS: THREE.Vector3[] = [];
for (let x = -1; x <= 1; x++) {
  for (let y = -1; y <= 1; y++) {
    for (let z = -1; z <= 1; z++) {
      if (x === 0 && y === 0 && z === 0) continue;
      DIRS.push(new THREE.Vector3(x, y, z).normalize().applyEuler(TILT));
    }
  }
}

/** Every named node whose ORIGIN is a joint the model must not open at. */
const JOINT_NAMES: RegExp[] = [
  /^legHip\d[LR]$/,
  /^legKnee\d[LR]$/,
  /^legAnkle\d[LR]$/,
  /^chelipedShoulder[LR]$/,
  /^chelipedElbow[LR]$/,
  /^chelipedWrist[LR]$/,
  /^chelaDactyl[LR]$/,
  /^eyestalk[LR]$/,
];

const joints: { name: string; at: THREE.Vector3 }[] = [];
g.traverse((o) => {
  if (JOINT_NAMES.some((re) => re.test(o.name))) {
    joints.push({ name: o.name, at: o.getWorldPosition(new THREE.Vector3()) });
  }
});

/** Meshes that are NOT closed solids: surface-conformal patches and eye caps.
 *  An open shell crosses a ray an odd number of times and would corrupt the
 *  parity count, so it is excluded rather than counted. None of them is load-
 *  bearing for a joint — they are colour on top of a solid that is. */
const OPEN_SHELLS: RegExp[] = [
  /^facePanel$/,
  /^chinApron$/,
  /^mouthGroove$/,
  /^iris[LR]$/,
  /^pupil[LR]$/,
  /^glint[LR]$/,
  /^eyeCollar[LR]$/,
];

const ray = new THREE.Raycaster();
ray.far = 4;
// A segment's cylinder ends exactly AT its joint, so the cylinder's end-cap disc
// is COPLANAR with the ray origin. Every ray then reports that cap as a
// front face at distance ~0 and the joint looks open from 25 of 26 directions
// while being solidly inside a ball. Skipping the coplanar hit is the fix; 1e-4
// is four orders of magnitude below the 0.02 seam-overlap floor this project
// works to, so it cannot hide a gap anyone could see.
ray.near = 1e-4;
let open = 0;

for (const j of joints) {
  const escaped: string[] = [];
  for (let i = 0; i < DIRS.length; i++) {
    const d = DIRS[i];
    ray.set(j.at, d);
    const hits = ray.intersectObject(g, true);
    if (hits.length === 0) {
      escaped.push(`dir${i}: no hit`);
      continue;
    }
    let depth = 0;
    for (const h of hits) {
      if (OPEN_SHELLS.some((re) => re.test(h.object.name))) continue;
      const n = h.face?.normal.clone();
      if (!n) continue;
      // Face normals are in the mesh's LOCAL frame. transformDirection() is
      // wrong for a non-uniformly scaled mesh (the palm ellipsoid is
      // 0.09 x 0.10 x 0.12) — a normal needs the inverse transpose, or its
      // direction shears and the front/back test flips.
      n.applyMatrix3(new THREE.Matrix3().getNormalMatrix(h.object.matrixWorld)).normalize();
      depth += n.dot(d) > 0 ? 1 : -1;
    }
    if (depth <= 0) escaped.push(`dir${i}: parity ${depth}`);
  }
  const ok = escaped.length === 0;
  if (!ok) open++;
  console.log(
    `${ok ? "ok  " : "OPEN"} ${j.name.padEnd(22)} ` +
      `(${j.at.x.toFixed(3)}, ${j.at.y.toFixed(3)}, ${j.at.z.toFixed(3)})` +
      (ok ? "" : `  ${escaped.length}/${DIRS.length} directions escape — e.g. ${escaped[0]}`),
  );
}

console.log(`\n${joints.length} joints checked, ${open} open.`);
if (joints.length !== 34) {
  console.log(`WARNING: expected 34 joints (8 legs x 3 + 2 chelipeds x 4 + 2 eyestalks), found ${joints.length}`);
}
process.exit(open === 0 && joints.length === 34 ? 0 : 1);
