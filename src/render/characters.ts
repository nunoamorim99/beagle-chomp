// OWNER: render-artist
// Beagle + enemy meshes built from primitives (grouped). Later can be swapped
// for glTF models (see PROJECT_PLAN M6). Reference: prototype makeBeagle/makeGhost.
// Contract: makeBeagle(skin?): THREE.Group, userData.coatMats for live
// re-skinning via applyBeagleSkin ; makeGhost(colorHex) / makeBeetle(colorHex)
// (IDEA-009 enemy skins): THREE.Group with userData { bodyMat, eyes, pups,
// pupM, baseColor, hem, skirt, pupOffset } for state-driven recolouring via
// applyGhostState — makeEnemy(skinId, colorHex) dispatches between the two so
// callers don't need to know which skin is equipped.
import * as THREE from "three";
import { type Entity, entityWorld } from "../game/movement";
import { type Vec2 } from "../game/grid";
import { type GhostState } from "../game/ghostAI";
import { COLORS } from "../game/config";
import { type BeagleSkin, getEquippedBeagleSkin } from "../game/cosmetics";
import { toon } from "./toon";
import {
  taperedSweepGeometry,
  latheFromProfile,
  splitCoatGroups,
  SPHERE_PROFILE,
  type SweepStation,
  type CoatRegion,
} from "./beagleSculpt";

/**
 * Animatable sub-parts of the beagle model, stashed on the group's userData
 * so `syncToEntity` can pose them per frame without any geometry rebuilds.
 * Each is a pivot `Group` (not the visible mesh directly) positioned at the
 * joint, with the actual mesh(es) offset inside it â€” rotating the pivot
 * therefore swings the part the way a real joint would.
 */
export interface BeagleParts {
  earL: THREE.Group;
  earR: THREE.Group;
  tail: THREE.Group;
  jaw: THREE.Group;
  legs: THREE.Group[]; // [frontL, frontR, backL, backR]
}

/**
 * The 4 coat materials a beagle skin swaps, stashed on the group's userData
 * (`g.userData.coatMats`) so a later skin change (see `applyBeagleSkin`) can
 * recolour the existing mesh in place â€” no geometry rebuild, no remove/re-add,
 * the model keeps animating uninterrupted.
 */
/** Nose leather and iris when a skin names neither — what every coat wore
 *  before the two channels existed. */
const DEFAULT_NOSE = 0x4a3028;
const DEFAULT_IRIS = 0xa2672e;

export interface BeagleCoatMats {
  tan: THREE.MeshToonMaterial;
  white: THREE.MeshToonMaterial;
  black: THREE.MeshToonMaterial;
  ear: THREE.MeshToonMaterial;
  /** Paws only. Falls back to the coat's `white` when a skin omits it. */
  paw: THREE.MeshToonMaterial;
  /** Brows only. Meaningless while the brows are hidden, which is the default. */
  brow: THREE.MeshToonMaterial;
  /** Nose leather. Per-skin: it does NOT follow `black`. */
  nose: THREE.MeshToonMaterial;
  /** Iris. Per-skin, like the nose. */
  iris: THREE.MeshToonMaterial;
}

/**
 * Builds the beagle — the img2threejs reference rebuild (the second full
 * sculpt; evidence, spec and the review trail live in .img2threejs/). Nose
 * points toward +Z at rotation.y = 0, matching ARCHITECTURE's
 * "yaw = atan2(dir.x, dir.y)" facing convention.
 *
 * THE TECHNIQUE — station-swept solids (torso, legs, ears, tail) and lathe
 * profiles (skull, muzzle, nose, paws, brow swells), with the tricolor coat
 * cut into per-triangle MATERIAL GROUPS by region predicates (see
 * beagleSculpt.ts): the saddle/blaze/bib/socks/tail-tip each land on one of
 * the shared skinnable toon materials, so applyBeagleSkin recolours the
 * whole dog in place exactly as before. Data tables sit just above
 * makeBeagle; the numbers are measured off the reference in head-units and
 * locked by the pipeline's proportion gates.
 */
/**
 * The Pac-Beagle brow, as two bars meeting at an apex — a triangle with its
 * bottom line left off.
 *
 * HAND-AUTHORED, not derived. The first version computed both bars from a
 * spread angle and an apex height, which is tidier to read and was simply the
 * wrong shape; these are the values Nuno dialled in on the LEFT brow in the
 * character editor, transcribed here and mirrored to the right (see `m` at the
 * call site).
 *
 * They had to be transcribed BY HAND because the editor could not save them
 * itself, and that is a documented limit rather than a bug: sourceRewrite.ts
 * can only edit a part that has its own `const` line to rewrite, and these
 * bars are built inside the per-side loop — same as the ears, side caps and
 * legs. The editor reports the refusal instead of writing something that would
 * not compile. Reach for "Copy edits" and paste into this table.
 *
 * Local to the brow group, which the pivot has already aimed down the gaze.
 */
const BROW_BARS = [
  { tag: "Inner", pos: [-0.047, 0.087, 0.007], rot: [-0.137, 0.06, -1.001] },
  { tag: "Outer", pos: [0.018, 0.093, 0.005], rot: [0.248, -0.007, 1.199] },
] as const;

// ---------------------------------------------------------------------------
// The reworked beagle (img2threejs reference rebuild — evidence, spec and the
// review trail live in .img2threejs/). Every number below was measured off the
// reference image in head-units (HH = 0.30 world units; total height 0.84
// pre-scale) and locked by that pipeline's proportion gates — tune through the
// editor or re-run the pipeline, don't eyeball-edit the tables.
//
// Coat markings are PER-TRIANGLE MATERIAL GROUPS cut by the region tables:
// each triangle lands on one of the shared skinnable toon materials
// (0 = tan, 1 = black, 2 = white), so applyBeagleSkin recolours the whole coat
// exactly as before. The triangle-quantised boundary is deliberate — at game
// scale it reads as the reference's torn-fur edge.
// ---------------------------------------------------------------------------
const COAT_TAN = 0;
const COAT_BLACK = 1;
const COAT_WHITE = 2;

/** Torso sweep: rump -> chest, chest deeper than rump (tuck-up), rounded caps. */
const TORSO_STATIONS: SweepStation[] = [
  { pos: [0, 0.028, -0.025], rx: 0.04, rz: 0.045 },
  { pos: [0, 0.026, -0.005], rx: 0.082, rz: 0.088 },
  { pos: [0, 0.025, 0.045], rx: 0.114, rz: 0.114 },
  { pos: [0, 0.028, 0.15], rx: 0.128, rz: 0.128 },
  { pos: [0, 0.029, 0.225], rx: 0.128, rz: 0.136 },
  { pos: [0, 0.03, 0.3], rx: 0.13, rz: 0.142 },
  { pos: [0, 0.03, 0.35], rx: 0.128, rz: 0.14 },
  { pos: [0, 0.03, 0.395], rx: 0.12, rz: 0.134 },
  { pos: [0, 0.029, 0.425], rx: 0.088, rz: 0.105 },
  { pos: [0, 0.028, 0.44], rx: 0.045, rz: 0.055 },
];
/** Saddle over the back, white bib at the chest, white belly underneath. */
const TORSO_COAT: CoatRegion[] = [
  { kind: "capsule", start: [0, 0.125, 0.02], end: [0, 0.12, 0.22], r0: 0.105, r1: 0.088, mat: COAT_BLACK },
  // The bib reaches up the torso's FRONT to where the neck lands, so the
  // throat white and the chest white are one shape — no tan shoulder wedges
  // spiking in at the junction. Narrow at the top so the shoulders stay tan.
  { kind: "capsule", start: [0, 0.1, 0.36], end: [0, -0.09, 0.49], r0: 0.09, r1: 0.125, mat: COAT_WHITE },
  { kind: "blob", center: [0, -0.12, 0.2], radii: [0.09, 0.08, 0.19], mat: COAT_WHITE },
];

/** White blaze up the forehead centre + white jaw/chin underside on a tan head. */
const HEAD_COAT: CoatRegion[] = [
  { kind: "capsule", start: [0, -0.06, 0.15], end: [0, 0.14, 0.055], r0: 0.048, r1: 0.028, mat: COAT_WHITE },
  { kind: "blob", center: [0, -0.125, 0.05], radii: [0.085, 0.05, 0.1], mat: COAT_WHITE },
];

/** Neck: white throat with a tan nape (blends head-tan into the back). */
const NECK_COAT: CoatRegion[] = [
  { kind: "band", axis: 2, min: -0.09, max: -0.022, mat: COAT_TAN },
];

/** Pendant ear: flattened teardrop hanging down-out-forward, tip curling in. */
function earStations(s: -1 | 1): SweepStation[] {
  return [
    { pos: [0, 0.012, 0.0], rx: 0.014, rz: 0.028 },
    { pos: [0.056 * s, -0.05, 0.012], rx: 0.018, rz: 0.046 },
    { pos: [0.078 * s, -0.13, 0.026], rx: 0.018, rz: 0.056 },
    { pos: [0.076 * s, -0.21, 0.05], rx: 0.013, rz: 0.04 },
    { pos: [0.068 * s, -0.245, 0.08], rx: 0.004, rz: 0.004 },
  ];
}

/** Front leg: near-columnar taper; the wide top is buried in the chest. */
const LEG_FRONT_STATIONS: SweepStation[] = [
  { pos: [0, 0.03, 0], rx: 0.03, rz: 0.034 },
  { pos: [0, -0.005, 0.004], rx: 0.06, rz: 0.066 },
  { pos: [0, -0.05, 0.004], rx: 0.058, rz: 0.062 },
  { pos: [0, -0.13, 0], rx: 0.044, rz: 0.046 },
  { pos: [0, -0.21, 0], rx: 0.036, rz: 0.037 },
  { pos: [0, -0.31, 0], rx: 0.033, rz: 0.035 },
];
/** Hind leg: haunch mass tapering into a short lower leg. */
const LEG_HIND_STATIONS: SweepStation[] = [
  { pos: [0, 0.035, -0.015], rx: 0.03, rz: 0.04 },
  { pos: [0, -0.01, -0.012], rx: 0.072, rz: 0.094 },
  { pos: [0, -0.07, -0.004], rx: 0.066, rz: 0.084 },
  { pos: [0, -0.14, 0.006], rx: 0.048, rz: 0.054 },
  // a station exactly at the sock line, so the coat cut is a clean ring
  { pos: [0, -0.17, 0.004], rx: 0.043, rz: 0.047 },
  { pos: [0, -0.21, 0.002], rx: 0.037, rz: 0.039 },
  { pos: [0, -0.325, 0], rx: 0.033, rz: 0.035 },
];
const LEG_FRONT_COAT: CoatRegion[] = [
  { kind: "band", axis: 1, min: -0.05, max: 0.06, mat: COAT_TAN },
];
const LEG_HIND_COAT: CoatRegion[] = [
  { kind: "band", axis: 1, min: -0.31, max: -0.17, mat: COAT_WHITE },
];

/** Flag tail: thick root, sabre curve, white tip on a black shaft. */
const TAIL_STATIONS: SweepStation[] = [
  { pos: [0, 0.0, 0.0], rx: 0.033, rz: 0.035 },
  { pos: [0, 0.1, -0.008], rx: 0.028, rz: 0.03 },
  { pos: [0, 0.2, -0.01], rx: 0.02, rz: 0.022 },
  { pos: [0, 0.27, 0.0], rx: 0.012, rz: 0.013 },
  { pos: [0, 0.3, 0.014], rx: 0.004, rz: 0.004 },
];
const TAIL_COAT: CoatRegion[] = [
  { kind: "band", axis: 1, min: 0.195, max: 0.34, mat: COAT_WHITE },
];

/**
 * Bridge ("stop"): the ramp from the muzzle top up between the eyes into the
 * forehead — wide and thin, sections lying flat, only its top surface
 * cresting above muzzle and skull. Head-local; ends taper to blend.
 */
const BRIDGE_STATIONS: SweepStation[] = [
  // Stations sampled from ONE quadratic curve (level along the muzzle top,
  // then a smooth climb into the forehead) with near-constant thickness
  // through the middle, so the top surface is a parallel of that arc and
  // cannot kink where hand-placed stations meet.
  { pos: [0, -0.0400, 0.2240], rx: 0.024, rz: 0.01 },
  { pos: [0, -0.0382, 0.2010], rx: 0.04, rz: 0.022 },
  { pos: [0, -0.0329, 0.1799], rx: 0.05, rz: 0.03 },
  { pos: [0, -0.0240, 0.1607], rx: 0.052, rz: 0.032 },
  { pos: [0, -0.0115, 0.1435], rx: 0.05, rz: 0.032 },
  { pos: [0, 0.0045, 0.1282], rx: 0.046, rz: 0.03 },
  { pos: [0, 0.0241, 0.1149], rx: 0.04, rz: 0.026 },
  { pos: [0, 0.0473, 0.1035], rx: 0.03, rz: 0.018 },
  { pos: [0, 0.0740, 0.0940], rx: 0.018, rz: 0.01 },
];

/** Muzzle profile: fuller at the flews/chin band, slightly squared front. */
const MUZZLE_PROFILE = [
  [0.001, -0.5], [0.3, -0.46], [0.44, -0.34], [0.5, -0.12], [0.5, 0.1],
  [0.44, 0.28], [0.3, 0.42], [0.001, 0.5],
] as const;
/** Nose profile: rounded-triangle read — wide base tapering up. */
const NOSE_PROFILE = [
  [0.001, -0.5], [0.36, -0.42], [0.5, -0.15], [0.46, 0.12], [0.32, 0.34], [0.001, 0.5],
] as const;
/** Paw profile: an egg bulb, wider than the leg shaft. */
const PAW_PROFILE = [
  [0.001, -0.5], [0.3, -0.44], [0.45, -0.25], [0.5, 0.0], [0.42, 0.28], [0.25, 0.43], [0.001, 0.5],
] as const;

export function makeBeagle(skin: BeagleSkin = getEquippedBeagleSkin()): THREE.Group {
  const g = new THREE.Group();
  const { coat } = skin;
  const tan = toon({ color: coat.tan });
  const white = toon({ color: coat.white });
  const black = toon({ color: coat.black });
  const earMat = toon({ color: coat.ear });
  const pawMat = toon({ color: coat.paw ?? coat.white });
  const browMat = toon({ color: coat.brow ?? 0x141210 });
  // Fixed, never skinned: nose leather, eye and its unlit catchlight (the one
  // deliberate MeshBasicMaterial in the character — a toon ramp quantises a
  // highlight into the surroundings and it stops reading as a catchlight).
  const noseMat = toon({ color: coat.nose ?? DEFAULT_NOSE });
  const scleraMat = toon({ color: 0xfdf9f2 });
  const irisMat = toon({ color: coat.iris ?? DEFAULT_IRIS });
  const pupilMat = toon({ color: 0x1c110c });
  const glintM = new THREE.MeshBasicMaterial({ color: 0xffffff });
  // Named so the editor can find their declarations and save colour edits
  // in place (a material's `.name` is the variable name that made it).
  noseMat.name = "noseMat";
  scleraMat.name = "scleraMat";
  irisMat.name = "irisMat";
  pupilMat.name = "pupilMat";
  glintM.name = "glintM";

  /** A flush cap of the eyeball: radius factor, angular radius (rad), then
   *  aimed from the gaze (+Z) by `up` and `outward` tilts in radians. */
  const EYE_R = 0.054;
  const eyeCap = (factor: number, thetaLen: number, up: number, outward: number): THREE.SphereGeometry => {
    const geo = new THREE.SphereGeometry(EYE_R * factor, 24, 16, 0, Math.PI * 2, 0, thetaLen);
    geo.rotateX(Math.PI / 2); // pole from +Y to +Z (the gaze)
    if (up !== 0) geo.rotateX(-up);
    if (outward !== 0) geo.rotateY(outward);
    return geo;
  };

  /** Material slots the coat-region splitter indexes into: tan/black/white. */
  const coatSlots = [tan, black, white];

  // --- torso: the one continuous body mass ---
  const body = new THREE.Mesh(
    splitCoatGroups(taperedSweepGeometry(TORSO_STATIONS, 28), COAT_TAN, TORSO_COAT),
    coatSlots,
  );
  body.name = "body";
  body.scale.set(1.1, 1, 1);
  body.position.set(0, 0.32, -0.22);
  g.add(body);

  // --- neck: short white throat, chin nearly on the chest ---
  const neck = new THREE.Mesh(
    splitCoatGroups(
      latheFromProfile([[0.56, -0.5], [0.5, -0.15], [0.42, 0.2], [0.34, 0.5]], 16, 0.2, 0.17, 0.19),
      COAT_WHITE,
      NECK_COAT,
    ),
    coatSlots,
  );
  neck.name = "neck";
  neck.rotation.set(0.338, 0, 0);
  neck.position.set(-0.002, 0.461, 0.152);
  g.add(neck);

  // --- head group: skull + muzzle + nose + jaw + eyes + brows + ears ---
  const head = new THREE.Group();
  head.name = "head";
  head.position.set(0, 0.65, 0.202);
  g.add(head);

  const skull = new THREE.Mesh(
    splitCoatGroups(latheFromProfile(SPHERE_PROFILE, 24, 0.285, 0.27, 0.27), COAT_TAN, HEAD_COAT),
    coatSlots,
  );
  skull.name = "skull";
  head.add(skull);

  const muzzle = new THREE.Mesh(latheFromProfile(MUZZLE_PROFILE, 20, 0.175, 0.135, 0.175), white);
  muzzle.name = "muzzle";
  muzzle.scale.set(1.012, 0.774, 1.163);
  muzzle.position.set(0, -0.08, 0.14);
  head.add(muzzle);

  // Bridge ("stop"): the ridge that runs from the muzzle top up between the
  // eyes into the forehead — it is what joins muzzle and skull into one face
  // and gives the eye sockets their depth on the inner side.
  const bridge = new THREE.Mesh(taperedSweepGeometry(BRIDGE_STATIONS, 14), white);
  bridge.name = "bridge";
  bridge.scale.set(0.9, 1, 1);
  bridge.position.set(0, 0, -0.014);
  head.add(bridge);

  // Muzzle roots: the corner where the muzzle's sides meet the skull, just
  // under and inside each eye — filled so muzzle and head read as one face.
  const muzzleRootL = new THREE.Mesh(latheFromProfile(SPHERE_PROFILE, 14, 0.078, 0.07, 0.09), white);
  muzzleRootL.name = "muzzleRootL";
  muzzleRootL.scale.set(0.88, 0.9, 1.66);
  muzzleRootL.rotation.set(0.164, 0, 0);
  muzzleRootL.position.set(0.015, -0.035, 0.145);
  head.add(muzzleRootL);
  const muzzleRootR = new THREE.Mesh(latheFromProfile(SPHERE_PROFILE, 14, 0.078, 0.07, 0.09), white);
  muzzleRootR.name = "muzzleRootR";
  muzzleRootR.scale.set(0.881, 0.901, 1.663);
  muzzleRootR.rotation.set(0.164, 0, 0);
  muzzleRootR.position.set(-0.017, -0.033, 0.145);
  head.add(muzzleRootR);

  // the oversized rounded-triangle nose leather sitting on the muzzle front
  const nose = new THREE.Mesh(latheFromProfile(NOSE_PROFILE, 16, 0.075, 0.062, 0.052), noseMat);
  nose.name = "nose";
  nose.position.set(0, -0.055, 0.23);
  head.add(nose);

  // Jaw: white lower-lip pivot hinged under the muzzle root so syncToEntity's
  // chomp swings it open/closed beneath the snout.
  const jaw = new THREE.Group();
  jaw.name = "jaw";
  jaw.position.set(0, -0.115, 0.095);
  const jawMesh = new THREE.Mesh(new THREE.SphereGeometry(0.07, 14, 10), white);
  jawMesh.name = "jawMesh";
  jawMesh.rotation.set(0.192, 0, 0);
  jawMesh.scale.set(0.75, 0.443, 1.313);
  jawMesh.position.set(0, -0.008, 0.026);
  jaw.add(jawMesh);
  head.add(jaw);

  // Eyes: the GHOST's cartoon eye, ported (Nuno's call — the painted-lens
  // puppy eye with its rim ring and lid tori never read as part of the head;
  // the ghost's two big ovals do). One egg-shaped WHITE ball, flattened into
  // a lens and sunk into the skull; the iris, pupil and two catchlights are
  // flush caps of the same sphere (a cap rotated about the sphere's centre
  // stays on it), aimed with eyeCap(): pole to +Z, then tilted up/out. The
  // socket is the brow swell above only. CUTE, not startled: the iris fills
  // most of the visible oval and leaves a thin white ring; the pupil is a
  // smaller disc inside it; each catchlight is centred 0.55 rad from the
  // pupil axis — exactly its radius — so it straddles the pupil/iris edge.
  //
  // EVERY eye part is a TOP-LEVEL declaration (not loop- or helper-built) so
  // the editor can save its transform in place. A cap's own rotation is
  // about the eye centre, so rotating one in the editor keeps it flush.
  // The lens shape and aim are the ones Nuno dialled in the editor.
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(EYE_R, 24, 20), scleraMat);
  eyeL.name = "eyeL";
  eyeL.position.set(0.075, 0.005, 0.1);
  eyeL.rotation.set(0, 0.588, 0);
  eyeL.scale.set(0.66, 0.78, 0.41);
  head.add(eyeL);
  const irisL = new THREE.Mesh(eyeCap(1.03, 0.98, 0.04, -0.1), irisMat);
  irisL.name = "irisL";
  irisL.rotation.set(0, -0.164, 0);
  eyeL.add(irisL);
  const pupilL = new THREE.Mesh(eyeCap(1.04, 0.55, 0.04, -0.1), pupilMat);
  pupilL.name = "pupilL";
  pupilL.rotation.set(0, -0.187, 0);
  eyeL.add(pupilL);
  const glintL = new THREE.Mesh(eyeCap(1.05, 0.2, 0.46, 0.26), glintM);
  glintL.name = "glintL";
  glintL.rotation.set(0.149, -0.389, 0.084);
  eyeL.add(glintL);
  const glint2L = new THREE.Mesh(eyeCap(1.05, 0.09, -0.36, -0.46), glintM);
  glint2L.name = "glint2L";
  eyeL.add(glint2L);

  const eyeR = new THREE.Mesh(new THREE.SphereGeometry(EYE_R, 24, 20), scleraMat);
  eyeR.name = "eyeR";
  eyeR.position.set(-0.075, 0.005, 0.1);
  eyeR.rotation.set(0, -0.588, 0);
  eyeR.scale.set(0.66, 0.78, 0.41);
  head.add(eyeR);
  const irisR = new THREE.Mesh(eyeCap(1.03, 0.98, 0.04, 0.1), irisMat);
  irisR.name = "irisR";
  irisR.rotation.set(0, 0.164, 0);
  eyeR.add(irisR);
  const pupilR = new THREE.Mesh(eyeCap(1.04, 0.55, 0.04, 0.1), pupilMat);
  pupilR.name = "pupilR";
  pupilR.rotation.set(0, 0.187, 0);
  eyeR.add(pupilR);
  const glintR = new THREE.Mesh(eyeCap(1.05, 0.2, 0.46, -0.26), glintM);
  glintR.name = "glintR";
  glintR.rotation.set(0.149, 0.389, 0.084);
  eyeR.add(glintR);
  const glint2R = new THREE.Mesh(eyeCap(1.05, 0.09, -0.36, 0.46), glintM);
  glint2R.name = "glint2R";
  eyeR.add(glint2R);

  // Fur brow swells above the sockets — part of the coat, always on. SOFT,
  // rounded bumps sunk mostly into the skull: the earlier flat ridge hung
  // over the eye and its shaded underside quantised into a dark band that
  // read as a frowning eyebrow — the "scared beagle". Cute is no eyebrow.
  // Top-level declarations so the editor can save them.
  const browSwellL = new THREE.Mesh(latheFromProfile(SPHERE_PROFILE, 12, 0.07, 0.036, 0.04), tan);
  browSwellL.name = "browSwellL";
  browSwellL.position.set(0.08, 0.078, 0.09);
  head.add(browSwellL);
  const browSwellR = new THREE.Mesh(latheFromProfile(SPHERE_PROFILE, 12, 0.07, 0.036, 0.04), tan);
  browSwellR.name = "browSwellR";
  browSwellR.position.set(-0.08, 0.078, 0.09);
  head.add(browSwellR);

  /** Brow pivots, hidden unless the equipped coat carries a `brow` colour. */
  /**
   * The Pac-Beagle brow ACCESSORY (cosmetic, per-coat): the hand-dialled
   * chevron bars from BROW_BARS on a pivot. TOP-LEVEL declarations, one per
   * side, so the editor can save the pivot's position and rotation — Nuno
   * places these by eye and a loop-built pivot could never be written back.
   *
   * The aim used to be computed from a gaze basis into `quaternion`; it is
   * BAKED into rotation here (the same angles, ±0.592 yaw / -0.262 pitch /
   * ±0.148 roll) because a quaternion written after a rotation would silently
   * discard whatever the editor saved.
   */
  const browBarsOf = (side: "L" | "R"): THREE.Group => {
    const brow = new THREE.Group();
    brow.name = "brow" + side;
    const BROW_LEN = 0.066;
    const BROW_THICK = 0.0145;
    const m = side === "L" ? 1 : -1;
    BROW_BARS.forEach(({ tag, pos, rot }) => {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(BROW_THICK, BROW_LEN, BROW_THICK * 0.55), browMat);
      bar.name = "brow" + side + tag;
      bar.position.set(pos[0] * m * 0.62, pos[1] * 0.62, pos[2] * 0.62);
      bar.rotation.set(rot[0], rot[1] * m, rot[2] * m);
      brow.add(bar);
    });
    brow.rotation.z = side === "L" ? -0.13 : 0.13;
    return brow;
  };
  const browPivotL = new THREE.Group();
  browPivotL.name = "browPivotL";
  browPivotL.position.set(0.08, 0.018, 0.09);
  browPivotL.rotation.set(-0.261714, 0.592177, 0.14841);
  browPivotL.add(browBarsOf("L"));
  head.add(browPivotL);
  const browPivotR = new THREE.Group();
  browPivotR.name = "browPivotR";
  browPivotR.position.set(-0.08, 0.018, 0.09);
  browPivotR.rotation.set(-0.261714, -0.592177, -0.14841);
  browPivotR.add(browBarsOf("R"));
  head.add(browPivotR);
  const brows: THREE.Object3D[] = [browPivotL, browPivotR];

  // --- ears: the pivot is the animated joint (syncToEntity flops rotation.x
  // and flares rotation.z every frame, so its rotation is runtime-owned); the
  // leather INSIDE it carries the rest pose — position/rotation edits on
  // earMeshL/R save in place and survive the animation. Both are top-level
  // declarations so the editor can rewrite them (a loop-built part cannot).
  const earL = new THREE.Group();
  earL.name = "earL";
  earL.position.set(0.1, 0.095, 0.04);
  head.add(earL);
  const earMeshL = new THREE.Mesh(taperedSweepGeometry(earStations(1), 12, [1, 0, 0]), earMat);
  earMeshL.name = "earMeshL";
  earMeshL.position.set(0, 0, -0.04);
  earMeshL.rotation.set(0.2, -0.33, 0.126);
  earL.add(earMeshL);
  const earR = new THREE.Group();
  earR.name = "earR";
  earR.position.set(-0.1, 0.095, 0.04);
  head.add(earR);
  const earMeshR = new THREE.Mesh(taperedSweepGeometry(earStations(-1), 12, [1, 0, 0]), earMat);
  earMeshR.name = "earMeshR";
  earMeshR.position.set(0, 0, -0.04);
  earMeshR.rotation.set(0.2, 0.33, -0.126);
  earR.add(earMeshR);

  // --- legs: one helper builds the sweep + paw INSIDE a pivot; each leg is
  // its own top-level declaration below so the editor's Save can rewrite its
  // position line (a loop-built part has no line of its own to rewrite).
  // Pivot at the shoulder/hip inside the body; paw bottoms land at y ~ 0.
  const legOf = (
    name: string,
    stations: SweepStation[],
    coatRegions: CoatRegion[],
    base: number,
  ): THREE.Group => {
    const pivot = new THREE.Group();
    pivot.name = name;
    // REST group: the pivot's rotation is the trot, written every frame and
    // blended to 0 when standing, so a rest angle on it can never survive.
    // The rest pose lives one level down — editable, and the trot swings on
    // top of it. Paws go in here too so they follow the rest angle.
    const rest = new THREE.Group();
    rest.name = `${name}Rest`;
    pivot.add(rest);
    const legMesh = new THREE.Mesh(
      splitCoatGroups(taperedSweepGeometry(stations, 14), base, coatRegions),
      coatSlots,
    );
    legMesh.name = `${name}Mesh`;
    rest.add(legMesh);
    return pivot;
  };
  /** A paw bulb, positioned INSIDE its leg pivot so it trots with the leg. */
  const pawOf = (name: string): THREE.Mesh => {
    const paw = new THREE.Mesh(latheFromProfile(PAW_PROFILE, 16, 0.1, 0.075, 0.115), pawMat);
    paw.name = name;
    return paw;
  };
  const legFL = legOf("legFL", LEG_FRONT_STATIONS, LEG_FRONT_COAT, COAT_WHITE);
  legFL.position.set(0.09, 0.335, 0.126);
  g.add(legFL);
  const legFLRest = legFL.getObjectByName("legFLRest") as THREE.Group;
  legFLRest.rotation.set(0, 0, 0);
  const pawFL = pawOf("pawFL");
  pawFL.position.set(0, -0.3, 0.012);
  legFLRest.add(pawFL);
  const legFR = legOf("legFR", LEG_FRONT_STATIONS, LEG_FRONT_COAT, COAT_WHITE);
  legFR.position.set(-0.09, 0.335, 0.126);
  g.add(legFR);
  const legFRRest = legFR.getObjectByName("legFRRest") as THREE.Group;
  legFRRest.rotation.set(0, 0, 0);
  const pawFR = pawOf("pawFR");
  pawFR.position.set(0, -0.3, 0.012);
  legFRRest.add(pawFR);
  const legBL = legOf("legBL", LEG_HIND_STATIONS, LEG_HIND_COAT, COAT_TAN);
  legBL.position.set(0.084, 0.35, -0.138);
  g.add(legBL);
  const legBLRest = legBL.getObjectByName("legBLRest") as THREE.Group;
  legBLRest.rotation.set(0.25, 0, 0);
  const pawBL = pawOf("pawBL");
  pawBL.position.set(0, -0.308, 0.012);
  legBLRest.add(pawBL);
  const legBR = legOf("legBR", LEG_HIND_STATIONS, LEG_HIND_COAT, COAT_TAN);
  legBR.position.set(-0.084, 0.35, -0.138);
  g.add(legBR);
  const legBRRest = legBR.getObjectByName("legBRRest") as THREE.Group;
  legBRRest.rotation.set(0.25, 0, 0);
  const pawBR = pawOf("pawBR");
  pawBR.position.set(0, -0.308, 0.012);
  legBRRest.add(pawBR);

  // --- tail: outer wag pivot + inner back-lean, so rotation.y sweeps the
  // leaned sabre side to side instead of spinning it about its own axis ---
  const tail = new THREE.Group();
  tail.name = "tail";
  tail.position.set(0, 0.405, -0.215);
  const tailTilt = new THREE.Group();
  tailTilt.name = "tailTilt";
  tailTilt.rotation.x = -0.14;
  tail.add(tailTilt);
  const tailMesh = new THREE.Mesh(
    splitCoatGroups(taperedSweepGeometry(TAIL_STATIONS, 12), COAT_BLACK, TAIL_COAT),
    coatSlots,
  );
  tailMesh.name = "tailMesh";
  tailMesh.rotation.set(-0.407, 0, 0);
  tailTilt.add(tailMesh);
  g.add(tail);

  g.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  g.scale.setScalar(1.1);

  const parts: BeagleParts = {
    earL,
    earR,
    tail,
    jaw,
    legs: [legFL, legFR, legBL, legBR],
  };
  g.userData.parts = parts;

  const coatMats: BeagleCoatMats = { tan, white, black, ear: earMat, paw: pawMat, brow: browMat, nose: noseMat, iris: irisMat };
  g.userData.coatMats = coatMats;
  g.userData.brows = brows;
  // The brow SWELLS: a browed coat (the Pac-Beagle) hides them and shows its
  // chevron bars instead, so the tribute wears bars rather than both.
  g.userData.browSwells = [browSwellL, browSwellR];
  // A coat with no `brow` hides them and keeps the fur swells; a browed coat
  // swaps swells for bars. Run through applyBeagleSkin so a freshly built
  // model and a live skin switch can never disagree.
  applyBeagleSkin(g, skin);

  return g;
}

