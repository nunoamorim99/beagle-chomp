// OWNER: render-artist
// Beagle + ghost meshes built from primitives (grouped). Later can be swapped
// for glTF models (see PROJECT_PLAN M6). Reference: prototype makeBeagle/makeGhost.
// Contract: makeBeagle(): THREE.Group ; makeGhost(colorHex): THREE.Group with
// userData { bodyMat, eyes, pups, pupM, baseColor } for state-driven recolouring.
import * as THREE from "three";
import { type Entity, entityWorld } from "../game/movement";
import { type Vec2 } from "../game/grid";
import { type GhostState } from "../game/ghostAI";
import { COLORS } from "../game/config";

/**
 * Animatable sub-parts of the beagle model, stashed on the group's userData
 * so `syncToEntity` can pose them per frame without any geometry rebuilds.
 * Each is a pivot `Group` (not the visible mesh directly) positioned at the
 * joint, with the actual mesh(es) offset inside it — rotating the pivot
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
 * Builds the beagle from primitives (ported from prototype section 6,
 * makeBeagle). Nose points toward +Z at rotation.y = 0, matching
 * ARCHITECTURE's "yaw = atan2(dir.x, dir.y)" facing convention.
 *
 * Ears, tail, jaw and legs are built as pivot groups (joint at the origin,
 * mesh offset inside) rather than bare meshes, and exposed via
 * `g.userData.parts` (typed `BeagleParts`) so `syncToEntity` can animate a
 * trot/wag/flop/chomp on top of the existing position+yaw+bob without
 * touching the model's static geometry.
 */
// Ear colour: a warm chocolate/liver brown, distinctly darker than the tan
// body but clearly lighter than both COLORS.beagleBlack (near-black, used for
// nose/eyes) and the near-black scene background (COLORS.bg 0x0b0b16). Pure
// black ears silhouette invisibly against the dark maze; this reads as a
// classic beagle ear (a real tri-colour beagle's ear patch is brown, not
// black) while staying readable from every angle. Local to this module
// rather than COLORS since it's a model-shading detail, not a shared palette
// entry other systems key off.
const EAR_BROWN = 0x6b3f22;

