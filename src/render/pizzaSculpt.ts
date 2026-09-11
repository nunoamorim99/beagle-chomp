// OWNER: render-artist
// Geometry machinery for the pizza-slice mascot (IDEA-058), the seventh
// img2threejs rebuild. Same role for it that `sushiSculpt.ts` plays for the
// maki and the nigiri: the shapes that are specific to this subject and are
// worth having in one tested place, kept out of the already-large
// `characters.ts`.
//
// Everything here is pure geometry — no materials, no scene, no game state —
// so it can be measured by a scratch script without a browser.
import * as THREE from "three";

/**
 * A pizza slice's outline: a circular SECTOR, apex down, arc up, with two
 * refinements the plain sector does not have.
 *
 * This is the one function the whole model hangs off. The wedge solid, the
 * cheese plate that sits on it and the arc the crust roll is swept along are
 * ALL derived from it, which is the point: three parts computed from one
 * outline cannot disagree about where the slice's edge is, and three parts
 * authored separately always eventually do.
 *
 * The two refinements:
 *
 * 1. **`bow`** pushes the two straight cut edges OUTWARD, nothing at either end
 *    and most of it LOW — the peak sits at about 40% of the edge, not at the
 *    middle, which is the `t^0.78` inside the sine below.
 *
 *    Both facts came out of measuring the reference against the first build.
 *    A real slice's cuts are dead straight, and the first pass took that
 *    literally at `bow = 0.020`: the render came back a clean geometric wedge
 *    while the reference is a distinctly FULL one, half again as wide across
 *    the mouth line. Scanline widths across the reference's cheese put its
 *    widest point at roughly 45% of the slice's height rather than at the
 *    centre, which is why the exponent is there rather than a plain `sin(pi t)`.
 *    It is still bounded on the other side: the silhouette's whole job is to
 *    say "triangle", and a bow big enough to move the widest point off the
 *    crust would say "leaf".
 *
 * 2. **`tipRound`** replaces the apex point with a fillet tangent to both
 *    edges. A sharp point is not what a slice's tip looks like, and at the
 *    game camera's ~25 px it aliases into nothing at all.
 *
 * `edgeInset` insets both cut edges by that distance along their own normals,
 * which is how the cheese plate is derived from the same call: an inset sector
 * is a sector whose apex has slid UP the axis by `inset / sin(alpha)`. So the
 * plate's dough rim is uniform BY CONSTRUCTION rather than by two numbers
 * being kept in step.
 *
 * Returned counter-clockwise, starting at the tip fillet, so it can be handed
 * straight to `THREE.Shape` with `smileHolePoints`' clockwise mouth as a hole.
 */
export interface SectorOutlineOptions {
  /** Arc radius, measured from the ORIGIN (the un-inset apex). */
  radius: number;
  /** Half-angle of the sector, radians. The full slice spans `2 * alpha`. */
  alpha: number;
  /** Outward bulge at the middle of each cut edge. 0 for a true sector. */
  bow: number;
  /** Fillet radius at the tip. */
  tipRound: number;
  /** Inset both cut edges by this much along their own normals. */
  edgeInset: number;
  /** Points along each cut edge. */
  edgeSegments: number;
  /** Points along the outer arc. */
  arcSegments: number;
  /** Points around the tip fillet. */
  tipSegments: number;
}

/** Where the (possibly inset) apex sits on the axis. */
export function sectorApexY(alpha: number, edgeInset: number): number {
  return edgeInset / Math.sin(alpha);
}

/**
 * Length along one cut edge, from the (inset) apex to the outer arc.
 *
 * Solving |A + uL| = radius with A = (0, y0) and u a unit vector `alpha` off
 * the axis gives L^2 + 2*L*y0*cos(alpha) + y0^2 = radius^2, hence the form
 * below. Worth writing out rather than approximating: this length is the
 * denominator the bow is parameterised on, so getting it wrong tilts the bulge
 * off centre instead of failing visibly.
 */
export function sectorEdgeLength(radius: number, alpha: number, edgeInset: number): number {
  const y0 = sectorApexY(alpha, edgeInset);
  const s = Math.sin(alpha);
  return -y0 * Math.cos(alpha) + Math.sqrt(Math.max(0, radius * radius - y0 * y0 * s * s));
}

