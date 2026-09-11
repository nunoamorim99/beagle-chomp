// Scratch: LOOK at the refreshed portal.
//
// Five of v8.0's bugs were found by rendering the thing and reading it, not by
// an assertion — a retention grid saying 0% where it meant "not yet", a bell
// that drew a speaker, a Back button reading "[object HTMLElement]". So this
// drives the real portal with a synthetic payload shaped like a busy season and
// screenshots every tab that changed.
//
// The payload is intercepted rather than seeded: the dev database has three
// runs in it, which is the right thing to launch against and the wrong thing to
// check a 40-level ladder with — and this writes nothing to it.
//
//   npx tsx scripts/_scratch-portal-render.ts

import { createServer } from "vite";
import { chromium } from "playwright";
import { resolve } from "node:path";

// Shots go OUTSIDE the repo — a review harness should not leave artifacts in
// `git status` for the next person to classify.
const OUT = resolve(process.env.TEMP ?? process.cwd(), "beagle-portal");

// A ladder where the tour thins out with depth and the twists are brutal —
// which is what the real thing should look like, and makes every branch of the
// new rendering visible at once (ranked, too-thin, never-opened).
const standings = Array.from({ length: 40 }, (_u, i) => {
  const attempts = i < 6 ? 120 - i * 14 : i < 11 ? 12 - (i - 6) * 2 : i >= 30 && i < 34 ? 9 - (i - 30) : 0;
  const rate = i >= 30 ? 0.12 + (i - 30) * 0.03 : Math.max(0.25, 0.92 - i * 0.06);
  const clears = Math.round(attempts * rate);
  return {
    challengeIdx: i,
    attempts,
    clears,
    clearRate: attempts > 0 ? clears / attempts : null,
    playersAttempted: Math.ceil(attempts / 6),
    playersCleared: clears > 0 ? Math.max(1, Math.ceil(clears / 6)) : 0,
    attemptsPerClear: clears > 0 ? attempts / Math.max(1, Math.ceil(clears / 6)) : null,
    medianClearSeconds: clears > 0 ? 70 + i * 4 : null,
    avgDeaths: attempts > 0 ? 1 + i * 0.08 : null,
  };
});
const ranked = standings.filter((s) => s.attempts >= 5 && s.clearRate !== null)
  .sort((a, b) => (a.clearRate ?? 1) - (b.clearRate ?? 1));
const insufficient = standings.filter((s) => s.attempts < 5 || s.clearRate === null);

const share = (rows: [string, number][]) => {
  const total = rows.reduce((s, [, n]) => s + n, 0);
  return rows.map(([value, runs]) => ({
    value,
    runs,
    players: Math.max(1, Math.round(runs / 5)),
    share: runs / total,
  }));
};

const PAYLOADS: Record<string, unknown> = {
  "/api/v1/auth/me": { user: { username: "beagleadmin" } },
  "/api/v1/admin/overview": {
    totals: { players_today: 12, players_7d: 48, players_30d: 130, total_players: 410,
              signups_7d: 22, runs_7d: 380, play_hours_7d: 41 },
    activity: Array.from({ length: 14 }, (_u, i) => ({
      day: `2026-08-${String(20 + i).padStart(2, "0")}`,
      players: 20 + ((i * 7) % 15), runs: 90 + ((i * 13) % 40), playSeconds: 4000 + i * 260,
    })),
  },
  "/api/v1/admin/challenges": { standings, ranked, insufficient, levelCount: 40, depth: [
    { levels_played: 1, runs: 140 }, { levels_played: 2, runs: 96 }, { levels_played: 3, runs: 61 },
    { levels_played: 5, runs: 28 }, { levels_played: 8, runs: 12 }, { levels_played: 15, runs: 4 },
    { levels_played: 37, runs: 1 },
  ] },
  "/api/v1/admin/gameplay": {
    enemies: ["Rose", "Teal", "Amber", "Violet", "Leaf"].map((label, slot) => ({
      slot, label, count: [180, 240, 120, 60, 25][slot], share: [180, 240, 120, 60, 25][slot] / 625,
    })),
    fruits: ["Apple", "Banana", "Carrot", "Strawberry", "Mango"].map((label, slot) => ({
      slot, label, count: [300, 180, 90, 40, 15][slot], share: [300, 180, 90, 40, 15][slot] / 625,
    })),
    nemesis: { slot: 1, label: "Teal", count: 240, share: 240 / 625 },
    favouriteFruit: { slot: 0, label: "Apple", count: 300, share: 300 / 625 },
  },
  // Deliberately partial: only four of eleven enemy skins have ever been worn,
  // and one row carries a retired id. Both are cases the old code hid.
  "/api/v1/admin/content": {
    beagleSkins: share([["bagel", 210], ["muffin", 88], ["pepper", 40], ["cookie", 22], ["pacbeagle", 9]]),
    enemySkins: share([["flea", 190], ["burger", 60], ["crab", 44], ["ghost", 12], ["beetle-old", 5]]),
    mazeThemes: share([["garden", 160], ["city", 70], ["beach", 30]]),
    controlSchemes: share([["swipe", 200], ["stick", 95], ["dpad", 45]]),
  },
};

const server = await createServer({
  configFile: resolve(process.cwd(), "vite.config.admin.ts"),
  server: { port: 5199, strictPort: true, hmr: false },
});
await server.listen();

const browser = await chromium.launch();
// The portal has no looping animation on a control, but ask anyway — it is the
// house rule for any context that drives real UI.
const page = await browser.newPage({ viewport: { width: 1280, height: 1400 }, reducedMotion: "reduce" });

// .env already points the portal at localhost:3001; intercept there so nothing
// about the client's own URL handling is stubbed out along with the data.
await page.route("**/localhost:3001/**", async (route) => {
  const path = new URL(route.request().url()).pathname;
  const body = PAYLOADS[path];
  if (!body) return route.fulfill({ status: 404, body: '{"error":{"code":"X","message":"no stub"}}' });
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
});

await page.addInitScript(() => {
  localStorage.setItem("beagle-chomp-admin:token", "stub-token");
});

page.on("console", (m) => { if (m.type() === "error") console.log("  console:", m.text()); });
page.on("pageerror", (e) => console.log("  pageerror:", e.message));

await page.goto("http://localhost:5199/", { waitUntil: "networkidle" });
await page.waitForSelector('[data-tab="difficulty"]', { timeout: 10_000 });

for (const tab of ["difficulty", "content"]) {
  await page.click(`[data-tab="${tab}"]`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}-${tab}.png`, fullPage: true });
  console.log(`shot ${tab}`);
}

// Read a few things back rather than trusting the picture alone.
await page.click('[data-tab="difficulty"]');
await page.waitForTimeout(300);
const firstRow = await page.locator("table tbody tr").first().innerText();
const tiles = await page.locator(".stats").first().innerText();
console.log("\nhardest row :", firstRow.replace(/\s+/g, " "));
console.log("tiles       :", tiles.replace(/\s+/g, " "));

await page.click('[data-tab="content"]');
await page.waitForTimeout(300);
const bodyText = await page.locator("main").innerText();
for (const needle of ["Bagel", "Starts every run with a shield", "Never played", "beetle-old", "Thumbstick", "Burger", "Doubles every coin"]) {
  console.log(`${needle.padEnd(32)} ${bodyText.includes(needle) ? "present" : "MISSING"}`);
}

await browser.close();
await server.close();
