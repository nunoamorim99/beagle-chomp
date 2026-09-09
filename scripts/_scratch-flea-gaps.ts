// Scratch: proves every leg joint of the shipped flea is CLOSED — that some
// solid actually contains the joint point, so consecutive segments cannot read
// as disconnected pieces (the defect Nuno spotted on the hind pair).
//
// This is a CONTAINMENT test, not a distance test. An earlier version measured
// the distance from the joint to the nearest vertex and called anything over a
// threshold "open", which is meaningless: a ball centred on the joint reports
// exactly its own radius, and a coarse capsule's nearest vertex sits well off
// its true surface. Inside-vs-outside is the only question that matters.
import * as THREE from "three";
import { makeEnemy } from "../src/render/characters";

const g = makeEnemy("flea", 0xe8615f);
g.updateMatrixWorld(true);

const inv = new THREE.Matrix4();
const local = new THREE.Vector3();

/** Signed clearance: negative means p is INSIDE the solid, by that much. */
function depth(meshName: string, p: THREE.Vector3): number {
  const m = g.getObjectByName(meshName) as THREE.Mesh | undefined;
  if (!m || !(m instanceof THREE.Mesh)) return NaN;
  // Both capsules and spheres carry `parameters`; BufferGeometry alone does not,
  // hence the narrowing rather than a bare property access.
  const geo = m.geometry as THREE.CapsuleGeometry | THREE.SphereGeometry;
  const params = geo.parameters as { radius: number; length?: number };
  inv.copy(m.matrixWorld).invert();
  local.copy(p).applyMatrix4(inv);

  if (params.length === undefined) {
    // sphere (the joint balls): plain radial distance
    return local.length() - params.radius;
  }
  // capsule: axis runs along local Y from -length/2 to +length/2
  const half = params.length / 2;
  const y = THREE.MathUtils.clamp(local.y, -half, half);
  const axial = new THREE.Vector3(0, y, 0);
  return local.distanceTo(axial) - params.radius;
}

let open = 0;
let worstMargin = Infinity;
for (const tag of ["F", "M", "B"]) {
  for (const side of ["L", "R"]) {
    for (const [joint, above, below] of [
      ["knee", "femur", "tibia"],
      ["ankle", "tibia", "tarsus"],
    ] as const) {
      const node = g.getObjectByName(joint + tag + side);
      if (!node) continue;
      const p = node.getWorldPosition(new THREE.Vector3());
      const dAbove = depth(above + tag + side, p);
      const dBelow = depth(below + tag + side, p);
      const dBall = depth(joint + "Ball" + tag + side, p);
      const best = Math.min(
        dAbove,
        dBelow,
        Number.isNaN(dBall) ? Infinity : dBall,
      );
      const closed = best < 0;
      if (!closed) open++;
      worstMargin = Math.min(worstMargin, -best);
      console.log(
        `${joint}${tag}${side}`.padEnd(9) +
          ` above ${dAbove.toFixed(4)}  below ${dBelow.toFixed(4)}` +
          `  ball ${Number.isNaN(dBall) ? "  none " : dBall.toFixed(4)}` +
          `  -> ${closed ? `closed (buried ${(-best).toFixed(4)})` : "OPEN"}`,
      );
    }
  }
}
console.log(
  `\nopen joints: ${open}/12   thinnest coverage margin: ${worstMargin.toFixed(4)}`,
);
