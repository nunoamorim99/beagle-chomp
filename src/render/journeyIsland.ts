// OWNER: render-artist (IDEA-079)
//
// ONE ISLAND of the Journey archipelago — a level, as a place rather than a dot.
//
// SPIKE STATUS: this module exists to answer a COST question before the rest of
// IDEA-079 is built. Forty dressed islands is the expensive part of that idea,
// and draw calls are this project's prop budget (IDEA-065 rule 3) — the garden
// board already sits near 350. So the first thing built is the thing that can
// be measured: a real island, from the real props, merged the real way.
// `scripts/_scratch-journey-spike.ts` is the instrument.
//
// ---------------------------------------------------------------------------
// NOTHING HERE INVENTS DATA
// ---------------------------------------------------------------------------
//
// The most useful finding while scoping this was that the Journey already
// carries everything an island needs:
//
//   * WHICH THEME. IDEA-063 rule 3 forces `themeId` on all forty levels
//     (`THEME_CYCLE[idx % 6]`), because the tour's second job is showing a
//     player the five themes they have not bought. So an island's dressing is
//     not a new authoring surface — it is the theme the level already plays in.
//
//   * WHAT THE THEME LOOKS LIKE. `MAZE_THEMES`' palette is the same one the
//     board, the surround and both showcases read.
//
//   * WHAT STANDS ON IT. `SHOWCASE_LANDMARKS` (showcaseSurround.ts) already
//     names each theme's signature props, and the garden's list opens with the
//     treehouse — the prop Nuno named for this, chosen for exactly this kind of
//     job by IDEA-072. They are built with `makePropFromDef` off `PROP_LIBRARY`,
//     so an island plants the SAME treehouse the garden board does rather than
//     a lookalike that drifts out of step with it.
//
// The one thing this module does own is the SHAPE of an island and how its
// contents are placed on it.
//
// ---------------------------------------------------------------------------
// WHY IT MERGES ITSELF
// ---------------------------------------------------------------------------
//
// `collapseByMaterial` runs on the finished island, not on the props as they
// are built. That is IDEA-065's rule about WHERE the collapse belongs: a
// merged prop loses its named part tree, which is what the editor addresses and
// what `applyPropParts` edits — so factories hand back the full tree and the
// PLACER collapses the instance it places. An island is a placer.

import * as THREE from "three";
import { getPropDef } from "../game/props";
import { makeSurroundMaterials, type SurroundMaterials } from "./surroundProps";
import {
  distantBeachSpot,
  distantBench,
  distantBin,
  distantBroadleaf,
  distantCar,
  distantCityBuilding,
  distantPath,
  distantRoad,
  distantTent,
} from "./surroundProps";
import { makePropFromDef, tunnelArchDefFor, TUNNEL_ARCH_INSTANCE_HASH, WALL_H } from "./board";
import { ARCH_PARAMS } from "./archway";
import { buildPortalsAt, type TunnelPortals } from "./tunnelPortal";
import { FENCE_PARAMS, fencePanelGeometry } from "./fence";
import { wallGeometry, wallShapeFor } from "./hedgeWall";
import { wallTextureFor } from "./wallTexture";
import { getMazeTheme, type MazeTheme } from "../game/themes";
import { type JourneyLevel } from "../game/journey";
import { collapseByMaterial, mergeBySignature } from "./propMerge";
import { rgbOf, css, hexOf, mix } from "./paint";
import { toon } from "./toon";

/**
 * What stands on each theme's island, in front of its gate.
 *
 * EVERY ISLAND IS A TUNNEL MOUTH FROM ITS OWN BOARD (see `buildIslandGate`),
 * and these are the things that board actually stands among — kept in step
 * with the menu and the shop, which show the same places. Two kinds of source,
 * because the boards now have two:
 *
 *  - LIBRARY props (`lib`), for the themes that still hand-place them — the
 *    garden's treehouse and the forest's cabin, built by `makePropFromDef` off
 *    `PROP_LIBRARY`, so an island plants the SAME prop the board does.
 *  - The NEIGHBOURHOOD's own builders (`build`), for the themes whose places
 *    are grown by the surround recipe since IDEA-080..082: the beach's tents
 *    and sunbathers, the park's path, benches and trees, Night City's
 *    frontages, street trees and traffic.
 *
 * The first version listed a library umbrella, palms, an oak, a streetlight and
 * a tower — props the beach, the park and the city boards stopped planting, so
 * the map was advertising places that no longer exist. Arcade Night stays
 * PROPLESS: its neon deck, neon walls and portal are the whole look.
 *
 * Positions are in island space (camera at +Z, gate at the back). The slots are
 * kept inside the deck's shore ring (0.845 of the radius) so nothing stands in
 * the water, and tall things go to the SIDES so they never hide the gate.
 */
