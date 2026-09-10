// Scratch: every review view of the burger in ONE browser session.
//
// Four instruments, because each has caught a defect class the others passed:
//
//  - PLAY CAMERA (el=59, scene.ts BASE_POS). IDEA-055's rule: a turntable's
//    comfortable 12-30 degrees is not the angle this game is played at, and the
//    burger's whole identity is stacked along the ONE axis a 59-degree camera
//    foreshortens.
//  - FRIGHTENED. The state where three of the four food skins go blue in most
//    of the same places, and where IDEA-053's flea lost its segment bands.
//  - CLAY (?flat=1). Map-stripped, so the FORM is judged with nothing to
//    flatter it. It is what found the flea's frightened recolour and the
//    mosquito's abdomen droop; in colour both looked finished.
//  - FIVE HUES. The burger's bread IS bodyMat, so the largest mass on the model
//    is a different colour on every team - and two of its fixed garnish colours
//    (lettuce green, tomato red) sit near two of the five team hues.
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
// The sheet inlines every shot as a data: URI rather than pointing at it with
// a file:// URL. Chromium refuses file:// SUBRESOURCES on a page created by
// setContent(), because that page has an opaque origin — and the refusal is
// silent: every cell renders as an empty frame with its caption underneath,
// which looks like a finished sheet of blank models rather than like a broken
// sheet. Worth knowing before trusting any contact sheet built this way.

const OUT = process.env.OUT ?? ".img2threejs/burger/evidence";
mkdirSync(OUT, { recursive: true });
const BASE = `${process.env.HOST ?? "http://localhost:5173"}/preview-rework/`;
const ROSE = 0xe0577a;
const HUES: readonly (readonly [string, number])[] = [
  ["rose", 0xe0577a], ["teal", 0x53c7c0], ["amber", 0xe8a23d],
  ["violet", 0x9b6bd6], ["leaf", 0x6fb84a],
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 620, height: 620 } });

async function shot(name: string, qs: string, alpha = false) {
  await page.goto(`${BASE}?grid=0&hud=0&${qs}`, {
    waitUntil: "domcontentloaded", timeout: 90_000,
  });
  await page.waitForFunction(() => document.title.includes("ready"), null, { timeout: 30_000 });
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${OUT}/${name}.png`, omitBackground: alpha });
  return `${OUT}/${name}.png`;
}

const cells: { path: string; label: string }[] = [];
const push = async (n: string, qs: string, label: string, a = false) =>
  cells.push({ path: await shot(n, qs, a), label });

await push("play", `model=burger&az=0&el=59&color=${ROSE}`, "play camera, el 59");
await push("play34", `model=burger&az=32&el=59&color=${ROSE}`, "play camera, az 32");
await push("fright", `model=burger&az=0&el=59&state=frightened&color=${ROSE}`, "frightened");
await push("clay", `model=burger&az=20&el=40&flat=1&color=${ROSE}`, "clay (form only)");
for (const [n, c] of HUES) {
  await push(`hue-${n}`, `model=burger&az=0&el=59&color=${c}`, `team ${n}`);
}

// One contact sheet. Nine separate PNGs are nine separate looks; the question
// "does the banding survive everything this model is put through" is only
// answerable side by side.
const cols = 5;
const rows = Math.ceil(cells.length / cols);
const html = `<body style="margin:0;background:#efe9e2;display:grid;
  grid-template-columns:repeat(${cols},620px);width:${cols * 620}px;height:${rows * 660}px">
  ${cells.map((c) => `<div style="position:relative;height:660px">
    <img src="data:image/png;base64,${readFileSync(c.path).toString("base64")}"
         style="width:620px;height:620px">
    <div style="position:absolute;bottom:6px;width:100%;text-align:center;
      font:600 24px system-ui;color:#3a2a20">${c.label}</div>
  </div>`).join("")}
</body>`;
await page.setViewportSize({ width: cols * 620, height: rows * 660 });
await page.setContent(html);
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/review-sheet.png` });
await browser.close();
console.log(`wrote ${OUT}/review-sheet.png (${cells.length} cells)`);
