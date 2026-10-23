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
  distantBroadleaf,
  distantBeachSpot,
  distantConifer,
  distantFloweringShrub,
  distantFlowerPatch,
  distantPicketFence,
  distantRockOutcrop,
  distantShrubClump,
  type FlowerMaker,
} from "./surroundProps";
import { makeGardenFlower } from "./gardenProps";
import { getPropDef } from "../game/props";
import { mergeBySignature } from "./propMerge";
import { SEASIDE_PARAMS, type Seaside, buildSeaside, disposeSeaside, inSea } from "./seaside";
import { buildCityStreets } from "./cityLayout";
import {
  distantAnchor,
  distantBarrel,
  distantCannon,
  distantCoinPile,
  distantCrate,
  distantJungleBush,
  distantPalm,
  distantPirateFlag,
  distantPistols,
  distantRopeCoil,
  distantShipWheel,
  distantShipwreck,
  distantSkullPost,
  distantSunkenMast,
  distantSwordInSand,
  distantTreasureChest,
} from "./islandProps";
import { boxInParkZone, buildLake, buildParkAvenue, buildPlayground, inParkZone } from "./parkLayout";

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

/** What a garden plot IS. See SURROUND_PARAMS' garden mix. */
type Archetype = "flowers" | "orchard" | "meadow";

function archetypeFor(plot: Plot): Archetype {
  const P = SURROUND_PARAMS;
  const roll = hash(plot.px, plot.pz, 4);
  if (roll < P.flowerGardenChance) return "flowers";
  if (roll < P.flowerGardenChance + P.orchardChance) return "orchard";
  return "meadow";
}

/**
 * The flower a patch plants: the Props tab's own def, so a retuned daisy in
 * the library is the daisy out here too. Its petal and centre colours are
 * overridden with the sentinels `distantFlowerPatch` identifies them by — the
 * patch swaps every material onto the shared set, so the authored colours
 * would never be drawn anyway.
 */
const makeFlower: FlowerMaker = (id, h, petal, centre) =>
  makeGardenFlower(
    { ...(getPropDef(id)?.params ?? {}), petalColor: petal, centerColor: centre },
    h,
    true,
    "distant",
  );

/**
 * A fenced boundary around a plot, with a GATE — a gap in the middle of one
 * side rather than a whole side missing. A missing side read fine on a hedge
 * (a hedge is a garden's back wall); on a fence it reads as unfinished.
 */
function fencePerimeter(host: THREE.Group, plot: Plot, m: SurroundMaterials): void {
  const gate = Math.floor(hash(plot.px, plot.pz, 3) * 4) % 4;
  const h = plot.band === "south" ? 0.34 : 0.4;
  const run = (x0: number, z0: number, x1: number, z1: number, salt: number): void => {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 0.3) return;
    const f = distantPicketFence(m, {
      length: len,
      height: h,
      seed: salt + plot.px * 7 + plot.pz * 13,
      rail: plot.out > SURROUND_PARAMS.detailReach,
    });
    f.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
    // Built along local +X: same aiming rule, and the same sign trap, as
    // every run in this file — atan2(-dz, dx), never atan2(dz, dx).
    f.rotation.y = Math.atan2(-dz, dx);
    host.add(f);
  };
  for (let i = 0; i < 4; i++) {
    const a = plot.corners[i];
    const b = plot.corners[(i + 1) % 4];
    if (i !== gate) {
      run(a[0], a[1], b[0], b[1], 41 + i);
      continue;
    }
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const k = (len - 1.3) / 2 / len; // a 1.3-unit gateway, centred
    run(a[0], a[1], a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, 45);
    run(b[0] + (a[0] - b[0]) * k, b[1] + (a[1] - b[1]) * k, b[0], b[1], 46);
  }
}

/**
 * The plot's planting SLOTS: a 3x3 grid in plot fractions, shuffled per plot.
 * Items take slots rather than free positions so a tree, a shrub and a
 * flower bed can never land on each other — the lesson of the
 * greenhouse-inside-the-house defect, solved by construction this time.
 */
