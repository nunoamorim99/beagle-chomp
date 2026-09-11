// Scratch: IDEA-063's headline claim — a challenge level dresses the board in
// its OWN theme, owned or not, and the world goes back to the equipped theme
// when the player leaves.
//
//   docker compose up -d && npx tsx scripts/_scratch-challenge-theme.ts
//
// Signs up a throwaway account, unlocks some of the ladder by writing
// challenge_progress straight into the dev database (there is no endpoint for
// it, and there should not be — the server is the authority on progress), then
// plays a level whose theme is NOT the one a new account has equipped and
// photographs the board.
//
// Stone 2 is "The Back Garden" on the ARCADE NIGHT theme: a black board with
// neon walls, about as far from the default garden as the six themes get, so
// "did the forced theme apply" is answerable from the screenshot alone rather
// than from a colour probe.
import { chromium, type Page } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const BASE_URL = process.argv[2] ?? "http://localhost:5173";
const SHOTS = ".tmp-screens";

const uniqueName = (): string =>
  `ct${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`.slice(0, 20);

function psql(sql: string): string {
  return execFileSync("docker", ["compose", "exec", "-T", "db", "psql", "-U", "beaglechomp", "-d", "beaglechomp", "-tAc", sql], {
    encoding: "utf-8",
  }).trim();
}

async function signUp(page: Page): Promise<string> {
  const username = uniqueName();
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#authGate:not(.hidden)", { timeout: 20_000 });
  await page.waitForSelector("#signupForm");
  await page.fill("#signupUsername", username);
  await page.fill("#signupPassword", "a-decent-password");
  await page.click("#signupForm button[type=submit]");
  await page.waitForSelector("#recoveryCode:not(.hidden)", { timeout: 25_000 });
  await page.check("#recoverySavedCheck");
  await page.click("#recoveryContinueBtn");
  await page.waitForSelector("#mainMenu:not(.hidden)", { timeout: 20_000 });
  return username;
}

// NO CANVAS COLOUR PROBE HERE, AND THAT IS THE POINT.
//
// The first version of this script read one pixel out of the WebGL canvas to
// prove the sky had changed. It reported rgb(0,0,0) at the menu, during the
// arcade-themed run and back at the menu again — so it concluded "forced theme
// applied: false" while the screenshots beside it showed the forced theme
// applying perfectly. The renderer runs without `preserveDrawingBuffer`, so
// drawing its canvas into a 2D context outside the compositing frame yields a
// cleared buffer, and every comparison between two such reads is a comparison
// of two blacks. A confident false negative is worse than no instrument: this
// one is answered by LOOKING at the two screenshots, which is honest about
// what it is.

(async () => {
  mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();

  const username = await signUp(page);
  console.log("account:", username);

  // Unlock the first ten stones so stone 2 is reachable.
  psql(`UPDATE users SET challenge_progress = 10 WHERE username = '${username}'`);
  console.log("challenge_progress:", psql(`SELECT challenge_progress FROM users WHERE username = '${username}'`));

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("#mainMenu:not(.hidden)", { timeout: 20_000 });


  await page.click("#challengeBtn");
  await page.waitForSelector("#levelMap:not(.hidden)");
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/theme-map-unlocked.png` });

  // Select stone 2 (index 1 — "The Back Garden", Arcade Night) and play it.
  await page.click('[data-node-idx="1"]');
  await page.waitForTimeout(400);
  const panel = await page.evaluate(() => ({
    title: document.querySelector(".map-footer-title")?.textContent,
    theme: document.querySelector(".map-theme-tag")?.textContent?.trim(),
    play: document.querySelector("#mapPlayBtn")?.textContent?.trim(),
  }));
  console.log("panel:", JSON.stringify(panel));

  await page.click("#mapPlayBtn");
  // Wait out the READY countdown so the board is fully lit.
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${SHOTS}/theme-run-arcade.png` });

  // Quit back to the menu — the equipped (garden) theme must come back. #homeBtn
  // is the HUD's abandon-the-run control (attachHomeButton -> quitToMenu).
  await page.click("#homeBtn");
  await page.waitForSelector("#mainMenu:not(.hidden)", { timeout: 10_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/theme-back-at-menu.png` });

  console.log("look at:");
  console.log(`  ${SHOTS}/theme-run-arcade.png   — must be a BLACK sky with neon-blue walls`);
  console.log(`  ${SHOTS}/theme-back-at-menu.png — must be the garden's blue sky and green lawn again`);

  psql(`DELETE FROM users WHERE username = '${username}'`);
  console.log("account removed");
  await browser.close();
})();
