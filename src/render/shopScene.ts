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
import { getMazeTheme, type MazeTheme } from "../game/themes";
import { makeBeagle, makeEnemy, applyBeagleSkin, type BeagleParts } from "./characters";
import { makePropById } from "./board";

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

// The L-shaped run, in local diorama tile coords (x grows right, z grows
// "into" the corner) — 5 wall tiles: a 3-long back arm plus a 2-long side arm
// sharing the corner tile, reading unambiguously as "a maze corner" at a
// glance rather than a straight featureless row.
const DIORAMA_WALL_TILES: ReadonlyArray<[number, number]> = [
  [0, 0],
  [1, 0],
  [2, 0],
  [0, 1],
  [0, 2],
];
// The floor footprint is a little larger than the wall run's own bounding
// box so there's visible walkable ground in front of the corner (where the
// trail sits), not just under the walls themselves.
// Sized so the WHOLE trail (including the bone's own ~0.3-unit knuckle
// span) sits on the slab with margin — the first cut (4.4 x 4.0 around
// center 1.0) ended at x=3.2 while the trail ran to x~4.2, so the last
// biscuit sat on the slab's corner edge and the bone floated past it in
// mid-air (visible in the shop screenshots).
const DIORAMA_FLOOR_SIZE = { w: 5.0, d: 4.6 };
const DIORAMA_FLOOR_CENTER = { x: 1.1, z: 1.05 };

// The trail: 4 biscuits stepping away from the corner along the open
// diagonal, plus one bone at the far end — echoes board.ts's actual pellet
// spacing (one per tile) and the bone-marks-progress read of the real board.
const DIORAMA_BISCUIT_TILES: ReadonlyArray<[number, number]> = [
  [1.5, 1.5],
  [2.0, 1.85],
  [2.5, 2.2],
  [3.0, 2.55],
];
const DIORAMA_BONE_TILE: [number, number] = [3.3, 2.95];

// Bloom/speck spots on the wall tops, keyed to specific wall tiles above (not
// hashed per-tile like board.ts's full-maze buildHedgeDecor — a 5-tile
// diorama is small enough to hand-place for a deliberately "planted" rather
// than "randomly sparse" read) — a theme with bloomChance 0 (classic) or an
// empty bloomColors array (also classic) simply shows none, same contract as
// board.ts's buildHedgeDecor.
const DIORAMA_BLOOM_SPOTS: ReadonlyArray<{ tile: [number, number]; jx: number; jz: number; colorIdx: number }> = [
  { tile: [0, 0], jx: -0.18, jz: 0.12, colorIdx: 0 },
  { tile: [1, 0], jx: 0.1, jz: -0.15, colorIdx: 1 },
  { tile: [0, 1], jx: 0.15, jz: 0.1, colorIdx: 2 },
];
const DIORAMA_SPECK_SPOTS: ReadonlyArray<{ tile: [number, number]; jx: number; jz: number }> = [
  { tile: [2, 0], jx: -0.1, jz: 0.15 },
  { tile: [0, 2], jx: 0.12, jz: -0.1 },
];

// v4.1 "Set Dressing": 0-2 SIGNATURE props per theme, so the diorama SELLS
// the decoration a purchase actually plants around the real board, not just
// the wall/floor/biscuit palette — Nuno's literal per-theme ask, verbatim:
// "on the garden add some shrubs, on the night city some lighting stations,
// on the beach some beach umbrella... On the night city we could add some
// buildings too." Reuses board.ts's exact factory (makePropById) rather than
// any diorama-local reimplementation, so a preview is always honest — same
// shapes/materials/params as the real board.
//
// Hand-placed, EXPLICITLY per theme id (same "planted, not derived"
// philosophy as DIORAMA_WALL_TILES/DIORAMA_BISCUIT_TILES/DIORAMA_BLOOM_SPOTS
// above, all hand-authored literals rather than generically derived from a
// theme's placements): now maps a theme id to library PROP IDS directly
// (was ThemePropKind pre-v4.1, back when a "kind" and a "population" were
// the same thing — the reusable prop library replaced that with named defs,
// so the diorama picks specific defs by id instead) — the brief's exact
// mapping: garden -> shrub, forest -> pine, beach -> umbrella,
// park -> oak + streetlight, city -> tower + streetlight, classic -> none.
// Each id must exist in PROP_LIBRARY (src/game/props.ts) — getPropDef's
// never-throws fallback means a stale/renamed id degrades to a neutral prop
// rather than breaking the diorama, but every entry below is kept in sync
// with the library by hand, same discipline as every other hand-authored
// table in this file.
const DIORAMA_SIGNATURE_IDS: Readonly<Record<string, readonly string[]>> = {
  garden: ["shrub"],
  classic: [],
  forest: ["pine"],
  beach: ["umbrella"],
  park: ["oak", "streetlight"],
  city: ["tower", "streetlight"],
};

