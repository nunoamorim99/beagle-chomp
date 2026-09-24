// Are ALL the in-game previews on the new style? The shop's three tabs stage
// very different things — a beagle, an enemy, a whole theme diorama — and only
// the first two go through the same path.
import { chromium } from "playwright";
import { signIn } from "./_scratch-auth.js";

const b = await chromium.launch();
const page = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, reducedMotion: "reduce" })).newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
await signIn(page, "http://localhost:5173/?style=madbox");

const kinds = async (label: string) => {
  const r = await page.evaluate(`(() => {
    const g = window.__game;
    const sc = g && g.shopScene && g.shopScene.scene;
    if (!sc) return ["no shopScene"];
    const k = new Map();
    sc.traverse((o) => { if (!o.isMesh) return;
      const path = []; let p = o; while (p) { if (p.name) path.unshift(p.name); p = p.parent; }
      const root = (path[0] || "(unnamed)") + (path[1] ? "/" + path[1] : "");
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
        if (m.type !== "MeshToonMaterial" || m.map || m.vertexColors) continue;
        const key = root + "  #" + (m.color ? m.color.getHexString() : "-");
        k.set(key, (k.get(key) ?? 0) + 1); } });
    return [...k.entries()].sort().map(([a, n]) => a + " x" + n);
  })()`);
  const n = await page.evaluate(`window.__setHeroStyle ?? "never"`);
  console.log(label + "  setHero passes: " + n + "  — plain-toon leftovers:");
  for (const line of (r as string[])) console.log("    " + line);
};

await page.click("#menuShopBtn");
await page.waitForSelector("#shop:not(.hidden)", { timeout: 20_000 });
await page.waitForTimeout(2000);
await kinds("shop/beagle");
console.log("manual swap:", await page.evaluate(`(async () => {
  const mod = await import("/src/render/madboxStyle.ts");
  const g = window.__game;
  const before = [];
  g.shopScene.scene.traverse((o) => { if (o.isMesh)
    for (const m of (Array.isArray(o.material) ? o.material : [o.material]))
      if (m.type === "MeshToonMaterial" && !m.map && !m.vertexColors) before.push(m.name || "?"); });
  const swaps = mod.applyMadboxStyle(g.shopScene.scene, mod.MADBOX_BOUNCE, mod.makeMadboxCaches());
  const after = [];
  g.shopScene.scene.traverse((o) => { if (o.isMesh)
    for (const m of (Array.isArray(o.material) ? o.material : [o.material]))
      if (m.type === "MeshToonMaterial" && !m.map && !m.vertexColors) after.push(m.name || "?"); });
  return { toonBefore: before.length, swapped: swaps.size, toonAfter: after.length };
})()`));
await page.screenshot({ path: ".tmp-screens/shop-tab-beagle.png" });

for (const [tab, label] of [["enemy", "shop/enemies"], ["theme", "shop/themes"]] as const) {
  await page.click(`.shop-tab[data-tab="${tab}"]`).catch(() => {});
  await page.waitForTimeout(2000);
  await kinds(label);
  await page.screenshot({ path: `.tmp-screens/shop-tab-${tab}.png` });
}
await b.close();
