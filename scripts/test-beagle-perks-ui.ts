// Browser-driven check of the beagle perks and the tribute unlock (IDEA-064).
//
//   docker compose up -d db api web     (or: npm run dev)
//   npx tsx scripts/test-beagle-perks-ui.ts [baseUrl]
//
// What this covers that no headless test can. The pure tests prove the RULES —
// which coat carries which perk, what the validator allows, what the registry
// reveals to whom. None of them proves the rules are WIRED: that the shop
// really hides the two tribute items, that the perk line really renders, that
// a Bagel run really opens holding a shield, and that a Cookie run really
// starts on four lives. Every one of those is a call site, and a call site that
// was never added looks exactly like a feature that works.
//
// It needs the real stack because sign-in is required before play and the
// profile comes from the server.
//
// NOTE: signup is rate-limited to 5/hour per IP — a few reruns need
// `docker compose restart api`.
//
// reducedMotion: "reduce" for the reason every other suite here asks for it:
// the menu's Play button carries an idle bob, and an element whose bounding box
// never settles never becomes actionable in Playwright.
import { execFileSync } from "node:child_process";
import { chromium, type Page } from "playwright";

const BASE_URL = process.argv[2] ?? "http://localhost:5173";
const DB_CONTAINER = process.env.BC_DB_CONTAINER ?? "beagle-chomp-db-1";

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
  `pk${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`.slice(0, 20);

/** Top up the wallet straight in the dev DB.
 *
 *  The alternative is playing for coins, and at five pickups a map that is
 *  several minutes of real gameplay to afford one 50-coin coat — which would
 *  make this suite slow AND flaky, since it would then depend on the bot
 *  surviving. The same shortcut scripts/_scratch-challenge-theme.ts takes to
 *  unlock the challenge ladder. */
function grantCoins(username: string, coins: number): void {
  execFileSync("docker", [
    "exec",
    DB_CONTAINER,
    "psql",
    "-U",
    "beaglechomp",
    "-d",
    "beaglechomp",
    "-c",
    `UPDATE users SET coins = ${coins} WHERE username_lower = '${username.toLowerCase()}'`,
  ]);
}

/** The card names currently listed in the shop rail. */
async function railNames(page: Page): Promise<string[]> {
  return page.$$eval(".shop-rail-card-name", (els) =>
    els.map((e) => (e.textContent ?? "").trim()),
  );
}

async function openShopTab(page: Page, tab: "beagle" | "enemy" | "theme"): Promise<void> {
  await page.click(`.shop-tab[data-tab="${tab}"]`);
  await page.waitForTimeout(120);
}

/**
 * Press Play and get all the way into a live run.
 *
 * The tutorial carousel stands between the two on a first run (IDEA-040 v2:
 * teach first, THEN open the session, so reading does not burn the run clock),
 * so a bare click on #playBtn leaves the game sitting on the carousel and every
 * later wait times out looking like a broken feature.
 */
