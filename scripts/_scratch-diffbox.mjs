// Where do two renders differ? Prints the bounding box of changed pixels.
import { chromium } from "playwright";
import fs from "node:fs";
const [a, b] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent("<body></body>");
const out = await page.evaluate(async ([ia, ib]) => {
  const load = async (d) => { const im = new Image(); im.src = "data:image/png;base64," + d; await im.decode(); const c = document.createElement("canvas"); c.width = im.width; c.height = im.height; c.getContext("2d").drawImage(im, 0, 0); return c.getContext("2d").getImageData(0, 0, c.width, c.height); };
  const A = await load(ia), B = await load(ib);
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0;
  for (let i = 0; i < A.data.length; i += 4) {
    const d = Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i+1] - B.data[i+1]) + Math.abs(A.data[i+2] - B.data[i+2]);
    if (d > 12) { const p = i / 4, x = p % A.width, y = (p / A.width) | 0; n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return { n, x0, y0, x1, y1 };
}, [fs.readFileSync(a).toString("base64"), fs.readFileSync(b).toString("base64")]);
console.log(JSON.stringify(out));
await browser.close();
