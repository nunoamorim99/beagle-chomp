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
import {
  sectorOutline,
  sectorHalfWidth,
  crustSweepPoints,
  spiralPoints,
  hoseGeometry,
  type SectorOutlineOptions,
} from "./pizzaSculpt";
import {
  squirclePillow,
  squirclePoints,
  squircleRadius,
  clipPolygonToBand,
  shapeFromPoints,
  pathFromPoints,
  smileHolePoints,
  latheAlongZ,
  bandedTubeAlongZ,
  squircleFrontZ,
  type BandedRing,
} from "./sushiSculpt";
import {
  TOP_BUN_STATIONS,
  BOTTOM_BUN_STATIONS,
  PATTY_STATIONS,
  bandProfile,
  stationRadius,
  onBand,
  frillRing,
  squircleSlab,
  scatterOnBand,
} from "./burgerSculpt";
import { rng } from "./paint";

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


// ---------------------------------------------------------------------------
// THE MOSQUITO — the third img2threejs rebuild (IDEA-055), after the beagle
// (IDEA-047) and the flea (IDEA-053). Same split as both: the pipeline's
// generated factory sits unused in src/render/rework/createMosquitoModel.ts and
// the SHIPPED mesh is hand-authored from the numbers that run locked. The whole
// evidence trail is .img2threejs/mosquito/ — a per-subject workspace, so a new
// run never overwrites another subject's.
//
// PROPORTION BASE: HEAD DIAMETER = HD, measured at 155 px on the reference,
// and every dimension below is a multiple of it. HD = 0.27 here, NOT the 0.32
// the bee and flea use, and that is deliberate: a mosquito is a LONGER animal
// at the same envelope. At 0.32 the model measured 0.90 along Z, past the
// beetle's 0.872 which is the cast's ceiling. At 0.27 it lands at 0.865 with
// the head 16% smaller than the bee's — which is what the reference shows.
//
// Measured against the shipped cast (scripts/_scratch-enemy-cast.ts):
//   w 0.812 (band 0.531-0.849) · h 0.762 (0.624-0.822)
//   l 0.865 (0.610-0.872)      · crown 0.780 (0.600-0.803)
const MOSQ_DARK = 0x2a1a0e; // thorax + large dark accent
const MOSQ_CREASE = 0x241408; // abdomen creases — NOT in accentMats, see below
const MOSQ_WING = 0xf7f4e2; // membrane, the reference's #FAF8E1
const MOSQ_LIMB = 0x14100c; // legs and antennae

// The abdomen's revolved profile, as fractions of the maximum half-width,
// sampled every 0.025 along the axis off the reference (evidence/bands.py).
// This is NOT a capsule and not an ellipsoid: the mass is pinched to a 6.5:1
// waist, holds a near-constant STALK to about t=0.28, swells to its maximum
// just PAST mid-length at t=0.475, then tapers to a rounded point. That stalk
// -then-bulb silhouette is identity feature #3 and the thing a capsule loses.
//
// The two readings at t=0.05 and t=0.075 are dropped: the measuring ray hit the
// thorax there and reported 0.83 and 0.69 against neighbours near 0.28 and 0.52.
// They are interpolated instead of trusted.
const MOSQ_ABDOMEN_PROFILE: readonly number[] = [
  0.154, 0.282, 0.36, 0.44, 0.521, 0.53, 0.53, 0.538, 0.53, 0.521,
  0.521, 0.504, 0.547, 0.607, 0.684, 0.744, 0.821, 0.88, 0.949, 1.0,
  0.991, 0.94, 0.94, 0.974, 0.966, 0.949, 0.932, 0.906, 0.889, 0.855,
  0.829, 0.795, 0.769, 0.727, 0.667, 0.624, 0.556, 0.487, 0.427, 0.325,
  0.231,
];

// The measured banding, as [t0, t1] ranges that take the CREASE material.
// Two narrow interior creases plus a dark base and a dark tip; the four
// mid-tone segments between them are the body colour.
const MOSQ_ABDOMEN_CREASES: readonly (readonly [number, number])[] = [
  [0.16, 0.21],
  [0.4, 0.45],
  [0.67, 0.72],
  [0.93, 1.06],
];
// The measured tone runs are wider than this — dark over 0.000-0.233,
// 0.396-0.462, 0.678-0.744 and 0.903-1.000. They are NARROWED on purpose, and
// the reason is the recolour rather than the reference.
//
// In the reference those runs are dark BROWN against mid brown: a modest step
// that reads as shading between segments. Here the body carries the TEAM
// COLOUR, so a fixed dark band sits against a saturated hue at maximum
// contrast, and at the measured widths the abdomen came back as four heavy
// black rings on red — a WASP, which is the one silhouette this model must not
// borrow (the bee is its recorded collision risk). Narrow creases read as
// segmentation; wide ones read as stripes. The band CENTRES are kept where the
// measurement put them; only their widths are pulled in. The 0.16 crease stands
// in for the measured dark base, whose real extent is swallowed by the thorax.

/**
 * Builds the abdomen as a lathe of the measured profile, with the creases as
 * PER-TRIANGLE MATERIAL GROUPS rather than separate decal meshes — the same
 * technique `splitCoatGroups` uses for the beagle's tricolor coat.
 *
 * Why groups and not decals: the flea's bands are shells laid on a sphere,
 * which works because its abdomen IS a sphere. This profile is not a quadric,
 * so a decal would have to be re-fitted at every radius and would still show
 * its open edges where the curve changes fastest. A group costs nothing extra —
 * the triangles already exist — and a band boundary lands EXACTLY on the
 * measured t rather than near it.
 *
 * Triangles are bucketed by their own mid-axis position and the index buffer is
 * rebuilt in bucket order, so the groups are contiguous without depending on
 * how LatheGeometry happens to emit its index.
 */
function mosquitoAbdomenGeometry(length: number, maxRadius: number): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const n = MOSQ_ABDOMEN_PROFILE.length;
  // A flat disc cap closes the waist end; without it the lathe is an open tube
  // and you see straight up inside the abdomen from below.
  pts.push(new THREE.Vector2(0.0001, 0));
  for (let i = 0; i < n; i++) {
    pts.push(new THREE.Vector2(MOSQ_ABDOMEN_PROFILE[i] * maxRadius, (i / (n - 1)) * length));
  }
  // Close to a rounded POINT, not a hemispherical cap — measured half-width is
  // still 0.231 at t=1.0, so the tip is a short cone off that last ring.
  pts.push(new THREE.Vector2(0.0001, length * 1.03));

  const geo = new THREE.LatheGeometry(pts, 24);
  const index = geo.getIndex();
  const pos = geo.getAttribute("position");
  if (!index) return geo;

  const isCrease = (t: number): boolean =>
    MOSQ_ABDOMEN_CREASES.some(([a, b]) => t >= a && t <= b);

  // Classify by RING, not by the triangle's own mean height.
  //
  // A lathe quad is two triangles between the same pair of profile rings, but
  // one has two vertices on the lower ring and one on the upper, and the other
  // is the reverse — so their mean y values differ, and a boundary tested
  // against the mean puts the two halves of a quad on opposite sides of it. The
  // band edge then alternates up and down around the circumference: the same
  // zigzag IDEA-047 recorded as the beagle's "spiky" markings. Every triangle in
  // a ring gets the ring's own midpoint here, so a boundary is a clean circle.
  const ys = pts.map((p) => p.y);
  const ringT = (y: number): number => {
    let lo = 0;
    for (let i = 0; i < ys.length - 1; i++) if (y >= ys[i] - 1e-6) lo = i;
    return ((ys[lo] + ys[Math.min(lo + 1, ys.length - 1)]) / 2) / length;
  };

  const body: number[] = [];
  const crease: number[] = [];
  const arr = index.array;
  for (let i = 0; i < arr.length; i += 3) {
    const minY = Math.min(pos.getY(arr[i]), pos.getY(arr[i + 1]), pos.getY(arr[i + 2]));
    (isCrease(ringT(minY)) ? crease : body).push(arr[i], arr[i + 1], arr[i + 2]);
  }
  geo.setIndex([...body, ...crease]);
  geo.clearGroups();
  geo.addGroup(0, body.length, 0);
  geo.addGroup(body.length, crease.length, 1);
  return geo;
}

/**
 * Builds a garden-mosquito enemy from primitives (IDEA-055, the sixth enemy
 * skin alongside the ghost, beetle, bee, ladybug and flea). Satisfies the
 * identical `GhostUserData` contract, so game.ts treats it like any other.
 *
 * THE RISK THIS MODEL IS BUILT AGAINST IS THE BEE. The bee already has
 * translucent veined wings, antennae, a three-mass head→thorax→abdomen diagonal,
 * six legs and a hover node — and colour cannot separate them, because both
 * take the team colour and both are recoloured again when frightened. So the
 * SILHOUETTE carries the whole identity, and every separator here is measured:
 *
 *   ONE wing pair, not two          · wing 1.60 HD vs the bee's 0.85 HD forewing
 *   abdomen aspect 0.51 and POINTED · vs the bee's rounded 1.15 HD
 *   a 0.73 HD proboscis             · the bee has nothing there
 *   legs splayed wider than the body · the bee's are tucked
 *
 * This is the same trap IDEA-053 recorded for the flea against the beetle and
 * ladybug, and that one was hit twice before it read correctly.
 */
export function makeMosquito(color: number): THREE.Group {
  const g = new THREE.Group();

  const HD = 0.27;
  const HR = HD / 2;

  // The body carries the TEAM colour — head, proboscis and abdomen, which is a
  // large enough coloured area to read at gameplay size. The thorax, limbs and
  // antennae are the dark accent.
  const bodyMat = toon({ color, emissive: color, emissiveIntensity: 0.12 });
  const darkMat = toon({ color: MOSQ_DARK });
  darkMat.userData.baseColor = MOSQ_DARK;
  const limbMat = toon({ color: MOSQ_LIMB });
  limbMat.userData.baseColor = MOSQ_LIMB;

  // The creases get their OWN material, deliberately kept OUT of accentMats —
  // IDEA-053's rule 2, learned the hard way on the flea. darkMat IS in
  // accentMats, so sharing it would make the frightened recolour paint body and
  // creases the same blue and the banding would vanish in the one state where
  // the player is chasing the thing. Two narrow creases are a negligible share
  // of the silhouette, which is exactly the small-fixed-accent case in
  // GhostUserData's documented rule.
  const creaseMat = toon({ color: MOSQ_CREASE });
  creaseMat.userData.baseColor = MOSQ_CREASE;

  const wingMat = toon({
    color: MOSQ_WING,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const veinMat = toon({
    color: 0xffffff,
    transparent: true,
    // Faint, and no depth write. At full opacity these punch through the head
    // as bright whiskers when seen edge-on — the defect the bee already records.
    opacity: 0.26,
    depthWrite: false,
  });

  // A mosquito hovers, so everything hangs off this node and the behaviour bobs
  // it. The root belongs to syncToEntity (position, yaw).
  const hover = new THREE.Group();
  hover.name = "hover";
  g.add(hover);

  // --- thorax: the hub ------------------------------------------------------
  // Not a spine — head, abdomen, both wings and all six legs branch from here.
  // Near-black in the reference and distinctly darker than the cuticle, which
  // is what gives the three-mass value read.
  const THORAX = new THREE.Vector3(0, 0.4, 0);
  const thorax = new THREE.Mesh(new THREE.SphereGeometry(HD * 0.34, 20, 14), darkMat);
  thorax.name = "thorax";
  thorax.scale.set(0.96, 1.04, 1.0);
  thorax.position.copy(THORAX);
  hover.add(thorax);

  // The one discrete specular mark on the subject: a lighter ellipse on the
  // upper-front quadrant. Small and fixed, so like the creases it keeps its own
  // colour rather than joining the recolour.
  const glossMat = toon({ color: 0x5a5a5a });
  glossMat.userData.baseColor = 0x5a5a5a;
  const gloss = new THREE.Mesh(
    new THREE.SphereGeometry(HD * 0.345, 14, 10, 0, Math.PI * 2, 0, 0.62),
    glossMat,
  );
  gloss.name = "thoraxGloss";
  gloss.scale.set(0.96, 1.04, 1.0);
  gloss.position.copy(THORAX);
  gloss.rotation.set(-0.5, 0, 0.7);
  hover.add(gloss);

  // --- head: forward and slightly above the thorax --------------------------
  // 0.64 HD ahead of the thorax, not the 0.74 the reference measures. The head
  // and thorax overlap either way — head radius 0.50 HD plus thorax 0.34 HD is
  // 0.84 — so the joint looks identical, and the 0.10 HD bought back here pays
  // for the shallower abdomen droop below without shortening either feature.
  const HEAD = new THREE.Vector3(0, THORAX.y + HD * 0.065, THORAX.z + HD * 0.64);
  const head = new THREE.Mesh(new THREE.SphereGeometry(HR, 22, 16), bodyMat);
  head.name = "head";
  head.scale.set(1, 0.96, 1.02);
  head.position.copy(HEAD);
  hover.add(head);

  // --- proboscis: identity rank 1 -------------------------------------------
  // The one feature no other enemy in the cast has. A lathe rather than a bare
  // cone so the base swell the reference shows survives — its widest run is
  // 39 px and it drops away fast — and so the tip converges to a TRUE POINT
  // rather than a flat cap.
  const PROB_LEN = HD * 0.73;
  const PROB_R = HD * 0.095;
  const probPts = [
    new THREE.Vector2(0.0001, 0),
    new THREE.Vector2(PROB_R * 0.92, PROB_LEN * 0.02),
    new THREE.Vector2(PROB_R, PROB_LEN * 0.1),
    new THREE.Vector2(PROB_R * 0.66, PROB_LEN * 0.3),
    new THREE.Vector2(PROB_R * 0.42, PROB_LEN * 0.55),
    new THREE.Vector2(PROB_R * 0.22, PROB_LEN * 0.78),
    new THREE.Vector2(0.0001, PROB_LEN),
  ];
  const proboscis = new THREE.Mesh(new THREE.LatheGeometry(probPts, 14), bodyMat);
  proboscis.name = "proboscis";
  // Leaves the head's front-lower face, 27.5° below horizontal (measured).
  proboscis.position.set(0, HEAD.y - HR * 0.42, HEAD.z + HR * 0.86);
  // Aimed by unit vectors rather than a hand-written Euler. The first pass wrote
  // `rotation.x = PI/2 - 0.48`, which points the lathe's +Y axis UP-forward —
  // the needle rose off the face instead of dropping below it. Deriving the
  // direction from the solved layout makes the sign impossible to get wrong.
  proboscis.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, -0.462, 0.887).normalize(),
  );
  hover.add(proboscis);

  // Two teeth on the lower front — the reference's grin.
  const toothMat = toon({ color: 0xfdfaf2 });
  const grin = new THREE.Mesh(
    new THREE.SphereGeometry(HR * 0.98, 14, 10, 0, Math.PI * 2, 0, 0.3),
    toothMat,
  );
  grin.name = "grin";
  grin.position.copy(HEAD);
  grin.rotation.set(1.15, 0, 0);
  hover.add(grin);

  // --- eyes: the flea/beetle/bee build — a white ball with flush caps -------
  const scleraMat = toon({ color: 0xfdf9f2 });
  const irisMat = toon({ color: 0x6b4a2a });
  const pupM = toon({ color: 0x0a0c12 });
  // The glint is the ONE deliberate unlit material in the model. A toon ramp
  // quantises a highlight into the same band as everything else facing the
  // light, and it stops reading as a catchlight.
  const glintMat = toon({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.5 });
  const mosquitoEyeMats = [scleraMat, irisMat, pupM, glintMat, toothMat];

  // Oversized on purpose: 0.45 HD across, measured. The mascot read is entirely
  // in them, and they are also what a player tracks while the enemy is eaten.
  const EYE_R = HD * 0.225;
  const EYE_FWD = Math.PI / 2;
  const EYE_TILT = -0.12;
  const eyeCap = (
    factor: number,
    rx: number,
    ry: number,
    thetaLen: number,
    mat: THREE.MeshToonMaterial,
  ): THREE.Mesh => {
    const geo = new THREE.SphereGeometry(EYE_R * factor, 16, 12, 0, Math.PI * 2, 0, thetaLen);
    geo.rotateX(rx);
    geo.rotateY(ry);
    return new THREE.Mesh(geo, mat);
  };

  const eyes: THREE.Object3D[] = [];
  const pupPivots: THREE.Object3D[] = [];
  const makeEye = (s: number): void => {
    // Set on the LATERAL faces and standing proud of the head — the reference's
    // cuticle wraps behind each eye rather than socketing it.
    const centre = new THREE.Vector3(0.31 * HD * s, HEAD.y + HR * 0.33, HEAD.z + HR * 0.52);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(EYE_R, 16, 12), scleraMat);
    ball.name = s < 0 ? "eyeL" : "eyeR";
    ball.position.copy(centre);

    const pivot = new THREE.Group();
    pivot.name = s < 0 ? "pupilPivotL" : "pupilPivotR";
    pivot.position.copy(centre);

    const iris = eyeCap(1.012, EYE_FWD, (EYE_TILT + 0.5) * s, 0.78, irisMat);
    iris.name = s < 0 ? "irisL" : "irisR";
    pivot.add(iris);
    // Half the sclera diameter — cartoon oversize, measured, not anatomy.
    const pupil = eyeCap(1.03, EYE_FWD, (EYE_TILT + 0.5) * s, 0.52, pupM);
    pupil.name = s < 0 ? "pupilL" : "pupilR";
    pivot.add(pupil);
    const glint = eyeCap(1.05, EYE_FWD - 0.3, (EYE_TILT + 0.78) * s, 0.15, glintMat);
    glint.name = s < 0 ? "glintL" : "glintR";
    pivot.add(glint);

    eyes.push(ball, iris, pupil, glint);
    pupPivots.push(pivot);
    hover.add(ball, pivot);
  };
  makeEye(-1);
  makeEye(1);

  // --- antennae: ARCS, not rods --------------------------------------------
  // Measured, the horizontal step per 24 px of rise falls 10.5 → 5 → 3, so the
  // curve steepens toward the tip. Straight antennae read as a beetle's.
  const antennae: THREE.Object3D[] = [];
  ([-1, 1] as const).forEach((s) => {
    const pivot = new THREE.Group();
    pivot.name = s < 0 ? "antennaPivotL" : "antennaPivotR";
    pivot.position.set(0.15 * HD * s, HEAD.y + HR * 0.86, HEAD.z + HR * 0.22);
    hover.add(pivot);
    antennae.push(pivot);

    const A = HD * 0.58;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0.3 * A * s, 0.55 * A, -0.1 * A),
      new THREE.Vector3(0.42 * A * s, 0.95 * A, -0.3 * A),
    ]);
    const ant = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 10, HD * 0.015, 6, false),
      limbMat,
    );
    ant.name = s < 0 ? "antennaL" : "antennaR";
    pivot.add(ant);
  });

  // --- wings: identity rank 2 ----------------------------------------------
  // ONE pair — the bee has two — and each is 1.60 HD long against the bee's
  // 0.85 HD forewing, so length is the separator that survives any recolour.
  //
  // 1.60 HD is a DOCUMENTED DEVIATION from the measured 2.22: at 2.22 the wing
  // is 0.60 world units and, held at the reference's sweep, overruns the crown
  // budget the cast occupies. Swept rearward at 35° the length loads the LENGTH
  // axis instead, which had the room. It is still ~1.9x the bee's.
  const wings: THREE.Object3D[] = [];
  ([-1, 1] as const).forEach((s) => {
    const mount = new THREE.Group();
    mount.name = s < 0 ? "wingMountL" : "wingMountR";
    // On the thorax DORSUM with the roots converging near the midline, as
    // measured — not out on the flanks.
    mount.position.set(0.07 * HD * s, THORAX.y + HD * 0.32, THORAX.z - HD * 0.034);
    hover.add(mount);

    const pivot = new THREE.Group();
    pivot.name = s < 0 ? "wingL" : "wingR";
    // Swept up 35°, back, and splayed 38° off the midline — aimed straight from
    // the solved layout's root→tip vector. Composed Euler angles were tried and
    // sent both wings FORWARD over the head, where a long translucent lobe reads
    // as exactly the bee paddle this model exists not to be.
    // Spread wide (52° off the midline) and lifted only 32°, so the wings flank
    // the abdomen instead of lying along it. At the first pass's 38°/35° they
    // covered the abdomen almost completely from the GAME CAMERA — which sits at
    // 59° elevation, not the 12° a turntable defaults to — and a mosquito whose
    // slender banded abdomen is invisible in play is a mosquito reduced to a head
    // and two wings. That is the bee.
    pivot.quaternion.setFromUnitVectors(
      new THREE.Vector3(s, 0, 0),
      new THREE.Vector3(0.668 * s, 0.53, -0.522).normalize(),
    );
    mount.add(pivot);
    wings.push(pivot);

    // 1.90 HD, against the reference's measured 2.22. A first pass used 1.60 and
    // the side-by-side comparison sheet is what rejected it: the reference's
    // wings DOMINATE its silhouette, and at 1.60 they read as a small-winged
    // insect instead. The budget had the room — swept at 32° they load the
    // crown (0.76 against a 0.803 ceiling) and the width (0.72 against 0.849)
    // and not the length, which was the axis that had none.
    const LEN = HD * 1.9;
    // 3.45:1, against the reference's measured 2.85:1. Slimmer than measured
    // because a broad lobe is the bee's read; length-to-width is the cheapest
    // place to buy separation, and it costs nothing in the silhouette that
    // matters.
    const WIDE = HD * 0.55;
    // A flattened lens, not an alpha-textured plane: this project builds every
    // character from primitives and ships no textures, and a CanvasTexture would
    // break the headless suites outright — they build these models in Node,
    // where there is no document to draw on.
    const blade = new THREE.Mesh(new THREE.SphereGeometry(LEN / 2, 18, 10), wingMat);
    blade.name = s < 0 ? "wingBladeL" : "wingBladeR";
    // The sphere's diameter IS LEN, so the width factor is WIDE/LEN — not
    // twice that. The doubled version made the wing 0.33 wide against a measured
    // 0.167 and it read as a rounded paddle, which is the bee.
    blade.scale.set(1, 0.045, WIDE / LEN);
    blade.position.x = (LEN / 2) * s;
    pivot.add(blade);

    // Four veins fanning from the root. Count is the midpoint of a 3-clear /
    // 5-faint reading — at the game camera the FAN is the read, not the tally.
    for (let i = 0; i < 4; i++) {
      const vein = new THREE.Mesh(
        new THREE.BoxGeometry(LEN * 0.6, LEN * 0.006, LEN * 0.006),
        veinMat,
      );
      vein.name = `wingVein${i}${s < 0 ? "L" : "R"}`;
      vein.position.set(LEN * 0.42 * s, 0, WIDE * (i - 1.5) * 0.2);
      vein.rotation.y = (0.3 - i * 0.12) * s;
      pivot.add(vein);
    }
  });

  // --- abdomen: identity rank 3 --------------------------------------------
  // Hung on its own pivot at the waist so the behaviour can swing it with lag.
  const waist = new THREE.Group();
  waist.name = "waistPivot";
  // The socket sits HD*0.14 behind the thorax centre, not the HD*0.313 the
  // reference measures. Both are inside the thorax's own 0.34 HD radius, so the
  // joint looks the same — the abdomen emerges from the thorax's rear surface
  // either way, and burying the first slice of a WAIST is what a waist is. The
  // depth is a length-budget knob: the measured value pushed the model to 0.898
  // along Z, past the beetle's 0.872 which is the shipped cast's ceiling.
  // Spending it here costs nothing visible; shortening the abdomen or the
  // proboscis would have cost identity features #3 and #1.
  waist.position.set(0, THORAX.y - HD * 0.1, THORAX.z - HD * 0.1);
  hover.add(waist);

  const ABD_LEN = HD * 1.46;
  const ABD_R = HD * 0.375;
  const abdomen = new THREE.Mesh(mosquitoAbdomenGeometry(ABD_LEN, ABD_R), [
    bodyMat,
    creaseMat,
  ]);
  abdomen.name = "abdomen";
  // The lathe is built along +Y; swing it to point REARWARD and 44° down.
  //
  // The reference projects a 60.2° droop and a first pass used 56°. Both are too
  // steep FOR THIS GAME, and the map-stripped clay render is what proved it: the
  // play camera sits at 59° elevation (scene.ts BASE_POS), so an abdomen hanging
  // at 56° points almost straight along the view axis and foreshortens to a
  // stub. With colour stripped it had nearly no form presence at all — identity
  // feature #3 carried entirely by two dark bands, which is exactly the failure
  // mode IDEA-053 recorded on the flea.
  //
  // 44° trails the abdomen visibly from above while staying clearly steeper than
  // the bee's 32°. The separator from the bee was never the angle anyway: it is
  // that this abdomen is slender (aspect 0.51) and comes to a point, where the
  // bee's is rounded.
  //
  // Aimed by unit vectors. `rotation.x = PI/2 + 0.977` was tried and points the
  // abdomen forward-down, tucking the model's LONGEST mass under its own head:
  // the measured envelope came back 0.67 long against a solved 0.842, which is
  // how the error was caught. Length is identity feature #3; it has to trail.
  abdomen.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, -0.695, -0.719).normalize(),
  );
  waist.add(abdomen);

  // --- legs: six, splayed wider than the body ------------------------------
  // A capsule's `length` argument is the CYLINDER ONLY — the caps add `radius`
  // on top. So each segment SPANS its joint distance with half a radius of
  // overlap, never a fraction of it: sizing a segment as a fraction of its span
  // is what left the flea's hind leg rendering in three separated pieces
  // (IDEA-053). A knuckle ball then sits at every knee and ankle, because
  // overlap closes a gap ALONG the limb's axis but not ACROSS a ~132° fold,
  // where two tangent capsules leave an open wedge.
  const LEG_R = HD * 0.03;
  const legSwings: THREE.Object3D[] = [];
  const bone = (
    from: THREE.Vector3,
    to: THREE.Vector3,
    name: string,
    parent: THREE.Object3D,
  ): void => {
    const span = from.distanceTo(to);
    const seg = new THREE.Mesh(
      new THREE.CapsuleGeometry(LEG_R, Math.max(0.001, span - LEG_R), 4, 8),
      limbMat,
    );
    seg.name = name;
    seg.position.copy(from).add(to).multiplyScalar(0.5).sub(parent.position);
    seg.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      to.clone().sub(from).normalize(),
    );
    parent.add(seg);
  };
  const knuckle = (at: THREE.Vector3, name: string, parent: THREE.Object3D): void => {
    const k = new THREE.Mesh(new THREE.SphereGeometry(LEG_R * 1.05, 8, 6), limbMat);
    k.name = name;
    k.position.copy(at).sub(parent.position);
    parent.add(k);
  };

  // Solved off the measured yaw/pitch table (evidence/layout.json): front,
  // middle and hind pairs at 64° / 108° / 128° from forward, pitched -38° /
  // -44° / -40°, with the tibia folding to -84°. The resulting knee folds are
  // 131-137°, against the ~132° measured off the reference.
  const LEGS: readonly (readonly [string, number, number, number, number, number, number])[] = [
    // tag, rootZ, kneeX, kneeY, kneeZ, ankleY, ankleZ  (X mirrored per side)
    ["F", 0.0505, 0.145, 0.2335, 0.0977, 0.1029, 0.1004],
    ["M", 0.0, 0.1417, 0.2227, -0.0304, 0.0921, -0.0323],
    ["H", -0.0505, 0.1307, 0.2298, -0.1149, 0.0992, -0.1187],
  ];
  const ANKLE_X = [0.1506, 0.1476, 0.1356];
  const TOE = [
    [0.1632, 0.097, 0.1065],
    [0.1598, 0.0862, -0.0362],
    [0.1464, 0.0933, -0.1271],
  ];
  LEGS.forEach(([tag, rootZ, kx, ky, kz, ay, az], i) => {
    ([-1, 1] as const).forEach((s) => {
      const root = new THREE.Vector3(0.0483 * s, 0.3176, rootZ);
      const swing = new THREE.Group();
      swing.name = `legSwing${tag}${s < 0 ? "L" : "R"}`;
      swing.position.copy(root);
      hover.add(swing);
      legSwings.push(swing);

      const knee = new THREE.Vector3(kx * s, ky, kz);
      const ankle = new THREE.Vector3(ANKLE_X[i] * s, ay, az);
      const toe = new THREE.Vector3(TOE[i][0] * s, TOE[i][1], TOE[i][2]);

      bone(root, knee, `femur${tag}${s < 0 ? "L" : "R"}`, swing);
      knuckle(knee, `knee${tag}${s < 0 ? "L" : "R"}`, swing);
      bone(knee, ankle, `tibia${tag}${s < 0 ? "L" : "R"}`, swing);
      knuckle(ankle, `ankle${tag}${s < 0 ? "L" : "R"}`, swing);
      bone(ankle, toe, `foot${tag}${s < 0 ? "L" : "R"}`, swing);
    });
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
    // The dark cuticle is the thorax, and limbMat the legs and antennae —
    // together a large enough share of the silhouette that leaving them
    // un-recoloured would blunt the "edible now" read. The creases and the
    // thorax gloss are the small-fixed case and are deliberately absent here.
    accentMats: [darkMat, limbMat, wingMat],
    eyes,
    pupPivots,
    pupM,
    pupBaseColor: pupM.color.getHex(),
    baseColor: color,
    // The mosquito's life is the hover, the wing beat and the trailing abdomen,
    // not a hem wobble — so no hem and no skirt, which opts it out of the
    // shared breathe.
    hem: [],
    pupOffset: { x: 0, z: 0 },
    behaviour: beeBehaviour(hover, [waist], wings, antennae, legSwings),
    eyeMats: mosquitoEyeMats,
    spiritMats: collectSpiritMats(g, mosquitoEyeMats),
  };
  g.userData = userData;
  return g;
}

