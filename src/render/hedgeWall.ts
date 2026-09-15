// OWNER: render-artist
// IDEA-068: THE MAZE WALL STOPS BEING A BOX.
//
// Nuno: "the maze walls look too geometrical and I was thinking, since they
// are simulating a plant, if we can add a little texture, not be so straight
// and look more like a hedge."
//
// He is attacking something this project already had on the record as a known
// compromise. CLAUDE.md, IDEA-060: *"with every map stripped, the fence and
// the wall-top flowers are still there as real silhouettes — and the HEDGE IS
// STILL A PLAIN BOX. All of its leafiness is paint."* Every hedge in the game
// is `BoxGeometry(1, 1, 1)` wearing a painted shrub, and at the play camera
// the flattest, largest, most visible surface on the whole board is ~200 dead
// level wall tops.
//
// WHAT ACTUALLY READS AT 17 PIXELS A TILE, WHICH IS WHAT A PHONE GIVES YOU.
// Measured off the real render, the board spans 325 CSS px for 19 tiles. So a
// geometric feature of 0.08 world units is 1.4 px and cannot read as a shape —
// the same arithmetic that made a literal-scale grass blade one pixel. What
// reads at that size is a change of VALUE over a LARGE AREA, and that is
// exactly what this buys: the scene is cel-shaded on a 3-step ramp that
// quantises by the surface normal, so a FLAT top face is one uniform band of
// green, while an UNDULATING one falls into two or three bands and the wall
// top mottles. The mottling is the feature. The bumps are only how it is
// produced.
//
// FIVE CONSTRAINTS, and every one of them is forced rather than chosen.
//
//  1. ONE SHARED GEOMETRY. The walls are a single InstancedMesh — one draw
//     call for the whole maze, which is the reason a 200-tile board costs less
//     than its biscuits do. So every tile gets the SAME lumpy block, and the
//     variety has to come from the instance MATRIX. That is a hard boundary,
//     not a budget: per-tile geometry means per-tile meshes.
//  2. THE FLANKS BULGE OUTWARD ONLY. Neighbouring tiles butt at their faces,
//     so a face that bulges outward merely overlaps its neighbour (invisible,
//     and what a hedge does), while a face that DENTS inward opens a gap you
//     can see straight through the wall. Outward-only makes that
//     unrepresentable rather than merely avoided.
//  3. THE CROWN DIPS DOWNWARD ONLY, AND VANISHES AT THE TILE EDGES. Downward,
//     because `buildHedgeDecor` and `buildWallDecor` place blooms, specks and
//     props at WALL_H + 0.04 / 0.06 / 0.08 — clearances so tight that any
//     upward bump swallows them. Vanishing at the edges, because a crown that
//     is displaced AT the seam leaves a step at every tile boundary, and a
//     step at every tile boundary is a GRID — the exact thing being removed.
//  4. THE BULGE IS ZERO AT THE FOOT. `fence.ts` stands its pickets `proud`
//     of the wall face at 0.54 from the tile centre and only FENCE_H = 0.3
//     tall. A bulge that grows with height clears the fence for free and is
//     also what a clipped hedge does — tight at the base where it is cut every
//     year, shaggy on top where this season's growth is.
//  5. IT IS DERIVED FROM `wallTexture`, NOT A NEW PALETTE FIELD. A hedge
//     texture gets a hedge shape; sand, brick and Arcade Night's flat keep
//     their boxes, which is right — a lumpy brick wall is a wrong brick wall.
//     Deriving rather than adding a slot is `surroundTextureFor`'s reasoning:
//     the two have to relate, so a separate field is only ever a chance for
//     them to disagree. It does mean the FOREST and the PARK get this too;
//     that is deliberate, because they are hedges wearing the same texture,
//     and the amplitude is a World-tab dial if either needs pulling back.
import * as THREE from "three";
import { TILE } from "../game/grid";
import { type WallTextureKind } from "./wallTexture";

/** Which block a theme's walls are cut from. */
export type WallShape = "box" | "hedge";

/**
 * THE DIALS, as a NAMED MUTABLE TABLE under `FENCE_PARAMS`' exact contract:
 * production never writes it, the editor's World tab does, and then writes the
 * values back to THESE literals so the file stays the source of truth.
 */
// NOT `as const`: the World tab WRITES these, which is the whole contract a
// named mutable table exists for (FENCE_PARAMS' header has the reasoning).
// A readonly literal would compile through main.ts's cast and silently
// refuse every edit at runtime.
export interface HedgeWallParams {
  segments: number;
  bulge: number;
  bulgeCurve: number;
  crownDip: number;
  crownRoll: number;
  heightVary: number;
}

