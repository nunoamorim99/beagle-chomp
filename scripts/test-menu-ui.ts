// Browser-driven checks for the IDEA-036 menu rework and the IDEA-006 v3
// install banner, at desktop AND phone sizes.
//
//   docker compose up -d db api
//   npm run dev
//   npx tsx scripts/test-menu-ui.ts [baseUrl]
//
// Layout work needs measuring, not just asserting that elements exist: the bug
// being fixed here (a pill that deformed into an unreadable lozenge, sitting on
// top of the menu buttons) would have passed any "is it in the DOM" check.
// Screenshots land in .tmp-screens/ for a human look.

import { chromium, type Browser, type Page } from "playwright";
import { mkdirSync } from "node:fs";

const BASE_URL = process.argv[2] ?? "http://localhost:5175";
const SHOTS = ".tmp-screens";

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
  `mn${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`.slice(0, 20);

async function signUpTo(page: Page): Promise<string> {
  const username = uniqueName();
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.waitForSelector("#authGate:not(.hidden)", { timeout: 20_000 });
  // IDEA-035: "Create account" is the default tab, so the form is already there.
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

/** Show the REAL install banner by dispatching a synthetic
 *  `beforeinstallprompt` — headless Chromium never fires one itself.
 *
 *  Deliberately not hand-built markup any more: the previous version pasted
 *  its own copy of the banner HTML, so it exercised the stylesheet but not
 *  install.ts, and silently drifted out of step with the real wording. */
async function showInstallBanner(page: Page): Promise<void> {
  await page.evaluate(() => {
    const e = new Event("beforeinstallprompt") as Event & {
      prompt?: () => Promise<void>;
      userChoice?: Promise<unknown>;
    };
    e.prompt = () => Promise.resolve();
    e.userChoice = Promise.resolve({ outcome: "dismissed", platform: "web" });
    window.dispatchEvent(e);
  });
  await page.waitForSelector(".install-hint");
}

/** The banner's promise has to stay true. It claimed "offline play" from v1.0
 *  until v5.2 — which stopped being true at v5.0, when sign-in before play and
 *  server-validated scores made the game online-only. */
async function checkInstallCopy(page: Page): Promise<void> {
  section("Install banner — what it promises");
  const text = await page.evaluate(
    () => document.querySelector(".install-hint__text")?.textContent ?? "",
  );
  ok("the banner does NOT promise offline play", !/offline/i.test(text), text);
  ok("it names the app", /beagle chomp/i.test(text), text);

  const icon = await page.evaluate(() => {
    const img = document.querySelector<HTMLImageElement>(".install-hint__icon");
    if (!img) return null;
    const ib = img.getBoundingClientRect();
    const tb = document.querySelector(".install-hint__text")?.getBoundingClientRect();
    return { loaded: img.naturalWidth > 0, leftOfText: tb ? ib.right <= tb.left + 1 : false };
  });
  ok("the app icon is shown", icon?.loaded === true);
  ok("…to the left of the message", icon?.leftOfText === true);
}

async function checkMenu(page: Page, label: string): Promise<void> {
  section(`${label} — menu layout`);

  ok("the eyebrow is gone", (await page.locator("#mainMenu .eyebrow").count()) === 0);
  // Two lines now, so compare the TEXT rather than the raw markup.
  ok(
    "the title stays",
    ((await page.textContent(".menu-top h1")) ?? "").replace(/\s+/g, " ").trim() === "Beagle Chomp",
    await page.textContent(".menu-top h1"),
  );

  // IDEA-036 v4: the swipe carousel is GONE. Play is its own block and the
  // four destinations are a fixed 4-up row, so nothing on this screen is
  // hidden behind a gesture. The checks below are the ones that fail if that
  // row ever stops fitting — which is the whole reason the rail existed.
  ok("the carousel is gone", (await page.locator(".menu-carousel, .carousel-viewport").count()) === 0);
  ok("Play is its own block", await page.isVisible(".menu-play"));
  ok("four destination tiles", (await page.locator(".menu-tile").count()) === 4);

  // The point of the rework: the beagle should be visible ABOVE the controls.
  const menuBottom = await page.locator(".menu-bottom").boundingBox();
  const viewport = page.viewportSize();
  if (menuBottom && viewport) {
    ok(
      "the controls sit in the lower part of the screen",
      menuBottom.y > viewport.height * 0.5,
      `controls start at y=${Math.round(menuBottom.y)} of ${viewport.height}`,
    );
  }

  await page.screenshot({ path: `${SHOTS}/menu-${label.toLowerCase()}-atload.png` });

  // Every destination must be visible and pressable WITHOUT scrolling. That is
  // the property the tile row buys, and the one a future fifth item would
  // silently break.
  for (const id of ["#playBtn", "#challengeBtn", "#menuShopBtn", "#menuLeaderboardBtn", "#menuProfileBtn"]) {
    const box = await page.locator(id).boundingBox();
    const onScreen =
      box !== null && viewport !== null && box.x >= -1 && box.x + box.width <= viewport.width + 1;
    ok(
      `${id} is on screen and a real touch target`,
      box !== null && box.height >= 44 && onScreen,
      box ? `${Math.round(box.width)}x${Math.round(box.height)} at x=${Math.round(box.x)}` : "no box",
    );
  }

  // The wallet and the sound control moved into the menu's own top bar.
  ok("the wallet is in the top bar", await page.isVisible(".menu-bar .coin-line"));
  ok("the menu has its own mute button", await page.isVisible("#menuMuteBtn"));

  // Nothing may overflow the viewport horizontally.
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  ok("the page doesn't scroll sideways", !overflows);
}

async function checkInstallBanner(page: Page, label: string): Promise<void> {
  section(`${label} — install banner`);

  await showInstallBanner(page);
  await checkInstallCopy(page);

  const banner = await page.locator(".install-hint").boundingBox();
  const viewport = page.viewportSize();
  if (!banner || !viewport) {
    ok("banner has a box", false);
    return;
  }

  // The core fix: it belongs at the TOP, clear of the menu actions.
  ok("the banner is at the TOP of the screen", banner.y < viewport.height * 0.25, `y=${Math.round(banner.y)}`);

  // The v1 bug: a 999px radius on a wrapped row rendered as an unreadable
  // lozenge. Assert the text is actually laid out with real width and height.
  const text = await page.locator(".install-hint__text").boundingBox();
  ok(
    "the message has room to be read",
    text !== null && text.width > 120 && text.height >= 16,
    text ? `${Math.round(text.width)}x${Math.round(text.height)}` : "no box",
  );

  // Text must not be clipped by its container.
  const clipped = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>(".install-hint__text");
    if (!el) return true;
    return el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2;
  });
  ok("the message isn't clipped", !clipped);

  // Both controls need to be tappable.
  const action = await page.locator(".install-hint__action").boundingBox();
  const dismiss = await page.locator(".install-hint__dismiss").boundingBox();
  ok("the install button is a real touch target", action !== null && action.height >= 44, action ? `${Math.round(action.width)}x${Math.round(action.height)}` : "none");
  ok("the dismiss button is a real touch target", dismiss !== null && dismiss.height >= 40 && dismiss.width >= 40, dismiss ? `${Math.round(dismiss.width)}x${Math.round(dismiss.height)}` : "none");

  // It must not cover the menu's controls — the whole reason it moved.
  const controls = await page.locator(".menu-bottom").boundingBox();
  if (controls) {
    ok(
      "the banner does NOT overlap the menu controls",
      banner.y + banner.height <= controls.y,
      `banner ends ${Math.round(banner.y + banner.height)}, controls start ${Math.round(controls.y)}`,
    );
  }

  ok("the banner stays inside the viewport", banner.x >= 0 && banner.x + banner.width <= viewport.width + 1);

  // Regression guard: the first phone screenshot showed the banner sitting
  // straight over "Beagle Chomp" and the coin line.
  const title = await page.locator(".menu-top h1").boundingBox();
  ok(
    "the banner does NOT cover the game title",
    title !== null && title.y >= banner.y + banner.height,
    title ? `title at y=${Math.round(title.y)}, banner ends ${Math.round(banner.y + banner.height)}` : "no title box",
  );

  await page.screenshot({ path: `${SHOTS}/menu-${label.toLowerCase()}.png` });
  await page.evaluate(() => {
    document.querySelector(".install-hint")?.remove();
    document.body.classList.remove("install-open");
  });
}

