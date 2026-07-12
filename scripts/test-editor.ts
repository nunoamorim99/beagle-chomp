// Automated browser checks for the character editor's delete flow (IDEA-025
// v2: "delete a component or a selected part"). Boots its OWN Vite dev
// server (programmatic API, not a spawned CLI process — no log-scraping to
// detect readiness) and drives /editor/ with a real headless Chromium via
// Playwright, since this exercises DOM/lil-gui/keyboard/scene-graph behavior
// no headless Node script could reach. Same "assert + log, exit 1 on
// failure" style as validate-maze.ts/sim-logic.ts/test-cosmetics.ts, adapted
// for an async browser flow.
//
// NOT wired into `npm run test` (that suite is the headless pure-logic
// tests CLAUDE.md's rule is about — no browser, fast, no dev server). Run
// this one directly: `npm run test:editor` (spawns Chromium + Vite, a few
// seconds slower). Requires Playwright's browser binaries to already be
// installed (`npx playwright install chromium`) — the repo's playwright
// devDependency ships the driver, not the binaries.
import { createServer, type ViteDevServer } from "vite";
import { chromium, type Browser, type Page } from "playwright";

let failures = 0;
function check(label: string, cond: boolean): void {
  if (cond) {
    console.log(`  ok   ${label}`);
  } else {
    console.log(`  FAIL ${label}`);
    failures++;
  }
}

// --- small DOM helpers the whole suite shares -----------------------------

/** Tree rows in current DOM order, same shape select()/refreshParts() would
 *  leave them in — reading THIS (not internal module state) is deliberate:
 *  partTree.ts's buildPartList() walks the LIVE THREE.Group, so a row being
 *  gone from this list is real proof the object left the scene graph, not
 *  just a visual illusion. */
async function treeRows(page: Page): Promise<Array<{ text: string; isMesh: boolean; isAdded: boolean; selected: boolean }>> {
  return page.$$eval(".tree-row", (els) =>
    els.map((e) => ({
      text: e.querySelector(".tree-name")?.textContent ?? "",
      isMesh: e.className.includes("is-mesh"),
      isAdded: e.className.includes("is-added"),
      selected: e.className.includes("selected"),
    })),
  );
}

async function rowIndexByText(page: Page, text: string): Promise<number> {
  return page.evaluate(
    (t) => [...document.querySelectorAll(".tree-row")].findIndex((r) => r.querySelector(".tree-name")?.textContent === t),
    text,
  );
}

async function clickRow(page: Page, index: number): Promise<void> {
  await page.evaluate((i) => {
    const row = document.querySelectorAll(".tree-row")[i];
    if (!(row instanceof HTMLElement)) throw new Error(`row ${i} not found`);
    row.click();
  }, index);
  await page.waitForTimeout(150); // select() + tree re-render settle
}

/** The bottom "Generated code" panel's raw text — the same surface a user
 *  reads/copies from, so asserting on it is asserting on the real feature,
 *  not a white-box internal. */
async function generatedText(page: Page): Promise<string> {
  return page.$eval("#generatedView code", (el) => el.textContent ?? "");
}

/** Clicks the inspector's delete button for the CURRENT selection folder —
 *  found by its visible label ("delete part 🗑" or "delete part + N inside
 *  🗑"), matching how a real person would click it (no internal handle). */
async function clickDeleteButton(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const fns = [...document.querySelectorAll("#guiPane .lil-function")];
    const del = fns.find((b) => b.querySelector(".lil-name")?.textContent?.startsWith("delete part"));
    if (!del) return null;
    const label = del.querySelector(".lil-name")?.textContent ?? null;
    del.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return label;
  });
}

/** True when the CURRENT selection folder has a delete button at all — used
 *  for the root-is-never-deletable check (button must be entirely absent,
 *  not just disabled — matches how inspector.ts actually implements the
 *  guard: it skips adding the controller). */
