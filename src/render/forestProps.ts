// OWNER: render-artist
// IDEA-065: the Deep Forest theme's props, rebuilt from references.
//
// Lives outside board.ts for the reason gardenProps.ts does, and follows its
// five carried-over rules verbatim (read its header): the silhouette is the
// identity and it is MEASURED, a hole needs dark behind it, every factory
// owns its materials, stable child order with every part named, and a prop is
// seen at ~25px per tile so nothing under a couple of pixels is detail.
//
// WHAT THIS THEME NEEDED, AND IT IS NOT WHAT THE GARDEN NEEDED. The garden's
// problem was that every plant in the game was a SPHERE (foliage.ts's own
// header). The forest's is the same defect one shape along: every CONIFER in
// this game is a smooth cone — `makePine` in board.ts is three stacked
// `ConeGeometry`s, and the forest board is thirty-nine of them. Measured on
// the reference (`scripts/_scratch-pine-profile.mjs`), a real cartoon pine's
// half-width oscillates with a standard deviation of **0.092 of its maximum**
// as you run down it, in **9 tiers** at a period of 0.092 of its height, with
// a needle sawtooth on top of that reaching 0.09 of the half-width. A cone
// measures 0.0 on both. That is the whole difference between "a pine" and "a
// green traffic cone", and colour cannot close it any more than it could for
// the shrub.
import * as THREE from "three";
import type { PropParams } from "../game/props";
import { toon } from "./toon";
import { flaredTrunkProfile, lobedFoliageGeometry, trunkGeometry } from "./foliage";
import { mergeGrouped } from "./propMerge";

/** Deterministic per-instance variation, seeded from the placement hash so a
 *  given prop looks the same on every device and every rebuild. Same
 *  generator gardenProps.ts uses — duplicated rather than exported from
 *  there because a sculpt module should not depend on a sibling sculpt
 *  module for a four-line PRNG. */
function rand(h: number): () => number {
  let a = ((h * 4294967296) | 0) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A squashed sphere — shared with forestCritters.ts's own copy for the same
 *  reason the PRNG is duplicated: a sculpt module should not depend on a
 *  sibling sculpt module for four lines. */
function blob(rx: number, ry: number, rz: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 10, 8);
  g.scale(rx, ry, rz);
  return g;
}

/** A named mesh, so IDEA-033's part editor and the outliner have something to
 *  address — gardenProps.ts rule 4. */
function part(
  geo: THREE.BufferGeometry,
  mat: THREE.Material | THREE.Material[],
  name: string,
  parent: THREE.Object3D,
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.name = name;
  m.castShadow = true;
  parent.add(m);
  return m;
}

// ---------------------------------------------------------------------------
// 1. THE WHORL — the primitive the whole conifer is made of.
//
// A conifer's branches grow in rings (whorls) that sweep OUT from the trunk
// and DROOP at the tip. What the eye reads from twenty metres away is not the
// branches; it is the stack of drooping skirts they make, each one's rim
// hanging below the one above and each rim broken into needle tufts.
//
// So a whorl here is a solid ring of revolution whose CROSS-SECTION carries
// the droop (out and down to a tip, then back in underneath) and whose
// CIRCUMFERENCE carries the serration. Three things are load-bearing:
//
//  - THE SERRATION SCALES WITH DISTANCE FROM THE HUB. Applied flat it moves
//    the attach point off the trunk too, and the whorl separates from the
//    tree it is supposed to be growing out of.
//  - THE TWO FACES ARE SEPARATE MATERIAL GROUPS, assigned by PROFILE-RING
//    index and never by a triangle's own height (IDEA-055 rule 3 — classify
//    by ring or the band edge zigzags around the circumference). The upper
//    run takes the lit green and the underside the dark one, which is
//    wallTexture.ts's drawHedge logic in geometry: foliage reads as foliage
//    largely through lit leaves sitting on a shadowed interior.
//  - THE PROFILE IS CLOSED. An open shell is invisible from below, which the
//    game camera never is — but the shop stage and the menu vignette are, and
//    a skirt you can see the inside of reads as a broken umbrella.
// ---------------------------------------------------------------------------

/** How much of the cross-section is built. 2 is the hero's: a convex shoulder
 *  and a sagging lower lip. 1 and 0 drop rings for the distant band, where a
 *  whorl is seven pixels of skirt and a shoulder is a third of one. */
export type WhorlDetail = 0 | 1 | 2;

/** Cross-section of one whorl, in the whorl's own local frame: `x` is the
 *  radius out from the trunk, `y` is height relative to the attach point
 *  (so every value here is zero or negative — a whorl hangs). Runs
 *  clockwise from the hub over the TOP to the drooping tip, then back under
 *  to the hub, and closes.
 *
 *  `litStrips` is how many of the revolved STRIPS belong to the lit upper
 *  surface; the rest are the shaded underside. It is a strip count rather
 *  than a point count because the rim face — the strip running from the tip
 *  back under — belongs with the TOP on the hero profile and with the
 *  UNDERSIDE once the lower run is down to a single ring. Counting points
 *  and comparing against the strip index happened to agree at detail 2 and
 *  silently classified every strip as lit at the reduced detents, which is a
 *  tree with no shaded side at all. */
function whorlProfile(
  hub: number,
  reach: number,
  droop: number,
  thickness: number,
  detail: WhorlDetail = 2,
): { pts: Array<readonly [number, number]>; litStrips: number } {
  // The upper surface is slightly CONVEX: a branch leaves the trunk close to
  // horizontal and only bends down under its own weight toward the tip. A
  // straight line from hub to tip gives a paper cone and loses the shoulder
  // the light sits on — but only slightly, because a strongly domed top turns
  // every whorl into a mushroom cap and the stack into a pile of them, which
  // is what review round three came back with.
  const upper: Array<readonly [number, number]> =
    detail === 2
      ? [
          [hub, 0],
          [hub + reach * 0.30, -droop * 0.13],
          [hub + reach * 0.62, -droop * 0.38],
          [hub + reach * 0.86, -droop * 0.70],
          [hub + reach, -droop],
        ]
      : detail === 1
        ? [
            [hub, 0],
            [hub + reach * 0.62, -droop * 0.38],
            [hub + reach, -droop],
          ]
        : [
            [hub, 0],
            [hub + reach, -droop],
          ];
  // The underside runs back in BELOW the upper one, converging at the tip so
  // the rim comes to an edge rather than a slab. It sags a little more than
  // the top, which is what gives the skirt a visible lower lip. Reduced, it
  // is one ring: a plain cone back to the hub, which is all a dark side needs
  // to be when it is four pixels of it.
  const lower: Array<readonly [number, number]> =
    detail === 2
      ? [
          [hub + reach * 0.55, -droop * 0.30 - thickness],
          [hub, -thickness],
        ]
      : [[hub, -thickness]];
  return {
    pts: [...upper, ...lower],
    litStrips: detail === 2 ? upper.length : upper.length - 1,
  };
}

/**
 * Revolve a whorl profile with an angular serration, as ONE indexed geometry
 * carrying two material groups (0 = lit upper surface, 1 = shaded underside).
 *
 * `teeth` is the needle-tuft count around the rim and `serration` their depth
 * as a fraction of the reach. `phase` rotates the tooth pattern so stacked
 * whorls do not line their notches up into vertical grooves — which reads as
 * a fluted column, not a tree.
 */
function whorlGeometry(
  profile: ReturnType<typeof whorlProfile>,
  segments: number,
  teeth: number,
  serration: number,
  phase: number,
  closed = true,
): THREE.BufferGeometry {
  const { pts, litStrips } = profile;
  const rings = pts.length;
  const hubR = pts[0][0];
  const tipR = Math.max(...pts.map((p) => p[0]));
  const span = Math.max(...pts.map((p) => p[1])) - Math.min(...pts.map((p) => p[1]));
  const pos: number[] = [];
  const idx: number[] = [];

  for (let s = 0; s <= segments; s++) {
    const a = (s / segments) * Math.PI * 2;
    // TWO harmonics, and the second one is not decoration.
    //
    // A single fine cosine gives a circle with a crinkled edge, and a circle
    // with a crinkled edge stacked six times is six SAUCERS — which is what
    // the second review round came back with. A real whorl is a handful of
    // branch CLUSTERS at discrete angles, so its plan view is an irregular
    // star, not a disc. The low term (three lobes) is those clusters and the
    // high term is the needles on them; together they are `foliage.ts`'s
    // lobed-sphere argument applied to a ring instead of a ball.
    const tooth = Math.cos(teeth * a + phase) * 0.62 + Math.cos(3 * a + phase * 2.7) * 0.5;
    for (let i = 0; i < rings; i++) {
      const [r, y] = pts[i];
      // Scale the serration by how far OUT this ring sits: zero at the hub,
      // full at the rim. Applied flat it would waggle the attach point off
      // the trunk.
      const f = tipR > hubR ? (r - hubR) / (tipR - hubR) : 0;
      const rr = r + tooth * serration * tipR * f;
      // A tooth that only moves IN AND OUT is a crinkled disc. A branch tip
      // that reaches further also hangs LOWER, so the same tooth drives Y —
      // which is what turns the rim from pie crust into branch ends. Only
      // the outer rings move, for the hub reason above, and only a LITTLE:
      // at 0.85 of the span the teeth became pendulous lobes and the rim
      // read as a scalloped valance rather than as branch ends.
      const yy = y + tooth * serration * span * 0.3 * f;
      pos.push(Math.cos(a) * rr, yy, Math.sin(a) * rr);
    }
  }

  // Quads between consecutive azimuth columns, one strip per profile segment.
  // The group a strip belongs to is decided by its RING index — see the
  // header note.
  //
  // `closed` wraps the last ring back to the first, sealing the section into
  // a solid. An OPEN profile (the spire, which starts at a point and ends at
  // an open base) must not: the wrap strip would run diagonally from the base
  // rim back up to the tip, building a second cone INSIDE the first and
  // showing as dark slots through the base.
  const upperStrips: number[] = [];
  const lowerStrips: number[] = [];
  const strips = closed ? rings : rings - 1;
  for (let s = 0; s < segments; s++) {
    const c0 = s * rings;
    const c1 = (s + 1) * rings;
    for (let i = 0; i < strips; i++) {
      const j = (i + 1) % rings;
      const tri = [c0 + i, c1 + i, c1 + j, c0 + i, c1 + j, c0 + j];
      // `litStrips` strips from the hub are the lit top; the rest are the
      // shaded underside. See whorlProfile for why this is counted in STRIPS.
      (i < litStrips ? upperStrips : lowerStrips).push(...tri);
    }
  }
  idx.push(...upperStrips, ...lowerStrips);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  // Only non-empty groups: the spire is all-upper, and a zero-count group is
  // a material slot that renders nothing while still looking, in the editor's
  // outliner, like a part that has gone missing.
  if (upperStrips.length) geo.addGroup(0, upperStrips.length, 0);
  if (lowerStrips.length) geo.addGroup(upperStrips.length, lowerStrips.length, 1);
  geo.computeVertexNormals();
  return geo;
}