export function makeBeagle(): THREE.Group {
  const g = new THREE.Group();
  const tan = new THREE.MeshStandardMaterial({ color: COLORS.beagleTan, roughness: 0.6 });
  const white = new THREE.MeshStandardMaterial({ color: COLORS.beagleWhite, roughness: 0.6 });
  const black = new THREE.MeshStandardMaterial({ color: COLORS.beagleBlack, roughness: 0.5 });
  const earMat = new THREE.MeshStandardMaterial({ color: EAR_BROWN, roughness: 0.65 });

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.34, 20, 16), tan);
  body.scale.set(1, 0.85, 1.25);
  body.position.y = 0.34;
  g.add(body);
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), white);
  belly.scale.set(0.9, 0.6, 1.1);
  belly.position.set(0, 0.24, 0.05);
  g.add(belly);

  // Tricolor "saddle": the black back-blanket marking that distinguishes a
  // tricolor beagle from a plain tan/white bi-color one. A single ellipsoid
  // draped over the TOP of the body sphere, centred over the back — it
  // deliberately intersects the body sphere's lower half (submerged there,
  // so invisible; both are opaque) and only its upper cap needs to be the
  // outermost surface. Its own radius (0.36) is bigger than the body's
  // (0.34) and its centre sits well above the body's (y 0.5 vs 0.34), so the
  // two surfaces cross at a steep angle all the way round the seam — a
  // shallow/grazing crossing (the first pass here used a same-size sphere
  // barely poking through) makes a jagged, sawtoothed edge; a steep one
  // reads as a clean rounded silhouette. Narrower than the body in X (tan
  // flanks stay visible below it), and its Z span (front edge ~0.25, rear
  // edge ~-0.25 around a centre of z=0) keeps it clear of both the head
  // sphere (centred z=0.34, radius 0.26 — the saddle's front edge sits
  // behind its equator) and the tail pivot (0,0.5,-0.34 — a healthy ~0.09
  // margin), so the upright/wagging tail never clips it.
  const saddle = new THREE.Mesh(new THREE.SphereGeometry(0.36, 24, 18), black);
  saddle.scale.set(0.8, 0.62, 0.68);
  saddle.position.set(0, 0.5, 0);
  g.add(saddle);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 20, 16), tan);
  head.position.set(0, 0.46, 0.34);
  g.add(head);
  const snout = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 12), white);
  snout.scale.set(1, 0.8, 1.2);
  snout.position.set(0, 0.4, 0.56);
  g.add(snout);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 10), black);
  nose.position.set(0, 0.44, 0.68);
  g.add(nose);

  // Jaw: a small lower-lip pivot hinged at the back of the snout so it can
  // swing open/closed for a subtle chomp. Sits just under the snout/nose.
  const jaw = new THREE.Group();
  jaw.position.set(0, 0.36, 0.5);
  const jawMesh = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), white);
  jawMesh.scale.set(0.85, 0.55, 0.9);
  jawMesh.position.set(0, -0.03, 0.14);
  jaw.add(jawMesh);
  g.add(jaw);

  const legs: THREE.Group[] = [];
  ([-1, 1] as const).forEach((s) => {
    // Ears: pivot moved to the SIDE of the head (x pushed out to +-0.24, a
    // touch lower at y 0.52) rather than the top, so the ear hinges where a
    // real beagle ear does — beside the face — and its long axis drapes DOWN
    // AND FORWARD alongside the cheek instead of tucking behind the skull.
    // The old ear was one small sphere squashed thin (0.12 radius * 0.5x/
    // 0.35z) sitting almost flush with the head, which reads as shadow, not
    // an ear. This one is built from two overlapping stretched spheres — a
    // wider "root" lobe near the hinge blending into a longer, narrower
    // "paddle" that reaches down toward the jaw — giving a floppy, tapered
    // silhouette (long ear, not a stubby blob) that's big enough to read at
    // normal game-camera distance and extends well clear of the head outline
    // in every view (front/side/three-quarter), including from behind where
    // the head sphere used to fully occlude it.
    const earPivot = new THREE.Group();
    earPivot.position.set(0.24 * s, 0.52, 0.3);

    const earRoot = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), earMat);
    earRoot.scale.set(0.62, 0.85, 0.5);
    earRoot.position.set(0.02 * s, -0.06, 0.02);
    earPivot.add(earRoot);

    const earPaddle = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), earMat);
    earPaddle.scale.set(0.46, 1.55, 0.4);
    // Angled slightly outward+forward off the vertical so the paddle clears
    // the cheek/jaw rather than pressing flat against the head, and swept a
    // touch further out on X so the silhouette separates from the head even
    // head-on (front view) instead of overlapping it edge-to-edge.
    earPaddle.rotation.z = 0.16 * s;
    earPaddle.position.set(0.1 * s, -0.32, 0.06);
    earPivot.add(earPaddle);

    g.add(earPivot);
    if (s < 0) g.userData.__earL = earPivot; else g.userData.__earR = earPivot;

    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), black);
    eye.position.set(0.1 * s, 0.52, 0.54);
    g.add(eye);
    // legs: pivot at the hip/shoulder (top of leg) so rotation.x swings the
    // cylinder like a real trot instead of just spinning around its middle.
    ([-0.16, 0.16] as const).forEach((dz) => {
      const legPivot = new THREE.Group();
      legPivot.position.set(0.18 * s, 0.2, dz);
      const legMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.2, 8), tan);
      legMesh.position.set(0, -0.1, 0);
      legPivot.add(legMesh);
      g.add(legPivot);
      legs.push(legPivot);
    });
  });

  // Tail: pivot raised to the TOP of the rump (y 0.42 -> 0.5) and tilted
  // rotation.x POSITIVE (was -0.7, which angled the mesh forward-and-down —
  // straight into/behind the body sphere, fully hidden from behind and the
  // side). +0.85 rad angles it up and back instead, like a beagle's
  // characteristically upright "flagged" tail, so it rises clear above the
  // body silhouette. Lengthened and thickened (0.24 long / 0.04-0.07 radius
  // -> 0.32 long / 0.055-0.085 radius) so it reads as a tail rather than a
  // twig, and the white tip enlarged slightly to stay a visible "flag" at
  // the new scale.
  const tail = new THREE.Group();
  tail.position.set(0, 0.5, -0.34);
  tail.rotation.x = 0.85;
  const tailMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.085, 0.32, 8), tan);
  tailMesh.position.set(0, 0.16, 0);
  tail.add(tailMesh);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.065, 8, 8), white);
  tip.position.set(0, 0.32, 0);
  tail.add(tip);
  g.add(tail);

  g.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  g.scale.setScalar(0.9);

  const parts: BeagleParts = {
    earL: g.userData.__earL as THREE.Group,
    earR: g.userData.__earR as THREE.Group,
    tail,
    jaw,
    legs,
  };
  delete g.userData.__earL;
  delete g.userData.__earR;
  g.userData.parts = parts;
  return g;
}

