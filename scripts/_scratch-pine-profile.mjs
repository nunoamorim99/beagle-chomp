// IDEA-065: the two numbers that decide whether a conifer is a CONE or a
// stack of drooping whorls.
//
//  1. TIER PERIOD + AMPLITUDE — the low-frequency oscillation of the
//     half-width down the tree. A smooth cone has amplitude 0.
//  2. SERRATION DEPTH — the high-frequency residual on the silhouette edge
//     after the tier trend is removed. That is the needle sawtooth, and it
//     is what "cartoon foliage" means at the outline.
//
// Both are reported as a fraction of the tree's own max half-width, so they
// port straight into a build at any scale.
import { chromium } from "playwright";
import fs from "node:fs";

const [img, y0s, y1s] = process.argv.slice(2);
const b64 = fs.readFileSync(img).toString("base64");
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent("<body style='margin:0'></body>");
const res = await page.evaluate(async ({ b64, y0s, y1s }) => {
  const im = new Image(); im.src = "data:image/png;base64," + b64; await im.decode();
  const W = im.naturalWidth, H = im.naturalHeight;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(im, 0, 0);
  const d = g.getImageData(0, 0, W, H).data;
  const isBg = (x, y) => {
    const i = (y * W + x) * 4;
    if (d[i + 3] < 16) return true;
    return d[i] > 236 && d[i + 1] > 236 && d[i + 2] > 236;
  };
  const y0 = Number(y0s), y1 = Number(y1s);
  // Per-row left/right edges over the TREE band only (the caller excludes
  // the ground shadow, which is non-white and would otherwise be measured
  // as the widest part of the tree).
  const L = [], R = [];
  for (let y = y0; y <= y1; y++) {
    let a0 = -1, a1 = -1;
    for (let x = 0; x < W; x++) if (!isBg(x, y)) { if (a0 < 0) a0 = x; a1 = x; }
    L.push(a0); R.push(a1);
  }
  const n = L.length;
  const cx = (Math.min(...L.filter(v => v >= 0)) + Math.max(...R)) / 2;
  const half = L.map((l, i) => (l < 0 ? 0 : (R[i] - l) / 2));
  const maxHalf = Math.max(...half);
  // Smooth at two scales: a wide window kills the tiers (the cone trend),
  // a narrow one keeps them but kills the serration.
  const smooth = (a, win) => a.map((_, i) => {
    let s = 0, k = 0;
    for (let j = Math.max(0, i - win); j <= Math.min(a.length - 1, i + win); j++) { s += a[j]; k++; }
    return s / k;
  });
  const trend = smooth(half, Math.round(n * 0.18));   // the cone
  const tiers = smooth(half, Math.round(n * 0.012));  // cone + tiers
  const tierResid = half.map((v, i) => tiers[i] - trend[i]);
  const serrResid = half.map((v, i) => v - tiers[i]);
  const sd = (a) => { const m = a.reduce((s, v) => s + v, 0) / a.length; return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length); };
  // Count tier maxima: sign changes of the tier residual's slope, downward.
  const peaks = [];
  for (let i = 2; i < n - 2; i++) {
    if (tierResid[i] > tierResid[i - 2] && tierResid[i] >= tierResid[i + 2] && tierResid[i] > 0.15 * sd(tierResid)) {
      if (!peaks.length || i - peaks[peaks.length - 1] > n * 0.05) peaks.push(i);
    }
  }
  return {
    rows: n, maxHalfPx: +maxHalf.toFixed(1),
    widestAtFracFromTop: +(half.indexOf(maxHalf) / n).toFixed(3),
    tierAmplitudeSd: +(sd(tierResid) / maxHalf).toFixed(4),
    tierPeakCount: peaks.length,
    tierPeriodFracOfHeight: peaks.length > 1 ? +(((peaks[peaks.length - 1] - peaks[0]) / (peaks.length - 1)) / n).toFixed(3) : null,
    serrationSd: +(sd(serrResid) / maxHalf).toFixed(4),
    serrationMaxPx: +Math.max(...serrResid.map(Math.abs)).toFixed(1),
    // The trend itself, as 11 samples: is the cone straight-sided or belled?
    trendProfile: Array.from({ length: 11 }, (_, k) => +(trend[Math.round(k * (n - 1) / 10)] / maxHalf).toFixed(3)),
  };
}, { b64, y0s, y1s });
console.log(JSON.stringify(res, null, 1));
await browser.close();