// ---------------------------------------------------------------------------
// 2. THE PINE — .img2threejs/reference/props/pine/image.png
//
// MEASURED (scripts/_scratch-pine-profile.mjs over the tree band only; the
// reference's ground shadow is non-white and reads as the widest part of the
// tree if you let it into the box):
//
//   aspect                 0.718 wide over tall
//   widest at              0.813 of the height DOWN from the tip — the
//                          bottom whorl tucks back IN (trend 0.770 -> 0.742)
//   tier count             9, period 0.092 of the height
//   tier amplitude         sd 0.092 of the max half-width
//   serration              sd 0.025, peaks at 0.09 of the half-width
//   half-width trend       0.144 0.195 0.257 0.366 0.466 0.560 0.655
//                          0.747 0.770 0.761 0.742   (tip -> base)
//   greens                 0x1b482a 0x285835 0x34683a 0x3d7443 0x437946
//                          0x498549 0x599755, and a 0x74b45d highlight
//   trunk                  0x7a6142, and barely there — a stub under the
//                          bottom skirt, no more than a twelfth of the width
//
// TWO DEPARTURES FROM THE MEASUREMENT, both for the same reason the burger's
// bun is not 63% of its stack and the garden sunflower has 16 petals against
// a measured 20: the reference is a hero render 200px wide and a pine on the
// apron is about 25px. Nine tiers over ~35px of height is four pixels a tier,
// and fourteen teeth around a 25px-wide tree is under two pixels a tooth —
// both below the cartoon rule's floor, where they stop being structure and
// become grain. So the default is SIX whorls and TEN teeth, and the count is
// a `segments` param so a hero placement can take more.
//
// The trend is the other thing worth reading: it is NOT a straight cone. The
// increments run 0.051, 0.062, 0.109, 0.100, 0.094, 0.095, 0.092 — i.e. the
// top fifth is markedly narrower than a straight taper would put it, and the
// bottom is essentially parallel. That is why the spire is its own piece.
// ---------------------------------------------------------------------------

/** The measured half-width trend, tip (t=0) to base (t=1), normalised to the
 *  maximum. Sampled at 11 points; `coniferRadius` interpolates. */
const PINE_TREND = [0.144, 0.195, 0.257, 0.366, 0.466, 0.56, 0.655, 0.747, 0.77, 0.761, 0.742] as const;

function coniferRadius(tFromTip: number): number {
  const t = THREE.MathUtils.clamp(tFromTip, 0, 1) * (PINE_TREND.length - 1);
  const i = Math.min(PINE_TREND.length - 2, Math.floor(t));
  return THREE.MathUtils.lerp(PINE_TREND[i], PINE_TREND[i + 1], t - i);
}

const PINE_GREENS = [0x285835, 0x2e6337, 0x24523a] as const;

/** How far a whorl's RIM stands proud of the smoothed trend, as a fraction of
 *  the max half-width.
 *
 *  This is the number that makes the tree the right shape, and getting it
 *  wrong the first time cost a whole build: `PINE_TREND` is the LOW-FREQUENCY
 *  cone, measured by smoothing the tiers away, so its peak sample is 0.77 and
 *  a tree built to it measures 0.607 wide over tall against a reference that
 *  measures 0.718. The missing 0.23 is exactly the two things the smoothing
 *  removed — the tier oscillation's own peak (~1.6 sd of the measured 0.092)
 *  plus the serration's 0.09 — and a whorl's rim IS the local maximum, so it
 *  is the rim that has to carry it. The serration adds the last 0.09 itself.
 *
 *  It is a MULTIPLIER, not an addend, and that was the second thing wrong.
 *  Added flat, a boost sized for the widest whorl is two thirds of the trend
 *  at the TOP one, so the little rings under the leader came out
 *  disproportionately broad — and a wide flat plate with a needle above it is
 *  a parasol, which is exactly what review round three showed. A tier is a
 *  proportion of the tree at that height, not a fixed amount of tree. */
const TIER_RIM = 1.195;

/** Needle tufts around a rim, and their depth as a fraction of the reach.
 *
 *  The reference's serration has sd 0.025 with peaks at 0.09 of the
 *  half-width, at a tooth pitch far finer than this. Ten teeth on a tree that
 *  is 25px wide on the apron is two and a half pixels a tooth — under the
 *  cartoon rule's floor, where a tooth stops being a shape and becomes grain.
 *  Eight is four pixels at the widest whorl, and the depth is taken to the
 *  measured PEAK rather than its sd because with fewer teeth each one has to
 *  do more work. */
const PINE_TEETH = 10;
const PINE_SERRATION = 0.085;

/** How much lighter the lit upper surface is than the def's own green, and
 *  how much darker the underside — the reference's own spread, 0x599755 over
 *  0x34683a over 0x1b482a.
 *
 *  These are LINEAR multipliers on a colour-managed `THREE.Color`, so they are
 *  much larger than the sRGB ratio they produce: x2.2 on 0x285835 lands on
 *  0x3b7b4b, not on white. Tune them by running `scripts/tmp/shift.mjs`, not
 *  by reading the number.
 *
 *  THEY ALSO DO A JOB THE REFERENCE CANNOT SEE. The forest's wall is a hedge
 *  at 0x215426 and the pine stands right against it, so a pine whose mid tone
 *  sits near the wall's is a green shape on a green shape — which is what the
 *  board came back as on the first pass: thirty-nine trees that read as a
 *  slightly bumpy hedge edge. The spread here is wider than the measurement
 *  on purpose, so the tree is a DARK mass with clearly LIT tops rather than
 *  another mid green. */
const PINE_LIT = 2.2;
const PINE_SHADE = 0.4;

function shift(color: number, k: number): number {
  const c = new THREE.Color(color);
  c.multiplyScalar(k);
  return c.getHex();
}

/**
 * THE PINE'S SHAPE, AT A BUDGET — shared by the hero prop and the surround.
 *
 * IDEA-065 v4. Nuno, after the new pine had been on the board for a while:
 * *"the deep forest theme the atmosphere are using the old pines, lets change
 * the pines that are on the space around the maze, not in the props area, the
 * ones that are illustrative, lets use the same style as the new pines we have
 * made"*. He was right and it was two conifers in one frame — a drooping
 * serrated stack on the apron and `surroundProps.ts`'s three stacked
 * `ConeGeometry`s six units behind it, i.e. exactly the green traffic cone
 * this file's own header was written to replace.
 *
 * It is ONE function rather than a second tree, for the reason rule 7 gave for
 * the stemless flower heads: the stack is six numbers that have to agree with
 * each other (whorl count, spacing exponent, droop, rim multiplier, tooth
 * pitch, spire taper), and a copy is six chances to retune one and not the
 * other. **What differs between the two call sites is RESOLUTION and nothing
 * else** — which is what every option here is.
 *
 * Returns geometry only, no materials, which is what lets `surroundProps.ts`
 * use it without breaking its own first rule (a surround builder takes the
 * shared material set and never makes one).
 */
