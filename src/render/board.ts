// OWNER: render-artist
// Builds maze meshes for a level: instanced walls, floor, biscuits, bones.
// Reference: /prototype/beagle-chomp.html (buildBoard, makeBone).
// Contract: buildBoard(scene, grid) -> { pelletMeshes: Map<string, {...}>, ... }
// Keep walls as a single InstancedMesh (performance requirement).
//
// IDEA-026 (maze themes, v4.0): wall/floor/biscuit materials and the
// hedge-top decor are now THEME-DRIVEN (src/game/themes.ts's ThemePalette) —
// buildBoard reads the currently equipped theme so a fresh level is always
// correctly skinned, and applyBoardTheme (below) lets a mid-run re-theme
// recolour the shared materials IN PLACE (zero rebuild, zero pellet-state
// loss) while rebuilding only the purely-cosmetic hedge decor. Pickups
// (bones/fruit/coin/golden bone) keep FIXED identity colors in every theme —
// only wall/floor/biscuit/hedge-decor read the palette.
import * as THREE from "three";
import { Grid, COLS, ROWS, TILE, worldX, worldZ } from "../game/grid";
import { getEquippedMazeTheme, type MazeTheme, type ThemePalette } from "../game/themes";

export const WALL_H = 1;

export type PelletKind = "biscuit" | "bone";
export interface PelletMesh {
  mesh: THREE.Object3D;
  kind: PelletKind;
}

export interface Board {
  /** Keyed by "tx,ty" — remove exactly one entry (and its mesh) when eaten. */
  pelletMeshes: Map<string, PelletMesh>;
  pelletsLeft: number;
  walls: THREE.InstancedMesh;
  floor: THREE.Mesh;
  /** The current bonus fruit, if any (see spawnFruit/clearFruit). Lifecycle
   *  is entirely render-side — gameplay only tells us when/where to spawn or
   *  clear one, keeping fruit placement logic out of src/game. */
  fruit: THREE.Object3D | null;
  /** IDEA-016/IDEA-017: the current maze coin pickup, if any (see
   *  spawnCoin/clearCoin below) — parallels `fruit` exactly. Placement
   *  (which tile, when) is gameplay's call (src/game/game.ts); this field
   *  just tracks the mesh so eating/spinDecor/teardown can find it. */
  coin: THREE.Object3D | null;
  /** IDEA-018: the current maze bonus-life pickup (a golden bone), if any
   *  (see spawnLife/clearLife below) — parallels `coin`/`fruit` exactly.
   *  Placement (which tile, when) is gameplay's call (src/game/game.ts); this
   *  field just tracks the mesh so eating/spinDecor/teardown can find it. */
  life: THREE.Object3D | null;
  /** IDEA-011 hedge-top decoration: a handful of InstancedMeshes (one per
   *  bloom color + one for leaf specks). Purely cosmetic, lives for the
   *  level like the walls do — not tracked per-tile like pellets.
   *  IDEA-026: theme-parameterized (buildHedgeDecor takes a ThemePalette) and
   *  entirely rebuilt (materials + instances) by applyBoardTheme on a
   *  mid-run re-theme — never mutated in place like matWall/matFloor/
   *  matBiscuit, since the SET of decorated tiles/colors can itself change
   *  (e.g. classic's bloomChance 0 means no decor at all). */
  hedgeDecor: THREE.InstancedMesh[];
}

// IDEA-026: wall/floor/biscuit materials are shared, module-level, and
// SHARED singletons (matching the "one InstancedMesh for all walls"
// performance requirement) — a theme is applied by mutating THESE instances'
// color/emissive/emissiveIntensity in place (see applyBoardTheme), never by
// creating new materials or new meshes. Seeded from the equipped theme at
// module load so a fresh session (before any applyBoardTheme call) already
// shows the right theme.
const initialPalette = getEquippedMazeTheme().palette;

