// Shared sign-in for the scratch harnesses.
//
// LOGS IN FIRST, signs up only as a fallback. Signup is rate limited to
// 5/hour per IP (a real security control, not a test nuisance), and an
// iteration loop that burns one per render stops after five — which is exactly
// what happened. `scripts/_scratch-showcase-sheet.ts` already established the
// reuse pattern with KEEP=1/USER_NAME; this is the same idea as a helper.
import type { Page } from "playwright";

export const DEV_USER = process.env.DEV_USER ?? "islandsdev";
export const DEV_PASS = "a-decent-password";

export async function signIn(page: Page, url: string): Promise<"login" | "signup"> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
  // NOT a comma selector. `waitForSelector("#a, #b")` resolves to BOTH and
  // then waits on whichever comes FIRST IN DOM ORDER — so with #mainMenu above
  // #authGate in index.html it waits on the hidden menu and times out while
  // the gate is sitting there visible. It reads like an "either" and behaves
  // like "the first one". `waitForFunction` says what is meant.
  await page.waitForFunction(
    `(() => {
      const vis = (id) => { const e = document.getElementById(id); return !!e && !e.classList.contains("hidden"); };
      return vis("authGate") || vis("mainMenu");
    })()`,
    undefined,
    { timeout: 60_000 },
  );
  if (await page.locator("#mainMenu:not(.hidden)").count()) return "login";

  // Try the existing account first. The tab click RE-RENDERS the gate, so the
  // login inputs do not exist until it has — clicking and immediately filling
  // raced it, which surfaced as "that username is already taken" from the
  // signup fallback rather than as a login failure.
  await page.click("#tabLogin").catch(() => {});
  const haveForm = await page
    .waitForSelector("#loginUsername", { state: "visible", timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (haveForm) {
    await page.fill("#loginUsername", DEV_USER);
    await page.fill("#loginPassword", DEV_PASS);
    await page.click("#loginForm button[type=submit]");
    const ok = await page
      .waitForSelector("#mainMenu:not(.hidden)", { timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    if (ok) return "login";

    // SAY WHY, and do NOT fall through blindly. The signup path burns one of
    // five per hour and then fails with "username is already taken", which
    // buries the real cause — usually the LOGIN limiter (10 per 15 minutes per
    // username). Reporting it means waiting a few minutes instead of spending
    // the other budget and learning nothing.
    const why = String(
      await page.evaluate(
        `document.querySelector(".auth-error, .auth-msg")?.textContent ?? "(no message)"`,
      ),
    );
    throw new Error(
      `signIn: login as "${DEV_USER}" failed — ${why}
` +
        `  (not attempting signup: the account exists, so that would only waste the 5/hour budget)`,
    );
  }

  // Fall back to creating it.
  await page.click("#tabSignup").catch(() => {});
  await page.waitForSelector("#signupUsername", { state: "visible", timeout: 10_000 });
  await page.fill("#signupUsername", DEV_USER);
  await page.fill("#signupPassword", DEV_PASS);
  await page.click("#signupForm button[type=submit]");
  const got = await page
    .waitForSelector("#recoveryCode:not(.hidden)", { timeout: 25_000 })
    .then(() => true)
    .catch(() => false);
  if (!got) {
    const err = await page.evaluate(
      `document.querySelector(".auth-error, .auth-msg")?.textContent ?? "(no message)"`,
    );
    throw new Error(`signIn: could not log in or sign up as "${DEV_USER}" — ${String(err)}`);
  }
  await page.check("#recoverySavedCheck");
  await page.click("#recoveryContinueBtn");
  await page.waitForSelector("#mainMenu:not(.hidden)", { timeout: 40_000 });
  return "signup";
}
