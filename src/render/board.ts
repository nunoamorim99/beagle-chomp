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
// IDEA-045: the fruit ids the board can spawn. Render importing pure game
// data is the allowed direction (CLAUDE.md); the reverse never happens.
import { type FruitId, type PowerupId } from "../game/config";
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
import { toon } from "./toon";
import { wallTextureFor } from "./wallTexture";
import { floorTextureFor } from "./floorTexture";

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
  /** IDEA-046: the current power-up pickup, if any (see spawnPowerup/
   *  clearPowerup) — parallels `coin`/`fruit`/`life` exactly. Placement and
   *  WHICH power-up are gameplay's decision; this is only the mesh. */
  powerup: THREE.Object3D | null;
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
const matWall = toon({
  color: initialPalette.wall,


  emissive: initialPalette.wallEmissive,
  emissiveIntensity: initialPalette.wallEmissiveIntensity,
});
// IDEA-008 (daytime garden): emissive swapped from a cold blue-black
// (0x0a0a18) to a warm dark brown so the soil reads as sunlit earth rather
// than picking up a cold night cast — still a faint whisper of lift, not a
// glow, on an otherwise diffuse, roughness: 1 surface. IDEA-026: themed.
const matFloor = toon({
  color: initialPalette.floor,

  emissive: initialPalette.floorEmissive,
  emissiveIntensity: initialPalette.floorEmissiveIntensity,
});
const geoBiscuit = new THREE.SphereGeometry(0.13, 12, 12);
// Biscuit glow warmed and strengthened (0x3a2a10/0.4 -> 0x6a4a18/0.55) so
// pellets read as gently lit treats rather than flat spheres, without
// blowing out at the tuned exposure (see scene.ts toneMappingExposure note).
// IDEA-026: themed — biscuits ARE the trail, so they re-skin with the world
// (unlike the fixed-identity pickups below).
const matBiscuit = toon({
  color: initialPalette.biscuit,

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
export function makeBone(): THREE.Group {
  const g = new THREE.Group();
  // Emissive warmed and strengthened (0x554a2a/0.25 -> 0x6a5730/0.4) to match
  // the biscuit's softly-lit-treat read at the new exposure/lighting.
  const white = toon({
    color: 0xf6f1e6,

    emissive: 0x6a5730,
    emissiveIntensity: 0.4,
  });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.34, 10), white);
  shaft.name = "shaft";
  shaft.scale.set(0.7, 1, 1);
  shaft.rotation.z = Math.PI / 2;
  g.add(shaft);
  const knuckles: Array<[number, number]> = [
    [-0.2, 0.08],
    [-0.2, -0.08],
    [0.2, 0.08],
    [0.2, -0.08],
  ];
  knuckles.forEach(([x, z]) => {
    const k = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 10), white);
    k.name = `knuckle${x < 0 ? "L" : "R"}${z < 0 ? "B" : "F"}`;
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
const matGoldBone = toon({
  color: 0xf4c430,


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
 *
 * EXPORTED for the tutorial's "earning more lives" slide (IDEA-040 v2), which
 * stages this exact mesh rather than a picture of one — so the thing the
 * player is told to look for is the thing they will actually see.
 */
export function makeLifeBone(): THREE.Group {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.34, 10), matGoldBone);
  shaft.name = "shaft";
  shaft.scale.set(0.7, 1.15, 1);
  shaft.rotation.z = Math.PI / 2;
  g.add(shaft);
  const knuckles: Array<[number, number]> = [
    [-0.2, 0.08],
    [-0.2, -0.08],
    [0.2, 0.08],
    [0.2, -0.08],
  ];
  knuckles.forEach(([x, z]) => {
    const k = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 10), matGoldBone);
    k.name = `knuckle${x < 0 ? "L" : "R"}${z < 0 ? "B" : "F"}`;
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
 * THE FRUIT BASKET (IDEA-045).
 *
 * There used to be one `makeFruit()` worth a flat 100. There are now five
 * builders, one per entry in config.ts's FRUITS table, and `spawnFruit` picks
 * between them by id.
 *
 * Three rules hold this set together, all of them about being READ rather than
 * being accurate:
 *
 *  1. **Silhouette first, colour second.** At the game camera a fruit is a
 *     handful of pixels, and three of the five (apple, strawberry, mango) are
 *     round and warm-coloured. So each one commits to a different OUTLINE — a
 *     ball, a crescent, a downward cone, a pointed berry, a tilted egg — and
 *     the colour only confirms what the shape already said. Recolouring these
 *     without keeping them apart in silhouette would undo the ladder: a player
 *     has to know a Mango is worth cutting across the maze for BEFORE they get
 *     there.
 *  2. **Same footprint, ~0.22 across.** They occupy one tile and share the
 *     board with the coin and the golden bone, which are built to that size
 *     too. A "bigger fruit is worth more" cue is tempting and wrong: it makes
 *     the 500 easier to see and easier to reach, which is backwards.
 *  3. **Fixed identity colours, and toon() like everything else.** Pickups do
 *     not follow the maze theme (see applyBoardTheme) — a fruit that went
 *     hedge-green in the forest theme would stop being a fruit. Emissive sits
 *     in the same 0.3-0.5 "soft glow" band as the biscuit/bone/coin.
 */

/**
 * The apple's lathe profile: [radius, height], bottom centre first.
 *
 * NOT monotonic in y, and that is the point. It starts on the axis at -0.150,
 * drops OUTWARD and down to the lowest ring at -0.196, and finishes by turning
 * back in and down to -0.158 below the shoulder. Those two reversals are the
 * calyx dimple underneath and the stem well on top, which is most of what
 * separates an apple from a ball. LatheGeometry is happy to revolve a polyline
 * that doubles back; it only cares that the points run bottom to top overall,
 * which is the direction that gets the winding right (see makeStrawberry).
 *
 * Wider than tall — 0.46 across against 0.39 of body — because a real one is.
 */
const APPLE_PROFILE: readonly [number, number][] = [
  [0.0, -0.168],
  [0.048, -0.186],
  [0.1, -0.196],
  [0.152, -0.186],
  [0.196, -0.152],
  [0.221, -0.1],
  [0.23, -0.04],
  [0.229, 0.028],
  [0.213, 0.092],
  [0.182, 0.146],
  [0.138, 0.182],
  [0.088, 0.196],
  [0.052, 0.18],
  [0.024, 0.164],
  [0.0, 0.158],
];

/**
 * Apple — 100, the common case (weight 40).
 *
 * Its comment used to say this was the original `makeFruit()`, untouched, so
 * that the fruit ladder read as four ADDITIONS rather than a replacement of
 * something familiar. That release has shipped; the ladder is the status quo
 * now, so the apple was rebuilt from a reference like the rest of them.
 *
 * What it gains is a stem in a real WELL and a dimple underneath. The old build
 * was a plain sphere with a green lozenge stuck on top and no stem at all — and
 * a sphere is the one thing an apple is not, because both of its ends are
 * pushed in.
 *
 * Worth knowing before retuning this: the apple is the shape the rest of the
 * set is differentiated FROM. The mango carries no leaf and the carrot's tuft
 * is six stalks rather than one mass, both to avoid reading as this fruit. A
 * change here that made the apple rounder or its leaf bigger would quietly
 * spend the margin those two are relying on.
 */
export function makeApple(): THREE.Group {
  const g = new THREE.Group();
  const apple = new THREE.Mesh(
    new THREE.LatheGeometry(
      APPLE_PROFILE.map(([r, y]) => new THREE.Vector2(r, y)),
      // 16, not 14: this is the roundest thing on the board and at 14 the
      // silhouette shows its facets.
      16,
    ),
    toon({
      color: 0xd8483f,
      emissive: 0x5c130f,
      emissiveIntensity: 0.5,
    }),
  );
  apple.name = "apple";
  g.add(apple);

  // Rises out of the well floor at 0.158, not off the shoulder — that recess is
  // the whole reason for the profile's second reversal, and a stem planted on
  // top of the fruit instead of inside the dimple wastes it.
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.011, 0.016, 0.115, 6),
    toon({
      color: 0x7a5a34,
      emissive: 0x241708,
      emissiveIntensity: 0.3,
    }),
  );
  stem.name = "stem";
  stem.position.set(0.006, 0.213, 0);
  stem.rotation.z = -0.16;
  g.add(stem);

  // A flat pointed BLADE, not a squashed sphere. The leaf is this fruit's tell —
  // it is why the mango has none — so its outline has to be a leaf's, and a
  // lozenge seen at 25px is just a green smudge either way.
  const blade = new THREE.Shape();
  // Big — 0.22 long against the fruit's 0.23 radius. The reference's leaf is
  // nearly as long as the apple is wide, and a smaller one tilted up reads as a
  // green sliver rather than as a blade.
  blade.moveTo(0, 0);
  blade.quadraticCurveTo(0.08, 0.092, 0.22, 0);
  blade.quadraticCurveTo(0.08, -0.092, 0, 0);
  const leafGeo = new THREE.ExtrudeGeometry(blade, {
    depth: 0.008,
    bevelEnabled: false,
    curveSegments: 5,
  });
  // Laid flat in the GEOMETRY so the mesh's own rotation is just placement:
  // tilt up on Z, then swing round the fruit on Y.
  leafGeo.rotateX(-Math.PI / 2);
  const leaf = new THREE.Mesh(
    leafGeo,
    toon({
      color: 0x5fae4d,
      emissive: 0x1c3a18,
      emissiveIntensity: 0.3,
    }),
  );
  leaf.name = "leaf";
  // On the shoulder RIM, not beside the stem. At the well the fruit is still
  // 0.11 across and a root placed at 0.05 buries the first third of the blade
  // inside the apple, which is why it read as a stub. 0.081 out is the rim.
  leaf.position.set(0.06, 0.196, 0.055);
  // Only a shallow tilt on Z: laid flatter, the blade turns its FACE to the
  // game camera, which looks down. Steeply tilted it presents its edge and
  // all that width is spent on nothing.
  leaf.rotation.set(0, -0.7, 0.22);
  g.add(leaf);

  g.traverse((o) => {
    o.castShadow = true;
  });
  return g;
}

