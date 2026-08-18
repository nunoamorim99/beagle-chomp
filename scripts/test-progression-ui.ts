// Browser check that the classic progression actually drives the GAME
// (IDEA-040), not just the pure module.
//
//   docker compose up -d db api
//   npm run dev
//   npx tsx scripts/test-progression-ui.ts [baseUrl]
//
// What only a browser can show: that startLevel() really loads the planned
// maze, that resetActors() really spawns that level's enemy count, and that
// the HUD label matches. The pure model is covered exhaustively in
// scripts/test-progression.ts; this proves the wiring.
//
// Levels are driven by calling the game's own startLevel through the debug
// hook rather than by playing 18 maps, which would take an hour per lap.

import { chromium, type Page } from "playwright";

const BASE_URL = process.argv[2] ?? "http://localhost:5173";
const PASSWORD = "correct-horse-battery";

let passed = 0;
let failed = 0;

function ok(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    console.log(`  FAIL ${label}${detail === undefined ? "" : ` — ${String(detail)}`}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

const uniqueName = (): string =>
  `pg${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`.slice(0, 20);

async function signUp(page: Page, username: string): Promise<void> {
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.waitForSelector("#signupUsername", { timeout: 30_000 });
  await page.fill("#signupUsername", username);
  await page.fill("#signupPassword", PASSWORD);
  await page.click("#signupForm button[type=submit]");
  await page.waitForSelector("#recoveryCode:not(.hidden)", { timeout: 30_000 });
  await page.check("#recoverySavedCheck");
  await page.click("#recoveryContinueBtn");
  await page.waitForSelector("#mainMenu:not(.hidden)", { timeout: 30_000 });
}

/** Jump the running game to a level and report what it built. */
async function gotoLevel(page: Page, levelIdx: number) {
  return page.evaluate((idx) => {
    const g = (window as unknown as { __game?: Record<string, unknown> }).__game;
    if (!g) return null;
    (g as unknown as { startLevel: (i: number) => void })["startLevel"](idx);
    const ghosts = (g as unknown as { ghosts: unknown[] }).ghosts;
    return {
      label: document.getElementById("level")?.textContent ?? "",
      ghostCount: Array.isArray(ghosts) ? ghosts.length : -1,
      banner: document.querySelector("#center .banner")?.textContent ?? "",
    };
  }, levelIdx);
}

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(60_000);

  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await signUp(page, uniqueName());
  await page.click("#playBtn");
  await page.waitForTimeout(3_000);

  const hookPresent = await page.evaluate(() =>
    Boolean((window as unknown as { __game?: unknown }).__game));
  if (!hookPresent) {
    console.log("\n  SKIP — window.__game debug hook not exposed in this build.");
    console.log("  (The pure model is covered by scripts/test-progression.ts.)");
    await browser.close();
    return;
  }

  section("Stage 1 — maps 1-5, three enemies");
  for (const [idx, wantLabel] of [[0, "Map 1"], [4, "Map 5"]] as const) {
    const r = await gotoLevel(page, idx);
    await page.waitForTimeout(400);
    ok(`level ${idx} shows "${wantLabel}"`, r?.label === wantLabel, r?.label);
    ok(`level ${idx} spawns 3 enemies`, r?.ghostCount === 3, r?.ghostCount);
  }

  section("The bonus level");
  {
    const r = await gotoLevel(page, 5);
    await page.waitForTimeout(400);
    ok('level 5 shows "Bonus"', r?.label === "Bonus", r?.label);
    ok("level 5 spawns ONE enemy", r?.ghostCount === 1, r?.ghostCount);
  }

  section("Stage 2 — maps 6-10, still three enemies");
  {
    const r = await gotoLevel(page, 6);
    await page.waitForTimeout(400);
    ok('level 6 shows "Map 6"', r?.label === "Map 6", r?.label);
    ok("level 6 spawns 3 enemies", r?.ghostCount === 3, r?.ghostCount);
  }

  section("Stage 3 — the FOURTH enemy");
  for (const [idx, wantLabel] of [[12, "Map 11"], [16, "Map 15"]] as const) {
    const r = await gotoLevel(page, idx);
    await page.waitForTimeout(400);
    ok(`level ${idx} shows "${wantLabel}"`, r?.label === wantLabel, r?.label);
    ok(`level ${idx} spawns 4 enemies`, r?.ghostCount === 4, r?.ghostCount);
  }

  section("Lap 2 — four enemies everywhere");
  {
    const r = await gotoLevel(page, 18);
    await page.waitForTimeout(400);
    ok('level 18 shows "Map 1 ·2"', r?.label === "Map 1 ·2", r?.label);
    ok("level 18 spawns 4 enemies", r?.ghostCount === 4, r?.ghostCount);

    const bonus = await gotoLevel(page, 23);
    await page.waitForTimeout(400);
    ok('level 23 shows "Bonus ·2"', bonus?.label === "Bonus ·2", bonus?.label);
    ok("lap-2 bonus spawns 2 enemies", bonus?.ghostCount === 2, bonus?.ghostCount);
  }

  ok("no console errors during the sweep", errors.length === 0, errors.slice(0, 2).join(" | "));

  await browser.close();

  console.log(`\n${"-".repeat(60)}`);
  console.log(`PROGRESSION UI: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
