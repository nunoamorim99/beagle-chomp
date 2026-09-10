// Scratch: the cast measured WHILE ANIMATING, not at rest.
//
// Every published envelope for these skins is a rest pose, and the walk cycle
// is not the rest pose: a leg swung forward carries a boot whose toe projects
// on +Z, and rotating that about X drops the toe BELOW its rest height. A foot
// that sinks into the maze floor for part of every stride is not visible in any
// still, which is exactly why it needs measuring rather than looking at.
import * as THREE from "three";
import { makeEnemy, type GhostUserData } from "../src/render/characters";

const ids = ["ghost", "beetle", "bee", "ladybug", "flea", "crab", "mosquito",
             "maki", "nigiri", "pizza", "burger"];
const v = new THREE.Vector3();

for (const id of ids) {
  const g = makeEnemy(id, 0xe8615f);
  const ud = g.userData as GhostUserData;
  let minY = Infinity, maxW = 0, restMinY = 0;
  for (let i = 0; i <= 60; i++) {
    const t = (i / 60) * 2.4;
    if (ud.behaviour?.animate) ud.behaviour.animate(t, t * 0.7, i === 0 ? 0 : 1);
    g.updateMatrixWorld(true);
    const b = new THREE.Box3();
    g.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const pos = o.geometry.attributes.position;
      for (let k = 0; k < pos.count; k++) b.expandByPoint(v.fromBufferAttribute(pos, k).applyMatrix4(o.matrixWorld));
    });
    if (i === 0) restMinY = b.min.y;
    minY = Math.min(minY, b.min.y);
    maxW = Math.max(maxW, b.max.x - b.min.x);
  }
  const sink = restMinY - minY;
  console.log(
    `${id.padEnd(8)} rest floor ${restMinY.toFixed(3)}  animated floor ${minY.toFixed(3)}` +
      `  SINK ${sink.toFixed(3)}  animated width ${maxW.toFixed(3)}`,
  );
}
