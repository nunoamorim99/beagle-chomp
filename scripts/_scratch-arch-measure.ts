// SCRATCH (IDEA-067 v3): every library arch, measured from VERTICES.
//
// Never `Box3.setFromObject` — it builds each mesh's box in LOCAL space and
// transforms its eight corners, so a rotated child over-reports (up to 56% on
// this project's own shrub). Every number `test-archway.ts` bounds comes from
// here: the span that must not swallow the tunnel's neighbouring wall tiles,
// the depth that keeps it a portal rather than a covered way, the floor, and
// the triangle budget for a fixture that stands on every board of every level.
import * as THREE from "three";
import { makeArchway, ARCH_DEFAULTS } from "../src/render/archway";
import { getPropDef, type PropParams } from "../src/game/props";

for (const id of ["hedge-arch", "hedge-arch-gothic", "hedge-arch-topiary", "forest-arch"]) {
  const p = getPropDef(id).params as PropParams;
  const arch = makeArchway(p, 0.37);
  arch.updateWorldMatrix(true, true);
  const lo = new THREE.Vector3(Infinity, Infinity, Infinity);
  const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const v = new THREE.Vector3();
  let tris = 0;
  arch.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const a = m.geometry.getAttribute("position");
    tris += (m.geometry.getIndex()?.count ?? a.count) / 3;
    for (let i = 0; i < a.count; i++) {
      v.fromBufferAttribute(a, i).applyMatrix4(m.matrixWorld);
      lo.min(v);
      hi.max(v);
    }
  });
  const H = ARCH_DEFAULTS.baseHeight * (p.height ?? 1);
  const openW = H * (p.archOpening ?? ARCH_DEFAULTS.opening) * (p.width ?? 1);
  const rise = (openW / 2) * (p.archRise ?? ARCH_DEFAULTS.rise);
  const bandT = H * (p.archCrown ?? ARCH_DEFAULTS.crown);
  const springH = H - rise - bandT;
  // IDEA-067 rule 6's own inequality: 0.6 = 1/tan(59 degrees), 0.86 = the
  // camera's horizontal heading crossing the corridor.
  const hides = springH / Math.tan((59 * Math.PI) / 180);
  console.log(
    `${id.padEnd(20)} span ${(hi.x - lo.x).toFixed(2)}  tall ${hi.y.toFixed(2)}  deep ${(hi.z - lo.z).toFixed(2)}  ` +
      `floor ${lo.y.toFixed(3)}  ${Math.round(tris)} tris   ` +
      `spring ${springH.toFixed(2)} hides ${hides.toFixed(2)} of ${(0.86 * openW).toFixed(2)}` +
      (hides < 0.86 * openW ? "  OK" : "  *** SLAB ***"),
  );
}
