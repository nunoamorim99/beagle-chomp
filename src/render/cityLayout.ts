// OWNER: render-artist (IDEA-082 — Night City's surround)
//
// The third surround that is DESIGNED rather than grown, after the beach
// (seaside.ts) and the park (parkLayout.ts). Nuno's brief, side for side:
//
//   - NORTH and SOUTH: a ROAD running the width of the world, parallel to the
//     maze, with cars in it, and a pavement with street trees on BOTH sides of
//     it.
//   - EAST and WEST: buildings and trees, fronting a pavement that joins the
//     two roads — and the maze's one crossing (row 9, IDEA-067) steps out onto
//     it, so the tunnel leads somewhere.
//   - FEWER buildings than the plot lattice planted (up to four towers a plot),
//     each one with a shopfront, a cornice and a roof: "the building look too
//     basic and we have a lack of details."
//
// THE PLOT LATTICE IS NOT USED HERE AT ALL, and that is the point rather than
// a shortcut. A city's read is its GRID: buildings standing in rows that face
// a street. The lattice's whole design is the opposite — jittered irregular
// plots, dropped whole near the board, which is right for gardens and left a
// bare five-unit strip between every street and the first plot row behind it.
// So the city is laid out explicitly: STREET FRONTAGES, row after row, out to
// what the camera can see.
//
// Four rules:
//
// 1. THE STREETS SIT WHERE BOTH SCREENS SEE THEM. A desktop frame ends at
//    z = -21.2 to the north; a phone's at +22.4 to the south. The street — near
//    pavement, two lanes, far pavement — spans |z| 14.6 to 20.8, so the whole
//    north street is in a desktop shot and the whole south street in a phone
//    one. It starts just past the keep-clear box, never inside it.
//
// 2. THE SOUTH IS HELD DOWN (surround rule 4). It is portrait-only, unfogged,
//    nearest the camera and under the HUD and the controls. Its trees are the
//    south fringe's own short range and NOTHING is built beyond its road —
//    a building there would stand at the bottom edge of the frame at the
//    largest size the surround ever draws.
//
// 3. TRAFFIC KEEPS RIGHT, AND EVERY CAR FACES THE WAY ITS LANE GOES. Seen
//    from the camera, the near lane of each road carries traffic to the right
//    (+X) and the far lane to the left. A car facing against its lane reads as
//    a crash at a glance, so `test-surround.ts` asserts it.
//
// 4. CROSSINGS ARE WHERE THE PAVEMENTS MEET THE ROAD. The east and west
//    pavements cross both roads on zebras, and no car stands on one.
import * as THREE from "three";
import { COLS, OZ, ROWS } from "../game/grid";
import { SURROUND_PARAMS, SURROUND_VIEW } from "./surround";
import {
  type SurroundMaterials,
  type VehicleKind,
  distantBroadleaf,
  distantCar,
  distantCityBuilding,
  distantCrosswalk,
  distantPath,
  distantRoad,
} from "./surroundProps";

/** The board's own floor plane reaches these, in world units. */
const FLOOR_HALF_X = (COLS + 2) / 2; // 10.5
const FLOOR_HALF_Z = (ROWS + 2) / 2; // 11.5

/** The maze's one crossing is row 9 on every board (IDEA-067). */
const TUNNEL_ROW = 9;

/** The city's dials. Named and mutable for the editor, like PARK_PARAMS. */
export const CITY_PARAMS = {
  /** Where the near pavement starts, past the board's floor edge. Just
   *  outside the keep-clear box: that ring is the hand-placed verge. */
  streetStart: SURROUND_PARAMS.keepClear + 0.1,
  sidewalkWidth: 1.4,
  /** Two lanes. */
  roadWidth: 3.4,
  /** Street trees: their pitch along the pavement and their distance in from
   *  the kerb. */
  treePitch: 3.3,
  treeKerb: 0.4,
  northTreeHeight: 2.2,
  southTreeHeight: 1.55,
  /** Gap between the far pavement and the building fronts behind it. */
  setback: 0.45,
  /** Depth of one city block, front to front, beyond the first row. */
  blockDepth: 5.4,
  /** Share of frontage lots that are a building; most of the rest are a pair
   *  of trees, and a few are left open. */
  buildingShare: 0.58,
  treeLotShare: 0.3,
  /** Width of the zebra crossings, and the clear road either side of one
   *  that no car stands in. */
  crossingWidth: 1.3,
  crossingClear: 0.9,
  /** Free road between consecutive vehicles in a lane: min + up to `spread`. */
  carGapMin: 1.6,
  carGapSpread: 6.5,
  busShare: 0.1,
  taxiShare: 0.28,
};

