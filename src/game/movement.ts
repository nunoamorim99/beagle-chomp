// Entity movement using a tile-stepping model: entities move smoothly between
// tile centres and may only change direction when they arrive at a centre.
// This is the single trickiest piece of any maze-chase game — it is validated
// headlessly in scripts/sim-logic.ts. Do not "simplify" without re-running tests.
import { Grid, Vec2, COLS, worldX, worldZ } from "./grid";

export interface Entity {
  tx: number;          // current tile x
  ty: number;          // current tile y
  dir: Vec2;           // current heading ({0,0} = stopped)
  queued: Vec2;        // desired heading, applied at next centre if walkable
  progress: number;    // 0..1 from current tile toward (tx+dir, ty+dir)
  speed: number;       // tiles per second
  facing: Vec2;        // last non-zero heading (for model orientation / AI)
}

export function makeEntity(tx: number, ty: number, speed: number): Entity {
  return { tx, ty, dir: { x: 0, y: 0 }, queued: { x: 0, y: 0 }, progress: 0, speed, facing: { x: 0, y: 1 } };
}

/** World-space position of an entity, interpolated between tile centres. */
export function entityWorld(e: Entity): { x: number; z: number } {
  const fx = worldX(e.tx), fz = worldZ(e.ty);
  const nx = e.tx + e.dir.x, ny = e.ty + e.dir.y;
  return {
    x: fx + (worldX(nx) - fx) * e.progress,
    z: fz + (worldZ(ny) - fz) * e.progress,
  };
}

/**
 * Advance one entity by dt seconds. `onArrive` fires once per tile centre
 * reached (use it to eat pellets or run ghost AI). Direction changes are only
 * applied at centres, and a blocked entity stops cleanly (never overshoots).
 */
export function stepEntity(
  e: Entity,
  dt: number,
  grid: Grid,
  forGhost: boolean,
  onArrive: (e: Entity) => void,
): void {
  if (e.dir.x === 0 && e.dir.y === 0) {
    if (grid.walkable(e.tx + e.queued.x, e.ty + e.queued.y, forGhost)) e.dir = { ...e.queued };
    else return;
  }

  e.progress += e.speed * dt;
  let guard = 0;
  while (e.progress >= 1 && guard++ < 8) {
    e.progress -= 1;
    e.tx += e.dir.x;
    e.ty += e.dir.y;

    // tunnel wrap
    if (grid.tunnelRows.has(e.ty)) {
      if (e.tx < 0) e.tx = COLS - 1;
      else if (e.tx >= COLS) e.tx = 0;
    }

    if (e.dir.x || e.dir.y) e.facing = { x: e.dir.x, y: e.dir.y };
    onArrive(e);

    // choose next direction at this centre
    if ((e.queued.x || e.queued.y) && grid.walkable(e.tx + e.queued.x, e.ty + e.queued.y, forGhost)) {
      e.dir = { ...e.queued };
    } else if (!grid.walkable(e.tx + e.dir.x, e.ty + e.dir.y, forGhost)) {
      e.dir = { x: 0, y: 0 };
      e.progress = 0;
      break;
    }
  }
}
