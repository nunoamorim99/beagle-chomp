// Captures a reference-matched framing of the rework model for Tier-1:
// viewport aspect = the reference dog-bbox crop (780x1125), camera at the
// reference's ~3/4 angle, distance chosen so the model fills the frame like
// the reference dog fills its crop.
import { chromium } from "playwright";

const dist = process.argv[2] ?? "1.35";
const az = process.argv[3] ?? "42";
const el = process.argv[4] ?? "15";
const out = process.argv[5] ?? ".img2threejs/renders/blockout/matched.png";

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 780, height: 1125 } });
p.on("pageerror", (e) => console.log("PAGEERROR:", String(e)));
for (let attempt = 0; attempt < 3; attempt++) {
  await p.goto(
    `http://localhost:5173/preview-rework/?az=${az}&el=${el}&dist=${dist}&grid=0&hud=0`,
    { waitUntil: "networkidle" },
  );
  await p.waitForFunction(() => document.title.includes("ready"), null, { timeout: 20_000 });
  await p.waitForTimeout(400);
  const buf = await p.screenshot({ path: out });
  if (buf.length > 20_000) break;
}
console.log(`→ ${out} (dist=${dist} az=${az} el=${el})`);
await b.close();
