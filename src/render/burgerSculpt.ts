// OWNER: render-artist
// Geometry machinery for the hamburger mascot (IDEA-059), the eighth
// img2threejs rebuild. Same role for it that `pizzaSculpt.ts` plays for the
// pizza and `sushiSculpt.ts` for the maki and the nigiri: the shapes that are
// specific to this subject and are worth having in one tested place, kept out
// of the already-large `characters.ts`.
//
// Everything here is pure geometry — no materials, no scene, no game state —
// so it can be measured by a scratch script without a browser.
//
// THE SUBJECT'S IDENTITY IS THAT IT IS A STACK OF CONTRASTING HORIZONTAL
// BANDS, and two of those bands have to break the silhouette or the whole
// thing reads as a layer cake. That is what most of this file is for: the
// lettuce frill (`frillRing`) and the cheese slice whose corners hang over the
// patty (`squircleSlab`). Everything else on the model is a lathe, a tube or a
// sphere, and those already exist in `beagleSculpt.ts` and `pizzaSculpt.ts`.
import * as THREE from "three";
import { rng } from "./paint";

// ---------------------------------------------------------------------------
// Measured profiles
// ---------------------------------------------------------------------------
//
// These are MEASURED, not fitted. Each row is (t, r): t is the fraction of the
// band's height from its top, r is the half-width as a fraction of that band's
// own maximum. They come out of `.img2threejs/burger/measure.py` — scanline
// runs across the reference at 6 px steps — and they are written out rather
// than replaced by an analytic curve because the top bun is NOT a hemisphere
// and the difference shows: it carries its width low, reaching 0.99 of maximum
// only at t = 0.70, which is what makes it read as a bun rather than as a ball
// with a face on it.
//
// Given in latheFromProfile's own convention (x = radius 0..0.5, y = -0.5 top
// to +0.5 bottom is NOT what it wants — it wants y ascending), so each table is
// emitted bottom-to-top by `bandProfile` below.

/** Top bun: crown to the base the lettuce hides. 28 measured stations. */
export const TOP_BUN_STATIONS: readonly (readonly [number, number])[] = [
  [0.000, 0.055], [0.006, 0.131], [0.042, 0.309], [0.079, 0.414], [0.115, 0.494],
  [0.152, 0.557], [0.188, 0.608], [0.224, 0.659], [0.261, 0.704], [0.297, 0.742],
  [0.333, 0.774], [0.370, 0.806], [0.406, 0.834], [0.442, 0.863], [0.479, 0.882],
  [0.515, 0.908], [0.552, 0.927], [0.588, 0.943], [0.624, 0.959], [0.661, 0.971],
  [0.697, 0.984], [0.733, 0.992], [0.800, 0.998], [0.880, 1.000], [1.000, 0.988],
];

/**
 * Bottom bun: a flat cut face on top rounding to nothing underneath.
 *
 * Measured NARROWER than the top bun (1.096 BH against 1.195), which is what
 * makes the stack taper downward. It looks top-heavy, and it is meant to: the
 * reference draws it that way and a burger with a wider base reads as a cake.
 */
export const BOTTOM_BUN_STATIONS: readonly (readonly [number, number])[] = [
  [0.000, 0.985], [0.050, 1.000], [0.180, 0.985], [0.330, 0.960], [0.560, 0.913],
  [0.700, 0.860], [0.790, 0.797], [0.860, 0.700], [0.900, 0.562], [0.955, 0.330],
  [1.000, 0.001],
];

/** Patty: a thick disc with a rounded rim. The stack's darkest band. */
export const PATTY_STATIONS: readonly (readonly [number, number])[] = [
  [0.000, 0.870], [0.090, 0.960], [0.220, 1.000], [0.500, 1.000], [0.780, 1.000],
  [0.910, 0.960], [1.000, 0.870],
];

/**
 * Convert a measured (t, r) station table into the unit lathe profile
 * `latheFromProfile` expects: x = radius in 0..0.5, y ascending from -0.5 to
 * +0.5, so t = 0 (the band's TOP) becomes y = +0.5.
 *
 * `capTop`/`capBottom` close the lathe onto the axis. A lathe whose first or
 * last profile point has a non-zero radius is an open tube, and an open tube
 * inside a stack is invisible right up until the moment the band above it
 * animates a few thousandths away and you can see straight down inside the
 * model.
 */
