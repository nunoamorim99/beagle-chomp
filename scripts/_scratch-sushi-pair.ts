// Scratch: the two sushi skins side by side at the SAME team colour and the
// SAME play-camera angle. IDEA-057's #1 recorded risk is that the nigiri reads
// as the maki: both are team-coloured and both are recoloured again when
// frightened, so colour cannot separate them and the check has to be a render,
// not an assertion.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const out = process.env.OUT ?? ".img2threejs/evidence";
const el = process.env.EL ?? "59";
const state = process.env.STATE ? `&state=${process.env.STATE}` : "";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 700, height: 700 } });
for (const model of ["maki", "nigiri"]) {
  await page.goto(
    `http://localhost:5173/preview-rework/?model=${model}&az=18&el=${el}&grid=0&hud=0&color=15229279${state}`,
    { waitUntil: "networkidle" },
  );
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/pair-${model}.png` });
}
await browser.close();
console.log("wrote", `${out}/pair-{maki,nigiri}.png`);
