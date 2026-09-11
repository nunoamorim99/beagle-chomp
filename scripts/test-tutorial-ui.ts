// Browser check for the tutorial carousel (IDEA-040 v2).
//
//   docker compose up -d db api
//   npm run dev
//   npx tsx scripts/test-tutorial-ui.ts [baseUrl]
//
// The copy is covered purely in scripts/test-tutorial-carousel.ts. What only a
// browser can show: that a new player meets it BEFORE the run starts, that the
// live 3D illustration is actually rendering behind it, that Next/Back/dots
// move through every slide, that finishing persists to the account, and that
// the account screen can reopen it on demand.
//
// IDEA-064 added what is now the largest thing on this screen — a five-row coat
// list on the last slide — so the run below also MEASURES it. Everything this
// project has got wrong on the 2D layer was geometry, and none of it was
// visible by looking: the card has to stay inside the viewport with the list in
// it, on a 390x844 phone AND in landscape, where there are 390 pixels of height
// for the whole thing.
//
// The slide COUNT is read off the dots rather than written here. It was hard-
// coded at five, IDEA-046 made it six, and the test went on asserting "five
// distinct slides" by stepping four times and never reaching the end.

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

/**
 * Measure the IDEA-064 coat list where it actually renders.
 *
 * Five things, and every one of them is a box rather than a look:
 *  - the card is INSIDE the viewport. `#tutorial` justifies to flex-end, so a
 *    card that outgrows the screen does not scroll — its top slides off, taking
 *    the title and the copy with it and leaving a list of paws with no heading.
 *  - all five rows are on screen. A list that is cut off after three teaches
 *    three coats and hides two.
 *  - every paw actually drew. `beagleSwatchHtml` is inline SVG, so a zero-sized
 *    well renders as nothing at all — no error, no gap, just a row of text.
 *  - the rows share a left edge. That is the whole reason this block is
 *    left-aligned inside a centred card.
 *  - nothing pushes the card wider than the page.
 */
async function measureCoats(page: Page, where: string): Promise<void> {
  const m = await page.evaluate(() => {
    const card = document.querySelector(".tut-card");
    const rows = [...document.querySelectorAll(".tut-perk")];
    const paws = [...document.querySelectorAll(".tut-perk .paw-swatch")];
    const cardBox = card?.getBoundingClientRect();
    return {
      title: document.querySelector(".tut-title")?.textContent?.trim() ?? "",
      rows: rows.length,
      cardTop: cardBox ? Math.round(cardBox.top) : -1,
      cardBottom: cardBox ? Math.round(cardBox.bottom) : -1,
      cardRight: cardBox ? Math.round(cardBox.right) : -1,
      cardLeft: cardBox ? Math.round(cardBox.left) : -1,
      rowBottoms: rows.map((r) => Math.round(r.getBoundingClientRect().bottom)),
      rowLefts: rows.map((r) => Math.round(r.getBoundingClientRect().left)),
      pawSizes: paws.map((p) => {
        const b = p.getBoundingClientRect();
        return `${Math.round(b.width)}x${Math.round(b.height)}`;
      }),
      vw: window.innerWidth,
      vh: window.innerHeight,
      docScrollW: document.documentElement.scrollWidth,
      // What is ABOVE the scroller's own top — the unreachable direction.
      overflowTop: Math.max(
        0,
        Math.round(
          (document.querySelector("#tutorial")?.getBoundingClientRect().top ?? 0) -
            (cardBox?.top ?? 0),
        ),
      ),
      scrollH: document.querySelector("#tutorial")?.scrollHeight ?? 0,
      scrolls: (() => {
        const t = document.querySelector("#tutorial");
        return t ? t.scrollHeight > t.clientHeight + 1 : false;
      })(),
    };
  });

  ok(`[${where}] the coats slide is showing`, /power/i.test(m.title), m.title);
  ok(`[${where}] every coat has a row`, m.rows === 5, m.rows);
  // The card's TOP is the strict one: #tutorial overflows downward on purpose,
  // so anything past the bottom is reachable by scrolling — anything past the
  // top is not, and it takes the title and the copy with it.
  ok(`[${where}] the card's top is on screen`, m.cardTop >= 0, m.cardTop);
  ok(`[${where}] nothing is cut off above the fold`,
    m.overflowTop === 0, `${m.overflowTop}px above`);
  ok(`[${where}] every row is reachable`,
    m.rowBottoms.every((b) => b > 0 && b <= m.scrollH), m.rowBottoms.join(","));
  ok(`[${where}] every paw drew at a real size`,
    m.pawSizes.length === 5 && m.pawSizes.every((sz) => !sz.startsWith("0x") && !sz.endsWith("x0")),
    m.pawSizes.join(" "));
  ok(`[${where}] the rows share one left edge`,
    new Set(m.rowLefts).size === 1, m.rowLefts.join(","));
  ok(`[${where}] the card stays inside the page`,
    m.cardLeft >= 0 && m.cardRight <= m.vw && m.docScrollW <= m.vw,
    `${m.cardLeft}..${m.cardRight} of ${m.vw} (scrollW ${m.docScrollW})`);

  // If it does not all fit, the overlay has to be able to SHOW the rest. A
  // scroll container whose overflow is at the top scrolls nowhere, which is the
  // exact failure this measurement exists to catch — so scroll it to the end
  // and check the last thing on the card actually arrives.
  if (m.scrolls) {
    const reached = await page.evaluate(() => {
      const t = document.querySelector("#tutorial");
      if (!t) return { ok: false, detail: "no #tutorial" };
      t.scrollTop = t.scrollHeight;
      const btn = document.querySelector(".tut-next")?.getBoundingClientRect();
      const last = [...document.querySelectorAll(".tut-perk")].pop()?.getBoundingClientRect();
      return {
        ok: !!btn && !!last &&
          btn.bottom <= window.innerHeight && btn.top >= 0 &&
          last.bottom <= window.innerHeight && last.top >= 0,
        detail: `btn ${Math.round(btn?.top ?? -1)}..${Math.round(btn?.bottom ?? -1)}, ` +
          `last row ${Math.round(last?.top ?? -1)}..${Math.round(last?.bottom ?? -1)} of ${window.innerHeight}`,
      };
    });
    ok(`[${where}] scrolling reaches the last coat and Got it`, reached.ok, reached.detail);
    await page.evaluate(() => { const t = document.querySelector("#tutorial"); if (t) t.scrollTop = 0; });
  } else {
    ok(`[${where}] it all fits without scrolling`, m.cardBottom <= m.vh,
      `${m.cardBottom} > ${m.vh}`);
  }
}

