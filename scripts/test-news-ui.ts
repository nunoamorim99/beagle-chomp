// OWNER: qa-test-engineer (IDEA-052)
//
// The News screen, driven in the real app.
//
// The check that matters most here is the LAST one. An announcement body is the
// first free-form, server-authored string this game renders — usernames, the
// only other remote strings, are boxed in by `^[A-Za-z0-9_-]{3,20}$` so markup
// is unstorable. A note is 4,000 characters of anything.
//
// So this publishes a note whose title and body are literally `<script>` and an
// `onerror` image, then asserts that NO such element exists in the document and
// that the text is on screen verbatim. That is the difference between
// createElement + textContent and any escape-then-interpolate scheme: the
// second is one careless `replace(/\n/g, "<br>")` away from being wrong, and
// this test fails the moment someone writes it.
//
// Run against a local stack:  docker compose up -d db api
//                             npx vite --port 5175
//                             npm run test:news-ui
// Signup is rate-limited 5/hour per IP; `docker compose restart api` clears it.

import { chromium, type Page } from "playwright";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";

const BASE = process.argv[2] ?? "http://localhost:5175";
const API = process.argv[3] ?? "http://localhost:3001";

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

function psql(sql: string): string {
  return execFileSync(
    "docker",
    ["compose", "exec", "-T", "db", "psql", "-U", "beaglechomp", "-d", "beaglechomp", "-t", "-A", "-c", sql],
    { encoding: "utf-8" },
  ).trim();
}

/** Mint a token for an account without knowing its password. hashToken() hashes
 *  the base64url STRING, not the decoded bytes (server/src/auth/tokens.ts). */
function mintToken(username: string): string {
  const plaintext = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(plaintext).digest("hex");
  psql(
    `INSERT INTO auth_tokens (token_hash, user_id, expires_at)
     SELECT decode('${hash}','hex'), id, now() + interval '1 hour'
       FROM users WHERE username_lower = lower('${username}');`,
  );
  return plaintext;
}

const HOSTILE_TITLE = `<script>window.__XSS_TITLE = 1;</script>`;
const HOSTILE_BODY = `<img src=x onerror="window.__XSS_BODY=1">\n\nSecond paragraph.`;

