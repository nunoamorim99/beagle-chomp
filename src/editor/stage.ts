// OWNER: character editor (IDEA-025, dev-only).
// The editor's viewport: a fork of menuScene.ts's showcase rig (same gradient
// backdrop + daylight lighting so characters read exactly as they do in the
// game, same character-scale camera) with the garden decoration swapped for a
// neutral ground disc + optional grid — this is a workbench, not a vignette.
//
// One deliberate difference from menuScene: the turntable rotates a WRAPPER
// group (contentRoot), never the character's own root. The character root's
// rotation stays the user's to edit — turntable yaw and user edits can never
// collide.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { ViewHelper } from "three/examples/jsm/helpers/ViewHelper.js";
import { COLORS } from "../game/config";

const BACKDROP_RADIUS = 80;
const BACKDROP_TOP_COLOR = new THREE.Color(0xcfe9f7);
const BACKDROP_BOTTOM_COLOR = new THREE.Color(COLORS.bg);

// Same gradient-skydome technique as scene.ts/menuScene.ts (each keeps its
// own copy on purpose — see menuScene.ts's note about not breaking exports).
function makeBackdrop(): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      topColor: { value: BACKDROP_TOP_COLOR },
      bottomColor: { value: BACKDROP_BOTTOM_COLOR },
      offset: { value: 6 },
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
  mesh.renderOrder = -1;
  return mesh;
}

// Character-scale camera, identical to menuScene's landscape rig (FOV 42,
// near dog eye-level) — the portrait dolly is dropped; this is a desktop tool.
// IDEA-027: exported so main.ts's board-mode camera framing can restore
// these EXACT defaults (position/target/fov/orbit distance limits) when
// switching back to character mode, instead of re-declaring copies that
// could silently drift from the real ones over time.
export const CAM_FOV = 42;
export const CAM_POS = new THREE.Vector3(0, 1.15, 3.2);
export const CAM_LOOK = new THREE.Vector3(0, 0.5, 0);
export const CAM_MIN_DISTANCE = 1.2;
export const CAM_MAX_DISTANCE = 12;

const TURNTABLE_SPEED = 0.18; // rad/s, same feel as the menu showcase

export interface Stage {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Parent for the character group — the turntable rotates THIS. */
  contentRoot: THREE.Group;
  /** IDEA-027: exposed directly (not wrapped in setters) so board mode
   *  (main.ts) can re-target/re-range the SAME OrbitControls instance for
   *  the much larger 19x21 maze, then restore the character defaults on the
   *  way back — see main.ts's setCharacterCameraFraming/setBoardCameraFraming.
   *  Character-mode code (this file's own resize/turntable, picking.ts) never
   *  needed anything beyond orbit.update() internally, so exposing the whole
   *  instance costs nothing today and avoids stage.ts having to anticipate
   *  every future framing need with bespoke setters. */
  orbit: OrbitControls;
  /** Exposed for the viewport's info readout (renderer.info) — see
   *  viewportExtras.ts. Nothing else should be reaching in here. */
  renderer: THREE.WebGLRenderer;
  setTurntable(on: boolean): void;
  setGrid(on: boolean): void;
  /** The bottom-right orientation cube. Clicking a face flies the camera onto
   *  that axis, around the SAME pivot orbit uses. */
  setViewHelper(on: boolean): void;
  /** True when the most recent pointerup landed on the orientation cube, so
   *  picking.ts can ignore that click instead of also selecting whatever part
   *  happened to be underneath. */
  viewHelperConsumedClick(): boolean;
  /** Frames `object`: centre the orbit pivot on it and pull the camera back
   *  to its bounding radius. Groups with no geometry of their own (the pivot
   *  groups this model is full of) fall back to their world position and a
   *  close-in distance — the three.js editor's EditorControls.focus() rule. */
  focusOn(object: THREE.Object3D): void;
  /** IDEA-027: the neutral ground disc reads wrong under a 19x21 maze floor
   *  (board.ts's own floor plane already covers that job) — board mode hides
   *  it; character mode always wants it back. */
  setGroundVisible(on: boolean): void;
  /** Registers the per-frame callback (idle animation, highlight update). */
  onFrame(cb: (dt: number, t: number) => void): void;
  resize(): void;
  dispose(): void;
}

