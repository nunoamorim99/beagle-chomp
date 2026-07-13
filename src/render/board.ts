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
//
// v4.1 "Set Dressing": theme.props (density populations) is gone, replaced by
// a reusable PROP LIBRARY (src/game/props.ts's PropDef/PropParams) referenced
// BY ID from two kinds of explicit, hand-authored placement:
//   - theme.placements ([[IDEA-030]]) — apron props, exactly where the editor
//     put them (see buildProps below).
//   - theme.wallDecor ([[IDEA-031]]) — wall-top components (lamps, signs,
//     blooms), exactly where the editor put them (see buildWallDecor below).
// A theme with an empty wallDecor still gets the original density-scattered
// hedge blooms (buildHedgeDecor, unchanged) as a fallback — a theme either
// hand-places wall components OR gets scattered palette blooms, never both.
import * as THREE from "three";
import { Grid, COLS, ROWS, TILE, worldX, worldZ } from "../game/grid";
import { getEquippedMazeTheme, type MazeTheme, type ThemePalette, type PropPlacement, type WallDecorPlacement } from "../game/themes";
import {
  getPropDef,
  type PropDef,
  type PropBaseShape,
  type PropParams,
  type PropPartEdit,
  type AddedPropPart,
  type PropPrimKind,
} from "../game/props";

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
  /** IDEA-011 hedge-top decoration, now DUAL-PURPOSE as of v4.1 "Set
   *  Dressing" (see the module doc comment above):
   *   - `theme.wallDecor` EMPTY (garden/forest/beach/park): the original
   *     density-scattered blooms/specks — a handful of THREE.InstancedMesh,
   *     one per bloom color + one for leaf specks (buildHedgeDecor, entirely
   *     unchanged from IDEA-011/IDEA-026).
   *   - `theme.wallDecor` NON-EMPTY (city): explicit hand-placed wall-top
   *     PROP components (lamps/signs/blooms from the prop library), one
   *     THREE.Group per placement (buildWallDecor, new in v4.1).
   *  A theme gets ONE of the two, never both (see buildBoard's dispatch)— so
   *  this array is always either all InstancedMesh or all Group, never mixed
   *  — but it's typed as the common `THREE.Object3D` supertype so game.ts's
   *  teardown loop (`level.board.hedgeDecor.forEach((m) =>
   *  this.rig.scene.remove(m))`) keeps working unchanged for either kind
   *  (folded here deliberately so the wall-decor addition needs NO game.ts
   *  change — see applyBoardTheme's disposal below for why the two kinds
   *  still dispose correctly despite sharing this one array). Purely
   *  cosmetic, lives for the level like the walls do — not tracked per-tile
   *  like pellets. Entirely rebuilt by applyBoardTheme on a mid-run
   *  re-theme — never mutated in place like matWall/matFloor/matBiscuit,
   *  since the SET (and even the kind) of decor can itself change. */
  hedgeDecor: THREE.Object3D[];
  /** IDEA-030 (v4.1 "Set Dressing" — was IDEA-026's density-scattered theme
   *  props): every apron PROP mesh from `theme.placements`, in ONE container
   *  Group so teardown is a single `scene.remove` + traverse-dispose (see
   *  buildProps' doc comment for exactly what "traverse-dispose" means here —
   *  props own their materials outright, nothing shared with matWall/
   *  matFloor/matBiscuit/hedgeDecor). `null` for a theme with an empty
   *  `placements` array (classic) — zero group, zero traverse cost, not just
   *  zero children. */
  props: THREE.Group | null;
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

  const hedgeDecor = buildWallTopDecor(scene, grid, theme);
  const props = buildProps(scene, theme);

  return { pelletMeshes, pelletsLeft, walls, floor, fruit: null, coin: null, life: null, hedgeDecor, props };
}

/**
 * v4.1 "Set Dressing": the single dispatch point deciding which of the two
 * wall-top decor mechanisms a theme gets — see Board.hedgeDecor's doc comment
 * for the "never both" contract this enforces. Shared by buildBoard (fresh
 * level) and applyBoardTheme (mid-run re-theme) so the two can never drift.
 * buildWallDecor returns ONE container Group (mirrors buildProps' own
 * single-Group shape) — folded into the single-element array
 * `[group]` here so Board.hedgeDecor stays a flat `THREE.Object3D[]` either
 * way (see Board.hedgeDecor's doc comment for why that folding is exactly
 * what lets this whole feature ship with NO game.ts change: its teardown
 * loop just calls `scene.remove` per array entry, which works identically
 * whether the entry is an InstancedMesh or this one wall-decor Group).
 */