// ---------------------------------------------------------------------------
// THE MAKI ROLL — the fourth img2threejs rebuild (IDEA-056), after the beagle
// (IDEA-047), the flea (IDEA-053), the crab (IDEA-054) and the mosquito
// (IDEA-055). Same split as all four: the pipeline's generated factory sits
// unused in src/render/rework/createMakiModel.ts and the SHIPPED mesh below is
// hand-authored from the numbers that run locked. The evidence trail is
// .img2threejs/maki/ — a per-subject workspace, so a new run never overwrites
// another subject's.
//
// WHY IT EXISTS: every other enemy is a bug. This one is FOOD, and it STANDS
// UP. Those are the two things the shipped cast cannot say, and they are what
// the skin is for — a beagle chasing (and being chased by) its dinner.
//
// PROPORTION BASE: ND = THE NORI DISC DIAMETER, the roll's cut face, measured
// at 1600 px on the reference. Not a head diameter, because this subject has no
// head: the body carries the face directly, there is no neck and no jaw, and a
// "head height" would be an invented boundary every ratio then inherited. Same
// reasoning as the crab's carapace width (IDEA-054). ND = 0.62 here.
//
// Measured against the shipped cast (scripts/_scratch-enemy-cast.ts):
//   the maki is the TALLEST thing in the maze, past the bee's 0.803 crown,
//   while staying well under the crab's 0.896 width — being the widest is the
//   crab's whole identity and this skin must not take it.
const MAKI_SEAM = 0x3a3228; // nori lap laminations — FIXED, deliberately not in accentMats
const MAKI_RICE = 0xf6f1e4; // cooked rice — never team-coloured, on either sushi
const MAKI_SALMON = 0xf26a26; // the face plate
const MAKI_FAT = 0xffd9bd; // pale marbling in the salmon
const MAKI_GLOVE = 0xf4f4f2; // mitten + boot
const MAKI_LIMB = 0x211d1a; // the four limb tubes — IN accentMats
const MAKI_MOUTH = 0x2b0f12; // the cavity's interior
const MAKI_TONGUE = 0xef7d86;
const MAKI_IRIS = 0x3fc4de;
const MAKI_PUPIL = 0x12161c;

// Walk. Slower and heavier than the bugs' scuttle: this thing has two legs and
// big boots, and a 15 rad/s flea-style patter on two limbs reads as a shiver.
const MK_STEP_FREQ = 9; // rad/s
const MK_STEP_SWING = 0.5; // radians at the hip
const MK_ARM_SWING = 0.34; // counter-phase to the legs
const MK_IDLE_FREQ = 1.25 * Math.PI * 2;
const MK_IDLE_ARM = 0.11; // a small hang-and-sway when standing still
const MK_IDLE_LEAN = 0.035; // body roll, so a stopped maki is not a statue

/**
 * The pitch, in radians, that leans the drum BACK.
 *
 * This is a PLAY-CAMERA decision and not a measurement, which is why it is a
 * named constant rather than a number buried in a rotation call. The game
 * camera sits at 59 degrees elevation (scene.ts BASE_POS). A cut face standing
 * vertically projects at cos(59) = 0.515 of its area from there, and the
 * three-zone bullseye on that face is this character's identity rank 1 — half
 * of it is not enough. Leaning back 18 degrees puts the face normal 43 degrees
 * off the view direction (cos 0.73), a 42% larger projected face, at a cost of
 * about 0.06 in crown height.
 *
 * It MUST live on an inner group. applyGhostState assigns `mesh.rotation.x` on
 * the ROOT every time the state changes — 0 when normal, a shiver while
 * frightened — so a pitch authored on the root is erased the first time the
 * beagle eats a bone.
 */
const MK_PITCH = -18 * (Math.PI / 180);

interface MakiParts {
  legs: THREE.Object3D[]; // [left, right] hip pivots
  arms: THREE.Object3D[]; // [left, right] shoulder pivots
  body: THREE.Object3D; // the pitched group, for the idle lean
}

function makiBehaviour(parts: MakiParts): EnemyBehaviour {
  const { legs, arms, body } = parts;
  return {
    animate: (t, idleT, moveBlend) => {
      const step = Math.sin(t * MK_STEP_FREQ) * MK_STEP_SWING * moveBlend;
      legs[0].rotation.x = step;
      legs[1].rotation.x = -step;
      // Arms counter-phase to the legs while walking, and a slow hang-sway
      // while standing. Blended rather than switched, so a stop eases out of
      // the stride instead of snapping to attention.
      const idleArm = Math.sin(idleT * MK_IDLE_FREQ) * MK_IDLE_ARM * (1 - moveBlend);
      arms[0].rotation.x = -step * (MK_ARM_SWING / MK_STEP_SWING) + idleArm;
      arms[1].rotation.x = step * (MK_ARM_SWING / MK_STEP_SWING) - idleArm;
      // A drum on two sticks needs SOME weight shift or it reads as a prop
      // being slid along. This is a roll about the travel axis, added to the
      // fixed pitch, which syncToEntity's own waddle then rides on top of.
      body.rotation.z = Math.sin(idleT * MK_IDLE_FREQ * 0.5) * MK_IDLE_LEAN * (1 - moveBlend * 0.6);
    },
  };
}

/**
 * Builds the maki-roll enemy skin (IDEA-056).
 *
 * Satisfies the same `GhostUserData` contract as every other skin, so game.ts
 * never learns which one is equipped.
 *
 * WHAT TAKES THE TEAM COLOUR: the NORI SLEEVE. That is a real loss — the nori
 * is what says "maki" in the reference — but the alternative is worse. bodyMat
 * has to be the dominant mass or four enemies in four colours stop being
 * distinguishable and the frightened state stops reading, and the sleeve IS the
 * dominant mass. The species survives the repaint the way the beetle and
 * ladybug survive theirs: SHAPE carries it. What keeps a hint of seaweed at
 * every hue is `seamMat`, the lap hairlines, which are their own fixed
 * near-black and are deliberately OUT of accentMats (IDEA-053 rule 2 applied up
 * front rather than rediscovered).
 *
 * WHAT NEVER CHANGES: the RICE. Both sushi skins keep it off the recolour
 * entirely — the maki repaints its WRAPPER, the nigiri repaints its TOPPING,
 * and the off-white rice is the one thing they share at every team colour. It
 * is also, with the gloves and boots, what stops the frightened silhouette
 * collapsing into a single blue mass.
 */
