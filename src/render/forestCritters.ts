// OWNER: render-artist
// IDEA-065: the Deep Forest theme's ANIMALS — deer, fox, rabbit, raccoon,
// squirrel and the squirrel explorer.
//
// Split out of forestProps.ts (which owns the pine, the cabin and the hollow
// tree) for the reason every sculpt module in this project is split: one
// responsibility each. What a fox is made of is not the same subject as how a
// log cabin is built.
//
// WHY SIX ANIMALS ARE ONE `PropBaseShape` AND NOT SIX. The garden's five
// flowers set the precedent and the argument is the same: they share a
// construction — a body, a head, ears, forelimbs, feet and a tail — and
// differ in the SHAPES of those parts, not in what parts exist. Six shapes
// would mean six rows in `PROP_SHAPE_FIELDS`, six in `PROP_HEIGHT_CLASS`, six
// factory cases and six editor entries to describe one idea. `critterKind`
// picks which, exactly as `flowerKind` does.
//
// THE RISK THIS WHOLE MODULE IS BUILT AGAINST is IDEA-056 rule 1, and here it
// is worse than it was for the sushi pair, because there are six of them and
// THREE ARE THE SAME ORANGE. A fox, a squirrel and a deer are all warm tan in
// their references; a rabbit is a paler version of the same. So colour
// separates nothing and the SILHOUETTE has to carry all of it. The measured
// separators, which every one of these is built to hold:
//
//   deer      tall QUADRUPED · antlers · long neck · long legs · white bib
//   fox       low  QUADRUPED · huge brush tail held level · pointed ears
//   rabbit    UPRIGHT · two tall narrow ears, the tallest thing on it
//   raccoon   UPRIGHT · a RINGED tail and a face mask, and it is GREY
//   squirrel  UPRIGHT · a plume tail arcing OVER its own back
//   explorer  the squirrel, plus a pith HAT and a staff — the only prop in
//             the game that carries an object
//
// Verify by rendering all six at the play camera in one sheet
// (`scripts/_scratch-critter-sheet.ts`), never by assertion. That is the
// instrument that caught the garden rose reading as a broken artichoke while
// every unit check passed.
//
// PROPORTION BASE: **HD = the head diameter**, for all six. Unlike the crab,
// the sushi and the burger, these subjects all HAVE a head and it is the
// thing a cartoon animal is drawn from, so there is nothing to invent.
import * as THREE from "three";
import type { PropParams } from "../game/props";
import { toon } from "./toon";
import {
  SPHERE_PROFILE,
  latheFromProfile,
  splitCoatGroups,
  taperedSweepGeometry,
  type CoatRegion,
  type SweepStation,
} from "./beagleSculpt";

/** Which of the six a `critter` prop is. */
export type ForestCritterKind =
  | "deer"
  | "fox"
  | "rabbit"
  | "raccoon"
  | "squirrel"
  | "squirrelExplorer";

function rand(h: number): () => number {
  let a = ((h * 4294967296) | 0) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

/** A squashed sphere — the mass every one of these is assembled from. Ten by
 *  eight segments, which is the cartoon rule applied to a prop: a body a
 *  dozen pixels across gains nothing from a smoother ball and a prop library
 *  that ships six of them pays for every ring. */
function blob(rx: number, ry: number, rz: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 10, 8);
  g.scale(rx, ry, rz);
  return g;
}

/**
 * A limb, aimed by its two ENDPOINTS rather than by hand-written Euler
 * angles — IDEA-055 rule 4, which this project has now got wrong four times
 * (the mosquito's abdomen and proboscis, the garden's rose whorls and tulip
 * petals, the treehouse's branch). `setFromUnitVectors` cannot be off by a
 * sign, and a leg that runs from the hip to the paw is described by the hip
 * and the paw.
 */
function limb(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  radius: number,
  mat: THREE.Material,
  name: string,
  parent: THREE.Object3D,
): THREE.Mesh {
  const a = new THREE.Vector3(...from);
  const b = new THREE.Vector3(...to);
  const dir = b.clone().sub(a);
  const len = dir.length();
  // The CYLINDER length only — CapsuleGeometry adds `radius` at each end on
  // top of it (the flea's three-piece leg, IDEA-053). Spanning the joint
  // exactly means asking for `len` of cylinder and letting the caps overlap
  // whatever is at each end.
  const g = new THREE.CapsuleGeometry(radius, Math.max(len - radius, radius * 0.2), 3, 7);
  const m = new THREE.Mesh(g, mat);
  m.name = name;
  m.castShadow = true;
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  parent.add(m);
  return m;
}

/**
 * A JOINTED, TAPERING LIMB — the crab's construction (IDEA-054), which this
 * project already found to be the one that cannot develop a gap.
 *
 * `limb` above is a single capsule of CONSTANT radius, which is right for a
 * fox's stub and wrong for anything with a real leg in it: a deer's foreleg
 * runs from a haunch as thick as its own neck down to a shank a third of
 * that, and drawn at one radius it is a DOWEL. Nuno, v8: *"the legs of the
 * deer, they are literally sticks."*
 *
 * `pts` is the chain of joints from the body outward and `radii` the radius
 * AT each one, so a segment is a truncated cone spanning its two joints
 * exactly. Three things follow from that and all three are the reason this
 * exists rather than two capsules:
 *
 *  - **IT IS OPEN-ENDED, AND A KNUCKLE BALL SITS AT EVERY INTERIOR JOINT.**
 *    Overlap closes a gap along a limb's axis but NOT across a fold, where
 *    two tangent tubes leave an open wedge — and a deer's hock is a fold of
 *    nearly 60 degrees, the sharpest in this module. The ball is also what
 *    hides the radius step between two segments.
 *  - **THE TAPER IS CONTINUOUS ACROSS A JOINT** because both segments read
 *    the same entry in `radii`. Two capsules at hand-picked radii agree only
 *    by luck, and stop agreeing the first time one is retuned.
 *  - **NO ARITHMETIC RELATES LENGTH TO RADIUS**, so IDEA-053's
 *    capsule-falls-short-of-its-joint defect is unrepresentable rather than
 *    merely absent.
 */
function jointedLimb(
  pts: ReadonlyArray<readonly [number, number, number]>,
  radii: readonly number[],
  mat: THREE.Material,
  name: string,
  parent: THREE.Object3D,
): THREE.Group {
  // ONE GROUP PER LIMB, AT ITS FIRST JOINT (IDEA-065 v10). Nuno: *"can we
  // have one component for the leg with all the subcomponents that make the
  // leg? its hard to move all the leg this way."* A four-joint leg is eight
  // meshes, and loose in the body's child list that is eight rows in the
  // Components tree to select and nudge in step — the editor could pose every
  // part of this animal except the one thing anybody actually wants to pose.
  //
  // THE GROUP SITS AT THE HIP RATHER THAN AT THE BODY'S ORIGIN, and that is
  // the half that makes it useful rather than merely tidy: the gizmo attaches
  // at an object's own position, so a group at the origin would put the handle
  // in the middle of the deer and ROTATING the leg would swing it round the
  // animal's centre. At the hip, rotate is exactly the joint a leg swings
  // from. It also makes a whole leg mirrorable in one keystroke (v9), because
  // the group's x negates and every child comes along inside it.
  //
  // The caller still passes points in the PARENT's frame — they are tuned
  // against `bodyY` and `bodyLen` and have to stay readable as body
  // coordinates — and they are rebased here.
  const limb = new THREE.Group();
  limb.name = name;
  limb.position.set(pts[0][0], pts[0][1], pts[0][2]);
  parent.add(limb);
  const v = pts.map((p) => new THREE.Vector3(...p).sub(limb.position));
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < v.length - 1; i++) {
    const dir = v[i + 1].clone().sub(v[i]);
    const len = dir.length();
    // FOURTEEN RADIAL SEGMENTS, NOT EIGHT, and that is a consequence of v11
    // rather than a free choice. At the old 0.15 haunch an eight-sided cone
    // was fine; at 0.22 each facet is 0.17 across and half a unit long, and
    // one of them turned square-on to the camera reads as a flat RECTANGULAR
    // PANEL hanging off the rump — which is what the thickening produced and
    // what three crops failed to identify, because the thing that looked like
    // a stray slab WAS the thigh. **A segment count that passes at one radius
    // does not pass at another**: the facet's width scales with the radius
    // while the eye's tolerance does not.
    const g = new THREE.CylinderGeometry(radii[i + 1], radii[i], len, 14, 1, true);
    const m = new THREE.Mesh(g, mat);
    m.name = `${name}Seg${i}`;
    m.castShadow = true;
    m.position.copy(v[i]).add(v[i + 1]).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(up, dir.normalize());
    limb.add(m);
    // A knuckle at EVERY joint including the first, which is the crab's own
    // rule (IDEA-054) and not only about folds. These cylinders are
    // open-ended, so the chain's first rim is a hole — and at the hip that
    // rim is 0.15 across on a haunch that only just fits inside the rump, so
    // it showed as a hard crescent on the flank. Capping it with the same
    // ball that handles the bends makes "the open end is outside the body"
    // unrepresentable rather than a placement to get right. The LAST rim is
    // the only one left uncovered, and the hoof sits on it.
    const ball = part(new THREE.SphereGeometry(radii[i] * 1.04, 7, 5), mat, `${name}Joint${i}`, limb);
    ball.position.copy(v[i]);
  }
  return limb;
}

/**
 * A LIMB WITH A PROFILE — placed exactly like `limb`, shaped like a sweep.
 *
 * `limb` is one radius and `jointedLimb` makes its own group at the first
 * joint; this is the third case: a single part whose cross-section varies
 * along its length and which must keep `limb`'s placement contract, because
 * the def may already carry a saved `position`/`scale` edit against it. The
 * geometry is therefore built about the segment's MIDPOINT in local +Y and
 * the mesh takes the same position and quaternion `limb` would have given it,
 * so an existing edit means exactly what it meant before.
 *
 * It exists for the NECK (v12). Nuno: *"on the body lets make the junction of
 * the part be more smooth and not so visible."* Making the barrel one sweep
 * fixed the creases inside it and left the ones at its edges, of which the
 * neck's was much the loudest — and a constant-radius tube entering the top
 * of a barrel meets it at a right angle however deep it is sunk, so no
 * amount of burying helps. A BELL at the base does: flared hard over the last
 * fifth, the neck's surface is nearly horizontal where it reaches the body's
 * nearly horizontal top, and two surfaces that meet tangentially have no
 * crease to show. It is the fillet this renderer cannot model, approximated
 * by the one thing it can.
 */
function flaredLimb(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  /** Per-station [lateral, fore-aft] radii, base first. */
  profile: ReadonlyArray<readonly [number, number]>,
  mat: THREE.Material,
  name: string,
  parent: THREE.Object3D,
): THREE.Mesh {
  const a = new THREE.Vector3(...from);
  const b = new THREE.Vector3(...to);
  const dir = b.clone().sub(a);
  const len = dir.length();
  const stations: SweepStation[] = profile.map(([rx, rz], i) => {
    const t = i / (profile.length - 1);
    return { pos: [0, -len / 2 + t * len, 0] as [number, number, number], rx, rz };
  });
  const m = new THREE.Mesh(taperedSweepGeometry(stations, 18), mat);
  m.name = name;
  m.castShadow = true;
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  parent.add(m);
  return m;
}

/**
 * A HOOF: a short dark wedge that FLARES OUT from the shank and stands on a
 * FLAT BASE.
 *
 * v8 shipped these as little dark ellipsoids and Nuno called them: *"the hoof
 * not looks good."* Cropped at eight times, three things were wrong and the
 * first is the one that mattered.
 *
 *  1. **IT WAS NARROWER THAN THE LEG ABOVE IT.** The cannon tapers to 0.046
 *     and the blob was 0.04 across, so the silhouette ran wide, narrow, then
 *     a BEAD on the end — which is a leg with something stuck to it. A real
 *     hoof is the widest part of the lower leg: the foot FLARES, and that
 *     flare is the whole reason a hoofed leg does not read as a stick.
 *  2. **IT WAS ROUND, SO THE ANIMAL BALANCED ON FOUR TANGENT POINTS.** A
 *     sphere touches the ground at one point and its own shading falls away
 *     to nothing there, so with a contact shadow under it the deer read as
 *     HOVERING. A flat base gives a real edge where the foot meets the floor,
 *     which is the same thing IDEA-071's kerb and IDEA-059's ledge are doing
 *     at other scales: a hard value step is what reads, a soft one is not
 *     seen at all.
 *  3. **THE CANNON'S OPEN RIM SHOWED.** `jointedLimb`'s segments are
 *     open-ended and the blob was too small to cover the last one, so there
 *     was a hard crescent of nothing between fur and hoof. The cone's own top
 *     is cut to the shank's radius so it caps it by construction.
 *
 * It is a touch longer front-to-back than it is wide, because a hoof is a
 * wedge pointing the way the animal walks — free, since the cone is scaled
 * rather than re-tessellated.
 */
function hoofWedge(
  at: readonly [number, number, number],
  shankR: number,
  height: number,
  mat: THREE.Material,
  name: string,
  parent: THREE.Object3D,
): THREE.Mesh {
  const g = new THREE.CylinderGeometry(shankR * 0.95, shankR * 1.5, height, 9, 1, false);
  g.scale(0.92, 1, 1.16);
  // Built about its own BASE rather than its centre, so the caller places the
  // foot by where it meets the ground and never has to add half a height.
  g.translate(0, height / 2, 0);
  const m = new THREE.Mesh(g, mat);
  m.name = name;
  m.castShadow = true;
  m.position.set(at[0], at[1], at[2]);
  parent.add(m);
  return m;
}

/**
 * THE EYE, AND IT IS THE BEAGLE'S (v7). Nuno: *"lets work on the eyes of the
 * deer, lets make something like the beagle eyes."*
 *
 * `characters.ts` builds the dog's eye as **one flattened LENS sunk into the
 * skull, with the iris, pupil and catchlights as flush CAPS of that same
 * sphere** — a cap rotated about the sphere's own centre stays on it, so no
 * amount of aiming can lift one off. These six were built the other way: a
 * sclera BALL with a smaller pupil ball pushed out along z and one glint ball
 * pushed out further. Three things were wrong with that and only the first is
 * cosmetic.
 *
 *  1. **A BALL ON A HEAD IS A GOOGLY EYE.** A sphere sitting at the skull's
 *     surface is 70-80% proud of it however carefully it is placed; v6 bought
 *     that back on the deer with arithmetic (`d + r - R`), which works and has
 *     to be redone by hand every time the skull changes. A lens flattened to
 *     half its depth is barely proud BY CONSTRUCTION.
 *  2. **THERE WAS NO IRIS.** The beagle's eye is white ring / coloured iris /
 *     dark pupil / two catchlights, and that four-step ladder is most of why
 *     it reads as an eye rather than as a dot. One of the two catchlights is
 *     the small one on the OPPOSITE side, which is what stops the highlight
 *     reading as a painted-on blob.
 *  3. **A STACK OF BALLS CAN COME APART AND A CAP CANNOT.** The pupil's push
 *     along z had to be retuned the moment `pupilScale` changed (v6 did
 *     exactly that), because a bigger ball pushed the same distance sinks its
 *     own equator below the sclera and gets a cream ring bitten out of it.
 *     Caps make that unrepresentable — IDEA-054's lesson again.
 *
 * The caps are children of the LENS MESH, which is what carries the
 * flattening: they are built as spheres and inherit the non-uniform scale, so
 * they deform with the lens and stay on it. That is the beagle's construction
 * exactly, and the reason its iris never needs a z offset.
 */
interface EyeOpts {
  /** Lens radius BEFORE flattening. */
  r: number;
  /** Lens scale (across, up, outward). The outward term is the one that
   *  matters: well under 1 or this is a ball again. */
  lens?: readonly [number, number, number];
  /** Angular radius of the iris cap, in radians, measured from the gaze.
   *  CUTE IS A BIG IRIS LEAVING A THIN WHITE RING — the beagle's is 0.98 of
   *  a lens whose own visible oval is about 1.1, and anything much smaller
   *  is the doll stare (IDEA-059 rule 8). */
  iris?: number;
  /** ...and of the pupil inside it. */
  pupil?: number;
}

function eye(
  parent: THREE.Object3D,
  side: number,
  at: readonly [number, number, number],
  k: Kit,
  name: string,
  o: EyeOpts,
): void {
  const pivot = new THREE.Group();
  pivot.name = name;
  pivot.position.set(side * at[0], at[1], at[2]);
  // Aim the whole stack outward-and-forward, so the caps stay flush on the
  // sclera however far round the head the eye sits.
  pivot.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(side * at[0], 0, Math.abs(at[2])).normalize(),
  );
  parent.add(pivot);

  const r = o.r;
  const lens = o.lens ?? [0.95, 1.0, 0.52];
  /** A flush cap of the lens: radius factor, angular radius, then tilted off
   *  the gaze by `up` and `outward`. Pole to +Z first, because that is where
   *  the pivot has already aimed the gaze. */
  const cap = (factor: number, thetaLen: number, up: number, outward: number, seg = 14, rings = 4) => {
    const g = new THREE.SphereGeometry(r * factor, seg, rings, 0, Math.PI * 2, 0, thetaLen);
    g.rotateX(Math.PI / 2);
    if (up !== 0) g.rotateX(-up);
    if (outward !== 0) g.rotateY(outward);
    return g;
  };

  const ball = part(new THREE.SphereGeometry(r, 12, 9), k.sclera, name + "Sclera", pivot);
  ball.scale.set(lens[0], lens[1], lens[2]);
  part(cap(1.03, o.iris ?? 1.0, 0.03, 0), k.iris, name + "Iris", ball);
  part(cap(1.07, o.pupil ?? 0.58, 0.03, 0), k.dark, name + "Pupil", ball);
  // TWO CATCHLIGHTS, the big one up-and-out and the small one down-and-in on
  // the far side. The beagle's own pair, and the second is not decoration:
  // a single highlight on a dark iris reads as a sticker, where two at
  // opposing angles read as a wet surface.
  part(cap(1.12, 0.21, 0.46, side * 0.3, 8, 2), k.glint, name + "Glint", ball);
  part(cap(1.12, 0.1, -0.36, -side * 0.46, 8, 2), k.glint, name + "Glint2", ball);
}

