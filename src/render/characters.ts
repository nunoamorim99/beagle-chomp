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
 * The 4 coat materials a beagle skin swaps, stashed on the group's userData
 * (`g.userData.coatMats`) so a later skin change (see `applyBeagleSkin`) can
 * recolour the existing mesh in place — no geometry rebuild, no remove/re-add,
 * the model keeps animating uninterrupted.
 */
export interface BeagleCoatMats {
  tan: THREE.MeshStandardMaterial;
  white: THREE.MeshStandardMaterial;
  black: THREE.MeshStandardMaterial;
  ear: THREE.MeshStandardMaterial;
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
 *
 * The 4 coat colors (tan/white/black/ear) come from `skin` (default: whatever
 * is currently equipped, via cosmetics.ts's getEquippedBeagleSkin — so
 * existing callers that pass nothing still boot wearing the persisted skin).
 * Bagel's coat is byte-for-byte the original fixed palette (COLORS.beagle* +
 * the old local EAR_BROWN const), so defaulting to it is a visual no-op.
 * Ear color is intentionally its own coat channel rather than reusing
 * `black`: a warm chocolate/liver brown reads as a classic beagle ear (real
 * tri-colour beagles have brown, not black, ear patches) and stays visible
 * against both the near-black nose/eyes and the dark scene background, where
 * pure black ears would silhouette invisibly.
 */
export function makeBeagle(skin: BeagleSkin = getEquippedBeagleSkin()): THREE.Group {
  const g = new THREE.Group();
  const { coat } = skin;
  const tan = new THREE.MeshStandardMaterial({ color: coat.tan, roughness: 0.6 });
  const white = new THREE.MeshStandardMaterial({ color: coat.white, roughness: 0.6 });
  const black = new THREE.MeshStandardMaterial({ color: coat.black, roughness: 0.5 });
  const earMat = new THREE.MeshStandardMaterial({ color: coat.ear, roughness: 0.65 });

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

  // Cute eyes (white eyeball + dark iris/pupil), loosely matching the enemy
  // meshes' eyeW/pupM treatment — shared between both sides like the
  // enemies share eyeW/pupM. Fixed colors, not part of the coat skin system
  // (the coat only swaps tan/white/black/ear body materials): every beagle
  // skin gets the same eyes, same as every enemy skin shares the same eye
  // look regardless of team color. An earlier pass scaled these down
  // (0.06 eyeball/0.028 pupil) to fit the beagle's smaller head, but that
  // read as too subtle at the game's small top-down scale; the eyeball was
  // sized back up to match the enemies' own eyeball radius (0.09). The
  // pupil, however, deliberately does NOT reuse the enemies' bright blue
  // `pupM` (that stays the enemies' own look, untouched) — a big bold blue
  // dot read as a permanently startled/wide-eyed stare on the beagle. Its
  // own `pupilM` is a dark, near-black warm brown instead (a calm, natural
  // dog-eye iris color), and sized smaller relative to the (unchanged)
  // eyeball so more white shows around it — see the per-eye comments below
  // for exact sizing/placement.
  const eyeW = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
  const pupilM = new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 0.35 });

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

    // Eyeball: sits on the front-upper hemisphere of the head, above/beside
    // the snout (head is centred y0.46 z0.34 radius 0.26; snout sphere is
    // centred z0.56 radius 0.14). Enlarged from an earlier too-subtle pass
    // (0.06 radius) to 0.09 — matching the enemies' own eyeball size — so
    // they read clearly even at the small top-down in-game scale. Spread
    // further apart (x 0.11 -> 0.15) so the bigger spheres don't touch/
    // overlap each other across the muzzle, and raised a touch (y 0.52 ->
    // 0.55) so they sit more on TOP of the head-front rather than tucked
    // under a brow — legible from the game's overhead-ish camera, not just
    // head-on. z stays 0.56 (level with the snout's own centre, clear of its
    // z-radius 0.14*1.2 front bulge) so the eyeballs sit proud on the face
    // surface without sinking into the head sphere or clipping the snout.
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 14), eyeW);
    eye.scale.set(0.85, 1, 0.65);
    eye.position.set(0.15 * s, 0.55, 0.56);
    g.add(eye);
    // Pupil/iris: shrunk from an earlier too-bold 0.042 to 0.032 — small
    // enough that visible white eyeball rings it on every side, reading as a
    // relaxed, natural eye rather than a big iris filling the socket (the
    // "startled" look). z pulled in slightly (0.625 -> 0.615) so the smaller
    // sphere still sits flush on the eyeball's front curve instead of
    // floating proud of a surface it's no longer as deep into. Centred on
    // the eyeball's forward (+Z) face, symmetric, same as before.
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.032, 10, 10), pupilM);
    pupil.position.set(0.15 * s, 0.55, 0.615);
    g.add(pupil);
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

  const coatMats: BeagleCoatMats = { tan, white, black, ear: earMat };
  g.userData.coatMats = coatMats;

  return g;
}

