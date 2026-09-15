// OWNER: render-artist (IDEA-066 — the world around the maze)
//
// What GROWS in the surround. surround.ts owns the ground and the dials;
// surroundProps.ts owns the objects; this owns the arrangement.
//
// THE LATTICE IS THE IDEA, not the objects on it. A scatter of trees and
// houses on grass reads as a scatter of trees and houses on grass. The same
// objects inside HEDGED PLOTS separated by lanes read as other gardens — which
// is the brief in Nuno's own words ("neighbour houses, other gardens"). So the
// boundary runs are the most-used builder here, and the plot rectangle is the
// unit everything else is placed inside.
//
// FIVE RULES:
//
// 1. IT NEVER READS THE GRID, AND NEVER THE LEVEL INDEX. The recipe is a pure
//    function of (kind, palette colours, SURROUND_PARAMS). That is what makes
//    it byte-identical on all 36 maps, which in turn is what makes the cache in
//    `ensureSurround` correct rather than a gamble, and what makes two
//    screenshots comparable.
//
// 2. A PLOT THAT OVERLAPS THE KEEP-CLEAR BOX IS DROPPED ENTIRELY, NEVER
//    CLIPPED. One rule, evaluated once per plot, and it is what guarantees
//    nothing procedural can ever land on top of something hand-placed. A
//    half-plot sliced off at the board's edge reads as a bug; a missing one
//    reads as "that is where the maze is".
//
// 3. EVERYTHING INSIDE A PLOT IS PLACED IN PLOT FRACTIONS, so nothing can
//    escape its own hedge whatever the plot size becomes. Same construction as
//    the pizza's sector-fraction placement, and for the same reason: it makes
//    the failure unrepresentable instead of merely absent.
//
// 4. THE SOUTH BAND IS DIFFERENT, and it is the most important tuning call in
//    the feature. Desktop's frame ends at z = +11.9 and portrait's at +22.4, so
//    the south band is PORTRAIT-ONLY, at ZERO fog, at the largest on-screen
//    size anything in the surround will ever have, and sitting directly under
//    the HUD and the D-pad. Full-size neighbour houses there read as an
//    obstruction. It gets lawns, low hedges and beds — no buildings, and a
//    hard height cap.
//
// 5. SEED BAND 600-639, claimed clear of buildProps (200/201), buildWallDecor
//    (301), buildHedgeDecor (1-7) and groundDetail (401-406, it adds 400 to its
//    own salt internally).
import * as THREE from "three";
import { COLS, ROWS } from "../game/grid";
import { SURROUND_PARAMS, SURROUND_VIEW, type SurroundKind } from "./surround";
import {
  type SurroundMaterials,
  type SurroundPaletteInput,
  disposeSurroundMaterials,
  makeSurroundMaterials,
  distantBed,
  distantBroadleaf,
  distantConifer,
  distantDune,
  distantFlowerBorder,
  distantHedgeRun,
  distantHouse,
  distantRockOutcrop,
  distantShrubClump,
  distantTower,
} from "./surroundProps";
import { mergeBySignature } from "./propMerge";

const SURROUND_HASH_SEED = 600;

/** The board's own floor plane reaches these, in world units. */
const FLOOR_HALF_X = (COLS + 2) / 2; // 10.5
const FLOOR_HALF_Z = (ROWS + 2) / 2; // 11.5

/** Deterministic hash of a plot coordinate to 0..1. Same shape as
 *  groundDetail's, on its own seed band. */
