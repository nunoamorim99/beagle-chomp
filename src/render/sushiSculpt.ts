// Geometry helpers shared by the two sushi enemy skins (IDEA-056 maki,
// IDEA-057 nigiri). They live here rather than in characters.ts for the same
// reason beagleSculpt.ts does: they are general shape machinery with their own
// rules, and characters.ts is already the biggest file in the project.
//
// Nothing here imports from src/game — this is render-layer geometry only.
import * as THREE from "three";

/**
 * A SQUIRCLE: the superellipse |x/hw|^n + |y/hh|^n = 1, sampled as a closed
 * polygon.
 *
 * Both sushi need a rounded square, and a rounded square is the one shape that
 * is genuinely awkward from primitives — a box has hard corners, a sphere has
 * none, and stitching four arcs to four lines by hand puts a tangency error at
 * every join. The superellipse is one continuous curve with no joins at all,
 * and `n` is a single readable knob: 2 is an ellipse, 4 is the reference's
 * salmon plate, 8 is nearly a box.
 *
 * Returned in COUNTER-CLOCKWISE order, which is what THREE.Shape wants for an
 * outer contour (a clockwise contour extrudes with its cap normals inverted and
 * the plate renders black from the front).
 */
export function squirclePoints(
  halfW: number,
  halfH: number,
  n: number,
  segments: number,
): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    // The signed superellipse parameterisation. Math.sign keeps the quadrant;
    // the fractional power is taken on the magnitude, since a negative base to
    // a fractional exponent is NaN and one NaN vertex silently deletes the
    // triangles that touch it.
    const x = Math.sign(c) * Math.pow(Math.abs(c), 2 / n) * halfW;
    const y = Math.sign(s) * Math.pow(Math.abs(s), 2 / n) * halfH;
    pts.push(new THREE.Vector2(x, y));
  }
  return pts;
}

/**
 * The radius of that same squircle in direction `theta` — the closed form, so a
 * scatter can follow the contour without searching the polygon for it.
 *
 * This is what makes the maki's rice ring hug its salmon plate. Scattered on a
 * CIRCLE the grains leave four fat gaps at the plate's flat sides and pinch
 * against its corners; scattered on the plate's own contour, offset outward,
 * the ring is even the whole way round, which is what the reference shows.
 */
export function squircleRadius(theta: number, halfW: number, halfH: number, n: number): number {
  const c = Math.pow(Math.abs(Math.cos(theta) / halfW), n);
  const s = Math.pow(Math.abs(Math.sin(theta) / halfH), n);
  return Math.pow(c + s, -1 / n);
}

/**
 * Clips a convex-or-concave polygon against ONE half-plane, Sutherland-Hodgman.
 * `nx,ny` is the inward normal and `d` the offset: a point is kept when
 * `nx*x + ny*y >= d`.
 */
function clipHalfPlane(
  poly: readonly THREE.Vector2[],
  nx: number,
  ny: number,
  d: number,
): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  const n = poly.length;
  if (n === 0) return out;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const da = nx * a.x + ny * a.y - d;
    const db = nx * b.x + ny * b.y - d;
    if (da >= 0) out.push(a.clone());
    // Crossing the boundary: emit the intersection. The guard on the
    // denominator matters — an edge lying exactly ON the boundary has da === db
    // and would divide by zero, producing a NaN vertex that deletes triangles.
    if ((da >= 0) !== (db >= 0) && Math.abs(da - db) > 1e-9) {
      const t = da / (da - db);
      out.push(new THREE.Vector2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t));
    }
  }
  return out;
}

/**
 * The intersection of a polygon with a BAND: the strip of the plane between two
 * parallel lines, at `angle` radians, whose centres are `offset` from the
 * origin along the band's normal and which is `width` across.
 *
 * This is how a surface marking is made to REACH the silhouette. A stripe drawn
 * as its own little rounded rectangle stops short of the host's edge and reads
 * as a floating dash — IDEA-054's sticker failure in two dimensions. Clipped
 * against the host's own outline, the stripe's two ends ARE the host's curve,
 * so its boundary is a line across the shape rather than a closed shape inside
 * it, which is the whole rule.
 *
 * Returns an empty array when the band misses the polygon entirely; callers
 * must skip that stripe rather than build a degenerate Shape from it.
 */
export function clipPolygonToBand(
  poly: readonly THREE.Vector2[],
  angle: number,
  offset: number,
  width: number,
): THREE.Vector2[] {
  // Band normal. The band runs along (cos, sin); its normal is the perpendicular.
  const nx = -Math.sin(angle);
  const ny = Math.cos(angle);
  let p = clipHalfPlane(poly, nx, ny, offset - width / 2);
  if (p.length < 3) return [];
  p = clipHalfPlane(p, -nx, -ny, -(offset + width / 2));
  return p.length < 3 ? [] : p;
}

/** A closed THREE.Shape through the given points, in order. */
export function shapeFromPoints(pts: readonly THREE.Vector2[]): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i].x, pts[i].y);
  s.closePath();
  return s;
}