export interface GhostUserData {
  bodyMat: THREE.MeshStandardMaterial;
  eyes: THREE.Mesh[];
  pups: THREE.Mesh[];
  pupM: THREE.MeshStandardMaterial;
  baseColor: number;
  /** The 5 wavy-hem spheres, in build order — wobbled (y bob + scale) by syncToEntity. */
  hem: THREE.Mesh[];
  /** Skirt body, exposed so the hem wobble can gently breathe the whole skirt too. */
  skirt: THREE.Mesh;
  /** Smoothed pupil offset (world-ish local units), lerped toward the dir-driven
   *  target each call instead of snapping; owned entirely by applyGhostState. */
  pupOffset: { x: number; z: number };
}

/**
 * Builds a ghost from primitives (ported from prototype section 6,
 * makeGhost). Exposes userData handles so game state (frightened/eaten)
 * can recolour the body and pupils without rebuilding the mesh.
 */
export function makeGhost(color: number): THREE.Group {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.4,
    emissive: color,
    emissiveIntensity: 0.15,
  });
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 20, 16, 0, Math.PI * 2, 0, Math.PI / 2),
    bodyMat,
  );
  dome.position.y = 0.36;
  g.add(dome);
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.36, 20), bodyMat);
  skirt.position.y = 0.18;
  g.add(skirt);
  // wavy hem
  const hem: THREE.Mesh[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 10), bodyMat);
    b.position.set(Math.cos(a) * 0.24, 0.02, Math.sin(a) * 0.24);
    g.add(b);
    hem.push(b);
  }
  const eyeW = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
  const pupM = new THREE.MeshStandardMaterial({ color: 0x1436b0, roughness: 0.3 });
  const eyes: THREE.Mesh[] = [];
  const pups: THREE.Mesh[] = [];
  ([-1, 1] as const).forEach((s) => {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 12), eyeW);
    e.scale.set(0.8, 1, 0.6);
    e.position.set(0.12 * s, 0.4, 0.2);
    g.add(e);
    eyes.push(e);
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 10), pupM);
    p.position.set(0.12 * s, 0.4, 0.27);
    g.add(p);
    pups.push(p);
  });
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  const userData: GhostUserData = {
    bodyMat, eyes, pups, pupM, baseColor: color, hem, skirt, pupOffset: { x: 0, z: 0 },
  };
  g.userData = userData;
  return g;
}

// Angular speed (rad/s) for turning the model toward its facing direction.
// High enough that, combined with the tile-stepping model (facing only
// changes at tile centres), a turn resolves well within one tile crossing —
// the prototype snaps instantly, this keeps that feel but avoids a visible
// pop when two syncs land on either side of a corner.
const TURN_RATE = 18;
// Walk bob/waddle tuning (ported from prototype syncMeshes).
const BOB_FREQ = 12;
const BOB_HEIGHT = 0.06;
const WADDLE_AMPLITUDE = 0.06;

// Beagle part-animation tuning. All keyed off the same BOB_FREQ-derived walk
// clock (`state.t`) so everything stays in lock-step with the existing bob —
// a trot/wag/flop that drifted out of phase with the bob would look wrong.
// Amplitudes bumped from the original pass (0.55/0.3/0.5 tail/ear/leg) — at
// normal camera distance the smaller values read as barely-there; these are
// the values that actually land on screen.
const TAIL_WAG_FREQ = BOB_FREQ * 0.5; // slower than the leg trot, reads as a wag not a blur
const TAIL_WAG_AMPLITUDE = 0.7; // radians of yaw at the pivot
const EAR_FLOP_AMPLITUDE = 0.5;
const EAR_FLOP_LAG = 0.35; // radians ear R lags ear L by (phase offset, not time) for a floppy asymmetry
const LEG_TROT_AMPLITUDE = 0.6;
const JAW_CHOMP_AMPLITUDE = 0.22;
const JAW_CHOMP_FREQ = BOB_FREQ; // one chomp per bob cycle

