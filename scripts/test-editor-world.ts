// IDEA-062 v5: the World tab — the IDEA-060 garden machinery (the picket
// fence's geometry and the ground dressing's scatter) that no theme palette
// can reach.
//
// WRITES REAL RENDER FILES, so it takes test-editor-board.ts's discipline: a
// `.bak` sidecar per file written before the first write, restored on startup
// if one is found. A `finally` covers a failed assertion but NOT a killed
// process — do not pipe this suite through `head`/`tail` (EPIPE kills it);
// redirect to a file.
import { createServer, type ViteDevServer } from "vite";
import { chromium, type Browser, type Page } from "playwright";
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const FILES = [resolve("src/render/fence.ts"), resolve("src/render/groundDetail.ts")];

let failures = 0;
function check(label: string, cond: boolean): void {
  if (cond) console.log(`  ok   ${label}`);
  else {
    console.log(`  FAIL ${label}`);
    failures++;
  }
}

for (const f of FILES) {
  if (existsSync(`${f}.bak`)) {
    console.log(`! stale ${f}.bak — a previous run was killed. Restoring.`);
    writeFileSync(f, readFileSync(`${f}.bak`, "utf-8"), "utf-8");
    rmSync(`${f}.bak`, { force: true });
  }
}

async function setWorld(page: Page, path: string, value: number): Promise<void> {
  await page.evaluate(
    ({ path, value }) => {
      const ctrl = document.querySelector(`#worldGuiHost [data-testid="world:${path}"]`);
      if (!ctrl) throw new Error(`no world control for ${path}`);
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
  const originals = FILES.map((f) => readFileSync(f, "utf-8"));
  try {
    server = await createServer({ server: { port: 0, strictPort: false }, logLevel: "error" });
    await server.listen();
    const addr = server.httpServer?.address();
    const port = typeof addr === "object" && addr ? addr.port : null;
    if (!port) throw new Error("dev server did not report a port");
    console.log(`Editor dev server up at http://localhost:${port}/editor/`);

    browser = await chromium.launch();
    const page = await (await browser.newContext({ reducedMotion: "reduce" })).newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error") pageErrors.push(m.text());
    });

    await page.goto(`http://localhost:${port}/editor/`);
    await page.waitForSelector(".tree-row");
    await page.waitForTimeout(400);

    console.log("\n=== the tab opens over a real board ===");
    {
      await page.click("#modeWorldBtn");
      await page.waitForTimeout(1800);
      check("world mode is active", (await page.evaluate(() => window.__boardTestHook?.mode())) === "world");
      check("the GUI host is visible", await page.isVisible("#worldGuiHost"));
      // The whole point of this tab is that you are looking at the board it
      // dresses — a form with no board would be guessing.
      check(
        "a real board is rendered (walls exist)",
        (await page.evaluate(() => window.__boardTestHook?.wallCount() ?? 0)) > 0,
      );
      // Slot markers must NOT be pickable here: a click landing on one would
      // plant a prop nobody asked for.
      check("the fence readout is up", await page.isVisible("#fenceReadout"));
    }

    console.log("\n=== the readout measures the fence at PLAY size ===");
    {
      const text = (await page.textContent("#fenceReadout")) ?? "";
      check("it reports a picket width in px", /picket\s+[\d.]+px/.test(text));
      check("it reports the GAP, which is the number that matters", /gap\s+[\d.]+px/.test(text));

      // Drive the picket width past the cartoon floor and the readout must say
      // so — this is the rule the module documents, made checkable live.
      await setWorld(page, "FENCE_PARAMS.picketWidth", 0.235);
      await page.waitForTimeout(500);
      const warned = (await page.textContent("#fenceReadout")) ?? "";
      check("a too-wide picket trips the ~2px gap warning", warned.includes("cartoon floor"));
      check("…and the readout goes red", await page.evaluate(() =>
        document.getElementById("fenceReadout")!.classList.contains("warn")));

      await setWorld(page, "FENCE_PARAMS.picketWidth", 0.17);
      await page.waitForTimeout(400);
      check("back at the shipped width the warning clears",
        !((await page.textContent("#fenceReadout")) ?? "").includes("cartoon floor"));
    }

    console.log("\n=== an edit rebuilds the LIVE board ===");
    {
      const before = await page.evaluate(() => window.__boardTestHook?.wallCount() ?? 0);
      await setWorld(page, "GROUND_DETAIL_PARAMS.chance", 0.9);
      await page.waitForTimeout(700);
      check(
        "the board survived the rebuild",
        (await page.evaluate(() => window.__boardTestHook?.wallCount() ?? 0)) === before,
      );
      await setWorld(page, "GROUND_DETAIL_PARAMS.chance", 0.22);
      await page.waitForTimeout(500);
    }

    console.log("\n=== pickets stay a whole number ===");
    {
      // PITCH = TILE / pickets must divide the tile EXACTLY, or every tile
      // boundary shows a seam and a straight run reads as a row of separate
      // gates. A fractional value must never reach the file.
      await setWorld(page, "FENCE_PARAMS.pickets", 4.5);
      await page.waitForTimeout(500);
      const live = await page.evaluate(() => {
        const ctrl = document.querySelector('#worldGuiHost [data-testid="world:FENCE_PARAMS.pickets"]');
        const el = ctrl?.querySelector('input:not([type="range"])') as HTMLInputElement | null;
        return el ? Number(el.value) : null;
      });
      check(`4.5 was rounded to a whole number of pickets (got ${live})`, Number.isInteger(live));
      await setWorld(page, "FENCE_PARAMS.pickets", 4);
      await page.waitForTimeout(400);
    }

    console.log("\n=== save writes both files in place ===");
    {
      FILES.forEach((f, i) => writeFileSync(`${f}.bak`, originals[i], "utf-8"));
      await setWorld(page, "FENCE_PARAMS.proud", 0.07);
      await setWorld(page, "GROUND_DETAIL_PARAMS.radius", 0.24);
      await page.waitForTimeout(400);
      await page.click("#saveWorldFileBtn");
      await page.waitForTimeout(1800);

      const fence = readFileSync(FILES[0], "utf-8");
      const ground = readFileSync(FILES[1], "utf-8");
      check("fence.ts has the new `proud`", /proud:\s*0\.07,/.test(fence));
      check("groundDetail.ts has the new `radius`", /radius:\s*0\.24,/.test(ground));
      check("fence.ts keeps its own rule comments", fence.includes("THE PITCH DIVIDES THE TILE EXACTLY"));
      check("groundDetail.ts keeps its own rule comments", ground.includes("belongs to the biscuits"));
      check("fence.ts line count unchanged", fence.split("\n").length === originals[0].split("\n").length);
      check("groundDetail.ts line count unchanged", ground.split("\n").length === originals[1].split("\n").length);
      check(
        "the page SURVIVED its own save (no HMR reload)",
        await page.evaluate(() => document.getElementById("worldGuiHost") !== null),
      );
    }

    check("zero uncaught page errors across the run", pageErrors.length === 0);
    if (pageErrors.length > 0) console.log("  page errors:", pageErrors.slice(0, 5));
  } finally {
    FILES.forEach((f, i) => {
      writeFileSync(f, originals[i], "utf-8");
      const restored = readFileSync(f, "utf-8");
      check(`${f.split(/[\\/]/).pop()} restored to its original bytes`, restored === originals[i]);
      if (restored === originals[i]) rmSync(`${f}.bak`, { force: true });
      rmSync(`${f}.editorbak`, { force: true });
    });
    await browser?.close();
    await server?.close();
  }
  console.log(`\n${failures === 0 ? "ALL WORLD EDITOR CHECKS PASSED" : `${failures} WORLD CHECK(S) FAILED`}`);
  if (failures > 0) process.exit(1);
}

run().catch((err) => {
  console.error("world editor test run crashed:", err);
  FILES.forEach((f) => {
    if (existsSync(`${f}.bak`)) writeFileSync(f, readFileSync(`${f}.bak`, "utf-8"), "utf-8");
  });
  process.exit(1);
});
