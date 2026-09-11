// Scratch: the three FOOD skins side by side at the SAME team colour and the
// SAME play-camera angle. IDEA-058's recorded risk is that the pizza joins the
// maki/nigiri cluster: all three are food, all three stand on two legs, all
// three take the team colour and all three are recoloured again when
// frightened — so colour cannot separate them and the check has to be a
// render, not an assertion.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const out = process.env.OUT ?? ".img2threejs/evidence";
const el = process.env.EL ?? "59";
const state = process.env.STATE ? `&state=${process.env.STATE}` : "";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 700, height: 700 } });
for (const model of ["maki", "nigiri", "pizza", "burger"]) {
  await page.goto(
    `http://localhost:5173/preview-rework/?model=${model}&az=18&el=${el}&grid=0&hud=0&color=15229279${state}`,
    { waitUntil: "networkidle" },
  );
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/pair-${model}.png` });
}
await browser.close();
console.log("wrote", `${out}/pair-{maki,nigiri,pizza}.png`);
