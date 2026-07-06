// Ghost targeting AI. Each ghost picks, among its walkable non-reversing
// neighbours, the one closest to a per-personality target tile. Falls back to
// reversing when boxed in so a ghost can never get stuck (validated in tests).
import { Grid, Vec2, DIRS, isReverse } from "./grid";
import { Entity } from "./movement";

export type GhostKind = "chaser" | "ambusher" | "clyde";
export type GlobalMode = "scatter" | "chase";
export type GhostState = "scatter" | "chase" | "frightened" | "eaten";

export interface Ghost {
  e: Entity;
  state: GhostState;
  kind: GhostKind;
  corner: Vec2;        // scatter target
}

export interface GhostAICtx {
  grid: Grid;
  beagle: Entity;      // uses beagle.tx/ty and beagle.facing
  globalMode: GlobalMode;
  ghostSpawn: Vec2;
}

export function chooseGhostDir(gh: Ghost, ctx: GhostAICtx): void {
  const e = gh.e;
  const g = ctx.grid;

  const walkAll: Vec2[] = [];
  const nonRev: Vec2[] = [];
  for (const k of Object.keys(DIRS) as (keyof typeof DIRS)[]) {
    const d = DIRS[k];
    if (!g.walkable(e.tx + d.x, e.ty + d.y, true)) continue;
    walkAll.push(d);
    if (!(isReverse(d, e.dir) && (e.dir.x || e.dir.y))) nonRev.push(d);
  }
  const cands = nonRev.length ? nonRev : walkAll;
  if (!cands.length) return; // fully walled — should never happen on a valid maze

  if (gh.state === "frightened") {
    e.queued = cands[(Math.random() * cands.length) | 0];
    return;
  }

  let target: Vec2;
  if (gh.state === "eaten") {
    target = ctx.ghostSpawn;
  } else if (ctx.globalMode === "scatter") {
    target = gh.corner;
  } else {
    const b = ctx.beagle;
    if (gh.kind === "chaser") target = { x: b.tx, y: b.ty };
    else if (gh.kind === "ambusher") target = { x: b.tx + b.facing.x * 4, y: b.ty + b.facing.y * 4 };
    else {
      const dist = Math.hypot(b.tx - e.tx, b.ty - e.ty);
      target = dist > 8 ? { x: b.tx, y: b.ty } : gh.corner;
    }
  }

  let best = cands[0];
  let bestD = Infinity;
  for (const d of cands) {
    const nd = Math.hypot((e.tx + d.x) - target.x, (e.ty + d.y) - target.y);
    if (nd < bestD) { bestD = nd; best = d; }
  }
  e.queued = best;
}
