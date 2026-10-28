// OWNER: render-artist (IDEA-023 shop v2, IDEA-026 theme diorama)
// The shop page's live 3D hero preview: a dedicated THREE.Scene — separate
// from both the game's own SceneRig (scene.ts) and the main menu's showcase
// (menuScene.ts) — that turntables whichever skin the player is currently
// browsing (a beagle, one of the four enemy forms, OR — IDEA-026 — a maze
// theme's own compact diorama) on a small garden patch, under the same
// daytime-garden identity as the rest of the app.
//
// Deliberately NOT a copy-paste of menuScene.ts's exact geometry (this scene
// only ever shows ONE hero at a time, and that hero is swapped repeatedly as
// the player taps cards/tabs — see showBeagle/showEnemy/showTheme below), but
// reuses its techniques verbatim: the same inward-facing gradient skydome, the
// same daylight rig (hemisphere + warm key + cool rim) so a skin reads with
// IDENTICAL lighting whether previewed here or worn in the menu/maze, and the
// same small soil+turf+hedge vignette so a CHARACTER hero always stands on
// "the same world" rather than a blank studio backdrop (a THEME hero brings
// its own ground instead — see the vignette show/hide note on showTheme).
//
// Contract: createShopScene() -> { scene, camera, update(dt), resize(aspect),
// showBeagle(skin), showEnemy(skinId), showTheme(themeId), dispose() } —
// created ONCE by game.ts alongside menuScene and reused for every shop
// visit; never rebuilt. Swapping the hero disposes the OUTGOING mesh's
// geometries/materials (a shopping session can swap the hero dozens of times
// as the player browses tabs/cards, so leaking one THREE.Group per tap would
// add up fast) and resets the turntable angle so every new hero starts
// front-on.
import * as THREE from "three";
import { COLORS } from "../game/config";
import { type BeagleSkin } from "../game/cosmetics";
import { getEquippedMazeTheme, getMazeTheme, type MazeTheme } from "../game/themes";
import {
  makeBeagle,
  makeEnemy,
  applyBeagleSkin,
  remapBeagleCoatMats,
  type BeagleParts,
} from "./characters";
import {
  makePropById,
  makePropFromDef,
  tunnelArchDefFor,
  TUNNEL_ARCH_INSTANCE_HASH,
  makeLifeBone,
  // IDEA-046: the three power-ups the tutorial stages (see showPowerups).
  makeShield,
  makeAnchor,
  makeStar,
} from "./board";
import { floorAccentsFor, floorPreviewTexture } from "./floorTexture";
import {
  VIGNETTE_CELLS,
  applyShowcaseSurfaces,
  disposeShowcaseSurfaces,
  type ShowcaseSurfaces,
} from "./showcaseSurface";
import { SHOWCASE_FOG_REACH, createShowcaseSurround } from "./showcaseSurround";
import { toon } from "./toon";
import { MADBOX_STYLE_ON } from "./madboxFlag";
import {
  applyMadboxStyle,
  makeMadboxCaches,
  setEmissiveIfPresent,
  boardBounce,
  shouldStyleBoard,
  type StyleableMat,
} from "./madboxStyle";
import { wallTextureFor } from "./wallTexture";
import { wallGeometry, wallShapeFor } from "./hedgeWall";
import { FENCE_PARAMS, fencePanelGeometry } from "./fence";
import { ARCH_PARAMS, archIsDirected } from "./archway";
import { distantPalm, distantTreasureChest } from "./islandProps";
import { buildPortalsAt, type TunnelPortals } from "./tunnelPortal";
import type { PropParams } from "../game/props";
import {
  type SurroundMaterials,
  makeSurroundMaterials,
  distantBeachSpot,
  distantBench,
  distantBroadleaf,
  distantCityBuilding,
} from "./surroundProps";

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

/** The character stage's own bits, kept so a theme can re-skin them — see
 *  applyPatchTheme. */
interface GardenPatch {
  group: THREE.Group;
  surfaces: ShowcaseSurfaces;
  // Widened for the same reason menuScene's ThemedBits is: [[IDEA-079]]'s
  // restyle swaps these for matcaps and `applyPatchTheme` must keep working
  // through whichever is in place.
  soilMat: StyleableMat;
  grassMat: StyleableMat;
  hedgeMat: StyleableMat;
  bloomMat: StyleableMat;
}

function makeGardenPatch(): GardenPatch {
  const g = new THREE.Group();

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
  const grassRim = new THREE.Mesh(new THREE.TorusGeometry(PATCH_RADIUS * 0.97, 0.055, 8, 40), grassMat);
  grassRim.rotation.x = Math.PI / 2;
  grassRim.receiveShadow = true;
  g.add(grassRim);

  // A single low hedge pair behind the hero, each topped with one bloom —
  // the game's own signature detail (board.ts's buildHedgeDecor) in
  // miniature, just enough to say "garden" without a full arc.
  const hedgeMat = toon({
    color: HEDGE_COLOR,


    emissive: COLORS.wallEmissive,
    emissiveIntensity: 0.2,
  });
  const hedgeGeo = new THREE.BoxGeometry(0.42, 0.26, 0.28);
  const bloomGeo = new THREE.SphereGeometry(0.05, 8, 8);
  const bloomMat = toon({
    color: BLOOM_COLOR,

    emissive: BLOOM_COLOR,
    emissiveIntensity: 0.25,
  });
  ([-1, 1] as const).forEach((s) => {
    const hedge = new THREE.Mesh(hedgeGeo, hedgeMat);
    hedge.position.set(s * PATCH_RADIUS * 0.62, 0.13, -PATCH_RADIUS * 0.62);
    hedge.rotation.y = s * 0.35;
    hedge.castShadow = true;
    hedge.receiveShadow = true;
    // IDEA-072 v2: HIDDEN, exactly as the menu's own arc is and for the same
    // reason — `buildStageDressing` now stands the REAL 1-unit maze wall behind
    // the hero, and a 0.42 x 0.26 stand-in beside it reads as a mistake rather
    // than as a second hedge. Kept rather than deleted so `applyPatchTheme`'s
    // hedge/bloom tinting still has something to address.
    hedge.visible = false;
    g.add(hedge);

    const bloom = new THREE.Mesh(bloomGeo, bloomMat);
    bloom.position.set(0, 0.18, 0);
    bloom.castShadow = true;
    hedge.add(bloom);
  });

  return {
    group: g,
    // The grass rim is a torus and stays untextured — its UVs wrap the
    // pattern exactly once around the whole ring, which smears it. Same call
    // as menuScene's vignette, for the same reason.
    surfaces: { wall: [hedgeMat], floor: [soilMat], cells: VIGNETTE_CELLS },
    soilMat,
    grassMat,
    hedgeMat,
    bloomMat,
  };
}