/**
 * Recolors an already-built beagle group in place to `skin`'s coat â€” sets
 * `.color` on the 4 materials stashed in `g.userData.coatMats` by `makeBeagle`.
 * No geometry rebuild, no remove/re-add: the mesh keeps animating (walk bob,
 * tail wag, etc.) uninterrupted through the switch. This is what the live
 * skin-switch UI calls; `makeBeagle`'s `skin` param is only for the initial
 * build (e.g. booting with the persisted skin already equipped).
 */
export function applyBeagleSkin(group: THREE.Group, skin: BeagleSkin): void {
  const mats = group.userData.coatMats as BeagleCoatMats | undefined;
  if (!mats) return;
  const { coat } = skin;
  mats.tan.color.setHex(coat.tan);
  mats.white.color.setHex(coat.white);
  mats.black.color.setHex(coat.black);
  mats.ear.color.setHex(coat.ear);
  // Optional channels. `paw` falls back to the belly white, which is what the
  // paws wore before the channel existed; `brow` falling back means HIDDEN, so
  // switching away from a browed coat takes the brows off again.
  mats.paw.color.setHex(coat.paw ?? coat.white);
  if (coat.brow !== undefined) mats.brow.color.setHex(coat.brow);
  // Nose and iris are per-skin and do NOT follow `black`: Cookie's saddle is
  // liver-brown but its nose is black, and the tribute's nose is orange.
  mats.nose.color.setHex(coat.nose ?? DEFAULT_NOSE);
  mats.iris.color.setHex(coat.iris ?? DEFAULT_IRIS);
  // A browed coat wears its chevron BARS INSTEAD of the fur swells — bars on
  // top of swells read as two brows stacked. Visibility only: where the bars
  // sit is authored in makeBeagle (and editable/savable there), never moved
  // from here, or a saved position would be overwritten on every skin apply.
  const browed = coat.brow !== undefined;
  const brows = group.userData.brows as THREE.Object3D[] | undefined;
  const swells = group.userData.browSwells as THREE.Object3D[] | undefined;
  if (swells) for (const b of swells) b.visible = !browed;
  if (brows) for (const b of brows) b.visible = browed;
}

export interface InsectLimbs {
  /** Antenna root pivots â€” swayed on idle, always. */
  antennae: THREE.Object3D[];
  /** Per-leg swing pivots, in build order: F-L, F-R, M-L, M-R, B-L, B-R. */
  legs: THREE.Object3D[];
}

/**
 * The per-character seam.
 *
 * Everything an enemy does that is NOT common to all enemies lives behind this
 * instead of behind another optional field on GhostUserData. The shared code
 * kept growing a field and a branch per character â€” `accentMats?`, `limbs?`,
 * and so on â€” which is why a change aimed at one enemy kept rippling into the
 * other three. A builder now closes over its own parts and hands back the
 * behaviour, so the shared layer never learns that legs or antennae exist.
 *
 * Every hook is optional: leave it off and the character gets the shared
 * default, which is what the ghost, bee and ladybug do today.
 */
export interface EnemyBehaviour {
  /** Extra per-frame motion this character owns â€” limbs, wings, whatever it
   *  happens to have. Called from syncToEntity after the shared body pose. */
  animate?(t: number, idleT: number, moveBlend: number): void;
  /** Fully replaces the shared "eaten" look for this character. */
  onEaten?(): void;
  /** Undoes whatever onEaten did, on the way back to a normal state. */
  onRestore?(): void;
}

export interface GhostUserData {
  bodyMat: THREE.MeshToonMaterial;
  /** Every node the "eaten" state must re-show â€” the eye parts and any group
   *  they hang from, since an invisible parent hides its children outright.
   *  Object3D, not Mesh: some of those are Groups. */
  eyes: THREE.Object3D[];
  /** The authored pupil colour, restored by applyGhostState when leaving the
   *  frightened look. Without it the "normal" branch put back a hardcoded ghost
   *  blue, which quietly repainted any character that wanted its own â€” the
   *  beetle's warm near-black turned blue the moment it animated. */
  pupBaseColor: number;
  /** This character's own behaviour â€” see EnemyBehaviour. */
  behaviour?: EnemyBehaviour;
  /** Every material of the body, dimmed to a translucent spirit while eaten.
   *  Collected by traversal at build time so a character never has to keep a
   *  hand-written list of its own materials in sync. */
  spiritMats: THREE.MeshToonMaterial[];
  /** Materials left SOLID while eaten â€” the eyes, which are what a player
   *  actually tracks as an eaten enemy runs home. */
  eyeMats: THREE.MeshToonMaterial[];
  /** Extra materials that must follow the frightened/normal recolour along
   *  with `bodyMat`. Small fixed accents (a dark antenna, a wing) deliberately
   *  stay their own colour â€” but when an accent is a LARGE share of the
   *  silhouette, leaving it un-recoloured would weaken the "this one is edible
   *  now" read, which matters more than the styling. Undefined = none. */
  accentMats?: THREE.MeshToonMaterial[];
  /** Pupil dart PIVOTS, one per eye. A decal cap has to stay centred on the
   *  form to hug it, so it can never be TRANSLATED the way the old ball pupils
   *  were â€” instead its pivot is ROTATED, sweeping the cap across the surface
   *  while it stays perfectly flush. Every character builds its own eyes, but
   *  they all share this one pivot convention, which is why a single editor
   *  rule covers all four. */
  pupPivots: THREE.Object3D[];
  pupM: THREE.MeshToonMaterial;
  baseColor: number;
  /** The 5 wavy-hem spheres, in build order â€” wobbled (y bob + scale) by syncToEntity. */
  hem: THREE.Mesh[];
  /** Skirt body, breathed by animateGhostHem alongside the hem wobble.
   *
   *  OPTIONAL: a character can decline the shared idle entirely. The ladybug
   *  does â€” its rim has to follow the shell's forward tilt, and a breathing
   *  tilted rim slides in and out of the shell it is supposed to seal. Its own
   *  behaviour supplies a body bob and antenna twitch instead. */
  skirt?: THREE.Mesh;
  /** Smoothed pupil offset (world-ish local units), lerped toward the dir-driven
   *  target each call instead of snapping; owned entirely by applyGhostState. */
  pupOffset: { x: number; z: number };
}

/**
 * Every distinct MeshStandardMaterial under `g`, minus the ones passed in.
 * Used to gather the materials that go translucent while eaten, so a builder
 * only has to name its EYE materials and the rest is discovered.
 *
 * The same traversal also snapshots each mesh's AUTHORED `castShadow`. The
 * spirit pass switches shadows off wholesale, and the restore used to switch
 * them all back on — which is not the same thing: the bee's wings are
 * deliberately non-casting, and one trip to the pen turned them into hard
 * black paddles for the rest of the run. Every builder calls this after it has
 * set its shadow flags, so what is captured here is the authored value.
 */
function collectSpiritMats(
  g: THREE.Group,
  exclude: THREE.MeshToonMaterial[],
): THREE.MeshToonMaterial[] {
  const seen = new Set<THREE.Material>(exclude);
  const out: THREE.MeshToonMaterial[] = [];
  g.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.userData.shadowBase = o.castShadow;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (seen.has(m)) continue;
      seen.add(m);
      if (!(m instanceof THREE.MeshToonMaterial)) continue;
      // Remember what this material looked like BEFORE any spirit pass, so the
      // restore puts back its own values rather than assuming every material
      // was opaque. The bee's wings are already translucent by design; a
      // restore that hardcoded `transparent = false` would turn them into
      // solid cream paddles the first time the bee was eaten and released.
      // colour/emissive are part of this snapshot for the same reason: the
      // spirit pass repaints EVERY spirit material to the team colour, not
      // just the body, so a restore that only put back the transparency flags
      // left the muzzle, ears and markings permanently team-coloured — an
      // enemy that came out of the pen half normal, half eaten.
      m.userData.spiritBase = {
        transparent: m.transparent,
        opacity: m.opacity,
        depthWrite: m.depthWrite,
        emissiveIntensity: m.emissiveIntensity,
        color: m.color.getHex(),
        emissive: m.emissive.getHex(),
      };
      out.push(m);
    }
  });
  return out;
}

interface SpiritBase {
  transparent: boolean;
  opacity: number;
  depthWrite: boolean;
  emissiveIntensity: number;
  color: number;
  emissive: number;
}

/**
 * Builds a ghost from primitives (ported from prototype section 6,
 * makeGhost). Exposes userData handles so game state (frightened/eaten)
 * can recolour the body and pupils without rebuilding the mesh.
 */
/** One ring of a wavy-lathe profile: radius, height, and how strongly the
 *  bottom-edge wave moves it. Weight 0 = pinned, 1 = full dip. */
interface WavyRing {
  r: number;
  y: number;
  w: number;
}

/**
 * A surface of revolution whose BOTTOM EDGE undulates â€” the ghost's body and
 * its scalloped hem as ONE mesh.
 *
 * LatheGeometry cannot do this: it revolves a fixed profile, so every angle
 * gets the same silhouette and the hem has to be built as separate blobs
 * hung underneath. Those blobs were the whole problem â€” five surfaces grazing
 * the body's flank at a shallow angle, which reads as a crease however they
 * are positioned, and a joint that opened whenever they animated.
 *
 * Here each ring is dipped by `amp * (0.5 + 0.5cos(waves * theta))`, scaled by
 * its own weight: 1 at the rim, fading to 0 up the flank and back to 0 at the
 * underside's axis. The axis MUST be pinned â€” every angle shares that single
 * vertex, so letting the wave move it would tear the mesh.
 *
 * Winding is bottom-to-top like LatheGeometry's, for the same reason: get it
 * backwards and the normals point inward and the model renders inside-out.
 */
function wavyLathe(
  profile: readonly WavyRing[],
  segments: number,
  waves: number,
  amp: number,
): THREE.BufferGeometry {
  const rings = profile.length;
  const positions: number[] = [];
  const indices: number[] = [];

  for (let j = 0; j <= segments; j++) {
    const theta = (j / segments) * Math.PI * 2;
    const dip = 0.5 + 0.5 * Math.cos(waves * theta); // 1 at a point, 0 at a notch
    const c = Math.cos(theta);
    const sn = Math.sin(theta);
    for (const p of profile) {
      positions.push(p.r * c, p.y - amp * dip * p.w, p.r * sn);
    }
  }
  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < rings - 1; i++) {
      const a = j * rings + i;
      const b = a + rings;
      indices.push(a, a + 1, b);
      indices.push(a + 1, b + 1, b);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// Ghost float. The reference is a sheet hovering, so unlike the walkers this
// runs whether or not it is moving: the whole body rises and falls.
//
// Two earlier ideas were tried and dropped. The hem used to TURN, so the waves
// travelled around the rim â€” but a spinning hem reads as the whole ghost
// rotating, and it fights the yaw syncToEntity applies to face the direction of
// travel. The scallops also used to ripple individually; they no longer exist
// as separate objects, since the hem is now part of the body's own geometry.
const GHOST_BOB = 0.035;
const GHOST_BOB_FREQ = 1.05 * Math.PI * 2;

function ghostBehaviour(hover: THREE.Object3D): EnemyBehaviour {
  return {
    animate: (_t, idleT, moveBlend) => {
      // Rise and fall. A little deeper while drifting than while held still, so
      // a ghost in the pen still breathes but a chasing one reads as floating.
      hover.position.y = Math.sin(idleT * GHOST_BOB_FREQ) * GHOST_BOB * (0.7 + 0.3 * moveBlend);
    },
  };
}

export function makeGhost(color: number): THREE.Group {
  const g = new THREE.Group();

  const bodyMat = toon({
    color,
    // Glossier than the old ghost: the reference is a smooth plastic toy, and
    // a low roughness is what the rig's rim light needs to read as a sheen.


    emissive: color,
    emissiveIntensity: 0.14,
    // SOLID, deliberately. A translucent body was tried and reverted: the eyes
    // are protruding balls mostly buried in the body, so a see-through surface
    // drew over them and you saw the whole sunken eyeball instead of the neat
    // oval that clears it â€” pupils washed out and all. The closed underside and
    // the hem scallops showed through as a band across the middle too.
    //
    // Translucency belongs to the EATEN state alone (0.3), where it means
    // something: this one is edible and heading home. Spending it on the normal
    // look would cost that read as well as this one.
  });

  // A ghost hovers, so everything hangs off this and the behaviour bobs it.
  // The root belongs to syncToEntity (position, yaw, waddle).
  const hover = new THREE.Group();
  hover.name = "hover";
  g.add(hover);

  // --- body: ONE mesh, hem included ---------------------------------------
  // The hem is no longer five blobs hung underneath â€” it is the body's own
  // bottom EDGE, undulating. See wavyLathe for why LatheGeometry cannot do this
  // and why separate scallops always creased against the flank.
  //
  // Each ring carries a weight saying how much the wave moves it: 1 at the rim,
  // fading to 0 up the flank so the sides stay straight, and back to 0 at the
  // underside's axis, which every angle shares and which would tear if it moved.
  const BODY_BOTTOM = 0.105;
  const WAVE_AMP = 0.092; // how far the points hang below the notches
  const profile: readonly WavyRing[] = [
    // underside, axis outward â€” the axis is PINNED at w 0
    { r: 0.0, y: BODY_BOTTOM - 0.03, w: 0 },
    { r: 0.1, y: BODY_BOTTOM - 0.026, w: 0.34 },
    { r: 0.2, y: BODY_BOTTOM - 0.016, w: 0.72 },
    { r: 0.275, y: BODY_BOTTOM - 0.006, w: 0.94 },
    // the rim: full wave, so this is the scalloped edge itself
    { r: 0.302, y: BODY_BOTTOM, w: 1 },
    // up the flank, the wave dying out
    { r: 0.305, y: BODY_BOTTOM + 0.03, w: 0.86 },
    { r: 0.304, y: BODY_BOTTOM + 0.07, w: 0.52 },
    { r: 0.303, y: BODY_BOTTOM + 0.115, w: 0.2 },
    { r: 0.302, y: 0.26, w: 0 },
    { r: 0.302, y: 0.34, w: 0 },
    { r: 0.298, y: 0.41, w: 0 },
    { r: 0.283, y: 0.478, w: 0 },
    // and over the crown
    { r: 0.253, y: 0.54, w: 0 },
    { r: 0.205, y: 0.592, w: 0 },
    { r: 0.145, y: 0.629, w: 0 },
    { r: 0.075, y: 0.652, w: 0 },
    { r: 0.0, y: 0.66, w: 0 },
  ];
  const body = new THREE.Mesh(wavyLathe(profile, 96, 5, WAVE_AMP), bodyMat);
  body.name = "body";
  hover.add(body);

  // --- eyes ----------------------------------------------------------------
  // Big white ovals with a plain black pupil â€” no iris, no second highlight.
  // The reference's whole face is those two shapes, and anything more starts
  // fighting them.
  const scleraMat = toon({ color: 0xfdfaf4});
  const pupM = toon({ color: 0x14161f});
  const glintMat = toon({
    color: 0xffffff,

    emissive: 0xffffff,
    emissiveIntensity: 0.45,
  });
  const ghostEyeMats = [scleraMat, pupM, glintMat];

  const EYE_R = 0.088;
  const EYE_FWD = Math.PI / 2;
  const eyeCap = (
    factor: number,
    rx: number,
    ry: number,
    thetaLen: number,
    mat: THREE.MeshToonMaterial,
  ): THREE.Mesh => {
    const geo = new THREE.SphereGeometry(EYE_R * factor, 24, 18, 0, Math.PI * 2, 0, thetaLen);
    geo.rotateX(rx);
    geo.rotateY(ry);
    return new THREE.Mesh(geo, mat);
  };

  const eyes: THREE.Object3D[] = [];
  const pupPivots: THREE.Object3D[] = [];

  const makeEye = (s: number): { ball: THREE.Mesh; pivot: THREE.Group } => {
    // Pushed OUT along the body's surface normal until a real oval clears it.
    // These sat at radius 0.224 against a body radius of 0.286, so only 0.013
    // of the eyeball ever emerged â€” a sliver. It looked fine only because the
    // body's normals were inverted at the time and the whole ball showed
    // through it; fixing the body exposed how buried they actually were.
    const centre = new THREE.Vector3(0.123 * s, 0.462, 0.223);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(EYE_R, 24, 20), scleraMat);
    ball.name = s < 0 ? "eyeL" : "eyeR";
    ball.position.copy(centre);
    // Egg-shaped rather than round, and squashed front-to-back so it sits into
    // the body instead of hanging off it like a bead.
    ball.scale.set(0.92, 1.12, 0.82);

    const pivot = new THREE.Group();
    pivot.name = s < 0 ? "pupilPivotL" : "pupilPivotR";
    pivot.position.copy(centre);
    pivot.scale.copy(ball.scale);

    const pupil = eyeCap(1.03, EYE_FWD, -0.1 * s, 0.42, pupM);
    pupil.name = s < 0 ? "pupilL" : "pupilR";
    pivot.add(pupil);

    // A single small highlight sitting INSIDE the pupil, upper-outer.
    //
    // Offsets here are measured from the PUPIL's axis, which carries its own
    // -0.1 yaw. It used to be offset (0.3, 0.3) = 0.424 from that axis while
    // the pupil's angular radius is 0.42 â€” so the highlight straddled the rim
    // and read as a dot floating just above the pupil. (0.16, 0.15) = 0.219
    // puts its far edge at 0.329, comfortably within the black.
    const glint = eyeCap(1.055, EYE_FWD - 0.16, (-0.1 + 0.15) * s, 0.11, glintMat);
    glint.name = s < 0 ? "glintL" : "glintR";
    pivot.add(glint);

    eyes.push(ball, pupil, glint);
    pupPivots.push(pivot);
    return { ball, pivot };
  };

  const eyeLeft = makeEye(-1);
  hover.add(eyeLeft.ball, eyeLeft.pivot);
  const eyeRight = makeEye(1);
  hover.add(eyeRight.ball, eyeRight.pivot);

  g.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });

  const userData: GhostUserData = {
    bodyMat,
    eyes,
    pupPivots,
    pupM,
    pupBaseColor: pupM.color.getHex(),
    baseColor: color,
    // The hem is driven by this character's OWN behaviour â€” it ripples in
    // place rather than doing the shared bob â€” so `hem` is empty here and no
    // `skirt` is offered. animateGhostHem has nothing to do for this one.
    hem: [],
    pupOffset: { x: 0, z: 0 },
    behaviour: ghostBehaviour(hover),
    eyeMats: ghostEyeMats,
    spiritMats: collectSpiritMats(g, ghostEyeMats),
  };
  g.userData = userData;
  return g;
}