function buildWallTopDecor(scene: THREE.Object3D, grid: Grid, theme: MazeTheme): THREE.Object3D[] {
  if (theme.wallDecor.length > 0) {
    const group = buildWallDecor(scene, theme);
    return group ? [group] : [];
  }
  return buildHedgeDecor(scene, grid, theme.palette);
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
 *
 * v4.1: unchanged in every particular (kept EXACTLY, per the task brief) —
 * this is the fallback path for a theme with an empty `wallDecor` (see
 * buildWallTopDecor above and Board.hedgeDecor's doc comment). Return type
 * widened to THREE.Object3D[] only so it unifies with buildWallDecor's own
 * return type (both InstancedMesh and Group are Object3D — no behavior
 * change, still literally InstancedMesh instances at runtime).
 */
function buildHedgeDecor(
  scene: THREE.Object3D,
  grid: Grid,
  palette: ThemePalette,
): THREE.Object3D[] {
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

// ---------------------------------------------------------------------------
// v4.1 "Set Dressing" — theme PROPS, now built from the REUSABLE prop library
// (src/game/props.ts's PropDef/PropParams) instead of IDEA-026's density
// populations. Nuno's original ask still holds ("on the garden add some
// shrubs, on the night city some lighting stations, on the beach some beach
// umbrella... buildings"), but a PropDef is now a named, hand-tunable
// definition referenced BY ID from any theme's explicit placements
// (theme.placements — apron — or theme.wallDecor — wall tops), so "Oak" or
// "Skyscraper" can appear in many themes and be personalized once rather than
// re-described per theme. Props are a SEPARATE decoration layer from
// buildHedgeDecor's density-scatter fallback above (which lives ON the wall
// tops): apron props stand on the 1-tile ring of floor surrounding the maze,
// so they dress the world the board sits in without ever competing with
// gameplay for a play tile; wall-top props sit directly on a wall's hedge top
// (see buildWallDecor below).
//
// One factory per PropBaseShape (below), each reading its own slice of
// PropParams with the DEFAULTS documented in props.ts's PropParams doc, all
// primitive-based and built with the same MeshStandardMaterial language
// board.ts/characters.ts already use everywhere else (modest roughness, no
// flatShading — flatShading was auditioned for characters and dropped, see
// characters.ts line ~128 — and emissive reserved for things that are
// actually "lit", i.e. windows/lamp heads/blooms/signs, not foliage). Every
// factory returns a THREE.Group centered on its own local origin (no baked
// position/rotation/scale) so buildProps/buildWallDecor can freely position/
// rotate/scale each instance uniformly, and every factory builds its OWN
// materials (never module-level shared ones like matWall) — see buildProps'
// doc comment for why: a single container Group is disposed as a whole on
// teardown/re-theme, so nothing here can be a shared singleton the
// walls/floor/biscuits also reference.

/** Height class for camera-safety capping (see buildProps' per-side rules
 *  below): "tall" props are skyline-scale and must never stand where they'd
 *  block the view of the board from the fixed camera; "medium" are eye-level
 *  street furniture; "low" hug the ground (or a wall top) and are always
 *  safe in front. Derived from the SHAPE (not the individual def) per the
 *  task brief — every def sharing a base shape shares its camera-safety
 *  class, since the shape is what determines silhouette scale. */
type PropHeightClass = "tall" | "medium" | "low";

const PROP_HEIGHT_CLASS: Record<PropBaseShape, PropHeightClass> = {
  building: "tall",
  pine: "tall",
  palm: "tall",
  tree: "medium",
  streetlight: "medium",
  umbrella: "medium",
  shrub: "low",
  bloom: "low",
  sign: "low",
};

// Fixed default trunk color family for every woody prop (tree/pine/palm) —
// independent of the def's own `foliageColors` (reserved for FOLIAGE/canopy —
// the part that actually varies by theme), matching board.ts's own floor
// brown (0x6b4a2f) so trunks read as "the same wood" across every theme
// rather than each def inventing its own bark hue. A def's own
// `params.trunkColor` overrides this per-shape default (see props.ts).
// Deliberately NOT a shared module-level THREE.MeshStandardMaterial (unlike
// matWall/matFloor/matBiscuit above) — makeTrunkMat below is called fresh by
// every tree/pine/palm instance so each prop's disposal is fully
// self-contained (see buildProps' doc comment: "every mesh gets its OWN
// material... so board.props can be disposed as a self-contained unit
// without any risk of double-disposing"). A shared constant here would mean
// disposePropGroup's traverse-dispose invalidates EVERY trunk still standing
// after the very first prop teardown — a real bug this per-call factory
// avoids entirely, at a negligible cost (prop counts are capped at
// MAX_TOTAL_PROPS=40, so at most a few dozen tiny extra material objects).
const DEFAULT_TRUNK_COLOR = 0x6b4a2f;
const DEFAULT_POLE_COLOR = 0x2a2a30; // streetlight/sign poles
const DEFAULT_UMBRELLA_POLE_COLOR = 0xdedede;

function makeTrunkMat(color = DEFAULT_TRUNK_COLOR): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.75 });
}

/** Picks one entry from `colors` deterministically via an already-computed
 *  hash01 value in [0,1) — shared by every factory that takes a color list,
 *  so "which color this instance gets" is one obvious idiom throughout. */
function pickColor(colors: readonly number[], h: number): number {
  return colors[Math.floor(h * colors.length) % colors.length];
}

/** shrub — 2-3 overlapping squashed spheres, low and rounded.
 *  - `params.foliageColors` (default the classic garden greens) — per-lobe
 *    color pick via `h`.
 *  - `params.width` (default 1) scales the whole lobe cluster's footprint.
 *  - `params.segments` (default 3, clamped 2-3) sets the lobe COUNT
 *    deterministically (was hash-driven "60% of the time" pre-v4.1 — now the
 *    def itself picks 2 vs 3, with `h` still choosing WHICH lobes/color so
 *    instances of the same def still look individual).
 *  `h` is a 0..1 instance hash driving color pick (and, for a 2-lobe def,
 *  which 2 of the 3 authored lobe slots appear). */
function makeShrub(params: PropParams, h: number): THREE.Group {
  const g = new THREE.Group();
  const colors = params.foliageColors ?? [0x4e9a3e, 0x3f8f3a, 0x5fae4d];
  const width = params.width ?? 1;
  const segments = THREE.MathUtils.clamp(Math.round(params.segments ?? 3), 2, 3);

  const mat = new THREE.MeshStandardMaterial({ color: pickColor(colors, h), roughness: 0.65 });
  const lobes: Array<[number, number, number, number]> = [
    [0, 0.12, 0, 0.22],
    [0.13, 0.15, 0.05, 0.17],
    [-0.12, 0.14, -0.06, 0.17],
  ];
  for (let i = 0; i < segments; i++) {
    const [x, y, z, r] = lobes[i];
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(r * width, 10, 8), mat);
    sphere.name = `lobe${i}`; // IDEA-033: addressable part name — see applyPropParts
    sphere.position.set(x * width, y, z * width);
    sphere.scale.y = 0.72; // squashed, low-and-rounded read
    sphere.castShadow = true;
    g.add(sphere);
  }
  return g;
}

/** tree — trunk + a stack of 1-3 foliage crown spheres.
 *  - `params.trunkColor` (default DEFAULT_TRUNK_COLOR), `params.foliageColors`
 *    (default the classic garden greens).
 *  - `params.height` (default 1) scales overall Y (trunk length + crown
 *    stack height); `params.width` (default 1) scales trunk+crown girth.
 *  - `params.segments` (default 2, clamped 1-3) sets crown sphere COUNT —
 *    was fixed at exactly 2 pre-v4.1 (crownLo+crownHi); now 1 gives a single
 *    round canopy, 3 stacks a taller, fuller crown. */
function makeTree(params: PropParams, h: number): THREE.Group {
  const g = new THREE.Group();
  const colors = params.foliageColors ?? [0x4e9a3e, 0x5fae4d];
  const height = params.height ?? 1;
  const width = params.width ?? 1;
  const segments = THREE.MathUtils.clamp(Math.round(params.segments ?? 2), 1, 3);

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045 * width, 0.06 * width, 0.42 * height, 8),
    makeTrunkMat(params.trunkColor),
  );
  trunk.name = "trunk"; // IDEA-033: addressable part name — see applyPropParts
  trunk.position.y = 0.21 * height;
  trunk.castShadow = true;
  g.add(trunk);

  const foliageMat = new THREE.MeshStandardMaterial({ color: pickColor(colors, h), roughness: 0.6 });
  // Crown spheres stack upward from just above the trunk, each a touch
  // smaller than the last — segments=2 reproduces the exact pre-v4.1
  // crownLo/crownHi radii/positions.
  const crownBaseY = 0.42 * height;
  const crownStep = 0.24 * height;
  for (let i = 0; i < segments; i++) {
    const r = (0.28 - i * 0.07) * width;
    const crown = new THREE.Mesh(new THREE.SphereGeometry(Math.max(r, 0.08), 12, 10), foliageMat);
    crown.name = `crown${i}`; // IDEA-033
    crown.position.y = crownBaseY + i * crownStep;
    crown.castShadow = true;
    g.add(crown);
  }

  return g;
}

/** pine — trunk + 2-4 stacked cones, noticeably taller than makeTree.
 *  - `params.trunkColor`, `params.foliageColors` (default deep conifer
 *    greens).
 *  - `params.height` (default 1) scales overall Y (trunk + cone-tier
 *    heights/positions); `params.width` (default 1) scales trunk+cone
 *    radii.
 *  - `params.segments` (default 3, clamped 2-4) sets the tier COUNT —
 *    was fixed at exactly 3 pre-v4.1; a 4th tier is a smaller/higher cone
 *    continuing the same taper the first 3 establish, so the def stays a
 *    single continuous conifer silhouette at any tier count. */
