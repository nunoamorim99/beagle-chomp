// IDEA-065: measure a forest reference PNG — alpha OR near-white background.
// Reports the subject bbox, a 40-row width profile (normalised to the bbox,
// which is what a proportion table is built from), and named colour probes.
//
//   npx tsx scripts/_scratch-measure-forest.mjs <img> [name,x,y ...]
//
// Coordinates for the probes are in SOURCE pixels.
import { chromium } from "playwright";
import fs from "node:fs";

const [img, ...crops] = process.argv.slice(2);
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
  // Background test: transparent, or near-white. A stock render on white is
  // the common case here and an alpha-only test reports the whole frame.
  const isBg = (x, y) => {
    const i = (y * W + x) * 4;
    if (d[i + 3] < 16) return true;
    return d[i] > 236 && d[i + 1] > 236 && d[i + 2] > 236;
  };
  let minX = W, minY = H, maxX = -1, maxY = -1, subject = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (isBg(x, y)) continue;
    subject++;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const w = maxX - minX + 1, h = maxY - minY + 1;
  // Width profile in NORMALISED units: fromTop 0..1 down the bbox, span as a
  // fraction of the bbox width, and the span's centre as a fraction too — a
  // leaning subject shows up in the centre column, not the width one.
  const rows = [];
  for (let k = 0; k <= 40; k++) {
    const y = Math.min(maxY, minY + Math.round((h - 1) * k / 40));
    let a0 = -1, a1 = -1;
    for (let x = minX; x <= maxX; x++) if (!isBg(x, y)) { if (a0 < 0) a0 = x; a1 = x; }
    rows.push({
      t: +(k / 40).toFixed(3),
      span: a0 < 0 ? 0 : +((a1 - a0 + 1) / w).toFixed(3),
      cx: a0 < 0 ? 0 : +(((a0 + a1) / 2 - minX) / w).toFixed(3),
    });
  }
  const out = {
    W, H, bbox: [minX, minY, maxX, maxY], w, h,
    aspectWOverH: +(w / h).toFixed(3),
    subjectPct: +(subject / (W * H) * 100).toFixed(1),
    rows,
  };
  out.probes = {};
  for (const cr of crops) {
    const [name, x, y] = cr.split(",");
    const i = (Number(y) * W + Number(x)) * 4;
    out.probes[name] = "#" + [d[i], d[i + 1], d[i + 2]].map(v => v.toString(16).padStart(2, "0")).join("");
  }
  return out;
}, { b64, crops });
console.log(JSON.stringify(res, null, 1));
await browser.close();