export function makeSushiMaki(color: number): THREE.Group {
  const g = new THREE.Group();

  const ND = 0.62;
  const R = ND / 2; // 0.310  barrel radius
  const L = 0.8 * ND; // 0.496  barrel length, along its own axis
  const RIM = 0.075 * ND; // 0.0465 nori rim thickness, on the radius
  const RR = R - RIM; // 0.2635 rice-bed radius
  const PHW = 0.2555 * ND; // 0.1584 salmon plate half-width
  const PHH = 0.24 * ND; // 0.1488 salmon plate half-height
  const SQ_N = 4; // squircle exponent — the measured corner radius, 0.069 ND
  const GR = 0.029 * ND; // 0.018  rice grain radius
  const GL = 0.089 * ND; // 0.055  rice grain length, tip to tip
  const EYE_R = 0.112 * ND; // 0.0694 eye white radius
  // The mouth is the one dimension SCALED UP from the measurement, and the
  // reason is the same one that sized the crab's pincer gap (IDEA-054 rule 2):
  // scaled honestly from the measured 0.183 x 0.088 ND it closed into a pale
  // sliver at review size, with the tongue and the lip strip fighting over
  // about nine pixels. A cavity has to be legible as an OPENING or it is not
  // doing the job a cavity exists to do.
  const MW = 0.225 * ND; // 0.1395 mouth aperture width  (measured 0.183)
  const MH = 0.125 * ND; // 0.0775 mouth aperture height (measured 0.088)

  // The nori rim stands PROUD of the rice bed, and that step is what makes the
  // roll read as cut rather than printed — it is the shadow line the reference
  // shows all the way round the annulus. Everything on the face is measured
  // back from the rim's front plane at z = L/2.
  const RICE_Z = L / 2 - 0.02;
  /** Mouth centre on the plate — landmark mouthLine 0.724, measured. */
  const MOUTH_Y = -0.0667;

  const bodyMat = toon({ color, emissive: color, emissiveIntensity: 0.15 });
  const seamMat = toon({ color: MAKI_SEAM });
  seamMat.userData.baseColor = MAKI_SEAM;
  const riceMat = toon({ color: MAKI_RICE });
  riceMat.userData.baseColor = MAKI_RICE;
  const salmonMat = toon({ color: MAKI_SALMON });
  salmonMat.userData.baseColor = MAKI_SALMON;
  const fatMat = toon({ color: MAKI_FAT });
  fatMat.userData.baseColor = MAKI_FAT;
  const gloveMat = toon({ color: MAKI_GLOVE });
  gloveMat.userData.baseColor = MAKI_GLOVE;
  // The limbs DO follow the frightened recolour. Four tubes plus their pivots
  // are a real share of the silhouette, which is the large-accent case in
  // GhostUserData's rule — the same call the beetle makes for its legs.
  const limbMat = toon({ color: MAKI_LIMB });
  limbMat.userData.baseColor = MAKI_LIMB;
  // BackSide: this is the INSIDE of the mouth, seen through a real hole in the
  // face plate. Rendering its front faces would put a dark bulge in the hole,
  // which is exactly the defect a cavity is supposed to avoid.
  const mouthMat = toon({ color: MAKI_MOUTH, side: THREE.BackSide });
  mouthMat.userData.baseColor = MAKI_MOUTH;
  const tongueMat = toon({ color: MAKI_TONGUE });
  tongueMat.userData.baseColor = MAKI_TONGUE;

  const scleraMat = toon({ color: 0xffffff });
  const irisMat = toon({ color: MAKI_IRIS });
  const pupM = toon({ color: MAKI_PUPIL });
  // The catchlight. The beagle gets a true MeshBasicMaterial; an enemy cannot,
  // because GhostUserData.eyeMats is typed MeshToonMaterial and those are the
  // materials kept SOLID through the eaten state. A fully emissive toon is the
  // enemy cast's standing answer and reads the same at this size.
  const glintMat = toon({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.5 });
  const makiEyeMats = [scleraMat, irisMat, pupM, glintMat];

  // The pitched group. Everything ABOVE the hips hangs off it; the legs do not,
  // so the lean never tips the stance.
  const body = new THREE.Group();
  body.name = "body";
  body.position.y = 0.4658;
  body.rotation.set(-0.03, 0, 0);
  g.add(body);

  // --- the nori sleeve: barrel and both rims as ONE revolved surface --------
  // Not a cylinder plus two rings. Building the rim as its own primitive puts a
  // shading seam exactly on the circle that identifies the subject, and any
  // mismatch between the two radii opens a crack there. The profile runs from
  // the rear rim's inner edge, out to the barrel, along it, and back in at the
  // front — low end to high end, or every normal points inward.
  const sleeve = new THREE.Mesh(
    latheAlongZ(
      [
        [RR, -L / 2],
        [R, -L / 2],
        [R, L / 2],
        [RR, L / 2],
      ],
      44,
    ),
    bodyMat,
  );
  sleeve.name = "noriSleeve";
  sleeve.castShadow = true;
  sleeve.receiveShadow = true;
  body.add(sleeve);

  // Lap laminations around the barrel. A torus already lies in the XY plane
  // with its axis on Z, which is exactly the barrel's axis — no rotation needed.
  //
  // THREE, THIN AND LOW-CONTRAST, and every one of those three words is a fix.
  // The first pass had four near-black rings at 0.005, and on a red drum they
  // read as TREAD: a dark cylinder on two legs with concentric rings and a pale
  // ring on its face is a tyre, which is this model's recorded rank-1 risk. The
  // laminations still have to be their OWN fixed colour rather than joining
  // accentMats — that is what keeps a hint of seaweed at every team hue — but
  // they only need to be darker than the sleeve, not black.
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R + 0.001, 0.0022, 4, 24), seamMat);
    ring.name = `noriSeam${i}`;
    ring.position.z = -L / 2 + (L * (i + 0.5)) / 3;
    body.add(ring);
  }

  // One seed, one draw order: the scatter is decided HERE, at build time, and
  // never re-rolled. A grain ring that changed between two calls would make the
  // four enemies of one skin visibly different objects.
  const rand = rng(0x5a5b1);

  /**
   * One cut face: rice bed, grain annulus, salmon plug. `front` gets the face.
   *
   * BOTH faces are built in the SAME local coordinates, at +z, and the rear one
   * is then turned round by rotating its whole GROUP. The first pass instead
   * carried a `sign` through every part's position, and the salmon plug's
   * expression got it backwards: the rear plate landed at z = +0.202, buried
   * inside the FRONT plate, leaving the rear of the roll as an open grey bowl
   * with the mouth cavity's lit back wall floating in it. One rotation on the
   * parent cannot be got wrong the way eight sign expressions can.
   */
  const buildFace = (front: boolean): THREE.Group => {
    const face = new THREE.Group();
    // Every part gets the face's suffix. Both cut faces come out of this one
    // function, so without it the model carries two meshes called "riceBed" and
    // two called "salmonPlate" — which the editor's part tree, its picking and
    // its save-in-place all key off by NAME, and a duplicate there silently
    // targets whichever one the traversal reaches first.
    const sfx = front ? "Front" : "Rear";
    face.name = "face" + sfx;
    if (!front) face.rotation.y = Math.PI;
    const z = RICE_Z;

    // The bed. Its job is to be the surface the grains sit ON and to stop the
    // annulus being see-through; the grains do the actual reading.
    //
    // It is an ANNULUS, not a disc, and that is what makes the mouth possible.
    // As a full disc it sat directly behind the salmon plate and therefore
    // directly behind the plate's mouth HOLE — so what showed through the
    // opening was cream rice, and the cavity, correctly built and correctly
    // back-faced, was simply occluded by a part nobody thought of as being in
    // the way. Its inner radius is under the plate everywhere (the plate's
    // closest approach to the centre is PHH = 0.149), so nothing is lost.
    const bed = new THREE.Mesh(
      latheAlongZ(
        [
          [0.125, -0.012],
          [RR, -0.012],
          [RR, 0.012],
          [0.125, 0.012],
        ],
        30,
      ),
      riceMat,
    );
    bed.name = "riceBed" + sfx;
    bed.position.z = z - 0.008;
    bed.receiveShadow = true;
    face.add(bed);

    // The grain annulus. Two rows FOLLOWING THE PLATE'S OWN CONTOUR rather than
    // a circle: scattered on a circle the ring leaves four fat gaps at the
    // plate's flat sides and pinches against its corners. Deterministically
    // seeded, and decided once here — nothing about the scatter is re-rolled at
    // runtime.
    // The inner row follows the PLATE's contour offset outward; the outer row
    // follows the nori rim. Two different guides, because the annulus is
    // bounded by two different curves.
    type GrainRow = { count: number; contour: number | null; ring: number };
    // THREE rows on the front, and the third one is not padding. The reference's
    // rice ring is a thick crowded mass three grains deep; at two rows the
    // annulus read as a thin braid with the nori showing through behind it,
    // which is the same "reads as a wheel" risk the seam rings carry. The rear
    // pays for it — one row there, because that face is only ever seen while
    // the enemy is running away, and at that moment it is a plain cut roll.
    const rows: GrainRow[] = front
      ? [
          { count: 20, contour: 0.024, ring: 0 },
          { count: 24, contour: 0.056, ring: 0 },
          { count: 26, contour: null, ring: RR - 0.02 },
        ]
      : [{ count: 18, contour: null, ring: RR - 0.023 }];
    // The grains live under ONE named group per face, not loose on the face.
    // The spec calls the annulus a single component and the part-coverage gate
    // reads it that way; it is also what makes the ring explodable and
    // selectable as the one thing it actually is.
    const grains = new THREE.Group();
    grains.name = "riceGrains" + sfx;
    face.add(grains);
    let gi = 0;
    for (const row of rows) {
      for (let i = 0; i < row.count; i++) {
        const theta = ((i + rand() * 0.5) / row.count) * Math.PI * 2;
        const base =
          row.contour !== null
            ? squircleRadius(theta, PHW, PHH, SQ_N) + row.contour
            : row.ring;
        const r = Math.min(base + (rand() - 0.5) * 0.012, RR - GR * 0.55);
        const grain = new THREE.Mesh(
          new THREE.CapsuleGeometry(GR, Math.max(0.004, GL - GR * 2), 2, 6),
          riceMat,
        );
        grain.name = `riceGrains${sfx}${gi++}`;
        // A capsule's axis is +Y, so a Z rotation lays it in the face plane.
        // Grains run roughly TANGENTIALLY around the ring, which is what the
        // reference shows, with enough jitter that no two neighbours line up.
        grain.rotation.z = theta + (rand() - 0.5) * 1.1;
        grain.rotation.y = (rand() - 0.5) * 0.5;
        grain.position.set(r * Math.cos(theta), r * Math.sin(theta), z + 0.006);
        grain.castShadow = false;
        grains.add(grain);
      }
    }

    // The salmon plug. On the FRONT it carries the mouth as a real HOLE in its
    // own outline — the plate genuinely has no material where the mouth is —
    // rather than a dark shape laid on top of it. Shape.holes is exact boolean
    // subtraction on a flat plate and costs nothing.
    const outline = squirclePoints(PHW, PHH, SQ_N, 44);
    const plateShape = shapeFromPoints(outline);
    if (front) {
      const hole = smileHolePoints(MW / 2, MH, 14);
      const holePath = pathFromPoints(hole.map((p) => new THREE.Vector2(p.x, p.y + MOUTH_Y)));
      plateShape.holes.push(holePath);
    }
    const plate = new THREE.Mesh(
      new THREE.ExtrudeGeometry(plateShape, {
        depth: 0.026,
        bevelEnabled: true,
        bevelThickness: 0.008,
        bevelSize: 0.008,
        bevelSegments: 1,
        curveSegments: 1,
      }),
      salmonMat,
    );
    plate.name = "salmonPlate" + sfx;
    // ExtrudeGeometry builds forward along +Z from the shape plane, so the
    // plate is pushed back by its own depth to land its FRONT face just inside
    // the nori rim (rim front z = L/2 = 0.248; plate front lands at 0.236).
    plate.position.z = z - 0.026;
    plate.scale.setScalar(front ? 1 : 0.9);
    plate.castShadow = false;
    face.add(plate);

    if (!front) return face;

    // Fat striations. Each is the INTERSECTION of a band with the plate's own
    // outline, so both ends of every stripe land on the plate's curve. A stripe
    // drawn as its own little rounded rectangle would stop short of the edge and
    // read as a floating dash — IDEA-054's sticker rule in two dimensions.
    // [angle from +X, offset along the band normal, width].
    //
    // Every offset is chosen to CLEAR THE MOUTH. The stripes lie on the plate's
    // front face, and the mouth is a real hole in that face, so a stripe
    // crossing it would bridge the opening — which is precisely what the first
    // pass did: the stripes sat BEHIND the plate, invisible except through the
    // hole, where one showed up as a tan bar across the mouth. Along this
    // band's normal the mouth occupies -0.127..+0.017 and the plate reaches
    // +/-0.212, so the four upper stripes start at +0.05 and the single lower
    // one sits past -0.15. The reference spreads its marbling over the whole
    // plate; here the middle belongs to the mouth, and a stripe cut off at the
    // mouth's edge would put the same straight ruler line across every one.
    const bands: [number, number, number][] = [
      [0.6, -0.168, 0.017],
      [0.6, 0.052, 0.02],
      [0.55, 0.098, 0.014],
      [0.64, 0.146, 0.017],
      [0.58, 0.19, 0.011],
    ];
    let si = 0;
    for (const [angle, offset, width] of bands) {
      const clipped = clipPolygonToBand(outline, angle, offset, width);
      if (clipped.length < 3) continue; // the band missed the plate entirely
      const stripe = new THREE.Mesh(
        new THREE.ExtrudeGeometry(shapeFromPoints(clipped), {
          depth: 0.004,
          bevelEnabled: false,
          curveSegments: 1,
        }),
        fatMat,
      );
      stripe.name = `fatStriations${si++}`;
      // In FRONT of the plate's front face (which the bevel carries out to
      // z + 0.008), not inside it.
      stripe.position.z = z + 0.0095;
      stripe.castShadow = false;
      face.add(stripe);
    }
    return face;
  };

  const faceFront = buildFace(true);
  const faceRear = buildFace(false);
  body.add(faceFront, faceRear);

  // --- the mouth's interior ------------------------------------------------
  // A sphere sitting BEHIND the hole, rendered back-side, so what shows through
  // the opening is the inside of its far wall: genuinely concave, genuinely
  // darkest-on-the-model. Squashed on Z so the cavity is shallow rather than a
  // tunnel into the roll.
  // Its front pole must sit BEHIND the plate's front face, or the sphere pushes
  // out through its own hole and the cavity becomes a bulge — the exact defect
  // it exists to avoid. The plate spans z 0.200..0.234; this lands the pole at
  // 0.218, inside that thickness, so what shows through the opening is the
  // inside of the far wall.
  const cavity = new THREE.Mesh(new THREE.SphereGeometry(MW * 0.62, 16, 10), mouthMat);
  cavity.name = "mouthCavity";
  cavity.scale.set(1, 0.9, 0.42);
  cavity.position.set(0, MOUTH_Y, RICE_Z - 0.024);
  faceFront.add(cavity);

  const tongue = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 9), tongueMat);
  tongue.name = "tongue";
  tongue.scale.set(1.05, 0.55, 0.5);
  tongue.position.set(0, MOUTH_Y - MH * 0.3, RICE_Z - 0.018);
  faceFront.add(tongue);

  // NO separate lip strip. The first pass had one, a thin cream bar across the
  // aperture's top edge, and it read as a bandage laid over the mouth rather
  // than as an upper lip — at review size it was wider than the opening was
  // tall. The extrusion's own BEVEL already turns the hole's edge into a lit
  // chamfer, which is the same read for no extra mesh.

  // --- eyes ----------------------------------------------------------------
  // The measured pair spans 0.58 ND against a plate 0.511 ND wide, so the eye
  // whites reach the plate's edge and touch the rice. That overhang is observed,
  // not a modelling error, and the build reproduces it.
  const eyeCap = (
    factor: number,
    thetaStart: number,
    thetaLen: number,
    mat: THREE.MeshToonMaterial,
  ): THREE.Mesh => {
    const geo = new THREE.SphereGeometry(
      EYE_R * factor,
      16,
      10,
      0,
      Math.PI * 2,
      thetaStart,
      thetaLen,
    );
    geo.rotateX(Math.PI / 2); // pole from +Y to +Z — the gaze direction
    return new THREE.Mesh(geo, mat);
  };

  const eyes: THREE.Object3D[] = [];
  const pupPivots: THREE.Object3D[] = [];
  for (const s of [1, -1]) {
    // A GROUP carries the flattening, not the ball. Scaling the ball alone
    // would leave the pupil and glint caps floating off a surface that had
    // moved underneath them; scaling their shared parent moves caps and ball
    // together, so they stay exactly flush however flat the eye is.
    const eye = new THREE.Group();
    eye.name = s > 0 ? "eyeL" : "eyeR";
    eye.position.set(s * 0.0905, 0.0441, RICE_Z + 0.012);
    eye.scale.set(1, 1, 0.55);
    faceFront.add(eye);

    const ball = new THREE.Mesh(new THREE.SphereGeometry(EYE_R, 18, 12), scleraMat);
    ball.name = s > 0 ? "eyeBallL" : "eyeBallR";
    eye.add(ball);

    // The dart pivot. A decal cap must stay centred on its form to hug it, so
    // it is never TRANSLATED — applyGhostState rotates this pivot instead and
    // the caps sweep across the surface while staying flush.
    const pivot = new THREE.Group();
    pivot.name = s > 0 ? "pupilPivotL" : "pupilPivotR";
    eye.add(pivot);

    const pupil = eyeCap(1.02, 0, 0.77, pupM);
    pupil.name = s > 0 ? "pupilL" : "pupilR";
    pivot.add(pupil);
    // The cyan is an ANNULUS around the pupil's rim, not an iris disc behind a
    // pupil — the pupil mass is in front of it. At 0.012 world units it is a
    // shape claim, well below the size at which any colour gate can read it.
    const iris = eyeCap(1.035, 0.6, 0.19, irisMat);
    iris.name = s > 0 ? "irisL" : "irisR";
    pivot.add(iris);
    const glint = eyeCap(1.05, 0, 0.235, glintMat);
    glint.name = s > 0 ? "glintL" : "glintR";
    glint.rotation.set(-0.5, s * 0.5, 0);
    pivot.add(glint);

    eyes.push(eye, ball, pupil, iris, glint);
    pupPivots.push(pivot);

    // Brows. The tilt IS the expression: level bars read as surprise, and these
    // are the only part of this face that can carry a mood at all.
    const brow = new THREE.Mesh(new THREE.CapsuleGeometry(0.013, 0.038, 3, 8), pupM);
    brow.name = s > 0 ? "browL" : "browR";
    brow.rotation.set(0, 0, Math.PI / 2 - s * 0.24);
    brow.position.set(s * 0.0905, 0.1366, RICE_Z + 0.018);
    faceFront.add(brow);
    eyes.push(brow);
  }

  // --- arms ----------------------------------------------------------------
  const arms: THREE.Object3D[] = [];
  for (const s of [1, -1]) {
    const pivot = new THREE.Group();
    pivot.name = s > 0 ? "armPivotL" : "armPivotR";
    // The shoulder sits on the barrel's WIDEST ring — x = +/-R at y = 0 — and
    // is nudged forward so the arm hangs in front of the flank rather than
    // along it. The first pass put it at R - 0.03 and swung it only 12 degrees
    // out, which tucked the whole arm INSIDE a barrel of radius R: the model
    // rendered with no arms at all and a single white blob where one mitt
    // clipped through the sleeve. A limb on a cylinder has to clear the
    // cylinder, which is a different sum from a limb on a torso.
    // z = 0.14 puts the shoulder toward the FRONT of a 0.496-long barrel. At
    // the barrel's mid-length the arm reads as a nub growing out of a wall,
    // because there is a quarter of a roll behind it in every three-quarter
    // view; forward, it has the front rim to be silhouetted against.
    pivot.position.set(s * (R - 0.012), -0.01, 0.14);
    // 23 degrees out, the reference's own angle. Still under the crab's 0.896,
    // and being the widest thing in the maze is the crab's identity, not this
    // one's.
    //
    // THE SIGN IS THE WHOLE FIX. A child hanging at (0, -h, 0) under a pivot
    // rotated by `rotation.z` lands at x = h * sin(z) — so a POSITIVE z swings
    // it toward +x. Both earlier passes used `s * -0.21` and then `s * -0.4`,
    // which swung each arm toward the median plane and buried it in a barrel of
    // radius R. The model rendered with no arms and one white blob where a mitt
    // clipped out through the sleeve, and widening the angle only buried them
    // deeper — the measurement never moved off 0.65, which is what said the
    // problem was direction and not distance.
    pivot.rotation.z = s * 0.4;
    body.add(pivot);

    const tube = new THREE.Mesh(new THREE.CapsuleGeometry(0.024, 0.086, 3, 9), limbMat);
    tube.name = s > 0 ? "armL" : "armR";
    tube.position.y = -0.068;
    tube.castShadow = true;
    pivot.add(tube);

    const mitt = new THREE.Mesh(new THREE.SphereGeometry(0.05, 14, 10), gloveMat);
    mitt.name = s > 0 ? "mittL" : "mittR";
    mitt.scale.set(1, 0.94, 0.82);
    mitt.position.y = -0.138;
    mitt.castShadow = true;
    pivot.add(mitt);

    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, 0.024, 3, 7), gloveMat);
    thumb.name = s > 0 ? "mittThumbL" : "mittThumbR";
    thumb.rotation.set(0.4, 0, s * -0.8);
    thumb.position.set(s * 0.036, -0.124, 0.02);
    pivot.add(thumb);

    arms.push(pivot);
  }

  // --- legs ----------------------------------------------------------------
  // Children of the ROOT, not of the pitched body: the drum leans, the stance
  // does not. The hip sits where the barrel's underside ends up AFTER the
  // pitch — the body-local (+/-0.1178, -0.2868, 0) attachment carried through
  // MK_PITCH, which moves it up to -0.2728 and forward to +0.0886.
  const legs: THREE.Object3D[] = [];
  for (const s of [1, -1]) {
    const pivot = new THREE.Group();
    pivot.name = s > 0 ? "legPivotL" : "legPivotR";
    pivot.position.set(s * 0.1178, 0.193, 0.0886);
    g.add(pivot);

    const tube = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.07, 3, 9), limbMat);
    tube.name = s > 0 ? "legL" : "legR";
    tube.position.y = -0.062;
    tube.castShadow = true;
    pivot.add(tube);

    // The ankle mass. Kept SHORTER than the toe on Z so the boot has a heel to
    // sit over the leg and a snout to point where it is going.
    const boot = new THREE.Mesh(new THREE.SphereGeometry(0.048, 14, 10), gloveMat);
    boot.name = s > 0 ? "bootL" : "bootR";
    boot.scale.set(0.95, 0.86, 1.15);
    boot.position.set(0, -0.152, -0.004);
    boot.castShadow = true;
    pivot.add(boot);

    // The toe. The first pass had it at 0.9 on Z, tucked INSIDE a boot already
    // 1.35 long, so the two spheres read as one ball: no front, no back, and a
    // walk cycle that looked like sliding. It has to project past the ankle
    // mass to be a toe at all.
    const toe = new THREE.Mesh(new THREE.SphereGeometry(0.04, 14, 10), gloveMat);
    toe.name = s > 0 ? "bootToeL" : "bootToeR";
    toe.scale.set(0.98, 0.66, 1.5);
    toe.position.set(0, -0.163, 0.058);
    pivot.add(toe);

    legs.push(pivot);
  }

  const userData: GhostUserData = {
    bodyMat,
    eyes,
    pupPivots,
    pupM,
    pupBaseColor: pupM.color.getHex(),
    baseColor: color,
    // No hem and no skirt: this one walks, so it opts out of the shared ghost
    // breathe and supplies its own stride and idle sway instead.
    hem: [],
    pupOffset: { x: 0, z: 0 },
    accentMats: [limbMat],
    behaviour: makiBehaviour({ legs, arms, body }),
    eyeMats: makiEyeMats,
    spiritMats: collectSpiritMats(g, makiEyeMats),
  };
  g.userData = userData;
  return g;
}

// ---------------------------------------------------------------------------
// THE EBI NIGIRI — the fifth img2threejs rebuild (IDEA-057), and the maki's
// sibling. Same split as every rebuild before it: the generated factory sits
// unused in src/render/rework/createNigiriModel.ts and the SHIPPED mesh below
// is hand-authored from the numbers the run locked. Evidence in
// .img2threejs/nigiri/.
//
// THE TOPPING IS PRAWN (ebi), NOT SALMON. Seven transverse lobes with pale
// bands between them, and a three-blade tail fan standing up at the rear. A
// salmon slice has neither — it is one smooth mass with irregular marbling.
// Reading the reference as salmon would have produced a smooth orange pillow
// with stripes painted on it and lost the feature that carries the topping.
//
// PROPORTION BASE: RW = THE RICE BLOCK WIDTH. No head again, and here the block
// is not even square, so a "head height" would have been a choice every ratio
// then inherited. RW = 0.56.
//
// THIS MODEL IS BUILT AGAINST ONE RISK: THE MAKI. The two ship together, both
// take the team colour, and both are recoloured AGAIN when frightened — so
// colour cannot separate them, exactly as it could not separate the mosquito
// from the bee (IDEA-055). Seven measured separators do it instead: a square
// block against a round drum; a pale dominant mass against a dark one; a face
// on a smooth panel against a face on a saturated plug; small upright eyes
// under a gold lid line against big ones with brows and a cyan iris ring
// (0.072 across against 0.139 — they were half-lidded until v2 opened them, so
// the separator is SIZE and furniture, not how far each is closed); a closed
// mouth curve against an open
// cavity with a tongue; bare feet against oversized boots; and a tail fan where
// the maki has nothing above its crown.
//
// The eighth separator is the one that matters most and it is not a shape: THE
// TWO RECOLOUR IN OPPOSITE PLACES. The maki's bodyMat is its WRAPPER, so its
// pale centre stays pale while its outside changes. This one's bodyMat is its
// TOPPING, so its pale block stays pale while its top changes. They never
// converge on the same picture at any team colour.
const NG_RICE = 0xf7f2e6; // the block and every grain — never team-coloured
const NG_BAND = 0xffe9d6; // the pale banding between prawn lobes — FIXED
const NG_NORI = 0x242a30; // the belt — FIXED, and deliberately not in accentMats
const NG_BLUSH = 0xf2938c;
const NG_EYE = 0x2b1d16;
const NG_LID = 0xc98b3f;
const NG_MOUTH = 0x8a4a33;

// Walk. A shade slower than the maki's 9 rad/s: this one is a heavier, squatter
// block on stubby feet, and a quick patter on those reads as a shiver.
const NG_STEP_FREQ = 8;
const NG_STEP_SWING = 0.34; // small — the feet barely clear the block
const NG_ARM_SWING = 0.26;
const NG_IDLE_FREQ = 1.15 * Math.PI * 2;
const NG_CAP_LAG = 0.055; // the cap is DRAPED, so it trails the body's bob
const NG_IDLE_ARM = 0.1;

interface NigiriParts {
  feet: THREE.Object3D[];
  arms: THREE.Object3D[];
  cap: THREE.Object3D;
}

function nigiriBehaviour(parts: NigiriParts): EnemyBehaviour {
  const { feet, arms, cap } = parts;
  const capRest = cap.rotation.x;
  return {
    animate: (t, idleT, moveBlend) => {
      const step = Math.sin(t * NG_STEP_FREQ) * NG_STEP_SWING * moveBlend;
      feet[0].rotation.x = step;
      feet[1].rotation.x = -step;
      const idleArm = Math.sin(idleT * NG_IDLE_FREQ) * NG_IDLE_ARM * (1 - moveBlend);
      arms[0].rotation.x = -step * (NG_ARM_SWING / NG_STEP_SWING) + idleArm;
      arms[1].rotation.x = step * (NG_ARM_SWING / NG_STEP_SWING) - idleArm;
      // The prawn is LAID on the rice, not glued to it, so it lags the body.
      // Half the walk frequency and a quarter turn behind, which reads as
      // weight settling rather than as a second animation.
      cap.rotation.x =
        capRest +
        Math.sin(t * NG_STEP_FREQ * 0.5 - Math.PI / 2) * NG_CAP_LAG * moveBlend;
    },
  };
}

/**
 * Builds the ebi-nigiri enemy skin (IDEA-057).
 *
 * WHAT TAKES THE TEAM COLOUR: the PRAWN — the cap, the arms and the feet, which
 * share one material because the reference shares one colour across them. That
 * is the opposite choice from the maki, and it is deliberate. It also means the
 * RICE BLOCK is fixed cream and stays OUT of accentMats: the block is the
 * neutral all four team colours are read against, and if it followed the
 * frightened recolour the block and the cap would go blue together and the
 * two-mass stack — this subject's identity rank 1 — would collapse into one
 * shape exactly while the player is chasing it. Same reasoning keeps the nori
 * belt fixed (IDEA-053 rule 2).
 */
