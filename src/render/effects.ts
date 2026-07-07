// OWNER: render-artist
// Gameplay "juice": transient, purely-cosmetic feedback layered on top of the
// already-decided game state — pellet pops, floating score popups, a ghost-eat
// burst, a fright-start ripple, a death flash + camera shake, and a level-clear
// sparkle. Nothing here reads or mutates game logic; game.ts tells us WHAT
// happened and WHERE (world coords), and we just play a cue.
//
// Contract (see game.ts call sites): createEffects(scene, camera, canvas) ->
// { pelletEaten, scorePopup, ghostEaten, frightStarted, beagleDied,
//   levelCleared, update(dt), shakeOffset, dispose() }.
//
// Perf notes:
// - Burst particles are ONE pooled THREE.Points object (a fixed-size buffer,
//   free-list allocated) shared by every burst kind — no per-effect geometry.
// - Score-popup number textures are generated once per distinct amount and
//   cached forever (the amount set is small and fixed: biscuit/bone/fruit/
//   ghost-chain values). Sprites themselves are still individual THREE.Sprite
//   instances (there are at most a handful alive at once) but their materials
//   share the cached texture, so eating a chain of ghosts allocates no new
//   textures.
// - The screen flash is a single camera-parented plane, toggled/faded via a
//   uniform-esque opacity field rather than created/destroyed per flash.
import * as THREE from "three";
import { COLORS } from "../game/config";

// ---------------------------------------------------------------------------
// Tuning constants (kept local — these are visual-feel knobs for this file
// only, not gameplay balance, so they don't belong in config.ts).

const POP_LIFE = 0.35; // biscuit/bone/fruit pop ring duration (s)
const BURST_PARTICLE_LIFE = 0.55; // ghost-eaten / level-clear particle life (s)
const SCORE_RISE = 1.0; // world units the popup rises
const SCORE_LIFE = 0.8; // popup duration (s)
const FLASH_FRIGHT_LIFE = 0.28;
const FLASH_DEATH_LIFE = 0.35;
const FLASH_CLEAR_LIFE = 0.4;

const SHAKE_DECAY = 6; // 1/s exponential decay rate
const SHAKE_KICK = 0.22; // initial shake amplitude (world units) on death
const SHAKE_FREQ = 42; // shake oscillation rate (rad/s-ish)

// Pooled burst-particle system capacity. A ghost-eat burst uses ~18 particles,
// level-clear uses ~40 — this comfortably covers several overlapping bursts
// (e.g. a fast eat-chain) without ever growing.
const MAX_PARTICLES = 320;

// ---------------------------------------------------------------------------
// Small numeric helpers (no allocation).

function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

// ---------------------------------------------------------------------------
// Ring "pop" for pellet/fruit eating: an expanding, fading torus-ish ring
// (built from a flat circle outline via a thin ring geometry) that scales up
// and fades over POP_LIFE. Bones/ghost-eaten pops are bigger + brighter than
// biscuit pops. Each pop owns a tiny geometry+material (rings are cheap and
// short-lived; pooling them would add more complexity than it saves given how
// few are ever alive at once — at most a handful, unlike the burst particles).

interface RingPop {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  t: number;
  life: number;
  startScale: number;
  maxScale: number;
}

const ringGeometry = new THREE.RingGeometry(0.5, 1, 24);
ringGeometry.rotateX(-Math.PI / 2);

function spawnRingPop(
  pool: RingPop[],
  scene: THREE.Scene,
  x: number,
  z: number,
  color: number,
  startScale: number,
  maxScale: number,
): void {
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(ringGeometry, material);
  mesh.position.set(x, 0.42, z);
  mesh.scale.setScalar(startScale);
  scene.add(mesh);
  pool.push({ mesh, material, t: 0, life: POP_LIFE, startScale, maxScale });
}

// ---------------------------------------------------------------------------
// Pooled burst particles: one THREE.Points, MAX_PARTICLES slots. Dead slots
// are parked at scale 0 / far below the board (cheap "hide" without touching
// draw-range bookkeeping every frame). A free-list of indices tracks which
// slots are available; `count`/`alive` tracking is per-slot via parallel
// typed arrays rather than per-particle objects, so steady-state bursts never
// allocate.

interface ParticlePool {
  points: THREE.Points;
  positions: Float32Array;
  colors: Float32Array;
  velocities: Float32Array; // vx, vy, vz per slot
  life: Float32Array; // remaining life, seconds; <=0 means dead
  free: number[]; // stack of free slot indices
}