export interface IslandItem {
  lib?: string;
  build?: (m: SurroundMaterials) => THREE.Object3D;
  at: readonly [number, number];
  /** Yaw; omitted means a seeded random one (a tree has no front). */
  rotY?: number;
  scale?: number;
}

export const ISLAND_DRESSING: Readonly<Record<string, readonly IslandItem[]>> = {
  garden: [
    { lib: "treehouse", at: [-1.15, 0.2], rotY: 0.35 },
    { lib: "garden-tree", at: [1.2, 0.05] },
    { lib: "garden-shrub", at: [-0.6, 1.2] },
    { lib: "birdhouse", at: [0.7, 1.05], rotY: -0.3 },
  ],
  forest: [
    { lib: "log-cabin", at: [-1.15, 0.15], rotY: 0.35 },
    { lib: "pine", at: [1.2, 0.0] },
    { lib: "critter-deer", at: [0.55, 1.1], rotY: -0.6 },
    { lib: "critter-fox", at: [-0.5, 1.2], rotY: 0.5 },
  ],
  beach: [
    // Held small and kept off the centre line: an umbrella canopy is the
    // widest thing on a beach, and at full size two of them hid the arch.
    { build: (m) => distantTent(m, { kind: "dome", seed: 4 }), at: [-1.2, 0.35], rotY: 0.6, scale: 0.6 },
    { build: (m) => distantBeachSpot(m, { seed: 7 }), at: [1.15, 0.45], rotY: -0.5, scale: 0.62 },
    { build: (m) => distantBeachSpot(m, { seed: 11 }), at: [-0.55, 1.2], rotY: 0.9, scale: 0.55 },
  ],
  park: [
    // The avenue, running out of the gate toward the viewer — the park board's
    // own path leads out of its tunnel the same way.
    { build: (m) => distantPath(m, { length: 2.3, width: 0.62, jointPitch: 0.7 }), at: [0, 0.55], rotY: 0 },
    { build: (m) => distantBroadleaf(m, { height: 1.55, seed: 141 }), at: [-1.2, 0.1] },
    { build: (m) => distantBroadleaf(m, { height: 1.35, seed: 143 }), at: [1.2, 0.2] },
    { build: (m) => distantBench(m, { seed: 5 }), at: [-0.75, 1.0], rotY: Math.PI / 2, scale: 0.8 },
    { build: (m) => distantBin(m), at: [0.7, 1.05], scale: 0.8 },
  ],
  city: [
    // A street across the front, with its traffic — what Night City's tunnel
    // opens onto.
    { build: (m) => distantRoad(m, { length: 3.0, width: 0.95, dashPitch: 0.7 }), at: [0, 1.05], rotY: Math.PI / 2 },
    { build: (m) => distantCar(m, { kind: "taxi", seed: 31 }), at: [0.45, 1.0], rotY: Math.PI / 2, scale: 0.55 },
    { build: (m) => distantCityBuilding(m, { height: 1.7, width: 0.95, depth: 0.85, seed: 21 }), at: [-1.15, 0.05], rotY: 0 },
    { build: (m) => distantBroadleaf(m, { height: 1.2, seed: 77, street: true }), at: [1.2, 0.1] },
  ],
  classic: [],
};

/** The gate — wall run, fence, arch and portal — as a fraction of its board
 *  size. The board's arches are 2.4 units tall against an island 2.1 in
 *  radius; at half size the arch stands about as tall as the treehouse and
 *  the whole mouth fits the back of the deck with the shore ring clear. */
export const ISLAND_GATE_SCALE = 0.5;
/** Where the gate's wall line stands, island space (negative is the back). */
const ISLAND_GATE_Z = -1.0;
/** Wall blocks either side of the tunnel. */
const ISLAND_GATE_TILES = 2;

