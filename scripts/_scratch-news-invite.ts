// Scratch: photograph the News screen's set-up card in its states.
//   npx tsx scripts/_scratch-news-invite.ts        (notify only, then +install)
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";

const BASE = process.env.BASE ?? "http://localhost:5175";
const OUT = process.env.OUT ?? ".";

function psql(sql: string): string {
  return execFileSync(
    "docker",
    ["compose", "exec", "-T", "db", "psql", "-U", "beaglechomp", "-d", "beaglechomp", "-t", "-A", "-c", sql],
    { encoding: "utf-8" },
  ).trim();
}

async function main(): Promise<void> {
  const user = process.env.USER_NAME ?? "beagleadmin";
  const plaintext = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(plaintext).digest("hex");
  psql(
    `INSERT INTO auth_tokens (token_hash, user_id, expires_at)
     SELECT decode('${hash}','hex'), id, now() + interval '1 hour'
       FROM users WHERE username_lower = lower('${user}');`,
  );

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  // Headless Chromium reports Notification.permission as "denied" whatever the
  // context grants, and a String init script is the only kind that survives
  // tsx — esbuild's keepNames wraps a named arrow in __name(), which does not
  // exist in the page.
  await ctx.addInitScript({
    content: `
      Object.defineProperty(Notification, "permission", {
        configurable: true, get: function () { return "default"; } });
      Object.defineProperty(PushManager.prototype, "getSubscription", {
        configurable: true, value: function () { return Promise.resolve(null); } });
    `,
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", String(e)));
  await page.addInitScript((t) => localStorage.setItem("beagle-chomp:token", t), plaintext);
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#menuNewsBtn", { timeout: 45_000 });
  await page.waitForTimeout(900);
  await page.locator("#menuNewsBtn").click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/news-invite-notify.png` });

  await page.evaluate(() => {
    const e = new Event("beforeinstallprompt") as Event & {
      prompt?: () => Promise<void>;
      userChoice?: Promise<unknown>;
    };
    e.prompt = () => Promise.resolve();
    e.userChoice = Promise.resolve({ outcome: "dismissed", platform: "web" });
    window.dispatchEvent(e);
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/news-invite-both.png` });

  console.log(
    await page.evaluate(() => {
      const el = document.querySelector("#news .news-invite") as HTMLElement | null;
      const r = el?.getBoundingClientRect();
      return { steps: el?.querySelectorAll(".news-invite-step").length, h: r?.height };
    }),
  );
  await browser.close();
  psql(`DELETE FROM auth_tokens WHERE token_hash = decode('${hash}','hex');`);
}
main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
