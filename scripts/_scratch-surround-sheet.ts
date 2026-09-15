// IDEA-066: the review sheet. Every theme, at the two framings that matter.
//
// A board is not an enemy skin: it has ONE camera a player ever sees, and the
// two framings of it see nearly disjoint regions -- a phone sees 27 units of
// depth to the north and almost nothing sideways, a desktop sees the opposite.
// So the sheet is per theme x {phone, desktop}, not a turntable, and `clay`
// is included because a distant object IS its silhouette (IDEA-059's burger
// came back as "a red egg with a stripe" in colour; only ?flat=1 showed it).
//
//   npm run dev
//   npx tsx scripts/_scratch-surround-sheet.ts [label]
//   THEMES=garden,forest CLAY=0 npx tsx scripts/_scratch-surround-sheet.ts
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const label = process.argv[2] ?? "now";
const base = process.env.BASE ?? "http://127.0.0.1:5173";
const themes = (process.env.THEMES ?? "garden,classic,forest,park,city,beach").split(",");
const clay = process.env.CLAY !== "0";
const OUT = `.img2threejs/garden-board/renders/${label}`;
mkdirSync(OUT, { recursive: true });

const FRAMINGS = [
  { id: "phone", width: 390, height: 844 },
  { id: "desktop", width: 1280, height: 800 },
];

const browser = await chromium.launch();
const errors: string[] = [];
for (const theme of themes) {
  for (const f of FRAMINGS) {
    for (const flat of clay && f.id === "phone" ? [false, true] : [false]) {
      const page = await browser.newPage({
        viewport: { width: f.width, height: f.height },
        deviceScaleFactor: 2,
        reducedMotion: "reduce",
      });
      page.on("pageerror", (e) => errors.push(`${theme}/${f.id}: ${e.message}`));
      const url = `${base}/preview-board/?theme=${theme}&maze=0&view=game&hud=0${flat ? "&flat=1" : ""}`;
      await page.goto(url, { waitUntil: "load", timeout: 90000 });
      await page.waitForFunction(() => document.title.includes("ready"), null, { timeout: 20000 });
      await page.waitForTimeout(350);
      const name = `${theme}-${f.id}${flat ? "-clay" : ""}.png`;
      await page.screenshot({ path: `${OUT}/${name}` });
      console.log(`  ${name}`);
      await page.close();
    }
  }
}
await browser.close();
if (errors.length) {
  console.log("\npage errors:");
  for (const e of errors) console.log("  " + e);
  process.exitCode = 1;
}
console.log(`\nwrote ${OUT}`);