// Fixed-dark accent color for the beetle's antennae + tiny head accent â€” a
// small enough slice of the silhouette that it doesn't fight the "whole bug
// turns blue" frightened read (see makeBeetle's doc comment), but reads as a
// natural dark detail against any of the three team shell colors.
const BEETLE_ACCENT = 0x1c1712;
/** The beetle's head/thorax, legs and antennae â€” the teal against the shell's
 *  team colour. That two-tone split IS the design (see makeBeetle), so unlike
 *  the old tiny dark nub this is a big slice of the silhouette; it is listed in
 *  `accentMats` so applyGhostState still turns the WHOLE bug blue when
 *  frightened. A frightened enemy has to be unmistakable â€” that reads ahead of
 *  any styling. */
const BEETLE_BODY = 0x1d6f7d;

/**
 * Builds a garden-beetle/ladybug-ish enemy from primitives (IDEA-009 skin
 * alternative to makeGhost). Satisfies the exact same `GhostUserData`
 * contract as the ghost â€” a single shared `bodyMat` covering the vast
 * majority of the silhouette (shell dome + skirt-equivalent underbelly rim +
 * the "hem" accent spheres), so `applyGhostState`'s frightened recolor
 * ("whole creature turns blue") and eaten hide/reveal both read correctly
 * unmodified.
 *
 * Shape: a rounded, squashed-sphere SHELL as the clear main body (reads as a
 * beetle's back from the top-down game camera) with the 2 eyes sitting
 * directly on its front face â€” no oversized head nub swallowing them (an
 * earlier pass had a large dark head blob here; it dominated the silhouette
 * and buried the eyes, so it's gone). Only a tiny dark accent nub peeks out
 * low between/below the eyes (mostly hidden by the shell's own curve), plus
 * two short, thin antennae firmly rooted at the shell's front-top edge and
 * swept up-and-back â€” small, attached, no floating pieces. A faint shell
 * seam + a few subtle "hem" spot-bumps add ladybug character, all on
 * `bodyMat` so they recolor with it.
 *
 * Eyes/pupils are positioned identically to the ghost's (eyes y0.4 z0.2
 * x+-0.12; pupils z0.27 x+-0.12) so applyGhostState's hardcoded pupil-offset
 * math lands on them unchanged, and they sit cleanly on the shell's front,
 * reading as the bug's own eyes.
 */
export function makeBeetle(color: number): THREE.Group {
  const g = new THREE.Group();
  // Shell keeps the TEAM colour (that is how a player tells the three enemies
  // apart); the head, legs and antennae carry the contrasting teal.
  const bodyMat = toon({
    color,

    emissive: color,
    emissiveIntensity: 0.15,
  });
  const limbMat = toon({ color: BEETLE_BODY});
  // applyGhostState turns accents blue while frightened and needs to know what
  // to put back afterwards â€” bodyMat has `baseColor` in userData for the same
  // reason, but an accent's base is its own, not the team colour.
  limbMat.userData.baseColor = BEETLE_BODY;
  const seamMat = toon({ color: BEETLE_ACCENT});

  // Proportion base: SHELL WIDTH = W, everything else a fraction of it per the
  // reference sheet. W itself comes from the game rather than the sheet â€” the
  // ghost reads 0.60 wide and 0.66 tall, and a beetle much bigger would not
  // sit right beside it in the same maze.
  const W = 0.64;
  const R = W / 2; // the shell's sphere radius before scaling

  // --- elytra shell: a squashed half-ellipsoid pushed BACK and tilted FORWARD,
  // so its front edge overhangs the head and the crown sits in the front third.
  const SHELL_Y = 0.36;
  const SHELL_Z = -0.05;
  const SHELL_SCALE = { x: 1.05, y: 0.88, z: 1.05 };
  const SHELL_TILT = -0.16; // ~9 degrees
  const SHELL_CUT = Math.PI * 0.6; // hard bottom cut, not a full sphere
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(R, 24, 18, 0, Math.PI * 2, 0, SHELL_CUT),
    bodyMat,
  );
  shell.name = "shell";
  shell.scale.set(SHELL_SCALE.x, SHELL_SCALE.y, SHELL_SCALE.z);
  shell.position.set(0, SHELL_Y, SHELL_Z);
  shell.rotation.x = SHELL_TILT;
  g.add(shell);

  // --- seams: grooves, NOT gaps. The same decal trick the eyes use â€” thin
  // lunes of a very slightly larger sphere, so they lie exactly on the shell
  // at any tilt instead of having to be fitted to it. One centre seam (front
  // half plus rear half, since a lune runs pole-to-cut down ONE side) and two
  // panel divisions per side, fanning from the front.
  const seamLune = (phiCentre: number, width: number): THREE.Mesh => {
    const geo = new THREE.SphereGeometry(
      R * 1.004, 8, 18, phiCentre - width / 2, width, 0, SHELL_CUT,
    );
    const m = new THREE.Mesh(geo, seamMat);
    m.scale.set(SHELL_SCALE.x, SHELL_SCALE.y, SHELL_SCALE.z);
    m.position.set(0, SHELL_Y, SHELL_Z);
    m.rotation.x = SHELL_TILT;
    return m;
  };
  const FRONT = Math.PI / 2; // phi = pi/2 faces +Z in three.js's sphere param
  const seam = seamLune(FRONT, 0.05);
  seam.name = "seam";
  g.add(seam);
  const seamRear = seamLune(-FRONT, 0.05);
  seamRear.name = "seamRear";
  g.add(seamRear);
  [0.62, 1.24].forEach((offset, i) => {
    ([-1, 1] as const).forEach((s) => {
      const panel = seamLune(FRONT + offset * s, 0.04);
      panel.name = "seamPanel" + i + (s < 0 ? "L" : "R");
      g.add(panel);
    });
  });

  // --- underside rim: the thin darker edge showing the shell's thickness.
  // Doubles as `skirt`, the mesh animateGhostHem gently breathes. That wobble
  // is applied RELATIVE to whatever is authored here (see restPose), so this
  // scale is free to be whatever the shape needs â€” it is no longer forced to 1.
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.05, R * 1.0, 0.035, 24), seamMat);
  skirt.name = "skirt";
  skirt.scale.setScalar(0.94);
  skirt.position.set(0, 0.272, SHELL_Z);
  g.add(skirt);

  // --- belly: the underside mass closing the shell off. The shell is a
  // partial sphere with no lid, so without this you look straight through its
  // open rim into an unlit cavity â€” a black wedge under the bug. It also gives
  // the six legs a body to grow out of, which is what the reference shows:
  // legs on the teal thorax mass, never on the shell.
  const belly = new THREE.Mesh(new THREE.SphereGeometry(R * 0.98, 24, 16), limbMat);
  belly.name = "belly";
  belly.scale.set(1.04, 0.62, 1.04);
  belly.position.set(0, 0.365, -0.05);
  g.add(belly);

  // --- fused head/thorax: one rounded mass, no neck, planted low and forward
  // so roughly a third of it disappears under the shell's overhang.
  const HEAD_R = W * 0.297; // a touch under the sheet's 0.65 x W
  const HEAD_POS = new THREE.Vector3(0, 0.33, 0.27);
  const head = new THREE.Mesh(new THREE.SphereGeometry(HEAD_R, 24, 18), limbMat);
  head.name = "head";
  head.scale.set(1, 1, 0.85); // flattened front-to-back
  head.position.copy(HEAD_POS);
  g.add(head);

  // --- antennae: a gentle S rising and splaying outward, then curving back and
  // inward so the two clubs lean toward each other over the shell. A curve plus
  // TubeGeometry is how three.js gives a smooth arc that a chain of cylinders
  // cannot. (One tube has a single radius for its whole length, so the sheet's
  // base-to-tip taper is not modelled; the club carries the read instead.)
  const antennae: THREE.Object3D[] = [];
  ([-1, 1] as const).forEach((s) => {
    // Each antenna hangs off a PIVOT at its root on the head, and its curve is
    // built relative to that root. That is what lets the idle sway rotate the
    // whole antenna from where it meets the head, instead of swinging it about
    // the model's origin â€” and it keeps the pivot's rotation a channel the
    // animation can own outright without touching anything authored.
    const root = new THREE.Vector3(0.085 * s, 0.47, 0.31);
    const pivot = new THREE.Group();
    pivot.name = s < 0 ? "antennaPivotL" : "antennaPivotR";
    pivot.position.copy(root);
    g.add(pivot);
    antennae.push(pivot);

    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0.115 * s, 0.13, -0.05),
      new THREE.Vector3(0.145 * s, 0.23, -0.23),
      new THREE.Vector3(0.055 * s, 0.26, -0.41),
    ]);
    const stalk = new THREE.Mesh(new THREE.TubeGeometry(curve, 20, W * 0.022, 6, false), limbMat);
    stalk.name = s < 0 ? "antennaStalkL" : "antennaStalkR";
    pivot.add(stalk);

    const club = new THREE.Mesh(new THREE.SphereGeometry(W * 0.055, 10, 8), limbMat);
    club.name = s < 0 ? "antennaTipL" : "antennaTipR";
    club.position.copy(curve.getPoint(1));
    pivot.add(club);
  });

  // --- six legs, short and chunky, so the beetle reads as crouching. Femur
  // down-and-out, a visible ball knee, then a shin kicked back to the ground
  // with a blunt pad. Front pair smallest and fanned forward, rear beefiest and
  // fanned back. (No toe nubs: at the size an enemy occupies on screen they
  // would be sub-pixel, and each one is another draw of geometry nobody sees.)
  const legSwings: THREE.Object3D[] = [];
  const LEGS = [
    { z: 0.17, yaw: 0.6, size: 0.86, tag: "F" },
    { z: -0.01, yaw: 0, size: 1, tag: "M" },
    { z: -0.19, yaw: -0.55, size: 1.14, tag: "B" },
  ];
  for (const leg of LEGS) {
    ([-1, 1] as const).forEach((s) => {
      const root = new THREE.Group();
      root.name = "leg" + leg.tag + (s < 0 ? "L" : "R");
      root.position.set(0.16 * s, 0.27, leg.z);
      root.rotation.z = -0.5 * s; // splay outward
      root.rotation.y = leg.yaw * s; // fan forward / backward
      root.scale.setScalar(leg.size);
      g.add(root);

      // The gait swings this INNER pivot, never `root`. root carries the
      // authored splay and fan, which stay editable; swing's rotation is a
      // clean channel the animation owns â€” the same separation the pupil dart
      // uses. Rotating a node that also holds authored values would force the
      // editor to lock the whole rotation channel, splay included.
      const swing = new THREE.Group();
      swing.name = "legSwing" + leg.tag + (s < 0 ? "L" : "R");
      root.add(swing);
      legSwings.push(swing);

      const femur = new THREE.Mesh(new THREE.CapsuleGeometry(W * 0.062, 0.11, 4, 8), limbMat);
      femur.position.y = -0.075;
      swing.add(femur);

      const knee = new THREE.Mesh(new THREE.SphereGeometry(W * 0.075, 10, 8), limbMat);
      knee.position.y = -0.155;
      swing.add(knee);

      // The shin hangs off the knee, counter-rotated back toward vertical so
      // the foot reaches the ground instead of continuing out sideways.
      const lower = new THREE.Group();
      lower.position.y = -0.155;
      lower.rotation.z = 0.5 * s;
      lower.rotation.x = 0.2;
      swing.add(lower);

      const shin = new THREE.Mesh(new THREE.CapsuleGeometry(W * 0.05, 0.08, 4, 8), limbMat);
      shin.position.y = -0.06;
      lower.add(shin);

      const pad = new THREE.Mesh(new THREE.SphereGeometry(W * 0.07, 10, 8), limbMat);
      pad.scale.set(1.1, 0.62, 1.3);
      pad.position.y = -0.115;
      lower.add(pad);
    });
  }

  // --- face: no mouth at all. Everything expressive lives in the eyes, so they
  // are big PROTRUDING spheres bulging past the head's silhouette â€” deliberately
  // NOT the flush decal caps the other three enemies wear â€” with a dark brow arc
  // riding each one as the only expression control.
  const pupM = toon({ color: 0x2a1a10});
  const scleraMat = toon({ color: 0xfdf6ec});
  const irisMat = toon({ color: 0x8a5a2b});
  const glintMat = toon({
    color: 0xffffff,

    emissive: 0xffffff,
    emissiveIntensity: 0.4,
  });

  const beetleEyeMats = [scleraMat, irisMat, pupM, glintMat];
  const EYE_R = W * 0.128; // ~0.26 x W across
  // A cap of a sphere `factor` bigger than the eyeball, its pole aimed by
  // rotating the GEOMETRY. EYE_FWD tips the pole from +Y round to +Z, which is
  // the direction the beetle faces.
  const EYE_FWD = Math.PI / 2;
  const eyeCap = (factor: number, rx: number, ry: number, thetaLen: number): THREE.SphereGeometry => {
    const geo = new THREE.SphereGeometry(EYE_R * factor, 28, 20, 0, Math.PI * 2, 0, thetaLen);
    geo.rotateX(rx);
    geo.rotateY(ry);
    return geo;
  };
  const eyes: THREE.Object3D[] = [];
  const pupPivots: THREE.Object3D[] = [];

  ([-1, 1] as const).forEach((s) => {
    const centre = new THREE.Vector3(0.1 * s, 0.4, 0.36); // narrow bridge between
    const ball = new THREE.Mesh(new THREE.SphereGeometry(EYE_R, 20, 16), scleraMat);
    ball.name = s < 0 ? "eyeL" : "eyeR";
    ball.position.copy(centre);
    g.add(ball);
    eyes.push(ball);

    // Iris, pupil and glint hang off a pivot AT THE EYEBALL'S CENTRE, so the
    // dart rotates them around the ball and they stay on its surface. Same
    // trick as the decal caps â€” and also just how a googly eye works.
    const pivot = new THREE.Group();
    pivot.name = s < 0 ? "pupilPivotL" : "pupilPivotR";
    pivot.position.copy(centre);
    g.add(pivot);
    pupPivots.push(pivot);

    // Iris, pupil and glint are flush decal CAPS on the eyeball â€” the same
    // technique the other three enemies' whole eyes use, just applied to a
    // small sphere instead of a head. They were squashed spheres pushed into
    // the eyeball, which z-fought against the sclera and read as a jagged
    // brown star close up; a cap can never do that, because it never crosses
    // the surface it sits on. Caps sit at the pivot's origin with their aim
    // baked into the geometry, so the dart's rotation is free to own the node.
    const iris = new THREE.Mesh(eyeCap(1.012, EYE_FWD, 0, 0.66), irisMat);
    iris.name = s < 0 ? "irisL" : "irisR";
    pivot.add(iris);
    eyes.push(iris);

    const pupil = new THREE.Mesh(eyeCap(1.03, EYE_FWD, 0, 0.36), pupM);
    pupil.name = s < 0 ? "pupilL" : "pupilR";
    pivot.add(pupil);
    eyes.push(pupil);

    // Up-and-OUTER, landing on the pupil/iris boundary the way the beagle's
    // does: the pupil cap's angular radius is 0.36, and this pole sits
    // sqrt(0.26^2 + 0.25^2) = 0.36 off the eye's axis, so the highlight
    // straddles the rim instead of floating out on the white. (It used to be
    // aimed 0.6 INWARD, which put it on the far side of the iris entirely.)
    const glint = new THREE.Mesh(eyeCap(1.05, EYE_FWD - 0.26, 0.25 * s, 0.13), glintMat);
    glint.name = s < 0 ? "glintL" : "glintR";
    pivot.add(glint);
    eyes.push(glint);

    // Brow: a thin dark arc riding the eye's upper edge. Its own node so it can
    // be rotated later â€” with no mouth, this is the one expression control.
    const brow = new THREE.Mesh(
      new THREE.TorusGeometry(EYE_R * 1.02, EYE_R * 0.075, 6, 20, 1.7),
      seamMat,
    );
    brow.name = s < 0 ? "browL" : "browR";
    brow.position.copy(centre);
    brow.position.z += EYE_R * 0.22;
    brow.rotation.z = 0.52 - 0.22 * s;
    g.add(brow);
    eyes.push(brow);
  });

  g.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  const userData: GhostUserData = {
    bodyMat,
    accentMats: [limbMat],
    pupBaseColor: pupM.color.getHex(),
    eyes,
    pupPivots,
    pupM,
    baseColor: color,
    // The beetle's own behaviour, closing over parts the shared layer never
    // sees. Adding a wing-flap to the bee later means another closure here,
    // not another optional field on GhostUserData.
    behaviour: {
      animate: (t, idleT, moveBlend) =>
        animateInsectLimbs({ antennae, legs: legSwings }, t, idleT, moveBlend),
    },
    eyeMats: beetleEyeMats,
    spiritMats: collectSpiritMats(g, beetleEyeMats),
    // No hem pieces: the sheet's shell carries seams only, no rivets. An empty
    // array just means animateGhostHem's wobble loop has nothing to do; the rim
    // above still gets its gentle breathe.
    hem: [],
    skirt,
    pupOffset: { x: 0, z: 0 },
  };
  g.userData = userData;
  return g;
}

// Fixed-dark accent color for the bee's stripe bands, antennae, and stinger â€”
// mirrors BEETLE_ACCENT's role: a small enough slice of the silhouette that
// it doesn't fight the "whole bug turns blue" frightened read.
const BEE_ACCENT = 0x1c1712;
/** The ladybug's head, spots, antennae and leg nubs â€” a near-black that stays
 *  slightly warm in the highlights, per the reference palette. */
const LADYBUG_BLACK = 0x141414;
// Pale, slightly translucent wing material â€” stays this color even when
// frightened (same treatment as the beetle's dark head accent staying dark),
// which is fine: a real bug's wings/head don't turn blue when scared either,
// only the body-color chitin does, and that's what bodyMat models.
const BEE_WING_COLOR = 0xf3f6ff;

/**
 * Builds a garden-bee enemy from primitives (IDEA-009 third enemy skin,
 * alongside the ghost and the beetle). Satisfies the identical
 * `GhostUserData` contract â€” a single shared `bodyMat` covering the main
 * abdomen+thorax body (plus its skirt-equivalent underbelly rim and the
 * "hem" segment-ring accents), so `applyGhostState`'s frightened recolor
 * ("whole creature turns blue") and eaten hide/reveal both read correctly
 * unmodified. The bee is deliberately NOT literally yellow â€” its body takes
 * the TEAM color like the beetle's shell does; it reads as a bee via SHAPE
 * (elongated, segmented oval body) and a few bold dark accent stripes across
 * its back, not via a fixed yellow-and-black palette.
 *
 * Shape: a plump oval body (more front-back elongated than the beetle's
 * round shell) on `bodyMat`, 3 bold dark stripe bands PAINTED ON the TOP of
 * the rear-half abdomen â€” each band built from a row of small flattened
 * dark blobs individually surface-solved onto the body's own dome curve
 * (same technique the ladybug's spots use), not a rigid tube/ring (an
 * earlier pass tried that; a fixed-radius ring can only touch a curved dome
 * at isolated points, so it stood visibly off the surface as a hoop from
 * every angle) â€” small-minority-coverage fixed-dark accent, so bodyMat
 * still clearly dominates the silhouette â€” 2 small pale
 * semi-transparent wings on the upper back, 2
 * short thin antennae at the front, and a tiny dark stinger nub at the rear.
 * Eyes/pupils use the exact same geometry/placement/material pattern as the
 * ghost and beetle (2 white eyes + 2 pupils on `pupM`, added directly to the
 * top-level group `g` as siblings â€” never nested under a sub-group, which is
 * what makes `applyGhostState`'s eaten-state eyes-float-home re-show work),
 * at the ghost's local coords (eyes y0.4 z0.2 x+-0.12; pupils z0.27 x+-0.12)
 * so applyGhostState's hardcoded pupil-offset math lands unchanged.
 */
// Chibi-bee hover. Almost all the life in this character comes from the
// trailing abdomen: the head bobs on a sine and every layer behind it follows
// LATE â€” abdomen chain, then antennae, then the dangling legs. Offsetting each
// layer's phase is what makes it feel alive without a single keyframe.
const BEE_BOB_FREQ = 1.2 * Math.PI * 2; // ~1.2 Hz
const BEE_BOB = 0.05;
const BEE_LAG_ABDOMEN = 0.15 * BEE_BOB_FREQ; // the sheet's ~0.15s, in radians
const BEE_LAG_ANTENNA = 0.3 * BEE_BOB_FREQ;
const BEE_LAG_LEG = 0.42 * BEE_BOB_FREQ;
const BEE_ABDOMEN_SWING = 0.17;
const BEE_WING_FREQ = 34;
const BEE_WING_AMPLITUDE = 0.32;

function beeBehaviour(
  hover: THREE.Object3D,
  abdomen: THREE.Object3D[],
  wings: THREE.Object3D[],
  antennae: THREE.Object3D[],
  legs: THREE.Object3D[],
): EnemyBehaviour {
  const abdomenRest = abdomen.map((a) => a.rotation.x);
  const wingRest = wings.map((w) => w.rotation.z);
  const antennaRest = antennae.map((a) => a.rotation.x);
  const legRest = legs.map((l) => l.rotation.x);
  return {
    animate: (t, idleT, moveBlend) => {
      const phase = idleT * BEE_BOB_FREQ;
      hover.position.y = Math.sin(phase) * BEE_BOB * 0.32;

      // The abdomen chain: each joint lags the one in front of it a little
      // more, so the whole tail whips rather than swinging as one rigid rod.
      for (let i = 0; i < abdomen.length; i++) {
        const lag = BEE_LAG_ABDOMEN * (i + 1);
        abdomen[i].rotation.x =
          abdomenRest[i] + Math.sin(phase - lag) * BEE_ABDOMEN_SWING * (1 - i * 0.22);
      }

      // Wings: high frequency, low amplitude. A real wingbeat would alias into
      // a strobe at 60fps, so this is a deliberate shimmer around the rest pose.
      const beat = Math.sin(t * BEE_WING_FREQ + idleT * 4) * BEE_WING_AMPLITUDE;
      for (let i = 0; i < wings.length; i++) {
        const side = i % 2 === 0 ? 1 : -1;
        wings[i].rotation.z = wingRest[i] + beat * side * (i < 2 ? 1 : 0.7);
      }

      for (let i = 0; i < antennae.length; i++) {
        antennae[i].rotation.x =
          antennaRest[i] + Math.sin(phase - BEE_LAG_ANTENNA + i * 0.7) * 0.12;
      }

      // Legs pendulum last, opening a little wider while actually travelling.
      const swing = Math.sin(phase - BEE_LAG_LEG) * 0.14 * (0.6 + 0.4 * moveBlend);
      for (let i = 0; i < legs.length; i++) {
        legs[i].rotation.x = legRest[i] + swing * (1 - i * 0.1);
      }
    },
  };
}