/**
 * A closed tube of VARYING radius swept along a curve.
 *
 * THREE.TubeGeometry cannot do this — its radius is a single number — and the
 * taper is the whole point of a banana: fat through the middle, pinched only in
 * the last tenth at each end. A partial torus, which is what the banana used to
 * be, has uniform thickness by construction.
 *
 * Normals are written radially rather than left to computeVertexNormals(). The
 * ring is closed by duplicating the seam column (j = 0 and j = radial share a
 * position), and averaged normals would give those two copies different values
 * and draw a bright seam down the length of the fruit.
 */
function taperedTube(
  curve: THREE.Curve<THREE.Vector3>,
  tubular: number,
  radial: number,
  radiusAt: (t: number) => number,
): THREE.BufferGeometry {
  const frames = curve.computeFrenetFrames(tubular, false);
  const position: number[] = [];
  const normal: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  const P = new THREE.Vector3();
  const dir = new THREE.Vector3();

  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular;
    curve.getPointAt(t, P);
    const N = frames.normals[i];
    const B = frames.binormals[i];
    const r = radiusAt(t);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      // NEGATIVE cosine, matching THREE.TubeGeometry exactly. The index winding
      // below is lifted from that class, and the two only agree if the ring is
      // walked in the same direction. With +cos the ring runs the other way,
      // every triangle comes out wound backwards, FrontSide culls the near wall
      // and you see straight through the fruit to its far side.
      const c = -Math.cos(a);
      const s = Math.sin(a);
      dir.set(N.x * c + B.x * s, N.y * c + B.y * s, N.z * c + B.z * s).normalize();
      normal.push(dir.x, dir.y, dir.z);
      position.push(P.x + r * dir.x, P.y + r * dir.y, P.z + r * dir.z);
      uv.push(t, j / radial);
    }
  }
  for (let i = 1; i <= tubular; i++) {
    for (let j = 1; j <= radial; j++) {
      const a = (radial + 1) * (i - 1) + (j - 1);
      const b = (radial + 1) * i + (j - 1);
      const c = (radial + 1) * i + j;
      const d = (radial + 1) * (i - 1) + j;
      index.push(a, b, d, b, c, d);
    }
  }

  // CLOSE BOTH ENDS. The swept ring is open by construction, and an open tube
  // shows you its own inside surface through the hole — which does not read as
  // a hole, it reads as the whole fruit being see-through. The cap fan carries
  // the end's tangent as its normal rather than the ring's radial one, so it
  // catches a different band of the toon ramp and the end reads as an end.
  for (const end of [0, tubular]) {
    const sign = end === 0 ? -1 : 1;
    const t = end / tubular;
    curve.getPointAt(t, P);
    const T = frames.tangents[end];
    const nx = T.x * sign;
    const ny = T.y * sign;
    const nz = T.z * sign;
    const centre = position.length / 3;
    position.push(P.x, P.y, P.z);
    normal.push(nx, ny, nz);
    uv.push(0.5, 0.5);
    const base = position.length / 3;
    const r = radiusAt(t);
    const N = frames.normals[end];
    const B = frames.binormals[end];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const c = -Math.cos(a);
      const s = Math.sin(a);
      dir.set(N.x * c + B.x * s, N.y * c + B.y * s, N.z * c + B.z * s).normalize();
      position.push(P.x + r * dir.x, P.y + r * dir.y, P.z + r * dir.z);
      normal.push(nx, ny, nz);
      uv.push(0.5 + 0.5 * c, 0.5 + 0.5 * s);
    }
    // Fan winding follows the ring's direction, so it flips with it.
    for (let j = 0; j < radial; j++) {
      if (sign > 0) index.push(centre, base + j + 1, base + j);
      else index.push(centre, base + j, base + j + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setIndex(index);
  geo.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normal, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  return geo;
}

/**
 * Banana — 200 (weight 25).
 *
 * A crescent, which is the whole trick: it shares its outline with nothing else
 * on the board, and that matters more here than on any other pickup. CLAUDE.md
 * records why — the first mango was near-round and gold and read as an apple,
 * so the 100 and the 500 looked alike. Five fruits, five silhouettes.
 *
 * The reference is a whole HAND of five. It is not built as one: at ~21px five
 * overlapping fingers are a yellow blob, and the blob is not a crescent. What
 * the reference gave is the profile of a single finger, and that is the upgrade
 * — this used to be a partial torus, so it was exactly as thick at the tips as
 * in the middle. It is now a tube of varying radius swept along a
 * CatmullRomCurve3: fat through the belly, pinched in the last tenth at each
 * end, the way a real one is.
 *
 * It stands UPRIGHT with a slight lean, rather than lying as a rainbow. The
 * lean is baked into the spine's own coordinates rather than applied as a
 * rotation on the group, because spinDecor owns rotation.y on that group and a
 * second Euler component there would compose in an order this file should not
 * have to reason about.
 *
 * The two ends are NOT the same and are not two brown balls. The reference is
 * clear about it: the stalk end carries the green stub where the finger was cut
 * from the crown, and the flower end is a small dark dot. They are still named
 * tipStem and tipEnd, which the editor's pickup test pins.
 *
 * Two proportions are deliberate. The ARC is flattened (its points are built at
 * 0.82 on Y before the lean is applied) because a circular arc reads as a ring,
 * but the TUBE is left round — the old build flattened both, and the
 * cross-section is the only thing this shape has to offer edge-on, where it was
 * the thinnest pickup on the board. And the taper holds 55% of full radius at
 * the very ends rather than running to a needle, so there is something for the
 * stem and the dot to sit on.
 */
export function makeBanana(): THREE.Group {
  const g = new THREE.Group();
  g.rotation.set(0, 0, 1.005);
  const yellow = toon({
    color: 0xf2c832,
    emissive: 0x5c4408,
    emissiveIntensity: 0.45,
  });

  // Authored lying down — a flattened arc, symmetric about x = 0 — then turned
  // upright by LEAN. 90 degrees would stand it dead vertical; a little under
  // leaves it hanging the way one does on the bunch.
  const LEAN = Math.PI * 0.5 - 0.19;
  const cos = Math.cos(LEAN);
  const sin = Math.sin(LEAN);
  // Scaled up from the version that lay flat. Standing the crescent upright
  // turned a 0.52-wide, 0.29-tall pickup into a 0.34-wide, 0.51-tall one, and
  // the game camera looks DOWN — so the long axis is now the foreshortened one
  // and the worst frame fell to 16px, which the contact sheet flags in red.
  // The spine grows more than the radius does, which buys the pixels back and
  // slims the fruit toward the reference's proportions at the same time.
  const L = 1.3;
  const flat: readonly [number, number][] = [
    [0.208 * L, 0.01 * L],
    [0.166 * L, 0.108 * L],
    [0.057 * L, 0.166 * L],
    [-0.07 * L, 0.16 * L],
    [-0.172 * L, 0.096 * L],
    [-0.208 * L, 0.006 * L],
  ];
  const turned = flat.map(([x, y]) => new THREE.Vector3(x * cos - y * sin, x * sin + y * cos, 0));
  // Re-centre on X so spinDecor's Y rotation turns it in place rather than
  // swinging it round a point outside itself. The lean moves the mass off the
  // axis; this puts it back.
  const midX = (Math.min(...turned.map((p) => p.x)) + Math.max(...turned.map((p) => p.x))) / 2;
  for (const p of turned) p.x -= midX;
  const spine = new THREE.CatmullRomCurve3(turned);

  const RMAX = 0.086;
  const radiusAt = (t: number) => RMAX * (0.55 + 0.45 * Math.sin(Math.PI * t) ** 0.35);

  const banana = new THREE.Mesh(taperedTube(spine, 24, 8, radiusAt), yellow);
  banana.name = "banana";
  g.add(banana);

  // The stalk end: the green stub left where this finger was cut off the bunch.
  // A short cylinder laid along the spine's own outgoing tangent, so it points
  // the way the fruit does however the lean is retuned.
  const stemMat = toon({
    color: 0x9fb83a,
    emissive: 0x2c3a08,
    emissiveIntensity: 0.35,
  });
  const stemOut = spine.getTangentAt(0).negate();
  const tipStem = new THREE.Mesh(
    new THREE.CylinderGeometry(radiusAt(0) * 0.62, radiusAt(0) * 0.95, 0.06, 7),
    stemMat,
  );
  tipStem.name = "tipStem";
  tipStem.scale.set(1.189, 1.8, 1.25);
  tipStem.position.set(0.163, 0.278, -0.002);
  tipStem.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), stemOut);
  g.add(tipStem);

  // The flower end: a small dark dot, not a ball. Half the radius the tube has
  // there, sat just proud of the cap so it reads as a mark on the end rather
  // than as a second object stuck to it.
  const tipMat = toon({
    color: 0x6b4a2f,
    emissive: 0x241708,
    emissiveIntensity: 0.3,
  });
  const tipEnd = new THREE.Mesh(new THREE.SphereGeometry(radiusAt(1) * 0.52, 8, 6), tipMat);
  tipEnd.name = "tipEnd";
  tipEnd.scale.set(1.8, 1.9, 2.007);
  tipEnd.rotation.set(0, 0, -0.699);
  tipEnd.position.copy(spine.getPointAt(1)).addScaledVector(spine.getTangentAt(1), 0.012);
  g.add(tipEnd);

  g.traverse((o) => {
    o.castShadow = true;
  });
  return g;
}

/**
 * The carrot's lathe profile: a power-curve taper up the root, then a
 * quarter-circle dome over the shoulder. Body and dome are stepped separately
 * so the dome gets real resolution without spending points up the straight.
 *
 * NO RINGS. A real root is banded and a lathe can express that for the price of
 * a ripple in the radius, so it was built — and it does not work here. The cel
 * ramp has three steps, and a ripple deep enough to see tips the surface normal
 * back and forth across a step boundary; the whole patch either side of a
 * crossing flips band together, so what renders is two or three dark BLOBS
 * rather than rings. Halving the amplitude did not fix it, and the amplitude
 * that does is too small to see. Rings and a three-step ramp are the
 * incompatible pair, not rings and this geometry.
 *
 * Ascending y, tip first — the direction LatheGeometry wants its points. Handed
 * a descending profile it inverts every face and the root renders see-through;
 * see makeStrawberry, where exactly that shipped.
 */
