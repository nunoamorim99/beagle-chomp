// OWNER: render-artist (IDEA-079)
//
// THE MAP CAMERA — a fixed base pose with damped channels laid over it, and a
// focus blend that never takes control away from the player.
//
// Adapted from Nuno's madbox.io teardown (2026-09-21), which is right that this
// is the biggest single win available and that it comes FIRST: a grey-box scene
// on this rig already reads like the reference, and a beautiful scene on
// OrbitControls does not.
//
// ---------------------------------------------------------------------------
// WHY NOT OrbitControls
// ---------------------------------------------------------------------------
//
// A level select is a composed picture, not a model viewer. Orbiting lets a
// player put the camera somewhere the scene was never authored for — under the
// waterline, behind the islands, looking at the unlit backs of props — and
// every one of those is a screenshot of a broken game. The base pose here can
// be deviated from slightly and never escaped.
//
// ---------------------------------------------------------------------------
// FOUR DECISIONS THAT DIFFER FROM THE REFERENCE, AND WHY
// ---------------------------------------------------------------------------
//
//  1. **THE DAMPING IS EXPONENTIAL, NOT `x += (t - x) * k * dt`.** The reference
//     multiplies by delta, which is a first-order approximation of the same
//     curve and is fine while `k * dt` stays small — but it is not actually
//     frame-rate independent, and at `k * dt > 1` it OVERSHOOTS and rings. On a
//     phone a dropped frame or a tab returning from background hands you a
//     250ms delta, which is exactly when the camera must not spring. The exact
//     form `1 - exp(-rate * dt)` costs one `Math.exp` per channel per frame,
//     cannot overshoot at any delta, and is genuinely identical at 60 and 144Hz
//     rather than approximately so.
//
//  2. **THERE IS NO ROTATE CHANNEL.** The reference puts it on right-drag and
//     zoom on the wheel — neither of which exists on a phone, and the teardown
//     says so itself: design the touch interaction first and drop rotate "if it
//     does not pay for itself". On a map whose whole job is picking a level, it
//     does not. One finger pans, two fingers pinch, a tap selects.
//
//  3. **PAN IS CLAMPED TO THE CHAIN, not to a rectangle somebody guessed.** The
//     bounds come from the island positions, so adding a level extends the map
//     by construction and there is no second number to keep in step.
//
//  4. **NO GSAP.** The focus tween is fifteen lines of `smootherstep` over a
//     float. `three` is this project's only runtime dependency and a camera
//     ease is not the reason to make it two.

import * as THREE from "three";

export interface CameraPose {
  position: THREE.Vector3;
  /** Euler X (pitch) and Y (yaw) only. There is no roll on a map camera, and
   *  leaving it out makes a tilted horizon unrepresentable rather than merely
   *  avoided. */
  pitch: number;
  yaw: number;
}

/**
 * One level's framing, authored per ORIENTATION.
 *
 * Portrait is NOT a squashed landscape: a phone held upright needs the camera
 * pulled further back and swung more side-on, or the island fills the frame and
 * its neighbours vanish. The reference authored both and the teardown flags it
 * as the detail most people skip and then wonder why mobile looks wrong — and
 * here portrait is the PRIMARY case, not the variant.
 */
export interface FocusPoint {
  id: string;
  /** What the pin is pinned to, in world space. */
  point: THREE.Vector3;
  landscape: CameraPose;
  portrait: CameraPose;
}