/**
 * An ear: a flattened blob on its own pivot, so `tilt` (out from the skull)
 * and `sweep` (back along it) are two numbers rather than an Euler triple
 * nobody can predict.
 *
 * IT BUILDS ITS OWN INNER EAR, and that is a correctness decision rather than
 * a convenience. The first version returned the pivot and let each kind add
 * its own inner blob at a hand-typed height — which is a height in the
 * PIVOT's units while the shell's is a fraction of `len`, so the two agreed
 * only by luck. The deer's and the fox's inner ears floated clear above the
 * ears they belong to, and on the fox they read as two black ANTENNAE. Taking
 * the position away from the caller and expressing it as a fraction of `len`
 * makes that defect unrepresentable, which is the crab's joint-gap lesson
 * (IDEA-054) applied to a different pair of parts.
 */
function ear(
  parent: THREE.Object3D,
  side: number,
  at: readonly [number, number, number],
  len: number,
  wide: number,
  thick: number,
  tilt: number,
  sweep: number,
  mat: THREE.Material,
  innerMat: THREE.Material,
  name: string,
  innerScale = 0.62,
): THREE.Group {
  const pivot = new THREE.Group();
  pivot.name = name;
  pivot.position.set(side * at[0], at[1], at[2]);
  pivot.rotation.z = -side * tilt;
  pivot.rotation.x = sweep;
  parent.add(pivot);
  const shell = part(blob(wide, len, thick), mat, name + "Shell", pivot);
  shell.position.y = len * 0.86;
  const inner = part(blob(wide * innerScale, len * 0.72, thick * 0.5), innerMat, name + "Inner", pivot);
  inner.position.set(0, len * 0.92, thick * 0.62);
  return pivot;
}

/**
 * `taperedSweepGeometry` with its surface split into TWO material groups by a
 * per-QUAD predicate — segment index along the path, and j around the ring.
 *
 * **A COLOUR REGION ON A SWEPT FORM BELONGS TO THAT FORM, NOT ON TOP OF IT.**
 * The fox's white mask was first built as a SECOND sweep of the muzzle's own
 * stations at 1.04, which is the obvious move and is wrong twice. The two
 * sweeps parallel-transport their frames from their own first tangents, so
 * their rings do not line up and the 4% offset is not uniform — the mask tore
 * through the skull in a ragged line under the eye. And even built perfectly
 * it is a second surface where the model wants a second COLOUR, which is a
 * z-fight waiting for the next retune.
 *
 * Grouping the one mesh cannot do either. It also lets the boundary run ALONG
 * the form rather than only around it, which is what a muzzle needs: white
 * sides and underside, orange bridge on top, one continuous surface.
 *
 * The triangle layout is `taperedSweepGeometry`'s own and is relied on here —
 * two per quad in (segment, j) order, then the start cap's fan, then the end
 * cap's. Reordering the index does not touch the vertices, so the normals it
 * already computed stay correct.
 */
function sweepBanded(
  stations: SweepStation[],
  radial: number,
  pick: (segment: number, j: number) => number,
): THREE.BufferGeometry {
  const geo = taperedSweepGeometry(stations, radial);
  const idx = geo.getIndex();
  if (!idx) return geo;
  const n = stations.length;
  const buckets: number[][] = [[], []];
  let t = 0;
  const take = (b: number): void => {
    buckets[b].push(idx.getX(t * 3), idx.getX(t * 3 + 1), idx.getX(t * 3 + 2));
    t++;
  };
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const b = pick(i, j);
      take(b);
      take(b);
    }
  }
  // Each cap belongs to the band of the ring it closes.
  for (let j = 0; j < radial; j++) take(pick(0, j));
  for (let j = 0; j < radial; j++) take(pick(n - 2, j));
  geo.setIndex([...buckets[0], ...buckets[1]]);
  geo.clearGroups();
  if (buckets[0].length) geo.addGroup(0, buckets[0].length, 0);
  if (buckets[1].length) geo.addGroup(buckets[0].length, buckets[1].length, 1);
  return geo;
}

/** `profile` sampled at `t` in 0..1 along a Catmull-Rom through its points.
 *
 *  LINEAR interpolation between a handful of control radii is the obvious
 *  thing and it leaves a visible CREASE at every control ring: the wall's
 *  slope changes discontinuously there, `computeVertexNormals` averages
 *  across it, and the brush comes out banded by rings nobody authored.
 *  Clamped at zero because a Catmull-Rom OVERSHOOTS on the way into a sharp
 *  tip, and a negative radius turns the last rings inside out. */
function smoothSample(p: readonly number[], t: number): number {
  const n = p.length;
  if (n < 2) return p[0] ?? 0;
  const x = THREE.MathUtils.clamp(t, 0, 1) * (n - 1);
  const i = Math.min(n - 2, Math.floor(x));
  const f = x - i;
  const at = (k: number): number => p[THREE.MathUtils.clamp(k, 0, n - 1)];
  const a = at(i - 1), b = at(i), c = at(i + 1), d = at(i + 2);
  return Math.max(
    0,
    0.5 *
      (2 * b + (-a + c) * f + (2 * a - 5 * b + 4 * c - d) * f * f + (-a + 3 * b - 3 * c + d) * f * f * f),
  );
}

/** A lathe profile resampled to `n` points along a Catmull-Rom through it.
 *
 *  **A MATERIAL BAND CAN ONLY BE AS SMOOTH AS THE GRID IT IS CUT ON.** Cutting
 *  on the lathe's own (azimuth, profile) quads is what makes the boundary
 *  exact rather than zigzagged — and "exact" on a coarse grid is a STAIRCASE.
 *  The raccoon's mask on an 11-point profile at 30 segments came out as a
 *  chequerboard: every quad was correctly classified and each one was 12
 *  degrees of arc wide. The fix is resolution, and only where it is needed —
 *  this is the one lathe in the file that carries a band.
 */
function densifyProfile(
  points: readonly (readonly [number, number])[],
  n: number,
): (readonly [number, number])[] {
  const xs = points.map((q) => q[0]);
  const ys = points.map((q) => q[1]);
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return [smoothSample(xs, t), ys[0] + (ys[ys.length - 1] - ys[0]) * smoothT(ys, t)] as const;
  });
}

/** `smoothSample` for a monotone axis, normalised 0..1 — the profile's heights
 *  run bottom to top, so interpolating them directly would need the clamp at
 *  zero that `smoothSample` applies to radii. */
function smoothT(ys: readonly number[], t: number): number {
  const lo = ys[0];
  const hi = ys[ys.length - 1];
  const norm = ys.map((y) => (y - lo) / (hi - lo));
  return Math.min(1, smoothSample(norm, t));
}

/**
 * A POINTED ear — a swept LEAF rather than `ear()`'s flattened blob, which
 * cannot come to a point however it is tuned (IDEA-065 v17 found that on the
 * fox, where two tunings of `ear()` read as a RABBIT at any size).
 *
 * Returns the same shape of subtree `ear()` does — a pivot named `<name>` with
 * `<name>Shell` and `<name>Inner` inside it — so a def's saved edits against
 * either survive the swap. `broad` scales the profile's width against its
 * length: a fox's is near 0.55 and a raccoon's near 1.0, and that one number
 * is most of what separates the two at a glance.
 */
function pointedEar(
  parent: THREE.Object3D,
  side: number,
  at: readonly [number, number, number],
  tilt: number,
  mat: THREE.Material,
  innerMat: THREE.Material,
  name: string,
  len = 0.46,
  broad = 1,
): THREE.Group {
  const pivot = new THREE.Group();
  pivot.name = name;
  pivot.position.set(side * at[0], at[1], at[2]);
  pivot.rotation.z = -side * tilt;
  pivot.rotation.x = -0.08;
  pivot.rotation.y = side * 0.2;
  parent.add(pivot);
  // Widest LOW and curving in to the point from both sides — a cone is widest
  // at its base and its silhouette is two straight lines, which reads as a
  // horn rather than as an ear.
  const PROFILE: readonly (readonly [number, number, number])[] = [
    [0, 0.43, 0.185],
    [0.08, 0.465, 0.205],
    [0.2, 0.435, 0.2],
    [0.33, 0.345, 0.16],
    [0.45, 0.215, 0.1],
    [0.55, 0.11, 0.055],
    [0.62, 0.028, 0.024],
  ];
  const leaf = (scale: number, dz: number, m: THREE.Material, n: string, hs = 1): THREE.Mesh => {
    const st: SweepStation[] = PROFILE.map(([t, w, d]) => ({
      pos: [0, t * len * hs, dz] as [number, number, number],
      rx: w * len * broad * scale,
      rz: d * len * scale,
    }));
    const mesh = part(taperedSweepGeometry(st, 14), m, n, pivot);
    mesh.castShadow = true;
    return mesh;
  };
  leaf(1, 0, mat, name + "Shell");
  // **THE INNER HAS TO CLEAR THE SHELL, AND AT 0.055 IT DID NOT.** The shell's
  // half-depth at its widest is 0.205 * len and the inner's is 0.66 of that,
  // so the inner needs to step forward by their DIFFERENCE before any of it
  // is outside — at 0.055 its front face sat 0.007 * len inside and the ear
  // rendered as a solid flap with a speck on it. Buried, correctly built and
  // correctly coloured, for the seventh time in this file.
  leaf(0.66, len * 0.115, innerMat, name + "Inner", 0.88);
  return pivot;
}

/** How far round the tufts travel between the root and the tip, in radians
 *  of the angular phase. Straight ridges read as a fluted column. */
const TUFT_SPIRAL = 6.0;
/** `tuft`'s own mean over a period, subtracted so the fluff averages to
 *  nothing and `profile` still means the radius it says. */
const TUFT_MEAN = 0.4244;
/** A cosine mapped to 0..1 and sharpened: convex peaks over a broad shallow
 *  floor. **THE EXPONENT IS BOUNDED AT BOTH ENDS AND THE UPPER BOUND IS A
 *  SAMPLING LIMIT.** At 1 it is the symmetric wave this replaced, creases and
 *  all. At 1.5 the peak spans 42% of its period, so `radial / lobes` of six
 *  puts two and a half columns across it and the tuft is a round bump; at 1.9
 *  it is 37% and two columns, and the bumps came back FACETED — hard
 *  polygonal creases where neighbouring tufts meet, which is the crumpled
 *  sheet again in a smaller font. Sharpen this and `radial` must go up with
 *  it. */
function tuft(x: number): number {
  return Math.pow((Math.cos(x) + 1) * 0.5, 1.5);
}

/**
 * A tail swept along a curve — the raccoon's RINGS, the squirrel's plume and
 * the fox's brush — with the colour bands assigned as per-triangle MATERIAL
 * GROUPS by RING INDEX. Classifying by a triangle's own height instead puts
 * the two halves of every quad on opposite sides of a boundary and the band
 * edge zigzags around the circumference — IDEA-055 rule 3, and the same
 * defect as IDEA-047's "spiky markings".
 *
 * **THE WALLS FACE OUTWARD AND THE ENDS ARE CAPPED, AND NEITHER WAS TRUE
 * UNTIL v16** (Nuno: *"the tail is transparent"*). It was wound
 * `(a, c, d) / (a, d, b)`, which is the OPPOSITE orientation to
 * `taperedSweepGeometry`'s `(a, b, c) / (b, d, c)` — so every wall normal
 * pointed INWARD. Measured on the shipped model: 518 of the fox's 528 tail
 * faces, 372 of the raccoon's and 356 of the squirrel's. A back-facing wall
 * is CULLED, so the near side of the tube is not drawn at all and what
 * reaches the screen is the INSIDE of the far wall — a tail you can see the
 * body through, lit from the wrong side. `taperedSweepGeometry`'s own header
 * records this exact defect on the beagle ("the dog rendered hollow"), which
 * is the second time this project has shipped it.
 *
 * Capping the ends is the other half and it retires a whole class of fix: an
 * OPEN tube has two visible rims, and the fox's comments carried two separate
 * workarounds for them (bury the base inside the rump, make the tip blob
 * wider than the final ring). A capped tube needs neither, which is what lets
 * the brush come to a POINT instead of a cream ball.
 *
 * `profile` replaces the r0..r1 lerp when a tail is not a simple taper: a
 * fox's brush is narrow where it leaves the rump, widest at about its middle
 * and finishes in a point, which no pair of end radii can describe.
 * `tipFrom` is a SINGLE colour boundary (the brush going white) where `bands`
 * is an alternating one (the raccoon's rings) — two different questions, so
 * two different dials rather than one overloaded count.
 */
function ringedTail(
  curve: THREE.Curve<THREE.Vector3>,
  r0: number,
  r1: number,
  rings: number,
  radial: number,
  bands: number,
  opts: {
    profile?: readonly number[];
    tipFrom?: number;
    /** Lobed, scalloped fur. See the note in the body. */
    fluff?: { lobes: number; along: number; amount: number };
    /**
     * Band 1 covers the OUTER side of the curl: every vertex whose offset
     * from the curve points away from the curl's own centre by at least this
     * much (a cosine, so 0 is the half facing outward and 0.7 a narrow rim).
     *
     * A squirrel's plume is pale along the whole outer EDGE of its curl, not
     * across its tip: `tipFrom` cuts a clean ring, which on a tail reads as a
     * sock or a bandage. This cuts along the length instead.
     *
     * **IT CANNOT BE DONE WITH THE RING'S ANGLE.** `computeFrenetFrames`
     * picks an ARBITRARY initial normal — the smallest component of the first
     * tangent — and parallel-transports it, so `N` is not the curvature
     * normal and `cos(a)` has no fixed relationship to which side of a curl a
     * vertex is on. Two sign choices put the band on the hidden inner side
     * and then on the camera-facing face before that was the obvious
     * explanation. Measured against the curve's own CENTROID it is a
     * geometric fact and needs no frame at all.
     */
    outer?: number;
  } = {},
): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const frames = curve.computeFrenetFrames(rings, false);
  // The curl's own centre, for `outer`. A C-shaped plume has its centroid
  // inside the C, so "away from the centroid" is the convex side.
  const hub = new THREE.Vector3();
  for (let i = 0; i <= rings; i++) hub.add(curve.getPointAt(i / rings));
  hub.divideScalar(rings + 1);
  /** Is the vertex at (t, a) on the outward-facing side of the curl? */
  const isOuter = (t: number, a: number): number => {
    if (opts.outer === undefined) return 0;
    const p = curve.getPointAt(Math.min(1, Math.max(0, t)));
    const i = Math.round(Math.min(1, Math.max(0, t)) * rings);
    const off = frames.normals[i]
      .clone()
      .multiplyScalar(Math.cos(a))
      .add(frames.binormals[i].clone().multiplyScalar(Math.sin(a)))
      .normalize();
    return off.dot(p.clone().sub(hub).normalize()) > opts.outer ? 1 : 0;
  };
  const radiusAt = (t: number): number => {
    if (opts.profile) return smoothSample(opts.profile, t);
    // A tail is fat at the base, fatter still at the shoulder of the brush,
    // and comes to a tip. A straight taper reads as a carrot.
    const bulge = Math.sin(Math.PI * Math.min(1, t * 1.15)) * 0.28 + 1;
    return THREE.MathUtils.lerp(r0, r1, t) * bulge;
  };
  // Which band a ring belongs to. Decided once for the whole ring, so the
  // boundary is a clean circle.
  const bandAt = (t: number, outerBand = 0): number => {
    if (opts.outer !== undefined) return outerBand;
    if (opts.tipFrom !== undefined) return t >= opts.tipFrom ? 1 : 0;
    // ONE BAND MEANS ONE BAND, and the guard is not cosmetic: the far cap is
    // generated at t = 1 exactly, where `floor(1 * 1) % 2` is **1** — so a
    // single-material tail put its apex in a band whose material does not
    // exist and three.js drew nothing there. A hole in the tip of the
    // squirrel's plume, from a tail asking for no banding at all.
    if (bands <= 1) return 0;
    return Math.floor(t * bands) % 2;
  };
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const p = curve.getPointAt(t);
    const N = frames.normals[i];
    const B = frames.binormals[i];
    const r = radiusAt(t);
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      // **FLUFF IS A WANDERING RADIUS, AND IT HAS TO WANDER OUTWARD.** A tube
      // of constant cross-section is a sausage however well its profile is
      // tuned — the squirrel's plume read as a croissant. Lobes AROUND the
      // ring break the circular silhouette; scallops ALONG it stop those
      // lobes reading as straight ridges running the whole length. The lobe
      // count must be a whole number or the seam at a = 0 does not meet, and
      // `radial` has to be four or five times it or the lobes are sampled too
      // coarsely to exist at all — the same floor the surround's conifer
      // serration ran into (IDEA-065 rule 8).
      //
      // **A SYMMETRIC WAVE MAKES CREASES, AND A TUFT IS CONVEX.** The first
      // build perturbed the radius with a plain cosine, so every bump bought
      // itself an equally deep VALLEY — and a valley cut across a curved
      // surface is a FOLD. At review size the plume came back as a crumpled
      // sheet, a cabbage leaf rather than a tail: correct volume, correct
      // silhouette width, and made of creases. `tuft` is the same cosine
      // mapped to 0..1 and raised to a power, so it has narrow convex peaks
      // over broad shallow floors; the mean is subtracted so the perturbation
      // still averages to nothing and the profile keeps meaning what it says.
      // Fur sticks OUT of a mass. It does not dent it.
      //
      // The angular phase drifts with t so the tufts SPIRAL — dead-straight
      // ridges read as a fluted column, which is the other half of the same
      // defect. And what carries any of this at 35 pixels is not the bumps,
      // it is the matcap banding on a normal that now changes across the
      // form — IDEA-068's lesson, which is why a few big tufts beat fine
      // noise.
      let r2 = r;
      if (opts.fluff) {
        const f = opts.fluff;
        r2 *=
          1 +
          f.amount *
            (0.62 * tuft(f.lobes * a + t * TUFT_SPIRAL) +
              0.38 * tuft(f.along * Math.PI * 2 * t) -
              TUFT_MEAN);
      }
      const v = N.clone().multiplyScalar(Math.cos(a) * r2).add(B.clone().multiplyScalar(Math.sin(a) * r2)).add(p);
      pos.push(v.x, v.y, v.z);
    }
  }
  const groups: number[][] = [[], []];
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < radial; j++) {
      // The quad's MID angle, so an angular boundary lands between columns
      // rather than on one.
      const mid = ((j + 0.5) / radial) * Math.PI * 2;
      const band = bandAt(i / rings, isOuter(i / rings, mid));
      const a = i * radial + j;
      const b = i * radial + ((j + 1) % radial);
      const c = (i + 1) * radial + j;
      const d = (i + 1) * radial + ((j + 1) % radial);
      // (a, b, c) / (b, d, c) — `taperedSweepGeometry`'s order, which is what
      // puts the wall normals OUTWARD. See the header.
      groups[band].push(a, b, c, b, d, c);
    }
  }
  // END CAPS, each in its own end's band, wound to face out of the tube.
  const base = pos.length / 3;
  const p0 = curve.getPointAt(0);
  pos.push(p0.x, p0.y, p0.z);
  for (let j = 0; j < radial; j++) {
    groups[bandAt(0, isOuter(0, ((j + 0.5) / radial) * Math.PI * 2))].push(base, ((j + 1) % radial), j);
  }
  const apex = pos.length / 3;
  const p1 = curve.getPointAt(1);
  pos.push(p1.x, p1.y, p1.z);
  for (let j = 0; j < radial; j++) {
    groups[bandAt(1, isOuter(1, ((j + 0.5) / radial) * Math.PI * 2))].push(apex, rings * radial + j, rings * radial + ((j + 1) % radial));
  }
  idx.push(...groups[0], ...groups[1]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  if (groups[0].length) geo.addGroup(0, groups[0].length, 0);
  if (groups[1].length) geo.addGroup(groups[0].length, groups[1].length, 1);
  geo.computeVertexNormals();
  // THE RING LAYOUT IS STAMPED ON THE GEOMETRY, for the test rather than for
  // the renderer. A tail is a swept form with no convenient axis — picking
  // one is how the raccoon's tip check came to measure "the last 6% of z" and
  // scoop up fat rings from two thirds of the way along — and re-deriving
  // (rings, radial) from a vertex count in a test is this project's own
  // "an instrument must not pin a COUNT it does not own". The vertices are
  // ring-major: ring i, column j is at `i * radial + j`, then the two apexes.
  geo.userData.tail = { rings, radial, fluff: opts.fluff ?? null };
  return geo;
}

