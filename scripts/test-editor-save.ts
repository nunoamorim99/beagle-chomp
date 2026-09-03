// End-to-end proof for IDEA-025 v3: drive the REAL editor in a real browser,
// move a part, press 💾 Save, and assert what actually landed on disk.
//
// The unit suite (test-source-rewrite.ts) proves the rewriter's string logic;
// this proves the whole chain — inspector → EditLog → applyEditsInPlace →
// the dev-only /__save-file middleware → characters.ts. That chain is exactly
// where the old flow lied: it flashed "Saved ✓" for changes that were appended
// as an override block (or, for animated/skin-owned values, could never stick
// at all — see IDEA-041).
//
// SAFETY: this test WRITES src/render/characters.ts, then restores its exact
// original bytes in a finally block. Run: tsx scripts/test-editor-save.ts
// (npm run test:editor:save, part of `npm run test:editor`).
import { createServer, type ViteDevServer } from "vite";
import { chromium, type Browser } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const FILE = resolve("src/render/characters.ts");
const ORIGINAL = readFileSync(FILE, "utf-8");

let failures = 0;
function check(label: string, cond: boolean): void {
  if (cond) {
    console.log(`  ok   ${label}`);
  } else {
    console.log(`  FAIL ${label}`);
    failures++;
  }
}

function count(s: string, re: RegExp): number {
  return (s.match(new RegExp(re.source, "g")) ?? []).length;
}

/**
 * Just one builder's text. These assertions are about what the rewriter did
 * inside makeBeagle, and whole-file counting was quietly wrong: `body` is a
 * local in several builders, so adding one elsewhere broke tests that had
 * nothing to do with the change.
 */
function builderSlice(src: string, name: string): string {
  const start = src.indexOf(`export function ${name}(`);
  if (start === -1) return "";
  const next = src.indexOf("\nexport function ", start + 1);
  return src.slice(start, next === -1 ? undefined : next);
}

/**
 * Clicks 💾 Save and returns the REPORT PANEL's text once it reports an outcome.
 *
 * Deliberately not the button. The button's flash lasts 1600ms, and a
 * successful save writes characters.ts — which makes Vite hot-reload the page
 * out from under the poll. So the flash can expire, or its execution context be
 * torn down, before any assertion sees it, and the button reads as its plain
 * label even though the save succeeded. That produced a consistent false
 * failure while the panel said "1 change(s) written" and the file on disk had
 * genuinely changed.
 *
 * The panel is the durable record: main.ts stashes the report before writing
 * and re-renders it after the reload, so it survives the very event that eats
 * the flash.
 */
async function clickSaveAndWait(page: import("playwright").Page): Promise<string> {
  await page.click("#saveFileBtn");
  try {
    await page.waitForFunction(
      () => /Saved to|NOT saved|Save failed/.test(
        document.getElementById("generatedView")?.textContent ?? "",
      ),
      undefined,
      { timeout: 8000 },
    );
  } catch {
    // Fall through — the caller's assertion reports the actual text, which is
    // more useful than a bare timeout error.
  }
  return page.$eval("#generatedView", (el) => el.textContent ?? "");
}

/** Clicks the tree row whose name matches, returns false if absent. */
async function selectPart(page: import("playwright").Page, name: string): Promise<boolean> {
  const idx = await page.evaluate(
    (n) =>
      [...document.querySelectorAll(".tree-row")].findIndex(
        (r) => r.querySelector(".tree-name")?.textContent === n,
      ),
    name,
  );
  if (idx < 0) return false;
  await page.evaluate((i) => {
    (document.querySelectorAll(".tree-row")[i] as HTMLElement).click();
  }, idx);
  await page.waitForTimeout(150);
  return true;
}

/**
 * Waits for the part tree's first paint by INTERVAL polling. Playwright's
 * default waitForSelector polls on requestAnimationFrame, and on a cold
 * spawned server the editor's boot (module transform + building ~60 meshes +
 * lil-gui) keeps the main thread busy enough that an immediate rAF-polled
 * wait can stall for the full timeout while the rows are already on screen.
 */
async function waitForTree(page: import("playwright").Page): Promise<void> {
  await page.waitForFunction(() => document.querySelectorAll(".tree-row").length > 0, null, { polling: 250, timeout: 60_000 });
}

