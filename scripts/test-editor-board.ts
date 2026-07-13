// Automated browser checks for the editor's "Board & Themes" workbench
// (IDEA-027: theme-recipe editing — pick a theme, tweak the palette live,
// copy the recipe back into src/game/themes.ts; IDEA-030/031: the ON-BOARD
// PLACEMENT EDITOR — click a spot on the board, assign a library prop,
// adjust its position/rotation/scale, remove it, all live). Same shape as
// scripts/test-editor.ts (own Vite dev server via the programmatic API,
// real headless Chromium via Playwright, "assert + log, exit 1 on
// failure") — a SEPARATE file rather than folding into that one because
// this suite exercises a materially different surface (lil-gui folders
// bound to live materials/lights, PLUS raycast clicks on the 3D canvas
// itself, instead of the character part tree/codegen). Wired as its own
// `npm run test:editor:board` AND folded into `npm run test:editor` (which
// runs all three editor suites back to back) — see package.json.
//
// v4.1 "Set Dressing" (IDEA-030/031) REWORK: the old density-population
// "Props" folder checks (add/remove a shrub/tree POPULATION, density/
// minScale/maxScale sliders) are GONE — MazeTheme.props no longer exists.
// This suite now drives the REAL placement UX instead: click an apron/wall
// slot marker on the 3D canvas (via window.__boardTestHook.tileToClientXY,
// the exact inverse of boardPlacement.ts's own raycast unprojection — see
// its doc comment), assign/swap a prop via the "Placement" folder's
// dropdown, drag its offset/rotation/scale sliders, remove it, and verify
// both the render-side observable (propMeshCount/wallDecorMeshCount) AND
// the underlying DATA (placementsLength/wallDecorLength/workingThemeId) —
// see main.ts's __boardTestHook for exactly what it exposes and why.
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
 *  folder per palette slot (Atmosphere/Walls/Floor/Biscuits/Blooms/Specks),
 *  found here by that exact visible title text (not an internal handle).
 *  Returns -1 if the folder doesn't exist, so a typo in `title` fails loud
 *  in the check() line instead of silently comparing 0 to 0. */
async function folderControllerCount(page: Page, title: string): Promise<number> {
  return page.evaluate((title) => {
    const guis = [...document.querySelectorAll("#boardGuiHost .lil-gui")];
    const folder = guis.find((f) => f.querySelector(":scope > .lil-title")?.textContent === title);
    return folder ? folder.querySelectorAll(":scope > .lil-children > .lil-controller").length : -1;
  }, title);
}

/** Every visible folder TITLE currently in #boardGuiHost, in DOM order. The
 *  "Placement" folder's title EMBEDS the selected tile/kind (see
 *  boardInspector.ts's buildPlacementFolder: `Placement — prop @ (x, y)` or
 *  `Placement — wall component @ (x, y)`) — this is how the suite verifies
 *  a slot click actually opened the right folder for the right tile, without
 *  a bespoke internal handle. */
