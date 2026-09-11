// Scratch: IDEA-063 level-map review. Signs up once, opens the Challenge level
// map, measures the header rail / stones / panel at phone and desktop sizes and
// drops screenshots in .tmp-screens/ for a human look.
//
//   docker compose up -d && npx tsx scripts/_scratch-levelmap-check.ts
//
// reducedMotion: "reduce" on every context — see test-menu-ui.ts's own note.
// Signup is rate-limited to 5/hour per IP, so this makes ONE account and reuses
// it across both viewports.
import { chromium, type Page } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const BASE_URL = process.argv[2] ?? "http://localhost:5173";
const SHOTS = ".tmp-screens";

const uniqueName = (): string =>
  `lm${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`.slice(0, 20);

async function signUp(page: Page): Promise<string> {
  const username = uniqueName();
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.waitForSelector("#authGate:not(.hidden)", { timeout: 20_000 });
  await page.waitForSelector("#signupForm");
  await page.fill("#signupUsername", username);
  await page.fill("#signupPassword", "a-decent-password");
  await page.click("#signupForm button[type=submit]");
  await page.waitForSelector("#recoveryCode:not(.hidden)", { timeout: 25_000 });
  await page.check("#recoverySavedCheck");
  await page.click("#recoveryContinueBtn");
  await page.waitForSelector("#mainMenu:not(.hidden)", { timeout: 20_000 });
  return username;
}

/** Unlocks the ladder straight in the dev database. There is no endpoint for
 *  this and there should not be — the server is the authority on progress —
 *  but a map rendered entirely in padlocks exercises one of three node states
 *  and none of the panel's twist content. */
function psql(sql: string): string {
  return execFileSync(
    "docker",
    ["compose", "exec", "-T", "db", "psql", "-U", "beaglechomp", "-d", "beaglechomp", "-tAc", sql],
    { encoding: "utf-8" },
  ).trim();
}

async function openMap(page: Page): Promise<void> {
  await page.click("#challengeBtn");
  await page.waitForSelector("#levelMap:not(.hidden)");
  await page.waitForTimeout(500);
}

async function report(page: Page, tag: string): Promise<void> {
  // NOTE: no nested function/arrow DECLARATIONS inside page.evaluate. tsx
  // compiles with esbuild's keepNames, which injects a `__name` helper that
  // does not exist in the page — the call fails with "__name is not defined",
  // which looks like a page error and is a bundler one.
  const m = await page.evaluate(
    (sels: string[]) => {
      const boxes: Record<string, unknown> = {};
      for (const sel of sels) {
        const el = document.querySelector(sel);
        if (!el) {
          boxes[sel] = null;
          continue;
        }
        const r = el.getBoundingClientRect();
        boxes[sel] = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      }

      const chips: unknown[] = [];
      for (const c of document.querySelectorAll<HTMLElement>(".map-chapter-chip")) {
        const r = c.getBoundingClientRect();
        chips.push({
          text: c.textContent?.trim(),
          cls: c.className,
          w: Math.round(r.width),
          h: Math.round(r.height),
          y: Math.round(r.y),
        });
      }

      const banners: (string | null)[] = [];
      for (const t of document.querySelectorAll(".map-chapter-label")) banners.push(t.textContent);

      return {
        boxes,
        chips,
        banners,
        nodes: document.querySelectorAll(".map-node").length,
        themeTag: document.querySelector(".map-theme-tag")?.textContent?.trim(),
        twistTag: document.querySelector(".map-twist-tag")?.textContent?.trim(),
        title: document.querySelector(".map-footer-title")?.textContent,
        playBtn: document.querySelector("#mapPlayBtn")?.textContent?.trim(),
        overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        innerW: window.innerWidth,
        innerH: window.innerHeight,
      };
    },
    [".map-header", ".map-chapter-rail", ".map-panel-info", "#mapPlayBtn", ".map-title-block"],
  );
  console.log(`\n--- ${tag} ---`);
  console.log(JSON.stringify(m, null, 1));
  await page.screenshot({ path: `${SHOTS}/levelmap-${tag}.png` });
}

