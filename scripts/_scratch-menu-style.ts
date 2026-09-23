// Menu + shop under both styles, from ONE sign-in.
//
// The style flag is read from `localStorage` (src/render/madboxFlag.ts), so a
// single authenticated session can switch and reload. Logging in twice hit the
// per-username limiter (10 per 15 minutes) and left the second capture as a
// stale file — which the pixel probe then reported as though it were current.
import { chromium } from "playwright";
import { signIn } from "./_scratch-auth.js";

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, reducedMotion: "reduce" });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE", m.text()); });

for (const style of ["classic", "madbox"] as const) {
  // The URL param is the flag's own front door and it persists itself, so
  // each pass is a plain navigation. signIn() returns immediately when the
  // session is already up, which it is after the first pass — that is what
  // keeps this to ONE actual login and clear of the per-username limiter.
  await signIn(page, `http://localhost:5173/?style=${style}`);
  await page.waitForTimeout(2600);
  await page.screenshot({ path: `.tmp-screens/menu-${style}.png` });

  const mats = await page.evaluate(`(() => {
    const g = window.__game;
    const sc = g && g.menuScene && g.menuScene.scene;
    if (!sc) return ["no menuScene"];
    const k = new Map();
    sc.traverse((o) => { if (!o.isMesh) return;
      const path = []; let p = o; while (p) { if (p.name) path.unshift(p.name); p = p.parent; }
      const root = (path[0] || "(unnamed)") + (path[1] ? "/" + path[1] : "");
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
        if (m.type !== "MeshToonMaterial" || m.map || m.vertexColors) continue;
        const key = root + " #" + (m.color ? m.color.getHexString() : "-");
        k.set(key, (k.get(key) ?? 0) + 1); } });
    return [...k.entries()].sort().map(([a, n]) => a + " x" + n);
  })()`);
  console.log(style.padEnd(8), "plain-toon left:");
  for (const line of (mats as string[])) console.log("    " + line);

  await page.click("#menuShopBtn");
  await page.waitForSelector("#shop:not(.hidden)", { timeout: 20_000 });
  await page.waitForTimeout(2400);
  await page.screenshot({ path: `.tmp-screens/shop-${style}.png` });

  // THE END-TO-END CHECK FOR THE WHOLE REMAP STORY: does picking another coat
  // still repaint the dog? This is what a stale `coatMats` reference breaks,
  // and it breaks SILENTLY — the shop would just keep showing the same beagle.
  const heroColours = async () =>
    page.evaluate(`(() => {
      const g = window.__game;
      const sc = g && g.shopScene && g.shopScene.scene;
      if (!sc) return "no shopScene";
      const cols = new Set();
      sc.traverse((o) => {
        if (!o.isMesh) return;
        let p = o, hero = false;
        while (p) { if (p.userData && p.userData.coatMats) { hero = true; break; } p = p.parent; }
        if (!hero) return;
        for (const m of (Array.isArray(o.material) ? o.material : [o.material]))
          if (m.color) cols.add(m.color.getHexString());
      });
      return [...cols].sort().join(",");
    })()`);
  const bagel = await heroColours();
  await page.click(".shop-rail-card:nth-of-type(2)");
  await page.waitForTimeout(1600);
  const cookie = await heroColours();
  console.log(
    style.padEnd(8),
    "coat switch:",
    bagel === cookie ? "UNCHANGED (broken)" : "repainted",
    `
           bagel  ${String(bagel).slice(0, 90)}`,
    `
           cookie ${String(cookie).slice(0, 90)}`,
  );
  await page.screenshot({ path: `.tmp-screens/shop-coat-${style}.png` });
  console.log(style.padEnd(8), "shot");
}
await b.close();