async function main(): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });

  const browser: Browser = await chromium.launch();
  const consoleErrors: string[] = [];

  try {
    // --- desktop ------------------------------------------------------------
    const desktop = await browser
      .newContext({ viewport: { width: 1280, height: 800 } })
      .then((c) => c.newPage());
    desktop.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });

    const desktopUser = await signUpTo(desktop);
    await checkMenu(desktop, "Desktop");
    await checkInstallBanner(desktop, "Desktop");
    // The desktop account used to be cleaned up at the end of the carousel-arrow
    // section, which went away with the carousel. Deleting it here keeps the run
    // from leaving an account behind on every pass.
    await deleteAccount(desktop, desktopUser);

    // --- phone --------------------------------------------------------------
    const phone = await browser
      .newContext({
        viewport: { width: 390, height: 844 }, // iPhone 14 class
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 3,
      })
      .then((c) => c.newPage());
    phone.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });

    const phoneUser = await signUpTo(phone);
    await checkMenu(phone, "Phone");
    await checkInstallBanner(phone, "Phone");

    await deleteAccount(phone, phoneUser);

    section("IDEA-038 — control scheme");

    // The pad must NOT appear for a default (swipe) account: it's an option,
    // not a replacement.
    const padWhenSwipe = await phone.locator(".dpad:not(.hidden)").count();
    ok("no D-pad by default (swipe stays the default)", padWhenSwipe === 0);

    section("Console hygiene");
    const real = consoleErrors.filter((e) => !/service worker|sw\.js|workbox|favicon/i.test(e));
    ok("no unexpected console errors", real.length === 0, real.slice(0, 2).join(" | "));
  } finally {
    await browser.close();
  }

  console.log(`\n${"-".repeat(60)}`);
  console.log(`MENU UI: ${passed} passed, ${failed} failed`);
  console.log(`screenshots in ${SHOTS}/`);
  if (failed > 0) process.exit(1);
}

main().catch((err: unknown) => {
  console.error("test-menu-ui crashed:", err);
  process.exit(1);
});
