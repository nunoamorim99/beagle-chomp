// Dumps world-space bounds of every mesh in the rework preview.
import { chromium } from "playwright";

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 400, height: 400 } });
p.on("pageerror", (e) => console.log("PAGEERROR:", (e as Error).stack ?? String(e)));
await p.goto("http://localhost:5173/preview-rework/?view=34&grid=0", { waitUntil: "networkidle" });
await p.waitForFunction(() => document.title.includes("ready"), null, { timeout: 20_000 });
const rows = await p.evaluate(() => {
  const { THREE, model } = (window as any).__preview;
  const out: string[] = [];
  model.updateWorldMatrix(true, true);
  model.traverse((o: any) => {
    if (!o.isMesh) return;
    const box = new THREE.Box3().setFromObject(o);
    const c = box.getCenter(new THREE.Vector3());
    const s = box.getSize(new THREE.Vector3());
    out.push(
      `${o.name.padEnd(14)} ctr(${c.x.toFixed(3)},${c.y.toFixed(3)},${c.z.toFixed(3)}) ` +
      `size(${s.x.toFixed(3)},${s.y.toFixed(3)},${s.z.toFixed(3)}) geo=${o.geometry.type}`,
    );
  });
  return out;
});
console.log(rows.join("\n"));
await b.close();