// IDEA-008 (daytime garden): emissive intensity dropped sharply (0.72 -> 0.2)
// so the hedges read as matte, sunlit foliage under daylight instead of
// glowing neon — roughness/metalness/base color untouched. IDEA-026: color/
// emissive/emissiveIntensity now come from the theme palette (garden's values
// above still equal the pre-theme constants, so equipping garden is a
// visual no-op — see themes.ts's regression note).
const matWall = new THREE.MeshStandardMaterial({
  color: initialPalette.wall,
  roughness: 0.5,
  metalness: 0.1,
  emissive: initialPalette.wallEmissive,
  emissiveIntensity: initialPalette.wallEmissiveIntensity,
});
// IDEA-008 (daytime garden): emissive swapped from a cold blue-black
// (0x0a0a18) to a warm dark brown so the soil reads as sunlit earth rather
// than picking up a cold night cast — still a faint whisper of lift, not a
// glow, on an otherwise diffuse, roughness: 1 surface. IDEA-026: themed.
const matFloor = new THREE.MeshStandardMaterial({
  color: initialPalette.floor,
  roughness: 1,
  emissive: initialPalette.floorEmissive,
  emissiveIntensity: initialPalette.floorEmissiveIntensity,
});
const geoBiscuit = new THREE.SphereGeometry(0.13, 12, 12);
// Biscuit glow warmed and strengthened (0x3a2a10/0.4 -> 0x6a4a18/0.55) so
// pellets read as gently lit treats rather than flat spheres, without
// blowing out at the tuned exposure (see scene.ts toneMappingExposure note).
// IDEA-026: themed — biscuits ARE the trail, so they re-skin with the world
// (unlike the fixed-identity pickups below).
const matBiscuit = new THREE.MeshStandardMaterial({
  color: initialPalette.biscuit,
  roughness: 0.7,
  emissive: initialPalette.biscuitEmissive,
  emissiveIntensity: initialPalette.biscuitEmissiveIntensity,
});

// IDEA-011 (hedge detail) / IDEA-026 (themed): hedge-top bloom/speck
// geometries stay shared, module-level constants (cheap spheres, reused by
// every theme) — only the MATERIALS are theme-specific, built fresh per
// buildHedgeDecor call from the palette's bloomColors/speckColor/emissives
// (see buildHedgeDecor below) and disposed by applyBoardTheme on swap.
const geoBloom = new THREE.SphereGeometry(0.075, 6, 6);
const geoLeafSpeck = new THREE.SphereGeometry(0.05, 6, 6);

/** Small deterministic hash of a tile coord -> [0,1), stable across builds
 *  (no Math.random/Date.now) so the garden layout doesn't shuffle every
 *  level reload. */
function hash01(x: number, y: number, seed: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return h - Math.floor(h);
}

/** A dog bone built from a cylinder shaft + four sphere "knuckles". */
function makeBone(): THREE.Group {
  const g = new THREE.Group();
  // Emissive warmed and strengthened (0x554a2a/0.25 -> 0x6a5730/0.4) to match
  // the biscuit's softly-lit-treat read at the new exposure/lighting.
  const white = new THREE.MeshStandardMaterial({
    color: 0xf6f1e6,
    roughness: 0.5,
    emissive: 0x6a5730,
    emissiveIntensity: 0.4,
  });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.34, 10), white);
  shaft.rotation.z = Math.PI / 2;
  g.add(shaft);
  const knuckles: Array<[number, number]> = [
    [-0.2, 0.09],
    [-0.2, -0.09],
    [0.2, 0.09],
    [0.2, -0.09],
  ];
  knuckles.forEach(([x, z]) => {
    const k = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 10), white);
    k.position.set(x, 0, z);
    g.add(k);
  });
  g.traverse((o) => {
    o.castShadow = true;
  });
  return g;
}