export function makeNigiri(color: number): THREE.Group {
  const g = new THREE.Group();

  const RW = 0.56; // proportion base: the rice block width
  const HW = RW / 2; // 0.280  block half-width
  const BH = 0.812 * RW; // 0.4547 block height
  const HD = (0.72 * RW) / 2; // 0.2016 block half-depth — INFERRED, the lowest-confidence number here
  const SQ_N = 3.4; // block footprint squircle exponent — flat-ish front, soft corners
  const CW = 1.079 * RW; // 0.6042 cap width (WIDER than the block: it drapes)
  const BELT_H = 0.218 * RW; // 0.1221
  const PANEL_H = 0.366 * RW; // 0.2050
  // Bigger and prouder than the maki's, and for a reason the maki does not
  // have: those grains sit in an annulus between a dark rim and a saturated
  // plate, so their edges are always against contrast. These sit on a cream
  // block in the same cream, where a flat toon band gives them almost nothing
  // to read against — at the maki's size the whole skirt disappeared and the
  // block rendered as a bar of soap.
  const GR = 0.027 * RW; // rice grain radius
  const GL = 0.082 * RW; // rice grain length

  const FLOOR = 0.03; // the block's underside; the feet poke out below it
  const TOP = FLOOR + BH; // 0.4847 block top
  const BELT_TOP = TOP - 0.451 * BH; // 0.2796 — measured: 0.451 down the block
  const PANEL_TOP = TOP;

  const bodyMat = toon({ color, emissive: color, emissiveIntensity: 0.15 });
  const bandMat = toon({ color: NG_BAND });
  bandMat.userData.baseColor = NG_BAND;
  const riceMat = toon({ color: NG_RICE });
  riceMat.userData.baseColor = NG_RICE;
  const noriMat = toon({ color: NG_NORI });
  noriMat.userData.baseColor = NG_NORI;
  const blushMat = toon({ color: NG_BLUSH });
  blushMat.userData.baseColor = NG_BLUSH;
  const lidMat = toon({ color: NG_LID });
  const mouthMat = toon({ color: NG_MOUTH });
  mouthMat.userData.baseColor = NG_MOUTH;
  // The cast's own sclera cream, deliberately the same value the other nine
  // use — the eye is the one part of an enemy that should read as belonging to
  // the same set whatever the enemy is made of.
  const scleraMat = toon({ color: 0xfdf9f2 });
  const pupM = toon({ color: NG_EYE });
  const glintMat = toon({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.5 });
  const nigiriEyeMats = [scleraMat, pupM, lidMat, glintMat];

  /** The block's OUTER surface — where the belt, the grains and the face marks
   *  all have to sit. */
  const footprint = squirclePoints(HW, HD, SQ_N, 44);

  // --- the rice block: a smooth squircle PILLOW -----------------------------
  // Not an ExtrudeGeometry with a bevel, and both reasons are recorded in
  // squirclePillow's own doc comment. The short version: the bevel grows
  // OUTWARD, so the first build came out 0.650 x 0.493 against an intended
  // 0.560 x 0.403 and swallowed the belt, the whole grain skirt and every mark
  // on the face — three systems invisible, one cause, and MEASURING the parts is
  // what found it, because what renders is a perfectly plausible plain block.
  // And an extrusion is non-indexed, so its bevel steps cannot be smoothed and
  // the toon ramp turns them into rectangular patches across the model's
  // largest surface.
  const block = new THREE.Mesh(squirclePillow(HW, HD, BH, SQ_N, 4, 34, 18), riceMat);
  block.name = "riceBlock";
  block.position.y = FLOOR;
  block.castShadow = true;
  block.receiveShadow = true;
  g.add(block);

  // --- the rice grain skirt -------------------------------------------------
  // Grains cover the sides and the underside and STOP at the face panel. That
  // mask is what makes the face possible: grains across the front would bury
  // every feature on it, and grains nowhere would make the block a bar of soap.
  const rand = rng(0x1691a1);
  const skirt = new THREE.Group();
  skirt.name = "riceGrainSkirt";
  g.add(skirt);
  let gi = 0;
  const BANDS = 6;
  for (let b = 0; b < BANDS; b++) {
    // Kept clear of the top and bottom bevels, where the block pulls in and a
    // grain placed at full radius would float off it.
    const y = FLOOR + 0.062 + (b / (BANDS - 1)) * (BH - 0.13);
    const inPanelBand = y > BELT_TOP + 0.012;
    const count = 13;
    for (let i = 0; i < count; i++) {
      const theta = ((i + (b % 2) * 0.5 + rand() * 0.35) / count) * Math.PI * 2;
      // The panel is the block's FRONT, so skip the forward arc — but only in
      // the height band the panel actually occupies. Below the belt the grains
      // wrap all the way round, which is what the reference shows.
      const front = Math.abs(Math.atan2(Math.sin(theta), Math.cos(theta)) - Math.PI / 2);
      if (inPanelBand && front < 0.95) continue;
      // Pushed OUT by half a grain radius: centred exactly on the surface, half
      // of every grain is inside the block and the skirt reads as a texture
      // rather than as beads.
      // Proud by a QUARTER of a radius, not a half. At half the skirt read as a
      // ring of studs bolted to the block rather than as grains pressed into
      // it — the grains have to sit IN the surface, with their shoulders
      // showing, which is what the reference's pressed rice looks like.
      const r = squircleRadius(theta, HW, HD, SQ_N) + GR * 0.22 + (rand() - 0.5) * 0.006;
      const grain = new THREE.Mesh(
        new THREE.CapsuleGeometry(GR, Math.max(0.004, GL - GR * 2), 1, 5),
        riceMat,
      );
      grain.name = `riceGrainSkirt${gi++}`;
      grain.position.set(r * Math.cos(theta), y, r * Math.sin(theta));
      // A capsule's axis is +Y, which is ALREADY tangent to a vertical-sided
      // block — so an unrotated grain lies flat against it. The variation has to
      // be a spin about the surface NORMAL, which keeps it flat; the first pass
      // used three loose Euler angles instead and tipped every grain outward, so
      // the skirt read as a ring of rivets bolted to the block.
      grain.quaternion.setFromAxisAngle(
        new THREE.Vector3(Math.cos(theta), 0, Math.sin(theta)),
        rand() * Math.PI,
      );
      grain.rotateX((rand() - 0.5) * 0.3);
      skirt.add(grain);
    }
  }
  // The underside ring, so the block never reads as a machined solid from below.
  for (let i = 0; i < 12; i++) {
    const theta = ((i + rand() * 0.4) / 12) * Math.PI * 2;
    const r = squircleRadius(theta, HW, HD, SQ_N) * 0.62;
    const grain = new THREE.Mesh(
      new THREE.CapsuleGeometry(GR, Math.max(0.004, GL - GR * 2), 1, 5),
      riceMat,
    );
    grain.name = `riceGrainSkirt${gi++}`;
    grain.position.set(r * Math.cos(theta), FLOOR + 0.022, r * Math.sin(theta));
    // The underside's own normal is -Y, so here the flat-lying orientation is
    // the one with the capsule laid horizontal.
    grain.rotation.set(Math.PI / 2, theta + (rand() - 0.5) * 1.2, 0);
    skirt.add(grain);
  }

  // --- the nori belt --------------------------------------------------------
  // The block's own footprint scaled out, with the unscaled footprint as a
  // HOLE: a closed wall that follows the block exactly. A scaled box would
  // float off the flanks wherever the squircle is not a box.
  const beltShape = shapeFromPoints(footprint.map((p) => p.clone().multiplyScalar(1.035)));
  beltShape.holes.push(pathFromPoints(footprint.map((p) => p.clone().multiplyScalar(0.99))));
  const beltGeo = new THREE.ExtrudeGeometry(beltShape, {
    depth: BELT_H,
    bevelEnabled: false,
    curveSegments: 1,
  });
  beltGeo.rotateX(-Math.PI / 2);
  const belt = new THREE.Mesh(beltGeo, noriMat);
  belt.name = "noriBelt";
  // ExtrudeGeometry runs from the position UPWARD once the geometry is stood
  // up, so the belt has to start a full belt-height below its measured TOP.
  // Placed at BELT_TOP it sat over the face panel instead of under it.
  belt.position.y = BELT_TOP - BELT_H;
  belt.castShadow = true;
  g.add(belt);

  // The belt carries the strongest specular in the whole reference — a broad
  // bright sweep along its upper half. A toon ramp cannot produce that from
  // lighting: it quantises the highlight into the same band as everything else
  // facing the light. So the sheen is GEOMETRY in a lighter tone, which is the
  // same call the project already makes for the eye glint.
  const sheenShape = shapeFromPoints(footprint.map((p) => p.clone().multiplyScalar(1.042)));
  sheenShape.holes.push(pathFromPoints(footprint.map((p) => p.clone().multiplyScalar(1.03))));
  const sheenGeo = new THREE.ExtrudeGeometry(sheenShape, {
    depth: BELT_H * 0.17,
    bevelEnabled: false,
    curveSegments: 1,
  });
  sheenGeo.rotateX(-Math.PI / 2);
  const sheen = new THREE.Mesh(sheenGeo, bandMat);
  sheen.name = "beltSheen";
  sheen.position.y = BELT_TOP - BELT_H * 0.34;
  g.add(sheen);

  // --- the prawn cap --------------------------------------------------------
  // A tube swept along Z whose radius OSCILLATES seven times, so the lobes are
  // in the SILHOUETTE and not only in the paint — a smooth pillow with stripes
  // on it is salmon, and this is a prawn. The pale bands are per-triangle
  // material groups at the radius minima, assigned by RING index.
  const CAP_R = CW / 2;
  // 0.94, not 1.1. At 1.1 the cap reached PAST the block's own front face, and
  // from the game camera at 59 degrees elevation that overhang put the entire
  // face panel in shadow behind it — the model rendered from the one framing
  // the game actually uses with no eyes visible at all. Pulled back to just
  // inside the block, the block's top-front edge stays clear and the face is
  // read at a grazing angle instead of not at all.
  const CAP_HALF_L = HD * 0.94;
  const RINGS = 85;
  const capRings: BandedRing[] = [];
  for (let i = 0; i < RINGS; i++) {
    const t = i / (RINGS - 1);
    // Ends closed, fat through the middle. Without the closure the cap is an
    // open tube and you see straight down inside it from the front.
    const envelope = Math.pow(Math.max(0, 1 - Math.pow((t - 0.5) * 2, 6)), 0.34);
    const lobe = 1 + 0.06 * Math.cos(7 * Math.PI * 2 * t + Math.PI);
    // A band ring is one near a lobe VALLEY, and the valleys are at
    // (2n-1)/14 — NOT at k/7, which is where the PEAKS are. The first pass
    // tested `(t*7) % 1` against a window instead, which is a test for the
    // peaks, and with the ring spacing at 0.014 it happened to catch exactly
    // one of them: the cap shipped with a single pale swoosh instead of six
    // bands, and it read as a smooth pillow with a stripe on it, which is
    // salmon. Naming the valleys directly makes the count exact.
    let band = false;
    for (let n = 1; n <= 7; n++) {
      if (Math.abs(t - (2 * n - 1) / 14) < 0.0125) band = true;
    }
    if (t < 0.05 || t > 0.95) band = false;
    capRings.push({
      r: Math.max(0.0015, CAP_R * envelope * lobe),
      z: (t - 0.5) * 2 * CAP_HALF_L,
      band,
    });
  }
  // A HALF tube (theta 0..PI), and that is the fix for the worst defect this
  // model had. As a FULL tube centred on the block's top plane, half its volume
  // was inside the block — which is fine at the flanks, where it reads as
  // draping — but at the front, where the sweep has not yet tapered, that lower
  // half hung down over the block's FRONT FACE and swallowed the entire face
  // panel. The model rendered with no eyes, no blush and no mouth, and no
  // amount of moving it up fixed that without lifting it off the rice
  // altogether. An arc seated just under the top plane drapes at the flanks and
  // never descends past it at the front.
  // The arc runs PAST horizontal at both ends (-0.38 to PI+0.38), and that is
  // what closes the gap between the prawn and the rice. A clean half tube ends
  // in a flat, horizontally-cut open rim — and because the cap is deliberately
  // WIDER than the block (0.302 against 0.280 on the half-width; it drapes),
  // that rim overhangs with nothing underneath it. The result is a hard
  // straight seam all the way round and daylight under the shoulder at any low
  // angle. Lowering the cap cannot fix it: the block is a pillow, so it is
  // narrower still at every height above its own mid-point, and there is no
  // height at which it is as wide as the cap. Carrying the arc below the
  // horizontal curls the rim DOWN onto the block's flank instead, which is
  // both what closes the gap and what the reference actually shows.
  //
  // 0.2 rad, and the value is bounded on BOTH sides. Too little and the flat
  // rim comes back; at 0.38 the cap draped all the way to the nori belt, buried
  // the rice skirt on both flanks and cost the two-mass stack — this subject's
  // identity rank 1 — from every side view. The prawn IS wider than the rice
  // and a shadowed underside is correct; what is not correct is a machined
  // straight edge, or daylight through it at the angles the game actually uses.
  const CAP_WRAP = 0.2;
  const cap = new THREE.Mesh(
    bandedTubeAlongZ(capRings, 24, -CAP_WRAP, Math.PI + CAP_WRAP * 2),
    [bodyMat, bandMat],
  );
  cap.name = "prawnCap";
  // scale.y sets the dome's height directly, now that the axis IS the base:
  // 0.86 * CAP_R gives the measured 0.465 RW cap height.
  cap.scale.set(1, 0.86, 1);
  cap.position.set(0, TOP - 0.05, -0.02);
  // A small lift at the front, so the cap's leading edge rises off the block
  // instead of sitting flush against it. It also reads as the prawn being LAID
  // on rather than moulded to it. nigiriBehaviour reads this as its rest pose
  // and adds the walk lag on top, so the two never fight.
  cap.rotation.x = -0.055;
  cap.castShadow = true;
  g.add(cap);

  // The prawn's front end, curving DOWN over the block's front edge. From
  // directly in front this is the only part of the cap that reads at all — the
  // transverse lobes are edge-on there and carry nothing.
  // SMALL. The first pass used CAP_R * 0.9 scaled to 0.54 wide, which is most
  // of the model's own width: it swallowed the lobes, the front of the cap and
  // the top of the face in one sphere. It only has to round off the sweep's
  // front end and lap the block's top-front corner.
  // Smaller AGAIN. At 0.42 it still spanned 0.317 across and 0.223 deep, which
  // covered the front half of the dome and left the cap smooth exactly where
  // the lobes are meant to read. It is a LIP over the block's top-front corner,
  // not a head: it must not reach back into the dome.
  const nose = new THREE.Mesh(new THREE.SphereGeometry(CAP_R * 0.3, 14, 10), bodyMat);
  nose.name = "capNose";
  nose.scale.set(1.18, 0.52, 0.66);
  nose.position.set(0, TOP + 0.012, HD * 0.64);
  nose.castShadow = true;
  g.add(nose);

  // The thickened rear the tail fan springs from; without it the blades grow
  // out of a taper and read as twigs stuck in a point.
  const tailRoot = new THREE.Mesh(new THREE.SphereGeometry(CAP_R * 0.38, 12, 9), bodyMat);
  tailRoot.name = "capTailRoot";
  tailRoot.scale.set(1.2, 0.7, 0.85);
  tailRoot.position.set(0, TOP + 0.035, -HD * 0.68);
  g.add(tailRoot);

  // --- the tail fan ---------------------------------------------------------
  // Three blades rising and splaying from the cap's rear. The only thing on
  // either sushi that rises above the crown, which is what makes the nigiri
  // unmistakable from directly above — the one framing the game uses most.
  const fan = new THREE.Group();
  fan.name = "tailFan";
  // ABOVE the dome's crown, not inside it. The cap now reaches y = 0.737, and a
  // fan rooted at 0.60 was simply swallowed: the blades have to start where the
  // silhouette already ends or they add nothing to it, and adding to the
  // silhouette is the entire job of this part.
  fan.position.set(0, TOP + 0.145, -HD * 0.84);
  fan.rotation.x = 0.42;
  g.add(fan);
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.Mesh(new THREE.CapsuleGeometry(0.027, 0.125, 3, 8), bodyMat);
    blade.name = `tailFan${i}`;
    blade.scale.set(1, 1, 0.55);
    const lean = (i - 1) * 1.02;
    blade.rotation.z = lean;
    // Splayed in DEPTH as well as across. Leaning them only in the plane of the
    // screen let all three overlap into a single horn from the front, which is
    // the one silhouette this part exists to avoid.
    blade.rotation.x = Math.abs(i - 1) * -0.42;
    blade.position.set(Math.sin(lean) * 0.104, Math.cos(lean) * 0.088, Math.abs(i - 1) * -0.03);
    blade.castShadow = true;
    fan.add(blade);
  }

  // --- the face -------------------------------------------------------------
  // The panel is the block's front between the cap and the belt — the one part
  // the grain scatter is masked out of. Every mark sits on the block's actual
  // surface, whose Z falls away by about 2 mm across the eye region: put them
  // all at one fixed Z and the outer ones sink into the rice.
  const face = new THREE.Group();
  face.name = "facePanel";
  g.add(face);
  const EYE_Y = PANEL_TOP - 0.44 * PANEL_H;
  const MOUTH_Y = PANEL_TOP - 0.62 * PANEL_H;
  const BLUSH_Y = PANEL_TOP - 0.73 * PANEL_H;
  const EYE_X = 0.19 * RW;
  const BLUSH_X = 0.3 * RW;
  const EYE_R = 0.0455; // sclera radius — the pair spans 0.30 RW, well under the maki's 0.58 ND
  const EYE_FLAT_Z = 0.3; // the lens is pressed into an inset panel, not a ball stuck on it

  // A decal cap aimed down +Z, the same helper every other enemy's eye is built
  // from. The pole is rotated from +Y to +Z so it points along the gaze; the
  // `factor` stack keeps each cap a hair proud of the one under it, which is
  // what stops the pupil z-fighting the sclera it lies on.
  // `rings` is spent on the SWEEP, not on a whole sphere's worth of latitude:
  // SphereGeometry lays its height segments across `thetaLen`, so leaving it at
  // a full sphere's 12 buys nothing on a 0.7-rad cap and costs a thousand
  // triangles across four caps. Each cap still clears the sclera it lies on —
  // its polygonal surface sags to cos(dTheta/2) of its radius, which at these
  // ring counts is under 1%, well inside the `factor` offsets below.
  const eyeCap = (
    factor: number,
    thetaLen: number,
    mat: THREE.MeshToonMaterial,
    seg: number,
    rings: number,
  ): THREE.Mesh => {
    const geo = new THREE.SphereGeometry(EYE_R * factor, seg, rings, 0, Math.PI * 2, 0, thetaLen);
    geo.rotateX(Math.PI / 2);
    return new THREE.Mesh(geo, mat);
  };

  const eyes: THREE.Object3D[] = [];
  const pupPivots: THREE.Object3D[] = [];
  for (const s of [1, -1]) {
    const z = squircleFrontZ(s * EYE_X, HW, HD, SQ_N);

    // THE CAST'S EYE, not a private one. Every other enemy builds a cream
    // SCLERA ball with a dark pupil cap that darts on its own pivot and a
    // catchlight over it; this one shipped as a single dark cap in `pupM` with
    // a lid line on top, so it read as a painted bean rather than as an eye of
    // the same family — and it broke the frightened state outright.
    // `applyEnemyLook` whitens `pupM` when the beagle eats a bone, which on
    // every other skin turns the PUPIL white inside a cream sclera (the blank
    // stare). Here `pupM` WAS the whole eye, so both eyes went cream-on-cream
    // against a cream rice block and the face lost its eyes at exactly the
    // moment the player is chasing it — the flea's `creaseMat` defect
    // (IDEA-053 rule 2) in a new place.
    //
    // A GROUP carries the flattening, never the ball: scaling the ball alone
    // leaves the caps riding a surface that has moved out from under them.
    // Scaled together, every cap stays flush however flat the lens is.
    const eye = new THREE.Group();
    eye.name = s > 0 ? "eyeL" : "eyeR";
    // Nearly flush. This face is INSET where the maki's bulges, so the lens is
    // seated into the block with only its front 2 mm proud of the surface.
    eye.position.set(s * EYE_X, EYE_Y, z - EYE_R * EYE_FLAT_Z + 0.002);
    // The lens the whole eye is flattened by. It USED to be the half-lidded
    // read on its own; the ball's own scale below now overrides that, and the
    // separator from the maki is the eye's SIZE and furniture instead — 0.072
    // across against its 0.139, a gold lid line against brows and a cyan iris.
    eye.scale.set(1, 0.66, EYE_FLAT_Z);
    face.add(eye);

    const ball = new THREE.Mesh(new THREE.SphereGeometry(EYE_R, 16, 12), scleraMat);
    ball.name = s > 0 ? "eyeBallL" : "eyeBallR";
    // NUNO'S SHAPE, set in the editor: narrower and much taller than the lens
    // it sits in. Net of the group's 0.66 it stands at 0.87 of the eye's width
    // — an upright almond rather than a wide slot, which is what stops the eye
    // reading as a bean whatever is drawn inside it.
    ball.scale.set(0.791, 1.31, 1);
    eye.add(ball);

    // The dart pivot sits at the ball's centre and carries ONLY the caps. The
    // lid is deliberately outside it: a lid that swings with the glance is a
    // rolling eyeball, not an eyelid.
    const pivot = new THREE.Group();
    pivot.name = s > 0 ? "pupilPivotL" : "pupilPivotR";
    eye.add(pivot);

    const pupil = eyeCap(1.02, 0.72, pupM, 16, 5);
    pupil.name = s > 0 ? "pupilL" : "pupilR";
    // Editor values. The pupil takes the ball's proportions rather than the
    // lens's — 0.89 of its width and 0.92 of its height — so the white reads as
    // an even rim around it instead of a crescent under a lid. Pushed 0.01
    // forward it stands PROUD of the sclera rather than lying flush on it: the
    // cap is narrower than the ball it sits in, so at its rim the ball's own
    // surface has already fallen away, and the offset closes that gap from the
    // front. It is 3 mm of world depth after the group's 0.3 z-squash, which is
    // why it stays a raised pupil and never becomes a floating disc.
    pupil.position.set(0, 0, 0.01);
    pupil.scale.set(0.701, 1.202, 1);
    pivot.add(pupil);

    const glint = eyeCap(1.06, 0.24, glintMat, 10, 3);
    glint.name = s > 0 ? "glintL" : "glintR";
    glint.rotation.set(-0.45, s * 0.45, 0);
    // Out and forward, on top of the rotation that already aims it up-and-out.
    // x is the ONE value in this set that mirrors: authored on the right eye at
    // +0.02, it has to be -0.02 on the left or both catchlights sit on the same
    // side of the face and the pair reads as a squint.
    glint.position.set(s * -0.02, 0, 0.02);
    pivot.add(glint);

    // THE LID IS A HOOD, not a line — the crab's collar solving a second
    // problem at the same time. A cream sclera on a cream rice block has almost
    // no boundary of its own (the maki's sits on saturated salmon and needs
    // none), and once the pupil whitens for the frightened state it has none at
    // all. The hood rims the eye's top and outer side in gold, which is a fixed
    // accent outside `accentMats`, so the eye keeps an outline in every state.
    // It has to be a RIM and nothing more. The first build swept 1.12 rad about
    // an up-and-FORWARD axis, and because the lens is flattened to 0.3 in Z a
    // forward-tilted cap projects almost entirely onto the front face: the gold
    // covered two thirds of the eye and the whole thing read as a brass button
    // with a dark sliver under it. Nearly vertical and half as wide, it lands
    // where an eyelid does.
    const lidGeo = new THREE.SphereGeometry(EYE_R * 1.1, 18, 4, 0, Math.PI * 2, 0, 0.62);
    lidGeo.rotateX(Math.PI / 2);
    const lid = new THREE.Mesh(lidGeo, lidMat);
    lid.name = s > 0 ? "lidL" : "lidR";
    lid.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(s * 0.16, 0.97, 0.18).normalize(),
    );
    // Editor value: lifted clear of the ball's top instead of clamped over it.
    // With the ball now 1.31 tall the old seated hood cut into the white, and
    // this is what keeps the lid a BROW-LINE over an open eye. It is the change
    // that moves the read from half-lidded toward alert — deliberate, and the
    // reason the maki separator is now the eye's SHAPE and its brows rather
    // than how far it is closed.
    lid.position.set(0, 0.02, 0);
    eye.add(lid);

    eyes.push(eye, ball, pupil, glint, lid);
    pupPivots.push(pivot);

    // The blush. Completely FLAT — the reference gives it no highlight at any
    // angle, which is why it is a matte disc rather than a dome. It is the one
    // face feature the maki has no counterpart for, so it carries a
    // disproportionate share of the separation between the two faces.
    const bz = squircleFrontZ(s * BLUSH_X, HW, HD, SQ_N);
    const blush = new THREE.Mesh(
      new THREE.SphereGeometry(0.0345, 12, 8, 0, Math.PI * 2, 0, 0.8),
      blushMat,
    );
    blush.name = s > 0 ? "blushL" : "blushR";
    blush.geometry.rotateX(Math.PI / 2);
    blush.scale.set(1, 0.78, 0.16);
    blush.position.set(s * BLUSH_X, BLUSH_Y, bz - 0.001);
    face.add(blush);
    eyes.push(blush);
  }

  // A CLOSED curve, not an aperture. The maki's mouth is an open cavity with a
  // tongue; two sushi with the same mouth would be one character in two hats.
  const mouth = new THREE.Mesh(
    new THREE.TorusGeometry(0.042, 0.0075, 5, 16, Math.PI * 0.82),
    mouthMat,
  );
  mouth.name = "mouth";
  mouth.rotation.z = Math.PI;
  mouth.scale.set(1, 0.72, 0.4);
  mouth.position.set(0, MOUTH_Y + 0.012, squircleFrontZ(0, HW, HD, SQ_N) + 0.002);
  face.add(mouth);

  // --- arms -----------------------------------------------------------------
  // Stubby on purpose: the reference's arms protrude only about 0.1 RW past the
  // block. Most of their length is INSIDE it, which is why a longer-looking arm
  // in the reference still measures a 1.198 RW span across the pair.
  const arms: THREE.Object3D[] = [];
  for (const s of [1, -1]) {
    const pivot = new THREE.Group();
    pivot.name = s > 0 ? "armPivotL" : "armPivotR";
    pivot.position.set(s * HW * 0.86, BELT_TOP + BELT_H * 0.16, 0.03);
    // Positive z swings a part hanging at -y toward +x; the maki's first two
    // passes got this backwards and buried both arms in its own body.
    pivot.rotation.z = s * 1.02;
    g.add(pivot);

    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.027, 0.115, 3, 8), bodyMat);
    arm.name = s > 0 ? "armL" : "armR";
    arm.position.y = -0.082;
    arm.castShadow = true;
    pivot.add(arm);

    // The arm FLARES at its end rather than tapering to a point — the
    // reference's arms are paddles, not spikes, and a short cone with a point
    // on it reads as a thorn.
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.031, 12, 9), bodyMat);
    tip.name = s > 0 ? "armTipL" : "armTipR";
    tip.scale.set(1, 0.86, 0.78);
    tip.position.y = -0.148;
    tip.castShadow = true;
    pivot.add(tip);

    arms.push(pivot);
  }

  // --- feet -----------------------------------------------------------------
  // Bare, in the prawn's own colour, and short. No boot: the maki has those,
  // and a shared foot would cost one of the seven separators.
  const feet: THREE.Object3D[] = [];
  for (const s of [1, -1]) {
    const pivot = new THREE.Group();
    pivot.name = s > 0 ? "footPivotL" : "footPivotR";
    // Lifted so the SOLE lands on y = 0. Measured first: at FLOOR + 0.028 the
    // toes reached -0.016, and an enemy standing 16 mm through the maze floor
    // is a thing you notice only from a low angle, which is not an angle this
    // game ever uses — so it has to be measured rather than looked for.
    pivot.position.set(s * 0.15 * RW, FLOOR + 0.046, HD * 0.2);
    g.add(pivot);

    const foot = new THREE.Mesh(new THREE.CapsuleGeometry(0.031, 0.03, 3, 9), bodyMat);
    foot.name = s > 0 ? "footL" : "footR";
    foot.rotation.x = 0.95;
    foot.scale.set(1, 1, 0.85);
    foot.position.set(0, -0.026, 0.026);
    foot.castShadow = true;
    pivot.add(foot);

    for (let t = 0; t < 2; t++) {
      const toe = new THREE.Mesh(new THREE.CapsuleGeometry(0.013, 0.022, 2, 6), bodyMat);
      toe.name = `toe${s > 0 ? "L" : "R"}${t}`;
      toe.rotation.set(1.35, 0, (t - 0.5) * 0.6);
      toe.position.set((t - 0.5) * 0.03, -0.042, 0.052);
      pivot.add(toe);
    }
    feet.push(pivot);
  }

  const userData: GhostUserData = {
    bodyMat,
    eyes,
    pupPivots,
    pupM,
    pupBaseColor: pupM.color.getHex(),
    baseColor: color,
    hem: [],
    pupOffset: { x: 0, z: 0 },
    // DELIBERATELY EMPTY. The obvious candidate is the rice block, which is the
    // largest mass — but the block and the cap going blue together is exactly
    // the collapse this skin cannot afford: the two-mass stack IS the identity,
    // and losing it while frightened means losing it while the player is
    // chasing the thing. The belt is out for the same reason (IDEA-053 rule 2).
    // The cap, arms and feet already share bodyMat, which is a large enough
    // coloured area to carry the recolour on its own.
    accentMats: [],
    behaviour: nigiriBehaviour({ feet, arms, cap }),
    eyeMats: nigiriEyeMats,
    spiritMats: collectSpiritMats(g, nigiriEyeMats),
  };
  g.userData = userData;
  return g;
}

