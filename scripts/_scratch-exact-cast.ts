// Scratch: the enemy cast measured from VERTICES, not from boxes.
//
// THE FINDING THIS EXISTS FOR. `Box3.setFromObject` builds each mesh's box in
// LOCAL space and then transforms its eight corners, so any child with a
// rotation that is not a multiple of 90 degrees reports an INFLATED box - a
// disc of radius 0.300 spun 45 degrees about Y measures 0.424 across. The
// burger has two such children (the cheese slice, deliberately turned so its
// corners face the camera, and the under-frill), and between them they made
// the cast script report a 0.930-wide model whose real width is 0.812.
//
// That is not a rounding error, it is 15%, and it is the difference between
// "wider than the crab" (which is the crab's own recorded identity claim) and
// "comfortably inside the pack". Measure the vertices.
import * as THREE from "three";
import { makeEnemy } from "../src/render/characters";

const ids = ["ghost", "beetle", "bee", "ladybug", "flea", "crab", "mosquito",
             "maki", "nigiri", "pizza", "burger"];
for (const id of ids) {
  const g = makeEnemy(id, 0xe8615f);
  g.updateMatrixWorld(true);
  const exact = new THREE.Box3();
  const v = new THREE.Vector3();
  let tris = 0, meshes = 0;
  g.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    meshes++;
    const geo = o.geometry;
    tris += geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      exact.expandByPoint(v);
    }
  });
  const boxy = new THREE.Box3().setFromObject(g);
  const s = exact.getSize(new THREE.Vector3());
  const sb = boxy.getSize(new THREE.Vector3());
  const infl = ((sb.x / s.x - 1) * 100).toFixed(1);
  console.log(
    `${id.padEnd(8)} w ${s.x.toFixed(3)}  h ${s.y.toFixed(3)}  l ${s.z.toFixed(3)}` +
      `  floor ${exact.min.y.toFixed(3)}  crown ${exact.max.y.toFixed(3)}` +
      `  tris ${String(Math.round(tris)).padStart(6)}  meshes ${String(meshes).padStart(3)}` +
      `   [box-based w ${sb.x.toFixed(3)}, +${infl}%]`,
  );
}
