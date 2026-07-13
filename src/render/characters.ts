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
 * Builds the beagle from primitives — "sculpted flush forms" redesign
 * (IDEA-024 second attempt, technique P2). Nose points toward +Z at
 * rotation.y = 0, matching ARCHITECTURE's "yaw = atan2(dir.x, dir.y)"
 * facing convention.
 *
 * THE TECHNIQUE — every coat marking is a "decal shell": a partial sphere
 * (SphereGeometry with restricted phi/theta ranges) sharing its base form's
 * exact centre and mesh scale, at a radius only a hair (~1-4% of the base
 * radius, 0.003-0.010 world units of rise) larger, so it hugs the base
 * surface like a silkscreened paint pass. No marking bulges: the shell IS
 * the base surface, offset along the normal by less than a whisker, and its
 * open rim sits that same hair above the base so the edge reads as a crisp
 * painted seam terminating inside the form's curvature. Cap orientations
 * are baked into the GEOMETRY (rotating a sphere's cap about its own centre
 * keeps it on the same sphere) so each shell mesh can carry its base
 * ellipsoid's non-uniform scale untouched and stay glued to the curved
 * surface everywhere — rotating the mesh instead would rotate the whole
 * ellipsoid and peel the shell off the base. Overlapping shells get
 * slightly different radius factors (layer order = radius order), so they
 * stack like print passes with zero z-fighting.
 *
 * Markings (all flush, all soft organic ovals born from the cap/ellipsoid
 * interaction):
 *  - BLACK saddle: ONE smooth cap over the body ellipsoid, pole tilted
 *    up-and-back, flowing from the neck (its front edge hides inside the
 *    head) over the back and rump to the tail root, draping about half-way
 *    down the flanks. A single continuous region — no discrete blobs.
 *  - WHITE bib+belly: one cap, pole tilted forward-and-down, wrapping the
 *    chest front and underside in a single white sweep. A soft white chest
 *    FORM (part of the silhouette, its edges buried deep inside the body)
 *    adds fullness under the chin and unions invisibly with the cap since
 *    both share the same white material and the poke-through region lies
 *    entirely inside the cap's zone.
 *  - EAR-BROWN head sides: one cap per side of the skull, centred where the
 *    ears root, sweeping around the eyes and cheeks — the classic beagle
 *    brown head split by the white blaze (eyes and blaze render on top via
 *    larger radius factors). Left/right factors differ by 0.004 so their
 *    small overlap at the back of the crown can't z-fight.
 *  - WHITE blaze: a narrow phi-restricted LUNE (a meridian strip of the
 *    head sphere itself, not a tilted lump) running from the crown down the
 *    forehead and melting into the white muzzle at its lower end. Flush by
 *    construction — checklist item "blaze painted into the head" is the
 *    literal geometry here.
 *  - WHITE socks: paw blobs inside each leg pivot (forms at the end of the
 *    legs, not surface bumps) so they trot with the leg; WHITE tail tip.
 *
 * Eyes are painted-lens style: three concentric decal caps per eye sitting
 * directly on the head sphere — white sclera disc (rise ~0.005), the calm
 * dark-brown 0x2a1a10 pupil (~0.008), and a tiny white glint cap offset
 * up-and-outward (~0.010) — so the eyes read as glossy lenses embedded in
 * the skull, never bulging spheres. They stay OUTSIDE the skin system
 * (fixed materials) exactly like before. The pupil caps are aimed a touch
 * medially relative to the sclera centres so the gaze converges gently
 * forward — calm, no walleye.
 *
 * Silhouette: 3 blended body forms (main ellipsoid + white chest + tan
 * haunches, the latter two poking through only low on the front/flanks and
 * rear so they never break the saddle's smooth edge) under a chibi head
 * (r 0.27, DOWN from the rejected pass's 0.30) placed high and forward: the
 * body runs a full ~0.5 units behind the head's rear edge and is WIDER than
 * the head (0.60 vs 0.54 across), so from every angle — especially the
 * game's top-down camera — it reads as a dog with a body, not a head with
 * feet. Stubby approved legs kept (0.17 long, paws at y=0). Top-down
 * direction read: brown/white head + blaze at the front vs black saddle
 * behind.
 *
 * ONE ear per side: a single continuous LatheGeometry teardrop (narrow
 * root, full middle, rounded tip), flattened into a soft paddle, rooted at
 * the top-side of the skull with its upper quarter buried inside the head
 * sphere, draping beside the cheek with a slight outward + backward tilt.
 * One mesh, one clean silhouette — no overlapping lobes, nothing that can
 * read as a second ear.
 *
 * Tail: pivot at the rump top (embedded in the haunch, under the saddle's
 * black rear so the base emerges from black fur like a real tricolor), with
 * the shaft in an INNER tilt group leaning ~20 degrees back — pointing UP
 * like a happy flag (tip crests at y~0.82 pre-scale, white flag tip).
 * syncToEntity wags `tail.rotation.y` on the OUTER pivot; because the
 * back-lean lives in the inner group, that yaw sweeps the leaned shaft
 * around the vertical axis — the flag waves side to side — instead of
 * uselessly spinning a vertical shaft about its own axis.
 *
 * flatShading was auditioned for the low-poly-portfolio look and dropped:
 * the decal shells depend on shell and base shading identically at the same
 * surface point (that is what sells "painted on"), and faceted normals
 * break that pairing (the shell's facet seams land at different angles than
 * the base sphere's, so the markings would shimmer against their ground).
 * Soft smooth shading also matches the toy-like reference sites better.
 *
 * Ears, tail, jaw and legs are pivot groups (joint at the origin, meshes
 * offset inside) exposed via `g.userData.parts` (BeagleParts) so
 * syncToEntity can drive the trot/wag/flop/chomp, and the 4 shared coat
 * materials land in `g.userData.coatMats` so applyBeagleSkin restyles every
 * coat-colored surface of the dog in place for all 4 skins.
 */
export function makeBeagle(skin: BeagleSkin = getEquippedBeagleSkin()): THREE.Group {
  const g = new THREE.Group();
  const { coat } = skin;
  const tan = new THREE.MeshStandardMaterial({ color: coat.tan, roughness: 0.6 });
  const white = new THREE.MeshStandardMaterial({ color: coat.white, roughness: 0.6 });
  const black = new THREE.MeshStandardMaterial({ color: coat.black, roughness: 0.55 });
  const earMat = new THREE.MeshStandardMaterial({ color: coat.ear, roughness: 0.65 });

  // Decal-shell builder (see the doc comment): a cap of a sphere `factor`
  // larger than `baseR`, pole aimed by rotating the GEOMETRY (rx about X,
  // then ry about Y) so the owning mesh can reuse the base form's scale and
  // position verbatim and stay flush on it. phi/theta ranges allow lune
  // strips (the blaze) as well as round caps.
  const shell = (
    baseR: number,
    factor: number,
    rx: number,
    ry: number,
    thetaLen: number,
    thetaStart = 0,
    phiStart = 0,
    phiLen = Math.PI * 2,
  ): THREE.SphereGeometry => {
    const geo = new THREE.SphereGeometry(baseR * factor, 48, 28, phiStart, phiLen, thetaStart, thetaLen);
    if (rx !== 0) geo.rotateX(rx);
    if (ry !== 0) geo.rotateY(ry);
    return geo;
  };

  // --- unified silhouette: 3 blended body forms ---
  // Main body: a long low ellipsoid (x 0.30 / y 0.255 / z 0.42 half-extents)
  // spanning z -0.44..0.40 — deliberately elongated so a clear body runs
  // behind and below the head (checklist: never "a head with feet").
  const BODY_R = 0.3;
  const body = new THREE.Mesh(new THREE.SphereGeometry(BODY_R, 32, 24), tan);
  body.name = "body";
  body.scale.set(1, 0.85, 1.4);
  body.position.set(0, 0.34, -0.02);
  g.add(body);

  // Haunches: a rounder form blended into the rear. Sized so it pokes
  // through the main ellipsoid only LOW on the flanks (max ~0.02 proud at
  // y~0.30, below the saddle's flank edge at y~0.42) and at the very rear
  // under the tail — a soft hip bulge that never breaks the saddle seam.
  const haunch = new THREE.Mesh(new THREE.SphereGeometry(0.24, 24, 18), tan);
  haunch.name = "haunch";
  haunch.scale.set(1.06, 0.9, 0.95);
  haunch.position.set(0, 0.3, -0.28);
  g.add(haunch);

  // Chest: a white form giving fullness under the chin. Buried inside the
  // body everywhere except a forward poke (z 0.40..0.47) that lands wholly
  // inside the white belly cap's zone, so form and decal union seamlessly
  // into one white chest/belly region (same material, no visible seam).
  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.22, 24, 18), white);
  chest.name = "chest";
  chest.scale.set(0.9, 0.95, 1.05);
  chest.position.set(0, 0.3, 0.24);
  g.add(chest);

  // BLACK saddle: ONE smooth flush cap on the body — pole tilted 0.35 rad
  // back, angular radius 1.25 rad. Front edge ((0,~0.51,~0.30) pre-scale)
  // hides inside the head/neck; rear edge wraps past the rump to z~-0.44 so
  // the tail base emerges from black fur; flank edge drapes to y~0.42,
  // about half-way down the visible side. Radial rise: 0.006 (x) / 0.005
  // (y) / 0.0086 (z) — painted into the surface, zero bumps.
  const saddle = new THREE.Mesh(shell(BODY_R, 1.02, -0.35, 0, 1.25), black);
  saddle.name = "saddle";
  saddle.scale.copy(body.scale);
  saddle.position.copy(body.position);
  g.add(saddle);

  // WHITE bib + belly: one flush cap, pole tilted forward-and-down (3/4 pi
  // about X points it at (0,-0.71,+0.71)), angular radius 1.05 — its upper
  // front edge crests at y~0.41 under the chin (the bib) and its rear edge
  // sweeps under the belly. Factor 1.012 keeps it under the saddle's 1.02
  // (they never meet anyway — a tan flank band separates them).
  const belly = new THREE.Mesh(shell(BODY_R, 1.012, Math.PI * 0.75, 0, 1.05), white);
  belly.name = "belly";
  belly.scale.copy(body.scale);
  belly.position.copy(body.position);
  g.add(belly);

  // --- head: chibi but honest (r 0.27, crown at 0.83 pre-scale) ---
  const HEAD_R = 0.27;
  const HEAD_POS = new THREE.Vector3(0, 0.56, 0.3);
  const head = new THREE.Mesh(new THREE.SphereGeometry(HEAD_R, 32, 24), tan);
  head.name = "head";
  head.position.copy(HEAD_POS);
  g.add(head);

  // Muzzle: a white form (silhouette, not a marking) whose top meets the
  // blaze's lower end at (0,~0.60,~0.57) so blaze and muzzle read as one
  // continuous white face marking.
  const snout = new THREE.Mesh(new THREE.SphereGeometry(0.13, 18, 14), white);
  snout.name = "snout";
  snout.scale.set(1.05, 0.85, 1.15);
  snout.position.set(0, 0.5, 0.5);
  g.add(snout);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.052, 12, 10), black);
  nose.name = "nose";
  nose.scale.set(1.1, 0.85, 0.8);
  nose.position.set(0, 0.555, 0.635);
  g.add(nose);

  // WHITE blaze: a phi-restricted LUNE of the head sphere itself — a strip
  // 0.32 rad wide in azimuth centred on the front meridian (phi = pi/2 in
  // SphereGeometry's parametrisation), running from theta 0.25 (just off
  // the crown) down to theta 1.40 where it melts into the muzzle top.
  // x half-width ~0.043 — well clear of the eyes at x ±0.115. Rise 0.006:
  // painted flush into the head, NOT a raised strip.
  const blaze = new THREE.Mesh(
    shell(HEAD_R, 1.022, 0, 0, 1.15, 0.25, Math.PI / 2 - 0.16, 0.32),
    white,
  );
  blaze.name = "blaze";
  blaze.position.copy(HEAD_POS);
  g.add(blaze);

  // Jaw: small white lower-lip pivot hinged at the back of the muzzle so
  // syncToEntity's chomp swings it open/closed under the snout.
  const jaw = new THREE.Group();
  jaw.name = "jaw";
  jaw.position.set(0, 0.46, 0.44);
  const jawMesh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 10), white);
  jawMesh.name = "jawMesh";
  jawMesh.scale.set(0.85, 0.5, 1);
  jawMesh.position.set(0, -0.035, 0.1);
  jaw.add(jawMesh);
  g.add(jaw);

  // Eye materials — fixed, never skinned (same policy as before): white
  // sclera, calm dark-brown pupil, tiny emissive glint that still reads as
  // a light-catch in shadow.
  const eyeW = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25 });
  const pupilM = new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 0.35 });
  const glintM = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.15,
    emissive: 0xffffff,
    emissiveIntensity: 0.35,
  });

  // Eye-cap aim, derived from the unit gaze direction (±0.42, 0.20, 0.885)
  // — ~33 degrees off the head's forward axis, slightly above the muzzle:
  // rotateX(acos(0.20)) lowers the cap pole from +Y to the right elevation,
  // then rotateY(±0.443) yaws it to each side. The pupil uses a slightly
  // smaller yaw (0.41) so both pupils sit a touch medial on their scleras —
  // a gentle forward convergence, never walleyed. The glint aims a little
  // higher and further out (up-and-outer highlight).
  const EYE_RX = Math.acos(0.2);
  const EYE_RY = 0.443;
  const PUPIL_RY = 0.41;
  const GLINT_RX = EYE_RX - 0.09;
  const GLINT_RY = 0.5;

  // ONE-piece teardrop ear profile for LatheGeometry: narrow root, fullest
  // just below the middle, rounded tapered tip 0.36 long. Lathed about its
  // own axis then flattened into a paddle (scale x0.55/z0.85), it is a
  // single continuous mesh — one clean silhouette per side.
  const earProfile = [
    new THREE.Vector2(0.002, 0),
    new THREE.Vector2(0.045, -0.05),
    new THREE.Vector2(0.07, -0.13),
    new THREE.Vector2(0.082, -0.21),
    new THREE.Vector2(0.068, -0.28),
    new THREE.Vector2(0.038, -0.33),
    new THREE.Vector2(0.002, -0.36),
  ];

  const legs: THREE.Group[] = [];
  ([-1, 1] as const).forEach((s) => {
    // EAR-BROWN head-side cap: pole aimed at the ear root (unit direction
    // ~(±0.78, 0.59, 0.22)), angular radius 0.95 — sweeps around the eye
    // and cheek so the eyes sit ON brown patches (they render above it via
    // larger radius factors) and the blaze splits the brown crown, the
    // classic beagle head map. Factors 1.010/1.014 per side so the small
    // overlap at the back of the crown layers cleanly instead of z-fighting.
    const sideCap = new THREE.Mesh(shell(HEAD_R, 1.012 + 0.002 * s, 0.936, 1.31 * s, 0.95), earMat);
    sideCap.name = s < 0 ? "sideCapL" : "sideCapR";
    sideCap.position.copy(HEAD_POS);
    g.add(sideCap);

    // Ear: ONE continuous teardrop (see earProfile), rooted at the top-side
    // of the skull. The pivot sits 0.02 INSIDE the head surface and the
    // mesh is nudged 0.02 further up, so the ear's narrow root is buried a
    // solid ~0.04-0.08 inside the head sphere at every angle — it visibly
    // grows out of the skull (within the brown side cap, so root color
    // matches). A slight outward roll (rotation.z, tip curls off the cheek)
    // and backward drape (rotation.x) keep it soft; the tip hangs beside
    // the cheek at y~0.36 pre-scale, far above ground even mid-flop.
    // syncToEntity flops earPivot.rotation.x, same joint semantics as ever.
    const earPivot = new THREE.Group();
    earPivot.name = s < 0 ? "earL" : "earR";
    earPivot.position.set(0.195 * s, 0.716, 0.313);
    const ear = new THREE.Mesh(new THREE.LatheGeometry(earProfile, 20), earMat);
    ear.name = s < 0 ? "earMeshL" : "earMeshR";
    ear.scale.set(0.55, 1, 0.85);
    ear.rotation.z = 0.2 * s;
    ear.rotation.x = 0.12;
    ear.position.set(0.01 * s, 0.02, 0);
    earPivot.add(ear);
    g.add(earPivot);
    if (s < 0) g.userData.__earL = earPivot;
    else g.userData.__earR = earPivot;

    // Painted-lens eye: three concentric flush caps directly on the head —
    // sclera (angular radius 0.28, rise 0.005), pupil (0.165, rise 0.008,
    // aimed a touch medial for convergence), glint (0.055, rise 0.010,
    // up-and-outer). Embedded, near-flush, cute — nothing bulges.
    const sclera = new THREE.Mesh(shell(HEAD_R, 1.02, EYE_RX, EYE_RY * s, 0.28), eyeW);
    sclera.name = s < 0 ? "scleraL" : "scleraR";
    sclera.position.copy(HEAD_POS);
    g.add(sclera);
    const pupil = new THREE.Mesh(shell(HEAD_R, 1.03, EYE_RX, PUPIL_RY * s, 0.165), pupilM);
    pupil.name = s < 0 ? "pupilL" : "pupilR";
    pupil.position.copy(HEAD_POS);
    g.add(pupil);
    const glint = new THREE.Mesh(shell(HEAD_R, 1.038, GLINT_RX, GLINT_RY * s, 0.055), glintM);
    glint.name = s < 0 ? "glintL" : "glintR";
    glint.position.copy(HEAD_POS);
    g.add(glint);

    // Legs: approved stubby proportions — pivot at the hip (inside the
    // body), short chunky cylinder, white paw/sock blob INSIDE the pivot so
    // it trots with the leg. Paw bottom lands at y~0.00 (ground contact).
    ([-0.17, 0.17] as const).forEach((dz) => {
      const legName = `leg${dz < 0 ? "F" : "B"}${s < 0 ? "L" : "R"}`;
      const legPivot = new THREE.Group();
      legPivot.name = legName;
      legPivot.position.set(0.16 * s, 0.2, dz);
      const legMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.055, 0.17, 10), tan);
      legMesh.name = `${legName}Mesh`;
      legMesh.position.y = -0.085;
      legPivot.add(legMesh);
      const paw = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), white);
      paw.name = `${legName}Paw`;
      paw.scale.set(1.05, 0.75, 1.25);
      paw.position.set(0, -0.155, 0.025);
      legPivot.add(paw);
      g.add(legPivot);
      legs.push(legPivot);
    });
  });

  // Tail: the happy flag. OUTER pivot at the rump top (0,0.46,-0.38) —
  // inside the haunch form and under the saddle's black rear, so the base
  // emerges from black fur. INNER tilt group leans the shaft 0.35 rad BACK
  // (near-vertical with a slight back-lean); shaft + white tip live in the
  // tilt group. syncToEntity wags tail.rotation.y on the OUTER pivot, which
  // sweeps the leaned shaft around the vertical axis — the tip traces a
  // visible side-to-side flag wave (horizontal lever arm ~0.11) instead of
  // a vertical shaft spinning invisibly on its own axis. Tip crests at
  // y~0.82 pre-scale, under the 1.0 ceiling.
  // Shaft is a chunky tapered cone (0.06 base -> 0.038 top) — thick enough to
  // read as a tail, not an antenna. The white tip is a matching taper that
  // overlaps the shaft's top third (steep shared seam at the shaft radius, no
  // radius jump to a distinct sphere) so it blends in as the tail's white
  // upper segment rather than a lollipop ball stuck on the end.
  const tail = new THREE.Group();
  tail.name = "tail";
  tail.position.set(0, 0.46, -0.38);
  const tailTilt = new THREE.Group();
  tailTilt.name = "tailTilt";
  tailTilt.rotation.x = -0.35;
  tail.add(tailTilt);
  const tailShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.06, 0.3, 10), tan);
  tailShaft.name = "tailShaft";
  tailShaft.position.y = 0.15;
  tailTilt.add(tailShaft);
  const tailTip = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.044, 0.16, 10), white);
  tailTip.name = "tailTip";
  tailTip.position.y = 0.34;
  tailTilt.add(tailTip);
  const tailTipCap = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 8), white);
  tailTipCap.name = "tailTipCap";
  tailTipCap.position.y = 0.42;
  tailTilt.add(tailTipCap);
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

  // --- Character Editor edits (generated by /editor/) ---
  haunch.scale.set(3, 0.9, 0.95);

  haunch.removeFromParent();

  chest.removeFromParent();
  // --- end Character Editor edits ---

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
  dome.name = "dome";
  dome.position.y = 0.36;
  g.add(dome);
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.36, 20), bodyMat);
  skirt.name = "skirt";
  skirt.position.y = 0.18;
  g.add(skirt);
  // wavy hem
  const hem: THREE.Mesh[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 10), bodyMat);
    b.name = `hem${i}`;
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
    e.name = s < 0 ? "eyeL" : "eyeR";
    e.scale.set(0.8, 1, 0.6);
    e.position.set(0.12 * s, 0.4, 0.2);
    g.add(e);
    eyes.push(e);
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 10), pupM);
    p.name = s < 0 ? "pupilL" : "pupilR";
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
  shell.name = "shell";
  shell.scale.set(1, 0.72, 1.12);
  shell.position.y = 0.28;
  g.add(shell);

  // Underbelly rim: a short, wide cylinder under the shell's equator standing
  // in for the ghost's "skirt" — keeps the beetle grounded-looking and gives
  // `hem`/`skirt` real geometry to wobble/breathe.
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.26, 0.14, 20), bodyMat);
  skirt.name = "skirt";
  skirt.position.y = 0.14;
  g.add(skirt);

  // Shell seam: a thin dark line down the midline (a classic ladybug/beetle
  // read), and a few small "hem" spheres standing in for wing-case rivets/
  // spots, dotted along the shell's rear edge — same role as the ghost's
  // wavy hem (wobbled by animateGhostHem) but doubling as subtle shell detail.
  const seam = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.58), bodyMat);
  seam.name = "seam";
  seam.position.set(0, 0.42, 0.02);
  g.add(seam);

  const hem: THREE.Mesh[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 10), bodyMat);
    b.name = `hem${i}`;
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
  head.name = "head";
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
    stalk.name = s < 0 ? "antennaStalkL" : "antennaStalkR";
    // Cylinder geometry is centred on its own origin, so offsetting the pivot
    // half its length along its local +Y (post-rotation) keeps the BASE
    // (not the middle) anchored at the root point.
    stalk.position.set(0.07 * s, 0.42, 0.3);
    stalk.rotation.x = -0.6;
    stalk.rotation.z = 0.18 * s;
    g.add(stalk);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 8), accentMat);
    tip.name = s < 0 ? "antennaTipL" : "antennaTipR";
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
    e.name = s < 0 ? "eyeL" : "eyeR";
    e.scale.set(0.8, 1, 0.6);
    e.position.set(0.12 * s, 0.4, 0.2);
    g.add(e);
    eyes.push(e);
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 10), pupM);
    p.name = s < 0 ? "pupilL" : "pupilR";
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
  body.name = "body";
  body.scale.set(0.92, 0.88, 1.3);
  body.position.y = 0.3;
  g.add(body);

  // Underbelly rim: standing in for the ghost's "skirt", same role as the
  // beetle's — keeps the bee grounded-looking and gives `hem`/`skirt` real
  // geometry to wobble/breathe.
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.19, 0.12, 20), bodyMat);
  skirt.name = "skirt";
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
      blob.name = `hem${hem.length}`;
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
    wing.name = s < 0 ? "wingL" : "wingR";
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
    pivot.name = s < 0 ? "antennaL" : "antennaR";
    pivot.position.set(0.05 * s, 0.4, 0.32); // root point, flush against the body's front-top
    pivot.rotation.x = -0.6; // sweep up
    pivot.rotation.z = 0.18 * s; // sweep outward
    g.add(pivot);

    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.011, ANTENNA_LEN, 6), accentMat);
    stalk.name = s < 0 ? "antennaStalkL" : "antennaStalkR";
    stalk.position.y = ANTENNA_LEN / 2; // base at the pivot origin, growing along local +Y
    pivot.add(stalk);

    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.011, 8, 8), accentMat);
    tip.name = s < 0 ? "antennaTipL" : "antennaTipR";
    tip.position.y = ANTENNA_LEN; // exactly at the stalk's far end, same local space
    pivot.add(tip);
  });

  // Tiny stinger nub at the rear — small dark accent, subtle.
  const stinger = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.09, 8), accentMat);
  stinger.name = "stinger";
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
    e.name = s < 0 ? "eyeL" : "eyeR";
    e.scale.set(0.8, 1, 0.6);
    e.position.set(0.12 * s, 0.4, 0.2);
    g.add(e);
    eyes.push(e);
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 10), pupM);
    p.name = s < 0 ? "pupilL" : "pupilR";
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
  shell.name = "shell";
  shell.scale.set(1.02, 0.9, 1.08);
  shell.position.y = 0.26;
  g.add(shell);

  // Underbelly rim: standing in for the ghost's "skirt", same role as the
  // beetle's/bee's — keeps the ladybug grounded-looking and gives
  // `hem`/`skirt` real geometry to wobble/breathe.
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.24, 0.13, 20), bodyMat);
  skirt.name = "skirt";
  skirt.position.y = 0.13;
  g.add(skirt);

  // Centre seam: thin dark line down the midline (the wing-case split) — a
  // classic ladybug detail, on top of the shell's crown.
  const seam = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.018, 0.5), accentMat);
  seam.name = "seam";
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
    spot.name = `hem${hem.length}`;
    spot.scale.set(1, 0.4, 1);
    spot.position.set(x, spotSurfaceY(x, z), z);
    g.add(spot);
    hem.push(spot);
  });

  // Small fixed-dark head at the front — ladybugs have a distinct black
  // head, kept small (same treatment as the beetle's) so it doesn't
  // dominate or swallow the eyes.
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.065, 12, 10), accentMat);
  head.name = "head";
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
    pivot.name = s < 0 ? "antennaL" : "antennaR";
    pivot.position.set(0.06 * s, 0.36, 0.32);
    pivot.rotation.x = -0.6;
    pivot.rotation.z = 0.18 * s;
    g.add(pivot);

    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.012, ANTENNA_LEN, 6), accentMat);
    stalk.name = s < 0 ? "antennaStalkL" : "antennaStalkR";
    stalk.position.y = ANTENNA_LEN / 2;
    pivot.add(stalk);

    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 8), accentMat);
    tip.name = s < 0 ? "antennaTipL" : "antennaTipR";
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
    e.name = s < 0 ? "eyeL" : "eyeR";
    e.scale.set(0.8, 1, 0.6);
    e.position.set(0.12 * s, 0.4, 0.2);
    g.add(e);
    eyes.push(e);
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 10), pupM);
    p.name = s < 0 ? "pupilL" : "pupilR";
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