// ---------------------------------------------------------------------------
// THE PIZZA SLICE — the seventh img2threejs rebuild (IDEA-058), and the first
// enemy in this game that is a PERSON. Same split as every rebuild before it:
// the generated factory sits unused in src/render/rework/createPizzaModel.ts
// and the SHIPPED mesh below is hand-authored from the numbers the run locked.
// Evidence in .img2threejs/pizza/, geometry machinery in ./pizzaSculpt.ts.
//
// WHY IT EXISTS. Nine enemies ship today: six bugs, a ghost, and two pieces of
// sushi that stand up. Every one of them is an animate OBJECT. This one is a
// 1930s rubber-hose MASCOT — it has hair, it wears gloves and boots, and it
// walks. Those are three things the cast has never said, and each of them is a
// thing a player can see at 25 px.
//
// PROPORTION BASE: SH = THE SLICE HEIGHT, crust top to cheese tip, MEASURED at
// 1494 px in the reference and built at 0.72 world units. No head again, and
// this time not even the pretence of one: the face is painted on the body, so
// there is no crown, no chin and no neck, and a "head height" would be an
// invention every ratio under it then inherited. That is IDEA-054's
// carapace-width reasoning, and it is the third subject in a row it applies to.
//
// FOUR RULES ARE LOAD-BEARING.
//
//  1. BEING VERTICAL IS THE IDENTITY. The cast measures 0.92 to 1.30 wide over
//     tall — nine enemies all roughly as wide as they are high. This one is
//     0.58 x 0.86, a ratio of 0.67, and it is a TRIANGLE, which is the one
//     silhouette family nobody else occupies. Widen it or shorten it and the
//     skin has no reason to exist. Everything below that costs width — the
//     sector angle, the spiral caps, the arm splay — was cut against that.
//
//  2. THE CRUST IS HAIR. A fat rolled tube swept across the top of the wedge,
//     overhanging the face on both sides, with a visible dough SPIRAL closing
//     each end. It reads as a pompadour, and that read is what turns a wedge
//     with eyes on it into a character. It has to stay clearly fatter than the
//     slice (0.121 against 0.095) or it stops being a mass and becomes a rim.
//     Its ends are CURLED FORWARD on purpose: on a plain arc the two spirals
//     face along +/-X, i.e. at the maze wall, and a player never sees them.
//
//  3. THE CHEESE PLATE IS bodyMat AND THE CRUST IS NOT. The plate is the
//     largest reliably-visible surface, so the team colour goes on the FACE —
//     a third distinct arrangement after the maki (repaints its wrapper) and
//     the nigiri (repaints its topping). The crust and boots are in
//     `accentMats`, so they follow the frightened blue but keep their own
//     baked brown-orange the rest of the time. That brown is deliberately
//     outside all five team hues (rose, teal, amber, violet, leaf): the amber
//     team is a warm orange, and a crust in the same family would collapse the
//     bread/cheese two-tone on exactly one team and nowhere else — the kind of
//     bug that ships. Everything small stays fixed and OUT of accentMats:
//     toppings, freckles, blisters, ink, and above all the GLOVES, which are
//     what stops the frightened silhouette going to one blue mass.
//
//  4. RUBBER HOSE MEANS NO ELBOWS AND NO KNEES. Each limb is ONE swept tube of
//     constant radius. That is a measurement, not a shortcut: the reference's
//     arm ink-run is the same width at two scanlines 100 px apart across a
//     large change of direction, with no taper and no joint bulge anywhere. It
//     also makes the flea's and the crab's whole joint-gap problem
//     unrepresentable here — a tube with no joints cannot have a joint gap.
const PZ_CRUST = 0xc2761f; // crust roll + boots — IN accentMats
const PZ_DOUGH = 0xe3a154; // the wedge solid: cut faces, rim, back — fixed
const PZ_INK = 0x5c2a22; // limbs, brows, creases, strands — fixed
const PZ_GLOVE = 0xfdfbf4; // mitts and teeth — fixed, and see rule 3
const PZ_PUPIL = 0x3a1f18;
const PZ_MOUTH = 0x6b2b26; // the cavity floor — deeper than the ink
const PZ_TONGUE = 0xef6d6a;
const PZ_PEP = 0xa8382c; // deeper than the reference's salmon, see makePizza
const PZ_MUSH = 0xeee3c0;
const PZ_OLIVE = 0x5e8c2e;
const PZ_FRECKLE = 0xd9a63a;
const PZ_BLISTER = 0xa35c15;

// The walk. Faster than the maki's 9 rad/s would be wrong — this one has long
// hose legs, and a long leg at a quick patter reads as running rather than
// striding — so it sits just under it with a bigger swing instead.
const PZ_STEP_FREQ = 8.4;
const PZ_STEP_SWING = 0.34;
const PZ_ARM_SWING = 0.28;
const PZ_IDLE_FREQ = 1.1 * Math.PI * 2;
const PZ_IDLE_ARM = 0.1;
const PZ_IDLE_LEAN = 0.038;
// The quiff LAGS. Half the step frequency and a quarter turn behind, which is
// the nigiri's cap-lag trick reused for hair momentum — the one motion in the
// cast that says "this thing has hair" rather than "this thing has a rim".
const PZ_QUIFF_LAG = 0.075;
const PZ_QUIFF_IDLE = 0.02;

/**
 * The pitch, in radians, that leans the whole slice BACK.
 *
 * A PLAY-CAMERA decision, not a measurement, which is why it is a named
 * constant. The game camera sits at 59 degrees elevation (scene.ts BASE_POS).
 * The cheese plate is a near-vertical plane carrying the ENTIRE face, and
 * vertical it projects at cos(59) = 0.515 of its area. Leaning back 18 degrees
 * puts the plate normal 41 degrees off the view direction (cos 0.75), a 46%
 * larger projected face, for about 0.01 of crown height.
 *
 * It MUST live on an inner group. applyGhostState assigns `mesh.rotation.x` on
 * the ROOT every time the state changes — 0 when normal, a shiver while
 * frightened — so a pitch authored on the root is erased the first time the
 * beagle eats a bone (IDEA-056 rule 3).
 */
const PZ_PITCH = -18 * (Math.PI / 180);

interface PizzaParts {
  legs: THREE.Object3D[]; // [left, right] hip pivots
  arms: THREE.Object3D[]; // [left, right] shoulder pivots
  quiff: THREE.Object3D; // the crust roll's own pivot, for the hair lag
  body: THREE.Object3D; // the pitched group, for the idle lean
}

function pizzaBehaviour(parts: PizzaParts): EnemyBehaviour {
  const { legs, arms, quiff, body } = parts;
  const armRest = arms.map((a) => a.rotation.x);
  const quiffRest = quiff.rotation.x;
  return {
    animate: (t, idleT, moveBlend) => {
      const step = Math.sin(t * PZ_STEP_FREQ) * PZ_STEP_SWING * moveBlend;
      legs[0].rotation.x = step;
      legs[1].rotation.x = -step;
      // Arms counter-phase to the legs while walking, and a slow hang-sway
      // while standing. Blended rather than switched, so a stop eases out of
      // the stride instead of snapping to attention. The rest angle is the
      // shoulder's own counter-pitch and has to be added back, or setting
      // rotation.x here would drop the arms into the body's lean.
      const idleArm = Math.sin(idleT * PZ_IDLE_FREQ) * PZ_IDLE_ARM * (1 - moveBlend);
      const ratio = PZ_ARM_SWING / PZ_STEP_SWING;
      arms[0].rotation.x = armRest[0] - step * ratio + idleArm;
      arms[1].rotation.x = armRest[1] + step * ratio - idleArm;
      // Hair momentum: the quiff trails the stride, and breathes on its own
      // when standing so a stopped mascot still reads as having hair.
      quiff.rotation.x =
        quiffRest +
        Math.sin(t * PZ_STEP_FREQ * 0.5 - Math.PI / 2) * PZ_QUIFF_LAG * moveBlend +
        Math.sin(idleT * PZ_IDLE_FREQ * 0.8) * PZ_QUIFF_IDLE * (1 - moveBlend);
      // A triangle on two sticks needs SOME weight shift or it reads as a prop
      // being slid along. A roll about the travel axis, added to the fixed
      // pitch, which syncToEntity's own waddle then rides on top of.
      body.rotation.z = Math.sin(idleT * PZ_IDLE_FREQ * 0.5) * PZ_IDLE_LEAN * (1 - moveBlend * 0.6);
    },
  };
}

/**
 * Builds the pizza-slice mascot enemy skin (IDEA-058).
 *
 * Satisfies the same `GhostUserData` contract as every other skin, so game.ts
 * never learns which one is equipped.
 */
