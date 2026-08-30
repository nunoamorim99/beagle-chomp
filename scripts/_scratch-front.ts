// Scratch diagnostic (delete before commit): front-ortho + silhouette of makeAnchor.
import { chromium } from "playwright";

const label = process.argv[2] ?? "front";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1900, height: 700 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
const mesh = process.argv[3] ?? "anchor";
await page.goto(`http://localhost:5173/preview/_scratch-anchor.html?mesh=${mesh}`, { waitUntil: "networkidle" });
await page.waitForFunction(() => document.title.includes("ready"), null, { timeout: 20_000 });
await page.locator("#wrap").screenshot({ path: `.tmp-screens/anchor-${label}-ortho.png` });
await page
  .locator("#wrap canvas")
  .first()
  .screenshot({ path: `.tmp-screens/anchor-${label}-front.png` });
// Panel 2 is the MeshBasicMaterial pass: unlit, no maps — the map-stripped
// evidence append_review requires before it will credit a blockout pass.
await page
  .locator("#wrap canvas")
  .nth(1)
  .screenshot({ path: `.tmp-screens/anchor-${label}-silhouette.png` });
await browser.close();
console.log(`→ .tmp-screens/anchor-${label}-ortho.png`);
if (errors.length) {
  for (const e of errors) console.log(`  ${e}`);
  process.exit(1);
}
