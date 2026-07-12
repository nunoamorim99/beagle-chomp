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
import { getEquippedMazeTheme, type MazeTheme, type ThemePalette, type ThemeProp, type ThemePropKind } from "../game/themes";

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
  /** IDEA-026 follow-up (theme props — "shrubs in the garden, lighting
   *  stations in the night city, beach umbrellas... buildings"): every prop
   *  mesh planted around the board's apron ring, in ONE container Group so
   *  teardown is a single `scene.remove` + traverse-dispose (see buildProps'
   *  doc comment for exactly what "traverse-dispose" means here — props own
   *  their materials outright, nothing shared with matWall/matFloor/
   *  matBiscuit/hedgeDecor). `null` for a theme with an empty `props` array
   *  (classic) — zero group, zero traverse cost, not just zero children. */
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

  const hedgeDecor = buildHedgeDecor(scene, grid, theme.palette);
  const props = buildProps(scene, grid, theme);

  return { pelletMeshes, pelletsLeft, walls, floor, fruit: null, coin: null, life: null, hedgeDecor, props };
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

// ---------------------------------------------------------------------------
// IDEA-026 follow-up: theme PROPS — Nuno's ask verbatim: "on the garden add
// some shrubs, on the night city some lighting stations, on the beach some
// beach umbrella... On the night city we could add some buildings too...
// components like this turn the themes more reliable and meaningful." Props
// are a SEPARATE decoration layer from buildHedgeDecor above (which lives ON
// the wall tops, inside the maze footprint): props stand on the APRON —
// the 1-tile ring of floor surrounding the maze — so they dress the world
// the board sits in without ever competing with gameplay for a play tile.
//
// One factory per ThemePropKind (below), all primitive-based and built with
// the same MeshStandardMaterial language board.ts/characters.ts already use
// everywhere else (modest roughness, no flatShading — flatShading was
// auditioned for characters and dropped, see characters.ts line ~128 — and
// emissive reserved for things that are actually "lit", i.e. windows/lamp
// heads, not foliage). Every factory returns a THREE.Group centered on its
// own local origin (no baked position/rotation/scale) so buildProps can
// freely position/rotate/scale each instance uniformly, and every factory
// builds its OWN materials (never module-level shared ones like matWall) —
// see buildProps' doc comment for why: a single container Group is disposed
// as a whole on teardown/re-theme, so nothing here can be a shared singleton
// the walls/floor/biscuits also reference.

/** Height class for camera-safety capping (see buildProps' per-side rules
 *  below): "tall" props are skyline-scale and must never stand where they'd
 *  block the view of the board from the fixed camera; "medium" are eye-level
 *  street furniture; "low" hug the ground and are always safe in front. */
type PropHeightClass = "tall" | "medium" | "low";

const PROP_HEIGHT_CLASS: Record<ThemePropKind, PropHeightClass> = {
  building: "tall",
  pine: "tall",
  palm: "tall",
  tree: "medium",
  streetlight: "medium",
  umbrella: "medium",
  shrub: "low",
};

// Fixed trunk color family for every woody prop (tree/pine/palm) —
// independent of the prop's own `colors` (which are reserved for FOLIAGE/
// canopy/facade — the part that actually varies by theme), matching
// board.ts's own floor brown (0x6b4a2f) so trunks read as "the same wood"
// across every theme rather than each population inventing its own bark hue.
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
const TRUNK_COLOR = 0x6b4a2f;
function makeTrunkMat(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: TRUNK_COLOR, roughness: 0.75 });
}

/** Picks one entry from `colors` deterministically via an already-computed
 *  hash01 value in [0,1) — shared by every factory that takes a color list,
 *  so "which color this instance gets" is one obvious idiom throughout. */
function pickColor(colors: readonly number[], h: number): number {
  return colors[Math.floor(h * colors.length) % colors.length];
}

