// Browser-driven checks for the IDEA-049 thumbstick, in the REAL app: signs up,
// switches the account to the stick, starts a run, pushes it, and MEASURES.
//
//   docker compose up -d db api
//   npm run dev
//   npm run test:stick-ui        (or: npx tsx scripts/test-stick-ui.ts [baseUrl])
//
// Layout work here needs measuring, not asserting that elements exist. Every
// failure this file has actually caught was geometry: a lit gate the ball
// covered at full throw, a throw so short the ball looked stuck, and a stick
// centred in landscape over the middle of the maze.
//
// Two things to know before running it:
//   - reducedMotion: "reduce" on the context. The menu's Play card carries an
//     idle bob, and an element whose bounding box never settles never becomes
//     actionable — every click on #playBtn hangs forever without this.
//   - Signup is rate-limited to 5 per hour per IP (server/src/routes/auth.ts).
//     A few reruns exhaust it; restarting the api container clears the
//     in-memory counter.
//
// Screenshots land in .tmp-screens/ for a human look — which is the point of
// half of them.

import { chromium, type Page } from "playwright";
import { mkdirSync } from "node:fs";

const BASE_URL = process.argv[2] ?? "http://localhost:5175";
const SHOTS = ".tmp-screens";
mkdirSync(SHOTS, { recursive: true });

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean, detail?: unknown): void {
  if (cond) { passed++; console.log(`  ok   ${label}`); }
  else { failed++; console.log(`  FAIL ${label}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`); }
}

const uniqueName = (): string =>
  `st${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`.slice(0, 20);

async function signUp(page: Page): Promise<string> {
  const username = uniqueName();
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.waitForSelector("#authGate:not(.hidden)", { timeout: 25_000 });
  await page.waitForSelector("#signupForm");
  await page.fill("#signupUsername", username);
  await page.fill("#signupPassword", "a-decent-password");
  await page.click("#signupForm button[type=submit]");
  await page.waitForSelector("#recoveryCode:not(.hidden)", { timeout: 25_000 });
  await page.check("#recoverySavedCheck");
  await page.click("#recoveryContinueBtn");
  await page.waitForSelector("#mainMenu:not(.hidden)", { timeout: 25_000 });
  return username;
}

async function box(page: Page, sel: string) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom, right: r.right };
  }, sel);
}