/** Distance from z = 0 to each edge of the street, world units. */
export function streetBands(): {
  nearWalk: [number, number];
  road: [number, number];
  farWalk: [number, number];
  roadCentre: number;
} {
  const P = CITY_PARAMS;
  const s0 = FLOOR_HALF_Z + P.streetStart;
  const s1 = s0 + P.sidewalkWidth;
  const s2 = s1 + P.roadWidth;
  const s3 = s2 + P.sidewalkWidth;
  return { nearWalk: [s0, s1], road: [s1, s2], farWalk: [s2, s3], roadCentre: (s1 + s2) / 2 };
}

/** The east/west pavement, |x| range. It joins the two near pavements. */
export function sideWalkBand(): [number, number] {
  const x0 = FLOOR_HALF_X + CITY_PARAMS.streetStart;
  return [x0, x0 + CITY_PARAMS.sidewalkWidth];
}

/** |x| of the zebra crossings' centres — the side pavement's own line. */
export function crossingX(): number {
  const [a, b] = sideWalkBand();
  return (a + b) / 2;
}

/** Deterministic 0..1 off an integer pair, on the city's own seed band. */
function hash(a: number, b: number): number {
  let h = Math.imul(a + 6007, 73856093) ^ Math.imul(b + 90001, 19349663) ^ Math.imul(1213, 83492791);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** How far the city is built along X: the camera's footprint, never past the
 *  ground that exists (IDEA-069). */
function xEnd(): number {
  return Math.min(SURROUND_VIEW.halfX, SURROUND_PARAMS.halfWidth);
}

/**
 * Everything around Night City's board. Parented under one group at the
 * origin, so every child is placed in WORLD XZ.
 */
export function buildCityStreets(host: THREE.Group, m: SurroundMaterials): void {
  const g = new THREE.Group();
  g.name = "city-streets";
  host.add(g);
  const end = xEnd();
  for (const side of [-1, 1] as const) buildStreet(g, m, side, end);
  buildSideWalks(g, m);
  buildNorthBlocks(g, m, end);
  buildSideBlocks(g, m, end);
}

/** One street: pavement, road, pavement, the trees on both pavements, the
 *  crossings and the traffic. `side` is -1 for north, +1 for south. */
function buildStreet(g: THREE.Group, m: SurroundMaterials, side: -1 | 1, end: number): void {
  const P = CITY_PARAMS;
  const S = streetBands();
  // Culled with the frame, like everything else in the surround.
  if (side < 0 ? -S.farWalk[1] < SURROUND_VIEW.zFar - 2 : S.nearWalk[0] > SURROUND_VIEW.zNear + 2) return;
  const len = end * 2;
  const at = (d: number): number => side * d;

  for (const [a, b] of [S.nearWalk, S.farWalk]) {
    const walk = distantPath(m, { length: len, width: b - a, jointPitch: 2.4 });
    walk.name = "city-sidewalk";
    walk.position.set(0, 0, at((a + b) / 2));
    walk.rotation.y = Math.PI / 2;
    g.add(walk);
  }
  const road = distantRoad(m, { length: len, width: P.roadWidth });
  road.position.set(0, 0, at(S.roadCentre));
  road.rotation.y = Math.PI / 2;
  g.add(road);

  const cx = crossingX();
  for (const s of [-1, 1]) {
    const zebra = distantCrosswalk(m, { roadWidth: P.roadWidth, width: P.crossingWidth });
    zebra.position.set(s * cx, 0, at(S.roadCentre));
    g.add(zebra);
  }

  // Street trees on both pavements, near the kerb, at an even pitch — a
  // planted street is regular, which is what says "laid out". Not on a
  // crossing's line: a tree standing in the middle of the zebra's landing.
  //
  // WHICH EDGE OF THE PAVEMENT IS DECIDED BY THE CAMERA. It looks down at 59
  // degrees toward -Z, so a crown at height y lands ~0.6y further NORTH on
  // screen than its trunk. A tree on the road side of the pavement that lies
  // SOUTH of a road (the north street's near pavement, the south street's far
  // one) therefore draws its crown over the carriageway and hides the cars —
  // the first render did exactly that. Those two rows stand at the pavement's
  // far edge from the road instead, and the north one is a little shorter.
  const south = side > 0;
  const rows: Array<{ d: number; h: number; salt: number }> = [
    south
      ? { d: S.nearWalk[1] - P.treeKerb, h: P.southTreeHeight, salt: 1 }
      : { d: S.nearWalk[0] + P.treeKerb * 0.8, h: P.northTreeHeight * 0.82, salt: 1 },
    south
      ? { d: S.farWalk[1] - P.treeKerb * 0.8, h: P.southTreeHeight * 0.95, salt: 2 }
      : { d: S.farWalk[0] + P.treeKerb, h: P.northTreeHeight, salt: 2 },
  ];
  for (const row of rows) {
    const phase = row.salt === 1 ? 0 : P.treePitch / 2;
    for (let x = -end + phase + 1; x < end - 0.5; x += P.treePitch) {
      if (Math.abs(Math.abs(x) - cx) < P.crossingWidth) continue;
      const k = Math.round(x * 10);
      const tree = distantBroadleaf(m, {
        height: row.h + hash(k, row.salt + (south ? 10 : 0)) * 0.35,
        seed: 901 + k + row.salt * 37 + (south ? 500 : 0),
        street: true,
      });
      tree.name = "city-tree";
      tree.position.set(x, 0, at(row.d));
      tree.rotation.y = hash(k, 77 + row.salt) * Math.PI * 2;
      g.add(tree);
    }
  }

  // The traffic. Right-hand: the lane NEARER the camera (larger z) carries
  // traffic to +X, the far lane to -X. Rule 3.
  const laneOff = P.roadWidth / 4;
  for (const lane of [-1, 1] as const) {
    const z = side * S.roadCentre + lane * laneOff;
    const dir = lane > 0 ? 1 : -1;
    const salt = (side > 0 ? 100 : 0) + (lane > 0 ? 50 : 0);
    let x = -end + hash(salt, 1) * 4;
    for (let i = 0; x < end; i++) {
      const roll = hash(salt + i, 2);
      const kind: VehicleKind = roll < P.busShare ? "bus" : roll < P.busShare + P.taxiShare ? "taxi" : "car";
      const L = kind === "bus" ? 2.5 : 1.35;
      const cxCar = x + L / 2;
      const clear =
        Math.abs(Math.abs(cxCar) - cx) > P.crossingWidth / 2 + P.crossingClear + L / 2 &&
        cxCar + L / 2 < end;
      if (clear) {
        const car = distantCar(m, { kind, seed: 1301 + salt * 7 + i });
        car.position.set(cxCar, 0, z);
        car.rotation.y = dir > 0 ? 0 : Math.PI;
        car.userData.laneDir = dir;
        g.add(car);
      }
      x += L + P.carGapMin + hash(salt + i, 3) * P.carGapSpread;
    }
  }
}

/** The east and west pavements, joining the two roads, and the short path
 *  that takes the maze's tunnel out onto them. */
function buildSideWalks(g: THREE.Group, m: SurroundMaterials): void {
  const P = CITY_PARAMS;
  const S = streetBands();
  const [x0, x1] = sideWalkBand();
  const zLen = S.nearWalk[0] * 2;
  const tunnelZ = TUNNEL_ROW - OZ;
  for (const s of [-1, 1] as const) {
    if (x0 > SURROUND_VIEW.halfX + 2) continue;
    const walk = distantPath(m, { length: zLen, width: x1 - x0, jointPitch: 2.4 });
    walk.name = "city-sidewalk";
    walk.position.set(s * (x0 + x1) / 2, 0, 0);
    g.add(walk);

    const link = distantPath(m, { length: x0 - FLOOR_HALF_X, width: 1.1, jointPitch: 9 });
    link.name = "city-tunnel-walk";
    link.position.set(s * (FLOOR_HALF_X + (x0 - FLOOR_HALF_X) / 2), 0, tunnelZ);
    link.rotation.y = Math.PI / 2;
    g.add(link);

    // Street trees on the board side of the pavement, clear of the tunnel's
    // landing so the crossing stays open.
    for (let z = -S.nearWalk[0] + 2; z < S.nearWalk[0] - 1; z += P.treePitch) {
      if (Math.abs(z - tunnelZ) < 1.4) continue;
      const k = Math.round(z * 10) + (s > 0 ? 3000 : 0);
      const tree = distantBroadleaf(m, {
        height: P.northTreeHeight * 0.9 + hash(k, 5) * 0.3,
        seed: 1501 + k,
        street: true,
      });
      tree.name = "city-tree";
      tree.position.set(s * (x0 + P.treeKerb), 0, z);
      tree.rotation.y = hash(k, 6) * Math.PI * 2;
      g.add(tree);
    }
  }
}

/**
 * A row of LOTS along a frontage line: each one a building facing the street,
 * a pair of trees, or open ground. `along` is the axis the row runs on.
 */
function frontageRow(
  g: THREE.Group,
  m: SurroundMaterials,
  o: {
    from: number;
    to: number;
    /** World coordinate of the building FRONTS on the other axis. */
    front: number;
    /** +1 if the buildings extend toward +other-axis behind their fronts. */
    back: 1 | -1;
    alongX: boolean;
    /** Rotation that turns a building's local +Z to face the street. */
    face: number;
    scale: number;
    salt: number;
  },
): void {
  const P = CITY_PARAMS;
  let a = o.from;
  for (let i = 0; a < o.to; i++) {
    const roll = hash(o.salt, i);
    const r2 = hash(o.salt + 1, i);
    const place = (obj: THREE.Object3D, along: number, depth: number): void => {
      const other = o.front + o.back * depth;
      if (o.alongX) obj.position.set(along, 0, other);
      else obj.position.set(other, 0, along);
      g.add(obj);
    };
    if (roll < P.buildingShare) {
      const w = 1.8 + r2 * 0.9;
      const d = 1.5 + hash(o.salt + 2, i) * 0.8;
      if (a + w * o.scale > o.to) break;
      const b = distantCityBuilding(m, {
        width: w,
        depth: d,
        height: (2.6 + hash(o.salt + 3, i) * 2.8),
        seed: 1701 + o.salt * 31 + i,
      });
      b.scale.setScalar(o.scale);
      b.rotation.y = o.face;
      place(b, a + (w * o.scale) / 2, (d * o.scale) / 2);
      a += w * o.scale + 0.5 + hash(o.salt + 4, i) * 1.2;
    } else if (roll < P.buildingShare + P.treeLotShare) {
      const span = 2.6;
      for (let t = 0; t < 2; t++) {
        const tree = distantBroadleaf(m, {
          height: (2.0 + hash(o.salt + 5 + t, i) * 0.6) * o.scale,
          seed: 1901 + o.salt * 13 + i * 2 + t,
          street: true,
        });
        tree.name = "city-tree";
        place(tree, a + span * (t === 0 ? 0.28 : 0.72), 0.9 + t * 0.5);
      }
      a += span + 0.4;
    } else {
      a += 2.2;
    }
  }
}

/** Behind the north street: block after block of frontages, out to the edge
 *  of what the camera sees. Each row a little bigger than the last — the size
 *  ramp the plot lattice uses, so the far city reads at a similar size. */
function buildNorthBlocks(g: THREE.Group, m: SurroundMaterials, end: number): void {
  const P = CITY_PARAMS;
  const first = streetBands().farWalk[1] + P.setback;
  for (let k = 0; ; k++) {
    const front = -(first + k * P.blockDepth);
    if (front < SURROUND_VIEW.zFar) break;
    frontageRow(g, m, {
      from: -end,
      to: end,
      front,
      back: -1,
      alongX: true,
      face: 0,
      scale: 1 + Math.min(0.5, k * 0.14),
      salt: 40 + k * 10,
    });
  }
}

/** East and west: buildings and trees fronting the side pavements, between
 *  the two streets, in columns out to the frame's edge. */
function buildSideBlocks(g: THREE.Group, m: SurroundMaterials, end: number): void {
  const P = CITY_PARAMS;
  const S = streetBands();
  const first = sideWalkBand()[1] + P.setback;
  // Stop short of the near pavements so a corner building does not stand on
  // the street.
  const zSpan = S.nearWalk[0] - 0.4;
  for (const s of [-1, 1] as const) {
    for (let k = 0; ; k++) {
      const front = first + k * P.blockDepth;
      if (front > end - 1) break;
      frontageRow(g, m, {
        from: -zSpan,
        to: zSpan,
        front: s * front,
        back: s,
        alongX: false,
        // Ry(t) sends +Z to (sin t, cos t): face -X on the east, +X on the west.
        face: s > 0 ? -Math.PI / 2 : Math.PI / 2,
        scale: 1 + Math.min(0.5, k * 0.14),
        salt: 400 + k * 10 + (s > 0 ? 200 : 0),
      });
    }
  }
}