/** shrub — 2-3 overlapping squashed spheres, low and rounded. `h` is a
 *  0..1 hash driving which of the 2-3 lobes appears and their color pick, so
 *  two shrubs from the same population still look like individuals. */
function makeShrub(colors: readonly number[], h: number): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: pickColor(colors, h), roughness: 0.65 });
  const lobes: Array<[number, number, number, number]> = [
    [0, 0.12, 0, 0.22],
    [0.13, 0.15, 0.05, 0.17],
    [-0.12, 0.14, -0.06, 0.17],
  ];
  // A third lobe only about 60% of the time (hash-driven) so shrubs vary
  // between a tight double-lobe and a fuller triple-lobe bush.
  const lobeCount = h > 0.4 ? 3 : 2;
  for (let i = 0; i < lobeCount; i++) {
    const [x, y, z, r] = lobes[i];
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), mat);
    sphere.position.set(x, y, z);
    sphere.scale.y = 0.72; // squashed, low-and-rounded read
    sphere.castShadow = true;
    g.add(sphere);
  }
  return g;
}

/** tree — slim brown trunk + a generous 2-sphere foliage crown. */
function makeTree(colors: readonly number[], h: number): THREE.Group {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.42, 8), makeTrunkMat());
  trunk.position.y = 0.21;
  trunk.castShadow = true;
  g.add(trunk);

  const foliageMat = new THREE.MeshStandardMaterial({ color: pickColor(colors, h), roughness: 0.6 });
  const crownLo = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), foliageMat);
  crownLo.position.y = 0.48;
  crownLo.castShadow = true;
  g.add(crownLo);
  const crownHi = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 10), foliageMat);
  crownHi.position.y = 0.72;
  crownHi.castShadow = true;
  g.add(crownHi);

  return g;
}

/** pine — trunk + 2-3 stacked cones, noticeably taller than makeTree. */
function makePine(colors: readonly number[], h: number): THREE.Group {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.5, 8), makeTrunkMat());
  trunk.position.y = 0.25;
  trunk.castShadow = true;
  g.add(trunk);

  const foliageMat = new THREE.MeshStandardMaterial({ color: pickColor(colors, h), roughness: 0.65 });
  // Three stacked cones, each smaller and higher than the last — a classic
  // conifer silhouette. Radius/height chosen so consecutive cones overlap
  // enough to read as one continuous canopy, not three separate collars.
  const tiers: Array<[number, number, number]> = [
    [0.34, 0.5, 0.52],
    [0.26, 0.42, 0.86],
    [0.17, 0.34, 1.16],
  ];
  tiers.forEach(([r, h2, y]) => {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r, h2, 10), foliageMat);
    cone.position.y = y;
    cone.castShadow = true;
    g.add(cone);
  });

  return g;
}

/** palm — a slightly tilted 2-segment trunk (curved read) + 4-5 drooping
 *  frond ellipsoids + a couple of tiny coconuts. */
function makePalm(colors: readonly number[], h: number): THREE.Group {
  const g = new THREE.Group();

  // Two trunk segments, the upper one angled a touch further than the lower
  // — reads as a gentle curve rather than a robotic dogleg, matching the
  // "curved trunk" beach-palm silhouette. Both segments share ONE trunk
  // material (they're the same physical trunk) — still per-instance, not the
  // module-level TRUNK_COLOR constant directly, so disposal stays correct.
  const trunkMat = makeTrunkMat();
  const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.4, 8), trunkMat);
  lower.position.set(0, 0.2, 0);
  lower.rotation.z = 0.08;
  lower.castShadow = true;
  g.add(lower);

  const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.42, 8), trunkMat);
  upper.position.set(0.09, 0.58, 0);
  upper.rotation.z = 0.22;
  upper.castShadow = true;
  g.add(upper);

  const crownOrigin = new THREE.Vector3(0.17, 0.8, 0);
  const frondMat = new THREE.MeshStandardMaterial({ color: pickColor(colors, h), roughness: 0.55 });
  const frondCount = 4 + (h > 0.5 ? 1 : 0); // 4-5 fronds
  for (let i = 0; i < frondCount; i++) {
    const angle = (i / frondCount) * Math.PI * 2 + h * 1.7;
    const frond = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), frondMat);
    frond.position.copy(crownOrigin);
    frond.position.x += Math.cos(angle) * 0.16;
    frond.position.z += Math.sin(angle) * 0.16;
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
    const coconut = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 6), coconutMat);
    coconut.position.set(crownOrigin.x + (i === 0 ? -0.05 : 0.06), crownOrigin.y - 0.08, i === 0 ? 0.04 : -0.05);
    coconut.castShadow = true;
    g.add(coconut);
  }

  return g;
}

