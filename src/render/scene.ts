// OWNER: render-artist
// Sets up renderer, camera (angled top-down framing the whole maze), and lights.
// Reference implementation: /prototype/beagle-chomp.html (section 2).
// Contract: export a function that returns { renderer, scene, camera, resize() }.
import * as THREE from "three";
import { COLORS } from "../game/config";
import { COLS, ROWS, TILE } from "../game/grid";
import { WALL_H } from "./board";

// Half-extents of the maze in world units, plus a little breathing room so
// walls at the border never touch the viewport edge.
const HALF_W = (COLS * TILE) / 2 + 1;
const HALF_H = (ROWS * TILE) / 2 + 1;

// Base camera rig, lifted straight from the prototype (section 2): a fixed
// angled look tuned for a landscape viewport. Portrait/narrow viewports need
// the camera pulled back along the same ray so the maze still fits width-wise
// (see resize() below) — this is the "coordinate with pwa-mobile-engineer" fit.
const BASE_FOV = 46;
const BASE_POS = new THREE.Vector3(0, 27, 15.5);
const BASE_LOOK = new THREE.Vector3(0, 0, -0.5);

// The 8 extreme corners of the board's AABB: the maze floor sits at y=0 and
// walls stand WALL_H tall, so the true bounding box is these two z-extents
// (± HALF_W/HALF_H) at both y=0 and y=WALL_H. Because the camera looks down
// at a steep angle, the near corners (world +Z, closest to the camera) blow
// up in the projection far more than a flat card at BASE_LOOK would suggest
// — hence fitting by actual projection instead of a half-fov/half-extent
// approximation.
function boardCorners(): THREE.Vector3[] {
  const corners: THREE.Vector3[] = [];
  for (const x of [-HALF_W, HALF_W]) {
    for (const z of [-HALF_H, HALF_H]) {
      for (const y of [0, WALL_H]) {
        corners.push(new THREE.Vector3(x, y, z));
      }
    }
  }
  return corners;
}
const BOARD_CORNERS = boardCorners();

// Target NDC bound each corner must land within (a hair inside ±1 so nothing
// touches the viewport edge), and the max refinement passes. 0.97 is chosen
// deliberately just above ~0.962 — the vertical NDC extent the *base* rig
// itself already reaches at baseDist (the near floor corner sits close to
// the bottom edge even in landscape) — so plain landscape reproduces
// baseDist exactly (worst ratio <= 1 on pass 0) rather than triggering a
// needless dolly from floating-point-level overshoot.
const NDC_TARGET = 0.97;
const FIT_PASSES = 4;

// IDEA-022 (portrait close-in): reference aspect and max NDC targets used by
// resize() to relax the fit on tall/narrow viewports.
//
// Follow-up finding: the board is roughly square (COLS ~ ROWS), so on a
// portrait viewport the HORIZONTAL fit — not the vertical one — is what
// pins the dolly distance. Relaxing only the vertical target (the original
// v1 of this fix) was a no-op for this board shape: the width constraint
// still forced the same distance back. So both axes relax in portrait:
//
// - PORTRAIT_NDC_X_MAX allows the maze's own left/right edges to reach
//   almost to the screen edge (values a little over 1.0 mean the AABB
//   corners — placed with +1 world-unit of margin beyond the outermost
//   wall/tunnel tile, see HALF_W/HALF_H above — are allowed to sit just
//   past the frame edge, while the actual tunnel tiles stay a hair inside
//   it). 1.05 was chosen conservatively: the AABB margin (1 world unit
//   against a ~21-unit half-width) is roughly 5%, so 1.05 lets that margin
//   crop while the true playable width still lands at/just inside the
//   frame — never past it. This is the "fills the frame width" lever the
//   coordinator asked for.
// - PORTRAIT_NDC_Y_MAX must stay >= PORTRAIT_NDC_X_MAX: the steep top-down
//   angle pushes the near (bottom) floor corner toward the bottom edge
//   faster than the horizontal corners approach the side edges, so if Y
//   were allowed to relax less than X, the near-bottom corner would clip
//   before the width-driven dolly ever eases off. Setting it visibly higher
//   (1.30, top of the requested 1.15-1.30 band) keeps that corner safely
//   on screen with margin to spare while X does the real work of pulling
//   the camera in.
//
// A typical phone in portrait sits around 9:19.5 ~ 0.46; both ramps hit
// their max there and hold flat beyond it so very extreme aspects don't
// keep cropping indefinitely.
const PORTRAIT_ASPECT_REF = 0.46;
const PORTRAIT_NDC_X_MAX = 1.05;
const PORTRAIT_NDC_Y_MAX = 1.3;

