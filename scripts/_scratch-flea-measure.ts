// Scratch: measures the flea's landmarks headlessly so the hind-leg fold can be
// tuned without a browser round-trip. Not part of the test suite.
import * as THREE from "three";
import { makeEnemy } from "../src/render/characters";

const g = makeEnemy("flea", 0xe8615f);
g.updateMatrixWorld(true);

const v = new THREE.Vector3();
function at(name: string): string {
  const o = g.getObjectByName(name);
  if (!o) return `${name}: MISSING`;
  o.getWorldPosition(v);
  return `${name.padEnd(12)} x ${v.x.toFixed(3)}  y ${v.y.toFixed(3)}  z ${v.z.toFixed(3)}`;
}

for (const n of [
  "abdomen", "head", "belly",
  "kneeBL", "footBL", "ankleBL",
  "kneeFL", "footFL",
  "kneeML", "footML",
  "antTipL", "eyeL",
]) {
  console.log(at(n));
}

const box = new THREE.Box3().setFromObject(g);
const size = box.getSize(new THREE.Vector3());
console.log(
  `\nbbox  w ${size.x.toFixed(3)}  h ${size.y.toFixed(3)}  l ${size.z.toFixed(3)}` +
    `   floor ${box.min.y.toFixed(3)}  crown ${box.max.y.toFixed(3)}` +
    `   z ${box.min.z.toFixed(3)}..${box.max.z.toFixed(3)}`,
);

let tris = 0;
g.traverse((o) => {
  if (!(o instanceof THREE.Mesh)) return;
  const geo = o.geometry;
  tris += geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
});
console.log(`tris  ${tris}`);