/** Where the raccoon's eye sits on its skull — and therefore where the painted
 *  mask is centred, since the two must not drift apart. These are the numbers
 *  Nuno authored in the Props tab; the mask band reads them rather than
 *  carrying a second copy. */
const RACCOON_EYE: readonly [number, number, number] = [0.236, 0.1, 0.385];

/** The raccoon's skull in profile — radius against height, both normalised,
 *  scaled to size by `latheFromProfile`.
 *
 *  **WIDEST LOW AND FLATTER ON TOP.** A sphere's widest point is its equator
 *  and a raccoon's is its JOWLS, well below the eye; the crown then falls away
 *  much faster than a sphere's does. `blob()` is a scaled sphere, so it can
 *  make the head wider than it is deep and it cannot make it this shape at
 *  all. */
const RACCOON_SKULL_PROFILE = [
  [0.001, -0.5],
  [0.23, -0.455],
  [0.4, -0.355],
  [0.475, -0.23],
  [0.5, -0.09],
  [0.493, 0.05],
  [0.455, 0.19],
  [0.39, 0.31],
  [0.3, 0.405],
  [0.17, 0.47],
  [0.001, 0.5],
] as const;

/** Every critter's palette in one table, so "what colour is a fox" is a
 *  lookup rather than six numbers scattered through six builders. Sampled off
 *  the references; a def's own `furColor`/`bellyColor`/`accentColor` override
 *  any of them. */
const CRITTER_COLORS: Record<
  ForestCritterKind,
  { fur: number; belly: number; accent: number; height: number; accentIsInk?: boolean }
> = {
  // `height` is the critter's own standing height in WORLD UNITS at scale 1,
  // and it is per-kind on purpose: a deer and a rabbit are not the same size,
  // and making them so would be the one thing about a set of woodland animals
  // that nothing else could excuse.
  deer: { fur: 0xc97f3e, belly: 0xf2e2c8, accent: 0x6b4a2f, height: 0.95 },
  // `accentIsInk` DECLARES that this kind's accent is a MARKING, not a
  // surface — the fox's black stockings and the raccoon's mask, both of which
  // are near-black and were therefore matched against the palette's NEUTRALS
  // and lifted to `slate`, a blue-grey. The fox shipped in blue boots and the
  // raccoon's mask came out the same colour as its own face, which is its
  // identity gone entirely. Colour cannot decide this (madboxStyle.ts's own
  // rule); the KIND can, because whether a dark patch is a marking or a
  // surface is a fact about the animal. The deer's accent is its antlers and
  // the rabbit's is a pink inner ear, so neither declares it.
  fox: { fur: 0xe07a2c, belly: 0xf6efe2, accent: 0x2e2620, height: 0.58, accentIsInk: true },
  rabbit: { fur: 0xd9a468, belly: 0xf4e3c6, accent: 0xe8a3a0, height: 0.62 },
  raccoon: { fur: 0x8d8a86, belly: 0xc9c4bc, accent: 0x2f2c2a, height: 0.6, accentIsInk: true },
  squirrel: { fur: 0xd4682a, belly: 0xf3e6d2, accent: 0x8a3f14, height: 0.58 },
  squirrelExplorer: { fur: 0xdd6f24, belly: 0xf6ead6, accent: 0xd8c99a, height: 0.68 },
};

interface Kit {
  fur: THREE.MeshToonMaterial;
  belly: THREE.MeshToonMaterial;
  accent: THREE.MeshToonMaterial;
  dark: THREE.MeshToonMaterial;
  /** The coloured ring between the sclera and the pupil — the beagle's eye
   *  has one and these did not, which is most of why theirs read as dots. */
  iris: THREE.MeshToonMaterial;
  sclera: THREE.MeshToonMaterial;
  glint: THREE.MeshBasicMaterial;
}

function kitFor(kind: ForestCritterKind, params: PropParams): Kit {
  const c = CRITTER_COLORS[kind];
  // THE PUPIL AND THE NOSE ARE MARKINGS, AND THEY HAD BEEN RENDERING BLUE
  // (IDEA-065 v6). `#27211d` is a near-black, so its saturation is under
  // `NEUTRAL_MAX_S` and the style matched it against the NEUTRALS alone — of
  // which the darkest is `slate`, a blue-grey at L 0.203. Every eye and every
  // nose on all six animals was a soft mid blue dot instead of a black one,
  // which is most of why the deer read as beady rather than as cute. This is
  // madboxStyle.ts's own example of what the ink role is for, word for word:
  // "a pupil, a nose". Nothing can infer it from the colour, which is exactly
  // why the tag exists.
  const dark = toon({ color: 0x27211d });
  dark.userData.madboxRole = "ink";
  // AND THE SCLERA HAD TO BECOME A TRUE NEUTRAL TO STAY WHITE. At #f8f3e8 its
  // saturation is 0.53, so it was matched against the COLOURS and landed on
  // `sand` — the same entry as the deer's own belly and muzzle, so the white
  // of the eye was the same value as the face around it and the eye lost its
  // outline. A hair of warmth is worth keeping in the classic look, so it is
  // pulled just under the neutral threshold rather than to flat white.
  const sclera = toon({ color: 0xf4f3f0 });
  // THE IRIS, AND ITS VALUE IS CHOSEN FROM THE LADDER RATHER THAN FROM A
  // DEER'S EYE. It has to sit between a white sclera and a near-black pupil
  // AND clear the fur it is surrounded by, and in the shipped palette the
  // warm family offers cream / sand / wood / bark / inkWarm. Every brown from
  // #a2672e down to #4a2d16 snaps to **`wood`** — which is the critters' own
  // FUR — so the obvious choices all paint an iris the colour of the face
  // around it. #6e4a30 is the one that lands on `bark`, a rung below the fur
  // and three above the pupil, and it is a true dark brown in the classic
  // look as well.
  // AND IT HAD TO BE PROBED RATHER THAN PICKED. `NEUTRAL_MAX_S` is a cliff,
  // not a ramp: #f4f3f0 (s 0.154) lands on `white`, #f6f4f1 (s 0.26) lands on
  // **`bark`** — two hexes three bytes apart, at opposite ends of the
  // palette. Author comfortably inside a band, never on its edge, and check
  // with `scripts/_scratch-snap-probe.ts` rather than by eye.
  return {
    fur: toon({ color: params.furColor ?? c.fur }),
    belly: toon({ color: params.bellyColor ?? c.belly }),
    accent: (() => {
      const m = toon({ color: params.accentColor ?? c.accent });
      if (c.accentIsInk) m.userData.madboxRole = "ink";
      return m;
    })(),
    dark,
    iris: toon({ color: 0x6e4a30 }),
    sclera,
    // The one deliberate unlit material, exactly as characters.ts's eye
    // glint is: a toon ramp quantises a highlight into the same band as
    // everything else facing the light and it stops reading as a catchlight.
    glint: new THREE.MeshBasicMaterial({ color: 0xffffff }),
  };
}

/**
 * Scale a finished critter so it stands exactly `target` units tall with its
 * lowest point on y = 0, measured from VERTICES.
 *
 * Every builder below works in HEAD UNITS, which is how the references were
 * read and the only frame in which "the rabbit's ears are 1.2 heads" is a
 * sentence. Solving by hand what head size makes a rabbit 0.62 units tall
 * once its ears are on is arithmetic nobody should do twice, and it has to be
 * redone the moment an ear angle changes.
 *
 * It measures vertices rather than calling `Box3.setFromObject`, because that
 * builds each mesh's box in LOCAL space and transforms the eight corners — so
 * a tilted ear or a swept tail over-reports (the project measured 15% on the
 * burger and 56% on the garden shrub). Here the error would land directly in
 * the prop's size.
 */
function fitToHeight(group: THREE.Object3D, target: number): void {
  group.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  let lo = Infinity;
  let hi = -Infinity;
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const pos = m.geometry.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos as THREE.BufferAttribute, i).applyMatrix4(m.matrixWorld);
      if (v.y < lo) lo = v.y;
      if (v.y > hi) hi = v.y;
    }
  });
  if (!isFinite(lo) || hi <= lo) return;
  const k = target / (hi - lo);
  group.scale.multiplyScalar(k);
  group.position.y = -lo * k;
}

// ---------------------------------------------------------------------------
// THE UPRIGHT CRITTERS — rabbit, raccoon, squirrel, squirrel explorer.
//
// One body plan, in HEAD UNITS: a pear of two masses (a wide haunch sitting on
// the ground and a narrower chest above it), a head on top, two short arms
// held in front, two feet peeping out at the bottom, and a tail. The
// references agree on all of it — a cartoon woodland animal standing up is
// drawn this way whatever species it is — and they disagree on exactly three
// things, which is why those three are what each kind overrides:
//
//   the EARS, the TAIL, and whether the face carries a MASK.
//
// That is not a simplification, it is the finding. At the apron those three
// are the only parts big enough to read, so they are also the only parts
// worth building differently.
// ---------------------------------------------------------------------------

