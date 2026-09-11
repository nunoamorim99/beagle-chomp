// IDEA-060 scratch: how many fence panels each maze needs, and what one costs.
//
// The fence is instanced once per exposed wall face, so the panel's triangle
// count is multiplied by ~440 on a real maze — which makes it the one number
// worth knowing BEFORE tuning how detailed a picket is. (The first build ran
// 5 arc segments on the picket head and cost 95k triangles for the fence
// alone; three segments reads identically at a 4px picket and costs 67k.)
import * as THREE from "three";
import { Grid } from "../src/game/grid";
import { MAZES } from "../src/game/mazes";
import { buildFence, fencePanelCount } from "../src/render/fence";

let total = 0;
let max = 0;
MAZES.forEach((rows, i) => {
  const g = new Grid(rows);
  const panels = fencePanelCount(g);
  let walls = 0;
  g.cells.forEach((r) => r.forEach((c) => { if (c === "#") walls++; }));
  total += panels;
  max = Math.max(max, panels);
  console.log(`maze ${String(i).padStart(2)}  ${String(walls).padStart(3)} wall tiles  ${String(panels).padStart(3)} panels`);
});

const scene = new THREE.Group();
const mesh = buildFence(scene, new Grid(MAZES[0]), 0x8a5a33);
if (!mesh) throw new Error("no fence built");
const panelTris = mesh.geometry.attributes.position.count / 3;
console.log(
  `\npanel   ${panelTris} tris` +
    `\nmazes   ${MAZES.length}, ${total} panels total, worst maze ${max}` +
    `\nworst   ${Math.round(panelTris * max)} tris on screen, in ONE draw call`,
);
