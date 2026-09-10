// Measure a reference PNG in a headless browser: alpha bbox, row/col spans, crops.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const [img, outDir, ...crops] = process.argv.slice(2);
const b64 = fs.readFileSync(img).toString("base64");
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent("<body style='margin:0'></body>");
const res = await page.evaluate(async ({ b64, crops }) => {
  const im = new Image();
  im.src = "data:image/png;base64," + b64;
  await im.decode();
  const W = im.naturalWidth, H = im.naturalHeight;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(im, 0, 0);
  const d = g.getImageData(0, 0, W, H).data;
  // alpha bbox (or non-background bbox if fully opaque)
  let minX = W, minY = H, maxX = -1, maxY = -1, opaqueCount = 0, transparent = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const a = d[(y * W + x) * 4 + 3];
    if (a < 16) { transparent++; continue; }
    opaqueCount++;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  // per-row horizontal extent of opaque pixels (subject width profile)
  const rows = [];
  for (let y = minY; y <= maxY; y += Math.max(1, Math.round((maxY - minY) / 60))) {
    let a0 = -1, a1 = -1;
    for (let x = 0; x < W; x++) { if (d[(y * W + x) * 4 + 3] >= 16) { if (a0 < 0) a0 = x; a1 = x; } }
    rows.push([y, a0, a1]);
  }
  const out = { W, H, bbox: [minX, minY, maxX, maxY], w: maxX - minX + 1, h: maxY - minY + 1, transparentPct: +(transparent / (W * H) * 100).toFixed(1), rows };
  out.samples = {};
  for (const cr of crops) {
    const [name, x, y] = cr.split(",");
    const i = (Number(y) * W + Number(x)) * 4;
    out.samples[name] = "#" + [d[i], d[i+1], d[i+2]].map(v => v.toString(16).padStart(2, "0")).join("") + " a" + d[i+3];
  }
  return out;
}, { b64, crops });
console.log(JSON.stringify(res, null, 1));
await browser.close();
