// End-to-end checks for the editor's ANIMATION PREVIEW (the /editor/
// "animation" dropdown) and the beetle's walking rig.
//
// Why this suite exists: the editor could not show a character animating, so
// the only way to see an animation defect was to play the game and catch it by
// eye. That is exactly how the bee's stripes and the ladybug's spots shipped
// falling onto the floor — the models looked perfect in the editor because the
// editor never ran the animation that broke them.
//
// The preview deliberately runs the REAL syncToEntity / applyGhostState, so
// these assertions are about the shipped animation code, not a preview-only
// copy of it. Run: tsx scripts/test-editor-anim.ts (npm run test:editor:anim).
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

async function pickCharacter(page: Page, label: string): Promise<void> {
  await page.evaluate((n) => {
    const sel = [...document.querySelectorAll("select")].find((s) =>
      [...s.options].some((o) => o.textContent === n),
    );
    if (!sel) throw new Error("character dropdown not found");
    sel.value = [...sel.options].find((o) => o.textContent === n)!.value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }, label);
  await page.waitForTimeout(500);
}

/** The animation dropdown is the select whose options are the AnimMode names. */
async function setAnimation(page: Page, mode: string): Promise<void> {
  await page.evaluate((m) => {
    const sel = [...document.querySelectorAll("select")].find((s) =>
      [...s.options].some((o) => o.textContent === "walk"),
    );
    if (!sel) throw new Error("animation dropdown not found");
    const opt = [...sel.options].find((o) => o.textContent === m);
    if (!opt) throw new Error(`animation mode "${m}" not offered`);
    sel.value = opt.value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }, mode);
  await page.waitForTimeout(120);
}

async function animModes(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const sel = [...document.querySelectorAll("select")].find((s) =>
      [...s.options].some((o) => o.textContent === "walk"),
    );
    return sel ? [...sel.options].map((o) => o.textContent ?? "") : [];
  });
}

