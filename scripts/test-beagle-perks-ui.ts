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
// v4 added the one that needs a SECOND map: Bagel's shield is granted per MAP
// rather than per run, so the check that matters is not "the run opens
// shielded" (v2 already proved that and would still pass if the grant had
// stayed in startClassicRun) but "map 2 opens shielded, having spent map 1's".
// It jumps maps through the dev-only window.__game hook for the same reason
// test-progression-ui.ts does — clearing a board honestly means eating every
// biscuit on it, which is minutes of real play per map and depends on the bot
// surviving, i.e. slow and flaky about something that is not the subject.
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

/** The power-up tray, as the player reads it. */
const heldPowerups = (page: Page): Promise<string[]> =>
  page.$$eval("#powerups .powerup .name", (els) =>
    els.map((e) => (e.textContent ?? "").trim()),
  );

/**
 * Is the shield BUBBLE on screen, and where?
 *
 * Found by NAME rather than by shape: "the group in the scene with four mesh
 * children" is a description that goes stale the first time the bubble gains
 * or loses a ring.
 */
const bubbleState = (page: Page): Promise<{ found: boolean; visible: boolean; near: boolean } | null> =>
  page.evaluate(() => {
    const g = (window as unknown as { __game?: Record<string, unknown> }).__game;
    if (!g) return null;
    const anyG = g as unknown as {
      rig: { scene: { getObjectByName(n: string): { visible: boolean; position: { x: number; y: number; z: number } } | undefined } };
      beagleMesh: { position: { x: number; z: number } };
    };
    const b = anyG.rig.scene.getObjectByName("shield-bubble");
    if (!b) return { found: false, visible: false, near: false };
    const dx = b.position.x - anyG.beagleMesh.position.x;
    const dz = b.position.z - anyG.beagleMesh.position.z;
    return { found: true, visible: b.visible, near: Math.hypot(dx, dz) < 0.05 };
  });

/** Jump the running game to a classic map through the dev-only debug hook. */
const gotoMap = (page: Page, levelIdx: number): Promise<boolean> =>
  page.evaluate((idx) => {
    const g = (window as unknown as { __game?: Record<string, unknown> }).__game;
    if (!g) return false;
    (g as unknown as { startLevel: (i: number) => void })["startLevel"](idx);
    return true;
  }, levelIdx);

/**
 * Empty the tray, standing in for the shield having absorbed a hit.
 *
 * Reaching into the state rather than driving a real catch is deliberate and
 * bounded: powerups.ts's own suite owns what a shielded hit DOES (it is that
 * module's whole reason to exist), and what is under test here is the GRANT
 * cadence — that map 2 hands out a shield to a player who no longer has one.
 */
