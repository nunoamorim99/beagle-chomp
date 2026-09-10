// Scratch: is the pair of eyes actually MIRRORED, in world space?
// The glint carries both a rotation (which mirrors by `s`) and a position
// offset authored on ONE side in the editor, and the two push in opposite
// directions — so the only honest check is where the visible cap lands, not
// where its object origin sits. A cap's origin is the eye's centre; its bright
// spot is the +Z pole carried round by the rotation.
import * as THREE from "three";
import { makeEnemy } from "../src/render/characters";

const g = makeEnemy("nigiri", 0xe8615f);
g.updateMatrixWorld(true);

const obj = (n: string): THREE.Object3D => {
  const o = g.getObjectByName(n);
  if (!o) throw new Error(`no part named ${n}`);
  return o;
};

for (const side of ["L", "R"]) {
  const eye = obj(`eye${side}`);
  const eyeC = new THREE.Vector3();
  eye.getWorldPosition(eyeC);

  // The lit spot: the cap's own +Z pole, in world space, relative to the eye.
  const spot = (name: string, radius: number): string => {
    const o = obj(name);
    const v = new THREE.Vector3(0, 0, radius).applyMatrix4(o.matrixWorld).sub(eyeC);
    return `${v.x.toFixed(4)} ${v.y.toFixed(4)} ${v.z.toFixed(4)}`;
  };

  const box = new THREE.Box3().setFromObject(obj(`eyeBall${side}`));
  const size = new THREE.Vector3();
  box.getSize(size);
  console.log(
    `${side}  eye.x ${eyeC.x.toFixed(4)}  ball ${size.x.toFixed(4)} x ${size.y.toFixed(4)} x ${size.z.toFixed(4)}`,
  );
  console.log(`    pupil spot  ${spot(`pupil${side}`, 0.0455 * 1.02)}`);
  console.log(`    glint spot  ${spot(`glint${side}`, 0.0455 * 1.06)}`);
}