function hash(x: number, y: number, salt: number): number {
  let h =
    Math.imul(x + 4001, 73856093) ^
    Math.imul(y + 4001, 19349663) ^
    Math.imul(salt + SURROUND_HASH_SEED, 83492791);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

type Band = "north" | "south" | "east" | "west";

interface Plot {
  /** Centre, world units. */
  cx: number;
  cz: number;
  /** Size, world units (a tile is 1). */
  w: number;
  d: number;
  band: Band;
  /** Distance from the keep-clear boundary, world units. */
  out: number;
  /** The size ramp evaluated at `out`. */
  scale: number;
  /** Plot-lattice coordinate, for hashing. */
  px: number;
  pz: number;
  /**
   * The plot's four corners in world XZ, anticlockwise from (-u,-v).
   *
   * IDEA-066 phase 5. A plot used to be a RECTANGLE with a jittered centre,
   * and a field of jittered rectangles still reads as a grid — the jitter
   * moves them without changing what they are. Real hedged land is irregular
   * QUADRILATERALS of varying size and angle, which is what an aerial of any
   * bocage landscape shows and what Nuno asked the surround to read as.
   *
   * Every corner is jittered independently and bounded by the lane width, so
   * neighbouring plots never close the lane between them.
   */
  corners: Array<[number, number]>;
}

/**
 * Lay the plot lattice over the surround rect and drop everything that touches
 * the board.
 *
 * Exported for `scripts/test-surround.ts`, which asserts the keep-clear rule
 * directly rather than trusting a render — a plot overlapping the maze is
 * invisible in a screenshot the moment anything else is standing there.
 */
/**
 * How the LANE is shared between the two jitters, as fractions of it.
 *
 * `lane - 2*CENTRE_JITTER*lane - 2*CORNER_JITTER*lane >= 0` is the whole
 * constraint: at 0.15 and 0.35 that is exactly zero, so the worst two
 * neighbours can do is touch. `scripts/test-surround.ts` asserts it from
 * these constants rather than from a copy of the arithmetic.
 */
const CENTRE_JITTER = 0.15;
const CORNER_JITTER = 0.35;

export function planPlots(): Plot[] {
  const P = SURROUND_PARAMS;
  const clearX = FLOOR_HALF_X + P.keepClear;
  const clearZ = FLOOR_HALF_Z + P.keepClear;
  const stepX = P.plotW + P.lane;
  const stepZ = P.plotD + P.lane;
  const out: Plot[] = [];

  const nx = Math.ceil((P.halfWidth * 2) / stepX);
  const nz = Math.ceil((P.zNear - P.zFar) / stepZ);
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      // Jitter the lattice so it does not read as a chessboard. Applied to the
      // CENTRE only: the plot keeps its size, so the lanes stay legible.
      // THE JITTER BUDGET IS THE LANE, AND IT USED TO BE OVERSPENT.
      //
      // Nuno: *"we have greenhouses inside the houses."* Two neighbouring
      // plots can each move toward the other, and each plot's CORNERS are
      // jittered again on top of that — so the gap between them is
      // `lane - 2*centreJitter - 2*cornerJitter`. At the old +-1 centre jitter
      // against a lane of 1 that is 1 - 2 - 0.7 = **-1.7**: two plots could
      // overlap by nearly two units, and everything standing in them with
      // them. Measured, 2 of 24 pairs did.
      //
      // Both jitters are now fractions of the LANE and they share it, so the
      // worst case is two plots exactly touching rather than interpenetrating
      // — and widening the lane buys more irregularity instead of more
      // collisions. The irregular QUADRILATERAL is what breaks the grid
      // (IDEA-066 v4); the centre jitter was only ever helping.
      const cjCentre = P.lane * CENTRE_JITTER;
      const jx = (hash(ix, iz, 0) - 0.5) * 2 * cjCentre;
      const jz = (hash(ix, iz, 1) - 0.5) * 2 * cjCentre;
      const cx = -P.halfWidth + (ix + 0.5) * stepX + jx;
      const cz = P.zFar + (iz + 0.5) * stepZ + jz;
      const hw = P.plotW / 2;
      const hd = P.plotD / 2;

      // Rule 2: dropped entirely, never clipped.
      if (Math.abs(cx) - hw < clearX && Math.abs(cz) - hd < clearZ) continue;
      // Outside the ground plane is outside the world -- but tested on the
      // plot's CENTRE, not its far corner. Requiring the whole rectangle to
      // fit dropped every plot within half a plot of the edge, which carved a
      // bare ring right where the frame ends: visibly empty ground at the top
      // and sides of a wide desktop. The ground reaches 50 and the widest
      // frame reaches 43, so a plot straddling the boundary has its contents
      // well inside the world anyway (rule 3 keeps them within the plot).
      if (Math.abs(cx) > P.halfWidth || cz < P.zFar || cz > P.zNear) continue;
      // IDEA-069: and outside what the CAMERA can see is not worth building.
      // SURROUND_VIEW is the measured ground footprint of the current frame
      // plus a margin (see surround.ts) — a phone sees |x| ~15 where the
      // shipped extent is 50, so most of a portrait board's neighbourhood was
      // being built, merged, uploaded and drawn off-screen. Tested on the
      // CENTRE like the rule above it and for the same reason: the margin is a
      // plot and a half, so a plot straddling the boundary has its contents
      // well inside the frame.
      if (
        Math.abs(cx) > SURROUND_VIEW.halfX ||
        cz < SURROUND_VIEW.zFar ||
        cz > SURROUND_VIEW.zNear
      ) {
        continue;
      }
      // The density dial. Checked AFTER the geometric rules so turning density
      // down thins the same population rather than shifting it around.
      if (hash(ix, iz, 2) > P.density) continue;

      const band: Band =
        cz > clearZ ? "south" : cz < -clearZ ? "north" : cx > 0 ? "east" : "west";
      const outX = Math.max(0, Math.abs(cx) - clearX);
      const outZ = Math.max(0, Math.abs(cz) - clearZ);
      const dist = Math.max(outX, outZ);
      const t = Math.min(1, dist / P.rampDistance);
      // Corners, each jittered on its own. Bounded to 0.35 of the lane so two
      // neighbours can never meet: the lane IS the street, and without it the
      // whole lattice closes into one field.
      const cj = P.lane * CORNER_JITTER;
      const corners: Array<[number, number]> = [
        [-hw, -hd],
        [hw, -hd],
        [hw, hd],
        [-hw, hd],
      ].map(([ox, oz], k) => [
        cx + ox + (hash(ix, iz, 10 + k) - 0.5) * 2 * cj,
        cz + oz + (hash(ix, iz, 20 + k) - 0.5) * 2 * cj,
      ]);

      out.push({
        cx,
        cz,
        w: P.plotW,
        d: P.plotD,
        corners,
        band,
        out: dist,
        scale: P.nearScale + (P.farScale - P.nearScale) * t,
        px: ix,
        pz: iz,
      });
    }
  }
  return out;
}

/**
 * The fringe: loose, LOW content in the annulus just outside the keep-clear
 * box, on a 2-tile cell grid rather than the plot lattice.
 *
 * Exported alongside planPlots so `scripts/test-surround.ts` can hold it to
 * the same keep-clear guarantee — it is the pass most likely to creep inward,
 * being the one whose whole job is to get close.
 */
/**
 * THE FRINGE MUST NOT BUILD INSIDE A PLOT, and this is the bug Nuno was
 * looking at when he said *"we have greenhouses inside the houses."*
 *
 * The two layers were written to fill DIFFERENT ground — the plot lattice
 * out beyond the keep-clear box, the fringe in the annulus the lattice
 * cannot serve — and they were never told about each other. But the lattice
 * is jittered and its plots are dropped only for the keep-clear box, so a
 * plot can and does sit well inside the fringe's annulus. Measured: **58 of
 * 179 fringe cells (32%) landed inside a plot**, each one dropping a
 * greenhouse, a shed or a tree into somebody's garden — and neither layer
 * could see it, because each one's own rules were being obeyed perfectly.
 *
 * The fringe yields, not the plots: a plot is a composition (a hedge, a
 * house, its garden) and losing one item out of it leaves a hole, while the
 * fringe is a scatter and losing a cell from a scatter is invisible.
 */
function insideAnyPlot(x: number, z: number, plots: readonly Plot[]): boolean {
  for (const p of plots) {
    // The plot's own rectangle plus half a lane, so nothing lands in the
    // hedge itself either — a shed growing out of a boundary hedge is the
    // same defect one step smaller.
    const pad = SURROUND_PARAMS.lane * 0.5;
    if (Math.abs(x - p.cx) < p.w / 2 + pad && Math.abs(z - p.cz) < p.d / 2 + pad) return true;
  }
  return false;
}

