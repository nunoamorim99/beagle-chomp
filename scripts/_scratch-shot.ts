// One-off screenshot of a /preview-rework/ URL, for views the turntable script
// does not cover (top-down, clay, frightened, side-by-side colour checks).
//
//   npx tsx scripts/_scratch-shot.ts "<url>" "<out.png>"
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const url = process.argv[2];
const out = process.argv[3];
if (!url || !out) throw new Error("usage: _scratch-shot.ts <url> <out.png>");
mkdirSync(dirname(out), { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } });
for (let attempt = 0; attempt < 3; attempt++) {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.title.includes("ready"), null, { timeout: 20_000 });
  await page.waitForTimeout(400);
  const buf = await page.screenshot({ path: out });
  if (buf.length > 20_000) break;
}
console.log((await page.textContent("#hud")) ?? "");
console.log("→", out);
await browser.close();