/**
 * Half-width of the outline at slice-local height `y`.
 *
 * The placement helper for every scattered thing on the plate — a topping, a
 * freckle, a drip lobe — is expressed as a FRACTION of this rather than as an
 * absolute x, so nothing can clip through the rim when the sector angle or the
 * inset changes. That is the same defence the crab's joint test uses: make the
 * defect unrepresentable rather than merely absent.
 *
 * The bow's own (small, downward) y-component is ignored here — at the values
 * this model uses it is at most 0.007 world units, and folding it in would
 * make this an iterative solve for no visible gain.
 */
export function sectorHalfWidth(o: SectorOutlineOptions, y: number): number {
  const y0 = sectorApexY(o.alpha, o.edgeInset);
  const lMax = sectorEdgeLength(o.radius, o.alpha, o.edgeInset);
  const l = Math.min(Math.max((y - y0) / Math.cos(o.alpha), 0), lMax);
  const t = lMax > 1e-6 ? l / lMax : 0;
  return l * Math.sin(o.alpha) + bowAt(o.bow, t) * Math.cos(o.alpha);
}

/** The outward bulge at edge parameter `t`. Peaks near t = 0.40, not at 0.50 —
 *  see `bow` in SectorOutlineOptions for the measurement that put it there. */
function bowAt(bow: number, t: number): number {
  return bow * Math.sin(Math.PI * Math.pow(Math.min(Math.max(t, 0), 1), 0.78));
}

/** A point on the right-hand cut edge at edge parameter `t` in 0..1. */
function edgePoint(o: SectorOutlineOptions, t: number, side: 1 | -1): THREE.Vector2 {
  const y0 = sectorApexY(o.alpha, o.edgeInset);
  const lMax = sectorEdgeLength(o.radius, o.alpha, o.edgeInset);
  const l = t * lMax;
  const sa = Math.sin(o.alpha);
  const ca = Math.cos(o.alpha);
  // Edge direction, and its OUTWARD normal (the edge direction turned away
  // from the axis). Getting the normal's sign wrong pulls the bow inward and
  // pinches the slice's waist, which looks like a modelling choice rather than
  // like an error — so it is written out rather than guessed.
  const b = bowAt(o.bow, t);
  return new THREE.Vector2(side * (l * sa + b * ca), y0 + l * ca - b * sa);
}

export function sectorOutline(o: SectorOutlineOptions): THREE.Vector2[] {
  const y0 = sectorApexY(o.alpha, o.edgeInset);
  const pts: THREE.Vector2[] = [];

  // --- the tip fillet -------------------------------------------------------
  // Centre sits `tipRound / sin(alpha)` above the apex, which is where a
  // circle tangent to both cut edges has to be. The arc runs left to right
  // under it, so the outline continues up the right edge afterwards.
  const cy = y0 + o.tipRound / Math.sin(o.alpha);
  const start = Math.PI + o.alpha; // tangent point on the LEFT edge
  const end = 2 * Math.PI - o.alpha; // tangent point on the RIGHT edge
  for (let i = 0; i <= o.tipSegments; i++) {
    const a = start + (end - start) * (i / o.tipSegments);
    pts.push(new THREE.Vector2(o.tipRound * Math.cos(a), cy + o.tipRound * Math.sin(a)));
  }

  // Where the fillet's tangent point sits along the edge, as a parameter — the
  // straight edges start there, not at the apex, or the outline doubles back
  // over the fillet it just drew.
  const lMax = sectorEdgeLength(o.radius, o.alpha, o.edgeInset);
  const tTangent = ((o.tipRound / Math.sin(o.alpha)) * Math.cos(o.alpha)) / lMax;

  // --- right cut edge, tip -> arc ------------------------------------------
  for (let i = 1; i <= o.edgeSegments; i++) {
    const t = tTangent + (1 - tTangent) * (i / o.edgeSegments);
    pts.push(edgePoint(o, t, 1));
  }

  // --- outer arc, right -> left, about the ORIGIN ---------------------------
  // About the origin and not about the inset apex, deliberately: the crust
  // roll is swept along the un-inset arc, so the plate's own outer boundary
  // has to be concentric with it or the gap between cheese and crust opens at
  // the middle and closes at the ends.
  const pRight = edgePoint(o, 1, 1);
  const a0 = Math.atan2(pRight.y, pRight.x);
  const a1 = Math.PI - a0;
  for (let i = 1; i <= o.arcSegments; i++) {
    const a = a0 + (a1 - a0) * (i / o.arcSegments);
    pts.push(new THREE.Vector2(o.radius * Math.cos(a), o.radius * Math.sin(a)));
  }

  // --- left cut edge, arc -> tip -------------------------------------------
  for (let i = 1; i < o.edgeSegments; i++) {
    const t = 1 - (1 - tTangent) * (i / o.edgeSegments);
    pts.push(edgePoint(o, t, -1));
  }
  return pts;
}