export function bandProfile(
  stations: readonly (readonly [number, number])[],
  capTop: boolean,
  capBottom: boolean,
): (readonly [number, number])[] {
  const out: [number, number][] = [];
  if (capBottom) out.push([0.0005, -0.5]);
  for (let i = stations.length - 1; i >= 0; i--) {
    const [t, r] = stations[i];
    out.push([Math.max(0.0005, r * 0.5), 0.5 - t]);
  }
  if (capTop) out.push([0.0005, 0.5]);
  return out;
}

/**
 * The half-width of a band profile at height fraction `t` from its top.
 *
 * This is the placement helper for everything that has to sit ON the top bun —
 * the eyes, the brows, the smile, the sesame seeds. Expressing those in terms
 * of the profile rather than as absolute coordinates is the same defence the
 * pizza's `sectorHalfWidth` provides: retune the dome and the face follows it
 * instead of sinking into it or floating off it.
 */
export function stationRadius(
  stations: readonly (readonly [number, number])[],
  t: number,
): number {
  const c = Math.min(Math.max(t, 0), 1);
  for (let i = 1; i < stations.length; i++) {
    const [t0, r0] = stations[i - 1];
    const [t1, r1] = stations[i];
    if (c <= t1) {
      const u = t1 > t0 ? (c - t0) / (t1 - t0) : 0;
      return r0 + (r1 - r0) * u;
    }
  }
  return stations[stations.length - 1][1];
}

/**
 * A point on a lathed band's surface, given an azimuth and a height fraction.
 *
 * `phi` is measured from +Z (the direction the model faces), so `phi = 0` is
 * dead centre of the face and the sign of `phi` is the character's own left.
 */
export function onBand(
  stations: readonly (readonly [number, number])[],
  t: number,
  phi: number,
  maxRadius: number,
  height: number,
  topY: number,
): THREE.Vector3 {
  const r = stationRadius(stations, t) * maxRadius;
  return new THREE.Vector3(r * Math.sin(phi), topY - t * height, r * Math.cos(phi));
}

// ---------------------------------------------------------------------------
// The lobe wave — what stops a repeated feature reading as a machined part
// ---------------------------------------------------------------------------

/**
 * A smooth, 2*pi-periodic wave in roughly [-1, 1] with `lobes` main bumps and
 * two seeded overtones on top.
 *
 * The overtones are the entire point. A pure `sin(k * theta)` frill is
 * PERIODIC, and a periodic frill on a round body reads as a gear — the same
 * failure the crab's pincer had when its gap was scaled honestly and closed
 * into a solid wedge, and the same one the spec records as risk R5. Two
 * incommensurate overtones at a quarter and a sixth of the main amplitude make
 * every lobe a slightly different size and depth while keeping the curve
 * smooth and exactly periodic, so the ring still closes.
 *
 * Seeded, so the same burger is built every time — a frill that reshuffles per
 * instance would make five enemies on screen look like five different props.
 */
export function lobeWave(lobes: number, seed: number): (theta: number) => number {
  const r = rng(seed);
  // Overtone counts are chosen coprime-ish to `lobes` so the sum does not
  // simply reinforce the main bumps.
  const k2 = lobes * 2 + 1;
  const k3 = Math.max(2, Math.round(lobes / 2) + 1);
  const p1 = r() * Math.PI * 2;
  const p2 = r() * Math.PI * 2;
  const p3 = r() * Math.PI * 2;
  return (theta: number) =>
    (Math.sin(lobes * theta + p1) +
      0.25 * Math.sin(k2 * theta + p2) +
      0.16 * Math.sin(k3 * theta + p3)) /
    1.41;
}

// ---------------------------------------------------------------------------
// The lettuce frill
// ---------------------------------------------------------------------------

