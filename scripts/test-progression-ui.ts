// Browser check that the classic progression actually drives the GAME
// (IDEA-040), not just the pure module.
//
//   docker compose up -d db api
//   npm run dev
//   npx tsx scripts/test-progression-ui.ts [baseUrl]
//
// What only a browser can show: that startLevel() really loads the planned
// maze, that resetActors() really spawns that level's enemy count, and that
// the HUD label matches. The pure model is covered exhaustively in
// scripts/test-progression.ts; this proves the wiring.
//
// Levels are driven by calling the game's own startLevel through the debug
// hook rather than by playing 18 maps, which would take an hour per lap.

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
  `pg${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`.slice(0, 20);

async function signUp(page: Page, username: string): Promise<void> {
  // NOT `networkidle`. Measured on this stack a cold browser context leaves one
  // Vite dep request (workbox-window) open indefinitely, so the wait never
  // returns on a page that is fully interactive — and the `waitForSelector`
  // that is the real readiness signal is already on the line below it.
  // test-beagle-perks-ui.ts hit and fixed exactly this (IDEA-064 v3).
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForSelector("#signupUsername", { timeout: 60_000 });
  await page.fill("#signupUsername", username);
  await page.fill("#signupPassword", PASSWORD);
  await page.click("#signupForm button[type=submit]");
  await page.waitForSelector("#recoveryCode:not(.hidden)", { timeout: 30_000 });
  await page.check("#recoverySavedCheck");
  await page.click("#recoveryContinueBtn");
  await page.waitForSelector("#mainMenu:not(.hidden)", { timeout: 30_000 });
}

/** Jump the running game to a level and report what it built. */
async function gotoLevel(page: Page, levelIdx: number) {
  return page.evaluate((idx) => {
    const g = (window as unknown as { __game?: Record<string, unknown> }).__game;
    if (!g) return null;
    (g as unknown as { startLevel: (i: number) => void })["startLevel"](idx);
    const ghosts = (g as unknown as { ghosts: unknown[] }).ghosts;
    const chip = document.getElementById("levelChip");
    const lives = document.getElementById("lives");
    const row = chip?.parentElement;
    // IDEA-076: the map chip shares its LINE with the score chip now, not with
    // the lives chip — so the score is what a widening map figure can push.
    const score = document.querySelector(".hud-line--top .stat");
    const buttons = document.querySelector(".hud-buttons");
    // NO INNER NAMED FUNCTION HERE. esbuild's keepNames wraps a named arrow —
    // including one that takes its name from the const it is assigned to — in
    // a `__name` helper, and Playwright serialises the SOURCE into the page,
    // where that helper does not exist. The whole evaluate then dies on one
    // "ReferenceError: __name is not defined" from code that is perfectly
    // valid TypeScript. Same trap IDEA-074 hit with `addInitScript`; a plain
    // loop over a list is the way round it.
    const rects: Record<string, { w: number; top: number; bottom: number } | null> = {};
    for (const [key, el] of [
      ["chip", chip],
      ["lives", lives],
      ["row", row],
      ["score", score],
      ["buttons", buttons],
    ] as Array<[string, Element | null | undefined]>) {
      const b = el ? el.getBoundingClientRect() : null;
      rects[key] = b
        ? { w: Math.round(b.width), top: Math.round(b.top), bottom: Math.round(b.bottom) }
        : null;
    }
    // WHAT THE CHIP SHOWS, eyebrow included. `#level` alone is only the
    // FIGURE — hud.ts's setLevel splits "Map 6" into a "MAP" eyebrow and a "6"
    // (IDEA-048), so half the assertions below had been comparing "6" against
    // "Map 6" and failing ever since, and the other half had been rewritten to
    // expect the bare figure. One reading for both. The eyebrow is HIDDEN
    // rather than emptied for labels that name themselves, so "Bonus" and "C5"
    // must not pick it up.
    const eyebrow = document.getElementById("levelLabel") as HTMLElement | null;
    const figure = document.getElementById("level")?.textContent ?? "";
    const shown = eyebrow && !eyebrow.hidden ? `${eyebrow.textContent ?? ""} ${figure}`.trim() : figure;
    return {
      label: shown,
      ghostCount: Array.isArray(ghosts) ? ghosts.length : -1,
      banner: document.querySelector("#center .banner")?.textContent ?? "",
      chip: rects.chip,
      lives: rects.lives,
      row: rects.row,
      score: rects.score,
      buttons: rects.buttons,
    };
  }, levelIdx);
}

