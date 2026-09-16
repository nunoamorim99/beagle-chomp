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
  // Scoped to THIS test's own notes rather than a global count: the database
  // may already hold real announcements, and asserting "exactly 2 cards" made
  // the suite fail on a perfectly healthy app.
  const releaseCard = page.locator(".news-card", { hasText: "A test release" });
  const hostileCard = page.locator(".news-card", { hasText: "<script>" });
  ok("the release note is listed", (await releaseCard.count()) === 1);
  ok("the notice is listed", (await hostileCard.count()) === 1);

  // A release note carries its version; a notice has none, and must not render
  // a stray separator where one would have gone.
  const releaseSub = await releaseCard.locator(".news-sub").innerText();
  ok("a release note shows its version", releaseSub.includes("v9.9"), releaseSub);
  const noticeSub = await hostileCard.locator(".news-sub").innerText();
  ok("a notice shows no version separator", !noticeSub.includes("·"), noticeSub);

  // --- the invitation, when there is nothing to offer ----------------------
  section("The invitation is silent on a browser that has blocked push");

  // FREE, because headless Chromium reports `Notification.permission` as
  // "denied" whatever the context grants — so this page IS the blocked-browser
  // case, with no stubbing at all. The rule: a permission that is denied can
  // only be reset in browser settings, so a banner about it on every visit is
  // nagging rather than inviting. The account screen still says why.
  ok(
    "no invitation card on a blocked browser",
    await page.locator("#news .news-invite").isHidden(),
    await page.locator("#news .news-invite").innerText().catch(() => "(absent)"),
  );

  // --- the detail sheet -----------------------------------------------------
  section("A card opens the full note");

  // The LIST is for scanning, so a card shows a clamped preview and a
  // "Read more". The whole body lives in the sheet.
  ok(
    "cards show a Read more affordance",
    (await releaseCard.locator(".news-more").count()) === 1,
  );
  const clamped = await releaseCard
    .locator(".news-body--clamp")
    .evaluate((el) => {
      const s = getComputedStyle(el);
      return { clamp: s.webkitLineClamp, overflow: s.overflow };
    });
  ok("…and the preview is clamped, not full-length", clamped.clamp === "3", JSON.stringify(clamped));

  await releaseCard.click();
  await page.waitForTimeout(600);
  ok("clicking a card opens the sheet", (await page.locator(".news-detail").count()) === 1);

  // A click INSIDE must not close it — the usual bug with this pattern.
  await page.locator(".news-detail-sheet h2").click();
  await page.waitForTimeout(250);
  ok("…a click inside keeps it open", (await page.locator(".news-detail").count()) === 1);

  ok("Escape closes it", await (async () => {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(350);
    return (await page.locator(".news-detail").count()) === 0;
  })());

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

  // Open the hostile note's own sheet: the body is rendered a SECOND time
  // there, and a regression in that path would be invisible if only the list
  // were checked.
  await hostileCard.click();
  await page.waitForTimeout(600);
  ok(
    "no <script> element inside the detail sheet either",
    (await page.locator(".news-detail script").count()) === 0,
  );
  ok("no <img> inside the sheet either", (await page.locator(".news-detail img").count()) === 0);
  const sheetText = (await page.locator(".news-detail").innerText()).replace(/\s+/g, " ");
  ok("…and the sheet shows the markup as characters", sheetText.includes("<img src=x"), sheetText.slice(0, 90));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(350);

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

  // --- the bell stays honest while the game is open -------------------------
  section("A note published while the app is open lights the bell");

  // THE BUG THIS COVERS, reported from a real phone: the badge was read exactly
  // once, at sign-in. A note published while the player already had the game
  // open never appeared — they got the push, opened the app, and the bell was
  // bare.
  ok("the bell starts bare after reading", await page.locator("#menuNewsDot").isHidden());

  const late = await post("/api/v1/admin/announcements", {
    kind: "notice",
    title: "Published while you were looking",
    body: "This should light the bell without a reload.",
  });
  const lateId = ((await late.json()) as { announcement: { id: string } }).announcement.id;
  await post(`/api/v1/admin/announcements/${lateId}/publish`, { published: true });
  await page.waitForTimeout(400);

  ok(
    "…and stays bare until something says otherwise",
    await page.locator("#menuNewsDot").isHidden(),
  );

  // push-sw.js posts this to every open window the moment a push lands. Not
  // throttled, because a push IS the event.
  await page.evaluate(() => {
    navigator.serviceWorker.dispatchEvent(
      new MessageEvent("message", { data: { type: "beagle-push" } }),
    );
  });
  await page.waitForTimeout(1500);

  ok("a push message lights it immediately", await page.locator("#menuNewsDot").isVisible());
  ok(
    "…with the right count",
    (await page.locator("#menuNewsDot").textContent())?.trim() === "1",
    await page.locator("#menuNewsDot").textContent(),
  );

  await fetch(`${API}/api/v1/admin/announcements/${lateId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${adminToken}` },
  });

  // --- the invitation (IDEA-074) -------------------------------------------
  //
  // The screen where a push LANDS (push-sw.js opens `/?news=1`) was the one
  // place in the game that never mentioned notifications: the only switch is
  // three taps away in the account screen, so the feature's whole audience was
  // "people who went looking for it".
  //
  // TWO THINGS ARE STUBBED, and only these two. Headless Chromium reports
  // `Notification.permission` as "denied" whatever the context grants, which is
  // the one state that correctly shows NO card (asserted above on the real
  // page) — so the positive cases need a browser that behaves like a phone.
  // And a device cannot really be subscribed here: there is no push service to
  // reach, and `subscribe()` fails with a message that reads like a permission
  // error even when permission was just granted (see push.ts). `getSubscription`
  // answering non-null IS what "this device is on" means to `isSubscribed()`.
  // ONE extra context, not two: this app pulls the whole three.js graph and
  // stands up a WebGL scene on every load, which on the dev server is 10-15
  // seconds and slower again with a second browser already running. The
  // subscribed/not-subscribed switch is therefore a QUERY FLAG the init script
  // reads, so each case costs exactly one page load.
  const phoneCtx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  await phoneCtx.addInitScript((t) => localStorage.setItem("beagle-chomp:token", t), token);
  // PASSED AS A STRING, not as a function, and that is not a style choice.
  // This suite runs under tsx, whose esbuild transform wraps named function
  // expressions in `__name(...)` for keepNames — including an arrow that picks
  // up its name from an object property, which `get: () => …` does. Playwright
  // serialises the function source and evaluates it in the PAGE, where
  // `__name` does not exist: the whole init script dies with
  // "ReferenceError: __name is not defined", every stub silently fails to
  // apply, and the browser's real (denied) state is what the app sees. It
  // looks exactly like the feature not working.
  await phoneCtx.addInitScript({
    content: `
      Object.defineProperty(Notification, "permission", {
        configurable: true,
        get: function () { return "default"; },
      });
      Object.defineProperty(Notification, "requestPermission", {
        configurable: true,
        value: function () { return Promise.resolve("granted"); },
      });
      Object.defineProperty(PushManager.prototype, "getSubscription", {
        configurable: true,
        // Off the URL rather than out of storage, so switching case is ONE
        // page load: an init script runs before the app, so no reload is
        // needed to make the flag take effect.
        value: function () {
          return Promise.resolve(
            new URLSearchParams(location.search).get("__sub") === "1"
              ? { endpoint: "https://example.invalid/stub" }
              : null,
          );
        },
      });
    `,
  });
  const phone = await phoneCtx.newPage();

  const openNews = async (subscribed: boolean): Promise<void> => {
    // `domcontentloaded`, not `networkidle`: the readiness signal that matters
    // is the menu being on screen, and waiting for the network to go quiet on
    // a Vite dev server serving several hundred modules is a 30-second gamble
    // that says nothing extra. The selector wait below is the real one.
    await phone.goto(`${BASE}?__sub=${subscribed ? 1 : 0}`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await phone.waitForSelector("#menuNewsBtn", { timeout: 45_000 });
    await phone.waitForTimeout(900);
    await phone.locator("#menuNewsBtn").click();
    await phone.waitForTimeout(1400);
  };

  section("The invitation, on a device that could be subscribed and is not");

  await openNews(false);
  const offPage = phone;
  const invite = offPage.locator("#news .news-invite");
  ok("the card is showing", await invite.isVisible());

  const inviteText = (await invite.innerText()).replace(/\s+/g, " ");
  ok("…and says what turning them on buys you", /leaderboard/i.test(inviteText), inviteText);

  const cta = invite.locator("button");
  ok("…and carries a button that can act", (await cta.count()) === 1);
  // §04: amber marks the SINGLE next action on a screen, and this screen's is
  // the Back button. Two amber things means one of them is wrong.
  const ctaClass = (await cta.getAttribute("class")) ?? "";
  ok("…which is the confirm green, not amber", ctaClass.includes("btn-confirm"), ctaClass);
  const ctaBox = await cta.boundingBox();
  ok(
    "…and is a 44px target inside a 390px screen",
    !!ctaBox && ctaBox.height >= 44 && ctaBox.x >= -1 && ctaBox.x + ctaBox.width <= 391,
    JSON.stringify(ctaBox),
  );

  // A stale font subset renders a ligature as its own NAME — the card would
  // read "notifications Turn them on" across the whole width.
  const inviteGlyphW = await invite
    .locator(".news-mark--invite i.bc-i")
    .evaluate((el) => (el as HTMLElement).offsetWidth);
  ok("…and its bell is a GLYPH, not the word", inviteGlyphW > 0 && inviteGlyphW <= 40, `${inviteGlyphW}px`);

  // ABOVE the list and OUTSIDE it. The list is the scroller; an invitation
  // inside it is one most players never scroll to.
  ok(
    "the card is not inside the scrolling list",
    (await offPage.locator("#news .news-list .news-invite").count()) === 0,
  );
  const inviteBox = await invite.boundingBox();
  const listBox = await offPage.locator("#news .news-list").boundingBox();
  ok(
    "…and sits above it",
    !!inviteBox && !!listBox && inviteBox.y + inviteBox.height <= listBox.y + 1,
    JSON.stringify({ inviteBox, listBox }),
  );

  section("The card grows an Install step when the browser offers one");

  // A browser decides when a site is installable and fires
  // `beforeinstallprompt` whenever it likes — usually long after boot, and
  // here never, since headless Chromium does not offer installs. Dispatching
  // the real event is how test-menu-ui.ts drives the banner too, and it
  // exercises install.ts rather than a hand-built copy of it.
  ok("only one step before the offer arrives", (await invite.locator("button").count()) === 1);

  await offPage.evaluate(() => {
    const e = new Event("beforeinstallprompt") as Event & {
      prompt?: () => Promise<void>;
      userChoice?: Promise<unknown>;
    };
    e.prompt = () => Promise.resolve();
    e.userChoice = Promise.resolve({ outcome: "dismissed", platform: "web" });
    window.dispatchEvent(e);
  });
  await offPage.waitForTimeout(900);

  // IDEA-074 v2's point: the card repaints itself when the offer arrives,
  // rather than waiting for the player to close and reopen the screen.
  ok("…two steps once it does", (await invite.locator(".news-invite-step").count()) === 2);
  const installBtn = invite.locator(".news-invite-step", { hasText: "Install the app" }).locator("button");
  ok("…with an Install button", (await installBtn.count()) === 1);
  const notifyBtn = invite
    .locator(".news-invite-step", { hasText: "Turn on notifications" })
    .locator("button");
  ok("…and the notifications one still there", (await notifyBtn.count()) === 1);
  // Exactly one of the two is the card's reason. Two greens side by side would
  // flatten them into one choice; amber is not available at all (§04 — the
  // screen's single amber action is Back).
  const classes = await invite.locator("button").evaluateAll((els) =>
    els.map((e) => (e as HTMLElement).className),
  );
  ok(
    "…one green, one wood — never two of either",
    classes.filter((c) => c.includes("btn-confirm")).length === 1 &&
      classes.filter((c) => c.includes("btn-secondary")).length === 1,
    classes.join(" | "),
  );

  // The step says what installing actually buys. It claimed "offline play"
  // elsewhere in this codebase until v5.2, which stopped being true at v5.0
  // when sign-in before play made the game online-only.
  const installCopy = await invite
    .locator(".news-invite-step", { hasText: "Install the app" })
    .locator(".news-invite-copy")
    .innerText();
  ok("…and does not promise offline play", !/offline/i.test(installCopy), installCopy);

  // WHERE, not just whether: a player who later wants them OFF needs an
  // address, or they block the site at the browser level instead.
  const note = await invite.locator(".news-invite-note").innerText();
  ok("the card says where to change this later", /account/i.test(note), note);

  // A browser hands out ONE usable beforeinstallprompt — `prompt()` cannot be
  // replayed — so pressing Install spends it and the row must go. A row left
  // behind is a button that silently does nothing from then on.
  await installBtn.click();
  await offPage.waitForTimeout(900);
  ok("pressing Install spends the offer", (await installBtn.count()) === 0);
  ok("…and the notifications step survives it", (await notifyBtn.count()) === 1);

  // A subscribe that cannot complete — which is every subscribe in here, since
  // there is no push service to reach — must say so IN PLACE rather than
  // vanishing or going quiet. Vanishing on failure would look exactly like
  // success, which is the worst available outcome for this card.
  const beforeText = (await invite.innerText()).replace(/\s+/g, " ");
  await notifyBtn.click();
  await offPage.waitForTimeout(2500);
  ok("a failed attempt leaves the card up", await invite.isVisible());
  const afterText = (await invite.innerText()).replace(/\s+/g, " ");
  ok("…and says something went wrong", afterText !== beforeText, afterText);
  ok("…with the button pressable again", await notifyBtn.isEnabled());

  section("The invitation disappears once this device is subscribed");

  // Nuno's ask, literally: "when active this message disappears from the
  // notification screen".
  await openNews(true);
  const onPage = phone;
  ok("the news screen still opens", await onPage.locator("#news .news-sheet").isVisible());
  ok(
    "…and the invitation is gone",
    await onPage.locator("#news .news-invite").isHidden(),
    await onPage.locator("#news .news-invite").innerText().catch(() => "(absent)"),
  );
  // It must be the CARD that went, not the screen — a bug that hid the sheet
  // would pass a naive "the card is not visible" check.
  ok("…while the notes are still listed", (await onPage.locator("#news .news-card").count()) > 0);
  await phoneCtx.close();

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
