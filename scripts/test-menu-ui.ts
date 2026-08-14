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
  // The Account button lives in the carousel now; scroll it into view first.
  await page.locator("#menuProfileBtn").scrollIntoViewIfNeeded();
  await page.click("#menuProfileBtn");
  await page.waitForSelector("#profile:not(.hidden)");
  await page.click("#deleteRevealBtn");
  await page.fill("#deleteConfirmInput", username);
  await page.click("#deleteConfirmBtn");
  await page.waitForSelector("#authGate:not(.hidden)", { timeout: 15_000 });
}

/** Inject the install banner directly. `beforeinstallprompt` can't be fired
 *  from a test, and this check is about the banner's LAYOUT, not its trigger. */
async function showInstallBanner(page: Page): Promise<void> {
  await page.evaluate(() => {
    const el = document.createElement("div");
    el.className = "install-hint";
    el.innerHTML =
      '<span class="install-hint__text">Install Beagle Chomp for full-screen play and a home-screen icon.</span>' +
      '<button type="button" class="install-hint__action">Install</button>' +
      '<button type="button" class="install-hint__dismiss" aria-label="Dismiss">&times;</button>';
    document.body.appendChild(el);
    // install.ts sets this when it mounts the real banner; the menu's title
    // block shifts down out from under it in CSS.
    document.body.classList.add("install-open");
  });
  await page.waitForSelector(".install-hint");
}

async function checkMenu(page: Page, label: string): Promise<void> {
  section(`${label} — menu layout`);

  ok("the eyebrow is gone", (await page.locator("#mainMenu .eyebrow").count()) === 0);
  ok("the title stays", (await page.textContent(".menu-top h1")) === "Beagle Chomp");

  ok("the carousel is present", await page.isVisible(".menu-carousel"));
  // IDEA-036 v3: Play joined the rail, so five cards not four.
  ok("all five destinations are in the rail", (await page.locator(".carousel-item").count()) === 5);
  ok("Play is the FIRST card", await page.locator(".carousel-item").first().evaluate((el) => el.id === "playBtn"));
  ok("Play keeps its accent styling", await page.locator("#playBtn").evaluate((el) => el.classList.contains("carousel-play")));

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

  // The rail must OPEN at its first option — an earlier centring rule left it
  // part-scrolled, cropping "Challenge" to "nge".
  const railStart = await page.locator(".carousel-viewport").evaluate((el) => el.scrollLeft);
  // Allow up to the track's own edge padding (10px): scroll-snap treats that
  // as the first snap position, which still shows the first card in full. The
  // bug this guards against was a 66px offset that cropped "Challenge".
  ok("the carousel opens at the first option", railStart <= 12, `scrollLeft=${railStart}`);

  // Capture BEFORE the scroll-each-card loop below, so the screenshot shows
  // the menu as a player first sees it rather than mid-scroll.
  await page.screenshot({ path: `${SHOTS}/menu-${label.toLowerCase()}-atload.png` });

  const firstCard = await page.locator("#challengeBtn").boundingBox();
  const railBox = await page.locator(".carousel-viewport").boundingBox();
  if (firstCard && railBox) {
    ok(
      "the first card isn't clipped by the rail edge",
      firstCard.x >= railBox.x - 1,
      `card x=${Math.round(firstCard.x)}, rail x=${Math.round(railBox.x)}`,
    );
  }

  // Every card must be reachable — this is what a wrapped/clipped row breaks.
  // NOTE: this loop SCROLLS the rail, so the "opens at first option" check
  // above must stay before it.
  for (const id of ["#playBtn", "#challengeBtn", "#menuShopBtn", "#menuLeaderboardBtn", "#menuProfileBtn"]) {
    await page.locator(id).scrollIntoViewIfNeeded();
    const box = await page.locator(id).boundingBox();
    ok(
      `${id} is reachable and a real touch target`,
      box !== null && box.height >= 44 && box.width >= 60,
      box ? `${Math.round(box.width)}x${Math.round(box.height)}` : "no box",
    );
  }

  // Nothing may overflow the viewport horizontally.
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  ok("the page doesn't scroll sideways", !overflows);
}

async function checkInstallBanner(page: Page, label: string): Promise<void> {
  section(`${label} — install banner`);

  await showInstallBanner(page);

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

    section("Desktop — carousel arrows");
    // checkMenu above scrolls every card into view, which leaves the rail at
    // its END. Reset to the start so these assertions describe the rail as a
    // player first meets it.
    await desktop.locator(".carousel-viewport").evaluate((el) => { el.scrollLeft = 0; });
    await desktop.waitForTimeout(400);
    // With Play in the rail (IDEA-036 v3) there are five cards, which may or
    // may not fit depending on width — so assert the arrows are CONSISTENT
    // with whether the rail actually scrolls, rather than assuming either.
    const scrollableDesktop = await desktop
      .locator(".carousel-viewport")
      .evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    const prevHidden = await desktop.locator("#carouselPrev").evaluate((el) =>
      el.classList.contains("hidden-arrow"),
    );
    const nextHidden = await desktop.locator("#carouselNext").evaluate((el) =>
      el.classList.contains("hidden-arrow"),
    );
    // At the START of the rail the back arrow is always useless; the forward
    // arrow is useful exactly when there's more to scroll to.
    ok("the back arrow hides at the start of the rail", prevHidden);
    ok(
      "the forward arrow matches whether the rail can scroll",
      nextHidden === !scrollableDesktop,
      `scrollable=${scrollableDesktop}, nextHidden=${nextHidden}`,
    );

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

    section("Phone — the edge fade cues that the rail scrolls");
    // The arrows are hidden on phones, so this fade is the ONLY hint that
    // there's more past the edge. Assert it tracks the scroll position rather
    // than just existing.
    const fadeAt = async () =>
      phone.locator(".carousel-viewport").evaluate((el) => {
        const cs = getComputedStyle(el);
        return {
          left: cs.getPropertyValue("--fade-left").trim(),
          right: cs.getPropertyValue("--fade-right").trim(),
        };
      });

    await phone.locator(".carousel-viewport").evaluate((el) => { el.scrollLeft = 0; });
    await phone.waitForTimeout(500);
    const atStartFade = await fadeAt();
    ok("at the start: no left fade", atStartFade.left === "0px", JSON.stringify(atStartFade));
    ok("at the start: right edge fades", atStartFade.right !== "0px", JSON.stringify(atStartFade));

    await phone.locator(".carousel-viewport").evaluate((el) => { el.scrollLeft = el.scrollWidth; });
    await phone.waitForTimeout(500);
    const atEndFade = await fadeAt();
    ok("at the end: left edge fades", atEndFade.left !== "0px", JSON.stringify(atEndFade));
    ok("at the end: no right fade", atEndFade.right === "0px", JSON.stringify(atEndFade));

    // Reset so later steps see the rail as a player first meets it.
    await phone.locator(".carousel-viewport").evaluate((el) => { el.scrollLeft = 0; });
    await phone.waitForTimeout(400);

    section("Phone — the rail actually scrolls");
    const scrollable = await phone
      .locator(".carousel-viewport")
      .evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    ok("the carousel is swipeable on a narrow screen", scrollable);

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
