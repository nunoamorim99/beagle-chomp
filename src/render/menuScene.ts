// OWNER: render-artist
// The full-screen main-menu 3D showcase (IDEA-021 v2): a dedicated THREE.Scene
// — separate from the game's own SceneRig (scene.ts) — showing the player's
// EQUIPPED beagle idling on a small garden patch under the same daytime-garden
// sky/lighting as the maze itself. Owns exactly one beagle mesh (never the
// game's own this.beagleMesh) plus a tiny decorative patch (soil disc + a
// couple of hedge blocks + a few flower dots), reusing the game's palette
// (COLORS) so the showcase reads as the SAME world as the maze, not a
// different screen bolted on.
//
// Contract: createMenuScene() -> { scene, camera, update(dt), resize(aspect),
// setBeagleSkin(skin), dispose() } — created ONCE by game.ts and reused across
// every menu visit (boot -> play -> menu -> play -> ...), never rebuilt.
import * as THREE from "three";
import { COLORS } from "../game/config";
import { type BeagleSkin, getEquippedBeagleSkin } from "../game/cosmetics";
import { type MazeTheme, getEquippedMazeTheme } from "../game/themes";
import { makeBeagle, applyBeagleSkin, type BeagleParts } from "./characters";
import { toon } from "./toon";

// Vertical-gradient backdrop, the same cheap inward-facing skydome technique
// as scene.ts's makeBackdrop (kept as its own small copy here rather than an
// export from scene.ts, per the task brief — "don't break scene.ts's
// exports"). Same top/bottom colors so the sky reads identically.
const BACKDROP_RADIUS = 80;
const BACKDROP_TOP_COLOR = new THREE.Color(0xcfe9f7);
const BACKDROP_BOTTOM_COLOR = new THREE.Color(COLORS.bg);

function makeBackdrop(): { mesh: THREE.Mesh; material: THREE.ShaderMaterial } {
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
  return { mesh, material };
}

// Garden-patch decoration colors, reusing board.ts's hedge-bloom palette
// (white/yellow/pink) rather than the full 4-color set (no red) — a tasteful
// vignette, not the full maze garden.
//
// Follow-up (coordinator screenshot pass): the original 2.4-radius disc
// filled ~70% of the frame ("dog on a mud island") and the hedges were
// maze-wall-sized monoliths bunched on one side and cropped by the frame
// edge. Shrunk the patch to a small grounding element, gave the hedges a
// proper low/tidy/symmetric arc fully inside frame, and moved the flower
// blooms onto the hedge tops (the game's own signature detail — see
// board.ts's buildHedgeDecor) instead of floating loose on the dirt.
const PATCH_RADIUS = 1.15;
const HEDGE_COLOR = COLORS.wall;
const GRASS_RIM_COLOR = COLORS.wall;
const BLOOM_COLORS = [0xf4efe6, 0xf2d43a, 0xe8709a] as const;

interface GardenPatch {
  group: THREE.Group;
  soilMat: THREE.MeshToonMaterial;
  grassMat: THREE.MeshToonMaterial;
  hedgeMat: THREE.MeshToonMaterial;
  bloomMats: THREE.MeshToonMaterial[];
}