// A single representative scale for every diorama signature prop — the prop
// library's PropDef carries no min/max scale RANGE (unlike pre-v4.1's
// ThemeProp population, whose minScale/maxScale the old scheme mid-band
// lerped — see the dropped findSignatureProp below), just the def's own
// height/width multipliers baked into its params, so there's nothing left to
// lerp: 1.0 is simply "the def's own natural, undistorted size", matching
// the ~1.0-centered scale values the real board's placements (themes.ts)
// mostly use too.
const DIORAMA_SIGNATURE_SCALE = 1.0;

// Two open pockets of the 5.0x4.6 slab that sit clear of BOTH the L-shaped
// wall run and the biscuit-trail/bone diagonal, with comfortable margin
// inside the slab edges (>=0.4 units, well past the ~0.3-margin discipline
// the trail sizing note above already established): a "BEHIND" spot past the
// short back arm (tile [3.2, 0.55], local ~(2.10, -0.50) — a tall/skyline-
// scale prop reads naturally sitting past the corner) and a "BESIDE" spot
// past the long side arm (tile [-0.9, 2.3], local ~(-2.00, 1.25) — a
// ground-level prop reads naturally flanking the run at eye level).
//
// Slot assignment is simply DIORAMA_SIGNATURE_IDS' own array order — index
// 0 -> BEHIND, index 1 -> BESIDE — rather than a generic per-shape preference
// table: every two-id entry above was deliberately AUTHORED taller/
// farther-reading id first (city: tower then streetlight; park: oak then
// streetlight), so array order already encodes the right slot without a
// second lookup that could collide (a per-shape table sends both of park's
// ids — oak AND streetlight are both "ground-level"-ish — to the same
// preferred slot, which was the bug this simpler scheme replaces). A theme
// with only one signature id (garden/forest/beach) always lands on index 0
// (BEHIND) since it's the only entry in its list.
const DIORAMA_SIGNATURE_SLOTS: ReadonlyArray<{ tile: [number, number]; rotY: number; hashSeed: number }> = [
  { tile: [3.2, 0.55], rotY: 0.5, hashSeed: 0.62 }, // BEHIND — index 0
  { tile: [-0.9, 2.3], rotY: -0.35, hashSeed: 0.3 }, // BESIDE — index 1
];
// Verified against the EXISTING diorama camera rig (DIORAMA_CAM_*/
// applyCameraFraming below — untouched, per the brief's "don't move the
// camera") through a full 360deg turntable spin at every real device aspect:
// city's tower (the largest signature prop) at DIORAMA_SIGNATURE_SCALE=1.0 is
// SMALLER than the pre-v4.1 mid-band scale (~1.225, the old population's
// lerp(0.85, 1.6, 0.5)) that was originally margin-verified here (worst NDC
// ~0.83 at landscape/4:3, ~0.93 at square — all comfortably inside frame), so
// the v4.1 fixed scale=1.0 only INCREASES every margin, never risks
// exceeding them — every other theme's signature prop(s) are smaller still
// and land well inside those same margins. Portrait (aspect <~0.55) is
// UNCHANGED from its pre-existing framing (the baseline board — walls/trail/
// bone alone, no props at all — already exceeds NDC 1 there before this
// change; fixing that would require moving the camera, out of scope here).