function carrotProfile(bodySteps: number, domeSteps: number): THREE.Vector2[] {
  const TIP_Y = -0.27;
  const TOP_Y = 0.225;
  const R = 0.118;
  /** Where the straight taper stops and the shoulder starts rounding over.
   *  The gap to TOP_Y is the dome's HEIGHT, and it has to be comparable to R or
   *  the quarter-circle comes out far wider than it is tall — at 0.045 against a
   *  radius of 0.118 the top surface sits almost horizontal and the carrot
   *  reads as having been sliced off flat. 0.10 against 0.118 is a dome. */
  const SHOULDER_Y = 0.125;
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= bodySteps; i++) {
    const t = i / bodySteps;
    // pow < 1 fattens the root quickly out of the tip and then eases off, which
    // is why the reference's carrot is not a straight-sided cone.
    pts.push(new THREE.Vector2(R * Math.pow(t, 0.62), TIP_Y + (SHOULDER_Y - TIP_Y) * t));
  }
  for (let i = 1; i <= domeSteps; i++) {
    const k = i / domeSteps;
    pts.push(new THREE.Vector2(R * Math.sqrt(Math.max(0, 1 - k * k)), SHOULDER_Y + (TOP_Y - SHOULDER_Y) * k));
  }
  return pts;
}

/** Where each frond leaves the crown: angle round the root, how far it leans
 *  out of vertical, its length and its thickness. Deliberately uneven — six
 *  identical stalks on a regular ring read as a fan, not a tuft. */
const CARROT_FRONDS: readonly { a: number; lean: number; len: number; r: number }[] = [
  { a: -0.5, lean: 0.55, len: 0.17, r: 0.03 },
  { a: 0.35, lean: 0.4, len: 0.22, r: 0.026 },
  { a: 1.4, lean: 0.62, len: 0.15, r: 0.028 },
  { a: 2.5, lean: 0.45, len: 0.19, r: 0.024 },
  { a: 3.6, lean: 0.58, len: 0.16, r: 0.027 },
  { a: 4.8, lean: 0.38, len: 0.21, r: 0.025 },
];

/**
 * Carrot — 300 (weight 18).
 *
 * The one fruit here that is actually a vegetable, and the one whose outline is
 * carrying the most weight: a shape tapering POINT-DOWN is the only one in the
 * set, so it separates from the mango's warm oval at a glance even though the
 * two colours are neighbours on the wheel.
 *
 * It was a plain cone. The reference is not one — its root fattens quickly out
 * of the tip and then eases off, and its shoulder is DOMED rather than cut flat
 * the way a cone's base is. Both of those are silhouette, so both are now in a
 * lathe profile instead.
 *
 * SIX fronds rather than three, and thinner. The three-cone tuft existed to
 * stop a single green lump reading as the apple's leaf, and that reasoning
 * still holds — what changed is that six thin stalks do the same job while
 * reading as foliage rather than as three spikes. Their angles and lengths are
 * deliberately uneven: six identical stalks on a regular ring read as a fan.
 *
 * The root's RINGS were built and then removed — see carrotProfile for why a
 * three-step cel ramp turns a rippled radius into blobs rather than bands.
 */
export function makeCarrot(): THREE.Group {
  const g = new THREE.Group();
  g.rotation.set(0, 0, 0.5);
  const carrot = new THREE.Mesh(
    new THREE.LatheGeometry(carrotProfile(12, 5), 10),
    toon({
      color: 0xe8721f,
      emissive: 0x5c2606,
      emissiveIntensity: 0.45,
    }),
  );
  carrot.name = "carrot";
  g.add(carrot);

  const frondMat = toon({
    color: 0x5fae4d,
    emissive: 0x1c3a18,
    emissiveIntensity: 0.35,
  });

  // The green shoulder the fronds spring from. Without it they read as six
  // stalks hovering over an orange cone rather than as growing out of one.
  // Sized against the dome it sits on: the root is 0.071 across at this height,
  // so 0.082 clears it and caps the apex rather than sinking into it.
  const collar = new THREE.Mesh(new THREE.SphereGeometry(0.082, 8, 5), frondMat);
  collar.name = "collar";
  collar.position.y = 0.205;
  collar.scale.set(1, 0.55, 1);
  g.add(collar);

  const UP = new THREE.Vector3(0, 1, 0);
  CARROT_FRONDS.forEach((f, i) => {
    const frond = new THREE.Mesh(new THREE.ConeGeometry(f.r, f.len, 5), frondMat);
    frond.name = `frond${i + 1}`;
    // Unit by construction: sin^2*(cos^2 a + sin^2 a) + cos^2 = 1.
    const dir = new THREE.Vector3(
      Math.cos(f.a) * Math.sin(f.lean),
      Math.cos(f.lean),
      Math.sin(f.a) * Math.sin(f.lean),
    );
    frond.quaternion.setFromUnitVectors(UP, dir);
    // Base sits on the collar and the cone extends ALONG its own lean, so the
    // stalks stay rooted however the angles above are retuned.
    frond.position
      .set(Math.cos(f.a) * 0.018, 0.216, Math.sin(f.a) * 0.018)
      .addScaledVector(dir, f.len / 2);
    g.add(frond);
  });

  g.traverse((o) => {
    o.castShadow = true;
  });
  return g;
}

/** The berry's silhouette, as a lathe profile: [radius, height], crown to tip. */
const BERRY_PROFILE: readonly [number, number][] = [
  [0.0, 0.2],
  [0.058, 0.195],
  [0.11, 0.18],
  [0.15, 0.15],
  [0.17, 0.108],
  [0.172, 0.062],
  [0.16, 0.005],
  [0.135, -0.058],
  [0.104, -0.118],
  [0.07, -0.172],
  [0.035, -0.212],
  [0.0, -0.232],
];

/** Radial segments of the berry lathe. seedPips needs the SAME number: the
 *  lathe's surface is a ring of flat quads, not a cylinder, so a seed placed at
 *  the analytic radius floats above every facet it does not land exactly on. */
const BERRY_SEGMENTS = 14;

/** The berry's radius at a height, by walking BERRY_PROFILE. Used to sit the
 *  seeds ON the surface rather than at a guessed radius, so retuning the
 *  profile carries them with it. */
function berryRadiusAt(y: number): number {
  for (let i = 1; i < BERRY_PROFILE.length; i++) {
    const [r0, y0] = BERRY_PROFILE[i - 1];
    const [r1, y1] = BERRY_PROFILE[i];
    if (y <= y0 && y >= y1) {
      const k = (y0 - y) / (y0 - y1 || 1);
      return r0 + (r1 - r0) * k;
    }
  }
  return 0;
}

/**
 * The berry's outward surface normal at a height, as [radial, vertical] in the
 * profile's own 2D plane. BERRY_PROFILE is a polyline, so the normal is
 * constant across each segment and IS the plane of the lathe quad there — which
 * is what lets a seed's base lie flat on the surface instead of tangent to a
 * curve it only touches at one point.
 */
function berryNormalAt(y: number): [number, number] {
  for (let i = 1; i < BERRY_PROFILE.length; i++) {
    const [r0, y0] = BERRY_PROFILE[i - 1];
    const [r1, y1] = BERRY_PROFILE[i];
    if (y <= y0 && y >= y1) {
      // Profile runs crown-to-tip (dy <= 0), so (-dy, dr) points outward.
      const nr = y0 - y1;
      const ny = r1 - r0;
      const len = Math.hypot(nr, ny) || 1;
      return [nr / len, ny / len];
    }
  }
  return [1, 0];
}

/**
 * A solid star cap: a rim of `leaves` points, each raised and thrown outward,
 * with notches pulled in between them. Built as one geometry rather than as N
 * leaf meshes so the calyx stays a single named part in the editor outliner.
 *
 * It has real thickness. A zero-thickness fan would need DoubleSide to survive
 * being seen from below and would still vanish entirely edge-on, which this
 * cannot afford — spinDecor turns the fruit, and the calyx is the feature
 * doing the identifying.
 */
function starCap(
  leaves: number,
  tipR: number,
  tipY: number,
  notchR: number,
  notchY: number,
  apexY: number,
  thick: number,
): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const push = (x: number, y: number, z: number) => (pos.push(x, y, z), pos.length / 3 - 1);

  const apexTop = push(0, apexY, 0);
  const apexBot = push(0, apexY - thick, 0);
  const top: number[] = [];
  const bot: number[] = [];
  const n = leaves * 2;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const tip = i % 2 === 0;
    const r = tip ? tipR : notchR;
    const y = tip ? tipY : notchY;
    top.push(push(Math.cos(a) * r, y, Math.sin(a) * r));
    bot.push(push(Math.cos(a) * r, y - thick, Math.sin(a) * r));
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    idx.push(apexTop, top[j], top[i]); // upper fan
    idx.push(apexBot, bot[i], bot[j]); // lower fan, opposite winding
    idx.push(top[i], top[j], bot[j], top[i], bot[j], bot[i]); // rim
  }
  const geo = new THREE.BufferGeometry();
  geo.setIndex(idx);
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * The seeds, as ONE geometry: a small four-sided pip per seed, sat FLUSH on the
 * berry's own surface — base in the facet's plane, apex lifted off it.
 *
 * The build this replaces refused seeds outright, and the reasoning still
 * holds for the reference's roughly two hundred of them: at ~24px a scatter
 * that dense aliases into noise and reads as dirt, which is the CARTOON rule
 * in CLAUDE.md. Fourteen is a different proposition — each one lands at about
 * two pixels, which is the floor that rule sets rather than something under
 * it, so they read as deliberate texture. They are pips rather than pits
 * because a recess of this size fills with its own shadow and disappears.
 */
