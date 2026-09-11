// IDEA-062 v4: the Balance tab — src/game/config.ts in the editor.
//
// WRITES A REAL GAME FILE, so it copies test-editor-board.ts's discipline: a
// `.bak` SIDECAR written before the first write, restored on startup if one is
// found. A `finally` covers a failed assertion but NOT the process being
// killed, and piping this suite through `head`/`tail` closes stdout, raises
// EPIPE and kills it — redirect to a file and read that.
//
// config.ts is the most consequential file the editor can write: it feeds the
// SERVER's plausibility bounds through `npm run sync`, so a bad rewrite does
// not look like a bug locally, it looks like players' honest runs being
// rejected in production. The pure half of this lives in
// scripts/test-config-rewrite.ts; this suite is the wiring and the sync gate.
import { createServer, type ViteDevServer } from "vite";
import { chromium, type Browser, type Page } from "playwright";
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const CONFIG = resolve("src/game/config.ts");
const BACKUP = `${CONFIG}.bak`;

let failures = 0;
function check(label: string, cond: boolean): void {
  if (cond) console.log(`  ok   ${label}`);
  else {
    console.log(`  FAIL ${label}`);
    failures++;
  }
}

// A stale sidecar means a previous run was killed mid-write. Restore first.
if (existsSync(BACKUP)) {
  console.log("! found a stale config.ts.bak — a previous run was killed. Restoring it.");
  writeFileSync(CONFIG, readFileSync(BACKUP, "utf-8"), "utf-8");
  rmSync(BACKUP, { force: true });
}