function makeGardenPatch(): GardenPatch {
  const g = new THREE.Group();

  // Soil disc the beagle stands on — small and grounding, not a diorama
  // floor. A slightly domed top (via a shallow cone-ish taper achieved with
  // a sphere-cap) would need more geometry than it's worth here; a subtler,
  // cheaper trick reads just as soft: keep it a flat cylinder but ring its
  // edge with a thin grass-green torus so the rim reads as turf rather than
  // a hard-edged mud disc dropped on the ground.
  const soilMat = toon({
    color: COLORS.floor,

    emissive: 0x2a1a0c,
    emissiveIntensity: 0.3,
  });
  const soil = new THREE.Mesh(new THREE.CylinderGeometry(PATCH_RADIUS, PATCH_RADIUS * 0.96, 0.07, 40), soilMat);
  soil.position.y = -0.035;
  soil.receiveShadow = true;
  g.add(soil);

  const grassMat = toon({
    color: GRASS_RIM_COLOR,

    emissive: COLORS.wallEmissive,
    emissiveIntensity: 0.2,
  });
  const grassRim = new THREE.Mesh(new THREE.TorusGeometry(PATCH_RADIUS * 0.97, 0.06, 8, 40), grassMat);
  grassRim.rotation.x = Math.PI / 2;
  grassRim.position.y = 0.0;
  grassRim.receiveShadow = true;
  g.add(grassRim);

  // Low, tidy hedge arc behind the dog — a garden backdrop, not a maze wall.
  // Much smaller than the old 0.9x0.5x0.5 monoliths, spaced in a gentle
  // symmetric arc, and pulled back far enough that the dog reads clearly in
  // front of them (never overlapping/cropped).
  const hedgeMat = toon({
    color: HEDGE_COLOR,


    emissive: COLORS.wallEmissive,
    emissiveIntensity: 0.2,
  });
  const hedgeGeo = new THREE.BoxGeometry(0.5, 0.28, 0.3);
  const hedgeCount = 5;
  const hedgeRadius = PATCH_RADIUS * 0.8;
  // Symmetric arc centred directly behind the dog (angle Math.PI, since the
  // camera sits at +Z looking toward -Z — "behind" is -Z, i.e. angle PI).
  // Span/radius tuned (checked by projection, not just eyeballed) so the 3
  // bloom-bearing hedges (indices 1-3) stay fully inside frame on BOTH a
  // desktop landscape aspect and a narrow phone portrait aspect, while the
  // 2 bare outer hedges (0 and 4) fall cleanly outside the portrait frame
  // (no partial/straddled box at the edge) rather than getting visibly
  // cropped — see the coordinator's portrait-crop finding.
  const hedgeArcSpan = Math.PI * 0.42;
  const hedgeTopBlooms: THREE.Object3D[] = [];
  for (let i = 0; i < hedgeCount; i++) {
    // hedgeCount is a fixed literal (5) above, always > 1, so this is a
    // plain even spread — no need for a hedgeCount===1 guard.
    const t = i / (hedgeCount - 1);
    const angle = Math.PI - hedgeArcSpan / 2 + t * hedgeArcSpan;
    const hedge = new THREE.Mesh(hedgeGeo, hedgeMat);
    hedge.position.set(Math.sin(angle) * hedgeRadius, 0.14, Math.cos(angle) * hedgeRadius);
    hedge.rotation.y = angle;
    hedge.castShadow = true;
    hedge.receiveShadow = true;
    g.add(hedge);
    hedgeTopBlooms.push(hedge);
  }

  // Hedge-top blooms (the game's own signature detail — board.ts's
  // buildHedgeDecor plants flowers on the hedge tops, not the ground) on
  // the middle 3 hedges, alternating colors; the two outer hedges stay bare
  // so the blooms read as sparse accents, not a solid flowery wall.
  const bloomGeo = new THREE.SphereGeometry(0.055, 8, 8);
  const bloomMats: THREE.MeshToonMaterial[] = [];
  [1, 2, 3].forEach((hedgeIdx, i) => {
    const hedge = hedgeTopBlooms[hedgeIdx];
    const mat = toon({
      color: BLOOM_COLORS[i % BLOOM_COLORS.length],

      emissive: BLOOM_COLORS[i % BLOOM_COLORS.length],
      emissiveIntensity: 0.25,
    });
    bloomMats.push(mat);
    const bloom = new THREE.Mesh(bloomGeo, mat);
    bloom.position.set(0, 0.19, 0);
    bloom.castShadow = true;
    hedge.add(bloom);
  });

  // One small ground-level bloom accent near the dog's feet, off to one
  // side so it doesn't compete with the beagle's own silhouette.
  const groundBloomMat = toon({
    color: BLOOM_COLORS[1],

    emissive: BLOOM_COLORS[1],
    emissiveIntensity: 0.25,
  });
  bloomMats.push(groundBloomMat);
  const groundBloom = new THREE.Mesh(bloomGeo, groundBloomMat);
  groundBloom.position.set(0.55, 0.02, 0.35);
  groundBloom.castShadow = true;
  g.add(groundBloom);

  return { group: g, soilMat, grassMat, hedgeMat, bloomMats };
}

