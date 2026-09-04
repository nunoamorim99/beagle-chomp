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
const OUT = `.img2threejs/renders/${label}`;

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
    await page.goto(`${baseUrl}/preview-rework/?${qs}&grid=0&hud=0${toon}`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.title.includes("ready"), null, { timeout: 20_000 });
    await page.waitForTimeout(400);
    const buf = await page.screenshot({ path: `${OUT}/${name}.png` });
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