async function main(): Promise<void> {
  const browser = await chromium.launch();
  // reducedMotion: the menu's Play card bobs, and Playwright never clicks an
  // element whose bounding box does not settle. The stylesheet cancels every
  // animation under the preference, so the product keeps the motion and this
  // suite gets a still button.
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
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

  // One dot per slide, so this is the carousel's own count rather than a
  // number copied into the test — the previous literal went stale the release
  // after it was written.
  const slideCount = await page.evaluate(() => document.querySelectorAll(".tut-dot").length);
  ok("there is a dot per slide", slideCount >= 6, slideCount);

  section(`Stepping through all ${slideCount}`);
  const seen: string[] = [await title(page)];
  for (let i = 0; i < slideCount - 1; i++) {
    await page.click(".tut-next");
    await page.waitForTimeout(250);
    seen.push(await title(page));
  }
  ok("every slide is distinct", new Set(seen).size === slideCount, seen.join(" | "));
  ok("the last one offers Got it",
    /got it/i.test((await page.textContent(".tut-next")) ?? ""),
    await page.textContent(".tut-next"));
  ok("Skip is gone on the last slide", await page.$(".tut-skip") === null);

  // --- IDEA-064: the coat list, measured on the slide it lives on ---
  await measureCoats(page, "phone 390x844");

  await page.click(".tut-back");
  await page.waitForTimeout(250);
  ok("Back returns to the previous slide",
    (await title(page)) === seen[slideCount - 2], await title(page));

  await page.click(".tut-dot[data-idx='0']");
  await page.waitForTimeout(250);
  ok("a dot jumps straight to that slide", (await title(page)) === seen[0], await title(page));

  // Landscape is where this screen has the least room — 390px of height for a
  // stage, a title, four lines of copy and five rows. Nothing in CSS knows the
  // list is there, so the only way to know it fits is to look at the boxes.
  section("Landscape");
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(400);
  await page.click(`.tut-dot[data-idx='${slideCount - 1}']`);
  await page.waitForTimeout(300);
  await measureCoats(page, "landscape 844x390");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);

  section("Finishing starts the run");
  await page.click(".tut-dot[data-idx='0']");
  await page.waitForTimeout(250);
  for (let i = 0; i < slideCount - 1; i++) {
    await page.click(".tut-next");
    await page.waitForTimeout(200);
  }
  await page.click(".tut-next");
  await page.waitForSelector("#tutorial", { state: "hidden", timeout: 15_000 });
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

  // reducedMotion here too — this page clicks the bobbing Play card, and a
  // context without the preference hangs on it forever (it hung here for three
  // releases; the first page had the option and this one was missed).
  const fresh = await browser.newPage({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
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
  for (let i = 0; i < slideCount - 1; i++) {
    await page.click(".tut-next");
    await page.waitForTimeout(180);
  }
  await page.click(".tut-next");
  await page.waitForSelector("#tutorial", { state: "hidden", timeout: 15_000 });
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