function makePine(params: PropParams, h: number): THREE.Group {
  const g = new THREE.Group();
  const colors = params.foliageColors ?? [0x2e6b34, 0x24552a, 0x3a7a40];
  const height = params.height ?? 1;
  const width = params.width ?? 1;
  const segments = THREE.MathUtils.clamp(Math.round(params.segments ?? 3), 2, 4);

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05 * width, 0.07 * width, 0.5 * height, 8),
    makeTrunkMat(params.trunkColor),
  );
  trunk.name = "trunk"; // IDEA-033: addressable part name — see applyPropParts
  trunk.position.y = 0.25 * height;
  trunk.castShadow = true;
  g.add(trunk);

  const foliageMat = new THREE.MeshStandardMaterial({ color: pickColor(colors, h), roughness: 0.65 });
  // Tiers taper radius/height by a fixed ratio per step (matches the
  // pre-v4.1 authored 3-tier sequence exactly at segments=3) and climb in Y
  // by a fixed step so consecutive cones keep overlapping enough to read as
  // one continuous canopy at any tier count.
  const tierStep = 0.34;
  for (let i = 0; i < segments; i++) {
    const r = (0.34 - i * 0.085) * width;
    const h2 = (0.5 - i * 0.08) * height;
    const y = (0.52 + i * tierStep) * height;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(Math.max(r, 0.08), Math.max(h2, 0.14), 10), foliageMat);
    cone.name = `tier${i}`; // IDEA-033
    cone.position.y = y;
    cone.castShadow = true;
    g.add(cone);
  }

  return g;
}

/** palm — a slightly tilted 2-segment trunk (curved read) + 4-5 drooping
 *  frond ellipsoids + a couple of tiny coconuts.
 *  - `params.trunkColor`, `params.foliageColors` (default beach-green
 *    fronds).
 *  - `params.height` (default 1) scales trunk-segment lengths + crown
 *    origin Y; `params.width` (default 1) scales trunk radii + frond
 *    length.
 *  - `params.tilt` (default 0.22 rad) — the lean applied to BOTH trunk
 *    segments (was a fixed 0.08/0.22 split pre-v4.1; now that split scales
 *    proportionally with the def's own tilt so a def authored with less
 *    lean reads as "less windswept" rather than snapping to a fixed lean). */
function makePalm(params: PropParams, h: number): THREE.Group {
  const g = new THREE.Group();
  const colors = params.foliageColors ?? [0x5fae4d, 0x4e9a3e];
  const height = params.height ?? 1;
  const width = params.width ?? 1;
  const tilt = params.tilt ?? 0.22;
  const tiltRatio = tilt / 0.22; // proportional to the original 0.08/0.22 authored split

  const trunkMat = makeTrunkMat(params.trunkColor);
  const lower = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05 * width, 0.07 * width, 0.4 * height, 8),
    trunkMat,
  );
  lower.name = "trunkLower"; // IDEA-033: addressable part name — see applyPropParts
  lower.position.set(0, 0.2 * height, 0);
  lower.rotation.z = 0.08 * tiltRatio;
  lower.castShadow = true;
  g.add(lower);

  const upper = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035 * width, 0.05 * width, 0.42 * height, 8),
    trunkMat,
  );
  upper.name = "trunkUpper"; // IDEA-033
  upper.position.set(0.09 * width, 0.58 * height, 0);
  upper.rotation.z = tilt;
  upper.castShadow = true;
  g.add(upper);

  const crownOrigin = new THREE.Vector3(0.17 * width, 0.8 * height, 0);
  const frondMat = new THREE.MeshStandardMaterial({ color: pickColor(colors, h), roughness: 0.55 });
  const frondCount = 4 + (h > 0.5 ? 1 : 0); // 4-5 fronds
  for (let i = 0; i < frondCount; i++) {
    const angle = (i / frondCount) * Math.PI * 2 + h * 1.7;
    const frond = new THREE.Mesh(new THREE.SphereGeometry(0.3 * width, 8, 6), frondMat);
    frond.name = `frond${i}`; // IDEA-033
    frond.position.copy(crownOrigin);
    frond.position.x += Math.cos(angle) * 0.16 * width;
    frond.position.z += Math.sin(angle) * 0.16 * width;
    // Flattened + elongated along its own outward axis, tipped downward for
    // the drooping-frond read.
    frond.scale.set(1.7, 0.22, 0.55);
    frond.rotation.y = angle;
    frond.rotation.z = -0.5;
    frond.castShadow = true;
    g.add(frond);
  }

  // A tiny coconut cluster tucked under the crown.
  const coconutMat = new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 0.7 });
  for (let i = 0; i < 2; i++) {
    const coconut = new THREE.Mesh(new THREE.SphereGeometry(0.045 * width, 6, 6), coconutMat);
    coconut.name = `coconut${i}`; // IDEA-033
    coconut.position.set(crownOrigin.x + (i === 0 ? -0.05 : 0.06) * width, crownOrigin.y - 0.08 * height, i === 0 ? 0.04 * width : -0.05 * width);
    coconut.castShadow = true;
    g.add(coconut);
  }

  return g;
}

// Lit-window layout for makeBuilding: a deterministic grid of thin emissive
// boxes on the two visible-ish facades (+X and +Z — the faces most likely to
// catch the camera from its fixed north-looking angle). Positions are
// FRACTIONS of the tower's own width/height (multiplied out in makeBuilding
// once the instance's actual footprint/height are known) so the layout
// scales cleanly across any footprint/height. `windowRows`/`windowCols`
// (default 2x2 = 8 windows total across both faces, unchanged from pre-v4.1)
// pick how many evenly-spaced fractional rows/cols to use; 0 of either means
// an unlit tower (rooftop/facade only).
function windowFractions(count: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [0.5];
  // Evenly spaced within a [0.2, 0.8] band (matches the pre-v4.1 authored
  // 2-row/2-col band [0.28..0.72]/[0.32..0.68] at count=2 closely enough to
  // be visually identical, while generalizing to any count).
  const lo = 0.22;
  const hi = 0.78;
  return Array.from({ length: count }, (_, i) => lo + ((hi - lo) * i) / (count - 1));
}

/** building — a box tower (facade hue from colors) + an optional smaller
 *  rooftop box + a deterministic grid of lit windows on two faces so towers
 *  read alive under Night City's dusk light.
 *  - `params.facadeColors` (default greys), `params.height`/`params.width`
 *    (default 1 each) scale the tower's base story height/footprint on top
 *    of the existing hash-driven per-instance variance.
 *  - `params.windowRows`/`params.windowCols` (default 2/2) set the lit-
 *    window grid size per facade; 0 rows or 0 cols -> unlit tower.
 *  - `params.windowColor`/`params.windowEmissiveIntensity` (default warm
 *    0xf4d060 / 1.1) drive the window material.
 *  - `params.rooftop` (default true) toggles the smaller rooftop block
 *    (was hash-driven "on ~half of instances" pre-v4.1; now the DEF decides
 *    whether this building kind ever gets one, with `h` still choosing
 *    which half of instances show it when `rooftop` is true, preserving the
 *    per-instance variety). */