function makeParticlePool(scene: THREE.Scene): ParticlePool {
  const positions = new Float32Array(MAX_PARTICLES * 3);
  const colors = new Float32Array(MAX_PARTICLES * 3);
  const velocities = new Float32Array(MAX_PARTICLES * 3);
  const life = new Float32Array(MAX_PARTICLES); // starts all 0 == dead

  // Park every slot far below the board so a stray dead-but-not-yet-recycled
  // vertex never reads as a stray lit dot near the maze.
  for (let i = 0; i < MAX_PARTICLES; i++) positions[i * 3 + 1] = -50;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size: 0.16,
    vertexColors: true,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  scene.add(points);

  const free: number[] = [];
  for (let i = MAX_PARTICLES - 1; i >= 0; i--) free.push(i);

  return { points, positions, colors, velocities, life, free };
}

/** Emits `n` particles from (x,0.4,z) in random directions, tinted `color`. Silently drops any that don't fit (pool exhausted) rather than growing. */
function emitBurst(
  pool: ParticlePool,
  x: number,
  z: number,
  n: number,
  color: THREE.Color,
  speed: number,
): void {
  for (let i = 0; i < n; i++) {
    const slot = pool.free.pop();
    if (slot === undefined) return; // pool exhausted; drop remaining particles

    const theta = Math.random() * Math.PI * 2;
    const upward = 0.6 + Math.random() * 1.2;
    const outward = speed * (0.5 + Math.random() * 0.5);

    pool.positions[slot * 3] = x;
    pool.positions[slot * 3 + 1] = 0.4;
    pool.positions[slot * 3 + 2] = z;

    pool.velocities[slot * 3] = Math.cos(theta) * outward;
    pool.velocities[slot * 3 + 1] = upward;
    pool.velocities[slot * 3 + 2] = Math.sin(theta) * outward;

    pool.colors[slot * 3] = color.r;
    pool.colors[slot * 3 + 1] = color.g;
    pool.colors[slot * 3 + 2] = color.b;

    pool.life[slot] = BURST_PARTICLE_LIFE;
  }
}

const PARTICLE_GRAVITY = 2.2;

