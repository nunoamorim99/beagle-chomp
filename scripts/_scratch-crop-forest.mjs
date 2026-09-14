// IDEA-065: crop + upscale a region of a reference so agent vision can read
// detail that is a handful of pixels in the source.
//   npx tsx scripts/_scratch-crop-forest.mjs <img> <out> <x> <y> <w> <h> [zoom]
import { chromium } from "playwright";
import fs from "node:fs";

const [img, out, x, y, w, h, zoom = "3"] = process.argv.slice(2);
const b64 = fs.readFileSync(img).toString("base64");
const Z = Number(zoom);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Math.round(Number(w) * Z), height: Math.round(Number(h) * Z) } });
await page.setContent(`<body style="margin:0;background:#fff">
<canvas id="c" width="${Math.round(Number(w) * Z)}" height="${Math.round(Number(h) * Z)}" style="display:block"></canvas>
<script>
(async () => {
  const im = new Image(); im.src = "data:image/png;base64,${b64}"; await im.decode();
  const g = document.getElementById("c").getContext("2d");
  g.imageSmoothingEnabled = false;
  g.drawImage(im, ${x}, ${y}, ${w}, ${h}, 0, 0, ${Math.round(Number(w) * Z)}, ${Math.round(Number(h) * Z)});
  document.title = "ready";
})();
</script></body>`);
await page.waitForFunction(() => document.title === "ready");
await page.screenshot({ path: out });
await browser.close();
console.log(out);