function seedPips(count: number, size: number, proud: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  const HALF_FACET = Math.PI / BERRY_SEGMENTS;
  const yTop = 0.13;
  const yBot = -0.15;
  for (let i = 0; i < count; i++) {
    const y = yTop + ((yBot - yTop) * (i + 0.5)) / count;
    if (berryRadiusAt(y) <= 0.02) continue;
    // Snap the azimuth to the MIDDLE of a lathe facet and use that facet's own
    // distance from the axis (r * cos(half facet)), not the analytic radius the
    // lathe only reaches at its vertices. Off by that difference, a pip hangs
    // in front of the berry with daylight under it.
    const facet = Math.round((i * GOLDEN) / (HALF_FACET * 2));
    const a = (facet + 0.5) * HALF_FACET * 2;
    const r = berryRadiusAt(y) * Math.cos(HALF_FACET);
    // LatheGeometry's own convention is x = radius * sin, z = radius * cos —
    // the quarter turn matters here, because a facet MIDPOINT in one
    // convention is a facet EDGE in the other, and the snapping above is only
    // worth doing if it lands where the flat actually is.
    const ox = Math.sin(a);
    const oz = Math.cos(a);
    // The surface is tilted wherever the profile slopes, so the pip gets the
    // facet's own frame: out along its normal, up along its slope, side around.
    const [nr, ny] = berryNormalAt(y);
    const out = [nr * ox, ny, nr * oz];
    const up = [-ny * ox, nr, -ny * oz];
    // (-oz, 0, ox), not (oz, 0, -ox): both are horizontal and perpendicular to
    // the outward axis, but only this one keeps the frame's handedness, and the
    // fan below is wound for it. The other choice culls every pip.
    const side = [-oz, 0, ox];
    const cx = r * ox + out[0] * proud;
    const cy = y + out[1] * proud;
    const cz = r * oz + out[2] * proud;
    const base = pos.length / 3;
    // Apex, lifted straight off the facet.
    pos.push(cx + out[0] * size * 0.5, cy + out[1] * size * 0.5, cz + out[2] * size * 0.5);
    // Four base corners, spread around the outward axis and then pulled back
    // onto the berry AT THEIR OWN HEIGHT. The profile is a polyline, so a
    // corner that spans one of its bends hangs off the kink if it is left in
    // the flat tangent plane.
    for (const [su, ss] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ]) {
      const px = cx + (up[0] * su + side[0] * ss) * size;
      const py = cy + (up[1] * su + side[1] * ss) * size;
      const pz = cz + (up[2] * su + side[2] * ss) * size;
      const hyp = Math.hypot(px, pz) || 1;
      const rr = berryRadiusAt(py) * Math.cos(HALF_FACET) + proud;
      pos.push((px / hyp) * rr, py, (pz / hyp) * rr);
    }
    for (let k = 0; k < 4; k++) {
      idx.push(base, base + 1 + k, base + 1 + ((k + 1) % 4));
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setIndex(idx);
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Strawberry — 400 (weight 12).
 *
 * Broad rounded shoulders tapering to a BLUNT point. The body is a lathe now,
 * not a cone capped with a squashed sphere: the reference's berry is a
 * continuous curve from crown to tip, and two intersecting primitives can only
 * approximate that at their seam. An earlier pass here had the sphere overhang
 * the cone and it read as the brim of a spinning top — a lathe cannot make that
 * mistake, because the silhouette IS the input.
 *
 * SEEDS, but fourteen of them. The previous build refused seeds altogether and
 * was right about the reference's two hundred: at ~24px that scatter aliases
 * into noise and reads as dirt. Fourteen pips at about two pixels each sit at
 * the floor the CARTOON rule sets rather than beneath it. They are placed from
 * berryRadiusAt(), so they sit on the profile rather than at a guessed radius.
 *
 * The CALYX carries the identification — it is the one part of this fruit that
 * is not red — so it is now a real star of pointed leaves that throw outward
 * and lift AWAY from the shoulder, rather than a squashed five-sided cone lying
 * flat on top of it.
 */
export function makeStrawberry(): THREE.Group {
  const g = new THREE.Group();
  g.rotation.set(0, 0, 0.5);
  const red = toon({
    color: 0xe23a5e,
    emissive: 0x5c0f22,
    emissiveIntensity: 0.5,
  });

  const berry = new THREE.Mesh(
    // REVERSED. BERRY_PROFILE reads crown-to-tip because that is the order
    // berryRadiusAt() walks and the order the shape is easiest to author in,
    // but LatheGeometry wants its points running the other way — its own
    // default is (0,-0.5), (0.5,0), (0,0.5), i.e. ascending y. Handing it a
    // descending profile inverts every face and its normals, FrontSide culls
    // the near wall, and the berry renders see-through. map() has already
    // copied, so reversing here does not touch the shared constant.
    new THREE.LatheGeometry(
      BERRY_PROFILE.map(([r, y]) => new THREE.Vector2(r, y)).reverse(),
      BERRY_SEGMENTS,
    ),
    red,
  );
  berry.name = "berry";
  g.add(berry);

  const seedMat = toon({
    color: 0xf0dda6,
    emissive: 0x4a3d18,
    emissiveIntensity: 0.3,
  });
  // proud is a rim-shimmer guard, nothing more: the pip base is already on the
  // facet, and any real offset here is the gap. The mesh sits at the ORIGIN —
  // an offset would push the seeds through the berry on one side and off it on
  // the other.
  const seeds = new THREE.Mesh(seedPips(14, 0.017, 0.001), seedMat);
  seeds.name = "seeds";
  g.add(seeds);

  const greenMat = toon({
    color: 0x5fae4d,
    emissive: 0x1c3a18,
    emissiveIntensity: 0.35,
  });
  // Tips at 0.150 sit well outboard of the shoulder the berry has at their
  // height, and 0.205 is above it — so the leaves stand off the fruit the way
  // a real calyx does instead of lying on it like a lid.
  const calyx = new THREE.Mesh(starCap(6, 0.148, 0.222, 0.072, 0.192, 0.208, 0.015), greenMat);
  calyx.name = "calyx";
  g.add(calyx);

  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.028, 0.1, 6), greenMat);
  stem.name = "stem";
  stem.position.set(0.012, 0.262, 0);
  stem.rotation.z = -0.16; // the reference's stem leans; a dead-vertical one reads as a nail
  g.add(stem);

  g.traverse((o) => {
    o.castShadow = true;
  });
  return g;
}

/**
 * The mango's silhouette, as a lathe profile about its own LONG axis:
 * [radius, distance along the axis], fat pole first. Ascending, because that is
 * the direction LatheGeometry wants its points — see makeStrawberry.
 *
 * It is deliberately not symmetric end to end, and the two poles are not the
 * same KIND of end either. The far pole is POINTED — the radius leaves it on a
 * long shallow ramp, which is a cone, not a hemisphere — while the stem pole
 * stays blunt, because that is the shoulder the reference puts the red cheek
 * on and a point there would be swallowed by it. The widest point sits just
 * past centre, biased toward the far pole. A stretched sphere, which is what
 * this used to be, is the same at both ends by construction.
 */
const MANGO_PROFILE: readonly [number, number][] = [
  [0.0, -0.29],
  [0.04, -0.256],
  [0.084, -0.218],
  [0.126, -0.174],
  [0.156, -0.122],
  [0.174, -0.058],
  [0.18, 0.008],
  [0.174, 0.072],
  [0.158, 0.132],
  [0.134, 0.186],
  [0.1, 0.228],
  [0.058, 0.256],
  [0.0, 0.272],
];

/**
 * Mango — 500 (weight 5), the one worth changing your route for.
 *
 * A long tilted oval with a red cheek: the only fruit here that is NOT
 * symmetrical about the Y axis, so spinning on the board (spinDecor) it visibly
 * turns where a plain sphere would look static however fast it spun.
 *
 * The FIRST pass of this was a near-round gold ball with a green leaf, and it
 * rendered as an orange apple — the cheapest fruit and the dearest one sharing
 * a silhouette, which is the one thing this set cannot afford. Hence the hard
 * stretch and the dropped leaf (it was the apple's tell). The reference this
 * was rebuilt from HAS a leaf, lying flat along the top; it is still not built,
 * for the same reason. Green on warm fruit is the apple's cue, and the 100 and
 * the 500 are the most expensive pair on the board to confuse.
 *
 * Two things the reference did correct.
 *
 * The body is a LATHE now rather than a stretched sphere, so it can be plump at
 * the far end and taper toward the stem the way a real one does. A scaled
 * sphere is identical at both ends however hard you stretch it.
 *
 * And the BLUSH is on the other end. It used to sit on the fat end with the
 * stem at the thin end — opposite poles. On a mango the red is on the shoulder
 * where the stalk comes out, so the two now share an end.
 *
 * The skin runs in three bands along the axis — GOLD, then GREEN, then RED at
 * the tip. Both bands are spheres poking through the lathe, and which one shows
 * at a given height is simply whichever has the larger cross-section there, so
 * the boundary between them is set by their radii and centres rather than being
 * drawn. They cross over at about 0.67 of the way along; below that the green
 * sphere is wider, above it the red one is.
 *
 * The blush is a second sphere in a different colour poking through the first,
 * not a texture: the whole project builds surfaces in code, and one extra
 * sphere is cheaper than a canvas for a thing this small.
 */
