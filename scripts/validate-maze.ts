// Validates every maze: rectangular, fully connected, all pellets reachable,
// ghosts can leave the pen. Uses the real Grid.walkable so it can never drift
// from in-game rules. Run: npm run validate
import { MAZES } from "../src/game/mazes";
import { Grid, COLS, ROWS } from "../src/game/grid";

function flood(grid: Grid, start: { x: number; y: number }, forGhost: boolean): Set<string> {
  const seen = new Set<string>([`${start.x},${start.y}`]);
  const stack = [start];
  while (stack.length) {
    const { x, y } = stack.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      let nx = x + dx, ny = y + dy;
      if (grid.tunnelRows.has(y)) { if (nx < 0) nx = COLS - 1; else if (nx >= COLS) nx = 0; }
      if (!grid.walkable(nx, ny, forGhost)) continue;
      const k = `${nx},${ny}`;
      if (!seen.has(k)) { seen.add(k); stack.push({ x: nx, y: ny }); }
    }
  }
  return seen;
}

let allOk = true;
MAZES.forEach((rows, idx) => {
  console.log(`\n=== MAZE ${idx + 1} ===`);
  let ok = true;
  if (rows.length !== ROWS) { console.log(`  ! ${rows.length} rows, expected ${ROWS}`); ok = false; }
  rows.forEach((r, y) => { if (r.length !== COLS) { console.log(`  ! row ${y} width ${r.length}, expected ${COLS}`); ok = false; } });

  const grid = new Grid(rows);
  let P: { x: number; y: number } | null = null;
  let G: { x: number; y: number } | null = null;
  let biscuits = 0, bones = 0;
  rows.forEach((r, y) => r.split("").forEach((c, x) => {
    if (c === "P") P = { x, y };
    if (c === "G") G = { x, y };
    if (c === ".") biscuits++;
    if (c === "o") bones++;
  }));
  if (!P) { console.log("  ! no beagle spawn P"); ok = false; }
  if (!G) { console.log("  ! no ghost spawn G"); ok = false; }
  if (!P || !G) { allOk = false; return; }

  const reach = flood(grid, P, false);
  let unreachable = 0;
  rows.forEach((r, y) => r.split("").forEach((c, x) => {
    if ((c === "." || c === "o") && !reach.has(`${x},${y}`)) {
      unreachable++; console.log(`  ! unreachable '${c}' at (${x},${y})`); ok = false;
    }
  }));

  const ghostReach = flood(grid, G, true);
  if (!ghostReach.has(`${P.x},${P.y}`)) { console.log("  ! ghosts can't reach the board (pen sealed?)"); ok = false; }

  console.log(`  biscuits: ${biscuits}, bones: ${bones}, unreachable: ${unreachable}`);
  console.log(ok ? "  VALID" : "  NEEDS FIXING");
  allOk = allOk && ok;
});

console.log("\nALL MAZES VALID:", allOk);
if (!allOk) process.exit(1);