function uprightBody(kind: ForestCritterKind, k: Kit, rnd: () => number): THREE.Group {
  const g = new THREE.Group();

  // --- 0/1: the pear. Two masses, not one, and not three: one ball reads as
  // a pebble with a head, and the chest/haunch step is what gives a standing
  // animal its shoulders.
  const haunch = part(blob(0.74, 0.74, 0.7), k.fur, "haunch", g);
  haunch.position.set(0, 0.68, -0.04);
  const chest = part(blob(0.56, 0.56, 0.54), k.fur, "chest", g);
  chest.position.set(0, 1.32, 0.03);

  // --- 2: the belly. A paler patch standing PROUD of the front of both
  // masses rather than painted on: this renderer has no outline pass, so a
  // flush colour change on a curved surface has nothing to define its edge
  // but the colour itself, and at 25px that edge is what says "bib".
  const bib = part(blob(0.42, 0.74, 0.34), k.belly, "bib", g);
  bib.position.set(0, 1.0, 0.42);

  // --- 3: the head.
  const head = new THREE.Group();
  head.name = "head";
  head.position.set(0, 2.0, 0.06);
  g.add(head);
  if (kind === "raccoon") {
    // **THE SKULL IS A SHAPED LATHE AND ITS MASK IS PAINTED ON IT** (v23,
    // Nuno: *"the skull is too rounded... and the mask and the browWhite
    // should not be components, they should be a colour pattern on the
    // skull"*).
    //
    // **WHY THE MASK HAD TO STOP BEING SOLIDS.** A patch stuck on has to
    // stand PROUD to be seen, so it has a silhouette of its own — and at any
    // angle where that silhouette shows, the marking reads as an OBJECT on
    // the head rather than as colour on it. That is what put this animal in
    // sunglasses twice.
    //
    // **AND IT IS CUT WITH `splitCoatGroups`, NOT ON THE LATHE'S GRID** (v24,
    // Nuno: *"behind the eyes the white and black pattern are pixelized, lets
    // make that smooth"*). Assigning whole QUADS to a band is exact in the
    // sense that it follows edges that already exist — and exact on a grid is
    // a STAIRCASE, which at 11 profile points and 30 segments came out a
    // literal chequerboard. Throwing resolution at it is a QUADRATIC bill
    // (34 x 64 was ~4k triangles for one skull and still visibly stepped
    // above apron size).
    //
    // `splitCoatGroups` SPLITS a triangle that straddles a region's boundary
    // along the region's true curve, which is the same machinery the beagle's
    // tricolor coat has used since IDEA-047 and for exactly this reason — its
    // own header calls the alternative "the spiky markings of the first
    // pass". The seam is then smooth at ANY mesh resolution, so the lathe
    // goes back down to 44 x 18 and the skull costs a third of what the
    // banded one did.
    //
    // **WHY IT IS NOT A SPHERE.** A raccoon's head is widest LOW, at the
    // jowls, and flattens toward the crown — and it is wider than it is deep.
    // `blob()` is a scaled sphere and can say the second but not the first.
    const SK_W = 1.08;
    const SK_H = 0.94;
    const SK_D = 0.86;
    // The mask is centred on the EYE and takes its centre from the same
    // constant the eye is placed with, so the two cannot drift apart. That
    // point already sits on the skull's surface, which is what makes a blob
    // centred there carve a round patch ON it.
    const [ex, ey, ez] = RACCOON_EYE;
    // Sized from the patches as Nuno had authored them: half-width 0.236
    // against a skull half-width of 0.54 is about 26 degrees of arc, and 0.16
    // of height. The white is the same shape, larger — it exists to give the
    // black an EDGE, which on a grey head nothing else does.
    const eye = (r: number, ry: number, mat: number): CoatRegion[] => [
      { kind: "blob", center: [-ex, ey, ez], radii: [r, ry, r], mat },
      { kind: "blob", center: [ex, ey, ez], radii: [r, ry, r], mat },
    ];
    part(
      splitCoatGroups(
        latheFromProfile(densifyProfile(RACCOON_SKULL_PROFILE, 18), 44, SK_W, SK_H, SK_D),
        0,
        // Declaration order is paint order — the LAST region to claim a
        // triangle wins — so the white goes down first and the black over it.
        [...eye(0.33, 0.25, 2), ...eye(0.26, 0.19, 1)],
      ),
      [k.fur, k.accent, k.belly],
      "skull",
      head,
    );
  } else {
    part(blob(0.5, 0.48, 0.48), k.fur, "skull", head);
  }
  // THE RACCOON'S SNOUT IS TWO JAWS (v21, Nuno: *"the snout should be a snout
  // like with two part upper and lower jaw"*). This part is the UPPER one, so
  // for the raccoon it is shallower and carried higher — the lower jaw is
  // appended after the ears, where a new part has to go so the saved edits on
  // everything above it keep pointing at the same thing.
  //
  // **HERE THE CREASE IS THE FEATURE.** Everywhere else in this file two
  // overlapping solids meeting at a normal discontinuity is the defect being
  // designed out; a mouth is the one place the eye is meant to read that line,
  // so the two jaws are deliberately two masses and not one form.
  const rac = kind === "raccoon";
  const muzzle = part(
    rac ? blob(0.285, 0.165, 0.26) : blob(0.28, 0.22, 0.26),
    k.belly,
    "muzzle",
    head,
  );
  muzzle.position.set(0, rac ? -0.1 : -0.14, rac ? 0.37 : 0.36);
  const nose = part(blob(0.09, 0.07, 0.07), k.accent, "nose", head);
  nose.position.set(0, rac ? -0.04 : -0.06, rac ? 0.57 : 0.56);

  // THE EYE SITS IN FRONT OF THE MASK, and the mask is now paint on the
  // skull rather than a disc pressed to it — see the skull above. The eye's
  // own placement is the mask's centre, which is why it is a named constant.
  const eyeR = 0.13;
  const eyeZ = kind === "raccoon" ? RACCOON_EYE[2] : 0.38;
  for (const s of [-1, 1]) {
    eye(head, s, [kind === "raccoon" ? RACCOON_EYE[0] : 0.21, kind === "raccoon" ? RACCOON_EYE[1] : 0.1, eyeZ], k, s < 0 ? "eyeL" : "eyeR", { r: eyeR });
  }

  // --- 4/5: the arms, held in front. Aimed by endpoints (see `limb`).
  //
  // **THE RACCOON GETS HANDS** (v25, Nuno: *"lets focus on the paws, the arms
  // and the feet, lets improve this to look like a really cute paw instead a
  // pill"*). A raccoon's hands are its signature — long slender dark fingers
  // on a small palm, which is the one thing in the reference that no other
  // animal in this set has. A capsule says none of it.
  //
  // **ONLY THE RACCOON**, deliberately: `uprightBody` builds the rabbit and
  // both squirrels too, and IDEA-060's rule is that rewriting a shared part
  // silently re-dresses animals nobody is reviewing. A rabbit's forepaw is a
  // stub and should stay one.
  const racPaw = kind === "raccoon";
  //
  // **CHUNKY, BECAUSE A THIN ROD CANNOT BE DARK UNDER A MATCAP.** The first
  // pair were slender and rendered BRIGHT — nearly white — against a palm of
  // the same material that rendered black. A matcap is sampled by the
  // view-space NORMAL, and a thin cylinder seen side-on has almost every
  // normal perpendicular to the view, which lands in the matcap's outer disk:
  // the BOUNCE colour, not the base. A sphere shows mostly its centre and so
  // reads as its own colour. So "thin and dark" is not representable here at
  // all, and the finger has to be thick enough for its normals to reach the
  // middle of the matcap. That is also what a cute paw wants, which is the
  // happier half of the constraint.
  const FINGER: SweepStation[] = [
    { pos: [0, 0, 0], rx: 0.062, rz: 0.064 },
    { pos: [0, 0.075, 0.005], rx: 0.058, rz: 0.06 },
    { pos: [0, 0.15, 0.008], rx: 0.047, rz: 0.048 },
    { pos: [0, 0.215, 0.005], rx: 0.031, rz: 0.031 },
    // Rounded off rather than brought to a point: a needle tip is thin by
    // definition and goes bright again.
    { pos: [0, 0.245, 0], rx: 0.014, rz: 0.014 },
  ];
  /** Four fingers fanned about the group's own +Y, longest in the middle. */
  const digits = (host: THREE.Object3D, name: string, len: number, spread: number, baseY = 0): void => {
    for (let i = 0; i < 4; i++) {
      const a = (i - 1.5) * spread;
      // The middle pair are longer, as a hand's are — four of one length is a
      // RAKE, and that is most of what makes a fan of rods read as fingers.
      const grow = 1 - Math.abs(i - 1.5) * 0.11;
      const d = part(
        taperedSweepGeometry(
          FINGER.map((st) => ({
            pos: [st.pos[0], st.pos[1] * len * grow, st.pos[2]] as [number, number, number],
            rx: st.rx,
            rz: st.rz,
          })),
          8,
        ),
        k.accent,
        `${name}${i}`,
        host,
      );
      // **THE FAN SPRINGS FROM THE PALM'S FAR EDGE, NOT ITS CENTRE.** At the
      // host's origin the outer fingers leave through the SIDE of the palm,
      // which reads as a ball with fingers stuck on it rather than as a hand.
      d.position.set(0, baseY, 0);
      d.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(Math.sin(a), Math.cos(a), 0.22).normalize(),
      );
      d.castShadow = true;
    }
  };
  for (const s of [-1, 1]) {
    const from: [number, number, number] = [s * 0.44, 1.5, 0.18];
    const to: [number, number, number] = [s * 0.26, 1.06, 0.46];
    const name = s < 0 ? "armL" : "armR";
    if (!racPaw) {
      limb(from, to, 0.14, k.fur, name, g);
      continue;
    }
    // TAPERED, shoulder to wrist. `flaredLimb` keeps `limb`'s placement
    // contract exactly — geometry about the midpoint in local +Y, same
    // position and quaternion — which matters because props.ts carries a
    // hand-authored position against this very part.
    const arm = flaredLimb(
      from,
      to,
      // ROUNDED AT THE SHOULDER, not cut off. The authored arm starts inside
      // the chest, where a flat end cap is invisible — but props.ts carries a
      // hand-authored position that brings the arm FORWARD, out of the chest,
      // and the cap then shows as a flat disc on the shoulder. A first
      // station near zero closes it to a dome, which costs nothing and is
      // right wherever the arm is moved to.
      [
        [0.055, 0.055],
        [0.15, 0.15],
        [0.138, 0.138],
        [0.112, 0.112],
        [0.072, 0.072],
      ],
      k.fur,
      name,
      g,
    );
    // THE HAND HANGS INSIDE THE ARM, so it follows wherever the arm is moved
    // — including by a saved edit. The arm's local +Y runs toward the wrist.
    const len = new THREE.Vector3(...to).sub(new THREE.Vector3(...from)).length();
    // **A HEEL CLOSES THE WRIST.** Bringing the hand back onto the chest
    // leaves it 0.125 short of where the arm ends, and the sweep's own end
    // cap then shows as a dark hole in the forearm. This sits at the arm's
    // end — in the ARM's frame, where that end is simply local +Y — and is
    // wide enough to meet the palm, so wrist and hand read as one dark mass
    // however far the hand is set back.
    const heel = part(blob(0.088, 0.085, 0.088), k.accent, s < 0 ? "heelL" : "heelR", arm);
    heel.position.set(0, len / 2 - 0.035, 0);
    const hand = new THREE.Group();
    hand.name = s < 0 ? "handL" : "handR";
    hand.position.set(0, len / 2 - 0.02, 0);
    // **THE HAND FOLLOWS THE FOREARM, AND THAT IS THE WHOLE FIX** (v27,
    // Nuno: *"I already put the arm on the position, just help me fix the
    // fingers"*).
    //
    // Every earlier version aimed the hand in BODY space and then cancelled
    // the arm's own rotation out of it — `Qarm^-1 * Qdesired` — so that the
    // fingers pointed the same way whatever the arm did. That is wrong twice
    // over. It is wrong anatomically, because a hand is carried by its
    // forearm and turning the arm turns the hand. And it is wrong in THIS
    // editor, because the cancellation uses the AUTHORED arm quaternion while
    // props.ts replaces it: pose the arm in the Props tab and the hand ends
    // up at `Qsaved * Qauthored^-1 * Qdesired`, which is nowhere anybody
    // asked for. That is exactly what left the raised hand's fingers splayed
    // at random after the arms were posed into a wave.
    //
    // A plain local orientation is the answer. The hand continues along the
    // arm's own +Y, so posing the arm aims the fingers — and ROLLING the arm
    // turns the fan, which is what rolling a real forearm does to a palm.
    // Both controls end up where someone posing an arm would look for them,
    // and nothing in here has to know what the arm was authored as.
    // **AND THE ROLL IS SOLVED, NOT GUESSED.** `rotation.y` here turns the fan
    // about the arm's own axis without changing where the fingers point — the
    // one control a wrist needs once it follows the forearm. Which way the
    // fan ends up facing is a consequence of the ARM's roll, and props.ts
    // sets each arm's rotation outright, so it is Nuno's pose that decides
    // it: at 0 the fingers were edge-on to the viewer and the whole hand read
    // as a dark spike. `scripts/_scratch-raccoon-roll.ts` sweeps the value
    // and reports which one turns the palm toward the animal's FRONT —
    // solved in the BODY's frame, because `makeForestCritter` gives every
    // instance a random yaw and a world-space answer is contaminated by
    // whichever seed the probe happened to use.
    //
    // These two are therefore tuned against the arm pose saved in props.ts.
    // Re-pose an arm and re-run that script; or roll the ARM instead, which
    // costs nothing visually because a forearm is a circular taper.
    hand.rotation.set(-0.22, s < 0 ? -1.64 : 1.75, 0);
    arm.add(hand);
    // A PAD, not a ball: wide across the fan (local x), short along the
    // fingers (y), thin through the palm (z). A sphere has no edge for the
    // fingers to leave from.
    const palm = part(blob(0.165, 0.085, 0.082), k.accent, s < 0 ? "palmL" : "palmR", hand);
    palm.position.set(0, -0.012, 0);
    digits(hand, s < 0 ? "fingerL" : "fingerR", 1, 0.3, 0.055);
  }
  // --- 6/7: the feet, peeping out at the front. Without them the pear sits
  // on the soil like a dropped egg.
  for (const s of [-1, 1]) {
    const name = s < 0 ? "footL" : "footR";
    if (!racPaw) {
      const f = part(blob(0.2, 0.13, 0.31), k.fur, name, g);
      f.position.set(s * 0.34, 0.13, 0.42);
      continue;
    }
    // A SOLE AND FOUR TOES, and DARK like the hands — the reference's feet
    // are the same near-black as its fingers, where this one had grey pills.
    const foot = new THREE.Group();
    foot.name = name;
    foot.position.set(s * 0.34, 0.12, 0.38);
    g.add(foot);
    const sole = part(blob(0.2, 0.11, 0.21), k.accent, s < 0 ? "soleL" : "soleR", foot);
    sole.castShadow = true;
    const toes = new THREE.Group();
    toes.name = s < 0 ? "toesL" : "toesR";
    toes.position.set(0, -0.015, 0.165);
    // Toes run FORWARD, not up: the fan is the same helper, turned onto the
    // floor. Shorter and blunter than the fingers, which is the difference
    // between a hand and a foot.
    toes.rotation.x = Math.PI / 2;
    foot.add(toes);
    digits(toes, s < 0 ? "toeL" : "toeR", 0.72, 0.4);
  }

  // --- 8/9: the ears. Identity separator #1 between four animals that are
  // otherwise the same tan pear.
  const earMat = k.fur;
  if (kind === "rabbit") {
    // THE TALLEST THING ON THE ANIMAL, and that is the whole point: a rabbit
    // is recognised from across a field by two vertical lines above a round
    // body. Narrow, long, and barely splayed.
    for (const s of [-1, 1]) {
      ear(head, s, [0.17, 0.36, -0.04], 0.62, 0.15, 0.11, 0.17, -0.1, earMat, k.accent, s < 0 ? "earL" : "earR", 0.66);
    }
  } else if (kind === "raccoon") {
    // POINTED, not round (v21, Nuno: *"lets make the ears more point and not
    // so rounded"*). `ear()` builds a flattened BLOB and a blob cannot come to
    // a point — the same thing the fox's ears ran into, and the reason that
    // one is a swept LEAF. The raccoon's is the fox's construction at the
    // raccoon's own proportion: BROADER and shorter, because a tall narrow
    // one is a fox's and these two already share a silhouette class.
    //
    // Still LOW and barely splayed: at tilt 0.5 and set high they stood off
    // the skull as two loose balls, which is the "blob assembly" read this
    // project has been moving away from since IDEA-047.
    for (const s of [-1, 1]) {
      // BROAD, but not as broad as it is long. At `broad` 1 the leaf was as
      // wide as it was tall and, leaning out, read as a floppy FLAP; at 0.76
      // it was a cat's spike. The reference's is about 1.2 tall-for-wide —
      // a rounded triangle, not a horn — and carried upright.
      pointedEar(head, s, [0.32, 0.22, -0.03], 0.2, earMat, k.belly, s < 0 ? "earL" : "earR", 0.5, 0.88);
    }
  } else {
    // Squirrel: upright, TUFTED. The tuft is the give-away and it is one
    // extra blob, so it stays even though it is two pixels on the board — it
    // costs nothing and it is what the reference draws first.
    for (const s of [-1, 1]) {
      const p = ear(head, s, [0.24, 0.34, -0.04], 0.3, 0.17, 0.1, 0.2, -0.06, earMat, k.belly, s < 0 ? "earL" : "earR", 0.55);
      const tuft = part(blob(0.1, 0.2, 0.08), k.accent, "tuft", p);
      tuft.position.set(0, 0.3 * 2.0, -0.02);
    }
  }

  // --- THE RACCOON'S FACE FURNITURE (v21). Everything here is APPENDED after
  // the ears rather than written beside the part it belongs with, and that is
  // deliberate: `props.ts` carries eight hand-authored edits against this
  // animal addressed by INDEX PATH, so a part inserted earlier in the head
  // would silently re-point every one of them onto something else. New parts
  // go at the END of the child list — IDEA-065 rule 23.
  if (kind === "raccoon") {
    // **THE LOWER JAW.** The muzzle above is the upper one; this is the chin
    // and lower lip, tucked UNDER and BACK so the upper overhangs it. A lower
    // jaw level with the upper is a beak.
    const jaw = part(blob(0.2, 0.1, 0.185), k.belly, "jaw", head);
    jaw.position.set(0, -0.265, 0.325);
    jaw.rotation.x = 0.18;

    // **THE WHISKERS — THREE A SIDE, FROM BESIDE THE NOSE** (Nuno: *"the nose
    // should have a few fur like 3 lines from each side of the nose"*).
    //
    // **AIMED WITH A FRAME, NOT EULER ANGLES** (IDEA-060 rule 5, which this
    // file has now hit three times): three.js applies an XYZ Euler as
    // Rx*Ry*Rz, so a `rotation.z` that swings a whisker outward is itself
    // rotated by any `rotation.y` written beside it, and the first cheek
    // tufts built that way pointed INWARD into the head and rendered as
    // nothing at all. A direction vector says what is meant.
    //
    // They taper to a POINT and are built from the same swept stations as
    // everything else here, because a constant-radius rod reads as a pin.
    // Cheap on purpose — 5 radial segments, 3 stations — since at the apron
    // this animal is about 35 pixels tall and these are for the shop stage
    // and any closer angle.
    const WHISKER: SweepStation[] = [
      { pos: [0, 0, 0], rx: 0.016, rz: 0.016 },
      { pos: [0, 0.12, 0], rx: 0.011, rz: 0.011 },
      { pos: [0, 0.26, 0], rx: 0.004, rz: 0.004 },
    ];
    // Out, and fanned up/level/down. The middle one runs nearly flat; the
    // outer two open away from it, which is what makes three lines read as a
    // fan rather than as a fork.
    const WHISKER_AIM: readonly [number, number, number][] = [
      [0.9, 0.3, 0.32],
      [0.96, -0.05, 0.28],
      [0.88, -0.4, 0.26],
    ];
    for (const s of [-1, 1]) {
      for (const [i, aim] of WHISKER_AIM.entries()) {
        const w = part(
          taperedSweepGeometry(WHISKER, 5),
          k.belly,
          (s < 0 ? "whiskerL" : "whiskerR") + String(i),
          head,
        );
        w.position.set(s * 0.1, -0.075, 0.53);
        w.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          new THREE.Vector3(s * aim[0], aim[1], aim[2]).normalize(),
        );
      }
    }
  }

  // --- last: the tail. Identity separator #2, and it is the part that
  // changes the silhouette most.
  if (kind === "rabbit") {
    // A puff, and nothing more. The rabbit's whole tail budget goes on the
    // ears; a big tail here would fight them.
    const t = part(blob(0.26, 0.26, 0.24), k.belly, "tail", g);
    t.position.set(0, 0.62, -0.72);
  } else if (kind === "raccoon") {
    // RINGED, and now the FOX'S BRUSH carrying those rings (v22, Nuno: *"lets
    // make one tail with the same shape of the fox but with the stripes
    // pattern of the raccoon"*). `ringedTail` already held both halves: a
    // control-point `profile` for the form and `bands` for an alternating
    // colour. The fox uses the first with `tipFrom`; the raccoon uses the
    // first with `bands`.
    //
    // **AND RAISING IT MAKES THE RINGS READ BETTER, WHICH INVERTS THE NOTE
    // THAT USED TO BE HERE.** That note said a tail carried vertically
    // foreshortens its bands into a smudge at the play camera, so this one
    // swept down and back — and the arithmetic says the old sweep was the
    // foreshortened one. The camera looks DOWN and FORWARD (view direction
    // about (0, -0.857, -0.515) at 59 degrees of elevation), and a tail
    // sweeping down and back runs very nearly ALONG that: the old axis
    // measured 27 degrees off the view direction, i.e. the rings were seen at
    // **45%** of their spacing. The fox's angle puts the axis at 94 degrees
    // to it — **99.8%**, as close to side-on as it gets. A vertical tail
    // would indeed be bad; the fix was never to point it downward.
    //
    // **IT STOPS WELL BELOW THE HEAD, AND THAT IS NOT A STYLE CHOICE.** The
    // squirrel's plume arcing up and OVER its back is the one tail in this
    // set that rises above the head, and it is what separates a squirrel from
    // a raccoon at any size and in any colour (rule 4). The head sits at
    // y 2.0; this tops out at 1.45.
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.7, -0.3),
      new THREE.Vector3(0.02, 0.82, -0.95),
      new THREE.Vector3(0.05, 1.12, -1.35),
      new THREE.Vector3(0.08, 1.45, -1.45),
    ]);
    // 28 rings against 7 bands, so every band is exactly four rings and no
    // boundary lands part-way along a taper. The far cap falls in the dark
    // band, which is right: a raccoon's tail ends black.
    // THICKER AT THE ROOT THAN THE FOX'S, because of what it comes out of: a
    // fox's barrel has already tapered to nothing at the rump, where a
    // raccoon's haunch is a full round pear. The fox's 0.10 base against that
    // reads as a stick pushed into a ball.
    const geo = ringedTail(curve, 0, 0, 28, 11, 7, {
      profile: [0.16, 0.27, 0.315, 0.32, 0.29, 0.235, 0.15, 0.018],
    });
    part(geo, [k.fur, k.accent], "tail", g);
  } else {
    // The squirrel's PLUME — the one tail in the set that rises above the
    // head, which is what separates it from the rabbit at any size and in
    // any colour.
    //
    // **THE FORM IS AN S, AND IT IS THE WHOLE SILHOUETTE** (v30, Nuno:
    // *"lets bring back the idea of the fox and the raccoon, but lets make
    // the form an S like the reference"*). v28/v29 swept a single C — out of
    // the rump, up, forward — which is a comma, and a comma is what a fox's
    // brush already is. Both squirrel references draw a double bend: the
    // lower limb curls BACK away from the body, the upper limb curls FORWARD
    // over it, and the tip hooks down. There is exactly one inflection and it
    // sits around two thirds of the way up.
    //
    // **AN S IS A CHANGE OF SIGN, AND A LONGER ARC IS NOT ONE.** The first
    // attempt at this swept back, up and then forward over the head — six
    // control points, a quarter-turn more than v29, and still a COMMA,
    // because the heading rotated one way the whole length (measured: 202
    // degrees down to -41 without once turning back). What makes a letter S
    // is an inflection: the lower limb convex one way, the upper limb convex
    // the OTHER. Here the heading falls 146 -> 107 -> 70 -> 45 up the back
    // sweep and then climbs 45 -> 94 -> 163 as the tip flicks up and away.
    // That reversal is the whole shape; everything else is where it sits.
    //
    // **AND IT IS BOUNDED BY THE HEAD, MEASURED RATHER THAN GUESSED.**
    // `scripts/_scratch-squirrel-space.ts` reads every part in the body's own
    // frame: the skull's back face is at z -0.41 and the ears' and their
    // tufts' at -0.13, over y 1.52..3.12. The upper limb's furthest-forward
    // surface lands at -0.48, so it clears the skull — and the tip, being the
    // THIN end, is what tops the animal out at about the ear tufts' own
    // height, which is the reference's relationship (the plume reaches the
    // ear tips, and narrows as it gets there).
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.5, -0.35),
      new THREE.Vector3(0, 1.0, -1.1),
      new THREE.Vector3(0, 1.7, -1.32),
      new THREE.Vector3(0, 2.3, -1.1),
      new THREE.Vector3(0, 2.62, -0.78),
      new THREE.Vector3(0, 2.95, -0.8),
      new THREE.Vector3(0, 3.05, -1.12),
    ]);
    // **AND THE MASS IS THE FOX'S AND THE RACCOON'S, NOT A FIELD OF TUFTS.**
    // Same instruction's other half. `fluff` at v29's 0.52 was most of what
    // the eye saw, so the underlying sweep was buried and the tail read as a
    // crumpled mass rather than as a shape — it is TEXTURE, and texture
    // cannot carry a silhouette. At 0.36 the profile is what reads and the
    // tufts break its edge, which is the job they were added for. **The
    // floor is not free**: `test-garden-props.ts` wants a ring's max/min over
    // 1.2, which this arithmetic puts at an `amount` of about 0.33, so there
    // is roughly a tenth of headroom under the shipped value and no more.
    //
    // Measured off the explorer reference on a labelled grid, the plume is
    // 0.71 of the body's width and 0.82 of standing height. The profile is
    // narrow where it leaves the rump, broad through the middle and upper
    // bend, and tapers HARD into the hook — a hook as thick as the mass is a
    // club, and the taper is what lets the second bend read at all.
    //
    // 32 rings against 28 before, because a curve with an inflection needs
    // more stations through two bends than one arc did through one.
    const geo = ringedTail(curve, 0, 0, 32, 30, 1, {
      profile: [0.17, 0.3, 0.44, 0.53, 0.56, 0.52, 0.38, 0.14],
      fluff: { lobes: 5, along: 5, amount: 0.36 },
    });
    part(geo, [k.fur], "tail", g);
  }

  // A little turn of the head, per instance. Two of these standing side by
  // side on an apron should not be stamped.
  head.rotation.y = (rnd() - 0.5) * 0.5;
  return g;
}