function makeBuilding(params: PropParams, h: number): THREE.Group {
  const g = new THREE.Group();
  const colors = params.facadeColors ?? [0x5a5a68, 0x6d6a78, 0x4a4a58, 0x7a7480];
  const heightMul = params.height ?? 1;
  const widthMul = params.width ?? 1;
  const windowRows = params.windowRows ?? 2;
  const windowCols = params.windowCols ?? 2;
  const windowColor = params.windowColor ?? 0xf4d060;
  const windowEmissiveIntensity = params.windowEmissiveIntensity ?? 1.1;
  const rooftop = params.rooftop ?? true;

  const footprint = (0.7 + h * 0.2) * widthMul; // ~0.7-0.9 tile pre-multiplier, per the original brief
  // Height is driven by BOTH the def's own height multiplier and the
  // INSTANCE's own hash `h` (short/tall variance survives per-instance even
  // within one def) — the geometry itself just picks a believable base
  // story count so short and tall instances (after scaling) both read as
  // buildings rather than one fixed silhouette stretched thin.
  const baseHeight = (1.1 + h * 0.9) * heightMul;

  const facadeMat = new THREE.MeshStandardMaterial({ color: pickColor(colors, h), roughness: 0.75 });
  const tower = new THREE.Mesh(new THREE.BoxGeometry(footprint, baseHeight, footprint), facadeMat);
  tower.name = "base"; // IDEA-033: addressable part name — see applyPropParts
  tower.position.y = baseHeight / 2;
  tower.castShadow = true;
  g.add(tower);

  // A smaller rooftop block, only if this def wants one at all AND on ~half
  // of instances (hash-driven), off-center so the skyline doesn't read as
  // identical box-on-box stamps.
  if (rooftop && h > 0.5) {
    const roofMat = new THREE.MeshStandardMaterial({ color: pickColor(colors, 1 - h), roughness: 0.75 });
    const roofSize = footprint * 0.48;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(roofSize, baseHeight * 0.3, roofSize), roofMat);
    roof.name = "rooftop"; // IDEA-033
    roof.position.set(footprint * 0.12, baseHeight + (baseHeight * 0.3) / 2, -footprint * 0.08);
    roof.castShadow = true;
    g.add(roof);
  }

  // Lit windows: thin emissive boxes, placed on the +X and +Z facades from
  // an evenly-spaced windowRows x windowCols grid (fractions of
  // footprint/baseHeight so the grid scales with the instance), sat just
  // proud of the facade so they never z-fight the tower box. 0 rows or 0
  // cols means no window meshes at all — an intentionally unlit tower.
  if (windowRows > 0 && windowCols > 0) {
    const windowMat = new THREE.MeshStandardMaterial({
      color: windowColor,
      emissive: windowColor,
      emissiveIntensity: windowEmissiveIntensity,
      roughness: 0.4,
    });
    const winW = footprint * (0.16 / windowCols) * 2; // narrower as columns increase, so a denser grid doesn't overlap
    const winH = baseHeight * (0.07 / windowRows) * 2;
    const winDepth = 0.012;
    const half = footprint / 2;

    // IDEA-033: sequential "window0".."windowN" across BOTH facades, in the
    // same row-major (rowFrac outer, colFrac inner) order this loop already
    // builds them — the +X facade's mesh for a given row/col comes first,
    // then the +Z facade's, so an edit targeting "window3" always resolves
    // to the same physical pane across rebuilds (the loop order never
    // changes for a fixed windowRows/windowCols).
    let windowIndex = 0;
    windowFractions(windowRows).forEach((rowFrac) => {
      windowFractions(windowCols).forEach((colFrac) => {
        const y = rowFrac * baseHeight;

        const winX = new THREE.Mesh(new THREE.BoxGeometry(winDepth, winH, winW), windowMat);
        winX.name = `window${windowIndex++}`;
        winX.position.set(half + winDepth / 2, y, (colFrac - 0.5) * footprint);
        g.add(winX);

        const winZ = new THREE.Mesh(new THREE.BoxGeometry(winW, winH, winDepth), windowMat);
        winZ.name = `window${windowIndex++}`;
        winZ.position.set((colFrac - 0.5) * footprint, y, half + winDepth / 2);
        g.add(winZ);
      });
    });
  }

  return g;
}

/** streetlight — thin dark pole + small arm + a glowing head sphere. NO
 *  PointLight (perf/shadow budget, per the brief) — the emissive sphere
 *  alone reads as lit under the tuned ACES exposure every theme shares.
 *  - `params.trunkColor` doubles as the pole color here (default
 *    DEFAULT_POLE_COLOR — a dark street-furniture grey, distinct from the
 *    woody trunk default) — reusing the same param slot per props.ts's
 *    documented per-shape default rather than adding a dedicated
 *    `poleColor` field.
 *  - `params.height` (default 1) scales pole+arm length/position.
 *  - `params.glowColor`/`params.glowIntensity` (default warm 0xf4d060/0.9)
 *    drive the lamp head. */
function makeStreetlight(params: PropParams, h: number): THREE.Group {
  const g = new THREE.Group();
  const poleColor = params.trunkColor ?? DEFAULT_POLE_COLOR;
  const height = params.height ?? 1;
  const glowColors = params.glowColor !== undefined ? [params.glowColor] : [0xf4d060];
  const glowIntensity = params.glowIntensity ?? 0.9;

  const poleMat = new THREE.MeshStandardMaterial({ color: poleColor, roughness: 0.55, metalness: 0.3 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.85 * height, 8), poleMat);
  pole.name = "pole"; // IDEA-033: addressable part name — see applyPropParts
  pole.position.y = 0.425 * height;
  pole.castShadow = true;
  g.add(pole);

  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.22, 6), poleMat);
  arm.name = "arm"; // IDEA-033
  arm.position.set(0.09, 0.82 * height, 0);
  arm.rotation.z = Math.PI / 2;
  arm.castShadow = true;
  g.add(arm);

  const headColor = pickColor(glowColors, h);
  const headMat = new THREE.MeshStandardMaterial({
    color: headColor,
    emissive: headColor,
    emissiveIntensity: glowIntensity,
    roughness: 0.3,
  });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), headMat);
  head.name = "head"; // IDEA-033
  head.position.set(0.19, 0.8 * height, 0);
  head.castShadow = true;
  g.add(head);

  return g;
}

