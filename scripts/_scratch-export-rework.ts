// Exports the rework model's world-space mesh geometry to meshes.json (for
// forge self_intersection.py) and captures a pivot-articulation pose test:
// legs swung, ears flared, tail wagged, head tilted via the factory's named
// pivot Groups — the same channels the game's syncToEntity drives.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 900, height: 900 } });
p.on("pageerror", (e) => console.log("PAGEERROR:", String(e)));
await p.goto("http://localhost:5173/preview-rework/?view=34&grid=0&hud=0", { waitUntil: "networkidle" });
await p.waitForFunction(() => document.title.includes("ready"), null, { timeout: 20_000 });
await p.waitForTimeout(400);

const meshes = await p.evaluate(() => {
  const { THREE, model } = (window as any).__preview;
  model.updateWorldMatrix(true, true);
  const out: any[] = [];
  model.traverse((o: any) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    const pos = g.attributes.position;
    const v = new THREE.Vector3();
    const vertices: number[][] = [];
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      vertices.push([v.x, v.y, v.z]);
    }
    const triangles: number[][] = [];
    if (g.index) {
      for (let i = 0; i < g.index.count; i += 3) {
        triangles.push([g.index.getX(i), g.index.getX(i + 1), g.index.getX(i + 2)]);
      }
    } else {
      for (let i = 0; i < pos.count; i += 3) triangles.push([i, i + 1, i + 2]);
    }
    out.push({ id: o.name || "unnamed", vertices, triangles });
  });
  return out;
});
writeFileSync(".img2threejs/renders/interaction-pass/meshes.json", JSON.stringify({ meshes }));
console.log("exported", meshes.length, "meshes,",
  meshes.reduce((n: number, m: any) => n + m.vertices.length, 0), "vertices");

// measured world pivot positions for the attachment gate
const measured = await p.evaluate(`(() => {
  const pv = window.__preview;
  pv.model.updateWorldMatrix(true, true);
  const out = {};
  pv.model.traverse((o) => {
    if (o.isMesh || !o.name || !o.name.endsWith("__pivot")) return;
    const v = new pv.THREE.Vector3();
    o.getWorldPosition(v);
    out[o.name.replace("__pivot", "")] = [v.x, v.y, v.z];
  });
  return out;
})()`);
writeFileSync(".img2threejs/renders/interaction-pass/measured.json", JSON.stringify(measured, null, 1));

// pose test through the pivot Groups the factory exposes (the same channels
// the game's syncToEntity drives)
const poseInfo = await p.evaluate(`(() => {
  const pv = window.__preview;
  const nodes = (pv.model.userData.sculptRuntime && pv.model.userData.sculptRuntime.nodes) || null;
  const byName = {};
  pv.model.traverse((o) => { if (o.name && o.name.endsWith("__pivot")) byName[o.name] = o; });
  const legFL = byName["Leg Front L__pivot"], legFR = byName["Leg Front R__pivot"];
  const legHL = byName["Leg Hind L__pivot"], legHR = byName["Leg Hind R__pivot"];
  const earL = byName["Ear L__pivot"], earR = byName["Ear R__pivot"];
  const tail = byName["Tail__pivot"], head = byName["Head (skull)__pivot"];
  if (legFL) legFL.rotation.x = 0.6;
  if (legHR) legHR.rotation.x = 0.6;
  if (legFR) legFR.rotation.x = -0.6;
  if (legHL) legHL.rotation.x = -0.6;
  if (earL) earL.rotation.z = -0.35;
  if (earR) earR.rotation.z = 0.35;
  if (tail) tail.rotation.z = 0.5;
  if (head) head.rotation.x = -0.15;
  pv.renderer.render(pv.scene, pv.camera);
  return {
    haveRuntimeNodes: !!nodes,
    pivots: { legFL: !!legFL, legFR: !!legFR, legHL: !!legHL, legHR: !!legHR, earL: !!earL, earR: !!earR, tail: !!tail, head: !!head },
  };
})()`);
console.log("pose:", JSON.stringify(poseInfo));
await p.screenshot({ path: ".img2threejs/renders/interaction-pass/pose-test.png" });
await b.close();
