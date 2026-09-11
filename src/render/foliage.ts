// OWNER: render-artist
// IDEA-060: the foliage primitive the garden props are built from.
//
// Every plant this project has shipped is a SPHERE. The shrub is three
// squashed ones, the oak is a trunk with two stacked on it, the pine is
// cones. That was fine when a prop was a coloured blob on the apron, and it
// is the first thing that fails against a real reference: measured on the
// shrub reference, the outline's radius has a standard deviation of 13.5% of
// its mean (`.img2threejs/garden-props/measurements.json`). A sphere measures
// zero. That single number is the difference between "a bush" and "a green
// ball", and no amount of colour work closes it.
//
// So foliage here is a LOBED sphere: an icosphere whose radius is pushed out
// toward a set of lobe directions, giving a scalloped, clumped silhouette in
// ONE mesh. Three properties made this the choice over the alternatives:
//
//  - It is one geometry, one draw, one material. A cluster of small spheres
//    studded on a big one gets a similar outline and costs a mesh per bump,
//    and it is the "blob assembly" look this project has been moving away
//    from since IDEA-047.
//  - The silhouette is REAL geometry, so it survives the clay render, the
//    shadow pass and any camera. A texture cannot put a notch in an outline.
//  - It is measurable. `lobedRoughness` below reports the same sd/mean the
//    reference was measured with, so the tuning loop is closed rather than
//    an opinion — see scripts/_scratch-foliage-tune.ts.
//
// The one thing it deliberately does NOT try to be is individual leaves.
// A prop stands on the apron at roughly 25px per tile; a leaf would be
// sub-pixel, and the cartoon rule this project follows everywhere else (see
// floorTexture.ts's own block) says a shape smaller than a couple of pixels
// is grain, not detail. What survives the distance is the CLUMPING, which is
// exactly what this draws.
import * as THREE from "three";

/** Deterministic PRNG, so a prop looks the same on every device and every
 *  reload — same contract as paint.ts's `rng`, duplicated here rather than
 *  imported because paint.ts is the 2D canvas kit and this is geometry. */
