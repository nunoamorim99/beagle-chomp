// Browser check that the first-run coach actually reaches a new player
// (IDEA-040), and — just as important — that it never bothers a returning one.
//
//   docker compose up -d db api
//   npm run dev
//   npx tsx scripts/test-tutorial-ui.ts [baseUrl]
//
// The ordering logic is covered exhaustively in scripts/test-tutorial.ts. What
// only a browser can show: that the caption renders over live play, that it
// doesn't block steering, that Skip removes it, and that the "already taught"
// flag survives a reload because it lives on the account rather than in memory.

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
  `tu${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`.slice(0, 20);

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

async function login(page: Page, username: string): Promise<void> {
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.waitForSelector("#tabLogin", { timeout: 30_000 });
  await page.click("#tabLogin");
  await page.fill("#loginUsername", username);
  await page.fill("#loginPassword", PASSWORD);
  await page.click("#loginForm button[type=submit]");
  await page.waitForSelector("#mainMenu:not(.hidden)", { timeout: 30_000 });
}

/** Steer for a while so the run produces real events (biscuits, bones). */
async function play(page: Page, seconds: number): Promise<void> {
  const keys = ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"];
  const deadline = Date.now() + seconds * 1000;
  let i = 0;
  while (Date.now() < deadline) {
    await page.keyboard.press(keys[i++ % keys.length]);
    await page.waitForTimeout(260);
  }
}

const captionText = (page: Page): Promise<string> =>
  page.evaluate(() => document.querySelector(".tutorial-tip")?.textContent?.trim() ?? "");

/** Wait until the run is actually in "play". Headless Chromium renders the 3D
 *  scene in software, so the READY countdown can take several seconds — a
 *  fixed sleep here is flaky by construction. */
async function waitForPlay(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as { __game?: { mode?: string } }).__game?.mode === "play",
    undefined,
    { timeout: 60_000, polling: 250 },
  );
}

/** Wait until the SERVER agrees the tutorial is done. setTutorialDone writes
 *  the cache immediately and syncs in the background, so reloading too soon
 *  races the write — and it is the persisted value this test cares about. */
async function waitForTutorialPersisted(page: Page): Promise<boolean> {
  try {
    await page.waitForFunction(
      async () => {
        const token = window.localStorage.getItem("beagle-chomp:token");
        if (!token) return false;
        const res = await fetch("http://localhost:3001/api/v1/profile", {
          headers: { authorization: `Bearer ${token}` },
        });
        if (!res.ok) return false;
        const body = await res.json();
        return body?.profile?.tutorialDone === true;
      },
      undefined,
      { timeout: 20_000, polling: 500 },
    );
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(60_000);

  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  const username = uniqueName();

  section("A brand-new player is coached");
  await signUp(page, username);
  await page.click("#playBtn");
  await waitForPlay(page);
  await page.waitForTimeout(500);

  ok("the coach is mounted", await page.$(".tutorial") !== null);

  const first = await captionText(page);
  ok("the first tip explains how to move", /swipe|pad/i.test(first), first);

  // It must not swallow input: the strip covers part of the board.
  const blocks = await page.evaluate(() => {
    const strip = document.querySelector(".tutorial");
    return strip ? getComputedStyle(strip).pointerEvents : "missing";
  });
  ok("the caption strip doesn't capture input", blocks === "none", blocks);

  section("Tips follow what the player does");
  await play(page, 14);
  const taught = await page.evaluate(() => {
    const g = (window as unknown as { __game?: { coach?: { seen: Set<string> } } }).__game;
    return g?.coach ? [...g.coach.seen] : [];
  });
  ok("the biscuit lesson fires once biscuits are eaten",
    taught.includes("biscuits") || taught.length === 0, taught.join(","));
  ok("more than one lesson has been delivered", taught.length >= 2, taught.join(","));

  section("Skip stops it immediately");
  const skip = await page.$(".tutorial-skip");
  ok("there is a Skip button", skip !== null);
  await skip?.click();
  await page.waitForTimeout(600);
  ok("the coach is gone after Skip", await page.$(".tutorial") === null);

  section("It never bothers the player again");
  ok("skipping is persisted to the account", await waitForTutorialPersisted(page));

  // Reload rather than just checking memory: the flag has to have reached the
  // account, which is the whole point of storing it server-side.
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("#mainMenu:not(.hidden)", { timeout: 30_000 });
  await page.click("#playBtn");
  await waitForPlay(page);
  ok("no coach on the next run", await page.$(".tutorial") === null);

  section("…on any device");
  const fresh = await browser.newPage({ viewport: { width: 390, height: 844 } });
  fresh.setDefaultTimeout(60_000);
  await login(fresh, username);
  await fresh.click("#playBtn");
  await waitForPlay(fresh);
  ok("no coach after signing in elsewhere", await fresh.$(".tutorial") === null);
  await fresh.close();

  section("The account screen can bring the tips back");
  await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>("#homeBtn")?.click();
  });
  await page.waitForTimeout(1_200);
  await page.click("#menuProfileBtn");
  await page.waitForSelector("#replayTutorialBtn", { timeout: 15_000 });
  await page.click("#replayTutorialBtn");
  await page.waitForTimeout(1_500);
  const label = await page.textContent("#replayTutorialBtn");
  ok("the button confirms in place", /next game/i.test(label ?? ""), label);

  await page.click("#profileCloseBtn");
  await page.waitForTimeout(600);
  await page.click("#playBtn");
  await waitForPlay(page);
  ok("the coach returns for the next game", await page.$(".tutorial") !== null);

  ok("no console errors throughout", errors.length === 0, errors.slice(0, 2).join(" | "));

  await browser.close();

  console.log(`\n${"-".repeat(60)}`);
  console.log(`TUTORIAL UI: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
