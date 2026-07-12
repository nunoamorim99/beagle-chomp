// Automated browser checks for the editor's "Board & Themes" workbench
// (IDEA-027: theme-recipe editing — pick a theme, tweak the palette live,
// copy the recipe back into src/game/themes.ts; IDEA-027 props follow-up:
// add/remove/tune per-theme decorative PROPS — shrubs, trees, buildings,
// streetlights... — the same way). Same shape as scripts/test-editor.ts (own
// Vite dev server via the programmatic API, real headless Chromium via
// Playwright, "assert + log, exit 1 on failure") — a SEPARATE file rather
// than folding into that one because this suite exercises a materially
// different surface (lil-gui folders bound to live materials/lights instead
// of the character part tree/codegen), and keeping the two suites
// independent means either can be read/run/extended without carrying the
// other's context. Wired as its own `npm run test:editor:board` AND folded
// into `npm run test:editor` (which now runs both suites back to back) —
// see package.json.
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

/** Tree rows in current DOM order — same #partTree element both the
 *  character part tree AND board mode's slot tree render into (one view owns
 *  it at a time; see main.ts's setMode). Reused verbatim from
 *  test-editor.ts's own treeRows() so both suites read the SAME real DOM
 *  surface a person sees, whichever workbench currently owns it. */
async function treeRows(page: Page): Promise<Array<{ text: string; selected: boolean }>> {
  return page.$$eval(".tree-row", (els) =>
    els.map((e) => ({
      text: e.querySelector(".tree-name")?.textContent ?? "",
      selected: e.className.includes("selected"),
    })),
  );
}

/** lil-gui renders each folder as its own `.lil-gui` with a `.lil-title`
 *  header — this codebase's board inspector (boardInspector.ts) builds one
 *  folder per palette slot (Atmosphere/Walls/Floor/Biscuits/Blooms/Specks/
 *  Props), found here by that exact visible title text (not an internal
 *  handle). A prop SUBfolder (nested one level inside "Props") is itself
 *  just another `.lil-gui` with its own `.lil-title` — this same query finds
 *  those too, since `querySelectorAll("#boardGuiHost .lil-gui")` is not
 *  scoped to top-level folders (see propSubfolderTitles below, which relies
 *  on exactly that). Returns -1 if the folder doesn't exist, so a typo in
 *  `title` fails loud in the check() line instead of silently comparing 0
 *  to 0. */
async function folderControllerCount(page: Page, title: string): Promise<number> {
  return page.evaluate((title) => {
    const guis = [...document.querySelectorAll("#boardGuiHost .lil-gui")];
    const folder = guis.find((f) => f.querySelector(":scope > .lil-title")?.textContent === title);
    return folder ? folder.querySelectorAll(":scope > .lil-children > .lil-controller").length : -1;
  }, title);
}

/** Lists the "Props" folder's direct-child SUBfolder titles, in DOM order —
 *  boardInspector.ts's buildPropsFolder names each one "prop N · kind" (see
 *  buildPropSubfolder), so this is how the suite discovers what's actually
 *  there after an add/remove/kind-swap rather than hardcoding an index-based
 *  guess (subfolder titles shift when the array they mirror does). Returns
 *  `[]` (not a thrown error) if the "Props" folder itself is missing, so a
 *  caller can assert on that separately with a clearer failure message. */
async function propSubfolderTitles(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const guis = [...document.querySelectorAll("#boardGuiHost .lil-gui")];
    const propsFolder = guis.find((f) => f.querySelector(":scope > .lil-title")?.textContent === "Props");
    if (!propsFolder) return [];
    const subfolders = [...propsFolder.querySelectorAll(":scope > .lil-children > .lil-gui")];
    return subfolders
      .map((f) => f.querySelector(":scope > .lil-title")?.textContent ?? "")
      .filter((t) => t !== "");
  });
}

/** Reads the live hex value off a `<input type="color">` swatch inside a
 *  named board-mode folder (matches boardInspector.ts's `{ color: "#hex" }`
 *  proxy pattern — the swatch's `.value` IS the bound color, live). `nth`
 *  picks which color control inside the folder (folders have several). */
