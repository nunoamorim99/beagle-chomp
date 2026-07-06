// Tile grid + walkability. Pure logic, no three.js.
// Legend: # wall  . biscuit  o bone  ' ' void  P beagle  G ghost spawn
//         = pen  - door  T tunnel  F fruit
import data from "./mazes.json";

export const COLS = data.cols;
export const ROWS = data.rows;
export const TILE = 1;
export const OX = (COLS - 1) / 2;
export const OZ = (ROWS - 1) / 2;

export const worldX = (tx: number) => (tx - OX) * TILE;
export const worldZ = (ty: number) => (ty - OZ) * TILE;

export interface Vec2 { x: number; y: number; }

export const DIRS = {
  up:    { x: 0, y: -1 },
  down:  { x: 0, y: 1 },
  left:  { x: -1, y: 0 },
  right: { x: 1, y: 0 },
} as const;

export function isReverse(a: Vec2, b: Vec2): boolean {
  return a.x === -b.x && a.y === -b.y && !!(a.x || a.y);
}

export class Grid {
  cells: string[][];
  tunnelRows: Set<number>;

  constructor(rows: string[]) {
    this.cells = rows.map((r) => r.split(""));
    this.tunnelRows = new Set();
    this.cells.forEach((row, y) => { if (row.includes("T")) this.tunnelRows.add(y); });
  }

  charAt(tx: number, ty: number): string {
    if (ty < 0 || ty >= ROWS) return "#";
    if (this.tunnelRows.has(ty)) tx = ((tx % COLS) + COLS) % COLS;
    else if (tx < 0 || tx >= COLS) return "#";
    return this.cells[ty][tx];
  }

  /** forGhost=true lets an entity walk pen/door tiles; the beagle cannot. */
  walkable(tx: number, ty: number, forGhost: boolean): boolean {
    const c = this.charAt(tx, ty);
    if (c === "#" || c === " ") return false;
    if (!forGhost && (c === "G" || c === "=" || c === "-")) return false;
    return true;
  }
}
