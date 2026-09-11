// IDEA-060: screenshots /preview-board/ — the board review harness.
//
//   npm run dev
//   npx tsx scripts/shoot-board.ts [label] [baseUrl]
//
// Writes .img2threejs/<SUBJECT>/renders/<label>/<view>.png, one per view in
// VIEWS. Env knobs mirror the page's query string:
//   THEME=garden   MAZE=0   FLAT=1   FENCE=0   VIEWS=game,close
//
// The default view set is deliberately NOT a turntable. A board has exactly
// one camera a player ever sees; `close` is that camera's magnification, and
// `hero`/`top` exist to read silhouette and grid work respectively.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const label = process.argv[2] ?? "now";
const baseUrl = process.argv[3] ?? "http://localhost:5173";
const subject = process.env.SUBJECT ?? "garden-board";
const theme = process.env.THEME ?? "garden";
const maze = process.env.MAZE ?? "0";
const flat = process.env.FLAT === "1" ? "&flat=1" : "";
const fence = process.env.FENCE === "0" ? "&fence=0" : "";
const views = (process.env.VIEWS ?? "game,close,hero,top").split(",");

const OUT = `.img2threejs/${subject}/renders/${label}`;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
// 1000x1000 matches shoot-rework.ts so the two sets of evidence are
// comparable, EXCEPT for `game`: the shipped camera fits the board to the
// viewport, so a square frame is not what a player has. That view is shot at
// 390x844 — a real phone — because the whole question about a board surface is
// whether it survives being that small.
const errors: string[] = [];

for (const view of views) {
  const phone = view === "game";
  const page = await browser.newPage({
    viewport: phone ? { width: 390, height: 844 } : { width: 1000, height: 1000 },
    deviceScaleFactor: 2,
  });
  page.on("pageerror", (e) => errors.push(`${view}: ${e}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`${view}: ${m.text()}`);
  });

  const url = `${baseUrl}/preview-board/?theme=${theme}&maze=${maze}&view=${view}&hud=0${flat}${fence}`;
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => document.title.includes("ready"), null, { timeout: 20000 });
  // One extra frame: the rig's resize() runs on load and the fit dolly is
  // computed from the real viewport, so the first painted frame can be the
  // pre-fit one.
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${view}.png` });
  console.log(`${OUT}/${view}.png`);
  await page.close();
}

if (errors.length) {
  console.log("\nPAGE ERRORS:");
  for (const e of errors) console.log("  " + e);
}
await browser.close();
