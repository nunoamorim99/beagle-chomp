// IDEA-060: the garden props measured from VERTICES, not from Box3.
//
// `Box3.setFromObject` builds each mesh's box in LOCAL space and transforms
// its eight corners, so any child with an off-axis rotation is over-reported —
// CLAUDE.md records it costing the burger 15%. Every prop here has rotated
// children by construction (a shrub spins its mass so two of them are not the
// same shrub), and the very first measurement of the new shrub came back 0.82
// wide against a designed 0.52 for exactly that reason. This walks the real
// world-space vertices.
import * as THREE from "three";
import {
  makeBirdhouse,
  makeBroadleafTree,
  makeGardenFlower,
  makeLeafShrub,
  makeTreehouse,
} from "../src/render/gardenProps";
import type { PropParams } from "../src/game/props";

const SUBJECTS: Array<[string, (p: PropParams, h: number) => THREE.Group, PropParams, number]> = [
  ["garden-shrub", makeLeafShrub, {}, 0.31],
  ["garden-tree", makeBroadleafTree, {}, 0.42],
  ["treehouse", makeTreehouse, {}, 0.5],
  ["birdhouse", makeBirdhouse, {}, 0.27],
  ["daisy", makeGardenFlower, { flowerKind: "daisy" }, 0.2],
  ["sunflower", makeGardenFlower, { flowerKind: "sunflower" }, 0.6],
  ["rose", makeGardenFlower, { flowerKind: "rose" }, 0.35],
  ["tulip", makeGardenFlower, { flowerKind: "tulip" }, 0.75],
  ["blossom", makeGardenFlower, { flowerKind: "blossom" }, 0.15],
];

const v = new THREE.Vector3();
console.log(
  "prop            exact w   h     l     w/h    floor   crown   tris   meshes   box w  (inflation)",
);
for (const [name, make, params, hash] of SUBJECTS) {
  const g = make(params, hash);
  g.updateMatrixWorld(true);
  const lo = new THREE.Vector3(Infinity, Infinity, Infinity);
  const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  let tris = 0;
  let meshes = 0;
  g.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    meshes++;
    const geo = o.geometry;
    tris += geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      lo.min(v);
      hi.max(v);
    }
  });
  const w = hi.x - lo.x;
  const hgt = hi.y - lo.y;
  const l = hi.z - lo.z;
  const box = new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3());
  console.log(
    `${name.padEnd(15)} ${w.toFixed(3)}  ${hgt.toFixed(3)}  ${l.toFixed(3)}  ${(w / hgt).toFixed(3)}  ` +
      `${lo.y.toFixed(3)}  ${hi.y.toFixed(3)}  ${String(Math.round(tris)).padStart(5)}  ` +
      `${String(meshes).padStart(5)}    ${box.x.toFixed(3)}  (+${(((box.x / w) - 1) * 100).toFixed(0)}%)`,
  );
}