/** umbrella — pole + a squashed cone canopy, slight tilt for a beach-casual
 *  read. ~Half get a second canopy color as a darker tip sphere accent
 *  (an alternating-look nod without a full multi-gore canopy).
 *  - `params.trunkColor` doubles as the pole color (default
 *    DEFAULT_UMBRELLA_POLE_COLOR — a light aluminium grey, distinct from the
 *    woody trunk default).
 *  - `params.foliageColors` (default beach-parasol colors) drives the
 *    canopy + tip accent.
 *  - `params.height`/`params.width` (default 1 each) scale pole length and
 *    canopy radius respectively.
 *  - `params.tilt` (default 0.12 rad) replaces the pre-v4.1 hash-driven
 *    `(h-0.5)*0.14` tilt (max ~0.07 rad either way) with a def-level lean,
 *    still applied with the same left/right hash-driven sign so instances
 *    of one def don't all lean the same way. */
function makeUmbrella(params: PropParams, h: number): THREE.Group {
  const g = new THREE.Group();
  const poleColor = params.trunkColor ?? DEFAULT_UMBRELLA_POLE_COLOR;
  const colors = params.foliageColors ?? [0xf29a8a, 0x5fc8c0, 0xf2d43a, 0xf4efe6];
  const height = params.height ?? 1;
  const width = params.width ?? 1;
  const tilt = params.tilt ?? 0.12;

  const poleMat = new THREE.MeshStandardMaterial({ color: poleColor, roughness: 0.5, metalness: 0.15 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.66 * height, 8), poleMat);
  pole.name = "pole"; // IDEA-033: addressable part name — see applyPropParts
  pole.position.y = 0.33 * height;
  pole.castShadow = true;
  g.add(pole);

  const canopyColor = pickColor(colors, h);
  const canopyMat = new THREE.MeshStandardMaterial({ color: canopyColor, roughness: 0.5 });
  const canopy = new THREE.Mesh(new THREE.ConeGeometry(0.34 * width, 0.24, 10), canopyMat);
  canopy.name = "canopy"; // IDEA-033
  canopy.position.y = 0.68 * height;
  canopy.castShadow = true;
  g.add(canopy);

  // ~Half get a contrasting tip in a second palette color, and every canopy
  // gets a slight tilt (beach-casual, never perfectly vertical) sized off
  // the def's own `tilt`, sign chosen by the hash so instances vary.
  if (h > 0.5 && colors.length > 1) {
    const tipColor = pickColor(colors, (h + 0.5) % 1);
    const tipMat = new THREE.MeshStandardMaterial({ color: tipColor, roughness: 0.5 });
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.045 * width, 8, 6), tipMat);
    tip.name = "tip"; // IDEA-033
    tip.position.y = 0.81 * height;
    tip.castShadow = true;
    g.add(tip);
  }
  g.rotation.z = (h - 0.5) * (tilt / 0.07); // preserves the original max-~0.07-rad-either-way feel at the default tilt

  return g;
}

/** bloom — a tiny flower/sphere on a thin stem: the wall-top flower
 *  ([[IDEA-031]]), colored by `glowColor` with `glowIntensity` emissive (same
 *  visual language as board.ts's own buildHedgeDecor blooms — geoBloom's
 *  0.075-radius sphere, color==emissive). Deliberately small (wall-top
 *  scale) so it never looks out of place stacked among hand-placed
 *  lamps/signs on a hedge top.
 *  - `params.width` (default 1) scales the whole bloom+stem.
 *  - `params.glowColor`/`params.glowIntensity` (default warm yellow/0.25,
 *    matching the garden's own first bloom color) drive the flower's
 *    emissive material. */
function makeBloom(params: PropParams, h: number): THREE.Group {
  const g = new THREE.Group();
  const width = params.width ?? 1;
  const glowColor = params.glowColor ?? 0xf2d43a;
  const glowIntensity = params.glowIntensity ?? 0.25;

  const stemMat = new THREE.MeshStandardMaterial({ color: 0x4a6a2e, roughness: 0.6 });
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012 * width, 0.015 * width, 0.1 * width, 6), stemMat);
  stem.name = "stem"; // IDEA-033: addressable part name — see applyPropParts
  stem.position.y = 0.05 * width;
  stem.castShadow = true;
  g.add(stem);

  const bloomMat = new THREE.MeshStandardMaterial({
    color: glowColor,
    roughness: 0.5,
    emissive: glowColor,
    emissiveIntensity: glowIntensity,
  });
  const bloom = new THREE.Mesh(new THREE.SphereGeometry(0.075 * width, 8, 8), bloomMat);
  bloom.name = "bloom"; // IDEA-033
  bloom.position.y = 0.13 * width;
  // A tiny per-instance jitter on the bloom head so a row of blooms doesn't
  // look perfectly identical stamped side by side.
  bloom.scale.setScalar(0.85 + h * 0.3);
  bloom.castShadow = true;
  g.add(bloom);

  return g;
}

/** sign — a thin post + a small glowing element: a warm round head for a
 *  streetlamp-style wall piece, or a small rectangular board (in
 *  `signBoardColor`) with a `glowColor`-emissive face for a transit signal.
 *  Kept small (wall-top scale, per the task brief) — this is the SAME
 *  physical shape for both "lamp-post" and "transit-sign" library defs, the
 *  visual difference coming entirely from params (a def with no
 *  `signBoardColor` reads as a bare glowing lamp head; one WITH it grows the
 *  small board behind the glow face).
 *  - `params.trunkColor` doubles as the post color (default
 *    DEFAULT_POLE_COLOR).
 *  - `params.height` (default 0.7) sets the post length.
 *  - `params.glowColor`/`params.glowIntensity` (default warm 0xf4d060/0.85)
 *    drive the glow face/head.
 *  - `params.signBoardColor` (default undefined -> no board, just a round
 *    lamp head) sets the board color when present. */
function makeSign(params: PropParams, h: number): THREE.Group {
  const g = new THREE.Group();
  const postColor = params.trunkColor ?? DEFAULT_POLE_COLOR;
  const height = params.height ?? 0.7;
  const glowColor = params.glowColor ?? 0xf4d060;
  const glowIntensity = params.glowIntensity ?? 0.85;
  const boardColor = params.signBoardColor;

  const postMat = new THREE.MeshStandardMaterial({ color: postColor, roughness: 0.55, metalness: 0.3 });
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.024, height, 8), postMat);
  post.name = "post"; // IDEA-033: addressable part name — see applyPropParts
  post.position.y = height / 2;
  post.castShadow = true;
  g.add(post);

  const glowMat = new THREE.MeshStandardMaterial({
    color: glowColor,
    emissive: glowColor,
    emissiveIntensity: glowIntensity,
    roughness: 0.3,
  });

  if (boardColor !== undefined) {
    // Transit-signal read: a small rectangular board mounted near the top of
    // the post, with a glowing face plate slightly proud of it.
    const boardMat = new THREE.MeshStandardMaterial({ color: boardColor, roughness: 0.5, metalness: 0.2 });
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.13, 0.02), boardMat);
    board.name = "board"; // IDEA-033
    board.position.set(0, height * 0.92, 0.01);
    board.castShadow = true;
    g.add(board);

    const face = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.008), glowMat);
    face.name = "face"; // IDEA-033
    face.position.set(0, height * 0.92, 0.021);
    face.castShadow = true;
    g.add(face);
  } else {
    // Bare lamp-head read: a small warm glowing sphere atop the post,
    // deterministically nudged by `h` so a row of wall lamps varies slightly.
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.055 + h * 0.01, 8, 8), glowMat);
    head.name = "head"; // IDEA-033
    head.position.y = height + 0.03;
    head.castShadow = true;
    g.add(head);
  }

  return g;
}

