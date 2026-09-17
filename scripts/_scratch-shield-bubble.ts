// Scratch: LOOK at the shield bubble (IDEA-064 v5).
//
// The whole point of the feature is whether a player reads "I am protected"
// at the play camera, on a board 325 CSS px wide, with the dog about 30px
// across. No assertion answers that; only the render does.
//
// Shoots the default coat (Bagel, which opens every map shielded) on a phone
// and on a desktop, plus a crop around the dog, plus the SAME frames with the
// bubble suppressed as a control — a cue that reads well on its own and badly
// beside the real thing is the trap this project has hit with every texture.
//
//   docker compose up -d db api web
//   npx tsx scripts/_scratch-shield-bubble.ts
//   USER_NAME=<existing> npx tsx scripts/_scratch-shield-bubble.ts   (no signup)
import { chromium, type Page } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:5173";
const OUT = ".scratch/shield-bubble";
mkdirSync(OUT, { recursive: true });

const uniqueName = (): string =>
  `sb${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`.slice(0, 20);

async function signUp(page: Page, username: string): Promise<void> {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForSelector("#authGate:not(.hidden)", { timeout: 30_000 });
  await page.waitForSelector("#signupForm");
  await page.fill("#signupUsername", username);
  await page.fill("#signupPassword", "a-decent-password");
  await page.click("#signupForm button[type=submit]");
  await page.waitForSelector("#recoveryCode:not(.hidden)", { timeout: 30_000 });
  await page.check("#recoverySavedCheck");
  await page.click("#recoveryContinueBtn");
  await page.waitForSelector("#mainMenu:not(.hidden)", { timeout: 30_000 });
}

async function logIn(page: Page, username: string): Promise<void> {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForSelector("#authGate:not(.hidden)", { timeout: 30_000 });
  await page.click("#tabLogin");
  await page.fill("#loginUsername", username);
  await page.fill("#loginPassword", "a-decent-password");
  await page.click("#loginForm button[type=submit]");
  await page.waitForSelector("#mainMenu:not(.hidden)", { timeout: 30_000 });
}

async function startRun(page: Page): Promise<void> {
  await page.click("#playBtn");
  for (let i = 0; i < 12; i++) {
    const next = await page.$(".tut-next");
    if (!next) break;
    await next.click();
    await page.waitForTimeout(200);
  }
  await page.waitForSelector("#center:not(.hidden)", { timeout: 30_000 });
  await page.waitForTimeout(3200);
}

/** The beagle's own position PROJECTED to screen pixels, through the real
 *  camera, so the crop lands on the dog rather than on the middle of the
 *  board. The matrix maths is done in the page in plain JS: three is not
 *  loaded as a global there, and importing it into the probe would measure a
 *  DIFFERENT camera than the one that drew the frame. */
async function beagleScreen(page: Page) {
  return page.evaluate(() => {
    const g = (window as unknown as { __game?: Record<string, unknown> }).__game;
    if (!g) return null;
    const mesh = (g as unknown as { beagleMesh: { position: { x: number; y: number; z: number } } }).beagleMesh;
    const rig = (g as unknown as {
      rig: {
        camera: { projectionMatrix: { elements: number[] }; matrixWorldInverse: { elements: number[] } };
        renderer: { domElement: HTMLCanvasElement };
      };
    }).rig;
    const el = rig.renderer.domElement;
    const r = el.getBoundingClientRect();

    // Written out rather than factored into a helper ON PURPOSE. tsx/esbuild
    // runs with keepNames, which wraps a NAMED function expression — including
    // an arrow that takes its name from the const it is assigned to — in
    // `__name(...)`, and Playwright serialises this function's SOURCE into the
    // page, where `__name` does not exist. The whole evaluate then dies on one
    // ReferenceError. Same trap CLAUDE.md records for addInitScript (IDEA-074).
    const mv = rig.camera.matrixWorldInverse.elements;
    const pm = rig.camera.projectionMatrix.elements;
    // The BUBBLE's centre, not the dog's feet: 0.43 above the floor.
    const wx = mesh.position.x, wy = mesh.position.y + 0.43, wz = mesh.position.z;
    const vx = mv[0] * wx + mv[4] * wy + mv[8] * wz + mv[12];
    const vy = mv[1] * wx + mv[5] * wy + mv[9] * wz + mv[13];
    const vz = mv[2] * wx + mv[6] * wy + mv[10] * wz + mv[14];
    const vw = mv[3] * wx + mv[7] * wy + mv[11] * wz + mv[15];
    const cx = pm[0] * vx + pm[4] * vy + pm[8] * vz + pm[12] * vw;
    const cy = pm[1] * vx + pm[5] * vy + pm[9] * vz + pm[13] * vw;
    const cw = pm[3] * vx + pm[7] * vy + pm[11] * vz + pm[15] * vw;
    const ndcX = cx / cw;
    const ndcY = cy / cw;
    return {
      canvas: { x: r.x, y: r.y, w: r.width, h: r.height },
      screen: { x: r.x + (ndcX * 0.5 + 0.5) * r.width, y: r.y + (-ndcY * 0.5 + 0.5) * r.height },
      tilePx: r.width / 21,
    };
  });
}

