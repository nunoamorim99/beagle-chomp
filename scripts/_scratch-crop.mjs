// SCRATCH: crop + nearest-neighbour zoom. Usage: node _scratch-crop.mjs in.png out.png x y w h zoom
import { chromium } from "playwright";
import fs from "node:fs";
const [inp, outp, x, y, w, h, z] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage();
const data = await page.evaluate(async ([s, x, y, w, h, z]) => {
  const im = new Image(); im.src = "data:image/png;base64," + s; await im.decode();
  const c = document.createElement("canvas"); c.width = w * z; c.height = h * z;
  const g = c.getContext("2d"); g.imageSmoothingEnabled = false;
  g.drawImage(im, x, y, w, h, 0, 0, w * z, h * z);
  return c.toDataURL("image/png").split(",")[1];
}, [fs.readFileSync(inp).toString("base64"), +x, +y, +w, +h, +z]);
fs.writeFileSync(outp, Buffer.from(data, "base64")); await browser.close();
