// SCRATCH (IDEA-080): per-group extents of the sea arch, from vertices.
import * as THREE from "three";
import { getPropDef, type PropParams } from "../src/game/props";
import { makeArchway, ARCH_DEFAULTS } from "../src/render/archway";
const p = getPropDef("sea-arch").params as PropParams;
const g = makeArchway(p, 0.37);
g.updateMatrixWorld(true);
const H = ARCH_DEFAULTS.baseHeight;
const openW = H * (p.archOpening ?? 0.458);
console.log("half opening", (openW / 2).toFixed(3));
const v = new THREE.Vector3();
for (const top of g.children) {
  let lo = Infinity, inner = Infinity, xmin = Infinity, xmax = -Infinity, worst = "";
  top.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const a = m.geometry.getAttribute("position");
    for (let i = 0; i < a.count; i++) {
      v.fromBufferAttribute(a, i).applyMatrix4(m.matrixWorld);
      if (v.y < lo) { lo = v.y; worst = m.name; }
      if (v.y < 1.0) inner = Math.min(inner, Math.abs(v.x));
      xmin = Math.min(xmin, v.x); xmax = Math.max(xmax, v.x);
    }
  });
  console.log(top.name.padEnd(10), "lowY", lo.toFixed(3), worst.padEnd(10), "innermost<1.0", inner.toFixed(3), "x", xmin.toFixed(2), xmax.toFixed(2));
}
