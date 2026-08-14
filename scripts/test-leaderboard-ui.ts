// Browser-driven checks for the IDEA-020 leaderboard.
//
//   docker compose up -d db api
//   npm run dev
//   npx tsx scripts/test-leaderboard-ui.ts [baseUrl]
//
// Two things this covers that nothing else can: that a score played in one
// account is visible to ANOTHER account (it's a *shared* scoreboard, which the
// single-account tests can't demonstrate), and that other players' usernames
// are rendered as text rather than markup.

import { chromium, type Browser, type Page } from "playwright";

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

const uniqueName = (prefix: string): string =>
  `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`.slice(0, 20);

/** Sign up in a fresh browser context, returning the page and the username. */
async function signUp(browser: Browser, prefix: string): Promise<{ page: Page; username: string }> {
  const page = await browser.newContext().then((c) => c.newPage());
  const username = uniqueName(prefix);

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

  return { page, username };
}

async function deleteAccount(page: Page, username: string): Promise<void> {
  await page.click("#menuProfileBtn");
  await page.waitForSelector("#profile:not(.hidden)");
  await page.click("#deleteRevealBtn");
  await page.fill("#deleteConfirmInput", username);
  await page.click("#deleteConfirmBtn");
  await page.waitForSelector("#authGate:not(.hidden)", { timeout: 15_000 });
}

/** Post a score straight through the API, from inside the page so it uses the
 *  real token. Plays no game — this test is about the BOARD, and the
 *  played-run path is already covered by test-score-ui.ts. */
