// OWNER: render-artist (IDEA-023 shop v2)
// The shop page's live 3D hero preview: a dedicated THREE.Scene — separate
// from both the game's own SceneRig (scene.ts) and the main menu's showcase
// (menuScene.ts) — that turntables whichever skin the player is currently
// browsing (a beagle OR one of the four enemy forms) on a small garden patch,
// under the same daytime-garden identity as the rest of the app.
//
// Deliberately NOT a copy-paste of menuScene.ts's exact geometry (this scene
// only ever shows ONE hero at a time, and that hero is swapped repeatedly as
// the player taps cards/tabs — see showBeagle/showEnemy below), but reuses
// its techniques verbatim: the same inward-facing gradient skydome, the same
// daylight rig (hemisphere + warm key + cool rim) so a skin reads with
// IDENTICAL lighting whether previewed here or worn in the menu/maze, and the
// same small soil+turf+hedge vignette so the hero always stands on "the same
// world" rather than a blank studio backdrop.
//
// Contract: createShopScene() -> { scene, camera, update(dt), resize(aspect),
// showBeagle(skin), showEnemy(skinId), dispose() } — created ONCE by game.ts
// alongside menuScene and reused for every shop visit; never rebuilt. Swapping
// the hero disposes the OUTGOING mesh's geometries/materials (a shopping
// session can swap the hero dozens of times as the player browses tabs/cards,
// so leaking one THREE.Group per tap would add up fast) and resets the
// turntable angle so every new hero starts front-on.
import * as THREE from "three";
import { COLORS } from "../game/config";
import { type BeagleSkin } from "../game/cosmetics";
import { makeBeagle, makeEnemy, applyBeagleSkin, type BeagleParts } from "./characters";

// Same cheap inward-facing skydome technique as menuScene.ts's own
// makeBackdrop (itself a copy of scene.ts's) — kept as a third small copy
// here rather than an export from either, matching menuScene.ts's own
// precedent ("don't break scene.ts's exports") and keeping this module
// self-contained. Same top/bottom colors so the sky reads identically.
const BACKDROP_RADIUS = 80;
const BACKDROP_TOP_COLOR = new THREE.Color(0xcfe9f7);
const BACKDROP_BOTTOM_COLOR = new THREE.Color(COLORS.bg);

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

// Garden-patch decoration: a smaller/simpler staging than menuScene's own
// vignette (per the task brief — "the hero is the model"), just a soil disc
// with a turf rim and a single low hedge pair flanking the back, enough to
// ground the hero in the same world without competing with it for attention
// on a compact shop-page hero region.
const PATCH_RADIUS = 1.0;
const HEDGE_COLOR = COLORS.wall;
const GRASS_RIM_COLOR = COLORS.wall;
const BLOOM_COLOR = 0xf2d43a;

function makeGardenPatch(): THREE.Group {
  const g = new THREE.Group();

  const soilMat = new THREE.MeshStandardMaterial({
    color: COLORS.floor,
    roughness: 1,
    emissive: 0x2a1a0c,
    emissiveIntensity: 0.3,
  });
  const soil = new THREE.Mesh(new THREE.CylinderGeometry(PATCH_RADIUS, PATCH_RADIUS * 0.96, 0.07, 40), soilMat);
  soil.position.y = -0.035;
  soil.receiveShadow = true;
  g.add(soil);

  const grassMat = new THREE.MeshStandardMaterial({
    color: GRASS_RIM_COLOR,
    roughness: 0.6,
    emissive: COLORS.wallEmissive,
    emissiveIntensity: 0.2,
  });
  const grassRim = new THREE.Mesh(new THREE.TorusGeometry(PATCH_RADIUS * 0.97, 0.055, 8, 40), grassMat);
  grassRim.rotation.x = Math.PI / 2;
  grassRim.receiveShadow = true;
  g.add(grassRim);

  // A single low hedge pair behind the hero, each topped with one bloom —
  // the game's own signature detail (board.ts's buildHedgeDecor) in
  // miniature, just enough to say "garden" without a full arc.
  const hedgeMat = new THREE.MeshStandardMaterial({
    color: HEDGE_COLOR,
    roughness: 0.5,
    metalness: 0.1,
    emissive: COLORS.wallEmissive,
    emissiveIntensity: 0.2,
  });
  const hedgeGeo = new THREE.BoxGeometry(0.42, 0.26, 0.28);
  const bloomGeo = new THREE.SphereGeometry(0.05, 8, 8);
  const bloomMat = new THREE.MeshStandardMaterial({
    color: BLOOM_COLOR,
    roughness: 0.5,
    emissive: BLOOM_COLOR,
    emissiveIntensity: 0.25,
  });
  ([-1, 1] as const).forEach((s) => {
    const hedge = new THREE.Mesh(hedgeGeo, hedgeMat);
    hedge.position.set(s * PATCH_RADIUS * 0.62, 0.13, -PATCH_RADIUS * 0.62);
    hedge.rotation.y = s * 0.35;
    hedge.castShadow = true;
    hedge.receiveShadow = true;
    g.add(hedge);

    const bloom = new THREE.Mesh(bloomGeo, bloomMat);
    bloom.position.set(0, 0.18, 0);
    bloom.castShadow = true;
    hedge.add(bloom);
  });

  return g;
}

