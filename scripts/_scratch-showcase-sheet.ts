// IDEA-072: the review sheet for the MENU VIGNETTE and the SHOP STAGES.
//
// These are the two screens IDEA-066's surround never reached, and they have a
// camera problem the board does not: the board pitches 59 degrees down and
// `_scratch-surround-coverage.ts` proved its horizon is NEVER in shot, which is
// why a bigger floor was the whole answer there. Here the menu sits at 14
// degrees of elevation and the shop's character stage at 9.5 -- the horizon is
// most of the frame, so what fills the sky is not ground, it is things that
// STAND UP on it.
//
//   npm run dev            (port 5175)
//   docker compose up      (the API, port 3001)
//   npx tsx scripts/_scratch-showcase-sheet.ts [label]
//
// Writes .img2threejs/showcase/renders/<label>/ -- menu + the shop's three tabs
// at phone and desktop. It signs up a throwaway account and deletes it again,
// the same flow every *-ui suite uses.
import { chromium, type Page } from "playwright";
import { mkdirSync } from "node:fs";

const label = process.argv[2] ?? "now";
const BASE = process.env.BASE ?? "http://localhost:5175";
const OUT = `.img2threejs/showcase/renders/${label}`;
mkdirSync(OUT, { recursive: true });

const FRAMINGS = [
  { id: "phone", width: 390, height: 844 },
  { id: "desktop", width: 1280, height: 800 },
];

const uniqueName = (): string =>
  `sc${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`.slice(0, 20);

/**
 * Log in as an account this sheet made earlier.
 *
 * SIGNUP IS RATE-LIMITED TO 5/HOUR PER IP (CLAUDE.md), which is four runs of
 * this sheet and then every further run dies at the recovery screen looking
 * exactly like a broken signup form. Iterating on a LOOK needs a dozen runs,
 * so: make one account with `KEEP=1`, then pass `USER=<name>` to reuse it.
 */
async function logInAs(page: Page, username: string): Promise<void> {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector("#authGate:not(.hidden)", { timeout: 20_000 });
  await page.click("#tabLogin");
  await page.waitForSelector("#loginForm");
  await page.fill("#loginUsername", username);
  await page.fill("#loginPassword", "a-decent-password");
  await page.click("#loginForm button[type=submit]");
  await page.waitForSelector("#mainMenu:not(.hidden)", { timeout: 20_000 });
}

async function signUpTo(page: Page): Promise<string> {
  const username = uniqueName();
  await page.goto(BASE, { waitUntil: "networkidle" });
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

async function deleteAccount(page: Page, username: string): Promise<void> {
  await page.click("#menuProfileBtn");
  await page.waitForSelector("#profile:not(.hidden)");
  await page.click("#deleteRevealBtn");
  await page.fill("#deleteConfirmInput", username);
  await page.click("#deleteConfirmBtn");
  await page.waitForSelector("#authGate:not(.hidden)", { timeout: 15_000 });
}

const browser = await chromium.launch();
const errors: string[] = [];

// ONE account for the whole sheet, and the framings are done by RESIZING
// rather than by a second context. Signup is rate-limited to 5/hour per IP
// (CLAUDE.md), so a context per framing burns the budget in two runs and then
// every further run fails at the recovery screen looking like a broken app.
const ctx = await browser.newContext({
  viewport: { width: FRAMINGS[0].width, height: FRAMINGS[0].height },
  deviceScaleFactor: 2,
  reducedMotion: "reduce",
});
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(e.message));
const reuse = process.env.USER_NAME;
let user = "";
if (reuse) {
  await logInAs(page, reuse);
  user = reuse;
} else {
  user = await signUpTo(page);
  console.log(`  account: ${user}  (re-run with USER_NAME=${user} to reuse it)`);
}

for (const f of FRAMINGS) {
  await page.setViewportSize({ width: f.width, height: f.height });
  await page.waitForTimeout(700);

  // Back to the menu between framings by RELOADING, not by clicking Back.
  // The session persists, so this lands on the menu without another signup —
  // and it sidesteps having to know how the shop hides itself, which is what
  // the first two attempts here got wrong in two different ways.
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector("#mainMenu:not(.hidden)", { timeout: 20_000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/menu-${f.id}.png` });

  // Dispatched rather than clicked. Playwright's actionability check refuses
  // this button at desktop width — it reports the box as 0x0 while the
  // screenshot plainly shows it — and chasing that is a harness yak on a
  // script whose whole job is taking pictures. The real UI suites
  // (`test-menu-ui.ts`) drive it properly and are where that would matter.
  await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>("#menuShopBtn")?.click();
  });
  await page.waitForSelector("#shop:not(.hidden)", { timeout: 15_000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/shop-beagle-${f.id}.png` });

  for (const tab of ["enemy", "theme"]) {
    const sel = `.shop-tab[data-tab="${tab}"]`;
    if ((await page.locator(sel).count()) === 0) {
      errors.push(`${f.id}: no tab ${sel}`);
      continue;
    }
    await page.click(sel);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/shop-${tab}-${f.id}.png` });
  }

  // Every theme card, on the phone only — this is the per-theme content check
  // (does the forest give conifers, the beach dunes, the city towers?) and it
  // does not need two framings. Tapping a card STAGES the theme; it does not
  // buy it, so a locked one photographs exactly the same.
  if (f.id === "phone" && process.env.THEMES !== "0") {
    const cards = await page.locator(".shop-rail [data-card-id]").evaluateAll((els) =>
      els.map((e) => e.getAttribute("data-card-id") ?? ""),
    );
    for (const id of cards.filter(Boolean)) {
      await page.locator(`.shop-rail [data-card-id="${id}"]`).click();
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${OUT}/theme-${id}-${f.id}.png` });
    }
  }
}

if (process.env.KEEP !== "1" && !reuse) {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector("#mainMenu:not(.hidden)", { timeout: 20_000 });
  await deleteAccount(page, user);
}
await ctx.close();
await browser.close();
console.log(OUT);
for (const e of errors) console.log("  !! " + e);
