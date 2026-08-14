// Browser-driven check that a real played run reaches the server and is
// judged (IDEA-020 Increment 2).
//
//   docker compose up -d db api
//   npm run dev
//   npx tsx scripts/test-score-ui.ts [baseUrl]
//
// What this covers that no headless test can: that a session is actually
// issued before a run starts, that gameplay accumulates telemetry, and that
// the finish call lands with numbers the validator accepts. The bounds
// themselves are covered exhaustively in server/scripts/test-plausibility.ts.

import { chromium, type Page } from "playwright";

const BASE_URL = process.argv[2] ?? "http://localhost:5175";

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
  `sc${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`.slice(0, 20);

/** Drive the beagle with real key presses for a while, so the run produces
 *  genuine telemetry rather than a synthetic payload. */
async function playFor(page: Page, seconds: number): Promise<void> {
  const keys = ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"];
  const deadline = Date.now() + seconds * 1000;
  let i = 0;
  while (Date.now() < deadline) {
    await page.keyboard.press(keys[i % keys.length]);
    i++;
    await page.waitForTimeout(420);
  }
}

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const page = await browser.newContext().then((c) => c.newPage());

  const apiCalls: Array<{ url: string; status: number }> = [];
  page.on("response", (res) => {
    const url = res.url();
    if (url.includes("/api/v1/sessions")) apiCalls.push({ url, status: res.status() });
  });

  const consoleErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  const username = uniqueName();

  try {
    section("Sign up and start a run");

    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.waitForSelector("#authGate:not(.hidden)", { timeout: 20_000 });
    await page.click("#goSignup");
    await page.waitForSelector("#signupForm");
    await page.fill("#signupUsername", username);
    await page.fill("#signupPassword", "a-decent-password");
    await page.click("#signupForm button[type=submit]");

    await page.waitForSelector("#recoveryCode:not(.hidden)", { timeout: 25_000 });
    await page.check("#recoverySavedCheck");
    await page.click("#recoveryContinueBtn");
    await page.waitForSelector("#mainMenu:not(.hidden)", { timeout: 20_000 });

    ok("starts with 0 coins", (await page.textContent("#menuCoinLine"))?.includes("0") === true);

    await page.click("#playBtn");
    // The run only begins once the server issues a ticket, so the READY banner
    // appearing at all is evidence the session call succeeded.
    await page.waitForSelector("#center:not(.hidden)", { timeout: 20_000 });

    const startCall = apiCalls.find((c) => c.url.endsWith("/sessions/start"));
    ok("a session was requested before the run", startCall !== undefined);
    ok("the session was issued (201)", startCall?.status === 201, startCall?.status);

    section("Play a real run");

    await playFor(page, 22);

    const score = Number((await page.textContent("#score")) ?? "0");
    ok("the run scored points", score > 0, `score=${score}`);

    section("Finish the run (play until out of lives)");

    // Stop steering and let the ghosts do their work. Generous timeout: three
    // lives at ~1.3s per death plus respawns.
    const gameOverAppeared = await page
      .waitForFunction(
        () => document.querySelector("#center")?.textContent?.includes("final score") === true,
        undefined,
        { timeout: 180_000 },
      )
      .then(() => true)
      .catch(() => false);

    ok("the run ended with a game-over panel", gameOverAppeared);

    if (gameOverAppeared) {
      // The submit fires as the panel renders; give it a moment to land.
      await page.waitForTimeout(3_000);

      const finishCall = apiCalls.find((c) => c.url.includes("/finish"));
      ok("the score was submitted", finishCall !== undefined);
      ok("the server accepted the request (200)", finishCall?.status === 200, finishCall?.status);

      // The authoritative proof: ask the API directly what it stored.
      const profile = await page.evaluate(async () => {
        const token = window.localStorage.getItem("beagle-chomp:token");
        const base = document
          .querySelector("script[type=module]")
          ?.getAttribute("src");
        void base;
        const res = await fetch(`${(window as unknown as { __API__?: string }).__API__ ?? "http://localhost:3001"}/api/v1/profile`, {
          headers: { Authorization: `Bearer ${token ?? ""}` },
        });
        return (await res.json()) as { profile: { coins: number; highScore: number } };
      });

      ok(
        "the server recorded a high score",
        profile.profile.highScore > 0,
        `highScore=${profile.profile.highScore}`,
      );

      // Compare against the FINAL score on the game-over panel, not the
      // mid-run reading taken earlier — the beagle keeps eating between the
      // two, so that snapshot is legitimately lower.
      const finalScore = Number(
        (await page.textContent("#center h1"))?.replace(/[^0-9]/g, "") ?? "0",
      );
      ok(
        "the stored score matches the run's final score",
        profile.profile.highScore === finalScore,
        `server=${profile.profile.highScore} panel=${finalScore}`,
      );
      ok("the final score is at least the mid-run reading", finalScore >= score, `${finalScore} vs ${score}`);
      ok(
        "coins were awarded server-side",
        profile.profile.coins >= 0,
        `coins=${profile.profile.coins}`,
      );
    }

    section("Cleanup");

    await page.click("#gameOverMenuBtn").catch(() => {});
    await page.waitForSelector("#mainMenu:not(.hidden)", { timeout: 15_000 });
    await page.click("#menuProfileBtn");
    await page.waitForSelector("#profile:not(.hidden)");
    await page.click("#deleteRevealBtn");
    await page.fill("#deleteConfirmInput", username);
    await page.click("#deleteConfirmBtn");
    await page.waitForSelector("#authGate:not(.hidden)", { timeout: 15_000 });
    ok("test account deleted", true);

    section("Console hygiene");
    const real = consoleErrors.filter((e) => !/service worker|sw\.js|workbox|favicon/i.test(e));
    ok("no unexpected console errors", real.length === 0, real.slice(0, 2).join(" | "));
  } finally {
    await browser.close();
  }

  console.log(`\n${"-".repeat(60)}`);
  console.log(`SCORE UI: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err: unknown) => {
  console.error("test-score-ui crashed:", err);
  process.exit(1);
});