// ---------------------------------------------------------------------------
// IDEA-033 "Props as editable part-assemblies" — applies an OPTIONAL
// def.parts layer (src/game/props.ts's PropPartLayer) on top of the base
// shape a factory above just built. Every factory now names its own parts
// (see the "IDEA-033" comments threaded through makeShrub..makeSign above) so
// they're addressable by a stable path; this function builds the SAME
// depth-first path map src/editor/partTree.ts's buildPartList uses (slash-
// joined child indices from the root, "" = the root itself) so an edit
// authored in the editor — which reads that exact tree — always resolves to
// the right node here, at real render time, with zero drift between the two.

/** Depth-first path -> object map for `root`, identical traversal order to
 *  partTree.ts's buildPartList (children visited in `.children` array
 *  order, same index-based path scheme) — kept here, not imported from
 *  src/editor/ (a dev-only tree), since board.ts must stay usable without
 *  ever importing the editor; the two are independently small and the
 *  traversal itself is a five-line contract neither side is likely to
 *  drift on silently (a mismatch would show up immediately as edits
 *  landing on the wrong part in every playtest, not just in the editor). */
function pathMap(root: THREE.Object3D): Map<string, THREE.Object3D> {
  const map = new Map<string, THREE.Object3D>();
  function visit(object: THREE.Object3D, path: string): void {
    map.set(path, object);
    object.children.forEach((child, i) => visit(child, path === "" ? String(i) : `${path}/${i}`));
  }
  visit(root, "");
  return map;
}

/** The live counterpart of src/editor/codegen.ts's GEOMETRY_CTORS, scoped to
 *  the 4 kinds a prop can add (see PropPrimKind — no "capsule": props are
 *  hard-surface/foliage silhouettes, not character-scale organic shapes). */
function buildPropPrimitiveGeometry(kind: PropPrimKind, p: Record<string, number>): THREE.BufferGeometry {
  switch (kind) {
    case "box":
      return new THREE.BoxGeometry(p.width, p.height, p.depth);
    case "sphere":
      return new THREE.SphereGeometry(p.radius, 16, 12);
    case "cylinder":
      return new THREE.CylinderGeometry(p.radiusTop, p.radiusBottom, p.height, 16);
    case "cone":
      return new THREE.ConeGeometry(p.radius, p.height, 16);
  }
}

/** Applies one PropPartEdit to the base part it targets — a no-op (not an
 *  error) if `edit.path` doesn't resolve, which happens legitimately when a
 *  def edited under one shape/params combination is later viewed after a
 *  shape swap or a params change that changes the child COUNT (e.g.
 *  `segments` shrinking a shrub from 3 lobes to 2 — "lobe2"'s edit simply
 *  has nothing to apply to until segments grows back). This mirrors
 *  applyPropParts' own "degrade gracefully, never throw" discipline (see its
 *  header) rather than validating paths against a specific def+params combo
 *  up front. */
function applyPropPartEdit(map: Map<string, THREE.Object3D>, edit: PropPartEdit): void {
  const target = map.get(edit.path);
  if (!target) return;
  if (edit.position) target.position.set(edit.position[0], edit.position[1], edit.position[2]);
  if (edit.rotation) target.rotation.set(edit.rotation[0], edit.rotation[1], edit.rotation[2]);
  if (edit.scale) target.scale.set(edit.scale[0], edit.scale[1], edit.scale[2]);
  if (edit.visible !== undefined) target.visible = edit.visible;
  if ((edit.color !== undefined || edit.emissive !== undefined) && target instanceof THREE.Mesh) {
    const mat = target.material;
    const mats = Array.isArray(mat) ? mat : [mat];
    for (const m of mats) {
      if (!(m instanceof THREE.MeshStandardMaterial)) continue;
      if (edit.color !== undefined) m.color.setHex(edit.color);
      // Emissive override only takes effect on a part the base factory
      // already lit (emissiveIntensity > 0) — recoloring a NON-emissive
      // part's emissive channel would silently make it glow, which is never
      // what "recolor this part" means for e.g. a building's plain facade.
      if (edit.emissive !== undefined && m.emissiveIntensity > 0) m.emissive.setHex(edit.emissive);
    }
  }
}

/** Builds + attaches one AddedPropPart under its recorded parent path —
 *  falls back to the prop's own root ("") if the parent path doesn't
 *  resolve (same "degrade gracefully" reasoning as applyPropPartEdit above:
 *  an added part should never simply vanish from the built mesh just
 *  because its intended parent isn't present under the current
 *  shape/params). */
function addPropPart(root: THREE.Object3D, map: Map<string, THREE.Object3D>, added: AddedPropPart): void {
  const parent = map.get(added.parentPath) ?? root;
  const mat = new THREE.MeshStandardMaterial({
    color: added.color,
    roughness: 0.6,
    ...(added.emissive !== undefined ? { emissive: added.emissive, emissiveIntensity: 0.8 } : {}),
  });
  const mesh = new THREE.Mesh(buildPropPrimitiveGeometry(added.kind, added.params), mat);
  mesh.name = added.id;
  mesh.position.set(added.position[0], added.position[1], added.position[2]);
  if (added.rotation) mesh.rotation.set(added.rotation[0], added.rotation[1], added.rotation[2]);
  if (added.scale) mesh.scale.set(added.scale[0], added.scale[1], added.scale[2]);
  mesh.castShadow = true;
  parent.add(mesh);
}

/** Applies `def.parts` (edits then added primitives, in that order — an
 *  added part may itself target a base part as its parent, so the base part
 *  must already carry its own transform/material overrides by the time an
 *  added child is attached, though in practice neither ordering would
 *  visually differ since edits and additions touch disjoint objects) on top
 *  of an already-built `root` — called from makePropFromDef ONLY when
 *  `def.parts` is present, so a def with no parts (every shipped def today)
 *  never even calls pathMap: the no-parts path is exactly the pre-IDEA-033
 *  code, unreached and unchanged. */
function applyPropParts(root: THREE.Object3D, parts: NonNullable<PropDef["parts"]>): void {
  const map = pathMap(root);
  for (const edit of parts.edits) applyPropPartEdit(map, edit);
  for (const added of parts.added) addPropPart(root, map, added);
}

/** Builds one prop instance from a full PropDef, dispatching on its `shape`
 *  via an EXHAUSTIVE switch (adding a PropBaseShape without a matching case
 *  here is a compile-time error, per the task brief) — `instanceHash` is the
 *  0..1 per-instance hash driving color pick / lobe-tier variance /
 *  micro-jitter (the same role `h` played pre-v4.1, just now paired with a
 *  full `def.params` bundle instead of a bare colors array). Exported so
 *  shopScene.ts's diorama can plant the exact same meshes it sells in the
 *  actual maze — never a re-implementation with its own drift risk.
 *
 *  IDEA-033: when `def.parts` is present, applyPropParts layers its edits/
 *  added primitives on top of the freshly-built base shape before returning
 *  — every shipped PROP_LIBRARY def has NO `parts` field at all, so
 *  `if (def.parts)` never runs for them and this function's return value is
 *  BYTE-IDENTICAL to the pre-IDEA-033 implementation for every real theme
 *  today (see props.ts's PropPartLayer doc comment for the same guarantee
 *  stated from the data side). */
