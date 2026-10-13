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
import { taperedSweepGeometry, type SweepStation } from "./beagleSculpt";

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
 * A RINGED tail — the raccoon's identity, and the one thing on any of these
 * six that a colour swap alone could not produce.
 *
 * Built as a tapered tube swept along a curve, with the bands assigned as
 * per-triangle MATERIAL GROUPS by RING INDEX. Classifying by a triangle's own
 * height instead puts the two halves of every quad on opposite sides of a
 * boundary and the band edge zigzags around the circumference — IDEA-055
 * rule 3, and the same defect as IDEA-047's "spiky markings".
 */
function ringedTail(
  curve: THREE.Curve<THREE.Vector3>,
  r0: number,
  r1: number,
  rings: number,
  radial: number,
  bands: number,
): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const frames = curve.computeFrenetFrames(rings, false);
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const p = curve.getPointAt(t);
    const N = frames.normals[i];
    const B = frames.binormals[i];
    // A tail is fat at the base, fatter still at the shoulder of the brush,
    // and comes to a tip. A straight taper reads as a carrot.
    const bulge = Math.sin(Math.PI * Math.min(1, t * 1.15)) * 0.28 + 1;
    const r = THREE.MathUtils.lerp(r0, r1, t) * bulge;
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const v = N.clone().multiplyScalar(Math.cos(a) * r).add(B.clone().multiplyScalar(Math.sin(a) * r)).add(p);
      pos.push(v.x, v.y, v.z);
    }
  }
  const groups: number[][] = [[], []];
  for (let i = 0; i < rings; i++) {
    // Which band this RING belongs to. Decided once for the whole ring, so
    // the boundary is a clean circle.
    const band = Math.floor((i / rings) * bands) % 2;
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j;
      const b = i * radial + ((j + 1) % radial);
      const c = (i + 1) * radial + j;
      const d = (i + 1) * radial + ((j + 1) % radial);
      groups[band].push(a, c, d, a, d, b);
    }
  }
  idx.push(...groups[0], ...groups[1]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  if (groups[0].length) geo.addGroup(0, groups[0].length, 0);
  if (groups[1].length) geo.addGroup(groups[0].length, groups[1].length, 1);
  geo.computeVertexNormals();
  return geo;
}

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
  part(blob(0.5, 0.48, 0.48), k.fur, "skull", head);
  const muzzle = part(blob(0.28, 0.22, 0.26), k.belly, "muzzle", head);
  muzzle.position.set(0, -0.14, 0.36);
  const nose = part(blob(0.09, 0.07, 0.07), k.accent, "nose", head);
  nose.position.set(0, -0.06, 0.56);

  // The raccoon's MASK is identity rank 1 alongside its tail, and it is
  // GEOMETRY — dark patches standing proud of the skull — for the bib's
  // reason. Painted flush it would be a grey shape on a grey head.
  //
  // TWO PATCHES AND A BRIDGE, NOT A BAR, and this is the one thing about the
  // raccoon that had to be rebuilt. A single dark bar across the eyes is what
  // the reference LOOKS like and it is not what the reference IS: built that
  // way the bar's own depth swallowed both eyeballs whole, and the pale
  // forehead band that is supposed to sit above it read as the PEAK OF A CAP.
  // The result was a raccoon in sunglasses and a baseball cap — every part
  // correct, correctly coloured, and assembled into a different animal.
  //
  // A patch per eye, sunk back so the eye stands PROUD of it, plus a thin
  // bridge over the nose, gives the same read and leaves the eyes where they
  // can be seen. The forehead band is gone: the mask reads on its own.
  const eyeR = 0.13;
  // THE RACCOON'S EYE SITS IN FRONT OF ITS MASK, not level with it. Two
  // patches was the right construction and it was still not enough: at the
  // same z as the eyeballs, a patch whose radius is 0.21 against an eye's
  // 0.13 simply engulfs it, and the sheet came back with the animal still in
  // sunglasses. The patch is now a SHALLOW disc pressed to the skull and the
  // eye stands a full radius proud of it.
  const eyeZ = kind === "raccoon" ? 0.44 : 0.38;
  if (kind === "raccoon") {
    for (const s of [-1, 1]) {
      const patch = part(blob(0.2, 0.16, 0.07), k.accent, s < 0 ? "maskL" : "maskR", head);
      patch.position.set(s * 0.21, 0.09, 0.36);
    }
    const bridge = part(blob(0.09, 0.08, 0.07), k.accent, "maskBridge", head);
    bridge.position.set(0, 0.03, 0.4);
  }
  for (const s of [-1, 1]) {
    eye(head, s, [0.21, 0.1, eyeZ], k, s < 0 ? "eyeL" : "eyeR", { r: eyeR });
  }

  // --- 4/5: the arms, held in front. Aimed by endpoints (see `limb`).
  for (const s of [-1, 1]) {
    limb([s * 0.44, 1.5, 0.18], [s * 0.26, 1.06, 0.46], 0.14, k.fur, s < 0 ? "armL" : "armR", g);
  }
  // --- 6/7: the feet, peeping out at the front. Without them the pear sits
  // on the soil like a dropped egg.
  for (const s of [-1, 1]) {
    const f = part(blob(0.2, 0.13, 0.31), k.fur, s < 0 ? "footL" : "footR", g);
    f.position.set(s * 0.34, 0.13, 0.42);
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
    // Small and ROUND, set wide. A raccoon's ear is a semicircle on the
    // corner of its skull, and setting it upright like a squirrel's is most
    // of what made the first pass read as a grey squirrel.
    for (const s of [-1, 1]) {
      // LOW and only just splayed. At tilt 0.5 and set high they stood off
      // the skull as two loose balls, which is the "blob assembly" read this
      // project has been moving away from since IDEA-047.
      ear(head, s, [0.33, 0.22, -0.03], 0.19, 0.21, 0.1, 0.28, -0.05, earMat, k.belly, s < 0 ? "earL" : "earR", 0.62);
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

  // --- last: the tail. Identity separator #2, and it is the part that
  // changes the silhouette most.
  if (kind === "rabbit") {
    // A puff, and nothing more. The rabbit's whole tail budget goes on the
    // ears; a big tail here would fight them.
    const t = part(blob(0.26, 0.26, 0.24), k.belly, "tail", g);
    t.position.set(0, 0.62, -0.72);
  } else if (kind === "raccoon") {
    // RINGED, and swept down and back so the bands are seen across their
    // width rather than end-on. The rings are the identity; a raccoon tail
    // carried vertically foreshortens them into a smudge at the play camera's
    // 59 degrees of elevation.
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.75, -0.5),
      new THREE.Vector3(0, 0.6, -1.05),
      new THREE.Vector3(0, 0.3, -1.45),
      new THREE.Vector3(0, 0.06, -1.6),
    ]);
    const geo = ringedTail(curve, 0.2, 0.13, 24, 8, 7);
    part(geo, [k.fur, k.accent], "tail", g);
  } else {
    // The squirrel's PLUME, arcing up and OVER its own back — the one tail in
    // the set that rises above the head, which is what separates it from the
    // rabbit at any size and in any colour.
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.6, -0.6),
      new THREE.Vector3(0, 1.35, -1.15),
      new THREE.Vector3(0, 2.25, -0.95),
      new THREE.Vector3(0, 2.72, -0.2),
    ]);
    // Wide, and it must be: the reference's plume is the biggest single mass
    // in the drawing after the body. At 0.22 it swept over the back as a
    // SAUSAGE — the right path and the wrong volume, which reads as a
    // question mark rather than as fur.
    const geo = ringedTail(curve, 0.3, 0.46, 22, 9, 1);
    part(geo, [k.fur], "tail", g);
    const plumeTip = part(blob(0.34, 0.3, 0.3), k.belly, "tailTip", g);
    plumeTip.position.set(0, 2.7, -0.16);
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

  // --- legs. Jointed and tapering (IDEA-065 v8), but far straighter than the
  // deer's: a fox's hock is shallow and its foreleg is almost a post. The
  // STOCKING is the lower two segments in the accent, which is why each leg
  // is built in two calls rather than one — a material boundary mid-limb is
  // the one thing `jointedLimb` cannot express, and a stocking is exactly
  // that boundary.
  // A JOINTED CHAIN HAS TO DESCEND, AND RAISING ONE POINT IS NOT RAISING THE
  // JOIN. Moving the stocking's top from legLen*0.3 to *0.62 meant moving the
  // UPPER chain's last point — which left it ABOVE the middle one, so the
  // thigh folded back on itself and the leg rendered as a thin black stick
  // under a short orange stub. Both points move together or the limb reverses.
  //
  // THE STOCKING IS MORE THAN HALF THE LEG. Measured off the reference, the
  // black runs from the paw up past the knee — about 55% of the leg a viewer
  // can see — where the first build put a short bootie on the bottom quarter.
  // On an animal that is otherwise one flat orange, black legs are the
  // strongest mark it has, and a bootie throws most of that away.
  const LEG_UPPER = [0.175, 0.142, 0.118] as const;
  const LEG_LOWER = [0.118, 0.1, 0.086] as const;
  for (const s of [-1, 1]) {
    // front
    const fx = s * 0.235;
    jointedLimb(
      [
        [fx, bodyY + 0.02, bodyLen * 0.3],
        [fx * 1.04, legLen * 0.82, bodyLen * 0.32],
        [fx * 1.06, legLen * 0.62, bodyLen * 0.335],
      ],
      LEG_UPPER,
      k.fur,
      s < 0 ? "legFL" : "legFR",
      g,
    );
    const sockF = jointedLimb(
      [
        [fx * 1.06, legLen * 0.62, bodyLen * 0.335],
        [fx * 1.07, legLen * 0.26, bodyLen * 0.35],
        [fx * 1.07, 0.035, bodyLen * 0.36],
      ],
      LEG_LOWER,
      k.accent,
      s < 0 ? "stockingFL" : "stockingFR",
      g,
    );
    const pawF = part(blob(0.1, 0.055, 0.125), k.accent, s < 0 ? "pawFL" : "pawFR", sockF);
    pawF.position.set(0, -legLen * 0.18, bodyLen * 0.025);
    // back — a shallow hock, enough to say quadruped and not enough to say deer
    const bx = s * 0.245;
    jointedLimb(
      [
        [bx, bodyY + 0.02, -bodyLen * 0.3],
        [bx * 1.02, legLen * 0.86, -bodyLen * 0.21],
        [bx * 1.04, legLen * 0.6, -bodyLen * 0.33],
      ],
      LEG_UPPER,
      k.fur,
      s < 0 ? "legBL" : "legBR",
      g,
    );
    const sockB = jointedLimb(
      [
        [bx * 1.04, legLen * 0.6, -bodyLen * 0.33],
        [bx * 1.05, legLen * 0.26, -bodyLen * 0.3],
        [bx * 1.05, 0.035, -bodyLen * 0.29],
      ],
      LEG_LOWER,
      k.accent,
      s < 0 ? "stockingBL" : "stockingBR",
      g,
    );
    const pawB = part(blob(0.1, 0.055, 0.125), k.accent, s < 0 ? "pawBL" : "pawBR", sockB);
    pawB.position.set(0, -legLen * 0.18, bodyLen * 0.015);
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

  // --- the head, carried high and pointed forward-and-down a little.
  const head = new THREE.Group();
  head.name = "head";
  head.position.set(0, bodyY + 0.86, bodyLen * 0.54);
  g.add(head);
  part(blob(0.375, 0.345, 0.36), k.fur, "skull", head);

  // THE MUZZLE IS A WEDGE, not the deer's stub and not the old build's long
  // snout. A fox's face narrows to a point from a wide brow, which is most of
  // what the eye uses to tell it from a dog.
  const snout = part(blob(0.15, 0.135, 0.23), k.fur, "snout", head);
  snout.position.set(0, -0.08, 0.31);
  const snoutTip = part(blob(0.098, 0.09, 0.12), k.fur, "snoutTip", head);
  snoutTip.position.set(0, -0.1, 0.45);
  const nose = part(blob(0.062, 0.055, 0.055), k.dark, "nose", head);
  nose.position.set(0, -0.085, 0.545);

  // THE WHITE RUFF: cheeks flaring out and back under each ear, and a pale
  // chin running down the muzzle. This is the fox's value pattern and it is
  // the half of the identity that colour CAN carry — the silhouette does the
  // rest.
  for (const s of [-1, 1]) {
    // A FLARE ALONG THE JAW, swept back — a round pale blob on the cheek
    // reads as BLUSHER, which two tunings of it duly did. The reference
    // draws the ruff as fur running back and down from under the ear, so
    // it is long in z, thin in x, and tilted.
    // LOW AND FORWARD, under the jaw rather than on the cheek. Sat out on
    // the side of the face it is a pale OVAL on an orange head — which is
    // what the side view showed, twice. The reference's white runs under
    // the muzzle and down the throat; the cheek only catches its edge.
    const ruff = part(blob(0.075, 0.1, 0.2), k.belly, s < 0 ? "ruffL" : "ruffR", head);
    ruff.position.set(s * 0.21, -0.195, 0.12);
    ruff.rotation.set(0.2, 0, -s * 0.45);
  }
  // THE LOWER FACE IS WHITE, which is the single biggest thing the first
  // three builds got wrong: they painted an orange muzzle with a cream chin
  // strip. In the reference the white covers the whole muzzle from under the
  // eyes forward, plus both cheeks — the orange is only the brow, the bridge
  // and the top of the head. That inversion is why it kept reading as a
  // generic canid: a fox's face is a white mask with an orange cap.
  const mask = part(blob(0.185, 0.14, 0.26), k.belly, "faceMask", head);
  mask.position.set(0, -0.145, 0.34);
  const chin = part(blob(0.12, 0.08, 0.17), k.belly, "chin", head);
  chin.position.set(0, -0.195, 0.28);

  for (const s of [-1, 1]) {
    eye(head, s, [0.175, 0.075, 0.235], k, s < 0 ? "eyeL" : "eyeR", {
      r: 0.125,
      lens: [0.95, 1.0, 0.52],
      iris: 1.05,
      pupil: 0.6,
    });
  }

  // --- THE EARS, which are the whole animal. Big, upright, broad at the base
  // and pointed, with a dark back and a pale inner — the reference's own
  // three-tone ear. `ear` owns its inner by construction (IDEA-065's
  // unrepresentable-defect fix), so the dark BACK is a third blob behind the
  // shell rather than a fourth argument.
  for (const s of [-1, 1]) {
    // A FOX'S EAR IS A TRIANGLE, AND `ear()` CANNOT MAKE ONE.
    //
    // That helper builds a flattened BLOB, which is a rounded lozenge — right
    // for a deer, a rabbit and a squirrel, and the reason two tunings of it
    // here came back reading as a RABBIT however big or small they were. The
    // reference's ear is broad at the base with straight sides running to a
    // point, and that outline is most of what separates a fox from every
    // other orange animal in this module at a glance.
    //
    // A CONE IS A TRIANGLE SEEN FACE ON, so a cone flattened along its own
    // depth is a triangular fin — the shape, for free, from a primitive. Three
    // of them nested give the reference's own three tones in the order that
    // makes it a fox's ear rather than a fennec's: an orange edge, a white
    // inner, a dark back. Built here rather than in `ear()` because adding a
    // shape mode to a helper four other kinds depend on is how you change
    // four animals to fix one.
    // BROADER THAN TALL AT THE BASE. At 0.23 wide on 0.52 the fins read
    // as HORNS; the reference's ear is nearly as wide as it is tall.
    const EAR_H = 0.45;
    const EAR_W = 0.335;
    const earPivot = new THREE.Group();
    earPivot.name = s < 0 ? "earL" : "earR";
    earPivot.position.set(s * 0.165, 0.185, -0.05);
    earPivot.rotation.z = -s * 0.38;
    earPivot.rotation.x = -0.12;
    // DEPTH AND YAW ARE ONE DECISION, AND TUNING EITHER ALONE OVERSHOOTS.
    // At 0.34 of depth the fin is nearly a plane, so the yaw that stops it
    // vanishing edge-on from the SIDE (0.55) turns it square-on at the
    // three-quarter — where it reads as a flat orange KITE, which is the same
    // defect from the opposite direction. A deeper fin (0.52) is legible from
    // both, so the yaw can come back to 0.4 and the ear is a solid shape at
    // every angle rather than a plate at one and an edge at another.
    //
    // TURNED OUTWARD, and this is what a flat fin needs that a blob does
    // not. An ear in the sagittal plane is seen EDGE ON from the side —
    // the one view a quadruped prop is mostly seen from — and 0.34 of
    // depth is a sliver, so the ears came back as two black spikes. A
    // real ear is a cup aimed out and forward; at 0.55 rad the fin keeps
    // most of its width from the flank and still reads from the front.
    earPivot.rotation.y = s * 0.4;
    head.add(earPivot);
    const fin = (
      w: number,
      h: number,
      depth: number,
      mat: THREE.Material,
      name: string,
      z: number,
    ): void => {
      const geo = new THREE.ConeGeometry(w, h, 12, 1, false);
      geo.scale(1, 1, depth);
      const m = part(geo, mat, name, earPivot);
      m.position.set(0, h / 2, z);
      m.castShadow = true;
    };
    fin(EAR_W, EAR_H, 0.52, k.fur, s < 0 ? "earLShell" : "earRShell", 0);
    fin(EAR_W * 0.6, EAR_H * 0.76, 0.42, k.belly, s < 0 ? "earLInner" : "earRInner", EAR_W * 0.2);
    fin(EAR_W * 0.97, EAR_H * 0.98, 0.4, k.accent, s < 0 ? "earLBack" : "earRBack", -EAR_W * 0.18);
  }

  // --- THE BRUSH. As thick as the fox's own body on purpose: the reference's
  // tail is the single biggest mass in the drawing after the torso, and a fox
  // drawn with a thin tail is a cat. It sweeps BACK AND UP — held low and
  // straight it is a rat's tail — and ends in a broad white tip.
  const curve = new THREE.CatmullRomCurve3([
    // THE BASE STARTS WHERE THE BODY IS STILL WIDE ENOUGH TO SWALLOW IT.
    // `ringedTail` is open at BOTH ends, and at -0.5 the barrel has already
    // tapered to 0.07 while the brush is 0.30 — so the base's open rim stood
    // clear of the rump as a hard vertical CUT with the body visible past it.
    // That is what read as a flat sheet, and it took a crop at four times to
    // see that the defect was at the END I had not been looking at: the taper,
    // the sweep and the tip were all retuned first on the other theory.
    new THREE.Vector3(0, bodyY, -bodyLen * 0.26),
    new THREE.Vector3(0.05, bodyY - 0.08, -bodyLen * 0.82),
    new THREE.Vector3(0.09, bodyY - 0.22, -bodyLen * 1.1),
    new THREE.Vector3(0.12, bodyY - 0.12, -bodyLen * 1.36),
  ]);
  // THICK FOR MOST OF ITS LENGTH. A brush that tapers steadily from base
  // to tip is a tapering TUBE, and swept upward a tapering tube reads as a
  // flat FIN — which is what the side view showed. A real brush is nearly
  // parallel-sided until it rounds off, so the far radius is most of the
  // near one and the curve is carried BACK rather than up.
  part(ringedTail(curve, 0.3, 0.22, 24, 11, 1), [k.fur], "tail", g);
  // THE TIP IS AN EXTENSION OF THE BRUSH, NOT A BALL ON IT. IDEA-065 v1
  // already learned this on the old tail — "a cream snowball stuck on the
  // end" — and a round blob put it straight back. Stretched along the
  // tail's own direction and tapered, it reads as the brush going white.
  // THE TIP HAS TO BE WIDER THAN THE TUBE IT CAPS. `ringedTail` is OPEN at
  // both ends — the base is buried in the rump and the far end is not — so a
  // tip blob narrower than the final ring leaves the rim showing, and an open
  // rim seen from the side is a straight hard edge across the brush. That is
  // what read as a flat SHEET, and it was neither the taper nor the sweep,
  // both of which were retuned first on that theory.
  const tip = part(blob(0.26, 0.25, 0.3), k.belly, "tailTip", g);
  tip.position.set(0.12, bodyY - 0.12, -bodyLen * 1.36);
  tip.rotation.x = -0.2;

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