// Lit-window layout for makeBuilding: a small deterministic grid of thin
// emissive boxes on the two visible-ish facades (+X and +Z — the faces most
// likely to catch the camera from its fixed north-looking angle), sized to
// land exactly on the brief's own "4-8 windows" ceiling: 2 rows x 2 cols x 2
// faces = 8 window meshes on every instance (no row-skipping needed — kept
// deliberately at 2 rows, not 3, specifically so the worst case never exceeds
// 8; an earlier 3-row draft could reach 12 on a tall instance, which pushed
// Night City's total prop draw-call count well past what its ~15-20
// buildings should cost — see buildProps' MAX_TOTAL_PROPS note for the
// sibling per-theme prop-COUNT budget this pairs with). Positions are
// FRACTIONS of the tower's own width/height (multiplied out in makeBuilding
// once the instance's actual footprint/height are known), not raw units, so
// the same layout scales cleanly across the kind's whole minScale..maxScale
// band.
const WINDOW_ROWS = [0.32, 0.68] as const;
const WINDOW_COLS = [0.28, 0.72] as const;

/** building — a box tower (facade hue from colors) + a smaller rooftop box
 *  on some instances + a hand-placed deterministic grid of lit windows on
 *  two faces so towers read alive under Night City's dusk light. */
function makeBuilding(colors: readonly number[], h: number): THREE.Group {
  const g = new THREE.Group();

  const footprint = 0.7 + h * 0.2; // ~0.7-0.9 tile, per the brief
  // Height is driven by the INSTANCE's own scale (applied uniformly by
  // buildProps) — the geometry itself just picks a believable base story
  // count so short and tall instances (after scaling) both read as
  // buildings rather than one fixed silhouette stretched thin.
  const baseHeight = 1.1 + h * 0.9;

  const facadeMat = new THREE.MeshStandardMaterial({ color: pickColor(colors, h), roughness: 0.75 });
  const tower = new THREE.Mesh(new THREE.BoxGeometry(footprint, baseHeight, footprint), facadeMat);
  tower.position.y = baseHeight / 2;
  tower.castShadow = true;
  g.add(tower);

  // A smaller rooftop block on ~half of instances (hash-driven), off-center
  // so the skyline doesn't read as identical box-on-box stamps.
  if (h > 0.5) {
    const roofMat = new THREE.MeshStandardMaterial({ color: pickColor(colors, 1 - h), roughness: 0.75 });
    const roofSize = footprint * 0.48;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(roofSize, baseHeight * 0.3, roofSize), roofMat);
    roof.position.set(footprint * 0.12, baseHeight + (baseHeight * 0.3) / 2, -footprint * 0.08);
    roof.castShadow = true;
    g.add(roof);
  }

  // Lit windows: thin emissive boxes, hand-placed on the +X and +Z facades
  // from WINDOW_ROWS/WINDOW_COLS (fractions of footprint/baseHeight so the
  // grid scales with the instance), sat just proud of the facade so they
  // never z-fight the tower box.
  const windowMat = new THREE.MeshStandardMaterial({
    color: 0xf4d060,
    emissive: 0xf4d060,
    emissiveIntensity: 1.1,
    roughness: 0.4,
  });
  const winW = footprint * 0.16;
  const winH = baseHeight * 0.07;
  const winDepth = 0.012;
  const half = footprint / 2;

  WINDOW_ROWS.forEach((rowFrac) => {
    WINDOW_COLS.forEach((colFrac) => {
      const y = rowFrac * baseHeight;

      const winX = new THREE.Mesh(new THREE.BoxGeometry(winDepth, winH, winW), windowMat);
      winX.position.set(half + winDepth / 2, y, (colFrac - 0.5) * footprint);
      g.add(winX);

      const winZ = new THREE.Mesh(new THREE.BoxGeometry(winW, winH, winDepth), windowMat);
      winZ.position.set((colFrac - 0.5) * footprint, y, half + winDepth / 2);
      g.add(winZ);
    });
  });

  return g;
}

