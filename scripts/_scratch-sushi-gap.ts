// Scratch: the prawn-cap / rice-block junction at the angles that matter.
// el=12 is the review turntable, el=59 is the GAME camera, el=6 is a
// deliberately extreme angle the game never uses — kept because it is where a
// gap shows first, not because it has to be clean.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const out = process.env.OUT ?? ".img2threejs/nigiri/renders/gap";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
const shots: [string, string][] = [
  ["side-el6", "az=90&el=6"],
  ["quarter-el12", "az=40&el=12"],
  ["quarter-el59", "az=40&el=59"],
  ["clay-el12", "az=40&el=12&flat=1"],
];
for (const [name, qs] of shots) {
  await page.goto(`http://localhost:5173/preview-rework/?model=nigiri&${qs}&grid=0&hud=0&dist=1.35`, {
    waitUntil: "networkidle",
  });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${out}/${name}.png` });
}
await browser.close();
console.log("wrote", out);
