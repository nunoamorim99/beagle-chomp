// Browser-driven checks for the IDEA-019 account screens.
//
// Follows the ad-hoc Playwright precedent set by scripts/test-editor*.ts:
// committed, runnable on demand, NOT part of `npm run test` (it needs a dev
// server and a live API).
//
//   docker compose up -d db api     # from the repo root
//   npm run dev                     # note the port it picks
//   npx tsx scripts/test-auth-ui.ts [baseUrl]
//
// What this covers that the headless suites cannot: that the auth gate actually
// gates, and — most importantly — that the recovery-code screen genuinely
// BLOCKS. With no email on file that screen is the only thing standing between
// a player and a permanently lost account, so "you can't dismiss it by accident"
// is a functional requirement, not a UI nicety.

import { chromium } from "playwright";

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
  `ui${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`.slice(0, 20);

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  const username = uniqueName();
  const password = "a-perfectly-fine-password";
  let recoveryCode = "";

  try {
    // --- the gate actually gates -------------------------------------------
    section("Auth gate blocks play");

    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.waitForSelector("#authGate:not(.hidden)", { timeout: 15_000 });

    ok("auth gate is shown on first load", await page.isVisible("#authGate"));
    ok("the main menu is NOT reachable while signed out", !(await page.isVisible("#mainMenu")));
    // IDEA-035: brand block first, then two tabs, with recovery below.
    ok("the app icon is shown", await page.isVisible(".auth-logo"));
    ok("the game name is shown", (await page.textContent(".auth-brand .auth-title"))?.includes("Beagle Chomp") === true);
    ok("both tabs are offered", (await page.locator("#tabSignup, #tabLogin").count()) === 2);
    ok("Create account is the DEFAULT tab", await page.locator("#tabSignup").evaluate((el) => el.classList.contains("is-active")));
    ok("the signup form is shown without any click", await page.isVisible("#signupForm"));
    ok("recovery is offered below the tabs", await page.isVisible("#goRecover"));

    section("Tabs switch between the two forms");

    await page.click("#tabLogin");
    await page.waitForSelector("#loginForm");
    ok("Login tab shows the login form", await page.isVisible("#loginForm"));
    ok("...and hides the signup form", (await page.locator("#signupForm").count()) === 0);
    ok("Login tab is marked active", await page.locator("#tabLogin").evaluate((el) => el.classList.contains("is-active")));

    await page.click("#tabSignup");
    await page.waitForSelector("#signupForm");
    ok("Create account tab comes back", await page.isVisible("#signupForm"));
    ok("...and hides the login form", (await page.locator("#loginForm").count()) === 0);

    // Recovery is reachable from either tab and returns to the tabbed screen.
    await page.click("#goRecover");
    await page.waitForSelector("#recoverForm");
    ok("recovery opens from the main screen", await page.isVisible("#recoverForm"));
    await page.click("#backToAuth");
    await page.waitForSelector("#signupForm");
    ok("Back returns to the tabs", await page.isVisible(".auth-tabs"));

    // --- signup -------------------------------------------------------------
    section("Signup");

    await page.waitForSelector("#signupForm");

    // The privacy notice must be reachable BEFORE handing over a password.
    await page.click("#privacyLink");
    await page.waitForSelector("#privacy:not(.hidden)");
    ok("privacy notice opens from the signup form", await page.isVisible("#privacy"));
    ok("privacy notice states there is no email collected", (await page.textContent("#privacy"))?.includes("don't collect email") === true);
    await page.click("#privacyCloseBtn");
    await page.waitForSelector("#privacy.hidden", { state: "attached" });

    await page.fill("#signupUsername", username);
    await page.fill("#signupPassword", password);
    await page.click("#signupForm button[type=submit]");

    // --- the blocking recovery screen: the critical part --------------------
    section("Recovery-code screen BLOCKS (the account-loss guard)");

    await page.waitForSelector("#recoveryCode:not(.hidden)", { timeout: 20_000 });
    ok("recovery screen appears immediately after signup", await page.isVisible("#recoveryCode"));

    recoveryCode = (await page.textContent("#recoveryCodeValue")) ?? "";
    ok("a well-formed code is displayed", /^BEAGLE-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(recoveryCode.trim()), recoveryCode);

    const warning = (await page.textContent("#recoveryCode")) ?? "";
    ok("warns this is the ONLY way back in", /only way/i.test(warning));
    ok("states plainly there is no password-reset email", /no password-reset email/i.test(warning));
    ok("tells the player to screenshot or write it down", /screenshot/i.test(warning));

    // The continue button must be inert until the player confirms.
    ok("continue is disabled before confirming", await page.isDisabled("#recoveryContinueBtn"));

    // Escape must NOT dismiss it.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    ok("Escape does NOT dismiss the screen", await page.isVisible("#recoveryCode"));

    // Clicking outside the sheet must not dismiss it either.
    await page.mouse.click(5, 5);
    await page.waitForTimeout(250);
    ok("clicking the backdrop does NOT dismiss it", await page.isVisible("#recoveryCode"));

    // Only the deliberate two-step gets you out.
    await page.check("#recoverySavedCheck");
    ok("continue enables once the checkbox is ticked", !(await page.isDisabled("#recoveryContinueBtn")));

    await page.click("#recoveryContinueBtn");
    await page.waitForSelector("#recoveryCode.hidden", { state: "attached", timeout: 10_000 });
    ok("confirming dismisses the screen", !(await page.isVisible("#recoveryCode")));

    // --- into the game ------------------------------------------------------
    section("Signed in → the game boots");

    await page.waitForSelector("#mainMenu:not(.hidden)", { timeout: 20_000 });
    ok("the main menu is reachable once signed in", await page.isVisible("#mainMenu"));
    ok("the account button is present", await page.isVisible("#menuProfileBtn"));
    ok("a fresh account shows 0 coins", (await page.textContent("#menuCoinLine"))?.includes("0") === true);

    // --- the session survives a reload --------------------------------------
    section("Session persistence");

    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector("#mainMenu:not(.hidden)", { timeout: 20_000 });
    ok("reloading does NOT ask you to sign in again", await page.isVisible("#mainMenu"));
    ok("the auth gate stays hidden after reload", !(await page.isVisible("#authGate")));

    // --- profile screen -----------------------------------------------------
    section("Profile screen");

    await page.click("#menuProfileBtn");
    await page.waitForSelector("#profile:not(.hidden)", { timeout: 10_000 });
    ok("profile opens from the menu", await page.isVisible("#profile"));
    ok("it shows the signed-in username", (await page.textContent("#profile"))?.includes(username) === true);

    await page.click("#deleteRevealBtn");
    await page.waitForSelector("#deleteConfirmInput");
    ok("delete is a two-step reveal, not a single button", await page.isVisible("#deleteConfirmInput"));
    // Collapse whitespace first: the copy wraps across lines in the template,
    // so a literal-space regex would fail on formatting rather than on meaning.
    const dangerCopy = ((await page.textContent(".profile-danger")) ?? "").replace(/\s+/g, " ");
    ok("deletion is described as permanent", /cannot be undone/i.test(dangerCopy), dangerCopy.slice(0, 120));

    // A wrong confirmation must not delete anything.
    await page.fill("#deleteConfirmInput", "definitely-not-my-username");
    await page.click("#deleteConfirmBtn");
    await page.waitForTimeout(600);
    ok("a mismatched confirmation is refused", await page.isVisible("#profile"));

    await page.click("#deleteCancelBtn");
    await page.click("#profileCloseBtn");
    await page.waitForSelector("#profile.hidden", { state: "attached" });

    // --- sign out, then recover on a "new device" ---------------------------
    section("Sign out → recover with the code");

    await page.click("#menuProfileBtn");
    await page.waitForSelector("#profile:not(.hidden)");
    await page.click("#profileSignOutBtn");
    await page.waitForSelector("#authGate:not(.hidden)", { timeout: 15_000 });
    ok("signing out returns to the auth gate", await page.isVisible("#authGate"));

    await page.click("#goRecover");
    await page.waitForSelector("#recoverForm");
    await page.fill("#recoverUsername", username);
    // Deliberately messy input: lowercase, dashes stripped. A player retyping
    // from a screenshot must not be locked out on formatting.
    await page.fill("#recoverCode", recoveryCode.trim().toLowerCase().replace(/-/g, ""));
    await page.click("#recoverForm button[type=submit]");

    await page.waitForSelector("#recoveryCode:not(.hidden)", { timeout: 20_000 });
    const newCode = (await page.textContent("#recoveryCodeValue")) ?? "";
    ok("messy code input is accepted", newCode.length > 0);
    ok("a NEW code is issued (single-use rotation)", newCode.trim() !== recoveryCode.trim(), `${recoveryCode} → ${newCode}`);
    ok("the replacement is shown with the same prominence", /only way/i.test((await page.textContent("#recoveryCode")) ?? ""));

    await page.check("#recoverySavedCheck");
    await page.click("#recoveryContinueBtn");
    await page.waitForSelector("#mainMenu:not(.hidden)", { timeout: 20_000 });
    ok("recovery signs you back in", await page.isVisible("#mainMenu"));

    // --- cleanup: delete the test account -----------------------------------
    section("Cleanup");

    await page.click("#menuProfileBtn");
    await page.waitForSelector("#profile:not(.hidden)");
    await page.click("#deleteRevealBtn");
    await page.fill("#deleteConfirmInput", username);
    await page.click("#deleteConfirmBtn");
    await page.waitForSelector("#authGate:not(.hidden)", { timeout: 15_000 });
    ok("deleting the account returns to the auth gate", await page.isVisible("#authGate"));

    // --- no console errors --------------------------------------------------
    section("Console hygiene");

    // The service worker's dev-mode registration is noisy and unrelated.
    const realErrors = consoleErrors.filter(
      (e) => !/service worker|sw\.js|workbox|favicon/i.test(e),
    );
    ok("no unexpected console errors", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));
  } finally {
    await browser.close();
  }

  console.log(`\n${"-".repeat(60)}`);
  console.log(`AUTH UI: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err: unknown) => {
  console.error("test-auth-ui crashed:", err);
  process.exit(1);
});
