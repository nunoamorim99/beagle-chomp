// IDEA-064 v2: does the level map's theme tag still draw a GLYPH?
//
//   npx tsx scripts/_scratch-levelmap-theme-tag.ts [baseUrl]
//
// ICON.themes moved from `park` to `palette` so the shop's Themes TAB would
// stop wearing the City Park theme's own card mark. levelMap.ts reads the same
// role for its per-level theme tag, so it moved too — and a Material Symbols
// name that is not in the subset prints itself, which on a 40-stone trail is a
// row of cards reading "palette Deep Forest". Measure, don't assume.
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:5173";
const name = `lm${Date.now().toString(36)}`.slice(0, 20);

async function main(): Promise<void> {
  const b = await chromium.launch();
  const page = await b
    .newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" })
    .then((c) => c.newPage());
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector("#signupForm");
  await page.fill("#signupUsername", name);
  await page.fill("#signupPassword", "a-decent-password");
  await page.click("#signupForm button[type=submit]");
  await page.waitForSelector("#recoveryCode:not(.hidden)", { timeout: 25000 });
  await page.check("#recoverySavedCheck");
  await page.click("#recoveryContinueBtn");
  await page.waitForSelector("#mainMenu:not(.hidden)", { timeout: 20000 });
  await page.click("#challengeBtn");
  await page.waitForSelector("#levelMap:not(.hidden)", { timeout: 15000 });
  await page.waitForTimeout(600);

  const tags = await page.$$eval(".map-theme-tag .bc-i", (els) =>
    els.map((e) => ({ text: (e.textContent ?? "").trim(), w: Math.round((e as HTMLElement).offsetWidth) })),
  );
  console.log("theme tags:", JSON.stringify(tags));
  const bad = tags.filter((t) => t.w > 60);
  console.log(bad.length === 0 ? "ok   every theme tag is a glyph" : `FAIL ${bad.length} printed their name`);
  if (process.env.BC_SHOT) await page.screenshot({ path: process.env.BC_SHOT });
  await b.close();
  process.exit(bad.length === 0 ? 0 : 1);
}
void main();
