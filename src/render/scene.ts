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

/**
 * Distance (along `dir`, from `look`) the camera must sit at so every corner
 * of the board's AABB projects within ±NDC_TARGET on both axes, for the given
 * fov/aspect. Refines by scaling `dist` by the worst NDC overshoot each pass
 * (moving the camera back shrinks every projected extent by ~that same
 * ratio for a perspective camera, so this converges in a few passes). Never
 * returns less than `minDist`, so the base (landscape) framing never grows
 * tighter than it is today.
 */
export function computeFitDistance(
  dir: THREE.Vector3,
  look: THREE.Vector3,
  fovDeg: number,
  aspect: number,
  minDist: number,
  corners: THREE.Vector3[] = BOARD_CORNERS,
): number {
  const camera = new THREE.PerspectiveCamera(fovDeg, aspect, 0.1, 200);
  let dist = minDist;

  for (let pass = 0; pass < FIT_PASSES; pass++) {
    camera.position.copy(look).addScaledVector(dir, dist);
    camera.lookAt(look);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();

    let worst = 1; // ratio of |ndc| to NDC_TARGET; >1 means it overshoots
    for (const corner of corners) {
      const ndc = corner.clone().project(camera);
      const rx = Math.abs(ndc.x) / NDC_TARGET;
      const rz = Math.abs(ndc.y) / NDC_TARGET;
      worst = Math.max(worst, rx, rz);
    }
    if (worst <= 1) break;
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

    const dist = computeFitDistance(dir, BASE_LOOK, BASE_FOV, aspect, baseDist);

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
