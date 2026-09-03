// Automated browser checks for the editor's DIRECT-MANIPULATION and VIEWPORT
// surfaces (the three.js-editor parity work): the transform gizmo toolbar and
// its shortcuts, the click-to-jump history panel, the outliner's fold /
// badge / keyboard navigation, and the viewport furniture (orientation cube,
// scene readout, shading overrides).
//
// Same shape as test-editor.ts: boots its OWN Vite dev server programmatically
// and drives /editor/ with headless Chromium, asserting on the surfaces a real
// person reads (the generated-code panel, the tree rows, the toolbar buttons)
// rather than on internal module state.
//
// One thing this file deliberately does NOT do is synthesise a pointer drag on
// the gizmo's arrow handles. Hitting a specific axis handle means guessing its
// projected pixel position, which is a function of camera framing and would
// turn a real regression signal into a flaky one. What IS asserted is every
// observable consequence of the gizmo's plumbing: the toolbar/shortcut state
// machine, and that transform edits reach the history panel with a label and
// can be jumped back out of. The drag itself is covered by the manual
// playtest checklist.
import { createServer, type ViteDevServer } from "vite";
import { chromium, type Browser, type Page } from "playwright";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let failures = 0;
function check(label: string, cond: boolean): void {
  if (cond) {
    console.log(`  ok   ${label}`);
  } else {
    console.log(`  FAIL ${label}`);
    failures++;
  }
}

async function treeRows(page: Page): Promise<Array<{ text: string; badge: string; selected: boolean }>> {
  return page.$$eval(".tree-row", (els) =>
    els.map((e) => ({
      text: e.querySelector(".tree-name")?.textContent ?? "",
      badge: e.querySelector(".tree-type-badge")?.textContent ?? "",
      selected: e.className.includes("selected"),
    })),
  );
}

async function generatedText(page: Page): Promise<string> {
  return page.$eval("#generatedView code", (el) => el.textContent ?? "");
}

async function activeGizmoMode(page: Page): Promise<string | null> {
  return page.$eval(".gizmo-btn.active", (el) => el.getAttribute("data-gizmo"));
}

/** Clicks a tree row by its visible name. */
async function clickRowNamed(page: Page, name: string): Promise<boolean> {
  const ok = await page.evaluate((n) => {
    const row = [...document.querySelectorAll(".tree-row")].find(
      (r) => r.querySelector(".tree-name")?.textContent === n,
    );
    if (!(row instanceof HTMLElement)) return false;
    row.click();
    return true;
  }, name);
  await page.waitForTimeout(150);
  return ok;
}

/** Selected rows in tree order, flagged with whether they are a SECONDARY
 *  member of a multi-selection (i.e. not the primary the inspector shows). */
async function selectedRows(page: Page): Promise<Array<{ text: string; secondary: boolean }>> {
  return page.$$eval(".tree-row.selected", (els) =>
    els.map((e) => ({
      text: e.querySelector(".tree-name")?.textContent ?? "",
      secondary: e.className.includes("secondary"),
    })),
  );
}

/** Ctrl-clicks a row by name — the multi-select gesture. */
async function ctrlClickRowNamed(page: Page, name: string): Promise<void> {
  await page.evaluate((n) => {
    const row = [...document.querySelectorAll(".tree-row")].find(
      (r) => r.querySelector(".tree-name")?.textContent === n,
    );
    row?.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
  }, name);
  await page.waitForTimeout(150);
}

/** The inspector's "Selected: <part>" folder title — proves which part the
 *  right-hand pane is actually bound to. */
async function inspectorTitle(page: Page): Promise<string> {
  return page.evaluate(() => {
    const titles = [...document.querySelectorAll("#guiPane .lil-title")].map((e) => e.textContent ?? "");
    return titles.find((t) => t.startsWith("Selected:")) ?? "";
  });
}

async function historyRows(page: Page): Promise<Array<{ label: string; current: boolean; undone: boolean }>> {
  return page.$$eval(".history-row", (els) =>
    els.map((e) => ({
      label: e.querySelector(".history-label")?.textContent ?? "",
      current: e.className.includes("current"),
      undone: e.className.includes("undone"),
    })),
  );
}