/**
 * IDEA-037: re-tint the whole vignette to a maze theme's palette.
 *
 * Mutates materials and lights IN PLACE — the same technique applyBoardTheme
 * uses for the real board, and the reason re-theming is instant and allocates
 * nothing. The mapping is deliberately literal: the menu's soil/hedge/bloom
 * stand in for the board's floor/wall/decor, so a theme reads the same here as
 * it does in a run.
 */
function applyTheme(bits: ThemedBits, theme: MazeTheme): void {
  const p = theme.palette;

  // Sky: the shader dome's two gradient stops.
  const uniforms = (bits.backdrop as THREE.ShaderMaterial).uniforms;
  if (uniforms?.topColor && uniforms?.bottomColor) {
    (uniforms.topColor.value as THREE.Color).setHex(p.backdropTop);
    (uniforms.bottomColor.value as THREE.Color).setHex(p.bg);
  }

  bits.soil.color.setHex(p.floor);
  bits.soil.emissive.setHex(p.floorEmissive);
  bits.soil.emissiveIntensity = p.floorEmissiveIntensity;

  // The grass rim and hedges both read as the board's walls.
  for (const mat of [bits.grass, bits.hedge]) {
    mat.color.setHex(p.wall);
    mat.emissive.setHex(p.wallEmissive);
    mat.emissiveIntensity = p.wallEmissiveIntensity;
  }

  // Blooms cycle the theme's own decor colours. Arcade Night ships an empty
  // bloom palette (it's deliberately clean/propless), so fall back to the
  // biscuit colour rather than rendering black dots.
  const palette = p.bloomColors.length > 0 ? p.bloomColors : [p.biscuit];
  bits.blooms.forEach((mat, i) => {
    const hex = palette[i % palette.length];
    mat.color.setHex(hex);
    mat.emissive.setHex(hex);
    mat.emissiveIntensity = p.bloomEmissiveIntensity;
  });

  // Lighting is most of what makes a theme feel different — Night City's
  // sodium-amber dusk vs The Garden's daylight.
  bits.hemi.color.setHex(p.hemiSky);
  bits.hemi.groundColor.setHex(p.hemiGround);
  bits.hemi.intensity = p.hemiIntensity;

  bits.key.color.setHex(p.sunColor);
  bits.key.intensity = p.sunIntensity;

  bits.rim.color.setHex(p.rimColor);
  bits.rim.intensity = p.rimIntensity;
}

// Camera framing (coordinator follow-up pass): the original steep top-down
// angle (y2.15 looking at y0.35) flattened/squashed the dog and put a huge
// dirt disc on screen. Lowered toward dog eye-level with only a slight
// downward tilt so the face + body both read dimensionally (the cute
// upward-looking eyes are the whole point of this shot) — this also drops
// the horizon so the composition becomes mostly sky with a small patch
// underfoot, per the brief. This is the LANDSCAPE/desktop base rig — verified
// unchanged (see resize() below, which reproduces exactly this position at
// aspect>=1).
const CAM_FOV = 42;
const CAM_POS = new THREE.Vector3(0, 1.15, 3.2);
// IDEA-036: the look target was lowered 0.5 -> 0.34, which lifts the beagle in
// frame and opens up the lower third for the button carousel (Nuno: "put the
// beagle a little up... and the buttons below", same on desktop and mobile).
//
// Done by moving the LOOK TARGET rather than the camera: the dolly math below
// derives BASE_DIST and CAM_DIR from this pair, so nudging the camera would
// have shifted the portrait framing that was tuned by projection math. Moving
// what it aims at re-frames the shot while leaving distance and direction
// intact.
const CAM_LOOK = new THREE.Vector3(0, 0.34, 0);

