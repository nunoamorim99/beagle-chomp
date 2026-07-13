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
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

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

/** Tree rows in current DOM order, SCOPED to #partTree specifically (not a
 *  bare ".tree-row" document-wide query) — the SAME #partTree element every
 *  editor mode's PRIMARY tree/list view renders into (character parts,
 *  board slots, or — here — the prop library list); one view owns it at a
 *  time (see main.ts's setMode). Was a document-wide ".tree-row" query
 *  before IDEA-033 (matching test-editor-board.ts's own treeRows()
 *  verbatim), which worked fine when #partTree was the ONLY tree on screen —
 *  IDEA-033 adds a SECOND tree (#propsPartTree, the selected prop's own
 *  component list — see componentTreeRows below), which reuses the exact
 *  same ".tree-row"/".tree-name"/".selected" CSS classes for visual
 *  consistency, so a document-wide query now double-counts: scoping to
 *  `#partTree .tree-row` restores "exactly the prop library list" as this
 *  helper's contract. */
async function treeRows(page: Page): Promise<Array<{ text: string; selected: boolean; usedBy: string | null }>> {
  return page.$$eval("#partTree .tree-row", (els) =>
    els.map((e) => ({
      text: e.querySelector(".tree-name")?.textContent ?? "",
      selected: e.className.includes("selected"),
      usedBy: e.querySelector(".tree-used-badge")?.textContent ?? null,
    })),
  );
}

/** IDEA-033: rows in the SEPARATE "Components" tree (#propsPartTree) — the
 *  selected prop's own base parts + any editor-added primitives, built by
 *  partTree.ts's buildPartList exactly like the character workbench's own
 *  #partTree rows (see test-editor.ts's treeRows, which this mirrors: same
 *  ".tree-name"/".is-mesh"/".is-added"/".selected" classes, since
 *  propsPartInspector.ts and main.ts's refreshPropParts reuse
 *  partTree.ts/createPartTreeView UNCHANGED — the same generic module the
 *  character tree uses, just pointed at a prop's own group instead of a
 *  character's). */
