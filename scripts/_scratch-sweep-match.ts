// Camera sweep for reference-matched Tier-1 framing: captures a grid of
// (dist, az, el) and leaves the PNGs in .img2threejs/renders/sweep/.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const OUT = ".img2threejs/renders/sweep";
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 780, height: 1125 } });
for (const dist of [2.0, 2.15, 2.3]) {
  for (const az of [38, 44, 50]) {
    for (const el of [10, 15, 20]) {
      await p.goto(
        `http://localhost:5173/preview-rework/?az=${az}&el=${el}&dist=${dist}&grid=0&hud=0`,
        { waitUntil: "networkidle" },
      );
      await p.waitForFunction(() => document.title.includes("ready"), null, { timeout: 20_000 });
      await p.screenshot({ path: `${OUT}/d${dist}-a${az}-e${el}.png` });
    }
  }
}
await b.close();
console.log("sweep captured");