/** streetlight — thin dark pole + small arm + a glowing head sphere. NO
 *  PointLight (perf/shadow budget, per the brief) — the emissive sphere
 *  alone reads as lit under the tuned ACES exposure every theme shares. */
function makeStreetlight(colors: readonly number[], h: number): THREE.Group {
  const g = new THREE.Group();

  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.55, metalness: 0.3 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.85, 8), poleMat);
  pole.position.y = 0.425;
  pole.castShadow = true;
  g.add(pole);

  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.22, 6), poleMat);
  arm.position.set(0.09, 0.82, 0);
  arm.rotation.z = Math.PI / 2;
  arm.castShadow = true;
  g.add(arm);

  const headColor = pickColor(colors, h);
  const headMat = new THREE.MeshStandardMaterial({
    color: headColor,
    emissive: headColor,
    emissiveIntensity: 0.9,
    roughness: 0.3,
  });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), headMat);
  head.position.set(0.19, 0.8, 0);
  head.castShadow = true;
  g.add(head);

  return g;
}

/** umbrella — pole + a squashed cone canopy, slight tilt for a beach-casual
 *  read. ~Half get a second canopy color as a darker tip sphere accent
 *  (an alternating-look nod without a full multi-gore canopy). */
function makeUmbrella(colors: readonly number[], h: number): THREE.Group {
  const g = new THREE.Group();

  const poleMat = new THREE.MeshStandardMaterial({ color: 0xdedede, roughness: 0.5, metalness: 0.15 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.66, 8), poleMat);
  pole.position.y = 0.33;
  pole.castShadow = true;
  g.add(pole);

  const canopyColor = pickColor(colors, h);
  const canopyMat = new THREE.MeshStandardMaterial({ color: canopyColor, roughness: 0.5 });
  const canopy = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.24, 10), canopyMat);
  canopy.position.y = 0.68;
  canopy.castShadow = true;
  g.add(canopy);

  // ~Half get a contrasting tip in a second palette color, and every canopy
  // gets a slight tilt (beach-casual, never perfectly vertical).
  if (h > 0.5 && colors.length > 1) {
    const tipColor = pickColor(colors, (h + 0.5) % 1);
    const tipMat = new THREE.MeshStandardMaterial({ color: tipColor, roughness: 0.5 });
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), tipMat);
    tip.position.y = 0.81;
    tip.castShadow = true;
    g.add(tip);
  }
  g.rotation.z = (h - 0.5) * 0.14;

  return g;
}

/** Dispatches to the factory for `kind`, keyed the same way theme.props
 *  entries are (kind + colors + a 0..1 instance hash). Exported so
 *  shopScene.ts's diorama can plant the exact same meshes it sells in the
 *  actual maze — never a re-implementation with its own drift risk. */
export function makeThemeProp(kind: ThemePropKind, colors: readonly number[], h: number): THREE.Group {
  switch (kind) {
    case "shrub": return makeShrub(colors, h);
    case "tree": return makeTree(colors, h);
    case "pine": return makePine(colors, h);
    case "palm": return makePalm(colors, h);
    case "building": return makeBuilding(colors, h);
    case "streetlight": return makeStreetlight(colors, h);
    case "umbrella": return makeUmbrella(colors, h);
  }
}

