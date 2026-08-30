// Scratch diagnostic (delete before commit): magnify a region of the reference.
//   npx tsx scripts/_scratch-zoom.ts <x> <y> <w> <h> <label>
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const [x, y, w, h] = process.argv.slice(2, 6).map(Number);
const label = process.argv[6] ?? "zoom";
const SCALE = 8;

const b64 = readFileSync(".img2threejs/reference/anchor.jpg").toString("base64");
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: w * SCALE + 20, height: h * SCALE + 20 },
});
await page.setContent(`
  <body style="margin:0;background:#fff">
    <div style="width:${w * SCALE}px;height:${h * SCALE}px;overflow:hidden;position:relative">
      <img src="data:image/jpeg;base64,${b64}"
           style="position:absolute;left:${-x * SCALE}px;top:${-y * SCALE}px;
                  width:${211 * SCALE}px;image-rendering:pixelated" />
    </div>
  </body>`);
await page.waitForTimeout(300);
await page.locator("div").first().screenshot({ path: `.tmp-screens/ref-${label}.png` });
await browser.close();
console.log(`→ .tmp-screens/ref-${label}.png`);
