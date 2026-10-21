// OWNER: render-artist (IDEA-081 — the City Park's surround)
//
// The park is the second surround that is DESIGNED rather than grown, after
// the beach (seaside.ts). Nuno's layout, side for side:
//
//   - EAST and WEST: one straight AVENUE out of the two TUNNEL MOUTHS — a
//     kerbed paved path lined with benches, a few bins and an avenue of trees
//     joined by low clipped hedges.
//   - NORTH: a lake with reeds, lily pads and ducks, and a footpath round it
//     with benches looking at the water.
//   - SOUTH: a children's playground — a slide, a dome climber and a swing in
//     a fenced play area, its gate facing the maze.
//
// IT WAS BUILT THE OTHER WAY ROUND FIRST, and the reason it moved is the most
// useful thing in this file. The avenue ran north-south with the playground
// west and the lake east — and on a PHONE the maze fills the frame's whole
// width, so the ground east and west of it is simply not in shot (a portrait
// frame reaches |x| ~15; the board alone is 10.5). Both features Nuno named
// were invisible to every phone player. North and south are the only bands a
// portrait frame shows, so they carry the two LANDMARKS, and the avenue — a
// strip, legible wherever any of it shows — takes east and west, which a
// desktop sees.
//
// The plot lattice still fills the rest of the ground with groves and lawn,
// and every zone here RESERVES its ground from it: a plot or a fringe item
// that would land on one is dropped whole, never clipped — surround rule 2,
// for the same reason. A grove standing in the middle of a path reads as a
// bug; a missing one reads as "that is where the path is".
//
// Three rules:
//
// 1. THE AVENUE IS FORMAL, SO IT IS MIRRORED AND REGULAR. Everything else in
//    the surround is jittered so it does not read as a grid. An avenue is the
//    one thing in a park whose regularity IS the read: two straight rows of
//    trees at an even pitch is what says "laid out". Variety comes from the
//    trees' own seeds, not from where they stand.
//
// 2. IT RUNS ALONG THE TUNNEL ROW. Every one of the 36 mazes has exactly one
//    crossing, row 9 at both ends (IDEA-067), so the path leaves the board
//    exactly where the beagle does. The crossing stops ending at the edge of
//    the world and starts going somewhere.
//
// 3. THE SOUTH IS HELD DOWN. South is portrait-only, unfogged, nearest the
//    camera and under the HUD and the controls (surround rule 4). The play
//    equipment is under two units, and the playground's trees are shortened
//    to the south fringe's own range, which IDEA-070 tuned for this band.
import * as THREE from "three";
import { COLS, OZ } from "../game/grid";
import { SURROUND_PARAMS, SURROUND_VIEW } from "./surround";
import {
  type SurroundMaterials,
  LAKE_SHORE_MAX,
  distantBench,
  distantBin,
  distantBroadleaf,
  distantClimbDome,
  distantDuck,
  distantClippedHedge,
  distantLake,
  distantLakePath,
  distantLilyPad,
  distantPath,
  distantPlayArea,
  distantReeds,
  distantShrubClump,
  distantSlide,
  distantSwing,
  lakeShore,
} from "./surroundProps";

/** The board's own floor plane reaches this, in world units. */
const FLOOR_HALF_X = (COLS + 2) / 2; // 10.5

/** The maze's one crossing is row 9 on every board (IDEA-067). */
const TUNNEL_ROW = 9;

/** The park's dials. Named and mutable for the editor, like SEASIDE_PARAMS. */
export const PARK_PARAMS = {
  /** World z the avenue runs along — the tunnel row's centre. */
  avenueZ: TUNNEL_ROW - OZ,
  /** Paved width of the avenue's path, kerbs excluded. */
  pathWidth: 2.6,
  /** Distance along the avenue between one slot and the next. Trees stand
   *  every OTHER slot, so the tree pitch is twice this. */
  slotPitch: 2.6,
  /** Offset of the bench / bin row from the path's EDGE. */
  innerRow: 0.55,
  /** Offset of the tree / bed row from the path's EDGE. */
  outerRow: 2.0,
  /** Ground reserved either side of the outer row, beyond the trees' crowns,
   *  that no plot or fringe item may take. */
  reserve: 1.3,
  /** Furniture starts this far past the board's floor edge. The path itself
   *  runs right up to the board; the first rings beyond it are the verge,
   *  where props are placed by hand, so nothing procedural stands there. */
  furnitureStart: SURROUND_PARAMS.keepClear + 0.5,
  /** Every Nth tree gets a bin at its foot on the bench row. */
  binEvery: 2,
  treeHeight: 2.35,
  /** The hedge between each pair of avenue trees: its height, and how far it
   *  stops short of each trunk. Held to about half a wall so it reads as a
   *  low clipped fence behind the benches, never as more maze. */
  hedgeHeight: 0.5,
  hedgeTrunkGap: 0.55,
};