export function makeMango(): THREE.Group {
  const g = new THREE.Group();
  // The long axis, tilted. Everything else on this fruit is placed ALONG it by
  // the same helper, so the mango can be re-proportioned by editing these and
  // nothing ends up floating beside the body. k = +1 is the STEM pole, k = -1
  // the fat one.
  const tilt = 0.42;
  const halfLong = 0.272;
  const along = (k: number) =>
    new THREE.Vector3(Math.cos(tilt) * halfLong * k, Math.sin(tilt) * halfLong * k, 0);
  // Brings the lathe's own +Y axis onto that tilted line.
  const axisSpin = tilt - Math.PI / 2;

  const mango = new THREE.Mesh(
    new THREE.LatheGeometry(
      MANGO_PROFILE.map(([r, y]) => new THREE.Vector2(r, y)),
      16,
    ),
    toon({
      color: 0xf0b429,
      emissive: 0x5c3d05,
      emissiveIntensity: 0.5,
    }),
  );
  mango.name = "mango";
  mango.rotation.z = axisSpin;
  g.add(mango);

  // A red cheek over the STEM shoulder, not a dot on the side. Big enough that
  // it breaks the outline instead of sitting inside it, and placed along the
  // tilted long axis so it stays on its end as the fruit spins.
  // RED, and it owns the tip: 0.145 against the body's 0.130 where it sits, and
  // centred far enough out (0.70) that it reaches past the stem pole at 0.272.
  // A sphere smaller than the lathe's local radius stays buried and surfaces
  // only as ragged patches where the body happens to be narrower, which reads
  // as bruising rather than as a cheek — so both bands are sized against the
  // profile rather than guessed. Plain spheres with no scale on purpose: the
  // boundary where each breaks the surface is then a clean circle.
  const blush = new THREE.Mesh(
    new THREE.SphereGeometry(0.145, 10, 8),
    toon({
      color: 0xd6455c,
      emissive: 0x4a0f1c,
      emissiveIntensity: 0.45,
    }),
  );
  blush.name = "blush";
  blush.position.copy(along(0.7));
  g.add(blush);

  // Stem at the stem pole, pointing straight out along the long axis — short
  // and thick, as the reference's is. It keeps the two ends reading differently
  // so the shape has a direction even when the blush is facing away.
  // GREEN, as a band across the body BELOW the red. Wide (0.180 against the
  // body's 0.173 where it sits) and centred low, so it surfaces from about a
  // fifth of the way along and stays the wider of the two spheres until the red
  // overtakes it near the shoulder. It has to be this big: the green sits where
  // the mango is at its fattest, and anything smaller never breaks the surface
  // at all.
  const greenBand = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 12, 10),
    toon({
      color: 0x8faa38,
      emissive: 0x2c3a08,
      emissiveIntensity: 0.4,
    }),
  );
  greenBand.name = "greenBand";
  greenBand.position.copy(along(0.28));
  g.add(greenBand);

  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.03, 0.075, 6),
    toon({
      color: 0x6b6a2f,
      emissive: 0x241708,
      emissiveIntensity: 0.3,
    }),
  );
  stem.name = "stem";
  // 1.32, not 1.18: the red sphere now reaches 0.335 along the axis, and at
  // the closer setting it swallowed all but a sliver of the stalk.
  stem.position.copy(along(1.32));
  stem.rotation.z = axisSpin;
  g.add(stem);

  g.traverse((o) => {
    o.castShadow = true;
  });
  return g;
}

/**
 * id -> builder, so `spawnFruit` (and the editor's Pickups registry) can go
 * from a FRUITS entry to a mesh without a switch statement that someone has to
 * remember to extend.
 *
 * Typed as a full Record<FruitId, ...>, which is the load-bearing part: adding
 * a sixth fruit to config.ts's FRUITS without building a mesh for it is then a
 * TYPE ERROR at build time, not a fruit that silently fails to appear.
 */
export const FRUIT_BUILDERS: Record<FruitId, () => THREE.Group> = {
  apple: makeApple,
  banana: makeBanana,
  carrot: makeCarrot,
  strawberry: makeStrawberry,
  mango: makeMango,
};

/**
 * THE POWER-UPS (IDEA-046).
 *
 * Five pickups that change the rules rather than the score, so they have a
 * harder job than the fruits: a fruit only has to be TOLD APART, a power-up has
 * to be READ — you decide whether to cross the maze for it based on what you
 * think it does, before you have ever picked one up.
 *
 * So each one is built as an ICON, not as an object:
 *
 *  - The two doublers share one plaque shape and differ by colour AND by what
 *    is sitting on them: two biscuits, or two enemy domes. A literal "x2" was
 *    the obvious idea and is the wrong one — a glyph that small is unreadable
 *    at the game camera (a tile face is ~25px), whereas "two of the thing"
 *    survives being tiny and needs no reading at all.
 *  - The anchor, the star-bone and the shield each own a silhouette nothing
 *    else on the board has.
 *
 * Same fixed identity colours as every other pickup — they do not follow the
 * maze theme — and the same toon() + soft-glow emissive language.
 */

/** A rectilinear "2", traced clockwise as one closed outline in a 0.60 x 1.00
 *  box: top bar, right upper stem, middle bar, left lower stem, bottom bar.
 *  Rectilinear rather than typographic on purpose — this glyph is a few pixels
 *  tall in play, and a curved 2 spends its detail where nothing can see it. */
function glyph2Shape(): THREE.Shape {
  const s = new THREE.Shape();
  const pts: [number, number][] = [
    [0.0, 1.0],
    [0.6, 1.0],
    [0.6, 0.39],
    [0.22, 0.39],
    [0.22, 0.22],
    [0.6, 0.22],
    [0.6, 0.0],
    [0.0, 0.0],
    [0.0, 0.61],
    [0.38, 0.61],
    [0.38, 0.78],
    [0.0, 0.78],
  ];
  s.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) s.lineTo(x, y);
  s.closePath();
  return s;
}

/** An "x": a plus sign turned 45 degrees. Twelve points, which is exactly what
 *  a cross is — building it as two crossed rectangles instead would leave the
 *  overlap coplanar with itself and z-fight across the middle. */
function glyphXShape(cx: number, cy: number): THREE.Shape {
  const w = 0.11;
  const L = 0.34;
  const k = Math.SQRT1_2; // cos 45 = sin 45
  const cross: [number, number][] = [
    [-w, -L],
    [w, -L],
    [w, -w],
    [L, -w],
    [L, w],
    [w, w],
    [w, L],
    [-w, L],
    [-w, w],
    [-L, w],
    [-L, -w],
    [-w, -w],
  ];
  const s = new THREE.Shape();
  cross.forEach(([x, y], i) => {
    const rx = (x - y) * k + cx;
    const ry = (x + y) * k + cy;
    if (i === 0) s.moveTo(rx, ry);
    else s.lineTo(rx, ry);
  });
  s.closePath();
  return s;
}

/** "x2" as ONE geometry, scaled to `width` and centred on its own origin.
 *  ExtrudeGeometry takes an array of shapes, so both glyphs come out of a
 *  single mesh and a single draw call. */
function x2Geometry(width: number, depth: number): THREE.BufferGeometry {
  const geo = new THREE.ExtrudeGeometry([glyphXShape(-0.42, 0.42), glyph2Shape()], {
    depth,
    bevelEnabled: false,
    curveSegments: 1,
  });
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const s = width / (bb.max.x - bb.min.x);
  geo.scale(s, s, 1);
  geo.translate((-(bb.min.x + bb.max.x) / 2) * s, (-(bb.min.y + bb.max.y) / 2) * s, 0);
  return geo;
}

/**
 * THE DOUBLERS' TOKEN.
 *
 * Both are struck on the same thing: a six-sided cylinder standing face-on,
 * with "x2" raised on each face.
 *
 * Six sides, not round. There is already a gold disc on this board — makeCoin,
 * the shop currency — and a round gold token with a device on it IS that coin.
 * The facets are what keep them apart at a glance, so they are load-bearing
 * rather than styling.
 *
 * The glyph is RAISED and sunk slightly into the face, not floated on it and
 * not engraved: a recess this shallow fills with its own shadow and disappears,
 * which is the same finding that made the strawberry's seeds pips rather than
 * pits.
 *
 * Radius 0.29 because a hexagon of circumradius r is r*sqrt(3) across the
 * flats — at 0.23 the token measured 0.40 wide, which against the board's
 * 40.5 px per tile is exactly the 16px the contact sheet flagged red on both
 * doublers for.
 *
 * And it is honest to say the x2 does NOT do the identifying in play. At a
 * ~25px tile face the glyph is around six pixels tall and will not resolve;
 * gold-against-teal is what tells the two apart on the board, and the x2 is
 * there for the close-up and the editor. The build this replaced put two
 * biscuits or two enemy domes on the face instead, because "two of the thing"
 * survives being tiny — that reasoning was sound and is traded away
 * deliberately, not overlooked.
 *
 * THE TWO BUILDERS BELOW ARE DELIBERATELY NOT SHARED. They were, briefly, and
 * it broke the editor: src/editor/sourceRewrite.ts finds the builder named in
 * the registry and then looks for top-level `const` mesh declarations INSIDE
 * it, so a builder whose whole body is `return makeDoublerToken(...)` has
 * nothing for save-in-place to rewrite and every part is blocked. Geometry
 * helpers are fine to share — the editor never rewrites those — but the meshes
 * and their transforms have to be declared where the editor can find them.
 */

/**
 * Double biscuits — gold.
 *
 * Its glyph parts are named for the doubler rather than generically. The two
 * tokens are the same SHAPE and differ only in colour, so the part names are
 * the only thing separating them in the editor's outliner; a shared "x2Front"
 * would make them indistinguishable there.
 */
export function makeDoubleBiscuit(): THREE.Group {
  const g = new THREE.Group();
  g.rotation.set(-0.3, 0, 0);
  const gold = toon({ color: 0xf2c832, emissive: 0x5c4408, emissiveIntensity: 0.5 });
  const engraved = toon({ color: 0x7a5408, emissive: 0x2a1c02, emissiveIntensity: 0.45 });

  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.1, 6), gold);
  plate.name = "plate";
  // Face-on to the camera rather than lying flat: the board is viewed from
  // above and in front, and a flat disc would show as a thin line.
  plate.rotation.x = Math.PI / 2;
  g.add(plate);

  // Both faces. spinDecor turns this on Y, so a device on the front alone
  // leaves a blank token facing the player for half of every revolution.
  const biscuitX2Front = new THREE.Mesh(x2Geometry(0.37, 0.025), engraved);
  biscuitX2Front.name = "biscuitX2Front";
  biscuitX2Front.position.set(0, -0.08, 0.04);
  g.add(biscuitX2Front);

  const biscuitX2Back = new THREE.Mesh(x2Geometry(0.37, 0.025), engraved);
  biscuitX2Back.name = "biscuitX2Back";
  biscuitX2Back.position.set(0, -0.08, -0.04);
  biscuitX2Back.rotation.y = Math.PI; // reads the right way round from behind
  g.add(biscuitX2Back);

  g.traverse((o) => {
    o.castShadow = true;
  });
  return g;
}

/** Double enemies — teal. Same token as makeDoubleBiscuit; see the note above
 *  that block for why the two are written out rather than sharing a builder. */
