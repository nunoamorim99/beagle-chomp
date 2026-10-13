// SCRATCH: do two renders actually differ? Eyeballing two near-identical
// turntable frames is how a change that did not apply gets accepted as a
// change that was too small to see.
import { chromium } from "playwright";
import fs from "node:fs";
const [a, b] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 50, height: 50 } });
const load = (p) => fs.readFileSync(p).toString("base64");
const out = await page.evaluate(async ([ia, ib]) => {
  const mk = async (s) => { const im = new Image(); im.src = "data:image/png;base64," + s; await im.decode(); return im; };
  const A = await mk(ia), B = await mk(ib);
  if (A.width !== B.width || A.height !== B.height) return { err: "size" };
  const c = document.createElement("canvas");
  c.width = A.width; c.height = A.height;
  const g = c.getContext("2d");
  g.drawImage(A, 0, 0); const da = g.getImageData(0, 0, c.width, c.height).data;
  g.clearRect(0, 0, c.width, c.height);
  g.drawImage(B, 0, 0); const db = g.getImageData(0, 0, c.width, c.height).data;
  let n = 0, worst = 0;
  for (let i = 0; i < da.length; i += 4) {
    const d = Math.abs(da[i] - db[i]) + Math.abs(da[i+1] - db[i+1]) + Math.abs(da[i+2] - db[i+2]);
    if (d > 12) n++;
    if (d > worst) worst = d;
  }
  return { differing: n, total: da.length / 4, worst };
}, [load(a), load(b)]);
console.log(JSON.stringify(out));
await browser.close();
