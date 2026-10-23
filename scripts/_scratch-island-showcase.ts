// Pirate Island (IDEA-085): the shop's theme card and the MENU stage, on the
// LOCAL dev stack only (never production — signup creates a real account).
// The menu shows the EQUIPPED theme and a fresh account owns only the garden,
// so the island is equipped IN MEMORY through the dev-only window.__game hook
// rather than bought.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const BASE = process.env.BASE ?? "http://localhost:5173";
const OUT = ".img2threejs/pirate-island/renders/showcase";
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, reducedMotion: "reduce" });
const page = await ctx.newPage();
page.setDefaultNavigationTimeout(120_000);
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
// REUSE an account with USER_NAME (signup is rate-limited); otherwise sign up.
const reuse = process.env.USER_NAME;
const user = reuse ?? `pi${Date.now().toString(36)}`.slice(0, 18);
await page.goto(BASE, { waitUntil: "domcontentloaded" });
if (reuse) {
  await page.waitForSelector("#authGate:not(.hidden)", { timeout: 90_000 });
  await page.click("#tabLogin");
  await page.fill("#loginUsername", user);
  await page.fill("#loginPassword", "a-decent-password");
  await page.click("#loginForm button[type=submit]");
} else {
  await page.waitForSelector("#signupForm", { timeout: 90_000 });
  await page.fill("#signupUsername", user);
  await page.fill("#signupPassword", "a-decent-password");
  await page.click("#signupForm button[type=submit]");
  await page.waitForSelector("#recoveryCode:not(.hidden)", { timeout: 25_000 });
  await page.check("#recoverySavedCheck");
  await page.click("#recoveryContinueBtn");
}
await page.waitForSelector("#mainMenu:not(.hidden)", { timeout: 30_000 });
// Dismiss the first-run tutorial if it is up.
await page.evaluate(() => document.querySelector<HTMLElement>("#tutorialSkip, .tutorial-skip")?.click());
await page.waitForTimeout(800);

// --- the shop's theme card --------------------------------------------------
await page.evaluate(() => document.querySelector<HTMLButtonElement>("#menuShopBtn")?.click());
await page.waitForSelector("#shop:not(.hidden)");
await page.evaluate(() => document.querySelector<HTMLButtonElement>('.shop-tab[data-tab="theme"]')?.click());
await page.waitForTimeout(700);
await page.evaluate(() => document.querySelector<HTMLElement>('.shop-rail [data-card-id="island"]')?.click());
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/shop-theme-island-phone.png`, timeout: 150_000 });

// --- the menu, wearing the island -------------------------------------------
// Back by the shop's own Back button, not a reload: a cold reload refetches
// the whole module graph across the bind mount and outran a 120s timeout.
await page.evaluate(() => document.querySelector<HTMLButtonElement>("#shop .map-back, #shopBackBtn, #shop [data-action=back]")?.click());
await page.keyboard.press("Escape");
await page.waitForSelector("#mainMenu:not(.hidden)", { timeout: 30_000 });
await page.evaluate(async () => {
  // @ts-expect-error a Vite dev-server URL, resolved by the browser (the SAME
  // module instance the app holds), not by tsc.
  const t = await import("/src/game/themes.ts");
  t.setEquippedMazeThemeId("island");
  const theme = t.getMazeTheme("island");
  const g = (window as unknown as { __game: Record<string, any> }).__game;
  g.rig.applySceneTheme(theme);
  g.menuScene.setMazeTheme(theme);
});
for (const [w, h, id] of [[390, 844, "phone"], [1280, 800, "desktop"]] as const) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${OUT}/menu-island-${id}.png`, timeout: 150_000 });
}

// --- clean up the throwaway account -----------------------------------------
await page.setViewportSize({ width: 390, height: 844 });
await page.evaluate(() => document.querySelector<HTMLButtonElement>("#menuProfileBtn")?.click());
await page.waitForSelector("#profile:not(.hidden)");
await page.click("#deleteRevealBtn");
await page.fill("#deleteConfirmInput", user);
await page.click("#deleteConfirmBtn");
await page.waitForSelector("#authGate:not(.hidden)", { timeout: 15_000 });
await b.close();
console.log(OUT);
for (const e of errors) console.log("  !! " + e);
