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
 * THE EYE, and it is one stack for every critter here for the same reason
 * every ENEMY shares one (`characters.ts`'s rule 8): a cream sclera BALL, a
 * dark pupil CAP on it, and a catchlight inside that.
 *
 * These are props and nothing recolours them, so the state argument does not
 * apply — but the shape one does. A single dark disc on a tan face reads as a
 * hole at any size, and at the shop stage's magnification it reads as a dead
 * one. The sclera is what makes an eye an eye.
 */
function eye(
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  r: number,
  scleraMat: THREE.Material,
  pupilMat: THREE.Material,
  glintMat: THREE.Material,
  name: string,
): void {
  const pivot = new THREE.Group();
  pivot.name = name;
  pivot.position.set(x, y, z);
  // Aim the whole stack outward-and-forward, so the pupil cap stays flush on
  // the sclera however far round the head the eye sits.
  pivot.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(x, 0, Math.abs(z)).normalize(),
  );
  parent.add(pivot);
  part(new THREE.SphereGeometry(r, 8, 6), scleraMat, name + "Sclera", pivot);
  const pup = part(new THREE.SphereGeometry(r * 0.74, 8, 6), pupilMat, name + "Pupil", pivot);
  pup.position.z = r * 0.42;
  const gl = part(new THREE.SphereGeometry(r * 0.26, 6, 5), glintMat, name + "Glint", pivot);
  gl.position.set(-r * 0.26, r * 0.3, r * 0.78);
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
  { fur: number; belly: number; accent: number; height: number }
> = {
  // `height` is the critter's own standing height in WORLD UNITS at scale 1,
  // and it is per-kind on purpose: a deer and a rabbit are not the same size,
  // and making them so would be the one thing about a set of woodland animals
  // that nothing else could excuse.
  deer: { fur: 0xc97f3e, belly: 0xf2e2c8, accent: 0x6b4a2f, height: 0.95 },
  fox: { fur: 0xe07a2c, belly: 0xf6efe2, accent: 0x2e2620, height: 0.58 },
  rabbit: { fur: 0xd9a468, belly: 0xf4e3c6, accent: 0xe8a3a0, height: 0.62 },
  raccoon: { fur: 0x8d8a86, belly: 0xc9c4bc, accent: 0x2f2c2a, height: 0.6 },
  squirrel: { fur: 0xd4682a, belly: 0xf3e6d2, accent: 0x8a3f14, height: 0.58 },
  squirrelExplorer: { fur: 0xdd6f24, belly: 0xf6ead6, accent: 0xd8c99a, height: 0.68 },
};

interface Kit {
  fur: THREE.MeshToonMaterial;
  belly: THREE.MeshToonMaterial;
  accent: THREE.MeshToonMaterial;
  dark: THREE.MeshToonMaterial;
  sclera: THREE.MeshToonMaterial;
  glint: THREE.MeshBasicMaterial;
}

function kitFor(kind: ForestCritterKind, params: PropParams): Kit {
  const c = CRITTER_COLORS[kind];
  return {
    fur: toon({ color: params.furColor ?? c.fur }),
    belly: toon({ color: params.bellyColor ?? c.belly }),
    accent: toon({ color: params.accentColor ?? c.accent }),
    dark: toon({ color: 0x27211d }),
    sclera: toon({ color: 0xf8f3e8 }),
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
    eye(head, s * 0.21, 0.1, eyeZ, eyeR, k.sclera, k.dark, k.glint, s < 0 ? "eyeL" : "eyeR");
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

function quadrupedBody(kind: "deer" | "fox", k: Kit, rnd: () => number): THREE.Group {
  const g = new THREE.Group();
  const deer = kind === "deer";
  // BOTH OF THESE WERE MOSTLY LEG on the first pass, and it showed at once:
  // a slim barrel on four long spindles reads as a TABLE, and the reference
  // deer's body is easily half its standing height. The numbers are still in
  // the ratio the references give (a deer is leggier than a fox by a factor of
  // about two) — they are just both shorter, and both bodies are fatter.
  const legLen = deer ? 1.1 : 0.52;
  const bodyY = legLen + (deer ? 0.56 : 0.46);
  const bodyLen = deer ? 1.55 : 1.5;

  // --- 0: the barrel. Longer than it is tall, and pinched at the waist by
  // sitting the haunch mass separately behind it.
  const body = part(blob(deer ? 0.52 : 0.55, deer ? 0.56 : 0.52, bodyLen * 0.5), k.fur, "body", g);
  body.position.set(0, bodyY, 0);
  const rump = part(blob(deer ? 0.56 : 0.58, deer ? 0.58 : 0.56, 0.46), k.fur, "rump", g);
  rump.position.set(0, bodyY + 0.04, -bodyLen * 0.42);
  // The pale underside. Both references carry it and it is what stops a
  // four-legged tan blob reading as a loaf.
  const under = part(blob(0.4, 0.28, bodyLen * 0.42), k.belly, "underside", g);
  under.position.set(0, bodyY - 0.3, 0.05);

  // --- legs. Endpoint-aimed; the front pair rakes slightly forward and the
  // back pair slightly back, which is what stops a standing animal looking
  // like a table.
  const legR = deer ? 0.115 : 0.14;
  for (const s of [-1, 1]) {
    limb([s * 0.3, bodyY - 0.22, bodyLen * 0.34], [s * 0.28, 0, bodyLen * 0.4], legR, k.fur, s < 0 ? "legFL" : "legFR", g);
    limb([s * 0.32, bodyY - 0.22, -bodyLen * 0.34], [s * 0.3, 0, -bodyLen * 0.42], legR, k.fur, s < 0 ? "legBL" : "legBR", g);
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
  const headY = bodyY + (deer ? 1.0 : 0.34);
  const headZ = bodyLen * (deer ? 0.42 : 0.58);
  limb(
    [0, bodyY + 0.12, bodyLen * 0.3],
    [0, headY - 0.16, headZ - 0.1],
    deer ? 0.22 : 0.3,
    k.fur,
    "neck",
    g,
  );
  if (deer) {
    // The white bib runs down the front of that long neck in the reference,
    // and at the apron it is the only thing marking the neck as a neck rather
    // than as a stick.
    const bib = part(blob(0.15, 0.5, 0.13), k.belly, "bib", g);
    bib.position.set(0, (bodyY + headY) / 2 + 0.1, bodyLen * 0.38);
  }

  const head = new THREE.Group();
  head.name = "head";
  head.position.set(0, headY, headZ);
  g.add(head);
  part(blob(0.3, 0.3, 0.34), k.fur, "skull", head);
  // The SNOUT, and it is long on both — a muzzle is what separates a deer or
  // a fox from every upright critter in this module, which all have round
  // faces.
  const snout = part(blob(deer ? 0.17 : 0.19, 0.16, deer ? 0.3 : 0.34), k.fur, "snout", head);
  snout.position.set(0, -0.1, 0.38);
  const cheek = part(blob(deer ? 0.15 : 0.22, 0.12, 0.22), k.belly, "cheek", head);
  cheek.position.set(0, -0.16, 0.4);
  const nose = part(blob(0.08, 0.07, 0.07), k.dark, "nose", head);
  nose.position.set(0, -0.04, deer ? 0.66 : 0.72);

  for (const s of [-1, 1]) {
    eye(head, s * 0.19, 0.08, 0.24, 0.1, k.sclera, k.dark, k.glint, s < 0 ? "eyeL" : "eyeR");
  }
  for (const s of [-1, 1]) {
    ear(
      head,
      s,
      [0.2, 0.2, -0.06],
      deer ? 0.3 : 0.24,
      deer ? 0.17 : 0.16,
      0.08,
      deer ? 0.7 : 0.34,
      -0.1,
      k.fur,
      deer ? k.belly : k.accent,
      s < 0 ? "earL" : "earR",
      0.6,
    );
  }

  if (deer) {
    // --- THE ANTLERS. Identity rank 1 and nothing else in the theme has
    // anything like them, so they are built as real branching tubes rather
    // than suggested with a blob. Three tines a side, all endpoint-aimed.
    for (const s of [-1, 1]) {
      const base: readonly [number, number, number] = [s * 0.16, 0.28, -0.04];
      const mid: readonly [number, number, number] = [s * 0.34, 0.78, -0.12];
      const top: readonly [number, number, number] = [s * 0.44, 1.15, 0.02];
      limb(base, mid, 0.045, k.accent, s < 0 ? "antlerL" : "antlerR", head);
      limb(mid, top, 0.036, k.accent, "antlerUpper", head);
      limb(mid, [s * 0.62, 0.98, -0.3], 0.03, k.accent, "tine1", head);
      limb([s * 0.25, 0.52, -0.08], [s * 0.52, 0.7, 0.16], 0.028, k.accent, "tine2", head);
    }
    // The reference's white rump spots. Six, not the reference's dozens: at a
    // fifth of a tile a spot is a pixel, and a dozen pixels is noise.
    for (let i = 0; i < 6; i++) {
      const sx = i % 2 === 0 ? -1 : 1;
      const sp = part(blob(0.07, 0.05, 0.07), k.belly, "spot" + i, g);
      sp.position.set(sx * (0.3 + rnd() * 0.14), bodyY + 0.22 - Math.floor(i / 2) * 0.2, -bodyLen * (0.1 + rnd() * 0.3));
    }
  }

  // --- the tail.
  if (deer) {
    const t = part(blob(0.12, 0.2, 0.1), k.belly, "tail", g);
    t.position.set(0, bodyY + 0.3, -bodyLen * 0.6);
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
    kind === "deer" || kind === "fox"
      ? quadrupedBody(kind, k, rnd)
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