async function main(): Promise<void> {
  // --- fixtures -------------------------------------------------------------
  const adminToken = mintToken("beagleadmin");
  const post = async (path: string, body?: unknown): Promise<Response> =>
    fetch(`${API}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  // BOTH kinds, and both created by this test — it must not depend on notes
  // that happen to be in the database, which is how it first failed after a
  // cleanup removed the fixtures it had silently been relying on.
  const publish = async (body: unknown): Promise<string> => {
    const res = await post("/api/v1/admin/announcements", body);
    const { announcement } = (await res.json()) as { announcement: { id: string } };
    await post(`/api/v1/admin/announcements/${announcement.id}/publish`, { published: true });
    return announcement.id;
  };

  const releaseId = await publish({
    kind: "release",
    version: "v9.9",
    title: "A test release",
    body: "First paragraph.\n\nSecond paragraph.",
  });
  const hostileId = await publish({
    kind: "notice",
    title: HOSTILE_TITLE,
    body: HOSTILE_BODY,
  });

  const player = `news${Date.now().toString().slice(-7)}`;
  const signup = await fetch(`${API}/api/v1/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: player, password: "news-test-pass-1" }),
  });
  if (!signup.ok) {
    console.error("signup failed — rate limited? `docker compose restart api`");
    process.exit(1);
  }
  const { token } = (await signup.json()) as { token: string };

  const browser = await chromium.launch();
  // The menu's Play button bobs forever; Playwright will not click an element
  // whose box never settles.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const page: Page = await ctx.newPage();

  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.addInitScript((t) => localStorage.setItem("beagle-chomp:token", t), token);
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector("#menuNewsBtn", { timeout: 15_000 });
  await page.waitForTimeout(800);

  // --- the bell -------------------------------------------------------------
  section("The bell");

  const bell = page.locator("#menuNewsBtn");
  ok("the bell is in the menu bar", await bell.isVisible());

  const box = await bell.boundingBox();
  ok("…and is a 44px touch target", !!box && box.height >= 44 && box.width >= 44, JSON.stringify(box));
  ok(
    "…and sits on screen at 390px",
    !!box && box.x >= -1 && box.x + box.width <= 390 + 1,
    JSON.stringify(box),
  );

  // The one check that catches a stale font subset: a missing glyph renders its
  // own ligature name, which is far wider than the icon.
  const glyphW = await bell
    .locator("i.bc-i")
    .evaluate((el) => (el as HTMLElement).offsetWidth);
  ok("…and draws a GLYPH, not the word 'notifications'", glyphW > 0 && glyphW <= 40, `${glyphW}px`);

  ok("the unread dot is showing", await page.locator("#menuNewsDot").isVisible());
  const dotText = await page.locator("#menuNewsDot").textContent();
  ok("…with a count on it", (dotText ?? "").trim().length > 0, dotText);

  // The destination row must be UNTOUCHED — the whole reason the bell went in
  // the top bar rather than becoming a fifth tile.
  ok("the destination row still has exactly 4 tiles", (await page.locator(".menu-tile").count()) === 4);

  // --- the screen -----------------------------------------------------------
  section("The screen");

  await bell.click();
  await page.waitForTimeout(900);

  ok("the news screen opened", await page.locator("#news .news-sheet").isVisible());
  const cards = await page.locator(".news-card").count();
  ok("…and shows both published notes", cards === 2, `${cards} cards`);
  // A release note carries its version; a notice has none, and must not render
  // a stray separator where one would have gone.
  const releaseSub = await page.locator(".news-card").last().locator(".news-sub").innerText();
  ok("a release note shows its version", releaseSub.includes("v9.9"), releaseSub);
  const noticeSub = await page.locator(".news-card").first().locator(".news-sub").innerText();
  ok("a notice shows no version separator", !noticeSub.includes("·"), noticeSub);

  // --- markup is TEXT, not markup ------------------------------------------
  section("A hostile note renders as text");

  ok(
    "no <script> element from the note exists",
    (await page.locator("#news script").count()) === 0,
  );
  ok("no <img> element from the note exists", (await page.locator("#news img").count()) === 0);

  const xssTitle = await page.evaluate(() => (window as unknown as Record<string, unknown>).__XSS_TITLE);
  const xssBody = await page.evaluate(() => (window as unknown as Record<string, unknown>).__XSS_BODY);
  ok("the title's script did not run", xssTitle === undefined);
  ok("the body's onerror did not run", xssBody === undefined);

  const newsText = (await page.locator("#news").innerText()).replace(/\s+/g, " ");
  ok("the title is shown verbatim, as characters", newsText.includes("<script>"), newsText.slice(0, 120));
  ok("the body is shown verbatim too", newsText.includes("<img src=x"));
  ok("…and its second paragraph rendered", newsText.includes("Second paragraph."));

  // --- the dot clears -------------------------------------------------------
  section("Reading clears the badge");

  ok("the dot is gone after opening", await page.locator("#menuNewsDot").isHidden());

  await page.locator("#news .btn-primary").click();
  await page.waitForTimeout(500);
  ok("Back closes the screen", await page.locator("#news").isHidden());

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("#menuNewsBtn", { timeout: 15_000 });
  await page.waitForTimeout(900);
  ok("…and it stays gone after a reload", await page.locator("#menuNewsDot").isHidden());

  ok("no page errors throughout", errors.length === 0, errors.join(" | "));

  await browser.close();

  // --- cleanup --------------------------------------------------------------
  for (const id of [releaseId, hostileId]) {
    await fetch(`${API}/api/v1/admin/announcements/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
  }
  psql(`DELETE FROM users WHERE username_lower = lower('${player}');`);
  psql(`DELETE FROM auth_tokens WHERE token_hash = decode('${createHash("sha256").update(adminToken).digest("hex")}','hex');`);

  console.log(`\n${"-".repeat(60)}`);
  console.log(`NEWS UI: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err: unknown) => {
  console.error("\ntest-news-ui crashed:", err);
  process.exit(1);
});