/**
 * The path the crust roll is swept along: the sector's own outer arc, with the
 * last stretch of each end curled FORWARD and dropped slightly.
 *
 * The curl is not decoration. The roll's ends are its identity — each closes
 * on a visible dough SPIRAL — and on a plain arc those spirals face straight
 * out along +/-X, i.e. at the maze wall. A viewer at the game camera never
 * sees them. Carrying the last quarter of the sweep forward turns both caps
 * toward the player, which is also exactly what the reference draws.
 *
 * `tuck` pulls the same two ends INWARD on X as they come forward, which a
 * real quiff's sides do and which is also, less romantically, where the width
 * budget came from: the two spiral caps sit at the sweep's ends, and MEASURED
 * on the first build they were the widest thing on the whole model at |x|
 * 0.330 — wider than the gloves. Tucking them costs nothing that reads and
 * buys 0.06 of envelope.
 *
 * The exponent is what keeps it a curl rather than a bend: at 2.4 the middle
 * three-fifths of the arc is untouched to within a millimetre, so the roll
 * still reads as following the slice's edge.
 */
export function crustSweepPoints(
  radius: number,
  alpha: number,
  curl: number,
  drop: number,
  tuck: number,
  segments: number,
): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    const a = Math.PI / 2 + alpha - 2 * alpha * u; // left end -> right end
    const e = Math.abs(2 * u - 1); // 0 at the crown, 1 at either end
    const k = Math.pow(e, 2.4);
    out.push(
      new THREE.Vector3(
        radius * Math.cos(a) * (1 - tuck * k),
        radius * Math.sin(a) - drop * k,
        curl * k,
      ),
    );
  }
  return out;
}

/**
 * An Archimedean spiral, as a list of points, for the groove on a crust cap's
 * face. Lies in the XZ plane so it can be swept as a tube and dropped straight
 * onto a lathe whose axis is +Y.
 */
export function spiralPoints(
  rInner: number,
  rOuter: number,
  turns: number,
  y: number,
  segments: number,
): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    const a = u * turns * Math.PI * 2;
    const r = rInner + (rOuter - rInner) * u;
    out.push(new THREE.Vector3(r * Math.cos(a), y, r * Math.sin(a)));
  }
  return out;
}

/**
 * A rubber-hose limb: one continuous tube of CONSTANT radius along a gentle
 * curve, with no elbow and no knee.
 *
 * That is the 1930s idiom the reference is drawn in, and it is a measurement
 * rather than a simplification: the reference's arm ink-run is the same width
 * at two scanlines 100 px apart across a large change of direction, with no
 * taper and no joint bulge anywhere. A capsule chain here would not be a
 * cheaper version of the right answer, it would be the wrong answer — and it
 * would drag in the whole joint-gap problem the flea and the crab had to
 * solve (a segmented limb needs a knuckle ball at every joint or it renders in
 * pieces). A single swept tube cannot have a joint gap, because it has no
 * joints.
 *
 * The curve is built from four control points so the hang has some weight to
 * it; `CatmullRomCurve3` then makes it continuous, which is what the caps at
 * either end are aligned against.
 */
export function hoseGeometry(
  points: readonly THREE.Vector3[],
  radius: number,
  pathSegments: number,
  radialSegments: number,
): { geometry: THREE.TubeGeometry; curve: THREE.CatmullRomCurve3 } {
  const curve = new THREE.CatmullRomCurve3([...points], false, "catmullrom", 0.5);
  return {
    geometry: new THREE.TubeGeometry(curve, pathSegments, radius, radialSegments, false),
    curve,
  };
}