export interface PineShapeOpts {
  /** Canopy top in world units — the tree's own height. Default 1. */
  height?: number;
  /** Half-width scale; at `width === height` the tree lands on the measured
   *  0.718 aspect. Default 1. */
  width?: number;
  /** Whorl count, clamped 4..11. Default 8.
   *
   *  THIS IS THE ONE RESOLUTION KNOB THAT IS NOT FREE TO TURN DOWN. Rule 2:
   *  the whorl spacing over a whorl's reach is 0.26 on the reference and 0.30
   *  at eight; six measures 0.40 and four 0.62, and past about 0.45 a stack of
   *  drooping skirts stops reading as one textured cone and becomes a pile of
   *  mushroom caps. Seven (0.345) is the floor the band uses. */
  whorls?: number;
  /** Needle tufts round a rim. Default PINE_TEETH. */
  teeth?: number;
  /** Their depth as a fraction of the reach. Default PINE_SERRATION. */
  serration?: number;
  /** Azimuth segments per tooth at the WIDEST whorl; narrower whorls scale
   *  down with their own reach to a floor of two.
   *
   *  TWO IS THE FLOOR AND IT IS A HARD ONE: at one segment per tooth the
   *  serration cosine is sampled once per period, every sample lands on the
   *  same phase, and the whorl comes out a REGULAR POLYGON with the serration
   *  silently doing nothing at all. Default 3. */
  segsPerTooth?: number;
  /** Cross-section detail. Default 2 (the hero's). */
  profileDetail?: WhorlDetail;
  /** Points along the leader. Default 5; three is enough at band size. */
  spirePoints?: number;
  /** Per-instance randomness — whorl phases and the per-ring tilt. */
  rnd?: () => number;
}

export interface PineShape {
  /** The whorls TOP DOWN, then the spire. Each carries group 0 = the lit
   *  upper surface and group 1 = the shaded underside, so a caller can either
   *  `mergeGrouped` them onto a two-material mesh (the hero) or split the
   *  groups into one plain geometry per material (the surround, where a
   *  material ARRAY would cost a draw call per group and defeat the band's
   *  whole merge — IDEA-067 rule 7). */
  geos: THREE.BufferGeometry[];
  /** `transforms[i]` places `geos[i]` in the tree's own frame. */
  transforms: THREE.Matrix4[];
  trunkHeight: number;
  trunkTopRadius: number;
  /** The canopy's widest half-width. The band needs it: the new silhouette is
   *  1.2x wider than the cone stack it replaces at the same height, so
   *  holding a wood's CANOPY COVERAGE constant means fewer trees. */
  maxHalfWidth: number;
}

export function pineWhorlStack(o: PineShapeOpts = {}): PineShape {
  const rnd = o.rnd ?? rand(0.37);
  const height = o.height ?? 1;
  const width = o.width ?? 1;
  const whorls = THREE.MathUtils.clamp(Math.round(o.whorls ?? 8), 4, 11);
  const teeth = Math.max(3, Math.round(o.teeth ?? PINE_TEETH));
  const serration = o.serration ?? PINE_SERRATION;
  const segsPerTooth = THREE.MathUtils.clamp(Math.round(o.segsPerTooth ?? 3), 2, 4);
  const detail = o.profileDetail ?? 2;

  const maxHalf = 0.359 * width; // from the measured 0.718 aspect
  const trunkH = 0.14 * height;
  const canopyTop = 1.0 * height;

  // Whorl attach heights, as a fraction DOWN from the tip. Above 0.2 is the
  // spire's business; 0.94 is as low as an attach can go before its own
  // droop pushes the rim underground.
  const tTop = 0.15;
  const tBottom = 0.94;
  // Whorls are NOT evenly spaced. A conifer's youngest growth is at the top
  // and its rings are closest together there; spreading them evenly leaves a
  // long bare shaft under the leader, and the spire then reads as a needle
  // stuck through a flying saucer — the loudest defect in review round two.
  // An exponent above 1 crowds the early steps.
  const tAt = (i: number) => tTop + Math.pow(i / (whorls - 1), 1.35) * (tBottom - tTop);
  // Local spacing, because the spacing is no longer uniform: a whorl's droop
  // has to clear the attach BELOW IT, and near the top that is much closer.
  const spacingAt = (i: number) => (i < whorls - 1 ? tAt(i + 1) - tAt(i) : tAt(i) - tAt(i - 1));
  // Droop, in whorl-spacings, and the number that decides whether this is a
  // tree or a fir cone. It has been wrong in BOTH directions. At 1.5 the
  // skirts did not reach the attach below them and the stack showed sky
  // between every tier — a pagoda. At 2.1 they reached far past it and every
  // whorl became a deep half-dome, which stacks into a fir CONE.
  //
  // 1.25 is right because of what actually fills the gap, and it is not the
  // droop: between one rim and the next you are looking at the TOP SURFACE of
  // the whorl below, which is wider (the radius grows all the way down) and
  // is the lit band the reference draws above every dark serrated edge. The
  // droop only has to clear the next attach, not reach the one after it.
  const DROOP_SPACINGS = 1.25;
  const droopFrac = (i: number) =>
    spacingAt(i) * DROOP_SPACINGS * THREE.MathUtils.lerp(0.6, 1, tAt(i));
  // THE BOTTOM WHORL'S TIP IS WHAT SETS THE TREE'S FOOTING, not its attach
  // height — a skirt hangs, so placing the lowest ATTACH at the trunk top
  // buries the whole rim in the soil. Solve the canopy's vertical span so the
  // deepest tip lands just clear of y=0 instead.
  const FOOT = 0.075;
  const canopySpan = (canopyTop - FOOT * height) / (tBottom + droopFrac(whorls - 1));

  // Every whorl plus the spire, built TOP DOWN — `mergeGrouped` is
  // order-sensitive and a canopy assembled bottom-up would put the spire's
  // triangles first.
  const geos: THREE.BufferGeometry[] = [];
  const transforms: THREE.Matrix4[] = [];
  const e = new THREE.Euler();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < whorls; i++) {
    const t = tAt(i);
    const reach = maxHalf * coniferRadius(t) * TIER_RIM;
    const y = canopyTop - t * canopySpan;
    const prof = whorlProfile(
      0.016 * width,
      reach,
      droopFrac(i) * canopySpan,
      0.045 * canopySpan,
      detail,
    );
    // Azimuth resolution follows the whorl's own REACH. The top ring is a
    // third of the bottom one's width and gets a third of the vertices; a
    // flat 32 everywhere spends half the tree's triangle budget on the part
    // of it that is four pixels across. Kept a multiple of the tooth count so
    // every tooth gets the same number of segments — below two the tooth
    // stops existing at all (see `segsPerTooth`).
    const segs =
      teeth *
      THREE.MathUtils.clamp(Math.round((reach / maxHalf) * segsPerTooth), 2, segsPerTooth);
    // OPEN, not closed. The closing strip runs from the underside's hub back
    // to the top's, which is a cylinder of radius 0.016 buried inside the
    // trunk with the whorl above sitting on it — a seventh of every whorl's
    // triangles spent on something no camera can reach. With thirty-five
    // pines on the board that seventh is ten thousand triangles.
    geos.push(whorlGeometry(prof, segs, teeth, serration, rnd() * Math.PI * 2, false));
    // A whorl is not perfectly level. A degree or two of tilt, different per
    // ring, is what stops the stack reading as a lathe of one profile — which
    // is exactly what a wedding cake is.
    e.set((rnd() - 0.5) * 0.11, 0, (rnd() - 0.5) * 0.11);
    transforms.push(new THREE.Matrix4().compose(new THREE.Vector3(0, y, 0), q.setFromEuler(e), one));
  }

  // --- the spire. The leader shoots above the top whorl, thin and pointed,
  // and the measured trend says the top fifth is markedly narrower than a
  // straight taper — so it is its own piece rather than one more whorl.
  // Serrated on the same tooth count so its outline belongs to the same tree,
  // and OPEN at the base (see whorlGeometry's `closed`): the base sits inside
  // the top whorl, where nothing can look into it.
  //
  // Authored rather than sampled off `coniferRadius`, because the trend's
  // first sample is 0.144 and a spire that starts at 0.144 of the max
  // half-width is a chimney, not a point. It rushes outward late, which is
  // what the measured increments (0.051, 0.062, then 0.109) describe.
  const spireLen = (tTop + 0.04) * canopySpan;
  const spireBaseR = maxHalf * coniferRadius(tTop + 0.04) * TIER_RIM * 0.85;
  const spireSteps = Math.max(2, Math.round(o.spirePoints ?? 5) - 1);
  const spirePts: Array<readonly [number, number]> = [];
  for (let k = 0; k <= spireSteps; k++) {
    const u = k / spireSteps;
    // `u^0.55` forces a real POINT at the tip. Authored with a near-zero
    // radius for its whole top third the first time, the leader rendered as a
    // WIRE; the reference's is a tuft.
    spirePts.push([spireBaseR * Math.pow(u, 0.55), -u * spireLen] as const);
  }
  geos.push(
    whorlGeometry(
      { pts: spirePts, litStrips: spirePts.length },
      teeth * 2,
      teeth,
      serration * 0.9,
      rnd() * Math.PI * 2,
      false,
    ),
  );
  transforms.push(new THREE.Matrix4().makeTranslation(0, canopyTop, 0));

  return {
    geos,
    transforms,
    trunkHeight: trunkH,
    trunkTopRadius: 0.034 * width,
    maxHalfWidth: maxHalf * TIER_RIM * Math.max(...PINE_TREND),
  };
}

/**
 * pine — a stack of drooping, serrated whorls on a stubby flared trunk.
 *
 *  - `params.foliageColors` (default the measured mid greens) — the base
 *    green; the lit and shaded tones are derived from it, so a theme that
 *    retints the forest keeps the three-tone relationship instead of having
 *    to author three numbers that agree.
 *  - `params.segments` (default 8, clamped 4-11) — the WHORL count.
 *  - `params.height` / `params.width` (default 1) scale the canopy and its
 *    radius independently, so one def can be a spindly sapling and another
 *    a broad old tree.
 *  - `params.trunkColor` (default the measured 0x7a6142).
 *
 * `h` is the 0..1 instance hash: it picks the base green, the whorl phases
 * and a small per-tree lean, so a row of twenty is not twenty copies.
 *
 * The SHAPE lives in `pineWhorlStack`, which the surround's distant conifer
 * shares; everything below is this prop's own colour and assembly.
 */
