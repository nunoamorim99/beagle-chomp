// Scratch diagnostic (delete before commit): the hero close-up only, at 4x.
import { chromium } from "playwright";

const label = process.argv[2] ?? "hero";
const only = process.argv[3] ?? "slowGhosts";
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1600, height: 1200 },
  deviceScaleFactor: 4,
});
await page.goto(`http://localhost:5173/preview/pickups.html?zoom=6&only=${only}`, {
  waitUntil: "networkidle",
});
await page.waitForFunction(() => document.title.includes("ready"), null, { timeout: 20_000 });

const box = await page.locator("#sheet").boundingBox();
if (!box) throw new Error("no sheet");
await page.screenshot({
  path: `.tmp-screens/anchor-${label}-4x.png`,
  clip: { x: box.x + 8, y: box.y + 30, width: 275, height: 275 },
});
await browser.close();
console.log(`→ .tmp-screens/anchor-${label}-4x.png`);
