// OWNER: render-artist (IDEA-064 v5)
//
// THE SHIELD YOU CAN SEE.
//
// Nuno: "when the beagle have a shield can we add something visual? Like a
// buble around the beagle? this way we have a visual indicator of the beagle
// and if the shield is active or not."
//
// Until now a held shield was stated in exactly one place — a chip in the
// power-up tray, which since IDEA-070 lives up under the HUD, i.e. the one part
// of the screen a player is NOT looking at while three enemies close in. The
// information that decides whether you take the gap or turn around was
// therefore nowhere near the gap. powerups.ts has carried a `hasShield()`
// export "for the HUD and for the beagle's bubble" since IDEA-046; the bubble
// half was never built, and the export sat unused for four releases.
//
// SIX THINGS ARE LOAD-BEARING, and the first two are measurements rather than
// taste while the next two are things only the render could say.
//
// 1. A SPHERE THAT CONTAINS THE BEAGLE IS WIDER THAN THE CORRIDOR IT RUNS
//    DOWN. Measured from vertices (scripts/_scratch-beagle-bounds.ts, never
//    Box3.setFromObject — see _scratch-exact-cast.ts), the dog is 0.453 wide,
//    0.866 tall and 0.908 long, and the tightest enclosing sphere has radius
//    0.553 about y = 0.43. That is 1.106 TILES across, against a corridor
//    exactly one tile wide — so a spherical bubble would be inside both hedges
//    for the entire run, which reads as clipping, not as a shield.
//    So it is an ELLIPSOID AIMED ALONG THE DOG'S HEADING: narrow across the
//    corridor, where there is no room, and long along it, where there is. The
//    dog is long and thin, and so is the space it moves through — the same
//    axis, which is why this works out rather than being a compromise.
// 2. IT FOLLOWS THE BEAGLE'S POSITION AND YAW, AND NOTHING ELSE. Not a child
//    of the beagle group: that group breathes (an idle scale.y oscillation),
//    waddles (rotation.z), is scaled to nothing by the death animation, and is
//    toggled invisible twelve times a second during the post-hit grace blink.
//    A bubble inheriting any of that would wobble, squash and strobe. Copying
//    two channels out is the whole coupling.
// 3. TWO SHELLS, NOT ONE, AND THE FAR ONE IS THE DENSE ONE. A single
//    translucent ball puts its full tint over the dog, and the dog is a
//    TRICOLOUR — the thing the player bought. Splitting the surface into a
//    BackSide shell (the far wall, 0.30) and a FrontSide shell (the glass you
//    look through, 0.10) is how real glass reads, and it costs one extra draw
//    call. It also produces the rim for free: where the dog covers the far
//    wall you get 0.10 of glaze, and in the ring between the dog's silhouette
//    and the bubble's you get both shells at once. A bright halo hugging the
//    dog, from depth testing, with no fresnel and no shader.
// 4. A SHELL ALONE IS A SMUDGE; THE RING IS WHAT READS. The first build was
//    the two shells and nothing else, and the render settled it: at the play
//    camera a translucent teal ball over a dark green hedge is a soft grey
//    bloom around the dog that could equally be its own shadow. No edge, so no
//    object. The fix is the project's own board lesson one scale in
//    (IDEA-068): at this size a shape does not read, a hard VALUE STEP does.
//    So a bright ring sits on the ellipsoid's own equator, in the bubble's
//    local XZ plane - which is the right plane precisely because this camera
//    looks DOWN 59 degrees, so a horizontal band is seen nearly face-on and
//    projects as a wide ellipse hugging the dog rather than as an edge-on
//    line. It is a LIGHTER cyan than the shells on purpose: the shells are the
//    glass and the ring is the light on it, and teal-on-green needs the value
//    step more than it needs the hue.
// 5. `MeshBasicMaterial`, UNLIT — the second deliberate exception to this
//    project's cel-shading rule after the eye glint, and for the same reason.
//    A toon ramp quantises by surface normal, so a toon bubble would be three
//    flat bands of cyan with hard boundaries across it: the dark band reads as
//    dirt on the glass, and the boundaries read as cracks. An energy field is
//    uniform by nature. `depthWrite: false` so the bubble never occludes
//    anything - including the other shell.
// 6. IT ENDS DIFFERENTLY DEPENDING ON WHY. Spent on a hit, it BURSTS
//    (expands and fades in 0.22s, alongside effects.shieldBroke()'s ground
//    ring and the existing shieldBreak() sound). Otherwise — a run ending, a
//    map cleared with it still held — it just fades. A shield that vanishes
//    the same way whether or not it did its job leaves the player guessing
//    which of the two just happened, at the exact moment the screen is also
//    flashing and the beagle is blinking.
import * as THREE from "three";