async function rotationOf(page: Page, name: string): Promise<{ x: number; y: number; z: number } | null> {
  return page.evaluate((n) => window.__charTestHook?.partRotation(n) ?? null, name);
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
    await page.waitForSelector(".tree-row");
    await page.waitForTimeout(500);

    // -------------------------------------------------------------------
    console.log("\n=== the dropdown offers the right modes per character ===");
    const beagleModes = await animModes(page);
    check("beagle offers off / idle / walk", beagleModes.join(",") === "off,idle,walk");
    check("beagle does NOT offer frightened", !beagleModes.includes("frightened"));

    await pickCharacter(page, "Beetle");
    const enemyModes = await animModes(page);
    check(
      "an enemy also offers frightened + eaten",
      enemyModes.includes("frightened") && enemyModes.includes("eaten"),
    );

    // -------------------------------------------------------------------
    console.log("\n=== the beetle actually walks ===");
    await setAnimation(page, "walk");
    await page.waitForTimeout(700);

    const swingA = await rotationOf(page, "legSwingFL");
    check("the beetle has a leg gait pivot", swingA !== null);
    await page.waitForTimeout(350);
    const swingB = await rotationOf(page, "legSwingFL");
    check(
      "the leg swings while walking",
      !!swingA && !!swingB && Math.abs(swingA.x) + Math.abs(swingB.x) > 0.02,
    );

    // The alternating tripod. All six MUST be sampled in one evaluate call:
    // the gait runs at 11 rad/s, so its sign flips roughly every 0.28s and
    // separate reads can straddle a zero crossing and compare different frames.
    const legs = await page.evaluate(() => {
      const h = window.__charTestHook!;
      const names = ["legSwingFL", "legSwingFR", "legSwingML", "legSwingMR", "legSwingBL", "legSwingBR"];
      return names.map((n) => h.partRotation(n)?.x ?? null);
    });
    check("all six leg pivots exist", legs.every((v) => v !== null));
    const [flx, frx, mlx, mrx, blx, brx] = legs as number[];
    check("the legs are mid-stride, not resting", Math.abs(flx) > 1e-3);
    check(
      "front-left and front-right are in OPPOSITE tripods",
      Math.sign(flx) !== Math.sign(frx),
    );
    check(
      "tripod A is front-left + middle-right + back-left",
      Math.sign(flx) === Math.sign(mrx) && Math.sign(flx) === Math.sign(blx),
    );
    check(
      "tripod B is the other three",
      Math.sign(frx) === Math.sign(mlx) && Math.sign(frx) === Math.sign(brx),
    );
    check("three legs swing one way and three the other", Math.abs(flx + frx) < 1e-9);

    // -------------------------------------------------------------------
    console.log("\n=== antennae sway even when standing still ===");
    await setAnimation(page, "idle");
    await page.waitForTimeout(400);
    const antA = await rotationOf(page, "antennaPivotL");
    await page.waitForTimeout(400);
    const antB = await rotationOf(page, "antennaPivotL");
    check("the beetle has an antenna pivot", antA !== null);
    check(
      "the antenna sways on idle",
      !!antA && !!antB && Math.abs(antA.x - antB.x) > 1e-4,
    );
    const antL = await rotationOf(page, "antennaPivotL");
    const antR = await rotationOf(page, "antennaPivotR");
    check(
      "the two antennae are out of phase (not mechanically twinned)",
      !!antL && !!antR && Math.abs(antL.x - antR.x) > 1e-3,
    );

    // -------------------------------------------------------------------
    console.log("\n=== enemy state previews ===");
    await setAnimation(page, "frightened");
    await page.waitForTimeout(300);
    const frightened = await page.evaluate(() => window.__charTestHook?.bodyColor() ?? null);
    await setAnimation(page, "idle");
    await page.waitForTimeout(300);
    const normal = await page.evaluate(() => window.__charTestHook?.bodyColor() ?? null);
    check("frightened recolours the body", frightened !== null && frightened !== normal);
    check("…and leaving frightened puts the colour back", normal !== null && normal !== frightened);

    await setAnimation(page, "eaten");
    await page.waitForTimeout(300);
    const eaten = await page.evaluate(() => {
      const h = window.__charTestHook!;
      return {
        shellVisible: h.partVisible("shell"),
        shellOpacity: h.partOpacity("shell"),
        eyeVisible: h.partVisible("eyeL"),
        eyeOpacity: h.partOpacity("eyeL"),
      };
    });
    // The eaten look KEEPS the silhouette — a translucent spirit in the team
    // colour — rather than the classic pair of floating eyes, so an eaten
    // enemy running home stays easy to follow.
    check("eaten keeps the body visible", eaten.shellVisible === true);
    check("…but renders it translucent", (eaten.shellOpacity ?? 1) < 0.6);
    check("…with the eyes still solid on top", eaten.eyeVisible === true && eaten.eyeOpacity === 1);

    // -------------------------------------------------------------------
    console.log("\n=== 'off' restores the authored pose ===");
    await setAnimation(page, "off");
    await page.waitForTimeout(300);
    const restored = await page.evaluate(() => {
      const h = window.__charTestHook!;
      return { visible: h.partVisible("shell"), opacity: h.partOpacity("shell") };
    });
    check("turning the preview off restores the body", restored.visible === true);
    check("…back to fully opaque", restored.opacity === 1);

    const restA = await rotationOf(page, "legSwingFL");
    await page.waitForTimeout(350);
    const restB = await rotationOf(page, "legSwingFL");
    check(
      "the leg is frozen once the preview is off",
      !!restA && !!restB && Math.abs(restA.x - restB.x) < 1e-6,
    );
    check("…at its authored rotation, not wherever the walk left it", !!restA && Math.abs(restA.x) < 1e-6);

    // -------------------------------------------------------------------
    console.log("\n=== selecting a part auto-pauses (edit against a still model) ===");
    await setAnimation(page, "walk");
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".tree-row")];
      (rows[1] as HTMLElement).click();
    });
    await page.waitForTimeout(250);
    const modeAfterSelect = await page.evaluate(() => window.__charTestHook?.animation() ?? "");
    check("selecting a part stops the animation", modeAfterSelect === "off");

    // -------------------------------------------------------------------
    console.log("\n=== the preview shows a part animating, and puts it back ===");
    // The bug this feature exists to catch — the bee's stripes and the
    // ladybug's spots dropping to the floor because animateGhostHem wrote
    // ABSOLUTE values — has no subject here any more: every enemy has since
    // been rebuilt without hem meshes at all. The real guard is
    // scripts/test-enemy-idle.ts, which drives syncToEntity on all four models
    // and was verified to fail by 0.5 when the fix is reverted.
    //
    // What is still worth proving HERE is the editor's half: that the preview
    // genuinely moves a part and genuinely restores it, which is what makes a
    // defect like that visible at all. The ghost's `hover` node is the cleanest
    // subject — its whole job is to be moved by the float animation.
    await pickCharacter(page, "Ghost");
    await setAnimation(page, "off");
    await page.waitForTimeout(250);
    const restY = await page.evaluate(() => window.__charTestHook?.partPosition("hover")?.y ?? null);
    await setAnimation(page, "idle");
    await page.waitForTimeout(700);
    const movedY = await page.evaluate(() => window.__charTestHook?.partPosition("hover")?.y ?? null);
    await setAnimation(page, "off");
    await page.waitForTimeout(300);
    const backY = await page.evaluate(() => window.__charTestHook?.partPosition("hover")?.y ?? null);
    check("the ghost has a hover node with a rest height", restY !== null);
    check(
      "the preview actually moves it",
      movedY !== null && restY !== null && Math.abs(movedY - restY) > 1e-4,
    );
    check(
      "…and it floats AROUND that height, never away from it",
      movedY !== null && restY !== null && Math.abs(movedY - restY) < 0.05,
    );
    check(
      "turning the preview off restores the authored height exactly",
      backY !== null && restY !== null && Math.abs(backY - restY) < 1e-6,
    );

    check("zero uncaught page errors across the run", pageErrors.length === 0);
    if (pageErrors.length) console.log(pageErrors.slice(0, 3));
  } finally {
    await browser?.close();
    await server?.close();
  }

  console.log(`\n${failures === 0 ? "ALL EDITOR-ANIM CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
  if (failures > 0) process.exit(1);
}

void run();