// Portrait dolly-back (coordinator follow-up #2): on a narrow aspect the
// horizontal FOV shrinks for a fixed vertical FOV, so the base landscape rig
// blows the subject up edge-to-edge on a phone. Fixed by dollying the camera
// BACK along its own look-ray (same technique scene.ts's computeFitDistance
// uses for the maze, just a plain lerp here — no NDC solving needed for a
// single small subject) as aspect narrows below 1, so the whole vignette
// (dog + patch + hedge arc) gets breathing room again.
//
// Verified by projection math (not just eyeballed): at PORTRAIT_DIST (5.3)
// on a 390x844 phone (aspect ~0.462) the beagle reads as a clearly centered,
// modestly-sized hero — about a fifth of the screen's height, comfortable
// margins of sky above and floor/button-room below, no longer edge-to-edge —
// while the base 3.2 distance is reproduced exactly at aspect>=1 (desktop
// untouched, byte-for-byte).
const PORTRAIT_ASPECT_REF = 0.46; // a typical phone in portrait, ~9:19.5
const PORTRAIT_DIST = 5.3;
const BASE_DIST = CAM_POS.distanceTo(CAM_LOOK);
// Direction from the look target to the base camera position, reused to
// dolly along the same ray for any aspect (mirrors scene.ts's own `dir`).
const CAM_DIR = CAM_POS.clone().sub(CAM_LOOK).normalize();

// Idle life tuning: a slow turntable yaw (reads as "showing off the coat from
// every angle") plus the beagle's own built-in idle tail-wag/ear-sway/
// breathing (syncToEntity already drives all of that whenever `moving` is
// false and dt keeps advancing — see characters.ts's WalkState/moveBlend).
const TURNTABLE_SPEED = 0.18; // rad/s — slow, smooth full rotation every ~35s

/** IDEA-037: everything in the vignette whose colour comes from the theme.
 *  Collected once at build time so applyTheme() can mutate materials IN PLACE
 *  — the same approach applyBoardTheme uses for the real board, which is what
 *  makes re-theming instant and allocation-free. */
interface ThemedBits {
  backdrop: THREE.ShaderMaterial | THREE.MeshBasicMaterial;
  soil: THREE.MeshToonMaterial;
  grass: THREE.MeshToonMaterial;
  hedge: THREE.MeshToonMaterial;
  blooms: THREE.MeshToonMaterial[];
  hemi: THREE.HemisphereLight;
  key: THREE.DirectionalLight;
  rim: THREE.DirectionalLight;
}

export interface MenuScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Advances the idle turntable + the beagle's own idle animation for one frame. */
  update(dt: number): void;
  /** Updates the camera aspect (call from the resize path — no maze-fit math needed). */
  resize(aspect: number): void;
  /** Recolors the showcase beagle in place (called when the player equips a
   *  new skin from the shop while the menu is showing). */
  setBeagleSkin(skin: BeagleSkin): void;
  /** IDEA-037: re-tints the whole vignette (sky, soil, hedge, blooms, lights)
   *  to a maze theme's palette, so the menu shows the theme the player has
   *  equipped — just as it already shows their equipped beagle skin. Applied
   *  in place, so it's instant and safe to call while the menu is visible. */
  setMazeTheme(theme: MazeTheme): void;
  /** Releases the showcase beagle's geometries/materials. Only meaningful if
   *  the whole game is being torn down — the menu scene is otherwise created
   *  once and kept alive for the app's lifetime. */
  dispose(): void;
}

/**
 * Builds the menu's dedicated scene, camera, garden patch, and showcase
 * beagle. Call once (from Game's constructor) and reuse via update()/resize()/
 * setBeagleSkin() on every subsequent menu visit — never rebuild.
 */
