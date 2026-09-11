// IDEA-060: measure a prop reference image.
//
//   npx tsx scripts/_scratch-measure-prop.mjs <img> [bgMode]
//
// bgMode "white" (default) treats near-white as background; "black" treats
// near-black as background (the PngTree shrub is on black); "alpha" uses the
// alpha channel.
//
// Prints the subject bbox, the width profile down the height in 20 bands, and
// the height profile across the width — which between them is what a
// proportion table is built from. The width profile is the useful one for a
// tree or a shrub: it says where the crown ends and the trunk begins without
// anyone having to guess a boundary.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const [img, bgMode = "white"] = process.argv.slice(2);
const ext = path.extname(img).toLowerCase();
const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
const b64 = fs.readFileSync(img).toString("base64");

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent("<body style='margin:0'></body>");
const res = await page.evaluate(async ({ b64, mime, bgMode }) => {
  const im = new Image();
  im.src = `data:${mime};base64,` + b64;
  await im.decode();
  const W = im.naturalWidth, H = im.naturalHeight;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(im, 0, 0);
  const d = g.getImageData(0, 0, W, H).data;
  const isBg = (i) => {
    const r = d[i], gg = d[i + 1], b = d[i + 2], a = d[i + 3];
    if (a < 24) return true;
    if (bgMode === "white") return r > 243 && gg > 243 && b > 243;
    if (bgMode === "black") return r < 18 && gg < 18 && b < 18;
    return false;
  };

  let minX = W, minY = H, maxX = -1, maxY = -1, n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (isBg((y * W + x) * 4)) continue;
    n++;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const bw = maxX - minX + 1, bh = maxY - minY + 1;

  // Width of the subject at 20 evenly spaced heights, as a FRACTION of the
  // bbox width, with the row's own left/right extents as fractions too — an
  // asymmetric subject (the treehouse's ladder, the tree's lean) shows up as a
  // centre that drifts.
  const bands = [];
  for (let i = 0; i < 20; i++) {
    const y = Math.min(maxY, minY + Math.round(((i + 0.5) / 20) * bh));
    let lo = -1, hi = -1, cnt = 0;
    for (let x = minX; x <= maxX; x++) {
      if (isBg((y * W + x) * 4)) continue;
      cnt++;
      if (lo < 0) lo = x;
      hi = x;
    }
    bands.push({
      yFrac: +((i + 0.5) / 20).toFixed(3),
      span: lo < 0 ? 0 : +((hi - lo + 1) / bw).toFixed(3),
      fill: +(cnt / bw).toFixed(3),
      cx: lo < 0 ? null : +(((lo + hi) / 2 - minX) / bw).toFixed(3),
    });
  }
  // Height of the subject at 12 columns, as a fraction of bbox height.
  const cols = [];
  for (let i = 0; i < 12; i++) {
    const x = Math.min(maxX, minX + Math.round(((i + 0.5) / 12) * bw));
    let lo = -1, hi = -1;
    for (let y = minY; y <= maxY; y++) {
      if (isBg((y * W + x) * 4)) continue;
      if (lo < 0) lo = y;
      hi = y;
    }
    cols.push({ xFrac: +((i + 0.5) / 12).toFixed(3), top: lo < 0 ? null : +((lo - minY) / bh).toFixed(3),
                bot: lo < 0 ? null : +((hi - minY) / bh).toFixed(3) });
  }
  return {
    image: { W, H },
    bbox: { minX, minY, maxX, maxY, w: bw, h: bh, widthOverHeight: +(bw / bh).toFixed(3) },
    coverage: +(n / (bw * bh)).toFixed(3),
    widthBands: bands,
    heightCols: cols,
  };
}, { b64, mime, bgMode });
console.log(JSON.stringify(res, null, 1));
await browser.close();