/**
 * Re-skins the character stage to `theme`, in place.
 *
 * The stage used to be permanently The Garden, which made it the one screen
 * where a player who had BOUGHT a theme could not see it: they would equip
 * Night City, open the shop to look at a beagle, and stand it on a garden
 * patch. It now follows the equipped theme exactly the way menuScene's
 * vignette does — same slot mapping (soil = floor, rim + hedge = wall, bloom =
 * decor), same procedural surfaces on top.
 */
function applyPatchTheme(patch: GardenPatch, theme: MazeTheme): void {
  const p = theme.palette;

  // First: the surfaces pass owns soilMat's COLOUR whenever the theme has a
  // floor texture (it bakes the palette colour into the canvas, so tinting it
  // again would square it) — see showcaseSurface.ts.
  applyShowcaseSurfaces(patch.surfaces, p);

  setEmissiveIfPresent(patch.soilMat, p.floorEmissive, p.floorEmissiveIntensity);

  // hedgeMat's colour belongs to applyShowcaseSurfaces (it wears the wall
  // texture); the grass rim is untextured and keeps the palette's wall colour.
  patch.grassMat.color.setHex(p.wall);
  for (const mat of [patch.grassMat, patch.hedgeMat]) {
    setEmissiveIfPresent(mat, p.wallEmissive, p.wallEmissiveIntensity);
  }

  // Arcade Night ships an empty bloom palette (deliberately clean/propless),
  // so fall back to the biscuit colour rather than a black dot — the same
  // fallback menuScene's own vignette uses.
  const bloom = p.bloomColors.length > 0 ? p.bloomColors[0] : p.biscuit;
  patch.bloomMat.color.setHex(bloom);
  setEmissiveIfPresent(patch.bloomMat, bloom, p.bloomEmissiveIntensity);
}

// ---------------------------------------------------------------------------
// IDEA-026: the maze-theme diorama hero — a compact maze-corner staging built
// FROM the theme's own ThemePalette, reusing board.ts's exact material
// recipe (same roughness/metalness/emissive treatment per slot) so the
// preview is honest: what you see here is what the real board will look
// like, not a stylized stand-in. TILE/WALL_H match board.ts's real wall
// block proportions (1x1x1) exactly, just a short 5-tile L-run rather than a
// full maze, small enough to sit comfortably in the same hero region a
// beagle/enemy occupies.
const DIORAMA_TILE = 1;
const DIORAMA_WALL_H = 1;

// The run, in local diorama tile coords (x grows right, z grows "into" the
// corner): a 3-long back arm and a side arm, and the side arm is the board's
// BORDER with the TUNNEL cut through it at (0, 2) — the one crossing every maze
// has (IDEA-067). It used to be a plain L of five boxes; the tunnel mouth is
// what lets the diorama carry the theme's own arch and portal, which since
// every theme got bespoke art (IDEA-080..083) is the single most recognisable
// thing a board has.
const DIORAMA_WALL_TILES: ReadonlyArray<[number, number]> = [
  [0, 0],
  [1, 0],
  [2, 0],
  [0, 1],
  [0, 3],
];
/** The tunnel tile, in the side arm. Its outside is -X. */
const DIORAMA_TUNNEL_TILE: [number, number] = [0, 2];
/**
 * The diorama's starting yaw: it turns the tunnel's OUTSIDE (-X in tile
 * space) toward the shop's diorama camera, which sits about 18 degrees round
 * from +Z. Built facing the other way, the first thing a player saw was the
 * arch edge-on behind the wall it belongs to — a green post — and the portal
 * not at all. Facing out, it is the menu's own composition in miniature: the
 * tunnel mouth seen from outside the maze, the trail running out through it.
 */
const DIORAMA_FACING = 1.9;
// The floor footprint is a little larger than the wall run's own bounding
// box so there's visible walkable ground in front of the corner (where the
// trail sits), not just under the walls themselves.
// Sized so the WHOLE trail sits on the slab with margin — the first cut
// (4.4 x 4.0 around center 1.0) ended short of the trail, so the last biscuit
// sat on the slab's corner edge and the bone floated past it in mid-air. It
// also has to carry the arch, which stands OUTSIDE the side arm at x ~ -0.8.
// One column wider than the bare L was, and centred a tile further left, for
// the arch: it stands outside the border arm, and on a phone's narrow frame
// the old centring put it past the left edge for the first half-turn.
const DIORAMA_FLOOR_SIZE = { w: 6.0, d: 5.0 };
const DIORAMA_FLOOR_CENTER = { x: 0.5, z: 1.0 };

// The slab as a TILE PATCH, for floorPreviewTexture — which needs to know
// where the corridors are, because that is what the park's gravel walk and the
// road's lane markings follow.
//
// It is the wall run above, transcribed: one cell per tile, cell (c, r) is
// diorama tile (c - 2, r - 1), so the walls land at (2,1),(3,1),(4,1),(2,2),
// (2,4) and the tunnel at (2,3) is open floor running straight out of the
// board. Keeping it aligned is what makes the preview honest: the floor's
// markings follow the open ground the biscuits sit on, not the walls.
const DIORAMA_FLOOR_CELLS: readonly string[] = [
  "......",
  "..###.",
  "..#...",
  "......",
  "..#...",
];

// The trail: biscuits one per tile down the tunnel row, heading OUT through
// the tunnel — the board's own pellet spacing, and the route a player takes
// into the portal — plus a power bone in the corner pocket.
const DIORAMA_BISCUIT_TILES: ReadonlyArray<[number, number]> = [
  [1, 2],
  [2, 2],
  [3, 2],
];
const DIORAMA_BONE_TILE: [number, number] = [2.1, 1.0];

// Bloom/speck spots on the wall tops, keyed to specific wall tiles above (not
// hashed per-tile like board.ts's full-maze buildHedgeDecor — a 5-tile
// diorama is small enough to hand-place for a deliberately "planted" rather
// than "randomly sparse" read) — a theme with bloomChance 0 or an empty
// bloomColors array simply shows none, same contract as board.ts's
// buildHedgeDecor.
const DIORAMA_BLOOM_SPOTS: ReadonlyArray<{ tile: [number, number]; jx: number; jz: number; colorIdx: number }> = [
  { tile: [0, 0], jx: -0.18, jz: 0.12, colorIdx: 0 },
  { tile: [1, 0], jx: 0.1, jz: -0.15, colorIdx: 1 },
  { tile: [0, 1], jx: 0.15, jz: 0.1, colorIdx: 2 },
];
const DIORAMA_SPECK_SPOTS: ReadonlyArray<{ tile: [number, number]; jx: number; jz: number }> = [
  { tile: [2, 0], jx: -0.1, jz: 0.15 },
  { tile: [0, 3], jx: 0.12, jz: -0.1 },
];

