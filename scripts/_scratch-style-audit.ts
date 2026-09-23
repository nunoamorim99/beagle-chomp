// WHAT IS STILL TOON DURING A RUN? "Ensure all the components follow the new
// style" is only checkable by listing what does not — spawners, effects and
// anything built after the level are exactly what a scene-wide pass misses.
import { chromium } from "playwright";
import { signIn } from "./_scratch-auth.js";

const b = await chromium.launch();
const page = await (await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" })).newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
await signIn(page, "http://localhost:5173/?style=madbox");
await page.click("#playBtn");
await page.waitForSelector("#tutorial:not(.hidden)", { timeout: 20_000 }).catch(() => {});
const t = await page.$(".tut-skip");
if (t) { await t.click(); await page.waitForSelector("#tutorial.hidden", { state: "attached", timeout: 10_000 }); }
await page.waitForTimeout(2500);

// Force every runtime spawner so the pickups exist to inspect.
await page.evaluate(`(() => {
  const g = window.__game;
  if (!g || !g.level) return;
  const b = g.level.board;
  try { g.spawnFruitAt ? g.spawnFruitAt(9, 9) : null; } catch {}
})()`);

const rows = await page.evaluate(`(() => {
  const g = window.__game;
  const sc = g && g.rig && g.rig.scene;
  if (!sc) return ["no scene"];
  const byKind = new Map();
  sc.traverse((o) => {
    if (!o.isMesh) return;
    const path = []; let p = o; while (p) { if (p.name) path.unshift(p.name); p = p.parent; }
    const root = (path[0] || "(unnamed)");
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
      const k = root + "  " + m.type.replace("Mesh","").replace("Material","") + (m.map ? " +map" : "") + (m.vertexColors ? " +vc" : "");
      byKind.set(k, (byKind.get(k) ?? 0) + 1);
    }
  });
  return [...byKind.entries()].sort().map(([k, n]) => k + "  x" + n);
})()`);
for (const r of rows as string[]) console.log("  " + r);
await b.close();