/** Converts a diorama tile coord to a local position, centered under
 *  DIORAMA_FLOOR_CENTER so the whole staging sits roughly on the vignette
 *  origin the camera rig is tuned for. */
function dioramaPos(tx: number, tz: number): [number, number] {
  return [(tx - DIORAMA_FLOOR_CENTER.x) * DIORAMA_TILE, (tz - DIORAMA_FLOOR_CENTER.z) * DIORAMA_TILE];
}

/**
 * Builds a maze-theme diorama: a small floor slab, an L-shaped run of wall
 * blocks, a short biscuit trail + one bone, a few theme-appropriate
 * blooms/specks on the wall tops, and (IDEA-026 follow-up) 1-2 signature
 * theme PROPS in the open pockets beside the run — all skinned from
 * `theme.palette` using the same material recipe board.ts uses for the real
 * board (so a city theme's glowing "windows" and a classic theme's clean
 * unplanted walls both read exactly as they would in the actual maze). The
 * bone keeps its FIXED off-white identity color, matching board.ts's pellet
 * bones in every theme.
 */
function makeThemeDiorama(theme: MazeTheme): THREE.Group {
  const palette = theme.palette;
  const g = new THREE.Group();

  // Floor — same roughness/emissive treatment as board.ts's matFloor.
  const floorMat = new THREE.MeshStandardMaterial({
    color: palette.floor,
    roughness: 1,
    emissive: palette.floorEmissive,
    emissiveIntensity: palette.floorEmissiveIntensity,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(DIORAMA_FLOOR_SIZE.w, DIORAMA_FLOOR_SIZE.d), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.01;
  floor.receiveShadow = true;
  g.add(floor);

  // Walls — same roughness/metalness/emissive treatment as board.ts's
  // matWall, instanced exactly like the real board (one draw call for the
  // whole run, even though 5 instances hardly needs it — keeps the "reuse
  // board.ts's recipe" promise literal, not just visual).
  const wallMat = new THREE.MeshStandardMaterial({
    color: palette.wall,
    roughness: 0.5,
    metalness: 0.1,
    emissive: palette.wallEmissive,
    emissiveIntensity: palette.wallEmissiveIntensity,
  });
  const wallGeo = new THREE.BoxGeometry(DIORAMA_TILE, DIORAMA_WALL_H, DIORAMA_TILE);
  const walls = new THREE.InstancedMesh(wallGeo, wallMat, DIORAMA_WALL_TILES.length);
  walls.castShadow = true;
  walls.receiveShadow = true;
  const dummy = new THREE.Object3D();
  DIORAMA_WALL_TILES.forEach(([tx, tz], i) => {
    const [x, z] = dioramaPos(tx, tz);
    dummy.position.set(x, DIORAMA_WALL_H / 2, z);
    dummy.updateMatrix();
    walls.setMatrixAt(i, dummy.matrix);
  });
  g.add(walls);

  // Biscuits — same roughness/emissive treatment as board.ts's matBiscuit;
  // biscuits theme (they're the trail), unlike the fixed-identity bone below.
  const biscuitMat = new THREE.MeshStandardMaterial({
    color: palette.biscuit,
    roughness: 0.7,
    emissive: palette.biscuitEmissive,
    emissiveIntensity: palette.biscuitEmissiveIntensity,
  });
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
  const boneMat = new THREE.MeshStandardMaterial({
    color: 0xf6f1e6,
    roughness: 0.5,
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
  // just individual meshes rather than InstancedMesh (a handful of decor
  // items on a 5-tile diorama doesn't need batching). bloomChance <= 0 or an
  // empty bloomColors (classic) mean DIORAMA_BLOOM_SPOTS/SPECK_SPOTS are
  // simply skipped below, so the diorama shows a clean, unplanted wall top —
  // exactly matching the real board's contract for that theme.
  if (palette.bloomChance > 0 && palette.bloomColors.length > 0) {
    const bloomGeo = new THREE.SphereGeometry(0.075, 6, 6);
    const bloomMats = palette.bloomColors.map(
      (color) =>
        new THREE.MeshStandardMaterial({
          color,
          roughness: 0.5,
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
      const speckMat = new THREE.MeshStandardMaterial({
        color: palette.speckColor,
        roughness: 0.6,
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

  // v4.1 "Set Dressing": 0-2 signature LIBRARY props, per DIORAMA_SIGNATURE_
  // IDS' exact per-theme-id list above — array index IS the slot index (see
  // DIORAMA_SIGNATURE_SLOTS' doc comment for why). classic's empty list
  // naturally plants nothing. makePropById never throws (getPropDef degrades
  // a stale id to a neutral fallback def), so there's no "drifted out of
  // sync" defensive skip needed here anymore (unlike the pre-v4.1
  // findSignatureProp lookup it replaces) — every id is still kept in sync
  // with PROP_LIBRARY by hand regardless, per DIORAMA_SIGNATURE_IDS' doc.
  const signatureIds = DIORAMA_SIGNATURE_IDS[theme.id] ?? [];
  signatureIds.forEach((propId, slotIdx) => {
    if (slotIdx >= DIORAMA_SIGNATURE_SLOTS.length) return; // defensive: never more ids than slots

    const slot = DIORAMA_SIGNATURE_SLOTS[slotIdx];
    const [x, z] = dioramaPos(slot.tile[0], slot.tile[1]);
    const prop = makePropById(propId, slot.hashSeed);
    prop.position.set(x, 0, z);
    prop.rotation.y = slot.rotY;
    prop.scale.setScalar(DIORAMA_SIGNATURE_SCALE);
    prop.traverse((o) => {
      o.castShadow = true;
    });
    g.add(prop);
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
type HeroKind = "beagle" | "enemy" | "theme";

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
  // IDEA-026: DEFAULT_BG/DEFAULT_HEMI_* below are this exact value/rig — kept
  // as named background/hemisphere so showTheme can subtly tint them toward
  // a staged theme and showBeagle/showEnemy can restore them exactly.
  scene.background = new THREE.Color(COLORS.bg);
  scene.add(makeBackdrop());

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
  const gardenPatch = makeGardenPatch();
  scene.add(gardenPatch);

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
    disposeHero(hero);
    hero = next;
    heroKind = kind;
    scene.add(hero);
    turntableAngle = 0;
    hero.rotation.y = 0;
    gardenPatch.visible = kind !== "theme";
    applyCameraFraming(kind, lastAspect);
  }

  // Same local idle-animation approach as menuScene.ts's animateIdle: the
  // showcase hero has no real game Entity/facing to sync via syncToEntity, so
  // drive the turntable directly here, plus (for a beagle hero only — enemies
  // have no `parts`) the same tail-wag/ear-sway/breathing formulas
  // characters.ts's animateBeagleParts already implements for the idle case.
  function animateIdle(dt: number): void {
    idleT += dt;
    // IDEA-026: the diorama turntables at its own, slower speed — see
    // DIORAMA_TURNTABLE_SPEED's doc comment above.
    const speed = heroKind === "theme" ? DIORAMA_TURNTABLE_SPEED : TURNTABLE_SPEED;
    turntableAngle += dt * speed;
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
  }

  return {
    scene,
    camera,
    update(dt: number): void {
      animateIdle(dt);
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
      // tabs, so every call here is a full swap — a plain applyBeagleSkin
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
    showTheme(themeId: string): void {
      const theme = getMazeTheme(themeId); // never throws — degrades to the default theme on an unknown id
      const next = makeThemeDiorama(theme);
      setHero(next, "theme");
      tintAtmosphere(theme.palette.bg, theme.palette.hemiSky, theme.palette.hemiGround);
    },
    dispose(): void {
      disposeHero(hero);
    },
  };
}
