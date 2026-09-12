// IDEA-060 v5: how much of an apron prop does the GAME camera actually see?
//
// board.ts's height note claimed "visible height = height*scale - WALL_H",
// which is only true for a camera level with the hedge crown. This one looks
// DOWN, so it sees some way past the crown and the real threshold is lower.
// Rather than trust the arithmetic, this reads the camera off the live page
// and solves the grazing ray over the wall row in front of each apron row.
import { chromium } from "playwright";

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await p.goto("http://localhost:5173/preview-board/?theme=garden&maze=0&view=game&hud=0", { waitUntil: "load" });
await p.waitForFunction(() => document.title.includes("ready"), null, { timeout: 20000 });
await p.waitForTimeout(400);

const cam = await p.evaluate(() => {
  const w = window as unknown as { __board?: { rig: { camera: { position: { toArray(): number[] }; fov: number } } } };
  const c = w.__board?.rig.camera;
  return c ? { pos: c.position.toArray(), fov: c.fov } : null;
});
await b.close();
if (!cam) throw new Error("no camera on window.__board");

const [, cy, cz] = cam.pos;
console.log(`game camera: y=${cy.toFixed(2)} z=${cz.toFixed(2)}  fov=${cam.fov}`);

// worldZ(ty) = (ty - OZ) * TILE, OZ = (ROWS - 1) / 2 = 10.
const worldZ = (ty: number) => ty - 10;
const WALL_H = 1;

// A prop on the north apron (ty = -1) is hidden by the wall row at ty = 0.
// The binding edge is that wall box's FAR top corner (its far face, at the
// crown) — nearer edges graze lower. Solve the ray from the camera through
// that corner and read its height at the prop's own centre z.
function threshold(propTy: number, occluderTy: number): number {
  const zEdge = worldZ(occluderTy) - 0.5; // far face of the occluding wall box
  const zProp = worldZ(propTy);
  // Parameterise the ray so u = 1 lands ON the occluding edge, then read its
  // height at the prop's own z. (Getting this backwards — solving for u at the
  // edge along a line that reaches WALL_H at the PROP — reports a threshold of
  // 1.61 instead of 0.38 and makes the whole apron sound hopeless.)
  const u = (zProp - cz) / (zEdge - cz);
  return cy + u * (WALL_H - cy);
}

const north = threshold(-1, 0);
console.log(`\nnorth apron (ty=-1), occluded by the wall row at ty=0:`);
console.log(`  everything below y=${north.toFixed(3)} is behind the hedge`);

const props: Array<[string, number]> = [
  ["treehouse", 2.478],
  ["garden-tree", 1.151],
  ["garden-shrub", 0.446],
];
console.log(`\n  prop            h      scale  top     visible  (share)`);
for (const [name, h] of props) {
  for (const s of [1, 1.4, 1.8, 2.2]) {
    const top = h * s;
    const vis = Math.max(0, top - north);
    console.log(
      `  ${name.padEnd(15)} ${h.toFixed(3)}  ${s.toFixed(1)}    ${top.toFixed(3)}   ${vis.toFixed(3)}    ${((vis / top) * 100).toFixed(0)}%`,
    );
  }
}
console.log(`\n  (south apron and the east/west columns are NOT occluded — they`);
console.log(`   stand beside or in front of the board, so every unit counts.)`);
