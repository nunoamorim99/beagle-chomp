// Browser check for the tutorial carousel (IDEA-040 v2).
//
//   docker compose up -d db api
//   npm run dev
//   npx tsx scripts/test-tutorial-ui.ts [baseUrl]
//
// The copy is covered purely in scripts/test-tutorial-carousel.ts. What only a
// browser can show: that a new player meets it BEFORE the run starts, that the
// live 3D illustration is actually rendering behind it, that Next/Back/dots
// move through all five, that finishing persists to the account, and that the
// account screen can reopen it on demand.

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
  `tc${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`.slice(0, 20);

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

const title = (page: Page): Promise<string> =>
  page.evaluate(() => document.querySelector(".tut-title")?.textContent?.trim() ?? "");

const gameMode = (page: Page): Promise<string | undefined> =>
  page.evaluate(() => (window as unknown as { __game?: { mode?: string } }).__game?.mode);

/** Wait for the server to agree — the flag is written optimistically and
 *  synced in the background, so reading it back is the real assertion. */
async function tutorialPersisted(page: Page): Promise<boolean> {
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

  section("A new player meets it before the run starts");
  await signUp(page, username);
  await page.click("#playBtn");
  await page.waitForSelector("#tutorial:not(.hidden)", { timeout: 30_000 });

  ok("the carousel opens", await page.$(".tut-card") !== null);
  ok("it starts on the movement slide", /steer/i.test(await title(page)), await title(page));

  // The whole point of moving it ahead of beginRunSession: the run must not
  // have started, so the session clock isn't burning while the player reads.
  ok("the run has NOT started yet", (await gameMode(page)) !== "play", await gameMode(page));
  ok("the menu is hidden behind it",
    await page.evaluate(() => document.body.classList.contains("tutorial-open")));

  // The illustration is the real game's meshes, rendered behind a transparent
  // stage. If the stage were painted, the 3D would be invisible.
  const stageBg = await page.evaluate(() => {
    const el = document.querySelector(".tut-stage");
    return el ? getComputedStyle(el).backgroundColor : "missing";
  });
  ok("the 3D stage is transparent", /rgba\(0, 0, 0, 0\)|transparent/.test(stageBg), stageBg);

  section("Stepping through all five");
  const seen: string[] = [await title(page)];
  for (let i = 0; i < 4; i++) {
    await page.click(".tut-next");
    await page.waitForTimeout(250);
    seen.push(await title(page));
  }
  ok("five distinct slides", new Set(seen).size === 5, seen.join(" | "));
  ok("the last one offers Got it",
    /got it/i.test((await page.textContent(".tut-next")) ?? ""),
    await page.textContent(".tut-next"));
  ok("Skip is gone on the last slide", await page.$(".tut-skip") === null);

  await page.click(".tut-back");
  await page.waitForTimeout(250);
  ok("Back returns to the previous slide", (await title(page)) === seen[3], await title(page));

  await page.click(".tut-dot[data-idx='0']");
  await page.waitForTimeout(250);
  ok("a dot jumps straight to that slide", (await title(page)) === seen[0], await title(page));

  section("Finishing starts the run");
  for (let i = 0; i < 4; i++) {
    await page.click(".tut-next");
    await page.waitForTimeout(200);
  }
  await page.click(".tut-next");
  await page.waitForSelector("#tutorial.hidden", { timeout: 15_000 });
  ok("the carousel closes", await page.$(".tut-card") === null);

  await page.waitForFunction(
    () => {
      const m = (window as unknown as { __game?: { mode?: string } }).__game?.mode;
      return m === "ready" || m === "play";
    },
    undefined,
    { timeout: 60_000, polling: 250 },
  );
  ok("the run begins once it's dismissed", true);
  ok("finishing is persisted to the account", await tutorialPersisted(page));

  section("It doesn't come back uninvited");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("#mainMenu:not(.hidden)", { timeout: 30_000 });
  await page.click("#playBtn");
  await page.waitForTimeout(2_500);
  ok("no carousel on the next run", await page.$(".tut-card") === null);

  const fresh = await browser.newPage({ viewport: { width: 390, height: 844 } });
  fresh.setDefaultTimeout(60_000);
  await login(fresh, username);
  await fresh.click("#playBtn");
  await fresh.waitForTimeout(2_500);
  ok("nor after signing in elsewhere", await fresh.$(".tut-card") === null);
  await fresh.close();

  section("…but Account can open it any time");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>("#homeBtn")?.click());
  await page.waitForTimeout(1_200);
  await page.click("#menuProfileBtn");
  await page.waitForSelector("#replayTutorialBtn", { timeout: 15_000 });
  ok("the button says View tutorial",
    /view tutorial/i.test((await page.textContent("#replayTutorialBtn")) ?? ""),
    await page.textContent("#replayTutorialBtn"));

  await page.click("#replayTutorialBtn");
  await page.waitForSelector("#tutorial:not(.hidden)", { timeout: 15_000 });
  ok("it opens straight away", await page.$(".tut-card") !== null);
  ok("…back at the first slide", /steer/i.test(await title(page)), await title(page));

  // Closing a replay must not start a game, and must not un-learn it.
  for (let i = 0; i < 4; i++) {
    await page.click(".tut-next");
    await page.waitForTimeout(180);
  }
  await page.click(".tut-next");
  await page.waitForSelector("#tutorial.hidden", { timeout: 15_000 });
  await page.waitForTimeout(800);
  ok("a replay does not start a run", (await gameMode(page)) !== "play", await gameMode(page));
  ok("and it stays learned", await tutorialPersisted(page));

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