// Camera framing: ONE rig tuned to flatter both hero shapes — the beagle
// (long, low, z-elongated ~0.5..0.75 nose-to-tail-tip pre-scale, scale 0.9)
// and the round enemies (~0.6-0.7 diameter, y 0..~0.5). Lower toward
// eye-level (mirrors menuScene's own "dog on a mud island" fix) with only a
// slight downward tilt so both a long low body and a round bug both read
// dimensionally instead of looking flattened from a steep top-down angle,
// and pulled back a bit further than menuScene's own dog-only rig (BASE_DIST
// 3.2) so the beagle's full nose-to-tail length always clears the frame.
const CAM_FOV = 40;
const CAM_POS = new THREE.Vector3(0, 1.05, 3.6);
const CAM_LOOK = new THREE.Vector3(0, 0.45, 0);

// Portrait dolly-back — identical technique to menuScene.ts's own (dolly the
// camera back along its own look-ray as aspect narrows below 1), so the hero
// keeps comfortable margins on a phone-width hero region instead of blowing
// up edge-to-edge. Ramp shape/reference aspect match menuScene's exactly;
// only the distances differ (this rig's BASE_DIST is already further back).
const PORTRAIT_ASPECT_REF = 0.46;
const PORTRAIT_DIST = 5.6;
const BASE_DIST = CAM_POS.distanceTo(CAM_LOOK);
const CAM_DIR = CAM_POS.clone().sub(CAM_LOOK).normalize();

// Idle life tuning — same spirit as menuScene's TURNTABLE_SPEED: a slow,
// continuous showcase spin so the player can see the whole skin without
// touching anything.
const TURNTABLE_SPEED = 0.22;

/** Kind of hero currently staged, so update()/resize() can special-case
 *  nothing (both kinds share one camera rig) but showBeagle/showEnemy can
 *  tell whether a rebuild is even needed. */
type HeroKind = "beagle" | "enemy";

export interface ShopScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Advances the turntable + (for a beagle hero) its own idle sub-part animation for one frame. */
  update(dt: number): void;
  /** Updates the camera aspect (call from the resize path — no maze-fit math needed). */
  resize(aspect: number): void;
  /** Swaps the hero to a beagle wearing `skin`. Disposes the previous hero's
   *  geometries/materials and resets the turntable angle. No-op rebuild if
   *  the current hero is already this exact beagle skin (still fine to call
   *  every time — see the doc comment below). */
  showBeagle(skin: BeagleSkin): void;
  /** Swaps the hero to the enemy form for `skinId` (ghost/beetle/bee/ladybug),
   *  in the canonical preview color. Disposes the previous hero and resets
   *  the turntable angle. */
  showEnemy(skinId: string): void;
  /** Releases the current hero's + patch's geometries/materials. Only
   *  meaningful if the whole game is being torn down — the shop scene is
   *  otherwise created once and kept alive for the app's lifetime. */
  dispose(): void;
}

// The team color used for every enemy preview (per the task brief: rose, the
// chaser) — the shop shows FORM, not team-color assignment, so one fixed
// color across all four enemy skins keeps the comparison apples-to-apples.
const ENEMY_PREVIEW_COLOR = 0xe0577a;

/**
 * Builds the shop's dedicated scene, camera, and garden patch, staged with an
 * initial beagle hero (the default skin — showBeagle/showEnemy are called by
 * the caller immediately on open() to show whatever's actually equipped, so
 * this initial mesh is never visibly seen, but the scene must never be
 * heroless). Call once (from Game's constructor) and reuse via update()/
 * resize()/showBeagle()/showEnemy() on every subsequent shop visit — never
 * rebuild.
 */