function slotsFor(plot: Plot): Array<[number, number]> {
  const s: Array<[number, number, number]> = [];
  for (const v of [-0.5, 0, 0.5]) {
    for (const u of [-0.56, 0, 0.56]) {
      s.push([
        u + (hash(plot.px * 3 + s.length, plot.pz, 35) - 0.5) * 0.12,
        v + (hash(plot.px, plot.pz * 3 + s.length, 36) - 0.5) * 0.12,
        hash(plot.px + s.length, plot.pz, 37),
      ]);
    }
  }
  return s.sort((a, b) => a[2] - b[2]).map(([u, v]) => [u, v]);
}

/** Corner slots first — a tree belongs at the edge of a plot, not its middle. */
function cornersFirst(slots: Array<[number, number]>): Array<[number, number]> {
  const corner = (s: [number, number]): boolean => Math.abs(s[0]) > 0.3 && Math.abs(s[1]) > 0.3;
  return [...slots.filter(corner), ...slots.filter((s) => !corner(s))];
}

/**
 * A flower patch near the board; a flowering shrub past `detailReach`.
 *
 * NOT a kerbed bed and NOT a flowering border, which is what the far band used
 * first. Rendered, the bed's pale kerb read as a FRUIT BOWL and the border's
 * stacked blocks as a row of candy bars — two more kinds of object in a band
 * whose whole brief is less noise. A flowering shrub is already out there, so
 * the far plots say "flowers" with a shape the near ones also use.
 */
function patch(plot: Plot, m: SurroundMaterials, i: number): THREE.Object3D {
  const seed = 701 + i + plot.px * 31 + plot.pz * 17;
  return plot.out <= SURROUND_PARAMS.detailReach
    ? distantFlowerPatch(m, makeFlower, { seed, radius: 0.48 + hash(plot.px, plot.pz, 70 + i) * 0.14 })
    : distantFloweringShrub(m, { seed });
}

/**
 * The garden's surround: FENCED PLOTS OF PLANTING, and nothing built.
 *
 * Nuno (IDEA-083): *"remove all the houses and treehouses. Just the
 * environment — some trees and shrubs with flowers. We can make groups of
 * flowers using the ones we have on the props, and fences, with squares that
 * have these components inside."* So the lattice stays (rule 5: the
 * boundaries are what turn a scatter into somebody's garden) and every plot
 * is a fenced square of trees, flowering shrubs and flower patches.
 */
function plotsContent(host: THREE.Group, plot: Plot, m: SurroundMaterials): void {
  const south = plot.band === "south";
  const kind = archetypeFor(plot);
  const seed = plot.px * 31 + plot.pz * 17;
  const far = plot.out > SURROUND_PARAMS.detailReach;
  fencePerimeter(host, plot, m);

  const slots = slotsFor(plot);
  const put = (o: THREE.Object3D, s: [number, number], salt: number): void =>
    placeIn(host, plot, o, s[0], s[1], plot.scale, hash(plot.px, plot.pz, salt) * Math.PI * 2);
  // South trees stay short, as everywhere in this band (IDEA-066 rule 6).
  const tree = (i: number): THREE.Object3D =>
    distantBroadleaf(m, {
      height: south ? 1.1 + hash(plot.px, plot.pz, 60 + i) * 0.3 : undefined,
      seed: 141 + i + seed,
    });
  const shrub = (i: number): THREE.Object3D =>
    hash(plot.px, plot.pz, 90 + i) < 0.75
      ? distantFloweringShrub(m, { seed: 151 + i + seed })
      : distantShrubClump(m, { seed: 151 + i + seed });

  if (kind === "flowers") {
    // Past `detailReach` a patch is a flowering shrub (see `patch`), and one
    // is plenty beside the plot's own shrubs.
    const nPatch = far ? 1 : 2 + Math.floor(hash(plot.px, plot.pz, 12) * 2);
    const nShrub = 2 + Math.floor(hash(plot.px, plot.pz, 13) * 2);
    const hasTree = hash(plot.px, plot.pz, 14) < 0.5;
    const order = hasTree ? cornersFirst(slots) : slots;
    let k = 0;
    if (hasTree) put(tree(0), order[k++], 20);
    for (let i = 0; i < nPatch; i++) put(patch(plot, m, i), order[k++], 21 + i);
    for (let i = 0; i < nShrub; i++) put(shrub(i), order[k++], 26 + i);
    return;
  }

  if (kind === "orchard") {
    const order = cornersFirst(slots);
    const nTree = (south ? 2 : 3) + Math.floor(hash(plot.px, plot.pz, 15) * 2);
    let k = 0;
    for (let i = 0; i < nTree; i++) put(tree(i), order[k++], 30 + i);
    // The orchard's and the meadow's single patch is planted near the board
    // only: out past `detailReach` the plot's shrubs already carry the colour.
    if (!far) put(patch(plot, m, 0), order[k++], 35);
    put(shrub(0), order[k++], 36);
    if (hash(plot.px, plot.pz, 16) < 0.5) put(shrub(1), order[k++], 37);
    return;
  }

  // meadow: mostly lawn, which is what gives the eye somewhere to rest.
  const order = cornersFirst(slots);
  put(tree(0), order[0], 40);
  if (!far) put(patch(plot, m, 0), order[4], 41);
  put(shrub(0), order[5], 42);
}