export interface FrillOptions {
  /** Radius where the frill meets the stack. Stays circular. */
  rInner: number;
  /** Mean radius of the frill's outer tip, before the lobes modulate it. */
  rOuter: number;
  /** Thickness of the leaf's cross-section at its thickest. */
  thickness: number;
  /** Main lobe count. */
  lobes: number;
  /** Radial modulation of the outer tip, as a fraction of (rOuter - rInner). */
  lobeAmp: number;
  /** How far the outer tip rides up and down with the wave. */
  dropAmp: number;
  seed: number;
  segments: number;
}

/**
 * A scalloped skirt: a closed leaf cross-section swept around Y, with the
 * OUTER edge pushed in and out and up and down by `lobeWave` while the inner
 * edge stays a clean circle.
 *
 * Why the inner edge is held circular: the frill sits between the bun above it
 * and the cheese below, and both of those are round. A frill that waved at its
 * inner edge too would open gaps into the stack at every trough, and a gap
 * into a stack shows the inside of the band above — which reads as a hole,
 * exactly the defect `turntable_gate.py` exists to catch.
 *
 * Topologically a torus: the profile is closed and the sweep is closed, so the
 * grid wraps in both directions and there is nothing to cap. That is worth
 * having deliberately rather than by accident — an open frill would need caps
 * at the seam, and a seam on a ring is a hairline that catches the light
 * differently from everything around it.
 */