async function main(): Promise<void> {
  const browser = await chromium.launch();

  // Portrait phone, coarse pointer, reduced motion (the Play card's idle bob
  // never settles otherwise and every click on it hangs).
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  const username = await signUp(page);
  console.log(`  (signed in as ${username})`);

  // --- the settings row ---
  await page.click("#menuProfileBtn");
  await page.waitForSelector("#profile:not(.hidden)");
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/stick-settings.png` });

  const opts = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".control-option")).map((el) => {
      const r = el.getBoundingClientRect();
      const glyph = el.querySelector(".control-icon");
      return {
        text: (el as HTMLElement).innerText.trim(),
        x: r.x,
        w: r.width,
        right: r.right,
        // The one measurement that can tell a rendered glyph from a font that
        // did not load. An icon element carries its LIGATURE NAME as its text,
        // so textContent says "joystick" either way — but the glyph is one em
        // square, and the word "joystick" set at 28px is four times wider.
        // This is the failure the self-hosted subset exists to prevent, and
        // adding an icon is exactly when it can come back.
        glyphWidth: glyph ? glyph.getBoundingClientRect().width : -1,
      };
    }),
  );
  ok("three control options", opts.length === 3, opts);
  ok("all three fit on screen", opts.every((o) => o.x >= 0 && o.right <= 390), opts);
  ok(
    "every icon renders as a GLYPH, not as its ligature name",
    opts.every((o) => o.glyphWidth > 8 && o.glyphWidth < 44),
    opts.map((o) => [o.text.split("\n")[1], o.glyphWidth]),
  );
  const note = await page.evaluate(() => document.querySelector(".control-note")?.textContent ?? "");
  ok("a note describes the chosen scheme", note.trim().length > 10, note);

  await page.click("#controlStick");
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${SHOTS}/stick-settings-chosen.png` });
  const chosen = await page.evaluate(
    () => document.querySelector("#controlStick")?.getAttribute("aria-pressed"),
  );
  ok("choosing Stick marks it pressed", chosen === "true", chosen);

  // --- in the run ---
  await page.click("#profileCloseBtn");
  await page.waitForSelector("#profile.hidden", { state: "attached", timeout: 5_000 });
  await page.click("#playBtn");

  // First run, so the how-to-play carousel opens over the top — and its first
  // slide is the one this scheme changes. Shoot it here rather than reopening
  // it later: this is where a real player meets it.
  await page.waitForSelector("#tutorial:not(.hidden)", { timeout: 15_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/stick-tutorial.png` });
  const diagram = await box(page, ".tut-stick .stick-plate");
  ok("the tutorial draws the stick diagram", !!diagram && diagram.w > 60, diagram);
  const tutBody = await page.evaluate(() => document.querySelector(".tut-body")?.textContent ?? "");
  ok("…with the stick's own copy", /stick/i.test(tutBody), tutBody);
  ok("…which says the thumb can stay put", /leave your thumb/i.test(tutBody), tutBody);
  await page.click(".tut-skip");
  await page.waitForSelector("#tutorial.hidden", { state: "attached", timeout: 10_000 });

  await page.waitForSelector(".stick:not(.hidden)", { timeout: 15_000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${SHOTS}/stick-run.png` });

  const stick = await box(page, ".stick");
  const plate = await box(page, ".stick-plate");
  const well = await box(page, ".stick-well");
  const ball = await box(page, ".stick-ball");
  const hud = await box(page, ".hud");
  ok("the stick is on screen", !!stick && stick.bottom <= 844 && stick.x >= 0, stick);
  ok("the plate is round and full size", !!plate && Math.abs(plate.w - plate.h) < 1 && plate.w > 120, plate);
  ok("the ball is a 44px+ touch target", !!ball && ball.w >= 44, ball);
  // The throw is short by design (the direction is read from the ANGLE of the
  // push, so length buys nothing but dead-zone room) — but it has to be real
  // enough to SEE, or the ball looks stuck and only the gate answers.
  const throwRadius = well && ball ? (well.w - ball.w) / 2 : 0;
  ok(
    "the ball at full throw stays inside the well, with visible travel",
    throwRadius > 12 && throwRadius < 32,
    { throwRadius, well, ball },
  );
  ok("it does not reach the HUD", !!hud && !!stick && stick.y > hud.bottom, { hud, stick });

  // The board's own lower edge, published by the render layer.
  const boardBottom = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--bc-board-bottom").trim(),
  );
  console.log(`  (--bc-board-bottom = ${boardBottom || "unset"})`);

  // --- drag it, and check the ball and the gate follow ---
  const cx = plate!.x + plate!.w / 2;
  const cy = plate!.y + plate!.h / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 40, cy, { steps: 6 });
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${SHOTS}/stick-pushed-left.png` });

  const pushed = await page.evaluate(() => {
    const plateEl = document.querySelector(".stick-plate") as HTMLElement | null;
    const ballEl = document.querySelector(".stick-ball") as HTMLElement | null;
    const lit = Array.from(document.querySelectorAll(".stick-gate.on")).map(
      (g) => (g as HTMLElement).className,
    );
    return {
      engaged: plateEl?.classList.contains("engaged") ?? false,
      grabbed: plateEl?.classList.contains("grabbed") ?? false,
      sx: plateEl?.style.getPropertyValue("--sx") ?? "",
      ballX: ballEl?.getBoundingClientRect().x ?? 0,
      lit,
    };
  });
  ok("pushing engages the plate", pushed.engaged, pushed);
  ok("exactly one gate lights", pushed.lit.length === 1, pushed.lit);
  ok("and it is the LEFT gate", pushed.lit[0]?.includes("stick-gate-left"), pushed.lit);
  ok("the ball moved with the thumb", parseFloat(pushed.sx) < -10, pushed.sx);
  ok(
    "the ball is clamped to the throw, not dragged to the finger",
    // The push was 40px; the ball must stop at the throw the DOM reports.
    Math.abs(Math.abs(parseFloat(pushed.sx)) - throwRadius) < 1.5,
    { sx: pushed.sx, throwRadius },
  );

  // Push far past the plate — the ball must stay put, the gate must hold.
  await page.mouse.move(cx - 300, cy, { steps: 4 });
  await page.waitForTimeout(80);
  const far = await page.evaluate(() => ({
    sx: (document.querySelector(".stick-plate") as HTMLElement)?.style.getPropertyValue("--sx") ?? "",
    lit: document.querySelectorAll(".stick-gate.on").length,
  }));
  ok("dragging off the plate keeps the gesture", far.lit === 1, far);
  ok(
    "…with the ball still clamped",
    Math.abs(Math.abs(parseFloat(far.sx)) - throwRadius) < 1.5,
    { sx: far.sx, throwRadius },
  );

  await page.mouse.up();
  await page.waitForTimeout(300);
  const released = await page.evaluate(() => ({
    engaged: document.querySelector(".stick-plate")?.classList.contains("engaged") ?? true,
    lit: document.querySelectorAll(".stick-gate.on").length,
    sx: (document.querySelector(".stick-plate") as HTMLElement)?.style.getPropertyValue("--sx") ?? "",
  }));
  ok("release darkens the gates", released.lit === 0 && !released.engaged, released);
  ok("…and springs the ball back to centre", parseFloat(released.sx) === 0, released.sx);
  await page.screenshot({ path: `${SHOTS}/stick-released.png` });

  // --- landscape ---
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/stick-landscape.png` });
  const land = await box(page, ".stick-plate");
  ok("landscape shrinks the plate", !!land && land.w < 130 && land.w > 90, land);
  ok("…and it still fits", !!land && land.bottom <= 390, land);
  // It must be OUT of the middle: in landscape the board fills the height, so a
  // centred stick sits on the part of the maze the player is reading.
  ok(
    "landscape moves the stick to the bottom-left, off the maze's centre",
    !!land && land.right < 844 * 0.35,
    land,
  );
  const landTray = await page.evaluate(() => {
    const tray = document.querySelector(".powerups");
    // Three held power-ups, so the row is at a real height. A tray measured
    // empty proves nothing — the D-pad's version of this failed by exactly one
    // wrapped line.
    if (tray && tray.querySelectorAll(".powerup").length === 0) {
      for (let i = 0; i < 3; i++) {
        const chip = document.createElement("div");
        chip.className = "powerup";
        chip.innerHTML = '<span class="bc-plate"></span><span class="name">TEST</span>';
        tray.appendChild(chip);
      }
    }
    const chips = Array.from(document.querySelectorAll(".powerup")).map((c) =>
      c.getBoundingClientRect(),
    );
    const s = document.querySelector(".stick-plate")!.getBoundingClientRect();
    return {
      chips: chips.length,
      hit: chips.some(
        (c) => c.right > s.left && c.left < s.right && c.bottom > s.top && c.top < s.bottom,
      ),
    };
  });
  ok(
    "…and the tray gets out of its way instead of overlapping it",
    landTray.chips > 0 && !landTray.hit,
    landTray,
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);

  // --- the power-up tray has to clear the stick ---
  // The tray is anchored to --bc-pad-block, which each scheme sets from its own
  // metrics. Fake three held power-ups so the row is at its real height; a tray
  // measured empty proves nothing, and the D-pad's version of this failed by
  // exactly one wrapped line.
  const overlap = await page.evaluate(() => {
    const tray = document.querySelector(".powerups");
    if (!tray) return "no tray element";
    for (let i = 0; i < 3; i++) {
      const chip = document.createElement("div");
      chip.className = "powerup";
      chip.innerHTML = '<span class="bc-plate"></span><span class="name">TEST</span>';
      tray.appendChild(chip);
    }
    const chips = Array.from(tray.querySelectorAll(".powerup")).map((c) =>
      c.getBoundingClientRect(),
    );
    const stickBox = document.querySelector(".stick-plate")!.getBoundingClientRect();
    const hit = chips.some(
      (c) =>
        c.right > stickBox.left &&
        c.left < stickBox.right &&
        c.bottom > stickBox.top &&
        c.top < stickBox.bottom,
    );
    const lowest = Math.max(...chips.map((c) => c.bottom));
    return { hit, lowest, stickTop: stickBox.top };
  });
  await page.screenshot({ path: `${SHOTS}/stick-with-tray.png` });
  ok(
    "power-up chips clear the stick",
    typeof overlap === "object" && !overlap.hit,
    overlap,
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  console.log(`screenshots in ${SHOTS}/`);
  await browser.close();
  if (failed > 0) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