/** The forest: conifers thickening with distance, no boundaries at all — a
 *  wood has no plots, and drawing hedgerows through one would say the opposite
 *  of what the theme is. */
function woodlandContent(host: THREE.Group, plot: Plot, m: SurroundMaterials): void {
  const south = plot.band === "south";
  // THINNED FROM 4..8 WHEN THE CONIFER BECAME THE REAL PINE (IDEA-065 v4),
  // AND THE UNIT THAT IS HELD CONSTANT IS CANOPY COVERAGE, NOT TREE COUNT.
  // The new silhouette is the measured 0.718 aspect against the cone stack's
  // 0.6, i.e. 1.2x wider at the same height and 1.43x the ground area, so
  // 0.75x the trees cover the same floor — and measured
  // (`scripts/_scratch-pine-census.ts`) that is also what keeps the band
  // inside its 140k triangle ceiling: 585 trees at ~280 triangles is 164k,
  // where the old 585 at 66 was 39k. A wood that reads as a wood is the
  // requirement; the number of trunks in it is not.
  const n = south ? 2 : 3 + Math.floor(hash(plot.px, plot.pz, 4) * 4);
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

/**
 * How far up the beach from the waterline's MEAN a thing must stand: the
 * swash's highest reach, the wet band behind it, and a margin for the object's
 * own footprint (a scaled tent is ~1.2 across). An umbrella planted at the mean
 * waterline stands in the surf half the time — see `inSea`.
 */
const BEACH_KEEP_DRY =
  SEASIDE_PARAMS.swashReach + SEASIDE_PARAMS.wetWidth + 1.4;

/** `placeIn`, refusing a spot in the sea. Returns whether it placed. */
function placeOnBeach(
  host: THREE.Group,
  plot: Plot,
  child: THREE.Object3D,
  u: number,
  v: number,
  rotY: number,
): boolean {
  const [x, z] = pointIn(plot, u, v);
  if (inSea(x, z, BEACH_KEEP_DRY)) return false;
  placeIn(host, plot, child, u, v, plot.scale, rotY);
  return true;
}

/**
 * The beach (IDEA-080): the SEA to the north and SUNBATHERS to the south —
 * and nothing on the east and west sides (v4, Nuno: *"the east and west sides
 * don't need to have any decoration, so let's put the towels and the umbrellas
 * on the south side and remove the things on the sides"*). The campsite that
 * stood east went with them; `distantTent` stays in surroundProps.ts as a
 * library shape. The kind id is still `"dunes"` because it is a palette value
 * in themes.ts; what it builds is no longer dunes.
 *
 * NO BOUNDARIES. Every other kind with people in it fences its plots; a beach
 * is the one place nobody does, and a hedge on sand would say "garden". The
 * plot is only a unit of placement here — the four SLOTS below are what keep a
 * spot's umbrella out of its neighbour's towels, since a plot fraction of
 * +-0.5 is ~3.5 units apart against a spot ~2 across.
 *
 * The SOUTH band is the whole width below the board (corner plots included),
 * so the sunbathers run edge to edge under the maze rather than in a patch.
 */
function dunesContent(host: THREE.Group, plot: Plot, m: SurroundMaterials): void {
  // Wholly in the water: nothing to build. Tested on the plot's centre with
  // no margin, because the per-object test below is the real guard and this
  // only saves the work.
  if (inSea(plot.cx, plot.cz)) return;
  // Open sand everywhere but the south.
  if (plot.band !== "south") return;
  const seed = plot.px * 31 + plot.pz * 17;
  const slots: Array<[number, number]> = [
    [-0.5, -0.45],
    [0.5, -0.45],
    [-0.5, 0.45],
    [0.5, 0.45],
  ];
  // Kept to two or three a plot, for rule 4's reason: the south is the
  // nearest, largest, unfogged band and it sits under the controls.
  const want = 2 + (hash(plot.px, plot.pz, 4) < 0.5 ? 1 : 0);
  let placed = 0;
  for (let i = 0; i < slots.length && placed < want; i++) {
    if (hash(plot.px, plot.pz, 30 + i) < 0.18) continue; // an empty pitch is part of a beach too
    const [su, sv] = slots[i];
    const u = su + (hash(plot.px, plot.pz, 5 + i) - 0.5) * 0.35;
    const v = sv + (hash(plot.px, plot.pz, 9 + i) - 0.5) * 0.35;
    const child = distantBeachSpot(m, { seed: 121 + i + seed });
    // Sunbathers lie at any angle.
    const rot = hash(plot.px, plot.pz, 13 + i) * Math.PI * 2;
    if (placeOnBeach(host, plot, child, u, v, rot)) placed++;
  }
  // NO BEACH GRASS, deliberately. `distantShrubClump` takes its greens off
  // `palette.wall`, which on this theme is SAND — so a "grass tuft" came out
  // as a tan lump, and a scatter of those read as pebbles and litter across
  // the beach (they were on the old dune build too). Open sand between the
  // pitches is what a beach is; the colour lives on the people's things.
}

// ---------------------------------------------------------------------------
// PIRATE ISLAND (IDEA-085)

/**
 * The island's SET PIECES: hand-composed groups at fixed spots, because the
 * brief names WHERE things are — the wreck on the water to the north-west, the
 * treasure to the south, ship's gear on each side close to the maze. A scatter
 * cannot promise any of that; a scatter is what fills between them.
 *
 * Positions are world units. Every one is OUTSIDE the keep-clear box (x 13.5,
 * z 14.5) or out in the sea, and `test-surround.ts` holds them to it.
 */
interface SetPiece {
  name: string;
  x: number;
  z: number;
  /** Clearance the fringe and the plots keep round it, world units. */
  clear: number;
  build: (m: SurroundMaterials) => THREE.Object3D;
}

/** A group of parts placed relative to a set piece's own origin. */
function cluster(
  name: string,
  items: Array<[THREE.Object3D, number, number, number, number?]>,
): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  for (const [o, x, z, yaw, scale] of items) {
    o.position.set(x, 0, z);
    o.rotation.y = yaw;
    if (scale !== undefined) o.scale.multiplyScalar(scale);
    g.add(o);
  }
  return g;
}

