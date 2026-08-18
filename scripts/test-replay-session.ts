// Browser check that a REPLAY gets its own server session (the "Play again"
// bug), plus the general rule behind it.
//
//   docker compose up -d db api
//   npm run dev
//   npx tsx scripts/test-replay-session.ts [baseUrl]
//
// THE BUG THIS EXISTS FOR: "Play again" called startLevel(0) directly instead
// of going through beginRunSession, so the replay had no session id.
// submitRun() bails on its first line when sessionId is null — silently, before
// any notice or rejection log — so every run after the first death was lost
// without a trace. A player who died once and pressed the obvious button never
// scored again.
//
// Nothing caught it because no test ever pressed "Play again". This one does.

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
  `rp${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`.slice(0, 20);

const sessionId = (page: Page): Promise<string | null> =>
  page.evaluate(() =>
    (window as unknown as { __game?: { sessionId?: string | null } }).__game?.sessionId ?? null);

async function waitForPlay(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as { __game?: { mode?: string } }).__game?.mode === "play",
    undefined,
    { timeout: 90_000, polling: 250 },
  );
}

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(90_000);

  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // Sign up, dismiss the tutorial, reach the first run.
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.waitForSelector("#signupUsername", { timeout: 30_000 });
  await page.fill("#signupUsername", uniqueName());
  await page.fill("#signupPassword", PASSWORD);
  await page.click("#signupForm button[type=submit]");
  await page.waitForSelector("#recoveryCode:not(.hidden)", { timeout: 30_000 });
  await page.check("#recoverySavedCheck");
  await page.click("#recoveryContinueBtn");
  await page.waitForSelector("#mainMenu:not(.hidden)", { timeout: 30_000 });
  await page.click("#playBtn");
  await page.waitForSelector("#tutorial:not(.hidden)", { timeout: 30_000 });
  for (let i = 0; i < 5; i++) {
    await page.click(".tut-next");
    await page.waitForTimeout(150);
  }

  section("The first run gets a session");
  await waitForPlay(page);
  const first = await sessionId(page);
  ok("a session id exists during the first run", typeof first === "string" && first.length > 20, first);

  section("Dying and pressing Play again");
  // Stand still — the pack takes all three lives.
  await page.waitForFunction(
    () => /final score/i.test(document.querySelector("#center .panel")?.textContent ?? ""),
    undefined,
    { timeout: 300_000, polling: 500 },
  );
  ok("the run ended", true);
  ok("the session is spent once submitted", (await sessionId(page)) === null, await sessionId(page));

  await page.click("#againBtn");
  await waitForPlay(page);

  // THE ASSERTION. Before the fix this was null for the whole replay, and the
  // run could never be submitted.
  const second = await sessionId(page);
  ok("the REPLAY gets its own session id",
    typeof second === "string" && second.length > 20, second);
  ok("…and it is a different session from the first", second !== first, `${first} vs ${second}`);

  section("The replay starts clean");
  const telemetry = await page.evaluate(() => {
    const t = (window as unknown as {
      __game?: { telemetry?: { pelletsEaten: number; mazeIdxSequence: number[] } };
    }).__game?.telemetry;
    return t ? { pellets: t.pelletsEaten, levels: t.mazeIdxSequence.length } : null;
  });
  // beginRunSession resets telemetry; the old path skipped it, so a replay
  // counted the previous run's pellets on top of its own.
  ok("telemetry is reset for the replay", (telemetry?.levels ?? 99) === 1,
    JSON.stringify(telemetry));
  ok("no console errors", errors.length === 0, errors.slice(0, 2).join(" | "));

  await browser.close();

  console.log(`\n${"-".repeat(60)}`);
  console.log(`REPLAY SESSION: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
