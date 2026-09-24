// Is the new style the DEFAULT now — with no URL param and no stored choice —
// and is classic still reachable? Both halves, because a default that cannot
// be turned off is not a default, it is a removal.
import { chromium } from "playwright";
import { signIn } from "./_scratch-auth.js";

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));

// No query string at all — a first-time visitor.
await signIn(page, "http://localhost:5173/");
const kinds = async () => page.evaluate(`(() => {
  const g = window.__game;
  const sc = g && g.menuScene && g.menuScene.scene;
  if (!sc) return "no menuScene";
  const k = new Map();
  sc.traverse((o) => { if (!o.isMesh) return;
    for (const m of (Array.isArray(o.material) ? o.material : [o.material]))
      k.set(m.type.replace("Mesh","").replace("Material",""), (k.get(m.type.replace("Mesh","").replace("Material","")) ?? 0) + 1); });
  return [...k.entries()].sort().map(([a, n]) => a + " x" + n).join("  ");
})()`);
await page.waitForTimeout(2000);
console.log("fresh visit:   ", await kinds());

await page.click("#menuProfileBtn");
await page.waitForSelector("#profile:not(.hidden)", { timeout: 20_000 });
await page.waitForTimeout(400);
console.log("profile shows: ", await page.evaluate(`(() => ({
  newActive: document.getElementById("styleNew")?.classList.contains("is-active"),
  classicActive: document.getElementById("styleClassic")?.classList.contains("is-active"),
}))()`));

await page.click("#styleClassic");
await page.waitForTimeout(1200);
await signIn(page, page.url());
await page.waitForTimeout(2000);
console.log("after opt-out: ", await kinds());
console.log("url:           ", page.url());

// And the opt-out must SURVIVE a visit with no query string.
await signIn(page, "http://localhost:5173/");
await page.waitForTimeout(2000);
console.log("sticks:        ", await kinds());
await b.close();