export function makeBee(color: number): THREE.Group {
  const g = new THREE.Group();

  // PROPORTION BASE: HEAD WIDTH = W. W comes from the GAME rather than the
  // sheet â€” head plus a 1.15 abdomen on a 32-degree axis runs about 0.68 front
  // to back, which has to fit a TILE of 1.0, and the total height has to sit
  // beside the ghost's 0.66 and the beetle's 0.76 without looming over them.
  const W = 0.32;
  const HEAD_R = W / 2;

  // Yellow is the TEAM colour here â€” it is how a player tells the three enemies
  // apart and how "frightened" announces itself. The dark stays dark, so the
  // banding still reads in every state.
  const bodyMat = toon({
    color,


    emissive: color,
    emissiveIntensity: 0.12,
  });
  const darkMat = toon({
    color: BEE_ACCENT,


  });
  const wingMat = toon({
    color: BEE_WING_COLOR,

    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const veinMat = toon({
    color: 0xffffff,

    transparent: true,
    // Faint on purpose. The veins do not write depth, so seen EDGE-ON from the
    // front they used to punch through the head as four bright whiskers. At
    // this opacity they still fan the wing when it faces the camera â€” which is
    // the angle the game's overhead view actually shows â€” without reading as
    // hairs the rest of the time.
    opacity: 0.28,
    depthWrite: false,
  });

  // A bee hovers, so everything hangs off this node and the behaviour bobs it.
  // The root belongs to syncToEntity (position, yaw, waddle).
  const hover = new THREE.Group();
  hover.name = "hover";
  g.add(hover);

  // --- three masses on a diagonal: head (front, high) â†’ thorax â†’ abdomen ----
  const HEAD_POS = new THREE.Vector3(0, 0.47, 0.09);
  const THORAX_POS = new THREE.Vector3(0, 0.41, -0.09);

  // Thorax first: small, dark, mostly swallowed. It is a JOINT, not a feature â€”
  // its whole job is to let the abdomen pivot.
  const thorax = new THREE.Mesh(new THREE.SphereGeometry(W * 0.275, 18, 14), darkMat);
  thorax.name = "thorax";
  thorax.scale.set(1, 0.92, 1.05);
  thorax.position.copy(THORAX_POS);
  hover.add(thorax);

  // `skirt` is the mesh animateGhostHem breathes; the thorax collar is the
  // natural pick â€” a gentle swell between head and abdomen.
  const skirt = thorax;

  // --- abdomen: TWO rounded segments on a 2-link chain ---------------------
  // Three long segments read as a mosquito, not a bee. Two near-spherical ones
  // give the short, fat, bumbly abdomen the silhouette wants, and the chain
  // still lets the trailing mass swing with lag.
  const SEG_R = [W * 0.37, W * 0.3];
  const abdomenJoints: THREE.Object3D[] = [];

  const abdomenRoot = new THREE.Group();
  abdomenRoot.name = "abdomenRoot";
  abdomenRoot.position.copy(THORAX_POS);
  abdomenRoot.rotation.set(0.25, 0, 0); // tips the chain back and down
  hover.add(abdomenRoot);
  abdomenJoints.push(abdomenRoot);

  /**
   * A broad FLAT band lying on a segment, rather than a torus ring standing
   * proud of it. Same flush-decal idea as everywhere else in this file â€” a
   * theta slice of a very slightly larger sphere â€” with one twist: the slice is
   * rotated so its pole points along the chain (+Z) instead of up (+Y), which
   * is what makes the band wrap the segment's waist instead of its equator.
   */
  const abdomenBand = (r: number, thetaStart: number, thetaLen: number): THREE.Mesh => {
    const geo = new THREE.SphereGeometry(r * 1.012, 26, 16, 0, Math.PI * 2, thetaStart, thetaLen);
    geo.rotateX(Math.PI / 2);
    return new THREE.Mesh(geo, darkMat);
  };

  let link: THREE.Object3D = abdomenRoot;
  for (let i = 0; i < 2; i++) {
    if (i > 0) {
      const joint = new THREE.Group();
      joint.name = `abdomenJoint${i}`;
      joint.position.z = -(SEG_R[0] + SEG_R[1]) * 0.66; // overlap, so no waist gap
      joint.rotation.x = -0.14; // the gentle down-then-up curve
      link.add(joint);
      abdomenJoints.push(joint);
      link = joint;
    }
    // Near-spherical: the roundness IS the read.
    const seg = new THREE.Mesh(new THREE.SphereGeometry(SEG_R[i], 22, 16), bodyMat);
    seg.name = `abdomen${i}`;
    seg.scale.set(1, 0.96, 1.04);
    link.add(seg);

    // ONE band per segment, sized off its own segment so it narrows with the
    // taper, and broad enough to read as a stripe rather than a wire.
    const stripe = abdomenBand(SEG_R[i], 1.05, 0.72);
    stripe.name = `abdomenBand${i}`;
    stripe.scale.set(1, 0.96, 1.04);
    link.add(stripe);
  }

  // Sting: blunt, as wide at its base as the abdomen's tip, so it continues the
  // form instead of looking like a spike stuck on. Cute, not threatening.
  // Longer, and pushed clear of the segment it grows from. At the sheet's
  // 0.1 x W it was 0.032 long sitting at z -0.091, while the segment's back
  // surface is already at -0.0998 â€” so barely 0.007 of it ever emerged and the
  // rest was buried inside the abdomen. Its base still matches the abdomen's
  // tip width, so it reads as a continuation rather than a spike stuck on.
  const sting = new THREE.Mesh(new THREE.ConeGeometry(SEG_R[1] * 0.4, W * 0.24, 10), darkMat);
  sting.name = "sting";
  sting.position.z = -SEG_R[1] * 1.28;
  sting.position.y = W * 0.02;
  sting.rotation.x = -Math.PI / 2 + 0.3; // points back and slightly UP
  link.add(sting);

  // --- head: the largest mass, near-spherical. No hood: the head is left as
  // one clean team-coloured ball, with the eyes and antennae carrying the read.
  const HEAD_SCALE = { x: 1, y: 0.98, z: 0.98 };
  const head = new THREE.Mesh(new THREE.SphereGeometry(HEAD_R, 28, 20), bodyMat);
  head.name = "head";
  head.scale.set(HEAD_SCALE.x, HEAD_SCALE.y, HEAD_SCALE.z);
  head.position.copy(HEAD_POS);
  hover.add(head);

  // --- antennae: a shallow C, dark stalk, BIG yellow ball -------------------
  // The stalk/ball colour contrast is the whole point of these, so the ball
  // stays the body's own yellow at full saturation and a full 0.2 x W across.
  const antennae: THREE.Object3D[] = [];
  ([-1, 1] as const).forEach((s) => {
    const pivot = new THREE.Group();
    pivot.name = s < 0 ? "antennaPivotL" : "antennaPivotR";
    pivot.position.set(0.085 * s, HEAD_POS.y + HEAD_R * 0.8, HEAD_POS.z - 0.02);
    pivot.rotation.z = -0.62 * s; // set wide, sweeping outward
    pivot.rotation.x = -0.28; // slight backward lean
    hover.add(pivot);
    antennae.push(pivot);

    const stalkLen = W * 0.55;
    const stalk = new THREE.Mesh(
      new THREE.CylinderGeometry(W * 0.035, W * 0.035, stalkLen, 6),
      darkMat,
    );
    stalk.name = s < 0 ? "antennaStalkL" : "antennaStalkR";
    stalk.position.y = stalkLen / 2;
    stalk.rotation.z = 0.2 * s; // the shallow C, curving back inward
    pivot.add(stalk);

    const ball = new THREE.Mesh(new THREE.SphereGeometry(W * 0.1, 12, 10), bodyMat);
    ball.name = s < 0 ? "antennaTipL" : "antennaTipR";
    ball.position.set(-Math.sin(0.2 * s) * stalkLen, stalkLen * 0.97, 0);
    pivot.add(ball);
  });

  // --- wings: two pairs, high on the thorax right behind the head -----------
  const wings: THREE.Object3D[] = [];
  ([-1, 1] as const).forEach((s) => {
    const mount = new THREE.Group();
    mount.name = s < 0 ? "wingMountL" : "wingMountR";
    // Set BACK over the front of the abdomen rather than tucked behind the
    // head â€” mounted at the head they crowded the face and read as ears.
    mount.position.set(0.03 * s, THORAX_POS.y + W * 0.1, THORAX_POS.z - W * 0.42);
    hover.add(mount);

    const makeWing = (tag: string, len: number, wide: number, lift: number, sweep: number): void => {
      const pivot = new THREE.Group();
      pivot.name = tag + (s < 0 ? "L" : "R");
      pivot.rotation.z = lift * s;
      pivot.rotation.y = sweep * s;
      mount.add(pivot);
      wings.push(pivot);

      // Flat lenses, not alpha-textured planes: this project builds every
      // character from primitives and loads no textures, and a CanvasTexture
      // would break the headless suites outright â€” they build these models in
      // Node, where there is no document to draw on.
      const blade = new THREE.Mesh(new THREE.SphereGeometry(len / 2, 20, 12), wingMat);
      blade.name = tag + "Blade" + (s < 0 ? "L" : "R");
      blade.scale.set(1, 0.05, wide / len * 2);
      blade.position.x = (len / 2) * s;
      pivot.add(blade);

      if (tag === "fore") {
        // Brighter rim along the leading edge, plus a small vein fan from the
        // base. Forewings only â€” on the hindwing these would be sub-pixel.
        const rim = new THREE.Mesh(
          new THREE.BoxGeometry(len * 0.94, len * 0.009, len * 0.009),
          veinMat,
        );
        rim.name = "wingRim" + (s < 0 ? "L" : "R");
        rim.position.set((len / 2) * s, 0, -wide * 0.42);
        pivot.add(rim);
        for (let i = 0; i < 3; i++) {
          const vein = new THREE.Mesh(
            new THREE.BoxGeometry(len * 0.42, len * 0.006, len * 0.006),
            veinMat,
          );
          vein.name = `wingVein${i}${s < 0 ? "L" : "R"}`;
          vein.position.set(len * (0.3 + i * 0.16) * s, 0, -wide * 0.08);
          vein.rotation.y = (0.42 - i * 0.14) * s;
          pivot.add(vein);
        }
      }
    };

    makeWing("fore", W * 0.85, W * 0.38, 0.6, -0.3);
    makeWing("hind", W * 0.6, W * 0.27, 0.2, -0.6);
  });

  // --- FOUR limbs, not six: this is a cartoon body plan ---------------------
  const legSwings: THREE.Object3D[] = [];
  const addLimb = (
    tag: string,
    s: number,
    anchor: THREE.Vector3,
    upperLen: number,
    bend: number,
    reach: number,
    pawR: number,
    /** Pitch of the whole limb about X â€” the arms tip forward on this. */
    pitch: number,
    /** How far the limb splays outward about Z. */
    splay: number,
  ): THREE.Group => {
    const root = new THREE.Group();
    root.name = tag + (s < 0 ? "L" : "R");
    root.position.copy(anchor);
    root.position.x = anchor.x * s;
    root.rotation.x = pitch;
    root.rotation.z = splay * s;

    // Same separation the beetle uses: `root` holds the authored pose and stays
    // editable; `swing` is the node the hover animation owns.
    const swing = new THREE.Group();
    swing.name = "legSwing" + tag.replace("limb", "") + (s < 0 ? "L" : "R");
    swing.rotation.x = reach;
    root.add(swing);
    legSwings.push(swing);

    // Thick relative to length â€” thin limbs kill the chibi read.
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(W * 0.055, upperLen, 4, 8), darkMat);
    upper.name = tag + "Upper" + (s < 0 ? "L" : "R");
    upper.position.y = -upperLen / 2;
    swing.add(upper);

    const wrist = new THREE.Group();
    wrist.name = tag + "Wrist" + (s < 0 ? "L" : "R");
    wrist.position.y = -upperLen;
    wrist.rotation.x = bend;
    swing.add(wrist);

    const fore = new THREE.Mesh(new THREE.CapsuleGeometry(W * 0.05, upperLen * 0.8, 4, 8), darkMat);
    fore.name = tag + "Fore" + (s < 0 ? "L" : "R");
    fore.position.y = -upperLen * 0.4;
    wrist.add(fore);

    // A rounded MITTEN â€” one ball, no separated fingers.
    const paw = new THREE.Mesh(new THREE.SphereGeometry(pawR, 12, 10), darkMat);
    paw.name = tag + "Paw" + (s < 0 ? "L" : "R");
    paw.position.y = -upperLen * 0.8 - pawR * 0.5;
    wrist.add(paw);

    return root;
  };

  // Each limb gets its OWN top-level const, deliberately, instead of being
  // built inside a mirrored forEach.
  //
  // That loop is convenient but it makes the limbs UN-EDITABLE: the character
  // editor rewrites a part by finding the single source line that owns it, and
  // one `forEach` statement owns both sides at once, so Save can only refuse.
  // Naming each side costs four lines and buys back the ability to nudge a leg
  // in the editor and have it stick.
  //
  // Front arms: short, chubby, reaching forward and inward. The wrist is a free
  // node so these can be posed to hold a prop later. Anchors sit INSIDE the mass
  // each limb hangs from â€” the arm root within the head's lower front, the leg
  // root within the thorax â€” so they grow out of the body rather than floating
  // beside it.
  const ARM_ANCHOR = new THREE.Vector3(W * 0.26, HEAD_POS.y - HEAD_R * 0.7, 0.02);
  // Rear legs: dangling from the thorax underside, bent ~100 degrees and
  // trailing slightly back. Rooted well in on X and splayed wide, so the pair
  // sits under the body and the feet swing out. No weight on them.
  const LEG_ANCHOR = new THREE.Vector3(W * 0.1, THORAX_POS.y - W * 0.1, -0.075);

  const limbArmL = addLimb("limbArm", -1, ARM_ANCHOR, W * 0.25, -0.9, -0.85, W * 0.1, 0.6, -0.5);
  hover.add(limbArmL);
  const limbArmR = addLimb("limbArm", 1, ARM_ANCHOR, W * 0.25, -0.9, -0.85, W * 0.1, 0.6, -0.5);
  hover.add(limbArmR);
  const limbLegL = addLimb("limbLeg", -1, LEG_ANCHOR, W * 0.22, -1.0, 0.3, W * 0.085, 0, -0.72);
  limbLegL.rotation.set(0, 0, 0);
  limbLegL.position.set(-0.032, 0.338, -0.075);
  hover.add(limbLegL);
  const limbLegR = addLimb("limbLeg", 1, LEG_ANCHOR, W * 0.22, -1.0, 0.3, W * 0.085, 0, -0.72);
  limbLegR.rotation.set(0, 0, 0);
  limbLegR.position.set(0.032, 0.338, -0.075);
  hover.add(limbLegR);

  // --- face: big cute eyes, no mouth, no nose ------------------------------
  const scleraMat = toon({ color: 0xfdf9f2});
  const irisMat = toon({ color: 0x2f7fd4});
  const pupM = toon({ color: 0x0a0c12});
  const glintMat = toon({
    color: 0xffffff,

    emissive: 0xffffff,
    emissiveIntensity: 0.5,
  });
  const beeEyeMats = [scleraMat, irisMat, pupM, glintMat];

  // BEETLE-STYLE eyes: big PROTRUDING eyeballs bulging past the head's
  // silhouette, with the iris, pupil and glint as flush caps ON each eyeball â€”
  // not caps painted flat on the head. Same construction as makeBeetle's, which
  // is why the parts carry the same names and the shared dart pivot still fits.
  const EYE_R = W * 0.21;
  /** Yaw of the iris/pupil off the eyeball's axis â€” a touch medial. */
  const EYE_TILT = -0.12;
  const EYE_FWD = Math.PI / 2; // tips a cap's pole from +Y round to +Z
  const eyeCap = (
    factor: number,
    rx: number,
    ry: number,
    thetaLen: number,
    mat: THREE.MeshToonMaterial,
  ): THREE.Mesh => {
    const geo = new THREE.SphereGeometry(EYE_R * factor, 26, 18, 0, Math.PI * 2, 0, thetaLen);
    geo.rotateX(rx);
    geo.rotateY(ry);
    return new THREE.Mesh(geo, mat);
  };

  const eyes: THREE.Object3D[] = [];
  const pupPivots: THREE.Object3D[] = [];

  ([-1, 1] as const).forEach((s) => {
    // Centres sit inside the head at ~0.87 of its radius, so a 0.21 x W eyeball
    // clears the surface by a clear margin and genuinely bulges.
    const centre = new THREE.Vector3(0.082 * s, HEAD_POS.y + 0.03, HEAD_POS.z + 0.11);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(EYE_R, 22, 18), scleraMat);
    ball.name = s < 0 ? "eyeL" : "eyeR";
    ball.position.copy(centre);
    hover.add(ball);
    eyes.push(ball);

    // The dart pivot sits at the EYEBALL's centre now, not the head's, so the
    // pupil sweeps around the ball it is painted on. That is the one piece of
    // eye machinery every enemy still shares.
    const pivot = new THREE.Group();
    pivot.name = s < 0 ? "pupilPivotL" : "pupilPivotR";
    pivot.position.copy(centre);
    hover.add(pivot);
    pupPivots.push(pivot);

    const iris = eyeCap(1.012, EYE_FWD, EYE_TILT * s, 0.72, irisMat);
    iris.name = s < 0 ? "irisL" : "irisR";
    pivot.add(iris);
    eyes.push(iris);

    const pupil = eyeCap(1.03, EYE_FWD, EYE_TILT * s, 0.38, pupM);
    pupil.name = s < 0 ? "pupilL" : "pupilR";
    pivot.add(pupil);
    eyes.push(pupil);

    // One highlight straddling the pupil/iris boundary. The offset is measured
    // from the PUPIL's axis, not the eyeball's â€” the pupil carries its own
    // EYE_TILT yaw, and ignoring that was what pushed the highlight out onto
    // the iris. sqrt(0.27^2 + 0.27^2) = 0.38, exactly the pupil's radius.
    const glint = eyeCap(1.05, EYE_FWD - 0.27, (EYE_TILT + 0.27) * s, 0.13, glintMat);
    glint.name = s < 0 ? "glintL" : "glintR";
    pivot.add(glint);
    eyes.push(glint);
  });

  g.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  // Wings never cast: a translucent blade throws a hard black shadow that
  // instantly reads as a solid paddle.
  for (const w of wings) {
    w.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = false;
    });
  }

  const userData: GhostUserData = {
    bodyMat,
    eyes,
    pupPivots,
    pupM,
    pupBaseColor: pupM.color.getHex(),
    baseColor: color,
    // The bee's life is the hover and the trailing abdomen, not a hem wobble.
    hem: [],
    skirt,
    pupOffset: { x: 0, z: 0 },
    behaviour: beeBehaviour(hover, abdomenJoints, wings, antennae, legSwings),
    eyeMats: beeEyeMats,
    spiritMats: collectSpiritMats(g, beeEyeMats),
  };
  g.userData = userData;
  return g;
}

/**
 * Builds a garden-ladybug enemy from primitives (IDEA-009 fourth enemy skin,
 * alongside the ghost, beetle, and bee). Satisfies the identical
 * `GhostUserData` contract â€” a single shared `bodyMat` covering the shell
 * (plus its skirt-equivalent underbelly rim), so `applyGhostState`'s
 * frightened recolor ("whole creature turns blue") and eaten hide/reveal
 * both read correctly unmodified. Like the beetle and bee, the shell takes
 * the TEAM color (rose/teal/amber) rather than a fixed red â€” the signature
 * ladybug read comes from SHAPE + the black spot pattern on top, not from a
 * fixed red-and-black palette, so each ghost keeps its team identity.
 *
 * Shape: a rounded, more-hemispherical dome shell than the beetle's flatter
 * one (a classic ladybug's back is rounder/taller) on `bodyMat`, 7 black
 * spot dots (1 centred + 3 symmetric pairs) scattered across the shell top
 * and weighted toward the REAR half â€” the star of the design, clearly
 * visible from the overhead game camera, each one flush on the dome's own
 * curved surface â€” while still a clear minority of the shell area so
 * bodyMat dominates the silhouette. A thin dark centre-seam line down the
 * back (the wing-case split), a small fixed-dark head at the front, and 2
 * short thin antennae. Eyes/pupils use the exact
 * same geometry/placement/material pattern as the other three enemies (2
 * white eyes + 2 blue pupils on `pupM`, added directly to the top-level
 * group `g` as siblings â€” never nested under a sub-group, which is what
 * makes `applyGhostState`'s eaten-state eyes-float-home re-show work), at
 * the standard local coords (eyes y0.4 z0.2 x+-0.12; pupils z0.27 x+-0.12)
 * so applyGhostState's hardcoded pupil-offset math lands unchanged.
 */
// Ladybug scuttle. The proportions call for a fast, low, busy gait rather than
// a deliberate step: the body barely bobs, the six nubs flick through a quick
// alternating tripod, and the antennae only twitch. Single-bone legs, no IK.
const LB_SCUTTLE_FREQ = 16; // rad/s â€” quick and busy, matching the tiny legs
const LB_SCUTTLE_SWING = 0.42;
const LB_BOB = 0.006; // barely there; the body sits ~0.05 W off the ground
const LB_BOB_FREQ = 2.1 * Math.PI * 2;
const LB_ANTENNA_TWITCH = 0.09;

function ladybugBehaviour(
  legs: THREE.Object3D[],
  antennae: THREE.Object3D[],
  body: THREE.Object3D,
): EnemyBehaviour {
  const legRest = legs.map((l) => l.rotation.y);
  const antennaRest = antennae.map((a) => a.rotation.x);
  const bodyRestY = body.position.y;
  return {
    animate: (t, idleT, moveBlend) => {
      // Alternating tripod, same grouping as the beetle: legs arrive in build
      // order (F-L, F-R, M-L, M-R, B-L, B-R), so indices 0, 3 and 4 form one
      // tripod and 1, 2, 5 the other.
      const stride = Math.sin(t * LB_SCUTTLE_FREQ) * LB_SCUTTLE_SWING * moveBlend;
      for (let i = 0; i < legs.length; i++) {
        const tripodA = i === 0 || i === 3 || i === 4;
        legs[i].rotation.y = legRest[i] + (tripodA ? stride : -stride);
      }
      body.position.y = bodyRestY + Math.abs(Math.sin(idleT * LB_BOB_FREQ)) * LB_BOB;
      for (let i = 0; i < antennae.length; i++) {
        antennae[i].rotation.x =
          antennaRest[i] + Math.sin(idleT * 1.6 + i * 1.3) * LB_ANTENNA_TWITCH;
      }
    },
  };
}

