// SCRATCH: print colour + luminance at points (median of a 3x3 box). Usage: node _scratch-px-at.mjs img.png x,y x,y ...
import { chromium } from "playwright";
import fs from "node:fs";
const [img, ...pts] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage();
const out = await page.evaluate(async ([s, pts]) => {
  const im = new Image(); im.src = "data:image/png;base64," + s; await im.decode();
  const c = document.createElement("canvas"); c.width = im.width; c.height = im.height;
  const g = c.getContext("2d"); g.drawImage(im, 0, 0);
  return pts.map((p) => { const [x, y] = p.split(",").map(Number);
    const d = g.getImageData(x - 1, y - 1, 3, 3).data; let r = 0, gg = 0, b = 0;
    for (let i = 0; i < 36; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
    r /= 9; gg /= 9; b /= 9;
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const L = 0.2126 * lin(r) + 0.7152 * lin(gg) + 0.0722 * lin(b);
    return `${p}  rgb(${r|0},${gg|0},${b|0})  relL ${L.toFixed(3)}`; });
}, [fs.readFileSync(img).toString("base64"), pts]);
console.log(out.join("\n")); await browser.close();
