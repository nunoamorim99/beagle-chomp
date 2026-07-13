// Automated browser checks for the editor's "Props" workbench (IDEA-029:
// library editing — a dedicated tab to edit the reusable PROP LIBRARY
// (definitions, not placements), so a def like "Oak" or "Skyscraper" can be
// tuned once and reused across every theme that references its id). Same
// shape as scripts/test-editor-board.ts (own Vite dev server via the
// programmatic API, real headless Chromium via Playwright, "assert + log,
// exit 1 on failure") — a SEPARATE file rather than folding into that one
// because this suite exercises a materially different surface (a list of
// library defs + a live single-prop preview, instead of theme palette
// folders bound to shared board materials/lights). Wired as its own
// `npm run test:editor:props` AND folded into `npm run test:editor` (which
// now runs all three editor suites back to back) — see package.json.
//
// NOT wired into `npm run test` (see test-editor.ts's own note — that's the
// headless PURE-LOGIC suite CLAUDE.md's rule is about; this one needs a real
// browser). Requires Playwright's browser binaries to already be installed
// (`npx playwright install chromium`).
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

// --- small DOM helpers -----------------------------------------------------

/** Tree rows in current DOM order — the SAME #partTree element every editor
 *  mode's tree/list view renders into (character parts, board slots, or —
 *  here — the prop library list); one view owns it at a time (see
 *  main.ts's setMode). Reused verbatim from test-editor-board.ts's own
 *  treeRows() so all three suites read the SAME real DOM surface a person
 *  sees, whichever workbench currently owns it. */
async function treeRows(page: Page): Promise<Array<{ text: string; selected: boolean; usedBy: string | null }>> {
  return page.$$eval(".tree-row", (els) =>
    els.map((e) => ({
      text: e.querySelector(".tree-name")?.textContent ?? "",
      selected: e.className.includes("selected"),
      usedBy: e.querySelector(".tree-used-badge")?.textContent ?? null,
    })),
  );
}

/** lil-gui renders each folder as its own `.lil-gui` with a `.lil-title`
 *  header — propsInspector.ts builds a "Library" folder (add/duplicate/
 *  remove) plus one "Selected: <name>" folder for the current def. Returns
 *  -1 if the folder doesn't exist, matching test-editor-board.ts's own
 *  folderControllerCount contract. */
async function folderControllerCount(page: Page, title: string): Promise<number> {
  return page.evaluate((title) => {
    const guis = [...document.querySelectorAll("#propsGuiHost .lil-gui")];
    const folder = guis.find((f) => f.querySelector(":scope > .lil-title")?.textContent === title);
    return folder ? folder.querySelectorAll(":scope > .lil-children > .lil-controller").length : -1;
  }, title);
}

/** Every visible folder TITLE currently in #propsGuiHost, in DOM order —
 *  used to assert the "Selected: X" folder's exact title (proves selection +
 *  rename both reach the folder header) without hardcoding index-based
 *  lookups. */
async function propsFolderTitles(page: Page): Promise<string[]> {
  return page.$$eval("#propsGuiHost .lil-title", (els) => els.map((e) => e.textContent ?? ""));
}

/** Every controller's visible `.lil-name` LABEL inside a named folder, in DOM
 *  order — a more robust assertion surface than a bare count (folderControl-
 *  lerCount above): a color-LIST field's control count varies with how many
 *  colors the def happens to have, so asserting on the exact set of labels
 *  present (e.g. "height"/"width"/"foliage colors 1") is both more precise
 *  and immune to that variance. */
async function folderControlLabels(page: Page, title: string): Promise<string[]> {
  return page.evaluate((title) => {
    const guis = [...document.querySelectorAll("#propsGuiHost .lil-gui")];
    const folder = guis.find((f) => f.querySelector(":scope > .lil-title")?.textContent === title);
    if (!folder) return [];
    return [...folder.querySelectorAll(":scope > .lil-children > .lil-controller > .lil-name")].map((e) => e.textContent ?? "");
  }, title);
}

