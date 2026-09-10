// Scratch: the EYES, close up, against the rest of the cast.
// The question this answers is not "do they look nice" but "are they built the
// way every other enemy's are" — a white sclera with a dark pupil cap that
// darts on its pivot, and a frightened state that whitens the PUPIL against
// that white rather than the whole eye.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const out = process.env.OUT ?? ".img2threejs/nigiri/renders/eyes";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 760, height: 760 } });
const models = (process.env.MODELS ?? "nigiri,maki,pizza,crab").split(",");
for (const m of models) {
  for (const [tag, extra] of [
    ["normal", ""],
    ["frightened", "&state=frightened"],
  ] as [string, string][]) {
    const url =
      `http://localhost:5173/preview-rework/?model=${m}&az=0&el=14&grid=0&hud=0` +
      `&dist=1.05&fov=18${extra}`;
    await page.goto(url, { waitUntil: "load" });
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${out}/${m}-${tag}.png` });
  }
}
await browser.close();
console.log("wrote", out);
