// IDEA-078: the Challenges screen, driven in the REAL app.
//
//   docker compose up -d db api
//   npm run dev
//   npm run test:challenges-ui [baseUrl]
//
// server/scripts/test-challenges.ts covers the rule and test-challenges-db.ts
// covers the queries. Neither can see any of this:
//
//  1. GEOMETRY. The first build of the header put a labelled Back button in
//     `.map-back`, which is a FIXED 44px icon-only box — so "Menu" overflowed
//     it and the page title was drawn straight through the button. It rendered,
//     it was clickable, every unit check would have passed, and a screenshot is
//     what caught it. So the header is MEASURED here, both elements, at both
//     phone widths.
//
//  2. THE FONT SUBSET. Every glyph on this screen is a ligature name in a
//     subset cut from ICON's values. A name that is not in the file renders as
//     that WORD — the defect that put "PEST_CONTROL" across the shop rail for
//     three releases. A glyph is ~24px wide; its name runs to 300.
//
//  3. THE ROUND TRIP. That a claim actually moves the wallet ON THE MENU
//     BEHIND the page. The screen sits above the menu and nothing re-renders it
//     on the way back, which is exactly why Game.refreshWallet() exists — and
//     exactly the kind of thing that is easy to forget and invisible until
//     somebody looks.
//
// reducedMotion: "reduce" on the context. The menu's Play button carries an
// idle bob, and an element whose bounding box never settles never becomes
// actionable in Playwright — every browser suite here needs this.
import { chromium, type Browser, type Page } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { CHALLENGES } from "../src/game/challenges";

const BASE_URL = process.argv[2] ?? "http://localhost:5175";
const SHOTS = ".tmp-screens";

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

/**
 * Seed run history straight into run_stats through psql.
 *
 * Deliberately not played: driving thirty real runs through the browser to
 * reach "30 coins in one run" would take longer than the whole suite and would
 * be testing the validator, not the screen. What the screen renders is what is
 * in the table, so that is what this writes.
 *
 * `-tAc` prints the RETURNING row AND psql's command tag on the next line, so
 * only the first line is the id. That cost a confusing "invalid input syntax
 * for type uuid" the first time.
 */
function sql(text: string): string {
  return execFileSync(
    "docker",
    ["compose", "exec", "-T", "db", "psql", "-U", "beaglechomp", "-d", "beaglechomp", "-tAc", text],
    { encoding: "utf-8" },
  )
    .trim()
    .split(String.fromCharCode(10))[0]
    .trim();
}

const uniq = (): string =>
  `cu${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`.slice(0, 20);

async function signUp(page: Page): Promise<string> {
  const username = uniq();
  await page.goto(BASE_URL);
  await page.waitForSelector("#authGate:not(.hidden)", { timeout: 20_000 });
  await page.fill("#signupUsername", username);
  await page.fill("#signupPassword", "a-decent-password");
  await page.click("#signupForm button[type=submit]");
  await page.waitForSelector("#recoveryCode:not(.hidden)", { timeout: 25_000 });
  await page.check("#recoverySavedCheck");
  await page.click("#recoveryContinueBtn");
  await page.waitForSelector("#mainMenu:not(.hidden)", { timeout: 20_000 });
  const skip = await page.$("#tutorialSkip, #tutorialDone");
  if (skip) await skip.click().catch(() => {});
  await page.waitForTimeout(600);
  return username;
}

function seedRun(
  uid: string,
  o: {
    mode?: string;
    challengeIdx?: number | null;
    coins?: number;
    ghosts?: number;
    fruit?: number;
    bones?: number;
    levels?: number;
    lives?: number;
    score?: number;
  },
): void {
  const mode = o.mode ?? "classic";
  const ci = o.challengeIdx === undefined || o.challengeIdx === null ? "NULL" : String(o.challengeIdx);
  const sid = sql(
    `INSERT INTO game_sessions (user_id, mode, challenge_idx, beagle_skin_id, status, finished_at)
     VALUES ('${uid}','${mode}',${ci},'bagel','accepted',now()) RETURNING id`,
  );
  sql(
    `INSERT INTO run_stats (session_id,user_id,finished_at,accepted,mode,challenge_idx,score,
       elapsed_seconds,levels_played,levels_cleared,ghosts_eaten,coins_collected,fruit_eaten,
       bones_eaten,lives_lost)
     VALUES ('${sid}','${uid}',now(),true,'${mode}',${ci},${o.score ?? 0},120,${o.levels ?? 0},
       ${o.levels ?? 0},${o.ghosts ?? 0},${o.coins ?? 0},${o.fruit ?? 0},${o.bones ?? 0},${o.lives ?? 0})`,
  );
}