export function makeDoubleGhost(): THREE.Group {
  const g = new THREE.Group();
  g.rotation.set(-0.3, 0, 0);
  const teal = toon({ color: 0x53c7c0, emissive: 0x0d3a38, emissiveIntensity: 0.5 });
  const engraved = toon({ color: 0x11524e, emissive: 0x041a18, emissiveIntensity: 0.45 });

  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.1, 6), teal);
  plate.name = "plate";
  plate.rotation.x = Math.PI / 2;
  g.add(plate);

  const enemyX2Front = new THREE.Mesh(x2Geometry(0.37, 0.025), engraved);
  enemyX2Front.name = "enemyX2Front";
  enemyX2Front.position.set(0, -0.08, 0.04);
  g.add(enemyX2Front);

  const enemyX2Back = new THREE.Mesh(x2Geometry(0.37, 0.025), engraved);
  enemyX2Back.name = "enemyX2Back";
  enemyX2Back.position.set(0, -0.08, -0.04);
  enemyX2Back.rotation.y = Math.PI;
  g.add(enemyX2Back);

  g.traverse((o) => {
    o.castShadow = true;
  });
  return g;
}

/**
 * The right half of the anchor's outline, traced from a reference illustration
 * and read clockwise from the top of the shoulder down to the keel tip. The
 * left half is this list mirrored, so the two sides cannot drift apart.
 *
 * `ctrl` present means a quadratic curve to `to`; absent means a straight run.
 * The curves are the point — the reference's arms are swept arcs, and the
 * previous build drew them as straight diagonals.
 */
type AnchorSeg = {
  to: [number, number];
  /** quadratic control point */
  ctrl?: [number, number];
  /** cubic control points, for the two long arm sweeps */
  c1?: [number, number];
  c2?: [number, number];
};

const ANCHOR_HALF: readonly AnchorSeg[] = [
  { to: [0.055, 0.22] }, // shoulder the ring sits on
  { to: [0.055, 0.195] },
  { to: [0.118, 0.195] }, // stock (crossbar), top edge
  // The stock END, as the reference draws it: the bar steps out onto a raised
  // COLLAR, and only then domes over into the cap. A single rounded end reads
  // as a lozenge; the collar is what makes it read as a forged fitting. The
  // step is 0.013 proud — under half a pixel on the board, so this is hero and
  // editor detail. It survives where the fluke barb did not only because it
  // sits on a straight run, where a step reads as a step; the barb sat inside a
  // curve, where the same size of feature reads as a chip.
  { to: [0.132, 0.208] }, // step up onto the collar
  { to: [0.152, 0.208] }, // collar, top run
  { to: [0.178, 0.15], ctrl: [0.18, 0.2] }, // cap, domed over
  { to: [0.152, 0.092], ctrl: [0.18, 0.1] }, // …and back under
  { to: [0.132, 0.092] }, // collar, bottom run
  { to: [0.118, 0.105] }, // step back down onto the bar
  { to: [0.052, 0.105] },
  // The shank's run, and a SLIM one — 0.10 across against a 0.33 stock.
  // Widening it was what turned the crown into a lump and swallowed the open V
  // below; the arms have to spring from a narrow shank to read at all. They
  // also spring HIGH, at -0.10: the V beneath them is the feature, and it needs
  // vertical room to be cut without the arm band going thin.
  //
  // The control point sits BELOW the segment and barely outboard of its start,
  // which holds the shank near-parallel for most of the run and puts the whole
  // flare in the last third, just above the crown. A control point placed
  // mid-run instead spreads the taper over the entire shank and the thing reads
  // as a wedge rather than a bar.
  { to: [0.078, -0.1], ctrl: [0.05, -0.04] },
  // Arm, upper edge — ONE clean sweep from the shank out to the fluke tip. The
  // open V it cuts between shank and blade is most of what says "anchor" rather
  // than "plus sign". The reference carries a small barb partway along this
  // edge; it was tried and dropped, because at a 26px glyph a spur inside the
  // scoop reads as a chip in the curve rather than as a barb.
  //
  // It is written as TWO cubics that meet at the bottom of the scoop with
  // matching horizontal tangents, so the join is invisible and the pair reads as
  // a single curve. Splitting it is what makes the point possible: one cubic
  // spanning the whole sweep arrives at the tip almost parallel to the outer
  // edge, the 0.022 bevel cannot fit inside an angle that thin, and the tip
  // renders chopped flat. The second cubic's trailing control sets a ~50 degree
  // tangent into the point instead, leaving roughly 22 degrees to resolve.
  { to: [0.17, -0.247], c1: [0.095, -0.185], c2: [0.13, -0.247] }, // the scoop
  { to: [0.3, -0.098], c1: [0.215, -0.247], c2: [0.258, -0.152] }, // …up to the TIP
  { to: [0.248, -0.285] }, // outer edge, one straight run back down the blade
  // Arm, lower edge — a convex cubic bowing under the crown, roughly parallel
  // to the scoop above it so the arm stays a band of even width.
  { to: [0.05, -0.318], c1: [0.19, -0.365], c2: [0.115, -0.362] },
  { to: [0.0, -0.39] }, // keel point — the lowest point, and a modest one
];

/**
 * Slow enemies — an anchor.
 *
 * Chosen over a snail, a clock or an hourglass because an anchor is the only
 * one of those whose outline survives being 25 pixels tall: a vertical bar, one
 * crossbar, one hook. The other three are all detail.
 *
 * That reasoning held, but the four-primitive build that came out of it did
 * not: an untapered cylinder, a second cylinder and a half-torus can express a
 * bar, a crossbar and a hook and nothing else. The three features that actually
 * say "anchor" rather than "plus sign" — the flukes, the barb notch inside each
 * one, and the keel point hanging below the crown — have no representation in
 * primitives that coarse, and the thin members alias into 2-3px sticks the toon
 * ramp has nothing to band.
 *
 * So it is now ONE closed outline (shank, stock, both arms, both flukes, keel)
 * extruded with a small bevel — the same construction as makeStar, in the same
 * spinning pickup slot, for the same reason its comment gives: without the
 * bevel a flat extrusion reads as a paper cut-out, because the side walls land
 * in the same ramp band as the face.
 *
 * Two proportions come straight off the reference and are worth keeping. The
 * FLUKE SPAN is the widest part of an anchor — the old build had the stock at
 * 81% of the arm span where a real one is nearer 55% — and the shank TAPERS,
 * widening as it drops into the crown. Both are silhouette facts, which is the
 * only kind that survives at this size.
 *
 * The colour is deliberately unchanged: the reference is teal, and teal would
 * sit next door to makeShield's 0x5ec8f0. Two power-ups in neighbouring hues on
 * one board is a worse trade than losing the reference's palette.
 */
export function makeAnchor(): THREE.Group {
  const g = new THREE.Group();
  g.rotation.set(-0.3, 0, 0);
  const iron = toon({
    color: 0x8fa6b8,
    emissive: 0x1e2c38,
    emissiveIntensity: 0.45,
  });

  const shape = new THREE.Shape();
  traceMirrored(shape, ANCHOR_HALF, 0.22);

  // Depth 0.12 rather than makeStar's 0.08. spinDecor turns this on Y, so twice
  // a revolution the glyph is edge-on and all the outline work above is worth
  // nothing — at 0.08 that view measured 5px across. This does not cure it (no
  // extrusion depth can), it just widens the worst frame by about a third
  // without the thing reading as a slab from the front.
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.12,
    bevelEnabled: true,
    bevelThickness: 0.022,
    bevelSize: 0.022,
    bevelSegments: 2,
    // 5, not the default 12 and not the 8 this started on. Every point the
    // curves are subdivided into is paid for twice by the two faces and twice
    // again by the two bevel segments, and at 8 this glyph cost 1724 triangles
    // against 768 for the next heaviest pickup on the board. At 5 the outline
    // is indistinguishable at both framings.
    curveSegments: 5,
  });
  // ExtrudeGeometry builds from z=0 forward, so the glyph sits half a depth off
  // the axis spinDecor turns it on. Centre Z only — NOT geo.center(). A
  // rotation.y spin is unaffected by a Y offset, the profile is already
  // symmetric in X, and centring Y would shift the body 0.05 up out of the
  // coordinates this profile was traced in, leaving the ring below half buried.
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  geo.translate(0, 0, -(bb.min.z + bb.max.z) / 2);

  const body = new THREE.Mesh(geo, iron);
  body.name = "glyph";
  body.scale.set(1, 1, 0.7);
  g.add(body);

  // The shackle stays a separate torus rather than a hole cut in the glyph: a
  // ring has to read as a thin closed LOOP, and an aperture through a 0.08-deep
  // extrusion is a dark socket at this size, not a hole. It overlaps the
  // shoulder by 0.029 so the two never show a seam.
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.026, 8, 18), iron);
  ring.name = "ring";
  ring.position.set(0, 0.315, 0);
  g.add(ring);

  g.traverse((o) => {
    o.castShadow = true;
  });
  return g;
}

/**
 * The STAR — flashes through the spectrum, Mario-style.
 *
 * This was a glowing BONE at first, and the reasoning was sound on paper: it
 * does what a power bone does and more, so make it look like a charged version
 * of the thing that already causes it. Play proved it wrong. The maze is full
 * of bones, so the one pickup that should stop you mid-corridor was the one
 * that looked most like scenery — Nuno played two sessions and never once
 * noticed it. A star shares its outline with nothing else in the game, which is
 * the entire job.
 *
 * Built from a real THREE.Shape rather than assembled from primitives: a
 * five-pointed star is a polygon, and ten line segments describe it exactly
 * where a pile of stretched boxes only approximates it. Extruded with a small
 * bevel so the points catch a different band of the toon ramp from the faces —
 * without it a flat extrusion reads as a paper cut-out.
 *
 * The colour cycling is applied by spinDecor via powerupFlash, not baked here.
 */