/**
 * 0-2 SIGNATURE props per theme, so the diorama sells what the theme's board
 * actually stands among — and ONLY that.
 *
 * Two kinds of source, because the boards now have two. The garden and the
 * forest still hand-place LIBRARY props (`makePropById`, the board's exact
 * factory). The beach, the park and Night City do not place any: since
 * IDEA-080..082 their places are built by the neighbourhood recipe — umbrellas
 * and towels on the sand, an avenue of trees and benches, a street of
 * frontages — so their signatures are those same `surroundProps` builders. The
 * old picks (the library umbrella, oak, streetlight and tower) were props
 * those boards stopped planting, i.e. the shop was advertising things the
 * player would never see after buying.
 */
type Signature =
  | { lib: string }
  | { build: (m: SurroundMaterials) => THREE.Object3D };
const DIORAMA_SIGNATURES: Readonly<Record<string, readonly Signature[]>> = {
  garden: [{ lib: "garden-tree" }, { lib: "garden-shrub" }],
  classic: [],
  forest: [{ lib: "pine" }, { lib: "critter-fox" }],
  beach: [{ build: (m) => distantBeachSpot(m, { seed: 7 }) }],
  park: [
    { build: (m) => distantBroadleaf(m, { height: 1.8, seed: 141 }) },
    { build: (m) => distantBench(m, { seed: 5 }) },
  ],
  city: [
    { build: (m) => distantCityBuilding(m, { height: 1.9, width: 1.3, depth: 1.1, seed: 21 }) },
    // `street: true`, as every tree cityLayout.ts plants: without it the crown
    // takes the foliage pair derived from `palette.wall`, which on this theme
    // is grey BRICK — the tree came out with near-black leaves.
    { build: (m) => distantBroadleaf(m, { height: 1.7, seed: 77, street: true }) },
  ],
  // Pirate Island (IDEA-085): a palm behind the corner and the treasure beside
  // the arch — the two things the island's board stands among. A stage-sized
  // chest rather than the board's, which at diorama scale was a matchbox.
  island: [
    { build: (m) => distantPalm(m, { height: 1.9, seed: 9 }) },
    {
      build: (m) => {
        const chest = distantTreasureChest(m, { seed: 3 });
        chest.scale.setScalar(1.0);
        return chest;
      },
    },
  ],
};

// Two open pockets of the slab clear of the walls, the trail and the arch: a
// "BEHIND" spot past the short back arm (a tall prop reads naturally sitting
// past the corner) and a "BESIDE" spot past the back-left corner, OUTSIDE the
// border like the arch and well clear of its piers. Array order is slot order:
// every two-entry list above is authored taller first.
const DIORAMA_SIGNATURE_SLOTS: ReadonlyArray<{ tile: [number, number]; rotY: number; hashSeed: number }> = [
  { tile: [3.2, 0.3], rotY: 0.5, hashSeed: 0.62 }, // BEHIND — index 0
  { tile: [-0.95, 0.15], rotY: -0.35, hashSeed: 0.3 }, // BESIDE — index 1
];

/** Converts a diorama tile coord to a local position, centered under
 *  DIORAMA_FLOOR_CENTER so the whole staging sits roughly on the vignette
 *  origin the camera rig is tuned for. */
function dioramaPos(tx: number, tz: number): [number, number] {
  return [(tx - DIORAMA_FLOOR_CENTER.x) * DIORAMA_TILE, (tz - DIORAMA_FLOOR_CENTER.z) * DIORAMA_TILE];
}

/**
 * Builds a maze-theme diorama: a small floor slab, a corner of the theme's
 * real maze wall with the TUNNEL cut through its border arm, the theme's own
 * tunnel arch and portal standing in it, a biscuit trail running out through
 * it and a power bone, the theme's wall-top blooms/specks, the picket fence
 * where the theme has one, and 0-2 signature props — every piece built by the
 * same function the real board uses for it, so the preview is honest about
 * what a purchase looks like.
 *
 * The portal animates: it is handed back on `userData.portal` and the scene
 * advances it from `update`.
 */
