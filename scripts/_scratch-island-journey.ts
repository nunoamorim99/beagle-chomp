// Pirate Island (IDEA-085): photograph a Journey island of the island theme.
// Level 8 (idx 7) is the first; `pan` frames the chain at that z.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const OUT = ".img2threejs/pirate-island/renders/journey";
mkdirSync(OUT, { recursive: true });
const pans = (process.env.PANS ?? "52,56").split(",");
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: Number(process.env.W ?? 390), height: Number(process.env.H ?? 844) }, deviceScaleFactor: 2 });
p.setDefaultNavigationTimeout(120_000);
for (const pan of pans) {
  await p.goto(`http://localhost:5173/preview-journey/?progress=${pan}`);
  await p.waitForTimeout(6000);
  await p.screenshot({ path: `${OUT}/progress-${pan}.png` });
}
await b.close();
console.log(OUT);