async function startRun(page: Page): Promise<void> {
  await page.click("#playBtn");
  // Only on the very first run of an account; a no-op afterwards.
  for (let i = 0; i < 12; i++) {
    const next = await page.$(".tut-next");
    if (!next) break;
    await next.click();
    await page.waitForTimeout(200);
  }
  await page.waitForSelector("#center:not(.hidden)", { timeout: 20_000 });
  // Past the READY banner and into "play", where the tray is live.
  await page.waitForTimeout(1200);
}

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const page = await browser
    .newContext({ reducedMotion: "reduce" })
    .then((c) => c.newPage());

  const consoleErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  const username = uniqueName();

  try {
    section("Sign up");

    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.waitForSelector("#authGate:not(.hidden)", { timeout: 20_000 });
    await page.waitForSelector("#signupForm");
    await page.fill("#signupUsername", username);
    await page.fill("#signupPassword", "a-decent-password");
    await page.click("#signupForm button[type=submit]");
    await page.waitForSelector("#recoveryCode:not(.hidden)", { timeout: 25_000 });
    await page.check("#recoverySavedCheck");
    await page.click("#recoveryContinueBtn");
    await page.waitForSelector("#mainMenu:not(.hidden)", { timeout: 20_000 });
    ok("a fresh account reaches the menu", true);

    // -----------------------------------------------------------------------
    section("The shop, before the tribute coat");

    await page.click("#menuShopBtn");
    await page.waitForSelector("#shop:not(.hidden)", { timeout: 10_000 });

    // The perk line is the feature's only explanation to the player. A coat
    // whose perk is invisible is a coat nobody chooses on purpose.
    const perkText = (await page.textContent(".shop-hero-perk"))?.trim() ?? "";
    ok("the beagle tab shows the selected coat's perk", perkText.length > 0, perkText);
    ok(
      "…and it is Bagel's, since Bagel is equipped",
      perkText.toLowerCase().includes("shield"),
      perkText,
    );

    await openShopTab(page, "enemy");
    const enemies = await railNames(page);
    ok("the enemy rail lists 10 skins", enemies.length === 10, enemies.join(","));
    ok("the Ghost is NOT listed before the coat is bought", !enemies.includes("Ghost"));
    ok("the Flea is listed", enemies.includes("Flea"), enemies.join(","));
    ok("the Flea is the equipped one", (await page.$(".shop-rail-card-selected .shop-rail-card-name")) !== null);
    const equippedEnemy = (
      await page.textContent(".shop-rail-card-selected .shop-rail-card-name")
    )?.trim();
    ok("…and the equipped enemy is the Flea", equippedEnemy === "Flea", equippedEnemy);

    await openShopTab(page, "theme");
    const themesBefore = await railNames(page);
    ok("the theme rail lists 5 boards", themesBefore.length === 5, themesBefore.join(","));
    ok(
      "Arcade Night is NOT listed before the coat is bought",
      !themesBefore.includes("Arcade Night"),
      themesBefore.join(","),
    );
    ok("a theme with no perk shows no perk line", (await page.$(".shop-hero-perk")) === null);

    // -----------------------------------------------------------------------
    section("Buying the Pac-Beagle unlocks both tributes");

    grantCoins(username, 500);
    // The wallet lives on the server; reload so the profile cache rehydrates.
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector("#mainMenu:not(.hidden)", { timeout: 20_000 });
    await page.click("#menuShopBtn");
    await page.waitForSelector("#shop:not(.hidden)", { timeout: 10_000 });

    await page.click('.shop-rail-card[data-card-id="pacbeagle"]');
    await page.waitForTimeout(150);
    const pacPerk = (await page.textContent(".shop-hero-perk"))?.trim() ?? "";
    ok(
      "the Pac-Beagle's perk says what it unlocks",
      pacPerk.includes("Ghost") && pacPerk.includes("Arcade"),
      pacPerk,
    );

    await page.click('.shop-hero-action[data-action="buy"]');
    await page.waitForTimeout(400);

    // The reveal must happen WITHOUT a reload: currentRegistry() asks fresh on
    // every render precisely so the unlock lands while the shop is still open.
    await openShopTab(page, "enemy");
    const enemiesAfter = await railNames(page);
    ok("the Ghost appears immediately", enemiesAfter.includes("Ghost"), enemiesAfter.join(","));
    ok("…and nothing else was added", enemiesAfter.length === 11, enemiesAfter.length);

    await openShopTab(page, "theme");
    const themesAfter = await railNames(page);
    ok(
      "Arcade Night appears immediately",
      themesAfter.includes("Arcade Night"),
      themesAfter.join(","),
    );
    ok("…and nothing else was added", themesAfter.length === 6, themesAfter.length);

    // It is GRANTED, not for sale: the card must read as owned rather than
    // offering to charge for something the coat already paid for.
    await page.click('.shop-rail-card[data-card-id="classic"]');
    await page.waitForTimeout(150);
    const arcadeAction = (await page.textContent(".shop-hero-action"))?.trim() ?? "";
    ok(
      "Arcade Night is owned, not on sale",
      /equip/i.test(arcadeAction),
      arcadeAction,
    );

    // -----------------------------------------------------------------------
    section("Bagel: a run opens holding a shield");

    await page.click("#shopBackBtn");
    await page.waitForSelector("#mainMenu:not(.hidden)", { timeout: 10_000 });
    await startRun(page);

    const chips = await page.$$eval("#powerups .powerup .name", (els) =>
      els.map((e) => (e.textContent ?? "").trim()),
    );
    ok("the run starts with exactly one power-up held", chips.length === 1, chips.join(","));
    ok("…and it is the shield", chips[0]?.toLowerCase().includes("shield") === true, chips[0]);

    // Read off the chip's own accessible name ("3 of 5 lives") rather than by
    // counting glyphs: the row always draws LIVES.max hearts and dims the
    // unearned ones, so a count of elements is the CAP, not the lives held.
    const bagelLives = await page.getAttribute("#lives", "aria-label");
    ok("Bagel starts on the usual three lives", bagelLives === "3 of 5 lives", bagelLives);

    // -----------------------------------------------------------------------
    section("Cookie: a run opens on four lives and no shield");

    await page.click("#homeBtn");
    await page.waitForSelector("#mainMenu:not(.hidden)", { timeout: 15_000 });
    await page.click("#menuShopBtn");
    await page.waitForSelector("#shop:not(.hidden)", { timeout: 10_000 });
    await openShopTab(page, "beagle");
    await page.click('.shop-rail-card[data-card-id="cookie"]');
    await page.waitForTimeout(150);
    await page.click('.shop-hero-action[data-action="buy"]');
    await page.waitForTimeout(300);
    await page.click('.shop-hero-action[data-action="equip"]');
    await page.waitForTimeout(300);
    await page.click("#shopBackBtn");
    await page.waitForSelector("#mainMenu:not(.hidden)", { timeout: 10_000 });

    await startRun(page);

    const cookieLives = await page.getAttribute("#lives", "aria-label");
    ok("Cookie starts on four lives", cookieLives === "4 of 5 lives", cookieLives);

    const cookieChips = await page.$$eval("#powerups .powerup", (els) => els.length);
    ok("Cookie holds no shield — one coat, one perk", cookieChips === 0, cookieChips);

    // -----------------------------------------------------------------------
    ok("no console errors along the way", consoleErrors.length === 0, consoleErrors.join(" | "));
  } finally {
    await browser.close();
  }

  console.log(`\n${"-".repeat(60)}`);
  console.log(`BEAGLE PERKS UI: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