function makeThemeDiorama(theme: MazeTheme): THREE.Group {
  const palette = theme.palette;
  const hero = new THREE.Group();
  // Everything is built in tile space and then turned as one, so the tunnel
  // mouth FACES THE CAMERA when the turntable starts — see DIORAMA_FACING.
  const g = new THREE.Group();
  g.rotation.y = DIORAMA_FACING;
  // Turned that way, the arch and the corner behind it sit right of the
  // turntable's axis; this puts their middle back on it, so the mouth stays
  // in frame on a phone and the spin does not swing it out.
  g.position.x = -0.55;
  hero.add(g);

  // Floor — same emissive treatment as board.ts's matFloor, and the same
  // procedural GROUND too, drawn from DIORAMA_FLOOR_CELLS instead of a maze
  // grid. board.ts's two rules come with it: a floor texture bakes the
  // palette colour in, so the material is held at white while one is present
  // (tinting twice squares the colour), and the same texture drives the
  // emissive map or the palette's flat emissive lift swamps the pattern on
  // the dark themes. The diorama OWNS this texture — see disposeHero.
  const floorTex = floorPreviewTexture(palette.floorTexture, DIORAMA_FLOOR_CELLS, palette.floor, floorAccentsFor(palette));
  const floorMat = toon({
    color: floorTex ? 0xffffff : palette.floor,
    map: floorTex,
    emissiveMap: floorTex,
    emissive: palette.floorEmissive,
    emissiveIntensity: palette.floorEmissiveIntensity,
  });
  g.userData.floorTexture = floorTex;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(DIORAMA_FLOOR_SIZE.w, DIORAMA_FLOOR_SIZE.d), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.01;
  floor.receiveShadow = true;
  g.add(floor);

  // Walls — the board's own BLOCK (`wallGeometry` + `wallShapeFor`, so a hedge
  // theme gets IDEA-068's lumpy clipped crown rather than a cube) wearing the
  // board's own cached texture, instanced exactly like the real board with the
  // same quarter-turn variety. The texture is wallTextureFor's shared
  // instance, so it is never disposed here.
  const wallTex = wallTextureFor(palette.wallTexture, palette.wall);
  const wallMat = toon({
    // White while a texture is present: it bakes palette.wall in as its own
    // ground, exactly like the floor texture above.
    color: wallTex ? 0xffffff : palette.wall,
    map: wallTex,
    emissive: palette.wallEmissive,
    emissiveIntensity: palette.wallEmissiveIntensity,
  });
  const wallGeo = wallGeometry(wallShapeFor(palette.wallTexture), DIORAMA_WALL_H);
  const walls = new THREE.InstancedMesh(wallGeo, wallMat, DIORAMA_WALL_TILES.length);
  walls.castShadow = true;
  walls.receiveShadow = true;
  const dummy = new THREE.Object3D();
  DIORAMA_WALL_TILES.forEach(([tx, tz], i) => {
    const [x, z] = dioramaPos(tx, tz);
    dummy.position.set(x, DIORAMA_WALL_H / 2, z);
    dummy.rotation.y = (Math.PI / 2) * ((tx * 3 + tz * 5) % 4);
    dummy.updateMatrix();
    walls.setMatrixAt(i, dummy.matrix);
  });
  g.add(walls);

  // The picket fence, on every exposed face of every wall block — board.ts's
  // `buildFence` rule over the diorama's own handful of tiles.
  if (palette.fence === "picket") {
    const isWall = (tx: number, tz: number): boolean =>
      DIORAMA_WALL_TILES.some(([wx, wz]) => wx === tx && wz === tz);
    const fenceGeo = fencePanelGeometry(1);
    const fenceMat = toon({ color: palette.fenceColor, vertexColors: true });
    const sides = [
      { dx: 0, dz: 1, rot: 0 },
      { dx: 0, dz: -1, rot: Math.PI },
      { dx: 1, dz: 0, rot: Math.PI / 2 },
      { dx: -1, dz: 0, rot: -Math.PI / 2 },
    ] as const;
    const out = DIORAMA_TILE / 2 + FENCE_PARAMS.proud;
    for (const [tx, tz] of DIORAMA_WALL_TILES) {
      const [x, z] = dioramaPos(tx, tz);
      for (const s of sides) {
        if (isWall(tx + s.dx, tz + s.dz)) continue;
        const f = new THREE.Mesh(fenceGeo, fenceMat);
        f.position.set(x + s.dx * out, 0, z + s.dz * out);
        f.rotation.y = s.rot;
        f.castShadow = true;
        g.add(f);
      }
    }
  }

  // The tunnel arch and its portal, exactly as `buildTunnelArches` and
  // `buildTunnelPortals` stand them at a WEST mouth: past the border's outer
  // face by the outset, spanning the corridor, a gate's leaves opening OUT of
  // the maze. A theme with no arch (Arcade Night) still teleports, so it gets
  // the board's frameless portal.
  const [tunX, tunZ] = dioramaPos(DIORAMA_TUNNEL_TILE[0], DIORAMA_TUNNEL_TILE[1]);
  const archX = tunX - (DIORAMA_TILE / 2 + ARCH_PARAMS.outset);
  const spanZ = Math.PI / 2 + ARCH_PARAMS.yaw;
  const archDef = tunnelArchDefFor(theme);
  if (archDef) {
    const arch = makePropFromDef(archDef, TUNNEL_ARCH_INSTANCE_HASH);
    arch.position.set(archX, ARCH_PARAMS.lift, tunZ);
    arch.rotation.y = spanZ + (archIsDirected(archDef.params as PropParams) ? Math.PI : 0);
    arch.scale.multiplyScalar(ARCH_PARAMS.scale);
    arch.traverse((o) => {
      o.castShadow = true;
    });
    g.add(arch);
  }
  g.userData.portal = buildPortalsAt(g, theme, [{ x: archX, z: tunZ, rotationY: spanZ, name: "dioramaPortal" }]);

  // Biscuits — same emissive treatment as board.ts's matBiscuit, and the same
  // TRAIL role on a theme that draws its trail dark (MazeTheme.inkBiscuits), or
  // the beach's and the park's brown trail snaps a rung lighter here than it
  // renders in a run.
  const biscuitMat = toon({
    color: palette.biscuit,
    emissive: palette.biscuitEmissive,
    emissiveIntensity: palette.biscuitEmissiveIntensity,
  });
  if (theme.inkBiscuits) biscuitMat.userData.madboxRole = "trail";
  const biscuitGeo = new THREE.SphereGeometry(0.13, 12, 12);
  DIORAMA_BISCUIT_TILES.forEach(([tx, tz]) => {
    const [x, z] = dioramaPos(tx, tz);
    const biscuit = new THREE.Mesh(biscuitGeo, biscuitMat);
    biscuit.position.set(x, 0.13, z);
    biscuit.castShadow = true;
    g.add(biscuit);
  });

  // Bone — fixed off-white identity color in every theme, matching
  // board.ts's makeBone exactly (same shaft + four-knuckle shape/material).
  const boneMat = toon({
    color: 0xf6f1e6,
    emissive: 0x6a5730,
    emissiveIntensity: 0.4,
  });
  const bone = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.34, 10), boneMat);
  shaft.rotation.z = Math.PI / 2;
  bone.add(shaft);
  ([[-0.2, 0.09], [-0.2, -0.09], [0.2, 0.09], [0.2, -0.09]] as const).forEach(([kx, kz]) => {
    const k = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 10), boneMat);
    k.position.set(kx, 0, kz);
    bone.add(k);
  });
  bone.traverse((o) => { o.castShadow = true; });
  const [boneX, boneZ] = dioramaPos(DIORAMA_BONE_TILE[0], DIORAMA_BONE_TILE[1]);
  bone.position.set(boneX, 0.13, boneZ);
  bone.rotation.y = 0.5;
  g.add(bone);

  // Hedge-top blooms/specks — same recipe as board.ts's buildHedgeDecor
  // materials (color==emissive for blooms, a dedicated speck color/emissive),
  // just individual meshes rather than InstancedMesh. bloomChance <= 0 or an
  // empty bloomColors mean they are simply skipped, so the diorama shows a
  // clean, unplanted wall top — exactly matching the real board's contract.
  if (palette.bloomChance > 0 && palette.bloomColors.length > 0) {
    const bloomGeo = new THREE.SphereGeometry(0.075, 6, 6);
    const bloomMats = palette.bloomColors.map((color) =>
      toon({
        color,
        emissive: color,
        emissiveIntensity: palette.bloomEmissiveIntensity,
      }),
    );
    DIORAMA_BLOOM_SPOTS.forEach(({ tile, jx, jz, colorIdx }) => {
      const [x, z] = dioramaPos(tile[0], tile[1]);
      const mat = bloomMats[colorIdx % bloomMats.length];
      const bloom = new THREE.Mesh(bloomGeo, mat);
      bloom.position.set(x + jx, DIORAMA_WALL_H + 0.06, z + jz);
      bloom.castShadow = true;
      g.add(bloom);
    });

    if (palette.speckChance > 0) {
      const speckGeo = new THREE.SphereGeometry(0.05, 6, 6);
      const speckMat = toon({
        color: palette.speckColor,
        emissive: palette.speckEmissive,
        emissiveIntensity: 0.2,
      });
      DIORAMA_SPECK_SPOTS.forEach(({ tile, jx, jz }) => {
        const [x, z] = dioramaPos(tile[0], tile[1]);
        const speck = new THREE.Mesh(speckGeo, speckMat);
        speck.position.set(x + jx, DIORAMA_WALL_H + 0.04, z + jz);
        speck.scale.set(1.3, 0.6, 1);
        g.add(speck);
      });
    }
  }

  // The signatures. A surround builder needs the theme's surround material
  // set, which is built only when one is asked for and is disposed with the
  // rest of the hero's materials (disposeHero traverses every mesh).
  const signatures = DIORAMA_SIGNATURES[theme.id] ?? [];
  const needsMats = signatures.some((s) => "build" in s);
  const mats = needsMats ? makeSurroundMaterials(palette) : null;
  signatures.forEach((sig, slotIdx) => {
    if (slotIdx >= DIORAMA_SIGNATURE_SLOTS.length) return; // never more entries than slots
    const slot = DIORAMA_SIGNATURE_SLOTS[slotIdx];
    const [x, z] = dioramaPos(slot.tile[0], slot.tile[1]);
    const prop = "lib" in sig ? makePropById(sig.lib, slot.hashSeed) : sig.build(mats as SurroundMaterials);
    prop.position.set(x, 0, z);
    prop.rotation.y = slot.rotY;
    prop.traverse((o) => {
      o.castShadow = true;
    });
    g.add(prop);
  });

  hero.userData.floorTexture = g.userData.floorTexture;
  hero.userData.portal = g.userData.portal;
  return hero;
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