async function run(): Promise<void> {
  let server: ViteDevServer | undefined;
  let browser: Browser | undefined;
  try {
    server = await createServer({ server: { port: 0, strictPort: false }, logLevel: "error" });
    await server.listen();
    const address = server.httpServer?.address();
    const port = typeof address === "object" && address ? address.port : null;
    if (!port) throw new Error("dev server did not report a port");
    const base = `http://localhost:${port}/editor/`;
    console.log(`Editor dev server up at ${base}`);

    browser = await chromium.launch();
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error") pageErrors.push(m.text());
    });

    await page.goto(base);
    await waitForTree(page);
    await page.waitForTimeout(400);

    // -------------------------------------------------------------------
    console.log("\n=== Save rewrites the part's REAL line ===");
    check("found 'body' in the part tree", await selectPart(page, "body"));

    // 3 x ArrowUp = +0.03 on Y (NUDGE_STEP is 0.01).
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("ArrowUp");
      await page.waitForTimeout(50);
    }

    const flash = await clickSaveAndWait(page);
    console.log(`    panel: "${flash.slice(0, 70)}"`);
    check("the panel reports a saved change", /Saved to/.test(flash));

    const after = readFileSync(FILE, "utf-8");
    check("characters.ts changed on disk", after !== ORIGINAL);
    check(
      "the body's own position.set carries the new Y",
      /body\.position\.set\(0, 0\.35, -0\.22\)/.test(after),
    );
    check("the old value is gone", !/body\.position\.set\(0, 0\.32, -0\.22\)/.test(after));
    check(
      "still exactly ONE body.position.set in makeBeagle — nothing appended",
      count(builderSlice(after, "makeBeagle"), /body\.position\.set/) === 1,
    );
    check(
      "no NEW 'Character Editor edits' block was added",
      count(after, /Character Editor edits \(generated/) ===
        count(ORIGINAL, /Character Editor edits \(generated/),
    );
    check(
      "the edit is line-for-line — no growth",
      after.split("\n").length === ORIGINAL.split("\n").length,
    );
    check(
      "no OTHER builder was touched at all",
      // The strongest form of the scoping guarantee findFunctionRange buys us:
      // rewriting one line inside makeBeagle must leave every other builder
      // byte-identical. (This used to name a specific line in makeBee, which
      // broke the moment the bee was redesigned — the property that actually
      // matters is "unchanged", not "still contains this string".)
      ["makeGhost", "makeBeetle", "makeBee", "makeLadybug"].every(
        (fn) => builderSlice(after, fn) === builderSlice(ORIGINAL, fn),
      ),
    );
    check(
      "the part's documenting comment survived",
      /the one continuous body mass/.test(after),
    );

    const report = await page.$eval("#generatedView", (el) => el.textContent ?? "");
    check("the panel reports what was written", /Written in place/.test(report));
    check("…and names the property", /body\.position/.test(report));

    // -------------------------------------------------------------------
    console.log("\n=== a loop-built mirrored part is reported, not faked ===");
    await page.goto(base);
    await waitForTree(page);
    await page.waitForTimeout(400);

    const beforeEar = readFileSync(FILE, "utf-8");
    // earL became a real declaration (its position saves); the brow swells
    // are still built in the per-side loop, so they stay the refusal fixture.
    const gotEar = await selectPart(page, "browSwellL");
    check("found 'browSwellL' (a mirrored, loop-built part)", gotEar);
    if (gotEar) {
      for (let i = 0; i < 3; i++) {
        await page.keyboard.press("ArrowUp");
        await page.waitForTimeout(50);
      }
      const earFlash = await clickSaveAndWait(page);
      console.log(`    panel: "${earFlash.slice(0, 70)}"`);
      check("the panel says nothing was saved", /NOT saved/.test(earFlash));
      check("characters.ts was NOT written", readFileSync(FILE, "utf-8") === beforeEar);

      const earReport = await page.$eval("#generatedView", (el) => el.textContent ?? "");
      check("the panel explains why", /NOT saved/.test(earReport));
      check("…naming the loop as the reason", /loop|callback/i.test(earReport));
      console.log(
        "    panel said: " +
          (earReport.split("\n").find((l) => /loop|callback/i.test(l)) ?? "").trim(),
      );
    }

    // -------------------------------------------------------------------
    console.log("\n=== IDEA-041: a runtime-driven channel is locked and refused ===");
    await page.goto(base);
    await waitForTree(page);
    await page.waitForTimeout(400);

    const beforeTail = readFileSync(FILE, "utf-8");
    const gotTail = await selectPart(page, "tail");
    check("found 'tail' (top-level in the source, but animated every frame)", gotTail);
    if (gotTail) {
      // The inspector should say so BEFORE any time is spent dragging.
      const guiText = await page.$eval("#charGuiHost", (el) => el.textContent ?? "");
      check("the rotation folder is marked as runtime-driven", /rotation 🔒/.test(guiText));
      check("…and names where the value lives", /lives in/.test(guiText));
      const lockedCount = await page.$$eval(".runtime-owned", (els) => els.length);
      check("at least one control carries the runtime-owned marker", lockedCount > 0);

      // Hold R + arrows = rotate nudge (the keyboard path bypasses the
      // disabled lil-gui widget, so the SAVE path must refuse it too).
      await page.keyboard.down("r");
      for (let i = 0; i < 3; i++) {
        await page.keyboard.press("ArrowLeft");
        await page.waitForTimeout(50);
      }
      await page.keyboard.up("r");
      await page.waitForTimeout(100);

      const tailFlash = await clickSaveAndWait(page);
      console.log(`    panel: "${tailFlash.slice(0, 70)}"`);
      check("nothing was saved for the animated joint", /NOT saved/.test(tailFlash));
      check("characters.ts was NOT written", readFileSync(FILE, "utf-8") === beforeTail);

      const tailReport = await page.$eval("#generatedView", (el) => el.textContent ?? "");
      check("the report names the animator", /animateBeagleParts/.test(tailReport));
      check("…and points at the real owner", /AMPLITUDE/.test(tailReport));
      console.log(
        "    panel said: " +
          (tailReport.split("\n").find((l) => /animateBeagleParts/.test(l)) ?? "").trim().slice(0, 120),
      );
    }

    check("zero uncaught page errors across the run", pageErrors.length === 0);
    if (pageErrors.length) console.log(pageErrors.slice(0, 3));
  } finally {
    // Always put the real file back exactly as it was.
    writeFileSync(FILE, ORIGINAL, "utf-8");
    const restored = readFileSync(FILE, "utf-8") === ORIGINAL;
    console.log(`\n  ${restored ? "ok  " : "FAIL"} src/render/characters.ts restored to its original bytes`);
    if (!restored) failures++;
    await browser?.close();
    await server?.close();
  }

  console.log(`\n${failures === 0 ? "ALL EDITOR-SAVE CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
  if (failures > 0) process.exit(1);
}

void run();
