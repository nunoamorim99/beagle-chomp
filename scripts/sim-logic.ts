// Headless gameplay simulation. Runs the actual movement + ghost AI for a
// while and asserts: no NaN positions, no exceptions, ghosts stay mobile
// (never stuck in a dead-end), and a bot can eat a big share of pellets.
// This is the safety net for the trickiest logic. Run: npm run sim
//
// THE BOT PATHFINDS; IT USED TO GUESS (IDEA-061). The original picked whichever
// legal turn reduced the STRAIGHT-LINE distance to the nearest pellet, which in
// a maze is not a plan: measured on the shipped mazes, it wedged into a 3-to-17
// tile loop in every single one of the eighteen and simply differed in how long
// it wandered first. Maze 7 cleared the "> 50 pellets" bar with 59 — so the
// assertion was a coin-flip on geometry, and eight perfectly sound new mazes
// tripped it. Now it runs a BFS over (tile, incoming direction) states — the
// no-reverse rule is part of the SEARCH rather than a filter applied after the
// target is chosen — so it clears every maze and the bar is a real one.
//
// This makes the check STRONGER, not laxer: "the bot eats nearly everything"
// now genuinely asserts that every pellet is reachable under the real movement
// rules, which is the thing the sim was always trying to say.
import { MAZES } from "../src/game/mazes";
import { Grid, DIRS, COLS, ROWS, Vec2 } from "../src/game/grid";
import { makeEntity, stepEntity, entityWorld, Entity } from "../src/game/movement";
import { chooseGhostDir, Ghost, GlobalMode } from "../src/game/ghostAI";
import { SPEEDS } from "../src/game/config";

const DIR_LIST: Vec2[] = Object.values(DIRS);

/** The tile a step in `d` from (x,y) lands on, honouring the tunnel wrap, or
 *  null if it is not walkable by the beagle. */
function stepTo(grid: Grid, x: number, y: number, d: Vec2): Vec2 | null {
  let nx = x + d.x;
  const ny = y + d.y;
  if (grid.tunnelRows.has(y) && d.x) nx = ((nx % COLS) + COLS) % COLS;
  return grid.walkable(nx, ny, false) ? { x: nx, y: ny } : null;
}

/**
 * Breadth-first search from (tile, incoming direction) to the nearest pellet,
 * returning the first step of that route.
 *
 * The state carries the DIRECTION because the no-reverse rule makes the same
 * tile a different situation depending on how you arrived — which is exactly
 * what the straight-line version could not represent, and why it drove into
 * pockets it then had to loop out of.
 */
function pathfindBeagleDir(e: Entity, grid: Grid, pellets: Set<string>): Vec2 {
  if (!pellets.size) return e.queued;

  const dirIdx = (d: Vec2) => DIR_LIST.findIndex((c) => c.x === d.x && c.y === d.y);
  const key = (x: number, y: number, di: number) => (y * COLS + x) * 4 + di;

  const startDir = dirIdx(e.dir);
  const seen = new Set<number>();
  // Each frontier entry remembers the FIRST move of the route that reached it.
  let frontier: Array<{ x: number; y: number; di: number; first: Vec2 | null }> = [
    { x: e.tx, y: e.ty, di: startDir, first: null },
  ];
  seen.add(key(e.tx, e.ty, startDir < 0 ? 0 : startDir));

  while (frontier.length) {
    const next: typeof frontier = [];
    for (const cur of frontier) {
      const back = cur.di >= 0 ? DIR_LIST[cur.di] : null;
      for (const d of DIR_LIST) {
        if (back && d.x === -back.x && d.y === -back.y) continue; // no reverse
        const t = stepTo(grid, cur.x, cur.y, d);
        if (!t) continue;
        const first = cur.first ?? d;
        if (pellets.has(`${t.x},${t.y}`)) return first;
        const k = key(t.x, t.y, dirIdx(d));
        if (seen.has(k)) continue;
        seen.add(k);
        next.push({ x: t.x, y: t.y, di: dirIdx(d), first });
      }
    }
    frontier = next;
  }

  // Nothing reachable without reversing: turn around rather than stall. The
  // real beagle may reverse freely, so this is the bot being MORE constrained
  // than the game, not less.
  for (const d of DIR_LIST) if (stepTo(grid, e.tx, e.ty, d)) return d;
  return e.queued;
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

  const dt = 1 / 60, TICKS = 60 * 180;
  let eaten = 0, nan = false, exceptions = 0, ticksUsed = TICKS;
  const moves = [0, 0, 0];
  const lastTile = ghosts.map((g) => `${g.e.tx},${g.e.ty}`);

  for (let t = 0; t < TICKS; t++) {
    try {
      // Decide INSIDE onArrive, the way the ghosts below do. Deciding in the
      // outer tick instead plans from the tile being LEFT, so `queued` always
      // described the step already in progress and the turn only landed a tile
      // late — the bot overshot every junction, which is most of why the old
      // one looked like it was circling.
      stepEntity(beagle, dt, grid, false, (e) => {
        const key = `${e.tx},${e.ty}`;
        if (pellets.has(key)) { pellets.delete(key); eaten++; }
        e.queued = pathfindBeagleDir(e, grid, pellets);
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
      if (pellets.size === 0) { ticksUsed = t + 1; break; }
    } catch (err) { exceptions++; if (exceptions <= 3) console.log("  EXC:", (err as Error).message); }
  }

  const ghostsMoved = moves.every((m) => m > 20);
  // The bar is a CLEARED BOARD, not a share of one. With a pathfinding bot that
  // is a real statement — every pellet is reachable under the actual movement
  // rules, from the actual spawn, with the tunnel behaving — and it is what a
  // sealed pocket or an unreachable pellet would break. `eaten > 50` could not
  // say that: it passed on mazes the bot had abandoned five-sixths of.
  const cleared = eaten === startPellets;
  const ok = !nan && exceptions === 0 && cleared && ghostsMoved;
  console.log(`=== ${label} ===`);
  console.log(`  pellets eaten: ${eaten}/${startPellets} (${((100 * eaten) / startPellets) | 0}%)` +
    ` in ${(ticksUsed / 60).toFixed(1)}s of ${(TICKS / 60).toFixed(0)}s`);
  console.log(`  ghost tile-moves: ${moves.join(", ")}`);
  console.log(`  NaN: ${nan}  exceptions: ${exceptions}`);
  console.log(ok ? "  LOGIC OK" : "  PROBLEM");
  return ok;
}

let ok = true;
MAZES.forEach((rows, i) => { ok = runMaze(rows, `MAZE ${i + 1}`) && ok; });
console.log("\nALL LOGIC OK:", ok);
if (!ok) process.exit(1);
