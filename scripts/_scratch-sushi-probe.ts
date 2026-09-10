// Scratch: world-space bounds of named parts, for diagnosing a part that
// renders as nothing.
import * as THREE from "three";
import { makeEnemy } from "../src/render/characters";

const g = makeEnemy(process.env.MODEL ?? "nigiri", 0xe8615f);
g.updateMatrixWorld(true);
const want = (process.env.PARTS ?? "riceBlock,noriBelt,beltSheen,prawnCap,eyeL,blushL,mouth,riceGrainSkirt0,tailFan0,capNose").split(",");
for (const name of want) {
  const o = g.getObjectByName(name);
  if (!o) { console.log(name.padEnd(16), "NOT FOUND"); continue; }
  const b = new THREE.Box3().setFromObject(o);
  if (b.isEmpty()) { console.log(name.padEnd(16), "EMPTY BOX"); continue; }
  const s = b.getSize(new THREE.Vector3());
  const tris = o instanceof THREE.Mesh
    ? (o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3)
    : -1;
  console.log(
    `${name.padEnd(16)} x[${b.min.x.toFixed(3)},${b.max.x.toFixed(3)}] y[${b.min.y.toFixed(3)},${b.max.y.toFixed(3)}] z[${b.min.z.toFixed(3)},${b.max.z.toFixed(3)}] size ${s.x.toFixed(3)}/${s.y.toFixed(3)}/${s.z.toFixed(3)} tris ${tris}`,
  );
}
