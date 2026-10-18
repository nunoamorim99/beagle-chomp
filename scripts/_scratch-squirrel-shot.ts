// SCRATCH (IDEA-065 v29): the squirrel's plume alone, three framings in one
// sheet — the play camera, a side-on three-quarter, and the CLAY pass.
//
// The full critter sheet is 24 navigations and the question here is about one
// prop, so this is the iteration instrument and the sheet is the check.
// It DEFAULTS to the shipped style, like every other harness in this project
// since IDEA-079 (`STYLE=classic` is the A/B) — `_scratch-critter-sheet.ts`
// forced `&toon=1` for four releases and every judgement made on it was about
// a look no player has had.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const label = process.argv[2] ?? "now";
const model = process.argv[3] ?? "prop-squirrel";
const base = "http://localhost:5173";
const style = process.env.STYLE === "classic" ? "&toon=1&style=classic" : "";
// Side-on is the view the references are drawn at, and the play camera is the
// one a player has. Neither alone settles a tail.
const SHOTS: [string, string][] = [
  ["play", "az=25&el=59"],
  ["side", "az=90&el=8"],
  ["34", "az=42&el=12"],
  ["clay", "az=42&el=12&flat=1"],
];

const out = `.img2threejs/forest-critters/renders/${label}`;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 460, height: 460 } });
const shots: string[] = [];
for (const [, q] of SHOTS) {
  await page.goto(`${base}/preview-rework/?${q}&model=${model}&grid=0&hud=0${style}`, {
    waitUntil: "load",
    timeout: 120000,
  });
  await page.waitForFunction(() => document.title.includes("ready"), null, { timeout: 20000 });
  await page.waitForTimeout(150);
  shots.push((await page.screenshot({ type: "png" })).toString("base64"));
}
const sheet = await page.evaluate(async (list: string[]) => {
  const W = 460;
  const c = document.createElement("canvas");
  c.width = W * list.length;
  c.height = W;
  const g = c.getContext("2d")!;
  g.fillStyle = "#eae6df";
  g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < list.length; i++) {
    const im = new Image();
    im.src = "data:image/png;base64," + list[i];
    await im.decode();
    g.drawImage(im, i * W, 0);
  }
  return c.toDataURL("image/png");
}, shots);
const { writeFileSync } = await import("node:fs");
writeFileSync(`${out}/${model}-sheet.png`, Buffer.from(sheet.split(",")[1], "base64"));
await browser.close();
console.log(`${out}/${model}-sheet.png   ${SHOTS.map((s) => s[0]).join(" | ")}`);