/** Reads the live hex value off a `<input type="color">` swatch inside a
 *  named Props-mode folder — same idiom as test-editor-board.ts's
 *  folderColorSwatch, scoped to #propsGuiHost. */
async function folderColorSwatch(page: Page, folderTitle: string, nth = 0): Promise<string | null> {
  return page.evaluate(
    ({ folderTitle, nth }) => {
      const guis = [...document.querySelectorAll("#propsGuiHost .lil-gui")];
      const folder = guis.find((f) => f.querySelector(":scope > .lil-title")?.textContent === folderTitle);
      const swatches = folder ? [...folder.querySelectorAll('input[type="color"]')] : [];
      const el = swatches[nth];
      return el instanceof HTMLInputElement ? el.value : null;
    },
    { folderTitle, nth },
  );
}

async function setFolderColorSwatch(page: Page, folderTitle: string, hex: string, nth = 0): Promise<void> {
  await page.evaluate(
    ({ folderTitle, hex, nth }) => {
      const guis = [...document.querySelectorAll("#propsGuiHost .lil-gui")];
      const folder = guis.find((f) => f.querySelector(":scope > .lil-title")?.textContent === folderTitle);
      const swatches = folder ? [...folder.querySelectorAll('input[type="color"]')] : [];
      const el = swatches[nth];
      if (!(el instanceof HTMLInputElement)) throw new Error(`swatch ${nth} not found in "${folderTitle}"`);
      el.value = hex;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    { folderTitle, hex, nth },
  );
}

/** Reads/writes a lil-gui number-slider's underlying `<input type="range">`
 *  (or its paired number box) inside a named folder, matched by the visible
 *  `.lil-name` label — same idiom as test-editor-board.ts's setFolderSlider. */
async function setFolderSlider(page: Page, folderTitle: string, controlLabel: string, value: number): Promise<void> {
  await page.evaluate(
    ({ folderTitle, controlLabel, value }) => {
      const guis = [...document.querySelectorAll("#propsGuiHost .lil-gui")];
      const folder = guis.find((f) => f.querySelector(":scope > .lil-title")?.textContent === folderTitle);
      if (!folder) throw new Error(`folder "${folderTitle}" not found`);
      const controllers = [...folder.querySelectorAll(":scope > .lil-children > .lil-controller")];
      const ctrl = controllers.find((c) => c.querySelector(".lil-name")?.textContent === controlLabel);
      if (!ctrl) throw new Error(`control "${controlLabel}" not found in "${folderTitle}"`);
      const range = ctrl.querySelector('input[type="range"]');
      const number = ctrl.querySelector('input[type="number"], input:not([type="range"])');
      const el = (range ?? number) as HTMLInputElement | null;
      if (!el) throw new Error(`no input widget for "${controlLabel}"`);
      el.value = String(value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    { folderTitle, controlLabel, value },
  );
}

/** Sets a text `<input>` controller's value and fires the same input+blur
 *  events a real typed edit + tabbing away would — used for the name/id
 *  fields. IMPORTANT: lil-gui's StringController (unlike its number/color/
 *  option controllers) only wires `_callOnFinishChange` to the `blur` event,
 *  not `change` (see lil-gui's own source, StringController's constructor) —
 *  propsInspector.ts's id field deliberately uses `onFinishChange` (not
 *  `onChange`) for its uniqueness gate specifically so typing doesn't
 *  collide with itself mid-edit, so this helper must dispatch `blur`, not
 *  `change`, to trigger it the way a real click-away would. */
async function setFolderText(page: Page, folderTitle: string, controlLabel: string, value: string): Promise<void> {
  await page.evaluate(
    ({ folderTitle, controlLabel, value }) => {
      const guis = [...document.querySelectorAll("#propsGuiHost .lil-gui")];
      const folder = guis.find((f) => f.querySelector(":scope > .lil-title")?.textContent === folderTitle);
      if (!folder) throw new Error(`folder "${folderTitle}" not found`);
      const controllers = [...folder.querySelectorAll(":scope > .lil-children > .lil-controller")];
      const ctrl = controllers.find((c) => c.querySelector(".lil-name")?.textContent === controlLabel);
      if (!ctrl) throw new Error(`control "${controlLabel}" not found in "${folderTitle}"`);
      const el = ctrl.querySelector("input");
      if (!(el instanceof HTMLInputElement)) throw new Error(`no <input> for "${controlLabel}"`);
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("blur", { bubbles: true }));
    },
    { folderTitle, controlLabel, value },
  );
}

/** Clicks a lil-gui BUTTON control inside a named folder, matched by its
 *  exact visible `.lil-name` label — same idiom as test-editor-board.ts's
 *  clickFolderButton. */
async function clickFolderButton(page: Page, folderTitle: string, buttonLabel: string): Promise<void> {
  await page.evaluate(
    ({ folderTitle, buttonLabel }) => {
      const guis = [...document.querySelectorAll("#propsGuiHost .lil-gui")];
      const folder = guis.find((f) => f.querySelector(":scope > .lil-title")?.textContent === folderTitle);
      if (!folder) throw new Error(`folder "${folderTitle}" not found`);
      const controllers = [...folder.querySelectorAll(":scope > .lil-children > .lil-controller")];
      const ctrl = controllers.find((c) => c.querySelector(".lil-name")?.textContent === buttonLabel);
      if (!ctrl) throw new Error(`button "${buttonLabel}" not found in "${folderTitle}"`);
      const button = ctrl.querySelector("button");
      if (!button) throw new Error(`control "${buttonLabel}" in "${folderTitle}" has no <button>`);
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    },
    { folderTitle, buttonLabel },
  );
}

async function selectShape(page: Page, folderTitle: string, shape: string): Promise<void> {
  const folder = page.locator(`#propsGuiHost .lil-gui:has(> .lil-title:text-is("${folderTitle}"))`).first();
  const select = folder.locator("select").first();
  const optionValue = await select.evaluate(
    (sel, shape) => {
      const opt = [...(sel as HTMLSelectElement).options].find((o) => o.textContent === shape);
      return opt?.value ?? null;
    },
    shape,
  );
  if (!optionValue) throw new Error(`shape option "${shape}" not found in "${folderTitle}"`);
  await select.selectOption(optionValue);
}

async function clickTreeRowByText(page: Page, text: string): Promise<void> {
  const idx = await page.evaluate(
    (text) => [...document.querySelectorAll(".tree-row")].findIndex((r) => r.querySelector(".tree-name")?.textContent === text),
    text,
  );
  if (idx === -1) throw new Error(`tree row "${text}" not found`);
  await page.evaluate((i) => (document.querySelectorAll(".tree-row")[i] as HTMLElement).click(), idx);
  await page.waitForTimeout(150);
}

/** "Copy library code" — a plain HTML button (main.ts prepends it into
 *  #propsGuiHost, NOT a lil-gui control — see main.ts's own note on why),
 *  found by its stable id rather than its flashing label text (mirrors
 *  test-editor-board.ts's data-testid rationale for the same "label
 *  flashes after click" reason). */
async function clickCopyLibraryCode(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>("#copyLibraryBtn")?.click();
  });
}