export interface JourneyCameraParams {
  /** Base pitch in radians, negative looking down. The reference's -0.15pi
   *  (-27 degrees) is the whole "toy diorama" framing: shallow enough that
   *  silhouettes still read, steep enough to show the island tops. Ours looks
   *  down the chain rather than across it, so the yaw differs. */
  basePitch: number;
  baseYaw: number;
  /** Height above the water at rest. */
  baseHeight: number;
  /** How far back along the view axis the camera sits at zoom 0. */
  baseDistance: number;
  /** World units travelled per unit of normalised drag. */
  panSpeed: number;
  /** Damping RATES, in units of "e-folds per second" — bigger is snappier.
   *  Named rate rather than the reference's `multiplier` because with the
   *  exponential form they genuinely are rates, and calling them a multiplier
   *  invites somebody to reintroduce the `* dt`. */
  panRate: number;
  zoomRate: number;
  parallaxRate: number;
  focusRate: number;
  /** Zoom travel along the view direction, not along a spherical radius — so
   *  zooming pushes INTO the scene at the authored angle and never reframes it.
   *  [min, max], negative being closer. */
  zoomRange: [number, number];
  /** How far the mouse/finger position nudges the camera. Small: it is a life
   *  sign, not a control. */
  parallax: number;
  /** Pixels of movement before a press becomes a drag. Below it the gesture
   *  stays a TAP — which is what makes pins reliably selectable on a surface
   *  that is also a draggable map. */
  dragThreshold: number;
  /** Extra room past the first and last island, so the ends of the chain are
   *  not hard walls the camera bumps into. */
  panMargin: number;
  /**
   * The camera's FAR PLANE, and it is a performance control rather than a
   * clipping one.
   *
   * A map camera looks DOWN A CORRIDOR, so a shallower pitch does not just
   * change the framing — it pulls far more of the chain into the frustum. At
   * the reference's -27 degrees this rig had twenty islands in view and cost
   * **361 draw calls** against the 95 the steeper preview camera cost, and
   * every one past the fog's far plane was drawn fully fogged out: paid for,
   * invisible.
   *
   * Setting `far` to just past where the fog finishes makes the frustum itself
   * cull them, which is one number rather than a per-island distance test —
   * the same "cull to what the frame can actually see" move IDEA-069 made on
   * the board's surround. Keep it in step with the fog, or islands pop out of
   * existence before they have finished fading.
   */
  far: number;
  /**
   * How far PAST a framed island `frame()` looks, in world units.
   *
   * Dead centre is the obvious reading of "frame this level" and it wastes the
   * bottom of the screen: at progress 0 the entire chain is AHEAD of the
   * player, so a centred island left 45% of a phone frame as empty water with
   * the route running off the top. One island spacing puts the target about a
   * third up from the bottom with two or three ahead of it.
   */
  frameBias: number;
}

export const JOURNEY_CAMERA: JourneyCameraParams = {
  // -0.58 rad (33 degrees) rather than the reference's -0.47: ours looks along
  // a CHAIN where theirs looks across a cluster, so the same angle here shows
  // half the journey at once. This keeps three or four islands in frame — the
  // one you are on, and enough of what is next to be a promise.
  basePitch: -0.58,
  baseYaw: 0,
  baseHeight: 17,
  baseDistance: 15,
  panSpeed: 150,
  panRate: 7.5,
  zoomRate: 6,
  parallaxRate: 3,
  focusRate: 3.2,
  zoomRange: [-6, 9],
  parallax: 0.9,
  dragThreshold: 10,
  panMargin: 14,
  far: 104,
  // How far PAST a framed island the camera looks, in world units. One island
  // spacing, so `frame()` puts the target about a third of the way up from the
  // bottom of the frame with two or three ahead of it.
  frameBias: 7,
};

/**
 * How a focused island is framed, per orientation.
 *
 * PORTRAIT IS NOT A SQUASHED LANDSCAPE. At a fixed vertical FOV a narrow window
 * has a much narrower HORIZONTAL angle, so the same camera distance that frames
 * an island nicely on a monitor crops it on a phone — the teardown calls this
 * the detail most people skip and then wonder why mobile looks wrong. Here
 * portrait is the PRIMARY case, so it is the one tuned first and landscape is
 * the variant.
 */
export interface FocusFraming {
  /** Height above the island's own surface. */
  height: number;
  /** Distance back along +Z from the island. */
  back: number;
  /** Sideways offset, so the island is not dead centre under the card. */
  sideways: number;
}

export interface FocusFramings {
  portrait: FocusFraming;
  landscape: FocusFraming;
}

export const FOCUS_FRAMING: FocusFramings = {
  // Further back and lifted, because a portrait frame is only ~10 degrees of
  // horizontal half-angle at this FOV.
  portrait: { height: 8.5, back: 12.5, sideways: 0 },
  landscape: { height: 7, back: 9.5, sideways: 2.2 },
};