export function makeLadybug(color: number): THREE.Group {
  const g = new THREE.Group();

  // PROPORTION BASE: SHELL WIDTH = W, everything derived from it per the
  // reference sheet. W comes from the GAME: total height is 0.95 x W, and at
  // W = 0.68 that lands on 0.65 â€” right beside the ghost's 0.66 and the
  // beetle's 0.76, which is what matters for a row of enemies in one maze.
  const W = 0.68;
  const R = W / 2;

  // The sheet's palette is a fixed red shell. In the game the shell carries the
  // TEAM colour instead â€” it is how a player tells the three enemies apart and
  // how "frightened" announces itself. Everything the sheet calls black stays
  // black, so the spots and the oversized head read in every state.
  const shellMat = toon({
    color,
    // As glossy as this scene can go: there is no environment map (see the
    // note in the summary), so a low roughness plus the rig's rim light is
    // what carries the plastic sheen.


    emissive: color,
    emissiveIntensity: 0.12,
  });
  const blackMat = toon({
    color: LADYBUG_BLACK,


  });
  blackMat.userData.baseColor = LADYBUG_BLACK;

  // --- shell: a squashed pebble dome, pushed BACK and tilted forward --------
  const SHELL_POS = new THREE.Vector3(0, 0.3, -0.07);
  const SHELL_SCALE = { x: 1, y: 0.9, z: 0.95 };
  const SHELL_TILT = -0.17; // ~10 degrees, so the crown sits over the front third
  const SHELL_CUT = Math.PI * 0.62; // clean bottom cut, not a full sphere
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(R, 40, 28, 0, Math.PI * 2, 0, SHELL_CUT),
    shellMat,
  );
  shell.name = "shell";
  shell.scale.set(SHELL_SCALE.x, SHELL_SCALE.y, SHELL_SCALE.z);
  shell.position.copy(SHELL_POS);
  shell.rotation.x = SHELL_TILT;
  g.add(shell);

  /** A flush decal on the shell â€” same transform as the shell itself, so it
   *  lies exactly on the curve at any tilt instead of having to be fitted. */
  const shellDecal = (
    factor: number,
    phiStart: number,
    phiLen: number,
    thetaStart: number,
    thetaLen: number,
  ): THREE.Mesh => {
    const geo = new THREE.SphereGeometry(R * factor, 32, 24, phiStart, phiLen, thetaStart, thetaLen);
    const m = new THREE.Mesh(geo, blackMat);
    m.scale.set(SHELL_SCALE.x, SHELL_SCALE.y, SHELL_SCALE.z);
    m.position.copy(SHELL_POS);
    m.rotation.x = SHELL_TILT;
    return m;
  };

  // Centre seam: one shallow crease down the middle, visible mainly on the
  // FRONT slope where the two elytra halves meet â€” hence the limited theta
  // range. No panel divisions; this shell is otherwise smooth.
  const seam = shellDecal(1.004, Math.PI / 2 - 0.022, 0.044, 0, 1.05);
  seam.name = "seam";
  g.add(seam);

  // Spots: flat discs PROJECTED onto the curve, not bumps â€” a small cap of a
  // slightly larger sphere is exactly that. Placement is hand-authored and
  // deliberately irregular: not mirrored across the seam, not gridded, sizes
  // varied between 0.12 and 0.21 of W, with clear breathing room around each
  // and none running off the rim.
  const SPOTS: Array<{ t: number; p: number; s: number }> = [
    { t: 0.42, p: 0.90, s: 0.20 },
    { t: 0.55, p: 2.50, s: 0.17 },
    { t: 0.95, p: 0.35, s: 0.15 },
    { t: 1.05, p: 1.75, s: 0.13 },
    { t: 1.20, p: 3.05, s: 0.19 },
    { t: 0.80, p: 4.15, s: 0.14 },
    { t: 1.30, p: 5.00, s: 0.12 },
    { t: 1.15, p: 5.75, s: 0.16 },
    { t: 0.62, p: 4.90, s: 0.13 },
    { t: 1.42, p: 2.15, s: 0.12 },
  ];
  SPOTS.forEach((spot, i) => {
    // The cap's pole is aimed by rotating the GEOMETRY, so every spot can share
    // the shell's own position and scale and stay flush.
    const geo = new THREE.SphereGeometry(R * 1.008, 20, 14, 0, Math.PI * 2, 0, spot.s);
    geo.rotateX(spot.t);
    geo.rotateY(spot.p);
    const dot = new THREE.Mesh(geo, blackMat);
    dot.name = `spot${i}`;
    dot.scale.set(SHELL_SCALE.x, SHELL_SCALE.y, SHELL_SCALE.z);
    dot.position.copy(SHELL_POS);
    dot.rotation.x = SHELL_TILT;
    g.add(dot);
  });

  // Rim: the soft chamfer under the shell's cut.
  //
  // It is NOT the `skirt` any more, and it now shares the shell's tilt. Both
  // changes fix the same defect: the shell's cut is a tilted ellipse whose edge
  // rises and falls by 0.054, while a level cylinder 0.035 tall cannot span
  // that â€” so the two interpenetrated, and animateGhostHem's breathe then slid
  // that intersection in and out on every frame of movement. Matching the tilt
  // makes the rim parallel to the cut it seals, and dropping it as the skirt
  // stops anything animating it at all.
  const rimCentre = new THREE.Vector3(0, R * 0.9 * Math.cos(SHELL_CUT), 0)
    .applyAxisAngle(new THREE.Vector3(1, 0, 0), SHELL_TILT)
    .add(SHELL_POS);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.99, R * 0.9, 0.05, 28), blackMat);
  rim.name = "rim";
  rim.position.copy(rimCentre);
  rim.rotation.x = SHELL_TILT;
  g.add(rim);

  // Underside: the shell is a partial sphere and three.js does not cap a cut,
  // so its bottom is an open hole. The flat rim above cannot seal it once the
  // shell is TILTED â€” the rim ellipse tips with it while the cylinder stays
  // level â€” and you end up looking through the gap into the lit interior. A
  // squashed black mass plugs it and reads as the body the legs grow from.
  const belly = new THREE.Mesh(new THREE.SphereGeometry(R * 0.93, 24, 16), blackMat);
  belly.name = "belly";
  belly.scale.set(1.04, 0.42, 1.0);
  belly.position.set(0, 0.2, SHELL_POS.z);
  g.add(belly);

  // --- head + pronotum: ONE fused black mass, and deliberately OVERSIZED ----
  // 0.78 x the shell's width. That is the whole charm of this design; shrinking
  // it toward realistic proportions loses the toy read immediately. The colour
  // break against the shell is hard and clean â€” no blending, no fringe.
  const HEAD_R = W * 0.39;
  const HEAD_POS = new THREE.Vector3(0, 0.24, 0.17);
  const head = new THREE.Mesh(new THREE.SphereGeometry(HEAD_R, 32, 24), blackMat);
  head.name = "head";
  head.scale.set(1, 0.81, 0.75); // squashed, and flattened front-to-back
  head.position.copy(HEAD_POS);
  g.add(head);

  // --- antennae: SHORT and subtle, the opposite of the bee's ---------------
  // They barely clear the head's silhouette, and they are the same black, so
  // they read as part of the head rather than as features.
  const makeAntenna = (s: number): THREE.Group => {
    const pivot = new THREE.Group();
    pivot.name = s < 0 ? "antennaPivotL" : "antennaPivotR";
    pivot.position.set(0.055 * s, HEAD_POS.y + HEAD_R * 0.543, HEAD_POS.z + HEAD_R * 0.5);
    pivot.rotation.z = -0.5 * s; // set close together, sweeping outward
    pivot.rotation.x = -0.3; // and slightly back
    const len = W * 0.21;
    const stalk = new THREE.Mesh(
      new THREE.CylinderGeometry(W * 0.015, W * 0.015, len, 6),
      blackMat,
    );
    stalk.name = s < 0 ? "antennaStalkL" : "antennaStalkR";
    stalk.position.y = len / 2;
    pivot.add(stalk);
    const club = new THREE.Mesh(new THREE.SphereGeometry(W * 0.03, 10, 8), blackMat);
    club.name = s < 0 ? "antennaTipL" : "antennaTipR";
    club.position.y = len;
    pivot.add(club);
    return pivot;
  };
  // Named per side rather than built in a mirrored loop â€” one loop statement
  // owns both sides, which makes them un-editable in the character editor.
  const antennaPivotL = makeAntenna(-1);
  g.add(antennaPivotL);
  const antennaPivotR = makeAntenna(1);
  g.add(antennaPivotR);

  // --- legs: six tiny nubs, almost vestigial -------------------------------
  // One smooth capsule each, no joints, no segments, no toes. The body sits so
  // low that only the outer half of each nub clears the silhouette.
  /**
   * One leg. `fanForward` is POSITIVE toward the front of the bug â€” front pair
   * positive, middle zero, rear pair negative.
   *
   * The sign matters, and it used to be inverted. `rotation.y` is applied after
   * `rotation.z` (Euler XYZ) and the leg's outward axis has a POSITIVE x
   * component, so a positive yaw swings the leg toward NEGATIVE z â€” backwards.
   * Passing the fan straight through as `yaw * s` therefore aimed the front
   * legs behind the bug and the rear legs in front of it.
   */
  const makeLeg = (tag: string, s: number, z: number, fanForward: number): THREE.Group => {
    const root = new THREE.Group();
    root.name = "leg" + tag + (s < 0 ? "L" : "R");
    root.position.set(R * 0.7 * s, 0.15, z);
    // Outward and DOWN. The first version used -(PI/2 - 0.5), whose cosine is
    // POSITIVE â€” so the nubs angled outward and UP, back into the body. And
    // they were too short to matter: the belly that plugs the shell's open
    // underside is 0.329 wide, and a nub reaching x 0.293 left the middle and
    // rear pairs entirely buried inside it. Only the front pair ever showed.
    root.rotation.z = -(Math.PI / 2 + 0.62) * s;
    root.rotation.y = -fanForward * s;

    const upperLen = W * 0.2;
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(W * 0.038, upperLen, 4, 8), blackMat);
    leg.name = "legNub" + tag + (s < 0 ? "L" : "R");
    leg.position.y = upperLen * 0.5;
    root.add(leg);

    // A rounded PAW at the tip â€” slightly flattened, so it reads as a little
    // foot rather than the end of a stick. This is what makes the legs visible
    // at all at this size: the pad is wider than the leg and catches the light.
    const paw = new THREE.Mesh(new THREE.SphereGeometry(W * 0.062, 12, 10), blackMat);
    paw.name = "legPaw" + tag + (s < 0 ? "L" : "R");
    paw.scale.set(1.05, 0.72, 1.15);
    paw.position.y = upperLen + W * 0.035;
    root.add(paw);

    return root;
  };
  // All three pairs sit under the BELLY. The front pair used to be at z 0.143,
  // which is inside the head's z span (-0.03 .. 0.37) â€” so it read as legs
  // growing out of the head rather than the body. Shifted back to clear it.
  // Front pair fans FORWARD, rear pair BACKWARD, middle straight out to the
  // side â€” which is what the reference sheet asks for and what makes the
  // alternating tripod read, since the middle leg is the pivot the other two
  // swing around.
  //
  // These are the values hand-tuned in the editor, folded back into the
  // parameters they belong to. The rear pair had drifted apart (0.05 of yaw and
  // 0.18 of splay between the two sides); it is averaged and symmetrical here.
  const FAN_FRONT = 0.597;
  const FAN_REAR = -0.327;
  const legFL = makeLeg("F", -1, -0.02, FAN_FRONT);
  g.add(legFL);
  const legFR = makeLeg("F", 1, -0.02, FAN_FRONT);
  g.add(legFR);
  const legML = makeLeg("M", -1, -0.15, 0);
  g.add(legML);
  const legMR = makeLeg("M", 1, -0.15, 0);
  g.add(legMR);
  const legBL = makeLeg("B", -1, -0.28, FAN_REAR);
  g.add(legBL);
  const legBR = makeLeg("B", 1, -0.28, FAN_REAR);
  g.add(legBR);
  const legs = [legFL, legFR, legML, legMR, legBL, legBR];

  // --- eyes ----------------------------------------------------------------
  // The sheet describes the head as one unbroken black mass with no eyes. The
  // game needs them anyway: every other enemy has a face, and applyGhostState's
  // "eaten" state is built around eyes that stay solid while the body fades. So
  // they use the same protruding build as the beetle and the bee â€” a white ball
  // with the iris, pupil and glint as flush caps on it â€” which also gives the
  // black head the one bright element it otherwise lacks.
  const scleraMat = toon({ color: 0xfdf9f2});
  const irisMat = toon({ color: 0x2f7fd4});
  const pupM = toon({ color: 0x0a0c12});
  const glintMat = toon({
    color: 0xffffff,

    emissive: 0xffffff,
    emissiveIntensity: 0.5,
  });
  const ladybugEyeMats = [scleraMat, irisMat, pupM, glintMat];

  const EYE_R = W * 0.085;
  const EYE_FWD = Math.PI / 2;
  const EYE_TILT = -0.1;
  const eyeCap = (
    factor: number,
    rx: number,
    ry: number,
    thetaLen: number,
    mat: THREE.MeshToonMaterial,
  ): THREE.Mesh => {
    const geo = new THREE.SphereGeometry(EYE_R * factor, 24, 16, 0, Math.PI * 2, 0, thetaLen);
    geo.rotateX(rx);
    geo.rotateY(ry);
    return new THREE.Mesh(geo, mat);
  };

  const eyes: THREE.Object3D[] = [];
  const pupPivots: THREE.Object3D[] = [];

  const makeEye = (s: number): { ball: THREE.Mesh; pivot: THREE.Group } => {
    const centre = new THREE.Vector3(0.115 * s, HEAD_POS.y + 0.055, HEAD_POS.z + 0.135);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(EYE_R, 22, 18), scleraMat);
    ball.name = s < 0 ? "eyeL" : "eyeR";
    ball.position.copy(centre);

    const pivot = new THREE.Group();
    pivot.name = s < 0 ? "pupilPivotL" : "pupilPivotR";
    pivot.position.copy(centre);

    const iris = eyeCap(1.012, EYE_FWD, EYE_TILT * s, 0.72, irisMat);
    iris.name = s < 0 ? "irisL" : "irisR";
    pivot.add(iris);

    const pupil = eyeCap(1.03, EYE_FWD, EYE_TILT * s, 0.38, pupM);
    pupil.name = s < 0 ? "pupilL" : "pupilR";
    pivot.add(pupil);

    // One highlight straddling the pupil/iris rim, measured from the PUPIL's
    // axis â€” the same construction the beetle and bee use.
    const glint = eyeCap(1.05, EYE_FWD - 0.27, (EYE_TILT + 0.27) * s, 0.13, glintMat);
    glint.name = s < 0 ? "glintL" : "glintR";
    pivot.add(glint);

    eyes.push(ball, iris, pupil, glint);
    pupPivots.push(pivot);
    return { ball, pivot };
  };

  const eyeLeft = makeEye(-1);
  g.add(eyeLeft.ball, eyeLeft.pivot);
  const eyeRight = makeEye(1);
  g.add(eyeRight.ball, eyeRight.pivot);

  g.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });

  const userData: GhostUserData = {
    bodyMat: shellMat,
    // The black mass is most of the silhouette, so it follows the frightened
    // recolour â€” otherwise a frightened ladybug would stay largely black and
    // blunt the "edible now" read.
    accentMats: [blackMat],
    eyes,
    pupPivots,
    pupM,
    pupBaseColor: pupM.color.getHex(),
    baseColor: color,
    // Spots are flush decals, not wobbling blobs, so there is no hem to bob.
    hem: [],
    // No `skirt`: this character opts out of the shared breathe (see the rim
    // note above). Its idle is the body bob and antenna twitch below.
    pupOffset: { x: 0, z: 0 },
    behaviour: ladybugBehaviour(legs, [antennaPivotL, antennaPivotR], g),
    eyeMats: ladybugEyeMats,
    spiritMats: collectSpiritMats(g, ladybugEyeMats),
  };
  g.userData = userData;
  return g;
}

// --- FLEA (IDEA-053) -------------------------------------------------------
// Rebuilt from .img2threejs/reference/flea/, gated by the img2threejs pipeline.
// The proportion lock, the ranked identity features and every number below come
// from .img2threejs/flea/object-sculpt-spec.json — re-run that pipeline rather
// than eyeballing these tables. Two findings from it are load-bearing here:
//
//   1. THE SEGMENT BANDS AND THE JUMPING HIND LEG ARE THE IDENTITY. They are
//      ranks 1 and 2 of the reference read, and rank 1 is the only feature
//      present in BOTH references. Lose either and this reads as one more
//      rounded garden bug beside the beetle and the ladybug — which is the
//      single biggest risk the spec records for this skin.
//   2. THE REFERENCE IS A WATERMARKED STOCK IMAGE. No colour here was sampled
//      from its pixels; every hue is authored from the observed
//      hue/value/saturation read. See .img2threejs/flea/evidence/.
//
// The reference is a LATERAL view. This model is authored facing +Z like every
// other enemy, i.e. rotated 90° out of the reference's own view.
const FLEA_DARK = 0x4a2510;
// The band creases. Darker than FLEA_DARK because they read as a recess, and
// separate from it because they must survive the frightened recolour (see makeFlea).
const FLEA_CREASE = 0x37200f;

const FL_SCUTTLE_FREQ = 15; // rad/s — a shade calmer than the ladybug's 16
const FL_SCUTTLE_SWING = 0.2;
const FL_HOP = 0.022; // deliberately TINY — see fleaBehaviour
const FL_HOP_FREQ = 1.45 * Math.PI * 2;
const FL_CROUCH = 0.22; // hind-femur flex, in phase with the hop
const FL_ANTENNA_TWITCH = 0.11;

/**
 * The flea's idle: an alternating-tripod scuttle, a small HOP, and an antenna
 * twitch.
 *
 * The hop is the whole point of the character and also the thing most likely to
 * go wrong, so it is deliberately small (0.022 world units — about 3% of the
 * model's height). Enemies move by tile-stepping on the grid; the mesh must
 * never look like it is leaving the maze plane, or it stops reading as a piece
 * on the board. What sells the jump is not height but the CROUCH: the hind
 * femurs flex in phase with the rise, so the leg does the work the vertical
 * travel is not allowed to do.
 *
 * Body y is written here rather than added to the shared bob because
 * syncToEntity sets `obj.position.y` BEFORE calling this, so a behaviour that
 * wants its own vertical motion must own it outright — the same reason the
 * ladybug takes over its own bob.
 */
function fleaBehaviour(
  legs: THREE.Object3D[],
  hindLegs: THREE.Object3D[],
  antennae: THREE.Object3D[],
  body: THREE.Object3D,
): EnemyBehaviour {
  const legRest = legs.map((l) => l.rotation.y);
  const hindRest = hindLegs.map((l) => l.rotation.z);
  const antennaRest = antennae.map((a) => a.rotation.x);
  const bodyRestY = body.position.y;
  return {
    animate: (t, idleT, moveBlend) => {
      // Same tripod grouping as the beetle and the ladybug: legs arrive in
      // build order (F-L, F-R, M-L, M-R, B-L, B-R), so 0/3/4 form one tripod
      // and 1/2/5 the other.
      const stride = Math.sin(t * FL_SCUTTLE_FREQ) * FL_SCUTTLE_SWING * moveBlend;
      for (let i = 0; i < legs.length; i++) {
        const tripodA = i === 0 || i === 3 || i === 4;
        legs[i].rotation.y = legRest[i] + (tripodA ? stride : -stride);
      }
      // One hop cycle drives both the body rise and the hind-leg crouch, so
      // they can never drift out of phase.
      const hop = Math.abs(Math.sin(idleT * FL_HOP_FREQ));
      body.position.y = bodyRestY + hop * FL_HOP;
      for (let i = 0; i < hindLegs.length; i++) {
        // Sign follows the leg's own side: hindRest already carries it.
        hindLegs[i].rotation.z = hindRest[i] * (1 + (1 - hop) * FL_CROUCH);
      }
      for (let i = 0; i < antennae.length; i++) {
        antennae[i].rotation.x =
          antennaRest[i] + Math.sin(idleT * 1.7 + i * 1.3) * FL_ANTENNA_TWITCH;
      }
    },
  };
}

export function makeFlea(color: number): THREE.Group {
  const g = new THREE.Group();

  // PROPORTION BASE: HEAD DIAMETER = HD, every number derived from it, exactly
  // as the spec measures the reference (in head-diameters). HD = 0.32 puts the
  // model's crown at ~0.63 — beside the ghost's 0.66 and the ladybug's 0.65,
  // which is what matters for a row of mixed enemies in one maze.
  const HD = 0.32;
  const HR = HD / 2;

  // The body carries the TEAM colour — and unlike the ladybug, so does the
  // HEAD. The spec calls for that explicitly: the three team colours are how a
  // player tells the enemies apart and how "frightened" announces itself, so
  // this skin needs a large coloured area. Only the limbs, antennae, belly and
  // face marks are the dark accent.
  const bodyMat = toon({ color, emissive: color, emissiveIntensity: 0.12 });
  const darkMat = toon({ color: FLEA_DARK });
  darkMat.userData.baseColor = FLEA_DARK;

  // The band creases get their OWN material, deliberately kept OUT of
  // accentMats. GhostUserData's rule is that a large accent should follow the
  // frightened recolour (or the "edible now" read is blunted) while a small
  // fixed accent keeps its own colour — and the creases are the small case:
  // six hairlines, a negligible share of the silhouette.
  //
  // It has to be a separate material because the first build shared darkMat,
  // which IS in accentMats. Frightened therefore repainted body and creases the
  // same blue and the banding vanished completely — the model's rank-1 identity
  // feature disappearing in the one state where the player is chasing it. The
  // map-stripped clay render is what exposed it; in normal colour it looked fine.
  const creaseMat = toon({ color: FLEA_CREASE });
  creaseMat.userData.baseColor = FLEA_CREASE;

  // --- abdomen: one continuous ovoid, arched so the BACK is the tallest mass -
  // Built as a unit sphere and scaled, so every band decal below can share the
  // exact same scale and sit flush on the curve at any radius factor.
  const ABD_POS = new THREE.Vector3(0, 0.292, -0.10);
  const ABD_SCALE = new THREE.Vector3(0.150, 0.171, 0.225);
  const abdomen = new THREE.Mesh(new THREE.SphereGeometry(1, 26, 16), bodyMat);
  abdomen.name = "abdomen";
  abdomen.scale.copy(ABD_SCALE);
  abdomen.position.copy(ABD_POS);
  g.add(abdomen);

  /**
   * A band tile on the abdomen. Same position and scale as the abdomen itself,
   * so it lies exactly on the curve instead of having to be fitted — the
   * ladybug's shell-decal construction.
   *
   * The geometry is rotated so its pole points along +Z (the body's long axis),
   * which is what makes a theta range a TRANSVERSE ring rather than a cap on
   * top. `theta` is measured from the anterior end.
   */
  const bandTile = (
    factor: number,
    thetaStart: number,
    thetaLen: number,
    mat: THREE.MeshToonMaterial,
    widthSeg: number,
    heightSeg: number,
  ): THREE.Mesh => {
    const geo = new THREE.SphereGeometry(
      factor, widthSeg, heightSeg, 0, Math.PI * 2, thetaStart, thetaLen,
    );
    geo.rotateX(Math.PI / 2);
    const m = new THREE.Mesh(geo, mat);
    m.scale.copy(ABD_SCALE);
    m.position.copy(ABD_POS);
    return m;
  };

  // SIX segment bands — identity rank 1, and the count both references agree
  // on. Each plate steps slightly PROUD of the one in front of it (the radius
  // factor grows front to back), which is what the reference shows: overlapping
  // plates, not evenly spaced grooves. A dark separator sits in each crevice,
  // because at gameplay size the step alone is too shallow to shade and the
  // line is what keeps the banding legible.
  //
  // THE CREASE MATERIAL IS THE LOAD-BEARING PART, not the step. A deeper step
  // was tried (plates standing 7.5% proud, with the base showing through as a
  // real groove) and it bought almost nothing: these plates are thin open
  // shells with smooth vertex normals, so the discontinuity at a plate edge
  // shades continuously and no ridge appears. What the map-stripped clay render
  // was really reporting was not "too shallow" but "carried entirely by
  // colour" — and that colour was darkMat, which is in accentMats, so the
  // frightened recolour painted body and creases the same blue and the banding
  // vanished exactly when the player is chasing the thing. Hence creaseMat.
  const BAND_START = 0.42;
  const BAND_LEN = 0.36;
  const BAND_GAP = 0.055;
  for (let i = 0; i < 6; i++) {
    const t0 = BAND_START + i * BAND_LEN;
    const plate = bandTile(1.0 + i * 0.014, t0, BAND_LEN, bodyMat, 22, 5);
    plate.name = `band${i}`;
    g.add(plate);
    // A thin crisp line sitting just proud of the plate it separates. A wide
    // soft band was tried and read as a stripe rather than a seam.
    const crease = bandTile(1.0 + i * 0.014 + 0.02, t0 - BAND_GAP / 2, BAND_GAP, creaseMat, 22, 2);
    crease.name = `bandCrease${i}`;
    g.add(crease);
  }

  // Underside: a dark mass the legs grow from, and the thing that stops you
  // seeing the band tiles' open edges where they wrap under.
  const belly = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), darkMat);
  belly.name = "belly";
  belly.scale.set(0.142, 0.062, 0.208);
  belly.position.set(0, 0.183, ABD_POS.z);
  g.add(belly);

  // --- head: no neck, embedded straight into the abdomen -------------------
  const HEAD_POS = new THREE.Vector3(0, 0.268, 0.208);
  const head = new THREE.Mesh(new THREE.SphereGeometry(HR, 24, 16), bodyMat);
  head.name = "head";
  head.scale.set(1, 1, 0.92); // slightly flattened front-to-back
  head.position.copy(HEAD_POS);
  g.add(head);

  // The rostrum, drawn as a nose in both references. Real relief, sunk in so it
  // reads as part of the capsule rather than a bead stuck on it.
  const rostrum = new THREE.Mesh(new THREE.SphereGeometry(HD * 0.10, 10, 8), darkMat);
  rostrum.name = "rostrum";
  rostrum.scale.set(1, 0.86, 0.9);
  rostrum.position.set(0, HEAD_POS.y - HR * 0.24, HEAD_POS.z + HR * 0.84);
  g.add(rostrum);


  // --- antennae: the tallest thing on the model ----------------------------
  // Built as a CHAIN of tapering segments, each a child of the last with a
  // small extra bend, so the shaft is a real swept arc rather than a straight
  // cone — and the beading comes free from the same construction. They sweep
  // postero-dorsally (back over the body), which is both what the reference
  // shows and what keeps the model inside the enemy height band: swept
  // straight up, this length would stand ~0.20 taller than the ghost.
  const ANT_N = 6;
  const ANT_SEG = 0.045;
  const makeAntenna = (s: number): THREE.Group => {
    const pivot = new THREE.Group();
    pivot.name = s < 0 ? "antennaPivotL" : "antennaPivotR";
    pivot.position.set(0.052 * s, 0.398, 0.192);
    pivot.rotation.x = -0.44;
    pivot.rotation.z = -0.42 * s;
    let parent: THREE.Object3D = pivot;
    for (let i = 0; i < ANT_N; i++) {
      const joint = new THREE.Group();
      joint.name = `${s < 0 ? "antJointL" : "antJointR"}${i}`;
      joint.position.y = i === 0 ? 0 : ANT_SEG;
      joint.rotation.x = i === 0 ? 0 : -0.10;
      parent.add(joint);
      const r0 = HD * 0.070 * (1 - i / (ANT_N + 1));
      const r1 = HD * 0.070 * (1 - (i + 1) / (ANT_N + 1));
      const bead = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, ANT_SEG, 7), darkMat);
      bead.name = `${s < 0 ? "antBeadL" : "antBeadR"}${i}`;
      bead.position.y = ANT_SEG / 2;
      joint.add(bead);
      parent = joint;
    }
    const tip = new THREE.Mesh(new THREE.SphereGeometry(HD * 0.032, 8, 6), darkMat);
    tip.name = s < 0 ? "antTipL" : "antTipR";
    tip.position.y = ANT_SEG;
    parent.add(tip);
    return pivot;
  };
  // Named per side rather than built in a mirrored loop — one loop statement
  // owns both sides, which makes them un-editable in the character editor.
  const antennaPivotL = makeAntenna(-1);
  g.add(antennaPivotL);
  const antennaPivotR = makeAntenna(1);
  g.add(antennaPivotR);

  // --- legs: three pairs, and the REAR pair is the character ----------------
  /**
   * One leg: a FAT femur lobe, a thin tibia, a thinner tarsus, a small foot.
   *
   * The fat/thin contrast is not decoration — it is what the detail-zone scan
   * corrected. Read at whole-image scale the reference's limbs look uniformly
   * thin; enlarged, the proximal segments are nearly as thick as they are long.
   * Uniformly thin legs read as a spider, not a flea.
   *
   * `rise` tilts the femur UP instead of down and `tiltBack` swings it toward
   * the tail; together they fold the hind limb into its Z and put the knee
   * ABOVE the body line, which is the whole jumping-leg read. `girth` keeps the
   * long rear femur from becoming a plank — at the front pair's thickness a
   * 2 HD femur reads as a rudder, not a limb.
   */
  const makeLeg = (
    tag: string,
    s: number,
    x: number,
    y: number,
    z: number,
    len: number,
    fanForward: number,
    rise: number,
    knee: number,
    girth = 1,
    tiltBack = 0,
    ankleBend = 0.45,
  ): THREE.Group => {
    const root = new THREE.Group();
    root.name = "leg" + tag + (s < 0 ? "L" : "R");
    root.position.set(x * s, y, z);
    // Outward and (usually) down. Same construction as the ladybug's nubs: a
    // +Y capsule rotated past 90° about Z points away from the body and below
    // the horizon. A NEGATIVE rise takes it back above the horizon instead.
    root.rotation.z = -(Math.PI / 2 + rise) * s;
    root.rotation.y = -fanForward * s;
    root.rotation.x = tiltBack;

    const femurLen = len * 0.42;
    const tibiaLen = len * 0.36;
    const tarsusLen = len * 0.22;

    const femurR = HD * 0.105 * girth;
    const tibiaR = HD * 0.042 * girth;
    const tarsusR = HD * 0.028 * girth;

    /**
     * A limb segment that actually SPANS its joint, plus half a radius of
     * overlap at each end.
     *
     * `CapsuleGeometry`'s length argument is the CYLINDER only — the two round
     * caps add `radius` on top — so a segment's true reach is `length + 2r`.
     * Each of these used to pass an arbitrary fraction of the joint distance
     * (0.72 / 0.82 / 0.80) and leave the caps to make up the rest, which holds
     * only while the radius is large relative to the segment. It is on the
     * front and middle legs. It is NOT on the HIND leg, which is more than
     * twice as long and, at `girth` 0.72, thinner as well: the femur fell
     * 0.0134 short of the knee and the tibia 0.0111 short of the ankle, so the
     * jumping leg — the one part of this model a player actually looks at —
     * rendered in three visibly disconnected pieces.
     *
     * Sizing from the real span makes the gap unrepresentable rather than
     * merely absent at the current numbers, so retuning a leg length or girth
     * cannot bring it back.
     */
    const boneGeo = (r: number, spanLen: number, capSeg: number): THREE.CapsuleGeometry =>
      new THREE.CapsuleGeometry(r, Math.max(spanLen - r, r * 0.2), capSeg, 8);

    const femur = new THREE.Mesh(boneGeo(femurR, femurLen, 3), darkMat);
    femur.name = "femur" + tag + (s < 0 ? "L" : "R");
    femur.position.y = femurLen * 0.5;
    root.add(femur);

    // The knee: everything below it hangs from this joint, so the fold is one
    // rotation rather than three hand-placed segments.
    const kneeJoint = new THREE.Group();
    kneeJoint.name = "knee" + tag + (s < 0 ? "L" : "R");
    kneeJoint.position.y = femurLen;
    kneeJoint.rotation.x = knee;
    root.add(kneeJoint);

    // A knuckle at each joint. Overlapping capsules close a gap along the
    // limb's axis but not ACROSS a sharp bend — the hind knee folds 2.3 rad
    // (132°), and two tangent capsules leave an open wedge on the outside of a
    // fold that steep. A ball sitting at the pivot fills it from any angle, and
    // it also bridges the step from the fat femur to the thin tibia, which the
    // reference draws as a visible joint rather than a smooth taper.
    const kneeBall = new THREE.Mesh(
      new THREE.SphereGeometry(Math.max(tibiaR * 1.35, femurR * 0.58), 10, 8),
      darkMat,
    );
    kneeBall.name = "kneeBall" + tag + (s < 0 ? "L" : "R");
    kneeJoint.add(kneeBall);

    const tibia = new THREE.Mesh(boneGeo(tibiaR, tibiaLen, 2), darkMat);
    tibia.name = "tibia" + tag + (s < 0 ? "L" : "R");
    tibia.position.y = tibiaLen * 0.5;
    kneeJoint.add(tibia);

    const ankle = new THREE.Group();
    ankle.name = "ankle" + tag + (s < 0 ? "L" : "R");
    ankle.position.y = tibiaLen;
    ankle.rotation.x = knee * ankleBend;
    kneeJoint.add(ankle);

    const ankleBall = new THREE.Mesh(
      new THREE.SphereGeometry(Math.max(tarsusR * 1.5, tibiaR * 1.05), 10, 8),
      darkMat,
    );
    ankleBall.name = "ankleBall" + tag + (s < 0 ? "L" : "R");
    ankle.add(ankleBall);

    const tarsus = new THREE.Mesh(boneGeo(tarsusR, tarsusLen, 2), darkMat);
    tarsus.name = "tarsus" + tag + (s < 0 ? "L" : "R");
    tarsus.position.y = tarsusLen * 0.5;
    ankle.add(tarsus);

    const foot = new THREE.Mesh(new THREE.SphereGeometry(HD * 0.048 * girth, 8, 6), darkMat);
    foot.name = "foot" + tag + (s < 0 ? "L" : "R");
    foot.scale.set(1.05, 0.75, 1.2);
    foot.position.y = tarsusLen;
    ankle.add(foot);

    return root;
  };

  // Front pair fans FORWARD, middle straight out, rear pair BACKWARD — the
  // middle leg is the pivot the other two swing around, which is what makes the
  // alternating tripod read.
  const legFL = makeLeg("F", -1, 0.100, 0.198, 0.100, HD * 0.86, 0.60, 0.86, 0.50);
  g.add(legFL);
  const legFR = makeLeg("F", 1, 0.100, 0.198, 0.100, HD * 0.86, 0.60, 0.86, 0.50);
  g.add(legFR);
  const legML = makeLeg("M", -1, 0.118, 0.184, -0.055, HD * 0.78, 0.0, 0.98, 0.55);
  g.add(legML);
  const legMR = makeLeg("M", 1, 0.118, 0.184, -0.055, HD * 0.78, 0.0, 0.98, 0.55);
  g.add(legMR);
  // THE JUMPING PAIR — identity rank 2, and the difference between reading as a
  // flea and reading as a grub. A NEGATIVE rise climbs the femur ABOVE the body
  // line, tiltBack swings it toward the tail, and the knee then folds hard so
  // the tibia drops back to the floor. The triangle of negative space between
  // that femur and the abdomen is the clearest jumping-leg cue in profile —
  // it is the thing to protect if these numbers are ever retuned.
  //
  // Length is 2.0 HD, not the 2.6 measured off the reference: 2.6 is the leg
  // EXTENDED, and this one is folded. At 2.6 the femur alone reached past the
  // tail and read as a rudder rather than a limb. `girth` 0.72 is the other
  // half of that fix.
  const legBL = makeLeg("B", -1, 0.118, 0.205, -0.200, HD * 2.0, 0, -1.12, -2.5, 0.72, -0.95, 0.14);
  g.add(legBL);
  const legBR = makeLeg("B", 1, 0.118, 0.205, -0.200, HD * 2.0, 0, -1.12, -2.5, 0.72, -0.95, 0.14);
  g.add(legBR);
  const legs = [legFL, legFR, legML, legMR, legBL, legBR];

  // --- eyes ----------------------------------------------------------------
  // Same protruding build as the beetle, bee and ladybug — a white ball with
  // the iris, pupil and glint as flush caps on it. The one divergence is the
  // IRIS COLOUR: this skin takes the reference's amber rather than the house
  // blue. It is the reference's own value, and it keeps a fifth insect from
  // looking like a recolour of the other four.
  const scleraMat = toon({ color: 0xfdf9f2 });
  const irisMat = toon({ color: 0xe8a317 });
  const pupM = toon({ color: 0x0a0c12 });
  const glintMat = toon({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.5 });
  const fleaEyeMats = [scleraMat, irisMat, pupM, glintMat];

  // Oversized on purpose: 0.34 of head width, measured off the reference. The
  // mascot read depends entirely on them.
  const EYE_R = HD * 0.17;
  const EYE_FWD = Math.PI / 2;
  const EYE_TILT = -0.1;
  const eyeCap = (
    factor: number,
    rx: number,
    ry: number,
    thetaLen: number,
    mat: THREE.MeshToonMaterial,
  ): THREE.Mesh => {
    const geo = new THREE.SphereGeometry(EYE_R * factor, 18, 12, 0, Math.PI * 2, 0, thetaLen);
    geo.rotateX(rx);
    geo.rotateY(ry);
    return new THREE.Mesh(geo, mat);
  };

  const eyes: THREE.Object3D[] = [];
  const pupPivots: THREE.Object3D[] = [];

  const makeEye = (s: number): { ball: THREE.Mesh; pivot: THREE.Group } => {
    const centre = new THREE.Vector3(0.081 * s, HEAD_POS.y + HR * 0.10, HEAD_POS.z + HR * 0.70);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(EYE_R, 18, 14), scleraMat);
    ball.name = s < 0 ? "eyeL" : "eyeR";
    ball.position.copy(centre);

    const pivot = new THREE.Group();
    pivot.name = s < 0 ? "pupilPivotL" : "pupilPivotR";
    pivot.position.copy(centre);

    const iris = eyeCap(1.012, EYE_FWD, EYE_TILT * s, 0.74, irisMat);
    iris.name = s < 0 ? "irisL" : "irisR";
    pivot.add(iris);

    const pupil = eyeCap(1.03, EYE_FWD, EYE_TILT * s, 0.38, pupM);
    pupil.name = s < 0 ? "pupilL" : "pupilR";
    pivot.add(pupil);

    const glint = eyeCap(1.05, EYE_FWD - 0.27, (EYE_TILT + 0.27) * s, 0.13, glintMat);
    glint.name = s < 0 ? "glintL" : "glintR";
    pivot.add(glint);

    eyes.push(ball, iris, pupil, glint);
    pupPivots.push(pivot);
    return { ball, pivot };
  };

  const eyeLeft = makeEye(-1);
  g.add(eyeLeft.ball, eyeLeft.pivot);
  const eyeRight = makeEye(1);
  g.add(eyeRight.ball, eyeRight.pivot);

  g.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });

  const userData: GhostUserData = {
    bodyMat,
    // The dark cuticle is on the limbs, antennae, belly and face marks — a
    // large enough share of the silhouette that leaving it un-recoloured would
    // blunt the "edible now" read, which is the same call the ladybug made.
    accentMats: [darkMat],
    eyes,
    pupPivots,
    pupM,
    pupBaseColor: pupM.color.getHex(),
    baseColor: color,
    // Band tiles are flush decals on the body, not wobbling blobs, so there is
    // no hem — and no `skirt`, so this character opts out of the shared
    // breathe. Its idle is the hop, scuttle and antenna twitch below.
    hem: [],
    pupOffset: { x: 0, z: 0 },
    behaviour: fleaBehaviour(legs, [legBL, legBR], [antennaPivotL, antennaPivotR], g),
    eyeMats: fleaEyeMats,
    spiritMats: collectSpiritMats(g, fleaEyeMats),
  };
  g.userData = userData;
  return g;
}

