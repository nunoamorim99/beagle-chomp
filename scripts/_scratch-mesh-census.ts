// IDEA-065: how many DRAW CALLS does a theme's board dressing actually cost?
//
// Draw calls, not triangles, are the prop budget in this project — these are
// flat toon materials with no maps — and until this ran nobody had a number.
// The forest's first build measured 393 prop meshes against the garden's 220
// and the city's 314, which is what `src/render/propMerge.ts` exists to fix.
//
//   npm run dev
//   THEMES=garden,forest npx tsx scripts/_scratch-mesh-census.ts
import { chromium } from "playwright";
const themes = (process.env.THEMES ?? "garden,forest,park,city,beach").split(",");
const SRC = `(() => {
  const board = window.__board && window.__board.board;
  function count(o) {
    var n = 0, tri = 0;
    if (!o || !o.traverse) return { n: n, tri: tri };
    o.traverse(function (m) {
      if (!m.isMesh) return;
      n++;
      var g = m.geometry;
      var t = (g.index ? g.index.count : g.attributes.position.count) / 3;
      tri += t * (m.isInstancedMesh ? m.count : 1);
    });
    return { n: n, tri: Math.round(tri) };
  }
  var d = { n: 0, tri: 0 };
  (board && board.hedgeDecor ? board.hedgeDecor : []).forEach(function (x) {
    var c = count(x); d.n += c.n; d.tri += c.tri;
  });
  return { props: count(board && board.props), decor: d, walls: count(board && board.walls) };
})()`;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
for (const t of themes) {
  await p.goto(`http://localhost:5173/preview-board/?theme=${t}&maze=0&view=game&hud=0`, { waitUntil: "load" });
  await p.waitForFunction(() => document.title.includes("ready"), null, { timeout: 20000 });
  const r = await p.evaluate(SRC);
  console.log(t.padEnd(8), JSON.stringify(r));
}
await b.close();