// Idle (stopped) tuning: the beagle is on-camera and holding still for long
// stretches (Start panel, "Ready!" banner, any paused moment), so it needs
// its own gentle life instead of going dead-flat. All keyed off `state.idleT`
// (free-running, unlike `state.t` which only advances while moving) so idle
// motion never freezes. Deliberately slower/subtler than the moving
// animation above — this is a standing dog breathing and glancing around,
// not a trot.
const TAIL_IDLE_WAG_FREQ = 1.8;
const TAIL_IDLE_WAG_AMPLITUDE = 0.4; // was 0.12 (read as +-0.08 on screen, imperceptible)
const EAR_IDLE_SWAY_FREQ = 0.9;
const EAR_IDLE_SWAY_AMPLITUDE = 0.08; // gentle sway, not a flop
const EAR_IDLE_SWAY_LAG = 1.1; // phase offset (radians) so L/R don't sway in lockstep
// Occasional bigger ear twitch layered on top of the base sway — a beat
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
// reused forever — obj.position.y is overwritten with bob applied on top of
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
  // group's top-level scale is otherwise free — ghosts already breathe via
  // animateGhostHem's skirt scale. Guarded to never run during the death
  // spin-shrink: setBeagleDeath/resetBeagleScale own `obj.scale` there, but
  // syncToEntity is never called on the beagle mesh while mode === "dying"
  // (see src/game/game.ts's "dying" case, which calls setBeagleDeath instead)
  // so there is no per-frame conflict — this code path simply doesn't run
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
}

/**
 * Poses the beagle's pivot sub-parts for one frame. Everything is driven off
 * `state.t` (the shared bob clock) while moving so the trot/wag/chomp stay in
 * lock-step with the bob, and off `state.idleT` for the idle sway/wag so the
 * beagle keeps a little life once stopped (Start panel, "Ready!" banner,
 * paused mid-decision). No allocations — every part is rotated in place via
 * plain scalar assignment.
 *
 * Idle and moving poses are computed independently and then cross-faded via
 * `state.moveBlend` (an exponentially-smoothed 0..1 chase toward `moving`,
 * advanced in syncToEntity) rather than hard if/else-switched, so a stop or
 * start eases between "standing around" and "mid-trot" instead of popping —
 * task item C. Legs/jaw have no idle motion (a standing dog doesn't trot or
 * chomp), so they naturally blend down to 0 as `moveBlend` falls.
 */
function animateBeagleParts(parts: BeagleParts, state: WalkState): void {
  const blend = state.moveBlend;

  // --- moving pose ---
  const movingTailWag = Math.sin(state.t * TAIL_WAG_FREQ * Math.PI * 2) * TAIL_WAG_AMPLITUDE;
  const movingEarL = Math.sin(state.t * BOB_FREQ) * EAR_FLOP_AMPLITUDE;
  const movingEarR = Math.sin(state.t * BOB_FREQ - EAR_FLOP_LAG) * EAR_FLOP_AMPLITUDE;
  // Alternating trot: front-left/back-right swing opposite front-right/back-left.
  const trot = Math.sin(state.t * BOB_FREQ) * LEG_TROT_AMPLITUDE;
  const movingJaw = Math.max(0, Math.sin(state.t * JAW_CHOMP_FREQ)) * JAW_CHOMP_AMPLITUDE;

  // --- idle pose (all off the free-running idleT so it never freezes) ---
  // Tail: a happy, clearly-visible idle wag (was a barely-there 0.12 rad).
  const idleTailWag = Math.sin(state.idleT * TAIL_IDLE_WAG_FREQ) * TAIL_IDLE_WAG_AMPLITUDE;
  // Ears: slow out-of-phase sway plus a small periodic "perk up" twitch, so a
  // standing beagle looks alert rather than pinned flat. Only ~0.1-0.15 rad
  // total — a gentle sway/twitch, not a flop.
  const earSwayL = Math.sin(state.idleT * EAR_IDLE_SWAY_FREQ) * EAR_IDLE_SWAY_AMPLITUDE
    + Math.sin(state.idleT * EAR_TWITCH_FREQ * Math.PI * 2) * EAR_TWITCH_AMPLITUDE;
  const earSwayR = Math.sin(state.idleT * EAR_IDLE_SWAY_FREQ + EAR_IDLE_SWAY_LAG) * EAR_IDLE_SWAY_AMPLITUDE
    + Math.sin(state.idleT * EAR_TWITCH_FREQ * Math.PI * 2 + EAR_IDLE_SWAY_LAG) * EAR_TWITCH_AMPLITUDE;
  // Legs/jaw at rest: a standing dog doesn't trot or chomp, so idle target is 0
  // and they simply blend down to nothing as `blend` falls (see below).

  parts.tail.rotation.y = idleTailWag + (movingTailWag - idleTailWag) * blend;
  parts.earL.rotation.x = earSwayL + (movingEarL - earSwayL) * blend;
  parts.earR.rotation.x = earSwayR + (movingEarR - earSwayR) * blend;

  parts.legs[0].rotation.x = trot * blend;
  parts.legs[1].rotation.x = -trot * blend;
  parts.legs[2].rotation.x = -trot * blend;
  parts.legs[3].rotation.x = trot * blend;

  parts.jaw.rotation.x = movingJaw * blend;
}