/**
 * Distance (along `dir`, from `look`) the camera must sit at so every corner
 * of the board's AABB projects within ±ndcTargetX on the horizontal axis and
 * ±ndcTargetY on the vertical axis, for the given fov/aspect. Refines by
 * scaling `dist` by the worst NDC overshoot each pass (moving the camera back
 * shrinks every projected extent by ~that same ratio for a perspective
 * camera, so this converges in a few passes). Never returns less than
 * `minDist`, so the base (landscape) framing never grows tighter than it is
 * today.
 *
 * `ndcTargetX`/`ndcTargetY` default to NDC_TARGET for both axes, reproducing
 * the original single-target behavior byte-for-byte when omitted — this is
 * the landscape/desktop path and callers relying on the old signature are
 * unaffected. IDEA-022 (portrait close-in) passes a larger `ndcTargetY` (see
 * resize() below) so the vertical extent is allowed to crop toward/past the
 * frame edge while the horizontal fit stays strict, letting the camera dolly
 * in closer on tall/narrow viewports without ever losing maze width.
 */
export function computeFitDistance(
  dir: THREE.Vector3,
  look: THREE.Vector3,
  fovDeg: number,
  aspect: number,
  minDist: number,
  corners: THREE.Vector3[] = BOARD_CORNERS,
  ndcTargetX: number = NDC_TARGET,
  ndcTargetY: number = NDC_TARGET,
): number {
  const camera = new THREE.PerspectiveCamera(fovDeg, aspect, 0.1, 200);
  let dist = minDist;

  for (let pass = 0; pass < FIT_PASSES; pass++) {
    camera.position.copy(look).addScaledVector(dir, dist);
    camera.lookAt(look);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();

    let worst = 1; // ratio of |ndc| to its target; >1 means it overshoots
    for (const corner of corners) {
      const ndc = corner.clone().project(camera);
      const rx = Math.abs(ndc.x) / ndcTargetX;
      const rz = Math.abs(ndc.y) / ndcTargetY;
      worst = Math.max(worst, rx, rz);
    }
    if (worst <= 1) break;
    dist = Math.max(minDist, dist * worst);
  }
  return dist;
}

// IDEA-022 (portrait close-in): computeFitDistance's single-scale-per-pass
// refinement is a good approximation when the first-pass overshoot is close
// to 1 (true for every real landscape aspect — see below), but a large first
// overshoot (which only happens now that portrait's relaxed NDC targets
// briefly put the un-dollied base rig ~2x past target on pass 0) makes the
// "scale by worst ratio" step conservative: the *worst* ratio it uses is
// floored at 1 (`let worst = 1`), so once a pass lands under target it stops
// immediately rather than pulling distance back down toward the true
// boundary, leaving the camera farther out than it needs to be. Tightening
// this matters for portrait (where we specifically want the camera as close
// as the NDC targets allow) but must never touch landscape's byte-for-byte
// framing — so this bidirectional refinement only ever runs from the
// portrait branch in resize() below, as a small extra pass layered on top of
// computeFitDistance's result, never by changing computeFitDistance itself
// (real landscape aspects already satisfy the target on pass 0 today, so
// there is nothing for this to tighten there anyway — see check-fit trace in
// the IDEA-022 follow-up notes — but gating it explicitly keeps the
// guarantee airtight rather than relying on that being true forever).
const TIGHTEN_PASSES = 6;

function tightenFitDistance(
  dir: THREE.Vector3,
  look: THREE.Vector3,
  fovDeg: number,
  aspect: number,
  minDist: number,
  startDist: number,
  corners: THREE.Vector3[],
  ndcTargetX: number,
  ndcTargetY: number,
): number {
  const camera = new THREE.PerspectiveCamera(fovDeg, aspect, 0.1, 200);
  let dist = startDist;
  for (let pass = 0; pass < TIGHTEN_PASSES; pass++) {
    camera.position.copy(look).addScaledVector(dir, dist);
    camera.lookAt(look);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();

    let worst = 0; // unfloored: <1 means we overshot and can pull dist back in
    for (const corner of corners) {
      const ndc = corner.clone().project(camera);
      worst = Math.max(worst, Math.abs(ndc.x) / ndcTargetX, Math.abs(ndc.y) / ndcTargetY);
    }
    dist = Math.max(minDist, dist * worst);
  }
  return dist;
}

export interface SceneRig {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  resize(): void;
}