/**
 * Recolors an already-built beagle group in place to `skin`'s coat — sets
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

// Fixed-dark accent color for the beetle's antennae + tiny head accent — a
// small enough slice of the silhouette that it doesn't fight the "whole bug
// turns blue" frightened read (see makeBeetle's doc comment), but reads as a
// natural dark detail against any of the three team shell colors.
const BEETLE_ACCENT = 0x1c1712;

/**
 * Builds a garden-beetle/ladybug-ish enemy from primitives (IDEA-009 skin
 * alternative to makeGhost). Satisfies the exact same `GhostUserData`
 * contract as the ghost — a single shared `bodyMat` covering the vast
 * majority of the silhouette (shell dome + skirt-equivalent underbelly rim +
 * the "hem" accent spheres), so `applyGhostState`'s frightened recolor
 * ("whole creature turns blue") and eaten hide/reveal both read correctly
 * unmodified.
 *
 * Shape: a rounded, squashed-sphere SHELL as the clear main body (reads as a
 * beetle's back from the top-down game camera) with the 2 eyes sitting
 * directly on its front face — no oversized head nub swallowing them (an
 * earlier pass had a large dark head blob here; it dominated the silhouette
 * and buried the eyes, so it's gone). Only a tiny dark accent nub peeks out
 * low between/below the eyes (mostly hidden by the shell's own curve), plus
 * two short, thin antennae firmly rooted at the shell's front-top edge and
 * swept up-and-back — small, attached, no floating pieces. A faint shell
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
  const bodyMat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.35,
    emissive: color,
    emissiveIntensity: 0.15,
  });
  const accentMat = new THREE.MeshStandardMaterial({ color: BEETLE_ACCENT, roughness: 0.5 });

  // Shell: a squashed dome (wider than tall, slightly elongated front-back)
  // sitting like a beetle's back — the bulk of the silhouette, all on bodyMat.
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.32, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.62), bodyMat);
  shell.scale.set(1, 0.72, 1.12);
  shell.position.y = 0.28;
  g.add(shell);

  // Underbelly rim: a short, wide cylinder under the shell's equator standing
  // in for the ghost's "skirt" — keeps the beetle grounded-looking and gives
  // `hem`/`skirt` real geometry to wobble/breathe.
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.26, 0.14, 20), bodyMat);
  skirt.position.y = 0.14;
  g.add(skirt);

  // Shell seam: a thin dark line down the midline (a classic ladybug/beetle
  // read), and a few small "hem" spheres standing in for wing-case rivets/
  // spots, dotted along the shell's rear edge — same role as the ghost's
  // wavy hem (wobbled by animateGhostHem) but doubling as subtle shell detail.
  const seam = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.58), bodyMat);
  seam.position.set(0, 0.42, 0.02);
  g.add(seam);

  const hem: THREE.Mesh[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 10), bodyMat);
    b.position.set(Math.cos(a) * 0.22, 0.32, Math.sin(a) * 0.26 - 0.02);
    g.add(b);
    hem.push(b);
  }

  // Tiny head accent: a small dark nub low on the shell's front face, mostly
  // tucked under/between where the eyes sit — just enough to break up the
  // shell-to-eyes transition without becoming its own dominant shape (was a
  // 0.14-radius sphere swallowing the eyes; now a much smaller 0.06 one
  // sitting low and set slightly back into the shell).
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), accentMat);
  head.scale.set(1, 0.8, 0.8);
  head.position.set(0, 0.3, 0.26);
  g.add(head);

  // Antennae: short, thin stalks rooted right at the shell's front-top edge
  // (not off a head blob) and swept up-and-back — a light, attached beetle
  // read with no detached/floating tip. Root position sits flush against the
  // shell surface (shell top ~0.28 + 0.72*0.32 ~= 0.51 at its crown, front
  // face reaches z~0.32*1.12=0.36 at the equator) so the stalk visibly grows
  // out of the shell instead of hovering near it.
  ([-1, 1] as const).forEach((s) => {
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.014, 0.1, 6), accentMat);
    // Cylinder geometry is centred on its own origin, so offsetting the pivot
    // half its length along its local +Y (post-rotation) keeps the BASE
    // (not the middle) anchored at the root point.
    stalk.position.set(0.07 * s, 0.42, 0.3);
    stalk.rotation.x = -0.6;
    stalk.rotation.z = 0.18 * s;
    g.add(stalk);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 8), accentMat);
    tip.position.set(0.09 * s, 0.48, 0.36);
    g.add(tip);
  });

  // Eyes + pupils: identical placement to the ghost's so applyGhostState's
  // pupil-offset math (targetX/targetZ around these bases) lands correctly.
  // Sitting cleanly on the shell's front face (no head blob behind them).
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

// Fixed-dark accent color for the bee's stripe bands, antennae, and stinger —
// mirrors BEETLE_ACCENT's role: a small enough slice of the silhouette that
// it doesn't fight the "whole bug turns blue" frightened read.
const BEE_ACCENT = 0x1c1712;
// Pale, slightly translucent wing material — stays this color even when
// frightened (same treatment as the beetle's dark head accent staying dark),
// which is fine: a real bug's wings/head don't turn blue when scared either,
// only the body-color chitin does, and that's what bodyMat models.
const BEE_WING_COLOR = 0xf3f6ff;

/**
 * Builds a garden-bee enemy from primitives (IDEA-009 third enemy skin,
 * alongside the ghost and the beetle). Satisfies the identical
 * `GhostUserData` contract — a single shared `bodyMat` covering the main
 * abdomen+thorax body (plus its skirt-equivalent underbelly rim and the
 * "hem" segment-ring accents), so `applyGhostState`'s frightened recolor
 * ("whole creature turns blue") and eaten hide/reveal both read correctly
 * unmodified. The bee is deliberately NOT literally yellow — its body takes
 * the TEAM color like the beetle's shell does; it reads as a bee via SHAPE
 * (elongated, segmented oval body) and a few bold dark accent stripes across
 * its back, not via a fixed yellow-and-black palette.
 *
 * Shape: a plump oval body (more front-back elongated than the beetle's
 * round shell) on `bodyMat`, 3 bold dark stripe bands PAINTED ON the TOP of
 * the rear-half abdomen — each band built from a row of small flattened
 * dark blobs individually surface-solved onto the body's own dome curve
 * (same technique the ladybug's spots use), not a rigid tube/ring (an
 * earlier pass tried that; a fixed-radius ring can only touch a curved dome
 * at isolated points, so it stood visibly off the surface as a hoop from
 * every angle) — small-minority-coverage fixed-dark accent, so bodyMat
 * still clearly dominates the silhouette — 2 small pale
 * semi-transparent wings on the upper back, 2
 * short thin antennae at the front, and a tiny dark stinger nub at the rear.
 * Eyes/pupils use the exact same geometry/placement/material pattern as the
 * ghost and beetle (2 white eyes + 2 pupils on `pupM`, added directly to the
 * top-level group `g` as siblings — never nested under a sub-group, which is
 * what makes `applyGhostState`'s eaten-state eyes-float-home re-show work),
 * at the ghost's local coords (eyes y0.4 z0.2 x+-0.12; pupils z0.27 x+-0.12)
 * so applyGhostState's hardcoded pupil-offset math lands unchanged.
 */