// IDEA-026: a SECOND camera rig, used only while a theme diorama is staged.
// The character rig above (CAM_POS/CAM_LOOK) is tuned for a compact, roughly
// egg-shaped hero ~0.6-0.9 units across; the diorama is a low, WIDE ~4x4
// footprint with walls only 1 unit tall, so reusing the character framing
// verbatim would either crop the L-run's far corner or leave the hero region
// mostly empty floor. Same technique as the character rig (fixed FOV, a
// raised/pulled-back eye-line position with a modest downward tilt so the
// wall-block volumes read dimensionally rather than flattening under a steep
// top-down look, portrait dolly-back along the same look-ray) — just
// re-tuned distances/height for the wider, flatter subject: higher (more of
// a "looking into a garden corner" angle than the character rig's near-eye-
// level one, so both wall arms of the L are visible past each other) and
// further back so the diorama's far corner (tile [2,0]/[0,2], local ~1.7
// units from the pivot) still clears the frame with margin.
const DIORAMA_CAM_FOV = 40;
// Pulled well back from the first pass (1.3, 2.6, 3.4 — dist ~4.4): the
// diorama is a ~4.4-unit slab, an order of magnitude wider than the
// ~0.6-unit character heroes, and at that distance single wall blocks
// filled the entire stage. ~10.6 units frames the WHOLE vignette as a
// tabletop miniature with comfortable margins through a full turntable
// spin, and the look-at sits slightly right of center so the model reads
// centered in the stage region left of the desktop side panel.
const DIORAMA_CAM_POS = new THREE.Vector3(3.2, 6.2, 8.6);
const DIORAMA_CAM_LOOK = new THREE.Vector3(0.35, 0.25, 0);
const DIORAMA_PORTRAIT_DIST = 12.2;
const DIORAMA_BASE_DIST = DIORAMA_CAM_POS.distanceTo(DIORAMA_CAM_LOOK);
const DIORAMA_CAM_DIR = DIORAMA_CAM_POS.clone().sub(DIORAMA_CAM_LOOK).normalize();

/**
 * IDEA-072: the diorama gets GROUND AND FOG, and NO horizon band.
 *
 * Solved rather than guessed, after guessing twice. The camera sits at
 * (3.2, 6.2, 8.6) — 9.2 units from the stage centre horizontally — at 33.3
 * degrees of elevation with a 20-degree half-FOV, so the TOP of frame points
 * 13.3 degrees DOWNWARD and, from y = 6.2, meets the ground 26.2 horizontal
 * units from the camera: about **17 units past the stage centre**. Its horizon
 * is off the top of the screen entirely, which is IDEA-066's situation and not
 * the character stages' — and there a bigger floor was the whole answer.
 *
 * That leaves a band nowhere to stand. At 0.38 (12.9-22.8 units) it was inside
 * the frame's own ground line and sprawled hedges and a flower border across
 * the top of the picture at near-full saturation. At 0.55 (18.7-33) it was
 * past the line, and the only thing that ever reached the screen was a CROPPED
 * fragment along the very top edge — which reads as debris rather than as
 * distance. Both were rendered; neither is better than none.
 *
 * The character rig is the opposite case and keeps its band: at 9.5 degrees of
 * elevation its horizon is IN shot a quarter of the way down the frame, and
 * ground alone can never reach above it.
 */
const DIORAMA_SURROUND_SCALE = 0;


// Idle life tuning — same spirit as menuScene's TURNTABLE_SPEED: a slow,
// continuous showcase spin so the player can see the whole skin without
// touching anything. The diorama turntables noticeably slower than a
// character hero: a wide low structure reads its shape from a full rotation
// far more than a compact hero does, so a slower spin gives the eye time to
// take in each wall arm as it comes into view instead of blurring past.
const TURNTABLE_SPEED = 0.22;
const DIORAMA_TURNTABLE_SPEED = 0.14;

/** Kind of hero currently staged. "theme" (IDEA-026) uses its own camera rig
 *  (DIORAMA_CAM_*) and turntable speed, and hides the garden-patch vignette
 *  (the diorama brings its own floor/walls) — see resize()/showTheme below. */
type HeroKind = "beagle" | "enemy" | "theme" | "pickup";

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
  /** Swaps the hero to the enemy form for `skinId` (ghost/beetle/bee/ladybug/
   *  flea/crab), in the canonical preview color. Disposes the previous hero and
   *  resets the turntable angle. Dispatches through `makeEnemy`, so a new skin
   *  needs nothing here. */
  showEnemy(skinId: string): void;
  /** IDEA-026: swaps the hero to `themeId`'s maze-corner diorama (a small
   *  floor + L-shaped wall run + biscuit trail + bone + theme-appropriate
   *  hedge-top blooms/specks, all skinned from the theme's own ThemePalette
   *  via the same material recipe board.ts uses for the real board). Unknown
   *  ids degrade to the default theme (mirrors getMazeTheme's own fallback —
   *  never throws). Disposes the previous hero, resets the turntable angle,
   *  switches to the diorama's own camera framing, and hides the
   *  garden-patch vignette (the diorama brings its own ground) — see the
   *  showTheme implementation below for exactly what toggles. */
  showTheme(themeId: string): void;
  /** IDEA-040 v2: stages the GOLDEN BONE (the bonus-life pickup) as the hero,
   *  for the tutorial's "earning more lives" slide. Uses board.ts's real
   *  makeLifeBone, scaled up and floated above the garden patch, so the player
   *  is shown the exact mesh they need to recognise mid-run. */
  showGoldenBone(): void;
  /** IDEA-046: stages the three power-ups worth SHOWING — the shield, the
   *  anchor and the star bone — as a row. The two doublers are deliberately
   *  left out: they are flat plaques whose whole meaning is the icon on their
   *  face, and at this camera they read as coloured tiles. The tutorial slide
   *  describes them in words instead. */
  showPowerups(): void;
  /** Re-skins the CHARACTER stage (the soil disc, turf rim, hedges and their
   *  blooms) to a maze theme's palette and procedural surfaces, so a player
   *  browsing beagles or enemies stands them on the ground they actually
   *  own. Independent of showTheme, which stages a theme as the hero. */
  setMazeTheme(theme: MazeTheme): void;
  /** Releases the current hero's + patch's geometries/materials. Only
   *  meaningful if the whole game is being torn down — the shop scene is
   *  otherwise created once and kept alive for the app's lifetime. */
  dispose(): void;
}