// ---------------------------------------------------------------------------
// THE CRAB (IDEA-054) — the third img2threejs rebuild.
//
// Built from the numbers `.img2threejs/crab/object-sculpt-spec.json` locked off
// the reference, following IDEA-047's split exactly: the pipeline's generated
// factory sits unused in `src/render/rework/createCrabModel.ts` and the SHIPPED
// mesh is hand-authored here, because only a hand-authored mesh can satisfy the
// `GhostUserData` contract — team-coloured bodyMat, accentMats following the
// frightened recolour, eyes surviving the eaten state, rotated pupil pivots.
//
// The fixed accents. The team colour goes on the carapace DOME; everything
// below keeps its own hue, and which of them follow the frightened recolour is
// a decision recorded per material in makeCrab and in
// `.img2threejs/crab/evidence/material-evidence.md`.
const CRAB_FACE = 0xffb347; // golden lower face — the measured #FFC756/#FF9444 read
const CRAB_APRON = 0xf7d9ac; // pale ventral apron, the only large LIGHT area
const CRAB_LIMB = 0xe8492e; // limb cuticle, more saturated and redder than the shell
const CRAB_CLAW = 0xf7be55; // chela horn, a full value step lighter than the arm
// Mouth groove and inter-plate limb creases. Separate from every other accent
// because it must NOT follow the frightened recolour — see makeCrab.
const CRAB_CREASE = 0x7e2a14;
const CRAB_BROW = 0x3a1410; // near-black with a red-maroon cast, never neutral

const CB_SCUTTLE_FREQ = 14; // rad/s — between the ladybug's 16 and the flea's 15
const CB_SCUTTLE_SWING = 0.24;
const CB_SCUTTLE_LAG = 0.7; // radians each pair lags the one in front of it
/** Lateral roll while moving. A crab walks sideways; the model still FACES its
 *  travel direction like every other enemy (syncToEntity owns that), so the
 *  sideways read has to come from the idle rather than from the facing. */
const CB_SWAY_FREQ = 7;
const CB_SWAY_ROLL = 0.055; // radians
const CB_SWAY_SHIFT = 0.012; // world units
const CB_ARM_SWING = 0.12;
const CB_CLAW_FREQ = 2.3; // pincer snap — slow, so it reads as a threat, not a flutter
const CB_CLAW_OPEN = 0.34;
const CB_STALK_FREQ = 1.6;
const CB_STALK_WAG = 0.15;

/**
 * The crab's own motion: an eight-leg scuttle wave, a lateral body sway, an arm
 * swing, a pincer snap and an eyestalk waggle.
 *
 * `sway` is an INNER group, never the model root. applyGhostState adds a
 * frightened shiver to the root's position every frame and syncToEntity writes
 * that position from entityWorld — a sway written there would be overwritten by
 * one and would fight the other.
 *
 * The legs need no per-side sign. Rotating a hip about +Y swings a leg that
 * points -X toward +Z and a leg that points +X toward -Z, so ONE wave already
 * moves the left side forward while the right side goes back. Adding a side
 * sign would cancel exactly the alternation it looks like it is creating.
 */
function crabBehaviour(
  legs: THREE.Object3D[],
  arms: THREE.Object3D[],
  dactyls: THREE.Object3D[],
  stalks: THREE.Object3D[],
  sway: THREE.Object3D,
): EnemyBehaviour {
  const legRest = legs.map((l) => l.rotation.y);
  const armRest = arms.map((a) => a.rotation.y);
  const dactylRest = dactyls.map((d) => d.rotation.x);
  const stalkRest = stalks.map((s) => s.rotation.x);
  return {
    animate: (t, idleT, moveBlend) => {
      // Legs arrive in build order (1L, 1R, 2L, 2R, …). `i >> 1` is the PAIR
      // index, so each side's fan ripples front to back: a fan of four reads as
      // a wave, which two alternating tripods would flatten into a shuffle.
      for (let i = 0; i < legs.length; i++) {
        const wave = Math.sin(t * CB_SCUTTLE_FREQ - (i >> 1) * CB_SCUTTLE_LAG);
        legs[i].rotation.y = legRest[i] + wave * CB_SCUTTLE_SWING * moveBlend;
      }
      // The sideways sway: a roll about the ground contact plus a small lateral
      // shift, driven by ONE cycle so the two can never drift apart. It rides
      // the walk clock, so a crab standing in the pen stands still.
      const s = Math.sin(t * CB_SWAY_FREQ) * moveBlend;
      sway.rotation.z = s * CB_SWAY_ROLL;
      sway.position.x = s * CB_SWAY_SHIFT;
      for (let i = 0; i < arms.length; i++) {
        arms[i].rotation.y = armRest[i] - s * CB_ARM_SWING;
      }
      // The pincers work off the FREE-RUNNING clock, so a crab that is not
      // moving is still visibly a crab.
      const open = (Math.sin(idleT * CB_CLAW_FREQ) * 0.5 + 0.5) * CB_CLAW_OPEN;
      for (let i = 0; i < dactyls.length; i++) dactyls[i].rotation.x = dactylRest[i] - open;
      for (let i = 0; i < stalks.length; i++) {
        stalks[i].rotation.x = stalkRest[i] + Math.sin(idleT * CB_STALK_FREQ + i * 1.9) * CB_STALK_WAG;
      }
    },
  };
}

/**
 * THE CRAB — a sixth enemy skin, and the third img2threejs rebuild.
 *
 * PROPORTION BASE: CW = CARAPACE WIDTH, not a head diameter. A crab's head is
 * fused into its carapace, so a "head height" would be an invented boundary and
 * every ratio derived from it would inherit the invention. CW = 0.56 is chosen
 * against the measured cast (scripts/_scratch-enemy-cast.ts): it puts the model
 * at ~0.86 wide — just past the ladybug's 0.849, so the crab is the WIDEST
 * enemy in the game — while the crown stays ~0.70, mid-band between the ghost's
 * 0.66 and the bee's 0.80.
 *
 * BEING THE WIDEST IS THE IDENTITY. The game already ships a beetle, a bee, a
 * ladybug and a flea, every one of them taller than it is wide or roughly
 * square. A tall crab joins that cluster and the skin has no reason to exist —
 * the risk the flea's spec recorded first and then hit twice.
 *
 * Two features carry the read at gameplay size, in order:
 *   1. THE OPEN PINCER GAPS. Two of them, and they are the largest pieces of
 *      negative space in the model. A claw that closes into a blob is a generic
 *      red arthropod.
 *   2. THE WIDE, LOW CARAPACE, with the eyes breaking its top outline.
 * Everything else — tubercles, crease lines, the cyan iris ring — is texture at
 * that size and is the first thing to trade if the budget ever bites.
 */