// ---------------------------------------------------------------------------
// THE QUADRUPEDS — deer and fox.
//
// Also one body plan: a barrel on four legs with a neck, a head and a tail.
// The two are separated by PROPORTION rather than by parts, and the numbers
// are the whole design:
//
//                    deer      fox
//   legs (of body)   1.05      0.52     — a deer is mostly leg, a fox is not
//   neck             0.95      0.30
//   tail             a flick   a BRUSH as thick as its own body
//   ears             tall cups pointed triangles
//   antlers          yes       no
//
// A fox and a deer in the same orange at the same size differ by exactly
// those, so they are what the builder varies.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// THE FOX'S HEAD PROFILES — the beagle's own numbers, COPIED (IDEA-065 v19).
//
// Nuno asked for the fox's head to be the beagle's head, as the same parts, so
// that he can edit each one toward a fox in the Props tab. These three tables
// are therefore seeded from `characters.ts` and kept SEPARATE from it on
// purpose: they exist to be tuned away from the dog, and sharing them would
// mean a fox edit repainting the beagle every player is looking at.
// `SPHERE_PROFILE` is the exception and is imported — it is a sphere, and there
// is nothing fox-specific for it to become.
// ---------------------------------------------------------------------------

/** Paw: an egg bulb, wider than the leg shaft it hangs from. The beagle's own
 *  profile, copied for the reason the head's three are (IDEA-065 v19) — it is
 *  here to be tuned toward a fox, and a shared table would repaint the dog. */
const FOX_PAW_PROFILE = [
  [0.001, -0.5],
  [0.3, -0.44],
  [0.45, -0.25],
  [0.5, 0.0],
  [0.42, 0.28],
  [0.25, 0.43],
  [0.001, 0.5],
] as const;

/** Muzzle: fuller at the flews/chin band, slightly squared front. */
const FOX_MUZZLE_PROFILE = [
  [0.001, -0.5],
  [0.3, -0.46],
  [0.44, -0.34],
  [0.5, -0.12],
  [0.5, 0.1],
  [0.44, 0.28],
  [0.3, 0.42],
  [0.001, 0.5],
] as const;

/** Nose: a rounded-triangle read — wide base tapering up. */
const FOX_NOSE_PROFILE = [
  [0.001, -0.5],
  [0.36, -0.42],
  [0.5, -0.15],
  [0.46, 0.12],
  [0.32, 0.34],
  [0.001, 0.5],
] as const;

/**
 * Bridge ("stop"): the ramp from the muzzle top up between the eyes into the
 * forehead — wide and thin, sections lying flat, only its top surface cresting
 * above muzzle and skull. Sampled from ONE quadratic curve with near-constant
 * thickness through the middle, so the top surface is a parallel of that arc
 * and cannot kink where hand-placed stations meet.
 */
const FOX_BRIDGE_STATIONS: SweepStation[] = [
  { pos: [0, -0.04, 0.224], rx: 0.024, rz: 0.01 },
  { pos: [0, -0.0382, 0.201], rx: 0.04, rz: 0.022 },
  { pos: [0, -0.0329, 0.1799], rx: 0.05, rz: 0.03 },
  { pos: [0, -0.024, 0.1607], rx: 0.052, rz: 0.032 },
  { pos: [0, -0.0115, 0.1435], rx: 0.05, rz: 0.032 },
  { pos: [0, 0.0045, 0.1282], rx: 0.046, rz: 0.03 },
  { pos: [0, 0.0241, 0.1149], rx: 0.04, rz: 0.026 },
  { pos: [0, 0.0473, 0.1035], rx: 0.03, rz: 0.018 },
  { pos: [0, 0.074, 0.094], rx: 0.018, rz: 0.01 },
];

// ---------------------------------------------------------------------------
// THE FOX — .img2threejs/reference/props/fox/image.png
//
// Nuno, v14: *"the fox need a lot of rework this not look like a fox at all."*
// He was right, and the reason is that the fox had been sharing the deer's
// body plan: a long barrel carried low, a head stuck on the front of it at
// body height, and ears the size of thumbnails. That reads as a WEASEL, which
// is the one animal a fox must not be mistaken for — and no amount of orange
// fixes a silhouette.
//
// MEASURED off the reference as fractions of standing height:
//   ears 18%   head 21%   neck 11%   body 24%   legs 26%
// Five things fall out of that and they are the whole rework:
//
//  1. **THE EARS ARE RANK 1 AND THEY ARE ENORMOUS.** Nearly a fifth of the
//     animal's height, held UPRIGHT, broad at the base and pointed, with dark
//     backs. Nothing else in this module has anything like them — the deer's
//     are small and swept, the rabbit's are tall but narrow and round-tipped.
//     At the apron they are the one part of a fox that survives.
//  2. **IT STANDS UP.** A quarter of its height is leg and a tenth is neck,
//     so the head is carried well above the back. The old build had the head
//     at body level, which is what made it a tube with a face on the end.
//  3. **THE WHITE IS A PATTERN, NOT A BELLY.** A throat-and-chest bib, a
//     cheek ruff flaring out under each ear, and the tail's white tip. The
//     old build had a small cream underside and nothing else, so the fox's
//     most recognisable value structure was simply absent.
//  4. **BLACK STOCKINGS, NOT BLACK SOCKS.** They run from the foot a third of
//     the way up the leg. The old build put a small dark blob at each foot —
//     and `accentIsInk` is what stops them rendering BLUE (see CRITTER_COLORS).
//  5. **THE BRUSH SWEEPS BACK AND UP.** Held low and straight it is a rat's
//     tail; the reference carries it out behind at a rising angle, as thick
//     as the body, ending in a broad white tip.
//
// The body is one `taperedSweepGeometry` for the reason the deer's is
// (IDEA-065 v12): two overlapping solids meet at a crease and no amount of
// overlap removes it.
// ---------------------------------------------------------------------------