async function folderColorSwatch(page: Page, folderTitle: string, nth = 0): Promise<string | null> {
  return page.evaluate(
    ({ folderTitle, nth }) => {
      const guis = [...document.querySelectorAll("#boardGuiHost .lil-gui")];
      const folder = guis.find((f) => f.querySelector(":scope > .lil-title")?.textContent === folderTitle);
      const swatches = folder ? [...folder.querySelectorAll('input[type="color"]')] : [];
      const el = swatches[nth];
      return el instanceof HTMLInputElement ? el.value : null;
    },
    { folderTitle, nth },
  );
}

/** Sets a `<input type="color">` swatch's value and fires the same
 *  input+change events a real color-picker drag would, so lil-gui's
 *  onChange/onFinishChange handlers run exactly as they would for a person
 *  dragging the picker. */
async function setFolderColorSwatch(page: Page, folderTitle: string, hex: string, nth = 0): Promise<void> {
  await page.evaluate(
    ({ folderTitle, hex, nth }) => {
      const guis = [...document.querySelectorAll("#boardGuiHost .lil-gui")];
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
 *  `.lil-name` label — same "find by what a person sees" spirit as
 *  test-editor.ts's clickDeleteButton. */
async function setFolderSlider(page: Page, folderTitle: string, controlLabel: string, value: number): Promise<void> {
  await page.evaluate(
    ({ folderTitle, controlLabel, value }) => {
      const guis = [...document.querySelectorAll("#boardGuiHost .lil-gui")];
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

/** Clicks a lil-gui BUTTON control (an `.add({ fn }, "fn").name(label)`
 *  controller, like boardInspector.ts's "add prop ✚"/"remove this prop 🗑")
 *  inside a named folder, matched by its exact visible `.lil-name` label —
 *  same "find by what a person sees" query shape as setFolderSlider above,
 *  just clicking the controller's real `<button>` instead of setting an
 *  input's value. Throws loud (not a silent no-op) if the folder or control
 *  isn't found, so a stale label string in a test fails at the exact line
 *  that assumed it, not several checks later. */
async function clickFolderButton(page: Page, folderTitle: string, buttonLabel: string): Promise<void> {
  await page.evaluate(
    ({ folderTitle, buttonLabel }) => {
      const guis = [...document.querySelectorAll("#boardGuiHost .lil-gui")];
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

async function selectBaseTheme(page: Page, name: string): Promise<void> {
  const select = await page.$("#boardGuiHost select");
  if (!select) throw new Error("base theme <select> not found");
  const optionValue = await page.evaluate(
    (name) => {
      const sel = document.querySelector("#boardGuiHost select") as HTMLSelectElement | null;
      const opt = sel ? [...sel.options].find((o) => o.textContent === name) : undefined;
      return opt?.value ?? null;
    },
    name,
  );
  if (!optionValue) throw new Error(`base theme option "${name}" not found`);
  await select.selectOption(optionValue);
}

/** Same idiom as selectBaseTheme above, scoped to ONE prop subfolder's
 *  "kind" dropdown — needed because once any prop exists, the page has
 *  MULTIPLE `<select>` elements (the base-theme picker plus one per prop
 *  subfolder), so `#boardGuiHost select` alone (selectBaseTheme's own query)
 *  would ambiguously match the FIRST one on the page, not necessarily this
 *  subfolder's. Locates the specific `<select>` with an XPath text-match on
 *  the subfolder's own `.lil-title` (Playwright locators, unlike a plain CSS
 *  selector, can express "the select inside the folder whose title reads
 *  exactly X"), then drives it with Playwright's own `.selectOption()` (not
 *  raw DOM `.value =` assignment) — it fires the same real `input`/`change`
 *  event sequence a person's dropdown pick does, which is what lil-gui's
 *  OptionController listens for (see lil-gui's source: it reads
 *  `this.$select.selectedIndex` off a `change` listener, never `.value`
 *  directly — matching by INDEX, not a `value` attribute the option never
 *  actually has, so driving selection through the same API a browser click
 *  would use is the only reliably correct way to trigger it). */
async function selectPropKind(page: Page, subfolderTitle: string, kind: string): Promise<void> {
  const folder = page.locator(`#boardGuiHost .lil-gui:has(> .lil-title:text-is("${subfolderTitle}"))`).first();
  const select = folder.locator("select").first();
  const optionValue = await select.evaluate(
    (sel, kind) => {
      const opt = [...(sel as HTMLSelectElement).options].find((o) => o.textContent === kind);
      return opt?.value ?? null;
    },
    kind,
  );
  if (!optionValue) throw new Error(`kind option "${kind}" not found in "${subfolderTitle}"`);
  await select.selectOption(optionValue);
}

/** Matched by boardInspector.ts's `data-testid="copy-theme-code"` (a stable
 *  marker on the real button), NOT its visible label text — the label
 *  flashes to "Copied ✓ ..." for 1.6s after every click (see
 *  boardInspector.ts's flashCopyLabel), so a suite clicking Copy twice in
 *  quick succession (this file spot-checks several different edits back to
 *  back) can't reliably find it by text alone. */
async function clickCopyThemeCode(page: Page): Promise<void> {
  await page.evaluate(() => {
    const button = document.querySelector('#boardGuiHost [data-testid="copy-theme-code"] button');
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** Reads main.ts's `window.__boardTestHook` — the one internal-state read
 *  this suite needs (wall INSTANCE count, hedge-decor MESH count, and prop
 *  GROUP CHILD count have no DOM surface of their own to assert on, unlike
 *  everything else in this file, which reads exactly what a person sees —
 *  tree rows, swatch values, clipboard text). See main.ts's own comment on
 *  the hook for why it's the one deliberate exception to test-editor.ts's
 *  established "no internal handle" style. `propMeshCount` reads
 *  `board.props?.children.length` — the render layer's REAL observable
 *  (src/render/board.ts's buildProps/applyBoardTheme landed alongside this
 *  suite, so this is a live assertion, not a working-theme-state fallback —
 *  see the "density slider -> live prop rebuild" section below). */
async function boardSnapshot(page: Page): Promise<{ wallCount: number; hedgeDecorMeshCount: number; propMeshCount: number; mode: string }> {
  return page.evaluate(() => {
    const h = window.__boardTestHook;
    if (!h) throw new Error("__boardTestHook missing — did main.ts's test-support hook get removed?");
    return { wallCount: h.wallCount(), hedgeDecorMeshCount: h.hedgeDecorMeshCount(), propMeshCount: h.propMeshCount(), mode: h.mode() };
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
    console.log("\n=== board mode opens + a real maze renders ===");
    {
      check("boots in character mode", (await boardSnapshot(page)).mode === "character");
      await page.click("#modeBoardBtn");
      await page.waitForTimeout(500);
      const snap = await boardSnapshot(page);
      check("mode flips to board", snap.mode === "board");
      check("walls instance count > 0 (a real validated maze rendered)", snap.wallCount > 0);
      // MAZES[0]'s wall tile count is fixed maze data — 198 walls (see
      // src/game/mazes.json's first entry) — asserting the exact number (not
      // just >0) proves this is genuinely MAZES[0] and not some placeholder.
      check("walls instance count matches MAZES[0]'s real wall-tile count (198)", snap.wallCount === 198);

      const rows = await treeRows(page);
      check(
        "tree pane lists the 7 board slots (incl. Props)",
        JSON.stringify(rows.map((r) => r.text)) ===
          JSON.stringify(["Atmosphere", "Walls", "Floor", "Biscuits", "Blooms", "Specks", "Props"]),
      );

      const folderTitles = await page.$$eval("#boardGuiHost .lil-title", (els) => els.map((e) => e.textContent));
      for (const expected of ["Board & Themes", "Theme identity", "Atmosphere", "Walls", "Floor", "Biscuits", "Blooms", "Specks", "Props"]) {
        check(`inspector shows the "${expected}" folder`, folderTitles.includes(expected));
      }

      // Garden (the board-mode default) authors exactly 2 prop populations —
      // shrub then tree (see src/game/themes.ts) — so the Props folder should
      // already show 2 subfolders, titled by their 1-based position + kind,
      // on the very FIRST board-mode entry (no click needed) — proves
      // buildBoard's own buildProps call (not just applyBoardTheme's re-apply
      // path) seeded `board.props` correctly.
      const gardenPropTitles = await propSubfolderTitles(page);
      check(
        "garden's Props folder starts with 2 subfolders: shrub then tree",
        JSON.stringify(gardenPropTitles) === JSON.stringify(["prop 1 · shrub", "prop 2 · tree"]),
      );
      check(
        "garden's live prop mesh count is > 0 on first board-mode entry",
        snap.propMeshCount > 0,
      );
    }

    // -------------------------------------------------------------------
    console.log("\n=== tree row click focuses/opens its folder ===");
    {
      const idx = await page.evaluate(() =>
        [...document.querySelectorAll(".tree-row")].findIndex((r) => r.querySelector(".tree-name")?.textContent === "Blooms"),
      );
      check("found the 'Blooms' tree row", idx !== -1);
      await page.evaluate((i) => {
        (document.querySelectorAll(".tree-row")[i] as HTMLElement).click();
      }, idx);
      await page.waitForTimeout(150);
      const rows = await treeRows(page);
      check("clicking a slot row selects it", rows.find((r) => r.text === "Blooms")?.selected === true);
      const bloomsOpen = await page.evaluate(() => {
        const guis = [...document.querySelectorAll("#boardGuiHost .lil-gui")];
        const folder = guis.find((f) => f.querySelector(":scope > .lil-title")?.textContent === "Blooms");
        return folder ? !folder.classList.contains("closed") : false;
      });
      check("Blooms folder is open after the row click", bloomsOpen);
    }

    // -------------------------------------------------------------------
    console.log("\n=== base theme dropdown loads each of the 6 registry themes ===");
    {
      const gardenWall = await folderColorSwatch(page, "Walls", 0);
      check("garden (default) wall swatch matches src/game/themes.ts", gardenWall === "#3f8f3a");

      await selectBaseTheme(page, "Arcade Night");
      await page.waitForTimeout(300);
      const classicWall = await folderColorSwatch(page, "Walls", 0);
      check("switching to Arcade Night changes the live wall swatch", classicWall !== gardenWall);
      check("Arcade Night wall swatch matches src/game/themes.ts (#2b2b6b)", classicWall === "#2b2b6b");

      const classicSnap = await boardSnapshot(page);
      check("Arcade Night has NO hedge decor (bloomChance: 0 in the registry)", classicSnap.hedgeDecorMeshCount === 0);
      // Arcade Night's palette has 0 bloomColors, so the Blooms folder should
      // rebuild down to just its 2 sliders + an "add" button (no per-color
      // swatches, no "remove" button) — proves loadBaseTheme's rebuild
      // reaches the color-LIST controls, not just the material colors.
      check(
        "Blooms folder shrinks to 3 controls for a 0-bloom-color theme (2 sliders + add button)",
        (await folderControllerCount(page, "Blooms")) === 3,
      );
      // Arcade Night is deliberately PROPLESS (src/game/themes.ts: "the v1.0
      // throwback is a clean neon board... anything planted would break the
      // retro read") — the Props folder should show zero subfolders, no
      // planted meshes, but the top-level "add prop ✚" button should still
      // exist (a propless theme is a valid STARTING point to author from,
      // not a locked-out one).
      check("Arcade Night's Props folder has zero subfolders", (await propSubfolderTitles(page)).length === 0);
      check("Arcade Night has zero live prop meshes", classicSnap.propMeshCount === 0);
      check(
        `Props folder still offers "add prop ✚" for a propless theme`,
        (await folderControllerCount(page, "Props")) === 1,
      );

      await selectBaseTheme(page, "The Garden");
      await page.waitForTimeout(300);
      check(
        "Blooms folder is back to 7 controls for garden's 4 bloom colors (4 swatches + remove + 2 sliders)",
        (await folderControllerCount(page, "Blooms")) === 7,
      );
      await selectBaseTheme(page, "Arcade Night");
      await page.waitForTimeout(300);

      // Spot-check every remaining theme loads without error and changes id.
      for (const name of ["Deep Forest", "Sunny Beach", "City Park", "Night City"]) {
        await selectBaseTheme(page, name);
        await page.waitForTimeout(250);
      }
      check("no page errors across all 6 base-theme loads", pageErrors.length === 0);

      // Night City authors exactly 2 prop populations — building then
      // streetlight (src/game/themes.ts: "some buildings... some lighting
      // stations") — a DIFFERENT pair of kinds than garden's, so this also
      // proves the Props folder rebuilds its subfolder SET (not just
      // recolors existing ones) on a base-theme swap.
      await selectBaseTheme(page, "Night City");
      await page.waitForTimeout(300);
      const cityPropTitles = await propSubfolderTitles(page);
      check(
        "Night City's Props folder shows 2 subfolders: building then streetlight",
        JSON.stringify(cityPropTitles) === JSON.stringify(["prop 1 · building", "prop 2 · streetlight"]),
      );
      const citySnap = await boardSnapshot(page);
      check("Night City has live prop meshes (buildings + streetlights)", citySnap.propMeshCount > 0);

      // Back to garden for the rest of the suite.
      await selectBaseTheme(page, "The Garden");
      await page.waitForTimeout(300);
      const backToGarden = await folderColorSwatch(page, "Walls", 0);
      check("re-selecting The Garden restores its wall swatch", backToGarden === "#3f8f3a");
      check(
        "re-selecting The Garden restores its 2 prop subfolders",
        JSON.stringify(await propSubfolderTitles(page)) === JSON.stringify(["prop 1 · shrub", "prop 2 · tree"]),
      );
    }

    // -------------------------------------------------------------------
    console.log("\n=== editing wall color updates the live material ===");
    {
      await setFolderColorSwatch(page, "Walls", "#ff00aa");
      await page.waitForTimeout(150);
      const swatch = await folderColorSwatch(page, "Walls", 0);
      check("wall swatch reflects the edit", swatch === "#ff00aa");

      // Prove it's not just a stale-looking swatch: "Copy theme code" reads
      // straight off the SAME working palette the material was set from, so
      // this exercises the live-material -> palette -> codegen path end to end.
      await clickCopyThemeCode(page);
      await page.waitForTimeout(250);
      const clip = await page.evaluate(() => navigator.clipboard.readText());
      check("copied code contains the edited wall hex (0xff00aa)", clip.includes("wall: 0xff00aa,"));
    }

    // -------------------------------------------------------------------
    console.log("\n=== bloomChance -> 0 clears decor meshes, back up rebuilds them ===");
    {
      const before = await boardSnapshot(page);
      check("garden starts with hedge decor meshes (bloomChance 0.2, 4 colors)", before.hedgeDecorMeshCount > 0);

      await setFolderSlider(page, "Blooms", "bloom chance", 0);
      await page.waitForTimeout(300);
      const cleared = await boardSnapshot(page);
      check("bloomChance -> 0 clears every hedge decor mesh", cleared.hedgeDecorMeshCount === 0);
      check("walls are untouched by a decor-only change", cleared.wallCount === before.wallCount);

      await setFolderSlider(page, "Blooms", "bloom chance", 0.2);
      await page.waitForTimeout(300);
      const rebuilt = await boardSnapshot(page);
      check("bloomChance back to 0.2 rebuilds the hedge decor meshes", rebuilt.hedgeDecorMeshCount > 0);
    }

    // -------------------------------------------------------------------
    console.log("\n=== Props: density slider live-rebuilds the planted meshes ===");
    {
      // Still on The Garden (restored at the end of the base-theme section
      // above) — its first subfolder is "prop 1 · shrub" (density 0.3 in the
      // registry). Cranking density up should PLANT MORE shrub meshes live —
      // asserted on the REAL render-side observable (board.props' Group
      // child count via window.__boardTestHook.propMeshCount, wired to
      // src/render/board.ts's buildProps/applyBoardTheme, which landed
      // alongside this suite — see boardSnapshot's own doc comment for why
      // this is NOT a working-theme-state fallback).
      const before = await boardSnapshot(page);
      check("garden starts with live prop meshes (shrub + tree populations)", before.propMeshCount > 0);

      await setFolderSlider(page, "prop 1 · shrub", "density", 0.6);
      await page.waitForTimeout(300);
      const denser = await boardSnapshot(page);
      check("raising shrub density plants MORE live prop meshes", denser.propMeshCount > before.propMeshCount);
      check("walls are untouched by a props-only change", denser.wallCount === before.wallCount);
      check("hedge decor is untouched by a props-only change", denser.hedgeDecorMeshCount === before.hedgeDecorMeshCount);

      await setFolderSlider(page, "prop 1 · shrub", "density", 0);
      await page.waitForTimeout(300);
      const noShrubs = await boardSnapshot(page);
      check(
        "shrub density -> 0 leaves only the tree population's meshes (fewer than before)",
        noShrubs.propMeshCount > 0 && noShrubs.propMeshCount < before.propMeshCount,
      );

      // Restore garden's authored shrub density (0.3) so later sections in
      // this suite (and anything relying on "Copy theme code" reflecting an
      // otherwise-unedited garden) see the registry's real starting value.
      await setFolderSlider(page, "prop 1 · shrub", "density", 0.3);
      await page.waitForTimeout(300);
    }

    // -------------------------------------------------------------------
    console.log("\n=== Props: add a population on a propless theme (Arcade Night) ===");
    {
      await selectBaseTheme(page, "Arcade Night");
      await page.waitForTimeout(300);
      check("Arcade Night starts with zero prop subfolders", (await propSubfolderTitles(page)).length === 0);
      check("Arcade Night starts with zero live prop meshes", (await boardSnapshot(page)).propMeshCount === 0);

      await clickFolderButton(page, "Props", "add prop ✚");
      await page.waitForTimeout(300);
      const afterAdd = await propSubfolderTitles(page);
      check(
        `"add prop ✚" gives Arcade Night exactly 1 subfolder, titled "prop 1 · shrub" (the default)`,
        JSON.stringify(afterAdd) === JSON.stringify(["prop 1 · shrub"]),
      );
      const addedSnap = await boardSnapshot(page);
      check("the newly-added prop plants live meshes on a previously propless theme", addedSnap.propMeshCount > 0);

      // "Copy theme code" should now include the freshly-authored population
      // in a genuinely propless base theme's recipe.
      await clickCopyThemeCode(page);
      await page.waitForTimeout(250);
      const clip = await page.evaluate(() => navigator.clipboard.readText());
      check(
        `Arcade Night's copied code now contains the added shrub population`,
        /kind: "shrub", density: 0\.2, colors: \[0x4e9a3e\], minScale: 0\.8, maxScale: 1\.2/.test(clip),
      );

      // Kind dropdown: swap the newly-added prop from shrub to building —
      // structural (the subfolder's own title embeds the kind), so this also
      // proves buildPropsFolder's full rebuild reaches a KIND change, not
      // just density/scale/color edits.
      await selectPropKind(page, "prop 1 · shrub", "building");
      await page.waitForTimeout(300);
      check(
        "swapping kind to 'building' renames the subfolder to 'prop 1 · building'",
        JSON.stringify(await propSubfolderTitles(page)) === JSON.stringify(["prop 1 · building"]),
      );
      const afterKindSwap = await boardSnapshot(page);
      check("swapping kind still rebuilds live meshes (buildings plant fine too)", afterKindSwap.propMeshCount > 0);
    }

    // -------------------------------------------------------------------
    console.log("\n=== Props: remove a population drops its subfolder AND the emitted code ===");
    {
      // Still on the just-edited Arcade Night (1 prop: building, from the
      // kind-swap above). Removing it should return Arcade Night to its
      // authored propless state exactly.
      await clickFolderButton(page, "prop 1 · building", "remove this prop 🗑");
      await page.waitForTimeout(300);
      check("removing the only prop drops the subfolder", (await propSubfolderTitles(page)).length === 0);
      check("removing the only prop clears its live meshes", (await boardSnapshot(page)).propMeshCount === 0);
      check(
        `"add prop ✚" is still offered after removing back down to zero`,
        (await folderControllerCount(page, "Props")) === 1,
      );

      await clickCopyThemeCode(page);
      await page.waitForTimeout(250);
      const clip = await page.evaluate(() => navigator.clipboard.readText());
      check("copied code's props array is empty again after the remove", /props: \[\],/.test(clip));
      check("copied code no longer mentions the removed building population", !clip.includes('kind: "building"'));

      // Restore Garden for the rest of the suite (same convention the
      // base-theme section above already follows).
      await selectBaseTheme(page, "The Garden");
      await page.waitForTimeout(300);
    }

    // -------------------------------------------------------------------
    console.log('\n=== "Copy theme code" emits a parseable MAZE_THEMES entry ===');
    {
      // Fresh, known state: reselect Arcade Night (0 bloom colors — a
      // simpler literal to eval) and make one identifying edit.
      await selectBaseTheme(page, "Arcade Night");
      await page.waitForTimeout(300);
      await setFolderColorSwatch(page, "Floor", "#123456");
      await page.waitForTimeout(150);

      // Also author a prop population with an edited value on this SAME
      // theme, so the round-trip below proves "props" is a genuinely
      // parseable, edit-reflecting array field alongside "palette" — not
      // just an empty `props: [],` (Arcade Night's untouched default, which
      // the earlier "add/remove" section already exercised at zero).
      await clickFolderButton(page, "Props", "add prop ✚");
      await page.waitForTimeout(300);
      await setFolderColorSwatch(page, "prop 1 · shrub", "#00ff88", 0);
      await page.waitForTimeout(150);
      await setFolderSlider(page, "prop 1 · shrub", "density", 0.45);
      await page.waitForTimeout(150);

      await clickCopyThemeCode(page);
      await page.waitForTimeout(250);
      const clip = await page.evaluate(() => navigator.clipboard.readText());

      check("emitted entry contains the edited floor hex", clip.includes("floor: 0x123456,"));
      check("emitted entry has the id field", /id: "classic",/.test(clip));
      check("emitted entry has the palette field", /palette: \{/.test(clip));
      // \r?\n here too — this regex spans the line break after `props: [`,
      // unlike the single-line `palette: {` check above.
      check("emitted entry has a non-empty props field", /props: \[\r?\n/.test(clip));
      check("emitted props entry contains the edited prop color", clip.includes("colors: [0x00ff88]"));
      check("emitted props entry contains the edited prop density", clip.includes("density: 0.45,"));
      // \r?\n rather than a literal \n: the OS clipboard round-trip
      // normalizes line endings to CRLF on Windows (confirmed harmless —
      // formatThemeEntry itself emits plain LF, see boardCodegen.ts; a pasted
      // .ts file is line-ending-agnostic either way), so the assertion must
      // tolerate both rather than assume the platform's clipboard behavior.
      check(
        "emitted entry is a single trailing-comma object literal (starts with '{' + id)",
        /^\s*\{\r?\n\s*id: /.test(clip),
      );

      // Round-trip: wrap it exactly as it would sit inside MAZE_THEMES and
      // eval it as a real object literal — this is the strongest available
      // proof that pasting the emitted code compiles and reproduces the
      // edited value, short of actually re-running tsc against themes.ts.
      const parsed = new Function(`return (${clip.trim().replace(/,\s*$/, "")});`)() as {
        id: string;
        name: string;
        price: number;
        palette: { floor: number; wall: number; bloomColors: number[] };
        props: Array<{ kind: string; density: number; colors: number[]; minScale: number; maxScale: number }>;
      };
      check("emitted entry parses as valid JS", parsed !== null && typeof parsed === "object");
      check("parsed entry keeps the edited floor value (0x123456)", parsed.palette.floor === 0x123456);
      check("parsed entry's id/name/price match Arcade Night", parsed.id === "classic" && parsed.name === "Arcade Night" && parsed.price === 5);
      check("parsed entry's bloomColors is an array (Arcade Night: empty)", Array.isArray(parsed.palette.bloomColors) && parsed.palette.bloomColors.length === 0);
      check("parsed entry's props is an array with exactly 1 population", Array.isArray(parsed.props) && parsed.props.length === 1);
      check("parsed prop keeps the edited color (0x00ff88)", parsed.props[0]?.colors[0] === 0x00ff88);
      check("parsed prop keeps the edited density (0.45)", parsed.props[0]?.density === 0.45);
      check("parsed prop's kind defaulted to 'shrub'", parsed.props[0]?.kind === "shrub");

      const flashed = await page.evaluate(() => {
        const names = [...document.querySelectorAll("#boardGuiHost .lil-function .lil-name")];
        return names.find((n) => n.textContent?.includes("Copied"))?.textContent ?? null;
      });
      check("copy button flashes a success label", flashed !== null);

      // Clean up: remove the just-authored prop so Arcade Night is back to
      // its authored propless state for anything relying on that later.
      await clickFolderButton(page, "prop 1 · shrub", "remove this prop 🗑");
      await page.waitForTimeout(300);
    }

    // -------------------------------------------------------------------
    console.log("\n=== authoring a NEW theme: editable id/name/price ===");
    {
      const idInput = await page.evaluate(() => {
        const guis = [...document.querySelectorAll("#boardGuiHost .lil-gui")];
        const folder = guis.find((f) => f.querySelector(":scope > .lil-title")?.textContent === "Theme identity");
        const controllers = folder ? [...folder.querySelectorAll(":scope > .lil-children > .lil-controller")] : [];
        const idCtrl = controllers.find((c) => c.querySelector(".lil-name")?.textContent === "id");
        const input = idCtrl?.querySelector("input");
        if (input instanceof HTMLInputElement) {
          input.value = "my-custom-theme";
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        }
        return false;
      });
      check("id field is editable", idInput);
      await page.waitForTimeout(150);
      await clickCopyThemeCode(page);
      await page.waitForTimeout(250);
      const clip = await page.evaluate(() => navigator.clipboard.readText());
      check("copied entry reflects the custom authored id", clip.includes('id: "my-custom-theme",'));
    }

    // -------------------------------------------------------------------
    console.log("\n=== switching back to a character restores the workbench exactly ===");
    {
      await page.click("#modeCharacterBtn");
      await page.waitForTimeout(500);
      const snap = await boardSnapshot(page);
      check("mode flips back to character", snap.mode === "character");

      const rows = await treeRows(page);
      check("character tree is back (root + several parts)", rows.length > 5);
      check("a known original part ('body') is visible again", rows.some((r) => r.text === "body"));
      check("character root row reads '(g)'", /\(g\)$/.test(rows[0]?.text ?? ""));

      const genText = await page.$eval("#generatedView code", (el) => el.textContent ?? "");
      check("generated code panel is back showing the character's own placeholder", genText.includes("No edits yet"));

      const codePaneVisible = await page.$eval("#codePane", (el) => getComputedStyle(el).display !== "none");
      check("bottom code panel is visible again in character mode", codePaneVisible);
    }

    // -------------------------------------------------------------------
    console.log("\n=== IDEA-025 v2 delete flow still works after visiting board mode ===");
    {
      const before = await treeRows(page);
      const idx = before.findIndex((r) => r.text === "blaze");
      check("found 'blaze' (an original mesh) in the tree", idx !== -1);
      await page.evaluate((i) => {
        (document.querySelectorAll(".tree-row")[i] as HTMLElement).click();
      }, idx);
      await page.waitForTimeout(150);
      const deleted = await page.evaluate(() => {
        const fns = [...document.querySelectorAll("#guiPane .lil-function")];
        const del = fns.find((b) => b.querySelector(".lil-name")?.textContent?.startsWith("delete part"));
        del?.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        return !!del;
      });
      check("delete button still works for an original part", deleted);
      await page.waitForTimeout(150);
      const after = await treeRows(page);
      check("'blaze' is gone from the tree", !after.some((r) => r.text === "blaze"));
      const gen = await page.$eval("#generatedView code", (el) => el.textContent ?? "");
      check("generated code contains blaze.removeFromParent();", gen.includes("blaze.removeFromParent();"));

      await page.keyboard.press("Control+z");
      await page.waitForTimeout(150);
      const restored = await treeRows(page);
      check("undo restores 'blaze' after a round trip through board mode", restored.some((r) => r.text === "blaze"));
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
    console.log(`\n${failures === 0 ? "ALL BOARD EDITOR CHECKS PASSED" : `${failures} BOARD EDITOR CHECK(S) FAILED`}`);
    if (failures > 0) process.exit(1);
  })
  .catch((err) => {
    console.error("board editor test run crashed:", err);
    process.exit(1);
  });
