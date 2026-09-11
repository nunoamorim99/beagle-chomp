// IDEA-060: turntable + clay for every garden prop, in ONE browser session.
//
// shoot-rework.ts launches a browser per subject, which is fine for a single
// enemy skin and is nine launches here. Same views, same page, one launch.
//
//   MODELS=prop-shrub,prop-tree  VIEWS=34,front  FLAT=1  npx tsx scripts/_scratch-shoot-props.ts <label>
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const label = process.argv[2] ?? "v1";
const base = process.argv[3] ?? "http://localhost:5173";
const models = (
  process.env.MODELS ??
  "prop-shrub,prop-tree,prop-treehouse,prop-birdhouse,prop-daisy,prop-sunflower,prop-rose,prop-tulip,prop-blossom"
).split(",");
const views = (process.env.VIEWS ?? "34,front,right,rear").split(",");
const flat = process.env.FLAT === "1" ? "&flat=1" : "";
const suffix = process.env.FLAT === "1" ? "-clay" : "";
const VIEW_QS: Record<string, string> = {
  "34": "view=34", front: "az=0", right: "az=90", rear: "az=180", left: "az=270", top: "view=top",
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 700, height: 700 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});

for (const model of models) {
  const dir = `.img2threejs/garden-props/renders/${label}${suffix}/${model}`;
  mkdirSync(dir, { recursive: true });
  for (const view of views) {
    const qs = VIEW_QS[view] ?? `az=${view}`;
    await page.goto(`${base}/preview-rework/?${qs}&model=${model}&grid=0&hud=0&toon=1${flat}`, {
      waitUntil: "load",
    });
    await page.waitForFunction(() => document.title.includes("ready"), null, { timeout: 15000 });
    await page.waitForTimeout(180);
    await page.screenshot({ path: `${dir}/${view}.png` });
  }
  // The HUD carries the measured envelope and triangle count, which is the
  // number worth reading alongside the picture.
  const hud = await page.evaluate(() => document.getElementById("hud")?.textContent ?? "");
  console.log(`--- ${model}\n${hud}`);
}

if (errors.length) {
  console.log("\nPAGE ERRORS:");
  for (const e of new Set(errors)) console.log("  " + e);
}
await browser.close();