export function makePropFromDef(def: PropDef, instanceHash: number): THREE.Group {
  const p = def.params;
  const g = ((): THREE.Group => {
    switch (def.shape) {
      case "shrub": return makeShrub(p, instanceHash);
      case "tree": return makeTree(p, instanceHash);
      case "pine": return makePine(p, instanceHash);
      case "palm": return makePalm(p, instanceHash);
      case "building": return makeBuilding(p, instanceHash);
      case "streetlight": return makeStreetlight(p, instanceHash);
      case "umbrella": return makeUmbrella(p, instanceHash);
      case "bloom": return makeBloom(p, instanceHash);
      case "sign": return makeSign(p, instanceHash);
    }
  })();
  if (def.parts) applyPropParts(g, def.parts);
  return g;
}

/** Convenience wrapper: looks up `id` in the prop library (never throws —
 *  degrades to the library's fallback def, see props.ts's getPropDef) and
 *  builds it. The idiom every placement-consuming call site below uses. */
export function makePropById(id: string, instanceHash: number): THREE.Group {
  return makePropFromDef(getPropDef(id), instanceHash);
}

/** Seed band for buildProps' per-placement instance hash (0..1, deterministic
 *  via hash01) — its own band (200+) so it can never collide with
 *  buildHedgeDecor's bloom/speck seeds (1-7) or buildWallDecor's own band
 *  (300+) even though all three can read the same tile coords. */
const PROP_INSTANCE_HASH_SEED = 201;

/**
 * v4.1 "Set Dressing": builds every apron prop for `theme.placements` — each
 * an EXPLICIT, hand-authored PropPlacement (editor-placed, per [[IDEA-030]]),
 * not a density scatter — and returns them all as ONE container Group (or
 * `null` for an empty `placements` array, e.g. classic, so a propless theme
 * costs nothing: no group, no children, no traverse). Every mesh gets its
 * OWN material (built inside the makeX factories above) rather than
 * referencing a shared module-level one, specifically so `board.props` can
 * be disposed as a self-contained unit (scene.remove + traverse-dispose
 * geometries AND materials) without any risk of double-disposing something
 * matWall/hedgeDecor/pellets also reference — see applyBoardTheme's
 * disposal below.
 *
 * Per placement:
 *  - `makePropById(placement.propId, instanceHash)` where instanceHash is a
 *    deterministic hash01 of the placement's OWN tile (so a given
 *    hand-placed prop's color/lobe-tier variance stays stable across
 *    rebuilds/re-themes, same determinism promise as buildHedgeDecor).
 *  - Position: `worldX(tile[0]) + offset[0]`, y=0, `worldZ(tile[1]) +
 *    offset[1]` — offset is the editor's fine ±tile nudge within the tile.
 *  - `rotation.y = placement.rotationY`; `scale.setScalar(placement.scale)`
 *    (see the height-safety clamp below, applied ON TOP of this).
 *
 * Height-safety contract (the doc-commented promise in themes.ts) — now a
 * RENDER-TIME GUARD rather than a placement-time filter, since placements are
 * hand-authored (there's no "later population" to fall back to if a spot is
 * rejected — the guard must instead CLAMP the effective scale so a
 * hand-placed/edited prop can never loom over the play area, protecting
 * against both the shipped placements — already authored to respect this —
 * and any future hand-edit that doesn't): the fixed camera sits at +Z
 * looking north (see scene.ts's BASE_POS/BASE_LOOK), so a placement on the
 * SOUTH apron row (`tile[1] === ROWS`, nearest the camera) whose prop's shape
 * is in the "tall" height class (see PROP_HEIGHT_CLASS above) has its scale
 * clamped hard to `SOUTH_ROW_TALL_SCALE_CAP` — low enough that even a
 * building/pine/palm reads as background dressing rather than blocking the
 * play area; a placement on an EAST/WEST apron column (`tile[0] === -1` or
 * `tile[0] === COLS`) whose prop is "tall" is clamped to `1.0` (the original
 * IDEA-026 cap) so a maxed-out building/pine/palm can't loom beside the
 * board where it would crowd the tunnel-mouth sightline. The NORTH row
 * (`tile[1] === -1`) and all four corners (grouped with whichever row owns
 * them — "corners count as their row") allow every shape at full authored
 * scale, since that's strictly BEHIND the board from the camera's fixed look
 * direction — the skyline row. Medium/low shapes are never capped anywhere.
 *
 * No `grid` parameter (unlike the pre-v4.1 version this replaces, which
 * needed it for tunnel-mouth exclusion + apron-candidate enumeration): both
 * of those were density-scatter concerns that don't apply to hand-authored
 * placements — a placement's tile IS its position, nothing to enumerate or
 * exclude — so buildProps depends only on the theme's own placements data.
 */
const SOUTH_ROW_TALL_SCALE_CAP = 0.55;
const EAST_WEST_TALL_SCALE_CAP = 1.0;

export function buildProps(scene: THREE.Object3D, theme: MazeTheme): THREE.Group | null {
  if (theme.placements.length === 0) return null;

  const group = new THREE.Group();

  theme.placements.forEach((placement: PropPlacement) => {
    const def = getPropDef(placement.propId);
    const [tx, ty] = placement.tile;
    const instanceHash = hash01(tx, ty, PROP_INSTANCE_HASH_SEED);

    const mesh = makePropFromDef(def, instanceHash);

    const heightClass = PROP_HEIGHT_CLASS[def.shape];
    const onSouthRow = ty === ROWS;
    const onEastWestCol = (tx === -1 || tx === COLS) && ty >= 0 && ty < ROWS;

    let scale = placement.scale;
    if (heightClass === "tall") {
      if (onSouthRow) scale = Math.min(scale, SOUTH_ROW_TALL_SCALE_CAP);
      else if (onEastWestCol) scale = Math.min(scale, EAST_WEST_TALL_SCALE_CAP);
    }

    mesh.position.set(worldX(tx) + placement.offset[0], 0, worldZ(ty) + placement.offset[1]);
    mesh.rotation.y = placement.rotationY;
    mesh.scale.setScalar(scale);
    mesh.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = false;
    });
    group.add(mesh);
  });

  scene.add(group);
  return group;
}

/** Seed band for buildWallDecor's per-placement instance hash — its own band
 *  (300+), distinct from buildProps' (200+) and buildHedgeDecor's bloom/speck
 *  seeds (1-7), so a tile that happens to carry both an apron prop and a
 *  wall-top component (different tiles in practice — one's a wall tile, one's
 *  an apron tile — but the hash bands stay non-colliding regardless). */
