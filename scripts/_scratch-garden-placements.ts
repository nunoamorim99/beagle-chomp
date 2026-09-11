// IDEA-060: generates the garden theme's wall-top placements.
//
// Hand-typing thirty of these is how you get two on the same tile and six in
// one corner. This spreads them deterministically and prints the literal to
// paste into themes.ts — the same "authored in a tool, pasted back" flow the
// editor's Save uses for props.ts.
//
// Two rules the picker enforces:
//
//  1. NEVER TWO ON ONE TILE, and a minimum spacing between any two, so the
//     board reads as a planted garden rather than as a rash.
//  2. A MIX OF ALWAYS-WALL AND SOMETIMES-WALL TILES. 81 of the 399 tiles are
//     wall in every one of the 18 mazes (mostly the border ring) and a
//     placement there always shows; the rest vary by layout, which is what
//     makes maze 7's garden a different garden from maze 2's. Nothing floats
//     either way now that buildWallDecor skips a non-wall tile.
import { COLS, Grid, ROWS } from "../src/game/grid";
import { MAZES } from "../src/game/mazes";

const grids = MAZES.map((m) => new Grid(m));
const wallCount = (x: number, y: number): number =>
  grids.filter((g) => g.cells[y][x] === "#").length;

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Candidates: any tile that is a wall in at least half the mazes, so a
// placement earns its line in the file.
const cands: Array<[number, number, number]> = [];
for (let y = 0; y < ROWS; y++) {
  for (let x = 0; x < COLS; x++) {
    const n = wallCount(x, y);
    if (n >= 9) cands.push([x, y, n]);
  }
}

const r = rng(0x60de1);
const chosen: Array<[number, number]> = [];
const MIN_GAP = 2.6;
// Shuffle deterministically, then take greedily with a spacing test.
const order = cands
  .map((c) => ({ c, k: r() }))
  .sort((a, b) => a.k - b.k)
  .map((o) => o.c);
for (const [x, y] of order) {
  if (chosen.some(([cx, cy]) => Math.hypot(cx - x, cy - y) < MIN_GAP)) continue;
  chosen.push([x, y]);
  if (chosen.length >= 34) break;
}
// Stable print order so a regenerate produces a readable diff.
chosen.sort((a, b) => a[1] - b[1] || a[0] - b[0]);

// The five flowers in rotation plus a birdhouse every seventh, so the mix is
// even without being a repeating pattern.
const FLOWERS = [
  "flower-daisy",
  "flower-blossom",
  "flower-tulip",
  "flower-sunflower",
  "flower-rose",
];
const lines = chosen.map(([x, y], i) => {
  const id = i % 7 === 3 ? "birdhouse" : FLOWERS[i % FLOWERS.length];
  const rot = Number((r() * Math.PI * 2).toFixed(3));
  // Flowers vary in scale; the birdhouse is a fixed object and should not.
  const scale = id === "birdhouse" ? 0.62 : Number((0.86 + r() * 0.34).toFixed(3));
  return `      { propId: "${id}", tile: [${x}, ${y}], rotationY: ${rot}, scale: ${scale} },`;
});

console.log("    wallDecor: [");
console.log(lines.join("\n"));
console.log("    ],");
console.log(
  `\n// ${chosen.length} placements; always-wall: ${chosen.filter(([x, y]) => wallCount(x, y) === 18).length}`,
);
for (let i = 0; i < MAZES.length; i++) {
  const shown = chosen.filter(([x, y]) => grids[i].cells[y][x] === "#").length;
  process.stdout.write(`maze ${i}: ${shown}  `);
}
console.log();
