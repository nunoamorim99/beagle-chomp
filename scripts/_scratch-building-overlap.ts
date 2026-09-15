import * as THREE from "three";
import { MAZE_THEMES } from "../src/game/themes";
import { SURROUND_PARAMS } from "../src/render/surround";
import { buildSurroundContent } from "../src/render/surroundRecipe";
import { makeSurroundMaterials } from "../src/render/surroundProps";

const GARDEN = MAZE_THEMES.find((t) => t.id === "garden")!;
console.log("plotW", SURROUND_PARAMS.plotW, "plotD", SURROUND_PARAMS.plotD, "lane", SURROUND_PARAMS.lane);
const host = buildSurroundContent("plots", makeSurroundMaterials(GARDEN.palette));
type F = { n: string; x0: number; x1: number; z0: number; z1: number };
const feet: F[] = [];
for (const c of host.children) {
  if (!c.name.startsWith("building-")) continue;
  c.updateWorldMatrix(true, true);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  const v = new THREE.Vector3();
  c.traverse((o) => {
    const mm = o as THREE.Mesh;
    if (!mm.isMesh) return;
    const p = mm.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(mm.matrixWorld);
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x);
      z0 = Math.min(z0, v.z); z1 = Math.max(z1, v.z);
    }
  });
  feet.push({ n: c.name, x0, x1, z0, z1 });
}
const hits: string[] = [];
for (let i = 0; i < feet.length; i++)
  for (let j = i + 1; j < feet.length; j++) {
    const a = feet[i], b = feet[j];
    const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
    const oz = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
    if (ox > 0 && oz > 0)
      hits.push(
        `${(ox * oz).toFixed(2)}  ${a.n}@(${((a.x0 + a.x1) / 2).toFixed(1)},${((a.z0 + a.z1) / 2).toFixed(1)}) ` +
        `${(a.x1 - a.x0).toFixed(1)}x${(a.z1 - a.z0).toFixed(1)}  vs  ` +
        `${b.n}@(${((b.x0 + b.x1) / 2).toFixed(1)},${((b.z0 + b.z1) / 2).toFixed(1)}) ${(b.x1 - b.x0).toFixed(1)}x${(b.z1 - b.z0).toFixed(1)}`,
      );
  }
hits.sort((a, b) => parseFloat(b) - parseFloat(a));
console.log(feet.length, "buildings,", hits.length, "overlapping pairs");
for (const h of hits.slice(0, 12)) console.log("  " + h);
