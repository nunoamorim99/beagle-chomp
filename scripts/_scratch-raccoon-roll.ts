// SCRATCH (IDEA-065 v27): what roll opens each raccoon palm toward the viewer?
//
// The hand follows the forearm, so its fan lies in the arm's own local X — and
// `props.ts` sets each arm's rotation outright, so which way that points is
// Nuno's, not the builder's. `hand.rotation.y` rolls the fan about the arm's
// axis without moving the fingers' direction, which is the one control this
// needs. This finds the value per side by sweeping it.
//
// Measured on the prop AS IT SHIPS, with the saved edits applied.
import * as THREE from "three";
import { makePropById } from "../src/render/board";

// **SOLVED IN THE BODY'S FRAME, NOT THE WORLD'S.** `makeForestCritter` gives
// every instance a random yaw so a row of them is not a rank of soldiers —
// which rotates x and z, so a world-space answer is contaminated by whatever
// seed this probe happened to use. "Facing forward" means facing the ANIMAL's
// front. (The deer's leg check learned the same thing in v8.)
const FRONT = new THREE.Vector3(0, 0, 1);

for (const side of ["L", "R"]) {
  const rac = makePropById("critter-raccoon", 0.29);
  rac.updateMatrixWorld(true);
  let hand: THREE.Object3D | undefined;
  rac.traverse((o) => {
    if (o.name === `hand${side}` && !hand) hand = o;
  });
  if (!hand) {
    console.log(`hand${side}: not found`);
    continue;
  }
  const parent = hand.parent!;
  const bodyInv = new THREE.Quaternion()
    .setFromRotationMatrix(rac.children[0].matrixWorld)
    .invert();
  const base = hand.rotation.clone();
  let best = -2;
  let bestRoll = 0;
  const q = new THREE.Quaternion();
  const z = new THREE.Vector3();
  for (let i = -180; i <= 180; i += 2) {
    const roll = (i * Math.PI) / 180;
    hand.rotation.set(base.x, roll, base.z);
    hand.updateMatrixWorld(true);
    // The fan's own normal is the hand's local +Z. Facing the viewer means
    // that normal points at the camera.
    z.set(0, 0, 1)
      .applyQuaternion(q.setFromRotationMatrix(hand.matrixWorld))
      .applyQuaternion(bodyInv)
      .normalize();
    const d = z.dot(FRONT);
    if (d > best) {
      best = d;
      bestRoll = roll;
    }
  }
  hand.rotation.copy(base);
  console.log(
    `hand${side}: palm faces the viewer best at rotation.y = ${bestRoll.toFixed(2)}  (dot ${best.toFixed(3)}; currently ${base.y.toFixed(2)})  parent='${parent.name}'`,
  );
}