export function makeForestPine(params: PropParams, h: number): THREE.Group {
  const g = new THREE.Group();
  const rnd = rand(h);
  const colors = params.foliageColors ?? PINE_GREENS;
  const base = colors[Math.floor(h * colors.length) % colors.length];

  // One material pair for the whole tree. Both are owned by this group and
  // disposed with it (rule 3) — never a module-level singleton.
  const litMat = toon({ color: shift(base, PINE_LIT) });
  const darkMat = toon({ color: shift(base, PINE_SHADE) });
  const mats = [litMat, darkMat];

  const shape = pineWhorlStack({
    height: params.height ?? 1,
    width: params.width ?? 1,
    whorls: params.segments ?? 8,
    rnd,
  });

  // --- 0: trunk. Short, flared, and mostly buried. It is here for the few
  // pixels of warm brown under the bottom skirt: without it the tree sits on
  // the soil like a cut-out, which is the one thing a cone at least got right.
  part(
    trunkGeometry(flaredTrunkProfile(shape.trunkTopRadius, shape.trunkHeight, 2.4, 5), 8),
    toon({ color: params.trunkColor ?? 0x7a6142 }),
    "trunk",
    g,
  );

  // --- 1: the canopy. Every whorl plus the spire in ONE merged geometry
  // carrying the same two material groups — see `mergeGrouped` for the
  // measured reason, which is that thirty-nine pines at a mesh per whorl cost
  // more draw calls than the whole rest of the board put together.
  part(mergeGrouped(shape.geos, mats, shape.transforms), mats, "canopy", g);

  return g;
}

// ---------------------------------------------------------------------------
// 3. SHARED MACHINERY — merging, and the log course.
// ---------------------------------------------------------------------------

/**
 * Concatenates a list of geometries into one non-indexed soup.
 *
 * Hand-rolled rather than pulled from `BufferGeometryUtils` for the reason
 * `fence.ts` states for its own copy: this project imports from `three` and
 * nothing else, and the addon would be the only exception. Keeps `position`
 * and `normal`, which is everything a prop needs — nothing here carries a map.
 *
 * It exists because a log cabin is thirty-six logs and four corner stacks, and
 * a mesh apiece is thirty-six draw calls for a prop that should cost one or
 * two.
 */
function mergeParts(geos: readonly THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of flat) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of flat) {
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    nor.set(g.attributes.normal.array as Float32Array, o * 3);
    o += g.attributes.position.count;
  }
  for (const g of geos) g.dispose();
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  out.computeBoundingSphere();
  return out;
}


/** A horizontal log lying against a wall face: a cylinder of length `len`
 *  along `axis`, centred at `(x, y, z)`, open-ended because the ends are
 *  either buried in the next wall or capped by a corner log-end. */