/** The same, as a THREE.Path — what THREE.Shape.holes wants. */
export function pathFromPoints(pts: readonly THREE.Vector2[]): THREE.Path {
  const p = new THREE.Path();
  p.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) p.lineTo(pts[i].x, pts[i].y);
  p.closePath();
  return p;
}

/**
 * The mouth aperture outline: a wide arc bulging UP across the top and a deep
 * rounded U underneath — an open cartoon smile, not an ellipse.
 *
 * Returned CLOCKWISE, because it is used as a HOLE in the face plate and a hole
 * must wind against its outer contour or the triangulator fills it in instead
 * of cutting it out.
 */
export function smileHolePoints(halfW: number, height: number, segments: number): THREE.Vector2[] {
  const top: THREE.Vector2[] = [];
  const bottom: THREE.Vector2[] = [];
  for (let i = 0; i <= segments; i++) {
    const u = i / segments; // 0..1 left to right
    const x = -halfW + u * halfW * 2;
    const k = Math.sin(u * Math.PI); // 0 at the corners, 1 at the centre
    top.push(new THREE.Vector2(x, height * 0.22 * k));
    bottom.push(new THREE.Vector2(x, -height * 0.78 * Math.pow(k, 0.72)));
  }
  // left-to-right along the top, then right-to-left along the bottom: clockwise.
  bottom.reverse();
  return [...top, ...bottom.slice(1, bottom.length - 1)];
}

/**
 * A LatheGeometry whose axis has been turned from +Y to +Z.
 *
 * Every revolved part on both sushi is a disc or a drum facing FORWARD, and
 * `LatheGeometry` only ever revolves about +Y. Rotating the geometry rather
 * than the mesh keeps the mesh's own rotation free for the animation to use,
 * which matters because these parts sit under pivots that the walk cycle turns.
 *
 * `points` are (radius, distance-along-axis) and must run from the LOW end to
 * the HIGH end: reversed, every normal points inward and the part renders
 * inside-out.
 */
export function latheAlongZ(
  points: readonly (readonly [number, number])[],
  segments: number,
): THREE.BufferGeometry {
  const profile = points.map(([r, y]) => new THREE.Vector2(Math.max(1e-4, r), y));
  const geo = new THREE.LatheGeometry(profile, segments);
  geo.rotateX(Math.PI / 2); // +Y axis -> +Z axis
  geo.computeVertexNormals();
  return geo;
}

/** One ring of a banded tube: radius, distance along the axis, and which of the
 *  two material slots its quads belong to. */
export interface BandedRing {
  r: number;
  z: number;
  band: boolean;
}

/**
 * A tube swept along +Z whose surface is cut into TWO PER-TRIANGLE MATERIAL
 * GROUPS by ring index — slot 0 for the body, slot 1 for the bands.
 *
 * Two rules are load-bearing and both were learned elsewhere in this project:
 *
 * 1. **Classify by RING, never by a triangle's own mean position.** A quad's
 *    two triangles have different means, so a mean-based test puts the two
 *    halves of every quad on opposite sides of a boundary and the band edge
 *    zigzags around the circumference — IDEA-047's "spiky markings" defect,
 *    which IDEA-055 then hit again on the mosquito's abdomen. By ring, every
 *    boundary is a clean circle.
 * 2. **Build the index in bucket order.** Groups address contiguous ranges of
 *    the index buffer, so the two buckets are filled separately and
 *    concatenated rather than relying on the emission order happening to sort
 *    itself.
 *
 * `thetaStart` / `thetaLength` cut the tube to an ARC of its circumference. A
 * HALF tube (0 to PI) is what a topping laid on a block wants: a full tube
 * centred on the block's top plane puts half its own volume inside the block
 * and, at the ends where the sweep has not yet tapered, hangs that half down
 * over the block's FRONT — which is where the face lives. Seat the arc's axis
 * just under the top plane instead and the open bottom edge is buried in the
 * block it is sitting on.
 *
 * Winding is chosen so the outward normal is outward: with the axis on +Z and
 * ring points at (r cos t, r sin t, z), the triangle (ring i seg j, ring i
 * seg j+1, ring i+1 seg j) has its normal pointing away from the axis. Get it
 * backwards and the tube renders inside-out.
 */
export function bandedTubeAlongZ(
  rings: readonly BandedRing[],
  segments: number,
  thetaStart = 0,
  thetaLength = Math.PI * 2,
): THREE.BufferGeometry {
  const positions: number[] = [];
  for (let j = 0; j <= segments; j++) {
    const t = thetaStart + (j / segments) * thetaLength;
    const c = Math.cos(t);
    const s = Math.sin(t);
    for (const p of rings) positions.push(p.r * c, p.r * s, p.z);
  }
  const n = rings.length;
  const body: number[] = [];
  const band: number[] = [];
  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i;
      const b = a + n;
      // A quad is a BAND quad when either of its two rings is a band ring, so a
      // band is never one ring thick and therefore never sub-pixel.
      const target = rings[i].band || rings[i + 1].band ? band : body;
      target.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex([...body, ...band]);
  geo.addGroup(0, body.length, 0);
  geo.addGroup(body.length, band.length, 1);
  geo.computeVertexNormals();
  return geo;
}