function rand(seed: number): () => number {
  let a = (seed * 747796405 + 2891336453) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface FoliageOptions {
  /** How many clumps the surface breaks into. More lobes means a finer, busier
   *  outline; fewer means a few big cauliflower heads. */
  lobes?: number;
  /** Radial deviation, as a fraction of the base radius. This is the knob that
   *  the reference's 0.135 roughness is tuned against — see `lobedRoughness`. */
  amplitude?: number;
  /** How tightly each lobe is concentrated around its own direction. Low
   *  values blend the lobes into one soft wobble; high values give separate
   *  round heads with real valleys between them. */
  sharpness?: number;
  /** Icosphere subdivision. 2 (320 faces) is right for a prop; 3 (1280) only
   *  pays off on something the camera gets close to. */
  detail?: number;
  /** Non-uniform scale applied AFTER lobing, so a canopy can be a broad dome
   *  without the lobes stretching with it. */
  scale?: readonly [number, number, number];
  /** Seed, so two shrubs on the same board are not the same shrub. */
  seed?: number;
}

/**
 * The radial multiplier field a lobed sphere is built from: a unit direction
 * in, a factor around 1.0 out.
 *
 * Shared by `lobedFoliageGeometry` (which samples it at each vertex) and
 * `lobedRoughness` (which samples it on a great circle). That sharing is the
 * point — the thing tuned and the thing measured are then the same function,
 * not two implementations that can drift.
 *
 * The lobe directions come off a Fibonacci sphere — evenly spread by
 * construction, with no clustering at the poles the way a lat/long
 * distribution has — then get a deterministic jitter so the result reads as
 * grown rather than as a pattern.
 *
 * Each direction's factor is driven by the STRONGEST lobe pointing at it, not
 * by the sum of all of them. A sum gives every direction a similar total (the
 * lobes either side average out) and flattens the whole thing back toward a
 * sphere, which is the defect this exists to avoid; a max leaves genuine
 * valleys between neighbouring lobes.
 */
export function lobeField(opts: FoliageOptions = {}): (n: THREE.Vector3) => number {
  // CALIBRATED DEFAULTS, not taste. lobes 16 / sharpness 10 / amplitude 0.24
  // measures 0.1350 on `lobedRoughness`, against the shrub reference's own
  // traced 0.135 — see scripts/_scratch-foliage-tune.ts, which prints the
  // whole table and a zero-amplitude control alongside it.
  const lobes = opts.lobes ?? 16;
  const amplitude = opts.amplitude ?? 0.24;
  const sharpness = opts.sharpness ?? 10;
  const r = rand(opts.seed ?? 1);

  const dirs: THREE.Vector3[] = [];
  const weights: number[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < lobes; i++) {
    const y = 1 - (i / Math.max(1, lobes - 1)) * 2;
    const rad = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i + (r() - 0.5) * 0.6;
    const v = new THREE.Vector3(Math.cos(theta) * rad, y, Math.sin(theta) * rad);
    v.y += (r() - 0.5) * 0.25;
    dirs.push(v.normalize());
    // Per-lobe amplitude variation. Without it every clump is the same size
    // and the outline reads as a machined scallop rather than as foliage.
    weights.push(0.6 + r() * 0.7);
  }

  return (n: THREE.Vector3): number => {
    let best = 0;
    for (let j = 0; j < dirs.length; j++) {
      const d = n.dot(dirs[j]);
      if (d <= 0) continue;
      const f = Math.pow(d, sharpness) * weights[j];
      if (f > best) best = f;
    }
    return 1 - amplitude + 2 * amplitude * Math.min(1, best);
  };
}

/**
 * A lobed sphere of radius `radius`, centred on its own origin.
 *
 * `detail` is the icosphere subdivision three.js's own parameter means:
 * 20*(detail+1)^2 faces, so 2 is 180 and 4 is 500 — NOT a x4 per level.
 */
export function lobedFoliageGeometry(radius: number, opts: FoliageOptions = {}): THREE.BufferGeometry {
  const detail = opts.detail ?? 2;
  const scale = opts.scale ?? [1, 1, 1];
  const field = lobeField(opts);

  const geo = new THREE.IcosahedronGeometry(radius, detail);
  const pos = geo.attributes.position;
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    n.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
    const rr = radius * field(n);
    pos.setXYZ(i, n.x * rr * scale[0], n.y * rr * scale[1], n.z * rr * scale[2]);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * The same sd/mean outline roughness the shrub reference was measured with —
 * 0.135 there, 0.0 for a sphere — computed on the LOBE FIELD rather than on a
 * built mesh, and averaged over the three cardinal great circles.
 *
 * IT IS MEASURED ON THE FIELD BECAUSE MEASURING THE MESH DOES NOT WORK, and
 * that is worth recording because the first two attempts both produced
 * confident wrong numbers:
 *
 *  1. Binning a mesh's vertices by angle and taking the furthest per bin is
 *     what tracing a 2D outline does, but a sphere's vertices are not dense
 *     near any given projection's equator. Most bins' furthest sample sits
 *     INSIDE the true outline, by a varying amount, and the variance of that
 *     error is what gets reported. Control measurement: a plain detail-4
 *     icosphere — a shape whose roughness is by definition zero — scored
 *     0.1667, while a 64x48 UV sphere scored 0.0000. The instrument was
 *     reading its own tessellation.
 *  2. Raising the subdivision does not fix it, it only shrinks it. The first
 *     tuning table ran every combination from amplitude 0.16 to 0.32 and
 *     reported 0.17-0.27 with barely any response to the amplitude, which is
 *     the signature of a measurement dominated by its own noise floor.
 *
 * Sampling the field on a great circle is exact for a star-shaped body, which
 * a lobed sphere is by construction. The caveat worth stating: a real 3D
 * silhouette can be formed by lobes sitting OFF the viewing equator, so this
 * slightly under-reports what a camera sees. The reference number came from
 * tracing a flat drawing, so both sides of the comparison carry the same
 * simplification.
 */
export function lobedRoughness(opts: FoliageOptions = {}, bins = 360): number {
  const field = lobeField(opts);
  const n = new THREE.Vector3();
  let total = 0;
  for (const axis of [0, 1, 2]) {
    const radii: number[] = [];
    for (let i = 0; i < bins; i++) {
      const t = (i / bins) * Math.PI * 2;
      const c = Math.cos(t);
      const s = Math.sin(t);
      if (axis === 0) n.set(0, c, s);
      else if (axis === 1) n.set(c, 0, s);
      else n.set(c, s, 0);
      radii.push(field(n));
    }
    const mean = radii.reduce((a, b) => a + b, 0) / radii.length;
    total += Math.sqrt(radii.reduce((a, b) => a + (b - mean) ** 2, 0) / radii.length) / mean;
  }
  return total / 3;
}

/**
 * A tapered solid of revolution from a `[radius, height]` profile — the trunk
 * primitive.
 *
 * It exists because of the single most characterful measurement in the tree
 * reference: the trunk is 0.117 of the tree's width where it meets the canopy
 * and 0.473 at the ground, a FOUR-FOLD root flare. A CylinderGeometry cannot
 * express that, and a cone gets the taper but not the curve — a real trunk's
 * flare is concave, rushing outward only in the last fifth. So the profile is
 * given as points and lathed.
 *
 * `profile` runs BOTTOM to TOP as [radius, y] pairs, both in world units.
 */
export function trunkGeometry(
  profile: readonly (readonly [number, number])[],
  segments = 10,
): THREE.BufferGeometry {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(1e-4, r), y));
  const geo = new THREE.LatheGeometry(pts, segments);
  geo.computeVertexNormals();
  return geo;
}

/**
 * A trunk profile with a concave root flare, from the reference's own two
 * numbers: `topRadius` at the shoulder and `flare`x that at the ground.
 *
 * The exponent is what makes the flare CONCAVE. A linear taper from 4x to 1x
 * gives a cone, and a cone reads as a traffic bollard; raising the parameter
 * to a power keeps the trunk near-parallel for most of its length and lets it
 * splay only where it meets the soil, which is what the reference draws.
 */
export function flaredTrunkProfile(
  topRadius: number,
  height: number,
  flare: number,
  steps = 6,
): Array<readonly [number, number]> {
  const out: Array<readonly [number, number]> = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps; // 0 at the ground, 1 at the shoulder
    const k = Math.pow(1 - t, 3.2);
    out.push([topRadius * (1 + (flare - 1) * k), height * t]);
  }
  return out;
}