// IDEA-018: gold material for the bonus-life pickup — a distinctly warmer,
// metallic gold (vs. the pellet bone's flat off-white 0xf6f1e6) so a golden
// bone reads immediately as a special pickup rather than an oversized regular
// bone. Tuned close to the maze coin's palette (0xf4c430 body / 0x6b4e0a
// emissive) since both are "wallet/reward" gold, but with a touch more
// metalness/roughness contrast so the bone's knuckle geometry still catches
// visible highlights rather than reading as a flat gold blob.
const matGoldBone = new THREE.MeshStandardMaterial({
  color: 0xf4c430,
  roughness: 0.35,
  metalness: 0.5,
  emissive: 0x6b4e0a,
  emissiveIntensity: 0.55,
});

/**
 * IDEA-018: the bonus-life pickup — a bigger, glowing GOLDEN version of the
 * regular power-bone (makeBone above): identical shaft + four-knuckle shape,
 * scaled up ~1.6x and finished in matGoldBone instead of the pellet bone's
 * flat white, so it's unmistakably a special pickup at a glance and never
 * confusable with a white maze-floor bone. Local origin stays centered (like
 * makeBone/makeCoin) so it sits right at whatever position spawnLife sets.
 */
function makeLifeBone(): THREE.Group {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.34, 10), matGoldBone);
  shaft.rotation.z = Math.PI / 2;
  g.add(shaft);
  const knuckles: Array<[number, number]> = [
    [-0.2, 0.09],
    [-0.2, -0.09],
    [0.2, 0.09],
    [0.2, -0.09],
  ];
  knuckles.forEach(([x, z]) => {
    const k = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 10), matGoldBone);
    k.position.set(x, 0, z);
    g.add(k);
  });
  g.scale.setScalar(1.6);
  g.traverse((o) => {
    o.castShadow = true;
  });
  return g;
}

/**
 * A bonus fruit built from primitives (ported from prototype makeFruit,
 * line 201): an apple body plus a small leaf. Placement is the caller's job
 * (see spawnFruit) — this just builds the model at the origin.
 */
export function makeFruit(): THREE.Group {
  const g = new THREE.Group();
  // Emissive strengthened (0x3a0d0a/0.4 -> 0x5c130f/0.5) so the fruit reads
  // as a glowing bonus pickup, matching the biscuit/bone glow treatment.
  const apple = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 16, 16),
    new THREE.MeshStandardMaterial({
      color: 0xd8483f,
      roughness: 0.4,
      emissive: 0x5c130f,
      emissiveIntensity: 0.5,
    }),
  );
  g.add(apple);
  // Leaf gets a faint green emissive too (was none) — subtle, just enough
  // that it doesn't look like a flat unlit cutout next to the glowing apple.
  const leaf = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 8, 8),
    new THREE.MeshStandardMaterial({
      color: 0x5fae4d,
      emissive: 0x1c3a18,
      emissiveIntensity: 0.3,
    }),
  );
  leaf.position.set(0.06, 0.22, 0);
  leaf.scale.set(1.4, 0.5, 0.8);
  g.add(leaf);
  g.traverse((o) => {
    o.castShadow = true;
  });
  return g;
}

// IDEA-017: real gold coin geometry/materials, sized to match the fruit's
// ~0.22 visual footprint. A short cylinder is the coin body; a thin torus
// hugs its rim for a raised-edge read; a smaller inset disc on each face
// gives a subtle emboss. All three share one warm-gold material so the coin
// reads as a single cohesive glowing pickup (same "soft glow" language as
// the biscuit/bone/fruit above), plus a slightly brighter rim material so
// the edge catches a touch more highlight.
const geoCoinBody = new THREE.CylinderGeometry(0.2, 0.2, 0.055, 20);
const geoCoinRim = new THREE.TorusGeometry(0.2, 0.02, 8, 20);
const geoCoinEmboss = new THREE.CylinderGeometry(0.1, 0.1, 0.01, 16);

const matCoinBody = new THREE.MeshStandardMaterial({
  color: 0xf4c430,
  roughness: 0.3,
  metalness: 0.55,
  emissive: 0x6b4e0a,
  emissiveIntensity: 0.5,
});
const matCoinRim = new THREE.MeshStandardMaterial({
  color: 0xffcc33,
  roughness: 0.25,
  metalness: 0.6,
  emissive: 0x6b4e0a,
  emissiveIntensity: 0.55,
});