function logBar(
  len: number,
  radius: number,
  axis: "x" | "z",
  x: number,
  y: number,
  z: number,
): THREE.BufferGeometry {
  // NINE SIDES, NOT SEVEN (v5). A seven-sided bar has a flat facet almost
  // exactly where the light hits it, so a wall of them banded into visible
  // vertical panels rather than reading as a stack of round logs — much more
  // obvious in a matcap, which takes its whole value from the normal, than in
  // the three-step ramp this was tuned against. Thirty-odd bars at two
  // triangles each is ~130 triangles for the thing the prop is named after.
  const g = new THREE.CylinderGeometry(radius, radius, len, 9, 1, true);
  g.rotateZ(axis === "x" ? Math.PI / 2 : 0);
  if (axis === "z") g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

/** A short log seen END ON: a closed cylinder standing proud of a corner.
 *  `capSign` says which way the visible cut face points, so only that end
 *  gets a cap — the other is buried in the wall and a cap there is two
 *  hundred triangles nobody will ever see across a cabin. */
function cappedLog(
  radius: number,
  len: number,
  axis: "x" | "z",
  x: number,
  y: number,
  z: number,
  capSign: number,
): THREE.BufferGeometry {
  // TEN, because this one is seen END ON: the cut face is identity rank 1 and
  // a seven-gon reads as a bolt head rather than as a sawn log at the shop
  // stage. On the board it is three pixels and the count is free either way.
  const g = new THREE.CylinderGeometry(radius, radius, len, 10, 1, false);
  g.rotateZ(axis === "x" ? Math.PI / 2 : 0);
  if (axis === "z") g.rotateX(Math.PI / 2);
  const off = (len / 2) * Math.sign(capSign || 1);
  g.translate(x + (axis === "x" ? off : 0), y, z + (axis === "z" ? off : 0));
  return g;
}

// ---------------------------------------------------------------------------
// 4. THE LOG CABIN — .img2threejs/reference/props/cabine/image.png
//
// Proportion base GH = the cabin's overall HEIGHT (foundation to ridge),
// because that is the one dimension a three-quarter product render does not
// foreshorten. Measured: 274 x 207 px, 1.32 WIDE OVER TALL, with the log wall
// taking the bottom 0.41 of the height and the gable the rest.
//
// WHAT MAKES IT A LOG CABIN RATHER THAN A HOUSE, in rank order off the
// reference — and the order matters, because the last two do not survive the
// apron and the first two must:
//   1. THE CORNER LOG ENDS. A vertical column of pale cut circles standing
//      proud of every corner. Nothing else in this prop library has them, and
//      no other building type has them at all.
//   2. HORIZONTAL COURSES. The wall is a stack of round bars, so its
//      silhouette EDGE is scalloped and its face is banded.
//   3. A steep gable with a deep overhang and a pale bargeboard.
//   4. A tall chimney standing clear of the ridge.
//   5. Windows, door and a step — three pixels each on the board, and here
//      for the shop stage and the menu vignette rather than for play.
//
// TWO THINGS THE REFERENCE CANNOT BE TRUSTED ON, both because it is an INKED
// drawing and this renderer has no outline pass:
//   - Its dominant colours BY AREA are its own KEYLINES (0x472718, 0x371708,
//     0x29140a — a quarter of the picture). Sampling "the" wall colour off a
//     histogram returns the line, not the wood, so the timber tones below are
//     point-probed off flat interiors instead.
//   - Twelve log courses is fine at the reference's 207px and is under three
//     pixels a course at the board's ~35px. Seven — the same departure the
//     pine's whorl count makes, for the same reason.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// THE CABIN'S PALETTE IS A VALUE LADDER, AND IT HAS TO SURVIVE THE SNAP
// (IDEA-065 v5).
//
// Nuno: *"now we have a new materials we should rework this to have a better
// look."* The cabin was authored in `toon()` against the OLD art direction and
// IDEA-079 now draws it as a matcap over a SNAPPED palette entry, so the
// number in this file is not the colour on screen. Measured with
// `scripts/_scratch-cabin-snap.ts`, the snap had collapsed nine authored tones
// onto four entries and taken every relationship the model depends on with
// them:
//
//   corner ends  #d6b393 -> wood    log body   #c2804e -> wood
//   trim         #d8b184 -> wood    door       #a2612f -> wood
//   roof         #6b5248 -> bark    shingles   #3b2c25 -> bark
//   foundation   #6e6a63 -> slate (a BLUE-grey plinth on a timber building)
//
// So four of the pale/mid tones became ONE, the roof's four dark joints became
// the roof, and wall-versus-roof went from 0.178 of luminance apart to 0.144 —
// two warm browns of one hue family, which at the play camera is a single
// undifferentiated mass. The corner log-ends are identity rank 1 and were the
// same colour as the wall they stand proud of.
//
// TWO THINGS ABOUT THE SNAP EXPLAIN ALL OF IT, and they generalise to any prop
// built out of one hue:
//
//  1. **IT IS HUE-DOMINANT WITH A STANDING REWARD FOR THE HIGHER KEY** (x3.0
//     on hue against 0.1 on lightness, plus 0.22 x (1 - l)). That is correct
//     and is what keeps the palette high-key — and it means a model whose
//     whole value ladder lives inside ONE hue has nothing to spread it across.
//     The warm family has exactly five rungs: cream, sand, wood, bark and
//     inkWarm. Author to those rungs and the ladder survives; author nine
//     browns and you get `wood`.
//  2. **`cream` IS IN `NEUTRAL_IDS`, SO NO WARM TAN CAN EVER REACH IT.** Every
//     pale tan from #ecd2a8 to #faf4ea lands on `sand`. A trim that must be
//     cream has to be authored as a near-GREY (s < 0.18), which on a timber
//     building reads chalky in the classic look — so the trim stays warm and
//     shares `sand` with the corner ends instead. They are never adjacent.
//
// DARK IS A DECLARED ROLE, NOT A COLOUR. `madboxRole = "ink"` is how a
// material says "this is a marking that must stay dark" (madboxStyle.ts's own
// rule — colour cannot decide it, which is why there is a tag). The roof, the
// chinking behind the logs and the plinth are exactly that: without the tag
// the palette lifts all three into the warm mid-tones and the building loses
// its roof, its courses and its footing in one pass.
// ---------------------------------------------------------------------------

/** The logs themselves — the mid rung, and the only one unchanged by v5. */
const CABIN_LOG = 0xc2804e; // -> wood

/** THE CHINKING, and it used to be `logMat`.
 *
 *  The extruded pentagon's own comment has always said it is "the DARK behind
 *  the log courses" — and it was built in the SAME material as the courses, so
 *  there was no dark behind anything. A round bar on a body of its own colour
 *  has only its shading to separate it from its neighbour, which a matcap
 *  quantises away almost entirely; the wall came back as a smooth orange slab
 *  with faint ripples. One dark material under the bars gives every course a
 *  hard line beneath it, which is what says LOGS rather than SIDING at 35px —
 *  and it costs nothing, because the body mesh already existed. */
const CABIN_CHINK = 0x5a3a26; // -> inkWarm, by role

/** The cut faces at the corners: identity rank 1, so they get their own rung
 *  ABOVE the logs. Was #d6b393, which snapped onto the logs themselves. */
const CABIN_LOG_END = 0xecd2a8; // -> sand

/** Bargeboards, ridge cap, window and door frames: the pale accents whose
 *  whole job is drawing a bright edge on a dark roof. Was #d8b184 -> wood,
 *  i.e. the same colour as the wall they were meant to separate it from. */
const CABIN_TRIM = 0xeed6ae; // -> sand

/** The roof, unchanged in classic and tagged INK so the style keeps it dark.
 *
 *  v1 lightened this from the reference's near-black slate on the grounds that
 *  "a value that dark reads as a hole in the treeline rather than as a
 *  building" — which was measured against the OLD board. IDEA-079 lifts the
 *  forest's floor and wall into the high-key range, so the field this sits
 *  against is far brighter now and a dark roof reads as a roof. It is also the
 *  only way to get the reference's own relationship back: a dark lid over warm
 *  logs. */
const CABIN_ROOF = 0x6b5248; // -> inkWarm, by role

/** The shingle joints, INVERTED by v5 — they are lighter than the roof now.
 *
 *  v1's note stands and is the reason this is a careful change: built at 0.2
 *  of the slope in the pale TRIM colour they covered four fifths of the roof
 *  and turned it into a pale planked lid with dark lines. What makes this
 *  different is that they are still THIN (0.055 of the slope) and only one
 *  rung up — a shingle course catching light on its lower edge, not a plank.
 *  Dark-on-dark was the only option while the roof was a mid tone; on an ink
 *  roof it is invisible. */
const CABIN_SHINGLE = 0x9a7050; // -> bark

/** The plinth and the chimney cap. Was #6e6a63, a warm grey — and a warm grey
 *  has s < NEUTRAL_MAX_S, so the snap matched it against the NEUTRALS only and
 *  the only mid neutral in the palette is `slate`, a blue-grey. The building
 *  shipped standing on a purple kerb. A plinth's job is IDEA-071's greenhouse
 *  trick — a few pixels of dark under a lighter mass — so it is ink. */
const CABIN_BASE = 0x45403a; // -> inkWarm, by role

/** The doorstep and the door itself: timber, one rung below the walls so the
 *  opening reads as an opening. The door was #a2612f -> wood, i.e. invisible
 *  against its own wall. */
const CABIN_STEP = 0x9a7050; // -> bark
const CABIN_DOOR = 0x8a5330; // -> bark

/**
 * logCabin — a gabled log cabin with corner log-ends, a chimney and a step.
 *
 *  - `params.trunkColor` (default the measured 0xc2804e) — the log timber.
 *  - `params.roofColor` (default 0x4a3a33) — roof slabs and chimney.
 *  - `params.windowColor` + `params.windowEmissiveIntensity` — the panes. A
 *    cabin with lit windows is a different prop from a dark one, and the
 *    theme should own which.
 *  - `params.height` / `params.width` scale the whole thing; the PROPORTIONS
 *    are fixed, because a cabin half as wide is a different building.
 *  - `params.segments` (default 7, clamped 4-12) — the log COURSE count.
 *
 * The ridge runs along Z, so the gable ends face +Z and -Z: at `rotationY: 0`
 * the game camera looks straight at a gable end, and a placement turns it to
 * the three-quarter the reference is drawn at.
 */
export function makeLogCabin(params: PropParams, h: number): THREE.Group {
  const g = new THREE.Group();
  const rnd = rand(h);
  const H = params.height ?? 1;
  const W = params.width ?? 1;
  const courses = THREE.MathUtils.clamp(Math.round(params.segments ?? 7), 4, 12);

  const logMat = toon({ color: params.trunkColor ?? CABIN_LOG });
  const endMat = toon({ color: CABIN_LOG_END });
  const roofMat = toon({ color: params.roofColor ?? CABIN_ROOF });
  const trimMat = toon({ color: CABIN_TRIM });
  const shingleMat = toon({ color: CABIN_SHINGLE });
  const stepMat = toon({ color: CABIN_STEP });
  const doorMat = toon({ color: CABIN_DOOR });
  const chinkMat = toon({ color: CABIN_CHINK });
  const baseMat = toon({ color: CABIN_BASE });
  // THE THREE THAT MUST STAY DARK SAY SO. See the palette note above: without
  // the tag the style lifts all three into the warm mid-tones, and the cabin
  // loses its roof, its chinking and its footing in one pass. `madboxRole`
  // lives on the MATERIAL, so it survives `applyPropParts`, the editor's part
  // tree and `collapseByMaterial` alike — none of which know what a roof is.
  for (const m of [roofMat, chinkMat, baseMat]) m.userData.madboxRole = "ink";

  // The box, in units of the cabin's own height.
  const bodyW = 0.7 * W; // gable-end width (X)
  const bodyL = 0.92 * W; // ridge length (Z)
  const footY = 0.055 * H; // foundation top
  const wallTop = 0.44 * H;
  // A SHALLOWER pitch than the reference's, for the ridge board's reason: the
  // steeper the roof, the more of it the play camera sees and the less of the
  // log wall that is the whole identity. 0.82 against a measured ~0.9.
  const ridge = 0.76 * H;
  const halfW = bodyW / 2;
  const halfL = bodyL / 2;
  const courseH = (wallTop - footY) / courses;
  const logR = courseH * 0.62;

  // --- 0: the foundation. A grey plinth a little wider than the walls.
  // Without it the bottom log sits half-buried in the soil, which is what the
  // reference's own stone course is there to prevent.
  const found = part(new THREE.BoxGeometry(bodyW * 1.06, footY, bodyL * 1.05), baseMat, "foundation", g);
  found.position.y = footY / 2;

  // --- 1: the body. ONE extruded pentagon — rectangle plus gable triangle —
  // so both gable ends and both long walls come from a single outline and can
  // never disagree about where the wall top is. It is the DARK behind the log
  // courses as much as it is the building: bars standing proud of nothing read
  // as a stack of loose poles.
  const houseShape = new THREE.Shape();
  houseShape.moveTo(-halfW, footY);
  houseShape.lineTo(halfW, footY);
  houseShape.lineTo(halfW, wallTop);
  houseShape.lineTo(0, ridge);
  houseShape.lineTo(-halfW, wallTop);
  houseShape.closePath();
  const bodyGeo = new THREE.ExtrudeGeometry(houseShape, {
    depth: bodyL,
    bevelEnabled: false, // IDEA-057 rule 4: the bevel grows OUTWARD.
    curveSegments: 1,
  });
  bodyGeo.translate(0, 0, -halfL);
  part(bodyGeo, chinkMat, "body", g);

  // --- 2: the log courses. Every wall's bars in ONE merged mesh — thirty-odd
  // draw calls is not what a prop should cost.
  //
  // The GABLE ENDS carry courses too, and they shorten as they climb the
  // triangle. That is the half of the identity a plain banded box loses.
  const bars: THREE.BufferGeometry[] = [];
  for (let i = 0; i < courses; i++) {
    const y = footY + (i + 0.5) * courseH;
    bars.push(logBar(bodyL, logR, "z", halfW, y, 0));
    bars.push(logBar(bodyL, logR, "z", -halfW, y, 0));
    bars.push(logBar(bodyW, logR, "x", 0, y, halfL));
    bars.push(logBar(bodyW, logR, "x", 0, y, -halfL));
  }
  const gableCourses = Math.max(2, Math.round((ridge - wallTop) / courseH) - 1);
  for (let i = 0; i < gableCourses; i++) {
    const y = wallTop + (i + 0.5) * courseH;
    const len = bodyW * (1 - (y - wallTop) / (ridge - wallTop));
    if (len < logR * 2) continue;
    bars.push(logBar(len, logR, "x", 0, y, halfL));
    bars.push(logBar(len, logR, "x", 0, y, -halfL));
  }
  part(mergeParts(bars), logMat, "courses", g);

  // --- 3: the corner log-ends. Identity rank 1, and the one thing here that
  // must survive the apron: a column of pale cut circles at every corner.
  // They are CLOSED cylinders (the courses are open-ended) and they stand
  // PROUD of the corner; flush, they would be four pale stripes.
  //
  // Which axis pokes out ALTERNATES course by course, as a real corner notch
  // does. Built both ways on the same course the corner reads as a lump;
  // alternating gives it the woven look for free.
  const ends: THREE.BufferGeometry[] = [];
  // How far past the corner a cut end stands. The log STARTS inside the wall
  // and runs outward, so this is a length, not an offset — set as an offset
  // the first time, every end floated clear of the building it belongs to.
  const over = logR * 1.9;
  for (let i = 0; i < courses; i++) {
    const y = footY + (i + 0.5) * courseH;
    const alongX = i % 2 === 0;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        ends.push(
          alongX
            ? cappedLog(logR, over * 2, "x", sx * (halfW - logR * 1.1), y, sz * halfL, sx)
            : cappedLog(logR, over * 2, "z", sx * halfW, y, sz * (halfL - logR * 1.1), sz),
        );
      }
    }
  }
  part(mergeParts(ends), endMat, "cornerEnds", g);

  // --- 4/5: the roof. Two slabs whose planes CONTAIN the gable's own sloped
  // edges, so the pediment gap gardenProps.ts's `gableFillGeometry` exists to
  // close cannot open here: the roof is not sitting ABOVE the wall top, it is
  // sitting ON the line from the wall corner to the ridge, and the overhang is
  // that same line continued past the corner.
  const slope = (ridge - wallTop) / halfW;
  const eaveOut = halfW * 0.34;
  const run = halfW + eaveOut;
  const slabLen = Math.hypot(run, run * slope);
  const slabT = 0.035 * H;
  const roofZ = bodyL + 0.14 * W;
  for (const s of [-1, 1]) {
    const slab = part(new THREE.BoxGeometry(slabLen, slabT, roofZ), roofMat, s < 0 ? "roofL" : "roofR", g);
    // NEGATIVE s: a rotation about +Z takes +X toward +Y, so the right-hand
    // slab needs a negative angle to fall away to the right. Signed the other
    // way the two slabs meet in a V and the cabin renders as an open book —
    // which is exactly what review round one showed.
    slab.rotation.z = -s * Math.atan(slope);
    slab.position.set((s * run) / 2, (ridge + (wallTop - eaveOut * slope)) / 2 + slabT * 0.5, 0);

    // SHINGLE COURSES, and the reason they exist is the CAMERA rather than
    // the reference. The reference is a three-quarter view from ground level,
    // where the log wall is most of the building. The game looks DOWN at 59
    // degrees: a vertical wall projects at cos(59) = 0.515 of its height while
    // a 45-degree roof projects at very nearly its full area, AND this prop
    // stands on the north apron where the hedge hides everything below
    // y = 0.382 — which is most of the wall. So from the one camera that
    // matters the roof IS the cabin, and two plain dark slabs meeting in a
    // line are a brown wedge.
    //
    // Four stepped courses in a lighter tone, children of the slab so they
    // inherit its pitch rather than needing the angle typed twice.
    // FIVE, THINNER AND LOWER THAN v1's FOUR (v5). With the roof on ink the
    // courses are a whole rung lighter than the field they sit on instead of
    // a whole rung darker, so the same geometry reads far louder: at the play
    // camera four wide proud battens made the roof CORRUGATED rather than
    // shingled. They are children of the slab, so this count is free of the
    // def's saved part edits, which address root indices only.
    const SHINGLE_COURSES = 5;
    for (let i = 0; i < SHINGLE_COURSES; i++) {
      const along = -slabLen / 2 + (slabLen * (i + 0.55)) / SHINGLE_COURSES;
      // THIN AND DARK — a shadow GAP between courses, not a plank laid on
      // top of one. Built at 0.2 of the slope in the pale trim colour they
      // covered four fifths of the roof and inverted it: the cabin came back
      // with a pale planked lid and dark lines, where the reference is a dark
      // roof with darker joints.
      const course = part(
        new THREE.BoxGeometry(slabLen * 0.045, slabT * 0.42, roofZ * 1.006),
        shingleMat,
        "shingle" + i,
        slab,
      );
      course.position.set(along, slabT * 0.5, 0);
    }
  }

  // --- 5b: the ridge board. It is not in the reference and it is here
  // because of the CAMERA: the reference is a three-quarter view from ground
  // level, where the roof is a third of the building and the log walls carry
  // it. The game looks DOWN at 59 degrees, so the roof is most of what a
  // player sees of this prop — and two dark slabs meeting in a line is a
  // featureless wedge. A pale capping plank along the ridge gives the one
  // thing the top view has nothing of: an edge.
  const ridgeCap = part(
    new THREE.BoxGeometry(0.055 * W, 0.03 * H, bodyL + 0.15 * W),
    trimMat,
    "ridgeCap",
    g,
  );
  ridgeCap.position.set(0, ridge + 0.022 * H, 0);

  // --- 6: the bargeboard, down each rake of the FRONT gable. It is the one
  // bright line on a dark roof and it is what separates roof from wall at a
  // distance; the reference gives it nearly a tenth of the building's width.
  for (const s of [-1, 1]) {
    const bb = part(new THREE.BoxGeometry(slabLen, slabT * 0.85, 0.03 * W), trimMat, s < 0 ? "bargeL" : "bargeR", g);
    bb.rotation.z = -s * Math.atan(slope);
    bb.position.set((s * run) / 2, (ridge + (wallTop - eaveOut * slope)) / 2 + slabT * 0.1, halfL + 0.077 * W);
  }

  // --- 7: the chimney. It stands CLEAR of the ridge in the reference and must
  // here: a chimney that stops at the roofline is a bump, and a tall thin
  // column beside a triangle is half of what says "cabin" in a silhouette.
  const chimW = 0.1 * W;
  const chimX = -halfW * 0.42;
  const chimTop = ridge * 1.08;
  const chimBase = wallTop * 0.55;
  // Its OWN colour, not the roof's. The reference's chimney is brick against
  // a dark roof; built in `roofMat` it merged into the slab it stands on and
  // the one vertical event in the silhouette disappeared.
  const chim = part(
    new THREE.BoxGeometry(chimW, chimTop - chimBase, chimW),
    toon({ color: 0x6b4128 }),
    "chimney",
    g,
  );
  chim.position.set(chimX, (chimTop + chimBase) / 2, -halfL * 0.3);
  const cap = part(new THREE.BoxGeometry(chimW * 1.3, 0.035 * H, chimW * 1.3), baseMat, "chimneyCap", g);
  cap.position.set(chimX, chimTop, -halfL * 0.3);

  // --- 8..: the openings. Three pixels each on the board; they are here for
  // the shop stage. Every one is a PLATE standing proud of the wall rather
  // than a hole cut in it — IDEA-058 rule 4 says a hole needs dark behind it,
  // and behind this wall is the wall.
  //
  // THEY STAND PROUD OF THE LOG COURSES, NOT OF THE WALL PLANE. The bars are
  // round and bulge `logR` past the pentagon's own face, so a plate placed
  // against that face is behind them: the first build's door was correctly
  // built, correctly coloured, correctly placed, and entirely hidden between
  // two logs. Fourth appearance of that family in this project after the
  // nori belt (IDEA-057), the pizza's mouth floor (IDEA-058) and the burger's
  // flipped band normal (IDEA-059).
  const proud = logR + 0.012 * W;
  const glassMat = toon({
    color: params.windowColor ?? 0x8fc4e0,
    emissive: params.windowColor ?? 0x8fc4e0,
    emissiveIntensity: params.windowEmissiveIntensity ?? 0.35,
  });
  const winW = 0.13 * W;
  const winH = 0.11 * H;
  const addWindow = (x: number, y: number, z: number, faceZ: boolean, name: string) => {
    const frameGeo = faceZ
      ? new THREE.BoxGeometry(winW * 1.32, winH * 1.32, 0.02 * W)
      : new THREE.BoxGeometry(0.02 * W, winH * 1.32, winW * 1.32);
    const frame = part(frameGeo, trimMat, name + "Frame", g);
    frame.position.set(x, y, z);
    const glassGeo = faceZ
      ? new THREE.BoxGeometry(winW, winH, 0.02 * W)
      : new THREE.BoxGeometry(0.02 * W, winH, winW);
    const glass = part(glassGeo, glassMat, name, g);
    glass.position.set(
      x + (faceZ ? 0 : Math.sign(x) * 0.008 * W),
      y,
      z + (faceZ ? Math.sign(z) * 0.008 * W : 0),
    );
  };
  const wallMid = (footY + wallTop) / 2 + courseH * 0.4;
  addWindow(-bodyW * 0.29, wallMid, halfL + proud, true, "winFrontL");
  addWindow(bodyW * 0.29, wallMid, halfL + proud, true, "winFrontR");
  addWindow(0, wallTop + (ridge - wallTop) * 0.32, halfL + proud, true, "winGable");
  addWindow(halfW + proud, wallMid, -bodyL * 0.22, false, "winSide");

  // The door, on the front gable end between the two windows, with one step.
  // The step is not decoration: a door whose sill is level with the ground
  // reads as a painted panel.
  const door = part(new THREE.BoxGeometry(0.11 * W, 0.2 * H, 0.024 * W), doorMat, "door", g);
  door.position.set(0, footY + 0.1 * H, halfL + proud);
  // ITS FRAME IS A CHILD OF THE DOOR, NOT A SIBLING — and that is a data
  // constraint, not a style. Every window here has its frame as a separate
  // root child, which was fine until someone used them: the shipped def
  // carries hand-authored part edits at paths "11".."16" and "19", so the
  // door has been MOVED from where this code puts it. A sibling frame would
  // have stayed behind at the authored position while the door it frames sat
  // somewhere else — and nothing would have errored. As a child it inherits
  // the edit for free, and it adds no root-level index, which matters just as
  // much: an insert anywhere before "19" silently re-points all seven of
  // those saved edits onto different parts. **New parts go at the END of the
  // child list, or inside an existing one.**
  const doorFrame = part(
    new THREE.BoxGeometry(0.11 * W * 1.3, 0.2 * H * 1.09, 0.018 * W),
    trimMat,
    "doorFrame",
    door,
  );
  doorFrame.position.set(0, 0.2 * H * 0.03, -0.004 * W);
  const step = part(new THREE.BoxGeometry(0.17 * W, 0.035 * H, 0.07 * W), stepMat, "step", g);
  step.position.set(0, footY + 0.0175 * H, halfL + proud + 0.038 * W);

  // --- 9: the REAR gable's bargeboards, appended last for the reason above.
  //
  // The front pair has been here since v1 and the back of the building had a
  // raw roof edge, which the turntable is exactly the instrument for: a prop
  // that only works from one side. It matters here rather than being tidiness,
  // because a placement sets `rotationY` freely — the gable the player sees is
  // whichever one the author turned toward the camera — and the showcase
  // stands landmarks at a yaw aimed at the viewer. Two meshes.
  for (const s of [-1, 1]) {
    const bb = part(
      new THREE.BoxGeometry(slabLen, slabT * 0.85, 0.03 * W),
      trimMat,
      s < 0 ? "bargeRearL" : "bargeRearR",
      g,
    );
    bb.rotation.z = -s * Math.atan(slope);
    bb.position.set(
      (s * run) / 2,
      (ridge + (wallTop - eaveOut * slope)) / 2 + slabT * 0.1,
      -(halfL + 0.077 * W),
    );
  }

  // A degree of settle, so two cabins in one theme are not stamped.
  g.rotation.y = (rnd() - 0.5) * 0.06;
  return g;
}