// The team color used for every enemy preview (per the task brief: rose, the
// chaser) — the shop shows FORM, not team-color assignment, so one fixed
// color across all six enemy skins keeps the comparison apples-to-apples.
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
  // IDEA-026: DEFAULT_BG/DEFAULT_HEMI_* below are this exact value/rig — kept
  // as named background/hemisphere so showTheme can subtly tint them toward
  // a staged theme and showBeagle/showEnemy can restore them exactly.
  scene.background = new THREE.Color(COLORS.bg);
  const backdrop = makeBackdrop();
  scene.add(backdrop);
  /** The dome follows the EQUIPPED theme, as the menu's does. It used to stay
   *  the garden's daytime blue whatever was equipped, so a Night City or
   *  Arcade Night player browsed coats on a dark ground under a noon sky. */
  function applyDome(theme: MazeTheme): void {
    const u = (backdrop.material as THREE.ShaderMaterial).uniforms;
    // Fresh colours rather than writing through: the defaults are module-level
    // constants the uniforms were built from.
    u.topColor.value = new THREE.Color(theme.palette.backdropTop);
    u.bottomColor.value = new THREE.Color(theme.palette.bg);
  }
  applyDome(getEquippedMazeTheme());

  const camera = new THREE.PerspectiveCamera(CAM_FOV, 1, 0.1, 200);
  camera.position.copy(CAM_POS);
  camera.lookAt(CAM_LOOK);

  // Mirrors menuScene.ts's (and, in turn, scene.ts's) daylight rig exactly so
  // a skin reads with identical lighting in every showcase. Named (`hemi`,
  // not an inline scene.add(new ...)) so showTheme/showBeagle/showEnemy can
  // nudge/restore its sky+ground colors for the subtle theme tint below.
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

  // IDEA-026: the garden-patch vignette only makes sense under a CHARACTER
  // hero (it's the "same world" grounding for a beagle/enemy that otherwise
  // has no floor of its own) — a theme diorama brings its own floor + walls,
  // so the two would visually collide (two overlapping ground planes) if
  // both were visible. Kept as a named reference so showTheme/setHero can
  // toggle its `.visible` rather than add/remove it from the scene (cheaper,
  // and avoids re-triggering shadow-map/matrix churn on every tab switch).
  const patch = makeGardenPatch();
  const madboxCaches = makeMadboxCaches();
  const gardenPatch = patch.group;
  scene.add(gardenPatch);

  // IDEA-072: ground out to the horizon, a fogged band of the theme's own
  // neighbourhood standing on it, and fog matched to the sky. `eyeY` is the
  // CAMERA's height rather than the look target's, because the fog has to
  // match the dome along a horizontal ray FROM the camera.
  const surround = createShowcaseSurround(scene, {
    eyeY: CAM_POS.y,
    seed: 2,
    stage: { bandScale: 1, camDist: BASE_DIST, fogReach: SHOWCASE_FOG_REACH },
  });

  // Show the EQUIPPED theme from the first paint rather than flashing the
  // garden default — same reasoning (and the same guarantee that the profile
  // is hydrated before Game is constructed) as menuScene's own first-paint
  // applyTheme.
  applyPatchTheme(patch, getEquippedMazeTheme());

  // [[IDEA-079]], two passes, same order and same reason as menuScene's: TINT
  // the patch first (applyPatchTheme repaints it on every theme change, so its
  // colours must stay on the materials and its references must point at what
  // is drawn), then BAKE everything else.
  if (MADBOX_STYLE_ON) {
    const swaps = applyMadboxStyle(patch.group, boardBounce(getEquippedMazeTheme().palette), madboxCaches, undefined, {
      tint: true,
    });
    const pick = (m: StyleableMat): StyleableMat =>
      (swaps.get(m as unknown as THREE.Material) as StyleableMat | undefined) ?? m;
    patch.soilMat = pick(patch.soilMat);
    patch.grassMat = pick(patch.grassMat);
    patch.hedgeMat = pick(patch.hedgeMat);
    patch.bloomMat = pick(patch.bloomMat);
    applyMadboxStyle(scene, boardBounce(getEquippedMazeTheme().palette), madboxCaches);
  }
  surround.apply(getEquippedMazeTheme());

  // IDEA-026: default atmosphere values, captured once, so showBeagle/
  // showEnemy can restore the standard shop look exactly (bitwise) after a
  // theme diorama tinted it — avoids any drift from repeated tint/restore
  // round-trips as the player bounces between the Beagle/Enemy/Theme tabs.
  const DEFAULT_BG = COLORS.bg;
  const DEFAULT_HEMI_SKY = 0xd8f0ff;
  const DEFAULT_HEMI_GROUND = 0x4a3a20;

  let heroKind: HeroKind = "beagle";
  let hero: THREE.Group = makeBeagle();
  scene.add(hero);

  let idleT = 0;
  let turntableAngle = 0;
  // Tracks the aspect passed to the last resize() call so a hero-kind swap
  // (which can change which camera rig applies — see applyCameraFraming
  // below) can immediately re-run the SAME framing math without waiting for
  // the next real window resize event.
  let lastAspect = 1;

  /** Disposes `hero`'s geometries/materials and removes it from the scene —
   *  the shared teardown step for both a hero SWAP (called right before the
   *  replacement is added) and final dispose() below. */
  function disposeHero(obj: THREE.Group): void {
    scene.remove(obj);
    // A theme diorama draws its own ground and is the only owner of it.
    // Material.dispose() does NOT free a map, so browsing the Themes tab
    // would leak one canvas texture per tap without this. The WALL map is
    // deliberately left alone: it is wallTextureFor's shared, cached
    // instance — the same object the real board's walls hold.
    (obj.userData.floorTexture as THREE.Texture | undefined)?.dispose();
    // The diorama's portal is Points + ShaderMaterials, which the mesh
    // traversal below does not reach; it owns its own teardown.
    (obj.userData.portal as TunnelPortals | undefined)?.dispose();
    obj.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const mat = o.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat.dispose();
      }
    });
  }

  /** Positions `camera` per the framing rig for `kind` at `aspect` — the
   *  character rig (CAM_*) for "beagle"/"enemy", the diorama rig
   *  (DIORAMA_CAM_*) for "theme" — including each rig's own portrait
   *  dolly-back. Shared by resize() (called on every real window resize) and
   *  setHero() (called on every hero-kind swap, so the camera framing is
   *  correct the instant a theme diorama — or a character hero returning
   *  from one — is staged, not just after the next resize). */
  function applyCameraFraming(kind: HeroKind, aspect: number): void {
    camera.aspect = aspect;

    if (kind === "theme") {
      camera.fov = DIORAMA_CAM_FOV;
      const t = aspect >= 1 ? 0 : Math.min(1, (1 - aspect) / (1 - PORTRAIT_ASPECT_REF));
      const dist = DIORAMA_BASE_DIST + (DIORAMA_PORTRAIT_DIST - DIORAMA_BASE_DIST) * t;
      camera.position.copy(DIORAMA_CAM_LOOK).addScaledVector(DIORAMA_CAM_DIR, dist);
      camera.lookAt(DIORAMA_CAM_LOOK);
    } else {
      camera.fov = CAM_FOV;
      const t = aspect >= 1 ? 0 : Math.min(1, (1 - aspect) / (1 - PORTRAIT_ASPECT_REF));
      const dist = BASE_DIST + (PORTRAIT_DIST - BASE_DIST) * t;
      camera.position.copy(CAM_LOOK).addScaledVector(CAM_DIR, dist);
      camera.lookAt(CAM_LOOK);
    }

    camera.updateProjectionMatrix();
  }

  /** Shared by showBeagle/showEnemy/showTheme: swaps `hero` to `next`,
   *  disposing the outgoing mesh, resetting the turntable so every new hero
   *  starts front-on rather than continuing mid-spin from wherever the last
   *  one stopped, showing/hiding the garden-patch vignette for the new kind
   *  (visible for a character hero, hidden for a theme diorama — see
   *  gardenPatch's doc comment above), and re-applying camera framing
   *  immediately in case `kind` changed the active rig. */
  function setHero(next: THREE.Group, kind: HeroKind): void {
    // [[IDEA-079]]: style the hero as it arrives. It is REBUILT on every tab
    // switch (see showBeagle's note on why), so this is the one place that
    // catches all of them — and TINT mode rather than the baked palette snap,
    // because the hero is the player's own coat or the enemy they are being
    // sold, and snapping it would quietly show them a colour they did not buy.
    //
    // Enemies are skipped inside applyMadboxStyle whatever is asked, so a
    // shop enemy stays toon exactly as it does in a run — which is what keeps
    // the preview honest about what the player is getting.
    if (MADBOX_STYLE_ON) {
      const swaps = applyMadboxStyle(next, boardBounce(getEquippedMazeTheme().palette), madboxCaches, undefined, {
        tint: true,
      });
      if (kind === "beagle") remapBeagleCoatMats(next, swaps);
    }
    disposeHero(hero);
    hero = next;
    heroKind = kind;
    scene.add(hero);
    turntableAngle = 0;
    hero.rotation.y = 0;
    gardenPatch.visible = kind !== "theme";
    // The two rigs frame opposite depths — see DIORAMA_SURROUND_SCALE.
    surround.setStage(
      kind === "theme"
        ? {
            bandScale: DIORAMA_SURROUND_SCALE,
            camDist: DIORAMA_BASE_DIST,
            // Past the 17 units at which this rig's frame leaves the ground,
            // so the lawn fades out near the top of the picture instead of
            // ending on a hard line — and nowhere near the model, which sits
            // 8-13 units from the camera and must stay at zero fog.
            fogReach: 26,
          }
        : { bandScale: 1, camDist: BASE_DIST, fogReach: SHOWCASE_FOG_REACH },
    );
    applyCameraFraming(kind, lastAspect);

    // RESTYLE AFTER THE SURROUND IS STAGED, not just at construction.
    //
    // `surround.setStage` REBUILDS the horizon band and the stage dressing —
    // and it is called from here, which runs after the construction-time pass.
    // So the band was never styled at all: the shop kept forty-nine toon
    // materials while everything in front of them was matcap, and it read as
    // a styled hero standing in an unstyled world. Exactly the ordering bug
    // the beagle hit in `buildLevel`.
    //
    // Safe to run on every tab switch because the swap is IDEMPOTENT — a
    // material that is already a matcap is skipped.
    if (MADBOX_STYLE_ON) applyMadboxStyle(scene, boardBounce(getEquippedMazeTheme().palette), madboxCaches);
  }

  // Same local idle-animation approach as menuScene.ts's animateIdle: the
  // showcase hero has no real game Entity/facing to sync via syncToEntity, so
  // drive the turntable directly here, plus (for a beagle hero only â€” enemies
  // have no `parts`) the same tail-wag/ear-sway/breathing formulas
  // characters.ts's animateBeagleParts already implements for the idle case.
  function animateIdle(dt: number): void {
    idleT += dt;
    // IDEA-026: the diorama turntables at its own, slower speed â€” see
    // DIORAMA_TURNTABLE_SPEED's doc comment above.
    const speed = heroKind === "theme" ? DIORAMA_TURNTABLE_SPEED : TURNTABLE_SPEED;
    turntableAngle += dt * speed;
    hero.rotation.y = turntableAngle;

    if (heroKind !== "beagle") return;
    const parts = hero.userData.parts as BeagleParts | undefined;
    if (!parts) return;

    const tailWag = Math.sin(idleT * 1.8) * 0.4;
    const earSwayL = -0.22 + Math.sin(idleT * 0.9) * 0.08 + Math.sin(idleT * 0.31 * Math.PI * 2) * 0.05;
    const earSwayR = -0.22 + Math.sin(idleT * 0.9 + 1.1) * 0.08 + Math.sin(idleT * 0.31 * Math.PI * 2 + 1.1) * 0.05;
    parts.tail.rotation.y = tailWag;
    parts.earL.rotation.x = earSwayL;
    parts.earR.rotation.x = earSwayR;

    const breathe = Math.sin(idleT * 1.4 * Math.PI * 2) * 0.015;
    hero.scale.y = hero.scale.x * (1 + breathe);
  }

  /** IDEA-026: nudges the shop scene's own background + hemisphere subtly
   *  toward `bg`/`hemiSky`/`hemiGround` (a 35% lerp — enough to read as "the
   *  world outside the diorama shares its mood" without fighting the fixed
   *  key/rim sun rig or repainting the whole page). Called by showTheme;
   *  restoreAtmosphere (below) undoes it exactly when a character hero
   *  returns. Deliberately does NOT touch the backdrop dome/fog (this scene
   *  has no fog, and the backdrop is barely visible behind the hero region
   *  regardless — the tint reads entirely through the background clear color
   *  and the hemisphere's ambient bounce on the hero/vignette).
   */
  function tintAtmosphere(bg: number, hemiSky: number, hemiGround: number): void {
    const TINT = 0.35;
    (scene.background as THREE.Color).lerp(new THREE.Color(bg), TINT);
    hemi.color.lerp(new THREE.Color(hemiSky), TINT);
    hemi.groundColor.lerp(new THREE.Color(hemiGround), TINT);
  }

  /** Restores the standard shop atmosphere exactly (bitwise, via the
   *  captured DEFAULT_* constants — not an inverse-lerp, which would drift)
   *  — called by showBeagle/showEnemy so returning from a theme diorama
   *  always lands back on the identical baseline look. */
  function restoreAtmosphere(): void {
    (scene.background as THREE.Color).set(DEFAULT_BG);
    hemi.color.set(DEFAULT_HEMI_SKY);
    hemi.groundColor.set(DEFAULT_HEMI_GROUND);
    // IDEA-072: and the world around the stage goes back to the EQUIPPED
    // theme's, since that is what the dome is still wearing. Put here rather
    // than beside each `restoreAtmosphere()` call because there are already
    // four of them and a fifth is one new hero kind away — the same reason
    // this function exists at all.
    surround.apply(getEquippedMazeTheme());
    // Restyle AFTER that rebuild, never before it — every caller runs this
    // after `setHero`, so its own pass has already happened.
    if (MADBOX_STYLE_ON) applyMadboxStyle(scene, boardBounce(getEquippedMazeTheme().palette), madboxCaches);
  }

  return {
    scene,
    camera,
    update(dt: number): void {
      animateIdle(dt);
      surround.update(dt);
      (hero.userData.portal as TunnelPortals | undefined)?.update(dt);
    },
    resize(aspect: number): void {
      lastAspect = aspect;
      applyCameraFraming(heroKind, aspect);
    },
    showBeagle(skin: BeagleSkin): void {
      // Build fresh rather than recolor-in-place: unlike menuScene's single
      // long-lived showcase beagle (which stays a beagle forever, so
      // applyBeagleSkin is the right live-recolor tool), this hero can BECOME
      // an enemy (or a theme diorama) and back again as the player switches
      // tabs, so every call here is a full swap â€” a plain applyBeagleSkin
      // would only be correct when the hero is already a beagle, and
      // silently do nothing useful otherwise.
      const next = makeBeagle(skin);
      applyBeagleSkin(next, skin); // belt-and-suspenders: makeBeagle(skin) already bakes the coat in, but keeps this path obviously correct even if that ever changes
      setHero(next, "beagle");
      restoreAtmosphere();
    },
    showEnemy(skinId: string): void {
      const next = makeEnemy(skinId, ENEMY_PREVIEW_COLOR);
      setHero(next, "enemy");
      restoreAtmosphere();
    },
    showGoldenBone(): void {
      // Wrapped in a group so the turntable spins the wrapper while the bone
      // keeps its own tilt — a bone spinning flat-on reads as a blob, angled
      // it reads as a bone.
      const wrapper = new THREE.Group();
      const bone = makeLifeBone();
      // makeLifeBone ALREADY carries a 1.6 internal scale, so this multiplier
      // compounds with it: 1.15 here lands the bone at roughly a beagle's
      // width, which is what this camera framing is built for. (2.1 overflowed
      // the frame entirely.) Lifted clear of the patch so it reads as a pickup
      // rather than something lying in the grass.
      bone.scale.multiplyScalar(1.15);
      bone.position.y = 0.44;
      bone.rotation.set(0.32, 0, 0.22);
      wrapper.add(bone);
      setHero(wrapper, "pickup");
      restoreAtmosphere();
    },
    showPowerups(): void {
      // A row of three rather than one hero. A power-up means nothing on its
      // own — the point the slide is making is that there is a FAMILY of them,
      // and three distinct silhouettes side by side say that faster than any
      // sentence does.
      const wrapper = new THREE.Group();
      ([
        [makeShield(), -0.72],
        [makeAnchor(), 0],
        [makeStar(), 0.72],
      ] as const).forEach(([mesh, x]) => {
        // Scaled to roughly the golden bone's presence at this framing: these
        // are built at board size (~0.44 across), which is a speck here.
        mesh.scale.multiplyScalar(2.1);
        mesh.position.set(x, 0.5, 0);
        wrapper.add(mesh);
      });
      // Tilted toward the camera so the flat-fronted shield is not edge-on and
      // the anchor's crossbar reads.
      wrapper.rotation.x = 0.1;
      setHero(wrapper, "pickup");
      restoreAtmosphere();
    },
    showTheme(themeId: string): void {
      const theme = getMazeTheme(themeId); // never throws — degrades to the default theme on an unknown id
      const next = makeThemeDiorama(theme);
      // The diorama is a BOARD, not a coat, so it is styled the way the board
      // is: BAKED against the snapped palette with the theme's own bounce, and
      // not at all for a night theme (`shouldStyleBoard`). `setHero`'s tint
      // pass then finds it already styled and leaves it — without this the
      // preview kept every authored colour unsnapped, i.e. showed a different
      // board from the one a run draws.
      if (MADBOX_STYLE_ON) {
        if (shouldStyleBoard(theme.palette)) applyMadboxStyle(next, boardBounce(theme.palette), madboxCaches);
        else next.userData.madboxSkip = true;
      }
      setHero(next, "theme");
      tintAtmosphere(theme.palette.bg, theme.palette.hemiSky, theme.palette.hemiGround);
      // The BAND shows the theme being CONSIDERED, not the one equipped. This
      // is the screen where somebody decides whether to spend 50 coins on it,
      // and a Deep Forest diorama standing in a garden's treeline advertises
      // the wrong product. The sky stays the equipped theme's (the dome is
      // only lerped 35% by `tintAtmosphere`), and that mismatch is invisible
      // here for a concrete reason: this rig's horizon is OFF the top of the
      // frame, so there is no sky-to-ground seam on screen to disagree at.
      surround.apply(theme);
      // AND RESTYLE AFTER IT. `surround.apply` rebuilds the band and the stage
      // AFTER `setHero` ran its pass, so without this the Themes tab showed
      // its neighbourhood in toon while the diorama in front of it was matcap.
      if (MADBOX_STYLE_ON) applyMadboxStyle(scene, boardBounce(getEquippedMazeTheme().palette), madboxCaches);
    },
    setMazeTheme(theme: MazeTheme): void {
      applyPatchTheme(patch, theme);
      applyDome(theme);
      surround.apply(theme);
      // AND HERE TOO. `surround.apply` REBUILDS the horizon band and the
      // stage dressing from scratch, so a theme change hands the scene a fresh
      // set of toon materials after every earlier pass has run. This is the
      // fourth place the same ordering bug turned up (the beagle in
      // buildLevel, the band in setHero, and this very line, which used to
      // restyle BEFORE the rebuild it was meant to cover). The rule behind all
      // of them is one line: **restyle after anything that rebuilds scene
      // content, not once at construction.** Affordable because the swap is
      // idempotent.
      if (MADBOX_STYLE_ON) applyMadboxStyle(scene, boardBounce(getEquippedMazeTheme().palette), madboxCaches);
    },
    dispose(): void {
      disposeHero(hero);
      surround.dispose();
      disposeShowcaseSurfaces(patch.surfaces);
    },
  };
}