const clearPowerups = (page: Page): Promise<void> =>
  page.evaluate(() => {
    const g = (window as unknown as { __game?: Record<string, unknown> }).__game;
    if (!g) return;
    (g as unknown as { powerups: { active: unknown[] } }).powerups.active.length = 0;
    (g as unknown as { syncPowerupHud: () => void })["syncPowerupHud"]();
  });

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

    // NOT `networkidle`. Measured on this stack, a cold browser context leaves
    // one Vite dep request (workbox-window) open indefinitely, so the page is
    // fully interactive and the wait never returns — which reads as the app
    // being broken. The selector below is the real readiness signal and was
    // already here; the navigation wait was only ever standing in front of it.
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 90_000 });
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

    // IDEA-064 v2: the swatch is a PAW painted from the coat, not four dots.
    // Checked as real geometry rather than by screenshot diff — the point is
    // that each coat produces DIFFERENT fills, which is the thing a hard-coded
    // palette or a one-colour font glyph could not do.
    const pawFills = await page.$$eval(".shop-rail-card .paw-swatch", (svgs) =>
      svgs.map((svg) =>
        [...svg.querySelectorAll("[fill]")].map((el) => el.getAttribute("fill")).join(","),
      ),
    );
    ok("every beagle card draws a paw", pawFills.length === 5, pawFills.length);
    // Six filled shapes — four toes, the pad and the sole — drawn from four
    // coat channels (the toes pair up: two `ear`, two `black`). Asserting the
    // DISTINCT count is the check worth having: a paw rendering as one blob
    // would still have six fills.
    ok(
      "each paw draws six shapes",
      pawFills.every((f) => f.split(",").length === 6),
      pawFills[0],
    );
    ok(
      "…from at least three distinct coat colours, so no coat is one blob",
      pawFills.every((f) => new Set(f.split(",")).size >= 3),
      pawFills.map((f) => new Set(f.split(",")).size).join(","),
    );
    ok(
      "no two coats paint the same paw",
      new Set(pawFills).size === pawFills.length,
    );
    ok(
      "the Pac-Beagle's paw shows its RED boots, which no other coat has",
      pawFills.some((f) => f.includes("#e01f26")),
      pawFills.find((f) => f.includes("#e01f26")) ?? "no red",
    );
    // The tribute coat sits LAST (Nuno's call) — the rail reads as four
    // comparable coats and then the special one.
    const coatNames = await railNames(page);
    ok(
      "the Pac-Beagle is the last card in the beagle rail",
      coatNames[coatNames.length - 1] === "Pac-Beagle",
      coatNames.join(","),
    );

    await openShopTab(page, "enemy");
    const enemies = await railNames(page);

    // THE GLYPH CHECK, and it is not decorative: a Material Symbols name that
    // is not in the font subset PRINTS ITSELF, which is what three of these
    // cards were doing. A rendered ligature name is many times wider than the
    // 26px square an icon occupies, so width is the tell.
    const enemyIconWidths = await page.$$eval(".shop-rail-card .skin-swatch-icon .bc-i", (els) =>
      els.map((e) => Math.round((e as HTMLElement).offsetWidth)),
    );
    ok(
      "every enemy card draws a GLYPH, not its ligature name",
      enemyIconWidths.length === 10 && enemyIconWidths.every((w) => w > 0 && w < 60),
      enemyIconWidths.join(","),
    );
    // Categories: six bugs, four dinners. Grouped rather than unique because
    // Material Symbols has no crab, flea, mosquito or sushi.
    const enemyGlyphs = await page.$$eval(".shop-rail-card .skin-swatch-icon .bc-i", (els) =>
      els.map((e) => (e.textContent ?? "").trim()),
    );
    ok(
      "the enemy rail reads as two categories, not ten identical faces",
      new Set(enemyGlyphs).size === 2,
      enemyGlyphs.join(","),
    );
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

    // One mark per theme, each on its own board colours.
    const themeMarks = await page.$$eval(".shop-rail-card .theme-mark .bc-i", (els) =>
      els.map((e) => (e.textContent ?? "").trim()),
    );
    ok("every theme card carries a place mark", themeMarks.length === 5, themeMarks.join(","));
    ok(
      "no two themes wear the same mark",
      new Set(themeMarks).size === themeMarks.length,
      themeMarks.join(","),
    );
    const themeMarkWidths = await page.$$eval(".shop-rail-card .theme-mark .bc-i", (els) =>
      els.map((e) => Math.round((e as HTMLElement).offsetWidth)),
    );
    ok(
      "…and every one is a glyph rather than its own name",
      themeMarkWidths.every((w) => w > 0 && w < 60),
      themeMarkWidths.join(","),
    );
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
    await page.reload({ waitUntil: "domcontentloaded", timeout: 90_000 });
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
    section("Bagel: EVERY map opens holding a shield");

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

    // IDEA-064 v5: the shield is now stated on the DOG as well as in the tray.
    // Checked in the real app because the whole feature is a call site — the
    // bubble module could be perfect and never be updated, and a bubble that is
    // never updated looks exactly like one that was never built.
    const bagelBubble = await bubbleState(page);
    ok("the shield bubble exists in the scene", bagelBubble?.found === true, bagelBubble);
    ok("…and it is on screen while the shield is held", bagelBubble?.visible === true, bagelBubble);
    ok("…and it is on the dog, not parked at the origin", bagelBubble?.near === true, bagelBubble);

    const hasHook = await gotoMap(page, 1);
    if (!hasHook) {
      console.log("  SKIP — window.__game is dev-only; the per-map grant needs it.");
    } else {
      await page.waitForTimeout(400);

      // Map 2 WITHOUT having spent map 1's. A shield is `untilHit`, so it
      // survives a cleared map and is still held here — and collect() refreshes
      // rather than pushes, so the second grant must top it up, not stack.
      const kept = await heldPowerups(page);
      ok("carrying an unspent shield into map 2 leaves ONE, not two", kept.length === 1, kept.join(","));
      ok("…and it is still the shield", kept[0]?.toLowerCase().includes("shield") === true, kept[0]);

      // And the rule itself: spend it, and the next map hands out another. This
      // is the whole of v3 — under v2 the tray would stay empty from here to
      // the end of the run.
      await clearPowerups(page);
      const spent = await heldPowerups(page);
      ok("a spent shield really leaves the tray empty", spent.length === 0, spent.join(","));

      await gotoMap(page, 2);
      await page.waitForTimeout(400);
      const regranted = await heldPowerups(page);
      ok("map 3 opens with a fresh shield", regranted.length === 1, regranted.join(","));
      ok("…and it is the shield", regranted[0]?.toLowerCase().includes("shield") === true, regranted[0]);
    }

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

    const cookieChips = await heldPowerups(page);
    ok("Cookie holds no shield — one coat, one perk", cookieChips.length === 0, cookieChips.join(","));

    // The other half of the readout: no shield, no bubble. An indicator that is
    // always on indicates nothing.
    const cookieBubble = await bubbleState(page);
    ok("…and no bubble either", cookieBubble?.visible === false, cookieBubble);

    // The per-map rule is now shared by two coats, so the "one coat, one perk"
    // half has to hold on the second map too: Cookie takes another LIFE there
    // and still no shield.
    if (await gotoMap(page, 1)) {
      await page.waitForTimeout(400);
      const cookieLives2 = await page.getAttribute("#lives", "aria-label");
      ok("Cookie's second map grants another life", cookieLives2 === "5 of 5 lives", cookieLives2);
      const cookieChips2 = await heldPowerups(page);
      ok("…and still no shield", cookieChips2.length === 0, cookieChips2.join(","));
    }

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
