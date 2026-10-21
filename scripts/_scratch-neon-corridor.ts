// IDEA-083: which parts of the neon gateway reach into the one-tile corridor.
import * as THREE from "three";
import { makeArchway, ARCH_DEFAULTS } from "../src/render/archway";
import { getPropDef, type PropParams } from "../src/game/props";
const np = getPropDef("neon-gateway").params as PropParams;
const arch = makeArchway(np, 0.37);
const H = ARCH_DEFAULTS.baseHeight * (np.height ?? 1);
const springY = H - ((H * (np.archOpening ?? 0.5)) / 2) * (np.archRise ?? 1);
arch.updateMatrixWorld(true);
const v = new THREE.Vector3();
arch.traverse((o) => {
  const m = o as THREE.Mesh;
  if (!m.isMesh) return;
  const a = m.geometry.getAttribute("position");
  let n = 0, minX = Infinity, ys: number[] = [];
  for (let i = 0; i < a.count; i++) {
    v.fromBufferAttribute(a, i).applyMatrix4(m.matrixWorld);
    if (Math.abs(v.x) < 0.5 && v.y < springY - 0.05) { n++; minX = Math.min(minX, Math.abs(v.x)); ys.push(v.y); }
  }
  if (n) console.log(m.name, n, "min|x|", minX.toFixed(3), "y", Math.min(...ys).toFixed(2), "..", Math.max(...ys).toFixed(2), "springY", springY.toFixed(2));
});