async function componentTreeRows(
  page: Page,
): Promise<Array<{ text: string; isMesh: boolean; isAdded: boolean; selected: boolean }>> {
  return page.$$eval("#propsPartTree .tree-row", (els) =>
    els.map((e) => ({
      text: e.querySelector(".tree-name")?.textContent ?? "",
      isMesh: e.className.includes("is-mesh"),
      isAdded: e.className.includes("is-added"),
      selected: e.className.includes("selected"),
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
 *  exactly. IDEA-033: extended with the part-editing fields — see
 *  __propsTestHook's own doc comment in main.ts for why each one earns its
 *  keep over a pure DOM read. */
async function propsSnapshot(page: Page): Promise<{
  previewMeshCount: number;
  libraryLength: number;
  selectedPropId: string | null;
  selectedPartPath: string | null;
  componentCount: number;
  selectedDefHasParts: boolean;
  livePartEditCount: number;
}> {
  return page.evaluate(() => {
    const h = window.__propsTestHook;
    if (!h) throw new Error("__propsTestHook missing — did main.ts's test-support hook get removed?");
    return {
      previewMeshCount: h.previewMeshCount(),
      libraryLength: h.libraryLength(),
      selectedPropId: h.selectedPropId(),
      selectedPartPath: h.selectedPartPath(),
      componentCount: h.componentCount(),
      selectedDefHasParts: h.selectedDefHasParts(),
      livePartEditCount: h.livePartEditCount(),
    };
  });
}

// --- IDEA-033: part-editing DOM helpers ------------------------------------
// The per-part folder (propsPartInspector.ts's "Part: <name>") and the
// persistent "Add part" folder both live in the SAME #propsGuiHost lil-gui
// host propsInspector.ts's own folders do — these helpers are the
// setFolderSlider/setFolderColorSwatch/clickFolderButton family above,
// applied to those NEW folder titles, not new idioms.

/** Clicks a row in the SEPARATE Components tree (#propsPartTree), matched by
 *  its exact visible name — the part-editing analogue of clickTreeRowByText
 *  above, scoped to the new tree so it can never accidentally click a
 *  PROP-LIBRARY row of the same text (e.g. selecting the "trunk" component
 *  vs. a hypothetical library def named "trunk"). */
async function clickComponentRowByText(page: Page, text: string): Promise<void> {
  const idx = await page.evaluate(
    (text) => [...document.querySelectorAll("#propsPartTree .tree-row")].findIndex(
      (r) => r.querySelector(".tree-name")?.textContent === text,
    ),
    text,
  );
  if (idx === -1) throw new Error(`component row "${text}" not found`);
  await page.evaluate(
    (i) => (document.querySelectorAll("#propsPartTree .tree-row")[i] as HTMLElement).click(),
    idx,
  );
  await page.waitForTimeout(150);
}

/** Sets one axis of the selected part's position/rotation/scale — the
 *  "Part: <name>" folder nests position/rotation/scale as their OWN
 *  sub-folders (propsPartInspector.ts mirrors inspector.ts's exact
 *  buildSelectionFolder shape: `folder.addFolder("position")` etc., each
 *  with x/y/z controllers labeled by their bare axis letter) — so this
 *  drills one level deeper than setFolderSlider's flat folder->control
 *  lookup, matching that nesting. */
async function setPartTransformAxis(
  page: Page,
  partFolderTitle: string,
  channel: "position" | "rotation" | "scale",
  axis: "x" | "y" | "z",
  value: number,
): Promise<void> {
  await page.evaluate(
    ({ partFolderTitle, channel, axis, value }) => {
      const guis = [...document.querySelectorAll("#propsGuiHost .lil-gui")];
      const partFolder = guis.find((f) => f.querySelector(":scope > .lil-title")?.textContent === partFolderTitle);
      if (!partFolder) throw new Error(`part folder "${partFolderTitle}" not found`);
      const subFolders = [...partFolder.querySelectorAll(":scope .lil-gui")];
      const channelFolder = subFolders.find((f) => f.querySelector(":scope > .lil-title")?.textContent === channel);
      if (!channelFolder) throw new Error(`"${channel}" sub-folder not found in "${partFolderTitle}"`);
      const controllers = [...channelFolder.querySelectorAll(":scope > .lil-children > .lil-controller")];
      const ctrl = controllers.find((c) => c.querySelector(".lil-name")?.textContent === axis);
      if (!ctrl) throw new Error(`axis "${axis}" not found in "${channel}"`);
      // Same range-or-plain-input fallback as setFolderSlider above — this
      // lil-gui version renders a number controller's editable field as a
      // plain `<input type="text">` alongside a separate `.lil-slider` fill
      // bar (NOT a real `<input type="range">`), so `input[type="range"]`
      // alone never matches; `input:not([type="range"])` picks up that text
      // input in either case.
      const range = ctrl.querySelector('input[type="range"]');
      const number = ctrl.querySelector('input[type="number"], input:not([type="range"])');
      const el = (range ?? number) as HTMLInputElement | null;
      if (!el) throw new Error(`no input widget for axis "${axis}"`);
      el.value = String(value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    { partFolderTitle, channel, axis, value },
  );
}

/** Same idiom as setFolderText, scoped to the "Add part" folder's `name`
 *  text field (propsPartInspector.ts's persistent folder — see its own
 *  header). Sets the field then reads it back is unnecessary here since
 *  addPropPart's own sanitizer only matters at CLICK time, not at typing
 *  time — this just types the value. */
async function setAddPartName(page: Page, value: string): Promise<void> {
  await page.evaluate((value) => {
    const guis = [...document.querySelectorAll("#propsGuiHost .lil-gui")];
    const folder = guis.find((f) => f.querySelector(":scope > .lil-title")?.textContent === "Add part");
    if (!folder) throw new Error(`"Add part" folder not found`);
    const controllers = [...folder.querySelectorAll(":scope > .lil-children > .lil-controller")];
    const ctrl = controllers.find((c) => c.querySelector(".lil-name")?.textContent === "name");
    const input = ctrl?.querySelector("input");
    if (!(input instanceof HTMLInputElement)) throw new Error(`"name" field not found in "Add part"`);
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

async function selectAddPartKind(page: Page, kind: string): Promise<void> {
  const folder = page.locator(`#propsGuiHost .lil-gui:has(> .lil-title:text-is("Add part"))`).first();
  const select = folder.locator("select").first();
  await select.selectOption(kind);
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

    // =====================================================================
    // IDEA-033 "Props as editable part-assemblies" — selecting a component,
    // editing its transform/material, adding/deleting a primitive, undo, and
    // both export surfaces (Copy library code / Save to props.ts) emitting
    // the new `parts` field. Uses "Palm" (untouched by every earlier
    // section above) so these assertions can't collide with the bloom/oak/
    // shrub edits already made in this session.
    // -------------------------------------------------------------------
    console.log("\n=== selecting a prop shows its Components tree + picking a component ===");
    {
      await clickTreeRowByText(page, "Palm");
      await page.waitForTimeout(200);
      const snap = await propsSnapshot(page);
      check("selecting Palm sets selectedPropId to 'palm'", snap.selectedPropId === "palm");
      check("Palm has no part edits yet (fresh def)", snap.selectedDefHasParts === false);

      // Palm's base parts (board.ts's makePalm): root + trunkLower +
      // trunkUpper + frond0..N (4-5) + coconut0-1 — componentCount is root-
      // inclusive, so > 5 proves the Components tree actually reflects
      // Palm's real child count, not a stale/empty list.
      check("Components tree has Palm's base parts (root + trunk + fronds + coconuts)", snap.componentCount > 5);

      const compRows = await componentTreeRows(page);
      check("Components tree shows 'trunkLower' (board.ts's own part name)", compRows.some((r) => r.text === "trunkLower"));
      check("Components tree shows 'trunkUpper'", compRows.some((r) => r.text === "trunkUpper"));
      check("Components tree shows at least one 'frond0'", compRows.some((r) => r.text === "frond0"));
      check("Components tree root shows 'Palm (g)' (rootLabel wired to the def's own name)", compRows.some((r) => r.text === "Palm (g)"));

      await clickComponentRowByText(page, "trunkLower");
      await page.waitForTimeout(200);
      const afterPick = await propsSnapshot(page);
      check("clicking 'trunkLower' selects it (selectedPartPath === '0')", afterPick.selectedPartPath === "0");

      const titles = await propsFolderTitles(page);
      check(`inspector shows "Part: trunkLower"`, titles.includes("Part: trunkLower"));
      check(`base-shape folder "Selected: Palm" is STILL present alongside it`, titles.includes("Selected: Palm"));

      const labels = await folderControlLabels(page, "Part: trunkLower");
      check(
        "Part folder shows visible + material — the transform sub-folders are their OWN folders, not flat labels here",
        labels.includes("visible (unchecked = delete this base part)"),
      );
    }

    // -------------------------------------------------------------------
    console.log("\n=== editing a selected part's transform + material ===");
    {
      // trunkLower is still selected from the previous section.
      await setPartTransformAxis(page, "Part: trunkLower", "position", "y", 0.4);
      await page.waitForTimeout(200);
      const afterMove = await propsSnapshot(page);
      // livePartEditCount (NOT selectedDefHasParts) is the right signal here
      // — the move hasn't been FLUSHED onto workingLibrary's palm entry yet
      // (that only happens on a mode switch / copy / save — see
      // syncPartsIntoWorkingDef's own doc comment), but propPartLog itself
      // already carries the pending delta the instant the slider fires.
      check("moving trunkLower is tracked live (unflushed) in propPartLog", afterMove.livePartEditCount > 0);

      await setFolderColorSwatch(page, "Part: trunkLower", "#ff8800", 0);
      await page.waitForTimeout(200);

      // "Copy library code" flushes (see copyLibraryBtn's own click handler)
      // before formatting, so selectedDefHasParts becomes true immediately
      // after this click — asserted alongside the clipboard content below.
      await clickCopyLibraryCode(page);
      await page.waitForTimeout(300);
      const afterFlush = await propsSnapshot(page);
      check("after the flush, selectedDefHasParts reads true from workingLibrary itself", afterFlush.selectedDefHasParts === true);
      const clip = await page.evaluate(() => navigator.clipboard.readText());
      check(`emitted code contains "palm"'s new parts.edits array`, /id: "palm",[\s\S]{0,400}parts: \{/.test(clip));
      check("emitted parts.edits targets path '0' (trunkLower's tree path)", clip.includes(`path: "0"`));
      check("emitted parts.edits carries the moved Y position (0.4)", /position: \[0, 0\.4, 0\]/.test(clip));
      check("emitted parts.edits carries the recolored trunk (0xff8800)", clip.includes("color: 0xff8800"));

      // Round-trip the palm entry specifically through a real eval, same
      // strength of proof as the earlier bloom round-trip section.
      const arrayBody = clip
        .replace(/^export const PROP_LIBRARY: readonly PropDef\[\] = /, "")
        .replace(/\s*as const;\s*$/, "");
      const parsed = new Function(`return (${arrayBody});`)() as Array<{
        id: string;
        parts?: { edits: Array<{ path: string; position?: number[]; color?: number }>; added: unknown[] };
      }>;
      const parsedPalm = parsed.find((p) => p.id === "palm");
      check("parsed 'palm' entry has a parts.edits array", Array.isArray(parsedPalm?.parts?.edits));
      const trunkEdit = parsedPalm?.parts?.edits.find((e) => e.path === "0");
      check("parsed palm's path-'0' edit carries the moved position", trunkEdit?.position?.[1] === 0.4);
      check("parsed palm's path-'0' edit carries the recolor", trunkEdit?.color === 0xff8800);
    }

    // -------------------------------------------------------------------
    console.log("\n=== add part: bolts a new primitive onto the selected component ===");
    {
      const before = await propsSnapshot(page);
      await selectAddPartKind(page, "sphere");
      await setAddPartName(page, "coconutExtra");
      await clickFolderButton(page, "Add part", "add to selected part ➕");
      await page.waitForTimeout(250);

      const afterAdd = await propsSnapshot(page);
      // componentCount (buildPartList's own recursive DFS walk) is the
      // depth-agnostic signal here — previewMeshCount is a SHALLOW
      // top-level-children-only count (see main.ts's own doc comment on
      // it), and this add attaches under "trunkLower" (still selected from
      // the previous section), one level BELOW the preview root, so the
      // root's own direct child count never changes even though a real
      // mesh was added deeper in the tree. componentCount catches that;
      // previewMeshCount would only move for an add targeting the ROOT
      // itself (see propPartSelectionContext's "no selection -> root"
      // fallback in main.ts's addPropPart).
      check("adding a part grows the Components tree by 1", afterAdd.componentCount === before.componentCount + 1);
      check("the newly-added part is auto-selected", afterAdd.selectedPartPath !== null && afterAdd.selectedPartPath !== before.selectedPartPath);

      const compRows = await componentTreeRows(page);
      const addedRow = compRows.find((r) => r.text === "coconutExtra");
      check("Components tree shows the new 'coconutExtra' row", addedRow !== undefined);
      check("the new row is flagged is-added (green, per editor.css's .is-added rule)", addedRow?.isAdded === true);
      check("the new row is flagged is-mesh (it's a real Mesh, not a Group)", addedRow?.isMesh === true);

      const titles = await propsFolderTitles(page);
      check(`inspector shows "Part: coconutExtra"`, titles.includes("Part: coconutExtra"));
      // Added parts get a live "geometry" sub-folder (radius etc.) — a base
      // part (trunkLower, tested above) never has one.
      const addedLabels = await folderControlLabels(page, "Part: coconutExtra");
      check(
        "added part's folder has NO 'visible (delete)' checkbox — added parts are TRULY removed instead (see deletePropPartNode)",
        !addedLabels.includes("visible (unchecked = delete this base part)"),
      );
    }

    // -------------------------------------------------------------------
    console.log("\n=== delete an ADDED part, then undo restores it ===");
    {
      const before = await propsSnapshot(page);
      // coconutExtra is still selected from the previous section.
      await clickFolderButton(page, "Part: coconutExtra", "delete part 🗑");
      await page.waitForTimeout(200);
      const afterDelete = await propsSnapshot(page);
      // componentCount only — see the "add part" section's own note on why
      // previewMeshCount (root's shallow child count) doesn't move for an
      // edit nested under "trunkLower".
      check("deleting the added part shrinks the Components tree by 1", afterDelete.componentCount === before.componentCount - 1);
      let compRows = await componentTreeRows(page);
      check("'coconutExtra' is gone from the Components tree", !compRows.some((r) => r.text === "coconutExtra"));

      // Ctrl+Z — propHistory's own undo stack (independent of character
      // mode's `history`), scoped by main.ts's own `mode !== "props"` guard.
      await page.keyboard.press("Control+z");
      await page.waitForTimeout(250);
      const afterUndo = await propsSnapshot(page);
      check("Ctrl+Z restores the deleted added part (Components tree count)", afterUndo.componentCount === before.componentCount);
      compRows = await componentTreeRows(page);
      check("'coconutExtra' is back in the Components tree after undo", compRows.some((r) => r.text === "coconutExtra"));

      // Clean up: redo isn't needed, but re-delete it via Ctrl+Z's redo
      // pair so later sections' component/mesh counts stay predictable —
      // actually simplest is a fresh delete + NO undo this time, since the
      // earlier "add part" section's whole point was proven already.
      await clickFolderButton(page, "Part: coconutExtra", "delete part 🗑");
      await page.waitForTimeout(200);
    }

    // -------------------------------------------------------------------
    console.log("\n=== delete a BASE part hides it (visible=false), undo un-hides it ===");
    {
      await clickComponentRowByText(page, "trunkLower");
      await page.waitForTimeout(200);
      const before = await propsSnapshot(page);
      check("trunkLower re-selected", before.selectedPartPath === "0");

      await clickFolderButton(page, "Part: trunkLower", "delete part 🗑");
      await page.waitForTimeout(200);
      // A BASE part's "delete" is hide+omit, NOT structural removal — the
      // Components tree/mesh COUNT must stay the SAME (the object is still
      // in the scene graph, just .visible = false); this is the key
      // difference from the added-part delete tested above.
      const afterHide = await propsSnapshot(page);
      check("hiding a base part does NOT shrink the Components tree (still present, just hidden)", afterHide.componentCount === before.componentCount);

      await clickCopyLibraryCode(page);
      await page.waitForTimeout(300);
      const clipHidden = await page.evaluate(() => navigator.clipboard.readText());
      check("emitted parts.edits records visible: false for the hidden trunkLower", /path: "0"[\s\S]{0,200}visible: false/.test(clipHidden));

      await page.keyboard.press("Control+z");
      await page.waitForTimeout(250);
      await clickCopyLibraryCode(page);
      await page.waitForTimeout(300);
      const clipRestored = await page.evaluate(() => navigator.clipboard.readText());
      check(
        "undo removes the visible:false edit (trunkLower's edit record either drops the field or disappears)",
        !/path: "0"[\s\S]{0,200}visible: false/.test(clipRestored),
      );
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

    // -------------------------------------------------------------------
    // "Save to props.ts" — kept as the LAST section deliberately: clicking
    // it writes to src/game/props.ts on disk, and this suite's own Vite dev
    // server is ALSO the one serving THIS page — Vite's file watcher sees
    // that write and pushes a full page reload to the connected client (the
    // same reload a real developer would see editing the file by hand while
    // /editor/ is open; this is genuine Vite dev-server behavior, not a bug
    // introduced by this feature, and it's shared by characters.ts's own
    // "Save to characters.ts" button via the identical saveEditorFile/
    // /__save-file plumbing — see saveFile.ts). The reload wipes ALL
    // in-page session state (workingLibrary, every edit made in this run),
    // so nothing AFTER this section can depend on prior state — hence its
    // placement at the very end, after the mode-round-trip section (which
    // DOES depend on prior state) has already run and asserted.
    console.log('\n=== "Save to props.ts" writes the real file, and round-trips cleanly ===');
    {
      // Captures the file's ORIGINAL bytes first and restores them
      // immediately after asserting, so this test run never leaves
      // src/game/props.ts modified on disk (mirrors the "never mutate the
      // registry" discipline this whole editor already follows for its
      // in-memory working copies, just extended to the actual file this one
      // save operation targets).
      const propsFilePath = resolve(process.cwd(), "src/game/props.ts");
      const originalContents = readFileSync(propsFilePath, "utf-8");
      try {
        // Race the flash-label read against the reload it triggers: the
        // button's ✓ label appears essentially the instant the fetch
        // resolves (well under 100ms locally), while Vite's own reload
        // follows shortly after once its file watcher notices the write —
        // reading with NO artificial delay (a single microtask-queue drain
        // via a 0ms timeout) reliably wins that race; waiting even 150ms
        // risks losing it, which is exactly what an earlier version of this
        // assertion did (the flash read back `null` because the reload had
        // already begun tearing down the DOM).
        await page.evaluate(() => {
          document.querySelector<HTMLButtonElement>("#savePropsFileBtn")?.click();
        });
        const flashed = await page.evaluate(
          () => new Promise<string | null>((res) => {
            requestAnimationFrame(() => res(document.querySelector("#savePropsFileBtn")?.textContent ?? null));
          }),
        );
        check("save button flashes a success label", flashed?.includes("Saved") === true);

        // Now let Vite's reload actually happen and settle — proves the
        // editor boots cleanly again immediately after saving over its own
        // running module graph, which is the realistic end-to-end scenario
        // (not just "the file changed on disk").
        await page.waitForLoadState("load");
        await page.waitForSelector(".tree-row");
        await page.waitForTimeout(300);

        const written = readFileSync(propsFilePath, "utf-8");
        check("props.ts on disk changed (a real write happened)", written !== originalContents);
        check("written file still starts with the module's own header comment", written.startsWith("// OWNER: gameplay-engineer"));
        check("written file's PROP_LIBRARY contains palm's parts.edits", /id: "palm",[\s\S]{0,400}parts: \{/.test(written));
        check("written file still exports PROP_SHAPE_FIELDS untouched (only PROP_LIBRARY was replaced)", written.includes("export const PROP_SHAPE_FIELDS"));

        // Compile-check: the written file must still be valid TypeScript
        // fed back through the same module the game/tests import — dynamic
        // ESM import of the file we just overwrote (via tsx's own loader,
        // which this whole script already runs under) is the strongest
        // "did this actually stay syntactically/type valid" signal short of
        // a full tsc invocation. pathToFileURL is required on Windows —
        // Node's ESM loader rejects a bare "C:\..." absolute path (it looks
        // like an unsupported URL scheme, "c:"), so a raw template-literal
        // path (which worked fine for readFileSync/writeFileSync above,
        // both plain fs calls) crashes here specifically; a real file://
        // URL is the portable fix on every OS.
        const importUrl = `${pathToFileURL(propsFilePath).href}?t=${Date.now()}`;
        const freshModule = (await import(importUrl)) as { PROP_LIBRARY: unknown[] };
        check("the written props.ts re-imports cleanly and PROP_LIBRARY is an array", Array.isArray(freshModule.PROP_LIBRARY));

        // After Vite's forced reload, the app re-booted from a truly FRESH
        // module load — proves the reload itself didn't leave the page in a
        // broken state (blank canvas, missing tree, etc.).
        await page.click("#modePropsBtn");
        await page.waitForTimeout(500);
        const rowsAfterReload = await treeRows(page);
        check("editor re-boots cleanly after the save-triggered reload (Props tree renders again)", rowsAfterReload.length > 0);
      } finally {
        writeFileSync(propsFilePath, originalContents, "utf-8");
        const restored = readFileSync(propsFilePath, "utf-8");
        check("props.ts restored to its original contents after the save-file test", restored === originalContents);
      }
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