// ---------------------------------------------------------------------------
// 5. THE NEST TREE — .img2threejs/reference/props/threewithbird/image.png
//
// A broad trunk with a HOLLOW cut into it, a woven nest sitting in the mouth
// of the hollow, and a chick looking out. Measured off the reference: the
// trunk fills the frame and the hollow is 0.46 of the trunk's width and 0.34
// of its visible height, sitting at 0.42 down from the first fork.
//
// IT IS THE THEME'S ONE HOLE, and IDEA-058 rule 4 is therefore the whole
// build: a hole is only a hole if there is DARK behind it. The garden's
// birdhouse shipped with its entrance rendering as a painted arch because the
// dark plate was buried inside the body, and gardenProps.ts's own header
// states the rule above the function that broke it. So here the hollow is a
// real RECESS — a dark cup set back into the trunk's surface with the nest in
// its mouth — and not a disc laid on the bark.
//
// The second thing the reference is built on is that the trunk FORKS. A plain
// column with a hole in it is a pipe; the two rising limbs are what make it a
// tree, and they are what carries the canopy that tells you it is alive.
// ---------------------------------------------------------------------------

/**
 * nestTree — a forked trunk with a hollow, a nest and a chick.
 *
 *  - `params.trunkColor` (default 0x7a5433) — bark.
 *  - `params.foliageColors` (default the forest greens) — the canopy.
 *  - `params.birdColor` (default 0xe8622a) + `params.showBird` (default true)
 *    — the chick. Turning it off leaves a plain hollow tree, which is a
 *    legitimate second prop rather than a broken first one.
 *  - `params.height` / `params.width` (default 1).
 */