export function planFringe(): Array<{ x: number; z: number; band: Band; scale: number }> {
  const P = SURROUND_PARAMS;
  // The plots this fringe has to keep out of. Recomputed rather than passed
  // in: planPlots is deterministic and cheap, and a parameter would let a
  // caller pass a DIFFERENT set than the one actually built, which is the
  // failure this function exists to prevent.
  const plots = planPlots();
  const clearX = FLOOR_HALF_X + P.keepClear;
  const clearZ = FLOOR_HALF_Z + P.keepClear;
  const outX = clearX + P.fringeWidth;
  const outZ = clearZ + P.fringeWidth;
  const cell = 2;
  const out: Array<{ x: number; z: number; band: Band; scale: number }> = [];
  for (let z = -outZ; z <= outZ; z += cell) {
    for (let x = -outX; x <= outX; x += cell) {
      const ax = Math.abs(x);
      const az = Math.abs(z);
      // Inside the keep-clear box: never.
      if (ax < clearX && az < clearZ) continue;
      // Outside the annulus: the plot lattice owns that.
      if (ax > outX || az > outZ) continue;
      const ix = Math.round(x / cell);
      const iz = Math.round(z / cell);
      if (hash(ix, iz, 50) > P.fringeDensity) continue;
      const band: Band = z > clearZ ? "south" : z < -clearZ ? "north" : x > 0 ? "east" : "west";
      // THE JITTER IS APPLIED FIRST AND THEN RE-TESTED, because it is half a
      // cell and the cell grid starts ON the boundary — so jittering after
      // the keep-clear check walked eight items back INSIDE it, straight
      // into the verge the whole rule exists to protect. Found by
      // test-surround.ts, which is precisely the pass most likely to creep
      // inward: its entire job is to get close.
      const jx = x + (hash(ix, iz, 51) - 0.5) * cell * 0.8;
      const jz = z + (hash(ix, iz, 52) - 0.5) * cell * 0.8;
      if (Math.abs(jx) < clearX && Math.abs(jz) < clearZ) continue;
      // Tested AFTER the jitter, for the same reason the keep-clear box is:
      // a cell that clears a plot before it moves can land in one after.
      if (insideAnyPlot(jx, jz, plots)) continue;
      out.push({
        x: jx,
        z: jz,
        band,
        scale: 0.75 + hash(ix, iz, 53) * 0.45,
      });
    }
  }
  return out;
}

/**
 * A placed object's world-space XZ footprint, measured FROM VERTICES.
 *
 * Never `Box3.setFromObject`: it builds each mesh's box in LOCAL space and
 * transforms the eight corners, so a rotated child over-reports by up to 56%
 * (CLAUDE.md's standing note) -- and every building in this band is placed
 * with a rotation, which is precisely the case that breaks it.
 */
const FOOT_V = new THREE.Vector3();
function footprint(o: THREE.Object3D): { x0: number; x1: number; z0: number; z1: number } {
  o.updateWorldMatrix(true, true);
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  o.traverse((n) => {
    const mesh = n as THREE.Mesh;
    if (!mesh.isMesh) return;
    const pos = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      FOOT_V.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      if (FOOT_V.x < x0) x0 = FOOT_V.x;
      if (FOOT_V.x > x1) x1 = FOOT_V.x;
      if (FOOT_V.z < z0) z0 = FOOT_V.z;
      if (FOOT_V.z > z1) z1 = FOOT_V.z;
    }
  });
  return { x0, x1, z0, z1 };
}

function footprintsClear(
  a: { x0: number; x1: number; z0: number; z1: number },
  b: { x0: number; x1: number; z0: number; z1: number },
  gap: number,
): boolean {
  // A NEGATIVE overlap is a gap. Written as `< gap` this reads perfectly well
  // and PERMITS an overlap of up to `gap` instead of requiring one -- which is
  // how the first version left five pairs clipping by exactly 0.12, 0.07 and
  // 0.03, i.e. by precisely the tolerance it thought it was enforcing.
  return (
    Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) < -gap ||
    Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0) < -gap
  );
}

/** Place a child at a fraction of the plot (rule 3), then add it. */
/** Bilinear point inside a plot's quadrilateral, u and v in [-1, 1]. */
function pointIn(plot: Plot, u: number, v: number): [number, number] {
  const [c0, c1, c2, c3] = plot.corners;
  const fu = (u + 1) / 2;
  const fv = (v + 1) / 2;
  const ax = c0[0] + (c1[0] - c0[0]) * fu;
  const az = c0[1] + (c1[1] - c0[1]) * fu;
  const bx = c3[0] + (c2[0] - c3[0]) * fu;
  const bz = c3[1] + (c2[1] - c3[1]) * fu;
  return [ax + (bx - ax) * fv, az + (bz - az) * fv];
}

function placeIn(
  host: THREE.Group,
  plot: Plot,
  child: THREE.Object3D,
  u: number,
  v: number,
  scale: number,
  rotY: number,
): void {
  // Rule 3 still holds and now holds harder: a plot fraction is interpolated
  // BETWEEN THE CORNERS, so nothing can escape its own hedge whatever shape
  // the quadrilateral takes.
  const [x, z] = pointIn(plot, u, v);
  child.position.set(x, 0, z);
  child.rotation.y = rotY;
  child.scale.multiplyScalar(scale);
  host.add(child);
}