export const HEDGE_WALL_PARAMS: HedgeWallParams = {
  /**
   * Subdivisions per axis. The cost multiplier for the whole maze, so it is
   * the one number here with a real budget behind it: a box is 12 triangles
   * and `n` segments is 12n^2, times ~200 tiles. At 3 that is 21k triangles
   * against the maze's own 2.4k — still ONE draw call, and small beside the
   * fence's 67k.
   *
   * It is also the resolution of the mottling: at 2 the top face has one
   * interior vertex to move and the undulation is a single dome, at 4 it
   * starts to read as noise rather than as growth.
   */
  segments: 4,
  /** How far a flank may bulge OUTWARD at the crown, in world units. Never
   *  inward — see constraint 2. The corridor is one tile, so two facing walls
   *  at 0.08 leave 0.84 against a beagle 0.6 across. */
  bulge: 0.105,
  /** The exponent on the bulge's height ramp. Above 1 keeps the foot tight
   *  and throws the growth to the top, which is both what clears the fence and
   *  what a clipped hedge looks like. At 1 it is a wedge. */
  bulgeCurve: 1.7,
  /** How deep the crown may dip BELOW `WALL_H`, in world units. Downward only
   *  — see constraint 3. This is the number that does most of the work, since
   *  the top face is the one the play camera sees nearly in plan. */
  crownDip: 0.19,
  /** How much of the crown's dip comes from the SEAM-SAFE rolling component
   *  rather than the per-tile interior one, 0..1. Near 0 every tile is its own
   *  dome and a straight run reads as a row of cushions; near 1 the crown
   *  rolls continuously but every tile rolls the same way. `ridge`'s own note
   *  explains why one of the two can cross a seam and the other cannot. */
  crownRoll: 0.55,
  /** Per-TILE crown height variation, as a fraction taken off the wall's
   *  height. Applied through the instance matrix rather than the geometry,
   *  because it is the only per-tile variety a single shared block can have —
   *  and it is the strongest anti-grid signal available, since it reads as
   *  separately clipped sections rather than as one extruded ribbon.
   *  DOWNWARD only, for constraint 3's reason. */
  heightVary: 0.115,
};

/**
 * A hedge texture gets a hedge block; everything else keeps its box.
 *
 * `hedgeFlower` is the garden's; `hedge` is the forest's and the park's. Sand,
 * brick and flat are not plants and must not wobble.
 */
export function wallShapeFor(kind: WallTextureKind): WallShape {
  return kind === "hedge" || kind === "hedgeFlower" ? "hedge" : "box";
}

/**
 * Smooth, deterministic, in [0, 1].
 *
 * Two sine products rather than one, and deliberately at INCOMMENSURATE
 * frequencies: a single term gives every tile the same centred dome, which is
 * a grid of dimples — a different grid, but still a grid. The phases are what
 * make the four 90-degree instance rotations produce four different profiles
 * instead of one profile turned round.
 */
function wobble(u: number, v: number, seed: number): number {
  const a = Math.sin(u * 5.1 + v * 2.3 + seed) * Math.cos(u * 2.7 - v * 4.4 + seed * 1.7);
  const b = Math.sin(u * 8.9 - v * 7.1 + seed * 2.9);
  return Math.min(1, Math.max(0, 0.5 + 0.35 * a + 0.15 * b));
}

/** 1 at the tile's centre, 0 at its edge. `Math.cos` over the half-tile, so it
 *  arrives at zero with zero slope and the join is smooth rather than creased. */
function edgeFade(w: number): number {
  return Math.max(0, Math.cos((w / TILE) * Math.PI));
}

/**
 * The crown's SEAM-SAFE component: an EVEN function with the tile's own
 * period, summed separably as `ridge(x) + ridge(z)`.
 *
 * THIS IS THE WHOLE TRICK AND IT IS WORTH THE PARAGRAPH. The first build
 * faded the crown to zero at every tile edge, which guarantees neighbours meet
 * flush — and guarantees that every tile is a separate dome. On a straight run
 * that reads as a row of CUSHIONS, which is a different grid, not less of one.
 *
 * A separable sum of an EVEN, tile-periodic function is flush at the seam
 * WITHOUT being zero there: on the +X edge the height is `ridge(0.5) +
 * ridge(z)`, on the neighbour's -X edge it is `ridge(-0.5) + ridge(z)`, and
 * those are equal because `ridge` is even. It survives the 90-degree instance
 * rotations for the same two reasons: the expression is symmetric in x and z,
 * and evenness makes a reversed edge parameter irrelevant. So the crown rolls
 * CONTINUOUSLY along a whole run instead of restarting at every tile.
 */