/**
 * Waits for the part tree's first paint by INTERVAL polling. Playwright's
 * default waitForSelector polls on requestAnimationFrame, and on a cold
 * spawned server the editor's boot (module transform + building ~60 meshes +
 * lil-gui) keeps the main thread busy enough that an immediate rAF-polled
 * wait can stall for the full timeout while the rows are already on screen.
 */
async function waitForTree(page: Page): Promise<void> {
  await page.waitForFunction(() => document.querySelectorAll(".tree-row").length > 0, null, { polling: 250, timeout: 60_000 });
}

async function run(): Promise<void> {
  let server: ViteDevServer | undefined;
  let browser: Browser | undefined;
  try {
    // hmr:false + watch:null — this suite runs LAST in `npm run test:editor`,
    // right after test-editor-save.ts restores src/render/characters.ts on
    // disk. A watcher that notices that write mid-run triggers a full page
    // reload and every subsequent page.evaluate dies with "Execution context
    // was destroyed". Nothing here needs hot reload: the page is loaded once
    // and driven to the end.
    server = await createServer({
      server: { port: 0, strictPort: false, hmr: false, watch: null },
      logLevel: "error",
    });
    await server.listen();
    const address = server.httpServer?.address();
    const port = typeof address === "object" && address ? address.port : null;
    if (!port) throw new Error("dev server did not report a port");
    const base = `http://localhost:${port}/editor/`;
    console.log(`Editor dev server up at ${base}`);

    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    page.on("console", (msg) => {
      if (msg.type() === "error") pageErrors.push(msg.text());
    });

    await page.goto(base);
    await waitForTree(page);
    await page.waitForTimeout(400);

    // ---------------------------------------------------------------------
    console.log("\n=== gizmo toolbar + shortcuts ===");
    check("gizmo bar is up in character mode", await page.isVisible("#gizmoBar"));
    check("translate is the default mode", (await activeGizmoMode(page)) === "translate");

    await page.click('.gizmo-btn[data-gizmo="rotate"]');
    check("clicking rotate switches mode", (await activeGizmoMode(page)) === "rotate");

    // W/E/T, NOT the reference editor's W/E/R: R and S are already held
    // modifiers for arrow-key rotate/scale nudging in this editor.
    await page.keyboard.press("w");
    check("'w' selects translate", (await activeGizmoMode(page)) === "translate");
    await page.keyboard.press("e");
    check("'e' selects rotate", (await activeGizmoMode(page)) === "rotate");
    await page.keyboard.press("t");
    check("'t' selects scale", (await activeGizmoMode(page)) === "scale");

    // The collision guard itself: 'r' must NOT be a gizmo shortcut, because
    // it means "hold to nudge rotation" here.
    await page.keyboard.press("w");
    await page.keyboard.press("r");
    check("'r' is NOT bound to rotate mode (it is the nudge modifier)", (await activeGizmoMode(page)) === "translate");

    await page.keyboard.press("q");
    check("'q' hides the gizmo", (await page.$eval("#gizmoOffBtn", (e) => e.textContent)) === "Show");
    await page.keyboard.press("q");
    check("'q' again shows it", (await page.$eval("#gizmoOffBtn", (e) => e.textContent)) === "Hide");

    await page.click("#gizmoSpaceBtn");
    check("space toggle reads World", (await page.$eval("#gizmoSpaceBtn", (e) => e.textContent)) === "World");
    await page.click("#gizmoSpaceBtn");
    check("space toggle returns to Local", (await page.$eval("#gizmoSpaceBtn", (e) => e.textContent)) === "Local");

    await page.click("#gizmoSnapBtn");
    check("snap toggles on", await page.$eval("#gizmoSnapBtn", (e) => e.className.includes("active")));
    await page.click("#gizmoSnapBtn");
    check("snap toggles off", !(await page.$eval("#gizmoSnapBtn", (e) => e.className.includes("active"))));

    // ---------------------------------------------------------------------
    console.log("\n=== viewport furniture ===");
    const info = await page.$eval("#viewportInfo", (e) => e.textContent ?? "");
    check("scene readout reports objects", /\d+ objects/.test(info));
    check("scene readout reports triangles", /tris/.test(info));

    await page.click("#infoBtn");
    check("info toggle hides the readout", await page.$eval("#viewportInfo", (e) => (e as HTMLElement).hidden));
    await page.click("#infoBtn");
    check("info toggle brings it back", !(await page.$eval("#viewportInfo", (e) => (e as HTMLElement).hidden)));

    await page.click("#viewCubeBtn");
    check("orientation cube can be switched off", !(await page.$eval("#viewCubeBtn", (e) => e.className.includes("active"))));
    await page.click("#viewCubeBtn");
    check("…and back on", await page.$eval("#viewCubeBtn", (e) => e.className.includes("active")));

    for (const mode of ["wireframe", "normals", "solid"]) {
      await page.selectOption("#shadingSelect", mode);
      await page.waitForTimeout(120);
      check(`shading override '${mode}' applies without error`, (await page.inputValue("#shadingSelect")) === mode);
    }

    // ---------------------------------------------------------------------
    console.log("\n=== outliner: badges, folding, keyboard ===");
    const rows = await treeRows(page);
    check("mesh rows carry a geometry badge", rows.some((r) => r.badge.length > 0));

    // "jaw" is a group with a child in the beagle — same fixture test-editor.ts
    // uses for its subtree checks.
    const jawChildBefore = (await treeRows(page)).some((r) => r.text === "jawMesh");
    check("jaw's child is listed while expanded", jawChildBefore);
    const folded = await page.evaluate(() => {
      const row = [...document.querySelectorAll(".tree-row")].find(
        (r) => r.querySelector(".tree-name")?.textContent === "jaw",
      );
      const opener = row?.querySelector(".tree-opener");
      if (!(opener instanceof HTMLElement)) return false;
      opener.click();
      return true;
    });
    check("jaw has a fold twisty", folded);
    await page.waitForTimeout(120);
    check("folding jaw hides its child", !(await treeRows(page)).some((r) => r.text === "jawMesh"));
    check("jaw itself stays listed", (await treeRows(page)).some((r) => r.text === "jaw"));

    // Selecting a folded-away part from elsewhere must reveal it again.
    await page.evaluate(() => {
      const row = [...document.querySelectorAll(".tree-row")].find(
        (r) => r.querySelector(".tree-name")?.textContent === "jaw",
      );
      (row?.querySelector(".tree-opener") as HTMLElement | null)?.click();
    });
    await page.waitForTimeout(120);
    check("unfolding brings the child back", (await treeRows(page)).some((r) => r.text === "jawMesh"));

    // Arrow keys move the SELECTION while the tree has focus — and must not
    // also nudge the selected part's transform (which is what the same keys
    // do when the tree is not focused).
    check("selected 'nose' for the keyboard check", await clickRowNamed(page, "nose"));
    const genBeforeNav = await generatedText(page);
    await page.evaluate(() => (document.getElementById("partTree") as HTMLElement).focus());
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(150);
    const afterNav = await treeRows(page);
    check("ArrowDown moved the selection off 'nose'", !afterNav.find((r) => r.text === "nose")?.selected);
    check("…and something else is now selected", afterNav.some((r) => r.selected));
    check("…and it did NOT also nudge a transform", (await generatedText(page)) === genBeforeNav);

    // ---------------------------------------------------------------------
    console.log("\n=== history panel: labels + click to jump ===");
    await page.click("#viewport"); // focus out of the tree so arrows nudge again
    check("re-selected 'nose'", await clickRowNamed(page, "nose"));
    await page.evaluate(() => (document.body as HTMLElement).focus());
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(150);
    await page.click('.code-tab[data-tab="history"]');
    await page.waitForTimeout(120);

    const hist = await historyRows(page);
    check("history lists the original state", hist.some((r) => r.label === "original build"));
    check("a nudge shows up as a labelled step", hist.some((r) => r.label === "position nose"));
    check("the newest step is the current one", hist[hist.length - 1]?.current === true);

    const genWithEdit = await generatedText(page);
    check("the nudge is in the generated code", genWithEdit.includes("nose") && !genWithEdit.includes("No edits yet"));

    // Jump back to the original state by clicking row 0.
    await page.evaluate(() => {
      const rows2 = [...document.querySelectorAll(".history-row")];
      (rows2[0] as HTMLElement | undefined)?.click();
    });
    await page.waitForTimeout(200);
    check("jumping to 'original build' clears the edit from codegen", (await generatedText(page)).includes("No edits yet"));
    const histAfterJump = await historyRows(page);
    check("the jumped-past step is greyed as undone", histAfterJump.some((r) => r.label === "position nose" && r.undone));
    check("'original build' is now current", histAfterJump[0]?.current === true);

    // …and forward again, which is the half a plain Ctrl+Z cannot do in one click.
    await page.evaluate(() => {
      const rows2 = [...document.querySelectorAll(".history-row")];
      (rows2[rows2.length - 1] as HTMLElement | undefined)?.click();
    });
    await page.waitForTimeout(200);
    check("clicking the last step redoes it", !(await generatedText(page)).includes("No edits yet"));

    // ---------------------------------------------------------------------
    console.log("\n=== focus framing ===");
    check("focus button is present", await page.isVisible("#focusBtn"));
    await page.click("#focusBtn");
    await page.waitForTimeout(200);
    check("clicking Focus does not error", true);

    // ---------------------------------------------------------------------
    console.log("\n=== multi-select ===");
    await page.click('.code-tab[data-tab="generated"]');
    check("plain click selects one", await clickRowNamed(page, "nose"));
    check("…exactly one row is selected", (await selectedRows(page)).length === 1);

    // Ctrl-click adds; the newly clicked part becomes the PRIMARY.
    await ctrlClickRowNamed(page, "muzzle");
    const multi = await selectedRows(page);
    check("ctrl-click adds a second part", multi.length === 2);
    // selectedRows reads DOM (tree) order, which says nothing about WHICH is
    // primary — the `secondary` class is the only honest signal here.
    check("the newly clicked part is primary", multi.some((r) => r.text === "muzzle" && !r.secondary));
    check("the earlier one is demoted to secondary", multi.some((r) => r.text === "nose" && r.secondary));
    check("the inspector follows the primary", (await inspectorTitle(page)).includes("muzzle"));

    // Ctrl-clicking it again takes it back out.
    await ctrlClickRowNamed(page, "muzzle");
    check("ctrl-click again removes it", (await selectedRows(page)).length === 1);

    // `a` is a TOGGLE, so with a part still selected the first press CLEARS.
    await page.evaluate(() => (document.body as HTMLElement).focus());
    await page.keyboard.press("a");
    await page.waitForTimeout(200);
    check("'a' with a selection clears it", (await selectedRows(page)).length === 0);
    await page.keyboard.press("a");
    await page.waitForTimeout(250);
    const all = await selectedRows(page);
    check("'a' with nothing selected selects every part", all.length > 5);
    check("…but never the root", !all.some((r) => r.text.includes("(g)")));
    await page.keyboard.press("a");
    await page.waitForTimeout(200);
    check("'a' again clears them", (await selectedRows(page)).length === 0);

    // ---------------------------------------------------------------------
    console.log("\n=== multi-delete is ONE undo step ===");
    await clickRowNamed(page, "nose");
    await ctrlClickRowNamed(page, "muzzle");
    const rowsBeforeDelete = (await treeRows(page)).length;
    await page.evaluate(() => (document.body as HTMLElement).focus());
    await page.keyboard.press("Delete");
    await page.waitForTimeout(250);
    const afterDelete = await treeRows(page);
    check("both selected parts are gone", !afterDelete.some((r) => r.text === "nose" || r.text === "muzzle"));
    check("the tree lost exactly two rows", afterDelete.length === rowsBeforeDelete - 2);

    await page.click('.code-tab[data-tab="history"]');
    await page.waitForTimeout(120);
    const histDelete = await historyRows(page);
    check("history shows ONE grouped step", histDelete.some((r) => r.label === "delete 2 parts"));

    await page.evaluate(() => (document.body as HTMLElement).focus());
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(250);
    const afterUndo = await treeRows(page);
    check(
      "a single undo brings BOTH parts back",
      afterUndo.some((r) => r.text === "nose") && afterUndo.some((r) => r.text === "muzzle"),
    );

    // ---------------------------------------------------------------------
    console.log("\n=== animation timeline ===");
    // Selecting a part auto-pauses the preview (setSelection's "hold still
    // while editing"), and the timeline has nothing to scan while it is off —
    // it says exactly that in its own hint. Put it back on idle first.
    await page.evaluate(() => {
      const sel = [...document.querySelectorAll("#guiPane select")].find((el) =>
        [...(el as HTMLSelectElement).options].some((o) => o.value === "idle"),
      ) as HTMLSelectElement | undefined;
      if (!sel) return;
      sel.value = "idle";
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForTimeout(250);
    await page.click('.code-tab[data-tab="animation"]');
    await page.waitForTimeout(800); // the track scan replays a whole cycle

    const trackLabels = await page.$$eval(".tl-track-label", (els) => els.map((e) => e.textContent ?? ""));
    check("the timeline discovered animated channels", trackLabels.length > 0);
    check(
      "…and they name a part and a channel",
      trackLabels.every((l) => /\.(position|rotation|scale)$/.test(l)),
    );
    check(
      "the beagle's idle drives a rotation somewhere",
      trackLabels.some((l) => l.endsWith(".rotation")),
    );

    const t0 = await page.$eval(".tl-readout", (e) => e.textContent ?? "");
    await page.evaluate(() => {
      const s = document.querySelector(".tl-scrub") as HTMLInputElement | null;
      if (!s) return;
      s.value = "500";
      s.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.waitForTimeout(300);
    const t1 = await page.$eval(".tl-readout", (e) => e.textContent ?? "");
    check("scrubbing moves the clock", t0 !== t1 && t1.startsWith("1.0"));

    await page.click(".tl-btn"); // play
    await page.waitForTimeout(400);
    check("play flips the transport to pause", (await page.$eval(".tl-btn", (e) => e.textContent)) === "❚❚");
    await page.click(".tl-btn"); // pause
    check("pausing flips it back", (await page.$eval(".tl-btn", (e) => e.textContent)) === "▶");

    await page.$$eval(".tl-btn", (els) => (els[1] as HTMLElement).click()); // stop
    await page.waitForTimeout(250);
    check("stop rewinds to zero", (await page.$eval(".tl-readout", (e) => e.textContent ?? "")).startsWith("0.00"));

    // ---------------------------------------------------------------------
    console.log("\n=== glTF export → reference round-trip ===");
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 20_000 }),
      page.click("#exportGlbBtn"),
    ]);
    check("export offers a .glb download", download.suggestedFilename().endsWith(".glb"));
    // download.path() is an EXTENSIONLESS temp file, and reference loading is
    // gated on the .glb/.gltf suffix (isGltfFile) — save it under a real name
    // or the round-trip gets rejected for the wrong reason entirely.
    const glbPath = join(tmpdir(), `beagle-chomp-roundtrip-${process.pid}.glb`);
    await download.saveAs(glbPath);
    check("…and the file actually lands on disk", existsSync(glbPath));

    if (existsSync(glbPath)) {
      // Feed our own export back in as a reference model. A round-trip is
      // the strongest cheap check there is: it exercises the exporter, the
      // loader, and the overlay tagging in one go.
      await page.setInputFiles("#refFileInput", glbPath);
      await page.waitForTimeout(1200);
      check("the reference loads", (await page.$eval("#refLoadBtn", (e) => e.textContent)) === "Ref ✓");
      check("…and offers a clear button", await page.isVisible("#refClearBtn"));

      // The whole safety story: a reference must never become a part.
      await page.click('.code-tab[data-tab="generated"]');
      const rowsWithRef = await treeRows(page);
      check(
        "the reference does NOT appear in the part tree",
        !rowsWithRef.some((r) => r.text.startsWith("reference:")),
      );
      check("…and does not turn up in codegen", !(await generatedText(page)).includes("reference:"));

      await page.click("#refClearBtn");
      await page.waitForTimeout(200);
      check("clearing the reference resets the button", (await page.$eval("#refLoadBtn", (e) => e.textContent)) === "Ref");
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
    console.log(
      `\n${failures === 0 ? "ALL EDITOR VIEWPORT CHECKS PASSED" : `${failures} EDITOR VIEWPORT CHECK(S) FAILED`}`,
    );
    if (failures > 0) process.exit(1);
  })
  .catch((err) => {
    console.error("editor viewport test run crashed:", err);
    process.exit(1);
  });