export interface IslandParams {
  /** Top-surface radius in world units. */
  radius: number;
  /** How far the rock skirt drops below the surface. */
  depth: number;
  /** Radial segments. Low on purpose — an island is seen from a map camera,
   *  not orbited, and every segment is triangles across forty of them. */
  segments: number;
  /** How far the skirt tucks in at its base, as a fraction of `radius`. A
   *  straight-sided disc reads as a COIN; a taper reads as something sitting
   *  in water. */
  taper: number;
}

/**
 * How far above an island's centre its map pin floats, in world units.
 *
 * A PIN LAID ON THE ISLAND HIDES THE ISLAND. The first build anchored at the
 * island's own origin and the label pill landed square across the middle of the
 * deck — covering the potting shed, the treehouse, the neon grid, i.e. covering
 * the one thing this whole screen exists to show. The tallest prop on a deck is
 * about 1.3, so this clears it with room for the pin's own height.
 *
 * It lives here rather than in the pin layer because it is a fact about the
 * ISLAND's dimensions, and `src/ui` may not import from the render layer.
 */
export const PIN_ANCHOR_Y = 2.35;

export const ISLAND_PARAMS: IslandParams = {
  radius: 2.1,
  depth: 0.9,
  segments: 14,
  taper: 0.62,
};

/**
 * The island body: a tapered drum, flat on top.
 *
 * ONE geometry for the whole body rather than a disc plus a skirt, so the
 * silhouette has no seam and the whole thing is one draw call before anything
 * is placed on it. `openEnded: false` gives the top cap; the bottom is never
 * seen from a map camera but costs one fan and closing it means no hole if the
 * camera ever dips.
 */
export function islandBodyGeometry(p: IslandParams = ISLAND_PARAMS): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(
    p.radius,
    p.radius * p.taper,
    p.depth,
    p.segments,
    1,
    false,
  );
  // Origin at the TOP surface, so everything placed on the island sits at y=0
  // in island space and a caller never has to know how deep it is.
  geo.translate(0, -p.depth / 2, 0);
  return geo;
}

/**
 * ARCADE NIGHT GETS LIGHT INSTEAD OF PROPS, AND THAT IS THE WHOLE IDEA.
 *
 * The spike's screenshots made one thing obvious that no measurement would
 * have: seven of the forty levels are themed `classic`, which has NO props by
 * design and a floor of 0x111120, so those seven rendered as flat black discs
 * between a treehouse and a log cabin. They did not read as a style; they read
 * as holes where content should be.
 *
 * THE BOARD AND THE MAP ARE DIFFERENT BRIEFS, which is what resolves it.
 * Arcade Night's emptiness is the FEATURE on a board — its `surround` is
 * `"none"` and that clean void is what somebody paid 50 coins for, so an island
 * scattering garden props on it would be a menu overruling the shop. But a
 * map's job is "which level is this", and a black disc answers nothing.
 *
 * So it stays PROPLESS and takes its identity from the one thing the theme is
 * actually made of: NEON ON BLACK. Three cheap marks, in rising order of how
 * much each does at map distance:
 *
 *  1. A LIT RIM, and it is the one that matters. At 40-80px an island is
 *     mostly its OUTLINE, and a bright ring is the difference between a shape
 *     and a hole. It is `MeshBasicMaterial` — UNLIT — which is this project's
 *     documented exception for anything that must actually glow (the eye glint,
 *     the shield bubble): a toon ramp quantises a highlight into the same three
 *     bands as everything else and it stops reading as light.
 *  2. A GRID on the deck, procedural and cached, used as `map` AND
 *     `emissiveMap` so the lines carry their own light the way the board's own
 *     neon floor does. Generated, never fetched — this PWA ships no texture
 *     assets.
 *  3. A DARKER SKIRT. The palette gives `floor` and `surroundGround` the SAME
 *     0x111120, so this is the one theme with no two-tone to inherit and the
 *     body was one undifferentiated mass before anything was drawn on it.
 */
const ARCADE_THEME_ID = "classic";

/**
 * Lift a board ground to something legible as a MAP TOKEN.
 *
 * THE MAP IS NOT THE BOARD. A palette's grounds are tuned to sit UNDER a
 * biscuit trail with a beagle on them, so several are very dark by design —
 * Night City's is 0x3a3640 and Deep Forest's 0x4a3524, both around 0.22
 * lightness. On a board that is correct and the pellets carry the read; as a
 * 100 px disc floating in an ocean it is a hole in the water with no theme
 * visible in it at all.
 *
 * Only the LIGHTNESS is touched, and only upward, so the hue and saturation
 * that make a theme recognisable are untouched and the already-bright grounds
 * (the garden's lawn, the beach's sand) come back byte for byte.
 */
