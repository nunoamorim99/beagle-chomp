// README media: the phone screens and one hero shot per theme.
//
//   docker compose up        (web on 5173, API on 3001)
//   npx tsx scripts/_scratch-readme-media.ts [outDir]
//
// Writes raw PNGs to outDir (default .readme-shots/); convert to docs/media/*.webp
// afterwards. Signs up ONE throwaway account (signup is rate-limited to 5/hour per
// IP) and deletes it at the end.
import { chromium, type Page } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:5173";
const OUT = process.argv[2] ?? ".readme-shots";
mkdirSync(OUT, { recursive: true });

const THEMES = process.env.THEMES ? process.env.THEMES.split(",") : ["garden", "forest", "beach", "park", "city", "daycity", "island", "classic"];
const NAV = { timeout: 90_000, waitUntil: "domcontentloaded" as const };

const uniqueName = (): string =>
  `rm${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`.slice(0, 20);

async function settle(page: Page, ms = 1500): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  // The brand lockups are plain <img>s; on the dev server they can arrive late.
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>(".auth-logo, .menu-wordmark")]
    .every((i) => i.complete && i.naturalWidth > 0), undefined, { timeout: 60_000 });
  await page.waitForTimeout(ms);
}

async function backToMenu(page: Page): Promise<void> {
  await page.goto(BASE, NAV);
  await page.waitForSelector("#mainMenu:not(.hidden)", { timeout: 30_000 });
  await settle(page, 1800);
}

const browser = await chromium.launch();
const errors: string[] = [];
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  reducedMotion: "reduce",
  // The dev build registers a service worker that intercepts navigations, and a
  // reload through it can hang indefinitely here. Pictures do not need it.
  serviceWorkers: "block",
});
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(e.message));
// Playwright DISMISSES dialogs by default, and dismissing a beforeunload prompt
// cancels the navigation — which reads as goto() hanging forever.
page.on("dialog", (d) => void d.accept());

if (!process.env.THEMES_ONLY) {
// --- signed out: the login screen --------------------------------------------
await page.goto(BASE, NAV);
await page.waitForSelector("#authGate:not(.hidden)", { timeout: 30_000 });
await settle(page);
await page.screenshot({ path: `${OUT}/login.png` });
await page.click("#tabLogin");
await settle(page, 500);
await page.screenshot({ path: `${OUT}/login-tab.png` });
const fold = await page.evaluate(() => {
  const r = document.querySelector("#goRecover")?.getBoundingClientRect();
  return r ? Math.round(r.bottom) : -1;
});
console.log(`  login tab: recovery row ends at y=${fold} (viewport 844)`);
await page.click("#tabSignup");

// --- sign up -----------------------------------------------------------------
const user = uniqueName();
await page.fill("#signupUsername", user);
await page.fill("#signupPassword", "a-decent-password");
await page.click("#signupForm button[type=submit]");
await page.waitForSelector("#recoveryCode:not(.hidden)", { timeout: 25_000 });
await page.check("#recoverySavedCheck");
await page.click("#recoveryContinueBtn");
await page.waitForSelector("#mainMenu:not(.hidden)", { timeout: 30_000 });
await settle(page, 2500);
await page.screenshot({ path: `${OUT}/menu.png` });

// --- landscape + desktop menu, for the layout check --------------------------
for (const v of [{ id: "landscape", width: 844, height: 390 }, { id: "desktop", width: 1440, height: 900 }]) {
  await page.setViewportSize(v);
  await settle(page, 1500);
  await page.screenshot({ path: `${OUT}/menu-${v.id}.png` });
}
await page.setViewportSize({ width: 390, height: 844 });
await backToMenu(page);

// --- gameplay ----------------------------------------------------------------
await page.click("#playBtn");
await page.waitForSelector("#tutorial:not(.hidden)", { timeout: 20_000 });
await page.click(".tut-skip");
await page.waitForSelector("#tutorial.hidden", { state: "attached", timeout: 10_000 });
// Wait out the "Ready!" countdown, then walk the beagle so a trail is eaten.
await page.waitForTimeout(5000);
for (const k of ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowUp", "ArrowLeft"]) {
  await page.keyboard.press(k);
  await page.waitForTimeout(1400);
}
await page.screenshot({ path: `${OUT}/gameplay-phone.png` });
await backToMenu(page);

// --- shop --------------------------------------------------------------------
await page.evaluate(() => document.querySelector<HTMLButtonElement>("#menuShopBtn")?.click());
await page.waitForSelector("#shop:not(.hidden)", { timeout: 15_000 });
await settle(page, 1500);
await page.screenshot({ path: `${OUT}/shop-beagles.png` });
await backToMenu(page);

// --- journey -----------------------------------------------------------------
await page.click("#journeyBtn");
await page.waitForSelector(".jp-item.is-visible", { timeout: 30_000 });
await settle(page, 2500);
await page.screenshot({ path: `${OUT}/journey.png` });
await backToMenu(page);

// --- challenges --------------------------------------------------------------
await page.evaluate(() => document.querySelector<HTMLButtonElement>("#menuChallengeBtn")?.click());
await page.waitForSelector(".ch-card", { timeout: 15_000 });
await settle(page, 1000);
await page.screenshot({ path: `${OUT}/challenges.png` });
await backToMenu(page);

// --- clean up the account ------------------------------------------------------
await page.click("#menuProfileBtn");
await page.waitForSelector("#profile:not(.hidden)");
await page.click("#deleteRevealBtn");
await page.fill("#deleteConfirmInput", user);
await page.click("#deleteConfirmBtn");
await page.waitForSelector("#authGate:not(.hidden)", { timeout: 15_000 });

} // THEMES_ONLY

// --- one hero per theme, from the board harness ----------------------------
// A FRESH page per theme: reusing one crashed the renderer on the second board.
for (const t of THEMES) {
  const board = await browser.newPage({ viewport: { width: 900, height: 558 }, deviceScaleFactor: 2, serviceWorkers: "block" });
  board.on("pageerror", (e) => errors.push(`board ${t}: ${e.message}`));
  await board.goto(`${BASE}/preview-board/?theme=${t}&view=hero&hud=0`, NAV);
  await board.waitForTimeout(6000);
  await board.screenshot({ path: `${OUT}/theme-${t}.png` });
  await board.close();
}

await browser.close();
console.log(errors.length ? `errors:\n  ${errors.join("\n  ")}` : "no page errors");