export function makeBee(color: number): THREE.Group {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.35,
    emissive: color,
    emissiveIntensity: 0.15,
  });
  const accentMat = new THREE.MeshStandardMaterial({ color: BEE_ACCENT, roughness: 0.5 });
  const wingMat = new THREE.MeshStandardMaterial({
    color: BEE_WING_COLOR,
    roughness: 0.25,
    transparent: true,
    opacity: 0.55,
  });

  // Body: a plump oval, elongated front-to-back (a bee's abdomen+thorax read
  // vs. the beetle's flatter, rounder shell) — the bulk of the silhouette,
  // all on bodyMat.
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.26, 20, 16), bodyMat);
  body.scale.set(0.92, 0.88, 1.3);
  body.position.y = 0.3;
  g.add(body);

  // Underbelly rim: standing in for the ghost's "skirt", same role as the
  // beetle's — keeps the bee grounded-looking and gives `hem`/`skirt` real
  // geometry to wobble/breathe.
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.19, 0.12, 20), bodyMat);
  skirt.position.y = 0.14;
  g.add(skirt);

  // Stripe bands: 3 BOLD dark bands PAINTED ON the TOP/upper-back of the
  // rear half of the abdomen — the surface the game's overhead camera
  // actually sees. Two earlier passes both tried a torus-tube ring (full
  // 360deg, then a 200deg arc): a tube built at the body's girth radius
  // necessarily stands OFF the actual body surface (the body is a smoothly
  // curved dome, not a cylinder, so a fixed-radius ring only touches it
  // along a thin great-circle and floats clear of it everywhere else) —
  // straight overhead that read as a closed hoop, and three-quarter it read
  // as a raised croquet-hoop standing proud of the shell. Replaced entirely
  // with the same technique the ladybug's spots use: each stripe is a ROW
  // of small flattened dark spheres, EACH ONE'S OWN Y solved individually
  // against the body's actual ellipsoid surface equation (bodySurfaceY
  // below) at its own (x, z) — so every blob sits flush on the curve at its
  // position (unlike a rigid ring, which can only be flush at isolated
  // points), and the row overlaps enough to read as one continuous painted
  // band rather than a dotted line.
  const hem: THREE.Mesh[] = [];
  // Body is SphereGeometry(0.26) scaled (0.92, 0.88, 1.3) at y0.3, so for
  // local (x, z), the top-surface height is
  // y = 0.3 + 0.26*0.88*sqrt(1 - (x/(0.26*0.92))^2 - (z/(0.26*1.3))^2).
  const BODY_R = 0.26;
  const BODY_SCALE = { x: 0.92, y: 0.88, z: 1.3 };
  const BODY_BASE_Y = 0.3;
  const bodySurfaceY = (x: number, z: number): number => {
    const u = x / BODY_SCALE.x;
    const v = z / BODY_SCALE.z;
    const underRoot = Math.max(0, BODY_R * BODY_R - u * u - v * v);
    return BODY_BASE_Y + BODY_SCALE.y * Math.sqrt(underRoot);
  };
  const BLOB_R = 0.055; // bold enough per-blob to match the old tube's visual weight once overlapped in a row
  const BLOBS_PER_STRIPE = 6;
  [
    // Same 3 z-positions/spacing as the earlier torus passes — spanning
    // from the MID-back (z 0.04, just behind the wings) to the tail
    // (z -0.28), evenly spaced ~0.16 apart, so they read as 2-3 distinct
    // parallel bands rather than a single clump. `xSpan` is how far each
    // row reaches left/right, kept a bit inside the body's true silhouette
    // edge at that z (see bee_stripes surface-solve) so blobs don't clip
    // off the visible top into the body's steep side-curve.
    { z: 0.04, xSpan: 0.17 },
    { z: -0.12, xSpan: 0.16 },
    { z: -0.28, xSpan: 0.09 },
  ].forEach(({ z, xSpan }) => {
    for (let i = 0; i < BLOBS_PER_STRIPE; i++) {
      const x = -xSpan + (2 * xSpan * i) / (BLOBS_PER_STRIPE - 1);
      const blob = new THREE.Mesh(new THREE.SphereGeometry(BLOB_R, 10, 8), accentMat);
      blob.scale.set(1, 0.3, 1); // flattened so it reads as painted ON the surface, not a bump standing up
      blob.position.set(x, bodySurfaceY(x, z), z);
      g.add(blob);
      hem.push(blob);
    }
  });

  // Wings: two small, pale, semi-transparent ellipses on the upper back —
  // a signature bee read. Flat squashed spheres angled slightly outward.
  ([-1, 1] as const).forEach((s) => {
    const wing = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), wingMat);
    wing.scale.set(0.55, 0.1, 0.9);
    wing.position.set(0.12 * s, 0.46, -0.02);
    wing.rotation.z = 0.5 * s;
    wing.rotation.y = -0.35 * s;
    g.add(wing);
  });

  // Antennae: short, thin stalks rooted at the body's front-top edge, swept
  // up-and-back. Built inside their own pivot Group anchored at the root
  // point (base flush against the body) rather than positioning the
  // cylinder's own centre and eyeballing a separate tip position — the
  // previous pass placed the tip sphere independently, and its coordinates
  // didn't actually line up with the rotated stalk's true end, leaving it
  // floating off to the side. Here the stalk mesh is offset by half its own
  // length along local +Y *inside* the pivot, so rotating the pivot sweeps
  // both the stalk AND a tip sphere placed at that same local end point
  // together as one rigid piece — guaranteeing the tip sits exactly at the
  // stalk's end no matter the angle.
  const ANTENNA_LEN = 0.09;
  ([-1, 1] as const).forEach((s) => {
    const pivot = new THREE.Group();
    pivot.position.set(0.05 * s, 0.4, 0.32); // root point, flush against the body's front-top
    pivot.rotation.x = -0.6; // sweep up
    pivot.rotation.z = 0.18 * s; // sweep outward
    g.add(pivot);

    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.011, ANTENNA_LEN, 6), accentMat);
    stalk.position.y = ANTENNA_LEN / 2; // base at the pivot origin, growing along local +Y
    pivot.add(stalk);

    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.011, 8, 8), accentMat);
    tip.position.y = ANTENNA_LEN; // exactly at the stalk's far end, same local space
    pivot.add(tip);
  });

  // Tiny stinger nub at the rear — small dark accent, subtle.
  const stinger = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.09, 8), accentMat);
  stinger.rotation.x = Math.PI / 2 + 0.15;
  stinger.position.set(0, 0.28, -0.36);
  g.add(stinger);

  // Eyes + pupils: identical placement to the ghost/beetle so
  // applyGhostState's pupil-offset math lands correctly, added directly to
  // `g` (siblings of body/wings/etc.) so the eaten-state re-show works.
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