export function makeStar(): THREE.Group {
  const g = new THREE.Group();
  g.rotation.set(-0.3, 0, 0.628);

  const OUTER = 0.26;
  // 0.40 of the outer radius. Deeper notches (a smaller ratio) give a spikier,
  // sharper star that loses its points to aliasing at the game camera; shallower
  // ones round off into a blob. This is the value that still reads as a star at
  // ~25px.
  const INNER = OUTER * 0.4;
  const POINTS = 5;

  const shape = new THREE.Shape();
  for (let i = 0; i < POINTS * 2; i++) {
    const radius = i % 2 === 0 ? OUTER : INNER;
    // -PI/2 puts a POINT at the top. Without it the star sits rotated by half a
    // segment and reads as a flower.
    const angle = (i / (POINTS * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.08,
    bevelEnabled: true,
    bevelThickness: 0.022,
    bevelSize: 0.022,
    bevelSegments: 2,
  });
  // ExtrudeGeometry builds from z=0 forward, so the mesh would hang off its own
  // origin and the spin in spinDecor would swing it around rather than turn it
  // in place.
  geo.center();

  const star = new THREE.Mesh(
    geo,
    toon({
      color: 0xf7d873,
      emissive: 0x806000,
      emissiveIntensity: 0.6,
    }),
  );
  star.name = "star";
  g.add(star);

  g.traverse((o) => {
    o.castShadow = true;
  });
  return g;
}

/** The shield plate's right half, traced from a reference heater shield and
 *  read clockwise from the top of the arch down to the bottom point. Mirrored
 *  for the left half, as ANCHOR_HALF is. */
const SHIELD_HALF: readonly AnchorSeg[] = [
  // The top is a SHALLOW arc, not a dome. Its job is to hand off to the side at
  // a distinct shoulder corner — the reference's shoulders are the second thing
  // that says "heater" after the point, and a rounder top blurs them away.
  { to: [0.24, 0.205], ctrl: [0.15, 0.252] },
  { to: [0.205, -0.11], c1: [0.248, 0.09], c2: [0.232, -0.03] }, // upper side, near-vertical
  { to: [0.0, -0.36], c1: [0.195, -0.215], c2: [0.05, -0.29] }, // lower side, in to the point
];

/** The cross's right half, clockwise from the top of the vertical arm. Each arm
 *  is wider at its end than at the junction — a cross pattée, which is what the
 *  reference draws and what stops it reading as a plain plus sign. */
const CROSS_HALF: readonly AnchorSeg[] = [
  // Every arm runs PAST the rim's inner edge, so the cross merges into the
  // border rather than floating inside it — the way the reference draws it.
  { to: [0.045, 0.235] }, // vertical arm, flared top, into the rim
  { to: [0.032, 0.062] }, // narrowing in to the junction
  // The horizontal arm ends ROUNDED, and stops at 0.206 rather than 0.215. The
  // plate's edge is a curve and a straight vertical cut across it is not: the
  // middle of a square end sits inside the silhouette while its two corners
  // push through, which is the clipped edge you get on both sides. A rounded
  // cap has no corners to push, and the shortening keeps the whole end inboard
  // of the plate's outer edge (~0.225 here) while still reaching past the rim's
  // inner edge (~0.202), so it merges into the border rather than crossing it.
  { to: [0.196, 0.072] }, // out along the arm's top edge
  { to: [0.206, 0.03], ctrl: [0.207, 0.062] }, // round over the end
  { to: [0.196, -0.012], ctrl: [0.207, -0.002] }, // …and back under
  { to: [0.032, -0.002] }, // back in along its underside
  // The foot comes to a V, not a flat cut. The plate is tapering to its point
  // down here, so a flat bottom is wider than the plate it sits on and its two
  // corners hang out below the silhouette as tabs. A V narrows to nothing
  // exactly where the plate does, so there is no width left to protrude.
  { to: [0.036, -0.255] }, // down the vertical arm, narrowing
  { to: [0.0, -0.315] }, // to a point, nested inside the plate's own
];

/** Emit a half-profile and its mirror as one closed path. `scale` shrinks the
 *  outline about `cy`, which is how the rim gets its hole: the same trace at
 *  0.87 becomes the inner edge, and the gap between the two is the band. */
function traceMirrored(
  path: THREE.Path,
  half: readonly AnchorSeg[],
  startY: number,
  scale = 1,
  cy = 0,
): void {
  const sx = (x: number) => x * scale;
  const sy = (y: number) => cy + (y - cy) * scale;
  path.moveTo(0, sy(startY));
  for (const seg of half) {
    if (seg.c1 && seg.c2) {
      path.bezierCurveTo(sx(seg.c1[0]), sy(seg.c1[1]), sx(seg.c2[0]), sy(seg.c2[1]), sx(seg.to[0]), sy(seg.to[1]));
    } else if (seg.ctrl) {
      path.quadraticCurveTo(sx(seg.ctrl[0]), sy(seg.ctrl[1]), sx(seg.to[0]), sy(seg.to[1]));
    } else {
      path.lineTo(sx(seg.to[0]), sy(seg.to[1]));
    }
  }
  // Down to 0, NOT 1. Stopping at 1 leaves the first segment's mirror to
  // closePath(), which can only draw a straight line — so a curved opening
  // segment comes out as an arc on the right and a chord on the left. Harmless
  // for ANCHOR_HALF, whose first segment is already a horizontal line; it made
  // the shield's arched top visibly lopsided.
  for (let i = half.length - 1; i >= 0; i--) {
    const [tx, ty] = i === 0 ? [0, startY] : half[i - 1].to;
    const { ctrl, c1, c2 } = half[i];
    if (c1 && c2) {
      path.bezierCurveTo(-sx(c2[0]), sy(c2[1]), -sx(c1[0]), sy(c1[1]), -sx(tx), sy(ty));
    } else if (ctrl) {
      path.quadraticCurveTo(-sx(ctrl[0]), sy(ctrl[1]), -sx(tx), sy(ty));
    } else {
      path.lineTo(-sx(tx), sy(ty));
    }
  }
  path.closePath();
}

/** Centre a geometry on Z only — see makeAnchor for why not geo.center(). */
function centreZ(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  geo.translate(0, 0, -(bb.min.z + bb.max.z) / 2);
  return geo;
}

/**
 * Shield — a heater plate.
 *
 * Deliberately NOT transparent. A transparent shell is what a shield "should"
 * look like and it is the wrong call twice over here: alpha blending has to be
 * sorted against every other transparent thing in the scene, and a cel-shaded
 * ramp through a 40%-opacity surface loses the band edges that make the whole
 * scene read as one style. A solid plate with a bright rim says the same thing
 * and costs nothing.
 *
 * It used to be a squashed sphere plus a cone, and the comment that build
 * carried listed three reads it had already failed — a serving-dish cloche, a
 * downward pennant, and a map pin. All three are the same problem: when the
 * outline is a by-product of two intersecting primitives, you cannot tune the
 * outline, only the primitives. So it is now a traced profile, the same
 * construction as makeAnchor.
 *
 * Two things here are load-bearing:
 *
 *  - The RIM is a band, not a second plate: one profile carrying a HOLE, which
 *    is the same trace inset to 0.87. A larger plate stacked behind would read
 *    the same from the front and show a blank trim-coloured slab from the back.
 *  - The CROSS is extruded DEEPER than the plate and centred on it, so it
 *    stands proud on both faces. spinDecor turns this thing continuously; a
 *    cross on the front alone leaves a plain plate facing the player for half
 *    of every revolution.
 *
 * Colour is unchanged from the old build. The reference is white with a red
 * cross on a steel rim, and both halves of that are wrong for this board: a
 * mostly-white pickup sits in the same value band as the cream pellet bone,
 * dozens of which are on screen at once, and the red lands between apple
 * 0xd8483f and strawberry 0xe23a5e.
 */
export function makeShield(): THREE.Group {
  const g = new THREE.Group();
  g.rotation.set(-0.3, 0, 0);
  const face = toon({ color: 0x5ec8f0, emissive: 0x0d3a4a, emissiveIntensity: 0.55 });
  const trim = toon({ color: 0xd8f2ff, emissive: 0x2a5a6a, emissiveIntensity: 0.5 });

  // Bevel 0.012, not the anchor's 0.022: the cross bars are only 0.064 across
  // at the junction, and a 0.022 bevel each side would eat almost all of that.
  const bevel = { bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 1 };
  // The outline is far simpler than the anchor's, so this stays low — the
  // anchor at 1244 triangles is the board's outlier and this should not join it.
  const curveSegments = 5;
  // The centre the rim's hole is scaled about: midway up the plate, so the band
  // comes out near enough even width all the way round.
  const CY = -0.045;

  // 0.985, not 1: at full size the plate's outer wall is exactly coplanar with
  // the rim's, and the two z-fight into a stripe along the edge on every
  // off-axis frame. Shrinking it a hair hands the outer silhouette to the rim
  // and leaves nothing coincident.
  const plate = new THREE.Shape();
  traceMirrored(plate, SHIELD_HALF, 0.26, 0.985, CY);
  const body = new THREE.Mesh(
    centreZ(new THREE.ExtrudeGeometry(plate, { depth: 0.07, curveSegments, ...bevel })),
    face,
  );
  body.name = "field";
  g.add(body);

  // The rim: the same outline again, with the trace inset as a hole.
  const rimShape = new THREE.Shape();
  traceMirrored(rimShape, SHIELD_HALF, 0.26);
  const rimHole = new THREE.Path();
  traceMirrored(rimHole, SHIELD_HALF, 0.26, 0.9, CY);
  rimShape.holes.push(rimHole);
  const rim = new THREE.Mesh(
    centreZ(new THREE.ExtrudeGeometry(rimShape, { depth: 0.09, curveSegments, ...bevel })),
    trim,
  );
  rim.name = "border";
  g.add(rim);

  // Deeper than the plate and centred on it, so it stands proud front AND back.
  const crossShape = new THREE.Shape();
  traceMirrored(crossShape, CROSS_HALF, 0.235);
  const cross = new THREE.Mesh(
    centreZ(new THREE.ExtrudeGeometry(crossShape, { depth: 0.11, curveSegments, ...bevel })),
    trim,
  );
  cross.name = "cross";
  cross.scale.set(1.08, 1.08, 0.75);
  cross.position.set(-0.001, -0.013, 0);
  g.add(cross);

  g.traverse((o) => {
    o.castShadow = true;
  });
  return g;
}

/**
 * id -> builder. Same full-Record trick as FRUIT_BUILDERS: adding a sixth
 * power-up to config.ts without building a mesh for it is a TYPE ERROR, not a
 * power-up that silently never appears.
 */
export const POWERUP_BUILDERS: Record<PowerupId, () => THREE.Group> = {
  doubleBiscuit: makeDoubleBiscuit,
  doubleGhost: makeDoubleGhost,
  slowGhosts: makeAnchor,
  star: makeStar,
  shield: makeShield,
};

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

const matCoinBody = toon({
  color: 0xf4c430,


  emissive: 0x6b4e0a,
  emissiveIntensity: 0.5,
});
const matCoinRim = toon({
  color: 0xffcc33,


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
  body.name = "body";
  body.rotation.z = Math.PI / 2; // flat faces point along X/-X, edge faces the camera-ish view
  body.castShadow = true;
  g.add(body);

  const rim = new THREE.Mesh(geoCoinRim, matCoinRim);
  rim.name = "rim";
  rim.rotation.y = Math.PI / 2; // ring wraps the coin's circumference, matching the body's orientation
  rim.castShadow = true;
  g.add(rim);

  // Small emboss discs, one per face, sitting just proud of the body surface.
  const embossFront = new THREE.Mesh(geoCoinEmboss, matCoinRim);
  embossFront.name = "embossFront";
  embossFront.rotation.z = Math.PI / 2;
  embossFront.position.x = 0.03;
  embossFront.castShadow = true;
  g.add(embossFront);

  const embossBack = new THREE.Mesh(geoCoinEmboss, matCoinRim);
  embossBack.name = "embossBack";
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
  syncBoardMaterials(theme.palette, grid);

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

  return {
    pelletMeshes,
    pelletsLeft,
    walls,
    floor,
    fruit: null,
    coin: null,
    life: null,
    powerup: null,
    hedgeDecor,
    props,
  };
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
function syncBoardMaterials(palette: ThemePalette, grid: Grid): void {
  matWall.emissive.set(palette.wallEmissive);
  matWall.emissiveIntensity = palette.wallEmissiveIntensity;
  // The theme's SURFACE (hedge / sand / brick / none). Swapping a map between
  // null and a texture changes the shader program three compiles for this
  // material, so `needsUpdate` is required — without it the first themed board
  // renders untextured and only picks the pattern up on some unrelated later
  // recompile. Only flagged when the map actually changed, since a needless
  // recompile stalls the frame.
  const wallMap = wallTextureFor(palette.wallTexture, palette.wall);
  if (matWall.map !== wallMap) {
    matWall.map = wallMap;
    matWall.needsUpdate = true;
  }
  // Same rule as the floor below: a wall texture bakes palette.wall in as its
  // own ground, so the material must NOT tint it a second time.
  matWall.color.set(wallMap ? 0xffffff : palette.wall);

  // matFloor.color is set BELOW, once the ground texture is known — a textured
  // floor carries the palette colour inside the canvas and must stay white.
  matFloor.emissive.set(palette.floorEmissive);
  matFloor.emissiveIntensity = palette.floorEmissiveIntensity;
  // The theme's GROUND. Unlike the wall texture this is grid-derived — a
  // garden path, a park's gravel walk and a road's markings all follow the
  // corridors — so it cannot be cached by kind and must be rebuilt whenever
  // the level or the theme changes. The outgoing one is disposed here because
  // nothing else owns it: leaking one canvas texture per level would grow all
  // through a run.
  const nextFloor = floorTextureFor(palette.floorTexture, grid, palette.floor);
  if (matFloor.map !== nextFloor) {
    matFloor.map?.dispose();
    matFloor.map = nextFloor;
    // ALSO the emissive map, and this is what makes the pattern visible at
    // all. Every floor palette carries a flat emissive lift (~0.3), which is
    // added AFTER the map multiplies the colour — so on the dark floors
    // (city 0.22 luminance, forest 0.22, arcade 0.07) that constant swamped
    // the pattern and the first pass rendered as a plain surface. Driving the
    // emissive with the same texture means the dark parts of the pattern dim
    // the lift too, and the contrast survives.
    matFloor.emissiveMap = nextFloor;
    matFloor.needsUpdate = true;
  }
  // A floor texture bakes palette.floor in as its own ground, so the material
  // must NOT tint it a second time — that would square the colour and drag
  // every surface back down towards black.
  matFloor.color.set(nextFloor ? 0xffffff : palette.floor);

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
      toon({
        color,

        emissive: color,
        emissiveIntensity: palette.bloomEmissiveIntensity,
      }),
  );
  const matLeafSpeck = toon({
    color: palette.speckColor,

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
// Deliberately NOT a shared module-level THREE.MeshToonMaterial (unlike
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

function makeTrunkMat(color = DEFAULT_TRUNK_COLOR): THREE.MeshToonMaterial {
  return toon({ color});
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

  const mat = toon({ color: pickColor(colors, h)});
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

  const foliageMat = toon({ color: pickColor(colors, h)});
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

  const foliageMat = toon({ color: pickColor(colors, h)});
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
  const frondMat = toon({ color: pickColor(colors, h)});
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
  const coconutMat = toon({ color: 0x4a3524});
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

  const facadeMat = toon({ color: pickColor(colors, h)});
  const tower = new THREE.Mesh(new THREE.BoxGeometry(footprint, baseHeight, footprint), facadeMat);
  tower.name = "base"; // IDEA-033: addressable part name — see applyPropParts
  tower.position.y = baseHeight / 2;
  tower.castShadow = true;
  g.add(tower);

  // A smaller rooftop block, only if this def wants one at all AND on ~half
  // of instances (hash-driven), off-center so the skyline doesn't read as
  // identical box-on-box stamps.
  if (rooftop && h > 0.5) {
    const roofMat = toon({ color: pickColor(colors, 1 - h)});
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
    const windowMat = toon({
      color: windowColor,
      emissive: windowColor,
      emissiveIntensity: windowEmissiveIntensity,

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

  const poleMat = toon({ color: poleColor});
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
  const headMat = toon({
    color: headColor,
    emissive: headColor,
    emissiveIntensity: glowIntensity,

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

  const poleMat = toon({ color: poleColor});
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.66 * height, 8), poleMat);
  pole.name = "pole"; // IDEA-033: addressable part name — see applyPropParts
  pole.position.y = 0.33 * height;
  pole.castShadow = true;
  g.add(pole);

  const canopyColor = pickColor(colors, h);
  const canopyMat = toon({ color: canopyColor});
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
    const tipMat = toon({ color: tipColor});
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

  const stemMat = toon({ color: 0x4a6a2e});
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012 * width, 0.015 * width, 0.1 * width, 6), stemMat);
  stem.name = "stem"; // IDEA-033: addressable part name — see applyPropParts
  stem.position.y = 0.05 * width;
  stem.castShadow = true;
  g.add(stem);

  const bloomMat = toon({
    color: glowColor,

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

  const postMat = toon({ color: postColor});
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.024, height, 8), postMat);
  post.name = "post"; // IDEA-033: addressable part name — see applyPropParts
  post.position.y = height / 2;
  post.castShadow = true;
  g.add(post);

  const glowMat = toon({
    color: glowColor,
    emissive: glowColor,
    emissiveIntensity: glowIntensity,

  });

  if (boardColor !== undefined) {
    // Transit-signal read: a small rectangular board mounted near the top of
    // the post, with a glowing face plate slightly proud of it.
    const boardMat = toon({ color: boardColor});
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
      if (!(m instanceof THREE.MeshToonMaterial)) continue;
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
  const mat = toon({
    color: added.color,

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
 * identity colors in every theme (see makeBone/the FRUIT_BUILDERS/makeCoin/
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
  syncBoardMaterials(theme.palette, grid);

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
 * board (prototype maybeSpawnFruit only ever keeps one at a time).
 *
 * IDEA-045: WHICH fruit is the caller's decision, not this function's — the
 * weighted roll lives in src/game/fruits.ts so it can be tested in Node, and
 * this only turns the chosen id into the matching mesh. Placement
 * (which tile, when) is entirely gameplay's call — this just builds the mesh
 * and tracks it on the board so clearFruit/spinDecor and eating can find it.
 */
export function spawnFruit(
  board: Board,
  scene: THREE.Object3D,
  tx: number,
  ty: number,
  kind: FruitId,
): void {
  if (board.fruit) clearFruit(board, scene);
  const fruit = FRUIT_BUILDERS[kind]();
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
 * Spawns a power-up mesh at tile (tx,ty), replacing any already on the board
 * (mirrors spawnFruit/spawnCoin — only one at a time).
 *
 * WHICH power-up is gameplay's decision, not this function's: the weighted roll
 * lives in src/game/powerups.ts's caller so it can be tested in Node.
 */
export function spawnPowerup(
  board: Board,
  scene: THREE.Object3D,
  tx: number,
  ty: number,
  kind: PowerupId,
): void {
  if (board.powerup) clearPowerup(board, scene);
  const mesh = POWERUP_BUILDERS[kind]();
  mesh.position.set(worldX(tx), 0.4, worldZ(ty));
  mesh.userData.powerupId = kind;
  scene.add(mesh);
  board.powerup = mesh;
}

/** Removes the current power-up mesh (if any) from the scene and the board. */
export function clearPowerup(board: Board, scene: THREE.Object3D): void {
  if (!board.powerup) return;
  scene.remove(board.powerup);
  board.powerup = null;
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

  // IDEA-046: the power-up spins like the other bonus pickups, and the STAR
  // bone additionally cycles its emissive through the spectrum — the Mario-star
  // read Nuno asked for. Driven from an accumulator on the mesh rather than a
  // wall clock so it pauses when the game does, like everything else here.
  if (board.powerup) {
    board.powerup.rotation.y += dt * 2.5;
    if (board.powerup.userData.powerupId === "star") {
      const t = ((board.powerup.userData.flash as number) ?? 0) + dt;
      board.powerup.userData.flash = t;
      powerupFlash(board.powerup, t);
    }
  }
}

/**
 * Cycles the star bone's emissive through the spectrum.
 *
 * Emissive rather than `color`: on a toon material the base colour is quantised
 * into the ramp's three bands, so a hue sweep there arrives as three flat steps
 * and reads as a fault. The emissive is added AFTER the ramp, so it sweeps
 * smoothly — which is the whole point of a flashing pickup.
 *
 * Exported for the editor and the tests; game code reaches it via spinDecor.
 */
export function powerupFlash(mesh: THREE.Object3D, t: number): void {
  // ~2.5 cycles a second: fast enough to read as "charged", slow enough not to
  // be a strobe. The bone lasts a fright window, so this runs for ~7s at most.
  const hue = (t * 0.4) % 1;
  mesh.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = m.material as THREE.MeshToonMaterial;
    if (mat.emissive) mat.emissive.setHSL(hue, 0.85, 0.35);
  });
}