export function makeCrab(color: number): THREE.Group {
  const g = new THREE.Group();
  // Everything hangs off an inner group so the lateral sway is LOCAL. See
  // crabBehaviour: the root's position belongs to syncToEntity and
  // applyGhostState, and a sway written there is overwritten or fought.
  const body = new THREE.Group();
  body.name = "crabBody";
  g.add(body);

  const CW = 0.56;

  // --- materials -----------------------------------------------------------
  // The carapace DOME carries the team colour: it is the single largest surface,
  // and the three team colours are how a player tells four enemies apart.
  const bodyMat = toon({ color, emissive: color, emissiveIntensity: 0.12 });
  const faceMat = toon({ color: CRAB_FACE });
  faceMat.userData.baseColor = CRAB_FACE;
  const limbMat = toon({ color: CRAB_LIMB });
  limbMat.userData.baseColor = CRAB_LIMB;
  const clawMat = toon({ color: CRAB_CLAW });
  clawMat.userData.baseColor = CRAB_CLAW;
  // The apron is deliberately NOT an accent. It is the only large light area in
  // the model, and it is what keeps the face legible once the body turns
  // frightened blue — a cream chin under a blue shell still reads as a face; an
  // all-blue front does not.
  const apronMat = toon({ color: CRAB_APRON });
  apronMat.userData.baseColor = CRAB_APRON;
  // The crease ink gets its OWN material, kept OUT of accentMats. This is the
  // flea's band-crease defect written down: a crease colour that follows the
  // frightened recolour paints detail and body the same blue, and the feature it
  // exists to draw vanishes in the one state where the player is chasing the
  // enemy. It was invisible in normal colour — only the map-stripped clay render
  // (/preview-rework/?model=crab&flat=1) showed it.
  //
  // It draws the leg-plate creases and nothing else now that the mouth is gone.
  // Still its own material rather than folded into limbMat, for exactly the
  // reason above — limbMat IS in accentMats.
  const creaseMat = toon({ color: CRAB_CREASE });
  creaseMat.userData.baseColor = CRAB_CREASE;
  // Two small dark lozenges that carry the whole face read. Same rule as the
  // creases: a small fixed accent keeps its own colour.
  const browMat = toon({ color: CRAB_BROW });
  browMat.userData.baseColor = CRAB_BROW;

  // --- carapace ------------------------------------------------------------
  // A LATERALLY STRETCHED oblate ellipsoid: 0.560 wide, 0.320 tall, 0.404 deep.
  // The measured width:height is 1.00:0.57 — never a sphere.
  //
  // Built as a unit sphere and SCALED, so every panel below can share the exact
  // same scale and position and therefore sit flush on the curve at any radius
  // factor instead of having to be fitted. The ladybug's shell-decal
  // construction, and the flea's segment bands.
  const CAR_POS = new THREE.Vector3(0, CW * 0.5911, -CW * 0.0179);
  const CAR_SCALE = new THREE.Vector3(CW * 0.5, CW * 0.2857, CW * 0.3607);
  const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 30, 18), bodyMat);
  shell.name = "carapace";
  shell.scale.copy(CAR_SCALE);
  shell.position.copy(CAR_POS);
  body.add(shell);

  /**
   * A surface-conformal patch on the carapace.
   *
   * The geometry is rotated so its pole points along +Z (the model's forward),
   * which makes `theta` an angle out from the FACE CENTRE and `phi` the sweep
   * around it: phi 0..PI is the LOWER half of the face, phi 0 is toward -X and
   * phi PI/2 is straight down.
   *
   * A constant-theta ring maps to an ELLIPSE on the scaled ellipsoid, which is
   * why every band here is guaranteed flush at every point where a flat torus
   * arc laid on the same face would sink into it in the middle and stand off it
   * at the ends — the surface falls 0.0157 across the width of the face alone.
   */
  const shellPatch = (
    factor: number,
    phiStart: number,
    phiLen: number,
    thetaStart: number,
    thetaLen: number,
    mat: THREE.MeshToonMaterial,
    wSeg: number,
    hSeg: number,
    poleTilt = 0,
  ): THREE.Mesh => {
    const geo = new THREE.SphereGeometry(factor, wSeg, hSeg, phiStart, phiLen, thetaStart, thetaLen);
    geo.rotateX(Math.PI / 2 + poleTilt);
    const m = new THREE.Mesh(geo, mat);
    m.scale.copy(CAR_SCALE);
    m.position.copy(CAR_POS);
    return m;
  };

  // THE GOLD FACE. The reference's crown-to-face gradient runs #FA5444 ->
  // #FFC756 and is measured, but a MeshToonMaterial quantises a gradient into
  // the shared 3-step ramp anyway — so it bands regardless, and an authored
  // surface puts the band where it belongs rather than wherever the ramp lands it.
  //
  // The patch's POLE IS TILTED DOWN-AND-FORWARD (0.75 rad) rather than aimed
  // straight ahead, and it is cut WIDE ENOUGH TO REACH THE SILHOUETTE (theta
  // 1.35 puts its lateral edge at x 0.273 of a 0.280 half-width). Both matter,
  // and each fixed a different version of the same defect: aimed ahead the cap
  // rendered as an oval PATCH stuck on the front, and cut short it rendered as a
  // closed oval floating inside the shell's outline. Neither read as the shell's
  // own colour. Tilted and cut to the edge, the boundary is a LINE across the
  // shell — from y 0.421 at the face centre down to y 0.307 at the flanks —
  // which is what the reference shows.
  const face = shellPatch(1.006, 0, Math.PI * 2, 0, 1.34, faceMat, 30, 14, 0.75);
  face.name = "facePanel";
  body.add(face);

  // THE ROLLED FRONT LIP. A narrow band standing 0.02 proud, straddling the
  // gold/red boundary at the shell's outer margin. It is shell-coloured, not
  // gold: the reference's rim is the carapace's own edge turning under, and a
  // gold rim would read as a second colour zone instead of as thickness.
  // Without it the dome is shrink-wrapped — the shell has no edge, and at the
  // review camera the boundary between crown and face reads as paint rather
  // than as the lip of a shell.
  const lip = shellPatch(1.02, 0, Math.PI * 2, 1.3, 0.09, bodyMat, 30, 2, 0.75);
  lip.name = "carapaceLip";
  body.add(lip);

  // The ventral apron: the same construction, tilted further down and cut
  // shorter. Its lower edge lands at y 0.1715 against a measured chin bottom of
  // 0.171 — that falls out of the tilt rather than being placed by hand. Its top
  // edge is now the only thing dividing the gold face from the cream chin, since
  // the mouth groove that used to sit on that boundary is gone.
  const apron = shellPatch(1.012, 0, Math.PI * 2, 0, 0.66, apronMat, 26, 10, 1.06);
  apron.name = "chinApron";
  body.add(apron);

  // NO MOUTH. The reference draws a smiling groove and the first build had one
  // — a narrow constant-theta ring at theta 0.40, phi 0.304..2.838, which
  // reproduced the measurement almost exactly (0.208 wide against a measured
  // 0.212, with a 0.0436 corner rise against a measured 0.0437). Nuno cut it:
  // the crab reads better without one. Recorded here rather than deleted
  // silently, because it is a DECISION and not an oversight, and because the
  // measurement is what a future build would need to put it back.
  //
  // The face still reads: the eyes and the brow lozenges carry it, which is what
  // they were ranked on in the first place. The gold/cream boundary the mouth
  // used to sit on is still there — it is the apron's own edge.
  //
  // And it turns out to be the CONSISTENT choice rather than only a taste one:
  // no other enemy in this game has a mouth mesh. The ghost, beetle, bee,
  // ladybug and flea all put their whole expression in the eyes (makeGhost says
  // so in as many words: "no mouth at all. Everything expressive lives in the
  // eyes"). The crab was the only one that broke that, and now it does not.

  // --- carapace tubercles --------------------------------------------------
  // Fifteen raised bosses: seven mirrored pairs plus one on the dorsal midline,
  // hand-placed rather than seeded. A random scatter clumps, and this model is
  // bilaterally symmetric everywhere else.
  //
  // Placed in spherical coordinates about the shell's own +Y, then pushed onto
  // the SCALED surface, so each shares the dome's tangent — a boss raised out of
  // the shell rather than a bead resting on it. Lowest-ranked identity feature
  // in the spec, and the first thing to drop if the budget bites.
  const TUBERCLES: [number, number][] = [
    [0.32, 0.35],
    [0.5, -0.4],
    [0.55, 0.9],
    [0.78, 0.12],
    [0.86, -0.85],
    [1.05, 0.58],
    [0.42, -1.2],
    [0.68, 1.25],
    [1.12, -0.35],
  ];
  const TUB_R = CW * 0.027;
  const tubercle = (el: number, az: number, i: number): void => {
    const n = new THREE.Vector3(
      Math.sin(el) * Math.cos(az),
      Math.cos(el),
      Math.sin(el) * Math.sin(az),
    );
    const m = new THREE.Mesh(new THREE.SphereGeometry(TUB_R, 9, 7), bodyMat);
    m.name = `tubercle${i}`;
    m.position.copy(n).multiply(CAR_SCALE).multiplyScalar(0.985).add(CAR_POS);
    body.add(m);
  };
  for (let i = 0; i < TUBERCLES.length; i++) {
    const [el, az] = TUBERCLES[i];
    tubercle(el, az, i * 2);
    tubercle(el, Math.PI - az, i * 2 + 1);
  }
  tubercle(0.5, -Math.PI / 2, 18);

  // --- eyes ----------------------------------------------------------------
  // Diameter 0.326 of the body width — an eye nearly a third as wide as the
  // whole animal, which is the measured read and not a stylistic choice. They
  // sit 0.097 ABOVE the shell top so they BREAK its outline: that is the
  // stalked-eye read, and it is identity rank 3.
  const EYE_R = CW * 0.1634;
  const EYE_X = CW * 0.2286;
  const EYE_Y = CW * 1.02;
  const EYE_Z = CW * 0.134;
  const STALK_Y = CW * 0.78;
  const scleraMat = toon({ color: 0xf7f1ea });
  const irisMat = toon({ color: 0x22c6ee });
  const pupM = toon({ color: 0x1b2450 });
  // The catchlight. The beagle gets a true MeshBasicMaterial for this; an enemy
  // cannot, because GhostUserData.eyeMats is typed MeshToonMaterial and those
  // are the materials kept SOLID through the eaten state. A fully emissive toon
  // is the enemy cast's standing answer and it reads the same at this size.
  const glintMat = toon({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.5 });
  const crabEyeMats = [scleraMat, irisMat, pupM, glintMat];

  const eyeCap = (
    factor: number,
    rx: number,
    ry: number,
    thetaLen: number,
    mat: THREE.MeshToonMaterial,
    wSeg: number,
  ): THREE.Mesh => {
    const geo = new THREE.SphereGeometry(EYE_R * factor, wSeg, 10, 0, Math.PI * 2, 0, thetaLen);
    geo.rotateX(rx);
    geo.rotateY(ry);
    return new THREE.Mesh(geo, mat);
  };

  const eyes: THREE.Object3D[] = [];
  const pupPivots: THREE.Object3D[] = [];

  /**
   * One eye on its stalk. `s` is -1 for the model's LEFT.
   *
   * NOTE ON SIDES: the spec's anatomical rule puts the character's own left at
   * POSITIVE x, but every enemy skin already in this file labels its NEGATIVE-x
   * side "L". The subject is symmetric, so nothing renders differently either
   * way; this follows the file, so the editor and the tests see one convention.
   *
   * The iris is set MEDIALLY off-centre — measured: a ball centre at x 205
   * against an iris centre at x 212 — so both eyes converge slightly on the
   * viewer. It is a small thing, and it is the difference between a face that
   * looks at you and two beads pointing outward.
   */
  const MEDIAL = 0.14;
  const makeEye = (s: number): THREE.Group => {
    const side = s < 0 ? "L" : "R";
    // The stalk pivot sits at the SOCKET, sunk into the shell. Pivoting at the
    // centre would swing the stalk through the carapace; starting it above the
    // surface would open a gap at the join the moment it waggles.
    const stalk = new THREE.Group();
    stalk.name = "eyestalk" + side;
    stalk.position.set(EYE_X * s, STALK_Y, EYE_Z * 0.83);
    body.add(stalk);

    // Short and NARROW. The first build gave it EYE_R * 0.5..0.62 of radius over
    // CW * 0.16 of length, and against the reference — where the collar swallows
    // the join and the ball sits almost directly on the shell — it read as a red
    // NECK holding the eye up rather than as a stalk.
    const column = new THREE.Mesh(
      new THREE.CylinderGeometry(EYE_R * 0.38, EYE_R * 0.5, CW * 0.13, 12),
      limbMat,
    );
    column.name = "eyestalkColumn" + side;
    column.position.y = CW * 0.055;
    stalk.add(column);

    // The ball is positioned in the STALK's frame, so the waggle carries the
    // whole eye — collar, iris, catchlight and brow — with it.
    const centre = new THREE.Vector3(0, EYE_Y - STALK_Y, EYE_Z - EYE_Z * 0.83);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(EYE_R, 20, 14), scleraMat);
    ball.name = "eye" + side;
    ball.position.copy(centre);
    stalk.add(ball);

    // THE COLLAR: a sheath hood over the ball's rear, top and OUTER side. It is
    // measured asymmetric — 24 px of sclera arc laterally against 10 px medially
    // — so its axis is tilted outward rather than sitting square. A symmetric
    // collar loses the hooded-outer-lid read entirely.
    const collarGeo = new THREE.SphereGeometry(EYE_R * 1.07, 20, 12, 0, Math.PI * 2, 0, 1.62);
    collarGeo.rotateX(Math.PI / 2);
    const collar = new THREE.Mesh(collarGeo, limbMat);
    collar.name = "eyeCollar" + side;
    collar.position.copy(centre);
    collar.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0.45 * s, 0.25, -0.86).normalize(),
    );
    stalk.add(collar);

    const pivot = new THREE.Group();
    pivot.name = s < 0 ? "pupilPivotL" : "pupilPivotR";
    pivot.position.copy(centre);
    stalk.add(pivot);

    const iris = eyeCap(1.012, Math.PI / 2, -MEDIAL * s, 0.54, irisMat, 20);
    iris.name = "iris" + side;
    pivot.add(iris);

    // The pupil covers most of the iris disc: measured at y=130 the reference's
    // whole 56 px disc reads dark, and the cyan only appears as a lower crescent.
    // A thick cyan ring round a small pupil (the first build) is a different eye.
    const pupil = eyeCap(1.03, Math.PI / 2, -MEDIAL * s, 0.42, pupM, 18);
    pupil.name = "pupil" + side;
    pivot.add(pupil);

    // Upper-OUTER quadrant: this one yaws AWAY from the midline, unlike the iris.
    const glint = eyeCap(1.05, Math.PI / 2 - 0.3, (MEDIAL + 0.3) * s, 0.13, glintMat, 12);
    glint.name = "glint" + side;
    pivot.add(glint);

    // THE BROW. Geometry, not a marking: 49x20 px measured, aspect 2.45, and it
    // carries its own silhouette against the sky above the eye. Without them the
    // eyes read as two beads and the face stops being a face.
    const brow = new THREE.Mesh(new THREE.CapsuleGeometry(CW * 0.0268, CW * 0.0884, 4, 10), browMat);
    brow.name = "brow" + side;
    brow.rotation.z = Math.PI / 2 + 0.16 * s;
    brow.rotation.x = -0.2;
    brow.scale.set(1, 1, 1.15);
    brow.position.set(0, centre.y + EYE_R * 1.01, centre.z - EYE_R * 0.19);
    stalk.add(brow);

    eyes.push(ball, iris, pupil, glint);
    pupPivots.push(pivot);
    return stalk;
  };

  // Named per side rather than built in a mirrored loop — one loop statement
  // owning both sides makes them un-editable in the character editor.
  const eyestalkL = makeEye(-1);
  const eyestalkR = makeEye(1);

  // --- limb construction ---------------------------------------------------
  const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
  const UP = new THREE.Vector3(0, 1, 0);

  /**
   * A tapered limb segment spanning EXACTLY from `a` to `b`, with a knuckle ball
   * dropped at every joint.
   *
   * This is the flea's hind-leg defect made unrepresentable rather than merely
   * absent. `CapsuleGeometry`'s length argument is the CYLINDER only — the two
   * round caps add `radius` on top — so a segment sized as a FRACTION of its
   * joint distance leaves daylight the moment the radius stops being large
   * relative to the segment. A cylinder of the exact span plus a ball AT the
   * joint cannot: the ball covers the joint from every angle, including ACROSS a
   * fold, where two tangent solids leave an open wedge that overlap alone never
   * fills. This crab folds at twenty joints, so it is built this way from the
   * start instead of being measured and patched afterwards.
   */
  const bone = (
    name: string,
    parent: THREE.Object3D,
    a: THREE.Vector3,
    b: THREE.Vector3,
    r0: number,
    r1: number,
    mat: THREE.MeshToonMaterial,
    seg = 10,
  ): void => {
    const len = a.distanceTo(b);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, len, seg, 1), mat);
    m.name = name;
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
    parent.add(m);
  };

  const knuckle = (
    name: string,
    parent: THREE.Object3D,
    at: THREE.Vector3,
    r: number,
    mat: THREE.MeshToonMaterial,
  ): void => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), mat);
    m.name = name;
    m.position.copy(at);
    parent.add(m);
  };

  // --- walking legs: four pairs, fanned ------------------------------------
  // FOUR pairs, not three: three a side is an insect, and this game already has
  // three of those. The fan runs lateral-high to medial-low — the frontmost leg
  // reaches furthest out, the rearmost least — which is what makes the count
  // readable as a fan rather than a skirt.
  //
  // All four reach the FLOOR. In the reference the tips descend medially because
  // the animal is drawn hanging in frame with nothing under it; this one stands.
  const LEG_Z = [0.1, 0.0, -0.1, -0.19];
  const LEG_F = [1.0, 0.96, 0.87, 0.75];
  const legs: THREE.Group[] = [];

  const makeLeg = (n: number, s: number): THREE.Group => {
    const side = s < 0 ? "L" : "R";
    const zi = LEG_Z[n];
    const f = LEG_F[n];
    const hip = V(CW * 0.4464 * s, CW * 0.4857, zi);
    const knee = V(CW * 0.6464 * f * s, CW * 0.2821, zi * 1.15);
    const ankle = V(CW * 0.7232 * f * s, CW * 0.1036, zi * 1.25);
    const tip = V(CW * 0.7357 * f * s, CW * 0.0179, zi * 1.32);

    const root = new THREE.Group();
    root.name = `leg${n + 1}${side}`;
    root.position.copy(hip);
    body.add(root);

    const kneeL = knee.clone().sub(hip);
    const ankleL = ankle.clone().sub(knee);
    const tipL = tip.clone().sub(ankle);

    const rMerus = CW * 0.0821;
    const rProp = CW * 0.0643;
    const rDact = CW * 0.0411;

    knuckle(`legHip${n + 1}${side}`, root, V(0, 0, 0), rMerus * 1.02, limbMat);
    bone(`legMerus${n + 1}${side}`, root, V(0, 0, 0), kneeL, rMerus, rProp, limbMat);

    // A dark band where each plate meets the next. At gameplay size the step
    // itself is too shallow to shade; the line is what keeps the leg COUNT
    // legible, and the count is the part of the fan that carries identity.
    const creaseRing = new THREE.Mesh(
      new THREE.CylinderGeometry(rMerus * 0.96, rMerus * 0.96, CW * 0.012, 10, 1),
      creaseMat,
    );
    creaseRing.name = `legCrease${n + 1}${side}`;
    creaseRing.position.copy(kneeL.clone().multiplyScalar(0.34));
    creaseRing.quaternion.setFromUnitVectors(UP, kneeL.clone().normalize());
    root.add(creaseRing);

    const kneeJoint = new THREE.Group();
    kneeJoint.name = `legKnee${n + 1}${side}`;
    kneeJoint.position.copy(kneeL);
    root.add(kneeJoint);
    knuckle(`legKneeBall${n + 1}${side}`, kneeJoint, V(0, 0, 0), rProp * 1.15, limbMat);
    bone(`legPropodus${n + 1}${side}`, kneeJoint, V(0, 0, 0), ankleL, rProp, rDact, limbMat, 9);

    const ankleJoint = new THREE.Group();
    ankleJoint.name = `legAnkle${n + 1}${side}`;
    ankleJoint.position.copy(ankleL);
    kneeJoint.add(ankleJoint);
    knuckle(`legAnkleBall${n + 1}${side}`, ankleJoint, V(0, 0, 0), rDact * 1.1, limbMat);
    // POINTED, and no ball at the tip — deliberately in contrast to the blunt,
    // rounded pincer fingers. Reading the claw AS a claw depends partly on the
    // walking legs not ending the same way.
    bone(`legDactyl${n + 1}${side}`, ankleJoint, V(0, 0, 0), tipL, rDact, CW * 0.009, limbMat, 8);

    return root;
  };

  for (let n = 0; n < 4; n++) {
    legs.push(makeLeg(n, -1));
    legs.push(makeLeg(n, 1));
  }

  // --- chelipeds: the claws ------------------------------------------------
  // IDENTITY RANK 1, and it is the GAP that matters, not the claw mass. The
  // fingers are sized from readability at the game camera — where the whole
  // enemy is a few dozen pixels — rather than scaled from the reference, and
  // they are held forward and slightly RAISED instead of at the reference's
  // ground level, so the raised 3/4 chase camera looks INTO the gap rather than
  // at the claw's own back.
  //
  // The two fingers are deliberately UNEQUAL: the fixed lower finger (pollex) is
  // longer than the movable upper one (dactyl). Two equal fingers read as a
  // clothes peg.
  const dactyls: THREE.Group[] = [];

  const makeCheliped = (s: number): THREE.Group => {
    const side = s < 0 ? "L" : "R";
    const socket = V(CW * 0.4268 * s, CW * 0.6429, CW * 0.0536);
    const elbow = V(CW * 0.5714 * s, CW * 0.5893, CW * 0.2054);
    const wrist = V(CW * 0.5089 * s, CW * 0.5179, CW * 0.3304);
    const palmC = V(CW * 0.4821 * s, CW * 0.3839, CW * 0.4375);
    // THE PINCER, and it is aimed as much as it is sized. The fingers sweep DOWN
    // AND INWARD from a chunky palm, so the gap between them opens ACROSS the
    // viewer's line of sight. Aiming them forward instead (the second build) put
    // the upper finger directly in front of the lower one at the review camera
    // and the gap vanished into its own foreshortening — the claws read as two
    // mittens.
    //
    // The gap is 0.1097 tip to tip against radii summing 0.038, so 0.072 of clear
    // daylight. That is WIDER than the reference's measured ~32deg on purpose:
    // it is sized from readability at the game camera, where the whole enemy is
    // a few dozen pixels, and the first build — which did scale the reference
    // angle honestly — closed into a solid gold wedge at exactly that size.
    //
    // They also hang DOWN as well as inward. Swung purely inward (the third
    // build) each claw read as a flat flipper laid across the body; the
    // reference's claws are chunky masses held low, with the fingers dropping
    // away from a palm that stays the biggest part of the shape.
    //
    // And they are held CLOSE to the body plane — the palm sits 0.155 in front
    // of the shell, not 0.4. Thrown further forward they sat much nearer the
    // review camera than the shell did, and perspective inflated them into two
    // enormous mitts that dominated the frame: the reference-matched Tier 1
    // capture measured a silhouette aspect of 1.126 against the reference's
    // 1.231, i.e. the model read as TALLER than the reference for a reason that
    // was entirely about claw depth.
    const pollexA = V(CW * 0.4732 * s, CW * 0.2946, CW * 0.5268);
    const pollexB = V(CW * 0.3304 * s, CW * 0.1071, CW * 0.5893);
    const dactA = V(CW * 0.4196 * s, CW * 0.3571, CW * 0.5357);
    const dactB = V(CW * 0.25 * s, CW * 0.2857, CW * 0.5893);

    const root = new THREE.Group();
    root.name = "cheliped" + side;
    root.position.copy(socket);
    body.add(root);

    const rMerus = CW * 0.1036;
    const rElbow = CW * 0.0857;
    const rWrist = CW * 0.0929;

    knuckle("chelipedShoulder" + side, root, V(0, 0, 0), rMerus * 1.02, limbMat);
    bone("chelipedMerus" + side, root, V(0, 0, 0), elbow.clone().sub(socket), rMerus, rElbow, limbMat, 12);

    const elbowJoint = new THREE.Group();
    elbowJoint.name = "chelipedElbow" + side;
    elbowJoint.position.copy(elbow.clone().sub(socket));
    root.add(elbowJoint);
    knuckle("chelipedElbowBall" + side, elbowJoint, V(0, 0, 0), rElbow * 1.08, limbMat);
    bone("chelipedCarpus" + side, elbowJoint, V(0, 0, 0), wrist.clone().sub(elbow), rElbow, rWrist, limbMat, 12);

    const wristJoint = new THREE.Group();
    wristJoint.name = "chelipedWrist" + side;
    wristJoint.position.copy(wrist.clone().sub(elbow));
    elbowJoint.add(wristJoint);
    knuckle("chelipedWristBall" + side, wristJoint, V(0, 0, 0), rWrist * 1.06, limbMat);

    // The palm — a full value step lighter than the red arm carrying it. The
    // gold-against-red is what makes the claw read as a different substance.
    const palm = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 14), clawMat);
    palm.name = "chelaPalm" + side;
    palm.scale.set(CW * 0.1607, CW * 0.1696, CW * 0.1964);
    palm.position.copy(palmC.clone().sub(wrist));
    // Yawed hard INWARD so the palm's long axis runs along the fingers rather
    // than down the model's +Z. Pointed forward, the two claws read as a pair of
    // beaks aimed at the camera; swept inward they read as pincers held across
    // the front of the body, which is both the reference's pose and the one that
    // keeps the gap visible.
    palm.rotation.y = -0.5 * s;
    palm.rotation.x = -0.25;
    wristJoint.add(palm);

    // The FIXED finger: lower, and the longer of the two. Rounded tip.
    const pA = pollexA.clone().sub(wrist);
    const pB = pollexB.clone().sub(wrist);
    bone("chelaPollex" + side, wristJoint, pA, pB, CW * 0.0893, CW * 0.0304, clawMat, 12);
    knuckle("chelaPollexTip" + side, wristJoint, pB, CW * 0.0304, clawMat);

    // The MOVABLE finger, on a real hinge at the palm. It is the one joint that
    // visibly articulates in the reference, and it is what opens the gap.
    const hinge = new THREE.Group();
    hinge.name = "chelaDactyl" + side;
    hinge.position.copy(dactA.clone().sub(wrist));
    wristJoint.add(hinge);
    knuckle("chelaHinge" + side, hinge, V(0, 0, 0), CW * 0.0804, clawMat);
    const dEnd = dactB.clone().sub(dactA);
    bone("chelaDactylTip" + side, hinge, V(0, 0, 0), dEnd, CW * 0.0804, CW * 0.0268, clawMat, 12);
    knuckle("chelaDactylCap" + side, hinge, dEnd, CW * 0.0268, clawMat);
    dactyls.push(hinge);

    return root;
  };

  const chelipedL = makeCheliped(-1);
  const chelipedR = makeCheliped(1);

  g.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });

  const userData: GhostUserData = {
    bodyMat,
    // The limbs, the gold face and the claws ARE the silhouette — ten limbs plus
    // the whole lower face. Leaving them un-recoloured would blunt the "edible
    // now" read, which is the documented large-accent rule. The apron, the crease
    // ink and the brows keep their own colour: they are what holds the face and
    // the leg count legible while everything else is one flat blue.
    accentMats: [limbMat, faceMat, clawMat],
    eyes,
    pupPivots,
    pupM,
    pupBaseColor: pupM.color.getHex(),
    baseColor: color,
    // No hem and no `skirt`, so this character opts out of the shared breathe.
    // Its idle is the scuttle, the sway, the pincer snap and the eyestalk
    // waggle below.
    hem: [],
    pupOffset: { x: 0, z: 0 },
    behaviour: crabBehaviour(
      legs,
      [chelipedL, chelipedR],
      dactyls,
      [eyestalkL, eyestalkR],
      body,
    ),
    eyeMats: crabEyeMats,
    spiritMats: collectSpiritMats(g, crabEyeMats),
  };
  g.userData = userData;
  return g;
}

/**
 * Builds an enemy mesh for `skinId`, dispatching between the classic ghost
 * and the garden beetle/bee/ladybug/flea/crab (IDEA-009, IDEA-053, IDEA-054)
 * â€” all six satisfy the
 * identical `GhostUserData` contract, so callers (game.ts) can treat the
 * result uniformly regardless of which skin is equipped. Falls back to the
 * ghost for any unrecognised id, mirroring cosmetics.ts's getEnemySkin
 * fallback behaviour (degrade to the default rather than throw).
 */
export function makeEnemy(skinId: string, color: number): THREE.Group {
  if (skinId === "beetle") return makeBeetle(color);
  if (skinId === "bee") return makeBee(color);
  if (skinId === "ladybug") return makeLadybug(color);
  if (skinId === "flea") return makeFlea(color);
  if (skinId === "crab") return makeCrab(color);
  return makeGhost(color);
}

// Angular speed (rad/s) for turning the model toward its facing direction.
// High enough that, combined with the tile-stepping model (facing only
// changes at tile centres), a turn resolves well within one tile crossing â€”
// the prototype snaps instantly, this keeps that feel but avoids a visible
// pop when two syncs land on either side of a corner.
const TURN_RATE = 18;
// Walk bob/waddle tuning (ported from prototype syncMeshes).
const BOB_FREQ = 12;
const BOB_HEIGHT = 0.06;
const WADDLE_AMPLITUDE = 0.06;

// Beagle part-animation tuning. All keyed off the same BOB_FREQ-derived walk
// clock (`state.t`) so everything stays in lock-step with the existing bob â€”
// a trot/wag/flop that drifted out of phase with the bob would look wrong.
// Amplitudes bumped from the original pass (0.55/0.3/0.5 tail/ear/leg) â€” at
// normal camera distance the smaller values read as barely-there; these are
// the values that actually land on screen.
const TAIL_WAG_FREQ = BOB_FREQ * 0.5; // slower than the leg trot, reads as a wag not a blur
const TAIL_WAG_AMPLITUDE = 0.7; // radians of yaw at the pivot
// How far the leather swings, and where it sits at each end of the crossfade.
// Positive rotation.x sweeps the ear BACK (rotating the ear's -Y hang about X
// tips the tip toward -Z); negative folds it FORWARD.
const EAR_FLOP_AMPLITUDE = 0.18;
/** Standing: the ear folds slightly FORWARD, the way it hangs on a still dog. */
const EAR_IDLE_FOLD = -0.22;
/** Running: the leather is swept BACK and flaps around that swept position —
 *  ears streaming behind like wings, which is what a beagle at speed does and
 *  what reads as speed on screen. Flapping around 0 instead (the old
 *  behaviour) just wagged the ears about the standing pose and read as
 *  nothing in particular. */
// The reworked ears hang from the skull's top edge and curve OUTWARD, so
// they must swing a long way back (~86 deg) to stream behind the head; the
// old 0.88 rotated the leather straight through the skull. Flop stays small
// around it (1.32..1.68) so no frame of the cycle dips back into the head.
const EAR_RUN_SWEEP = 1.5;
/** Outward yaw (mirrored) while running — the leathers angle away from the
 *  skull instead of lying flat along it. Tuned on /preview/?earx=1.5&eary=0.35. */
const EAR_RUN_YAW = 0.35;
/**
 * ...and swung OUT as well as back, which is the half that makes it work.
 *
 * Sweeping on X alone sends the ear straight into the body: this is a chibi
 * build, the head sits close to the chest, and past ~0.6 rad the leather
 * disappears inside the barrel. Adding flare carries it clear on the way round
 * — and it is also what "ears flying like wings" actually looks like from the
 * front, which is the angle the player sees most in the maze.
 */
const EAR_RUN_FLARE = 0.05; // near-zero: with the swept-back leather, roll only pushed the tips up like horns
const EAR_FLOP_LAG = 0.35; // radians ear R lags ear L by (phase offset, not time) for a floppy asymmetry
const LEG_TROT_AMPLITUDE = 0.6;
const JAW_CHOMP_AMPLITUDE = 0.22;
const JAW_CHOMP_FREQ = BOB_FREQ; // one chomp per bob cycle

// Idle (stopped) tuning: the beagle is on-camera and holding still for long
// stretches (Start panel, "Ready!" banner, any paused moment), so it needs
// its own gentle life instead of going dead-flat. All keyed off `state.idleT`
// (free-running, unlike `state.t` which only advances while moving) so idle
// motion never freezes. Deliberately slower/subtler than the moving
// animation above â€” this is a standing dog breathing and glancing around,
// not a trot.
const TAIL_IDLE_WAG_FREQ = 1.8;
const TAIL_IDLE_WAG_AMPLITUDE = 0.4; // was 0.12 (read as +-0.08 on screen, imperceptible)
const EAR_IDLE_SWAY_FREQ = 0.9;
const EAR_IDLE_SWAY_AMPLITUDE = 0.08; // gentle sway, not a flop
const EAR_IDLE_SWAY_LAG = 1.1; // phase offset (radians) so L/R don't sway in lockstep
// Occasional bigger ear twitch layered on top of the base sway â€” a beat
// pattern (two closely-spaced frequencies) gives a periodic "perk up" without
// any randomness/state.
const EAR_TWITCH_FREQ = 0.31;
const EAR_TWITCH_AMPLITUDE = 0.05;
// Idle breathing: a subtle whole-body scale.y oscillation (not position,
// which syncToEntity already owns for the bob) around the base scale.
// Kept tiny (+-1.5%) so it reads as breathing, not pulsing.
const IDLE_BREATHE_FREQ = 1.4;
const IDLE_BREATHE_AMPLITUDE = 0.015;
// How fast the idle<->moving pose blend crosses over (1/s decay constant,
// same exponential-smoothing shape as TURN_RATE) so a stop/start doesn't pop
// the ears/tail straight between the two formulas.
const POSE_BLEND_RATE = 6;

// Ghost hem-wobble tuning: a slow breathing wave around the 5 hem spheres,
// phase-offset per sphere so it reads as a skirt ripple rather than the
// whole hem pumping in unison. Runs continuously (not gated on `moving`) so
// a ghost paused mid-decision doesn't look frozen.
const HEM_WOBBLE_FREQ = 5;
const HEM_WOBBLE_HEIGHT = 0.02;
const HEM_WOBBLE_SCALE = 0.08;
const SKIRT_BREATHE_SCALE = 0.02;