export function makePizza(color: number): THREE.Group {
  const g = new THREE.Group();

  // --- proportions, all in SH multiples measured off the reference ----------
  const SH = 0.72; // proportion base: the slice height
  // 0.183 SH in diameter. The reference MEASURES 0.168 over the brow and this
  // is deliberately over it: side by side against the reference at 0.168 the
  // quiff read as a rim rather than as hair, because a drawing gets to put an
  // ink keyline round the roll and a toon mesh does not. The extra 9% is what
  // buys back the separation the keyline was doing.
  const CR = 0.066; // crust roll radius
  const R = SH - CR; // 0.654 sector radius, apex to the arc's centreline
  const ALPHA = 20 * (Math.PI / 180); // sector HALF-angle; the slice spans 40
  const T = 0.095; // dough thickness — INFERRED, see the spec's assumptions
  const CT = 0.02; // cheese layer, proud of the dough's front face
  const TIPY = 0.145; // world Y of the apex; the tip hangs between the boots
  const INSET = 0.028; // cheese plate inset from the cut edges
  const BOW = 0.042; // outward bulge on each cut edge — see pizzaSculpt

  // ONE outline, three parts. The wedge solid, the cheese plate and the arc the
  // crust is swept along are all derived from these two option sets, which is
  // what makes the dough rim uniform BY CONSTRUCTION instead of by two numbers
  // being kept in step. Checked against the reference: at the eye line this
  // gives a plate half-width of 0.1276 against a MEASURED 0.126.
  const WEDGE: SectorOutlineOptions = {
    radius: R,
    alpha: ALPHA,
    bow: BOW,
    tipRound: 0.035,
    edgeInset: 0,
    edgeSegments: 16,
    arcSegments: 20,
    tipSegments: 14,
  };
  const PLATE: SectorOutlineOptions = {
    radius: R - CR * 0.72,
    alpha: ALPHA,
    bow: BOW,
    // Much smaller than the wedge's own fillet, and that is the point: the
    // plate's apex is already pushed 0.082 up the axis by the inset, and a
    // generous fillet on top of that left a third of the slice bare tan. The
    // reference runs cheese almost to the tip.
    tipRound: 0.016,
    edgeInset: INSET,
    edgeSegments: 16,
    arcSegments: 18,
    tipSegments: 12,
  };

  const FACE_Z = T / 2 + CT; // the cheese plate's own front face
  const EYE_Y = 0.424; // 0.589 SH — MEASURED
  const EYE_X = 0.043; // half of a MEASURED 0.119 SH separation
  const MOUTH_Y = 0.305; // 0.424 SH — MEASURED
  // Nearly twice as wide as it is tall, which is what the reference's grin
  // measures. The first build was 1.5:1 and read as a pout.
  const MOUTH_HW = 0.078;
  const MOUTH_H = 0.086;
  const SHOULDER_Y = 0.396;

  // --- materials ------------------------------------------------------------
  const bodyMat = toon({ color, emissive: color, emissiveIntensity: 0.15 });
  const crustMat = toon({ color: PZ_CRUST });
  crustMat.userData.baseColor = PZ_CRUST;
  const doughMat = toon({ color: PZ_DOUGH });
  doughMat.userData.baseColor = PZ_DOUGH;
  const inkMat = toon({ color: PZ_INK });
  inkMat.userData.baseColor = PZ_INK;
  const gloveMat = toon({ color: PZ_GLOVE });
  gloveMat.userData.baseColor = PZ_GLOVE;
  const mouthMat = toon({ color: PZ_MOUTH });
  mouthMat.userData.baseColor = PZ_MOUTH;
  const tongueMat = toon({ color: PZ_TONGUE });
  tongueMat.userData.baseColor = PZ_TONGUE;
  // Deeper than the reference's #f27666 on purpose. Salmon on the rose team's
  // own #e0577a plate is invisible; this survives it — and the discs are RAISED
  // as well, so they read on geometry even where they lose on hue.
  const pepMat = toon({ color: PZ_PEP });
  pepMat.userData.baseColor = PZ_PEP;
  const mushMat = toon({ color: PZ_MUSH });
  mushMat.userData.baseColor = PZ_MUSH;
  const oliveMat = toon({ color: PZ_OLIVE });
  oliveMat.userData.baseColor = PZ_OLIVE;
  const freckleMat = toon({ color: PZ_FRECKLE });
  freckleMat.userData.baseColor = PZ_FRECKLE;
  const blisterMat = toon({ color: PZ_BLISTER });
  blisterMat.userData.baseColor = PZ_BLISTER;
  // Its own material rather than a share of the glove: it belongs to eyeMats,
  // the list kept SOLID while the enemy is eaten, and sharing would leave the
  // gloves solid too — a spirit coming home still wearing them.
  const scleraMat = toon({ color: PZ_GLOVE });
  const pupM = toon({ color: PZ_PUPIL });
  const glintMat = toon({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.5 });
  const pizzaEyeMats = [scleraMat, pupM, glintMat];

  // --- the pitched body -----------------------------------------------------
  // Everything above the hips hangs off this; the legs do not, so the lean
  // never tips the stance. Pushed forward on Z because an 18-degree lean
  // carries the crown 0.22 backwards, and without it the mass sits behind the
  // feet and the mascot reads as falling over rather than as leaning back.
  const body = new THREE.Group();
  body.name = "body";
  body.position.set(0, 0.145, 0.017);
  body.rotation.x = PZ_PITCH;
  g.add(body);

  // --- the wedge ------------------------------------------------------------
  // bevelEnabled is FALSE and stays false. IDEA-057 measured what a bevel does
  // to an extrusion here: `bevelSize` grows OUTWARD, so a footprint of 0.560 x
  // 0.403 came out 0.650 x 0.493 and swallowed three separate subsystems that
  // had been positioned against the original outline. Everything on this model
  // is positioned against this outline.
  const wedgeShape = shapeFromPoints(sectorOutline(WEDGE));
  const wedgeGeo = new THREE.ExtrudeGeometry(wedgeShape, {
    depth: T,
    bevelEnabled: false,
    curveSegments: 1,
  });
  wedgeGeo.translate(0, 0, -T / 2);
  const wedge = new THREE.Mesh(wedgeGeo, doughMat);
  wedge.name = "sliceWedge";
  wedge.castShadow = true;
  body.add(wedge);

  // --- the cheese plate, with the mouth cut OUT of it -----------------------
  // The mouth is a real aperture, not a dark patch: the plate's own Shape
  // carries a hole and a dark floor sits behind it. That matters here more
  // than it did for the sushi, because this plate takes the TEAM COLOUR — a
  // dark oval laid on a violet plate reads as a sticker, while a hole still
  // reads as a hole at every hue.
  const plateShape = shapeFromPoints(sectorOutline(PLATE));
  plateShape.holes.push(
    pathFromPoints(
      smileHolePoints(MOUTH_HW, MOUTH_H, 22).map(
        (p) => new THREE.Vector2(p.x, p.y + MOUTH_Y),
      ),
    ),
  );
  const plateGeo = new THREE.ExtrudeGeometry(plateShape, {
    depth: CT,
    bevelEnabled: false,
    curveSegments: 1,
  });
  plateGeo.translate(0, 0, T / 2);
  const plate = new THREE.Mesh(plateGeo, bodyMat);
  plate.name = "cheesePlate";
  plate.castShadow = true;
  body.add(plate);

  // --- the mouth's floor, teeth and tongue ----------------------------------
  // The floor sits just PROUD of the dough's front face and 0.019 behind the
  // plate's, so the aperture's own wall is what shades it.
  //
  // "Just proud of the dough" is the whole point and it was got wrong first:
  // the floor was authored at T/2 - 0.008, which is INSIDE the wedge, and the
  // wedge's own tan front face then showed through the hole instead. The mouth
  // rendered as a cream band on a tan blob with no dark anywhere in it — an
  // open mouth with nothing open about it. Same class of defect as IDEA-057's
  // buried nori belt: a part correctly built, correctly coloured, and behind
  // another surface. Nothing about the render says so; the z arithmetic does.
  const wellShape = shapeFromPoints(
    smileHolePoints(MOUTH_HW * 1.16, MOUTH_H * 1.16, 20)
      .slice()
      .reverse()
      .map((p) => new THREE.Vector2(p.x, p.y + MOUTH_Y)),
  );
  const wellGeo = new THREE.ExtrudeGeometry(wellShape, {
    depth: 0.006,
    bevelEnabled: false,
    curveSegments: 1,
  });
  wellGeo.translate(0, 0, T / 2 + 0.0006);
  const well = new THREE.Mesh(wellGeo, mouthMat);
  well.name = "mouthWell";
  body.add(well);

  // The tooth band FOLLOWS the aperture's top curve rather than lying flat
  // across it. A straight bar poked out through the corners, where the smile's
  // top edge falls to zero — the sort of thing that looks like a modelling
  // choice from the front and like a defect from anywhere else.
  const toothTop: THREE.Vector2[] = [];
  const toothBot: THREE.Vector2[] = [];
  for (let i = 0; i <= 18; i++) {
    const u = i / 18;
    const x = -MOUTH_HW * 0.9 + u * MOUTH_HW * 1.8;
    const k = Math.sin(u * Math.PI);
    const top = MOUTH_H * 0.22 * k * 0.94 - 0.001 + MOUTH_Y;
    toothTop.push(new THREE.Vector2(x, top));
    // TAPERED, and thin. The first build gave it a constant 0.019 and the band
    // filled most of the aperture — leaving a white crescent with a sliver of
    // pink under it, which reads as a downturned lip. An open mouth only reads
    // as OPEN if DARK is the dominant thing inside it, so the teeth are a strip
    // along the top lip and nothing more.
    toothBot.push(new THREE.Vector2(x, top - (0.0035 + 0.0065 * k)));
  }
  const toothGeo = new THREE.ExtrudeGeometry(
    shapeFromPoints([...toothTop, ...toothBot.reverse()]),
    { depth: 0.012, bevelEnabled: false, curveSegments: 1 },
  );
  toothGeo.translate(0, 0, T / 2 + 0.004);
  const teeth = new THREE.Mesh(toothGeo, gloveMat);
  teeth.name = "toothBand";
  body.add(teeth);

  // Sized so the cavity stays visibly DARK above it and at both corners. It
  // fills a little under half the aperture, which is what the reference shows.
  const tongue = new THREE.Mesh(new THREE.SphereGeometry(0.05, 14, 10), tongueMat);
  tongue.name = "tongue";
  tongue.scale.set(1.05, 0.42, 0.24);
  tongue.position.set(0, MOUTH_Y - 0.036, T / 2 + 0.004);
  body.add(tongue);

  // --- the crust roll, on its own pivot so the quiff can lag ----------------
  const quiff = new THREE.Group();
  quiff.name = "quiffPivot";
  const QUIFF_PIVOT_Y = R * 0.45;
  quiff.position.set(0, QUIFF_PIVOT_Y, 0);
  body.add(quiff);

  const CURL = 0.1; // how far the roll's ends carry forward
  const DROP = 0.03;
  const TUCK = 0.16; // and how far they pull IN — this is the width budget
  const sweepPts = crustSweepPoints(R, ALPHA, CURL, DROP, TUCK, 22);
  const { geometry: rollGeo, curve: rollCurve } = hoseGeometry(sweepPts, CR, 44, 12);
  rollGeo.translate(0, -QUIFF_PIVOT_Y, 0);
  const roll = new THREE.Mesh(rollGeo, crustMat);
  roll.name = "crustRoll";
  roll.castShadow = true;
  quiff.add(roll);

  // The parting. One ink line down the roll's length, and it is the whole
  // difference between a hairstyle and a sausage. Its own fixed material, kept
  // OUT of accentMats: the roll goes blue while frightened but six hairlines
  // do not register, and if they followed they would vanish into it
  // (IDEA-053 rule 2).
  const partPts = sweepPts.map((p) => {
    const rad = Math.hypot(p.x, p.y) || 1;
    return new THREE.Vector3(
      p.x + (p.x / rad) * CR * 0.62,
      p.y + (p.y / rad) * CR * 0.62,
      p.z + CR * 0.55,
    );
  });
  const partGeo = hoseGeometry(partPts, 0.0055, 40, 6).geometry;
  partGeo.translate(0, -QUIFF_PIVOT_Y, 0);
  const parting = new THREE.Mesh(partGeo, inkMat);
  parting.name = "crustParting";
  quiff.add(parting);

  // Oven blisters, counted along the sweep's own arc PARAMETER so the roll's
  // length sets the spacing — change CR or ALPHA and there is still no bald
  // patch. Deterministic: `rng`, never Math.random.
  const blisterRand = rng(0x5a17);
  for (let i = 0; i < 12; i++) {
    const u = Math.min(0.97, Math.max(0.03, (i + 0.5) / 12 + (blisterRand() - 0.5) * 0.05));
    const p = rollCurve.getPointAt(u);
    const rad = Math.hypot(p.x, p.y) || 1;
    const phi = blisterRand() * Math.PI * 2;
    const c = Math.cos(phi) * CR * 0.88;
    const s = Math.sin(phi) * CR * 0.88;
    const blister = new THREE.Mesh(
      new THREE.SphereGeometry(0.006 + blisterRand() * 0.004, 8, 6),
      blisterMat,
    );
    blister.name = `crustBlister${i}`;
    blister.position.set(
      p.x + (p.x / rad) * c,
      p.y - QUIFF_PIVOT_Y + (p.y / rad) * c,
      p.z + s,
    );
    quiff.add(blister);
  }

  // --- the spiral termini ---------------------------------------------------
  // Aimed with setFromUnitVectors against the sweep's own end TANGENT, never
  // with hand-written Euler angles. IDEA-055 rule 4: the mosquito's abdomen and
  // proboscis were both authored with rotation.x and both came out inverted,
  // and what exposed it was a measured envelope rather than the render.
  const CAP_R = 0.078;
  for (const s of [1, -1] as const) {
    const u = s > 0 ? 1 : 0; // the sweep runs left end -> right end
    const at = rollCurve.getPointAt(u);
    const tangent = rollCurve.getTangentAt(u).multiplyScalar(s > 0 ? 1 : -1);

    const cap = new THREE.Group();
    cap.name = s > 0 ? "crustCapL" : "crustCapR";
    cap.position.set(at.x, at.y - QUIFF_PIVOT_Y, at.z);
    cap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
    quiff.add(cap);

    // A rolled dough end BULGES — MEASURED at 0.262 SH across in the reference
    // against the roll's own 0.168. Built at 0.155 rather than the measured
    // 0.189 to hold the width budget (rule 1); the reduction is deliberate.
    const capBody = new THREE.Mesh(
      latheFromProfile(
        [
          [0.0001, -0.048],
          [CAP_R * 0.55, -0.05],
          [CAP_R * 0.92, -0.026],
          [CAP_R, 0.004],
          [CAP_R * 0.9, 0.028],
          [CAP_R * 0.55, 0.04],
          [0.0001, 0.044],
        ],
        22,
        1,
        1,
        1,
      ),
      crustMat,
    );
    capBody.name = s > 0 ? "crustCapBodyL" : "crustCapBodyR";
    capBody.castShadow = true;
    cap.add(capBody);

    const spiral = new THREE.Mesh(
      hoseGeometry(spiralPoints(CAP_R * 0.13, CAP_R * 0.74, 1.55, 0.036, 44), 0.006, 44, 6)
        .geometry,
      inkMat,
    );
    spiral.name = s > 0 ? "crustSpiralL" : "crustSpiralR";
    cap.add(spiral);
  }

  // --- everything scattered on the plate ------------------------------------
  // Placed in (u, y) where u is a FRACTION of the plate's own half-width at
  // that height, so nothing can clip through the rim however the sector angle
  // or the inset changes. Same defence as the crab's joint test: make the
  // defect unrepresentable rather than merely absent.
  const plateX = (y: number, u: number) => u * sectorHalfWidth(PLATE, y);
  const TOP_Z = FACE_Z;

  // Four pepperoni. The face owns the plate between y=0.24 and y=0.51, so they
  // go above the brows and beside the mouth, which is where the reference puts
  // them too.
  const PEPS: readonly [number, number, number][] = [
    [-0.60, 0.558, 0.03],
    [0.64, 0.545, 0.028],
    [0.72, 0.352, 0.023],
    [0.0, 0.213, 0.017],
  ];
  PEPS.forEach(([u, y, r], i) => {
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.013, 16), pepMat);
    disc.name = `pepperoni${i}`;
    disc.rotation.x = Math.PI / 2;
    disc.position.set(plateX(y, u), y, TOP_Z + 0.005);
    disc.castShadow = true;
    body.add(disc);
  });

  // Two mushroom slices — a cap with a stem notch, which is the one shape that
  // separates a mushroom from "a second pale pepperoni" at this size.
  // Placed WELL clear of the eyes. The first build put one at y=0.352 directly
  // under the left eye and it read as a wart on the cheek — a reminder that a
  // scatter system still has to respect the face's own footprint.
  const MUSH: readonly [number, number, number][] = [
    [-0.86, 0.238, 0.023],
    [0.78, 0.596, 0.021],
  ];
  MUSH.forEach(([u, y, r], i) => {
    const x = plateX(y, u);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 9), mushMat);
    cap.name = `mushroomCap${i}`;
    cap.scale.set(1, 0.82, 0.3);
    cap.position.set(x, y + r * 0.16, TOP_Z + 0.004);
    body.add(cap);
    const stem = new THREE.Mesh(new THREE.SphereGeometry(r * 0.46, 10, 8), mushMat);
    stem.name = `mushroomStem${i}`;
    stem.scale.set(1, 1.1, 0.3);
    stem.position.set(x, y - r * 0.62, TOP_Z + 0.004);
    body.add(stem);
  });

  // Two olive crescents. The ONLY cool hue on the whole body, which is what
  // makes them worth their triangles at this size.
  const OLIVES: readonly [number, number, number][] = [
    [-0.86, 0.588, 1.0],
    [0.36, 0.596, -1.0],
  ];
  OLIVES.forEach(([u, y, flip], i) => {
    const olive = new THREE.Mesh(
      new THREE.TorusGeometry(0.019, 0.007, 5, 12, Math.PI * 0.85),
      oliveMat,
    );
    olive.name = `olive${i}`;
    olive.scale.set(1, 1, 0.45);
    olive.rotation.z = flip > 0 ? 0.5 : Math.PI - 0.5;
    olive.position.set(plateX(y, u), y, TOP_Z + 0.003);
    body.add(olive);
  });

  // Ochre freckles. Texture only, and the first thing to cut if the triangle
  // budget ever bites.
  const FRECKLES: readonly [number, number][] = [
    [-0.30, 0.585],
    [0.24, 0.612],
    [-0.86, 0.475],
    [0.88, 0.462],
    [-0.90, 0.402],
    [0.90, 0.286],
    [-0.72, 0.268],
    [0.40, 0.238],
    [-0.34, 0.223],
    [0.62, 0.500],
  ];
  const freckleRand = rng(0x0b1e);
  FRECKLES.forEach(([u, y], i) => {
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.005 + freckleRand() * 0.003, 7, 5),
      freckleMat,
    );
    dot.name = `cheeseFreckle${i}`;
    dot.scale.set(1, 1, 0.5);
    dot.position.set(plateX(y, u), y, TOP_Z + 0.002);
    body.add(dot);
  });

  // Cheese drip lobes on the plate's rim. Straddling the edge so half of each
  // one overhangs, and ASYMMETRIC — three one side, two the other — because a
  // mirrored drip reads as machining.
  const DRIPS: readonly [number, number][] = [
    [1, 0.30],
    [1, 0.42],
    [1, 0.545],
    [-1, 0.355],
    [-1, 0.50],
  ];
  DRIPS.forEach(([s, y], i) => {
    const lobe = new THREE.Mesh(new THREE.SphereGeometry(0.032, 12, 9), bodyMat);
    lobe.name = `cheeseDrip${i}`;
    lobe.scale.set(0.78, 1.08, 0.62);
    lobe.position.set(s * (sectorHalfWidth(PLATE, y) + 0.004), y, T / 2 + CT * 0.45);
    body.add(lobe);
  });

  // Cheese-pull strands, in the dough rim between the plate's edge and the
  // slice's own. They are what says MELTED rather than PAINTED, and putting
  // them on the front rim rather than on the cut face is a play-camera call:
  // the cut face is near edge-on from 59 degrees and these would never be seen
  // there.
  for (const s of [1, -1] as const) {
    [0.3, 0.42, 0.545].forEach((y, i) => {
      const mid = (sectorHalfWidth(WEDGE, y) + sectorHalfWidth(PLATE, y)) / 2;
      const strand = new THREE.Mesh(new THREE.CapsuleGeometry(0.0055, 0.075, 3, 6), inkMat);
      strand.name = `pullStrand${s > 0 ? "L" : "R"}${i}`;
      strand.scale.set(1, 1, 0.45);
      strand.rotation.z = -s * ALPHA;
      strand.position.set(s * mid, y, T / 2 + 0.005);
      body.add(strand);
    });

    // And three more ON the cut face itself, swept along the edge's own curve
    // rather than laid across it as straight capsules — the edge bows, so a
    // straight bar dips inside it at the middle and out of it at the ends.
    //
    // These exist for the SIDE view, which is the one the front-facing work
    // never improves: from due right the whole model is one flat tan panel and
    // nothing on it says pizza. That view is worth building for even though
    // the game camera rarely takes it, because the shop's character stage does.
    [-0.03, 0.0, 0.03].forEach((dz, i) => {
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 5; k++) {
        const y = 0.24 + (0.32 * k) / 5;
        pts.push(
          new THREE.Vector3(s * (sectorHalfWidth(WEDGE, y) + 0.003), y, dz + (i - 1) * 0.004),
        );
      }
      const groove = new THREE.Mesh(hoseGeometry(pts, 0.0045, 14, 5).geometry, inkMat);
      groove.name = `cutStrand${s > 0 ? "L" : "R"}${i}`;
      body.add(groove);
    });
  }

  // --- the face -------------------------------------------------------------
  const face = new THREE.Group();
  face.name = "facePanel";
  body.add(face);

  const eyes: THREE.Object3D[] = [];
  const pupPivots: THREE.Object3D[] = [];
  for (const s of [1, -1] as const) {
    const pivot = new THREE.Group();
    pivot.name = s > 0 ? "pupilPivotL" : "pupilPivotR";
    pivot.position.set(s * EYE_X, EYE_Y, 0);
    face.add(pivot);

    // MEASURED 0.063 wide x 0.088 tall, centres 0.086 apart — so the two
    // nearly touch, with 0.023 of plate between them. That closeness is the
    // single strongest cartoon signal the face carries; spaced at human
    // proportions the whole read goes.
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12), scleraMat);
    eye.name = s > 0 ? "eyeL" : "eyeR";
    eye.scale.set(0.7, 0.98, 0.34);
    eye.position.z = FACE_Z - 0.006;
    pivot.add(eye);

    const pup = new THREE.Mesh(new THREE.SphereGeometry(0.026, 14, 10), pupM);
    pup.name = s > 0 ? "pupilL" : "pupilR";
    pup.scale.set(0.7, 0.88, 0.32);
    pup.position.set(0, -0.004, FACE_Z + 0.004);
    pivot.add(pup);

    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.011, 9, 7), glintMat);
    glint.name = s > 0 ? "glintL" : "glintR";
    glint.scale.set(1, 1, 0.45);
    glint.position.set(s * 0.009, 0.016, FACE_Z + 0.011);
    pivot.add(glint);

    eyes.push(pivot, eye, pup, glint);
    pupPivots.push(pivot);

    // The brow is DETACHED and sits above the eye. Detached is the point: a
    // brow drawn on the lid is an eyelid; a brow floating above it is an
    // expression, and at 25 px it is most of the expression there is.
    // A torus ARC is not symmetric, so its mirror is a REFLECTION, not a
    // rotation by pi. An arc drawn from a0 over A reflects to (pi - a0 - A);
    // rotating by pi instead lands it upside down on the other side, which is
    // how the first build ended up with one brow and one stray tick.
    // A shallow cap centred over the eye and tilted so its OUTER end drops.
    // The tilt's sign is the difference between friendly and angry: rotating
    // the arc counter-clockwise lowers the LEFT end, which on the left eye is
    // the inner end — and two inner ends dropped is the universal cartoon
    // scowl. The first build had exactly that and the whole mascot read cross.
    const BROW_ARC = Math.PI * 0.62;
    const BROW_REST = Math.PI / 2 - BROW_ARC / 2;
    const brow = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.0075, 5, 12, BROW_ARC), inkMat);
    brow.name = s > 0 ? "browL" : "browR";
    brow.scale.set(1, 0.72, 0.5);
    brow.rotation.z =
      s > 0 ? BROW_REST - 0.2 : Math.PI - (BROW_REST - 0.2) - BROW_ARC;
    brow.position.set(s * (EYE_X + 0.006), 0.508, FACE_Z - 0.002);
    face.add(brow);

    // The cheek hook. Three ink marks in total with the chin one, and they are
    // what stops a flat plate reading as a card.
    const CHEEK_ARC = Math.PI * 0.55;
    const cheek = new THREE.Mesh(
      new THREE.TorusGeometry(0.015, 0.0055, 5, 10, CHEEK_ARC),
      inkMat,
    );
    cheek.name = s > 0 ? "cheekCreaseL" : "cheekCreaseR";
    cheek.scale.set(1, 1, 0.45);
    cheek.rotation.z = s > 0 ? -0.6 : Math.PI + 0.6 - CHEEK_ARC;
    cheek.position.set(s * 0.105, 0.362, FACE_Z - 0.002);
    face.add(cheek);
  }

  const chin = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.0055, 5, 12, Math.PI * 0.5), inkMat);
  chin.name = "chinCrease";
  chin.scale.set(1, 0.8, 0.45);
  chin.rotation.z = Math.PI + 0.78;
  chin.position.set(0, 0.228, FACE_Z - 0.002);
  face.add(chin);

  // --- arms -----------------------------------------------------------------
  // The shoulder carries +18 degrees to CANCEL the body's lean, so the hose
  // hangs vertically in world space. Authored on the pivot rather than by
  // re-parenting to the root, so the idle body-lean still carries the arms with
  // it. Positive rotation.z swings a part hanging at -y toward +x — the maki's
  // first two passes got that backwards and buried both arms inside its own
  // barrel, and widening the angle only buried them deeper.
  const arms: THREE.Object3D[] = [];
  for (const s of [1, -1] as const) {
    const pivot = new THREE.Group();
    pivot.name = s > 0 ? "armPivotL" : "armPivotR";
    pivot.position.set(s * sectorHalfWidth(WEDGE, SHOULDER_Y), SHOULDER_Y, 0.012);
    pivot.rotation.set(-PZ_PITCH, 0, s * 0.2);
    body.add(pivot);

    const hose = new THREE.Mesh(
      hoseGeometry(
        [
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(s * 0.004, -0.075, 0.02),
          new THREE.Vector3(s * 0.013, -0.152, 0.026),
          new THREE.Vector3(s * 0.017, -0.226, 0.012),
        ],
        0.019,
        20,
        9,
      ).geometry,
      inkMat,
    );
    hose.name = s > 0 ? "armL" : "armR";
    hose.castShadow = true;
    pivot.add(hose);

    // The mitt. Four-fingered cartoon gloves are drawn as a blob with
    // separations, not as fingers — at this size a modelled hand is a smear.
    // MEASURED 0.149 SH across.
    const mitt = new THREE.Mesh(new THREE.SphereGeometry(0.054, 14, 11), gloveMat);
    mitt.name = s > 0 ? "gloveL" : "gloveR";
    mitt.scale.set(1, 0.92, 0.76);
    mitt.position.set(s * 0.019, -0.249, 0.01);
    mitt.castShadow = true;
    pivot.add(mitt);

    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, 0.022, 3, 7), gloveMat);
    thumb.name = s > 0 ? "gloveThumbL" : "gloveThumbR";
    thumb.rotation.set(0.35, 0, s * -0.85);
    thumb.position.set(s * 0.052, -0.234, 0.024);
    pivot.add(thumb);

    arms.push(pivot);
  }

  // --- legs and boots -------------------------------------------------------
  // Children of the ROOT, not of the pitched body: the slice leans, the stance
  // does not. The hips sit BEHIND the wedge, which is what makes the tip hang
  // down BETWEEN the legs — a detail the reference is explicit about, and the
  // thing that makes the pose legible as standing rather than as balancing on
  // a point.
  const legs: THREE.Object3D[] = [];
  for (const s of [1, -1] as const) {
    const pivot = new THREE.Group();
    pivot.name = s > 0 ? "legPivotL" : "legPivotR";
    pivot.position.set(s * 0.072, 0.2856, -0.045);
    pivot.rotation.z = s * 0.1;
    g.add(pivot);

    const hose = new THREE.Mesh(
      hoseGeometry(
        [
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(0, -0.062, 0.014),
          new THREE.Vector3(s * 0.002, -0.132, 0.046),
          new THREE.Vector3(0, -0.203, 0.062),
        ],
        0.0205,
        18,
        9,
      ).geometry,
      inkMat,
    );
    hose.name = s > 0 ? "legL" : "legR";
    hose.castShadow = true;
    pivot.add(hose);

    const boot = new THREE.Group();
    boot.name = s > 0 ? "bootL" : "bootR";
    boot.position.set(0, -0.203, 0.062);
    pivot.add(boot);

    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.041, 0.05, 0.078, 14), crustMat);
    shaft.name = s > 0 ? "bootShaftL" : "bootShaftR";
    shaft.position.set(0, -0.004, -0.014);
    shaft.castShadow = true;
    boot.add(shaft);

    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.05, 15, 11), crustMat);
    foot.name = s > 0 ? "bootFootL" : "bootFootR";
    foot.scale.set(0.98, 0.82, 1.1);
    foot.position.set(0, -0.038, -0.006);
    foot.castShadow = true;
    boot.add(foot);

    // The toe has to PROJECT past the ankle mass or the two spheres read as one
    // ball: no front, no back, and a walk cycle that looks like sliding. The
    // maki learned that at 0.9 on Z inside a boot already 1.35 long.
    const toe = new THREE.Mesh(new THREE.SphereGeometry(0.046, 15, 11), crustMat);
    toe.name = s > 0 ? "bootToeL" : "bootToeR";
    toe.scale.set(0.95, 0.76, 1.42);
    toe.position.set(0, -0.044, 0.052);
    toe.castShadow = true;
    boot.add(toe);

    // The collar, and ONLY the collar. The reference draws a pale sole sliver
    // under each boot (MEASURED 0.116 x 0.057 SH) and it was built, then cut:
    // the game camera sits at 59 degrees ELEVATION and looks down, so the
    // underside of a boot is a surface no player ever sees, and all the sliver
    // did at play size was put a bright rim between the boot and its own ground
    // shadow — a halo that made the foot read as hovering rather than as
    // planted. A drawn detail that only exists in a view the game never takes
    // is worth deleting, not shrinking. The collar alone still separates a boot
    // from a blob, which was the pair's real job.
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.0115, 6, 16), crustMat);
    collar.name = s > 0 ? "bootCollarL" : "bootCollarR";
    collar.rotation.x = Math.PI / 2;
    collar.scale.set(1, 1.08, 1);
    collar.position.set(0, 0.031, -0.014);
    boot.add(collar);

    legs.push(pivot);
  }

  const userData: GhostUserData = {
    bodyMat,
    eyes,
    pupPivots,
    pupM,
    pupBaseColor: pupM.color.getHex(),
    baseColor: color,
    // No hem and no skirt: this one WALKS, so it opts out of the shared ghost
    // breathe entirely and supplies its own stride, hair lag and idle sway.
    hem: [],
    pupOffset: { x: 0, z: 0 },
    // The crust roll and both boots, which share crustMat. They are a large
    // share of the silhouette at the TOP and the BOTTOM of the figure, so
    // following the frightened recolour is what stops a third of the enemy
    // staying warm while the player is chasing it. Everything else is a small
    // fixed accent and stays out (IDEA-053 rule 2) — and the gloves stay out
    // for a second reason as well: white at both hands and in the mouth is
    // what keeps the frightened silhouette from collapsing into one blue mass.
    accentMats: [crustMat],
    behaviour: pizzaBehaviour({ legs, arms, quiff, body }),
    eyeMats: pizzaEyeMats,
    spiritMats: collectSpiritMats(g, pizzaEyeMats),
  };
  g.userData = userData;
  return g;
}

// ---------------------------------------------------------------------------
// THE HAMBURGER — the eighth img2threejs rebuild (IDEA-059). Same split as
// every rebuild before it: the pipeline's evidence trail lives in
// .img2threejs/burger/ and the SHIPPED mesh below is hand-authored from the
// numbers that run locked. Geometry machinery in ./burgerSculpt.ts.
//
// WHY IT EXISTS. Ten enemies ship today. Nine of them have a body that is ONE
// mass — a shell, a drum, a block, a wedge — wearing marks. This one's body is
// a STACK: six contrasting bands piled up, and the banding is the whole read.
// Nothing else in the cast is striped across its full width, and at 25 px a
// striped tower is not confusable with a smooth one whatever colour it is.
//
// The other novelty is smaller and it is on the hands. Every gloved enemy in
// this game (the maki, the nigiri, the pizza) wears the same blob mitt. This
// one has FINGERS, and it holds two of them up in a V. It is the only gesture
// in the cast, and it is the reference's own pose.
//
// PROPORTION BASE: BH = THE STACK HEIGHT, top-bun crown to bottom-bun
// underside, MEASURED at 261 px in the reference and built at 0.62 world
// units. No head, and for the fourth subject running not even a stand-in for
// one: the face is drawn ON the top bun, which is band 1 of the body, so there
// is no crown, no chin and no neck and a "head height" would be an invention
// every ratio under it inherited (IDEA-054's carapace width, IDEA-056/057's
// nori disc and rice width, IDEA-058's slice height). The HEIGHT rather than
// the width, because the identity is how the body is BANDED and the bands
// divide the height.
//
// FIVE RULES ARE LOAD-BEARING.
//
//  1. THE BANDING IS THE IDENTITY, AND IT MUST SURVIVE THE FRIGHTENED
//     RECOLOUR. bodyMat is the BREAD — shared by the top bun and the bottom
//     bun, two DISJOINT masses at the top and the bottom of the body with the
//     garnish clamped between them. That is a fourth distinct arrangement
//     after the maki (repaints its wrapper), the nigiri (repaints its topping)
//     and the pizza (repaints its face plate), and it is the first where the
//     team colour lands in two separate places. `accentMats` is EMPTY ON
//     PURPOSE: the patty is the obvious candidate, being the largest fixed
//     mass, and putting it in would turn bread AND meat blue together and
//     collapse the whole stack to one blue lump exactly while the player is
//     chasing it. That is IDEA-053 rule 2, and here it applies to the biggest
//     accent on the model rather than to six hairlines.
//
//  2. THE WAIST HAS TO BE RAGGED OR IT IS A LAYER CAKE. The measured band
//     order DISAGREES between columns of the reference — lettuce/cheese/patty
//     at x=250, lettuce/onion/cheese/patty at x=300, tomato/patty/cheese at
//     x=460 — because the drawing overlaps its garnish rather than stacking
//     it. So the lettuce is a SCALLOPED ring (`frillRing`) and not a disc, the
//     cheese is a square slice whose corners hang over the patty
//     (`squircleSlab`), and the tomato and onion are OFF-CENTRE discs that
//     each peek out on one side only.
//
//  3. THE CHEESE'S FOUR DRIPS ARE ONE MECHANISM, NOT FOUR PARTS. A square laid
//     on a circle overhangs at exactly four places by construction; make the
//     overhang the part that droops and the drips place themselves. Four
//     separate pendant meshes would be four numbers to keep in step with the
//     patty's radius — the pizza's `sectorOutline` reasoning in a new place.
//
//  4. RUBBER HOSE MEANS NO ELBOWS AND NO KNEES. Every limb is ONE swept tube
//     of constant radius, sharing the pizza's `hoseGeometry`. It is a
//     measurement, not a shortcut: the reference's limb ink-run is the same
//     width at scanlines 100 px apart across a large change of direction. It
//     also makes the flea's and the crab's joint-gap problem unrepresentable
//     rather than merely absent.
//
//  5. THE TWO ARMS ARE DELIBERATELY NOT MIRRORS. One holds the V and does not
//     swing with the stride; the other is a closed fist and counter-swings
//     normally. An asymmetric pose is the thing that reads as a decision
//     rather than as a bug, so the raised arm gets its own slow wave — a rigid
//     raised arm on a walking figure looks broken, a waving one looks pleased
//     with itself.
const BG_LETTUCE = 0x7d9a35; // pushed to olive off the sampled #839f3c, see below
const BG_LETTUCE_DK = 0x5f7526;
const BG_TOMATO = 0xd8434b;
// Deepened from the sampled #b76c8a. That pink sits close enough to the ROSE
// team hue (#e0577a) that the onion sliver read as more bun on that one team
// — the lettuce/leaf collision in a second place, and this one is cheap to
// fix because nothing about an onion insists on being pale.
const BG_ONION = 0x9c5a86;
const BG_CHEESE = 0xffd154;
// The reference samples #8e3a2d, a red-brown, and it works there against an
// ORANGE bun. Here the bun is whichever of five team hues this slot fields,
// and on the ROSE team (#e0577a) a red-brown patty against a red bun is one
// mass — the darkest band in the stack disappearing into the largest. So the
// patty is taken to a deep BROWN instead: value contrast holds on all five
// hues and on the frightened blue, where hue contrast holds on three.
const BG_PATTY = 0x6b3a22;
const BG_PATTY_DK = 0x3d1f0f; // the char dimples
const BG_INK = 0x37110c; // limbs, brows, smile
const BG_GLOVE = 0xfdfbf4;
const BG_BOOT = 0xe5402c; // a VERMILION, not the sampled #ff4239 — see below
const BG_BOOT_DK = 0xa82b1c;
const BG_PUPIL = 0x3a1f18;
const BG_SESAME = 0xf6e6bd;