export function makeNestTree(params: PropParams, h: number): THREE.Group {
  const g = new THREE.Group();
  const rnd = rand(h);
  const H = params.height ?? 1;
  const W = params.width ?? 1;
  const barkMat = toon({ color: params.trunkColor ?? 0x7a5433 });
  const darkMat = toon({ color: 0x21150c });
  const greens = params.foliageColors ?? [0x2e6337, 0x38703c, 0x25552e];
  const leafMat = toon({ color: greens[Math.floor(h * greens.length) % greens.length] });

  const trunkR = 0.19 * W;
  const forkY = 0.58 * H;
  const trunkH = forkY + 0.06 * H;
  const FLARE = 1.9;
  // The trunk is a LATHE with a concave root flare, so "the surface" is a
  // different radius at every height — and the first build placed the hollow,
  // the nest and the chick against `trunkR * 0.78` as though it were a
  // cylinder. At the hollow's own height the flare puts the bark at 0.208 and
  // the parts were at 0.148, so the whole assembly rendered INSIDE the tree:
  // a correctly built nest with a correctly built bird in it, entirely
  // invisible. Fifth appearance of that family in this project (the nori
  // belt, the pizza's mouth floor, the burger's flipped normal, the cabin's
  // door behind its own logs) and the first where the surface is curved.
  const barkR = (y: number) =>
    trunkR * (1 + (FLARE - 1) * Math.pow(Math.max(0, 1 - y / trunkH), 3.2));

  // --- 0: the trunk. Lathed with a root flare, for the reason foliage.ts
  // gives: a reference trunk measures four times as wide at the soil as at
  // the shoulder and a cone reads as a bollard.
  part(trunkGeometry(flaredTrunkProfile(trunkR, trunkH, FLARE, 6), 12), barkMat, "trunk", g);

  // --- 1/2: the fork. Two limbs leaning apart — the thing that makes this a
  // tree rather than a pipe with a hole in it.
  for (const s of [-1, 1]) {
    const lb = part(
      new THREE.CylinderGeometry(trunkR * 0.44, trunkR * 0.78, 0.34 * H, 9),
      barkMat,
      s < 0 ? "limbL" : "limbR",
      g,
    );
    lb.position.set(s * trunkR * 0.52, forkY + 0.15 * H, -0.02 * W);
    lb.rotation.z = -s * 0.42;
  }

  // --- 3: THE HOLLOW. A dark cup set BACK into the trunk, not a disc laid on
  // it. Its mouth sits a whisker proud of the bark so the rim cannot z-fight,
  // and its floor is a full radius behind that — which is the part the
  // birdhouse got wrong.
  const holeR = 0.105 * W;
  const holeY = 0.4 * H;
  const holeZ = barkR(holeY) * 0.92;
  const cup = part(new THREE.SphereGeometry(holeR * 1.18, 12, 8), darkMat, "hollow", g);
  cup.position.set(0, holeY, holeZ - holeR * 0.95);
  cup.scale.set(1, 1.22, 0.8);
  // A raised bark lip all round the mouth. Without it the dark cup is a
  // sticker: the trunk is a smooth lathe, so nothing marks where its surface
  // stops and the hole starts (IDEA-054 rule 3, the crab's face panel).
  const lip = part(new THREE.TorusGeometry(holeR * 1.1, holeR * 0.26, 6, 14), barkMat, "hollowLip", g);
  lip.position.set(0, holeY, holeZ - holeR * 0.1);
  lip.scale.set(1, 1.2, 1);

  // --- 4: the nest, in the MOUTH of the hollow and overhanging it. A woven
  // bowl: one torus for the rim and a cup under it.
  const nestMat = toon({ color: 0x6a4a2c });
  const nest = part(new THREE.SphereGeometry(holeR * 1.25, 12, 6, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5), nestMat, "nest", g);
  nest.position.set(0, holeY - holeR * 0.55, holeZ + holeR * 0.1);
  nest.scale.set(1.05, 0.72, 0.9);
  const rim = part(new THREE.TorusGeometry(holeR * 1.22, holeR * 0.19, 6, 14), nestMat, "nestRim", g);
  rim.position.set(0, holeY - holeR * 0.55, holeZ + holeR * 0.1);
  rim.rotation.x = Math.PI / 2;

  // --- 5..: the chick, looking out of the hollow. Only the head and the
  // shoulders: the rest is inside the tree, which is what the reference draws
  // and what makes the hollow read as deep.
  if (params.showBird ?? true) {
    const bird = new THREE.Group();
    bird.name = "chick";
    bird.position.set(0, holeY + holeR * 0.16, holeZ + holeR * 0.12);
    // The chick FILLS the hollow in the reference, and at 1.0 it sat in the
    // middle of it like a pea in a bowl. It is the only face on the prop;
    // everything else here is bark.
    bird.scale.setScalar(1.4);
    g.add(bird);
    const plume = toon({ color: params.birdColor ?? 0xe8622a });
    const chest = part(blob(holeR * 0.62, holeR * 0.52, holeR * 0.4), toon({ color: 0xf6efe2 }), "chest", bird);
    chest.position.set(0, -holeR * 0.28, holeR * 0.16);
    part(blob(holeR * 0.5, holeR * 0.46, holeR * 0.44), plume, "skull", bird);
    // The crest. It is what the reference leads with and it is the only part
    // of a chick that breaks a round silhouette.
    for (let i = -1; i <= 1; i++) {
      const q = part(blob(holeR * 0.08, holeR * 0.28, holeR * 0.08), plume, "crest" + (i + 1), bird);
      q.position.set(i * holeR * 0.16, holeR * 0.52, -holeR * 0.06);
      q.rotation.z = -i * 0.4;
      q.rotation.x = -0.35;
    }
    const beak = part(new THREE.ConeGeometry(holeR * 0.12, holeR * 0.26, 5), toon({ color: 0xf0b32c }), "beak", bird);
    beak.position.set(0, -holeR * 0.02, holeR * 0.48);
    beak.rotation.x = Math.PI / 2;
    const sclera = toon({ color: 0xf8f3e8 });
    const pupil = toon({ color: 0x241d18 });
    const glint = new THREE.MeshBasicMaterial({ color: 0xffffff });
    for (const s of [-1, 1]) {
      const p = new THREE.Group();
      p.position.set(s * holeR * 0.2, holeR * 0.1, holeR * 0.36);
      bird.add(p);
      part(new THREE.SphereGeometry(holeR * 0.17, 8, 6), sclera, "eyeBall", p);
      const pu = part(new THREE.SphereGeometry(holeR * 0.12, 8, 6), pupil, "eyePupil", p);
      pu.position.z = holeR * 0.08;
      const gl = part(new THREE.SphereGeometry(holeR * 0.045, 5, 4), glint, "eyeGlint", p);
      gl.position.set(-holeR * 0.04, holeR * 0.05, holeR * 0.14);
    }
  }

  // --- the canopy. Three lobed masses on the fork, using the same primitive
  // the garden's foliage does, so a forest leaf-mass and a garden one are the
  // same kind of object rather than two ideas about what a bush is.
  const crowns: Array<[number, number, number, number]> = [
    [0, 1.02, -0.02, 0.31],
    [-0.24, 0.9, 0.04, 0.22],
    [0.25, 0.92, -0.06, 0.23],
  ];
  crowns.forEach(([x, y, z, r], i) => {
    const c = part(
      lobedFoliageGeometry(r * W, { lobes: 13, sharpness: 9, amplitude: 0.24, detail: 2, seed: i + 3 }),
      leafMat,
      "crown" + i,
      g,
    );
    c.position.set(x * W, y * H, z * W);
    c.scale.y = 0.82;
  });

  g.rotation.y = (rnd() - 0.5) * 0.5;
  return g;
}