/** A hedged boundary around a plot, with ONE side left open as a gate. */
function hedgePerimeter(
  host: THREE.Group,
  plot: Plot,
  m: SurroundMaterials,
  height: number,
): void {
  const gate = Math.floor(hash(plot.px, plot.pz, 3) * 4);
  for (let i = 0; i < 4; i++) {
    if (i === gate) continue;
    const a = plot.corners[i];
    const b = plot.corners[(i + 1) % 4];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    const run = distantHedgeRun(m, {
      length: len,
      height,
      seed: 41 + i + plot.px * 7 + plot.pz * 13,
    });
    run.position.set((a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2);
    // A hedge run is built along its local +X. Rotating by t about Y sends +X
    // to (cos t, 0, -sin t), so aiming it down the edge needs atan2(-dz, dx) —
    // NOT atan2(dz, dx), which mirrors every run and leaves the boundary
    // crossing its own corners.
    run.rotation.y = Math.atan2(-dz, dx);
    host.add(run);
  }
}

/**
 * A flowering border, laid just INSIDE one of the plot's own hedges.
 *
 * It is placed against an edge rather than scattered, and that is the whole
 * difference between a border and litter. Scattered into the middle of a lawn,
 * a saturated mass reads as a dropped object -- a red crisp packet -- because
 * nothing in the picture explains why it is there. Run along a hedge it reads
 * as planting, for the same reason `hedgePerimeter` exists at the scale above:
 * the boundaries are what turn a scatter of objects into somebody's garden.
 *
 * Inset toward the plot centre so it stands IN FRONT of the hedge instead of
 * inside it, which would bury it (this project's most-repeated defect).
 */
function flowerBorder(host: THREE.Group, plot: Plot, m: SurroundMaterials, salt: number): void {
  // NOT EVERY PLOT. Three of the four archetypes call this, so without a gate
  // almost every garden in the band gets a saturated band in it and the
  // neighbourhood becomes a paint chart. Roughly three in five is the dose
  // that reads as "some of these people garden".
  if (hash(plot.px, plot.pz, salt + 2) > 0.6) return;
  const side = Math.floor(hash(plot.px, plot.pz, salt) * 4) % 4;
  const a = plot.corners[side];
  const b = plot.corners[(side + 1) % 4];
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  const mx = (a[0] + b[0]) / 2;
  const mz = (a[1] + b[1]) / 2;
  const cx = (plot.corners[0][0] + plot.corners[1][0] + plot.corners[2][0] + plot.corners[3][0]) / 4;
  const cz = (plot.corners[0][1] + plot.corners[1][1] + plot.corners[2][1] + plot.corners[3][1]) / 4;
  const tx = cx - mx;
  const tz = cz - mz;
  const tl = Math.hypot(tx, tz) || 1;
  const inset = 0.34;
  const run = distantFlowerBorder(m, {
    // Most of the edge, never all of it: a border running corner to corner
    // reads as a second hedge in front of the first.
    length: len * (0.42 + hash(plot.px, plot.pz, salt + 1) * 0.2),
    seed: 201 + salt + plot.px * 5 + plot.pz * 11,
  });
  run.position.set(mx + (tx / tl) * inset, 0, mz + (tz / tl) * inset);
  // Same aiming rule as hedgePerimeter, and the same sign trap: a run is built
  // along its local +X, so it needs atan2(-dz, dx).
  run.rotation.y = Math.atan2(-dz, dx);
  run.scale.multiplyScalar(plot.scale);
  host.add(run);
}

/** What a plot IS. See SURROUND_PARAMS' archetype mix for why there is more
 *  than one. */
type Archetype = "house" | "allotment" | "orchard" | "lawn";

/**
 * Pick a plot's archetype from one hash roll against the cumulative bands.
 *
 * THE SOUTH BAND NEVER GETS A BUILDING, whatever the mix says. Desktop's frame
 * ends at z = +11.9 and portrait's at +22.4, so south is portrait-only, at ZERO
 * fog, at the largest on-screen size anything in the surround ever has, and
 * directly under the HUD and the D-pad. Only ONE plot row is ever visible down
 * there, so it carries orchards and lawns and nothing that stands up.
 */
function archetypeFor(plot: Plot): Archetype {
  const P = SURROUND_PARAMS;
  const roll = hash(plot.px, plot.pz, 4);
  // THE SOUTH BAND STILL NEVER GETS A HOUSE, and it now gets ALLOTMENTS —
  // see SURROUND_PARAMS.southAllotmentChance for both halves of why. A
  // greenhouse is the one building in the set that is low and long rather
  // than tall, which is what lets this band have buildings at all.
  if (plot.band === "south") {
    if (roll < P.southAllotmentChance) return "allotment";
    return roll < P.southAllotmentChance + (1 - P.southAllotmentChance) * 0.55
      ? "orchard"
      : "lawn";
  }
  if (roll < P.houseChance) return "house";
  if (roll < P.houseChance + P.allotmentChance) return "allotment";
  if (roll < P.houseChance + P.allotmentChance + P.orchardChance) return "orchard";
  return "lawn";
}

/** Scatter n of something inside a plot, at plot fractions. */
function scatter(
  host: THREE.Group,
  plot: Plot,
  n: number,
  salt: number,
  make: (i: number) => THREE.Object3D,
  spread = 1.5,
): void {
  for (let i = 0; i < n; i++) {
    placeIn(
      host,
      plot,
      make(i),
      hash(plot.px, plot.pz, salt + i) * spread - spread / 2,
      hash(plot.px, plot.pz, salt + 40 + i) * spread - spread / 2,
      plot.scale,
      hash(plot.px, plot.pz, salt + 80 + i) * Math.PI * 2,
    );
  }
}

/**
 * The garden's neighbourhood.
 *
 * THE BOUNDARIES ARE THE IDEA — a scatter of objects on grass reads as a
 * scatter of objects on grass; the same objects inside hedged plots read as
 * OTHER GARDENS. Every archetype below therefore gets its hedge first and its
 * contents second, and the contents are placed in PLOT FRACTIONS so nothing
 * can escape the hedge whatever shape the quadrilateral takes.
 *
 * A house stands against the plot edge FURTHEST from the board and faces the
 * lane: a house seen facing away, over its own garden, is the whole "you are
 * inside a neighbourhood" read, and a row of front doors staring at the player
 * is not.
 */
function plotsContent(host: THREE.Group, plot: Plot, m: SurroundMaterials): void {
  const south = plot.band === "south";
  const kind = archetypeFor(plot);
  const seed = plot.px * 31 + plot.pz * 17;

  // A lawn plot keeps its boundary and almost nothing else. It is not a gap:
  // it is what stops the neighbourhood reading as wall-to-wall stuff, and the
  // hedges alone still carry the lattice.
  hedgePerimeter(host, plot, m, south ? 0.34 : 0.5);

  if (kind === "house") {
    const away = plot.band === "north" ? -1 : plot.band === "east" ? 1 : -1;
    const northSouth = plot.band === "north" || plot.band === "south";
    const u = northSouth ? 0 : away * 0.45;
    const v = northSouth ? away * 0.45 : 0;
    const house = distantHouse(m, { kind: "house", seed: 51 + seed });
    placeIn(host, plot, house, u, v, plot.scale, hash(plot.px, plot.pz, 5) * 0.5 - 0.25);
    // A shed or a greenhouse DOWN THE FAR END OF THE GARDEN -- and until now it
    // was frequently standing INSIDE the house, which is what Nuno reported.
    //
    // THE CAUSE IS NOT A SPACING NUMBER, AND THAT IS WHY NUDGING ONE NEVER
    // FIXED IT. Measured: a house runs up to 4.7 x 3.7 world units at the top
    // of `plot.scale`, an outbuilding 2.3 x 2.7, and a plot is 7 x 6 tiles.
    // 3.7 + 2.7 = 6.4 does not fit in 6 and 4.7 + 2.3 = 7.0 does not fit in 7
    // with any jitter at all, so on those plots there is NO pair of positions
    // that works and every choice of fractions is just choosing where to clip.
    // (The old code also used the wrong axis -- it always offset in u and
    // barely in v, which is right for an east/west plot and wrong for a north
    // or south one, so the two buildings were 1.78 units apart needing 1.9.)
    //
    // So it is SOLVED rather than tuned: four candidate corners are tried in
    // turn against the house's real measured footprint, and if none of them
    // clears, the plot simply has no outbuilding. A missing shed is invisible;
    // a shed inside a house is the first thing anyone sees. Measured, that
    // costs about one house plot in ten its outbuilding.
    if (hash(plot.px, plot.pz, 6) < 0.45) {
      const houseFoot = footprint(house);
      const far = -away * 0.45;
      const corners: Array<[number, number]> = northSouth
        ? [
            [0.55, far],
            [-0.55, far],
            [0.62, -far * 0.25],
            [-0.62, -far * 0.25],
          ]
        : [
            [far, 0.55],
            [far, -0.55],
            [-far * 0.25, 0.62],
            [-far * 0.25, -0.62],
          ];
      const first = Math.floor(hash(plot.px, plot.pz, 28) * 4) % 4;
      for (let i = 0; i < corners.length; i++) {
        const [ou, ov] = corners[(first + i) % corners.length];
        const out = distantHouse(m, {
          kind: hash(plot.px, plot.pz, 7) < 0.5 ? "shed" : "greenhouse",
          seed: 61 + plot.px * 13,
        });
        placeIn(host, plot, out, ou, ov, plot.scale * 0.85, 1.2);
        // A real GAP, not merely non-intersection: two buildings whose walls
        // touch read as one L-shaped building, which is a different mistake
        // rather than a fixed one.
        if (footprintsClear(houseFoot, footprint(out), 0.12)) break;
        host.remove(out);
        out.traverse((n) => {
          const mesh = n as THREE.Mesh;
          if (mesh.isMesh) mesh.geometry.dispose();
        });
      }
    }
    scatter(host, plot, 1 + Math.floor(hash(plot.px, plot.pz, 8) * 2), 9, (i) =>
      distantBroadleaf(m, { seed: 71 + i + seed }),
    );
    scatter(host, plot, 2 + Math.floor(hash(plot.px, plot.pz, 15) * 3), 16, (i) =>
      distantShrubClump(m, { seed: 81 + i + plot.px * 3 }),
    );
    scatter(host, plot, 1, 27, (i) => distantBed(m, { seed: 91 + i + plot.pz * 7 }), 1.3);
    // A BORDER OF FLOWERING SHRUBS. IDEA-071's new colour: where a bed builds
    // its colour out of six small blooms inside a kerb, these ARE the colour,
    // at twice the size. One or two drifts per garden is the dose -- the
    // neighbourhood has to stay green with colour IN it, not become a paint
    // chart, and `bloomColors` is loud on purpose.
    flowerBorder(host, plot, m, 31);
    return;
  }

  if (kind === "allotment") {
    // No house at all — a greenhouse and beds. This is the archetype that
    // makes the neighbourhood read as WORKED rather than as a development,
    // and since IDEA-070 it is the only building the SOUTH band can have.
    //
    // South buildings are held to three quarters of their eaves width, which
    // is the same lever every other south branch in this file already pulls
    // (the orchard's trees, the lawn's beds). The band is unfogged, nearest
    // the camera and the largest anything in the surround ever draws, so a
    // building at full size there does not read as further away — it reads as
    // bigger than the maze.
    const ew = south ? 1.55 : undefined;
    const glass = distantHouse(m, { kind: "greenhouse", eavesWidth: ew, seed: 101 + seed });
    placeIn(
      host,
      plot,
      glass,
      hash(plot.px, plot.pz, 9) * 0.8 - 0.4,
      south ? -0.2 : -0.35,
      plot.scale,
      hash(plot.px, plot.pz, 10) * 0.4 - 0.2,
    );
    // Same solve as the house plot's outbuilding, and for the same reason: an
    // allotment's greenhouse is placed on a jittered fraction, so a shed at a
    // FIXED (0.42, 0.42) sometimes lands on top of it.
    if (hash(plot.px, plot.pz, 11) < (south ? 0.55 : 0.4)) {
      const glassFoot = footprint(glass);
      const spots: Array<[number, number]> = [
        [0.55, 0.55],
        [-0.55, 0.55],
        [0.55, -0.6],
        [-0.55, -0.6],
      ];
      const first = Math.floor(hash(plot.px, plot.pz, 29) * 4) % 4;
      for (let i = 0; i < spots.length; i++) {
        const [su, sv] = spots[(first + i) % spots.length];
        const shed = distantHouse(m, {
          kind: "shed",
          eavesWidth: south ? 1.15 : undefined,
          seed: 111 + seed,
        });
        placeIn(host, plot, shed, su, sv, plot.scale * 0.8, 0.9);
        if (footprintsClear(glassFoot, footprint(shed), 0.12)) break;
        host.remove(shed);
        shed.traverse((n) => {
          const mesh = n as THREE.Mesh;
          if (mesh.isMesh) mesh.geometry.dispose();
        });
      }
    }
    scatter(host, plot, 3 + Math.floor(hash(plot.px, plot.pz, 12) * 3), 13, (i) =>
      distantBed(m, { width: 1.5, depth: 0.55, seed: 121 + i + seed }),
      1.4,
    );
    scatter(host, plot, 1 + Math.floor(hash(plot.px, plot.pz, 24) * 2), 25, (i) =>
      distantShrubClump(m, { seed: 131 + i + plot.pz }),
    );
    flowerBorder(host, plot, m, 33);
    return;
  }

  if (kind === "orchard") {
    scatter(host, plot, (south ? 2 : 3) + Math.floor(hash(plot.px, plot.pz, 14) * 3), 30, (i) =>
      distantBroadleaf(m, {
        height: south ? 1.0 + hash(plot.px, plot.pz, 60 + i) * 0.3 : undefined,
        seed: 141 + i + seed,
      }),
    );
    scatter(host, plot, 1 + Math.floor(hash(plot.px, plot.pz, 18) * 2), 19, (i) =>
      distantShrubClump(m, { seed: 151 + i + plot.px }),
    );
    return;
  }

  // lawn
  scatter(host, plot, 1 + Math.floor(hash(plot.px, plot.pz, 21) * 2), 22, (i) =>
    distantBed(m, { seed: 161 + i + seed }),
    1.2,
  );
  if (!south && hash(plot.px, plot.pz, 23) < 0.5) {
    scatter(host, plot, 1, 26, (i) => distantShrubClump(m, { seed: 171 + i + plot.pz }));
  }
  // A lawn plot is deliberately the empty one -- it is what stops the band
  // reading as wall-to-wall stuff -- but a lawn with ONE bed on it and nothing
  // else was reading as a gap rather than as a choice. A single drift is
  // enough to say somebody keeps it, and it is the cheapest object in the set.
  flowerBorder(host, plot, m, 34);
}

/** The forest: conifers thickening with distance, no boundaries at all — a
 *  wood has no plots, and drawing hedgerows through one would say the opposite
 *  of what the theme is. */
function woodlandContent(host: THREE.Group, plot: Plot, m: SurroundMaterials): void {
  const south = plot.band === "south";
  const n = south ? 2 : 4 + Math.floor(hash(plot.px, plot.pz, 4) * 5);
  for (let i = 0; i < n; i++) {
    const tree = distantConifer(m, {
      height: south ? 1.1 + hash(plot.px, plot.pz, 40 + i) * 0.5 : undefined,
      seed: 101 + i + plot.px * 7 + plot.pz * 3,
    });
    placeIn(
      host,
      plot,
      tree,
      hash(plot.px, plot.pz, 5 + i) * 1.7 - 0.85,
      hash(plot.px, plot.pz, 14 + i) * 1.7 - 0.85,
      plot.scale,
      0,
    );
  }
  if (hash(plot.px, plot.pz, 23) < 0.4) {
    const rock = distantRockOutcrop(m, { seed: 111 + plot.px });
    placeIn(host, plot, rock, hash(plot.px, plot.pz, 24) - 0.5, hash(plot.px, plot.pz, 25) - 0.5, plot.scale, 0);
  }
}

/** The beach: low mounds and almost no vertical mass, because a beach's read
 *  is the horizon. */
function dunesContent(host: THREE.Group, plot: Plot, m: SurroundMaterials): void {
  const n = 1 + Math.floor(hash(plot.px, plot.pz, 4) * 3);
  for (let i = 0; i < n; i++) {
    const dune = distantDune(m, { seed: 121 + i + plot.px * 5 });
    placeIn(
      host,
      plot,
      dune,
      hash(plot.px, plot.pz, 5 + i) * 1.2 - 0.6,
      hash(plot.px, plot.pz, 9 + i) * 1.2 - 0.6,
      plot.scale,
      hash(plot.px, plot.pz, 13 + i) * Math.PI,
    );
  }
  if (plot.band !== "south" && hash(plot.px, plot.pz, 17) < 0.3) {
    const sh = distantShrubClump(m, { seed: 131 + plot.pz });
    placeIn(host, plot, sh, hash(plot.px, plot.pz, 18) - 0.5, hash(plot.px, plot.pz, 19) - 0.5, plot.scale, 0);
  }
}

/** The park: loose groves and lawn patches, paths instead of hedgerows. */
function parklandContent(host: THREE.Group, plot: Plot, m: SurroundMaterials): void {
  const south = plot.band === "south";
  const n = south ? 1 : 2 + Math.floor(hash(plot.px, plot.pz, 4) * 3);
  for (let i = 0; i < n; i++) {
    const t = distantBroadleaf(m, {
      height: south ? 1.2 : undefined,
      seed: 141 + i + plot.px * 11 + plot.pz * 5,
    });
    placeIn(
      host,
      plot,
      t,
      hash(plot.px, plot.pz, 5 + i) * 1.6 - 0.8,
      hash(plot.px, plot.pz, 11 + i) * 1.6 - 0.8,
      plot.scale,
      0,
    );
  }
  const beds = 1 + Math.floor(hash(plot.px, plot.pz, 17) * 3);
  for (let i = 0; i < beds; i++) {
    const b = distantBed(m, { width: 1.6, depth: 1.1, seed: 151 + i + plot.px });
    placeIn(
      host,
      plot,
      b,
      hash(plot.px, plot.pz, 18 + i) * 1.4 - 0.7,
      hash(plot.px, plot.pz, 22 + i) * 1.4 - 0.7,
      plot.scale,
      hash(plot.px, plot.pz, 26 + i) * Math.PI,
    );
  }
}

/** The city: blocks on a street grid. The one kind whose regularity is the
 *  point, so this is the only content function that does not jitter. */
function cityblocksContent(host: THREE.Group, plot: Plot, m: SurroundMaterials): void {
  const south = plot.band === "south";
  const cols = 2;
  const rows = 2;
  for (let z = 0; z < rows; z++) {
    for (let x = 0; x < cols; x++) {
      if (hash(plot.px * 7 + x, plot.pz * 7 + z, 4) < 0.25) continue;
      const tower = distantTower(m, {
        height: south ? 1.2 + hash(plot.px + x, plot.pz + z, 5) * 0.8 : undefined,
        seed: 161 + x + z * 3 + plot.px * 5 + plot.pz * 9,
      });
      placeIn(
        host,
        plot,
        tower,
        (x + 0.5 - cols / 2) * (1.6 / cols) * 2,
        (z + 0.5 - rows / 2) * (1.6 / rows) * 2,
        plot.scale,
        0,
      );
    }
  }
}

/**
 * What stands in the fringe. LOW, always — it is the nearest thing to the
 * board on the south side, where the frame ends at z = +22 and fog is at
 * zero, and the solved occlusion limit is not the constraint (3.85 units at
 * that distance); crowding the play area is.
 */
function fringeContent(
  host: THREE.Group,
  f: { x: number; z: number; band: Band; scale: number },
  kind: SurroundKind,
  m: SurroundMaterials,
): void {
  const seed = Math.round(f.x * 13 + f.z * 7);
  const roll = hash(Math.round(f.x), Math.round(f.z), 54);
  let child: THREE.Object3D;
  if (kind === "dunes") {
    child = roll < 0.35 ? distantDune(m, { radius: 1.4, seed }) : distantShrubClump(m, { radius: 0.24, seed });
  } else if (kind === "woodland") {
    child = roll < 0.45 ? distantConifer(m, { height: 1.3, seed }) : roll < 0.8 ? distantShrubClump(m, { seed }) : distantRockOutcrop(m, { seed });
  } else if (kind === "cityblocks") {
    // NOT beds. The city’s bloomColors are its NEON, so a flower bed out here
    // scatters magenta dots across the pavement and reads as litter rather than
    // as planting — a palette slot doing the job it was named for and the wrong
    // job for this object. Rubble and low planting instead.
    child = roll < 0.55 ? distantRockOutcrop(m, { seed }) : distantShrubClump(m, { seed });
  } else if (
    f.band === "south" &&
    roll >= SURROUND_PARAMS.southFringeBuildings &&
    roll < SURROUND_PARAMS.southFringeBuildings + SURROUND_PARAMS.southFringeTrees
  ) {
    // IDEA-070: trees in the south, and SHORT ones. Everything in this band
    // is held down for the same reason — it is unfogged, nearest the camera
    // and the largest anything in the surround ever draws, so a tree at the
    // north band's size reads as standing on the maze rather than behind it.
    // 1.7..2.3, not the 1.15 the first tuning used. The solved occlusion
    // limit for this band is 3.85 units, so the constraint here is CROWDING
    // rather than sightline — and under that limit a tree short enough to be
    // "safe" is just a shrub. At 1.15 they read as more of the bushes already
    // scattered there, which is the opposite of filling a gap.
    child = distantBroadleaf(m, {
      height: 1.7 + hash(Math.round(f.x), Math.round(f.z), 56) * 0.6,
      seed,
    });
  } else if (f.band === "south" && roll < SURROUND_PARAMS.southFringeBuildings) {
    // IDEA-070: THE SOUTH FRINGE IS WHERE A SOUTH BUILDING HAS TO GO, and
    // finding that out is most of what this change was.
    //
    // Nuno: *"on the bottom of the maze, on the zone we have the buttons and
    // the joystick, we should balance the world — there are no houses or
    // greenhouses there."* The obvious fix was to let the south PLOTS take
    // allotments, and that is done — but measured, it barely shows, because
    // of where the lattice lands: on a phone the visible south window is
    // z 14.5..22.4 and the plot row sits at 22.5..24.1, i.e. AT or PAST the
    // frame edge, with exactly ONE plot inside it. The band looked empty
    // because almost nothing was ever built there, not because of the mix.
    //
    // The FRINGE is the mechanism that owns that annulus — IDEA-066 rule 7
    // added it for precisely this gap, "a plot row straddling the keep-clear
    // boundary is dropped whole, which on the south side left the nearest
    // five units bare". It carried only LOW content; now the south share of
    // it can also carry a greenhouse or a shed, which are the two buildings
    // low enough for the nearest, unfogged, largest-on-screen band.
    // MOSTLY GREENHOUSES, and that is a VALUE decision rather than a taste
    // one. The first tuning split them evenly with sheds and the render said
    // no: a shed is a small RED roof, the flower beds out here are small dark
    // RED rectangles, and at this size on dark lawn the two are the same mark.
    // A greenhouse is PALE — that is its whole identity rank 1, a pale box on
    // a dark plinth — so it is the one building in the set that separates from
    // everything already standing in this band.
    child =
      roll < SURROUND_PARAMS.southFringeBuildings * 0.78
        ? distantHouse(m, { kind: "greenhouse", eavesWidth: 1.75, seed })
        : distantHouse(m, { kind: "shed", eavesWidth: 1.2, seed });
  } else {
    // NO FLOWERING BORDER OUT HERE, deliberately. The fringe is the annulus
    // between the keep-clear box and the first plot row, so it has no hedge
    // for a border to stand against -- and a saturated mass alone on lawn is
    // the exact thing that made the first build read as litter, at the one
    // distance where everything is biggest and least fogged.
    child =
      roll < 0.55
        ? distantShrubClump(m, { seed })
        : roll < 0.78
          ? distantBed(m, { seed })
          : distantBroadleaf(m, { height: 1.15, seed });
  }
  child.position.set(f.x, 0, f.z);
  child.rotation.y = hash(Math.round(f.x), Math.round(f.z), 55) * Math.PI * 2;
  child.scale.multiplyScalar(f.scale);
  host.add(child);
}

const CONTENT: Record<
  Exclude<SurroundKind, "none">,
  (host: THREE.Group, plot: Plot, m: SurroundMaterials) => void
> = {
  plots: plotsContent,
  woodland: woodlandContent,
  dunes: dunesContent,
  parkland: parklandContent,
  cityblocks: cityblocksContent,
};

// ---------------------------------------------------------------------------

interface Cached {
  key: string;
  group: THREE.Group;
  mats: SurroundMaterials;
}
let cached: Cached | null = null;

/** Everything the built surround depends on, as one string. */
function cacheKey(kind: SurroundKind, pal: SurroundPaletteInput): string {
  const P = SURROUND_PARAMS;
  return [
    kind,
    pal.wall,
    pal.surroundGround,
    pal.fenceColor,
    pal.groundDetailColor,
    pal.bloomColors.join(","),
    P.halfWidth,
    P.zFar,
    P.zNear,
    P.plotW,
    P.plotD,
    P.lane,
    P.density,
    P.houseChance,
    P.allotmentChance,
    P.orchardChance,
    P.keepClear,
    P.nearScale,
    P.farScale,
    P.rampDistance,
    P.fringeWidth,
    P.fringeDensity,
    // IDEA-069: the visible footprint is part of WHAT WAS BUILT, so it belongs
    // in the key exactly as the dials do. It is quantised to 4 units at the
    // source, which is what stops a window drag rebuilding several hundred
    // props on every frame while still catching a rotation.
    SURROUND_VIEW.halfX,
    SURROUND_VIEW.zNear,
    SURROUND_VIEW.zFar,
  ].join("|");
}

/**
 * Build (or reuse) the surround and parent it to `scene`.
 *
 * IDEMPOTENT AND CONTENT-KEYED, which is the whole reason this is not a
 * per-level asset. The recipe reads only the theme and SURROUND_PARAMS — never
 * the grid — so it is byte-identical on all 36 maps and rebuilding it on every
 * level change would be several hundred props of pure waste on the one code
 * path a player notices.
 *
 * Keying on the VALUES of SURROUND_PARAMS rather than on a revision counter is
 * deliberate: it makes the editor's World tab live-preview work by
 * construction, with no invalidation call anyone can forget to make. It is the
 * one place this deviates from fence.ts's precedent, and only because the fence
 * is cheap enough to rebuild unconditionally and this is not.
 *
 * The caller BORROWS the result: `Board.surround` holds it for the census and
 * for the editor, but it must NOT be disposed per level — `disposeSurround`
 * below is for a theme change and for teardown, and it is called from here.
 */
/**
 * What the last successful build was made FOR, so `refreshSurroundForView`
 * can redo it without the caller having to hand the palette back.
 *
 * A resize happens in `scene.ts`, which has the camera and no idea which
 * theme the board is wearing; the board knows the theme and never hears about
 * a resize. Remembering the last call is what lets the two meet without
 * threading a rebuild callback through `buildBoard`, `applyBoardTheme` and
 * every call site of both.
 */
let lastBuild: { scene: THREE.Object3D; kind: SurroundKind; pal: SurroundPaletteInput } | null = null;

/**
 * IDEA-069: rebuild the surround if the visible footprint has moved.
 *
 * Called from `scene.ts`'s `resize()` — a rotation, a window drag past a
 * quantisation step, or the portrait dolly kicking in. Cheap when nothing
 * changed: `ensureSurround` is content-keyed, so this is a string compare
 * unless the view genuinely moved.
 */
export function refreshSurroundForView(): void {
  if (!lastBuild) return;
  ensureSurround(lastBuild.scene, lastBuild.kind, lastBuild.pal);
}

export function ensureSurround(
  scene: THREE.Object3D,
  kind: SurroundKind,
  pal: SurroundPaletteInput,
): THREE.Group | null {
  if (kind === "none") {
    disposeSurround();
    lastBuild = null;
    return null;
  }
  lastBuild = { scene, kind, pal };
  const key = cacheKey(kind, pal);
  if (cached && cached.key === key) {
    if (cached.group.parent !== scene) scene.add(cached.group);
    return cached.group;
  }
  disposeSurround();

  const mats = makeSurroundMaterials(pal);
  const host = buildSurroundContent(kind, mats);

  // ONE mesh per distinct material for the whole band, however much is in it.
  // castShadow stays off: the merged batch spans the full ground plane, which
  // OVERLAPS the key light's +-14/+-16 shadow camera, so it would be drawn into
  // the shadow map and its near contents could drop shadows across the apron
  // from geometry the player reads as far away. Widening the shadow camera
  // instead would cost board shadow resolution, which is the one thing that
  // must not get worse.
  mergeBySignature(host, { castShadow: false });
  host.traverse((o) => {
    o.castShadow = false;
    o.receiveShadow = false;
  });

  scene.add(host);
  cached = { key, group: host, mats };
  return host;
}

/**
 * Everything the band contains, UNMERGED and with its groups still named.
 *
 * Split out of `ensureSurround` purely so it can be tested: the merge that
 * follows welds the whole band into one mesh per material, which makes every
 * question about where an individual object ENDED UP unanswerable from the
 * finished group. The greenhouse-inside-the-house defect lived in that blind
 * spot for two releases.
 */
export function buildSurroundContent(
  kind: Exclude<SurroundKind, "none">,
  mats: SurroundMaterials,
): THREE.Group {
  const host = new THREE.Group();
  host.name = "surround";
  const content = CONTENT[kind];
  for (const plot of planPlots()) content(host, plot, mats);
  for (const f of planFringe()) fringeContent(host, f, kind, mats);
  return host;
}

/** Frees the cached surround — geometry AND the shared material set, both of
 *  which it owns. Safe to call when nothing is cached. */
export function disposeSurround(): void {
  if (!cached) return;
  cached.group.removeFromParent();
  cached.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.geometry.dispose();
  });
  disposeSurroundMaterials(cached.mats);
  cached = null;
}
