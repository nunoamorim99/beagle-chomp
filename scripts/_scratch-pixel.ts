// Reads pixels back out of .tmp-screens/*.png. See _scratch-menu-style.ts's
// header: if the script that WRITES those files failed, this one reports the
// previous run's image with no indication anything is wrong. The mtime line
// below is the cheapest available guard.
import { chromium } from "playwright";
import { statSync } from "node:fs";
import { resolve } from "node:path";
const b = await chromium.launch();
const p = await (await b.newContext()).newPage();
// MEDIAN OF A GRID, never a hand-picked pixel.
//
// Three times in this session a single coordinate landed on something other
// than what I labelled it — a dune instead of the ground, an island instead of
// the sea, a hedge instead of a corridor — and each time it produced a
// confident number that was simply about a different object. Sampling a region
// and taking the median lets AREA decide, which is what "what colour is the
// ground" actually means.
const code = `(async () => {
  const img = document.querySelector("img");
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  const median = (x0, y0, x1, y1) => {
    const ls = [], px = [];
    for (let y = y0; y < y1; y += 7) for (let x = x0; x < x1; x += 7) {
      const d = g.getImageData(x, y, 1, 1).data;
      ls.push((0.2126*d[0] + 0.7152*d[1] + 0.0722*d[2]) / 255);
      px.push([d[0], d[1], d[2]]);
    }
    const idx = ls.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0])[Math.floor(ls.length / 2)][1];
    const p = px[idx];
    return "#" + p.map(v => v.toString(16).padStart(2, "0")).join("") + " L" + ls[idx].toFixed(3) + " (n=" + ls.length + ")";
  };
  // The COLOUR CAST of a region: how far blue sits above red on average.
  // A cyan bounce pushes every rim and turned-away face toward blue, so the
  // mean B-R over a large area is the thing the complaint was about.
  const cast = (x0, y0, x1, y1) => {
    let r = 0, b = 0, n = 0;
    for (let y = y0; y < y1; y += 5) for (let x = x0; x < x1; x += 5) {
      const d = g.getImageData(x, y, 1, 1).data;
      r += d[0]; b += d[2]; n++;
    }
    return "B-R " + ((b - r) / n).toFixed(1);
  };
  return {
    "props above the board": median(40, 40, 740, 520) + "   " + cast(40, 40, 740, 520),
    "the board itself": median(120, 600, 660, 1140) + "   " + cast(120, 600, 660, 1140),
  };
})()`;
for (const f of ["theme-garden-classic", "theme-garden-madbox"]) {
  const age = Math.round((Date.now() - statSync(`.tmp-screens/${f}.png`).mtimeMs) / 1000);
  if (age > 300) console.log(`  !! ${f}.png is ${age}s old — probably NOT this build`);
  await p.goto("file:///" + resolve(`.tmp-screens/${f}.png`).split("\\").join("/"));
  console.log(f.padEnd(14), JSON.stringify(await p.evaluate(code)));
}
await b.close();
