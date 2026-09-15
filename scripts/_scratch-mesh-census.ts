// IDEA-065: how many DRAW CALLS does a theme's board dressing actually cost?
// IDEA-066: ...and what does the surround add on top?
//
// Draw calls, not triangles, are the prop budget in this project — these are
// flat toon materials with no maps — and until this ran nobody had a number.
// The forest's first build measured 393 prop meshes against the garden's 220
// and the city's 314, which is what `src/render/propMerge.ts` exists to fix.
//
// IDEA-066 added two things the first version was missing, both of which
// change what you conclude:
//   - `renderer.info.render.calls`, the REAL draw-call count for the whole
//     frame. Mesh count is a proxy and it is not a tight one: it misses the
//     floor, the fence, the ground detail and the pellets entirely, and the
//     renderer merges nothing, so the true number is the one to budget against.
//   - the `fence`, `groundDetail`, `surround` and `verge` buckets. The fence is
//     ~440 panels in ONE instanced call and the census used to report it as
//     nothing at all.
//
//   npm run dev
//   THEMES=garden,forest npx tsx scripts/_scratch-mesh-census.ts
import { chromium } from "playwright";
const themes = (process.env.THEMES ?? "garden,classic,forest,park,city,beach").split(",");
const SRC = `(() => {
  const w = window.__board || {};
  const board = w.board;
  const rig = w.rig;
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
  // renderer.info is per-frame and autoReset wipes it at the START of each
  // render, so it describes the frame that has just been drawn.
  var info = rig ? rig.renderer.info.render : { calls: -1, triangles: -1 };
  return {
    props: count(board && board.props),
    verge: count(board && board.verge),
    decor: d,
    walls: count(board && board.walls),
    fence: count(board && board.fence),
    ground: count(board && board.groundDetail),
    surround: count(w.surround || (board && board.surround)),
    // IDEA-067. Its own column rather than folded into the props one: it is a
    // FIXTURE derived from the grid, not a placement, so a change in its cost
    // has a completely different cause from a theme gaining a prop. (And no
    // backticks in here -- this whole block is a template literal evaluated in
    // the page, so one in a comment ends the string 40 lines early.)
    arches: count(board && board.tunnelArches),
    frame: { calls: info.calls, tris: info.triangles },
  };
})()`;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
const pad = (s: string, n: number) => String(s).padStart(n);
console.log("  theme     props      verge      decor      walls      fence     ground   surround    arches  |  FRAME calls / tris");
for (const t of themes) {
  await p.goto(`http://127.0.0.1:5173/preview-board/?theme=${t}&maze=0&view=game&hud=0`, { waitUntil: "load", timeout: 90000 });
  await p.waitForFunction(() => document.title.includes("ready"), null, { timeout: 20000 });
  // Let the animation loop draw at least one frame so renderer.info is real.
  await p.waitForTimeout(250);
  const r = (await p.evaluate(SRC)) as Record<string, { n: number; tri: number } & { calls?: number; tris?: number }>;
  const cell = (k: string) => `${pad(String(r[k].n), 3)}/${pad(String(r[k].tri), 6)}`;
  console.log(
    `  ${t.padEnd(8)} ${cell("props")} ${cell("verge")} ${cell("decor")} ${cell("walls")} ` +
      `${cell("fence")} ${cell("ground")} ${cell("surround")} ${cell("arches")}  |  ${pad(String(r.frame.calls), 4)} / ${pad(String(r.frame.tris), 7)}`,
  );
}
await b.close();
console.log(`
  n/tri per bucket; FRAME is renderer.info.render for the last drawn frame.

  BEFORE (IDEA-066 phase 0, 390x844, maze 0, measured 2026-09-14):
    theme     props        decor      walls      fence      ground   FRAME calls / tris
    garden   104/22488   52/ 3384   1/2376   1/66880   1/1680     356 / 146770
    classic    0/    0    0/    0   1/2376   0/    0   0/   0     198 /  52338
    forest     0/    0    3/  792   1/2376   0/    0   0/   0     201 /  53130
    park      66/15532    5/ 5700   1/2376   0/    0   0/   0     269 /  73570
    city      94/ 5368   15/  280   1/2376   0/    0   0/   0     307 /  57986
    beach     64/ 6888    4/ 2880   1/2376   0/    0   0/   0     266 /  62106

  THE BASELINE IS PELLETS, AND IT DWARFS EVERYTHING THIS PROJECT HAS TUNED.
  Arcade Night has ZERO props and still costs 198 draw calls. Traversed: 176
  unnamed SphereGeometry meshes -- one per biscuit, one draw call each -- plus
  four bones, the floor and the single instanced wall mesh. So ~90% of a
  propless board's draw calls are pellets, and instancing them would save more
  (~175) than the entire surround is allowed to spend (18). That is a separate
  idea, deliberately NOT done here; it is in the Inbox.

  IDEA-066 budgets are DELTAS over that table, because the garden already sits
  at 356 and an absolute ceiling below it would be a test nobody could pass:
    surround   <= 18 calls / 120k tris
    verge      <= 30 calls
    whole frame<= 420 calls on the worst theme (garden 356 + 48 + slack)
`);