/**
 * The bubble's cyan.
 *
 * It is `#53C7C0` because that is the colour of the SHIELD CHIP in the
 * power-up tray (`POWERUP_LOOK.shield` in src/ui/hud.ts) — the chip and the
 * bubble are two readouts of one fact and must not be two different cyans.
 * They cannot share a constant: hud.ts is the DOM layer and is not allowed to
 * import from src/game, and this is the render layer. So the literal is
 * duplicated and `scripts/test-powerups.ts` reads BOTH files and fails if they
 * drift, which is the same shape as every other hand-copied field in this
 * codebase (the palette writer, propsCodegen's field list).
 */
export const SHIELD_COLOR = 0x53c7c0;

/**
 * The ellipsoid, in world units, and the reasoning is rule 1 above.
 *
 * `x` is ACROSS the corridor and is the constrained one. The measured free
 * half-width of a corridor is 0.5 minus IDEA-068's outward hedge bulge, which
 * grows with height (`0.105 * t^1.7`), so the tightest point is not the floor:
 * at the bubble's own widest height the gap is 0.055 and at the crown 0.098.
 * `y`/`z` are the smallest that still contain every vertex of the dog (0.526
 * and 0.559) plus a little air, so the fur never grazes the glass.
 */
const RADIUS = { x: 0.42, y: 0.55, z: 0.58 } as const;

/** Where the ellipsoid's centre sits above the floor — the beagle's own
 *  bounding-box centre (0.430), so the bubble is not lopsided about the dog. */
const CENTER_Y = 0.43;

/**
 * The ring's cyan — lighter than the shells' (rule 4).
 *
 * Not a second colour so much as the same one with the light on it: the ring
 * has to win a value fight against a dark green hedge, and hue alone does not
 * carry at 30 CSS px.
 */
const RIM_COLOR = 0x9ef0ea;

/** Opacity of the far wall, of the glass you look through, and of the ring.
 *  See rules 3 and 4. The first two were 0.30/0.10 and the render said the
 *  whole thing was a smudge; the ring took over the reading, which is what
 *  lets the glass stay light enough to keep the dog's own tricolour. */
const BACK_OPACITY = 0.45;
const FRONT_OPACITY = 0.12;
const RIM_OPACITY = 0.85;

/**
 * The ring's tube radius, in the ellipsoid's own local units.
 *
 * Measured rather than chosen: on a 390px phone the board spans 325 CSS px for
 * 21 tiles, so one tile is 18.6 px and the ring's DIAMETER lands at
 * `2 * RIM_TUBE * RADIUS.x * 18.6` = about 1.2 CSS px — which only clears the
 * CARTOON rule's couple-of-pixels floor because every phone this ships to
 * renders at DPR 2-3 (3.7 device px there). Thinner and it dissolves on a
 * 1x display; much thicker and it stops being a rim and becomes a tyre.
 */
const RIM_TUBE = 0.055;

/**
 * The SECOND ring, and it is what turns a halo into a sphere.
 *
 * One ring reads as "protected" and reads as FLAT — a hoop on the floor, or a
 * selection marker. Two horizontal rings at different heights are latitude
 * lines on a globe, which is a shape the eye assembles instantly from two
 * marks. They are both HORIZONTAL on purpose: this camera looks down 59
 * degrees, so a horizontal circle is seen nearly face-on whatever the dog's
 * heading, where any vertical ring would swing from a wide ellipse to an
 * edge-on line as the beagle turned a corner — the cue would come and go with
 * the direction of travel, which is the one thing a state readout must not do.
 *
 * Its height is a fraction of the ellipsoid's own half-height, and its radius
 * is what the surface actually is at that height: sqrt(1 - h^2). Derived
 * rather than typed, so it cannot drift off the shell it is meant to be lying
 * on.
 */