async function setBalance(page: Page, path: string, value: number): Promise<void> {
  await page.evaluate(
    ({ path, value }) => {
      const ctrl = document.querySelector(`#balanceGuiHost [data-testid="balance:${path}"]`);
      if (!ctrl) throw new Error(`no balance control for ${path}`);
      const el = (ctrl.querySelector('input[type="range"]') ??
        ctrl.querySelector('input:not([type="range"])')) as HTMLInputElement | null;
      if (!el) throw new Error(`no input for ${path}`);
      el.value = String(value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    { path, value },
  );
}

async function run(): Promise<void> {
  let server: ViteDevServer | undefined;
  let browser: Browser | undefined;
  const original = readFileSync(CONFIG, "utf-8");
  try {
    server = await createServer({ server: { port: 0, strictPort: false }, logLevel: "error" });
    await server.listen();
    const addr = server.httpServer?.address();
    const port = typeof addr === "object" && addr ? addr.port : null;
    if (!port) throw new Error("dev server did not report a port");
    console.log(`Editor dev server up at http://localhost:${port}/editor/`);

    browser = await chromium.launch();
    const ctx = await browser.newContext({ reducedMotion: "reduce" });
    await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
    const page = await ctx.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error") pageErrors.push(m.text());
    });

    await page.goto(`http://localhost:${port}/editor/`);
    await page.waitForSelector(".tree-row");
    await page.waitForTimeout(400);

    console.log("\n=== the tab opens and every group is there ===");
    {
      await page.click("#modeBalanceBtn");
      await page.waitForTimeout(600);
      const mode = await page.evaluate(() => window.__boardTestHook?.mode());
      check("balance mode is active", mode === "balance");
      check("the GUI host is visible", await page.isVisible("#balanceGuiHost"));
      // No tree, no viewport — this tab is a form (balanceInspector.ts's header).
      check(
        "the layout drops the tree/viewport columns",
        await page.evaluate(() => document.getElementById("editorApp")!.classList.contains("mode-balance")),
      );

      // THE regression this pins: a grid area that does not exist does NOT
      // hide the element naming it — the browser auto-places it into an
      // implicit track. Balance's first layout omitted the `tree`/`viewport`
      // areas and looked like a styling nit; what it actually produced was a
      // mode bar squeezed to 566px, the pane as a small island in the
      // top-left, and the 3D SKY still on screen in a tab with no scene.
      // NOTE: no helper FUNCTION declared inside this evaluate. tsx/esbuild
      // compiles a named arrow in here through its `keepNames` helper, which
      // emits a `__name(...)` call that does not exist in the browser — the
      // page throws `ReferenceError: __name is not defined` and the failure
      // looks nothing like its cause. Keep evaluate bodies to plain
      // expressions.
      const layout = await page.evaluate(() => {
        const vp = document.getElementById("viewportPane")!;
        const tp = document.getElementById("treePane")!;
        const vpBox = vp.getBoundingClientRect();
        const tpBox = tp.getBoundingClientRect();
        return {
          viewport: getComputedStyle(vp).display !== "none" && vpBox.width > 0 && vpBox.height > 0,
          tree: getComputedStyle(tp).display !== "none" && tpBox.width > 0 && tpBox.height > 0,
          modeBarW: document.getElementById("modeBar")!.getBoundingClientRect().width,
          guiW: document.getElementById("guiPane")!.getBoundingClientRect().width,
          win: window.innerWidth,
        };
      });
      check("the 3D viewport pane is GONE, not merely unused", !layout.viewport);
      check("the tree pane is GONE too", !layout.tree);
      check(
        `the mode bar spans the full window (${Math.round(layout.modeBarW)} of ${layout.win})`,
        layout.modeBarW >= layout.win - 4,
      );
      check(
        `the pane fills the width rather than floating as an island (${Math.round(layout.guiW)} of ${layout.win})`,
        layout.guiW >= layout.win - 4,
      );

      // All eight groups OPEN and laid out in columns — a balance pass plays
      // speeds off against score off against the thresholds, so they have to
      // be visible together.
      const openFolders = await page.$$eval(
        "#balanceGuiHost .lil-gui.lil-gui:not(.lil-root)",
        (els) => els.filter((e) => !e.classList.contains("lil-closed")).length,
      );
      check(`every group is open (${openFolders})`, openFolders >= 8);
      const cols = await page.evaluate(() => {
        const children = document.querySelector("#balanceGuiHost > .lil-gui.lil-root > .lil-children");
        return getComputedStyle(children as Element).columnWidth;
      });
      check(`the groups run in newspaper columns (column-width ${cols})`, cols !== "auto" && cols !== "");

      const titles = await page.$$eval("#balanceGuiHost .lil-gui .lil-title", (els) =>
        els.map((e) => e.textContent ?? ""),
      );
      for (const t of ["Speeds", "Score", "Timing", "Lives", "Coins", "Fruit", "Power-ups"]) {
        check(`group "${t}" is present`, titles.some((x) => x.includes(t)));
      }
    }

    console.log("\n=== controls are seeded from the real file ===");
    {
      const shown = await page.evaluate(() => {
        const ctrl = document.querySelector('#balanceGuiHost [data-testid="balance:SPEEDS.beagle"]');
        const el = ctrl?.querySelector('input:not([type="range"])') as HTMLInputElement | null;
        return el ? Number(el.value) : null;
      });
      check(`SPEEDS.beagle shows the shipped 5.2 (got ${shown})`, shown === 5.2);
    }

    console.log("\n=== save writes the numbers and leaves the prose alone ===");
    {
      writeFileSync(BACKUP, original, "utf-8"); // sidecar BEFORE the first write
      await setBalance(page, "SPEEDS.beagle", 6.4);
      await setBalance(page, "SCORE.biscuit", 12);
      await page.waitForTimeout(300);
      await page.click("#saveConfigFileBtn");
      await page.waitForTimeout(1600);

      const written = readFileSync(CONFIG, "utf-8");
      check("config.ts changed on disk", written !== original);
      check("the new beagle speed is in the file", /beagle:\s*6\.4,/.test(written));
      check("the new biscuit score is in the file", /biscuit:\s*12,/.test(written));
      check("the file's own header comment survives", written.startsWith("// Central tunables"));
      check("COINS' long explanation survives", written.includes("there is NO points-to-coins conversion"));
      check(
        "same line count — a token swap, not a regeneration",
        written.split("\n").length === original.split("\n").length,
      );
      const origLines = original.split("\n");
      check(
        "exactly two lines differ",
        written.split("\n").filter((l, i) => l !== origLines[i]).length === 2,
      );
      check(
        "the page SURVIVED its own save (no HMR reload)",
        await page.evaluate(() => document.getElementById("balanceGuiHost") !== null),
      );
    }

    console.log("\n=== the `npm run sync` gate is unmissable ===");
    {
      check("the sync panel is up after a save", await page.isVisible("#syncPanel"));
      const text = (await page.textContent("#syncPanel")) ?? "";
      check("it names the exact commands", text.includes("npm run sync") && text.includes("test:catalog"));
      check("it says what breaks if you skip it", text.includes("SCORE_ITEM_MISMATCH"));
      check("it does NOT auto-hide — it has a Dismiss button", text.includes("Dismiss"));
    }

    console.log("\n=== the written file is still valid TypeScript ===");
    {
      const written = readFileSync(CONFIG, "utf-8");
      const open = (written.match(/\{/g) ?? []).length;
      const close = (written.match(/\}/g) ?? []).length;
      check(`braces balance (${open}/${close})`, open === close);
      // A real re-import is the strongest signal short of tsc. pathToFileURL
      // is required on Windows — a bare "C:\..." path looks like an
      // unsupported URL scheme to Node's ESM loader.
      const url = `${pathToFileURL(CONFIG).href}?t=${Date.now()}`;
      const mod = (await import(url)) as { SPEEDS: { beagle: number }; SCORE: { biscuit: number } };
      check("it re-imports cleanly with the new beagle speed", mod.SPEEDS.beagle === 6.4);
      check("…and the new biscuit score", mod.SCORE.biscuit === 12);
    }

    check("zero uncaught page errors across the run", pageErrors.length === 0);
    if (pageErrors.length > 0) console.log("  page errors:", pageErrors.slice(0, 5));
  } finally {
    writeFileSync(CONFIG, original, "utf-8");
    const restored = readFileSync(CONFIG, "utf-8");
    check("src/game/config.ts restored to its original bytes", restored === original);
    if (restored === original) rmSync(BACKUP, { force: true });
    rmSync(`${CONFIG}.editorbak`, { force: true });
    await browser?.close();
    await server?.close();
  }
  console.log(`\n${failures === 0 ? "ALL BALANCE EDITOR CHECKS PASSED" : `${failures} BALANCE CHECK(S) FAILED`}`);
  if (failures > 0) process.exit(1);
}

run().catch((err) => {
  console.error("balance editor test run crashed:", err);
  if (existsSync(BACKUP)) writeFileSync(CONFIG, readFileSync(BACKUP, "utf-8"), "utf-8");
  process.exit(1);
});
