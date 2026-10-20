// SCRATCH (IDEA-080): list a tent's parts and their vertex bounds.
import * as THREE from "three";
import { makeSurroundMaterials, distantTent } from "../src/render/surroundProps";
const m = makeSurroundMaterials({ wall: 0xd4b078, surroundGround: 0x9a8258, fenceColor: 0xa9743f, bloomColors: [0xf8f0e2, 0x5fc8c0, 0xf29a8a], groundDetailColor: 0x9c9a90 });
for (const kind of ["ridge", "dome"] as const) {
  const t = distantTent(m, { kind, seed: 9 });
  t.updateMatrixWorld(true);
  t.traverse((o) => {
    const me = o as THREE.Mesh;
    if (!me.isMesh) return;
    const b = new THREE.Box3();
    const a = me.geometry.getAttribute("position");
    const v = new THREE.Vector3();
    for (let i = 0; i < a.count; i++) b.expandByPoint(v.fromBufferAttribute(a, i).applyMatrix4(me.matrixWorld));
    console.log(kind, me.name, (me.material as THREE.MeshToonMaterial).color.getHexString(), b.min.toArray().map((n) => n.toFixed(2)).join(","), "->", b.max.toArray().map((n) => n.toFixed(2)).join(","));
  });
}