// Prop-count sanity cap: if a theme's density math would place more than
// this many total props, later populations simply stop claiming once the
// running total hits it (earlier theme.props entries — and earlier apron
// spots within a population — always win, so the cap never causes visible
// "holes", just an early stop once the board is already dressed).
const MAX_TOTAL_PROPS = 40;

/**
 * IDEA-026 follow-up: builds every prop for `theme` around `grid`'s apron —
 * the 1-tile ring of floor OUTSIDE the maze footprint (tx in [-1..COLS], ty
 * in [-1..ROWS], excluding the interior [0..COLS-1]x[0..ROWS-1] tiles the
 * maze itself occupies) — and returns them all as ONE container Group (or
 * `null` for an empty `theme.props`, e.g. classic, so a propless theme costs
 * nothing: no group, no children, no traverse). Every mesh gets its OWN
 * material (built inside the makeX factories above) rather than referencing
 * a shared module-level one, specifically so `board.props` can be disposed
 * as a self-contained unit (scene.remove + traverse-dispose geometries AND
 * materials) without any risk of double-disposing something matWall/
 * hedgeDecor/pellets also reference — see applyBoardTheme's disposal below.
 *
 * Placement contract (mirrors buildHedgeDecor's determinism promise):
 *  - Candidate spots = every apron tile, MINUS the tiles immediately flanking
 *    a tunnel-row exit (tx===-1 or tx===COLS on a `grid.tunnelRows` row, plus
 *    that row's vertical neighbors on the same column) so a prop can never
 *    visually plug a tunnel mouth.
 *  - Deterministic: hash01(x, y, seed) — same idiom buildHedgeDecor uses,
 *    just its own seed band (100+) so prop placement can never collide with
 *    bloom/speck placement's seeds (1-7) even though both read the same tile
 *    coords.
 *  - Each population in `theme.props`, IN ORDER, claims up to
 *    `density * candidateCount` spots from whatever's left in the shuffled
 *    candidate pool — "in order" means an earlier population (e.g. garden's
 *    shrubs before its trees) always gets first pick, so a denser later
 *    population can never crowd out an earlier one's promised density.
 *  - Per instance: jitter (+-0.25 tile), a random y-rotation, and a scale
 *    lerp(minScale, maxScale, hash) — same "hash-driven, not Math.random"
 *    idiom as the jitter above, so a theme's prop layout is exactly as
 *    reproducible as its hedge blooms are.
 *
 * Height-safety contract (the doc-commented promise in themes.ts): the fixed
 * camera sits at +Z looking north (see scene.ts's BASE_POS/BASE_LOOK), so the
 * SOUTH apron row (ty===ROWS, nearest the camera) only ever gets LOW props
 * (tall/medium kinds don't even attempt to claim a spot there); EAST/WEST
 * apron columns (tx===-1 or tx===COLS, for the ROWS between the two corners)
 * cap TALL props' scale to ~1.0 so a maxed-out building/pine/palm can't loom
 * beside the board where it would crowd the tunnel-mouth sightline; the NORTH
 * row (ty===-1) and all four corners (grouped with whichever row owns them —
 * "corners count as their row") allow every kind at full scale, since that's
 * strictly BEHIND the board from the camera's fixed look direction — the
 * skyline row.
 */