function liftForMap(hex: number, minL = 0.36): number {
  const c = new THREE.Color(hex);
  c.getHSL(hsl);
  return hsl.l >= minL ? hex : c.setHSL(hsl.h, hsl.s, minL).getHex();
}

const hsl = { h: 0, s: 0, l: 0 };

/**
 * The deck's colour: the ground a player SEES on that board.
 *
 * Usually `surroundGround` lifted for the map. SAND IS THE EXCEPTION, and the
 * style is why: the beach's lifted ground (#c6b08b) is a mid tan, and the
 * hue-dominant snap sends it to `bark` — so the beach island shipped as a
 * brown disc while its board, whose floor is a TEXTURE the style never snaps,
 * reads as pale sand. A sand floor takes a pale sand that lands on the
 * palette's `sand` entry (`scripts/_scratch-deck-snap.ts` checks it).
 */
function deckColorFor(pal: MazeTheme["palette"]): number {
  if (pal.floorTexture === "sand") return blendHex(pal.surroundGround, 0xf0dcb0, 0.6);
  return liftForMap(pal.surroundGround);
}

/** Blend two palette hexes and come back with a hex.
 *
 *  Material colours stay plain numbers here, exactly as every other material in
 *  this project receives them, so `toon()` does the one sRGB conversion. Going
 *  through THREE.Color's float components instead would put a second
 *  colour-space decision in a file that has no business making one. */
function blendHex(a: number, b: number, t: number): number {
  return hexOf(mix(rgbOf(a), rgbOf(b), t));
}

/** One canvas for every arcade island — there is exactly one arcade look and
 *  seven islands wearing it. Never disposed, for `wallTextureFor`'s reason: a
 *  single small entry shared by everything that draws it. */
let arcadeDeck: THREE.Texture | null = null;

/**
 * Returns null when there is NO DOM, and that is deliberate rather than
 * defensive.
 *
 * `scripts/_scratch-journey-spike.ts` measures this module in Node — draw calls
 * and triangles, which is the question the whole spike exists to answer — and
 * a canvas texture changes NEITHER of those: same mesh, same material count,
 * same geometry. So the headless path measuring a deck with no map measures
 * exactly the right numbers, while the browser always takes the real path.
 *
 * The guard is on `document` itself rather than on a flag somebody could set,
 * so the browser cannot reach it by accident — a silent no-grid fallback that
 * could fire in the app would be a defect nobody would notice.
 */