/**
 * A gold coin pickup: a disc-shaped cylinder body (flat faces on the sides,
 * so a Y-axis spin shows the classic "coin flip" edge-on silhouette from the
 * angled top-down camera), a thin torus rim for a raised-edge read, and a
 * small inset disc emboss on each face for detail at a glance. Keep the
 * exported function name/shape (`makeCoin(): THREE.Group`) — spawnCoin calls
 * it and its local origin must stay centered so it sits right at the
 * position spawnCoin sets.
 */
export function makeCoin(): THREE.Group {
  const g = new THREE.Group();

  const body = new THREE.Mesh(geoCoinBody, matCoinBody);
  body.rotation.z = Math.PI / 2; // flat faces point along X/-X, edge faces the camera-ish view
  body.castShadow = true;
  g.add(body);

  const rim = new THREE.Mesh(geoCoinRim, matCoinRim);
  rim.rotation.y = Math.PI / 2; // ring wraps the coin's circumference, matching the body's orientation
  rim.castShadow = true;
  g.add(rim);

  // Small emboss discs, one per face, sitting just proud of the body surface.
  const embossFront = new THREE.Mesh(geoCoinEmboss, matCoinRim);
  embossFront.rotation.z = Math.PI / 2;
  embossFront.position.x = 0.03;
  embossFront.castShadow = true;
  g.add(embossFront);

  const embossBack = new THREE.Mesh(geoCoinEmboss, matCoinRim);
  embossBack.rotation.z = Math.PI / 2;
  embossBack.position.x = -0.03;
  embossBack.castShadow = true;
  g.add(embossBack);

  return g;
}

/**
 * Builds the floor, instanced walls, and pellet meshes for one level. Reads
 * the currently EQUIPPED theme (src/game/themes.ts) so a fresh level always
 * starts correctly skinned — the shared matWall/matFloor/matBiscuit were
 * already seeded from the equipped theme at module load, but re-reading it
 * here keeps buildBoard correct even if the equipped theme changed since
 * (e.g. the player re-themed while dead/between levels, before a fresh
 * buildBoard ran) without requiring every caller to remember to call
 * applyBoardTheme right after buildBoard.
 */
export function buildBoard(scene: THREE.Object3D, grid: Grid): Board {
  const theme = getEquippedMazeTheme();
  syncBoardMaterials(theme.palette);

  const pelletMeshes = new Map<string, PelletMesh>();
  let pelletsLeft = 0;

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(COLS + 2, ROWS + 2), matFloor);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.01;
  floor.receiveShadow = true;
  scene.add(floor);

  let wallCount = 0;
  grid.cells.forEach((row) => row.forEach((c) => { if (c === "#") wallCount++; }));

  const wallGeo = new THREE.BoxGeometry(TILE, WALL_H, TILE);
  const walls = new THREE.InstancedMesh(wallGeo, matWall, wallCount);
  walls.castShadow = true;
  walls.receiveShadow = true;
  const dummy = new THREE.Object3D();
  let wi = 0;

  grid.cells.forEach((row, y) => row.forEach((c, x) => {
    if (c === "#") {
      dummy.position.set(worldX(x), WALL_H / 2, worldZ(y));
      dummy.updateMatrix();
      walls.setMatrixAt(wi++, dummy.matrix);
    } else if (c === "." || c === "o") {
      const mesh: THREE.Object3D = c === "o" ? makeBone() : new THREE.Mesh(geoBiscuit, matBiscuit);
      mesh.position.set(worldX(x), 0.45, worldZ(y));
      if (c !== "o") mesh.castShadow = true;
      scene.add(mesh);
      pelletMeshes.set(`${x},${y}`, { mesh, kind: c === "o" ? "bone" : "biscuit" });
      pelletsLeft++;
    }
  }));

  scene.add(walls);

  const hedgeDecor = buildHedgeDecor(scene, grid, theme.palette);

  return { pelletMeshes, pelletsLeft, walls, floor, fruit: null, coin: null, life: null, hedgeDecor };
}