/** Reads main.ts's `window.__propsTestHook` — the one internal-state read
 *  this suite needs (the live PREVIEW mesh's child count has no DOM surface
 *  of its own), mirroring test-editor-board.ts's own boardSnapshot rationale
 *  exactly. */
async function propsSnapshot(page: Page): Promise<{ previewMeshCount: number; libraryLength: number; selectedPropId: string | null }> {
  return page.evaluate(() => {
    const h = window.__propsTestHook;
    if (!h) throw new Error("__propsTestHook missing — did main.ts's test-support hook get removed?");
    return { previewMeshCount: h.previewMeshCount(), libraryLength: h.libraryLength(), selectedPropId: h.selectedPropId() };
  });
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
    const context = await browser.newContext();
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    page.on("console", (msg) => {
      if (msg.type() === "error") pageErrors.push(msg.text());
    });

    await page.goto(base);
    await page.waitForSelector(".tree-row");
    await page.waitForTimeout(300);

    // -------------------------------------------------------------------
    console.log("\n=== Props mode opens + shows all 10 library props ===");
    {
      await page.click("#modePropsBtn");
      await page.waitForTimeout(500);

      const rows = await treeRows(page);
      check("Props tree lists exactly 10 defs (PROP_LIBRARY's starter count)", rows.length === 10);
      check(
        "Props tree shows every starter def's name",
        [
          "Shrub", "Oak Tree", "Pine", "Palm", "City Tower", "Streetlight",
          "Beach Umbrella", "Flower Bloom", "Wall Lamp", "Transit Signal",
        ].every((name) => rows.some((r) => r.text === name)),
      );

      const codePaneHidden = await page.$eval("#codePane", (el) => getComputedStyle(el).display === "none");
      check("bottom code panel is hidden in Props mode (no per-mesh codegen)", codePaneHidden);

      const propsGuiVisible = await page.$eval("#propsGuiHost", (el) => !(el as HTMLElement).hidden);
      check("#propsGuiHost is visible in Props mode", propsGuiVisible);
      const boardGuiHidden = await page.$eval("#boardGuiHost", (el) => (el as HTMLElement).hidden);
      check("#boardGuiHost is hidden in Props mode", boardGuiHidden);
      const charGuiHidden = await page.$eval("#charGuiHost", (el) => (el as HTMLElement).hidden);
      check("#charGuiHost is hidden in Props mode", charGuiHidden);

      check("Props mode shows the 'Library' folder", (await propsFolderTitles(page)).includes("Library"));
      check(
        "Library folder offers add/duplicate/remove (3 controls)",
        (await folderControllerCount(page, "Library")) === 3,
      );
    }

    // -------------------------------------------------------------------
    console.log("\n=== selecting a prop renders a live preview ===");
    {
      await clickTreeRowByText(page, "Shrub");
      await page.waitForTimeout(200);
      const rows = await treeRows(page);
      check("clicking 'Shrub' selects its tree row", rows.find((r) => r.text === "Shrub")?.selected === true);

      const snap = await propsSnapshot(page);
      check("selecting Shrub sets selectedPropId to 'shrub'", snap.selectedPropId === "shrub");
      check("selecting Shrub builds a non-empty live preview (stage child count > 0)", snap.previewMeshCount > 0);

      const titles = await propsFolderTitles(page);
      check(`inspector shows "Selected: Shrub"`, titles.includes("Selected: Shrub"));

      // Shrub's PROP_SHAPE_FIELDS are [height, width, segments, foliageColors]
      // (see src/game/props.ts) + name/id/shape, in exactly that order —
      // asserting on the labels (not a bare count) is immune to the
      // foliageColors list's own length varying, and to whether the "used
      // by" note is present (shrub IS placed by real themes, so it will be —
      // see the next section).
      const labels = await folderControlLabels(page, "Selected: Shrub");
      check(
        "Selected-def folder shows name/id/shape then Shrub's own fields in PROP_SHAPE_FIELDS order",
        labels[0] === "name" &&
          labels[1] === "id" &&
          labels[2] === "shape" &&
          labels.includes("height") &&
          labels.includes("width") &&
          labels.includes("segments") &&
          labels.includes("foliage colors 1"),
      );
      check(
        "Selected-def folder shows NO building-only fields on a shrub (window rows/rooftop absent)",
        !labels.includes("window rows") && !labels.includes("rooftop"),
      );
    }

    // -------------------------------------------------------------------
    console.log("\n=== used-by note + tree badge reflect real theme placements ===");
    {
      // "shrub" is referenced by garden/park's placements AND is the fallback
      // def id (props.ts's DEFAULT_PROP_ID) — either way it's used by real
      // MAZE_THEMES placements, so both the tree badge and the inspector's
      // "used by" note should show a positive count.
      const rows = await treeRows(page);
      const shrubRow = rows.find((r) => r.text === "Shrub");
      check("Shrub's tree row shows a 'used by N' badge", shrubRow?.usedBy !== null && Number(shrubRow?.usedBy) > 0);

      const usedByNoteVisible = await page.evaluate(() => {
        const note = document.querySelector("#propsGuiHost .props-used-by-note .lil-name");
        return note?.textContent ?? null;
      });
      check(
        "inspector shows a 'used by N placements' note for Shrub",
        usedByNoteVisible !== null && /^used by \d+ placements?/.test(usedByNoteVisible),
      );
    }

    // -------------------------------------------------------------------
    console.log("\n=== editing a param rebuilds the live preview ===");
    {
      const before = await propsSnapshot(page);
      // Shrub's segments field is the lobe COUNT (clamped 2-3 by makeShrub) —
      // changing it should change the mesh child count (fewer/more lobes).
      await setFolderSlider(page, "Selected: Shrub", "segments", 2);
      await page.waitForTimeout(200);
      const after2 = await propsSnapshot(page);
      await setFolderSlider(page, "Selected: Shrub", "segments", 3);
      await page.waitForTimeout(200);
      const after3 = await propsSnapshot(page);
      check(
        "segments 2 vs 3 changes the preview's mesh count (2-lobe vs 3-lobe shrub)",
        after2.previewMeshCount !== after3.previewMeshCount,
      );
      check("walls/other state untouched — this is a props-only assertion", before.libraryLength === after3.libraryLength);

      // A foliage color edit doesn't change mesh COUNT but should still not
      // error and should leave a live preview standing.
      await setFolderColorSwatch(page, "Selected: Shrub", "#ff00aa", 0);
      await page.waitForTimeout(200);
      const afterColor = await propsSnapshot(page);
      check("editing a foliage color still leaves a live preview", afterColor.previewMeshCount > 0);
      const swatch = await folderColorSwatch(page, "Selected: Shrub", 0);
      check("foliage color 1 swatch reflects the edit", swatch === "#ff00aa");
    }

    // -------------------------------------------------------------------
    console.log("\n=== a building's params (windowRows) rebuild the preview ===");
    {
      await clickTreeRowByText(page, "City Tower");
      await page.waitForTimeout(200);
      const snap = await propsSnapshot(page);
      check("selecting City Tower sets selectedPropId to 'tower'", snap.selectedPropId === "tower");
      check("City Tower has a non-empty preview (rooftop/facade/windows)", snap.previewMeshCount > 0);

      const before = await propsSnapshot(page);
      await setFolderSlider(page, "Selected: City Tower", "window rows", 0);
      await page.waitForTimeout(200);
      const noWindows = await propsSnapshot(page);
      check(
        "windowRows -> 0 removes the window meshes (fewer children than before)",
        noWindows.previewMeshCount < before.previewMeshCount,
      );

      await setFolderSlider(page, "Selected: City Tower", "window rows", 2);
      await page.waitForTimeout(200);
      const withWindows = await propsSnapshot(page);
      check("windowRows back to 2 restores the window meshes", withWindows.previewMeshCount > noWindows.previewMeshCount);
    }

    // -------------------------------------------------------------------
    console.log("\n=== shape swap changes the visible controls ===");
    {
      await clickTreeRowByText(page, "Streetlight");
      await page.waitForTimeout(200);
      // Streetlight's PROP_SHAPE_FIELDS are [height, trunkColor, glowColor,
      // glowIntensity] (see src/game/props.ts) — none of umbrella's OWN
      // fields (width/tilt/foliageColors) should be visible yet.
      const beforeLabels = await folderControlLabels(page, "Selected: Streetlight");
      check(
        "Streetlight's def folder shows exactly its own field set",
        beforeLabels.includes("height") &&
          beforeLabels.includes("trunk color") &&
          beforeLabels.includes("glow color") &&
          beforeLabels.includes("glow intensity") &&
          !beforeLabels.includes("width") &&
          !beforeLabels.includes("tilt"),
      );

      await selectShape(page, "Selected: Streetlight", "umbrella");
      await page.waitForTimeout(250);
      const titlesAfterSwap = await propsFolderTitles(page);
      check(
        "swapping shape to 'umbrella' keeps the SAME def selected (still 'Selected: Streetlight' by name)",
        titlesAfterSwap.includes("Selected: Streetlight"),
      );
      // umbrella's PROP_SHAPE_FIELDS are [height, width, tilt, foliageColors,
      // trunkColor] — width/tilt/foliage colors should now be visible;
      // streetlight-only fields (glow color/intensity) should be gone.
      const afterSwapLabels = await folderControlLabels(page, "Selected: Streetlight");
      check(
        "shape swap to umbrella shows umbrella's own fields and drops streetlight-only ones",
        afterSwapLabels.includes("width") &&
          afterSwapLabels.includes("tilt") &&
          afterSwapLabels.includes("foliage colors 1") &&
          !afterSwapLabels.includes("glow color") &&
          !afterSwapLabels.includes("glow intensity"),
      );
      const snap = await propsSnapshot(page);
      check("shape swap still rebuilds a live preview (umbrella shape renders fine)", snap.previewMeshCount > 0);

      // Swap back so later id-uniqueness assertions aren't confused by a
      // renamed/reshaped "streetlight" lingering with the wrong shape.
      await selectShape(page, "Selected: Streetlight", "streetlight");
      await page.waitForTimeout(200);
    }

    // -------------------------------------------------------------------
    console.log("\n=== add / duplicate / remove work ===");
    {
      const before = await propsSnapshot(page);
      check("library starts at 10 defs", before.libraryLength === 10);

      await clickFolderButton(page, "Library", "add prop ✚");
      await page.waitForTimeout(250);
      const afterAdd = await propsSnapshot(page);
      check("'add prop ✚' grows the library by 1", afterAdd.libraryLength === before.libraryLength + 1);
      check("the newly-added prop is auto-selected", afterAdd.selectedPropId !== null && afterAdd.selectedPropId.startsWith("prop-"));
      check("the newly-added prop renders a live preview (default shrub)", afterAdd.previewMeshCount > 0);

      const rowsAfterAdd = await treeRows(page);
      check("tree list grows by 1 row too (now 11)", rowsAfterAdd.length === 11);
      check("new prop's default name is 'New Prop'", rowsAfterAdd.some((r) => r.text === "New Prop"));

      // Duplicate the just-added prop.
      await clickFolderButton(page, "Library", "duplicate 📄");
      await page.waitForTimeout(250);
      const afterDup = await propsSnapshot(page);
      check("'duplicate 📄' grows the library by 1 more (now 12)", afterDup.libraryLength === before.libraryLength + 2);
      check(
        "duplicate gets a DIFFERENT id than the source",
        afterDup.selectedPropId !== null && afterDup.selectedPropId !== afterAdd.selectedPropId,
      );
      const dupTitles = await propsFolderTitles(page);
      check(`duplicate is named "New Prop Copy" and auto-selected`, dupTitles.includes("Selected: New Prop Copy"));

      // Remove the duplicate, then the original add — back to 10.
      await clickFolderButton(page, "Library", "remove 🗑");
      await page.waitForTimeout(250);
      const afterRemoveDup = await propsSnapshot(page);
      check("removing the duplicate shrinks the library back to 11", afterRemoveDup.libraryLength === before.libraryLength + 1);

      await clickFolderButton(page, "Library", "remove 🗑");
      await page.waitForTimeout(250);
      const afterRemoveAdd = await propsSnapshot(page);
      check("removing the original add shrinks the library back to the starting 10", afterRemoveAdd.libraryLength === before.libraryLength);

      const rowsAfterCleanup = await treeRows(page);
      check("tree list is back to 10 rows", rowsAfterCleanup.length === 10);
      check("'New Prop' is gone from the list", !rowsAfterCleanup.some((r) => r.text === "New Prop"));
    }

    // -------------------------------------------------------------------
    console.log("\n=== remove is guarded against emptying the library ===");
    {
      // Drive the library down to exactly 1 def by removing 9 of the 10
      // (whichever the current selection walks to — the removal picks the
      // next available def each time, so a fixed loop count reaches 1
      // remaining regardless of order).
      for (let i = 0; i < 9; i++) {
        await clickFolderButton(page, "Library", "remove 🗑");
        await page.waitForTimeout(150);
      }
      const downToOne = await propsSnapshot(page);
      check("removed down to exactly 1 def", downToOne.libraryLength === 1);

      await clickFolderButton(page, "Library", "remove 🗑");
      await page.waitForTimeout(200);
      const stillOne = await propsSnapshot(page);
      check("removing the LAST def is refused — library stays at 1", stillOne.libraryLength === 1);
      check("the last def is still selected/rendered after the refused remove", stillOne.previewMeshCount > 0);

      // Reload the page to restore the full starter library for the
      // remaining sections (Props mode's working copy is deep-cloned fresh
      // once per page load — see main.ts's enterPropsMode/libraryLoaded — a
      // reload is the simplest, most honest "start over" for this suite,
      // exactly mirroring how board mode's own tests re-select a known base
      // theme rather than trying to reconstruct removed state by hand).
      await page.goto(base);
      await page.waitForSelector(".tree-row");
      await page.waitForTimeout(300);
      await page.click("#modePropsBtn");
      await page.waitForTimeout(500);
      const reloaded = await propsSnapshot(page);
      check("reload restores the full 10-def starter library", reloaded.libraryLength === 10);
    }

    // -------------------------------------------------------------------
    console.log("\n=== id uniqueness: editing an id to a taken one is uniquified ===");
    {
      await clickTreeRowByText(page, "Oak Tree");
      await page.waitForTimeout(200);
      await setFolderText(page, "Selected: Oak Tree", "id", "shrub"); // "shrub" is already taken
      await page.waitForTimeout(250);

      const idValue = await page.evaluate(() => {
        const guis = [...document.querySelectorAll("#propsGuiHost .lil-gui")];
        const folder = guis.find((f) => f.querySelector(":scope > .lil-title")?.textContent === "Selected: Oak Tree");
        const controllers = folder ? [...folder.querySelectorAll(":scope > .lil-children > .lil-controller")] : [];
        const idCtrl = controllers.find((c) => c.querySelector(".lil-name")?.textContent === "id");
        const input = idCtrl?.querySelector("input");
        return input instanceof HTMLInputElement ? input.value : null;
      });
      check(`renaming "oak" -> "shrub" (taken) is uniquified to "shrub-2"`, idValue === "shrub-2");

      const rows = await treeRows(page);
      check("tree still shows exactly one 'Oak Tree' row (no duplicate id broke the list)", rows.filter((r) => r.text === "Oak Tree").length === 1);
    }

    // -------------------------------------------------------------------
    console.log('\n=== "Copy library code" emits a parseable PROP_LIBRARY ===');
    {
      // Fresh, identifying edit on a simple def (bloom — few params, easy to
      // regex-match) before copying.
      await clickTreeRowByText(page, "Flower Bloom");
      await page.waitForTimeout(200);
      await setFolderColorSwatch(page, "Selected: Flower Bloom", "#123456", 0);
      await page.waitForTimeout(150);
      await setFolderSlider(page, "Selected: Flower Bloom", "glow intensity", 0.6);
      await page.waitForTimeout(150);

      await clickCopyLibraryCode(page);
      await page.waitForTimeout(300);
      const clip = await page.evaluate(() => navigator.clipboard.readText());

      check("emitted code starts with the PROP_LIBRARY export declaration", clip.trim().startsWith("export const PROP_LIBRARY: readonly PropDef[] = ["));
      check("emitted code ends with the 'as const;' closer", clip.trim().endsWith("] as const;"));
      check("emitted code contains the edited bloom glow color", clip.includes("glowColor: 0x123456,"));
      check("emitted code contains the edited bloom glow intensity", clip.includes("glowIntensity: 0.6,"));
      // "oak" was renamed to "shrub-2" earlier in THIS session (the id-
      // uniqueness section above) — workingLibrary is a session-lifetime
      // deep copy (see main.ts's enterPropsMode/libraryLoaded), never
      // re-cloned between sections, so that rename is still in effect here.
      // Asserting against the library's actual current id set (not the
      // pristine registry's) is correct: it also doubles as proof the rename
      // itself persists all the way through to codegen.
      check(
        "emitted code still contains every other def's (current) id",
        ["shrub", "shrub-2", "pine", "palm", "tower", "streetlight", "umbrella", "bloom", "lamp-post", "transit-sign"].every((id) =>
          clip.includes(`id: ${JSON.stringify(id)},`),
        ),
      );

      // Round-trip: extract the array body and eval it as a real array
      // literal — the strongest available proof that pasting the emitted
      // code (minus the `export const .. =` / `as const;` wrapper a real
      // paste keeps, but eval can't use directly) compiles and reproduces
      // the edited value, mirroring test-editor-board.ts's own `new
      // Function` round-trip.
      const arrayBody = clip
        .replace(/^export const PROP_LIBRARY: readonly PropDef\[\] = /, "")
        .replace(/\s*as const;\s*$/, "");
      const parsed = new Function(`return (${arrayBody});`)() as Array<{
        id: string;
        name: string;
        shape: string;
        params: Record<string, unknown>;
      }>;
      check("emitted array parses as valid JS", Array.isArray(parsed));
      check("parsed array has exactly 10 entries", parsed.length === 10);
      const parsedBloom = parsed.find((p) => p.id === "bloom");
      check("parsed 'bloom' entry exists", parsedBloom !== undefined);
      check("parsed bloom keeps the edited glowColor (0x123456)", parsedBloom?.params.glowColor === 0x123456);
      check("parsed bloom keeps the edited glowIntensity (0.6)", parsedBloom?.params.glowIntensity === 0.6);
      check("parsed bloom's shape is 'bloom'", parsedBloom?.shape === "bloom");

      const flashed = await page.evaluate(() => document.querySelector("#copyLibraryBtn")?.textContent ?? null);
      check("copy button flashes a success label", flashed?.includes("Copied") === true);
    }

    // -------------------------------------------------------------------
    console.log("\n=== switching to another mode and back is clean ===");
    {
      await page.click("#modeCharacterBtn");
      await page.waitForTimeout(400);
      let snap = await page.evaluate(() => window.__boardTestHook?.mode() ?? null);
      check("switching to Character mode flips mode()", snap === "character");
      const charRows = await treeRows(page);
      check("character tree is back (root + several parts)", charRows.length > 5);

      await page.click("#modeBoardBtn");
      await page.waitForTimeout(500);
      snap = await page.evaluate(() => window.__boardTestHook?.mode() ?? null);
      check("switching to Board mode flips mode()", snap === "board");

      await page.click("#modePropsBtn");
      await page.waitForTimeout(500);
      snap = await page.evaluate(() => window.__boardTestHook?.mode() ?? null);
      check("switching BACK to Props mode flips mode() again", snap === "props");

      const rows = await treeRows(page);
      check("Props tree is restored with all 10 (edited-in-session) defs", rows.length === 10);
      const propsSnap = await propsSnapshot(page);
      check("a def is still selected after the round trip", propsSnap.selectedPropId !== null);
      check("preview still renders after the round trip", propsSnap.previewMeshCount > 0);

      const propsGuiVisible = await page.$eval("#propsGuiHost", (el) => !(el as HTMLElement).hidden);
      check("#propsGuiHost is visible again after the round trip", propsGuiVisible);
      const codePaneHidden = await page.$eval("#codePane", (el) => getComputedStyle(el).display === "none");
      check("code panel is hidden again in Props mode after the round trip", codePaneHidden);

      // Session-persistence check: the bloom edit from the copy-code section
      // above should have survived the whole mode round trip (workingLibrary
      // is a session-lifetime deep copy, never re-cloned on re-entry).
      await clickTreeRowByText(page, "Flower Bloom");
      await page.waitForTimeout(200);
      const bloomSwatch = await folderColorSwatch(page, "Selected: Flower Bloom", 0);
      check("Flower Bloom's edited color survived the mode round trip", bloomSwatch === "#123456");
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
    console.log(`\n${failures === 0 ? "ALL PROPS EDITOR CHECKS PASSED" : `${failures} PROPS EDITOR CHECK(S) FAILED`}`);
    if (failures > 0) process.exit(1);
  })
  .catch((err) => {
    console.error("props editor test run crashed:", err);
    process.exit(1);
  });
