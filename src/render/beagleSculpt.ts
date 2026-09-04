// OWNER: render-artist
// Geometry engine for the reworked beagle (IDEA: img2threejs reference rebuild).
//
// The beagle's forms are STATION SWEEPS (a path of cross-section stations with
// per-station elliptical radii — how the torso gets a chest deeper than its
// rump and the ears get their teardrop) and LATHE PROFILES (skull, muzzle,
// nose, paws). Coat markings are PER-TRIANGLE MATERIAL GROUPS cut by region
// predicates — the saddle/blaze/bib/socks/tail-tip land on the same shared
// toon materials the skin shop recolours, so applyBeagleSkin keeps working
// unchanged. The triangle-quantised boundary is deliberate: at game scale it
// reads as the torn-fur edge of the reference.
//
// Numbers come from the img2threejs sculpt spec (.img2threejs/object-sculpt-
// spec.json), measured off the reference in head-units — do not eyeball-edit
// them here without re-running that pipeline's review gates.
import * as THREE from "three";

/** One sweep station: a cross-section on the path. */
export interface SweepStation {
  /** Center of this cross-section, in the part's local frame. */
  pos: [number, number, number];
  /** Ellipse radius along the transported "right" axis (x-ish). */
  rx: number;
  /** Ellipse radius along the transported "up" axis (z-ish for vertical paths). */
  rz: number;
}

/**
 * Sweep an ellipse through the stations, capped at both ends. Frames are
 * parallel-transported from a deterministic start (right = +X for
 * near-vertical paths, else cross(up, tangent)) so rx stays lateral and rz
 * stays the path-perpendicular second axis for every part we author.
 */