/**
 * Build a focus point per island from one rule, rather than hand-authoring 80
 * camera poses.
 *
 * THIS IS A DELIBERATE DEPARTURE FROM THE REFERENCE, and the reason is the
 * count. Madbox hand-tuned SIX focus points with a debug slider, for six
 * bespoke islands that each want their own composition — and the teardown is
 * right that this is what makes their framing look composed rather than
 * computed. We have FORTY, laid on one chain, all the same size and shape. One
 * good rule plus an escape hatch beats eighty numbers nobody will ever re-tune,
 * and eighty hand-authored poses would go stale the first time the chain's
 * spacing changed.
 *
 * `overrides` is the escape hatch: a level that earns a bespoke framing takes
 * one, and everything else follows the rule. That is also the shape an editor
 * focus-point mode would write into.
 */
export function deriveFocusPoints(
  chain: readonly THREE.Vector3[],
  ids: readonly string[],
  framings: FocusFramings = FOCUS_FRAMING,
  overrides: Readonly<Record<string, Partial<FocusFramings>>> = {},
): FocusPoint[] {
  return chain.map((point, i) => {
    const id = ids[i] ?? String(i);
    const per = overrides[id] ?? {};
    const pose = (f: FocusFraming): CameraPose => ({
      position: new THREE.Vector3(point.x + f.sideways, point.y + f.height, point.z + f.back),
      // Solved so the camera actually LOOKS at the island rather than being
      // given a pitch that happens to be about right — the horizontal leg is
      // the real one, including the sideways offset, or an off-centre framing
      // aims slightly past its own subject.
      pitch: -Math.atan2(f.height, Math.hypot(f.back, f.sideways)),
      yaw: Math.atan2(f.sideways, f.back),
    });
    return {
      id,
      point: point.clone(),
      portrait: pose({ ...framings.portrait, ...per.portrait }),
      landscape: pose({ ...framings.landscape, ...per.landscape }),
    };
  });
}

/** Frame-rate-independent approach. Returns the fraction of the remaining
 *  distance to travel this frame; `dt` in SECONDS. */