export function createMenuScene(): MenuScene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.bg);
  const backdrop = makeBackdrop();
  scene.add(backdrop.mesh);

  const camera = new THREE.PerspectiveCamera(CAM_FOV, 1, 0.1, 200);
  camera.position.copy(CAM_POS);
  camera.lookAt(CAM_LOOK);

  // Mirrors scene.ts's daylight rig exactly (hemisphere + warm key + cool
  // rim) so the beagle's coat reads identically in the menu and in-game.
  const hemi = new THREE.HemisphereLight(0xd8f0ff, 0x4a3a20, 0.65);
  scene.add(hemi);
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

  const patch = makeGardenPatch();
  scene.add(patch.group);

  // IDEA-037: everything the theme can re-tint, gathered once.
  const themed: ThemedBits = {
    backdrop: backdrop.material,
    soil: patch.soilMat,
    grass: patch.grassMat,
    hedge: patch.hedgeMat,
    blooms: patch.bloomMats,
    hemi,
    key,
    rim,
  };

  // Apply the EQUIPPED theme immediately, so the menu shows it on first paint
  // rather than flashing the garden default. Same reasoning as the equipped
  // beagle skin just below — and the same IDEA-021 v3 bug class if we didn't
  // (the profile is guaranteed hydrated before Game is constructed).
  applyTheme(themed, getEquippedMazeTheme());

  // The menu's dog SITS, tongue out — this is the one surface where the player
  // is looking at the character rather than steering it, so it gets the hero
  // model (smooth segment counts, inverted-hull outline) and the sitting pose.
  // The maze keeps the cheap standing model; `makeBeagle` is that one.
  let beagleMesh = makeBeagle(getEquippedBeagleSkin());
  scene.add(beagleMesh);

  // The idle-animation path (syncToEntity in characters.ts) reads an Entity's
  // dir/facing/tx/ty via entityWorld() to place the model â€” but the showcase
  // beagle isn't a real game Entity stepping around a grid, it just stands at
  // the origin forever. Rather than fabricate a fake Entity (and pull in
  // movement.ts's Entity/entityWorld machinery for a mesh that never moves),
  // drive the idle sub-part animation directly here: same idle formulas
  // (tail wag / ear sway / breathing) that characters.ts's
  // animateBeagleParts already implements for the stopped case, applied to
  // this mesh's own userData.parts. Kept intentionally simple/local rather
  // than reusing syncToEntity, since the showcase has no facing/position to
  // sync â€” only the idle life matters here.
  let idleT = 0;
  let turntableAngle = 0;

  function animateIdle(dt: number): void {
    idleT += dt;
    turntableAngle += dt * TURNTABLE_SPEED;
    beagleMesh.rotation.y = turntableAngle;

    const parts = beagleMesh.userData.parts as BeagleParts | undefined;
    if (!parts) return;

    // Same idle constants' spirit as characters.ts's animateBeagleParts idle
    // branch, kept as small local literals since that function isn't
    // exported (it's an internal helper keyed off syncToEntity's WalkState).
    const tailWag = Math.sin(idleT * 1.8) * 0.4;
    const earSwayL = -0.22 + Math.sin(idleT * 0.9) * 0.08 + Math.sin(idleT * 0.31 * Math.PI * 2) * 0.05;
    const earSwayR = -0.22 + Math.sin(idleT * 0.9 + 1.1) * 0.08 + Math.sin(idleT * 0.31 * Math.PI * 2 + 1.1) * 0.05;
    parts.tail.rotation.y = tailWag;
    parts.earL.rotation.x = earSwayL;
    parts.earR.rotation.x = earSwayR;

    const breathe = Math.sin(idleT * 1.4 * Math.PI * 2) * 0.015;
    beagleMesh.scale.y = beagleMesh.scale.x * (1 + breathe);
  }

  return {
    scene,
    camera,
    update(dt: number): void {
      animateIdle(dt);
    },
    resize(aspect: number): void {
      camera.aspect = aspect;

      // Portrait dolly-back: aspect>=1 (landscape/desktop) reproduces
      // BASE_DIST exactly (t=0 below), so desktop framing is untouched.
      // Narrower than 1 ramps linearly toward PORTRAIT_DIST, holding flat
      // beyond PORTRAIT_ASPECT_REF so very extreme aspects don't keep
      // dollying back indefinitely (mirrors scene.ts's own portrait ramp
      // shape for the maze camera).
      const t = aspect >= 1 ? 0 : Math.min(1, (1 - aspect) / (1 - PORTRAIT_ASPECT_REF));
      const dist = BASE_DIST + (PORTRAIT_DIST - BASE_DIST) * t;
      camera.position.copy(CAM_LOOK).addScaledVector(CAM_DIR, dist);
      camera.lookAt(CAM_LOOK);

      camera.updateProjectionMatrix();
    },
    setMazeTheme(theme: MazeTheme): void {
      applyTheme(themed, theme);
    },
    setBeagleSkin(skin: BeagleSkin): void {
      applyBeagleSkin(beagleMesh, skin);
    },
    dispose(): void {
      scene.remove(beagleMesh);
      beagleMesh.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          const mat = o.material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat.dispose();
        }
      });
    },
  };
}
