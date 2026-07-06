// Validate maze layouts: rectangular, connected, all pellets reachable,
// spawns valid, pen reachable by ghosts. Pure logic — no three.js.

// Legend:
//  #   wall
//  .   biscuit (pellet)
//  o   bone (power-up)
//  ' ' empty path (no pellet)
//  P   beagle spawn (path)
//  G   ghost spawn (pen interior, ghost-only)
//  =   pen interior (ghost-only, no pellet)
//  -   pen door (passage for ghosts leaving)
//  F   fruit spawn (path, no pellet)

const MAZE1 = [
  "###################",
  "#........#........#",
  "#o##.###.#.###.##o#",
  "#.................#",
  "#.##.#.#####.#.##.#",
  "#....#...#...#....#",
  "####.###.#.###.####",
  "   #.#...=...#.#   ",
  "####.#.##-##.#.####",
  "T......#=G=#......T",
  "####.#.#####.#.####",
  "   #.#.......#.#   ",
  "####.#.#####.#.####",
  "#........#........#",
  "#.##.###.#.###.##.#",
  "#o.#....FPF....#.o#",
  "##.#.#.#####.#.#.##",
  "#....#...#...#....#",
  "#.######.#.######.#",
  "#.................#",
  "###################",
];

function analyze(maze, name) {
  console.log(`\n=== ${name} ===`);
  const rows = maze.length;
  const cols = maze[0].length;
  let ok = true;

  // rectangular
  maze.forEach((r, i) => {
    if (r.length !== cols) {
      console.log(`  ! row ${i} has length ${r.length}, expected ${cols}`);
      ok = false;
    }
  });

  const grid = maze.map(r => r.split(""));
  const at = (x, y) => (grid[y] && grid[y][x] !== undefined) ? grid[y][x] : "#";

  // tunnel wrap: treat off-grid on tunnel rows as walkable via wrap
  const tunnelRows = new Set();
  grid.forEach((row, y) => { if (row.includes("T")) tunnelRows.add(y); });

  const beagleWalk = (x, y) => {
    const c = at(x, y);
    return c !== "#" && c !== " " && c !== "G" && c !== "=" && c !== "-";
  };
  const ghostWalk = (x, y) => { const c = at(x, y); return c !== "#" && c !== " "; };

  // find spawns
  let P = null; const ghosts = [];
  grid.forEach((row, y) => row.forEach((c, x) => {
    if (c === "P") P = { x, y };
    if (c === "G") ghosts.push({ x, y });
  }));
  if (!P) { console.log("  ! no beagle spawn P"); ok = false; }
  if (ghosts.length === 0) { console.log("  ! no ghost spawn G"); ok = false; }

  // flood fill (with tunnel wrap) using a walkable predicate
  function flood(start, walk) {
    const seen = new Set();
    const key = (x, y) => `${x},${y}`;
    const stack = [start];
    seen.add(key(start.x, start.y));
    while (stack.length) {
      const { x, y } = stack.pop();
      const nbrs = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
      for (let [nx, ny] of nbrs) {
        // tunnel wrap horizontally on tunnel rows
        if (tunnelRows.has(y)) {
          if (nx < 0) nx = cols - 1;
          if (nx >= cols) nx = 0;
        }
        if (ny < 0 || ny >= rows) continue;
        if (nx < 0 || nx >= cols) continue;
        if (!walk(nx, ny)) continue;
        const k = key(nx, ny);
        if (!seen.has(k)) { seen.add(k); stack.push({ x: nx, y: ny }); }
      }
    }
    return seen;
  }

  const reach = flood(P, beagleWalk);

  // pellet reachability
  let pellets = 0, bones = 0, unreachable = 0;
  grid.forEach((row, y) => row.forEach((c, x) => {
    if (c === "." || c === "o") {
      if (c === ".") pellets++; else bones++;
      if (!reach.has(`${x},${y}`)) {
        unreachable++;
        console.log(`  ! unreachable ${c} at (${x},${y})`);
        ok = false;
      }
    }
  }));

  // ghost mobility: can a ghost leave the pen and reach the board?
  const ghostReach = flood(ghosts[0], ghostWalk);
  // does ghostReach include a non-pen path tile far away, e.g. P's tile?
  if (!ghostReach.has(`${P.x},${P.y}`)) {
    console.log("  ! ghosts cannot reach the beagle's start area (pen sealed?)");
    ok = false;
  }

  // count total beagle-walkable tiles reachable vs total, to spot dead zones
  let totalWalk = 0;
  grid.forEach((row, y) => row.forEach((c, x) => { if (beagleWalk(x, y)) totalWalk++; }));
  const isolated = totalWalk - reach.size;
  if (isolated > 0) {
    const iso = [];
    grid.forEach((row, y) => row.forEach((c, x) => {
      if (beagleWalk(x, y) && !reach.has(`${x},${y}`)) iso.push(`(${x},${y})='${c}'`);
    }));
    console.log("  isolated tiles: " + iso.join(" "));
  }

  console.log(`  size: ${cols} x ${rows}`);
  console.log(`  biscuits: ${pellets}, bones: ${bones}`);
  console.log(`  beagle-walkable tiles: ${totalWalk}, reachable from P: ${reach.size}, isolated: ${isolated}`);
  console.log(`  tunnel rows: ${[...tunnelRows].join(",") || "none"}`);
  console.log(`  ghost spawns: ${ghosts.length}`);
  console.log(ok && unreachable === 0 && isolated === 0 ? "  RESULT: VALID ✔" : "  RESULT: NEEDS FIXING �“—");
  return ok && unreachable === 0 && isolated === 0;
}

const MAZE2 = [
  "###################",
  "#........#........#",
  "#.##.###.#.###.##.#",
  "#.................#",
  "#o##.#.#####.#.##o#",
  "#....#...#...#....#",
  "####.###.#.###.####",
  "   #.#...=...#.#   ",
  "####.#.##-##.#.####",
  "T......#=G=#......T",
  "####.#.#####.#.####",
  "   #.#.......#.#   ",
  "####.#.#####.#.####",
  "#........#........#",
  "#.###.##.#.##.###.#",
  "#o.#....FPF..#..o.#",
  "##.#.#.#####.#.#.##",
  "#....#...#...#....#",
  "#.######.#.######.#",
  "#.................#",
  "###################",
];

const v1 = analyze(MAZE1, "MAZE1");
const v2 = analyze(MAZE2, "MAZE2");
console.log("\nALL VALID:", v1 && v2);
