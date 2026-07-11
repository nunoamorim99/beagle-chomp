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
const CAM_FOV = 42;
const CAM_POS = new THREE.Vector3(0, 1.15, 3.2);
const CAM_LOOK = new THREE.Vector3(0, 0.5, 0);

const TURNTABLE_SPEED = 0.18; // rad/s, same feel as the menu showcase

export interface Stage {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Parent for the character group — the turntable rotates THIS. */
  contentRoot: THREE.Group;
  setTurntable(on: boolean): void;
  setGrid(on: boolean): void;
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
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;

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
  orbit.minDistance = 1.2;
  orbit.maxDistance = 12;
  orbit.maxPolarAngle = Math.PI * 0.55; // don't dive below the ground disc
  orbit.update();

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
    orbit.update(); // damping needs a per-frame tick
    frameCb?.(dt, t);
    renderer.render(scene, camera);
  });

  return {
    scene,
    camera,
    contentRoot,
    setTurntable(on: boolean): void {
      turntableOn = on;
    },
    setGrid(on: boolean): void {
      grid.visible = on;
    },
    onFrame(cb: (dt: number, t: number) => void): void {
      frameCb = cb;
    },
    resize,
    dispose(): void {
      renderer.setAnimationLoop(null);
      window.removeEventListener("resize", resize);
      orbit.dispose();
      renderer.dispose();
    },
  };
}
