// IDEA-065: the N dominant NON-BACKGROUND colours of a reference, by area.
// A point probe hits whatever happens to be at one pixel; this is what the
// picture is actually MADE of, which is the number a 3-tone cartoon build
// needs. Quantised to a 16-level cube so anti-aliasing does not fragment a
// flat region into fifty near-identical entries.
//   npx tsx scripts/_scratch-palette.mjs <img> [top] [x0 y0 x1 y1]
import { chromium } from "playwright";
import fs from "node:fs";

const [img, topS = "10", ...box] = process.argv.slice(2);
const b64 = fs.readFileSync(img).toString("base64");
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent("<body style='margin:0'></body>");
const res = await page.evaluate(async ({ b64, topS, box }) => {
  const im = new Image(); im.src = "data:image/png;base64," + b64; await im.decode();
  const W = im.naturalWidth, H = im.naturalHeight;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(im, 0, 0);
  const d = g.getImageData(0, 0, W, H).data;
  const [x0, y0, x1, y1] = box.length === 4 ? box.map(Number) : [0, 0, W - 1, H - 1];
  const bins = new Map();
  let total = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = (y * W + x) * 4;
    if (d[i + 3] < 16) continue;
    if (d[i] > 236 && d[i + 1] > 236 && d[i + 2] > 236) continue;
    const k = (d[i] >> 4) * 256 + (d[i + 1] >> 4) * 16 + (d[i + 2] >> 4);
    const b = bins.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
    b.n++; b.r += d[i]; b.g += d[i + 1]; b.b += d[i + 2];
    bins.set(k, b); total++;
  }
  return [...bins.values()].sort((a, b) => b.n - a.n).slice(0, Number(topS)).map((b) => ({
    hex: "0x" + [b.r / b.n, b.g / b.n, b.b / b.n].map((v) => Math.round(v).toString(16).padStart(2, "0")).join(""),
    pct: +(b.n / total * 100).toFixed(1),
  }));
}, { b64, topS, box });
console.log(JSON.stringify(res));
await browser.close();
