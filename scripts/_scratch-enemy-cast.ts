// Scratch: the whole enemy cast measured side by side. The flea's spec requires
// it to land in the established height band and inside one maze tile.
import * as THREE from "three";
import { makeEnemy } from "../src/render/characters";

for (const id of ["ghost", "beetle", "bee", "ladybug", "flea", "crab", "mosquito", "maki", "nigiri", "pizza", "burger"]) {
  const g = makeEnemy(id, 0xe8615f);
  g.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(g);
  const s = b.getSize(new THREE.Vector3());
  let tris = 0;
  let meshes = 0;
  g.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    meshes++;
    const geo = o.geometry;
    tris += geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
  });
  console.log(
    `${id.padEnd(8)} w ${s.x.toFixed(3)}  h ${s.y.toFixed(3)}  l ${s.z.toFixed(3)}` +
      `  floor ${b.min.y.toFixed(3)}  crown ${b.max.y.toFixed(3)}` +
      `  meshes ${String(meshes).padStart(3)}  tris ${String(Math.round(tris)).padStart(6)}`,
  );
}