const RIM2_HEIGHT = 0.62;
const RIM2_RADIUS = Math.sqrt(1 - RIM2_HEIGHT * RIM2_HEIGHT);
const RIM2_OPACITY = 0.7;

/** Seconds. In is longer than out because appearing is the event worth
 *  noticing; going out is usually followed by something louder. */
const FADE_IN = 0.22;
const FADE_OUT = 0.14;
const BURST = 0.22;

/** The idle breath: ±2.5% at 0.55 Hz. Enough that the bubble reads as ALIVE
 *  rather than as a decal stuck to the dog, small enough that it is never
 *  motion the eye has to track during a chase. */
const BREATH_AMPLITUDE = 0.025;
const BREATH_HZ = 0.55;

/** How far the burst expands before it is gone. */
const BURST_SCALE = 1.5;

type Phase = "off" | "in" | "on" | "out" | "burst";

export interface ShieldBubble {
  /**
   * Follow the beagle and play whichever transition the two states imply.
   *
   * `active` is simply `hasShield(powerups)` — the caller does not have to
   * remember what was true last frame, which is the point: every entry and
   * exit is derived here from the edge, so no call site can forget to turn the
   * bubble off.
   */
  update(dt: number, follow: THREE.Object3D, active: boolean): void;
  /** The shield just absorbed a hit — burst rather than fade (rule 6). */
  burst(): void;
  dispose(): void;
}