// Fixed-dark accent color for the ladybug's spots/head/seam/antennae — same
// role as BEETLE_ACCENT/BEE_ACCENT.
const LADYBUG_ACCENT = 0x1c1712;

/**
 * Builds a garden-ladybug enemy from primitives (IDEA-009 fourth enemy skin,
 * alongside the ghost, beetle, and bee). Satisfies the identical
 * `GhostUserData` contract — a single shared `bodyMat` covering the shell
 * (plus its skirt-equivalent underbelly rim), so `applyGhostState`'s
 * frightened recolor ("whole creature turns blue") and eaten hide/reveal
 * both read correctly unmodified. Like the beetle and bee, the shell takes
 * the TEAM color (rose/teal/amber) rather than a fixed red — the signature
 * ladybug read comes from SHAPE + the black spot pattern on top, not from a
 * fixed red-and-black palette, so each ghost keeps its team identity.
 *
 * Shape: a rounded, more-hemispherical dome shell than the beetle's flatter
 * one (a classic ladybug's back is rounder/taller) on `bodyMat`, 7 black
 * spot dots (1 centred + 3 symmetric pairs) scattered across the shell top
 * and weighted toward the REAR half — the star of the design, clearly
 * visible from the overhead game camera, each one flush on the dome's own
 * curved surface — while still a clear minority of the shell area so
 * bodyMat dominates the silhouette. A thin dark centre-seam line down the
 * back (the wing-case split), a small fixed-dark head at the front, and 2
 * short thin antennae. Eyes/pupils use the exact
 * same geometry/placement/material pattern as the other three enemies (2
 * white eyes + 2 blue pupils on `pupM`, added directly to the top-level
 * group `g` as siblings — never nested under a sub-group, which is what
 * makes `applyGhostState`'s eaten-state eyes-float-home re-show work), at
 * the standard local coords (eyes y0.4 z0.2 x+-0.12; pupils z0.27 x+-0.12)
 * so applyGhostState's hardcoded pupil-offset math lands unchanged.
 */
