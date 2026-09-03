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

function regionClaims(r: CoatRegion, x: number, y: number, z: number): boolean {
  if (r.kind === "band") {
    const v = r.axis === 0 ? x : r.axis === 1 ? y : z;
    return v >= r.min && v <= r.max;
  }
  if (r.kind === "blob") {
    const [cx, cy, cz] = r.center;
    const [rx, ry, rz] = r.radii;
    return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + ((z - cz) / rz) ** 2 <= 1;
  }
  const [ax, ay, az] = r.start;
  const [bx, by, bz] = r.end;
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const denom = abx * abx + aby * aby + abz * abz;
  let t = denom > 0 ? ((x - ax) * abx + (y - ay) * aby + (z - az) * abz) / denom : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = x - (ax + abx * t), dy = y - (ay + aby * t), dz = z - (az + abz * t);
  const radius = r.r0 + (r.r1 - r.r0) * t;
  return dx * dx + dy * dy + dz * dz <= radius * radius;
}

/**
 * Cut a geometry into material groups: every triangle goes to the LAST region
 * whose shape claims its centroid (declaration order wins, like the pipeline's
 * paint order), or to `baseMat`. Returns a non-indexed geometry with its
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
  const triCount = pos.count / 3;
  const triMat = new Array<number>(triCount);
  let maxMat = baseMat;
  for (let t = 0; t < triCount; t++) {
    const i = t * 3;
    const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
    const cy = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
    const cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
    let mat = baseMat;
    for (const r of regions) if (regionClaims(r, cx, cy, cz)) mat = r.mat;
    triMat[t] = mat;
    if (mat > maxMat) maxMat = mat;
  }
  const order: number[] = [];
  const out = new THREE.BufferGeometry();
  const p = new Float32Array(pos.count * 3);
  const nn = new Float32Array(pos.count * 3);
  let write = 0;
  for (let m = 0; m <= maxMat; m++) {
    const start = write;
    for (let t = 0; t < triCount; t++) {
      if (triMat[t] !== m) continue;
      for (let k = 0; k < 3; k++) {
        const i = t * 3 + k;
        p[write * 3] = pos.getX(i);
        p[write * 3 + 1] = pos.getY(i);
        p[write * 3 + 2] = pos.getZ(i);
        nn[write * 3] = nrm.getX(i);
        nn[write * 3 + 1] = nrm.getY(i);
        nn[write * 3 + 2] = nrm.getZ(i);
        write++;
      }
    }
    if (write > start) {
      out.addGroup(start, write - start, m);
      order.push(m);
    }
  }
  out.setAttribute("position", new THREE.BufferAttribute(p, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nn, 3));
  if (src !== geometry) src.dispose();
  return out;
}