/**
 * Wobbles a ghost's 5 hem spheres (phase-offset vertical bob + squash/stretch)
 * and gently breathes the skirt cylinder, purely for idle liveliness — runs
 * off the free-running `idleT` clock so it never stops even when the ghost
 * itself is paused (e.g. still in its pen).
 */
function animateGhostHem(hem: THREE.Mesh[], skirt: THREE.Mesh, idleT: number): void {
  for (let i = 0; i < hem.length; i++) {
    const phase = (i / hem.length) * Math.PI * 2;
    const wave = Math.sin(idleT * HEM_WOBBLE_FREQ * Math.PI * 2 + phase);
    hem[i].position.y = 0.02 + wave * HEM_WOBBLE_HEIGHT;
    const s = 1 + wave * HEM_WOBBLE_SCALE;
    hem[i].scale.set(s, s, s);
  }
  const breathe = 1 + Math.sin(idleT * HEM_WOBBLE_FREQ * Math.PI * 2) * SKIRT_BREATHE_SCALE;
  skirt.scale.set(breathe, 1, breathe);
}

// Pupil dart smoothing rate (1/s decay constant, same shape as TURN_RATE's
// exp smoothing) — fast enough to read as "snappy glance" rather than lazy
// drift, but no longer an instant snap to the target offset.
const PUPIL_SMOOTH_RATE = 14;
// Eaten-eyes glide the same way, slightly gentler so the eyes read as
// "floating home" rather than darting.
const EYES_GLIDE_RATE = 10;

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
 * internally from consecutive `performance.now()` timestamps — the same
 * technique the game loop itself uses (see game.ts's `clock.last`). This
 * keeps the shiver/smoothing frame-rate independent without touching the
 * exported signature.
 */
interface GhostStateClock { lastMs: number; shiverT: number; }
const ghostStateClocks = new WeakMap<THREE.Object3D, GhostStateClock>();

/** Exponential smoothing step: moves `from` toward `to` at `rate` over `dt` seconds. */
function smoothTo(from: number, to: number, rate: number, dt: number): number {
  return from + (to - from) * (1 - Math.exp(-rate * dt));
}

/**
 * Recolours/re-visibilities a ghost mesh for its current gameplay state and
 * offsets its pupils to look toward `dir` (ported from prototype syncMeshes,
 * lines 591-608). Call once per frame per ghost, separate from syncToEntity
 * (which only moves/turns — the beagle has no state to recolour, so state
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
 * (a classic arcade cue) is deliberately NOT implemented here — this
 * function only ever receives the current `state`, not remaining fright
 * time, and changing that contract is out of scope for this pass; it's left
 * for the effects layer, which is better positioned to key off a timer.
 */
export function applyGhostState(mesh: THREE.Object3D, state: GhostState, dir: Vec2): void {
  const ud = mesh.userData as GhostUserData;

  const now = performance.now();
  const clock = ghostStateClocks.get(mesh) ?? { lastMs: now, shiverT: 0 };
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
  ud.pups.forEach((p, i) => {
    p.position.z = 0.27 + ud.pupOffset.z;
    p.position.x = (i ? 0.12 : -0.12) + ud.pupOffset.x;
  });

  if (state === "frightened") {
    ud.bodyMat.color.setHex(COLORS.frightened);
    ud.bodyMat.emissive.setHex(0x101c66);
    ud.pupM.color.setHex(0xffffff);
    mesh.traverse((o) => { o.visible = true; });
    // Nervous shiver, layered on top of the position/yaw syncToEntity just
    // applied this frame. Two slightly-detuned sine terms per axis avoid an
    // obviously-circular or metronomic jitter.
    const t = clock.shiverT;
    mesh.position.x += Math.sin(t * SHIVER_FREQ) * SHIVER_POS_AMPLITUDE;
    mesh.position.z += Math.cos(t * SHIVER_FREQ * 1.3) * SHIVER_POS_AMPLITUDE;
    mesh.rotation.x = Math.sin(t * SHIVER_FREQ * 1.7) * SHIVER_ROT_AMPLITUDE;
  } else if (state === "eaten") {
    mesh.traverse((o) => { o.visible = false; });
    ud.eyes.forEach((e) => { e.visible = true; });
    ud.pups.forEach((p) => { p.visible = true; });
    ud.pupM.color.setHex(0x1436b0);
    mesh.rotation.x = 0;
  } else {
    mesh.traverse((o) => { o.visible = true; });
    ud.bodyMat.color.setHex(ud.baseColor);
    ud.bodyMat.emissive.setHex(ud.baseColor);
    ud.pupM.color.setHex(0x1436b0);
    mesh.rotation.x = 0;
  }
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