/** Yaw that turns a builder's local +Z to point along world (dx, dz). */
const aim = (dx: number, dz: number): number => Math.atan2(dx, dz);

export const ISLAND_SET_PIECES: readonly SetPiece[] = [
  {
    // NORTH-WEST, ON THE WATER (Nuno: "a shipwreck on the north left side...
    // the ship should be on the water"). Bow out to sea, listing toward the
    // board so the camera sees its deck, sunk to a third of the hull.
    name: "wreck",
    x: -9,
    z: -20.6,
    clear: 0,
    build: (m) => {
      const w = distantShipwreck(m, { seed: 5 });
      w.rotation.y = Math.PI / 2 + 0.35;
      // A landmark: big enough to read as a GALLEON at the top of a phone,
      // where the camera is furthest away.
      w.scale.setScalar(1.3);
      w.position.y = -0.65;
      const g = new THREE.Group();
      g.name = "wreck-site";
      g.add(w);
      return g;
    },
  },
  {
    // A second, sunken wreck to the north-east, so the north is not one object.
    name: "sunkenMast",
    x: 10.5,
    z: -22.5,
    clear: 0,
    build: (m) => distantSunkenMast(m, { seed: 7 }),
  },
  {
    // SOUTH: the treasure. Low on purpose — this band is unfogged, nearest the
    // camera and under the HUD (IDEA-066 rule 6); the flag is the only thing
    // with height and it stands at the back.
    name: "hoard",
    x: 0,
    z: 17,
    clear: 4,
    build: (m) => {
      const hoard = cluster("hoard", [
        [distantTreasureChest(m, { seed: 3 }), 0, 0, 0, 1.25],
        [distantCoinPile(m, { seed: 1 }), -1.1, 0.35, 0],
        [distantCoinPile(m, { seed: 2, size: 0.8 }), 1.15, 0.5, 0],
        [distantSwordInSand(m, { seed: 4 }), -0.75, -0.75, 0, 1.3],
        [distantSwordInSand(m, { seed: 9 }), 0.85, -0.7, 0, 1.3],
        [distantPistols(m, { seed: 2 }), -1.6, 1.1, 0.4, 1.2],
        [distantSkullPost(m, { seed: 5 }), 1.9, 0.6, -0.3, 1.2],
        [distantPirateFlag(m, { seed: 8, height: 1.5 }), -1.9, -1.2, 0.5],
      ]);
      // The centrepiece of the band a phone shows under the maze: at 1x the
      // chest was a dozen pixels, a gold dot rather than a treasure.
      hoard.scale.setScalar(1.4);
      return hoard;
    },
  },
  {
    // THE SIDES, close to the maze: a shore battery each side — guns run out
    // toward open water, a flag, the powder and shot beside them.
    name: "batteryWest",
    x: -15.2,
    z: -2,
    clear: 2.6,
    build: (m) =>
      cluster("battery-west", [
        [distantCannon(m, { seed: 1 }), 0, -1.1, aim(-0.6, -1), 1.35],
        [distantCannon(m, { seed: 2 }), 0.2, 0.6, aim(-1, -0.3), 1.35],
        [distantPirateFlag(m, { seed: 3 }), 1.0, -0.2, 0.6],
        [distantBarrel(m, { seed: 4, tipped: false }), 1.2, 1.4, 0, 1.2],
        [distantCrate(m), 0.9, 2.0, 0.4, 1.2],
      ]),
  },
  {
    name: "helmWest",
    x: -14.6,
    z: 7,
    clear: 1.6,
    build: (m) =>
      cluster("helm-west", [
        [distantShipWheel(m, { seed: 3 }), 0, 0, 0.5, 1.4],
        [distantRopeCoil(m), 0.9, 0.6, 0, 1.2],
      ]),
  },
  {
    name: "batteryEast",
    x: 15.2,
    z: 2,
    clear: 2.6,
    build: (m) =>
      cluster("battery-east", [
        [distantCannon(m, { seed: 5 }), 0, -0.9, aim(1, -0.4), 1.35],
        [distantCannon(m, { seed: 6 }), -0.2, 0.9, aim(1, 0.2), 1.35],
        [distantPirateFlag(m, { seed: 9 }), -1.0, -0.1, -0.4],
        [distantBarrel(m, { seed: 7, tipped: true }), -1.0, 1.7, 0.8, 1.2],
      ]),
  },
  {
    name: "anchorEast",
    x: 14.4,
    z: -8,
    clear: 1.6,
    build: (m) =>
      cluster("anchor-east", [
        [distantAnchor(m, { seed: 2 }), 0, 0, 0, 1.5],
        [distantShipWheel(m, { seed: 8 }), 1.2, 0.8, -0.6, 1.25],
      ]),
  },
];