async function main(): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  const browser: Browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  const username = await signUp(page);
  const uid = sql(`SELECT id FROM users WHERE username_lower = '${username.toLowerCase()}'`);

  try {
    // -----------------------------------------------------------------------
    section("The chip in the menu bar");
    {
      const chip = await page.$("#menuChallengeBtn");
      ok("the challenges chip exists", chip !== null);

      const badgeHidden = await page.evaluate(
        () => document.getElementById("menuChallengeBadge")?.classList.contains("hidden") ?? null,
      );
      ok("its badge is hidden with nothing to claim", badgeHidden === true, badgeHidden);

      // The destination row is a hard-coded 4-up grid and this feature must not
      // have grown a fifth tile — the whole reason the chip is a chip.
      const tiles = await page.$$eval(".menu-tiles .menu-tile", (els) => els.length);
      ok("the destination row is still four tiles", tiles === 4, tiles);

      // The bar is space-between with TWO children. A third loose child spreads
      // coin/trophy/actions evenly across the width instead.
      const barKids = await page.$$eval(".menu-bar > *", (els) => els.length);
      ok("the menu bar still has exactly two groups", barKids === 2, barKids);

      // The chip must sit BESIDE the coins (Nuno's call), not over on the right
      // with the bell and the speaker.
      const sides = await page.evaluate(() => {
        const coin = document.getElementById("menuCoinLine")?.getBoundingClientRect();
        const chipEl = document.getElementById("menuChallengeBtn")?.getBoundingClientRect();
        const bell = document.getElementById("menuNewsBtn")?.getBoundingClientRect();
        return coin && chipEl && bell
          ? { coinRight: coin.right, chipLeft: chipEl.left, chipRight: chipEl.right, bellLeft: bell.left }
          : null;
      });
      ok("…and it is to the RIGHT of the coin line", !!sides && sides.chipLeft >= sides.coinRight - 1, JSON.stringify(sides));
      ok("…and to the LEFT of the bell", !!sides && sides.chipRight <= sides.bellLeft + 1, JSON.stringify(sides));
    }

    // -----------------------------------------------------------------------
    section("The screen, with nothing played yet");
    await page.click("#menuChallengeBtn");
    await page.waitForSelector(".ch-card", { timeout: 15_000 });
    {
      const cards = await page.$$eval(".ch-card", (els) => els.length);
      const tabs = await page.$$eval(".ch-tab", (els) => els.map((e) => (e as HTMLElement).innerText.trim()));
      ok("there is no Ready tab when nothing is claimable", !tabs.some((t) => t.startsWith("Ready")), tabs.join(" · "));
      ok("the three categories are there", tabs.length === 3, tabs.join(" · "));
      ok("the first category has cards", cards > 0, cards);
      ok("nothing is claimable", (await page.$$(".ch-claim")).length === 0);

      // Every card across every tab, so the screen is proved to show the whole
      // ladder rather than whichever slice happens to be open.
      let total = 0;
      for (const label of tabs) {
        await page.click(`.ch-tab:text-is("${label}")`).catch(async () => {
          await page.click(`text=${label}`);
        });
        await page.waitForTimeout(150);
        total += await page.$$eval(".ch-card", (els) => els.length);
      }
      ok(`all ${CHALLENGES.length} challenges are on the screen`, total === CHALLENGES.length, total);
    }

    // -----------------------------------------------------------------------
    section("The header does not draw itself over its own Back button");
    // The defect this suite was written for. `.map-back` is a fixed 44px
    // icon-only box; a labelled one overflows and the title lands on top.
    for (const width of [390, 360]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForTimeout(250);
      const rects = await page.evaluate(() => {
        const btn = document.getElementById("challengesBackBtn");
        const b = btn?.getBoundingClientRect();
        const h = document.querySelector(".ch-head h1")?.getBoundingClientRect();
        return btn && b && h
          ? {
              bR: b.right,
              hL: h.left,
              bW: b.width,
              hW: h.width,
              // THE CONTENT AGAINST THE BOX, which is the whole defect.
              //
              // The first version of this check compared the two RECTS and
              // passed on the broken build — because `.map-back` is a fixed
              // 44px box, so adding a "Menu" label does not move its
              // boundingClientRect one pixel. The text simply spills OUT of it
              // and the title is drawn over the spill. A rect comparison can
              // never see that; the button's own overflow can.
              overflowX: btn.scrollWidth - btn.clientWidth,
            }
          : null;
      });
      ok(`@${width}: the title starts after the Back button`, !!rects && rects.hL >= rects.bR - 1, JSON.stringify(rects));
      ok(`@${width}: the Back button's content fits inside it`, !!rects && rects.overflowX <= 1, JSON.stringify(rects));
      // Bounded at BOTH ends: a zero-width element passes any "does not overlap"
      // check, and a hidden one measures zero.
      ok(`@${width}: both are actually drawn`, !!rects && rects.bW > 20 && rects.hW > 40, JSON.stringify(rects));

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      ok(`@${width}: the page does not scroll sideways`, !overflow);
    }
    await page.setViewportSize({ width: 390, height: 844 });

    // -----------------------------------------------------------------------
    section("Every mark is a GLYPH, not its own ligature name");
    {
      // A present glyph is one square icon (~24px). A missing one prints its
      // name and runs to 300px. Bounded at both ends so a hidden element
      // measuring zero cannot pass.
      const widths = await page.$$eval(".ch-card .bc-i, .ch-head .bc-i", (els) =>
        els.map((e) => ({ t: (e as HTMLElement).textContent ?? "", w: e.getBoundingClientRect().width })),
      );
      ok("there are icons to measure", widths.length > 0, widths.length);
      const wide = widths.filter((x) => x.w > 60);
      ok("none renders as a word", wide.length === 0, wide.map((x) => `${x.t}=${Math.round(x.w)}px`).join(", "));
      const zero = widths.filter((x) => x.w < 8);
      ok("…and none measures zero (which would pass vacuously)", zero.length === 0, zero.length);
    }

    await page.screenshot({ path: `${SHOTS}/challenges-empty.png` });

    // -----------------------------------------------------------------------
    section("With some history behind it");
    seedRun(uid, { coins: 17, ghosts: 22, fruit: 12, bones: 11, levels: 4, score: 12_000, lives: 0 });
    seedRun(uid, { coins: 9, ghosts: 8, fruit: 6, bones: 5, levels: 2, score: 5_200, lives: 2 });
    seedRun(uid, { mode: "challenge", challengeIdx: 0, coins: 5, fruit: 4, ghosts: 6, levels: 1, lives: 0 });
    sql(`UPDATE users SET challenge_progress = 6 WHERE id = '${uid}'`);

    await page.click("#challengesBackBtn");
    await page.waitForTimeout(300);
    await page.click("#menuChallengeBtn");
    await page.waitForSelector(".ch-claim", { timeout: 15_000 });
    {
      const tabs = await page.$$eval(".ch-tab", (els) => els.map((e) => (e as HTMLElement).innerText.trim()));
      ok("a Ready tab appears", tabs.some((t) => t.startsWith("Ready")), tabs.join(" · "));
      const onTab = await page.$eval(".ch-tab.is-on", (e) => (e as HTMLElement).innerText.trim());
      ok("…and it opens on it", onTab.startsWith("Ready"), onTab);

      const badge = await page.evaluate(() => document.getElementById("menuChallengeBadge")?.textContent);
      const claims = await page.$$eval(".ch-claim", (els) => els.length);
      ok("the badge counts what is claimable", Number(badge) === claims, `${badge} vs ${claims}`);
      ok("…and it is showing", await page.evaluate(
        () => !document.getElementById("menuChallengeBadge")?.classList.contains("hidden"),
      ));

      // A Journey run must not complete a CLASSIC challenge. The mode tag is
      // what a player reads, so it is checked on the screen and not only in the
      // repo test.
      const modes = await page.$$eval(".ch-card .ch-mode", (els) =>
        els.map((e) => (e as HTMLElement).innerText.trim()),
      );
      ok("cards say which mode they count in", modes.length > 0 && modes.every((m) => m.length > 0), modes.slice(0, 3).join(", "));

      const lead = await page.$eval(".ch-lead", (e) => (e as HTMLElement).innerText);
      ok("the lead line counts the coins waiting", /coin/i.test(lead), lead);
    }
    await page.screenshot({ path: `${SHOTS}/challenges-ready.png` });

    // -----------------------------------------------------------------------
    section("Claiming moves the wallet on the menu behind the page");
    {
      const before = Number((await page.textContent("#menuCoinCount"))?.replace(/\D+/g, "") ?? "0");
      const badgeBefore = Number(await page.evaluate(() => document.getElementById("menuChallengeBadge")?.textContent));
      const reward = await page.$eval(".ch-claim", (e) => Number((e as HTMLElement).innerText.replace(/\D+/g, "")));

      await page.click(".ch-claim");
      await page.waitForTimeout(2_500);

      ok("no error appeared on the card", (await page.$$(".ch-error")).length === 0);
      const badgeAfter = Number(await page.evaluate(() => document.getElementById("menuChallengeBadge")?.textContent));
      ok("the badge drops by one", badgeAfter === badgeBefore - 1, `${badgeBefore} -> ${badgeAfter}`);

      const after = Number((await page.textContent("#menuCoinCount"))?.replace(/\D+/g, "") ?? "0");
      ok(
        `the wallet gains the reward (${reward})`,
        after === before + reward,
        `${before} -> ${after}, reward ${reward}`,
      );

      // A claimed challenge stays in the list — a screen that dropped what you
      // finished would get emptier the better you played.
      await page.click('.ch-tab:not(.is-on)');
      await page.waitForTimeout(250);
      const stamps = await page.$$eval(".ch-stamp", (els) => els.length);
      ok("the claimed one is still listed, stamped", stamps >= 1, stamps);
      ok("…and it has no Claim button any more", (await page.$$(".ch-card.is-claimed .ch-claim")).length === 0);
    }
    await page.screenshot({ path: `${SHOTS}/challenges-claimed.png` });

    // -----------------------------------------------------------------------
    section("Back to the menu");
    {
      await page.click("#challengesBackBtn");
      await page.waitForTimeout(400);
      const hidden = await page.evaluate(() => document.getElementById("challenges")?.classList.contains("hidden"));
      ok("the page closes", hidden === true);
      ok("the menu is still there", await page.isVisible("#mainMenu"));
    }

    // -----------------------------------------------------------------------
    section("The badge refreshes when a RUN ends, not only when the page opens");
    // Game.onMenuShown is the hook, and it exists because a run is the only
    // thing that can complete a challenge — every run ends at showMenu(). Test
    // it the way a player triggers it: start a run and quit to the menu. Seeded
    // while the player is standing ON the menu, so nothing but the hook can
    // account for the number changing.
    {
      const before = Number(await page.evaluate(
        () => document.getElementById("menuChallengeBadge")?.textContent || "0",
      ));

      // A run big enough to finish several tiers that were not finished before.
      seedRun(uid, { coins: 25, ghosts: 26, fruit: 21, bones: 21, levels: 11, score: 31_000, lives: 0 });

      const stale = Number(await page.evaluate(
        () => document.getElementById("menuChallengeBadge")?.textContent || "0",
      ));
      ok("the badge has not moved on its own", stale === before, `${before} -> ${stale}`);

      await page.click("#playBtn");
      // THE HOW-TO-PLAY CAROUSEL OPENS OVER THE FIRST RUN, and
      // `body.tutorial-open` sets `.hud{display:none}` — so #homeBtn is in the
      // DOM, enabled, and never becomes visible. Dismiss it the way a player
      // does. test-progression-ui.ts carries the same note; this is the second
      // suite to be caught by it.
      await page.waitForSelector("#tutorial:not(.hidden)", { timeout: 20_000 }).catch(() => {});
      const tutSkip = await page.$(".tut-skip");
      if (tutSkip) {
        await tutSkip.click();
        await page.waitForSelector("#tutorial.hidden", { state: "attached", timeout: 10_000 });
      }
      await page.waitForTimeout(1_500);
      await page.click("#homeBtn");
      await page.waitForSelector("#mainMenu:not(.hidden)", { timeout: 15_000 });
      await page.waitForTimeout(2_000);

      const after = Number(await page.evaluate(
        () => document.getElementById("menuChallengeBadge")?.textContent || "0",
      ));
      ok("…and ending a run refreshes it", after > before, `${before} -> ${after}`);
    }

    ok("no page errors anywhere in the run", pageErrors.length === 0, pageErrors.join(" | "));
  } finally {
    sql(`DELETE FROM users WHERE id = '${uid}'`);
    await browser.close();
  }
}

main()
  .catch((err) => {
    failed++;
    console.error("\nUNCAUGHT", err);
  })
  .finally(() => {
    console.log(`\n${"-".repeat(60)}`);
    console.log(`CHALLENGES UI: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
  });
