// IDEA-060: the five flowers rendered TOGETHER at the same scale, same
// lighting and the same camera.
//
// IDEA-056 rule 1: two subjects that share a palette are separated by
// SILHOUETTE, and that is verified by rendering them side by side, never by
// assertion. The rose and the tulip are both red here, so this sheet is the
// only thing that can answer whether they are two flowers or one flower
// twice — and the second row is the PLAY camera's 59 degrees of elevation,
// which is the only angle a player ever sees them from.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const label = process.argv[2] ?? "v1";
const base = "http://localhost:5173";
const KINDS = ["daisy", "sunflower", "rose", "tulip", "blossom"];
const OUT = `.img2threejs/garden-props/renders/${label}-flowers`;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 460, height: 620 } });
for (const el of [12, 59]) {
  for (const kind of KINDS) {
    await page.goto(`${base}/preview-rework/?model=prop-${kind}&az=25&el=${el}&grid=0&hud=0&toon=1&dist=2.6`, {
      waitUntil: "load",
    });
    await page.waitForFunction(() => document.title.includes("ready"), null, { timeout: 15000 });
    await page.waitForTimeout(160);
    await page.screenshot({ path: `${OUT}/${kind}-el${el}.png` });
  }
}
console.log("wrote", OUT);
await browser.close();