/**
 * IDEA-026: mutates matWall/matFloor/matBiscuit's color/emissive/
 * emissiveIntensity IN PLACE from `palette` — this is the whole mechanism
 * behind a zero-rebuild re-theme: every wall instance, the floor plane, and
 * every biscuit mesh already reference these three shared material objects,
 * so a `.color.set(...)` here is instantly visible on all of them with no
 * geometry rebuild and no pellet-state loss (safe to call mid-run). Shared
 * by buildBoard (fresh level) and applyBoardTheme (mid-run re-theme) so the
 * two can never drift.
 */
function syncBoardMaterials(palette: ThemePalette): void {
  matWall.color.set(palette.wall);
  matWall.emissive.set(palette.wallEmissive);
  matWall.emissiveIntensity = palette.wallEmissiveIntensity;

  matFloor.color.set(palette.floor);
  matFloor.emissive.set(palette.floorEmissive);
  matFloor.emissiveIntensity = palette.floorEmissiveIntensity;

  matBiscuit.color.set(palette.biscuit);
  matBiscuit.emissive.set(palette.biscuitEmissive);
  matBiscuit.emissiveIntensity = palette.biscuitEmissiveIntensity;
}

/**
 * IDEA-011 (garden) / IDEA-026 (themed): sparse, tasteful hedge-top detail.
 * Deterministically picks a `palette.bloomChance` fraction of wall tiles to
 * get a tiny bloom (one of `palette.bloomColors`), and a `palette.speckChance`
 * fraction of those also get a leaf/vent speck beside the bloom. Batched into
 * one InstancedMesh per bloom color plus one for specks — a handful of draw
 * calls total, not one mesh per flower.
 *
 * The deterministic hash01 placement (seeded only by tile coord, never by
 * palette) is unchanged from the original garden-only version, so WHICH
 * tiles get decorated stays stable across a re-theme — only the count
 * (bloomChance/speckChance) and appearance (colors/emissives) vary. An empty
 * `bloomColors` or `bloomChance` of 0 (e.g. classic's clean neon walls)
 * short-circuits to no decor at all, returning `[]`.
 *
 * Builds its OWN materials from `palette` (not the old module-level
 * matBlooms/matLeafSpeck constants) so applyBoardTheme can swap the whole
 * decor set — colors, counts, and all — by rebuilding rather than mutating;
 * see applyBoardTheme's disposal of the outgoing meshes' materials below.
 */