export function createStage(canvas: HTMLCanvasElement): Stage {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Matches the game's renderer exactly (scene.ts): NO tone mapping, so the
  // cel ramp's three bands land where the gradient texture put them. The
  // editor showing a filmic-graded version of a toon character would be the
  // editor lying about what ships.
  renderer.toneMapping = THREE.NoToneMapping;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.bg);
  scene.add(makeBackdrop());

  const camera = new THREE.PerspectiveCamera(CAM_FOV, 1, 0.1, 200);
  camera.position.copy(CAM_POS);
  camera.lookAt(CAM_LOOK);

  // menuScene's daylight rig, verbatim — the character must read identically
  // here and in the game or edits would be judged under the wrong light.
  scene.add(new THREE.HemisphereLight(0xd8f0ff, 0x4a3a20, 0.65));
  const key = new THREE.DirectionalLight(0xfff4e0, 1.1);
  key.position.set(2.5, 4.5, 3);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 12;
  key.shadow.camera.left = -3;
  key.shadow.camera.right = 3;
  key.shadow.camera.top = 3;
  key.shadow.camera.bottom = -3;
  key.shadow.bias = -0.0005;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xaed4f0, 0.35);
  rim.position.set(-2, 2.5, -2.5);
  scene.add(rim);

  // Neutral ground: a soft grey disc (shadow catcher) + a toggleable grid for
  // judging sizes/positions. Deliberately not the garden patch — decoration
  // competes with the part being edited.
  const ground = new THREE.Mesh(
    new THREE.CylinderGeometry(4.5, 4.5, 0.05, 48),
    new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 1 }),
  );
  ground.position.y = -0.025;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(9, 18, 0x555b63, 0x3c4148);
  grid.position.y = 0.002;
  grid.visible = false;
  scene.add(grid);

  const contentRoot = new THREE.Group();
  scene.add(contentRoot);

  // Free camera orbit: drag rotates around the character, scroll zooms,
  // right-drag pans. Clicks still pick parts — picking.ts ignores any
  // pointerup that moved more than a few pixels, so orbit drags never
  // select. With this, the auto-turntable becomes an optional extra
  // (default OFF — you steer the view yourself now).
  const orbit = new OrbitControls(camera, canvas);
  orbit.target.copy(CAM_LOOK);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.08;
  orbit.minDistance = CAM_MIN_DISTANCE;
  orbit.maxDistance = CAM_MAX_DISTANCE;
  orbit.maxPolarAngle = Math.PI * 0.55; // don't dive below the ground disc
  orbit.update();

  // Orientation cube, bottom-right. NOTE: the parity spec says top-right —
  // that is r185's placement. At r169 ViewHelper hard-codes `x = width - dim,
  // y = 0`, i.e. BOTTOM-right, and the offset is a closure local with no
  // setter, so this is not a knob we can turn without forking the addon.
  // Bottom-right is fine here: the top-left is where the gizmo bar lives.
  const viewHelper = new ViewHelper(camera, canvas);
  // Same pivot as the orbit rig, so clicking a face re-frames the view the
  // user already has rather than swinging around the world origin.
  viewHelper.center = orbit.target;
  let viewHelperOn = true;
  let viewHelperHit = false;

  // Capture phase: this must resolve BEFORE picking.ts's own bubble-phase
  // pointerup handler on the same canvas, so a click on the cube can be
  // marked consumed in time for picking to skip it.
  canvas.addEventListener(
    "pointerup",
    (e) => {
      viewHelperHit = viewHelperOn && viewHelper.handleClick(e);
    },
    true,
  );

  let turntableOn = false;
  let frameCb: ((dt: number, t: number) => void) | null = null;

  function resize(): void {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  resize();

  const clock = new THREE.Clock();
  let t = 0;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    t += dt;
    if (turntableOn) contentRoot.rotation.y += dt * TURNTABLE_SPEED;
    // The cube's fly-to animation drives the camera directly, so it has to
    // run BEFORE orbit.update() re-reads the camera for damping.
    if (viewHelper.animating) viewHelper.update(dt);
    orbit.update(); // damping needs a per-frame tick
    frameCb?.(dt, t);
    renderer.render(scene, camera);
    if (viewHelperOn) {
      // autoClear off for the overlay pass: ViewHelper.render() does its own
      // clearDepth and expects the colour buffer to survive. Leaving autoClear
      // on wipes the frame we just drew and the viewport goes black.
      renderer.autoClear = false;
      viewHelper.render(renderer);
      renderer.autoClear = true;
    }
  });

  function focusOn(object: THREE.Object3D): void {
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    const center = new THREE.Vector3();
    let distance: number;
    if (box.isEmpty()) {
      object.getWorldPosition(center);
      distance = 0.1;
    } else {
      box.getCenter(center);
      distance = box.getBoundingSphere(new THREE.Sphere()).radius;
    }
    // Pull back along the camera's CURRENT view direction, so focusing keeps
    // the angle you were already looking from and only changes the framing.
    const offset = new THREE.Vector3(0, 0, 1)
      .applyQuaternion(camera.quaternion)
      .multiplyScalar(Math.max(distance, 0.05) * 4);
    orbit.target.copy(center);
    camera.position.copy(center).add(offset);
    // orbit.update() clamps the result back inside min/max distance, so a
    // tiny part (a glint, a pupil) can't shove the camera inside the model.
    orbit.update();
  }

  return {
    scene,
    camera,
    contentRoot,
    orbit,
    renderer,
    setTurntable(on: boolean): void {
      turntableOn = on;
    },
    setGrid(on: boolean): void {
      grid.visible = on;
    },
    setViewHelper(on: boolean): void {
      viewHelperOn = on;
      if (!on) viewHelperHit = false;
    },
    viewHelperConsumedClick(): boolean {
      return viewHelperHit;
    },
    focusOn,
    setGroundVisible(on: boolean): void {
      ground.visible = on;
    },
    onFrame(cb: (dt: number, t: number) => void): void {
      frameCb = cb;
    },
    resize,
    dispose(): void {
      renderer.setAnimationLoop(null);
      window.removeEventListener("resize", resize);
      orbit.dispose();
      viewHelper.dispose();
      renderer.dispose();
    },
  };
}