/** Half the width of ground the avenue reserves, either side of its line. */
export function avenueHalfWidth(): number {
  const P = PARK_PARAMS;
  return P.pathWidth / 2 + P.outerRow + P.reserve;
}

/** Is (x, z) on the avenue's reserved ground? The board itself is excluded —
 *  that is the keep-clear box's business, not this. */
export function inAvenue(x: number, z: number, pad = 0): boolean {
  return Math.abs(z - PARK_PARAMS.avenueZ) < avenueHalfWidth() + pad && Math.abs(x) > FLOOR_HALF_X - pad;
}

/**
 * The lake, NORTH of the board. Water radii and the footpath, world units.
 *
 * WIDE AND SHALLOW, and placed for two frames at once. A phone sees the north
 * band whole, out to z ~ -38. A 16:9 desktop's frame ends at z = -21.2, and
 * the keep-clear box ends at -14.5, so a lake centred where a phone frames it
 * well shows a desktop its southern half — the near shore, the path, the
 * benches and the ducks — with the far shore running out past the top of the
 * picture, which reads as a lake that carries on rather than a cropped one.
 */
export const LAKE = {
  cx: 0,
  cz: -20.5,
  rx: 7,
  rz: 3.5,
  /** Gap from the water's edge to the footpath's inner edge. */
  pathOffset: 1.0,
  pathWidth: 0.85,
  /** Ground reserved beyond the footpath, for its benches and trees. */
  reserve: 1.6,
  seed: 0,
};

/** The lake zone's half-extents, footpath and reserve included. */
function lakeHalfExtents(pad = 0): [number, number] {
  const L = LAKE;
  const grow = (r: number): number => (r + L.pathOffset) * LAKE_SHORE_MAX + L.pathWidth + L.reserve + pad;
  return [grow(L.rx), grow(L.rz)];
}

/** Is (x, z) on the lake's reserved ground? A bounding box, deliberately: the
 *  reservation only has to keep plots out, and a box is the cheap safe side. */
export function inLake(x: number, z: number, pad = 0): boolean {
  const [hx, hz] = lakeHalfExtents(pad);
  return Math.abs(x - LAKE.cx) < hx && Math.abs(z - LAKE.cz) < hz;
}

/**
 * The playground, SOUTH of the board, gate facing the maze.
 *
 * Wider than deep because the south band is SHALLOW on screen: a phone's frame
 * ends at z = +22.4 and the keep-clear box at +14.5, so there are eight units
 * of depth to work in, and the frame is only ~10 units either side down here.
 */
export const PLAYGROUND = {
  cx: 0,
  cz: 18.3,
  /** Along X. */
  width: 10,
  /** Along Z. */
  depth: 5.6,
  /** Ground reserved round the fence, for its own shade trees. */
  reserve: 2.0,
  treeHeight: 1.75,
};

/** Is (x, z) on the playground's reserved ground? */
export function inPlayground(x: number, z: number, pad = 0): boolean {
  const P = PLAYGROUND;
  const r = P.reserve + pad;
  return Math.abs(x - P.cx) < P.width / 2 + r && Math.abs(z - P.cz) < P.depth / 2 + r;
}

/** Is (x, z) on ANY of the park's reserved zones? */
export function inParkZone(x: number, z: number, pad = 0): boolean {
  return inAvenue(x, z, pad) || inPlayground(x, z, pad) || inLake(x, z, pad);
}

/** Do two axis-aligned XZ boxes overlap? */
function boxesTouch(
  a: [number, number, number, number],
  b: [number, number, number, number],
): boolean {
  return !(a[1] < b[0] || a[0] > b[1] || a[3] < b[2] || a[2] > b[3]);
}