// ---------------------------------------------------------------------------
// Atmosphere backdrop: a large inward-facing "skydome" sphere behind the
// maze, shaded with a cheap vertical-gradient ShaderMaterial. Three-only, no
// textures, one draw call, no post-processing pipeline.
//
// Kept deliberately near-invisible for a CLEAN look: the gradient's bottom is
// the same near-black as the scene background, and from the game's steep
// top-down camera the visible part of the dome (behind/around the maze) is
// that low, near-black band — so the surround reads as clean dark and the
// maze stays crisp against it. (An earlier pass turned this into a visible
// view-space indigo glow; it was reverted here because the crisp look reads
// better on a top-down board.)
//
// Sized far outside both the maximum plausible camera dolly distance and the
// fog far-plane so it can never be clipped into or dollied past at any
// aspect ratio — it fully encloses the board, camera included, at all times.
// (computeFitDistance's dolly grows as aspect narrows; even a pathologically
// tall/narrow viewport — aspect 0.25, well past any real phone — only
// reaches ~131 units, so 260 leaves it comfortably enclosed with the whole
// far side of the sphere still inside CAMERA_FAR below.) Rendered BackSide
// (we're always inside it), depthWrite disabled so it never fights the
// floor/walls in the depth buffer, and excluded from scene.fog.
const BACKDROP_RADIUS = 260;
// Camera far-clip: independent of the fit math (which only concerns FOV/
// position/aspect via computeFitDistance) — this is just the render-distance
// cutoff, widened from the prototype's 200 so BACKDROP_RADIUS's far side
// never clips even at the dolly distances above.
const CAMERA_FAR = 420;
// Vertical-gradient backdrop colors: the bottom matches the scene background
// (COLORS.bg, a soft daytime sky blue), and the top is a paler, brighter blue
// so the dome reads as an open daytime sky rather than a night dome. The top
// only shows if you look up, which the fixed camera never does — so this is
// still mostly a "hint of depth" above the crisp board, just tuned for day.
const BACKDROP_TOP_COLOR = new THREE.Color(0xcfe9f7);
const BACKDROP_BOTTOM_COLOR = new THREE.Color(COLORS.bg);

function makeBackdrop(): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      topColor: { value: BACKDROP_TOP_COLOR },
      bottomColor: { value: BACKDROP_BOTTOM_COLOR },
      offset: { value: 15 },
      exponent: { value: 0.55 },
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform float offset;
      uniform float exponent;
      varying vec3 vWorldPosition;
      void main() {
        float h = clamp((vWorldPosition.y + offset) / (2.0 * offset), 0.0, 1.0);
        gl_FragColor = vec4(mix(bottomColor, topColor, pow(h, exponent)), 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(BACKDROP_RADIUS, 24, 16), material);
  // Render first, right after the (otherwise unused-for-BackSide) background
  // clear, so it never has to win a depth fight it isn't part of.
  mesh.renderOrder = -1;
  return mesh;
}