// ---------------------------------------------------------------------------
// 6. THE PERCHED BIRD — .img2threejs/reference/props/birdwall/image.png
//
// A WALL-TOP prop, and that is what it is designed around. The hedge crown is
// a flat one-tile square at y = 1.08 with nothing to occlude it, so what a
// wall piece needs is not height — it is a compact silhouette that reads at a
// glance from directly above and behind.
//
// Measured: the bird is 1.12 wide over tall INCLUDING its spread wings, and
// 0.74 without them; the head is 0.62 of the body's own diameter, which is
// enormous and is the whole charm. Two things carry it:
//   1. THE EYES. In the reference they are nearly a third of the head each,
//      gold-ringed, and they are the first thing you see. At wall-top size
//      they are what says "bird" rather than "berry".
//   2. THE SWEPT WINGS. Held out and slightly back, they widen the silhouette
//      past the body — without them a perched bird is a ball on a branch.
// It sits on its own short BRANCH, because a bird placed directly on a hedge
// crown reads as having fallen onto it.
// ---------------------------------------------------------------------------

/**
 * perchedBird — a round songbird on a short branch, for wall tops.
 *
 *  - `params.birdColor` (default 0x2f7fd6) — plumage.
 *  - `params.bellyColor` (default 0x8fc4ea) — the pale breast.
 *  - `params.eyeColor` (default the measured 0xe8c24a gold) — the iris ring.
 *  - `params.trunkColor` (default 0x7a5433) — the branch.
 *  - `params.height` / `params.width` (default 1).
 */
export function makePerchedBird(params: PropParams, h: number): THREE.Group {
  const g = new THREE.Group();
  const rnd = rand(h);
  const H = params.height ?? 1;
  const W = params.width ?? 1;
  const plume = toon({ color: params.birdColor ?? 0x2f7fd6 });
  const breast = toon({ color: params.bellyColor ?? 0x8fc4ea });
  const barkMat = toon({ color: params.trunkColor ?? 0x7a5433 });
  const dark = toon({ color: 0x241d18 });
  const gold = toon({ color: params.eyeColor ?? 0xe8c24a });

  const BD = 0.17; // body radius, the proportion base
  const branchR = 0.032 * W;
  // The branch's own BOTTOM sits on y = 0 — this is a wall-top prop and its
  // placement drops it straight onto the hedge crown, so anything above zero
  // is a bird hovering over its own perch. Measured at 0.067 on the first
  // build.
  const perchY = branchR;

  // --- 0: the branch. Runs across the tile, so the bird has something to be
  // standing ON — see the header.
  const br = part(new THREE.CylinderGeometry(branchR * 0.9, branchR * 1.1, 0.62 * W, 7), barkMat, "branch", g);
  br.position.set(0, perchY, 0);
  br.rotation.z = Math.PI / 2;
  br.rotation.y = 0.22;
  for (const s of [-1, 1]) {
    const twig = part(new THREE.CylinderGeometry(0.014 * W, 0.02 * W, 0.16 * W, 6), barkMat, "twig", g);
    twig.position.set(s * 0.26 * W, perchY + 0.05 * H, s * 0.03 * W);
    twig.rotation.z = -s * 0.7;
  }

  const body = new THREE.Group();
  body.name = "bird";
  body.position.set(0.02 * W, perchY + branchR + BD * 0.86 * H, 0);
  g.add(body);

  // --- the body: one round mass with a pale breast standing proud of it,
  // not painted on (this renderer has no outline pass, so a flush colour
  // change on a curve has nothing but the colour to define its edge).
  part(blob(BD * W, BD * 1.04 * H, BD * 0.94 * W), plume, "body", body);
  const bib = part(blob(BD * 0.7 * W, BD * 0.78 * H, BD * 0.5 * W), breast, "breast", body);
  bib.position.set(0, -BD * 0.16 * H, BD * 0.6 * W);

  // --- the head. 0.62 of the body and deliberately not less: shrinking it
  // toward realism is exactly what would make this read as a pigeon.
  const head = part(blob(BD * 0.66 * W, BD * 0.64 * H, BD * 0.64 * W), plume, "head", body);
  head.position.set(0, BD * 0.86 * H, BD * 0.06 * W);
  // The crown tuft — three short quills, the reference's own ruffled top.
  for (let i = -1; i <= 1; i++) {
    const q = part(blob(BD * 0.07 * W, BD * 0.22 * H, BD * 0.07 * W), plume, "tuft" + (i + 1), body);
    q.position.set(i * BD * 0.22 * W, BD * 1.42 * H, -BD * 0.06 * W);
    q.rotation.z = -i * 0.45;
  }

  // --- THE EYES, identity rank 1. Gold ring, dark ball, catchlight — the
  // ring is a separate slightly larger sphere behind the pupil rather than a
  // torus, because a torus at this size is six triangles of nothing.
  for (const s of [-1, 1]) {
    const p = new THREE.Group();
    p.name = s < 0 ? "eyeL" : "eyeR";
    p.position.set(s * BD * 0.3 * W, BD * 0.92 * H, BD * 0.5 * W);
    body.add(p);
    part(new THREE.SphereGeometry(BD * 0.26 * W, 9, 7), gold, "ring", p);
    const pu = part(new THREE.SphereGeometry(BD * 0.19 * W, 9, 7), dark, "pupil", p);
    pu.position.z = BD * 0.12 * W;
    const gl = part(
      new THREE.SphereGeometry(BD * 0.07 * W, 6, 5),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      "glint",
      p,
    );
    gl.position.set(-s * BD * 0.05 * W, BD * 0.07 * H, BD * 0.26 * W);
  }
  const beak = part(new THREE.ConeGeometry(BD * 0.13 * W, BD * 0.3 * H, 5), toon({ color: 0x5c4332 }), "beak", body);
  beak.position.set(0, BD * 0.7 * H, BD * 0.6 * W);
  beak.rotation.x = Math.PI / 2;

  // --- the wings, held OUT. Identity rank 2: they are what makes the
  // silhouette wider than tall, and a perched bird with folded wings is a
  // ball. Each is a flattened blade on a pivot so the sweep is one number.
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.name = s < 0 ? "wingL" : "wingR";
    // Clear of the body, not inside it. At 0.82 of the body RADIUS the pivot
    // sat within the mass and each wing emerged as a nub — and the spread
    // wing is what makes this silhouette wider than tall, which is identity
    // rank 2.
    pivot.position.set(s * BD * 1.12 * W, BD * 0.14 * H, -BD * 0.14 * W);
    pivot.rotation.z = -s * 0.55;
    pivot.rotation.y = s * 0.5;
    body.add(pivot);
    const w = part(blob(BD * 0.62 * W, BD * 0.15 * H, BD * 0.36 * W), plume, "blade", pivot);
    w.position.x = s * BD * 0.5 * W;
  }

  // --- the tail, a flat fan swept back and down.
  const tail = part(blob(BD * 0.28 * W, BD * 0.1 * H, BD * 0.7 * W), plume, "tail", body);
  tail.position.set(0, -BD * 0.5 * H, -BD * 0.9 * W);
  tail.rotation.x = -0.42;

  // --- feet, gripping the branch. Two pixels, and the one thing that stops
  // the bird looking as though it is hovering a hair above its own perch.
  for (const s of [-1, 1]) {
    const foot = part(blob(BD * 0.1 * W, BD * 0.1 * H, BD * 0.16 * W), dark, "foot", g);
    foot.position.set(0.02 * W + s * BD * 0.24 * W, perchY + branchR * 0.8, BD * 0.12 * W);
  }

  body.rotation.y = (rnd() - 0.5) * 0.6;
  return g;
}
