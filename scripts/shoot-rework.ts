// Screenshots the dev-only rework preview (/preview-rework/) for the
// img2threejs review gates: a full turntable plus the reference-matched 3/4.
//
//   npm run dev
//   npx tsx scripts/shoot-rework.ts [label] [baseUrl]
//
// Writes .img2threejs/renders/<label>/{34,front,right,rear,left}.png.
// Extra query knobs via env: TOON=1 adds &toon=1 to every view.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const label = process.argv[2] ?? "now";
const baseUrl = process.argv[3] ?? "http://localhost:5173";
const toon = process.env.TOON === "1" ? "&toon=1" : "";
// FLAT=1 captures the map-stripped CLAY turntable, which is a required review
// artefact rather than a nicety: the flea's frightened-recolour defect was
// invisible in colour and only the clay render showed it. STATE=frightened|eaten
// captures the two recolours an enemy skin has to survive.
const flat = process.env.FLAT === "1" ? "&flat=1" : "";
const state = process.env.STATE ? `&state=${process.env.STATE}` : "";
// DIST/EL match the REVIEW framing to the reference's. Tier 1 diagnostics
// compare silhouette IoU and scale against the reference image, so a render
// framed at the viewer's comfortable default fails on FRAMING and reports it
// as a model defect — measured: IoU 0.332 and a 0.584 scale delta on a model
// the turntable gate passes.
const dist = process.env.DIST ? `&dist=${process.env.DIST}` : "";
const elev = process.env.EL ? `&el=${process.env.EL}` : "";
const fov = process.env.FOV ? `&fov=${process.env.FOV}` : "";
// BG/SHADOW re-shoot for the segmentation gate. turntable_gate.py decides what
// is background by COLOUR, so a subject with near-white surfaces (rice, gloves,
// boots) and a pale ground shadow gets both counted as background and flood
// filled into "interior holes". BG=0x120a3a SHADOW=0 removes both ambiguities
// at once, which is what tells a real hole from a segmentation artefact.
const bg = process.env.BG ? `&bg=${process.env.BG}` : "";
const shadow = process.env.SHADOW === "0" ? "&shadow=0" : "";
// MODEL picks which generated rework factory the viewer builds (beagle|flea).
// Renders land under that subject's own workspace so two runs never overwrite
// each other's evidence.
const model = process.env.MODEL ?? "beagle";
const OUT =
  model === "beagle"
    ? `.img2threejs/renders/${label}`
    : `.img2threejs/${model}/renders/${label}`;

mkdirSync(OUT, { recursive: true });

const VIEWS: Record<string, string> = {
  "34": "view=34",
  front: "az=0",
  right: "az=90",
  rear: "az=180",
  left: "az=270",
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } });

const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});

let hud = "";
for (const [name, qs] of Object.entries(VIEWS)) {
  // The session's first navigation sometimes presents a blank canvas (GPU
  // warm-up); a blank full-page PNG is ~5KB vs ~50KB+ for a real frame, so
  // retry on suspiciously small screenshots.
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto(`${baseUrl}/preview-rework/?${qs}&model=${model}&grid=0&hud=0${toon}${flat}${state}${dist}${elev}${fov}${bg}${shadow}`, {
      // "domcontentloaded", not "networkidle". The Vite dev server holds an
      // open HMR websocket, so the network is never idle and every view after
      // the first times out — which looks like a broken model and is a broken
      // wait. The readiness signal is the page's own title, checked below.
      waitUntil: "domcontentloaded",
      // A cold Vite dev server transforms characters.ts (7k lines) on the first
      // request for it and can take well past Playwright's 30s default.
      timeout: 90_000,
    });
    await page.waitForFunction(() => document.title.includes("ready"), null, { timeout: 20_000 });
    await page.waitForTimeout(400);
    // omitBackground is half of what BG=none needs: without it Playwright
    // composites the page over opaque white and the alpha never reaches the
    // PNG, so the gate falls back to guessing at colour again — which looked
    // exactly like a pass on a transparent render and was not one. The other
    // half is the page's own CSS background, cleared in the viewer.
    const buf = await page.screenshot({
      path: `${OUT}/${name}.png`,
      omitBackground: process.env.BG === "none",
    });
    if (buf.length > 20_000) break;
  }
  if (name === "34") hud = (await page.textContent("#hud")) ?? "";
}
await browser.close();

console.log(hud);
console.log(`→ ${OUT}/{${Object.keys(VIEWS).join(",")}}.png`);
if (errors.length) {
  console.log("\npage errors:");
  for (const e of errors) console.log(`  ${e}`);
  process.exit(1);
}