export function createScene(canvas: HTMLCanvasElement): SceneRig {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  // IDEA-008 (daytime garden): nudged down a hair from 0.98 now that the
  // hemisphere/key intensities were lifted for the brighter daylight palette
  // — keeps the sunlit board from blowing out highlights on walls/floor.
  renderer.toneMappingExposure = 0.92;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.bg);
  scene.add(makeBackdrop());
  // Fog fades toward COLORS.bg (the scene background) and its range only
  // catches the very farthest maze corners, so on the game's top-down board
  // the maze reads crisp against clean dark with no visible haze — the
  // intentional "clean" look. (An earlier pass tinted the fog a distinct
  // indigo and pulled the range in to melt the far edge into a glow; that was
  // reverted here in favour of the crisp look.) resize() scales near/far by
  // the dolly so portrait doesn't behave differently.
  const FOG_COLOR = COLORS.bg;
  const FOG_NEAR_BASE = 30;
  const FOG_FAR_BASE = 55;
  scene.fog = new THREE.Fog(FOG_COLOR, FOG_NEAR_BASE, FOG_FAR_BASE);

  const camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.1, CAMERA_FAR);
  camera.position.copy(BASE_POS);
  camera.lookAt(BASE_LOOK);

  // IDEA-008 (daytime garden): hemisphere pushed to a bright daylight
  // sky/white above and a warm earthy-green ground bounce below (was a cool
  // lavender/indigo pair tuned for a neon-night board); intensity lifted a
  // touch since we lost the dark backdrop to soak up ambient light.
  scene.add(new THREE.HemisphereLight(0xd8f0ff, 0x4a3a20, 0.65));
  // Key: shifted from a candle-warm amber to a neutral, slightly-warm
  // sunlight tone, and lifted a touch for a bright daytime read.
  const key = new THREE.DirectionalLight(0xfff4e0, 1.1);
  key.position.set(6, 20, 10);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 60;
  key.shadow.camera.left = -14;
  key.shadow.camera.right = 14;
  key.shadow.camera.top = 16;
  key.shadow.camera.bottom = -16;
  key.shadow.bias = -0.0005;
  scene.add(key);

  // Rim/fill from the opposite side and lower angle, shifted from a cool
  // indigo to a soft sky-blue so it reads as ambient daylight bounce rather
  // than a night-time cool rim: no shadow casting (a second shadow-casting
  // light would double the shadow-map cost for a subtle effect), just enough
  // to lift the walls' far faces off pure black so they stay dimensional.
  const rim = new THREE.DirectionalLight(0xaed4f0, 0.35);
  rim.position.set(-8, 10, -12);
  scene.add(rim);

  // Direction from the look target to the camera, and the camera's distance
  // in that base rig — used to dolly the camera back along the same ray to
  // keep the whole maze in frame on narrow (portrait) viewports.
  const dir = BASE_POS.clone().sub(BASE_LOOK).normalize();
  const baseDist = BASE_POS.clone().sub(BASE_LOOK).length();

  function resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    // updateStyle defaults to true here (deliberately, no `false` arg): three.js
    // must write canvas.style.width/height = `${w}px`/`${h}px` so the element's
    // CSS/displayed size matches the logical viewport. The drawing buffer still
    // gets scaled by the renderer's pixelRatio (set in createScene) for
    // sharpness, but only the buffer — leaving the CSS size at its default
    // (== buffer size) blows the on-screen canvas up to viewport*pixelRatio on
    // any dpr>1 device (all phones), so only the top-left portion of the
    // rendered frame is visible on screen.
    renderer.setSize(w, h);
    const aspect = w / h;
    camera.aspect = aspect;

    // IDEA-022 (portrait close-in): on a tall/narrow viewport (aspect < 1)
    // the board is close to square, so it's the maze's WIDTH — not its
    // height — that pins the dolly-back distance (computeFitDistance scales
    // dist to keep every corner within the NDC target on whichever axis
    // overshoots worst). Relaxing only the vertical target is therefore a
    // no-op: width never stopped being the binding constraint. So both axes
    // ramp open on portrait, linearly from NDC_TARGET (0.97) at aspect 1.0
    // (reproducing today's exact landscape framing) up to their own max at
    // PORTRAIT_ASPECT_REF (~a typical phone, 9:19.5 ≈ 0.46), holding flat at
    // that max beyond it so very extreme aspects don't keep cropping
    // indefinitely:
    //   - ndcTargetX ramps to PORTRAIT_NDC_X_MAX — this is the real lever:
    //     it lets the camera dolly in until the maze's own width fills
    //     nearly the whole frame, only cropping the small AABB margin
    //     (HALF_W/HALF_H's "+1 world unit" breathing room) rather than any
    //     actual tunnel column.
    //   - ndcTargetY ramps to PORTRAIT_NDC_Y_MAX, kept >= the X max so the
    //     near-bottom floor corner (which the steep top-down angle pushes
    //     toward the bottom edge fastest) never clips before the
    //     width-driven dolly eases off.
    const portraitT = aspect >= 1 ? 0 : Math.min(1, (1 - aspect) / (1 - PORTRAIT_ASPECT_REF));
    const ndcTargetX = NDC_TARGET + (PORTRAIT_NDC_X_MAX - NDC_TARGET) * portraitT;
    const ndcTargetY = NDC_TARGET + (PORTRAIT_NDC_Y_MAX - NDC_TARGET) * portraitT;

    let dist = computeFitDistance(
      dir,
      BASE_LOOK,
      BASE_FOV,
      aspect,
      baseDist,
      BOARD_CORNERS,
      ndcTargetX,
      ndcTargetY,
    );

    // IDEA-022 (portrait close-in), continued: computeFitDistance's own
    // early-break loop leaves real slack on portrait (a large first-pass
    // overshoot means its floored "worst" never signals that dist can come
    // back down). Tighten it here, portrait only, so the camera actually
    // lands at the NDC-target boundary instead of noticeably short of it —
    // this is where the visible "zoom in" comes from. Landscape (aspect >=
    // 1) skips this entirely, so its framing is untouched byte-for-byte.
    if (aspect < 1) {
      dist = tightenFitDistance(
        dir,
        BASE_LOOK,
        BASE_FOV,
        aspect,
        baseDist,
        dist,
        BOARD_CORNERS,
        ndcTargetX,
        ndcTargetY,
      );
    }

    camera.position.copy(BASE_LOOK).addScaledVector(dir, dist);
    camera.lookAt(BASE_LOOK);
    camera.updateProjectionMatrix();

    // Scale fog with the dolly so the far edge behaves the same at every
    // aspect (dist === baseDist reproduces the base look exactly). Uses the
    // same FOG_COLOR/near/far as the constructor so the two never drift.
    const fogScale = dist / baseDist;
    scene.fog = new THREE.Fog(FOG_COLOR, FOG_NEAR_BASE * fogScale, FOG_FAR_BASE * fogScale);
  }

  window.addEventListener("resize", resize);
  resize();

  return { renderer, scene, camera, resize };
}
