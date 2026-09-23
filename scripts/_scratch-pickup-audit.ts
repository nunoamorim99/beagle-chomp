// Are the PICKUPS styled? They spawn mid-run, long after buildLevel's pass, so
// "it looked fine" proves nothing — none of them were on screen when the board
// was last audited. Forced here, one of each, and inspected.
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

const rows = await page.evaluate(`(async () => {
  const board = await import("/src/render/board.ts");
  const g = window.__game;
  const out = [];
  const inspect = (label, obj) => {
    const kinds = new Map();
    obj.traverse((o) => { if (!o.isMesh) return;
      for (const m of (Array.isArray(o.material) ? o.material : [o.material]))
        kinds.set(m.type.replace("Mesh","").replace("Material",""), (kinds.get(m.type.replace("Mesh","").replace("Material","")) ?? 0) + 1); });
    out.push(label + ": " + [...kinds.entries()].map(([k, n]) => k + " x" + n).join(", "));
  };
  for (const kind of ["apple", "banana", "carrot", "strawberry", "mango"]) {
    board.spawnFruit(g.level.board, g.rig.scene, 9, 9, kind);
    inspect("fruit/" + kind, g.level.board.fruit);
  }
  board.spawnCoin(g.level.board, g.rig.scene, 9, 10);
  inspect("coin", g.level.board.coin);
  for (const kind of ["doubleBiscuit", "doubleGhost", "slowGhosts", "star", "shield"]) {
    try {
      board.spawnPowerup(g.level.board, g.rig.scene, 9, 11, kind);
      inspect("powerup/" + kind, g.level.board.powerup);
    } catch (e) { out.push("powerup/" + kind + ": " + e.message); }
  }
  return out;
})()`);
for (const r of rows as string[]) console.log("  " + r);
await b.close();