const WALL_DECOR_INSTANCE_HASH_SEED = 301;
/** Small clearance above the wall top so a wall-decor component visibly sits
 *  ON the hedge rather than embedded in it — mirrors buildHedgeDecor's own
 *  bloom clearance (WALL_H + 0.06) closely; wall-decor components are
 *  slightly larger silhouettes (lamps/signs) than a bare bloom sphere, so a
 *  touch more clearance keeps their base from clipping the wall box. */
const WALL_DECOR_Y_OFFSET = 0.08;

/**
 * v4.1 "Set Dressing" ([[IDEA-031]]): builds every wall-top component for
 * `theme.wallDecor` — each an EXPLICIT, hand-authored WallDecorPlacement (a
 * lamp, transit signal, or bloom the editor placed on a specific wall tile's
 * top), as opposed to buildHedgeDecor's density-scattered fallback above —
 * and returns them all as ONE container Group (`null` for an empty
 * `wallDecor`, mirroring buildProps' own null-for-empty contract exactly,
 * though in practice buildWallTopDecor's dispatch above never calls this
 * with an empty array — buildHedgeDecor handles that case instead — this
 * function still honors the contract standalone so it's correct to call
 * directly, e.g. from a future editor preview). Every mesh gets its OWN
 * material (built inside the makeX factories above), so `board.hedgeDecor`'s
 * entry for this Group can be disposed as a self-contained unit exactly like
 * `board.props` — see applyBoardTheme's disposal below, which now branches on
 * whether an outgoing hedgeDecor entry is a bare Mesh-bearing InstancedMesh
 * (buildHedgeDecor's shared-geometry contract) or one of THESE self-owned
 * Groups.
 *
 * Per placement: `makePropById(placement.propId, instanceHash)` (deterministic
 * hash01 of the placement's own wall tile, same determinism promise as
 * buildProps), seated ON TOP of the wall tile — position `worldX(tile[0])`,
 * y = WALL_H + WALL_DECOR_Y_OFFSET (so it sits on the hedge top rather than
 * embedded in it, mirroring buildHedgeDecor's own bloom clearance),
 * `worldZ(tile[1])`; `rotation.y = placement.rotationY`;
 * `scale.setScalar(placement.scale)`. No height-safety clamp here (unlike
 * buildProps' apron guard) — wall-top components are, by construction
 * (bloom/sign shapes only — see props.ts's WALL_TOP_SHAPES), always in the
 * "low" PROP_HEIGHT_CLASS, so they can never loom over the play area
 * regardless of which wall tile they sit on.
 *
 * No `grid` parameter, same reasoning as buildProps above — a wall-top
 * placement's tile IS its position, nothing to enumerate/exclude against
 * the grid.
 */
export function buildWallDecor(scene: THREE.Object3D, theme: MazeTheme): THREE.Group | null {
  if (theme.wallDecor.length === 0) return null;

  const group = new THREE.Group();

  theme.wallDecor.forEach((placement: WallDecorPlacement) => {
    const def = getPropDef(placement.propId);
    const [tx, ty] = placement.tile;
    const instanceHash = hash01(tx, ty, WALL_DECOR_INSTANCE_HASH_SEED);

    const mesh = makePropFromDef(def, instanceHash);
    mesh.position.set(worldX(tx), WALL_H + WALL_DECOR_Y_OFFSET, worldZ(ty));
    mesh.rotation.y = placement.rotationY;
    mesh.scale.setScalar(placement.scale);
    mesh.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = false;
    });
    group.add(mesh);
  });

  scene.add(group);
  return group;
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
 *  3. Props (IDEA-026 follow-up): also rebuilt from scratch — a re-theme can
 *     change the prop KINDS entirely (garden's shrubs -> city's buildings),
 *     not just a count, so there's nothing to mutate in place. Unlike hedge
 *     decor, prop geometries/materials are NOT shared module-level constants
 *     — each makeX factory in the props section above builds its own, so the
 *     outgoing `board.props` group is traverse-disposed (geometry AND
 *     material on every mesh) before the group itself is dropped, then
 *     buildProps runs again and `board.props` is reassigned (possibly to
 *     `null`, if the new theme is propless).
 *
 * Pickups (bones/fruit/coin/golden bone) are untouched — they keep fixed
 * identity colors in every theme (see makeBone/makeFruit/makeCoin/
 * makeLifeBone above) and are never read from ThemePalette.
 *
 * v4.1 "Set Dressing": hedge decor's disposal (step 2) now branches per
 * OUTGOING ENTRY, since `board.hedgeDecor` can hold either kind (see
 * Board.hedgeDecor's doc comment): a bare `THREE.InstancedMesh` from
 * buildHedgeDecor's density-scatter fallback (shares geoBloom/geoLeafSpeck —
 * only its own per-build MATERIAL is disposed, geometry is a reused
 * module-level constant), or a self-owned `THREE.Group` of wall-decor prop
 * components from buildWallDecor (every mesh inside owns its OWN geometry
 * AND material — needs a full traverse-dispose, exactly disposePropGroup's
 * job, reused here rather than duplicated). Whichever kind theme.wallDecor
 * calls for, the OLD entries are always disposed correctly before the new
 * ones are built — a re-theme that swaps from one kind to the other (e.g.
 * leaving city's hand-placed lamps for garden's density blooms) never leaks.
 */
export function applyBoardTheme(board: Board, scene: THREE.Object3D, grid: Grid, theme: MazeTheme): void {
  syncBoardMaterials(theme.palette);

  board.hedgeDecor.forEach((entry) => {
    if (entry instanceof THREE.Group) {
      // Wall-decor component: self-owned geometries/materials throughout —
      // full traverse-dispose, same path buildProps' outgoing group uses.
      disposePropGroup(scene, entry);
      return;
    }
    // Density-scatter InstancedMesh: shares geoBloom/geoLeafSpeck (NOT
    // disposed — reused by the next build), only its own per-build material
    // is torn down.
    scene.remove(entry);
    const mesh = entry as THREE.InstancedMesh;
    const mat = mesh.material;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat.dispose();
  });

  board.hedgeDecor = buildWallTopDecor(scene, grid, theme);

  if (board.props) disposePropGroup(scene, board.props);
  board.props = buildProps(scene, theme);
}

/**
 * Removes `group` from `scene` and disposes every mesh's geometry AND
 * material inside it (unlike buildHedgeDecor's density-scatter
 * InstancedMeshes, whose geometry is shared and must NOT be disposed here,
 * every mesh inside a prop/wall-decor Group owns its geometry+material
 * outright — see buildProps'/buildWallDecor's doc comments — so a full
 * traverse-dispose is correct and complete). Used for BOTH `board.props`
 * (buildProps' apron container) and any wall-decor Group folded into
 * `board.hedgeDecor` (buildWallDecor's output — see applyBoardTheme's
 * disposal branch above). Exported so game.ts's disposeLevel can call the
 * SAME disposal path this module uses internally on a re-theme, rather than
 * duplicating the traverse logic at the call site.
 */
export function disposePropGroup(scene: THREE.Object3D, group: THREE.Group): void {
  scene.remove(group);
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      const mat = o.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat.dispose();
    }
  });
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
