// Crop a reference PNG region to a file (headless canvas). Usage:
//   node scripts/_scratch-crop-ref.mjs <img> <out.png> <x> <y> <w> <h> [scale]
import { chromium } from "playwright";
import fs from "node:fs";
const [img, out, x, y, w, h, scale = "1"] = process.argv.slice(2);
const b64 = fs.readFileSync(img).toString("base64");
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent("<body style='margin:0'></body>");
const data = await page.evaluate(async (a) => {
  const im = new Image(); im.src = "data:image/png;base64," + a.b64; await im.decode();
  const s = Number(a.scale);
  const c = document.createElement("canvas");
  c.width = Math.round(Number(a.w) * s); c.height = Math.round(Number(a.h) * s);
  const g = c.getContext("2d");
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, c.width, c.height); // flatten alpha so shapes read
  g.imageSmoothingQuality = "high";
  g.drawImage(im, Number(a.x), Number(a.y), Number(a.w), Number(a.h), 0, 0, c.width, c.height);
  return c.toDataURL("image/png").split(",")[1];
}, { b64, x, y, w, h, scale });
fs.writeFileSync(out, Buffer.from(data, "base64"));
console.log("wrote", out);
await browser.close();