export function makeLadybug(color: number): THREE.Group {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.3,
    emissive: color,
    emissiveIntensity: 0.15,
  });
  const accentMat = new THREE.MeshStandardMaterial({ color: LADYBUG_ACCENT, roughness: 0.5 });

  // Shell: rounder/taller than the beetle's flatter dome — a true
  // hemispherical cap, only lightly squashed — the bulk of the silhouette,
  // all on bodyMat.
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.3, 22, 16, 0, Math.PI * 2, 0, Math.PI * 0.58), bodyMat);
  shell.scale.set(1.02, 0.9, 1.08);
  shell.position.y = 0.26;
  g.add(shell);

  // Underbelly rim: standing in for the ghost's "skirt", same role as the
  // beetle's/bee's — keeps the ladybug grounded-looking and gives
  // `hem`/`skirt` real geometry to wobble/breathe.
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.24, 0.13, 20), bodyMat);
  skirt.position.y = 0.13;
  g.add(skirt);

  // Centre seam: thin dark line down the midline (the wing-case split) — a
  // classic ladybug detail, on top of the shell's crown.
  const seam = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.018, 0.5), accentMat);
  seam.position.set(0, 0.46, 0.02);
  g.add(seam);

  // Spots: 7 black dots (1 centred + 3 symmetric pairs) scattered across the
  // shell top, HEAVILY weighted toward the REAR half — the largest area the
  // overhead game camera actually sees — leaving the front (near the
  // eyes/head, z > ~0.1) relatively clear. An earlier pass clustered all 6
  // spots up near the front (z 0.14 down to -0.24) around the eyes/head,
  // leaving the whole rear dome bare — from directly above it read as "a
  // plain dome with a couple specks near the face". Now spanning z from the
  // TAIL (-0.26) up to just past mid-back (0.06), well clear of the eyes at
  // z0.2/head at z0.27, so the back reads as a proper spotted ladybug dome.
  // Each spot's y is computed from the shell's own ellipsoid-dome surface
  // equation — shell is SphereGeometry(0.3) scaled (1.02, 0.9, 1.08) at
  // y0.26, so for local (x,z), y = 0.26 + 0.9*sqrt(0.3^2 - (x/1.02)^2 -
  // (z/1.08)^2) — so each flattened spot sits flush ON the dome's curve
  // (following the surface height at its own position) rather than a fixed
  // y that floats above or sinks into the shell away from the crown.
  // Enlarged from the earlier too-small 0.052 to 0.065 so each spot reads
  // clearly from a top-down camera, while 7 spots of this size still stay a
  // clear minority of the total shell area — bodyMat (team color) keeps
  // dominating and frightened still reads as "mostly blue with spots".
  const hem: THREE.Mesh[] = [];
  const SPOT_R = 0.065;
  const SHELL_R = 0.3;
  const SHELL_SCALE = { x: 1.02, y: 0.9, z: 1.08 };
  const SHELL_BASE_Y = 0.26;
  const spotSurfaceY = (x: number, z: number): number => {
    const u = x / SHELL_SCALE.x;
    const v = z / SHELL_SCALE.z;
    const underRoot = Math.max(0, SHELL_R * SHELL_R - u * u - v * v);
    return SHELL_BASE_Y + SHELL_SCALE.y * Math.sqrt(underRoot);
  };
  ([
    { x: 0, z: -0.26 }, // single spot on the centre seam, near the tail
    { x: 0.12, z: -0.22 },
    { x: -0.12, z: -0.22 },
    { x: 0.17, z: -0.06 },
    { x: -0.17, z: -0.06 },
    { x: 0.1, z: 0.06 },
    { x: -0.1, z: 0.06 },
  ] as const).forEach(({ x, z }) => {
    const spot = new THREE.Mesh(new THREE.SphereGeometry(SPOT_R, 12, 8), accentMat);
    spot.scale.set(1, 0.4, 1);
    spot.position.set(x, spotSurfaceY(x, z), z);
    g.add(spot);
    hem.push(spot);
  });

  // Small fixed-dark head at the front — ladybugs have a distinct black
  // head, kept small (same treatment as the beetle's) so it doesn't
  // dominate or swallow the eyes.
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.065, 12, 10), accentMat);
  head.scale.set(1, 0.8, 0.8);
  head.position.set(0, 0.3, 0.27);
  g.add(head);

  // Antennae: short, thin stalks in their own root-anchored pivot (mirrors
  // the bee's fix — base flush against the head, tip guaranteed to sit at
  // the stalk's true end since both are children of the same rotated
  // pivot, never independently positioned).
  const ANTENNA_LEN = 0.09;
  ([-1, 1] as const).forEach((s) => {
    const pivot = new THREE.Group();
    pivot.position.set(0.06 * s, 0.36, 0.32);
    pivot.rotation.x = -0.6;
    pivot.rotation.z = 0.18 * s;
    g.add(pivot);

    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.012, ANTENNA_LEN, 6), accentMat);
    stalk.position.y = ANTENNA_LEN / 2;
    pivot.add(stalk);

    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 8), accentMat);
    tip.position.y = ANTENNA_LEN;
    pivot.add(tip);
  });

  // Eyes + pupils: identical placement to the other enemies so
  // applyGhostState's pupil-offset math lands correctly, added directly to
  // `g` (siblings of shell/spots/etc.) so the eaten-state re-show works.
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