async function boardFolderTitles(page: Page): Promise<string[]> {
  return page.$$eval("#boardGuiHost .lil-title", (els) => els.map((e) => e.textContent ?? ""));
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

/** Reads a lil-gui number-slider's CURRENT displayed value — the read-side
 *  counterpart to setFolderSlider above, used to prove a keyboard nudge (not
 *  a slider drag) updated the visible display via
 *  boardInspector.refreshPlacementDisplays(). */
async function readFolderSlider(page: Page, folderTitle: string, controlLabel: string): Promise<number | null> {
  return page.evaluate(
    ({ folderTitle, controlLabel }) => {
      const guis = [...document.querySelectorAll("#boardGuiHost .lil-gui")];
      const folder = guis.find((f) => f.querySelector(":scope > .lil-title")?.textContent === folderTitle);
      if (!folder) return null;
      const controllers = [...folder.querySelectorAll(":scope > .lil-children > .lil-controller")];
      const ctrl = controllers.find((c) => c.querySelector(".lil-name")?.textContent === controlLabel);
      if (!ctrl) return null;
      const range = ctrl.querySelector('input[type="range"]');
      const number = ctrl.querySelector('input[type="number"], input:not([type="range"])');
      const el = (range ?? number) as HTMLInputElement | null;
      return el ? Number(el.value) : null;
    },
    { folderTitle, controlLabel },
  );
}

/** Drives a lil-gui `<select>` dropdown inside the "Placement" folder by its
 *  visible option TEXT (not value) — same idiom the old suite's
 *  selectPropKind used, scoped here to the ONE dropdown board mode's
 *  Placement folder has (the "prop" swap control). Located by a PARTIAL
 *  title match (a regex `hasText`) rather than an exact one, since the
 *  folder's title embeds the tile coord (`Placement — prop @ (x, y)`),
 *  which the caller doesn't always want to spell out exactly. Uses
 *  Playwright's own `.selectOption()` (fires the real input/change sequence
 *  lil-gui's OptionController listens for) rather than raw DOM `.value =`. */
async function selectPlacementDropdown(page: Page, optionText: string): Promise<void> {
  const folder = page.locator("#boardGuiHost .lil-gui", {
    has: page.locator(":scope > .lil-title", { hasText: /^Placement/ }),
  }).first();
  const select = folder.locator("select").first();
  const optionValue = await select.evaluate(
    (sel, optionText) => {
      const opt = [...(sel as HTMLSelectElement).options].find((o) => o.textContent === optionText);
      return opt?.value ?? null;
    },
    optionText,
  );
  if (!optionValue) throw new Error(`prop option "${optionText}" not found in the Placement folder`);
  await select.selectOption(optionValue);
}

/** Clicks a lil-gui BUTTON control (an `.add({ fn }, "fn").name(label)`
 *  controller) inside the "Placement" folder — matched by whichever folder's
 *  title starts with "Placement" (the folder's title embeds the tile coord,
 *  see boardFolderTitles' doc comment), then by the button's exact visible
 *  `.lil-name` label. Throws loud (not a silent no-op) if the folder or
 *  control isn't found. */
async function clickPlacementButton(page: Page, buttonLabel: string): Promise<void> {
  await page.evaluate((buttonLabel) => {
    const guis = [...document.querySelectorAll("#boardGuiHost .lil-gui")];
    const folder = guis.find((f) => (f.querySelector(":scope > .lil-title")?.textContent ?? "").startsWith("Placement"));
    if (!folder) throw new Error(`no "Placement" folder found (button "${buttonLabel}")`);
    const controllers = [...folder.querySelectorAll(":scope > .lil-children > .lil-controller")];
    const ctrl = controllers.find((c) => c.querySelector(".lil-name")?.textContent === buttonLabel);
    if (!ctrl) throw new Error(`button "${buttonLabel}" not found in the Placement folder`);
    const button = ctrl.querySelector("button");
    if (!button) throw new Error(`control "${buttonLabel}" in the Placement folder has no <button>`);
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }, buttonLabel);
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

/** Reads main.ts's `window.__boardTestHook` — the internal-state reads this
 *  suite needs beyond what a person can see in the DOM (wall INSTANCE
 *  count, hedge-decor/wall-decor MESH counts, prop GROUP CHILD count, the
 *  working theme's raw placements/wallDecor array LENGTHS, boardPlacement's
 *  sub-mode/selection, and the tile->screen projection used to actually
 *  DRIVE a raycast click) — see main.ts's own comment on the hook for why
 *  it's the one deliberate exception to test-editor.ts's established "no
 *  internal handle" style. */
interface BoardSnapshot {
  wallCount: number;
  hedgeDecorMeshCount: number;
  propMeshCount: number;
  wallDecorMeshCount: number;
  mode: string;
  workingThemeId: string;
  placementsLength: number;
  wallDecorLength: number;
  placementSubMode: "apron" | "wall";
  placementSelection: { tile: [number, number]; propId: string | null } | null;
}
async function boardSnapshot(page: Page): Promise<BoardSnapshot> {
  return page.evaluate(() => {
    const h = window.__boardTestHook;
    if (!h) throw new Error("__boardTestHook missing — did main.ts's test-support hook get removed?");
    return {
      wallCount: h.wallCount(),
      hedgeDecorMeshCount: h.hedgeDecorMeshCount(),
      propMeshCount: h.propMeshCount(),
      wallDecorMeshCount: h.wallDecorMeshCount(),
      mode: h.mode(),
      workingThemeId: h.workingThemeId(),
      placementsLength: h.placementsLength(),
      wallDecorLength: h.wallDecorLength(),
      placementSubMode: h.placementSubMode(),
      placementSelection: h.placementSelection(),
    };
  });
}

/** Clicks the 3D canvas at the projected screen position of `tile` in
 *  `submode` — the actual raycast-driven slot pick a real user performs,
 *  via window.__boardTestHook.tileToClientXY (see main.ts's own doc comment
 *  on why this reuses the LIVE camera rather than re-deriving the
 *  projection math independently here). Fires a real mousedown+mouseup
 *  pair via Playwright's `page.mouse` (matching boardPlacement.ts's own
 *  pointerdown/pointerup click-vs-drag detection, which only cares that the
 *  two events land within CLICK_SLOP_PX of each other — a single
 *  `page.mouse.click()` at a fixed point satisfies that trivially). Throws
 *  if the tile doesn't project onscreen (should never happen for a real
 *  apron/wall tile at this rig's fixed framing — a thrown error here means
 *  the camera framing itself broke, which deserves a loud failure, not a
 *  silently-skipped check). */
async function clickTile(page: Page, tile: [number, number], submode: "apron" | "wall"): Promise<void> {
  const pt = await page.evaluate(
    ({ tile, submode }) => {
      const h = window.__boardTestHook;
      if (!h) throw new Error("__boardTestHook missing");
      return h.tileToClientXY(tile, submode);
    },
    { tile, submode },
  );
  if (!pt) throw new Error(`tile (${tile[0]}, ${tile[1]}) [${submode}] did not project onscreen`);
  await page.mouse.click(pt.x, pt.y);
}

/** Clicks a tree row by its exact visible label (e.g. "Props (apron)",
 *  "Wall components", "Blooms") — shared by every section below that needs
 *  to switch sub-mode or focus a palette folder via the tree pane, same
 *  "find by what a person sees" idiom as clickFolderButton. */
async function clickTreeRow(page: Page, label: string): Promise<void> {
  const idx = await page.evaluate(
    (label) => [...document.querySelectorAll(".tree-row")].findIndex((r) => r.querySelector(".tree-name")?.textContent === label),
    label,
  );
  if (idx === -1) throw new Error(`tree row "${label}" not found`);
  await page.evaluate((i) => {
    (document.querySelectorAll(".tree-row")[i] as HTMLElement).click();
  }, idx);
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
        "tree pane lists the 6 palette slots + 2 placement rows",
        JSON.stringify(rows.map((r) => r.text)) ===
          JSON.stringify(["Atmosphere", "Walls", "Floor", "Biscuits", "Blooms", "Specks", "Props (apron)", "Wall components"]),
      );

      const folderTitles = await boardFolderTitles(page);
      for (const expected of ["Board & Themes", "Theme identity", "Atmosphere", "Walls", "Floor", "Biscuits", "Blooms", "Specks"]) {
        check(`inspector shows the "${expected}" folder`, folderTitles.includes(expected));
      }
      check("no 'Placement' folder yet (nothing selected on first entry)", !folderTitles.some((t) => t.startsWith("Placement")));

      // Garden (the board-mode default) authors 29 apron placements and an
      // empty wallDecor (see src/game/themes.ts) — asserting these exact
      // numbers on the very FIRST board-mode entry proves buildBoard's own
      // buildProps call (not just applyBoardTheme's re-apply path) seeded
      // board.props correctly from the real registry data.
      check("garden's working theme starts with 29 placements", snap.placementsLength === 29);
      check("garden's working theme starts with an empty wallDecor", snap.wallDecorLength === 0);
      check("garden's live apron prop mesh count is > 0 on first board-mode entry", snap.propMeshCount > 0);
      check("garden's sub-mode defaults to apron", snap.placementSubMode === "apron");
    }

    // -------------------------------------------------------------------
    console.log("\n=== tree row click focuses/opens a palette folder ===");
    {
      await clickTreeRow(page, "Blooms");
      await page.waitForTimeout(150);
      const rows = await treeRows(page);
      check("clicking a palette-slot row selects it", rows.find((r) => r.text === "Blooms")?.selected === true);
      const bloomsOpen = await page.evaluate(() => {
        const guis = [...document.querySelectorAll("#boardGuiHost .lil-gui")];
        const folder = guis.find((f) => f.querySelector(":scope > .lil-title")?.textContent === "Blooms");
        return folder ? !folder.classList.contains("closed") : false;
      });
      check("Blooms folder is open after the row click", bloomsOpen);
    }

    // -------------------------------------------------------------------
    console.log("\n=== tree row click switches the placement sub-mode (no folder to focus) ===");
    {
      check("sub-mode starts apron", (await boardSnapshot(page)).placementSubMode === "apron");
      await clickTreeRow(page, "Wall components");
      await page.waitForTimeout(150);
      const afterWall = await boardSnapshot(page);
      check("clicking 'Wall components' switches sub-mode to wall", afterWall.placementSubMode === "wall");
      check("switching sub-mode clears any prior selection", afterWall.placementSelection === null);
      const rows = await treeRows(page);
      check("'Wall components' row reads selected", rows.find((r) => r.text === "Wall components")?.selected === true);

      await clickTreeRow(page, "Props (apron)");
      await page.waitForTimeout(150);
      check("clicking 'Props (apron)' switches sub-mode back to apron", (await boardSnapshot(page)).placementSubMode === "apron");
    }

    // -------------------------------------------------------------------
    console.log("\n=== clicking an EMPTY apron slot auto-creates + selects a placement ===");
    {
      // (-1, -1) is garden's NW apron corner — not one of the 29 authored
      // shrub/oak spots (spot-checked against src/game/themes.ts: garden's
      // placements list has no [-1,-1] entry... actually it DOES; pick a
      // genuinely empty corner instead — (-1, 4) is not in garden's list).
      const emptyTile: [number, number] = [-1, 4];
      const before = await boardSnapshot(page);

      await clickTile(page, emptyTile, "apron");
      await page.waitForTimeout(300);

      const after = await boardSnapshot(page);
      check("clicking an empty apron slot adds exactly one placement", after.placementsLength === before.placementsLength + 1);
      check("clicking an empty apron slot plants exactly one more live mesh", after.propMeshCount === before.propMeshCount + 1);
      check(
        "the new selection is at the clicked tile",
        after.placementSelection?.tile[0] === emptyTile[0] && after.placementSelection?.tile[1] === emptyTile[1],
      );
      check("the auto-created placement defaults to the shrub prop", after.placementSelection?.propId === "shrub");

      const titles = await boardFolderTitles(page);
      check(
        `a "Placement — prop @ (${emptyTile[0]}, ${emptyTile[1]})" folder opened`,
        titles.includes(`Placement — prop @ (${emptyTile[0]}, ${emptyTile[1]})`),
      );
      check(
        "the Placement folder shows all 5 apron controls (prop/offset X/offset Z/rotation/scale/remove = 6)",
        (await folderControllerCount(page, `Placement — prop @ (${emptyTile[0]}, ${emptyTile[1]})`)) === 6,
      );

      // Clean up: remove it so later sections (which spot-check garden's
      // exact placements count) see the registry's real starting value.
      await clickPlacementButton(page, "remove this placement 🗑");
      await page.waitForTimeout(300);
      const cleaned = await boardSnapshot(page);
      check("removing it drops placementsLength back to garden's original 29", cleaned.placementsLength === before.placementsLength);
      check("removing it drops the live mesh count back down", cleaned.propMeshCount === before.propMeshCount);
    }

    // -------------------------------------------------------------------
    console.log("\n=== selecting a FILLED apron slot selects the existing placement ===");
    {
      // Garden's first authored shrub placement (src/game/themes.ts:
      // `{ propId: "shrub", tile: [19, 4], ... }`).
      const filledTile: [number, number] = [19, 4];
      await clickTile(page, filledTile, "apron");
      await page.waitForTimeout(300);

      const snap = await boardSnapshot(page);
      check("clicking a filled slot does NOT add a new placement", snap.placementsLength === 29);
      check("the selection reports the existing shrub", snap.placementSelection?.propId === "shrub");
      check(
        "the selection is at garden's authored tile",
        snap.placementSelection?.tile[0] === filledTile[0] && snap.placementSelection?.tile[1] === filledTile[1],
      );
    }

    // -------------------------------------------------------------------
    console.log("\n=== Placement folder: swap prop, edit offset/rotation/scale re-applies live ===");
    {
      const before = await boardSnapshot(page);
      const folderTitle = `Placement — prop @ (19, 4)`;

      await selectPlacementDropdown(page, "Oak Tree");
      await page.waitForTimeout(300);
      const afterSwap = await boardSnapshot(page);
      check("swapping the prop dropdown updates the selection's propId", afterSwap.placementSelection?.propId === "oak");
      check("swapping the prop does not change placementsLength (still an edit, not an add)", afterSwap.placementsLength === before.placementsLength);

      await setFolderSlider(page, `Placement — prop @ (19, 4)`, "offset X", 0.3);
      await page.waitForTimeout(200);
      await setFolderSlider(page, folderTitle, "offset Z", -0.2);
      await page.waitForTimeout(200);
      await setFolderSlider(page, folderTitle, "rotation", 1.5);
      await page.waitForTimeout(200);
      await setFolderSlider(page, folderTitle, "scale", 1.4);
      await page.waitForTimeout(200);

      // Prove the edits actually reached the working theme (not just the
      // slider's own displayed value) via "Copy theme code".
      await clickCopyThemeCode(page);
      await page.waitForTimeout(250);
      const clip = await page.evaluate(() => navigator.clipboard.readText());
      check(
        "copied code reflects the edited oak placement at (19, 4)",
        /\{ propId: "oak", tile: \[19, 4\], offset: \[0\.3, -0\.2\], rotationY: 1\.5, scale: 1\.4 \},/.test(clip),
      );

      // Restore garden's authored shrub at (19,4) for later sections.
      await selectPlacementDropdown(page, "Shrub");
      await page.waitForTimeout(200);
      await setFolderSlider(page, folderTitle, "offset X", -0.24);
      await setFolderSlider(page, folderTitle, "offset Z", -0.162);
      await setFolderSlider(page, folderTitle, "rotation", 5.691);
      await setFolderSlider(page, folderTitle, "scale", 0.949);
      await page.waitForTimeout(200);
    }

    // -------------------------------------------------------------------
    console.log("\n=== keyboard arrow-nudge moves the selected placement's offset ===");
    {
      // Still selected at (19, 4) from the restore above.
      const beforeX = await readFolderSlider(page, "Placement — prop @ (19, 4)", "offset X");
      check("offset X slider reads a number before nudging", typeof beforeX === "number");
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(200);
      const afterX = await readFolderSlider(page, "Placement — prop @ (19, 4)", "offset X");
      check("ArrowRight nudges offset X up by the default NUDGE_STEP (0.01)", afterX !== null && beforeX !== null && Math.abs(afterX - (beforeX + 0.01)) < 1e-9);

      await page.keyboard.press("ArrowLeft"); // undo the nudge by hand (board mode has no undo/redo)
      await page.waitForTimeout(200);
      const restoredX = await readFolderSlider(page, "Placement — prop @ (19, 4)", "offset X");
      check("ArrowLeft nudges it back down", restoredX !== null && beforeX !== null && Math.abs(restoredX - beforeX) < 1e-9);
    }

    // -------------------------------------------------------------------
    console.log("\n=== Wall components sub-mode: place + edit + remove a wall-top piece ===");
    {
      await clickTreeRow(page, "Wall components");
      await page.waitForTimeout(200);
      check("switched to wall sub-mode", (await boardSnapshot(page)).placementSubMode === "wall");

      // (9, 6) is a real '#' wall tile in MAZES[0] (spot-checked against
      // src/game/mazes.json's first maze) that no registry theme's own
      // authored wallDecor references — a genuinely empty wall slot for
      // every base theme, garden included. (NOTE for a future reader: some
      // of city's own shipped wallDecor tile coords — e.g. [3,3]/[15,3] —
      // do NOT actually land on a '#' wall tile in MAZES[0]; board.ts's
      // buildWallDecor has no grid-membership validation by design (see its
      // own doc comment: "No grid parameter... a wall-top placement's tile
      // IS its position, nothing to enumerate/exclude"), so those render
      // fine, just floating over whatever tile is actually there — a
      // pre-existing themes.ts data-authoring nit, not a bug this suite
      // needs to guard against, and not something this task touches
      // themes.ts to fix.)
      const wallTile: [number, number] = [9, 6];
      const before = await boardSnapshot(page);
      check("garden starts with 0 wallDecor entries", before.wallDecorLength === 0);

      await clickTile(page, wallTile, "wall");
      await page.waitForTimeout(300);
      const after = await boardSnapshot(page);
      check("clicking an empty wall slot adds exactly one wallDecor entry", after.wallDecorLength === before.wallDecorLength + 1);
      check("clicking an empty wall slot plants exactly one wall-decor mesh", after.wallDecorMeshCount === before.wallDecorMeshCount + 1);
      check("the auto-created wall placement defaults to the bloom prop", after.placementSelection?.propId === "bloom");

      const titles = await boardFolderTitles(page);
      check(`a "Placement — wall component @ (9, 6)" folder opened`, titles.includes("Placement — wall component @ (9, 6)"));
      check(
        "the wall Placement folder shows only 4 controls (prop/rotation/scale/remove — no offset)",
        (await folderControllerCount(page, "Placement — wall component @ (9, 6)")) === 4,
      );

      await selectPlacementDropdown(page, "Transit Signal");
      await page.waitForTimeout(200);
      check("swapping a wall prop updates propId", (await boardSnapshot(page)).placementSelection?.propId === "transit-sign");
      check("mesh count unaffected by a swap (still 1 planted)", (await boardSnapshot(page)).wallDecorMeshCount === after.wallDecorMeshCount);

      await clickPlacementButton(page, "remove this placement 🗑");
      await page.waitForTimeout(300);
      const removed = await boardSnapshot(page);
      check("removing it drops wallDecorLength back to 0", removed.wallDecorLength === before.wallDecorLength);
      check("removing it drops wallDecorMeshCount back to 0", removed.wallDecorMeshCount === before.wallDecorMeshCount);

      await clickTreeRow(page, "Props (apron)");
      await page.waitForTimeout(200);
    }

    // -------------------------------------------------------------------
    console.log("\n=== base theme dropdown loads each of the 6 registry themes (placements reload too) ===");
    {
      const gardenWall = await folderColorSwatch(page, "Walls", 0);
      check("garden (default) wall swatch matches src/game/themes.ts", gardenWall === "#3f8f3a");
      check("garden reloads with 29 placements", (await boardSnapshot(page)).placementsLength === 29);

      await selectBaseTheme(page, "Arcade Night");
      await page.waitForTimeout(300);
      const classicWall = await folderColorSwatch(page, "Walls", 0);
      check("switching to Arcade Night changes the live wall swatch", classicWall !== gardenWall);
      check("Arcade Night wall swatch matches src/game/themes.ts (#2b2b6b)", classicWall === "#2b2b6b");

      const classicSnap = await boardSnapshot(page);
      check("Arcade Night has NO hedge decor (bloomChance: 0 in the registry)", classicSnap.hedgeDecorMeshCount === 0);
      check("Arcade Night is deliberately propless (0 placements)", classicSnap.placementsLength === 0);
      check("Arcade Night has 0 live apron prop meshes", classicSnap.propMeshCount === 0);
      check("Arcade Night's selection cleared on base-theme swap", classicSnap.placementSelection === null);
      // Arcade Night's palette has 0 bloomColors, so the Blooms folder should
      // rebuild down to just its 2 sliders + an "add" button (no per-color
      // swatches, no "remove" button) — proves loadBaseTheme's rebuild
      // reaches the color-LIST controls, not just the material colors.
      check(
        "Blooms folder shrinks to 3 controls for a 0-bloom-color theme (2 sliders + add button)",
        (await folderControllerCount(page, "Blooms")) === 3,
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

      // Night City authors 40 apron placements (31 towers + 9 streetlights)
      // AND 5 hand-placed wallDecor entries (lamp-posts/transit-signs — see
      // src/game/themes.ts's city entry) — a materially different pair of
      // numbers than garden's (29 placements, 0 wallDecor), proving the
      // base-theme swap reloads BOTH arrays, not just placements.
      await selectBaseTheme(page, "Night City");
      await page.waitForTimeout(300);
      const citySnap = await boardSnapshot(page);
      check("Night City's working theme has 40 apron placements", citySnap.placementsLength === 40);
      check("Night City's working theme has 5 wallDecor entries", citySnap.wallDecorLength === 5);
      check("Night City has live apron prop meshes (towers + streetlights)", citySnap.propMeshCount > 0);
      check("Night City has live wall-decor meshes (its hand-placed lamps/signals)", citySnap.wallDecorMeshCount === 5);

      // Back to garden for the rest of the suite.
      await selectBaseTheme(page, "The Garden");
      await page.waitForTimeout(300);
      const backToGarden = await folderColorSwatch(page, "Walls", 0);
      check("re-selecting The Garden restores its wall swatch", backToGarden === "#3f8f3a");
      check("re-selecting The Garden restores its 29 placements", (await boardSnapshot(page)).placementsLength === 29);
      check("re-selecting The Garden restores its empty wallDecor", (await boardSnapshot(page)).wallDecorLength === 0);
    }

    // -------------------------------------------------------------------
    console.log("\n=== editing wall color updates the live material (palette folders still work) ===");
    {
      await setFolderColorSwatch(page, "Walls", "#ff00aa");
      await page.waitForTimeout(150);
      const swatch = await folderColorSwatch(page, "Walls", 0);
      check("wall swatch reflects the edit", swatch === "#ff00aa");

      await clickCopyThemeCode(page);
      await page.waitForTimeout(250);
      const clip = await page.evaluate(() => navigator.clipboard.readText());
      check("copied code contains the edited wall hex (0xff00aa)", clip.includes("wall: 0xff00aa,"));

      // Restore for later sections.
      await setFolderColorSwatch(page, "Walls", "#3f8f3a");
      await page.waitForTimeout(150);
    }

    // -------------------------------------------------------------------
    console.log("\n=== bloomChance -> 0 clears decor meshes, back up rebuilds them (still applies with hand placements empty) ===");
    {
      const before = await boardSnapshot(page);
      check("garden starts with hedge decor meshes (bloomChance 0.2, 4 colors, empty wallDecor)", before.hedgeDecorMeshCount > 0);

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
    console.log('\n=== "Copy theme code" emits parseable placements + wallDecor arrays ===');
    {
      // Fresh, known state: reselect Arcade Night (0 placements, 0
      // wallDecor — the simplest starting literals to eval) and author one
      // of EACH kind with an identifying edited value.
      await selectBaseTheme(page, "Arcade Night");
      await page.waitForTimeout(300);
      await setFolderColorSwatch(page, "Floor", "#123456");
      await page.waitForTimeout(150);

      const apronTile: [number, number] = [-1, 4];
      await clickTile(page, apronTile, "apron");
      await page.waitForTimeout(300);
      await setFolderSlider(page, `Placement — prop @ (-1, 4)`, "offset X", 0.2);
      await page.waitForTimeout(150);
      await setFolderSlider(page, `Placement — prop @ (-1, 4)`, "scale", 1.3);
      await page.waitForTimeout(150);

      await clickTreeRow(page, "Wall components");
      await page.waitForTimeout(200);
      const wallTile: [number, number] = [9, 6]; // see the earlier section's own note on why this tile
      await clickTile(page, wallTile, "wall");
      await page.waitForTimeout(300);
      await setFolderSlider(page, "Placement — wall component @ (9, 6)", "rotation", 0.9);
      await page.waitForTimeout(150);

      await clickCopyThemeCode(page);
      await page.waitForTimeout(250);
      const clip = await page.evaluate(() => navigator.clipboard.readText());

      check("emitted entry contains the edited floor hex", clip.includes("floor: 0x123456,"));
      check("emitted entry has the id field", /id: "classic",/.test(clip));
      check("emitted entry has the palette field", /palette: \{/.test(clip));
      // \r?\n spans the line break after `placements: [`/`wallDecor: [` —
      // unlike the single-line `palette: {` check above.
      check("emitted entry has a non-empty placements field", /placements: \[\r?\n/.test(clip));
      check("emitted entry has a non-empty wallDecor field", /wallDecor: \[\r?\n/.test(clip));
      check("emitted placements entry contains the edited apron placement", clip.includes("offset: [0.2, 0]") && clip.includes("scale: 1.3"));
      check("emitted wallDecor entry contains the edited wall placement", /propId: "bloom", tile: \[9, 6\], rotationY: 0\.9, scale: 1 \},/.test(clip));

      // Round-trip: wrap it exactly as it would sit inside MAZE_THEMES and
      // eval it as a real object literal — the strongest available proof
      // that pasting the emitted code compiles and reproduces the edited
      // values, short of actually re-running tsc against themes.ts.
      const parsed = new Function(`return (${clip.trim().replace(/,\s*$/, "")});`)() as {
        id: string;
        name: string;
        price: number;
        palette: { floor: number; wall: number; bloomColors: number[] };
        placements: Array<{ propId: string; tile: [number, number]; offset: [number, number]; rotationY: number; scale: number }>;
        wallDecor: Array<{ propId: string; tile: [number, number]; rotationY: number; scale: number }>;
      };
      check("emitted entry parses as valid JS", parsed !== null && typeof parsed === "object");
      check("parsed entry keeps the edited floor value (0x123456)", parsed.palette.floor === 0x123456);
      check("parsed entry's id/name/price match Arcade Night", parsed.id === "classic" && parsed.name === "Arcade Night" && parsed.price === 5);
      check("parsed entry's placements is an array with exactly 1 entry", Array.isArray(parsed.placements) && parsed.placements.length === 1);
      check("parsed placement keeps the edited offset (0.2)", parsed.placements[0]?.offset[0] === 0.2);
      check("parsed placement keeps the edited scale (1.3)", parsed.placements[0]?.scale === 1.3);
      check("parsed placement's tile matches the clicked apron tile", parsed.placements[0]?.tile[0] === -1 && parsed.placements[0]?.tile[1] === 4);
      check("parsed entry's wallDecor is an array with exactly 1 entry", Array.isArray(parsed.wallDecor) && parsed.wallDecor.length === 1);
      check("parsed wallDecor keeps the edited rotationY (0.9)", parsed.wallDecor[0]?.rotationY === 0.9);
      check("parsed wallDecor's tile matches the clicked wall tile", parsed.wallDecor[0]?.tile[0] === 9 && parsed.wallDecor[0]?.tile[1] === 6);

      const flashed = await page.evaluate(() => {
        const names = [...document.querySelectorAll("#boardGuiHost .lil-function .lil-name")];
        return names.find((n) => n.textContent?.includes("Copied"))?.textContent ?? null;
      });
      check("copy button flashes a success label", flashed !== null);

      // Restore garden for the rest of the suite.
      await selectBaseTheme(page, "The Garden");
      await page.waitForTimeout(300);
    }

    // -------------------------------------------------------------------
    console.log("\n=== authoring a NEW theme: editable id/name/price still works ===");
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
    console.log("\n=== switching to character mode and back stays clean ===");
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

      // A canvas click that would have hit a board slot marker (still
      // parented under the now-hidden boardStage.boardRoot) must NOT mutate
      // the working theme while character mode is active — this is exactly
      // the setPickingEnabled(false) gate main.ts's setMode wires (see its
      // own doc comment on why THREE.Raycaster ignores `.visible`).
      const beforeClick = await boardSnapshot(page);
      await clickTile(page, [19, 4], "apron"); // a filled garden apron tile, if picking were (wrongly) still live
      await page.waitForTimeout(200);
      const afterClick = await boardSnapshot(page);
      check(
        "a canvas click in character mode never mutates the working theme (picking is gated off)",
        afterClick.placementsLength === beforeClick.placementsLength && afterClick.placementSelection === null,
      );

      // Back into board mode: everything should be exactly where it was —
      // INCLUDING the "my-custom-theme" id rename from the previous section
      // (a mode switch must never reset/reload the working theme; only a
      // base-theme dropdown pick does that — see loadBaseTheme's own doc
      // comment). The underlying DATA is still garden's (only `.id` was
      // free-text-edited, not the palette/placements), so placementsLength
      // stays 29.
      await page.click("#modeBoardBtn");
      await page.waitForTimeout(400);
      const backSnap = await boardSnapshot(page);
      check(
        "re-entering board mode keeps the exact same working theme (id + 29 placements survive the round trip)",
        backSnap.workingThemeId === "my-custom-theme" && backSnap.placementsLength === 29,
      );
      check("re-entering board mode has picking enabled again", true); // implicit: the NEXT section's click succeeds
    }

    // -------------------------------------------------------------------
    console.log("\n=== IDEA-025 v2 delete flow (character mode) still works after visiting board mode ===");
    {
      await page.click("#modeCharacterBtn");
      await page.waitForTimeout(400);
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