export function buildProps(scene: THREE.Object3D, grid: Grid, theme: MazeTheme): THREE.Group | null {
  if (theme.props.length === 0) return null;

  // Tunnel-mouth exclusion: for every tunnel row, both its exit columns
  // (tx=-1 and tx=COLS) AND that row's immediate vertical neighbors on the
  // same column are off-limits, so nothing ever visually plugs a tunnel
  // mouth or crowds right up against one.
  const excluded = new Set<string>();
  grid.tunnelRows.forEach((ty) => {
    ([-1, COLS] as const).forEach((tx) => {
      excluded.add(`${tx},${ty - 1}`);
      excluded.add(`${tx},${ty}`);
      excluded.add(`${tx},${ty + 1}`);
    });
  });

  // Every apron tile: the (COLS+2)x(ROWS+2) floor footprint minus the
  // interior [0..COLS-1]x[0..ROWS-1] the maze itself occupies.
  const candidates: Array<[number, number]> = [];
  for (let ty = -1; ty <= ROWS; ty++) {
    for (let tx = -1; tx <= COLS; tx++) {
      const isInterior = tx >= 0 && tx < COLS && ty >= 0 && ty < ROWS;
      if (isInterior) continue;
      const key = `${tx},${ty}`;
      if (excluded.has(key)) continue;
      candidates.push([tx, ty]);
    }
  }

  // Deterministic shuffle (Fisher-Yates driven by hash01, never Math.random)
  // so "which spots exist" and "what order populations claim them in" are
  // both stable across rebuilds, matching the rest of this module's
  // determinism promise.
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(hash01(candidates[i][0], candidates[i][1], 101) * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  const group = new THREE.Group();
  const claimed = new Set<string>(); // "tx,ty" already taken by an earlier population
  let cursor = 0; // walks the shuffled candidate pool once, shared across populations
  let totalPlaced = 0;

  theme.props.forEach((pop: ThemeProp) => {
    const target = Math.round(pop.density * candidates.length);
    let placedForPop = 0;

    while (placedForPop < target && cursor < candidates.length && totalPlaced < MAX_TOTAL_PROPS) {
      const [tx, ty] = candidates[cursor];
      cursor++;
      const key = `${tx},${ty}`;
      if (claimed.has(key)) continue;

      const heightClass = PROP_HEIGHT_CLASS[pop.kind];
      const onSouthRow = ty === ROWS;
      const onEastWestCol = (tx === -1 || tx === COLS) && ty >= 0 && ty < ROWS;

      // South apron row (closest to the fixed camera): only LOW props may
      // stand there at all — a medium/tall population simply skips this
      // spot (it stays unclaimed for a later, shorter population to use).
      if (onSouthRow && heightClass !== "low") continue;

      claimed.add(key);

      const hJitterX = hash01(tx, ty, 102);
      const hJitterZ = hash01(tx, ty, 103);
      const hRot = hash01(tx, ty, 104);
      const hScale = hash01(tx, ty, 105);
      const hVariant = hash01(tx, ty, 106); // fed to the factory for color/lobe-count variance

      const mesh = makeThemeProp(pop.kind, pop.colors, hVariant);

      let scale = THREE.MathUtils.lerp(pop.minScale, pop.maxScale, hScale);
      // East/West columns: cap TALL kinds' scale so a maxed-out building/
      // pine/palm never looms right beside the board/tunnel — medium/low
      // stay free to use their full density band there.
      if (onEastWestCol && heightClass === "tall") scale = Math.min(scale, 1.0);

      const jx = (hJitterX - 0.5) * 0.5; // +-0.25 tile
      const jz = (hJitterZ - 0.5) * 0.5;
      mesh.position.set(worldX(tx) + jx, 0, worldZ(ty) + jz);
      mesh.rotation.y = hRot * Math.PI * 2;
      mesh.scale.setScalar(scale);
      mesh.traverse((o) => {
        o.castShadow = true;
        o.receiveShadow = false;
      });
      group.add(mesh);

      placedForPop++;
      totalPlaced++;
    }
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

  if (board.props) disposePropGroup(scene, board.props);
  board.props = buildProps(scene, grid, theme);
}

/**
 * Removes `group` from `scene` and disposes every mesh's geometry AND
 * material inside it (unlike hedgeDecor's disposal above, props never share
 * geometries/materials with anything else — see buildProps' doc comment —
 * so a full traverse-dispose is correct and complete here). Exported so
 * game.ts's disposeLevel can call the SAME disposal path this module uses
 * internally on a re-theme, rather than duplicating the traverse logic at
 * the call site.
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