export function taperedSweepGeometry(
  stations: SweepStation[],
  radialSegments: number,
  rightHint?: [number, number, number],
): THREE.BufferGeometry {
  const n = stations.length;
  const pts = stations.map((s) => new THREE.Vector3(...s.pos));
  const tangents: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    tangents.push(b.clone().sub(a).normalize());
  }
  // Deterministic initial frame, then transport it so the section never spins.
  // `rightHint` pins which local axis carries rx: a part whose FIRST segment
  // leaves at a diagonal (the ear kinking outward over the skull edge) would
  // otherwise get its section rotated to the diagonal and lie flat against
  // the surface it should hang beside.
  let right = rightHint
    ? new THREE.Vector3(...rightHint)
    : Math.abs(tangents[0].y) > 0.9
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), tangents[0]).normalize();
  const positions: number[] = [];
  const rings: number[][] = [];
  for (let i = 0; i < n; i++) {
    // Project the previous right onto the plane of this tangent (parallel transport).
    right = right.clone().sub(tangents[i].clone().multiplyScalar(right.dot(tangents[i]))).normalize();
    const up = new THREE.Vector3().crossVectors(tangents[i], right).normalize();
    const ring: number[] = [];
    for (let j = 0; j < radialSegments; j++) {
      const a = (j / radialSegments) * Math.PI * 2;
      const p = pts[i]
        .clone()
        .addScaledVector(right, Math.cos(a) * stations[i].rx)
        .addScaledVector(up, Math.sin(a) * stations[i].rz);
      ring.push(positions.length / 3);
      positions.push(p.x, p.y, p.z);
    }
    rings.push(ring);
  }
  const indices: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const j2 = (j + 1) % radialSegments;
      const a = rings[i][j], b = rings[i][j2], c = rings[i + 1][j], d = rings[i + 1][j2];
      indices.push(a, b, c, b, d, c);
    }
  }
  // Winding: rings run counter-clockwise seen from the direction the path
  // travels, so (a, b, c) / (b, d, c) puts every wall normal OUTWARD — the
  // first cut had this backwards and the dog rendered hollow, every near wall
  // culled and the far inner surface showing through.
  // End caps: a fan from each end's center point, wound to face out.
  const startCenter = positions.length / 3;
  positions.push(pts[0].x, pts[0].y, pts[0].z);
  for (let j = 0; j < radialSegments; j++) {
    indices.push(startCenter, rings[0][(j + 1) % radialSegments], rings[0][j]);
  }
  const endCenter = positions.length / 3;
  const last = pts[n - 1];
  positions.push(last.x, last.y, last.z);
  for (let j = 0; j < radialSegments; j++) {
    indices.push(endCenter, rings[n - 1][j], rings[n - 1][(j + 1) % radialSegments]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Revolve a unit profile (x = radius 0..0.5, y = -0.5..0.5) and scale to the
 * part's real width/height/depth — the profile carries the SHAPE, the scale
 * carries the size, so one skull profile serves skull, brows, etc.
 */
export function latheFromProfile(
  points: readonly (readonly [number, number])[],
  segments: number,
  w: number,
  h: number,
  d: number,
): THREE.BufferGeometry {
  const profile = points.map(([x, y]) => new THREE.Vector2(Math.max(0.001, x), y));
  const geo = new THREE.LatheGeometry(profile, segments);
  geo.scale(w, h, d);
  geo.computeVertexNormals();
  return geo;
}

/** The near-spherical profile used by skull, brows and (squashed) the nose/paws. */
export const SPHERE_PROFILE = [
  [0.001, -0.5], [0.191, -0.462], [0.354, -0.354], [0.462, -0.191], [0.5, 0],
  [0.462, 0.191], [0.354, 0.354], [0.191, 0.462], [0.001, 0.5],
] as const;

// ---------------------------------------------------------------------------
// Coat regions: the same three shape predicates the img2threejs pipeline
// gates the markings with (axis-band / ellipsoid / tapered-capsule), evaluated
// per TRIANGLE against the mesh's local geometry to cut material groups.
// ---------------------------------------------------------------------------

export type CoatRegion =
  | { kind: "band"; axis: 0 | 1 | 2; min: number; max: number; mat: number }
  | { kind: "blob"; center: [number, number, number]; radii: [number, number, number]; mat: number }
  | {
      kind: "capsule";
      start: [number, number, number];
      end: [number, number, number];
      r0: number;
      r1: number;
      mat: number;
    };

type Vtx = { p: [number, number, number]; n: [number, number, number] };
type Tri = { v: [Vtx, Vtx, Vtx]; mat: number };
/** A signed field: negative/zero INSIDE the region, positive outside. */
type Field = (x: number, y: number, z: number) => number;

/**
 * A region as a list of fields that must ALL be <= 0. A band is its two
 * planes (exact, so a cut across a band edge is dead straight); a blob is a
 * distance-like ellipsoid field; a capsule is distance-to-segment minus the
 * tapered radius.
 */
function regionFields(r: CoatRegion): Field[] {
  if (r.kind === "band") {
    const pick = (x: number, y: number, z: number): number => (r.axis === 0 ? x : r.axis === 1 ? y : z);
    return [(x, y, z) => r.min - pick(x, y, z), (x, y, z) => pick(x, y, z) - r.max];
  }
  if (r.kind === "blob") {
    const [cx, cy, cz] = r.center;
    const [rx, ry, rz] = r.radii;
    return [(x, y, z) => Math.sqrt(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + ((z - cz) / rz) ** 2) - 1];
  }
  const [ax, ay, az] = r.start;
  const [bx, by, bz] = r.end;
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const denom = abx * abx + aby * aby + abz * abz;
  return [
    (x, y, z) => {
      let t = denom > 0 ? ((x - ax) * abx + (y - ay) * aby + (z - az) * abz) / denom : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = x - (ax + abx * t), dy = y - (ay + aby * t), dz = z - (az + abz * t);
      return Math.sqrt(dx * dx + dy * dy + dz * dz) - (r.r0 + (r.r1 - r.r0) * t);
    },
  ];
}

function lerpVtx(a: Vtx, b: Vtx, t: number): Vtx {
  const p: [number, number, number] = [
    a.p[0] + (b.p[0] - a.p[0]) * t,
    a.p[1] + (b.p[1] - a.p[1]) * t,
    a.p[2] + (b.p[2] - a.p[2]) * t,
  ];
  const nx = a.n[0] + (b.n[0] - a.n[0]) * t;
  const ny = a.n[1] + (b.n[1] - a.n[1]) * t;
  const nz = a.n[2] + (b.n[2] - a.n[2]) * t;
  const len = Math.hypot(nx, ny, nz) || 1;
  return { p, n: [nx / len, ny / len, nz / len] };
}

/** The point on a→b where `f` crosses zero, refined by bisection (the blob and
 *  capsule fields are not linear along an edge, so a lerp of the end values
 *  would put the seam a little off the true curve). */
function crossing(a: Vtx, b: Vtx, f: Field, fa: number): Vtx {
  let lo = 0, hi = 1;
  const aIn = fa <= 0;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    const m = lerpVtx(a, b, mid);
    if ((f(m.p[0], m.p[1], m.p[2]) <= 0) === aIn) lo = mid;
    else hi = mid;
  }
  return lerpVtx(a, b, (lo + hi) / 2);
}

/**
 * Split one triangle by a field's zero level. Pushes the pieces inside
 * (f <= 0) to `inside` and the rest to `outside`. Sub-triangles keep the
 * parent's cyclic vertex order, so winding (front faces CCW) is preserved.
 */
function clipTri(tri: Tri, f: Field, inside: Tri[], outside: Tri[]): void {
  const v = tri.v;
  const fv = v.map((q) => f(q.p[0], q.p[1], q.p[2])) as [number, number, number];
  const inMask = fv.map((x) => x <= 0) as [boolean, boolean, boolean];
  const nIn = inMask.filter(Boolean).length;
  if (nIn === 3) { inside.push(tri); return; }
  if (nIn === 0) { outside.push(tri); return; }
  // Rotate so the LONE vertex (the odd one out) is first — cyclic, so winding holds.
  const loneIn = nIn === 1;
  const k = inMask.findIndex((x) => x === loneIn);
  const a = v[k], b = v[(k + 1) % 3], c = v[(k + 2) % 3];
  const fa = fv[k];
  const pab = crossing(a, b, f, fa);
  const pca = crossing(a, c, f, fa);
  const lone: Tri[] = [{ v: [a, pab, pca], mat: tri.mat }];
  const pair: Tri[] = [
    { v: [pab, b, c], mat: tri.mat },
    { v: [pab, c, pca], mat: tri.mat },
  ];
  if (loneIn) { inside.push(...lone); outside.push(...pair); }
  else { inside.push(...pair); outside.push(...lone); }
}

/**
 * Cut a geometry into material groups with CLEAN region edges: every
 * triangle goes to the LAST region whose shape claims it (declaration order
 * wins, like the pipeline's paint order), or to `baseMat` — and a triangle
 * that straddles a region's boundary is SPLIT along it, so the seam between
 * two coat colours follows the region's true curve instead of zigzagging
 * along whatever triangle edges the sweep happened to have (the "spiky"
 * markings of the first pass). Returns a non-indexed geometry with its
 * triangles bucketed into one group per material index, ready for a material
 * array of shared skinnable toon materials.
 */
export function splitCoatGroups(
  geometry: THREE.BufferGeometry,
  baseMat: number,
  regions: readonly CoatRegion[],
): THREE.BufferGeometry {
  const src = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = src.getAttribute("position");
  const nrm = src.getAttribute("normal");
  let tris: Tri[] = [];
  for (let i = 0; i < pos.count; i += 3) {
    const vs = [0, 1, 2].map((k): Vtx => ({
      p: [pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k)],
      n: [nrm.getX(i + k), nrm.getY(i + k), nrm.getZ(i + k)],
    })) as [Vtx, Vtx, Vtx];
    tris.push({ v: vs, mat: baseMat });
  }
  let maxMat = baseMat;
  for (const r of regions) {
    if (r.mat > maxMat) maxMat = r.mat;
    // Pieces must be inside EVERY field of the region to be claimed; anything
    // that falls outside any one of them keeps whatever it had.
    let candidates = tris;
    const rejected: Tri[] = [];
    for (const f of regionFields(r)) {
      const next: Tri[] = [];
      for (const t of candidates) clipTri(t, f, next, rejected);
      candidates = next;
    }
    for (const t of candidates) t.mat = r.mat;
    tris = rejected.concat(candidates);
  }
  const out = new THREE.BufferGeometry();
  const p = new Float32Array(tris.length * 9);
  const nn = new Float32Array(tris.length * 9);
  let write = 0;
  for (let m = 0; m <= maxMat; m++) {
    const start = write;
    for (const t of tris) {
      if (t.mat !== m) continue;
      for (const q of t.v) {
        p[write * 3] = q.p[0]; p[write * 3 + 1] = q.p[1]; p[write * 3 + 2] = q.p[2];
        nn[write * 3] = q.n[0]; nn[write * 3 + 1] = q.n[1]; nn[write * 3 + 2] = q.n[2];
        write++;
      }
    }
    if (write > start) out.addGroup(start, write - start, m);
  }
  out.setAttribute("position", new THREE.BufferAttribute(p, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nn, 3));
  if (src !== geometry) src.dispose();
  return out;
}