async function main(): Promise<void> {
  const browser = await chromium.launch();
  // `reducedMotion: "reduce"` is not optional for any context that drives the
  // real UI: the menu's Play card animates, and Playwright will not click an
  // element whose bounding box never settles — `page.click("#playBtn")` simply
  // times out after sixty seconds of "element is not stable". The stylesheet
  // already cancels every animation under `prefers-reduced-motion`, so the
  // product keeps its motion and the suite gets a still button. This was the
  // one browser suite in the project still missing it.
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  page.setDefaultTimeout(60_000);

  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await signUp(page, uniqueName());
  await page.click("#playBtn");
  // THE HOW-TO-PLAY CAROUSEL OPENS OVER THE FIRST RUN, and `body.tutorial-open`
  // sets `.hud{display:none}` — so every HUD rect below reads 0x0 while the
  // game itself is running perfectly. Dismiss it the way a player does.
  // (This is why the section further down measures a WIDTH as well as a
  // position: a hidden element passes any "these two are on the same line"
  // check that only compares offsets.)
  await page.waitForSelector("#tutorial:not(.hidden)", { timeout: 20_000 });
  await page.click(".tut-skip");
  await page.waitForSelector("#tutorial.hidden", { state: "attached", timeout: 10_000 });
  await page.waitForTimeout(3_000);

  const hookPresent = await page.evaluate(() =>
    Boolean((window as unknown as { __game?: unknown }).__game));
  if (!hookPresent) {
    console.log("\n  SKIP — window.__game debug hook not exposed in this build.");
    console.log("  (The pure model is covered by scripts/test-progression.ts.)");
    await browser.close();
    return;
  }

  section("Stage 1 — maps 1-5, three enemies");
  for (const [idx, wantLabel] of [[0, "Map 1"], [4, "Map 5"]] as const) {
    const r = await gotoLevel(page, idx);
    await page.waitForTimeout(400);
    ok(`level ${idx} shows "${wantLabel}"`, r?.label === wantLabel, r?.label);
    ok(`level ${idx} spawns 3 enemies`, r?.ghostCount === 3, r?.ghostCount);
  }

  section("The bonus level");
  {
    const r = await gotoLevel(page, 5);
    await page.waitForTimeout(400);
    ok('level 5 shows "Bonus"', r?.label === "Bonus", r?.label);
    ok("level 5 spawns ONE enemy", r?.ghostCount === 1, r?.ghostCount);
  }

  section("Stage 2 — maps 6-10, still three enemies");
  {
    const r = await gotoLevel(page, 6);
    await page.waitForTimeout(400);
    ok('level 6 shows "Map 6"', r?.label === "Map 6", r?.label);
    ok("level 6 spawns 3 enemies", r?.ghostCount === 3, r?.ghostCount);
  }

  section("Stage 3 — the FOURTH enemy");
  for (const [idx, wantLabel] of [[12, "Map 11"], [16, "Map 15"]] as const) {
    const r = await gotoLevel(page, idx);
    await page.waitForTimeout(400);
    ok(`level ${idx} shows "${wantLabel}"`, r?.label === wantLabel, r?.label);
    ok(`level ${idx} spawns 4 enemies`, r?.ghostCount === 4, r?.ghostCount);
  }

  section("Stages 4-6 — the new maps, and the FIFTH enemy (IDEA-061)");
  {
    const s4 = await gotoLevel(page, 18);
    await page.waitForTimeout(400);
    ok('level 18 shows "Map 16"', s4?.label === "Map 16", s4?.label);
    ok("level 18 spawns 4 enemies", s4?.ghostCount === 4, s4?.ghostCount);

    const s5 = await gotoLevel(page, 24);
    await page.waitForTimeout(400);
    ok('level 24 shows "Map 21"', s5?.label === "Map 21", s5?.label);
    ok("level 24 spawns 5 enemies", s5?.ghostCount === 5, s5?.ghostCount);

    const last = await gotoLevel(page, 34);
    await page.waitForTimeout(400);
    ok('level 34 shows "Map 30"', last?.label === "Map 30", last?.label);
    ok("level 34 spawns 5 enemies", last?.ghostCount === 5, last?.ghostCount);
  }

  section("Lap 2 — the map number keeps counting");
  {
    const r = await gotoLevel(page, 36);
    await page.waitForTimeout(400);
    ok('level 36 shows "Map 31", not "Map 1"', r?.label === "Map 31", r?.label);
    ok("level 36 spawns 5 enemies", r?.ghostCount === 5, r?.ghostCount);

    const bonus = await gotoLevel(page, 41);
    await page.waitForTimeout(400);
    ok('level 41 shows "Bonus" with no lap mark', bonus?.label === "Bonus", bonus?.label);
    ok("lap-2 bonus spawns 2 enemies", bonus?.ghostCount === 2, bonus?.ghostCount);
  }

  // IDEA-061's one LAYOUT consequence. The HUD was written around a map figure
  // "one character wide", and the number is now two digits for most of a long
  // run and three for a very long one (Map 115 is lap 4).
  //
  // MEASURED at 390x844 rather than reasoned about: the chip goes 75.5px at
  // "5" to 88.7 at "30" to 92.8 at "115", and "Bonus" is wider still at ~103 —
  // so a numbered map can never be the thing that overflows its line.
  //
  // IDEA-076 changed WHAT it shares that line with. The map chip used to sit
  // beside the lives chip in a right-hand COLUMN, where the two together were
  // ~213px of a column the 200px button row had already claimed; it now sits
  // at the far end of a full-width line whose other end is the score chip, and
  // lives has dropped to the line below with the coin wallet. So the three
  // things to hold are: map stays on the score's line, lives stays on the
  // coins' line, and the chrome row stays BELOW both — the last is the one
  // Nuno reported, where the home button had wrapped to a line of its own.
  section("The HUD lines survive a wide map number");
  {
    // THE HUD HAS TO BE ON SCREEN, AND THAT NEEDS SAYING OUT LOUD. Fourteen
    // `startLevel` calls with 300-400ms of real play between them is enough
    // real estate for the beagle to lose all three lives, and a game over
    // returns to the menu — where `.hud` is `display:none` and every
    // `getBoundingClientRect()` below reads 0x0. The assertion this section
    // replaced was `Math.abs(chip.top - lives.top) < 4`, which PASSES on
    // 0 - 0: it had been measuring a hidden element and reporting a pass.
    // Every check here is therefore bounded at both ends (IDEA-073's rule),
    // starting with a non-zero width.
    const live = await page.evaluate(() => {
      const menu = document.getElementById("mainMenu");
      return !menu || menu.classList.contains("hidden");
    });
    if (!live) {
      await page.click("#playBtn");
      await page.waitForTimeout(2_000);
    }
    const widest = [
      ["Map 5", 4],
      ["Map 30", 34],
      ["Map 31", 36],
      // Lap 4, map 25 — the first THREE-digit figure a real run can reach.
      ["Map 115", 36 * 3 + 28],
    ] as const;
    for (const [name, idx] of widest) {
      const r = await gotoLevel(page, idx);
      await page.waitForTimeout(300);
      if (!r?.chip || !r.lives || !r.score || !r.buttons || r.chip.w === 0 || r.score.w === 0) {
        ok(`${name}: the HUD is on screen and measurable`, false, JSON.stringify(r));
        continue;
      }
      // Vertical OVERLAP, not an equal top: the two chips on a line are
      // different heights and `align-items:center` offsets the shorter one,
      // so comparing tops would report a correct line as two rows.
      ok(
        `${name} (figure "${r.label}", chip ${r.chip.w}px): map shares the TOP line with the score`,
        r.chip.top < r.score.bottom && r.score.top < r.chip.bottom,
        `score ${r.score.top}..${r.score.bottom}, map ${r.chip.top}..${r.chip.bottom}`,
      );
      ok(
        `${name}: lives is on its own line BELOW the map chip`,
        r.lives.top >= r.chip.bottom - 2,
        `map bottom=${r.chip.bottom} lives top=${r.lives.top}`,
      );
      ok(
        `${name}: the chrome row is below the chips, not wrapped into them`,
        r.buttons.top >= r.lives.bottom - 2,
        `lives bottom=${r.lives.bottom} buttons top=${r.buttons.top}`,
      );
    }
  }

  ok("no console errors during the sweep", errors.length === 0, errors.slice(0, 2).join(" | "));

  await browser.close();

  console.log(`\n${"-".repeat(60)}`);
  console.log(`PROGRESSION UI: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