function buildHedgeDecor(
  scene: THREE.Object3D,
  grid: Grid,
  palette: ThemePalette,
): THREE.InstancedMesh[] {
  if (palette.bloomChance <= 0 || palette.bloomColors.length === 0) return [];

  const bloomColors = palette.bloomColors;

  // Bucket chosen tile positions per bloom color first, so we know exact
  // instance counts before allocating each InstancedMesh.
  const perColor: Array<Array<[number, number]>> = bloomColors.map(() => []);
  const leafSpots: Array<[number, number]> = [];

  grid.cells.forEach((row, y) => row.forEach((c, x) => {
    if (c !== "#") return;
    const r = hash01(x, y, 1);
    if (r >= palette.bloomChance) return;
    const colorIdx = Math.floor(hash01(x, y, 2) * bloomColors.length) % bloomColors.length;
    perColor[colorIdx].push([x, y]);
    if (hash01(x, y, 3) < palette.speckChance) leafSpots.push([x, y]);
  }));

  const matBlooms = bloomColors.map(
    (color) =>
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.5,
        emissive: color,
        emissiveIntensity: palette.bloomEmissiveIntensity,
      }),
  );
  const matLeafSpeck = new THREE.MeshStandardMaterial({
    color: palette.speckColor,
    roughness: 0.6,
    emissive: palette.speckEmissive,
    emissiveIntensity: 0.2,
  });

  const dummy = new THREE.Object3D();
  const meshes: THREE.InstancedMesh[] = [];

  perColor.forEach((spots, colorIdx) => {
    if (spots.length === 0) return;
    const mesh = new THREE.InstancedMesh(geoBloom, matBlooms[colorIdx], spots.length);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    spots.forEach(([x, y], i) => {
      // Slight per-tile jitter (from the hash, not random) so blooms don't
      // all sit dead-center on the hedge top — keeps it feeling planted
      // rather than stamped.
      const jx = (hash01(x, y, 4) - 0.5) * 0.4;
      const jz = (hash01(x, y, 5) - 0.5) * 0.4;
      dummy.position.set(worldX(x) + jx, WALL_H + 0.06, worldZ(y) + jz);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    scene.add(mesh);
    meshes.push(mesh);
  });

  if (leafSpots.length > 0) {
    const leafMesh = new THREE.InstancedMesh(geoLeafSpeck, matLeafSpeck, leafSpots.length);
    leafMesh.castShadow = false;
    leafMesh.receiveShadow = false;
    leafSpots.forEach(([x, y], i) => {
      const jx = (hash01(x, y, 6) - 0.5) * 0.4;
      const jz = (hash01(x, y, 7) - 0.5) * 0.4;
      dummy.position.set(worldX(x) + jx, WALL_H + 0.04, worldZ(y) + jz);
      dummy.scale.set(1.3, 0.6, 1);
      dummy.updateMatrix();
      leafMesh.setMatrixAt(i, dummy.matrix);
    });
    dummy.scale.set(1, 1, 1);
    scene.add(leafMesh);
    meshes.push(leafMesh);
  }

  return meshes;
}

/**
 * IDEA-026: applies `theme` to an already-built board, LIVE — safe to call
 * mid-run (e.g. the player re-themes from the shop between levels, or a
 * future "preview while playing" flow). Two very different mechanisms, by
 * design:
 *
 *  1. Wall/floor/biscuit: `syncBoardMaterials` mutates the shared matWall/
 *     matFloor/matBiscuit in place. Because every wall instance, the floor
 *     plane, and every biscuit mesh on `board` already reference these same
 *     three material objects, this alone re-themes ALL of them instantly —
 *     zero geometry rebuild, zero pellet Map churn, `board.pelletMeshes`
 *     keeps every existing entry untouched (eating still works exactly as
 *     before the re-theme).
 *  2. Hedge decor: rebuilt from scratch — the SET of decorated tiles/colors
 *     can itself change size (a theme with fewer bloomColors or a different
 *     bloomChance produces a different instance count per InstancedMesh,
 *     which isn't something you can resize in place), so the old
 *     `board.hedgeDecor` meshes are removed from `scene` and their
 *     per-build materials disposed (their geometries — geoBloom/
 *     geoLeafSpeck — are shared module-level constants and must NOT be
 *     disposed here), then buildHedgeDecor runs again with the new theme and
 *     `board.hedgeDecor` is reassigned to the fresh array.
 *
 * Pickups (bones/fruit/coin/golden bone) are untouched — they keep fixed
 * identity colors in every theme (see makeBone/makeFruit/makeCoin/
 * makeLifeBone above) and are never read from ThemePalette.
 */
export function applyBoardTheme(board: Board, scene: THREE.Object3D, grid: Grid, theme: MazeTheme): void {
  syncBoardMaterials(theme.palette);

  board.hedgeDecor.forEach((mesh) => {
    scene.remove(mesh);
    const mat = mesh.material;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat.dispose();
    // geometry (geoBloom/geoLeafSpeck) is a shared module-level constant —
    // intentionally NOT disposed here, it's reused by the next build.
  });

  board.hedgeDecor = buildHedgeDecor(scene, grid, theme.palette);
}

/**
 * Removes and disposes the pellet mesh at `key` ("tx,ty"), if any, and
 * decrements board.pelletsLeft. Returns the eaten pellet's kind, or null if
 * there was no pellet there (e.g. already eaten).
 */
export function eatPellet(board: Board, key: string): PelletKind | null {
  const entry = board.pelletMeshes.get(key);
  if (!entry) return null;
  entry.mesh.removeFromParent();
  board.pelletMeshes.delete(key);
  board.pelletsLeft--;
  return entry.kind;
}

/**
 * Spawns a fruit mesh at tile (tx,ty), replacing any fruit already on the
 * board (prototype maybeSpawnFruit only ever keeps one at a time). Placement
 * (which tile, when) is entirely gameplay's call — this just builds the mesh
 * and tracks it on the board so clearFruit/spinDecor and eating can find it.
 */
export function spawnFruit(board: Board, scene: THREE.Object3D, tx: number, ty: number): void {
  if (board.fruit) clearFruit(board, scene);
  const fruit = makeFruit();
  fruit.position.set(worldX(tx), 0.35, worldZ(ty));
  scene.add(fruit);
  board.fruit = fruit;
}

/** Removes the current fruit mesh (if any) from the scene and the board. */
export function clearFruit(board: Board, scene: THREE.Object3D): void {
  if (!board.fruit) return;
  scene.remove(board.fruit);
  board.fruit = null;
}

/**
 * Spawns a coin mesh at tile (tx,ty), replacing any coin already on the board
 * (mirrors spawnFruit — only one coin at a time). Placement is gameplay's
 * call; this just builds the mesh and tracks it on the board so
 * clearCoin/spinDecor and eating can find it.
 *
 * TODO(render-artist IDEA-017): currently builds makeCoin()'s placeholder
 * disc — swap that function's body for the real mesh, this call site and
 * signature should not need to change.
 */
export function spawnCoin(board: Board, scene: THREE.Object3D, tx: number, ty: number): void {
  if (board.coin) clearCoin(board, scene);
  const coin = makeCoin();
  coin.position.set(worldX(tx), 0.35, worldZ(ty));
  scene.add(coin);
  board.coin = coin;
}

/** Removes the current coin mesh (if any) from the scene and the board. */
export function clearCoin(board: Board, scene: THREE.Object3D): void {
  if (!board.coin) return;
  scene.remove(board.coin);
  board.coin = null;
}

/**
 * IDEA-018: spawns the bonus-life golden-bone mesh at tile (tx,ty), replacing
 * any life pickup already on the board (mirrors spawnCoin/spawnFruit — only
 * one at a time). Placement (which tile, when) is gameplay's call; this just
 * builds the mesh and tracks it on the board so clearLife/spinDecor and
 * eating can find it.
 */
export function spawnLife(board: Board, scene: THREE.Object3D, tx: number, ty: number): void {
  if (board.life) clearLife(board, scene);
  const life = makeLifeBone();
  life.position.set(worldX(tx), 0.35, worldZ(ty));
  scene.add(life);
  board.life = life;
}

/** IDEA-018: removes the current bonus-life mesh (if any) from the scene and the board. */
export function clearLife(board: Board, scene: THREE.Object3D): void {
  if (!board.life) return;
  scene.remove(board.life);
  board.life = null;
}

/**
 * Gentle idle spin for decorative pickups (prototype syncMeshes, lines
 * 582-583): bones spin a bit faster than the fruit. Biscuits don't spin in
 * the prototype, so they're left untouched here.
 *
 * IDEA-016/IDEA-017: the coin spins fastest of all (a coin-flip read), so it
 * visually reads as distinct from the fruit even with the placeholder mesh —
 * render-artist: feel free to retune this rate once the real mesh lands.
 *
 * IDEA-018: the golden life-bone spins at the coin's faster rate (dt*3)
 * rather than the regular pellet bone's dt*2, so its rarity/specialness
 * reads at a glance, distinct from the far more common pellet bones.
 */
export function spinDecor(board: Board, dt: number): void {
  board.pelletMeshes.forEach((p) => {
    if (p.kind === "bone") p.mesh.rotation.y += dt * 2;
  });
  if (board.fruit) board.fruit.rotation.y += dt * 1.5;
  if (board.coin) board.coin.rotation.y += dt * 3;
  if (board.life) board.life.rotation.y += dt * 3;
}