// The walk. Slower than the pizza's 8.4 and with less swing: this one is a
// heavy wide body on short legs, and a wide body at a quick patter reads as
// scurrying. It waddles instead.
const BG_STEP_FREQ = 7.2;
// 0.26, trimmed from 0.30, and the reason is measured rather than aesthetic.
// This boot's toe projects a long way on +Z (that projection is what stops the
// pair reading as urns), and rotating a long +Z part about X drops it BELOW its
// rest height — so a big stride digs the foot into the maze floor. The whole
// cast does this to some degree (ghost 0.035, pizza 0.029, crab 0.022, maki
// 0.014 — see scripts/_scratch-cast-animated.ts), and at 0.30 this one was the
// worst of them at 0.038. It is invisible in any still, which is exactly why it
// needs measuring.
const BG_STEP_SWING = 0.26;
const BG_ARM_SWING = 0.22;
const BG_IDLE_FREQ = 1.05 * Math.PI * 2;
const BG_IDLE_ARM = 0.09;
// The idle lean is a rotation.z on the stack, and the stack carries the raised
// arm — so every 0.01 of lean also swings the highest, furthest-out part of the
// model sideways. At 0.042 the burger's ANIMATED width reached 0.897, past the
// crab's 0.861, which is the crab's own recorded identity claim; a claim that
// only holds while both models stand still is not much of a claim.
const BG_IDLE_LEAN = 0.030;
/**
 * The pitch, in radians, that leans the whole stack BACK.
 *
 * A PLAY-CAMERA decision, not a measurement, and the reasoning is the reverse
 * of the pizza's. The pizza leans back to turn a vertical FACE toward a camera
 * that is 59 degrees up. This one leans back to stop the camera looking down
 * the axis its six BANDS are stacked along: with the stack upright the axis
 * sits only 31 degrees off the view direction, so every band projects at
 * sin(31) = 0.515 of its height AND the top bun, being the widest thing on the
 * model and the highest, occludes most of what is under it. Leaning back 15
 * degrees opens that to 46 degrees, sin 0.719 — a 40% taller band — and tips
 * the bun off the things it was covering.
 *
 * It is deliberately MODEST rather than the ~59 degrees that would put the
 * axis square to the view, for a reason worth writing down: `syncToEntity`
 * turns the enemy to face its own travel direction, so the lean is away from
 * the camera when it walks toward the player and toward the camera when it
 * walks away. A big lean would buy a great read half the time and a worse one
 * than upright the other half. 15 degrees reads as a jaunty backward lean from
 * every heading and never as a model falling over.
 *
 * It MUST live on the stack group rather than the root: applyGhostState
 * assigns `mesh.rotation.x` on the ROOT every time the state changes, so a
 * pitch authored there is erased the first time the beagle eats a bone
 * (IDEA-056 rule 3).
 */
const BG_PITCH = -15 * (Math.PI / 180);

// The wave, on the raised arm only. Deliberately NOT locked to the stride — its
// own frequency and phase, so the gesture never looks like part of the walk.
//
// It is ONE-SIDED, and that is a size decision as much as a motion one. A
// symmetric wave swings the hand as far OUT as it swings it in, and the hand is
// the furthest-out thing on the model: at an amplitude of 0.13 the burger's
// animated width reached 0.895, past the crab's 0.861 and the mosquito's own
// animated 0.861. Swinging inward-only from the authored pose means the
// envelope is set by the REST pose — the number the cast table actually
// publishes — so the gesture can be almost twice as large for free.
const BG_WAVE_FREQ = 3.1;
const BG_WAVE_AMP = 0.24;

interface BurgerParts {
  legs: THREE.Object3D[]; // [left, right] hip pivots
  swingArm: THREE.Object3D; // the FIST arm — counter-swings the stride
  waveArm: THREE.Object3D; // the V arm — holds its raise and waves
  stack: THREE.Object3D; // the banded body, for the idle weight shift
}

function burgerBehaviour(parts: BurgerParts): EnemyBehaviour {
  const { legs, swingArm, waveArm, stack } = parts;
  const swingRest = swingArm.rotation.x;
  const waveRestZ = waveArm.rotation.z;
  return {
    animate: (t, idleT, moveBlend) => {
      const step = Math.sin(t * BG_STEP_FREQ) * BG_STEP_SWING * moveBlend;
      legs[0].rotation.x = step;
      legs[1].rotation.x = -step;
      // Only ONE arm counter-swings, because only one arm is free. The rest
      // angle is the shoulder's own hang and has to be added back, or setting
      // rotation.x here would swing the arm up into the patty.
      const idleArm = Math.sin(idleT * BG_IDLE_FREQ) * BG_IDLE_ARM * (1 - moveBlend);
      swingArm.rotation.x = swingRest - step * (BG_ARM_SWING / BG_STEP_SWING) + idleArm;
      // The wave. It runs whether the burger is walking or standing — that is
      // what makes the raised arm read as held on purpose rather than as an
      // arm that failed to come down.
      // (1 - sin) / 2 runs 0..1, so this only ever rotates the arm INWARD from
      // its authored raise and never past it. See BG_WAVE_AMP.
      waveArm.rotation.z =
        waveRestZ + (1 - Math.sin(idleT * BG_WAVE_FREQ)) * 0.5 * BG_WAVE_AMP;
      // A wide body on two short legs needs a weight shift or it reads as a
      // prop being slid along. Roll about the travel axis, which syncToEntity's
      // own waddle then rides on top of.
      // rotation.z ONLY. The stack's rotation.x carries the authored BG_PITCH
      // and nothing here may touch it.
      stack.rotation.z = Math.sin(idleT * BG_IDLE_FREQ * 0.5) * BG_IDLE_LEAN * (1 - moveBlend * 0.6);
    },
  };
}

/**
 * Builds the hamburger mascot enemy skin (IDEA-059).
 *
 * Satisfies the same `GhostUserData` contract as every other skin, so game.ts
 * never learns which one is equipped.
 */
