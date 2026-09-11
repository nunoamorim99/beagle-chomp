// IDEA-060: is a hand-placed wall-top prop actually on a WALL in every maze?
//
// buildWallDecor seats a placement at `WALL_H + offset` with no grid check at
// all, so a tile that is '#' in the maze the placement was authored against
// but ' ' or '.' in another leaves the prop hanging in mid-air over a corridor.
// The city theme already ships five of these; the garden is about to ship
// nearly thirty.
import { Grid } from "../src/game/grid";
import { MAZES } from "../src/game/mazes";
import { MAZE_THEMES } from "../src/game/themes";
import { COLS, ROWS } from "../src/game/grid";

const grids = MAZES.map((m) => new Grid(m));

for (const theme of MAZE_THEMES) {
  if (theme.wallDecor.length === 0) continue;
  console.log(`\n${theme.id}: ${theme.wallDecor.length} wall-top placements`);
  for (const p of theme.wallDecor) {
    const [x, y] = p.tile;
    const bad = grids
      .map((g, i) => (g.cells[y]?.[x] === "#" ? -1 : i))
      .filter((i) => i >= 0);
    console.log(
      `  ${p.propId} at (${x},${y}) — wall in ${MAZES.length - bad.length}/${MAZES.length} mazes` +
        (bad.length ? `, FLOATS in maze ${bad.join(",")}` : ""),
    );
  }
}

// How many tiles are '#' in EVERY maze? Those are the safe places to author.
let always = 0;
const safe: Array<[number, number]> = [];
for (let y = 0; y < ROWS; y++) {
  for (let x = 0; x < COLS; x++) {
    if (grids.every((g) => g.cells[y][x] === "#")) {
      always++;
      safe.push([x, y]);
    }
  }
}
console.log(`\n${always} tiles are wall in ALL ${MAZES.length} mazes (of ${COLS * ROWS}).`);