/** Inside a set piece's clearance? */
function nearSetPiece(x: number, z: number, margin = 0): boolean {
  return ISLAND_SET_PIECES.some((p) => p.clear > 0 && Math.hypot(x - p.x, z - p.z) < p.clear + margin);
}

/** The island's interior: palm groves and jungle on open sand. NO BOUNDARIES,
 *  for the beach's reason: nobody fences a desert island. */
function islandContent(host: THREE.Group, plot: Plot, m: SurroundMaterials): void {
  if (inSea(plot.cx, plot.cz)) return;
  if (nearSetPiece(plot.cx, plot.cz, plot.w / 2)) return;
  const south = plot.band === "south";
  const seed = plot.px * 31 + plot.pz * 17;
  // Palms in GROVES — two to four leaning together reads as a grove; one per
  // plot evenly spread reads as a planted avenue.
  const nPalm = south
    ? 1 + (hash(plot.px, plot.pz, 4) < 0.5 ? 1 : 0)
    : 2 + Math.floor(hash(plot.px, plot.pz, 4) * 3);
  const gu = (hash(plot.px, plot.pz, 5) - 0.5) * 0.8;
  const gv = (hash(plot.px, plot.pz, 6) - 0.5) * 0.8;
  for (let i = 0; i < nPalm; i++) {
    const palm = distantPalm(m, {
      height: south ? 1.7 + hash(plot.px, plot.pz, 40 + i) * 0.4 : undefined,
      seed: 161 + i + seed,
    });
    const u = gu + (hash(plot.px, plot.pz, 7 + i) - 0.5) * 0.7;
    const v = gv + (hash(plot.px, plot.pz, 12 + i) - 0.5) * 0.7;
    placeOnBeach(host, plot, palm, u, v, hash(plot.px, plot.pz, 17 + i) * Math.PI * 2);
  }
  const nBush = 1 + Math.floor(hash(plot.px, plot.pz, 22) * 3);
  for (let i = 0; i < nBush; i++) {
    placeOnBeach(
      host,
      plot,
      distantJungleBush(m, { seed: 171 + i + seed }),
      (hash(plot.px, plot.pz, 23 + i) - 0.5) * 1.6,
      (hash(plot.px, plot.pz, 27 + i) - 0.5) * 1.6,
      hash(plot.px, plot.pz, 31 + i) * Math.PI * 2,
    );
  }
  // Now and then something washed up among the trees.
  if (!south && hash(plot.px, plot.pz, 34) < 0.25) {
    const d = hash(plot.px, plot.pz, 35);
    const debris = d < 0.4 ? distantBarrel(m, { seed }) : d < 0.75 ? distantCrate(m) : distantAnchor(m, { seed });
    placeOnBeach(host, plot, debris, (hash(plot.px, plot.pz, 36) - 0.5) * 1.4, (hash(plot.px, plot.pz, 37) - 0.5) * 1.4, d * 6);
  }
}