export function makeBurger(color: number): THREE.Group {
  const g = new THREE.Group();
  g.name = "root";

  // --- proportions, all in BH multiples measured off the reference ----------
  const BH = 0.62; // proportion base: the stack height
  const Y0 = 0.185; // the bottom bun's lowest point
  // The boot's own origin, chosen so the toe's UNDERSIDE lands on y = 0. It is
  // derived rather than guessed because it was wrong first: authored from a
  // nominal boot height the model floated 0.0186 above the floor, which no
  // render shows (the enemy just sits a little high in its own shadow) and
  // which `_scratch-exact-cast.ts` reports as `floor 0.018`. Toe centre sits
  // 0.074 below the origin and its scaled radius is 0.0394, so the origin has
  // to be exactly their sum.
  const BOOT_SOLE = 0.080 + 0.083 * 0.55; // 0.1257
  const HIP_Y = 0.236;
  const CROWN = Y0 + BH; // 0.805

  // The reference figure is LEGGIER than this cast allows. Taken literally at a
  // readable stack width it stands 1.10 world units, against a cast whose
  // tallest crown is the pizza's 0.873. Height had to come off, and it comes
  // off the legs rather than off the stack because the stack is the identity.
  // Recorded in .img2threejs/burger/measurements.md as departure 2 so it is
  // never mistaken later for something that was measured.

  // THE GARNISH IS WIDER THAN BOTH BUNS, and that is the single most important
  // number on this model. The play camera sits at 59 degrees ELEVATION, so a
  // vertical extent projects at cos(59) = 0.515 while a horizontal one does
  // not: the six bands are stacked along the ONE axis the camera foreshortens,
  // and the first build proved it — 0.136 of band under 0.392 of bun came back
  // as a hairline on a ball. Radial protrusion is what survives that view, so
  // the filling squeezes out past the bread by 0.061 (17% of the bun's own
  // radius) and the frill's scalloped edge and the cheese's corners are read
  // from any elevation at all. It is also what the reference draws.
  // THE BAND IS BUILT BIGGER THAN IT MEASURES AND THE BREAD SMALLER, and this
  // is the largest deliberate departure on the model. Measured, the reference
  // divides its stack 0.632 bun / 0.218 garnish / 0.149 base. Built to those
  // numbers this model came back as a red EGG with a stripe round it, from
  // every angle, and the reason is not proportion — it is that the reference
  // has two things this renderer does not. Its bun is ORANGE against a green,
  // red, yellow and brown band, and every one of its bands carries a hard ink
  // KEYLINE. Here both bun masses take the same team hue (bodyMat is the
  // bread) and there is no outline pass in the project at all, so two same-
  // coloured domes 0.22 apart simply close up into one form. The separation
  // has to be bought with SHAPE instead: 0.53 / 0.30 / 0.17.
  const BUN_H = 0.329; // 0.530 BH — MEASURED 0.632
  // 0.330, narrowed from 0.352 for the play camera and not for the reference.
  // From 59 degrees up the top bun is both the highest and the widest thing on
  // the model, so it OCCLUDES the five bands under it and all a player sees is
  // whatever sticks out past its own rim. Every millimetre off this radius is a
  // millimetre of garnish ring that becomes visible, and the ring is 34% wider
  // at 0.330 than it was at 0.352.
  const BUN_R = 0.330; // aspect 0.499: a shallow CAP, not a dome
  const BUN_Y = CROWN - BUN_H; // 0.476, the cap's base
  const BOT_H = 0.105; // 0.170 BH — MEASURED 0.149
  // 0.833 of the top bun against a MEASURED 0.917 — the same argument as the
  // band heights above, and the other half of what breaks the egg.
  const BOT_R = 0.275;
  // The patty is now the second-largest mass on the model and the darkest, at
  // 0.17 BH against a MEASURED 0.123. It is the stack's value anchor and it is
  // what a player reads as "there is something between the two bits of bread"
  // from a camera 59 degrees up.
  const PATTY_H = 0.105; // 0.170 BH — MEASURED 0.123
  // 0.372 — WIDER THAN THE TOP BUN (0.330), WIDER THAN THE BOTTOM BUN (0.275)
  // AND WIDER THAN THE FRILL'S OWN TROUGHS (0.368). That last comparison is the
  // one that matters, and it is what the CLAY RENDER (`?flat=1`) was needed to
  // find. In colour the model looked finished; map-stripped it was a ball with
  // a ruffled skirt, because the entire six-band stack was being carried by
  // COLOUR and the only geometric events on the whole body were the frill and
  // the boots. The two bun masses merged into one sphere in clay exactly the
  // way they had merged into one egg in colour two passes earlier — the same
  // defect, found twice by two different instruments, because it was never
  // fixed in the geometry.
  //
  // A band has to be a LEDGE in the silhouette, not a stripe on it. The patty
  // protruding 0.042 past the bun is what turns the profile into a real step
  // sequence: narrow cap, ruffled waist, wide dark ledge, narrow base.
  const PATTY_R = 0.372;
  const PATTY_TOP = Y0 + BOT_H + PATTY_H; // 0.395
  const CHEESE_Y = PATTY_TOP + 0.004;
  const FRILL_Y = 0.450;

  // --- materials ------------------------------------------------------------
  // bodyMat is the BREAD, and both buns share it — see rule 1. There is no
  // BG_BUN constant on purpose: the reference's bun samples #ea9b3c, but that
  // colour is never on screen, because this material is ALWAYS one of the five
  // team hues (or the frightened blue). Keeping the sampled value as a named
  // constant would put a colour in the palette that nothing can ever show.
  const bodyMat = toon({ color, emissive: color, emissiveIntensity: 0.15 });
  // Pushed to olive off the sampled #839f3c on purpose. The LEAF team hue is
  // #6fb84a and the buns take it, so on exactly one team of five a green frill
  // would sit against a green bun; darkening and de-saturating it keeps a value
  // step there even when the hue step is gone. The same class of decision as
  // the pizza's brown-orange crust, and bounded the same way: the tomato, the
  // cheese and the patty carry the band on their own if this one loses.
  const lettuceMat = toon({ color: BG_LETTUCE });
  lettuceMat.userData.baseColor = BG_LETTUCE;
  const lettuceDkMat = toon({ color: BG_LETTUCE_DK });
  lettuceDkMat.userData.baseColor = BG_LETTUCE_DK;
  const tomatoMat = toon({ color: BG_TOMATO });
  tomatoMat.userData.baseColor = BG_TOMATO;
  const onionMat = toon({ color: BG_ONION });
  onionMat.userData.baseColor = BG_ONION;
  const cheeseMat = toon({ color: BG_CHEESE });
  cheeseMat.userData.baseColor = BG_CHEESE;
  const pattyMat = toon({ color: BG_PATTY });
  pattyMat.userData.baseColor = BG_PATTY;
  const charMat = toon({ color: BG_PATTY_DK });
  charMat.userData.baseColor = BG_PATTY_DK;
  const inkMat = toon({ color: BG_INK });
  inkMat.userData.baseColor = BG_INK;
  const gloveMat = toon({ color: BG_GLOVE });
  gloveMat.userData.baseColor = BG_GLOVE;
  // A VERMILION rather than the reference's #ff4239. The rose team hue is
  // #e0577a and the buns take it; a pink-red boot under a pink-red bun is one
  // mass on that team and nowhere else — the kind of bug that ships. This one
  // leans orange and stays a different hue family.
  const bootMat = toon({ color: BG_BOOT });
  bootMat.userData.baseColor = BG_BOOT;
  const bootDkMat = toon({ color: BG_BOOT_DK });
  bootDkMat.userData.baseColor = BG_BOOT_DK;
  const sesameMat = toon({ color: BG_SESAME });
  sesameMat.userData.baseColor = BG_SESAME;
  // Its own material rather than a share of the glove: it belongs to eyeMats,
  // the list kept SOLID while the enemy is eaten, and sharing would leave the
  // gloves solid too — a spirit coming home still wearing them.
  const scleraMat = toon({ color: 0xffffff });
  const pupM = toon({ color: BG_PUPIL });
  const glintMat = toon({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.5 });
  const burgerEyeMats = [scleraMat, pupM, glintMat];

  // --- the stack ------------------------------------------------------------
  // An INNER group. applyGhostState assigns rotation.x on the ROOT every time
  // the state changes, so anything authored on the root is erased the first
  // time the beagle eats a bone (IDEA-056 rule 3) — and the idle weight shift
  // lives here for the same reason.
  const stack = new THREE.Group();
  stack.name = "stack";
  stack.rotation.set(-0.037, 0.018, -0.01);
  // Pushed forward on Z because a 15-degree lean carries the crown 0.16
  // backwards; without it the mass sits behind the feet and the mascot reads as
  // toppling rather than as leaning.
  stack.position.z = 0.052;
  g.add(stack);

  const bottomBun = new THREE.Mesh(
    latheFromProfile(bandProfile(BOTTOM_BUN_STATIONS, false, true), 36, BOT_R * 2, BOT_H, BOT_R * 2),
    bodyMat,
  );
  bottomBun.name = "bottomBun";
  bottomBun.position.y = Y0 + BOT_H / 2;
  bottomBun.castShadow = true;
  stack.add(bottomBun);

  const patty = new THREE.Mesh(
    latheFromProfile(bandProfile(PATTY_STATIONS, true, true), 36, PATTY_R * 2, PATTY_H, PATTY_R * 2),
    pattyMat,
  );
  patty.name = "patty";
  patty.position.y = PATTY_TOP - PATTY_H / 2;
  patty.castShadow = true;
  stack.add(patty);

  // Char dimples, and they go on the RIM rather than on the face. The play
  // camera sits at 59 degrees ELEVATION and looks down: the patty's top face is
  // under the cheese and its bottom face is under the bun, so the rim is the
  // only part of it a player ever sees. Marks on the face would be correct,
  // invisible, and 300 triangles.
  const charRand = rng(0x8a3c);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + charRand() * 0.3;
    const yy = PATTY_TOP - PATTY_H * (0.28 + charRand() * 0.44);
    const dimple = new THREE.Mesh(new THREE.SphereGeometry(0.011, 6, 4), charMat);
    dimple.name = `pattyChar${i}`;
    dimple.scale.set(1.6, 0.62, 0.62);
    dimple.position.set(PATTY_R * 0.985 * Math.sin(a), yy, PATTY_R * 0.985 * Math.cos(a));
    dimple.rotation.y = a;
    stack.add(dimple);
  }

  // The cheese. `supportRadius` is the patty's own radius, so the drips are
  // exactly the overhang and nothing else — change the patty and they follow.
  const cheese = new THREE.Mesh(
    squircleSlab({
      // 0.322 puts the corners at 0.406, PAST the frill's own troughs at 0.368
      // AND past the patty's rim at 0.372 — which they have to clear too, since
      // widening the patty into a ledge (see PATTY_R) put a new thing in front
      // of the drips. Two systems, one number; the COMPARISON SHEET is what
      // showed the cheese had quietly gone back to a sliver
      // — so two of the four punch through the green ring as a yellow flash
      // when the model is seen from above, which is the one angle at which the
      // cheese otherwise contributes nothing at all.
      halfWidth: 0.322,
      // 6.0, not the 2.4 the first build used. A squircle's DIAGONAL radius is
      // halfWidth * 2^(0.5 - 1/n), which at n = 2.4 is 1.059 — a 6% bulge, i.e.
      // very nearly a circle. Measured, the slab came out 0.300 across its
      // axes and 0.318 across its corners and there were no corners to hang:
      // the whole four-drips-for-free mechanism was there and producing
      // nothing. At n = 6 the factor is 1.260 and the corners reach 0.372
      // against a 0.318 patty, so they overhang by 0.054 and droop.
      exponent: 6.0,
      thickness: 0.018,
      supportRadius: PATTY_R * 0.78,
      // Far enough that the corners clear the patty's own bottom edge. A drip
      // that stops short of the mass it is dripping off is a bevel.
      droop: 0.098,
      droopJitter: 0.45,
      seed: 0x5c1e,
      segments: 64,
      rings: 5,
    }),
    cheeseMat,
  );
  cheese.name = "cheese";
  cheese.position.y = CHEESE_Y;
  cheese.rotation.y = Math.PI / 4; // corners to the diagonals: two hang toward the camera
  cheese.castShadow = true;
  stack.add(cheese);

  // Tomato and onion: OFF-CENTRE discs, each peeking out on one side only.
  // That asymmetry is measured — the reference's tomato is dominant on the
  // viewer-right and its onion on the left — and it is what stops the garnish
  // band reading as a stripe. Two full concentric rings would average it away.
  // The garnish is its own subassembly: two off-centre discs that only make
  // sense together, and the thing a person means when they say "the salad".
  const garnish = new THREE.Group();
  garnish.name = "garnish";
  stack.add(garnish);

  const tomato = new THREE.Mesh(new THREE.CylinderGeometry(0.348, 0.348, 0.026, 30), tomatoMat);
  tomato.name = "tomato";
  tomato.position.set(0.056, 0.424, 0.014);
  garnish.add(tomato);

  const onion = new THREE.Mesh(new THREE.CylinderGeometry(0.330, 0.330, 0.015, 26), onionMat);
  onion.name = "onion";
  onion.position.set(-0.064, 0.438, -0.006);
  garnish.add(onion);

  // The lettuce frill. Its inner edge is a clean circle and only the OUTER
  // edge scallops — a frill that waved at its inner edge too would open gaps
  // into the stack at every trough, and a gap into a stack shows the inside of
  // the band above it.
  const frill = new THREE.Mesh(
    frillRing({
      rInner: 0.298,
      rOuter: 0.386,
      thickness: 0.044,
      lobes: 9,
      lobeAmp: 0.24, // outer tip reaches 0.407 — the widest thing on the model
      dropAmp: 0.046,
      seed: 0x1b7f,
      segments: 76,
    }),
    lettuceMat,
  );
  frill.name = "lettuce";
  frill.position.y = FRILL_Y;
  frill.castShadow = true;
  stack.add(frill);

  // A second, smaller frill tucked under the first and darker. Two rings is
  // what turns a scalloped edge into a LEAFY one: a single ring reads as a
  // pie-crust crimp, and the reference draws lettuce two or three leaves deep.
  const frill2 = new THREE.Mesh(
    frillRing({
      rInner: 0.288,
      rOuter: 0.372,
      thickness: 0.036,
      lobes: 7,
      lobeAmp: 0.28,
      dropAmp: 0.042,
      seed: 0x64d2,
      segments: 64,
    }),
    lettuceDkMat,
  );
  frill2.name = "lettuceUnder";
  frill2.position.y = FRILL_Y - 0.036;
  frill2.rotation.y = 0.4;
  stack.add(frill2);

  const topBun = new THREE.Mesh(
    latheFromProfile(bandProfile(TOP_BUN_STATIONS, true, false), 44, BUN_R * 2, BUN_H, BUN_R * 2),
    bodyMat,
  );
  topBun.name = "topBun";
  topBun.position.y = BUN_Y + BUN_H / 2;
  topBun.castShadow = true;
  stack.add(topBun);

  // --- sesame -------------------------------------------------------------
  // THE SESAME IS DOING MORE WORK HERE THAN IN THE REFERENCE, and it is sized
  // for that rather than measured. The reference's bun is ORANGE, so it reads
  // as bread on its colour alone and the seeds are a garnish. This one's bun is
  // whichever of five team hues the slot fields - on the rose team it is a big
  // pink dome - so the seeds are the only mark on the largest mass of the model
  // that says "bread" on EVERY hue and on the frightened blue as well. Built at
  // the measured 0.023 BH they came back as specks; 38 of them at half again
  // that size is a deliberate departure, recorded as one.
  //
  // Laid FLAT against the dome and pushed out along its own normal, which is
  // what `scatterOnBand` returns the normal for: a seed oriented to the radius
  // instead lies flat near the equator and stands on end near the crown. They
  // are also raised rather than painted, so they survive the team recolour of
  // the bun underneath them — the one mark on the model that is guaranteed to
  // read on all five hues and on the frightened blue.
  const up = new THREE.Vector3(0, 1, 0);
  const seeds = scatterOnBand(
    TOP_BUN_STATIONS, 38, 0x2f91, BUN_R, BUN_H, CROWN,
    [0.05, 0.80], 1.7,
    // Carve out the face. The reference has no seed below the brow line and
    // none between the eyes, and a sesame seed sitting on an eyeball is the
    // kind of thing that only shows up once everything else is finished.
    { phi: 0.72, t: [0.30, 0.78] },
  );
  seeds.forEach((s, i) => {
    const seedMesh = new THREE.Mesh(new THREE.SphereGeometry(0.0205, 7, 5), sesameMat);
    seedMesh.name = `sesame${i}`;
    seedMesh.scale.set(0.60, 0.34, 1);
    seedMesh.position.copy(s.position).addScaledVector(s.normal, 0.005);
    seedMesh.quaternion.setFromUnitVectors(up, s.normal);
    seedMesh.rotateY(s.spin);
    stack.add(seedMesh);
  });

  // --- the face -------------------------------------------------------------
  // Everything here is placed by `onBand`, i.e. in (azimuth, height-fraction)
  // on the dome's own measured profile rather than in absolute coordinates.
  // The face therefore FOLLOWS the dome — which is the separator from the
  // pizza, whose face is a flat plate — and retuning the bun moves the face
  // with it instead of sinking it in or floating it off.
  const face = new THREE.Group();
  face.name = "face";
  stack.add(face);

  const EYE_T = 0.530; // 0.335 BH below the crown — MEASURED
  const EYE_X = 0.1091; // half of a MEASURED 0.352 BH separation
  const eyeR = stationRadius(TOP_BUN_STATIONS, EYE_T) * BUN_R;
  const EYE_PHI = Math.asin(Math.min(0.99, EYE_X / eyeR));

  const eyes: THREE.Object3D[] = [];
  const pupPivots: THREE.Object3D[] = [];
  for (const s of [1, -1] as const) {
    const p = onBand(TOP_BUN_STATIONS, EYE_T, s * EYE_PHI, BUN_R, BUN_H, CROWN);
    const outward = new THREE.Vector3(p.x, 0, p.z).normalize();

    const pivot = new THREE.Group();
    pivot.name = s > 0 ? "pupilPivotL" : "pupilPivotR";
    pivot.position.copy(p);
    // Turn the whole eye to face out along the dome's own surface, so the
    // sclera sits flush instead of cutting a lens out of the bun.
    pivot.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), outward);
    face.add(pivot);

    // MEASURED 0.115 x 0.153 BH, centres 0.352 BH apart — so the two nearly
    // touch, with a third of an eye's width of bun between them. That
    // closeness is the strongest cartoon signal the face carries; spaced at
    // human proportions the whole read goes.
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.050, 16, 12), scleraMat);
    eye.name = s > 0 ? "eyeL" : "eyeR";
    eye.scale.set(0.72, 0.95, 0.42);
    eye.position.z = 0.004;
    pivot.add(eye);

    const pup = new THREE.Mesh(new THREE.SphereGeometry(0.036, 14, 10), pupM);
    pup.name = s > 0 ? "pupilL" : "pupilR";
    pup.scale.set(0.76, 0.88, 0.36);
    pup.position.set(s * 0.006, -0.004, 0.014);
    pivot.add(pup);

    // The catchlight is a WEDGE, not a dot. It is the reference's one
    // un-generic face mark and it costs four triangles to keep.
    const glint = new THREE.Mesh(new THREE.ConeGeometry(0.013, 0.020, 4), glintMat);
    glint.name = s > 0 ? "glintL" : "glintR";
    glint.scale.set(1, 1, 0.5);
    glint.rotation.set(Math.PI / 2, 0, s * 0.5);
    glint.position.set(s * -0.010, 0.012, 0.026);
    pivot.add(glint);

    eyes.push(pivot, eye, pup, glint);
    pupPivots.push(pivot);
  }

  // The brows: detached ink arcs above and OUTBOARD of each eye, built as
  // tubes whose points lie on the dome so they hug it. Detached is the point —
  // a brow drawn on the lid is an eyelid, a brow floating above it is an
  // expression, and at 25 px it is most of the expression there is.
  //
  // Built as a swept curve rather than as a torus arc for a reason worth
  // keeping: a torus ARC is not symmetric, so its mirror is a REFLECTION
  // (pi - a0 - A) and not a rotation by pi, which is how the pizza's first
  // build ended up with one brow and one stray tick. Sampling phi symmetrically
  // and negating it for the other side makes that mistake unrepresentable.
  for (const s of [1, -1] as const) {
    const pts: THREE.Vector3[] = [];
    // MEASURED: the reference's brow is 58 px across against a 30 px sclera,
    // i.e. 1.93x the eye's own width. The eye spans 0.232 rad here, so the brow
    // wants 0.448 — a half-width of 0.224, rounded up a touch.
    const HALF = 0.24;
    for (let i = 0; i <= 10; i++) {
      const u = i / 10;
      const phi = s * (EYE_PHI + (u - 0.5) * 2 * HALF);
      // The arch: highest in the middle, and the OUTER end drops further than
      // the inner one. The sign of that asymmetry is the whole difference
      // between friendly and a scowl — two inner ends dropped is the universal
      // cartoon glare.
      const e = (u - 0.5) * 2;
      // The ARCH term has to dominate the TILT term or this is not a brow, it is
      // a slanted bar. The reference measures 32 px of curvature across 58 px
      // of brow — a pronounced arc — and the first two builds had 0.028 and
      // 0.034 of arch against 0.018 and then 0.042 of tilt, so the tilt swamped
      // it and both ends came out on the same side of the middle. What renders
      // from that is a straight line over a big pupil, which reads DEADPAN at
      // best and stern at worst, and neither is the reference's expression.
      //
      // Base 0.352 puts the crown of the arc above the sclera's own top edge
      // (t 0.386); the ends drop to 0.433 and 0.461, which is bun on both sides
      // because the brow is nearly twice the eye's width. The tilt is small but
      // it stays, and its SIGN is the difference between friendly and a scowl:
      // outer end LOWER (larger t). Two inner ends dropped is the universal
      // cartoon glare, and IDEA-058 shipped it once already.
      const t = 0.352 + 0.095 * e * e + 0.014 * e;
      pts.push(onBand(TOP_BUN_STATIONS, t, phi, BUN_R * 1.012, BUN_H, CROWN));
    }
    const brow = new THREE.Mesh(hoseGeometry(pts, 0.0068, 12, 6).geometry, inkMat);
    brow.name = s > 0 ? "browL" : "browR";
    face.add(brow);
  }

  // The smile. A LINE, not an aperture: no teeth, no tongue, no cavity. That
  // is deliberate and it is a separator — the pizza's open mouth with a tongue
  // in it is one of ITS identity features, and two food mascots with the same
  // mouth would be two of the same thing.
  const smilePts: THREE.Vector3[] = [];
  const SMILE_HALF = 0.46;
  for (let i = 0; i <= 18; i++) {
    const u = i / 18;
    const e = (u - 0.5) * 2;
    const phi = e * SMILE_HALF;
    // Lowest at the centre, rising at both ends: t is the fraction DOWN the
    // dome, so the ends want a SMALLER t. Getting that sign backwards draws a
    // frown, and a frown on a burger reads as a bug rather than as a mood.
    const t = 0.891 - 0.150 * e * e;
    smilePts.push(onBand(TOP_BUN_STATIONS, t, phi, BUN_R * 1.012, BUN_H, CROWN));
  }
  const smile = new THREE.Mesh(hoseGeometry(smilePts, 0.0105, 22, 6).geometry, inkMat);
  smile.name = "smile";
  face.add(smile);

  // The two ticks that turn up at the corners of the mouth. They are four
  // hundred triangles of nothing at play size and they are what makes the
  // smile read as drawn rather than as a groove.
  for (const s of [1, -1] as const) {
    const tick: THREE.Vector3[] = [];
    for (let i = 0; i <= 5; i++) {
      const u = i / 5;
      const phi = s * (SMILE_HALF + u * 0.055);
      tick.push(onBand(TOP_BUN_STATIONS, 0.741 - u * 0.052, phi, BUN_R * 1.012, BUN_H, CROWN));
    }
    const t = new THREE.Mesh(hoseGeometry(tick, 0.0085, 6, 5).geometry, inkMat);
    t.name = s > 0 ? "smileTickL" : "smileTickR";
    face.add(t);
  }

  // The nose: a small ball sitting ON the smile's crest and overlapping it,
  // which is what the reference draws. Bread-coloured, so it reads as part of
  // the bun pushed forward rather than as a separate object stuck to it — and
  // it therefore follows the team recolour with the rest of the bread.
  // t = 0.700, which is the MEASURED value (115 px below the crown of a 165 px
  // bun). The first build had it at 0.762 — a transcription slip, not a
  // decision — and 0.06 of bun height was the whole difference between a nose
  // and a TONGUE: at 0.762 the ball sat down on the smile's own crest, and a
  // warm bun-coloured bump inside a dark mouth curve is a tongue however it
  // was labelled. The ink arc went the same way and now sits UNDER the ball
  // rather than around it. The drawing gets away with a nose on the mouth line
  // because it carries a full ink circle that closes the nose off as its own
  // object; a toon mesh has no outline to close with, so the separation has to
  // be geometric instead.
  const noseP = onBand(TOP_BUN_STATIONS, 0.700, 0, BUN_R, BUN_H, CROWN);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.0295, 12, 9), bodyMat);
  nose.name = "nose";
  nose.scale.set(1, 0.92, 0.78);
  nose.position.copy(noseP);
  nose.position.z += 0.006;
  face.add(nose);

  const noseInk = new THREE.Mesh(
    new THREE.TorusGeometry(0.0250, 0.0050, 5, 14, Math.PI * 0.72),
    inkMat,
  );
  noseInk.name = "noseCrease";
  noseInk.scale.set(1.1, 0.85, 0.5);
  noseInk.rotation.z = Math.PI + 0.62; // the arc UNDER the ball, opening upward
  noseInk.position.copy(nose.position);
  noseInk.position.y -= 0.004;
  noseInk.position.z -= 0.003;
  face.add(noseInk);

  // --- arms -----------------------------------------------------------------
  // Both shoulders sit at the garnish line, on the stack's own widest band —
  // there is no torso to hang them from and no shoulder to speak of, which is
  // the same thing the maki and the nigiri had to solve. Positive rotation.z
  // swings a part hanging at -y toward +x.
  const SHOULDER_Y = 0.408;
  // INSIDE the patty's own radius (0.362) on purpose. There is no shoulder to
  // hang an arm off, so the pivot is buried in the filling and the hose emerges
  // from the side of the stack the way the reference draws it. It is also where
  // the width budget came from: the raised hand's reach is measured from here,
  // and moving the pivot in by 0.03 buys 0.03 of envelope for nothing visible.
  const SHOULDER_R = 0.285;

  // The FIST arm. Hangs, and counter-swings the stride.
  const arms = new THREE.Group();
  arms.name = "arms";
  stack.add(arms);

  const swingArm = new THREE.Group();
  swingArm.name = "armPivotR";
  swingArm.position.set(-SHOULDER_R, SHOULDER_Y, 0.02);
  swingArm.rotation.z = -0.235;
  arms.add(swingArm);

  const fistHose = new THREE.Mesh(
    hoseGeometry(
      [
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(-0.014, -0.050, 0.030),
        new THREE.Vector3(-0.024, -0.098, 0.048),
        new THREE.Vector3(-0.026, -0.142, 0.048),
      ],
      0.0195,
      18,
      9,
    ).geometry,
    inkMat,
  );
  fistHose.name = "armR";
  fistHose.castShadow = true;
  swingArm.add(fistHose);

  // The CUFF. The pizza's mitts have no cuff and this one does: it is what
  // makes the hand read as a worn glove rather than as a white blob on the end
  // of a stick, and it is a measured 0.218 BH across — wider than the mitt.
  const gloveFist = new THREE.Group();
  gloveFist.name = "gloveFist";
  swingArm.add(gloveFist);

  const fistCuff = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.044, 0.026, 14), gloveMat);
  fistCuff.name = "cuffR";
  fistCuff.position.set(-0.026, -0.152, 0.048);
  gloveFist.add(fistCuff);

  const fist = new THREE.Mesh(new THREE.SphereGeometry(0.050, 14, 11), gloveMat);
  fist.name = "gloveR";
  fist.scale.set(1, 0.94, 0.86);
  fist.position.set(-0.028, -0.190, 0.048);
  fist.castShadow = true;
  gloveFist.add(fist);

  const fistThumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.013, 0.020, 3, 7), gloveMat);
  fistThumb.name = "gloveThumbR";
  fistThumb.rotation.set(0.3, 0, 0.9);
  fistThumb.position.set(-0.064, -0.182, 0.058);
  gloveFist.add(fistThumb);

  // The V ARM. Raised, and it does NOT swing with the stride — it holds the
  // gesture and waves. Its hand tops out AT the bun's crown rather than the
  // measured 0.134 BH above it: measured, this model's crown would pass the
  // pizza's 0.873, and being the tallest in the cast is the pizza's own
  // recorded identity claim. A hand at crown height still reads as a wave.
  const waveArm = new THREE.Group();
  waveArm.name = "armPivotL";
  waveArm.position.set(SHOULDER_R, SHOULDER_Y, 0.02);
  // NEGATIVE, and the sign is the whole difference between a raised arm and no
  // arm at all. rotation.z positive swings a part toward +x when it hangs at
  // -y — but this one points UP, so the same positive angle folds it across
  // the body instead. The first build had +0.46 and the entire arm, hand,
  // fingers and cuff rendered INSIDE the bun: not a subtle defect, an invisible
  // one, because a limb buried in a solid looks exactly like a limb that was
  // never built. The maki lost both of its arms the same way.
  waveArm.rotation.z = -0.195;
  arms.add(waveArm);

  const waveHose = new THREE.Mesh(
    hoseGeometry(
      [
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0.026, 0.078, 0.020),
        new THREE.Vector3(0.030, 0.166, 0.040),
        new THREE.Vector3(0.018, 0.254, 0.050),
      ],
      0.0195,
      18,
      9,
    ).geometry,
    inkMat,
  );
  waveHose.name = "armL";
  waveHose.castShadow = true;
  waveArm.add(waveHose);

  const waveCuff = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.052, 0.026, 14), gloveMat);
  waveCuff.name = "cuffL";
  waveCuff.position.set(0.018, 0.264, 0.050);
  waveArm.add(waveCuff);

  // THE HAND. It is the only one in the cast with fingers, so it is built as a
  // hand: a palm, two fingers up in a V, two knuckles folded down and a thumb
  // across them. At the 25 px play size this is a white nub above the body and
  // the RAISED ARM is what reads; the V is a shop-and-showcase feature and the
  // spec's review target tiers it 'important' rather than 'critical' for
  // exactly that reason.
  const hand = new THREE.Group();
  hand.name = "gloveV";
  hand.position.set(0.018, 0.300, 0.052);
  hand.rotation.z = -0.12;
  waveArm.add(hand);

  const palm = new THREE.Mesh(new THREE.SphereGeometry(0.042, 13, 10), gloveMat);
  palm.name = "palmL";
  palm.scale.set(0.94, 1, 0.82);
  palm.castShadow = true;
  hand.add(palm);

  // The two raised fingers. They have to CLEAR each other and clear the bun's
  // outline, or the V closes up into the silhouette and the hand is a lump —
  // which is the whole reason for building a hand at all. Splayed 34 degrees,
  // measured off the reference's two finger runs (12x46 and 15x40 px).
  const FINGERS: readonly (readonly [number, number, number])[] = [
    [-0.30, 0.070, 0.0155], // the taller, more upright one
    [0.30, 0.060, 0.0150],
  ];
  FINGERS.forEach(([tilt, len, rad], i) => {
    const f = new THREE.Mesh(new THREE.CapsuleGeometry(rad, len, 4, 9), gloveMat);
    f.name = `fingerL${i}`;
    f.rotation.z = tilt;
    f.position.set(Math.sin(tilt) * -(len / 2 + 0.030), Math.cos(tilt) * (len / 2 + 0.030), 0.004);
    f.castShadow = true;
    hand.add(f);
  });

  // The folded fingers and the thumb — drawn, in the reference, as a stack of
  // knuckle bumps rather than as fingers. At this size a modelled curled
  // finger is a smear; three bumps read.
  for (let i = 0; i < 3; i++) {
    const k = new THREE.Mesh(new THREE.SphereGeometry(0.0165, 8, 6), gloveMat);
    k.name = `knuckleL${i}`;
    k.scale.set(1, 0.86, 1.1);
    k.position.set(0.030, 0.016 - i * 0.021, 0.014);
    hand.add(k);
  }
  const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.0135, 0.022, 3, 7), gloveMat);
  thumb.name = "thumbL";
  thumb.rotation.set(0.2, 0, -1.15);
  thumb.position.set(0.006, -0.026, 0.030);
  hand.add(thumb);

  // --- legs and boots -------------------------------------------------------
  // Children of the ROOT, not of the stack: the body leans and sways, the
  // stance does not.
  const legRig = new THREE.Group();
  legRig.name = "legs";
  g.add(legRig);

  const legs: THREE.Object3D[] = [];
  for (const s of [1, -1] as const) {
    const pivot = new THREE.Group();
    pivot.name = s > 0 ? "legPivotL" : "legPivotR";
    pivot.position.set(s * 0.1105, HIP_Y, -0.010);
    pivot.rotation.z = s * 0.06;
    legRig.add(pivot);

    const hose = new THREE.Mesh(
      hoseGeometry(
        [
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(0, -0.034, 0.010),
          new THREE.Vector3(s * 0.002, -0.078, 0.026),
          new THREE.Vector3(0, BOOT_SOLE - HIP_Y, 0.034),
        ],
        0.030,
        16,
        9,
      ).geometry,
      inkMat,
    );
    hose.name = s > 0 ? "legL" : "legR";
    hose.castShadow = true;
    pivot.add(hose);

    const boot = new THREE.Group();
    boot.name = s > 0 ? "bootL" : "bootR";
    boot.position.set(0, BOOT_SOLE - HIP_Y, 0.034);
    pivot.add(boot);

    // THE COLLAR IS A FUNNEL, and that is measured: 0.287 BH across against a
    // 0.096 BH leg — nearly three times the tube it swallows. The pizza's boot
    // takes a thin torus for a collar and it is right for a boot that is
    // mostly foot; this reference draws a bowl the leg drops into, and at play
    // size the flare is most of what says "boot" rather than "dark blob".
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.054, 0.044, 0.028, 16), bootMat);
    collar.name = s > 0 ? "bootCollarL" : "bootCollarR";
    collar.position.y = -0.012;
    collar.castShadow = true;
    boot.add(collar);

    const collarLip = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.0066, 6, 18), bootDkMat);
    collarLip.name = s > 0 ? "bootLipL" : "bootLipR";
    collarLip.rotation.x = Math.PI / 2;
    collarLip.position.y = 0.002;
    boot.add(collarLip);

    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.064, 0.036, 14), bootMat);
    shaft.name = s > 0 ? "bootShaftL" : "bootShaftR";
    shaft.position.set(0, -0.046, -0.004);
    shaft.castShadow = true;
    boot.add(shaft);

    // MEASURED 1.32x the collar's width (99 px of foot against 75 of collar).
    // The first build had it at 0.87x, which makes a boot that is all cuff - a
    // red egg-cup with a dot of foot under it.
    // Narrow in X and long in Z. The comparison sheet caught this: from a
    // near-FRONT view a boot whose whole shape is DEPTH reads as a POT — a
    // flared cup with a ball under it — because none of the projection a player
    // sees from 59 degrees up is available head-on. Taking width out of the
    // foot and putting it into the toe's length costs nothing at the play
    // camera and buys back the head-on read the shop showcase uses.
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.083, 14, 11), bootMat);
    foot.name = s > 0 ? "bootFootL" : "bootFootR";
    foot.scale.set(0.86, 0.58, 1.12);
    foot.position.set(0, -0.070, 0.004);
    foot.castShadow = true;
    boot.add(foot);

    // The toe has to PROJECT past the ankle mass or the two spheres read as
    // one ball: no front, no back, and a walk cycle that looks like sliding.
    // The toe has to PROJECT past the ankle mass or the two spheres read as one
    // ball: no front, no back, and a walk cycle that looks like sliding. The
    // first build had it at z 0.052 inside a 0.083 foot and the pair read as an
    // urn — a flared cup with a bulb under it, which is what a boot becomes the
    // moment nothing about it points forward.
    const toe = new THREE.Mesh(new THREE.SphereGeometry(0.076, 14, 11), bootMat);
    toe.name = s > 0 ? "bootToeL" : "bootToeR";
    toe.scale.set(0.80, 0.55, 1.62);
    toe.position.set(0, -0.080, 0.082);
    toe.castShadow = true;
    boot.add(toe);

    // The toe seam. The reference draws an ink arc separating a rounded toe
    // cap from the shaft; a boot without it is a red bean.
    const seam = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.0055, 5, 16, Math.PI * 1.15), bootDkMat);
    seam.name = s > 0 ? "bootSeamL" : "bootSeamR";
    seam.rotation.set(-0.5, 0, Math.PI * 0.92);
    seam.scale.set(1.25, 1, 0.7);
    seam.position.set(0, -0.062, 0.038);
    boot.add(seam);

    // The reference also draws a pale SOLE strip (MEASURED 0.368 x 0.023 BH).
    // It is not built, and that is IDEA-058's cut applied up front rather than
    // rediscovered: the game camera sits at 59 degrees ELEVATION and looks
    // DOWN, so a strip at the very bottom of a boot is occluded by the boot's
    // own bulge, and all it did on the pizza was put a bright rim between the
    // foot and its own ground shadow — a halo that made the foot read as
    // hovering rather than as planted.

    legs.push(pivot);
  }

  const userData: GhostUserData = {
    bodyMat,
    eyes,
    pupPivots,
    pupM,
    pupBaseColor: pupM.color.getHex(),
    baseColor: color,
    // No hem and no skirt: this one WALKS, so it opts out of the shared ghost
    // breathe entirely and supplies its own stride, wave and idle sway.
    hem: [],
    pupOffset: { x: 0, z: 0 },
    // EMPTY ON PURPOSE, and it is the most load-bearing empty list in this
    // file. bodyMat is already the bread — two disjoint masses at the top and
    // the bottom of the body — so the frightened blue lands in both of the
    // places that matter. The obvious addition is the patty, which is the
    // largest fixed mass on the model; adding it would turn bread AND meat
    // blue together and collapse the six-band stack into one blue lump
    // exactly while the player is chasing it. The banding is the identity and
    // it has to survive the recolour, so the entire garnish stays warm:
    // IDEA-053 rule 2, applied here to the biggest accent rather than to six
    // hairlines. The nigiri's accentMats is empty for the same shape of
    // reason (its block and cap collapse together), which is the precedent.
    accentMats: [],
    behaviour: burgerBehaviour({ legs, swingArm, waveArm, stack }),
    eyeMats: burgerEyeMats,
    spiritMats: collectSpiritMats(g, burgerEyeMats),
  };
  g.userData = userData;
  return g;
}

/**
 * Builds an enemy mesh for `skinId`, dispatching between the classic ghost
 * and the garden beetle/bee/ladybug/flea/crab/mosquito (IDEA-009, IDEA-053,
 * IDEA-054, IDEA-055) — all seven satisfy the identical `GhostUserData` contract, so callers (game.ts) can treat the
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
  if (skinId === "mosquito") return makeMosquito(color);
  if (skinId === "maki") return makeSushiMaki(color);
  if (skinId === "nigiri") return makeNigiri(color);
  if (skinId === "pizza") return makePizza(color);
  if (skinId === "burger") return makeBurger(color);
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