async function postScore(page: Page, score: number): Promise<number> {
  return page.evaluate(async (targetScore) => {
    const api = "http://localhost:3001";
    const token = window.localStorage.getItem("beagle-chomp:token") ?? "";
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

    const start = await fetch(`${api}/api/v1/sessions/start`, {
      method: "POST",
      headers,
      body: JSON.stringify({ mode: "classic" }),
    });
    if (!start.ok) return 0;
    const { sessionId } = (await start.json()) as { sessionId: string };

    // Build a payload that is genuinely reachable on maze 0, which holds only
    // 175 biscuits + 4 bones + 2 fruit — so a score is made up mostly of GHOST
    // points, exactly as a real high-scoring run would be. (Asking for 420
    // pellets on a 175-pellet maze is what a first draft of this helper did,
    // and the validator correctly refused it.)
    const pellets = Math.min(175, Math.floor(targetScore / 10));
    let remaining = targetScore - pellets * 10;

    const bones = Math.min(4, Math.floor(remaining / 50));
    remaining -= bones * 50;

    // Ghosts at the 200-point chain minimum: at most 3 per bone in classic.
    const ghosts = Math.min(bones * 3, Math.floor(remaining / 200));
    remaining -= ghosts * 200;

    const fruit = Math.min(2, Math.floor(remaining / 100));

    const score = pellets * 10 + bones * 50 + ghosts * 200 + fruit * 100;

    const res = await fetch(`${api}/api/v1/sessions/${sessionId}/finish`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        score,
        // Reported as UNFINISHED so the time floor doesn't apply — this helper
        // is about populating the BOARD, not about exercising the bounds.
        levelsCleared: 0,
        mazeIdxSequence: [0],
        pelletsEaten: pellets,
        bonesEaten: bones,
        fruitEaten: fruit,
        ghostsEaten: ghosts,
        coinsCollected: 0,
        livesLost: 3,
        playSeconds: 120,
      }),
    });
    const body = (await res.json()) as { accepted: boolean };
    return body.accepted ? score : 0;
  }, score);
}

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const consoleErrors: string[] = [];

  let alice: { page: Page; username: string } | null = null;
  let bob: { page: Page; username: string } | null = null;

  try {
    section("Empty board");

    alice = await signUp(browser, "alice");
    alice.page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });
    alice.page.on("pageerror", (e) => consoleErrors.push(String(e)));

    await alice.page.click("#menuLeaderboardBtn");
    await alice.page.waitForSelector("#leaderboard:not(.hidden)", { timeout: 15_000 });

    ok("the leaderboard opens from the menu", await alice.page.isVisible("#leaderboard"));

    const header = (await alice.page.textContent(".lb-header")) ?? "";
    // Otherwise a player who just cleared C8 would wonder where their score went.
    ok("it says CLASSIC mode explicitly", /classic/i.test(header), header.replace(/\s+/g, " ").trim());

    await alice.page.waitForTimeout(1200);
    const emptyBody = (await alice.page.textContent(".lb-body")) ?? "";
    ok("an unranked player is told how to get on the board", /play a classic run/i.test(emptyBody), emptyBody.trim().slice(0, 80));

    await alice.page.click(".lb-header button");
    await alice.page.waitForSelector("#leaderboard.hidden", { state: "attached" });
    ok("it closes back to the menu", await alice.page.isVisible("#mainMenu"));

    section("A score appears on the board");

    const aliceScore = await postScore(alice.page, 4200);
    ok("alice's score was accepted", aliceScore > 0, aliceScore);

    await alice.page.click("#menuLeaderboardBtn");
    await alice.page.waitForSelector(".lb-row", { timeout: 15_000 });

    const rows = await alice.page.locator(".lb-row").count();
    ok("the board has a row", rows >= 1, rows);
    ok("alice is listed", (await alice.page.textContent(".lb-list"))?.includes(alice.username) === true);
    const aliceFormatted = await alice.page.evaluate(
      (n) => n.toLocaleString(),
      aliceScore,
    );
    ok(
      "her score is shown",
      (await alice.page.textContent(".lb-list"))?.includes(aliceFormatted) === true,
      `${aliceScore} -> ${aliceFormatted}`,
    );
    ok("rank 1 gets a medal", (await alice.page.textContent(".lb-rank")) === "🥇");
    ok("her own row is highlighted", (await alice.page.locator(".lb-row-me").count()) === 1);

    await alice.page.click(".lb-header button");
    await alice.page.waitForSelector("#leaderboard.hidden", { state: "attached" });

    section("It is SHARED — a second player sees the first");

    bob = await signUp(browser, "bob");
    const bobScore = await postScore(bob.page, 7100);
    ok("bob's higher score was accepted", bobScore > 0, bobScore);
    ok("bob outscored alice (so ordering is testable)", bobScore > aliceScore, `${bobScore} vs ${aliceScore}`);

    await bob.page.click("#menuLeaderboardBtn");
    await bob.page.waitForSelector(".lb-row", { timeout: 15_000 });

    const boardText = (await bob.page.textContent(".lb-list")) ?? "";
    ok("bob sees ALICE's score too", boardText.includes(alice.username), boardText.replace(/\s+/g, " ").slice(0, 120));
    ok("bob sees his own", boardText.includes(bob.username));

    // Ordering is the point of a leaderboard.
    const names = await bob.page.locator(".lb-name").allTextContents();
    ok("the higher score ranks first", names[0] === bob.username, names.join(" | "));
    ok("the lower score ranks second", names[1] === alice.username, names.join(" | "));

    const scores = await bob.page.locator(".lb-score").allTextContents();
    const bobFormatted = await bob.page.evaluate((n) => n.toLocaleString(), bobScore);
    ok(
      "scores are rendered with thousands separators",
      scores[0] === bobFormatted,
      `${scores.join(" | ")} (expected ${bobFormatted})`,
    );

    section("Other players' names are TEXT, never markup");

    // The server's username regex already forbids the characters that matter;
    // this asserts the client's own defence independently, by checking that the
    // rendered name node contains no element children at all.
    const nameIsPlainText = await bob.page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll(".lb-name"));
      return nodes.every((n) => n.children.length === 0 && n.textContent !== null);
    });
    ok("every username renders as a pure text node", nameIsPlainText);

    section("Cleanup");

    await bob.page.click(".lb-header button");
    await bob.page.waitForSelector("#leaderboard.hidden", { state: "attached" });
    await deleteAccount(bob.page, bob.username);
    ok("bob's account deleted", true);

    await deleteAccount(alice.page, alice.username);
    ok("alice's account deleted", true);

    section("Console hygiene");
    const real = consoleErrors.filter((e) => !/service worker|sw\.js|workbox|favicon/i.test(e));
    ok("no unexpected console errors", real.length === 0, real.slice(0, 2).join(" | "));
  } finally {
    await browser.close();
  }

  console.log(`\n${"-".repeat(60)}`);
  console.log(`LEADERBOARD UI: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err: unknown) => {
  console.error("test-leaderboard-ui crashed:", err);
  process.exit(1);
});