/**
 * Builds an enemy mesh for `skinId`, dispatching between the classic ghost
 * and the garden beetle/bee/ladybug (IDEA-009) — all four satisfy the
 * identical `GhostUserData` contract, so callers (game.ts) can treat the
 * result uniformly regardless of which skin is equipped. Falls back to the
 * ghost for any unrecognised id, mirroring cosmetics.ts's getEnemySkin
 * fallback behaviour (degrade to the default rather than throw).
 */
export function makeEnemy(skinId: string, color: number): THREE.Group {
  if (skinId === "beetle") return makeBeetle(color);
  if (skinId === "bee") return makeBee(color);
  if (skinId === "ladybug") return makeLadybug(color);
  return makeGhost(color);
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
    // Hide every CHILD (body/shell/hem/etc.), but deliberately leave the top-
    // level `mesh` group itself visible: Object3D.traverse invokes its
    // callback on `this` first, so `mesh.traverse(o => o.visible=false)`
    // used to also flip the group's own `.visible` to false — and three.js's
    // renderer (projectObject) returns immediately on an invisible object
    // without even looking at its children, so re-showing eyes/pups below
    // had no effect: the whole mesh (eyes included) vanished. Iterating
    // `mesh.children` instead of `mesh.traverse` skips `mesh` itself, so the
    // group stays visible and only its descendants go dark, letting the
    // eyes/pups re-show correctly afterward.
    mesh.children.forEach((o) => { o.visible = false; });
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
