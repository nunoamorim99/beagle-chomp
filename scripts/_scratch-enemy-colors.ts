// WHY ARE THE ENEMIES WRONG IN A RUN BUT RIGHT IN THE SHOP?
//
// Nuno: "on the shop they have the right colors but on the game they are all
// black... the crab should be orange like he is on the shop."
//
// Dumps every enemy material on BOTH paths: class, colour, and — the thing a
// screenshot cannot show — whether two different enemies are holding the SAME
// material object. The tint cache is keyed on the source colour, so sharing is
// the hypothesis worth measuring rather than arguing about.
import { chromium } from "playwright";
import { signIn } from "./_scratch-auth.js";

// `page.evaluate` with a string returns `unknown`; these shapes are this
// probe's own and are asserted nowhere else.
interface Part { name?: string; kind: string; color: string; id?: string }
interface GhostDump { skin: string; base: string; bodyDrawn: boolean; parts: Part[] }
interface HeroDump { byKind: Record<string, number>; colours: string[] }

const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 900, height: 900 }, reducedMotion: "reduce" })).newPage();
p.on("pageerror", (e) => console.log("PAGEERROR", e.message));
await signIn(p, "http://localhost:5173/");

const DUMP = `(() => {
  const g = window.__game;
  const out = { ghosts: [] };
  const ids = new Map(); let n = 0;
  const idOf = (m) => { if (!ids.has(m)) ids.set(m, "m" + (n++)); return ids.get(m); };
  let gi = 0;
  for (const rig of (g.ghosts ?? [])) {
    const parts = [];
    rig.mesh.traverse((o) => {
      if (!o.isMesh) return;
      for (const mat of (Array.isArray(o.material) ? o.material : [o.material])) {
        parts.push({
          name: o.name || "(unnamed)",
          kind: mat.type.replace("Mesh", "").replace("Material", ""),
          color: "#" + mat.color.getHexString(),
          id: idOf(mat),
        });
      }
    });
    const ud = rig.mesh.userData;
    out.ghosts.push({
      skin: "ghost" + (gi++),
      base: "#" + (ud.baseColor ?? 0).toString(16).padStart(6, "0"),
      bodyDrawn: parts.some((x) => x.id === idOf(ud.bodyMat)),
      parts,
    });
  }
  return out;
})()`;

// --- a real run -----------------------------------------------------------
await p.click("#playBtn");
await p.waitForTimeout(6000);
const run = (await p.evaluate(DUMP)) as { ghosts: GhostDump[] };

const tally = (parts: Part[]): Record<string, number> => {
  const byKind: Record<string, number> = {};
  for (const x of parts) byKind[x.kind] = (byKind[x.kind] ?? 0) + 1;
  return byKind;
};
console.log("=== IN A RUN ===");
for (const gh of run.ghosts) {
  console.log(` skin=${gh.skin} base=${gh.base} bodyMat drawn=${gh.bodyDrawn} ${JSON.stringify(tally(gh.parts))}`);
  const counts: Record<string, number> = {};
  for (const x of gh.parts) counts[x.color] = (counts[x.color] ?? 0) + 1;
  console.log("   colours:", Object.keys(counts).sort().map((c) => `${c}x${counts[c]}`).join(" "));
}
// SHARING between different ghosts — the measurement a render cannot make.
const owner = new Map();
let shared = 0;
for (const gh of run.ghosts) {
  for (const part of gh.parts) {
    const prev = owner.get(part.id);
    if (prev !== undefined && prev !== gh.skin) shared++;
    else owner.set(part.id, gh.skin);
  }
}
console.log(` materials shared BETWEEN ghosts: ${shared}`);

// --- the SHOP hero, same skins ---------------------------------------------
// The hero is found by `userData.bodyMat` -- the same field applyMadboxStyle
// uses to recognise an enemy -- rather than by index into the scene, so this
// cannot drift when the stage gains another child.
await p.evaluate("window.__game.showMenu()");
await p.waitForTimeout(1200);
await p.click("#menuShopBtn");
await p.waitForSelector("#shop:not(.hidden)", { timeout: 20000 });
const enemyTab = p.locator("#shop .shop-tab", { hasText: "Enemies" }).first();
if (await enemyTab.count()) { await enemyTab.click(); await p.waitForTimeout(1000); }
console.log("");
console.log("=== IN THE SHOP ===");
const count = await p.locator("#shop .shop-rail-card").count();
for (const idx of [0, 1, 5, 7]) {
  if (idx >= count) continue;
  await p.locator("#shop .shop-rail-card").nth(idx).click();
  await p.waitForTimeout(1300);
  const r = (await p.evaluate(`(() => {
    const sc = window.__game.shopScene.scene;
    let hero = null;
    sc.traverse((o) => { if (!hero && o.userData && o.userData.bodyMat) hero = o; });
    if (!hero) return null;
    const parts = [];
    hero.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of (Array.isArray(o.material) ? o.material : [o.material]))
        parts.push({ kind: m.type.replace("Mesh","").replace("Material",""), color: "#" + m.color.getHexString() });
    });
    const byKind = {};
    for (const x of parts) byKind[x.kind] = (byKind[x.kind] ?? 0) + 1;
    const counts = {};
    for (const x of parts) counts[x.color] = (counts[x.color] ?? 0) + 1;
    return { byKind, colours: Object.keys(counts).sort().map((c) => c + "x" + counts[c]) };
  })()`)) as HeroDump | null;
  const name = (await p.locator("#shop .shop-rail-card").nth(idx).textContent())?.trim().slice(0, 16);
  console.log(` card ${idx} (${name}):`, r ? JSON.stringify(r.byKind) : "NO HERO FOUND");
  if (r) console.log("   colours:", r.colours.join(" "));
}
await b.close();