export function createShieldBubble(scene: THREE.Scene): ShieldBubble {
  const root = new THREE.Group();
  // Named so the browser suite can find it by name rather than by shape ("the
  // group in the scene with four mesh children"), which is a description that
  // goes stale the moment the bubble gains or loses a ring.
  root.name = "shield-bubble";
  root.visible = false;
  // Nothing about this reads or writes the scene graph's matrices before it is
  // positioned, and it is moved every frame it is visible.
  root.matrixAutoUpdate = true;

  // ONE geometry, two meshes. A unit sphere: the ellipsoid comes from the
  // root's scale, so the breath and the burst multiply it rather than each
  // axis needing its own arithmetic.
  const geo = new THREE.SphereGeometry(1, 32, 20);

  const backMat = new THREE.MeshBasicMaterial({
    color: SHIELD_COLOR,
    transparent: true,
    opacity: BACK_OPACITY,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const frontMat = new THREE.MeshBasicMaterial({
    color: SHIELD_COLOR,
    transparent: true,
    opacity: FRONT_OPACITY,
    side: THREE.FrontSide,
    depthWrite: false,
  });

  // The equator ring (rule 4). Built in the XY plane like every torus and laid
  // FLAT, so that after the root's non-uniform scale it traces the ellipsoid's
  // own widest section exactly — radius 1 in local units IS the surface.
  const rimGeo = new THREE.TorusGeometry(1, RIM_TUBE, 8, 48);
  const rimMat = new THREE.MeshBasicMaterial({
    color: RIM_COLOR,
    transparent: true,
    opacity: RIM_OPACITY,
    depthWrite: false,
  });
  const rim = new THREE.Mesh(rimGeo, rimMat);
  rim.rotation.x = -Math.PI / 2;

  // The upper latitude. Its own geometry rather than a scaled copy of the
  // first, because scaling a torus scales its TUBE too and a rim that thins
  // with height falls under the cartoon floor at the top of the bubble.
  const rim2Geo = new THREE.TorusGeometry(RIM2_RADIUS, RIM_TUBE * 0.85, 8, 40);
  const rim2Mat = new THREE.MeshBasicMaterial({
    color: RIM_COLOR,
    transparent: true,
    opacity: RIM2_OPACITY,
    depthWrite: false,
  });
  const rim2 = new THREE.Mesh(rim2Geo, rim2Mat);
  rim2.rotation.x = -Math.PI / 2;
  rim2.position.y = RIM2_HEIGHT;

  const back = new THREE.Mesh(geo, backMat);
  const front = new THREE.Mesh(geo, frontMat);
  // The far wall first, so where both are on screen they blend in the order
  // they are in space. One object cannot be depth-sorted against itself.
  back.renderOrder = 1;
  front.renderOrder = 2;
  rim.renderOrder = 3;
  rim2.renderOrder = 3;
  root.add(back, front, rim, rim2);
  scene.add(root);

  let phase: Phase = "off";
  let t = 0;
  /** Set by burst() and consumed by the next update, so a hit taken between
   *  two frames cannot be missed and cannot fire twice. */
  let burstQueued = false;
  let breath = 0;

  function setOpacity(k: number): void {
    backMat.opacity = BACK_OPACITY * k;
    frontMat.opacity = FRONT_OPACITY * k;
    rimMat.opacity = RIM_OPACITY * k;
    rim2Mat.opacity = RIM2_OPACITY * k;
  }

  function update(dt: number, follow: THREE.Object3D, active: boolean): void {
    if (burstQueued) {
      burstQueued = false;
      // Only if there was something to burst. A queued burst arriving while
      // the bubble is already off would otherwise flash a bubble that was
      // never there.
      if (phase !== "off") {
        phase = "burst";
        t = 0;
      }
    } else if (active && (phase === "off" || phase === "out")) {
      phase = "in";
      t = 0;
    } else if (!active && (phase === "in" || phase === "on")) {
      phase = "out";
      t = 0;
    }

    if (phase === "off") {
      root.visible = false;
      return;
    }

    t += dt;
    breath += dt;

    // How big and how solid, per phase. `scale` is a multiplier on RADIUS.
    let scale = 1;
    let alpha = 1;
    if (phase === "in") {
      const k = Math.min(t / FADE_IN, 1);
      alpha = k;
      // A small overshoot on the way in — it is what makes the bubble read as
      // snapping into existence rather than being cross-faded up.
      scale = 0.72 + 0.34 * easeOutBack(k);
      if (k >= 1) {
        phase = "on";
        t = 0;
      }
    } else if (phase === "out") {
      const k = Math.min(t / FADE_OUT, 1);
      alpha = 1 - k;
      scale = 1 - 0.12 * k;
      if (k >= 1) {
        phase = "off";
        root.visible = false;
        return;
      }
    } else if (phase === "burst") {
      const k = Math.min(t / BURST, 1);
      alpha = (1 - k) * (1 - k);
      scale = 1 + (BURST_SCALE - 1) * easeOutCubic(k);
      if (k >= 1) {
        phase = "off";
        root.visible = false;
        return;
      }
    }

    if (phase === "on") {
      scale = 1 + Math.sin(breath * BREATH_HZ * Math.PI * 2) * BREATH_AMPLITUDE;
    }

    // Position and YAW ONLY (rule 2). The dog's own y already carries its walk
    // bob, so the bubble bobs with it; CENTER_Y rides on top of that.
    root.position.set(follow.position.x, follow.position.y + CENTER_Y, follow.position.z);
    root.rotation.y = follow.rotation.y;
    root.scale.set(RADIUS.x * scale, RADIUS.y * scale, RADIUS.z * scale);
    setOpacity(alpha);
    root.visible = true;
  }

  function burst(): void {
    burstQueued = true;
  }

  function dispose(): void {
    root.removeFromParent();
    geo.dispose();
    rimGeo.dispose();
    rim2Geo.dispose();
    backMat.dispose();
    frontMat.dispose();
    rimMat.dispose();
    rim2Mat.dispose();
  }

  return { update, burst, dispose };
}

function easeOutCubic(k: number): number {
  return 1 - Math.pow(1 - k, 3);
}

/** Overshoots past 1 and settles back — the standard "pop in". */
function easeOutBack(k: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
}
