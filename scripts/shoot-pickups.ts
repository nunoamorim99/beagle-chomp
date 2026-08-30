// Screenshots the dev-only pickup contact sheet (/preview/pickups.html).
//
//   npm run dev
//   npx tsx scripts/shoot-pickups.ts [label] [baseUrl]
//
// Writes .tmp-screens/pickups-<label>.png. The right-hand column of that sheet
// is the pickup at its true in-game pixel size — that is the column to judge,
// not the hero render. Pass a label to keep a before/after pair around.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const label = process.argv[2] ?? "now";
const baseUrl = process.argv[3] ?? "http://localhost:5175";
const only = process.env.ONLY ? `&only=${process.env.ONLY}` : "";
const SHOTS = ".tmp-screens";

mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });

const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});

await page.goto(`${baseUrl}/preview/pickups.html?zoom=6${only}`, { waitUntil: "networkidle" });
// The page renders synchronously on import, then renames itself — so a title
// change is the honest "the sheet exists" signal, not an arbitrary timeout.
await page.waitForFunction(() => document.title.includes("ready"), null, { timeout: 20_000 });

const hud = await page.textContent("#hud");
const out = `${SHOTS}/pickups-${label}.png`;
await page.locator("#sheet").screenshot({ path: out });
await browser.close();

console.log(hud);
console.log(`→ ${out}`);
if (errors.length) {
  console.log("\npage errors:");
  for (const e of errors) console.log(`  ${e}`);
  process.exit(1);
}
