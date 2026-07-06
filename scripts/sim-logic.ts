// Headless gameplay simulation. Runs the actual movement + ghost AI for a
// while and asserts: no NaN positions, no exceptions, ghosts stay mobile
// (never stuck in a dead-end), and a naive bot can eat a big share of pellets.
// This is the safety net for the trickiest logic. Run: npm run sim
import { MAZES } from "../src/game/mazes";
import { Grid, DIRS, COLS, ROWS, Vec2 } from "../src/game/grid";
import { makeEntity, stepEntity, entityWorld, Entity } from "../src/game/movement";
import { chooseGhostDir, Ghost, GlobalMode } from "../src/game/ghostAI";
import { SPEEDS } from "../src/game/config";

function greedyBeagleDir(e: Entity, grid: Grid, pellets: Set<string>): Vec2 {
  let best: Vec2 | null = null, bd = Infinity;
  for (const key of pellets) {
    const [px, py] = key.split(",").map(Number);
    const d = Math.hypot(px - e.tx, py - e.ty);
    if (d < bd) { bd = d; best = { x: px, y: py }; }
  }
  if (!best) return e.queued;
  const opts: Vec2[] = [];
  for (const k of Object.keys(DIRS) as (keyof typeof DIRS)[]) {
    const d = DIRS[k];
    if (!grid.walkable(e.tx + d.x, e.ty + d.y, false)) continue;
    if ((e.dir.x || e.dir.y) && d.x === -e.dir.x && d.y === -e.dir.y) continue; // no reverse
    opts.push(d);
  }
  const legal = opts.length ? opts : Object.values(DIRS).filter((d) => grid.walkable(e.tx + d.x, e.ty + d.y, false));
  let pick = e.queued, pd = Infinity;
  for (const d of legal) {
    const nd = Math.hypot((e.tx + d.x) - best.x, (e.ty + d.y) - best.y);
    if (nd < pd) { pd = nd; pick = d; }
  }
  return pick;
}

function runMaze(rows: string[], label: string): boolean {
  const grid = new Grid(rows);
  const pellets = new Set<string>();
  let beagleSpawn = { x: 9, y: 15 }, ghostSpawn = { x: 9, y: 9 };
  rows.forEach((r, y) => r.split("").forEach((c, x) => {
    if (c === "." || c === "o") pellets.add(`${x},${y}`);
    if (c === "P") beagleSpawn = { x, y };
    if (c === "G") ghostSpawn = { x, y };
  }));
  const startPellets = pellets.size;

  const beagle = makeEntity(beagleSpawn.x, beagleSpawn.y, SPEEDS.beagle);
  beagle.queued = { x: -1, y: 0 };

  const corners = [{ x: COLS - 2, y: 1 }, { x: 1, y: 1 }, { x: 1, y: ROWS - 2 }];
  const kinds = ["chaser", "ambusher", "clyde"] as const;
  const ghosts: Ghost[] = [0, 1, 2].map((i) => {
    const e = makeEntity(ghostSpawn.x, ghostSpawn.y, SPEEDS.ghost);
    e.dir = { x: 0, y: -1 }; e.queued = { x: 0, y: -1 };
    return { e, state: "chase", kind: kinds[i], corner: corners[i] };
  });
  const globalMode: GlobalMode = "chase";

  const dt = 1 / 60, TICKS = 60 * 90;
  let eaten = 0, nan = false, exceptions = 0;
  const moves = [0, 0, 0];
  const lastTile = ghosts.map((g) => `${g.e.tx},${g.e.ty}`);

  for (let t = 0; t < TICKS; t++) {
    try {
      beagle.queued = greedyBeagleDir(beagle, grid, pellets);
      stepEntity(beagle, dt, grid, false, (e) => {
        const key = `${e.tx},${e.ty}`;
        if (pellets.has(key)) { pellets.delete(key); eaten++; }
      });
      ghosts.forEach((gh, i) => {
        stepEntity(gh.e, dt, grid, true, () => chooseGhostDir(gh, { grid, beagle, globalMode, ghostSpawn }));
        const w = entityWorld(gh.e);
        if (Number.isNaN(w.x) || Number.isNaN(w.z)) nan = true;
        const tile = `${gh.e.tx},${gh.e.ty}`;
        if (tile !== lastTile[i]) moves[i]++;
        lastTile[i] = tile;
      });
      const bw = entityWorld(beagle);
      if (Number.isNaN(bw.x) || Number.isNaN(bw.z)) nan = true;
      if (pellets.size === 0) break;
    } catch (err) { exceptions++; if (exceptions <= 3) console.log("  EXC:", (err as Error).message); }
  }

  const ghostsMoved = moves.every((m) => m > 20);
  const ok = !nan && exceptions === 0 && eaten > 50 && ghostsMoved;
  console.log(`=== ${label} ===`);
  console.log(`  pellets eaten: ${eaten}/${startPellets} (${((100 * eaten) / startPellets) | 0}%)`);
  console.log(`  ghost tile-moves: ${moves.join(", ")}`);
  console.log(`  NaN: ${nan}  exceptions: ${exceptions}`);
  console.log(ok ? "  LOGIC OK" : "  PROBLEM");
  return ok;
}

let ok = true;
MAZES.forEach((rows, i) => { ok = runMaze(rows, `MAZE ${i + 1}`) && ok; });
console.log("\nALL LOGIC OK:", ok);
if (!ok) process.exit(1);