function updateParticlePool(pool: ParticlePool, dt: number): void {
  let dirty = false;
  for (let i = 0; i < MAX_PARTICLES; i++) {
    if (pool.life[i] <= 0) continue;
    dirty = true;

    pool.life[i] -= dt;
    if (pool.life[i] <= 0) {
      // Recycle: park off-scene and return the slot to the free list.
      pool.positions[i * 3 + 1] = -50;
      pool.free.push(i);
      continue;
    }

    pool.velocities[i * 3 + 1] -= PARTICLE_GRAVITY * dt;
    pool.positions[i * 3] += pool.velocities[i * 3] * dt;
    pool.positions[i * 3 + 1] += pool.velocities[i * 3 + 1] * dt;
    pool.positions[i * 3 + 2] += pool.velocities[i * 3 + 2] * dt;
  }
  if (dirty) {
    pool.points.geometry.attributes.position.needsUpdate = true;
    pool.points.geometry.attributes.color.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Score popups: a billboard sprite showing "+amount", built from a cached
// canvas texture (one per distinct amount, generated lazily and kept forever
// — the amount set is small: 10, 50, 100, 200, 400, 800, 1600).

const SCORE_CANVAS_W = 160;
const SCORE_CANVAS_H = 64;

function renderScoreTexture(amount: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = SCORE_CANVAS_W;
  canvas.height = SCORE_CANVAS_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("effects: 2D canvas context unavailable for score texture");

  ctx.clearRect(0, 0, SCORE_CANVAS_W, SCORE_CANVAS_H);
  ctx.font = "700 40px system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const text = `+${amount}`;

  // Dark outline for legibility over any background tile, then a bright fill.
  ctx.lineWidth = 8;
  ctx.strokeStyle = "rgba(10,10,20,0.85)";
  ctx.strokeText(text, SCORE_CANVAS_W / 2, SCORE_CANVAS_H / 2);
  ctx.fillStyle = "#fff3d0";
  ctx.fillText(text, SCORE_CANVAS_W / 2, SCORE_CANVAS_H / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

interface ScorePopup {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  t: number;
  baseY: number;
}

// ---------------------------------------------------------------------------
// Full-screen flash: one camera-parented plane reused for every flash kind
// (fright/death/level-clear each just set its own colour + life + opacity
// curve). Parented to the camera so it always fills the view regardless of
// the maze's fixed top-down framing, and placed just inside the near plane.
const FLASH_DISTANCE = 0.2;
const FLASH_SIZE = 4; // big enough to cover the frustum at FLASH_DISTANCE for BASE_FOV

interface FlashPlane {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
}

function makeFlashPlane(camera: THREE.PerspectiveCamera): FlashPlane {
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(FLASH_SIZE, FLASH_SIZE), material);
  mesh.position.set(0, 0, -FLASH_DISTANCE);
  mesh.renderOrder = 999;
  camera.add(mesh);
  // The camera itself isn't otherwise part of the scene graph (scene.ts never
  // adds it), so attaching the plane here is what makes it reachable for
  // rendering at all — it rides along with every camera move for free.
  return { mesh, material };
}

// ---------------------------------------------------------------------------

export interface Effects {
  pelletEaten(x: number, z: number, kind: "biscuit" | "bone"): void;
  scorePopup(x: number, z: number, amount: number): void;
  ghostEaten(x: number, z: number, chainScore: number): void;
  frightStarted(): void;
  beagleDied(x: number, z: number): void;
  levelCleared(): void;
  update(dt: number): void;
  /** Current camera shake displacement; add to camera.position before render, subtract after (see game.ts tick()). */
  readonly shakeOffset: { x: number; y: number; z: number };
  dispose(): void;
}

type FlashKind = "fright" | "death" | "clear";

const FLASH_COLOR: Record<FlashKind, number> = {
  fright: COLORS.frightened,
  death: 0xd8393f,
  clear: 0xfff3d0,
};
const FLASH_PEAK_OPACITY: Record<FlashKind, number> = {
  fright: 0.22,
  death: 0.4,
  clear: 0.3,
};
const FLASH_LIFE: Record<FlashKind, number> = {
  fright: FLASH_FRIGHT_LIFE,
  death: FLASH_DEATH_LIFE,
  clear: FLASH_CLEAR_LIFE,
};

export function createEffects(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  // canvas is part of the documented contract (kept for parity with other
  // render-layer factories and any future canvas-space cue); not needed by
  // the current three.js-only implementation.
  _canvas: HTMLCanvasElement,
): Effects {
  const ringPops: RingPop[] = [];
  const particlePool = makeParticlePool(scene);
  const scorePopups: ScorePopup[] = [];
  const scoreTextureCache = new Map<number, THREE.CanvasTexture>();
  const { mesh: flashMesh, material: flashMaterial } = makeFlashPlane(camera);

  let flashKind: FlashKind | null = null;
  let flashT = 0;
  let flashLife = 0;

  const shakeOffset = { x: 0, y: 0, z: 0 };
  let shakeAmp = 0;
  let shakeT = 0;

  function getScoreTexture(amount: number): THREE.CanvasTexture {
    let tex = scoreTextureCache.get(amount);
    if (!tex) {
      tex = renderScoreTexture(amount);
      scoreTextureCache.set(amount, tex);
    }
    return tex;
  }

  function startFlash(kind: FlashKind): void {
    flashKind = kind;
    flashT = 0;
    flashLife = FLASH_LIFE[kind];
    flashMaterial.color.setHex(FLASH_COLOR[kind]);
  }

  function pelletEaten(x: number, z: number, kind: "biscuit" | "bone"): void {
    if (kind === "bone") {
      spawnRingPop(ringPops, scene, x, z, 0xfff3d0, 0.18, 0.85);
      emitBurst(particlePool, x, z, 6, new THREE.Color(0xfff3d0), 1.4);
    } else {
      spawnRingPop(ringPops, scene, x, z, COLORS.biscuit, 0.12, 0.55);
    }
  }

  function scorePopup(x: number, z: number, amount: number): void {
    const material = new THREE.SpriteMaterial({
      map: getScoreTexture(amount),
      transparent: true,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    });
    const sprite = new THREE.Sprite(material);
    const aspect = SCORE_CANVAS_W / SCORE_CANVAS_H;
    const height = 0.5;
    sprite.scale.set(height * aspect, height, 1);
    sprite.position.set(x, 0.9, z);
    sprite.renderOrder = 10;
    scene.add(sprite);
    scorePopups.push({ sprite, material, t: 0, baseY: 0.9 });
  }

  function ghostEaten(x: number, z: number, chainScore: number): void {
    emitBurst(particlePool, x, z, 20, new THREE.Color(0xbdf3ff), 2.2);
    spawnRingPop(ringPops, scene, x, z, 0xbdf3ff, 0.2, 1.1);
    scorePopup(x, z, chainScore);
  }

  function frightStarted(): void {
    startFlash("fright");
  }

  function beagleDied(x: number, z: number): void {
    startFlash("death");
    emitBurst(particlePool, x, z, 14, new THREE.Color(0xd8393f), 1.6);
    shakeAmp = SHAKE_KICK;
    shakeT = 0;
  }

  function levelCleared(): void {
    startFlash("clear");
    // Sparkles scattered loosely across the board centre rather than one
    // pinpoint burst, so it reads as "the whole map celebrating" — several
    // origin points, modest particle counts each, within the pooled budget.
    const spread = 4;
    for (let i = 0; i < 5; i++) {
      const ox = (Math.random() - 0.5) * spread * 2;
      const oz = (Math.random() - 0.5) * spread * 2;
      emitBurst(particlePool, ox, oz, 8, new THREE.Color(0xfff3d0), 1.2);
    }
  }

  function updateRingPops(dt: number): void {
    for (let i = ringPops.length - 1; i >= 0; i--) {
      const p = ringPops[i];
      p.t += dt;
      if (p.t >= p.life) {
        p.mesh.removeFromParent();
        p.material.dispose();
        ringPops.splice(i, 1);
        continue;
      }
      const k = p.t / p.life;
      const eased = easeOutCubic(k);
      p.mesh.scale.setScalar(THREE.MathUtils.lerp(p.startScale, p.maxScale, eased));
      p.material.opacity = 0.9 * (1 - k);
    }
  }

  function updateScorePopups(dt: number): void {
    for (let i = scorePopups.length - 1; i >= 0; i--) {
      const p = scorePopups[i];
      p.t += dt;
      if (p.t >= SCORE_LIFE) {
        p.sprite.removeFromParent();
        p.material.dispose();
        scorePopups.splice(i, 1);
        continue;
      }
      const k = p.t / SCORE_LIFE;
      p.sprite.position.y = p.baseY + easeOutCubic(k) * SCORE_RISE;
      p.material.opacity = 1 - easeOutCubic(k);
    }
  }

  function updateFlash(dt: number): void {
    if (flashKind === null) return;
    flashT += dt;
    if (flashT >= flashLife) {
      flashKind = null;
      flashMaterial.opacity = 0;
      return;
    }
    const k = flashT / flashLife;
    // Quick ramp up, slower fade out — reads as a "hit" rather than a fade-in.
    const shape = k < 0.15 ? k / 0.15 : 1 - easeOutCubic((k - 0.15) / 0.85);
    flashMaterial.opacity = FLASH_PEAK_OPACITY[flashKind] * shape;
  }

  function updateShake(dt: number): void {
    if (shakeAmp <= 0.0001) {
      shakeOffset.x = 0;
      shakeOffset.y = 0;
      shakeOffset.z = 0;
      return;
    }
    shakeT += dt;
    shakeAmp *= Math.exp(-SHAKE_DECAY * dt);
    if (shakeAmp <= 0.0001) shakeAmp = 0;
    shakeOffset.x = Math.sin(shakeT * SHAKE_FREQ) * shakeAmp;
    shakeOffset.y = Math.sin(shakeT * SHAKE_FREQ * 1.7 + 1.3) * shakeAmp * 0.6;
    shakeOffset.z = Math.cos(shakeT * SHAKE_FREQ * 1.3) * shakeAmp;
  }

  function update(dt: number): void {
    updateRingPops(dt);
    updateParticlePool(particlePool, dt);
    updateScorePopups(dt);
    updateFlash(dt);
    updateShake(dt);
  }

  function dispose(): void {
    ringPops.forEach((p) => {
      p.mesh.removeFromParent();
      p.material.dispose();
    });
    ringPops.length = 0;

    scorePopups.forEach((p) => {
      p.sprite.removeFromParent();
      p.material.dispose();
    });
    scorePopups.length = 0;

    scoreTextureCache.forEach((tex) => tex.dispose());
    scoreTextureCache.clear();

    particlePool.points.removeFromParent();
    particlePool.points.geometry.dispose();
    (particlePool.points.material as THREE.Material).dispose();

    flashMesh.removeFromParent();
    flashMaterial.dispose();
    flashMesh.geometry.dispose();
  }

  return {
    pelletEaten,
    scorePopup,
    ghostEaten,
    frightStarted,
    beagleDied,
    levelCleared,
    update,
    shakeOffset,
    dispose,
  };
}
