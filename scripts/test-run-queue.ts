// Browser-driven check that a finished run is NEVER lost to a network failure.
//
//   docker compose up -d db api
//   npm run dev
//   npx tsx scripts/test-run-queue.ts [baseUrl]
//
// This is the test that matters for the "I scored 16 000 and the board still
// shows my old record" complaint. The submit used to be a single fetch with no
// retry, so one dropped packet at the moment the run ended lost the score for
// good, silently.
//
// Everything here runs against the REAL app in a REAL browser, because the
// interesting behaviour is all in the seams: localStorage persistence across a
// reload, the browser's own offline mode, and the `online` event. A unit test
// with a mocked fetch would prove none of it.

// reducedMotion: "reduce" on every context.
//
// The menu’s Play button carries an idle bob (design system §09). An element
// whose bounding box never settles never becomes actionable in Playwright, so
// a looping animation on a control hangs every click on it. Asking for reduced
// motion is the honest fix: it is a real user preference the stylesheet already
// honours, it stills the button, and it means the product keeps the motion
// instead of dropping it to suit a test runner.

import { chromium, type Page, type BrowserContext } from "playwright";

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
  `rq${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`.slice(0, 20);

const PENDING_KEY = "beagle-chomp:pending-runs";

async function signUp(page: Page, username: string): Promise<void> {
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.waitForSelector("#signupUsername", { timeout: 30_000 });
  await page.fill("#signupUsername", username);
  await page.fill("#signupPassword", PASSWORD);
  await page.click("#signupForm button[type=submit]");
  // The recovery-code screen is deliberately blocking.
  await page.waitForSelector("#recoveryCode:not(.hidden)", { timeout: 30_000 });
  await page.check("#recoverySavedCheck");
  await page.click("#recoveryContinueBtn");
  await page.waitForSelector("#mainMenu:not(.hidden)", { timeout: 30_000 });
}

async function readPending(page: Page): Promise<unknown[]> {
  return page.evaluate((key) => {
    try {
      return JSON.parse(window.localStorage.getItem(key) ?? "[]");
    } catch {
      return [];
    }
  }, PENDING_KEY);
}

async function main(): Promise<void> {
  const browser = await chromium.launch();

  // --- a run finished while OFFLINE is queued, not lost --------------------
  section("A run that can't be submitted is queued");

  const context: BrowserContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);

  const username = uniqueName();
  await signUp(page, username);

  // Go offline AFTER the session has been issued, so the run is real and the
  // server already knows about it — exactly the case the queue exists for.
  await page.click("#playBtn");
  await page.waitForTimeout(2_500);
  await context.setOffline(true);

  await page.waitForFunction(
    () => /final score/i.test(document.querySelector("#center .panel")?.textContent ?? ""),
    undefined,
    { timeout: 240_000, polling: 500 },
  );

  // PERSIST-FIRST: the run must be on disk the moment the panel shows — not
  // after the retries exhaust. This is what protects the die-and-swipe-the-
  // app-away player, who never waits around for a backoff schedule.
  const immediate = await readPending(page);
  ok(
    "the run is persisted the instant the game ends",
    immediate.length === 1,
    immediate.length,
  );

  // Then let the foreground retries (700ms + 1400ms) exhaust so the offline
  // notice appears.
  await page.waitForTimeout(6_000);

  const queued = await readPending(page);
  ok("still queued after retries exhaust", queued.length === 1, queued.length);

  const panelText = (await page.textContent("#center .panel")) ?? "";
  ok(
    "the player is told it will be sent later",
    /sent automatically|back online/i.test(panelText),
    panelText.replace(/\s+/g, " ").slice(0, 120),
  );

  const scoreText = (await page.textContent("#center .panel h1")) ?? "0";
  const runScore = Number(scoreText.replace(/\D/g, ""));
  ok("the run scored something to lose", runScore > 0, runScore);

  // --- it survives a full reload ------------------------------------------
  section("It survives closing the app");

  await page.reload({ waitUntil: "domcontentloaded" });
  const afterReload = await readPending(page);
  ok("still queued after a reload", afterReload.length === 1, afterReload.length);

  // --- coming back online flushes it --------------------------------------
  section("Reconnecting sends it");

  await context.setOffline(false);
  // The 'online' event fires on the page; the boot flush is the backstop.
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("#mainMenu:not(.hidden)", { timeout: 30_000 });

  // Give the scheduled flush (1.5s) room, plus the request itself.
  await page.waitForFunction(
    (key) => {
      try {
        return JSON.parse(window.localStorage.getItem(key) ?? "[]").length === 0;
      } catch {
        return true;
      }
    },
    PENDING_KEY,
    { timeout: 30_000, polling: 500 },
  ).catch(() => { /* asserted below with a real message */ });

  const afterFlush = await readPending(page);
  ok("the queue drains once back online", afterFlush.length === 0, afterFlush.length);

  // And the score actually reached the board.
  await page.click("#menuLeaderboardBtn");
  await page.waitForSelector(".lb-row", { timeout: 30_000 });
  await page.waitForTimeout(600);
  const mineText = (await page.textContent(".lb-mine")) ?? "";
  const boardScore = Number((mineText.match(/[\d\s ]{2,}/)?.[0] ?? "0").replace(/\D/g, ""));
  ok(
    "the recovered run appears on the leaderboard",
    boardScore === runScore,
    `board=${boardScore} run=${runScore}`,
  );

  await context.close();

  // --- a queued run is not stolen by a different account -------------------
  section("A queued run belongs to its own account");

  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const page2 = await ctx2.newPage();
  page2.setDefaultTimeout(60_000);

  const owner = uniqueName();
  await signUp(page2, owner);
  await page2.click("#playBtn");
  await page2.waitForTimeout(2_500);
  await ctx2.setOffline(true);
  await page2.waitForFunction(
    () => /final score/i.test(document.querySelector("#center .panel")?.textContent ?? ""),
    undefined,
    { timeout: 240_000, polling: 500 },
  );
  await page2.waitForTimeout(6_000);
  ok("owner's run is queued", (await readPending(page2)).length === 1);

  // Sign out and in as somebody else, with the connection restored.
  await ctx2.setOffline(false);
  const other = uniqueName();
  await page2.evaluate(() => window.localStorage.removeItem("beagle-chomp:token"));
  await signUp(page2, other);
  await page2.waitForTimeout(6_000);

  const stillQueued = await readPending(page2);
  ok(
    "it is NOT submitted under the other account",
    stillQueued.length === 1,
    `expected it to stay queued, found ${stillQueued.length}`,
  );

  await ctx2.close();
  await browser.close();

  console.log(`\n${"-".repeat(60)}`);
  console.log(`RUN QUEUE: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