export function createShopScene(): ShopScene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.bg);
  scene.add(makeBackdrop());

  const camera = new THREE.PerspectiveCamera(CAM_FOV, 1, 0.1, 200);
  camera.position.copy(CAM_POS);
  camera.lookAt(CAM_LOOK);

  // Mirrors menuScene.ts's (and, in turn, scene.ts's) daylight rig exactly so
  // a skin reads with identical lighting in every showcase.
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

  scene.add(makeGardenPatch());

  let heroKind: HeroKind = "beagle";
  let hero: THREE.Group = makeBeagle();
  scene.add(hero);

  let idleT = 0;
  let turntableAngle = 0;

  /** Disposes `hero`'s geometries/materials and removes it from the scene —
   *  the shared teardown step for both a hero SWAP (called right before the
   *  replacement is added) and final dispose() below. */
  function disposeHero(obj: THREE.Group): void {
    scene.remove(obj);
    obj.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const mat = o.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat.dispose();
      }
    });
  }

  /** Shared by showBeagle/showEnemy: swaps `hero` to `next`, disposing the
   *  outgoing mesh and resetting the turntable so every new hero starts
   *  front-on rather than continuing mid-spin from wherever the last one
   *  stopped. */
  function setHero(next: THREE.Group, kind: HeroKind): void {
    disposeHero(hero);
    hero = next;
    heroKind = kind;
    scene.add(hero);
    turntableAngle = 0;
    hero.rotation.y = 0;
  }

  // Same local idle-animation approach as menuScene.ts's animateIdle: the
  // showcase hero has no real game Entity/facing to sync via syncToEntity, so
  // drive the turntable directly here, plus (for a beagle hero only — enemies
  // have no `parts`) the same tail-wag/ear-sway/breathing formulas
  // characters.ts's animateBeagleParts already implements for the idle case.
  function animateIdle(dt: number): void {
    idleT += dt;
    turntableAngle += dt * TURNTABLE_SPEED;
    hero.rotation.y = turntableAngle;

    if (heroKind !== "beagle") return;
    const parts = hero.userData.parts as BeagleParts | undefined;
    if (!parts) return;

    const tailWag = Math.sin(idleT * 1.8) * 0.4;
    const earSwayL = Math.sin(idleT * 0.9) * 0.08 + Math.sin(idleT * 0.31 * Math.PI * 2) * 0.05;
    const earSwayR = Math.sin(idleT * 0.9 + 1.1) * 0.08 + Math.sin(idleT * 0.31 * Math.PI * 2 + 1.1) * 0.05;
    parts.tail.rotation.y = tailWag;
    parts.earL.rotation.x = earSwayL;
    parts.earR.rotation.x = earSwayR;

    const breathe = Math.sin(idleT * 1.4 * Math.PI * 2) * 0.015;
    hero.scale.y = hero.scale.x * (1 + breathe);
  }

  return {
    scene,
    camera,
    update(dt: number): void {
      animateIdle(dt);
    },
    resize(aspect: number): void {
      camera.aspect = aspect;

      const t = aspect >= 1 ? 0 : Math.min(1, (1 - aspect) / (1 - PORTRAIT_ASPECT_REF));
      const dist = BASE_DIST + (PORTRAIT_DIST - BASE_DIST) * t;
      camera.position.copy(CAM_LOOK).addScaledVector(CAM_DIR, dist);
      camera.lookAt(CAM_LOOK);

      camera.updateProjectionMatrix();
    },
    showBeagle(skin: BeagleSkin): void {
      // Build fresh rather than recolor-in-place: unlike menuScene's single
      // long-lived showcase beagle (which stays a beagle forever, so
      // applyBeagleSkin is the right live-recolor tool), this hero can BECOME
      // an enemy and back again as the player switches tabs, so every call
      // here is a full swap — a plain applyBeagleSkin would only be correct
      // when the hero is already a beagle, and silently do nothing useful
      // when it's currently an enemy shape.
      const next = makeBeagle(skin);
      applyBeagleSkin(next, skin); // belt-and-suspenders: makeBeagle(skin) already bakes the coat in, but keeps this path obviously correct even if that ever changes
      setHero(next, "beagle");
    },
    showEnemy(skinId: string): void {
      const next = makeEnemy(skinId, ENEMY_PREVIEW_COLOR);
      setHero(next, "enemy");
    },
    dispose(): void {
      disposeHero(hero);
    },
  };
}