function foxBody(k: Kit, rnd: () => number): THREE.Group {
  const g = new THREE.Group();

  // SHORTER THAN THE DEER'S, which is the point: measured, a fox is 26%
  // leg against a deer's 19% of a much taller animal, so in absolute
  // terms it stands LOW. At 0.86 it read as a small deer.
  const legLen = 0.74;
  const bodyY = legLen + 0.5;
  // SHORTER THAN IT WAS. Measured on the reference the body is about 0.41 of
  // the standing height; at 1.34 head-units against this stance it was nearer
  // 0.6, and a long back on short legs is a dachshund however good the head
  // is. A fox is COMPACT and deep-chested.
  const bodyLen = 1.12;

  // --- the barrel. Deepest at the chest and falling away to a narrow waist
  // and a small rump, which is a fox: it carries its weight forward.
  const BODY_STATIONS: SweepStation[] = [
    { pos: [0, bodyY - 0.02, -bodyLen * 0.52], rx: 0.07, rz: 0.07 },
    { pos: [0, bodyY - 0.01, -bodyLen * 0.44], rx: 0.26, rz: 0.25 },
    { pos: [0, bodyY, -bodyLen * 0.3], rx: 0.345, rz: 0.335 },
    { pos: [0, bodyY, -bodyLen * 0.12], rx: 0.355, rz: 0.35 },
    { pos: [0, bodyY + 0.01, bodyLen * 0.08], rx: 0.375, rz: 0.385 },
    { pos: [0, bodyY + 0.02, bodyLen * 0.26], rx: 0.405, rz: 0.43 },
    { pos: [0, bodyY + 0.02, bodyLen * 0.4], rx: 0.385, rz: 0.415 },
    { pos: [0, bodyY + 0.01, bodyLen * 0.5], rx: 0.3, rz: 0.33 },
    { pos: [0, bodyY, bodyLen * 0.56], rx: 0.08, rz: 0.09 },
  ];
  part(taperedSweepGeometry(BODY_STATIONS, 22), k.fur, "body", g);

  // The pale underside, tucked so it reads as a colour region rather than a
  // mass of its own.
  const under = part(blob(0.3, 0.2, bodyLen * 0.34), k.belly, "underside", g);
  under.position.set(0, bodyY - 0.26, bodyLen * 0.06);

  // --- THE LEGS ARE THE BEAGLE'S LEGS (v20, Nuno: *"lets work on the legs
  // now, lets improve a little bit the legs and the paws, lets make something
  // like the beagle legs on the fox too"*). Same construction as the head:
  // one PIVOT per leg, a single swept tapered mesh inside it, and a LATHE paw
  // bulb that is wider than the shaft it hangs from.
  //
  // **FOUR TOP-LEVEL PARTS INSTEAD OF TWELVE.** Each leg used to be two
  // `jointedLimb` chains plus a paw blob — the chains because a material
  // boundary mid-limb is the one thing `jointedLimb` cannot express, and the
  // fox's stocking is exactly that boundary. One sweep with a BAND says it
  // instead (`sweepBanded`, the ear's own mechanism), so the stocking is a
  // material group on the leg rather than a second solid butted onto it:
  // no joint to misalign, no pair of radii to keep in step, and the leg is
  // one row in the Components tree.
  //
  // **THE PAW IS A BULB, AND BEING WIDER THAN THE SHAFT IS THE POINT** — the
  // beagle's is 1.5x its leg. A paw that is narrower than the leg above it
  // reads as the leg having been cut off, which is IDEA-065 v8's hoof lesson
  // on a different foot.
  //
  // The beagle's `Rest` group is deliberately NOT ported: it exists because
  // the trot writes the pivot's rotation every frame, so a rest angle there
  // could never survive. Nothing animates a prop's legs, so the pivot itself
  // is the editable frame and an extra empty group would only deepen the tree.
  const LEG_FRONT: SweepStation[] = [
    { pos: [0, 0.04, 0], rx: 0.12, rz: 0.13 },
    { pos: [0, -0.06, 0.012], rx: 0.175, rz: 0.185 },
    { pos: [0, -0.3, 0.02], rx: 0.145, rz: 0.15 },
    { pos: [0, -0.56, 0.024], rx: 0.115, rz: 0.118 },
    // A station exactly ON the stocking line, so the colour cut is a clean
    // ring rather than a boundary part-way along a taper.
    { pos: [0, -0.68, 0.027], rx: 0.102, rz: 0.104 },
    { pos: [0, -0.92, 0.03], rx: 0.089, rz: 0.091 },
    { pos: [0, -1.14, 0.032], rx: 0.081, rz: 0.083 },
  ];
  const LEG_HIND: SweepStation[] = [
    { pos: [0, 0.05, -0.03], rx: 0.13, rz: 0.15 },
    // The haunch: a fox carries real muscle at the top of the hind leg and
    // almost none at the shoulder, which is most of what tells the two pairs
    // apart at a glance.
    { pos: [0, -0.05, -0.018], rx: 0.2, rz: 0.225 },
    { pos: [0, -0.3, 0.004], rx: 0.155, rz: 0.17 },
    { pos: [0, -0.55, 0.03], rx: 0.116, rz: 0.121 },
    { pos: [0, -0.68, 0.034], rx: 0.102, rz: 0.104 },
    { pos: [0, -0.92, 0.038], rx: 0.089, rz: 0.091 },
    { pos: [0, -1.14, 0.04], rx: 0.081, rz: 0.083 },
  ];
  // THE STOCKING IS MORE THAN HALF THE LEG. Measured off the reference the
  // black runs from the paw up past the knee — about 55% of the leg a viewer
  // can see — where an early build put a short bootie on the bottom quarter.
  // On an animal that is otherwise one flat orange, black legs are the
  // strongest mark it has.
  const STOCKING_SEG = 4;
  const legOf = (
    name: string,
    stations: SweepStation[],
    at: readonly [number, number, number],
  ): THREE.Group => {
    const pivot = new THREE.Group();
    pivot.name = name;
    pivot.position.set(at[0], at[1], at[2]);
    g.add(pivot);
    const mesh = part(
      sweepBanded(stations, 14, (seg) => (seg >= STOCKING_SEG ? 1 : 0)),
      [k.fur, k.accent],
      `${name}Mesh`,
      pivot,
    );
    mesh.castShadow = true;
    const paw = part(
      latheFromProfile(FOX_PAW_PROFILE, 16, 0.24, 0.185, 0.26),
      k.accent,
      name.replace("leg", "paw"),
      pivot,
    );
    // The TOE projects a little over one shaft-radius past the front of the
    // leg, which is the beagle's own proportion. Pushed further it stops
    // being a paw and becomes a ski boot — which is what 0.3 deep at z 0.055
    // read as, because a bulb seen from the side is judged on how far it
    // overhangs rather than on its own size.
    paw.position.set(0, -1.15, 0.038);
    return pivot;
  };
  for (const s of [-1, 1]) {
    legOf(s < 0 ? "legFL" : "legFR", LEG_FRONT, [s * 0.235, bodyY + 0.02, bodyLen * 0.3]);
    legOf(s < 0 ? "legBL" : "legBR", LEG_HIND, [s * 0.245, bodyY + 0.02, -bodyLen * 0.3]);
  }

  // --- the neck, bell-flared into the chest for the reason the deer's is
  // (v13): a constant tube entering a barrel meets it at a right angle and
  // the crease reads as a line drawn round the animal. Elliptical, because a
  // round flare is bounded by whichever axis runs out of barrel first.
  const nLo: readonly [number, number, number] = [0, bodyY + 0.2, bodyLen * 0.34];
  const nHi: readonly [number, number, number] = [0, bodyY + 0.78, bodyLen * 0.5];
  const rN = 0.2;
  flaredLimb(
    nLo,
    nHi,
    [
      [rN * 1.7, rN * 1.25],
      [rN * 1.3, rN * 1.12],
      [rN * 1.08, rN * 1.02],
      [rN * 0.96, rN * 0.96],
      [rN * 0.92, rN * 0.92],
    ],
    k.fur,
    "neck",
    g,
  );

  // --- THE HEAD IS THE BEAGLE'S HEAD (v19, Nuno: *"the fox snout still not
  // there, so lets take the beagle head and make something like that, the same
  // parts, then I edit the parts on the fox to look more like a fox. The only
  // thing we can reuse is the ears of the fox that are ok"*).
  //
  // v18 built something LIKE the beagle's arrangement and kept re-deriving its
  // numbers; three rounds of that still did not land the snout. So this is the
  // beagle's head literally — the same parts, in the same order, built from the
  // same primitives at the same relative positions, scaled up by `HS` to the
  // fox's own head size. **It is a STARTING POINT to be edited in the Props
  // tab, not a finished fox**, which is exactly what was asked for: every piece
  // is a named top-level mesh with its own transform, so skull, muzzle, bridge,
  // nose, jaw and both brow swells can each be moved, scaled and recoloured
  // without touching the others.
  //
  // **THE PROFILES ARE COPIED, NOT IMPORTED, AND THAT IS DELIBERATE.**
  // `SPHERE_PROFILE` is shared (it is already exported, and it is a sphere —
  // there is nothing fox-specific to diverge). The muzzle, nose and bridge
  // tables are the fox's OWN copies of the beagle's numbers, because the whole
  // point of this hand-off is that they get tuned away from the dog — and a
  // shared table would mean tuning the fox changes the beagle every player is
  // looking at. Two tables that are meant to diverge are not duplication.
  const HS = 2.1;
  const head = new THREE.Group();
  head.name = "head";
  head.position.set(0, bodyY + 0.86, bodyLen * 0.54);
  g.add(head);

  const skull = part(
    latheFromProfile(SPHERE_PROFILE, 24, 0.285 * HS, 0.27 * HS, 0.27 * HS),
    k.fur,
    "skull",
    head,
  );
  skull.castShadow = true;

  const muzzle = part(
    latheFromProfile(FOX_MUZZLE_PROFILE, 20, 0.175 * HS, 0.135 * HS, 0.175 * HS),
    k.belly,
    "muzzle",
    head,
  );
  muzzle.scale.set(1.012, 0.774, 1.163);
  muzzle.position.set(0, -0.08 * HS, 0.14 * HS);

  // The bridge ("stop") — the ridge from the muzzle top up between the eyes
  // into the forehead, and the part whose job is to make muzzle and skull read
  // as ONE face. **The one colour that differs from the beagle's**: its bridge
  // is white because its whole muzzle is, while a fox's muzzle is pale with an
  // ORANGE bridge over it. That is the single most recognisable thing about a
  // fox's face and it costs nothing to say here.
  const bridge = part(
    taperedSweepGeometry(
      FOX_BRIDGE_STATIONS.map((s) => ({
        pos: [s.pos[0] * HS, s.pos[1] * HS, s.pos[2] * HS] as [number, number, number],
        rx: s.rx * HS,
        rz: s.rz * HS,
      })),
      14,
    ),
    k.fur,
    "bridge",
    head,
  );
  bridge.scale.set(0.9, 1, 1);
  bridge.position.set(0, 0, -0.014 * HS);

  const nose = part(
    latheFromProfile(FOX_NOSE_PROFILE, 16, 0.075 * HS, 0.062 * HS, 0.052 * HS),
    k.dark,
    "nose",
    head,
  );
  nose.position.set(0, -0.055 * HS, 0.23 * HS);

  // The jaw. The beagle's is a pivot its chomp animation swings; nothing
  // animates a prop's face, so it is kept as the shape it also is — the pale
  // underside of the muzzle — on its own group so the editor sees one part.
  const jaw = new THREE.Group();
  jaw.name = "jaw";
  jaw.position.set(0, -0.115 * HS, 0.095 * HS);
  const jawMesh = part(new THREE.SphereGeometry(0.07 * HS, 14, 10), k.belly, "jawMesh", jaw);
  jawMesh.rotation.set(0.192, 0, 0);
  jawMesh.scale.set(0.75, 0.443, 1.313);
  jawMesh.position.set(0, -0.008 * HS, 0.026 * HS);
  head.add(jaw);

  for (const s of [-1, 1]) {
    eye(head, s, [0.075 * HS, 0.005 * HS, 0.1 * HS], k, s < 0 ? "eyeL" : "eyeR", {
      r: 0.054 * HS,
      // THE BEAGLE'S OWN LENS, which is much flatter than this module's
      // default (0.66 across against 0.95). Kept at 0.95 the eye stood 57% of
      // its radius proud of a skull that is narrow at that z, and the far one
      // rendered as a white arc hanging off the side of the head.
      lens: [0.66, 0.78, 0.41],
      iris: 1.05,
      pupil: 0.6,
    });
  }

  // Brow swells, sunk mostly into the skull — the beagle's note applies here
  // too: a flat ridge hangs over the eye and its shaded underside quantises
  // into a dark band that reads as a frown.
  const browSwellL = part(
    latheFromProfile(SPHERE_PROFILE, 12, 0.07 * HS, 0.036 * HS, 0.04 * HS),
    k.fur,
    "browSwellL",
    head,
  );
  browSwellL.position.set(0.08 * HS, 0.078 * HS, 0.09 * HS);
  const browSwellR = part(
    latheFromProfile(SPHERE_PROFILE, 12, 0.07 * HS, 0.036 * HS, 0.04 * HS),
    k.fur,
    "browSwellR",
    head,
  );
  browSwellR.position.set(-0.08 * HS, 0.078 * HS, 0.09 * HS);

  // --- THE CHEEK FUR, which Nuno asked for by name one round earlier and
  // which the beagle has no equivalent of. Kept as four separate top-level
  // parts so they are his to tune or hide; the beagle's own head is otherwise
  // reproduced part for part.
  //
  // **FUR READS ON HAVING A POINT**, and it reads as an AREA. A pale lozenge
  // on the side of the face is BLUSHER — three tunings of it were — so these
  // are swept leaves ending in points, two per side at different angles,
  // because one tuft is a fin and two overlapping ones are a mass of hair.
  const CHEEK: SweepStation[] = [
    { pos: [0, 0, 0], rx: 0.04, rz: 0.022 },
    { pos: [0, 0.05, 0.004], rx: 0.056, rz: 0.028 },
    { pos: [0, 0.105, 0.005], rx: 0.052, rz: 0.026 },
    { pos: [0, 0.155, 0.002], rx: 0.038, rz: 0.019 },
    { pos: [0, 0.195, -0.002], rx: 0.02, rz: 0.011 },
    { pos: [0, 0.22, -0.005], rx: 0.006, rz: 0.004 },
  ];
  // SWEPT BACK, not out, and **AIMED WITH A FRAME RATHER THAN EULER ANGLES**
  // (IDEA-060 rule 5, now twice in this file): three.js applies an XYZ Euler
  // as Rx*Ry*Rz, so a `rotation.z` that swings a tuft outward is itself
  // rotated by the `rotation.y` written beside it — the first pair pointed
  // INWARD, into the head, and rendered as nothing at all.
  const CHEEK_AIM: readonly [number, number, number][] = [
    [0.4, -0.12, -0.91],
    [0.38, -0.4, -0.83],
  ];
  for (const s of [-1, 1]) {
    for (const [i, aim] of CHEEK_AIM.entries()) {
      const tuft = part(
        taperedSweepGeometry(CHEEK, 10),
        k.belly,
        (s < 0 ? "cheekL" : "cheekR") + String(i),
        head,
      );
      tuft.position.set(s * 0.175, -0.14, 0.13);
      tuft.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(s * aim[0], aim[1], aim[2]).normalize(),
      );
    }
  }

  // --- THE EARS, which are the whole animal, and they were the wrong SHAPE
  // and the wrong PROPORTION at once.
  //
  // **MEASURED ON THE REFERENCE AN EAR IS ABOUT 1.9 LONG FOR 1 WIDE.** The
  // shipped pair were 0.45 tall on a 0.67 base — i.e. WIDER THAN THEY WERE
  // TALL, almost three times too broad. (An older note here says a narrower
  // fin "read as HORNS"; that was judged at 1.13, still nowhere near the
  // reference, and the horn read came from the fin being a flat sliver rather
  // than from its width.) An ear is also about as long as the head is tall,
  // which is why this is rank 1 of the whole animal.
  //
  // **AND IT IS A LEAF, NOT A CONE.** A cone's silhouette is two STRAIGHT
  // lines from a base that is its widest point; the reference's ear is widest
  // about a third of the way up and curves in to the point from both sides.
  // So it is the brush's construction again — swept stations with a profile —
  // which also gives it real DEPTH rather than a scaled-flat primitive, and
  // depth is what v15 found the yaw cannot substitute for.
  // **WIDEST NEAR THE BASE, WHICH IS WHAT MAKES IT A FOX'S AND NOT A
  // RABBIT'S.** The first leaf was widest a third of the way UP, narrowing to
  // a thin root — and that is precisely a rabbit's ear, which is why the
  // first render of it read as one despite being the right length and the
  // right ratio. A fox's is a TRIANGLE with a broad base; the curve is in how
  // it comes off that base and in to the point, not in where its maximum is.
  const EAR: SweepStation[] = [
    { pos: [0, 0, 0], rx: 0.176, rz: 0.068 },
    { pos: [0, 0.085, 0.006], rx: 0.191, rz: 0.079 },
    { pos: [0.004, 0.2, 0.009], rx: 0.179, rz: 0.079 },
    { pos: [0.008, 0.33, 0.006], rx: 0.145, rz: 0.068 },
    { pos: [0.012, 0.45, -0.001], rx: 0.104, rz: 0.05 },
    { pos: [0.016, 0.55, -0.007], rx: 0.056, rz: 0.03 },
    { pos: [0.02, 0.62, -0.011], rx: 0.013, rz: 0.011 },
  ];
  const EAR_RADIAL = 14;
  const earStations = (scale: number, dz: number, hScale: number): SweepStation[] =>
    EAR.map((s) => ({
      pos: [s.pos[0] * scale, s.pos[1] * hScale, s.pos[2] * scale + dz] as [number, number, number],
      rx: s.rx * scale,
      rz: s.rz * scale,
    }));
  const earLeaf = (
    scale: number,
    dz: number,
    mat: THREE.Material,
    name: string,
    parent: THREE.Object3D,
    hScale = 1,
  ): void => {
    const m = part(taperedSweepGeometry(earStations(scale, dz, hScale), EAR_RADIAL), mat, name, parent);
    m.castShadow = true;
  };
  for (const s of [-1, 1]) {
    const earPivot = new THREE.Group();
    earPivot.name = s < 0 ? "earL" : "earR";
    // SET WIDE AND HIGH, on the corners of the skull rather than on top of
    // it: ears meeting in the middle are a cat's.
    earPivot.position.set(s * 0.185, 0.2, -0.13);
    earPivot.rotation.z = -s * 0.34;
    earPivot.rotation.x = -0.1;
    // A real leaf carries its own depth, so the yaw is back to what the
    // reference shows rather than to whatever stopped a flat fin vanishing
    // edge-on. v15's rule stands: depth and yaw are ONE decision, and this is
    // the end of it where the depth does the work.
    // **MEASURED, NOT CHOSEN.** At 0.26 the ear's own plane sits 49 degrees
    // off face-on from the review camera, which compresses its apparent width
    // to 0.66 of the real one — the pair measured 2.68 tall-for-wide against
    // the reference's 1.82 and read as a kangaroo's. The ear is not narrow in
    // three dimensions; it was being LOOKED at edge-on. Half the correction
    // belongs here and half in the table above, because a prop takes a random
    // yaw on the board and so is seen from every azimuth.
    earPivot.rotation.y = s * 0.18;
    head.add(earPivot);
    // THE DARK BACK IS THE SHELL'S OWN REAR HALF, NOT A SOLID BEHIND IT.
    // Built as a separate leaf it could only ever be a RIM: it has to stand
    // proud of the shell somewhere to be seen at all, and on an ear that is
    // yawed outward "somewhere" turns out to be the OUTER SILHOUETTE — a hard
    // black line down the edge of each ear. That is the version Nuno hid, and
    // he was right to. As a material group on the one surface the dark is on
    // the rear face BY CONSTRUCTION and cannot escape to the outline.
    //
    // The ear's path runs along +Y, so `taperedSweepGeometry` frames it as
    // right = +X and up = -Z: a point's z is `-sin(a) * rz`, which makes
    // `sin(a) > 0` the REAR. Slightly past zero, so a sliver of orange rim
    // survives at the edges from the front.
    const shell = part(
      sweepBanded(earStations(1, 0, 1), EAR_RADIAL, (_seg, j) => {
        const a = ((j + 0.5) / EAR_RADIAL) * Math.PI * 2;
        return Math.sin(a) > 0.15 ? 1 : 0;
      }),
      [k.fur, k.accent],
      s < 0 ? "earLShell" : "earRShell",
      earPivot,
    );
    shell.castShadow = true;
    earLeaf(0.68, 0.036, k.belly, s < 0 ? "earLInner" : "earRInner", earPivot, 0.9);
  }

  // --- THE BRUSH, RAISED (v16, Nuno: *"the tail should be pointing up and
  // should have other form, this dont look like a tail, and should be pointed
  // on the edge"*). Three separate things, and only the first was a shape
  // problem at all:
  //
  //  * **IT WAS TRANSPARENT BECAUSE IT WAS INSIDE-OUT.** See `ringedTail`'s
  //    header — the walls were wound inward, so the near side was culled away
  //    and the body showed through the tail. Every tuning before this was
  //    done against a tail that was not being drawn.
  //  * **IT POINTS UP.** It used to run back and DOWN (bodyY to bodyY-0.22),
  //    which is a fox at rest and, at the apron, a horizontal bar behind a
  //    horizontal body — the one direction that adds nothing to a silhouette
  //    already long in z. Raised, the brush is the only part of this animal
  //    with real vertical extent apart from the ears, and it stops short of
  //    them on purpose: the ears are rank 1 and must stay the top of the
  //    outline.
  //  * **IT COMES TO A POINT, WHICH IS WHAT A CAP BOUGHT.** The white tip was
  //    a BLOB, carried because an open tube's final rim had to be hidden
  //    behind something wider than itself — so the brush could only ever end
  //    blunt, and the thing hiding the rim was exactly IDEA-065 v1's "cream
  //    snowball stuck on the end". With the ends capped the rim does not
  //    exist, the profile can run to 0.02, and the white is a BAND on the
  //    brush's own last fifth rather than an object on the end of it.
  const curve = new THREE.CatmullRomCurve3([
    // The base still starts inside the rump — not to hide a rim any more, but
    // because a tail that begins at the body's surface reads as attached TO
    // it rather than as growing out of it.
    new THREE.Vector3(0, bodyY - 0.04, -bodyLen * 0.26),
    new THREE.Vector3(0.03, bodyY + 0.1, -bodyLen * 0.86),
    new THREE.Vector3(0.07, bodyY + 0.56, -bodyLen * 1.16),
    // The tip leans FORWARD over the back. A brush that goes straight up is a
    // mast; the curl is what makes the raised pose read as fur with weight.
    new THREE.Vector3(0.1, bodyY + 1.02, -bodyLen * 1.06),
  ]);
  // NARROW AT THE RUMP, WIDEST AT A THIRD, AND A POINT — which is a brush,
  // and which no pair of end radii can describe. A steady taper from a fat
  // base is a CARROT; parallel sides are a bolster.
  //
  // **LENGTH OVER WIDTH IS THE NUMBER, AND IT IS ABOUT 3.** The first raised
  // build ran 1.47 long against 0.70 across — 2.1, which is not a fat tail,
  // it is a BLADE: at that ratio the curve's own bend happens inside a single
  // diameter and the whole thing reads as a comma, or as a fin. Lengthened to
  // 1.73 and narrowed to 0.55 it is 3.1, and the point at the end has room to
  // be a point rather than a facet on a lump.
  part(
    ringedTail(curve, 0, 0, 34, 12, 1, {
      profile: [0.1, 0.22, 0.27, 0.275, 0.25, 0.2, 0.12, 0.015],
      tipFrom: 0.74,
    }),
    [k.fur, k.belly],
    "tail",
    g,
  );

  // THE BIB, down the front of the neck and chest — appended last, which is
  // this file's rule for anything added after a def may have saved edits.
  // ONE CONTINUOUS WHITE FRONT. Two small discs read as patches stuck on;
  // the reference carries a single pale mass from the chin down the throat
  // and across the chest, and that value structure is half of what says
  // FOX at any size.
  const bib = part(blob(0.18, 0.36, 0.15), k.belly, "bib", g);
  bib.position.set(0, bodyY + 0.52, bodyLen * 0.53);
  // THE CHEST RUFF IS BIG. In the reference it is a pale mass running from
  // the chin to between the forelegs and it is most of the animal's front —
  // a patch the size of the first build's reads as a bib on an orange shirt.
  const bibChest = part(blob(0.33, 0.34, 0.2), k.belly, "bibChest", g);
  bibChest.position.set(0, bodyY + 0.1, bodyLen * 0.42);

  head.rotation.x = 0.1;
  head.rotation.y = (rnd() - 0.5) * 0.3;
  return g;
}

/**
 * The deer's and the fox's proportions, as ONE named table.
 *
 * It was twenty inline `deer ? a : b` ternaries, which is fine for three
 * numbers and unreadable for twenty — and it hid the thing v6's review found:
 * measured against the reference the deer was 37% leg and 19% neck-and-head,
 * where the drawing is 19% leg and 29% neck-and-head. You cannot see that in
 * a ternary. Side by side in a table you can.
 *
 * Everything is in HEAD UNITS (see `fitToHeight`), so these are ratios and
 * the absolute size lives in `CRITTER_COLORS[kind].height`.
 */
interface QuadProp {
  /** Hip to ground. */
  legLen: number;
  legR: number;
  /** Barrel centre above the hip. */
  bodyRise: number;
  bodyLen: number;
  /** Half-width, half-depth of the barrel. */
  chestW: number;
  chestH: number;
  /** How far the head sits above the barrel — the NECK, in effect. */
  headRise: number;
  neckR: number;
  skull: readonly [number, number, number];
  snout: readonly [number, number, number];
  snoutZ: number;
  noseZ: number;
  eyeR: number;
  eyeAt: readonly [number, number, number];
  /** Lens scale, and the angular radii of the iris and pupil caps. */
  lens: readonly [number, number, number];
  irisArc: number;
  pupilArc: number;
  earLen: number;
  earWide: number;
  earTilt: number;
  earSweep: number;
}