/** The share of fringe cells the island fills at all — see `islandFringe`. */
const ISLAND_FRINGE_SHARE = 0.5;

/**
 * The island's fringe — the ring nearest the board. THE SIDES carry ship's
 * gear between their set pieces; THE SOUTH carries arms and symbols round the
 * hoard; THE NORTH is surf and stays empty. Sparser than any other theme's
 * fringe: a few objects with sand between them reads as a beach, a ring of
 * them reads as a junk yard.
 */
function islandFringe(
  f: { x: number; z: number; band: Band; scale: number },
  roll: number,
  m: SurroundMaterials,
  seed: number,
): THREE.Object3D | null {
  if (inSea(f.x, f.z, BEACH_KEEP_DRY)) return null;
  if (nearSetPiece(f.x, f.z, 0.6)) return null;
  if (roll > ISLAND_FRINGE_SHARE) return null;
  const t = roll / ISLAND_FRINGE_SHARE;
  if (f.band === "south") {
    if (t < 0.22) return distantSwordInSand(m, { seed });
    if (t < 0.32) return distantSkullPost(m, { seed });
    if (t < 0.42) return distantPistols(m, { seed });
    if (t < 0.5) return distantCoinPile(m, { seed, size: 0.7 });
    if (t < 0.6) return distantBarrel(m, { seed });
    if (t < 0.78) return distantPalm(m, { height: 1.7 + (t - 0.6) * 2, seed });
    return distantJungleBush(m, { seed });
  }
  if (t < 0.12) return distantBarrel(m, { seed });
  if (t < 0.2) return distantCrate(m);
  if (t < 0.26) return distantRopeCoil(m);
  if (t < 0.32) return distantCannon(m, { seed });
  if (t < 0.6) return distantPalm(m, { height: 1.9 + (t - 0.32) * 2, seed });
  return distantJungleBush(m, { seed });
}

/** The park: loose groves of trees on open lawn. */
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
  // NO FLOWER BEDS (IDEA-081, Nuno: *"around the park we have the trees and
  // that ok but we have the oval things with some dots with colors, lets
  // remove that"*). Scattered over open lawn they read as litter rather than
  // planting; the park's flowers live on the avenue, behind its benches, where
  // there is a reason for them to be.
}