/**
 * The Z of a squircle FOOTPRINT at a given X — i.e. how far forward the block's
 * front surface is directly in front of a point.
 *
 * Face marks have to sit ON that surface. The block's front is nearly, but not
 * exactly, flat: across the eye region the superellipse falls away by about two
 * millimetres in world units, which is more than the marks' own thickness. Put
 * every mark at one fixed Z and the outer ones sink into the rice.
 */
export function squircleFrontZ(x: number, halfW: number, halfD: number, n: number): number {
  const u = Math.min(1, Math.abs(x) / halfW);
  const rest = Math.max(0, 1 - Math.pow(u, n));
  return halfD * Math.pow(rest, 1 / n);
}

/**
 * A rounded pillow with a SQUIRCLE footprint: flat-ish sides, rounded top and
 * bottom edges, one continuous smooth surface.
 *
 * This replaces an `ExtrudeGeometry` with a bevel, which is the obvious way to
 * build the same shape and is wrong here for two separate reasons:
 *
 * 1. **The bevel grows OUTWARD.** `bevelSize` is how far the mid-depth profile
 *    extends BEYOND the shape you hand it, so the finished solid is `bevelSize`
 *    wider on every side than its own outline. Anything positioned against that
 *    outline — a belt, a grain scatter, a face — ends up INSIDE the solid and
 *    renders as nothing at all.
 * 2. **It is non-indexed, so it cannot be smoothed.** Every triangle carries its
 *    own vertices, `computeVertexNormals` therefore produces flat shading, and
 *    each bevel step becomes a hard facet. Under a three-step toon ramp those
 *    facets quantise into visible rectangular patches across what is supposed to
 *    be one soft mass.
 *
 * Here the rings are shared and indexed, so normals average across them.
 * `footprintExp` shapes the plan (2 is an ellipse, 3-4 a soft rounded square)
 * and `profileExp` shapes the elevation (2 is an ellipsoid, 4 gives flat sides
 * with a rounded edge about a fifth of the height).
 */
export function squirclePillow(
  halfW: number,
  halfD: number,
  height: number,
  footprintExp: number,
  profileExp: number,
  radialSegments: number,
  heightSegments: number,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const ringOf: number[] = []; // first vertex index of each ring, -1 for a pole

  const dirs: [number, number][] = [];
  for (let j = 0; j <= radialSegments; j++) {
    const t = (j / radialSegments) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    dirs.push([
      Math.sign(c) * Math.pow(Math.abs(c), 2 / footprintExp),
      Math.sign(s) * Math.pow(Math.abs(s), 2 / footprintExp),
    ]);
  }

  for (let i = 0; i <= heightSegments; i++) {
    const v = i / heightSegments;
    const y = height * v;
    // The elevation superellipse: ~1 across the middle, rolling off at both
    // ends. It reaches exactly 0 at v = 0 and v = 1, which collapses those two
    // rings to poles — and because the curve's tangent there is vertical, the
    // surface arrives at each pole horizontally, which is what makes the top
    // and bottom read FLAT rather than pointed.
    const s = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(2 * v - 1), profileExp)), 1 / profileExp);
    if (s <= 1e-6) {
      ringOf.push(-1);
      positions.push(0, y, 0);
      continue;
    }
    ringOf.push(positions.length / 3);
    for (const [dx, dz] of dirs) positions.push(dx * halfW * s, y, dz * halfD * s);
  }

  const poleIndex = (i: number): number => {
    // A pole ring stored one vertex; recover its index from the running count.
    let count = 0;
    for (let k = 0; k < i; k++) count += ringOf[k] < 0 ? 1 : radialSegments + 1;
    return count;
  };

  for (let i = 0; i < heightSegments; i++) {
    const lowPole = ringOf[i] < 0;
    const highPole = ringOf[i + 1] < 0;
    for (let j = 0; j < radialSegments; j++) {
      if (lowPole && highPole) continue;
      // WINDING, and all three cases have to agree or the pillow renders
      // inside-out: with rings running counter-clockwise in XZ and stacked up
      // +Y, the outward normal comes from cross(up, around), so the ring
      // neighbour must be the SECOND vertex and the circumferential neighbour
      // the third. Got backwards, the block renders as a dark grey shell lit
      // from behind — which looks like a material bug and is not one.
      if (lowPole) {
        const p = poleIndex(i);
        const b = ringOf[i + 1] + j;
        indices.push(p, b, b + 1);
      } else if (highPole) {
        const p = poleIndex(i + 1);
        const a = ringOf[i] + j;
        indices.push(a, p, a + 1);
      } else {
        const a = ringOf[i] + j;
        const b = ringOf[i + 1] + j;
        indices.push(a, b, a + 1);
        indices.push(a + 1, b, b + 1);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}