const QUAD: Record<"deer" | "fox", QuadProp> = {
  // THE DEER IS MOSTLY NECK AND THAT IS THE WHOLE ANIMAL (v6). Nuno: *"the
  // deer should have a little of rework to look more like a deer and cute."*
  // Measured off the reference as fractions of standing height — antlers
  // 26%, head and neck 29%, body 26%, legs 19% — against what shipped, which
  // was legs 37%, body 20%, head and neck 19%. A short neck on long legs is a
  // FAWN-COLOURED PONY; the long upright neck rising out of a deep chest is
  // the one silhouette nothing else in this theme has. So the legs come down,
  // the barrel gets deeper, and the neck goes up by half again.
  //
  // CUTE IS A SEPARATE AXIS AND IT IS MOSTLY THE FACE: a big round cranium, a
  // SHORT muzzle rather than the horse-like snout this had, and eyes that are
  // nearly half the head deep with the pupil covering most of them. The old
  // eye was 0.1 on a 0.3 skull with a 0.74 pupil, which at any size reads as
  // a bead.
  deer: {
    legLen: 0.95,
    legR: 0.1,
    bodyRise: 0.6,
    // LONGER AND SHALLOWER THAN THE FIRST TUNING, which came back a BALL.
    // A deer's barrel is about 1.7 times longer than it is deep; at 1.5 long
    // and 1.24 deep it was 1.2, and three overlapping spheres at that ratio
    // union into a sphere. The depth is what had to give, not the length —
    // a deeper body on shorter legs is a pig whatever its length.
    bodyLen: 1.78,
    chestW: 0.45,
    chestH: 0.53,
    headRise: 1.46,
    neckR: 0.2,
    skull: [0.33, 0.32, 0.33],
    snout: [0.155, 0.14, 0.23],
    snoutZ: 0.33,
    noseZ: 0.56,
    // SIZED AND SEATED TOGETHER, because the first tuning got the size right
    // and the seating wrong and the result was a GOOGLY EYE — a full sphere
    // sitting 76% proud of the skull, which reads as a frog. A cartoon eye is
    // a dome SET INTO the head: solve `d + r - R` for the protrusion, where
    // d is the eye centre's distance from the skull centre and R the skull's
    // radius there. At 0.155/0.206 out of a 0.33 skull with r 0.12 that is
    // 0.048, i.e. 40% of the eye proud and 60% buried.
    // THE LENS IS WHAT BUYS THE SEATING NOW. v6 solved `d + r - R` by hand to
    // keep a sphere from bulging; a lens flattened to half its depth is
    // barely proud whatever the skull does, so the eye could go back UP in
    // size — which is the cute lever — without becoming a googly again.
    eyeR: 0.15,
    eyeAt: [0.168, 0.05, 0.222],
    lens: [0.95, 1.06, 0.5],
    // A THIN WHITE RING, AND IT IS BOUNDED AT BOTH ENDS. At 1.0 rad against
    // a lens whose visible oval runs to about 1.5 the eye was a white almond
    // with a black bead in it — startled, which is the opposite of the
    // brief, and characters.ts's own note is "the iris fills most of the
    // visible oval and leaves a thin white ring". At 1.26 the ring was GONE,
    // and that is worse than it sounds: the iris snaps to `bark` and the fur
    // to `wood`, one rung apart, so with no white between them the eye's
    // outer boundary is brown-on-tan and the whole shape stops reading. The
    // ring is not decoration, it is the OUTLINE this renderer has no ink
    // pass to draw.
    irisArc: 1.1,
    pupilArc: 0.64,
    // BIGGER AND MORE HORIZONTAL THAN v1's, and the reason is the antlers:
    // tucked at 0.56 of tilt they sat directly under the beams and read as
    // two slivers. A deer's ears are held OUT, nearly level, well below and
    // outside the rack — which is also what keeps them visible from the play
    // camera, where anything vertical foreshortens away.
    earLen: 0.33,
    earWide: 0.2,
    earTilt: 0.95,
    earSweep: -0.18,
  },
  // The fox is UNCHANGED. Its numbers were reviewed in v1 and it is not the
  // animal under review; lifting them into this table is a move, not an edit.
  fox: {
    legLen: 0.52,
    legR: 0.14,
    bodyRise: 0.46,
    bodyLen: 1.5,
    chestW: 0.55,
    chestH: 0.52,
    headRise: 0.34,
    neckR: 0.3,
    skull: [0.3, 0.3, 0.34],
    snout: [0.19, 0.16, 0.34],
    snoutZ: 0.38,
    noseZ: 0.72,
    eyeR: 0.112,
    eyeAt: [0.19, 0.08, 0.235],
    lens: [0.95, 1.0, 0.55],
    irisArc: 1.02,
    pupilArc: 0.58,
    earLen: 0.24,
    earWide: 0.16,
    earTilt: 0.34,
    earSweep: -0.1,
  },
};