/** Shortest-path angle difference a -> b, in (-PI, PI]. */
function angleDelta(a: number, b: number): number {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

// Per-object walk-cycle state: `t` is the bob/waddle clock (advances only
// while moving), `idleT` is a free-running clock (advances always, used for
// idle-tail-wag and the ghost hem wobble so those never freeze when stopped),
// `baseY` is the model's own y baseline captured once (on first sync) and
// reused forever â€” obj.position.y is overwritten with bob applied on top of
// it each call, so re-reading obj.position.y as the baseline would re-add
// the previous frame's bob and ratchet the model upward. `moveBlend` is an
// exponentially-smoothed 0..1 crossfade between the idle and moving beagle
// poses (1 = fully moving) so a stop/start doesn't visibly pop the ears/tail
// between the two formulas; unused by the ghost hem wobble but harmless
// there. Independent per entity (beagle and each ghost call this) without
// storing extra fields on Entity.
interface WalkState { t: number; idleT: number; baseY: number; moveBlend: number; }
const walkStates = new WeakMap<THREE.Object3D, WalkState>();

/**
 * Reads (never mutates) `e` and moves/turns `obj` to match: position from
 * entityWorld(e) (keeping the model's own y baseline), yaw toward the
 * entity's heading, plus a cheap walk bob while moving. Also layers
 * part-animation on top when `obj` exposes the corresponding userData
 * contract: `userData.parts` (BeagleParts) drives a tail wag / ear flop /
 * leg trot / subtle chomp; `userData.hem` (GhostUserData) drives a skirt
 * wobble. Both are purely additive over the existing position/yaw/bob path.
 *
 * Heading = `e.dir` while moving, falling back to `e.facing` when stopped.
 * This is deliberately NOT always `e.facing`: stepEntity (src/game/movement.ts)
 * updates `facing` to the OLD dir on tile arrival before applying the queued
 * turn at that same centre, so `facing` lags a turn by a full tile by design
 * (movement.ts is validated and kept that way for M3 ambusher AI semantics).
 * Using `dir` while moving means the model turns exactly when the entity
 * actually changes heading, instead of a tile late; `facing` is only needed
 * as a fallback for the stopped case, where `dir` is `{0,0}`.
 */
export function syncToEntity(obj: THREE.Object3D, e: Entity, dt: number): void {
  const w = entityWorld(e);

  const moving = e.dir.x !== 0 || e.dir.y !== 0;
  const state = walkStates.get(obj) ?? { t: 0, idleT: 0, baseY: obj.position.y, moveBlend: moving ? 1 : 0 };
  state.t += moving ? dt : 0;
  state.idleT += dt;
  // Exponentially chase the moving/idle target so a stop/start crossfades the
  // two pose formulas below instead of popping between them (task item C).
  state.moveBlend += ((moving ? 1 : 0) - state.moveBlend) * (1 - Math.exp(-POSE_BLEND_RATE * dt));
  walkStates.set(obj, state);

  const h = moving ? e.dir : e.facing;
  const targetYaw = Math.atan2(h.x, h.y);
  const smoothing = 1 - Math.exp(-TURN_RATE * dt);
  obj.rotation.y += angleDelta(obj.rotation.y, targetYaw) * smoothing;

  obj.position.x = w.x;
  obj.position.z = w.z;
  obj.position.y = state.baseY + (moving ? Math.abs(Math.sin(state.t * BOB_FREQ)) * BOB_HEIGHT : 0);
  obj.rotation.z = moving ? Math.sin(state.t * BOB_FREQ) * WADDLE_AMPLITUDE : 0;

  const parts = obj.userData.parts as BeagleParts | undefined;
  if (parts) animateBeagleParts(parts, state);

  // Idle breathing: a tiny scale.y oscillation on the whole beagle group,
  // fading out via moveBlend as it starts moving (a trotting dog's silhouette
  // shouldn't also be breathing) and fading back in once it settles. Skipped
  // entirely for objects with no `parts` (i.e. ghosts) since only the beagle
  // group's top-level scale is otherwise free â€” ghosts already breathe via
  // animateGhostHem's skirt scale. Guarded to never run during the death
  // spin-shrink: setBeagleDeath/resetBeagleScale own `obj.scale` there, but
  // syncToEntity is never called on the beagle mesh while mode === "dying"
  // (see src/game/game.ts's "dying" case, which calls setBeagleDeath instead)
  // so there is no per-frame conflict â€” this code path simply doesn't run
  // then. At full moveBlend (steady trot) scale.y is pinned back to the base
  // uniform scale so no idle-breathe residue lingers into the moving pose.
  if (parts) {
    const idleFactor = 1 - state.moveBlend;
    const breathe = Math.sin(state.idleT * IDLE_BREATHE_FREQ * Math.PI * 2) * IDLE_BREATHE_AMPLITUDE * idleFactor;
    obj.scale.y = obj.scale.x * (1 + breathe);
  }

  const hem = obj.userData.hem as THREE.Mesh[] | undefined;
  const skirt = obj.userData.skirt as THREE.Mesh | undefined;
  if (hem && skirt) animateGhostHem(hem, skirt, state.idleT);

  // Whatever else this particular character animates â€” the shared layer does
  // not know or care what that is.
  const behaviour = obj.userData.behaviour as EnemyBehaviour | undefined;
  behaviour?.animate?.(state.t, state.idleT, state.moveBlend);
}

/**
 * Poses the beagle's pivot sub-parts for one frame. Everything is driven off
 * `state.t` (the shared bob clock) while moving so the trot/wag/chomp stay in
 * lock-step with the bob, and off `state.idleT` for the idle sway/wag so the
 * beagle keeps a little life once stopped (Start panel, "Ready!" banner,
 * paused mid-decision). No allocations â€” every part is rotated in place via
 * plain scalar assignment.
 *
 * Idle and moving poses are computed independently and then cross-faded via
 * `state.moveBlend` (an exponentially-smoothed 0..1 chase toward `moving`,
 * advanced in syncToEntity) rather than hard if/else-switched, so a stop or
 * start eases between "standing around" and "mid-trot" instead of popping â€”
 * task item C. Legs/jaw have no idle motion (a standing dog doesn't trot or
 * chomp), so they naturally blend down to 0 as `moveBlend` falls.
 */
function animateBeagleParts(parts: BeagleParts, state: WalkState): void {
  const blend = state.moveBlend;

  // --- moving pose ---
  const movingTailWag = Math.sin(state.t * TAIL_WAG_FREQ * Math.PI * 2) * TAIL_WAG_AMPLITUDE;
  const movingEarL = EAR_RUN_SWEEP + Math.sin(state.t * BOB_FREQ) * EAR_FLOP_AMPLITUDE;
  const movingEarR = EAR_RUN_SWEEP + Math.sin(state.t * BOB_FREQ - EAR_FLOP_LAG) * EAR_FLOP_AMPLITUDE;
  // Alternating trot: front-left/back-right swing opposite front-right/back-left.
  const trot = Math.sin(state.t * BOB_FREQ) * LEG_TROT_AMPLITUDE;
  const movingJaw = Math.max(0, Math.sin(state.t * JAW_CHOMP_FREQ)) * JAW_CHOMP_AMPLITUDE;

  // --- idle pose (all off the free-running idleT so it never freezes) ---
  // Tail: a happy, clearly-visible idle wag (was a barely-there 0.12 rad).
  const idleTailWag = Math.sin(state.idleT * TAIL_IDLE_WAG_FREQ) * TAIL_IDLE_WAG_AMPLITUDE;
  // Ears: slow out-of-phase sway plus a small periodic "perk up" twitch, so a
  // standing beagle looks alert rather than pinned flat. Only ~0.1-0.15 rad
  // total â€” a gentle sway/twitch, not a flop.
  const earSwayL = EAR_IDLE_FOLD
    + Math.sin(state.idleT * EAR_IDLE_SWAY_FREQ) * EAR_IDLE_SWAY_AMPLITUDE
    + Math.sin(state.idleT * EAR_TWITCH_FREQ * Math.PI * 2) * EAR_TWITCH_AMPLITUDE;
  const earSwayR = EAR_IDLE_FOLD
    + Math.sin(state.idleT * EAR_IDLE_SWAY_FREQ + EAR_IDLE_SWAY_LAG) * EAR_IDLE_SWAY_AMPLITUDE
    + Math.sin(state.idleT * EAR_TWITCH_FREQ * Math.PI * 2 + EAR_IDLE_SWAY_LAG) * EAR_TWITCH_AMPLITUDE;
  // Legs/jaw at rest: a standing dog doesn't trot or chomp, so idle target is 0
  // and they simply blend down to nothing as `blend` falls (see below).

  parts.tail.rotation.y = idleTailWag + (movingTailWag - idleTailWag) * blend;
  parts.earL.rotation.x = earSwayL + (movingEarL - earSwayL) * blend;
  parts.earR.rotation.x = earSwayR + (movingEarR - earSwayR) * blend;
  // The outward swing is moving-only, so it simply scales with the crossfade:
  // standing, the leather hangs on the flare its own mesh already carries.
  // Mirrored, so the ears fly away from each other rather than both one way.
  parts.earL.rotation.z = -EAR_RUN_FLARE * blend;
  parts.earR.rotation.z = EAR_RUN_FLARE * blend;
  parts.earL.rotation.y = -EAR_RUN_YAW * blend;
  parts.earR.rotation.y = EAR_RUN_YAW * blend;

  parts.legs[0].rotation.x = trot * blend;
  parts.legs[1].rotation.x = -trot * blend;
  parts.legs[2].rotation.x = -trot * blend;
  parts.legs[3].rotation.x = trot * blend;

  parts.jaw.rotation.x = movingJaw * blend;
}

/**
 * Wobbles a ghost's 5 hem spheres (phase-offset vertical bob + squash/stretch)
 * and gently breathes the skirt cylinder, purely for idle liveliness â€” runs
 * off the free-running `idleT` clock so it never stops even when the ghost
 * itself is paused (e.g. still in its pen).
 */
interface RestPose {
  y: number;
  sx: number;
  sy: number;
  sz: number;
}

/**
 * The authored rest pose of a wobbled part, captured the first time it is
 * animated and then reused every frame.
 *
 * This exists because animateGhostHem used to write ABSOLUTE values â€” a
 * hardcoded `position.y = 0.02` and `scale.set(s, s, s)` â€” which silently threw
 * away whatever the builder had authored. Two consequences, both real:
 *
 *  1. The bee's stripe blobs and the ladybug's spots are placed ON their body
 *     surface (y around 0.50), computed by bodySurfaceY/spotSurfaceY. The old
 *     code dropped every one of them to y = 0.02 on the first animated frame â€”
 *     they fell off the body onto the floor. Invisible in the editor, which
 *     does not idle-animate enemies, and visible in the actual game.
 *  2. Nothing could author its own skirt scale or hem height, because the
 *     animation overwrote it. That made those channels un-editable in the
 *     character editor for no good reason.
 *
 * Animating RELATIVE to the captured rest pose fixes both, and is a no-op for
 * the ghost: its hems are authored at exactly y = 0.02 with scale 1, so the
 * arithmetic lands on the same numbers it always did.
 */
const restPoses = new WeakMap<THREE.Object3D, RestPose>();

function restPose(o: THREE.Object3D): RestPose {
  let rest = restPoses.get(o);
  if (!rest) {
    rest = { y: o.position.y, sx: o.scale.x, sy: o.scale.y, sz: o.scale.z };
    restPoses.set(o, rest);
  }
  return rest;
}

// Beetle gait + antenna sway. The sheet asked for "body bob + counter-phase
// antenna lag"; the bob already comes free from syncToEntity's shared BOB_FREQ.
const LEG_GAIT_FREQ = 11; // rad/s â€” a quick insect scuttle, not a dog's trot
const LEG_GAIT_SWING = 0.5; // radians fore/aft at a full stride
const ANTENNA_SWAY_FREQ = 1.15;
const ANTENNA_SWAY = 0.14;
const ANTENNA_LAG = 1.15; // radians of phase between the two antennae

/**
 * Six legs in the ALTERNATING TRIPOD every real insect walks with: front-left,
 * middle-right and back-left swing together while the other three are planted,
 * then they swap. Three points of contact at all times, which is why it reads
 * as a bug scuttling rather than a toy waddling.
 *
 * Legs arrive in build order (F-L, F-R, M-L, M-R, B-L, B-R), so a leg's tripod
 * is simply whether its index is even or odd â€” index 0 (F-L), 3 (M-R) and 4
 * (B-L) land in one group and 1, 2, 5 in the other.
 */
function animateInsectLimbs(limbs: InsectLimbs, t: number, idleT: number, moveBlend: number): void {
  const stride = Math.sin(t * LEG_GAIT_FREQ) * LEG_GAIT_SWING * moveBlend;
  for (let i = 0; i < limbs.legs.length; i++) {
    const tripodA = i === 0 || i === 3 || i === 4;
    limbs.legs[i].rotation.x = tripodA ? stride : -stride;
  }
  // The antennae never stop â€” a bug's feelers twitch even standing still â€” and
  // the two are phase-offset so they never look mechanically twinned.
  for (let i = 0; i < limbs.antennae.length; i++) {
    const phase = idleT * ANTENNA_SWAY_FREQ + i * ANTENNA_LAG;
    limbs.antennae[i].rotation.x = Math.sin(phase) * ANTENNA_SWAY;
    limbs.antennae[i].rotation.z = Math.cos(phase * 0.7) * ANTENNA_SWAY * 0.6;
  }
}

function animateGhostHem(hem: THREE.Mesh[], skirt: THREE.Mesh, idleT: number): void {
  for (let i = 0; i < hem.length; i++) {
    const rest = restPose(hem[i]);
    const phase = (i / hem.length) * Math.PI * 2;
    const wave = Math.sin(idleT * HEM_WOBBLE_FREQ * Math.PI * 2 + phase);
    hem[i].position.y = rest.y + wave * HEM_WOBBLE_HEIGHT;
    const s = 1 + wave * HEM_WOBBLE_SCALE;
    hem[i].scale.set(rest.sx * s, rest.sy * s, rest.sz * s);
  }
  const rest = restPose(skirt);
  const breathe = 1 + Math.sin(idleT * HEM_WOBBLE_FREQ * Math.PI * 2) * SKIRT_BREATHE_SCALE;
  skirt.scale.set(rest.sx * breathe, rest.sy, rest.sz * breathe);
}

// Pupil dart smoothing rate (1/s decay constant, same shape as TURN_RATE's
// exp smoothing) â€” fast enough to read as "snappy glance" rather than lazy
// drift, but no longer an instant snap to the target offset.
const PUPIL_SMOOTH_RATE = 14;
// Eaten-eyes glide the same way, slightly gentler so the eyes read as
// "floating home" rather than darting.
const EYES_GLIDE_RATE = 10;

// A flush cap sweeps by ROTATING about the sphere's centre, never by sliding.
// This converts a pupil offset into that rotation.
//
// The ceiling is geometric, not aesthetic: a pupil cap of angular radius r_p
// sitting inside a sclera of r_s can travel (r_s - r_p) before its edge clears
// the white. The old shared helper used 0.28 and 0.28 * 0.59, a margin of 0.115
// radians â€” and pupOffset peaks at 0.05 per axis. The first version converted
// by 1/0.309 = 3.24, giving 0.162: HALF AGAIN past the margin, so the pupils
// rode up off the sclera and sat on the body whenever an enemy moved. 1.6 keeps
// the sweep at 0.08, comfortably inside the white with a rim still showing.
const PUPIL_SWEEP = 1.6;
// Frightened shiver: small, rapid position/rotation jitter layered on top of
// whatever syncToEntity just set this frame, so it reads as a nervous quiver
// without fighting the walk/bob motion underneath.
const SHIVER_FREQ = 26; // Hz-ish; deliberately not a multiple of BOB_FREQ so it doesn't visually lock-step with the walk bob
const SHIVER_POS_AMPLITUDE = 0.015;
const SHIVER_ROT_AMPLITUDE = 0.05;

/**
 * Per-mesh clock for applyGhostState's own time-based effects (pupil/eye
 * smoothing, frightened shiver). applyGhostState intentionally has no `dt`
 * parameter (the call sites pass only mesh/state/dir), so it derives one
 * internally from consecutive `performance.now()` timestamps â€” the same
 * technique the game loop itself uses (see game.ts's `clock.last`). This
 * keeps the shiver/smoothing frame-rate independent without touching the
 * exported signature.
 */
interface GhostStateClock {
  lastMs: number;
  shiverT: number;
  /** The look currently painted on this mesh â€” null until the first apply.
   *  Gates the expensive material work to genuine state TRANSITIONS. */
  look: LookKind | null;
}
const ghostStateClocks = new WeakMap<THREE.Object3D, GhostStateClock>();

/** Exponential smoothing step: moves `from` toward `to` at `rate` over `dt` seconds. */
function smoothTo(from: number, to: number, rate: number, dt: number): number {
  return from + (to - from) * (1 - Math.exp(-rate * dt));
}

/**
 * Recolours/re-visibilities a ghost mesh for its current gameplay state and
 * offsets its pupils to look toward `dir` (ported from prototype syncMeshes,
 * lines 591-608). Call once per frame per ghost, separate from syncToEntity
 * (which only moves/turns â���” the beagle has no state to recolour, so state
 * handling stays out of the shared positional path).
 *
 * - frightened: body recolours to COLORS.frightened / a dark blue emissive,
 *   pupils go white, everything stays visible, and the whole mesh gets a
 *   rapid nervous shiver (small position/rotation jitter) layered on top of
 *   whatever position syncToEntity set this frame.
 * - eaten: every child is hidden except the eyes + pupils, which glide home
 *   alone (smoothly, not snapping); pupils return to their normal blue.
 * - scatter/chase (normal): everything visible, body back to its own
 *   baseColor, pupils normal blue, no shiver.
 *
 * Pupil dart-toward-`dir` is smoothed (exponential ease) rather than
 * snapped, using `ud.pupOffset` as the running value. A fright-ending blink
 * (a classic arcade cue) is deliberately NOT implemented here â€” this
 * function only ever receives the current `state`, not remaining fright
 * time, and changing that contract is out of scope for this pass; it's left
 * for the effects layer, which is better positioned to key off a timer.
 */
export function applyGhostState(mesh: THREE.Object3D, state: GhostState, dir: Vec2): void {
  const ud = mesh.userData as GhostUserData;

  const now = performance.now();
  const clock: GhostStateClock = ghostStateClocks.get(mesh) ?? { lastMs: now, shiverT: 0, look: null };
  const dt = Math.min(Math.max((now - clock.lastMs) / 1000, 0), 0.1); // clamp guards first-call/tab-away spikes
  clock.lastMs = now;
  clock.shiverT += dt;
  ghostStateClocks.set(mesh, clock);

  // eye/pupil look direction (prototype lines 591-592), smoothed toward the
  // target instead of snapping so a sudden reversal reads as a quick glance.
  const targetX = dir.x * 0.05;
  const targetZ = dir.y * 0.05;
  const glideRate = state === "eaten" ? EYES_GLIDE_RATE : PUPIL_SMOOTH_RATE;
  ud.pupOffset.x = smoothTo(ud.pupOffset.x, targetX, glideRate, dt);
  ud.pupOffset.z = smoothTo(ud.pupOffset.z, targetZ, glideRate, dt);
  // The eye-dart. Every enemy's pupil is now a flush decal cap, which must
  // stay centred on its form to hug it â€” so it can never be TRANSLATED the way
  // the old ball pupils were. Its pivot ROTATES instead, sweeping the cap
  // across the surface. The pivot is its own node so the animation can own its
  // rotation outright, without touching anything the builder authored.
  for (const pivot of ud.pupPivots) {
    pivot.rotation.y = ud.pupOffset.x * PUPIL_SWEEP;
    // A cap cannot slide along its own surface normal, so what used to be an
    // in/out nudge reads as an up/down glance â€” closer to what a real eye does
    // anyway. Flip this sign for the opposite glance.
    pivot.rotation.x = -ud.pupOffset.z * PUPIL_SWEEP;
  }

  // THE LOOK is applied only when the state actually CHANGES, not every frame.
  // That is not just tidiness: toggling Material.transparent invalidates the
  // material's shader program, so doing it per-frame would recompile the whole
  // model's materials sixty times a second. Per-frame motion (the pupil dart
  // above, the shiver below) stays outside this gate.
  const kind: LookKind = state === "frightened" ? "frightened" : state === "eaten" ? "eaten" : "normal";
  if (clock.look !== kind) {
    clock.look = kind;
    applyEnemyLook(mesh, ud, kind);
  }

  if (state === "frightened") {
    // Nervous shiver, layered on top of the position/yaw syncToEntity just
    // applied this frame. Two slightly-detuned sine terms per axis avoid an
    // obviously-circular or metronomic jitter.
    const t = clock.shiverT;
    mesh.position.x += Math.sin(t * SHIVER_FREQ) * SHIVER_POS_AMPLITUDE;
    mesh.position.z += Math.cos(t * SHIVER_FREQ * 1.3) * SHIVER_POS_AMPLITUDE;
    mesh.rotation.x = Math.sin(t * SHIVER_FREQ * 1.7) * SHIVER_ROT_AMPLITUDE;
  } else {
    mesh.rotation.x = 0;
  }
}

type LookKind = "normal" | "frightened" | "eaten";

/** How much of the body survives as a spirit while eaten. */
const EATEN_OPACITY = 0.3;
/** Emissive strength of that spirit â€” enough to read against a dark maze. */
const EATEN_GLOW = 0.5;

/**
 * The three looks an enemy can wear.
 *
 * EATEN is deliberately NOT the classic pair of floating eyes any more. The
 * body stays, rendered as a translucent spirit in the enemy's own team colour,
 * with the eyes left solid on top. Two reasons: an eaten enemy running home is
 * far easier to follow across a busy maze when it still has a silhouette, and
 * keeping the team colour means you can tell WHICH one you ate and where it is
 * about to pop back out of the pen.
 *
 * A character that wants something else entirely supplies behaviour.onEaten /
 * onRestore and this shared treatment steps aside.
 */
function applyEnemyLook(mesh: THREE.Object3D, ud: GhostUserData, look: LookKind): void {
  const behaviour = ud.behaviour;

  // Coming OUT of eaten, always undo the spirit before anything else paints.
  if (look !== "eaten") {
    if (behaviour?.onRestore) behaviour.onRestore();
    else {
      for (const m of ud.spiritMats) {
        const base = m.userData.spiritBase as SpiritBase | undefined;
        m.transparent = base?.transparent ?? false;
        m.opacity = base?.opacity ?? 1;
        m.depthWrite = base?.depthWrite ?? true;
        m.emissiveIntensity = base?.emissiveIntensity ?? 1;
        // Put the authored colours back too. bodyMat and the accents are in
        // this list as well and get repainted a few lines below, so this is
        // the full undo for every OTHER material — the ones no branch owns.
        if (base) {
          m.color.setHex(base.color);
          m.emissive.setHex(base.emissive);
        }
        m.needsUpdate = true;
      }
      mesh.traverse((o) => {
        if (o instanceof THREE.Mesh) o.castShadow = (o.userData.shadowBase as boolean | undefined) ?? true;
      });
    }
    mesh.traverse((o) => { o.visible = true; });
  }

  if (look === "frightened") {
    ud.bodyMat.color.setHex(COLORS.frightened);
    ud.bodyMat.emissive.setHex(0x101c66);
    ud.bodyMat.emissiveIntensity = 0.15;
    // Large accent masses (the beetle's teal head, legs and antennae) turn too,
    // or a third of the silhouette would stay its normal colour and blunt the
    // "edible now" read. Small fixed accents simply do not register here.
    ud.accentMats?.forEach((m) => {
      m.color.setHex(COLORS.frightened);
      m.emissive.setHex(0x101c66);
    });
    ud.pupM.color.setHex(0xffffff);
    return;
  }

  if (look === "eaten") {
    if (behaviour?.onEaten) {
      behaviour.onEaten();
      return;
    }
    // Everything stays VISIBLE â€” that is the whole change. The body simply
    // turns to a faint, glowing version of its own colour.
    mesh.traverse((o) => { o.visible = true; });
    for (const m of ud.spiritMats) {
      m.transparent = true;
      m.opacity = EATEN_OPACITY;
      // depthWrite off so the spirit's own overlapping parts do not carve
      // depth-buffer holes in each other and flicker as it turns.
      m.depthWrite = false;
      m.color.setHex(ud.baseColor);
      m.emissive.setHex(ud.baseColor);
      m.emissiveIntensity = EATEN_GLOW;
      m.needsUpdate = true;
    }
    // A spirit that still drops a solid shadow gives the whole illusion away,
    // so an eaten enemy stops casting one until it is restored.
    mesh.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = false;
    });
    // Eyes stay solid, so they still read as the thing you follow home.
    ud.pupM.color.setHex(ud.pupBaseColor);
    return;
  }

  // normal
  ud.bodyMat.color.setHex(ud.baseColor);
  ud.bodyMat.emissive.setHex(ud.baseColor);
  ud.bodyMat.emissiveIntensity = 0.15;
  ud.accentMats?.forEach((m) => {
    m.color.setHex(m.userData.baseColor as number);
    m.emissive.setHex(0x000000);
    m.emissiveIntensity = 1;
  });
  ud.pupM.color.setHex(ud.pupBaseColor);
}

// Base model scale from makeBeagle (g.scale.setScalar(0.9)) — the resting
// scale the death spin shrinks away from and resets back to.
const BEAGLE_BASE_SCALE = 0.9;

/**
 * Drives the beagle's death spin-shrink (ported from prototype's `dying`
 * branch, lines 673-679): spins on Y and shrinks toward zero as `k` (the
 * caller's stateTimer/deathDuration, expected clamped to 0..1) counts down.
 * The state machine owns the timer/clamping; this just applies one frame.
 */
export function setBeagleDeath(mesh: THREE.Object3D, k: number, dt: number): void {
  mesh.rotation.y += dt * 10;
  mesh.scale.setScalar(BEAGLE_BASE_SCALE * k);
}

/** Restores the beagle's resting scale after a death animation completes. */
export function resetBeagleScale(mesh: THREE.Object3D): void {
  mesh.scale.setScalar(BEAGLE_BASE_SCALE);
}