async function hasDeleteButton(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    [...document.querySelectorAll("#guiPane .lil-function")].some((b) =>
      b.querySelector(".lil-name")?.textContent?.startsWith("delete part"),
    ),
  );
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
    page.on("console", (msg) => {
      if (msg.type() === "error") pageErrors.push(msg.text());
    });

    // ---------------------------------------------------------------------
    console.log("\n=== boots clean ===");
    await page.goto(base);
    await page.waitForSelector(".tree-row"); // first paint of the part tree
    await page.waitForTimeout(300); // idle animation frame, lil-gui init
    check("no page errors on load", pageErrors.length === 0);
    const initialRows = await treeRows(page);
    check("part tree has rows", initialRows.length > 5);
    check("generated code starts empty", (await generatedText(page)).includes("No edits yet"));

    // ---------------------------------------------------------------------
    console.log("\n=== delete an ORIGINAL mesh part (button) ===");
    {
      const before = await treeRows(page);
      const idx = await rowIndexByText(page, "blaze");
      check("found 'blaze' (an original mesh) in the tree", idx !== -1);
      await clickRow(page, idx);
      const label = await clickDeleteButton(page);
      check("delete button was present and clicked", label !== null && label.startsWith("delete part"));
      check("delete button has no subtree suffix on a leaf mesh", label === "delete part 🗑");
      await page.waitForTimeout(150);

      const after = await treeRows(page);
      check("row count dropped by exactly 1", after.length === before.length - 1);
      check("'blaze' is gone from the tree (== gone from the scene graph)", !after.some((r) => r.text === "blaze"));
      check("nothing stayed selected after delete", !after.some((r) => r.selected));

      const gen = await generatedText(page);
      check("generated code contains blaze.removeFromParent();", gen.includes("blaze.removeFromParent();"));
    }

    // ---------------------------------------------------------------------
    console.log("\n=== undo restores it (visible again, tree row back, no codegen) ===");
    {
      await page.keyboard.press("Control+z");
      await page.waitForTimeout(150);
      const after = await treeRows(page);
      check("row count back to original", after.length === initialRows.length);
      check("'blaze' is back in the tree", after.some((r) => r.text === "blaze"));
      check("restored part is selected (lands back on it)", after.find((r) => r.text === "blaze")?.selected === true);
      const gen = await generatedText(page);
      check("generated code has NO removeFromParent (undo cleared the mark)", !gen.includes("removeFromParent"));
      check("generated code is back to the empty placeholder", gen.includes("No edits yet"));

      // Order preservation: same row sequence as before any deletion.
      const sameOrder = JSON.stringify(after.map((r) => r.text)) === JSON.stringify(initialRows.map((r) => r.text));
      check("row order after undo exactly matches the original (sibling index preserved)", sameOrder);
    }

    // ---------------------------------------------------------------------
    console.log("\n=== redo re-deletes ===");
    {
      await page.keyboard.press("Control+y");
      await page.waitForTimeout(150);
      const after = await treeRows(page);
      check("'blaze' is gone again after redo", !after.some((r) => r.text === "blaze"));
      const gen = await generatedText(page);
      check("generated code shows removeFromParent again after redo", gen.includes("blaze.removeFromParent();"));
    }
    // leave it undone for the next block, on a fresh page instead (isolate state)

    // ---------------------------------------------------------------------
    console.log("\n=== root is never deletable ===");
    {
      await page.goto(base);
      await page.waitForSelector(".tree-row");
      await page.waitForTimeout(300);
      await clickRow(page, 0); // row 0 is always the root ("<Label> (g)")
      const rootText = (await treeRows(page))[0]?.text ?? "";
      check("row 0 is the character root", /\(g\)$/.test(rootText));
      check("root selection has NO delete button at all", !(await hasDeleteButton(page)));
    }

    // ---------------------------------------------------------------------
    console.log("\n=== Delete key deletes the current selection ===");
    {
      const before = await treeRows(page);
      const idx = await rowIndexByText(page, "nose");
      check("found 'nose' in the tree", idx !== -1);
      await clickRow(page, idx);
      await page.keyboard.press("Delete");
      await page.waitForTimeout(150);
      const after = await treeRows(page);
      check("'nose' gone after pressing Delete", !after.some((r) => r.text === "nose"));
      check("row count dropped by 1 via keyboard delete", after.length === before.length - 1);
      const gen = await generatedText(page);
      check("keyboard delete also emits removeFromParent()", gen.includes("nose.removeFromParent();"));
      // restore for the next block
      await page.keyboard.press("Control+z");
      await page.waitForTimeout(150);
    }

    // ---------------------------------------------------------------------
    console.log("\n=== Esc still deselects (regression) ===");
    {
      const idx = await rowIndexByText(page, "nose");
      await clickRow(page, idx);
      check("something is selected before Escape", (await treeRows(page)).some((r) => r.selected));
      await page.keyboard.press("Escape");
      await page.waitForTimeout(100);
      check("nothing selected after Escape", !(await treeRows(page)).some((r) => r.selected));
    }

    // ---------------------------------------------------------------------
    console.log("\n=== delete an ORIGINAL group removes its whole subtree ===");
    {
      await page.goto(base);
      await page.waitForSelector(".tree-row");
      await page.waitForTimeout(300);
      const before = await treeRows(page);
      const jawIdx = await rowIndexByText(page, "jaw");
      check("found 'jaw' (a group with a child) in the tree", jawIdx !== -1);
      const childText = before[jawIdx + 1]?.text ?? "";
      check("'jaw' has a child row right after it in the tree", childText.length > 0);

      await clickRow(page, jawIdx);
      const label = await clickDeleteButton(page);
      check('group delete button shows the subtree-size subtitle ("+ N inside")', label !== null && /delete part \+ \d+ inside 🗑/.test(label));
      await page.waitForTimeout(150);

      const after = await treeRows(page);
      check("'jaw' is gone from the tree", !after.some((r) => r.text === "jaw"));
      check("'jaw's child is ALSO gone (whole subtree removed)", !after.some((r) => r.text === childText));
      check("row count dropped by jaw + its descendants", after.length < before.length - 1);

      const gen = await generatedText(page);
      check("generated code emits removeFromParent() for the GROUP itself", gen.includes("jaw.removeFromParent();"));
      check("generated code does NOT also emit a line for the now-gone child", !gen.includes(`${childText}.removeFromParent();`));

      await page.keyboard.press("Control+z");
      await page.waitForTimeout(150);
      const restored = await treeRows(page);
      check("undo restores the whole subtree (row count back to original)", restored.length === before.length);
      check("undo restores the child too", restored.some((r) => r.text === childText));
    }

    // ---------------------------------------------------------------------
    console.log("\n=== deleting an editor-ADDED part keeps its existing behavior (regression) ===");
    {
      await page.goto(base);
      await page.waitForSelector(".tree-row");
      await page.waitForTimeout(300);
      const bodyIdx = await rowIndexByText(page, "body");
      await clickRow(page, bodyIdx);

      // Fill the "Add part" name field, then click "add to selected part".
      await page.evaluate(() => {
        const nameInput = [...document.querySelectorAll("#guiPane .lil-controller")]
          .find((c) => c.querySelector(".lil-name")?.textContent === "name")
          ?.querySelector("input");
        if (!(nameInput instanceof HTMLInputElement)) throw new Error("name field not found");
        nameInput.value = "editorTestSphere";
        nameInput.dispatchEvent(new Event("input", { bubbles: true }));
        nameInput.dispatchEvent(new Event("change", { bubbles: true }));
      });
      const added = await page.evaluate(() => {
        const fns = [...document.querySelectorAll("#guiPane .lil-function")];
        const add = fns.find((b) => b.querySelector(".lil-name")?.textContent?.includes("add to selected part"));
        add?.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        return !!add;
      });
      check("added a new part via the Add-part panel", added);
      await page.waitForTimeout(150);
      check("the new part shows in the tree as is-added", (await treeRows(page)).some((r) => r.text === "editorTestSphere" && r.isAdded));
      const genAfterAdd = await generatedText(page);
      check("codegen shows the new-part construction block", genAfterAdd.includes("const editorTestSphere ="));

      const label = await clickDeleteButton(page);
      check("added part's delete button has no subtree suffix (it's a leaf)", label === "delete part 🗑");
      await page.waitForTimeout(150);
      check("added part is gone from the tree", !(await treeRows(page)).some((r) => r.text === "editorTestSphere"));
      const genAfterDelete = await generatedText(page);
      check(
        "added-then-deleted part drops OUT of codegen entirely (no removeFromParent — never existed in the builder)",
        !genAfterDelete.includes("editorTestSphere") && genAfterDelete.includes("No edits yet"),
      );
    }

    check("zero uncaught page errors across the whole run", pageErrors.length === 0);
    if (pageErrors.length > 0) console.log("  page errors seen:", pageErrors);
  } finally {
    await browser?.close();
    await server?.close();
  }
}

run()
  .then(() => {
    console.log(`\n${failures === 0 ? "ALL EDITOR CHECKS PASSED" : `${failures} EDITOR CHECK(S) FAILED`}`);
    if (failures > 0) process.exit(1);
  })
  .catch((err) => {
    console.error("editor test run crashed:", err);
    process.exit(1);
  });