(async () => {
  mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();

  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    reducedMotion: "reduce",
  });
  const page = await phone.newPage();
  const username = await signUp(page);
  console.log("account:", username);

  await openMap(page);
  await report(page, "phone-top");
  await page.click("#mapBackBtn");
  await page.waitForSelector("#mainMenu:not(.hidden)");

  // Clear the whole ladder so every node state and the twist panel are real.
  psql(`UPDATE users SET challenge_progress = 40 WHERE username = '${username}'`);
  // goto rather than reload: the PWA service worker makes reload() flaky about
  // ever firing domcontentloaded here, and a fresh navigation re-hydrates the
  // profile cache just the same.
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector("#mainMenu:not(.hidden)", { timeout: 20_000 });
  await openMap(page);

  // Jump to the twists chapter, then SELECT a twist level — the panel's two-tag
  // row (theme + twist) only renders on a level that actually turns a dial.
  await page.click('.map-chapter-chip[data-chapter-from="30"]');
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${SHOTS}/levelmap-phone-twists.png` });
  await page.click('[data-node-idx="38"]'); // level 39, "Dream Walk"
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/levelmap-phone-dreamwalk.png` });
  await report(page, "phone-twists");

  const state = await phone.storageState();
  await phone.close();

  const desk = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    reducedMotion: "reduce",
    storageState: state,
  });
  const dpage = await desk.newPage();
  await dpage.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await dpage.waitForSelector("#mainMenu:not(.hidden)", { timeout: 20_000 });
  await openMap(dpage);
  await report(dpage, "desktop");

  // The thing the 40-stone trail broke and the 8-stone one never could: after
  // the auto-scroll to the selected stone, are the sticky header and the sticky
  // side panel still ON SCREEN? Both live inside `.map-page`, and a sticky box
  // cannot leave its own containing block.
  const stuck = await dpage.evaluate(() => {
    const h = document.querySelector(".map-header")?.getBoundingClientRect();
    const p = document.querySelector(".map-panel-info")?.getBoundingClientRect();
    const map = document.querySelector("#levelMap");
    return {
      scrollTop: Math.round(map?.scrollTop ?? -1),
      scrollHeight: Math.round(map?.scrollHeight ?? -1),
      headerTop: h ? Math.round(h.top) : null,
      headerVisible: !!h && h.top >= -1 && h.bottom <= window.innerHeight,
      panelTop: p ? Math.round(p.top) : null,
      panelVisible: !!p && p.bottom > 0 && p.top < window.innerHeight,
      // The real question: does the panel start BELOW the header, or under it?
      panelClearsHeader: !!p && !!h && p.top >= h.bottom - 1,
      headerH: h ? Math.round(h.height) : null,
      headerVar: getComputedStyle(document.querySelector("#levelMap") as Element).getPropertyValue("--map-header-h"),
    };
  });
  console.log("desktop sticky:", JSON.stringify(stuck));
  await dpage.click('.map-chapter-chip[data-chapter-from="30"]');
  await dpage.waitForTimeout(1200);
  await dpage.screenshot({ path: `${SHOTS}/levelmap-desktop-twists.png` });

  // Clean up the throwaway account.
  await dpage.click("#mapBackBtn");
  await dpage.waitForSelector("#mainMenu:not(.hidden)");
  await dpage.click("#menuProfileBtn");
  await dpage.waitForSelector("#profile:not(.hidden)");
  await dpage.click("#deleteRevealBtn");
  await dpage.fill("#deleteConfirmInput", username);
  await dpage.click("#deleteConfirmBtn");
  await dpage.waitForSelector("#authGate:not(.hidden)", { timeout: 15_000 });
  console.log("\naccount deleted");

  await browser.close();
})();