/**
 * Where the park's south-fringe trees start on the roll. 0.34 is where the
 * garden's south fringe BUILDINGS used to end (IDEA-070) — the two themes
 * shared one window, and the park keeps its exact placement now that the
 * garden has its own arm and no buildings.
 */
const PARK_SOUTH_TREE_FROM = 0.34;

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
  if (kind === "island") {
    const c = islandFringe(f, roll, m, seed);
    if (!c) return;
    child = c;
  } else if (kind === "dunes") {
    // IDEA-080. The fringe is the annulus nearest the board, so the beach's
    // north fringe is where the surf is: nothing in the water, and nothing on
    // the wet sand either.
    if (inSea(f.x, f.z, BEACH_KEEP_DRY)) return;
    // South only, as in `dunesContent`: the sides stay open sand. Sparser
    // than the plots — most of the fringe stays open, which is what lets the
    // pitches further out read as a beach rather than a car park.
    if (f.band !== "south" || roll >= 0.3) return;
    child = distantBeachSpot(m, { seed });
  } else if (kind === "woodland") {
    // A RANGE, NOT A LITERAL (IDEA-065 v4). Every woodland fringe conifer was
    // exactly 1.3 units, so the ring of trees nearest the board was a row of
    // clones at one height — which the cone stack got away with and the new
    // pine does not, because a stack of seven skirts at 1.3 units is skirts
    // two pixels apart and reads as a sprig rather than as a tree.
    //
    // 1.5..2.1 is the same move IDEA-070 made for the south fringe of every
    // OTHER theme (1.7..2.3) and which the forest could never reach, because
    // this `woodland` arm is tested before the south-band one. Still well
    // under the solved 3.85 occlusion limit for this annulus; crowding is the
    // constraint out here, not sightlines.
    child =
      roll < 0.45
        ? distantConifer(m, { height: 1.5 + hash(Math.round(f.x), Math.round(f.z), 61) * 0.6, seed })
        : roll < 0.8
          ? distantShrubClump(m, { seed })
          : distantRockOutcrop(m, { seed });
  } else if (kind === "plots") {
    // IDEA-083: THE GARDEN'S FRINGE IS PLANTING, NOTHING BUILT. This annulus
    // carried IDEA-070's south greenhouses and sheds; it now carries the
    // flowers, because it is the nearest, least-fogged ring and the one place
    // a flower is big enough on screen to read as the Props tab's daisy or
    // tulip rather than as a coloured speck. No fence out here: the fringe is
    // the maze's own verge, not somebody's plot.
    const P = SURROUND_PARAMS;
    if (roll < P.fringeFlowers) {
      child = distantFlowerPatch(m, makeFlower, {
        seed,
        radius: 0.42 + hash(Math.round(f.x), Math.round(f.z), 57) * 0.14,
        count: 4 + Math.floor(hash(Math.round(f.x), Math.round(f.z), 58) * 2),
      });
    } else if (f.band === "south" && roll < P.fringeFlowers + P.southFringeTrees) {
      // Short trees in the south, for IDEA-070's reason — see southFringeTrees.
      child = distantBroadleaf(m, {
        height: 1.7 + hash(Math.round(f.x), Math.round(f.z), 56) * 0.6,
        seed,
      });
    } else if (roll < 0.86) {
      child =
        roll < 0.66 ? distantFloweringShrub(m, { seed }) : distantShrubClump(m, { seed });
    } else {
      child = distantBroadleaf(m, { height: 1.15, seed });
    }
  } else if (
    f.band === "south" &&
    roll >= PARK_SOUTH_TREE_FROM &&
    roll < PARK_SOUTH_TREE_FROM + SURROUND_PARAMS.southFringeTrees
  ) {
    // The park's south trees (IDEA-070), short for the band's reason. They
    // were 1.15 units on the first tuning and read as more of the bushes;
    // 1.7..2.3 is still well under the solved 3.85 occlusion limit.
    child = distantBroadleaf(m, {
      height: 1.7 + hash(Math.round(f.x), Math.round(f.z), 56) * 0.6,
      seed,
    });
  } else {
    // No flowering border and no flower bed in the park's fringe (IDEA-081):
    // a saturated mass alone on lawn reads as litter, and a public park's
    // nearest ring is the avenue's continuation.
    child =
      roll < 0.78
        ? distantShrubClump(m, { seed })
        : distantBroadleaf(m, { height: 1.15, seed });
  }
  child.position.set(f.x, 0, f.z);
  const spin = hash(Math.round(f.x), Math.round(f.z), 55);
  child.rotation.y = spin * Math.PI * 2;
  child.scale.multiplyScalar(f.scale);
  host.add(child);
}