/** Turn the bubble off without touching the game state, for the control shot. */
async function setBubble(page: Page, on: boolean): Promise<void> {
  await page.evaluate((visible) => {
    const g = (window as unknown as { __game?: Record<string, unknown> }).__game;
    if (!g) return;
    const rig = (g as unknown as { rig: { scene: { children: { type: string; visible: boolean; children: unknown[] }[] } } }).rig;
    for (const c of rig.scene.children) {
      // The bubble is the only Group of exactly two meshes added straight to
      // the game scene.
      if (c.type === "Group" && c.children.length === 2) c.visible = visible;
    }
  }, on);
}

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const name = process.env.USER_NAME ?? uniqueName();

  for (const [label, w, h] of [["phone", 390, 844], ["desktop", 1280, 800]] as const) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: "reduce", deviceScaleFactor: 3 });
    const page = await ctx.newPage();
    if (process.env.USER_NAME) await logIn(page, name);
    else if (label === "phone") await signUp(page, name);
    else await logIn(page, name);

    await startRun(page);
    // The dog leaves its spawn under the direction resetActors gives it, so a
    // crop computed a frame before the shot lands on empty corridor. Stop it.
    await page.evaluate(() => {
      const g = (window as unknown as { __game?: Record<string, unknown> }).__game;
      if (!g) return;
      const b = (g as unknown as { beagle: { dir: { x: number; y: number }; queued: unknown } }).beagle;
      b.dir = { x: 0, y: 0 };
      b.queued = null;
    });
    await page.waitForTimeout(600);
    const info = await beagleScreen(page);
    console.log(label, JSON.stringify(info));

    if (info) {
      // Eight tiles across the dog: wide enough to judge the bubble against
      // the corridor it is standing in, tight enough that the dog is not four
      // pixels. deviceScaleFactor does the magnifying.
      const half = info.tilePx * 2.2;
      await page.screenshot({
        path: `${OUT}/${label}-crop.png`,
        clip: {
          x: Math.max(0, info.screen.x - half),
          y: Math.max(0, info.screen.y - half),
          width: half * 2,
          height: half * 2,
        },
      });
    }

    await page.screenshot({ path: `${OUT}/${label}.png` });

    // THE BURST. Staged by calling the two cues directly rather than by
    // arranging to be caught — what is under review here is whether the burst
    // READS, and the wiring that fires it is a single call site three lines
    // long in checkCollisions() that the suite already covers.
    if (info) {
      const half = info.tilePx * 2.6;
      const clip = {
        x: Math.max(0, info.screen.x - half),
        y: Math.max(0, info.screen.y - half),
        width: half * 2,
        height: half * 2,
      };
      await page.evaluate(() => {
        const g = (window as unknown as { __game?: Record<string, unknown> }).__game;
        if (!g) return;
        const anyG = g as unknown as {
          shieldBubble: { burst(): void };
          effects: { shieldBroke(x: number, z: number): void };
          beagleMesh: { position: { x: number; z: number } };
        };
        anyG.shieldBubble.burst();
        anyG.effects.shieldBroke(anyG.beagleMesh.position.x, anyG.beagleMesh.position.z);
      });
      for (const [i, wait] of [60, 60, 60].entries()) {
        await page.waitForTimeout(wait);
        await page.screenshot({ path: `${OUT}/${label}-burst${i + 1}.png`, clip });
      }
    }

    await setBubble(page, false);
    await page.waitForTimeout(60);
    const info2 = await beagleScreen(page);
    if (info2) {
      const info = info2;
      const half = info.tilePx * 2.2;
      await page.screenshot({
        path: `${OUT}/${label}-control.png`,
        clip: {
          x: Math.max(0, info.screen.x - half),
          y: Math.max(0, info.screen.y - half),
          width: half * 2,
          height: half * 2,
        },
      });
    }

    await ctx.close();
  }

  await browser.close();
  console.log(`\nwrote ${OUT}/{phone,desktop}{,-crop,-control}.png`);
  if (!process.env.USER_NAME) console.log(`account: ${name}`);
}

main();
