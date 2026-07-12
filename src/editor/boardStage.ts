// OWNER: board & themes editor (IDEA-027, dev-only).
// Board mode's ATMOSPHERE rig: a backdrop dome + hemisphere/sun/rim lights,
// all driven live by a ThemePalette. This is the editor-stage equivalent of
// scene.ts's atmosphere half (see scene.ts's makeBackdrop/createScene) — we
// cannot import scene.ts's createScene() directly (it owns its own canvas +
// renderer + camera-fit math that belongs to the GAME window, not this tool),
// so this module ports just the visual technique (same gradient-skydome
// shader, same light rig shape: hemisphere + directional key + directional
// rim) and re-parents it under the shared editor Stage's scene (stage.ts) —
// one canvas/renderer for the whole editor, character and board modes alike.
//
// Lives ADDED to stage.scene but toggled invisible (not removed) when the
// user switches back to character mode — cheap to keep around, and
// setVisible(false) is enough to fully hide it (see main.ts's mode switch).
// dispose() is only for a genuine teardown (there isn't one today — the
// editor page has one lifetime — but included for symmetry with the rest of
// this codebase's dispose-what-you-own discipline).
import * as THREE from "three";
import type { ThemePalette } from "../game/themes";

const BACKDROP_RADIUS = 100;

function makeBackdrop(top: THREE.Color, bottom: THREE.Color): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      topColor: { value: top },
      bottomColor: { value: bottom },
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
  mesh.renderOrder = -1;
  mesh.userData.editorOverlay = true; // never selectable/pickable, like highlight.ts's overlays
  return mesh;
}

export interface BoardStage {
  /** Parent for the live board (buildBoard adds walls/floor/pellets/decor
   *  straight into this, exactly like it adds into a game scene). */
  boardRoot: THREE.Group;
  /** Direct handles to the three lights — boardInspector.ts binds its
   *  Atmosphere folder's hemi/sun/rim controls straight to these (the
   *  "mutate directly, no rebuild" live-apply path from the brief), same
   *  spirit as inspector.ts editing the real coat/bodyMat materials. */
  lights: {
    hemi: THREE.HemisphereLight;
    sun: THREE.DirectionalLight;
    rim: THREE.DirectionalLight;
  };
  /** Applies every atmosphere slot of `palette` to the dome + lights, live —
   *  mirrors scene.ts's applySceneTheme, minus the fog/resize concerns (this
   *  stage's camera framing is fixed, not dolly-fit like the game's). Used
   *  for a full base-theme LOAD (every slot at once); per-field edits after
   *  that go through `lights` directly or `setSky` below instead. */
  applyPalette(palette: ThemePalette): void;
  /** bg/backdropTop have no THREE.Light counterpart to bind a GUI control to
   *  directly (they're backdrop-shader uniform colors) — this is their
   *  live-apply path, called from boardInspector.ts's Atmosphere folder. */
  setSky(bg: number, backdropTop: number): void;
  setVisible(on: boolean): void;
  dispose(): void;
}

/** Builds the board-mode atmosphere and adds it to `scene`, seeded from
 *  `initial`. Call `setVisible(false)` immediately if board mode isn't the
 *  active mode yet (main.ts does this right after creation). */
export function createBoardStage(scene: THREE.Scene, initial: ThemePalette): BoardStage {
  const topColor = new THREE.Color(initial.backdropTop);
  const bottomColor = new THREE.Color(initial.bg);
  const backdrop = makeBackdrop(topColor, bottomColor);
  scene.add(backdrop);

  const hemi = new THREE.HemisphereLight(initial.hemiSky, initial.hemiGround, initial.hemiIntensity);
  scene.add(hemi);

  // Same key/rim WORLD positions as scene.ts's game rig, verbatim (angled
  // from above, tuned for this exact ~19x21 tile board — no rescaling
  // needed, since both rigs frame the identical board geometry). The shadow
  // frustum below is likewise copied from scene.ts's key light, sized for
  // the same board.
  const key = new THREE.DirectionalLight(initial.sunColor, initial.sunIntensity);
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

  const rim = new THREE.DirectionalLight(initial.rimColor, initial.rimIntensity);
  rim.position.set(-8, 10, -12);
  scene.add(rim);

  const boardRoot = new THREE.Group();
  scene.add(boardRoot);

  const parts = [backdrop, hemi, key, rim, boardRoot];

  return {
    boardRoot,
    lights: { hemi, sun: key, rim },
    applyPalette(palette: ThemePalette): void {
      topColor.set(palette.backdropTop);
      bottomColor.set(palette.bg);
      hemi.color.set(palette.hemiSky);
      hemi.groundColor.set(palette.hemiGround);
      hemi.intensity = palette.hemiIntensity;
      key.color.set(palette.sunColor);
      key.intensity = palette.sunIntensity;
      rim.color.set(palette.rimColor);
      rim.intensity = palette.rimIntensity;
    },
    setSky(bg: number, backdropTop: number): void {
      bottomColor.set(bg);
      topColor.set(backdropTop);
    },
    setVisible(on: boolean): void {
      for (const p of parts) p.visible = on;
    },
    dispose(): void {
      scene.remove(backdrop, hemi, key, rim, boardRoot);
      backdrop.geometry.dispose();
      (backdrop.material as THREE.Material).dispose();
    },
  };
}