function ridge(u: number): number {
  const p = (u / TILE) * Math.PI * 2;
  return 0.5 * Math.cos(p) + 0.3 * Math.cos(2 * p);
}

/**
 * The hedge block: one unit tile, `height` tall, sitting on y = 0 in the
 * instance frame `buildBoard` already uses (the box is centred, so the caller
 * still positions it at height/2).
 *
 * Returns a plain `BoxGeometry` for `"box"` — the byte-identical geometry
 * every theme had before this existed, so a non-hedge board is provably
 * unchanged rather than merely intended to be.
 */
export function wallGeometry(shape: WallShape, height: number): THREE.BufferGeometry {
  if (shape === "box") return new THREE.BoxGeometry(TILE, height, TILE);

  const n = Math.max(1, Math.round(HEDGE_WALL_PARAMS.segments));
  const geo = new THREE.BoxGeometry(TILE, height, TILE, n, n, n);
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const half = TILE / 2;
  const top = height / 2;
  const eps = 1e-4;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);

    // Height fraction, 0 at the foot and 1 at the crown.
    const t = Math.min(1, Math.max(0, (y + top) / height));
    const ramp = Math.pow(t, HEDGE_WALL_PARAMS.bulgeCurve);

    // --- flanks: OUTWARD only, and only on a face that IS a flank ---------
    // A corner vertex sits on two of them and gets both, which is what keeps
    // the corners from pinching in while the faces bulge out.
    let nx = x;
    let nz = z;
    if (Math.abs(Math.abs(x) - half) < eps) {
      nx = x + Math.sign(x) * HEDGE_WALL_PARAMS.bulge * ramp * wobble(z, y, 0.7);
    }
    if (Math.abs(Math.abs(z) - half) < eps) {
      nz = z + Math.sign(z) * HEDGE_WALL_PARAMS.bulge * ramp * wobble(x, y, 2.4);
    }

    // --- crown: DOWNWARD only, in two parts -------------------------------
    // A seam-safe rolling component that continues across tile boundaries,
    // plus an asymmetric interior one that fades to nothing at the edges.
    // The second is what makes the four instance rotations produce four
    // different tiles rather than one tile turned round — a symmetric crown
    // is rotation-invariant, so rotating it buys exactly nothing.
    let ny = y;
    if (Math.abs(y - top) < eps) {
      const roll = (ridge(x) + ridge(z) + 1.6) / 3.2; // -> [0, 1]
      const inner = edgeFade(x) * edgeFade(z) * wobble(x, z, 4.1);
      const mix = HEDGE_WALL_PARAMS.crownRoll * roll +
        (1 - HEDGE_WALL_PARAMS.crownRoll) * inner;
      ny = y - HEDGE_WALL_PARAMS.crownDip * mix;
    }

    pos.setXYZ(i, nx, ny, nz);
  }
  pos.needsUpdate = true;
  // Recomputed rather than kept: the whole point is that the top face stops
  // pointing straight up, because that is what puts parts of it into a
  // different band of the toon ramp. Keeping the authored normals would move
  // the vertices and leave the shading perfectly flat — the change would be
  // real geometry and invisible, which is this project's most-repeated defect.
  geo.computeVertexNormals();
  return geo;
}

/**
 * The per-TILE crown height, as a fraction of `WALL_H`.
 *
 * Deterministic from the tile, so it is the SAME answer for the instance
 * matrix and for everything that has to sit ON the crown. That sharing is the
 * point: `buildHedgeDecor` and `buildWallDecor` place blooms, specks and props
 * at fixed offsets above `WALL_H`, and the moment a tile's crown moves they
 * are either floating or buried. One function, three callers, no drift.
 *
 * Always <= 1, never above — see constraint 3.
 */
export function wallHeightScale(hash01: number, shape: WallShape): number {
  if (shape === "box") return 1;
  return 1 - HEDGE_WALL_PARAMS.heightVary * hash01;
}

/** Its own hash band, clear of buildProps (200/201), buildWallDecor (301),
 *  buildHedgeDecor (1-7), groundDetail (401-406), the verge (501), the
 *  surround (600-639) and the arches (701). */
export const WALL_SHAPE_HASH_SEED = 801;