function approach(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

/** Hermite with zero first AND second derivative at both ends — the reference's
 *  `power2.inOut` by another name, and the reason a focus move neither jerks
 *  off the mark nor arrives with a visible stop. */
function smootherstep(t: number): number {
  const x = THREE.MathUtils.clamp(t, 0, 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

export interface JourneyCameraHandle {
  camera: THREE.PerspectiveCamera;
  /** Call once per frame with the real delta in SECONDS. */
  update: (dt: number) => void;
  resize: (width: number, height: number) => void;
  /** Frame a focus point. `null` hands control back. */
  focus: (point: FocusPoint | null) => void;
  /** Put a point on the chain in the MIDDLE of the frame, without focusing it.
   *  Used to open the map on the player's current level. */
  frame: (z: number) => void;
  /** Project a world point to CSS pixels for the HTML pin layer. `onScreen` is
   *  false behind the camera or outside the frustum, so a caller can hide a pin
   *  rather than drawing it at a nonsense coordinate. `distance` is in world
   *  units from the camera — the pin layer needs it because DISTANT PINS BUNCH
   *  UP: past a few islands the chain compresses toward the horizon and six
   *  labels land in the same forty pixels.
   *
   *  RAW UNITS, deliberately, not a 0..1 fraction of anything. A fraction of the
   *  far plane is useless here (nothing in frame is ever nearer than the
   *  look-ahead, so every pin reads as distant) and NDC z is worse, being
   *  hyperbolically distributed. The caller maps it against a band it chooses. */
  project: (p: THREE.Vector3) => { x: number; y: number; onScreen: boolean; distance: number };
  /** True while the pointer is past the drag threshold. The pin layer fades out
   *  on it — a map you are dragging should not also be offering buttons. */
  isDragging: () => boolean;
  detach: () => void;
}

export interface JourneyCameraOptions {
  /** Every island position, used to clamp the pan to the chain. */
  chain: readonly THREE.Vector3[];
  params?: JourneyCameraParams;
  /** Fired on a tap that never became a drag, with the pointer in CSS pixels.
   *  Selection is the caller's business — this module knows about the camera
   *  and nothing else. */
  onTap?: (x: number, y: number) => void;
}

export function attachJourneyCamera(
  dom: HTMLElement,
  opts: JourneyCameraOptions,
): JourneyCameraHandle {
  const p = opts.params ?? JOURNEY_CAMERA;
  const camera = new THREE.PerspectiveCamera(42, 1, 0.5, p.far);

  // Pan is one number: distance along the chain. The chain runs along -Z, so
  // this is how far down it the camera has travelled.
  const zs = opts.chain.map((v) => v.z);
  const zNear = Math.max(...zs) + p.panMargin;
  const zFar = Math.min(...zs) - p.panMargin;

  let panTarget = zNear;
  let panEased = zNear;
  let zoomTarget = 0;
  let zoomEased = 0;
  const parallaxTarget = new THREE.Vector2();
  const parallaxEased = new THREE.Vector2();

  let focusPoint: FocusPoint | null = null;
  let focusMix = 0;
  let focusMixTarget = 0;

  let width = 1;
  let height = 1;
  let portrait = false;

  const live = new AbortController();
  const signal = live.signal;

  // --- input ----------------------------------------------------------------
  const pointers = new Map<number, { x: number; y: number }>();
  let dragging = false;
  let downAt = { x: 0, y: 0 };
  let lastY = 0;
  let pinchStart = 0;
  let zoomAtPinchStart = 0;

  /** Drag deltas are divided by the SHORT side, so the same swipe covers the
   *  same amount of world on a phone and on a monitor. Without it a gesture
   *  tuned on desktop is unusably slow on a 390px screen. */
  const norm = (): number => Math.min(width, height);

  dom.addEventListener(
    "pointerdown",
    (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        downAt = { x: e.clientX, y: e.clientY };
        lastY = e.clientY;
        dragging = false;
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchStart = Math.hypot(a.x - b.x, a.y - b.y);
        zoomAtPinchStart = zoomTarget;
      }
    },
    { signal },
  );

  dom.addEventListener(
    "pointermove",
    (e) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchStart > 0) {
          zoomTarget = THREE.MathUtils.clamp(
            zoomAtPinchStart + (d - pinchStart) * 0.03,
            p.zoomRange[0],
            p.zoomRange[1],
          );
        }
        dragging = true;
        return;
      }

      if (!dragging && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > p.dragThreshold) {
        dragging = true;
        // Re-anchor so the map does not jump by the threshold at the moment the
        // drag is recognised.
        lastY = e.clientY;
      }
      if (!dragging) return;

      // Dragging DOWN moves the camera back up the chain, the way a map moves
      // under a finger rather than the camera moving over it.
      panTarget = THREE.MathUtils.clamp(
        panTarget + ((e.clientY - lastY) / norm()) * p.panSpeed,
        zFar,
        zNear,
      );
      lastY = e.clientY;
      // Any deliberate movement hands control back from a focused island.
      if (focusMixTarget !== 0) focusMixTarget = 0;
    },
    { signal },
  );

  const endPointer = (e: PointerEvent): void => {
    const had = pointers.size;
    pointers.delete(e.pointerId);
    if (had === 1 && !dragging) opts.onTap?.(e.clientX, e.clientY);
    if (pointers.size < 2) pinchStart = 0;
    if (pointers.size === 0) dragging = false;
  };
  dom.addEventListener("pointerup", endPointer, { signal });
  dom.addEventListener("pointercancel", endPointer, { signal });

  dom.addEventListener(
    "wheel",
    (e) => {
      zoomTarget = THREE.MathUtils.clamp(
        zoomTarget - e.deltaY * 0.01,
        p.zoomRange[0],
        p.zoomRange[1],
      );
    },
    { signal, passive: true },
  );

  dom.addEventListener(
    "pointermove",
    (e) => {
      // Parallax is mouse-only by nature: a finger is already driving the pan,
      // and adding a second response to the same input reads as drift.
      if (e.pointerType !== "mouse" || dragging) return;
      parallaxTarget.set((e.clientX / width) * 2 - 1, (e.clientY / height) * 2 - 1);
    },
    { signal },
  );

  // --- the frame ------------------------------------------------------------
  const basePos = new THREE.Vector3();
  const baseEuler = new THREE.Euler(0, 0, 0, "YXZ");
  const zoomDir = new THREE.Vector3();

  function update(dt: number): void {
    const step = Math.min(dt, 0.1); // a returning tab must not teleport the map

    panEased += (panTarget - panEased) * approach(p.panRate, step);
    zoomEased += (zoomTarget - zoomEased) * approach(p.zoomRate, step);
    parallaxEased.x += (parallaxTarget.x - parallaxEased.x) * approach(p.parallaxRate, step);
    parallaxEased.y += (parallaxTarget.y - parallaxEased.y) * approach(p.parallaxRate, step);
    focusMix += (focusMixTarget - focusMix) * approach(p.focusRate, step);

    // The free-roam pose.
    baseEuler.set(p.basePitch, p.baseYaw, 0, "YXZ");
    zoomDir.set(0, 0, -1).applyEuler(baseEuler);
    basePos.set(0, p.baseHeight, panEased + p.baseDistance).addScaledVector(zoomDir, zoomEased);

    let pitch = p.basePitch;
    let yaw = p.baseYaw;

    // THE FOCUS BLEND, and the reason it is a blend rather than a takeover:
    // free-look never stops working. The reference tweens one float and lets
    // the render loop lean toward the target pose, so a player can still nudge
    // the map while focused and `focus(null)` simply relaxes back. No state
    // machine, no snapping, no input that stops responding.
    if (focusPoint && focusMix > 0.001) {
      const pose = portrait ? focusPoint.portrait : focusPoint.landscape;
      const k = smootherstep(focusMix);
      basePos.lerp(pose.position, k);
      pitch += (pose.pitch - pitch) * k;
      yaw += (pose.yaw - yaw) * k;
    }

    camera.position.copy(basePos);
    camera.rotation.set(
      pitch + parallaxEased.y * 0.02 * p.parallax,
      yaw - parallaxEased.x * 0.05 * p.parallax,
      0,
      "YXZ",
    );
  }

  const projected = new THREE.Vector3();
  function project(pt: THREE.Vector3): { x: number; y: number; onScreen: boolean; distance: number } {
    projected.copy(pt).project(camera);
    // z > 1 is BEHIND the camera and projects to a mirrored coordinate that
    // looks perfectly plausible — a pin drawn from it lands on the wrong side
    // of the screen rather than nowhere, which is far harder to notice.
    const onScreen =
      projected.z < 1 &&
      projected.x > -1.15 &&
      projected.x < 1.15 &&
      projected.y > -1.15 &&
      projected.y < 1.15;
    return {
      x: (projected.x * 0.5 + 0.5) * width,
      y: (-projected.y * 0.5 + 0.5) * height,
      onScreen,
      distance: camera.position.distanceTo(pt),
    };
  }

  function resize(w: number, h: number): void {
    width = Math.max(1, w);
    height = Math.max(1, h);
    portrait = height >= width;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  return {
    camera,
    update,
    resize,
    project,
    isDragging: () => dragging,
    focus(point: FocusPoint | null): void {
      if (point) {
        focusPoint = point;
        focusMixTarget = 1;
      } else {
        focusMixTarget = 0;
      }
    },
    frame(z: number): void {
      // THE CAMERA DOES NOT LOOK AT ITS OWN FEET. It sits `baseHeight` up at
      // `basePitch`, so the middle of the frame lands this far ahead of it —
      // set the pan to `z` and the point you asked for ends up behind you,
      // which is exactly how the map first opened five islands past the level
      // the player was actually on.
      // The camera sits `baseDistance` BEHIND the pan point and looks
      // `lookAhead` past it, so both terms are needed: the first version
      // carried only the second and opened the map three islands early.
      // BIASED SO THE FRAMED ISLAND SITS BELOW CENTRE, not on it. Dead centre
      // is the obvious reading of "frame this" and it wastes the bottom of the
      // screen: at progress 0 the whole chain is AHEAD of you, so a centred
      // island left 45% of a phone frame as empty water with the route running
      // off the top. Looking further past the target pushes it down the frame
      // and fills the gap with where you are going, which is what the map is
      // for.
      const lookAhead = p.baseHeight / Math.tan(-p.basePitch);
      panTarget = THREE.MathUtils.clamp(
        z + lookAhead - p.baseDistance - p.frameBias,
        zFar,
        zNear,
      );
      panEased = panTarget;
    },
    detach(): void {
      live.abort();
      pointers.clear();
    },
  };
}