export function frillRing(o: FrillOptions): THREE.BufferGeometry {
  // The leaf cross-section, in (dr, dy) where dr runs 0 at the inner
  // attachment to 1 at the outer tip and dy is in units of `thickness`. Fat
  // near the attachment, tapering to a thin edge — which is what a lettuce
  // leaf does and, more usefully, what keeps the tip from reading as a slab
  // when the lobe pushes it out past the bun.
  const SECTION: readonly (readonly [number, number])[] = [
    [0.00, 0.50], [0.30, 0.60], [0.62, 0.42], [0.88, 0.20], [1.00, 0.02],
    [0.88, -0.16], [0.62, -0.34], [0.30, -0.52], [0.00, -0.50],
  ];
  const P = SECTION.length;
  const S = o.segments;
  const wave = lobeWave(o.lobes, o.seed);
  // A second wave, out of phase with the first, drives the vertical dip. Using
  // the SAME wave for both would make every lobe that pushes out also drop —
  // a perfectly correlated frill, which reads as a pleated cone. Real frilled
  // leaves are uncorrelated, and so is this.
  const wave2 = lobeWave(o.lobes, o.seed ^ 0x9e37);

  const pos: number[] = [];
  const idx: number[] = [];
  const span = o.rOuter - o.rInner;
  for (let a = 0; a < S; a++) {
    const theta = (a / S) * Math.PI * 2;
    const gain = 1 + o.lobeAmp * wave(theta);
    const dip = o.dropAmp * wave2(theta);
    const ct = Math.cos(theta);
    const st = Math.sin(theta);
    for (let i = 0; i < P; i++) {
      const [dr, dy] = SECTION[i];
      const r = o.rInner + span * dr * gain;
      // The dip is weighted by `dr`, so the inner attachment never moves and
      // the tip carries all of it.
      const y = dy * o.thickness + dip * dr;
      pos.push(r * st, y, r * ct);
    }
  }
  for (let a = 0; a < S; a++) {
    const a1 = (a + 1) % S;
    for (let i = 0; i < P; i++) {
      const i1 = (i + 1) % P;
      const v00 = a * P + i;
      const v01 = a * P + i1;
      const v10 = a1 * P + i;
      const v11 = a1 * P + i1;
      idx.push(v00, v10, v11, v00, v11, v01);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// ---------------------------------------------------------------------------
// The cheese slice
// ---------------------------------------------------------------------------

export interface CheeseOptions {
  /** Half-width across the squircle's AXES (not to its corners). */
  halfWidth: number;
  /** Squircle exponent. 2 is a circle; this wants ~2.4, a soft square. */
  exponent: number;
  thickness: number;
  /** Radius past which a point starts to droop — i.e. the patty's radius. */
  supportRadius: number;
  /** How far the furthest corner falls. */
  droop: number;
  /** Per-corner variation of the droop, 0..1. */
  droopJitter: number;
  seed: number;
  segments: number;
  rings: number;
}

/**
 * A square cheese slice on a round burger, with the corners hanging over.
 *
 * THIS IS ONE MECHANISM PRODUCING FOUR DRIPS. The reference draws big
 * triangular cheese corners dangling past the patty, and the obvious build is
 * four separate pendant meshes bolted onto a disc. That build has four
 * numbers that have to be kept in step with the disc's radius and with each
 * other, and it is wrong for the reason the pizza's `sectorOutline` is right:
 * a square laid on a circle overhangs at exactly four places BY CONSTRUCTION,
 * and if the parts that overhang are the parts that droop, the drips place
 * themselves. Change the exponent, the half-width or the patty's radius and
 * the drips follow instead of needing a second edit.
 *
 * The droop is keyed on a vertex's ACTUAL radius against `supportRadius`, so
 * everything still resting on the patty stays flat and only the overhang
 * falls. `droopJitter` then varies it per corner, because four identical drips
 * are a cog — the same reasoning as `lobeWave`'s overtones.
 */
export function squircleSlab(o: CheeseOptions): THREE.BufferGeometry {
  const S = o.segments;
  const J = o.rings;
  const r = rng(o.seed);
  const jitter = [r(), r(), r(), r()].map((v) => 1 - o.droopJitter * v);
  const half = o.thickness / 2;

  // Squircle boundary radius at `theta`: |cos|^n + |sin|^n = 1 solved for r.
  const bound = (theta: number): number => {
    const c = Math.abs(Math.cos(theta));
    const s = Math.abs(Math.sin(theta));
    return o.halfWidth / Math.pow(Math.pow(c, o.exponent) + Math.pow(s, o.exponent), 1 / o.exponent);
  };
  // Which of the four corners a given angle belongs to, for the jitter.
  const cornerAt = (theta: number): number => {
    const k = ((theta / (Math.PI / 2)) % 4 + 4) % 4;
    const i = Math.floor(k);
    const f = k - i;
    // Blend between neighbouring corners so the jitter is continuous and the
    // slab does not develop a crease on the axes.
    const a = jitter[i % 4];
    const b = jitter[(i + 1) % 4];
    return a + (b - a) * (0.5 - 0.5 * Math.cos(f * Math.PI));
  };
  const fall = (rho: number, theta: number): number => {
    if (rho <= o.supportRadius) return 0;
    const rMax = bound(theta);
    if (rMax <= o.supportRadius) return 0;
    const u = Math.min(1, (rho - o.supportRadius) / (rMax - o.supportRadius));
    return o.droop * Math.pow(u, 1.5) * cornerAt(theta);
  };

  const pos: number[] = [];
  const idx: number[] = [];
  // Vertex layout: [top grid (J+1) x S] then [bottom grid (J+1) x S].
  const topAt = (j: number, a: number) => j * S + a;
  const botAt = (j: number, a: number) => (J + 1) * S + j * S + a;
  for (const sign of [1, -1] as const) {
    for (let j = 0; j <= J; j++) {
      for (let a = 0; a < S; a++) {
        const theta = (a / S) * Math.PI * 2;
        const rho = bound(theta) * (j / J);
        const d = fall(rho, theta);
        pos.push(rho * Math.sin(theta), sign * half - d, rho * Math.cos(theta));
      }
    }
  }
  for (let j = 0; j < J; j++) {
    for (let a = 0; a < S; a++) {
      const a1 = (a + 1) % S;
      idx.push(topAt(j, a), topAt(j + 1, a), topAt(j + 1, a1));
      idx.push(topAt(j, a), topAt(j + 1, a1), topAt(j, a1));
      idx.push(botAt(j, a), botAt(j + 1, a1), botAt(j + 1, a));
      idx.push(botAt(j, a), botAt(j, a1), botAt(j + 1, a1));
    }
  }
  // The rim, joining the two grids at j = J.
  for (let a = 0; a < S; a++) {
    const a1 = (a + 1) % S;
    idx.push(topAt(J, a), topAt(J, a1), botAt(J, a1));
    idx.push(topAt(J, a), botAt(J, a1), botAt(J, a));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// ---------------------------------------------------------------------------
// Scatter on a lathed surface
// ---------------------------------------------------------------------------

export interface SurfacePlacement {
  position: THREE.Vector3;
  /** Outward surface normal, for standing a seed proud of the dome. */
  normal: THREE.Vector3;
  /** Rotation about the normal, radians — a seed's own tilt. */
  spin: number;
}

/**
 * Deterministic scatter over a band of a lathed surface.
 *
 * Used for the sesame seeds. Two things it does that a naive scatter does not:
 *
 *  1. It samples `t` with a bias toward the crown, because the reference's
 *     seeds crowd the top of the bun and thin out toward the sides. A uniform
 *     scatter over t reads as a polka-dot pattern.
 *
 *     `crownBias` is the EXPONENT on a uniform sample, so it must be GREATER
 *     than 1 to pull `t` toward `tRange[0]`. Below 1 it pushes the other way
 *     and crowds the base instead — which is what the burger's first build
 *     did at 0.58, and which does not look like a bug in the render, it just
 *     looks like a bun with bald patches where the seeds should be.
 *  2. It returns a real surface NORMAL, computed from the profile's own slope,
 *     so a seed can be laid flat against the dome and pushed out along it. A
 *     seed oriented to the radius instead lies flat near the equator and
 *     stands on end near the crown.
 *
 * `avoidPhi`/`avoidT` carve out the face: no seed is placed inside that
 * rectangle in (phi, t). The reference has none below the brow line and none
 * between the eyes, and a sesame seed sitting on an eyeball is the kind of
 * thing that only shows up after everything else is finished.
 */
export function scatterOnBand(
  stations: readonly (readonly [number, number])[],
  count: number,
  seed: number,
  maxRadius: number,
  height: number,
  topY: number,
  tRange: readonly [number, number],
  crownBias: number,
  avoid?: { phi: number; t: readonly [number, number] },
): SurfacePlacement[] {
  const r = rng(seed);
  const out: SurfacePlacement[] = [];
  let guard = 0;
  while (out.length < count && guard++ < count * 40) {
    const t = tRange[0] + (tRange[1] - tRange[0]) * Math.pow(r(), crownBias);
    const phi = (r() * 2 - 1) * Math.PI;
    if (avoid && Math.abs(phi) < avoid.phi && t >= avoid.t[0] && t <= avoid.t[1]) continue;
    const p = onBand(stations, t, phi, maxRadius, height, topY);
    // Surface normal from the profile slope. Shared with `bandNormal` rather
    // than reimplemented: this function had its own inline copy and the copy
    // carried the sign error described there, so the seeds were sunk into the
    // bun rather than standing proud of it.
    out.push({
      position: p,
      normal: bandNormal(stations, t, phi, maxRadius, height),
      spin: r() * Math.PI,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// A mouth that lies ON a dome
// ---------------------------------------------------------------------------

/**
 * The outward surface NORMAL of a lathed band at (t, phi).
 *
 * Not the same as the radial direction, and the difference is the whole reason
 * this exists: on a dome the profile is expanding as it descends, so the true
 * normal tilts UP away from horizontal by the profile's own slope. Anything
 * laid on the surface and pushed out radially instead lifts off at the crown
 * and digs in at the base.
 */
export function bandNormal(
  stations: readonly (readonly [number, number])[],
  t: number,
  phi: number,
  maxRadius: number,
  height: number,
): THREE.Vector3 {
  const dt = 0.004;
  const t0 = Math.max(0, t - dt);
  const t1 = Math.min(1, t + dt);
  const dr = (stationRadius(stations, t1) - stationRadius(stations, t0)) * maxRadius;
  const dy = -(t1 - t0) * height;
  const len = Math.hypot(dr, dy) || 1;
  // (dr, dy) is the tangent in the (radius, y) plane as t DESCENDS, so on a
  // dome dr > 0 and dy < 0. Turning it outward is (-dy, dr), NOT (dy, -dr):
  // the outward normal has a POSITIVE radial component and points up.
  //
  // The wrong one of those two is not a small error, it is a sign, and it is
  // invisible in a render: it pushes anything laid on the surface INTO the
  // solid instead of proud of it, and what you get back is a part that is
  // built, correctly coloured, correctly placed and simply not there. This
  // file shipped it once — the mouth's whole interior went missing behind the
  // bun, and the sesame seeds were being sunk 0.005 into the dome and oriented
  // upside down, which nothing about either render says.
  return new THREE.Vector3(
    (-dy / len) * Math.sin(phi),
    dr / len,
    (-dy / len) * Math.cos(phi),
  ).normalize();
}

export interface SmilePatchOptions {
  stations: readonly (readonly [number, number])[];
  maxRadius: number;
  height: number;
  topY: number;
  /** Angular half-width of the mouth, radians. */
  halfPhi: number;
  /** Height fraction of the band the mouth's centre line sits at. */
  tCentre: number;
  /** Total vertical extent of the aperture, in t units. */
  tHeight: number;
  /** How far the patch stands proud of the surface. */
  lift: number;
  /** Sub-range of the aperture to build, 0 = top lip, 1 = bottom. */
  vFrom: number;
  vTo: number;
  segments: number;
  rows: number;
}

/** The aperture's top edge at parameter u (0..1 left to right), in t units. */
function smileTopT(o: SmilePatchOptions, u: number): number {
  return o.tCentre - 0.22 * o.tHeight * Math.sin(u * Math.PI);
}

/** The aperture's bottom edge at parameter u, in t units. */
function smileBotT(o: SmilePatchOptions, u: number): number {
  return o.tCentre + 0.78 * o.tHeight * Math.pow(Math.sin(u * Math.PI), 0.72);
}

/**
 * A patch of the same open-smile aperture `sushiSculpt.smileHolePoints` draws,
 * but CONFORMED to a lathed dome instead of cut out of a flat plate.
 *
 * The pizza and the maki carry their mouths as real HOLES, because both faces
 * are flat and a hole is one `Shape` with one `Path` in it. This face is a
 * revolved dome, where there is no plate to cut and no flat behind it to put a
 * floor on, so the mouth is built the other way round: a stack of thin layers
 * lying ON the surface — dark cavity, ink rim, tooth strip, tongue — each one
 * generated here at its own `vFrom`/`vTo` slice of the same aperture, so they
 * cannot disagree about where the mouth is.
 *
 * It is a GRID, not a triangulated outline, and that matters. `ShapeGeometry`
 * only emits vertices on the contour, so a patch this wide (0.64 rad, about 37
 * degrees of arc) would be spanned by long triangles that cut straight across
 * the curvature and sink into the bun through the middle. Sampling rows and
 * columns and putting every vertex on the surface makes the patch hug it.
 */
export function smilePatch(o: SmilePatchOptions): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const cols = o.segments + 1;
  for (let i = 0; i <= o.segments; i++) {
    const u = i / o.segments;
    const phi = (u - 0.5) * 2 * o.halfPhi;
    const tT = smileTopT(o, u);
    const tB = smileBotT(o, u);
    for (let j = 0; j <= o.rows; j++) {
      const v = o.vFrom + (o.vTo - o.vFrom) * (j / o.rows);
      const t = tT + (tB - tT) * v;
      const p = onBand(o.stations, t, phi, o.maxRadius, o.height, o.topY);
      const n = bandNormal(o.stations, t, phi, o.maxRadius, o.height);
      pos.push(p.x + n.x * o.lift, p.y + n.y * o.lift, p.z + n.z * o.lift);
    }
  }
  for (let i = 0; i < o.segments; i++) {
    for (let j = 0; j < o.rows; j++) {
      const a = i * (o.rows + 1) + j;
      const b = a + (o.rows + 1);
      // Wound so the patch faces OUT. `i` runs left to right and `j` runs
      // DOWNWARD, and those two tangents cross to an INWARD normal — so the
      // obvious index order gives a patch that faces into the dome, is
      // back-face culled, and renders as nothing at all. The first build had
      // it, and what it looks like is a mouth with the bun's own colour inside
      // it: the ink lip (a tube, and so unaffected) drew a perfect grin around
      // an empty hole. Same family as a limb buried in a solid — the part is
      // built, correct and simply not visible.
      idx.push(a, b + 1, b, a, a + 1, b + 1);
    }
  }
  void cols;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}