/** Does an axis-aligned XZ box touch any of the park's reserved zones? */
export function boxInParkZone(x0: number, x1: number, z0: number, z1: number): boolean {
  const box: [number, number, number, number] = [x0, x1, z0, z1];
  const az = PARK_PARAMS.avenueZ;
  const ah = avenueHalfWidth();
  // The avenue: its z-band, past the board on either side.
  if (z1 > az - ah && z0 < az + ah && (x0 < -FLOOR_HALF_X || x1 > FLOOR_HALF_X)) return true;
  const [lx, lz] = lakeHalfExtents();
  if (boxesTouch(box, [LAKE.cx - lx, LAKE.cx + lx, LAKE.cz - lz, LAKE.cz + lz])) return true;
  const P = PLAYGROUND;
  const px = P.width / 2 + P.reserve;
  const pz = P.depth / 2 + P.reserve;
  return boxesTouch(box, [P.cx - px, P.cx + px, P.cz - pz, P.cz + pz]);
}

/** Deterministic 0..1 off an integer pair, on the park's own seed band. */
function hash(a: number, b: number): number {
  let h = Math.imul(a + 7919, 73856093) ^ Math.imul(b + 104729, 19349663) ^ Math.imul(811, 83492791);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * The avenue, east and west: path, then the two mirrored rows either side.
 *
 * Each side's outer row is TREES joined by low HEDGES, and a BENCH sits on the
 * inner row in front of every hedge — so a bench always has a hedge at its
 * back and a tree either side, which is the composition a park bench actually
 * has.
 * A bin stands at the foot of every `binEvery`-th tree, on the bench row.
 */
export function buildParkAvenue(host: THREE.Group, m: SurroundMaterials): void {
  const P = PARK_PARAMS;
  const halfPath = P.pathWidth / 2;
  const innerOff = halfPath + P.innerRow;
  const outerOff = halfPath + P.outerRow;
  const az = P.avenueZ;

  for (const dir of [-1, 1] as const) {
    // The path runs from the board's floor edge to the end of the ground the
    // camera can see — culled like everything else (IDEA-069), and never past
    // the ground that exists.
    const end = Math.min(SURROUND_VIEW.halfX, SURROUND_PARAMS.halfWidth);
    const len = end - FLOOR_HALF_X;
    if (len <= 0) continue;
    const path = distantPath(m, { length: len, width: P.pathWidth });
    path.position.set(dir * (FLOOR_HALF_X + len / 2), 0, az);
    // distantPath runs along its local Z; turn it to run along X.
    path.rotation.y = Math.PI / 2;
    host.add(path);

    const first = FLOOR_HALF_X + P.furnitureStart;
    for (let k = 0; ; k++) {
      const d = first + k * P.slotPitch;
      if (d > end - 0.5) break;
      const x = dir * d;
      for (const side of [-1, 1] as const) {
        const seed = k * 2 + (side > 0 ? 1 : 0) + (dir > 0 ? 500 : 0);
        // A bench's sitting side is its local +Z. A bench on the +Z side of
        // the path faces -Z (Ry(pi)); one on the -Z side keeps 0.
        const face = side > 0 ? Math.PI : 0;
        if (k % 2 === 0) {
          const tree = distantBroadleaf(m, {
            height: P.treeHeight + hash(seed, 1) * 0.35,
            seed: 301 + seed,
          });
          tree.position.set(x, 0, az + side * outerOff);
          tree.userData.avenue = true;
          host.add(tree);
          if ((k / 2) % P.binEvery === 1) {
            const bin = distantBin(m);
            bin.position.set(x, 0, az + side * innerOff);
            host.add(bin);
          }
        } else {
          // A clipped hedge from trunk to trunk, so each side of the path
          // reads as a low green FENCE broken only by its trees (Nuno: *"lets
          // change for horizontal shrubs that will look like a fence"*). It
          // was a flower bed, and an oval of coloured dots between every pair
          // of trees read as litter rather than as a boundary.
          const hedge = distantClippedHedge(m, {
            length: P.slotPitch * 2 - P.hedgeTrunkGap * 2,
            height: P.hedgeHeight,
            seed: 401 + seed,
          });
          hedge.name = "avenue-hedge";
          // A run is built along its local +X, which is already ALONG the avenue.
          hedge.position.set(x, 0, az + side * outerOff);
          hedge.userData.avenue = true;
          host.add(hedge);
          const bench = distantBench(m, { seed: 451 + seed });
          bench.position.set(x, 0, az + side * innerOff);
          bench.rotation.y = face;
          host.add(bench);
        }
      }
    }
  }
}

/** A point on the lake's outline at angle `t`: `k` times the shore (1 is the
 *  water's edge), plus `out` world units further out. World XZ. */
function lakePoint(t: number, k: number, out = 0): [number, number] {
  const L = LAKE;
  const sh = lakeShore(t, L.seed);
  return [
    L.cx + Math.cos(t) * (L.rx * sh * k + out * sh),
    L.cz + Math.sin(t) * (L.rz * sh * k + out * sh),
  ];
}

/**
 * The lake: water, the footpath round it, and what lives on and beside it.
 *
 * Angles run from +X toward +Z, so +pi/2 is the SOUTH shore — the one facing
 * the board. Trees stay off that side: it is the near shore, the one a desktop
 * frame shows, and a row of crowns there would hide the water behind them.
 */
export function buildLake(host: THREE.Group, m: SurroundMaterials): void {
  const L = LAKE;
  if (L.cz + L.rz * 2 < SURROUND_VIEW.zFar - L.reserve) return; // off-frame (IDEA-069)
  const g = new THREE.Group();
  g.name = "park-lake";
  host.add(g);
  const add = (o: THREE.Object3D, [x, z]: [number, number], rotY = 0): void => {
    o.position.set(x, 0, z);
    o.rotation.y = rotY;
    g.add(o);
  };
  // The group stays at the origin so every child is placed in WORLD XZ, the
  // same frame the reservation is measured in.
  add(distantLake(m, { rx: L.rx, rz: L.rz, seed: L.seed }), [L.cx, L.cz]);
  add(
    distantLakePath(m, { rx: L.rx, rz: L.rz, offset: L.pathOffset, width: L.pathWidth, seed: L.seed }),
    [L.cx, L.cz],
  );

  // Facing the water: Ry(t) sends +Z to (sin t, 0, cos t), so a bench at
  // (x, z) looking at the centre turns by atan2(cx - x, cz - z).
  const facing = ([x, z]: [number, number]): number => Math.atan2(L.cx - x, L.cz - z);
  const benchOut = L.pathOffset + L.pathWidth + 0.4;
  // Two on the near shore, backs to the maze, looking out over the water —
  // the benches a desktop player actually sees — and three round the far side.
  [Math.PI / 2 - 0.75, Math.PI / 2 + 0.75, -Math.PI / 2, -Math.PI / 2 - 0.85, -Math.PI / 2 + 0.85].forEach((t, i) => {
    const p = lakePoint(t, 1, benchOut);
    add(distantBench(m, { seed: 701 + i }), p, facing(p));
  });
  add(distantBin(m), lakePoint(Math.PI / 2 - 0.42, 1, benchOut));

  // Trees beyond the path, round the far side and the two ends.
  const treeOut = L.pathOffset + L.pathWidth + 1.5;
  [-2.75, -2.25, -1.85, -1.3, -0.9, -0.4, 0.15, Math.PI - 0.15].forEach((t, i) => {
    add(distantBroadleaf(m, { height: 2.2 + hash(i, 950) * 0.6, seed: 721 + i }), lakePoint(t, 1, treeOut));
  });

  // Between the water and the path: a few shrubs, and reeds AT the shore.
  [-2.4, -0.7, 2.6].forEach((t, i) => {
    add(distantShrubClump(m, { seed: 741 + i }), lakePoint(t, 1, L.pathOffset * 0.55));
  });
  [-2.9, -2.0, -1.0, 0.2, 0.9, 2.3, 2.95].forEach((t, i) => {
    add(distantReeds(m, { seed: 751 + i }), lakePoint(t, 0.98), hash(i, 960) * Math.PI);
  });

  // Lily pads in the shallows, clustered near the reeds rather than evenly
  // round — real ones colonise the sheltered margins.
  [-2.8, -2.6, -1.1, 0.35, 0.55, 2.2, 2.45, 2.8].forEach((t, i) => {
    add(distantLilyPad(m, { seed: 761 + i }), lakePoint(t, 0.88 + hash(i, 970) * 0.06), hash(i, 971) * 6.28);
  });

  // Ducks on the water: a mother leading three ducklings in single file, and
  // two more on their own. The line is what says "ducks" at a few pixels,
  // because it is visible when no single bird is. The family is on the NEAR
  // half of the lake, so a desktop frame — which ends mid-lake — still has it.
  const heading = 1.25; // roughly +X: Ry(h) sends +Z to (sin h, cos h)
  const dir: [number, number] = [Math.sin(heading), Math.cos(heading)];
  const lead: [number, number] = [L.cx - 1.5, L.cz + 0.9];
  add(distantDuck(m), lead, heading);
  for (let i = 1; i <= 3; i++) {
    const back = 0.45 + i * 0.4;
    add(
      distantDuck(m, { size: 0.6 }),
      [lead[0] - dir[0] * back, lead[1] - dir[1] * back],
      heading + (hash(i, 980) - 0.5) * 0.4,
    );
  }
  add(distantDuck(m), [L.cx + 3.2, L.cz + 0.6], -2.2);
  add(distantDuck(m), [L.cx + 1.4, L.cz - 1.5], 2.6);
  // Ducks float ON the water, not on the ground under it.
  for (const c of g.children) if (c.name === "duck") c.position.y = 0.04;
}

/**
 * The playground: the fenced pad, the three pieces Nuno named, and what makes
 * it a place people sit beside — a bench for the grown-ups, a bin, and shade
 * trees on either side.
 *
 * Laid out for the camera, which is NORTH of it and above (it looks down-and-
 * toward -Z):
 *  - the SLIDE's chute runs toward +Z, i.e. toward the viewer, so its length
 *    is in view rather than foreshortened behind its own platform;
 *  - the SWING's beam runs along X, so both seats hang in the open;
 *  - the GATE is on the north side, facing the maze it belongs to.
 * No trees on the south side: they would stand at the frame's bottom edge,
 * under the controls, at the largest size anything in the surround draws.
 */
export function buildPlayground(host: THREE.Group, m: SurroundMaterials): void {
  const P = PLAYGROUND;
  if (P.cz - P.depth / 2 > SURROUND_VIEW.zNear + P.reserve) return; // off-frame (IDEA-069)
  const g = new THREE.Group();
  g.name = "playground";
  g.position.set(P.cx, 0, P.cz);
  const hw = P.width / 2;
  const hd = P.depth / 2;

  g.add(distantPlayArea(m, { width: P.width, depth: P.depth, gateSide: "north" }));

  const swing = distantSwing(m);
  swing.position.set(-hw * 0.6, 0, -hd * 0.1);
  g.add(swing);

  const slide = distantSlide(m);
  slide.position.set(hw * 0.5, 0, -hd * 0.32);
  g.add(slide);

  const dome = distantClimbDome(m);
  dome.position.set(-hw * 0.02, 0, hd * 0.25);
  g.add(dome);

  // A bench inside the east fence, facing into the play area (-X): a
  // parent's seat. Ry(t) sends +Z to (sin t, 0, cos t), so facing -X is -pi/2.
  const bench = distantBench(m, { seed: 611 });
  bench.position.set(hw - 0.5, 0, hd * 0.45);
  bench.rotation.y = -Math.PI / 2;
  g.add(bench);
  const bin = distantBin(m);
  bin.position.set(hw - 0.45, 0, -hd * 0.75);
  g.add(bin);

  const trees: Array<[number, number]> = [
    [-hw - 1.3, -hd * 0.5],
    [-hw - 1.3, hd * 0.6],
    [hw + 1.3, -hd * 0.4],
    [hw + 1.3, hd * 0.65],
  ];
  trees.forEach(([x, z], i) => {
    const t = distantBroadleaf(m, { height: P.treeHeight + hash(i, 900) * 0.4, seed: 621 + i });
    t.position.set(x, 0, z);
    g.add(t);
  });
  host.add(g);
}