function quadrupedBody(kind: "deer" | "fox", k: Kit, rnd: () => number): THREE.Group {
  const g = new THREE.Group();
  const deer = kind === "deer";
  const P = QUAD[kind];
  // BOTH OF THESE WERE MOSTLY LEG on the first pass, and it showed at once:
  // a slim barrel on four long spindles reads as a TABLE, and the reference
  // deer's body is easily half its standing height. v6 took the deer's legs
  // down again for the same reason one measurement further on — see QUAD.
  const legLen = P.legLen;
  const bodyY = legLen + P.bodyRise;
  const bodyLen = P.bodyLen;

  // --- 0: the barrel. A deer is DEEP AT THE FRONT and slopes away behind —
  // the withers are the high point and the rump falls from them. v1 had the
  // rump mass BIGGER than the chest and sitting higher, which put a step in
  // the back line going the wrong way and read as a hunch.
  // ONE CONTINUOUS BODY (v12). Nuno: *"on the body lets make the junction of
  // the part be more smooth and not so visible."*
  //
  // The deer's barrel was three overlapping ellipsoids — chest, body, rump —
  // and however hard they overlap, two intersecting surfaces meet at a CREASE:
  // the normal is discontinuous along the curve where one cuts the other, so
  // the matcap steps there and the seam reads as a line drawn round the
  // animal. No amount of overlap removes it, because the defect is not a gap.
  // It is also the one thing this project has called out from the start —
  // "no blob assemblies".
  //
  // The fix is the BEAGLE's: `taperedSweepGeometry`, a path of elliptical
  // cross-sections swept into one capped tube, which `computeVertexNormals`
  // then smooths end to end. characters.ts has used it for the dog's torso
  // since IDEA-047 for exactly this reason — "the one continuous body mass".
  //
  // **THE STATIONS ARE THE OLD UNION'S OWN SILHOUETTE, SAMPLED.** Nuno had
  // tuned those three blobs by hand in the editor, so the shape is his and
  // the only thing this change is allowed to alter is the creases:
  // `scripts/_scratch-body-stations.mjs` walks the union's outline in z and
  // emits the table below, with his saved scales folded in. Those three part
  // edits are therefore RETIRED from the def — they are in these numbers now.
  //
  // The end stations are pulled a half percent in from the true extent
  // rather than sitting on it: a station at the exact tip has zero radius and
  // a cap fanned from a zero-radius ring is a point, which shows as a pinch.
  const BODY_STATIONS: SweepStation[] = [
    { pos: [0, 1.55, -1.0022], rx: 0.0808, rz: 0.0688 },
    { pos: [0, 1.55, -0.8403], rx: 0.3393, rz: 0.289 },
    { pos: [0, 1.55, -0.6784], rx: 0.4167, rz: 0.355 },
    { pos: [0, 1.55, -0.5166], rx: 0.4268, rz: 0.3768 },
    { pos: [0, 1.55, -0.3547], rx: 0.4127, rz: 0.4244 },
    { pos: [0, 1.55, -0.1929], rx: 0.4393, rz: 0.4517 },
    { pos: [0, 1.55, -0.031], rx: 0.4497, rz: 0.4624 },
    { pos: [0, 1.5607, 0.1309], rx: 0.452, rz: 0.4684 },
    { pos: [0, 1.585, 0.2927], rx: 0.494, rz: 0.4854 },
    { pos: [0, 1.585, 0.4546], rx: 0.4941, rz: 0.4854 },
    { pos: [0, 1.585, 0.6164], rx: 0.4523, rz: 0.4444 },
    { pos: [0, 1.585, 0.7783], rx: 0.3542, rz: 0.348 },
    { pos: [0, 1.585, 0.9402], rx: 0.0822, rz: 0.0807 },
  ];
  const body = deer
    ? part(taperedSweepGeometry(BODY_STATIONS, 22), k.fur, "body", g)
    : part(blob(P.chestW, P.chestH, bodyLen * 0.5), k.fur, "body", g);
  if (!deer) body.position.set(0, bodyY, 0);
  if (!deer) {
    const foxChest = part(blob(P.chestW * 1.02, P.chestH * 1.0, bodyLen * 0.34), k.fur, "chest", g);
    foxChest.position.set(0, bodyY + 0.035, bodyLen * 0.21);
    const rump = part(blob(0.58, 0.56, 0.44), k.fur, "rump", g);
    rump.position.set(0, bodyY + 0.04, -bodyLen * 0.32);
  }
  // The pale underside. Both references carry it and it is what stops a
  // four-legged tan blob reading as a loaf.
  const under = part(blob(deer ? 0.35 : 0.4, deer ? 0.24 : 0.28, bodyLen * 0.4), k.belly, "underside", g);
  under.position.set(0, bodyY - (deer ? 0.28 : 0.3), 0.05);

  // --- legs. Endpoint-aimed; the front pair rakes slightly forward and the
  // back pair slightly back, which is what stops a standing animal looking
  // like a table.
  const legR = P.legR;
  // The hoof's height, shared so the cannon's last joint lands exactly on the
  // foot's top face. Typed in two places it drifts, and the symptom is the
  // open rim of a cylinder showing as a crescent between fur and horn.
  const HOOF_H = 0.098;
  // THE LEG RADII, NAMED, because the hoof has to be cut to the shank it
  // hangs from and a number typed in two places drifts (the same reason
  // HOOF_H is shared).
  //
  // ROBUST, v11. Nuno: *"lets make the legs more robust, they look too tight
  // to be on a deer body."* Measured at a matched framing the old leg was
  // already at the reference's own ratio — 0.19 of the body's depth against
  // 0.18 — so thickness alone was never the whole story, and raising it
  // without the second half below would have given a fat tube poked into a
  // balloon. What the reference actually shows is a HAUNCH CONTINUOUS WITH
  // THE RUMP: the limb is a swelling of the body that only becomes a separate
  // tube below the belly line. So the top radius goes up much harder than the
  // bottom (0.15 -> 0.22 at the hip against 0.044 -> 0.066 at the fetlock),
  // which both thickens the leg AND puts the muscle where the reference has
  // it. The taper is STEEPER now, not shallower.
  // AND THE HAUNCH BLOB IS WHY THE CONE DOES NOT HAVE TO CARRY IT ALL. The
  // first tuning put 0.22 at the hip and the thigh came out a slab; with a
  // rounded mass over it the cone can be 0.2, which also keeps its top inside
  // the rump (0.21 + 0.2 = 0.41 against the rump's 0.43 at that height).
  const LEG_B = [0.2, 0.155, 0.095, 0.078, 0.066] as const;
  const LEG_F = [0.17, 0.105, 0.085, 0.072] as const;
  for (const s of [-1, 1]) {
    if (deer) {
      // A DEER'S HIND LEG IS A Z, AND THAT IS THE WHOLE DIFFERENCE BETWEEN A
      // DEER AND A TABLE (v8).
      //
      // Four joints, not two. Hip, then the thigh swings FORWARD and down to
      // the stifle, then the tibia swings BACK and down to the HOCK, then the
      // cannon drops almost straight to the fetlock. The hock is the sharp
      // backward angle halfway down an ungulate's hind leg and it is the one
      // feature no other animal in this module has — a dog's is shallow, a
      // rabbit's is folded away under it, and a straight line through all
      // four is a stilt. Every quadruped in a cartoon is recognised on this
      // profile before anything else about it.
      //
      // The FORE leg is nearly straight by contrast — shoulder, carpus,
      // fetlock, with the carpus pushed a little forward — because that is
      // what a deer's is, and building the two the same way is most of why
      // this animal read as a table on four dowels.
      //
      // The radii are the other half: 0.15 at the hip down to 0.046 at the
      // fetlock is better than three to one, and the taper is what makes the
      // leg read as a LEG rather than as a rod. It is continuous across each
      // joint by construction (see `jointedLimb`).
      const legF = jointedLimb(
        [
          // THE SHOULDER AND THE HIP SIT INSIDE THE BARREL, SOLVED RATHER
          // THAN NUDGED. These cones are open-ended, so a chain whose first
          // joint is outside the body shows a straight CUT RIM on the flank —
          // which is what v11's first robust tuning did the moment the haunch
          // went to 0.22, a hard-edged panel hanging off the rump. Shrinking
          // the cap to hide it was the wrong lever and made it worse: a
          // sphere narrower than the disc it is capping cannot cap it.
          //
          // The requirement is `x + r <= the body's half-width AT that point`.
          // The chest is widest at its own centre height, so the shoulder goes
          // UP as well as in: 0.25 + 0.177 = 0.427 against the chest's 0.430
          // at y = bodyY. The rump gives 0.421 at the hip's height, so
          // 0.21 + 0.229 = 0.439 — a hair proud, and buried by the body blob
          // behind it. The STIFLE and CARPUS do not move, so the leg a player
          // sees is unchanged: only the part inside the animal does.
          [s * 0.25, bodyY, bodyLen * 0.33],
          [s * 0.29, 0.56, bodyLen * 0.375],
          // The FETLOCK, and then a short PASTERN raked forward onto the
          // hoof. Without it the cannon ran straight into the foot and the
          // ankle — the one joint on a hoofed leg you can always see — simply
          // was not there.
          [s * 0.287, 0.22, bodyLen * 0.365],
          [s * 0.285, HOOF_H, bodyLen * 0.378],
        ],
        LEG_F,
        k.fur,
        s < 0 ? "legFL" : "legFR",
        g,
      );
      const legB = jointedLimb(
        [
          [s * 0.21, bodyY - 0.02, -bodyLen * 0.28],
          // THE STIFLE BELONGS INSIDE THE BARREL. At y 0.84 it sat well below
          // the body's own underside, so the visible leg STARTED forward and
          // then swept back to the hock — which reads as a crouch, not a
          // stance. On a standing deer the stifle is tucked up against the
          // belly and the first thing you see of the hind leg is already on
          // its way DOWN AND BACK to the hock.
          [s * 0.3, 1.0, -bodyLen * 0.235],
          [s * 0.295, 0.5, -bodyLen * 0.335],
          [s * 0.292, 0.21, -bodyLen * 0.318],
          [s * 0.29, HOOF_H, -bodyLen * 0.308],
        ],
        LEG_B,
        k.fur,
        s < 0 ? "legBL" : "legBR",
        g,
      );
      // SIDED NAMES, because a duplicate name is a part the editor cannot
      // address (IDEA-065 v9). These were `hoofF`/`hoofB` built inside the
      // `for (const s of [-1, 1])` loop, so each name belonged to TWO meshes:
      // the Components tree showed two identical rows, and the Mirror action
      // correctly refuses an ambiguous twin rather than writing a transform
      // to whichever one `find` reached first. Same for the antler's upper
      // beam and its tines.
      //
      // THE HOOVES, and they are the reason `k.dark` is worth spending here.
      // A tapering leg that simply stops is a leg that has been cut off; a
      // deer's foot ends in a dark wedge, which at the shop stage finishes
      // the limb and at the apron is one dark pixel grounding it. Same ink as
      // the nose and the pupils, so no extra material and the style keeps
      // them dark. See `hoofWedge` for why it flares and why its base is
      // flat — both were wrong on the first build.
      // THE HAUNCH IS A ROUNDED MASS, NOT A FAT CONE (v11).
      //
      // v11's first robust tuning took the thigh cone's top radius from 0.15
      // to 0.22 and produced a flat RECTANGULAR SLAB hanging off the rump — a
      // defect that survived three crops and a segment-count change before a
      // raycast through the offending pixel named the part
      // (`scripts/_scratch-pixel-owner.ts`). The cause is geometric and worth
      // keeping: **a truncated cone is a RULED surface, so its silhouette is
      // a pair of straight lines.** At 0.15 that passes for a limb; at 0.22
      // it is a wide straight-sided plate, and no amount of radial resolution
      // helps because the facets were never the problem.
      //
      // A muscle is round. The blob straddles the body's edge at a third of
      // the way down the thigh — half inside the rump, half proud of it —
      // which is where v8 said a haunch has to be and is exactly what the
      // reference shows: a haunch CONTINUOUS WITH THE RUMP that only becomes
      // a separate tube below the belly. v8's version failed because it sat
      // BESIDE a thin straight leg and read as a paddle; over a thick cone it
      // rounds the slab off instead.
      const hipPt = new THREE.Vector3(s * 0.21, bodyY - 0.02, -bodyLen * 0.28);
      const stiflePt = new THREE.Vector3(s * 0.3, 1.0, -bodyLen * 0.235);
      const haunchAt = hipPt.clone().lerp(stiflePt, 0.27);
      const haunch = part(blob(0.25, 0.34, 0.27), k.fur, s < 0 ? "haunchL" : "haunchR", legB);
      haunch.position.set(
        haunchAt.x - legB.position.x,
        haunchAt.y - legB.position.y,
        haunchAt.z - legB.position.z,
      );

      // INSIDE THE LEG GROUP, so "the leg" is one component with everything
      // that makes it. A hoof left as a sibling of the leg is the one part
      // that stays behind when the leg is dragged — which is worse than four
      // loose parts, because three of them move and one does not.
      //
      // `inLimb` rebases an absolute body-frame point into the group, so the
      // numbers above and below stay in the same frame and readable against
      // `bodyLen`.
      const inLimb = (
        limb: THREE.Group,
        at: readonly [number, number, number],
      ): [number, number, number] => [at[0] - limb.position.x, at[1] - limb.position.y, at[2] - limb.position.z];
      hoofWedge(
        inLimb(legF, [s * 0.285, 0, bodyLen * 0.378]),
        LEG_F[LEG_F.length - 1],
        HOOF_H,
        k.dark,
        s < 0 ? "hoofFL" : "hoofFR",
        legF,
      );
      hoofWedge(
        inLimb(legB, [s * 0.29, 0, -bodyLen * 0.308]),
        LEG_B[LEG_B.length - 1],
        HOOF_H,
        k.dark,
        s < 0 ? "hoofBL" : "hoofBR",
        legB,
      );
      // AND THE HAUNCH BLOB IS GONE. v6 added it because a constant-radius
      // capsule had no muscle anywhere on it; the jointed leg's own 0.15 top
      // IS the muscle now, and the blob sitting beside it was a second,
      // rounder thigh in front of the real one — meeting the leg at a hard
      // CREASE, which is the one artefact the hindquarter crop showed. A
      // part added to compensate for a missing feature has to come out when
      // the feature arrives.
    } else {
      limb([s * 0.3, bodyY - 0.22, bodyLen * 0.34], [s * 0.28, 0, bodyLen * 0.4], legR, k.fur, s < 0 ? "legFL" : "legFR", g);
      limb([s * 0.32, bodyY - 0.22, -bodyLen * 0.34], [s * 0.3, 0, -bodyLen * 0.42], legR, k.fur, s < 0 ? "legBL" : "legBR", g);
    }
  }
  // The fox's black SOCKS. A fox without them is a tan dog; they are the
  // second thing the reference draws after the tail.
  if (!deer) {
    for (const s of [-1, 1]) {
      for (const z of [bodyLen * 0.4, -bodyLen * 0.42]) {
        const sock = part(blob(legR * 1.25, 0.16, legR * 1.45), k.accent, "sock", g);
        sock.position.set(s * (z > 0 ? 0.28 : 0.3), 0.13, z);
      }
    }
  }

  // --- the neck and head. A deer's neck is the feature; a fox's barely
  // exists, which is why one is a tube and the other is a shoulder.
  //
  // IT IS NEARLY UPRIGHT ON THE DEER AND IT IS BUILT IN TWO PIECES. One
  // straight capsule from shoulder to skull gives a RAMP, and the reference's
  // neck leaves the chest steeply, then eases forward under the head — the
  // shallow S that is most of what makes the pose alert rather than grazing.
  const headY = bodyY + P.headRise;
  const headZ = bodyLen * (deer ? 0.4 : 0.58);
  if (deer) {
    // Named points, because the BIB is placed against them below and a bib
    // positioned by hand-typed numbers is a bib buried inside its own neck —
    // which is exactly what the first tuning shipped, with two cream corners
    // poking through where the neck happened to be thinner. Seventh
    // appearance of the buried-part family in this project.
    // THE NECK'S ENDPOINTS ARE NUNO'S, MEASURED OFF THE SHIPPED PROP AND
    // BAKED IN (v13). They were authored from `bodyY`/`headRise` and then
    // re-tuned in the editor — a `position` MOVES a limb segment and a
    // `scale.y` shortens it about its own midpoint, so the neck that ships
    // started at y 1.813, not the 1.710 this code said.
    //
    // That mattered because the BELL below has to be solved against the
    // barrel's cross-section AT THE NECK'S BASE, and solving it against a
    // base a tenth of a unit lower gave a flare 0.449 wide where the body is
    // only 0.430 — so it came out through the shoulder as a hard collar, for
    // the second time and for a completely different reason than the first.
    // **A number you solve against has to be the number that ships**, which
    // means folding the saved edit in rather than reading past it. The two
    // neck edits are retired into these three points.
    const nLo: readonly [number, number, number] = [0, 1.8129, 0.4746];
    const nMid: readonly [number, number, number] = [0, 2.3491, 0.5934];
    const nHi: readonly [number, number, number] = [0, 2.7759, 0.6503];
    const rLo = P.neckR * 1.15;
    const rHi = P.neckR * 0.92;
    // THE BELL IS ELLIPTICAL, AND THAT IS WHAT MAKES IT BIG ENOUGH TO WORK.
    //
    // A ROUND flare is bounded by whichever direction runs out of barrel
    // first, and that is fore-aft: at 2.0x the rim reached z 0.92, past the
    // point where the chest has narrowed to a fifth of it, and the bell came
    // out through the FRONT of the animal as a hard-edged collar. Capping it
    // round therefore caps it at ~1.3x, which barely softens anything.
    //
    // But the barrel is 0.49 wide and only tapers fore-aft, so there is far
    // more room LATERALLY than there is forward — and sideways is also where
    // the junction is seen, since the game and the review cameras both look
    // at the animal's flank. Solved per axis against the body's own
    // cross-section at the neck's base (half-width 0.477 at that height, and
    // the body still contains the rim out to z 0.75), the bell goes to 1.95x
    // across and 1.22x fore-aft. The same mesh, nearly twice the blend, and
    // still entirely inside the chest.
    flaredLimb(
      nLo,
      nMid,
      [
        [rLo * 1.75, rLo * 1.3],
        [rLo * 1.36, rLo * 1.16],
        [rLo * 1.16, rLo * 1.06],
        [rLo * 1.02, rLo * 1.0],
        [rLo * 0.96, rLo * 0.96],
      ],
      k.fur,
      "neck",
      g,
    );
    limb([0, 2.2681, 0.6077], nHi, rHi, k.fur, "neckUpper", g);

    // The white bib runs down the front of that long neck in the reference,
    // and at the apron it is the only thing marking the neck as a neck rather
    // than as a stick. Each patch is laid ON the segment it belongs to:
    // interpolate the axis at that height, step out by the segment's own
    // radius, and pull back by half the patch's depth so it sits just proud.
    const onNeck = (
      a0: readonly [number, number, number],
      a1: readonly [number, number, number],
      r: number,
      t: number,
      depth: number,
    ): [number, number] => {
      const y = a0[1] + (a1[1] - a0[1]) * t;
      const z = a0[2] + (a1[2] - a0[2]) * t + r - depth * 0.5;
      return [y, z];
    };
    const [by, bz] = onNeck(nLo, nMid, rLo, 0.55, 0.12);
    const bib = part(blob(0.13, 0.34, 0.12), k.belly, "bib", g);
    bib.position.set(0, by, bz);
    const [uy, uz] = onNeck([0, 2.2681, 0.6077], nHi, rHi, 0.55, 0.11);
    const bibUpper = part(blob(0.11, 0.26, 0.11), k.belly, "bibUpper", g);
    bibUpper.position.set(0, uy, uz);
  } else {
    limb([0, bodyY + 0.12, bodyLen * 0.3], [0, headY - 0.16, headZ - 0.1], P.neckR, k.fur, "neck", g);
  }

  const head = new THREE.Group();
  head.name = "head";
  head.position.set(0, headY, headZ);
  g.add(head);
  part(blob(...(P.skull as [number, number, number])), k.fur, "skull", head);
  // The SNOUT, and it is long on both — a muzzle is what separates a deer or
  // a fox from every upright critter in this module, which all have round
  // faces. SHORT on the deer, though: cuteness in a cartoon mammal is a big
  // cranium over a stubby muzzle, and v1's was two thirds of the skull's own
  // length, which is a pony.
  const snout = part(blob(...(P.snout as [number, number, number])), k.fur, "snout", head);
  snout.position.set(0, -0.1, P.snoutZ);
  // The pale muzzle. v1 called this a "cheek" and sat it wide and low, which
  // swelled the jaw; on the deer it is the cream chin-and-lip the reference
  // draws, tucked UNDER the snout rather than beside it.
  const cheek = part(
    deer ? blob(0.12, 0.085, 0.16) : blob(0.22, 0.12, 0.22),
    k.belly,
    "cheek",
    head,
  );
  cheek.position.set(0, deer ? -0.185 : -0.16, deer ? 0.36 : 0.4);
  const nose = part(blob(deer ? 0.085 : 0.08, deer ? 0.072 : 0.07, 0.07), k.dark, "nose", head);
  nose.position.set(0, deer ? -0.055 : -0.04, P.noseZ);

  for (const s of [-1, 1]) {
    eye(head, s, P.eyeAt, k, s < 0 ? "eyeL" : "eyeR", {
      r: P.eyeR,
      lens: P.lens,
      iris: P.irisArc,
      pupil: P.pupilArc,
    });
  }
  for (const s of [-1, 1]) {
    ear(
      head,
      s,
      deer ? [0.255, 0.1, -0.09] : [0.2, 0.2, -0.06],
      P.earLen,
      P.earWide,
      0.08,
      P.earTilt,
      P.earSweep,
      k.fur,
      deer ? k.belly : k.accent,
      s < 0 ? "earL" : "earR",
      0.6,
    );
  }

  if (deer) {
    // --- THE ANTLERS. Identity rank 1 and nothing else in the theme has
    // anything like them, so they are built as real branching tubes rather
    // than suggested with a blob. All endpoint-aimed.
    //
    // v6 REBUILT THEM AND THE CHANGE IS WHERE THE TINES POINT. v1's swept
    // OUTWARD and BACKWARD from a 0.045 beam — three bare twigs a side, which
    // from the play camera's 59 degrees project almost entirely into the
    // plan and vanish (the critter sheet's own note). A real rack rises
    // first: a thick beam going UP and only then out, with every tine
    // pointing UP and slightly FORWARD, so the whole thing still has vertical
    // extent from above. The beam is also half again as thick — at 0.045 on a
    // 0.33 skull it was a wire, where the reference's base is nearly as thick
    // as the ear.
    for (const s of [-1, 1]) {
      // The PEDICLE: the short fat stub the antler grows out of. Without it
      // the beam starts in mid-air at the skull's surface and reads as stuck
      // on rather than grown.
      const ped = part(blob(0.095, 0.085, 0.095), k.accent, s < 0 ? "pedicleL" : "pedicleR", head);
      ped.position.set(s * 0.155, 0.27, -0.02);
      const base: readonly [number, number, number] = [s * 0.16, 0.3, -0.03];
      const mid: readonly [number, number, number] = [s * 0.3, 0.76, -0.14];
      const top: readonly [number, number, number] = [s * 0.38, 1.04, 0.0];
      limb(base, mid, 0.088, k.accent, s < 0 ? "antlerL" : "antlerR", head);
      limb(mid, top, 0.07, k.accent, s < 0 ? "antlerUpperL" : "antlerUpperR", head);
      // TWO TINES A SIDE, NOT THREE, AND BOTH POINT UP AND FORWARD. Three
      // read as a TANGLE at review size — the eye cannot follow six thin
      // branches crossing each other, and what it gets instead is a bush. A
      // cartoon rack is a few thick prongs; the reference has more than this
      // and the reference is six hundred pixels tall.
      limb(mid, [s * 0.52, 0.98, 0.14], 0.058, k.accent, s < 0 ? "tine1L" : "tine1R", head);
      limb([s * 0.21, 0.5, -0.06], [s * 0.36, 0.86, 0.22], 0.054, k.accent, s < 0 ? "tine2L" : "tine2R", head);
    }
    // The reference's white dapples, and v6 moved them where they can be
    // seen. v1 put six on the RUMP, which is the one panel the play camera
    // never has square to it and which the animal's own hindquarters hide
    // from three sides out of four; they are on the upper FLANK now, where
    // the reference draws them, and FLATTENED ALONG THE SURFACE NORMAL rather
    // than along y — a sphere squashed vertically still pokes out of a flank
    // sideways and reads as a wart.
    for (let i = 0; i < 8; i++) {
      const s = i % 2 === 0 ? -1 : 1;
      const row = Math.floor(i / 2);
      const dy = 0.26 - row * 0.17 + (rnd() - 0.5) * 0.06;
      const dz = bodyLen * (0.14 - row * 0.13) + (rnd() - 0.5) * 0.1;
      // A SPOT HAS TO SIT ON THE SURFACE IT IS PAINTED ON, and the barrel is
      // an ELLIPSOID — its half-width at the shoulder is not its half-width
      // at the waist. Placed at a constant x the fore and aft spots floated
      // clear of a body that had narrowed away underneath them, which reads
      // as warts rather than as dapples. Solving the ellipsoid for the local
      // half-width at (dy, dz) puts every one of them just under the skin.
      const u = dz / (bodyLen * 0.5);
      const v = dy / P.chestH;
      const shrink = Math.sqrt(Math.max(0.15, 1 - u * u - v * v));
      const sp = part(blob(0.028, 0.07, 0.07), k.belly, "spot" + i, g);
      sp.position.set(s * P.chestW * shrink * 0.94, bodyY + dy, dz);
    }
  }

  // --- the tail.
  if (deer) {
    // Cocked UP, which is what a deer's tail does and the only thing that
    // makes a 0.2-unit nub read as a tail rather than as a lump on the rump.
    const t = part(blob(0.11, 0.19, 0.09), k.belly, "tail", g);
    t.position.set(0, bodyY + 0.24, -bodyLen * 0.58);
    t.rotation.x = -0.5;
  } else {
    // THE BRUSH, and it is as thick as the fox's own body on purpose: the
    // reference's tail is the single biggest mass in the drawing after the
    // torso, and a fox drawn with a thin tail is a cat. Held LEVEL and
    // sweeping back, with a pale tip.
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, bodyY + 0.1, -bodyLen * 0.5),
      new THREE.Vector3(0.1, bodyY + 0.16, -bodyLen * 0.95),
      new THREE.Vector3(0.2, bodyY + 0.1, -bodyLen * 1.35),
      new THREE.Vector3(0.26, bodyY - 0.06, -bodyLen * 1.6),
    ]);
    // AS THICK AS THE FOX'S OWN BODY, which is the measurement and not an
    // exaggeration: the reference's tail is the single biggest mass in the
    // drawing after the torso. At 0.24 it came out a rope, and a fox with a
    // rope for a tail is a small dog — the one read this model exists to
    // avoid, given the squirrel beside it is the same orange.
    // It TAPERS to the white tip. Built with the larger radius at t=1 the
    // brush ended in a flat disc with a cream ball capping it, which reads as
    // a snowball stuck on the end — the width belongs in `ringedTail`'s own
    // mid-curve bulge, not at the far end.
    part(ringedTail(curve, 0.32, 0.2, 22, 9, 1), [k.fur], "tail", g);
    const tip = part(blob(0.23, 0.21, 0.23), k.belly, "tailTip", g);
    tip.position.set(0.26, bodyY - 0.07, -bodyLen * 1.62);
  }

  head.rotation.y = (rnd() - 0.5) * 0.35;
  return g;
}

/**
 * The squirrel explorer's kit: a pith helmet and a walking staff.
 *
 * It is the ONLY prop in this game that carries an object, and the hat is why
 * it exists as a separate kind rather than as a recoloured squirrel — a wide
 * pale disc on top of the head changes the silhouette more than any colour
 * could, which is the only currency these six have (IDEA-056 rule 1).
 *
 * The reference also gives it a map, a bedroll and a satchel. None of those
 * are here: they are all inside the body's own outline, so at the apron they
 * would cost triangles and change nothing. The hat and the staff both break
 * the silhouette, which is the test.
 */
function explorerKit(body: THREE.Group, head: THREE.Object3D): void {
  const hatMat = toon({ color: 0xd8c99a });
  const bandMat = toon({ color: 0x8a5a33 });
  // Sized to clear the squirrel's own EARS rather than to the reference's
  // proportion: built at the drawn size the crown swallowed both ears and the
  // tufts came out through the top of it, which reads as a modelling error
  // rather than as a hat.
  const brim = part(new THREE.CylinderGeometry(0.66, 0.7, 0.06, 14), hatMat, "hatBrim", head);
  brim.position.set(0, 0.56, 0.02);
  brim.rotation.x = -0.1;
  const crown = part(blob(0.38, 0.3, 0.38), hatMat, "hatCrown", head);
  crown.position.set(0, 0.72, 0.02);
  const band = part(new THREE.CylinderGeometry(0.4, 0.4, 0.09, 14), bandMat, "hatBand", head);
  band.position.set(0, 0.6, 0.02);

  const staff = limb(
    [0.62, -0.1, 0.52],
    [0.52, 2.55, 0.3],
    0.055,
    toon({ color: 0x6b4a2f }),
    "staff",
    body,
  );
  void staff;
}

/**
 * critter — one of six woodland animals, chosen by `params.critterKind`.
 *
 *  - `params.critterKind` (default "rabbit").
 *  - `params.furColor` / `params.bellyColor` / `params.accentColor` override
 *    the kind's own three tones. The accent is whatever the kind's reference
 *    makes dark: a fox's socks, a raccoon's mask and tail bands, a deer's
 *    antlers, a rabbit's inner ear.
 *  - `params.height` (default 1) multiplies the kind's OWN standing height,
 *    which is per-kind because a deer and a rabbit are not the same size.
 *  - `params.width` (default 1) is a girth multiplier on top.
 */
export function makeForestCritter(params: PropParams, h: number): THREE.Group {
  const kind = (params.critterKind ?? "rabbit") as ForestCritterKind;
  const spec = CRITTER_COLORS[kind] ?? CRITTER_COLORS.rabbit;
  const k = kitFor(kind, params);
  const rnd = rand(h);

  const g = new THREE.Group();
  const inner =
    kind === "deer"
      ? quadrupedBody(kind, k, rnd)
      : kind === "fox"
        ? foxBody(k, rnd)
        : uprightBody(kind, k, rnd);
  g.add(inner);

  if (kind === "squirrelExplorer") {
    const head = inner.getObjectByName("head");
    if (head) explorerKit(inner, head);
  }

  const w = params.width ?? 1;
  inner.scale.set(w, 1, w);
  // Built in head units; fitted here. See `fitToHeight`.
  fitToHeight(inner, spec.height * (params.height ?? 1));
  // A quarter turn of body yaw per instance, so a row of them is a group of
  // animals rather than a rank of soldiers.
  g.rotation.y = (rnd() - 0.5) * 0.8;
  return g;
}
