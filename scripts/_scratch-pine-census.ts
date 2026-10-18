// SCRATCH (IDEA-065 v4): how much of the forest's surround is conifer?
//
// The question this answers is a budget one: the hero pine is a stack of
// serrated whorls at ~1,800 triangles, and the surround's conifer is three
// cones at ~90. Before putting the new silhouette out there I need to know
// how many of them there are, in the band and in the showcase ring.
import * as THREE from "three";
import { MAZE_THEMES } from "../src/game/themes";
import { buildSurroundContent, ensureSurround, disposeSurround } from "../src/render/surroundRecipe";
import { makeSurroundMaterials, distantConifer } from "../src/render/surroundProps";

function count(o: THREE.Object3D): { meshes: number; tris: number } {
  let meshes = 0;
  let tris = 0;
  o.traverse((n) => {
    const m = n as THREE.Mesh;
    if (!m.isMesh) return;
    meshes++;
    const pos = m.geometry.attributes.position;
    tris += (m.geometry.index ? m.geometry.index.count : pos.count) / 3;
  });
  return { meshes, tris };
}

for (const t of MAZE_THEMES) {
  if (t.palette.surround === "none") continue;
  const raw = buildSurroundContent(t.palette.surround, makeSurroundMaterials(t.palette));
  const all = count(raw);
  // Conifers are the groups whose children are all named tier*/trunk.
  let conifers = 0;
  let coniferTris = 0;
  raw.traverse((n) => {
    if (!(n instanceof THREE.Group)) return;
    const kids = n.children.filter((c) => (c as THREE.Mesh).isMesh);
    if (!kids.length) return;
    if (kids.every((c) => /^(tier\d+|trunk|whorl\d+|canopyLit|canopyDark|spire)$/.test(c.name))) {
      if (kids.some((c) => /^(tier\d+|whorl\d+|canopyLit)$/.test(c.name))) {
        conifers++;
        coniferTris += count(n).tris;
      }
    }
  });
  const merged = ensureSurround(new THREE.Group(), t.palette.surround, t.palette);
  const m = merged ? count(merged) : { meshes: 0, tris: 0 };
  disposeSurround();
  console.log(
    `${t.id.padEnd(10)} unmerged ${String(all.meshes).padStart(5)} meshes / ${String(Math.round(all.tris)).padStart(7)} tris` +
      ` | conifers ${String(conifers).padStart(4)} = ${String(Math.round(coniferTris)).padStart(6)} tris` +
      ` | merged ${String(m.meshes).padStart(3)} calls / ${String(Math.round(m.tris)).padStart(7)} tris`,
  );
}

const mats = makeSurroundMaterials(MAZE_THEMES.find((t) => t.id === "forest")!.palette);
const one = distantConifer(mats, { seed: 6 });
console.log("\none surround conifer:", JSON.stringify(count(one)));