// The city is not here: it does not use the plot lattice at all (IDEA-082, see
// cityLayout.ts), so `buildSurroundContent` hands it to `buildCityStreets`.
const CONTENT: Record<
  Exclude<SurroundKind, "none" | "cityblocks">,
  (host: THREE.Group, plot: Plot, m: SurroundMaterials) => void
> = {
  plots: plotsContent,
  woodland: woodlandContent,
  dunes: dunesContent,
  parkland: parklandContent,
  island: islandContent,
};

// ---------------------------------------------------------------------------

interface Cached {
  key: string;
  group: THREE.Group;
  mats: SurroundMaterials;
  /** The beach's sea (IDEA-080), owned alongside the band: its two shader
   *  materials are NOT in the shared set, so disposing that set would leak
   *  them. */
  sea: Seaside | null;
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
    // Day or night decides whether the windows are lamps or glass.
    pal.bg,
    P.halfWidth,
    P.zFar,
    P.zNear,
    P.plotW,
    P.plotD,
    P.lane,
    P.density,
    P.flowerGardenChance,
    P.orchardChance,
    P.detailReach,
    P.fringeFlowers,
    P.southFringeTrees,
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

  // THE SEA GOES IN AFTER THE MERGE, never before it. Its two materials are
  // ShaderMaterials owned by seaside.ts, and `mergeBySignature` exists to weld
  // the shared toon set — handing it a transparent, depth-ignoring shore
  // ribbon to bucket is asking it to reason about something it was never
  // written for. Parented to the band so it is cached, borrowed and removed
  // with it, and built over the ground's FULL extent rather than the culled
  // view: it is two meshes whatever its size, and IDEA-069's rule is that
  // only props are culled, never ground.
  const sea =
    kind === "dunes" || kind === "island"
      ? buildSeaside(SURROUND_PARAMS.halfWidth, SURROUND_PARAMS.zFar)
      : null;
  if (sea) host.add(sea.group);

  scene.add(host);
  cached = { key, group: host, mats, sea };
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
/** Does a plot's quadrilateral touch any of the park's reserved zones? */
function plotInPark(plot: Plot): boolean {
  const xs = plot.corners.map((c) => c[0]);
  const zs = plot.corners.map((c) => c[1]);
  return boxInParkZone(Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs));
}

export function buildSurroundContent(
  kind: Exclude<SurroundKind, "none">,
  mats: SurroundMaterials,
): THREE.Group {
  const host = new THREE.Group();
  host.name = "surround";
  // Night City is laid out as STREETS rather than grown on the plot lattice
  // (IDEA-082): no plots, no fringe — the street frontages are both.
  if (kind === "cityblocks") {
    buildCityStreets(host, mats);
    return host;
  }
  const content = CONTENT[kind];
  // The park reserves the ground its designed zones stand on (IDEA-081). A
  // plot touching one is dropped WHOLE, rule 2's reasoning, and a fringe item
  // is dropped with a margin so nothing grows out of the avenue's tree row.
  const park = kind === "parkland";
  for (const plot of planPlots()) {
    if (park && plotInPark(plot)) continue;
    content(host, plot, mats);
  }
  for (const f of planFringe()) {
    if (park && inParkZone(f.x, f.z, 0.8)) continue;
    fringeContent(host, f, kind, mats);
  }
  if (kind === "island") {
    for (const p of ISLAND_SET_PIECES) {
      const o = p.build(mats);
      o.position.x += p.x;
      o.position.z += p.z;
      host.add(o);
    }
  }
  if (park) {
    buildParkAvenue(host, mats);
    buildPlayground(host, mats);
    buildLake(host, mats);
  }
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
  if (cached.sea) disposeSeaside(cached.sea);
  cached = null;
}