function arcadeDeckTexture(pal: MazeTheme["palette"]): THREE.Texture | null {
  if (typeof document === "undefined") return null;
  if (arcadeDeck) return arcadeDeck;

  const S = 256;
  const cell = S / 8;
  const cv = document.createElement("canvas");
  cv.width = S;
  cv.height = S;
  const g = cv.getContext("2d");
  if (!g) throw new Error("arcadeDeckTexture: no 2d context");

  g.fillStyle = css(rgbOf(pal.floor));
  g.fillRect(0, 0, S, S);

  // TWO PASSES PER LINE, not one hairline. A single bright 1px line aliases
  // into dashes the moment the texture is minified, which it always is here;
  // a wide dim line under a narrow bright one is the same VALUE STEP the whole
  // surface library is built on, and it survives being small.
  const neon = rgbOf(pal.wall);
  for (const pass of [
    { w: 5, style: css(mix(rgbOf(pal.floor), neon, 0.5)) },
    { w: 1.6, style: css(mix(neon, rgbOf(0xffffff), 0.35)) },
  ]) {
    g.strokeStyle = pass.style;
    g.lineWidth = pass.w;
    g.beginPath();
    for (let i = 0; i <= 8; i++) {
      const at = i * cell;
      g.moveTo(at, 0);
      g.lineTo(at, S);
      g.moveTo(0, at);
      g.lineTo(S, at);
    }
    g.stroke();
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  arcadeDeck = tex;
  return tex;
}


/**
 * The theme's own tunnel mouth, at the back of the deck: a short run of its
 * real maze wall (`wallGeometry` + `wallTextureFor`, the board's block and
 * cached surface), the picket fence where the theme has one, the arch the board
 * stands at its tunnels (`tunnelArchDefFor`, so a retuned arch reaches the map
 * by existing) and, returned separately, the portal glowing in it.
 *
 * WHY EVERY ISLAND GETS ONE. Since IDEA-080..083 the arch is the single most
 * recognisable thing a board has — the garden's yew, the forest's two trees,
 * the beach's rock arch, the park's gate, the city's neon gateway — and the
 * map's whole job is telling a player which place a level is. It is also the
 * one image every level shares: the tunnel is the crossing every maze has.
 *
 * The camera here looks down from about 33 degrees, so an arch facing it reads
 * as an arch — and placed at the BACK, the props in front never hide it.
 */
function buildIslandGate(theme: MazeTheme, idx: number): { gate: THREE.Group; archZ: number } {
  const pal = theme.palette;
  const gate = new THREE.Group();
  gate.name = "island-gate";
  gate.position.set(0, 0, ISLAND_GATE_Z);
  gate.scale.setScalar(ISLAND_GATE_SCALE);

  // No DOM, no texture — the headless cost measurement's path, for
  // `arcadeDeckTexture`'s reason: a map changes neither draw calls nor
  // triangles, which is all `_scratch-journey-spike.ts` asks.
  const wallTex = typeof document === "undefined" ? null : wallTextureFor(pal.wallTexture, pal.wall);
  const wallMat = toon({
    color: wallTex ? 0xffffff : pal.wall,
    map: wallTex,
    emissive: pal.wallEmissive,
    emissiveIntensity: pal.wallEmissiveIntensity,
  });
  const wallGeo = wallGeometry(wallShapeFor(pal.wallTexture), WALL_H);
  const tiles: number[] = [];
  for (let i = -ISLAND_GATE_TILES; i <= ISLAND_GATE_TILES; i++) if (i !== 0) tiles.push(i);
  for (const i of tiles) {
    const w = new THREE.Mesh(wallGeo, wallMat);
    w.position.set(i, WALL_H / 2, 0);
    w.rotation.y = (Math.PI / 2) * Math.floor(hash(i + 5, idx + 9) * 4);
    w.castShadow = true;
    gate.add(w);
  }

  if (pal.fence === "picket") {
    const fenceGeo = fencePanelGeometry(1);
    const fenceMat = toon({ color: pal.fenceColor, vertexColors: true });
    const out = 0.5 + FENCE_PARAMS.proud;
    const panel = (x: number, z: number, rot: number): void => {
      const f = new THREE.Mesh(fenceGeo, fenceMat);
      f.position.set(x, 0, z);
      f.rotation.y = rot;
      gate.add(f);
    };
    for (const i of tiles) panel(i, out, 0);
    panel(-1 + out, 0, Math.PI / 2);
    panel(1 - out, 0, -Math.PI / 2);
  }

  // `archTransformFor` for a mouth opening toward +Z, i.e. toward the camera.
  const archZ = 0.5 + ARCH_PARAMS.outset;
  const def = tunnelArchDefFor(theme);
  if (def) {
    const arch = makePropFromDef(def, TUNNEL_ARCH_INSTANCE_HASH);
    arch.position.set(0, ARCH_PARAMS.lift, archZ);
    arch.rotation.y = ARCH_PARAMS.yaw;
    arch.scale.multiplyScalar(ARCH_PARAMS.scale);
    gate.add(arch);
  }
  return { gate, archZ };
}

export interface JourneyIsland {
  group: THREE.Group;
  /** The gate's portal (IDEA-083). Advanced by the scene's `update`. */
  portal: TunnelPortals;
  dispose: () => void;
}

/** Deterministic per-island jitter. Seeded from the LEVEL INDEX, so an island
 *  looks the same every time the map is opened — a level that rearranged
 *  itself between visits would stop being a place. */
function hash(n: number, seed: number): number {
  const x = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Build one island for one Journey level.
 *
 * `idx` is the level's position in the ladder and is the only seed — see
 * `hash`. The returned group's origin is the island's TOP SURFACE at its
 * centre, so a caller positions it by where the player should look.
 */
export type IslandMerge = "signature" | "material" | "none";

export function makeJourneyIsland(
  level: JourneyLevel,
  idx: number,
  params: IslandParams = ISLAND_PARAMS,
  merge: IslandMerge = "signature",
): JourneyIsland {
  const theme: MazeTheme = getMazeTheme(level.themeId);
  const pal = theme.palette;
  const group = new THREE.Group();
  group.name = `island-${idx}`;

  // --- the body -------------------------------------------------------------
  //
  // THE DECK IS `surroundGround`, NOT `floor`, AND THAT IS [[IDEA-066]] RULE 2
  // IN A NEW PLACE. `palette.floor` is what floorTexture.ts bakes in as its
  // GROUND — and then the lawn painter covers it. On the garden those are
  // 0x6b4a2f soil and a 0x517a33 lawn, a full value step and a hue apart, so a
  // deck painted `floor` is a BROWN disc standing in for a green board. The
  // surround already solved this: `surroundGround` IS the floor texture's
  // measured mean, i.e. the colour a player actually sees on that board.
  //
  // Deliberately flat colour rather than the floor TEXTURE itself: that texture
  // is grid-derived and maps one canvas onto the board plane, so it has nothing
  // to say about a disc — and at map distance a tile pattern is noise.
  const isArcade = level.themeId === ARCADE_THEME_ID;
  const deck = isArcade ? arcadeDeckTexture(pal) : null;

  const bodyGeo = islandBodyGeometry(params);
  const topMat = isArcade
    ? toon({
        // White, because the texture carries the colour — the same rule the
        // board's floor follows: a map multiplies, so tinting it twice darkens
        // the grid into the deck it is drawn on.
        // White ONLY when the deck texture is really there: a map multiplies,
        // so a textured surface holds its material white (the board's own floor
        // rule) — but a white material with NO map is a white disc, which is
        // the worst possible fallback for a theme made of black.
        color: deck ? 0xffffff : liftForMap(pal.surroundGround),
        map: deck,
        // The deck lights ITSELF. Without the emissive map the grid is a dark
        // blue line on a darker blue disc, which at map distance is no line at
        // all — and light on black is this theme's entire look.
        emissive: deck ? 0xffffff : 0x000000,
        emissiveMap: deck,
        emissiveIntensity: 0.85,
      })
    : toon({ color: deckColorFor(pal) });
  // THE TWO SWAP ROLES AND BOTH STAY MEANINGFUL. `floor` is the SOIL under the
  // board's ground texture, which is exactly what a cliff below a lawn is made
  // of — so the deck takes the texture's mean and the skirt takes the earth it
  // sits on. Darkened, because a cliff is in its own shadow and because the
  // toon ramp needs a real value step between deck and skirt or the island
  // reads as one flat disc from above.
  const skirtMat = toon({
    color: isArcade
      ? blendHex(pal.floor, 0x000000, 0.45)
      : blendHex(liftForMap(pal.floor, 0.3), 0x000000, 0.26),
  });
  // CylinderGeometry emits groups in side/top/bottom order, so the two
  // materials land without any per-triangle work.
  const body = new THREE.Mesh(bodyGeo, [skirtMat, topMat, skirtMat]);
  body.name = "island-body";
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // --- the beach ------------------------------------------------------------
  //
  // THE ONE THING THAT MAKES A DISC READ AS AN ISLAND. Without it the deck ends
  // at a hard line straight into open water, which is what a lily pad does; a
  // real shore has a pale band where the ground shelves into the sea, and at
  // this size that band is the whole difference between "an island" and "a
  // token lying on the water".
  //
  // It sits ON the deck rather than proud of it, inside the island's own
  // radius: a ring sticking out past the rock would be a brim, and it would
  // also collide with the sea's foam line, which is drawn at 0.98-1.14 of this
  // same radius. Props scatter between 0.42 and 0.70 of it, so nothing on the
  // deck can stand in the water.
  //
  // The colour is a pale warm neutral carrying a little of the island's own
  // hue, never a fixed sand: on the garden that reads as a sunlit shore and on
  // Night City as a concrete embankment, which is the right answer for both
  // without a per-theme table nobody would keep in step.
  if (!isArcade) {
    const beachGeo = new THREE.RingGeometry(
      params.radius * 0.845,
      params.radius * 0.999,
      params.segments * 2,
    );
    beachGeo.rotateX(-Math.PI / 2);
    // A hair above the deck: coplanar with it z-fights, and the fight is
    // resolved differently at every distance, so it flickers as the map pans.
    beachGeo.translate(0, 0.012, 0);
    const beachMat = toon({ color: blendHex(deckColorFor(pal), 0xe4d2a6, 0.7) });
    const beach = new THREE.Mesh(beachGeo, beachMat);
    beach.name = "island-beach";
    beach.receiveShadow = true;
    group.add(beach);
  }

  // --- the arcade's lit rim -------------------------------------------------
  // Added outside the merge on purpose: MeshBasicMaterial carries no `toonKey`,
  // so mergeBySignature would fall back to its uuid and bucket it alone anyway
  // — and welding an UNLIT material into a lit bucket is precisely what that
  // merge's contract forbids.
  if (isArcade) {
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(params.radius * 0.985, 0.045, 6, params.segments * 2),
      new THREE.MeshBasicMaterial({ color: blendHex(pal.rimColor, 0xffffff, 0.25) }),
    );
    rim.name = "island-rim";
    rim.rotation.x = -Math.PI / 2;
    // A hair BELOW the deck rather than on it: a torus centred exactly on the
    // cap is half buried and half floating, and the buried half z-fights.
    rim.position.y = -0.02;
    group.add(rim);
  }

  // --- the gate --------------------------------------------------------------
  const { gate, archZ } = buildIslandGate(theme, idx);
  // Arcade Night's walls are flat NEON with a real emissive and no texture —
  // the one wall the style would snap (to a pale lilac) and strip of its glow.
  // Its board is exempt from the style for the same reason (shouldStyleBoard).
  // Kept out of the merge too, which would rebuild it into new meshes and lose
  // the flag — two meshes on seven islands is not worth welding.
  if (isArcade) gate.userData.madboxSkip = true;
  const props: THREE.Object3D[] = isArcade ? [] : [gate];
  group.add(gate);
  // The portal stays OUT of the merge: additive ShaderMaterials and Points
  // that have no business being bucketed, and the style skips them anyway.
  const portalHolder = new THREE.Group();
  portalHolder.name = "island-portal";
  portalHolder.position.copy(gate.position);
  portalHolder.scale.copy(gate.scale);
  group.add(portalHolder);
  const portal = buildPortalsAt(portalHolder, theme, [
    { x: 0, z: archZ, rotationY: ARCH_PARAMS.yaw, name: "island-portal" },
  ]);

  // --- what stands in front of it --------------------------------------------
  const items = ISLAND_DRESSING[level.themeId] ?? [];
  const mats = items.some((it) => it.build) ? makeSurroundMaterials(pal) : null;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const prop = it.lib
      ? makePropFromDef(getPropDef(it.lib), hash(i * 13, idx + 2))
      : it.build
        ? it.build(mats as SurroundMaterials)
        : null;
    if (!prop) continue;
    prop.position.set(it.at[0], 0, it.at[1]);
    // A building faces out of the screen as authored; anything else takes a
    // seeded yaw so a stage does not read as a row of clones.
    prop.rotation.y = it.rotY ?? hash(i * 17, idx + 3) * Math.PI * 2;
    if (it.scale) prop.scale.multiplyScalar(it.scale);
    props.push(prop);
    group.add(prop);
  }

  // --- the collapse ---------------------------------------------------------
  // This is the whole reason forty of these might be affordable, and which of
  // the two merges is used is exactly the question the spike measures — so the
  // caller picks and the script runs both.
  //
  // `mergeBySignature` is the strong one: it buckets by what a material LOOKS
  // like (`toonKey`), so two different props' identical greens become ONE mesh.
  // Its contract restricts it to "where nothing is recoloured, animated,
  // team-tinted or part-edited" — the surround and the verge, never a
  // character. An island qualifies on every count: it is static scenery on a
  // map, nothing tints it and the editor never addresses it. Saying so here
  // rather than assuming it, because that contract is the one thing standing
  // between this and a prop silently repainting another.
  //
  // The BODY is deliberately outside the merge either way: it carries a
  // material ARRAY, which neither merge touches by contract (a material-array
  // mesh costs a draw call per GROUP — IDEA-067 rule 7), and it is already one
  // mesh.
  if (merge !== "none") {
    const dressing = new THREE.Group();
    dressing.name = "island-dressing";
    for (const p of props) {
      group.remove(p);
      dressing.add(p);
    }
    group.add(merge === "signature" ? mergeBySignature(dressing) : collapseByMaterial(dressing));
  }

  return {
    group,
    portal,
    dispose(): void {
      portal.dispose();
      group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry?.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of mats) mat?.dispose();
      });
      group.clear();
    },
  };
}
