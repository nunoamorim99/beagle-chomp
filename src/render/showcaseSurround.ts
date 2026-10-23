// OWNER: render-artist
// IDEA-072: the ambience the menu and the shop never got.
//
// Nuno, after IDEA-071 landed: *"now one thing that I'd like to change is the
// preview of the home screen and the shop. Since we have now this logic of the
// ambience, let's bring that to the menus... and hide the blue part."*
//
// The "blue part" is literal and it is most of both screens: the menu beagle
// stands on a 1.15-radius soil disc with three hedge blocks behind it, and
// past the disc's rim there is NO GEOMETRY AT ALL — just the gradient dome. On
// a 390x844 phone that is about 70% of the frame, and the disc reads as a
// diorama on a table rather than as a dog in a garden.
//
// THE FIX IS NOT IDEA-066'S FIX, AND THE DIFFERENCE IS THE WHOLE DESIGN.
// `_scratch-surround-coverage.ts` proved the BOARD's horizon is never in shot:
// the play camera pitches 59 degrees down with a 23-degree half-FOV, so the
// top of frame still points 36 degrees DOWNWARD and a bigger floor fills every
// pixel. These cameras are nothing like that — measured off their own rigs:
//
//   menu character    elevation 14.2 deg, half-FOV 21  -> horizon 17% from top
//   shop character    elevation  9.5 deg, half-FOV 20  -> horizon 27% from top
//   shop diorama      elevation 33.3 deg, half-FOV 20  -> horizon OFF the top
//
// So on the two character stages the horizon is IN SHOT and high, and ground —
// however much of it — can only ever fill up to that line. What fills the rest
// is not ground, it is THINGS THAT STAND UP ON IT. This module is therefore a
// ground plane AND a band of distant content sitting on the horizon, where
// IDEA-066 needed only the first. (The diorama is the one stage that behaves
// like the board, and it gets the same treatment for free.)
//
// Four rules are load-bearing.
//
//  1. THE SKY ABOVE THE HORIZON STAYS SKY. It is where sky is, and it is also
//     where the menu's title, the coin chip and the shop's tab rail sit. The
//     brief is "hide the blue part", not "fill the frame" — a treeline drawn
//     up over the horizon would read as a wall and would cost the one screen
//     that has to stay legible.
//  2. THE BAND IS FAR, AND THAT IS ARITHMETIC RATHER THAN TASTE. The subject
//     is ~0.6 units at 3.2-5.3 units, so the frame is only ~4 units tall where
//     it stands. A 2.2-unit house reads as 2.2 / (2 * D * tan(halfFov)) of the
//     frame: put it at 8 units and it is half the screen and dwarfs the dog;
//     at 35 units it is ~8%, which is a house on the horizon. Hence
//     BAND_INNER/BAND_OUTER well past anything the stage itself occupies.
//  3. THE FOG IS SCALED, NOT COPIED. `palette.fogNear/fogFar` are absolute
//     world units AT THE BOARD'S BASE DOLLY (~31 units out), and this camera
//     sits 3-11 units out. Copied verbatim, a band at 35 units would land at
//     2% fog on the garden and read as a hard row of objects pasted on the
//     sky. Scaled by one constant the per-theme character survives — the
//     forest still swallows depth, the beach is still the clearest — while the
//     band lands where it should: mostly dissolved.
//  4. AND THE FOG COLOUR IS THE SKY AT THE HORIZON, NOT `palette.bg`. The
//     backdrop dome is a vertical gradient, so at eye height it is already
//     ~75% of the way to its TOP colour — fogging to `bg` (its BOTTOM colour)
//     would fade the treeline into a blue that is nowhere near the blue behind
//     it, and leave a visible band exactly where the fix is supposed to be
//     invisible. It is computed from the dome's own two colours and exponent
//     at the caller's own eye height, so the two cannot drift.
import * as THREE from "three";
import type { MazeTheme, ThemePalette } from "../game/themes";
import { mergeBySignature } from "./propMerge";
import { surroundTextureFor } from "./surroundTexture";
import {
  SURROUND_PARAMS,
  SURROUND_VIEW,
  luminance,
  surroundTextureKindFor,
  type SurroundKind,
} from "./surround";
import {
  type SurroundMaterials,
  disposeSurroundMaterials,
  makeSurroundMaterials,
} from "./surroundProps";
import { buildSurroundContent } from "./surroundRecipe";
import { distantCannon, distantPalm, distantPirateFlag, distantTreasureChest } from "./islandProps";
import { buildSeaside, disposeSeaside, type Seaside } from "./seaside";
import { getPropDef } from "../game/props";
import { ROWS } from "../game/grid";
import { makePropFromDef, tunnelArchDefFor, TUNNEL_ARCH_INSTANCE_HASH, WALL_H } from "./board";
import { ARCH_PARAMS } from "./archway";
import { buildPortalsAt, type TunnelPortals } from "./tunnelPortal";
import { FENCE_PARAMS, fencePanelGeometry } from "./fence";
import { wallGeometry, wallShapeFor } from "./hedgeWall";
import { wallTextureFor } from "./wallTexture";
import { toon } from "./toon";
import { shouldStyleBoard } from "./madboxStyle";

/** Under the stage's own disc/floor, exactly as the board's surround runs
 *  under the board floor — no joint to align, no crack, no z-fight. */
const GROUND_Y = -0.06;

/**
 * How far the ground reaches.
 *
 * A DISC, not a rectangle, and that is not decoration: these cameras sit close
 * to a small subject and the stage turntables, so a rectangle's CORNER can
 * come into frame at one aspect and not another, and a straight world edge in
 * a showcase is the same catastrophe IDEA-066 rule 1 names. A disc has no
 * corner to find. It is also sized well past the fog's own reach, so the edge
 * is never the thing that ends the picture.
 */
const GROUND_RADIUS = 150;

/** World units per repeat of the ground texture. See the note at its use. */
const GROUND_TEXTURE_PERIOD = 3;

/**
 * Showcase-only CLONES of the shared ground textures, by `kind|hex`.
 *
 * `surroundTextureFor` is a CACHE returning ONE texture instance per key — the
 * board's own surround ground holds the very same object. So the first version
 * of this module, which called `map.repeat.set()` on what it got back, was
 * writing the showcase's repeat (100) onto the texture the BOARD reads at
 * 12.5, and whichever built last won. That is a bug in the GAME, reached from
 * a menu: open the shop, start a run, and the board's ground would be tiled at
 * the menu's density.
 *
 * A clone shares `.source`, so this costs a small object and no second upload,
 * and it gets its own sampler state — which is also where the anisotropy goes.
 * They are never disposed, for the same reason `surroundTextureFor`'s own
 * cache is not: a handful of entries shared by every showcase, and disposing a
 * clone would free the SOURCE the original still needs.
 */
const groundClones = new Map<string, THREE.Texture>();

function showcaseGroundTexture(kind: string, hex: number): THREE.Texture | null {
  const key = `${kind}|${hex}`;
  const hit = groundClones.get(key);
  if (hit) return hit;
  const shared = surroundTextureFor(kind as never, hex);
  if (!shared) return null;
  const clone = shared.clone();
  const reps = (GROUND_RADIUS * 2) / GROUND_TEXTURE_PERIOD;
  clone.repeat.set(reps, reps);
  // A GROUND PLANE SEEN FROM 3 UNITS UP IS THE TEXTBOOK ANISOTROPIC CASE: the
  // camera looks along it, so one texel maps to many pixels across and almost
  // none down, and isotropic minification turns the lawn's tonal blobs into
  // smeared dark lenses. The board never needed this because it looks DOWN at
  // 59 degrees. 8 is well inside every WebGL2 implementation's limit and
  // three.js clamps to the real maximum anyway.
  clone.anisotropy = 8;
  groundClones.set(key, clone);
  return clone;
}

/**
 * Fog, derived from where the BAND actually is rather than scaled from the
 * board's numbers.
 *
 * THE FIRST VERSION SCALED `palette.fogNear/fogFar` BY ONE CONSTANT AND IT WAS
 * WRONG FOR A REASON THAT ONLY ONE OF THE THREE STAGES SHOWED. Those numbers
 * are absolute world units at the board's own dolly, so scaling them assumes
 * the camera sits at the stage's centre — true enough for the two character
 * rigs, 3.2 and 3.6 units out, and false for the shop's diorama, which sits
 * **10.6 units out**. Its band at radius 12.9-22.8 is therefore 23-33 units
 * from the CAMERA, and a fog far of 21.7 put every last object past the end of
 * the curve: the band was built, merged, added to the scene, and rendered as
 * nothing at all. Another correctly-built-and-invisible defect, and no render
 * says which of the two it is.
 *
 * So the band's camera-space depth is solved instead, and the only thing taken
 * from the palette is its near/far RATIO — which is what actually carries the
 * per-theme character: the garden and the beach run 2.7 (a long, soft fade),
 * the forest and the city 1.9-2.0 (depth swallowed quickly). The far plane
 * lands just past the outer ring, so the horizon always dissolves completely,
 * and the near plane falls out of the ratio.
 */
export function showcaseFog(palette: ThemePalette, reach: number, camDist: number): { near: number; far: number } {
  const ratio = Math.max(1.2, palette.fogFar / Math.max(1, palette.fogNear));
  const far = camDist + reach * 1.05;
  return { near: far / ratio, far };
}

/**
 * The band, in world units from the stage's own centre.
 *
 * IT IS THE BOARD'S OWN NEIGHBOURHOOD NOW, so these are no longer chosen —
 * they are read off it. The stage stands where the MAZE stands (the origin of
 * the board's world), and the surround recipe keeps everything outside the
 * board's floor plus `keepClear`, so the near edge is that box's north face
 * and the far edge is the ground the recipe builds on.
 *
 * It used to be a hand-made ring at 26-52 units built from the same library of
 * distant shapes, and that was honest while every theme's neighbourhood was a
 * scatter of those shapes. It stopped being honest when the beach grew a SEA
 * (IDEA-080), the park an avenue, a lake and a playground (IDEA-081) and Night
 * City a street grid with traffic (IDEA-082): the menu went on advertising the
 * dunes, the loose groves and the skyscraper ring those replaced. Building the
 * real recipe means a neighbourhood edit reaches the menu by existing.
 */
const BAND_INNER = (ROWS + 2) / 2 + SURROUND_PARAMS.keepClear;
const BAND_OUTER = Math.max(-SURROUND_PARAMS.zFar, SURROUND_PARAMS.halfWidth);

/** The default fog reach for a stage that HAS a band: just past its far edge,
 *  so the horizon always finishes dissolving before the ground runs out. */
export const SHOWCASE_FOG_REACH = BAND_OUTER + 2;

/** The band's own extent, exported so a test can check the fog clears it. */
export const SHOWCASE_BAND = { inner: BAND_INNER, outer: BAND_OUTER } as const;

/**
 * The cull, as a view cone from the camera rather than a fixed wedge.
 *
 * Every rig here looks from +Z toward the origin with a horizontal half-angle
 * of at most ~32 degrees (desktop; a phone is ~10). The neighbourhood is laid
 * out all the way round the board, so more than half of it can never be in
 * frame — the south band is behind the camera outright. IDEA-069's rule
 * applies unchanged: cull what is EXPENSIVE (the props), never what is cheap
 * and load-bearing (the ground, the sea).
 */
const VIEW_HALF_ANGLE = (40 * Math.PI) / 180;
/** Nothing whose nearest edge is further toward the camera than this is kept:
 *  it is beside or behind every rig's eye (the portrait dolly ends near 5.3). */
const VIEW_Z_CUT = 6;

/** Exported so a test can check the cull actually happened. */
export const SHOWCASE_VIEW_CULL = { halfAngle: VIEW_HALF_ANGLE, zCut: VIEW_Z_CUT } as const;

/** Deterministic hash in [0,1). Seed band 900-949 — clear of buildProps
 *  (200/201), buildWallDecor (301), buildHedgeDecor (1-7), groundDetail
 *  (401-406), the surround (600-639) and the arches (701). */
function hash(i: number, salt: number): number {
  const x = Math.sin(i * 127.1 + salt * 311.7 + 900) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * The colour the sky actually is at the horizon.
 *
 * `menuScene`/`shopScene` both build the same inward-facing gradient dome —
 * `mix(bottom, top, pow(clamp((y + offset) / (2 * offset)), exponent))` — so a
 * horizontal ray from a camera at `eyeY` lands on it at that height and that
 * is the colour the band has to disappear into. Rule 4.
 */
export function horizonSkyColor(
  bottomHex: number,
  topHex: number,
  eyeY: number,
  offset = 6,
  exponent = 0.55,
): THREE.Color {
  const h = Math.min(1, Math.max(0, (eyeY + offset) / (2 * offset)));
  // The shader's own `mix` is a LINEAR blend of two linear-working colours,
  // which is exactly what Color.lerp does, so this half is a straight copy.
  const domeLinear = new THREE.Color(bottomHex).lerp(
    new THREE.Color(topHex),
    Math.pow(h, exponent),
  );

  // AND THEN THE HALF THAT IS NOT OBVIOUS. Those dome shaders are hand-written
  // and write `gl_FragColor` with NO colour-space conversion, so the renderer's
  // linear-to-sRGB output step never runs on them and the sky is displayed as
  // its LINEAR triple read raw. Measured, `palette.bg` = 0x9ecbe8 = (158, 203,
  // 232) renders as (87, 152, 206) — its own linear values (0.342, 0.597,
  // 0.807) shown as if they were sRGB, to the byte.
  //
  // So the sky on these three screens is markedly darker and more saturated
  // than the hex it is given. That is PRE-EXISTING (it has been true since
  // IDEA-021) and deliberately NOT fixed here: correcting the shader would
  // change the sky on the menu, both shop stages and the game's own backdrop
  // at once, which is a visual change to something that was tuned by eye and
  // is nothing to do with this feature. Raise it separately.
  //
  // What it DOES mean is that fog — which is converted properly, being a real
  // material feature — cannot be given the palette hex or it lands ~40% too
  // light and paints a pale band across the horizon, which is precisely where
  // this whole feature has to be invisible. Handing the dome's linear triple
  // back as an sRGB triple reproduces what the screen shows, exactly.
  const shown = new THREE.Color();
  shown.setRGB(domeLinear.r, domeLinear.g, domeLinear.b, THREE.SRGBColorSpace);
  return shown;
}

/**
 * One camera's sense of depth.
 *
 * `bandScale` AND `fogReach` ARE SEPARATE NUMBERS, and collapsing them cost a
 * render: the first version derived the fog's far plane from the band's outer
 * radius, so a stage with NO band (`bandScale` 0) got a far plane at the
 * camera's own distance — and the shop's theme diorama rendered as an empty
 * blue screen, the model fogged out of existence from 8 units away. Fog is
 * about how far the GROUND reads; the band is one thing standing on it.
 */
export interface ShowcaseStage {
  /** Multiplies BAND_INNER/BAND_OUTER. 0 means no band at all. */
  bandScale: number;
  /** Distance from the camera to the stage centre. */
  camDist: number;
  /** Stage-space radius the fog should finish at. */
  fogReach: number;
}

export interface ShowcaseSurroundOpts {
  /** The camera's eye height — for the fog colour only. See rule 4. The two
   *  gradient stops are NOT passed: both scenes drive their dome from
   *  `palette.bg` / `palette.backdropTop`, so `apply()` reads them off the
   *  same palette it is theming to and the fog cannot lag the sky by a
   *  theme change. */
  eyeY: number;

  /** The stage this surround opens on. */
  stage: ShowcaseStage;
  /** Salt, so two stages in the same scene are not the same neighbourhood. */
  seed?: number;
}

export interface ShowcaseSurround {
  /** Re-themes in place: new ground surface, new band, new fog. Cheap enough
   *  to call on every theme change — it is what the shop's Themes tab does on
   *  every card tap. */
  apply(theme: MazeTheme): void;
  /** Advances what moves in the stage — the tunnel portal's swirl. The sea
   *  keeps its own clock (seaside.ts reads performance.now() per draw). */
  update(dt: number): void;
  /**
   * Switch to a stage with a different sense of scale.
   *
   * THE SHOP HAS TWO CAMERAS IN ONE SCENE and they want opposite things. Its
   * character rig sits 3.6 units out at 9.5 degrees, so its horizon is in shot
   * and the band belongs FAR (34-60). Its diorama rig sits 10.6 units out at
   * 33 degrees, where the top of frame points 13 degrees DOWNWARD and meets
   * the ground at 26 units — so on that stage anything past 26 is off-screen
   * entirely and the band has to come IN, not go out. One number covers both
   * because the band radii and the fog scale together.
   */
  setStage(stage: ShowcaseStage): void;
  /** Hide it entirely — the shop's diorama brings its own world and wants the
   *  band but not a second ground under its slab. */
  setVisible(v: boolean): void;
  dispose(): void;
}

/**
 * Content for one theme: the board's real neighbourhood, culled to the view.
 *
 * EVERY THEME SHOWS WHAT ITS BOARD SHOWS, because it is built by the same
 * function the board's surround is (`buildSurroundContent`). Looking north
 * from the stage, which is where every rig here looks, that is: the garden's
 * hedged plots and houses, the forest's pines, the beach's SEA running to the
 * horizon, the park's lake with its avenue running off either side, and Night
 * City's first street — pavement, traffic and frontages. `"none"` (Arcade
 * Night) builds nothing, which preserves IDEA-066's deliberate void.
 *
 * `SURROUND_VIEW` is the GAME camera's footprint and the recipe reads it to
 * cull, so it is opened to the full extent for the build and put back
 * afterwards — a board built later must not inherit the menu's view, and the
 * menu must not inherit a phone's narrow strip of the board's.
 *
 * The beach's sea is NOT in here: it is two ShaderMaterials owned by
 * seaside.ts, which `mergeBySignature` was never written to bucket, so the
 * caller builds it alongside — the same split `ensureSurround` makes.
 */
export function buildShowcaseBand(
  kind: SurroundKind,
  m: SurroundMaterials,
  scale: number,
  camDist: number,
): THREE.Group {
  const g = new THREE.Group();
  g.userData.itemCount = 0;
  // `scale` 0 is GROUND ONLY, and the shop's diorama is why it exists. That rig
  // looks down at 33 degrees, so its horizon is off the top of the frame and
  // the ground already fills every pixel — IDEA-066's situation exactly, where
  // a bigger floor was the whole answer. A band there has nowhere to stand that
  // is both in frame and not in the way: inside the frame's own ground line it
  // sprawls across the top of the picture, and past it the only thing that
  // ever shows is a CROPPED fragment at the very edge. Both were built and both
  // read as debris. Nothing is the right amount.
  if (kind === "none" || scale <= 0) return g;

  const saved = { ...SURROUND_VIEW };
  const P = SURROUND_PARAMS;
  let host: THREE.Group;
  try {
    SURROUND_VIEW.halfX = P.halfWidth;
    SURROUND_VIEW.zNear = P.zNear;
    SURROUND_VIEW.zFar = P.zFar;
    host = buildSurroundContent(kind, m);
  } finally {
    SURROUND_VIEW.halfX = saved.halfX;
    SURROUND_VIEW.zNear = saved.zNear;
    SURROUND_VIEW.zFar = saved.zFar;
  }
  const kept = cullToView(host, camDist);
  g.add(host);
  // One mesh per distinct material for the whole band, exactly as the board's
  // surround does — and for the same reason: this is a few hundred objects and
  // a per-object draw call is not affordable on a menu that also renders a
  // fully animated character.
  mergeBySignature(g, { castShadow: false });
  g.traverse((o) => {
    o.castShadow = false;
    o.receiveShadow = false;
  });
  g.userData.itemCount = kept;
  return g;
}

/**
 * Removes everything that can never be in frame, recursing into a group only
 * when it straddles the edge (Night City's streets are one group spanning the
 * whole board). Returns how many objects were kept, for the test.
 */
function cullToView(group: THREE.Object3D, camDist: number): number {
  const box = new THREE.Box3();
  const tan = Math.tan(VIEW_HALF_ANGLE);
  let kept = 0;
  for (const child of [...group.children]) {
    child.updateMatrixWorld(true);
    box.setFromObject(child);
    if (box.isEmpty()) continue;
    // The cone at this object's FAR edge is the widest it gets over the
    // object's depth; the margin covers its height poking into a taller frame.
    const halfW = (camDist - box.min.z) * tan + 2;
    const inside = box.min.z < VIEW_Z_CUT && box.min.x < halfW && box.max.x > -halfW;
    if (!inside) {
      group.remove(child);
      disposeGeometryOnly(child);
      continue;
    }
    const straddles = box.max.z > VIEW_Z_CUT || box.max.x > halfW || box.min.x < -halfW;
    if (straddles && !(child as THREE.Mesh).isMesh && child.children.length > 0) {
      kept += cullToView(child, camDist);
    } else {
      kept++;
    }
  }
  return kept;
}

/** Geometry only: the band's materials are the shared surround set, owned and
 *  disposed by the caller. */
function disposeGeometryOnly(o: THREE.Object3D): void {
  o.traverse((x) => {
    const mesh = x as THREE.Mesh;
    if (mesh.isMesh) mesh.geometry.dispose();
  });
}

/**
 * THE NEAR STAGE: the theme's own maze wall, its arch, and its landmarks.
 *
 * Nuno, after the first pass: *"bring the trees closer to the dog, and the
 * main props of each theme like the walls of each theme should appear, the
 * treehouse of the garden for example. Another thing we can make is to put the
 * beagle stopped and behind him the arch of each theme."*
 *
 * Three asks and one composition answers all of them, because it is a place
 * the game already has: **a tunnel mouth.** A run of the theme's real maze
 * wall, an arch standing in the gap, and the beagle in front of it, facing
 * out. It is the one piece of staging that is both a portrait and a screenshot
 * of the game.
 *
 * FOUR THINGS ARE LOAD-BEARING.
 *
 *  1. **THIS IS THE ONE CAMERA AN ARCH READS ON.** IDEA-067's first rule is
 *     that at the PLAY camera an arch reads in PLAN, not elevation — the board
 *     pitches 59 degrees down, so a portal's near jamb eclipses its own
 *     opening and the whole thing renders as a green slab. That is why the
 *     shipped arch is a low arbour rather than a portal. Here the camera sits
 *     at 14 degrees, nearly level, and an arch facing it reads exactly as an
 *     arch. Same prop, opposite constraint, and worth stating because the two
 *     notes contradict each other unless you know which camera each is about.
 *  2. **THE WALL IS THE REAL ONE.** `wallGeometry` + `wallShapeFor` +
 *     `wallTextureFor` — the same block and the same cached texture the maze
 *     builds from, so a hedge theme gets IDEA-068's lumpy crown and Night City
 *     gets its brick. The menu's old stand-in was five 0.5 x 0.28 boxes: a
 *     doll's-house hedge, which is precisely why "the walls of each theme
 *     should appear" needed asking for.
 *  3. **THE ARCH IS THE BOARD'S OWN, FROM `tunnelArchDefFor`.** It used to be
 *     the garden's Hedge Arch tinted from each palette, which was right while
 *     only the garden named an arch — and has been wrong since every theme got
 *     its own (the forest's two trees, the beach's rock arch, the park's gate,
 *     the city's neon gateway). The menu was advertising a recoloured yew
 *     portal on five themes that do not have one. It stands where the board
 *     stands it — `ARCH_PARAMS.outset` past the wall face, at the board's
 *     scale, over a ONE-tile gap — with the theme's PORTAL glowing in it, and
 *     a theme with no arch (Arcade Night) gets the board's frameless portal,
 *     so the doorway in the menu is the doorway in a run.
 *  4. **THE LANDMARKS ARE THE REAL LIBRARY PROPS**, `makePropFromDef` off
 *     `PROP_LIBRARY`, so the menu plants the same treehouse the garden does
 *     rather than a lookalike that drifts out of step with it — and only
 *     props the theme's board actually plants. The beach, the park and the
 *     city have no hand-placed props any more (their places are their sea,
 *     lake and streets, which the band now shows), so they get none here
 *     either; the old umbrella/palm/oak/tower picks were advertising props
 *     those boards stopped planting.
 */
/**
 * A landmark is a LIBRARY prop by id, or — for a theme whose place is built by
 * the surround recipe rather than placed from the library — one of that
 * recipe's own builders, at a size for this stage. Pirate Island (IDEA-085) is
 * the first: its props are still to be authored, and a menu advertising it
 * with nothing behind the arch would be selling sand.
 */
type Landmark =
  | string
  | { build: (m: SurroundMaterials) => THREE.Object3D; scale: number; front?: boolean };

const SHOWCASE_LANDMARKS: Readonly<Record<string, readonly Landmark[]>> = {
  // The treehouse first because Nuno named it, and because it is the garden's
  // only singular prop — IDEA-060 built it for one apron corner and this is
  // the second place in the game it can stand at full size.
  garden: ["treehouse", "garden-tree", "garden-shrub", "nest-tree", "birdhouse"],
  forest: ["log-cabin", "pine", "critter-deer", "pine", "critter-fox"],
  beach: [],
  park: [],
  city: [],
  daycity: [],
  // The treasure first: it is what the island is KNOWN by, and the near-axis
  // slot puts it right behind the dog. Then palms and the guns either side.
  island: [
    // Sized against the TREEHOUSE the garden plants here (~2.6 units tall at
    // its library scale): the first pass at 2.4x put a chest a fifth of a
    // phone screen wide beside the title, and palms off the top of the frame.
    { build: (m) => distantTreasureChest(m, { seed: 3 }), scale: 1.4, front: true },
    { build: (m) => distantPalm(m, { height: 2.4, seed: 9 }), scale: 1.05 },
    { build: (m) => distantCannon(m, { seed: 2 }), scale: 1.5, front: true },
    { build: (m) => distantPalm(m, { height: 2.7, seed: 14 }), scale: 1.05 },
    { build: (m) => distantPirateFlag(m, { seed: 6 }), scale: 1.3 },
  ],
  classic: [],
};

/**
 * Landmarks that have a FRONT, and whose front is local +Z.
 *
 * Nuno: *"rotate the treehouse to have the front of the treehouse pointing to
 * the user."* Every landmark was getting a random yaw, which is right for a
 * tree and wrong for a building — a treehouse showing its blank side wall is
 * the same prop with its one recognisable face turned away.
 *
 * **MEMBERSHIP IS VERIFIED, NOT GUESSED**, because the whole thing turns on
 * which way a prop's local axes point and being wrong shows the BACK. Checked
 * in the source: the treehouse's door, window and plank grooves all sit at
 * `bodyD / 2` on +Z (`gardenProps.ts`), and the log cabin's door and step at
 * `halfL + proud`, likewise +Z (`forestProps.ts`); the birdhouse's entrance is
 * cut from the same face. That is the house style here, but it is a
 * CONVENTION rather than a guarantee — anything added to this set needs the
 * same check, or it will be turned confidently the wrong way round.
 *
 * Organic props stay on their random yaw deliberately: a tree has no front,
 * and a row of them all turned the same way is a row of clones.
 */
export const SHOWCASE_FRONTED: ReadonlySet<string> = new Set([
  "treehouse",
  "log-cabin",
  "birdhouse",
]);

/**
 * The Y rotation that turns a prop's local +Z toward the camera.
 *
 * Exported because it is the one part of the facing rule a headless test can
 * reach — `buildStageDressing` needs a canvas for the wall texture, so the
 * test checks the ARITHMETIC and the source keeps the evidence for the axis.
 */
export function faceCameraYaw(px: number, pz: number, camDist: number): number {
  return Math.atan2(0 - px, camDist - pz);
}

/** Where the wall run stands, in units behind the subject. */
// Pushed back from -3.6 after the desktop render: at 3.2 units of camera the
// arch's crown landed behind the "Beagle Chomp" title. The menu's own copy is
// part of the composition, not something to be drawn over.
const STAGE_WALL_Z = -4.2;
/** Half-length of the wall run, in tiles either side of the tunnel. */
const STAGE_WALL_TILES = 5;
/**
 * The whole tunnel mouth — wall, fence, arch and portal together — as a
 * fraction of its size on the board.
 *
 * SIZED FOR THE PORTRAIT FRAME, WHICH IS MUCH NARROWER THAN IT LOOKS. The menu
 * dollies to 5.3 units on a phone and its vertical FOV is 42 degrees, so at
 * aspect 0.462 the HORIZONTAL half-angle is only 10.1 degrees — the visible
 * world at the wall's depth is about 3.2 units across. The board's arches are
 * 2.4 units tall; at full size one runs off the top of a phone and dwarfs the
 * dog it is meant to frame. Scaling the WHOLE mouth rather than the arch alone
 * keeps the relationship the board has — the arch exactly spanning a one-tile
 * corridor between two wall blocks — which is the thing a player recognises.
 */
const STAGE_SCALE = 0.62;

function buildStageDressing(
  theme: MazeTheme,
  seed: number,
  camDist: number,
): THREE.Group {
  const palette = theme.palette;
  const g = new THREE.Group();
  g.name = "showcaseStage";

  // The tunnel mouth, in BOARD units, scaled as one. Its origin is the
  // tunnel's own corridor tile.
  const mouth = new THREE.Group();
  mouth.name = "showcaseTunnelMouth";
  mouth.position.set(0, 0, STAGE_WALL_Z);
  mouth.scale.setScalar(STAGE_SCALE);
  g.add(mouth);

  // --- the wall run ---------------------------------------------------------
  const wallTex = wallTextureFor(palette.wallTexture, palette.wall);
  const wallMat = toon({
    color: wallTex ? 0xffffff : palette.wall,
    map: wallTex,
    emissive: palette.wallEmissive,
    emissiveIntensity: palette.wallEmissiveIntensity,
  });
  const wallGeo = wallGeometry(wallShapeFor(palette.wallTexture), WALL_H);
  // ONE tile of gap, centred on the origin — the board's real tunnel. The arch
  // spans exactly that, standing outside the wall face, so its piers land in
  // front of the two blocks either side of the corridor as they do in a run.
  const tiles: number[] = [];
  for (let i = -STAGE_WALL_TILES; i <= STAGE_WALL_TILES; i++) if (i !== 0) tiles.push(i);
  for (const i of tiles) {
    const w = new THREE.Mesh(wallGeo, wallMat);
    w.position.set(i, WALL_H / 2, 0);
    // The same quarter-turn variety the maze gets, so a straight run is not
    // ten copies of one block.
    w.rotation.y = (Math.PI / 2) * Math.floor(hash(i + 40, seed) * 4);
    w.castShadow = true;
    w.receiveShadow = true;
    mouth.add(w);
  }

  // --- the fence ------------------------------------------------------------
  // The garden's picket stands in front of every exposed wall face on the
  // board, so it does here: along the run's face toward the camera, and on the
  // two ends facing into the tunnel — the panels the arch's own footing fence
  // continues (IDEA-067 rule 3).
  if (palette.fence === "picket") {
    const fenceGeo = fencePanelGeometry(1);
    const fenceMat = toon({ color: palette.fenceColor, vertexColors: true });
    const out = 0.5 + FENCE_PARAMS.proud;
    const panel = (x: number, z: number, rot: number): void => {
      const f = new THREE.Mesh(fenceGeo, fenceMat);
      f.position.set(x, 0, z);
      f.rotation.y = rot;
      f.castShadow = true;
      mouth.add(f);
    };
    for (const i of tiles) panel(i, out, 0);
    panel(-1 + out, 0, Math.PI / 2);
    panel(1 - out, 0, -Math.PI / 2);
  }

  // --- the arch -------------------------------------------------------------
  // `archTransformFor` for a mouth opening toward +Z: the wall face plus the
  // outset, local +X spanning the corridor, a gate's leaves opening OUT of the
  // maze — which is toward the camera.
  const archZ = 0.5 + ARCH_PARAMS.outset;
  const archDef = tunnelArchDefFor(theme);
  if (archDef) {
    const arch = makePropFromDef(archDef, TUNNEL_ARCH_INSTANCE_HASH);
    arch.position.set(0, ARCH_PARAMS.lift, archZ);
    arch.rotation.y = ARCH_PARAMS.yaw;
    arch.scale.multiplyScalar(ARCH_PARAMS.scale);
    mouth.add(arch);
  }
  g.userData.archZ = archZ;

  // --- the landmarks --------------------------------------------------------
  // An arc BEHIND the wall run, near enough to read as "the trees by the dog"
  // and far enough not to crowd him. The first pass put the whole horizon at
  // 34 units and Nuno's note was exactly this gap: a meadow with nothing in
  // the middle distance.
  // PLACED IN A FRAME THAT IS 2-4 UNITS WIDE, which is the whole difficulty.
  // The first pass swept an arc from 112 to 248 degrees and put NONE of them
  // on screen — partly a sign error (with `z = sin(a) * rad`, "behind" is
  // -90 degrees, not 180, so the whole set was strung out to the left and
  // right at z = -2) and partly because a phone at 8 units out can only see
  // |x| < 2.4. So the offsets are measured from the -Z axis, the first
  // landmark is placed deliberately close to it, and the rest fan outward for
  // the desktop framing, which is four times wider.
  const ids = SHOWCASE_LANDMARKS[theme.id] ?? [];
  // Builder landmarks draw from a surround material set of their OWN: the
  // dressing disposes every material its meshes hold when it is cleared, so a
  // set shared with the band would be freed out from under it.
  const builtMats = ids.some((l) => typeof l !== "string") ? makeSurroundMaterials(palette) : null;
  for (let i = 0; i < ids.length; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    // Landmark 0 is the one the theme is KNOWN by (the garden's treehouse) and
    // it gets the near-axis slot; each later one steps further out.
    // 0.24 rather than dead centre: at 8 units that is x = 1.9, which is just
    // inside a phone's ~2.4-unit half-width AND just outside the centred menu
    // title on desktop. Both framings, one number.
    const off = side * (0.24 + Math.floor(i / 2) * 0.34 + (hash(i * 5, seed) - 0.5) * 0.1);
    // Held inside the keep-clear box — the neighbourhood starts at its edge —
    // so a landmark never stands in somebody's plot.
    const rad = Math.min(BAND_INNER - 1.5, 7.5 + hash(i * 9, seed + 1) * 5.5);
    const lm = ids[i];
    let prop: THREE.Object3D;
    if (typeof lm === "string") {
      prop = makePropFromDef(getPropDef(lm), hash(i * 13, seed + 2));
    } else {
      prop = lm.build(builtMats!);
      prop.scale.multiplyScalar(lm.scale);
    }
    const px = Math.sin(off) * rad;
    const pz = -Math.cos(off) * rad;
    prop.position.set(px, 0, pz);
    if (typeof lm === "string" ? SHOWCASE_FRONTED.has(lm) : lm.front === true) {
      // Aimed at the CAMERA, not simply at +Z: a landmark 1.9 units off the
      // centre line and 8 back is about 10 degrees round from the view axis,
      // and squaring it to the world instead of to the viewer shows a sliver
      // of its side wall — which is the whole thing this is fixing, just less
      // of it. Every rig here looks from (0, ·, camDist), so that is where it
      // aims. The portrait dolly moves the camera from 3.2 to 5.3 and swings
      // this by about 1.5 degrees, which is why one base distance is honest
      // and a per-frame update would be machinery for nothing.
      prop.rotation.y = faceCameraYaw(px, pz, camDist);
    } else {
      // A tree has no front, and a row of them all turned the same way is a
      // row of clones.
      prop.rotation.y = hash(i * 17, seed + 3) * Math.PI * 2;
    }
    prop.traverse((o) => {
      o.castShadow = false;
      o.receiveShadow = false;
    });
    g.add(prop);
  }
  if (builtMats) {
    // Whatever the builders did not use is held by no mesh, so the dressing's
    // own teardown would never reach it.
    const used = new Set<THREE.Material>();
    g.traverse((o) => {
      const mat = (o as THREE.Mesh).material;
      if (mat) (Array.isArray(mat) ? mat : [mat]).forEach((x) => used.add(x));
    });
    for (const mat of Object.values(builtMats)) if (!used.has(mat)) mat.dispose();
  }
  return g;
}

/**
 * The portal in the stage's tunnel mouth: the board's own (IDEA-083), placed
 * in the mouth's frame and scaled with it. Kept OUT of the dressing group,
 * because the dressing is welded by `mergeBySignature` and these are additive
 * ShaderMaterials and Points that have no business being bucketed.
 */
function buildStagePortal(parent: THREE.Object3D, theme: MazeTheme, archZ: number): TunnelPortals {
  const holder = new THREE.Group();
  holder.name = "showcasePortal";
  holder.position.set(0, 0, STAGE_WALL_Z);
  holder.scale.setScalar(STAGE_SCALE);
  parent.add(holder);
  return buildPortalsAt(holder, theme, [
    { x: 0, z: archZ, rotationY: ARCH_PARAMS.yaw, name: "showcasePortal" },
  ]);
}

/**
 * Builds a showcase's ground + horizon band + fog, and re-themes in place.
 *
 * The scene KEEPS OWNERSHIP of nothing here: everything this adds lives under
 * one group it also disposes, which is what lets a stage call `apply()` on
 * every theme card tap without leaking a material per tap.
 */
export function createShowcaseSurround(
  scene: THREE.Scene,
  opts: ShowcaseSurroundOpts,
): ShowcaseSurround {
  const seed = opts.seed ?? 0;
  const root = new THREE.Group();
  root.name = "showcaseSurround";
  scene.add(root);

  const groundGeo = new THREE.CircleGeometry(GROUND_RADIUS, 64);
  let groundMat: THREE.MeshToonMaterial | null = null;
  const ground = new THREE.Mesh(groundGeo, toon({ color: 0x000000 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = GROUND_Y;
  ground.receiveShadow = false;
  ground.castShadow = false;
  root.add(ground);

  let band: THREE.Group | null = null;
  let dressing: THREE.Group | null = null;
  /** The beach's sea (IDEA-080) — two ShaderMaterials owned by seaside.ts,
   *  built beside the band rather than inside it for the board's reason. */
  let sea: Seaside | null = null;
  /** The tunnel mouth's portal (IDEA-083), animated from `update`. */
  let portal: TunnelPortals | null = null;
  let mats: SurroundMaterials | null = null;
  let stage: ShowcaseStage = opts.stage;
  let lastTheme: MazeTheme | null = null;

  function clearBand(): void {
    if (band) {
      root.remove(band);
      band.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) mesh.geometry.dispose();
      });
      band = null;
    }
    if (dressing) {
      root.remove(dressing);
      // The dressing owns MATERIALS as well as geometry — every prop factory
      // builds its own, and `mergeBySignature` disposes only what IT orphans
      // (IDEA-066 rule 5). Leaving these would leak a GPU program per theme
      // change, and the shop's Themes tab changes theme on every card tap.
      dressing.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        const m = mesh.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
      });
      dressing = null;
    }
    if (sea) {
      disposeSeaside(sea);
      sea = null;
    }
    if (portal) {
      portal.group.parent?.parent?.remove(portal.group.parent);
      portal.dispose();
      portal = null;
    }
    if (mats) {
      disposeSurroundMaterials(mats);
      mats = null;
    }
  }

  function apply(theme: MazeTheme): void {
    const palette = theme.palette;
    // A night theme keeps its own look here exactly as it does on its board
    // (`shouldStyleBoard`) — see `madboxSkip` in madboxStyle.ts.
    root.userData.madboxSkip = !shouldStyleBoard(palette);
    // --- ground -----------------------------------------------------------
    // Same construction and the same two traps as `buildSurroundGround`: the
    // texture BAKES `surroundGround` in so the material is held at white, and
    // the emissive is driven through that same map (or scaled by the colour's
    // luminance when a "flat" theme has no map on either side, or the showcase
    // comes back darker than the board it is advertising).
    // A CLONE, never the shared cache entry — see `showcaseGroundTexture`. The
    // period is NOT `SURROUND_TEXTURE_TILES`, and that is a camera decision
    // rather than a surface one: that canvas covers 8 tiles, which is right on
    // the board (seen from 30-50 units at 59 degrees an 8-unit period is a
    // small pattern), while here the camera sits 3 units up and the near
    // ground is magnified enormously.
    const map = showcaseGroundTexture(
      surroundTextureKindFor(palette.floorTexture),
      palette.surroundGround,
    );
    const lift = palette.floorTexture === "flat" ? 1 : luminance(palette.surroundGround);
    const next = toon({
      color: map ? 0xffffff : palette.surroundGround,
      map,
      emissiveMap: map,
      emissive: palette.floorEmissive,
      emissiveIntensity: palette.floorEmissiveIntensity * (map ? 1 : lift),
    });
    ground.material = next;
    groundMat?.dispose();
    groundMat = next;

    // --- band -------------------------------------------------------------
    clearBand();
    mats = makeSurroundMaterials(palette);
    band = buildShowcaseBand(palette.surround, mats, stage.bandScale, stage.camDist);
    root.add(band);
    // The sea is ground, not props: built whole and never culled, exactly as
    // `ensureSurround` does — two meshes whatever its size.
    if ((palette.surround === "dunes" || palette.surround === "island") && stage.bandScale > 0) {
      sea = buildSeaside(SURROUND_PARAMS.halfWidth, SURROUND_PARAMS.zFar);
      root.add(sea.group);
    }

    // --- the near stage ---------------------------------------------------
    // Only where there is a band: a stage with `bandScale` 0 is the shop's
    // diorama, which brings its OWN walls and props and would be standing in
    // front of a second set of them.
    if (stage.bandScale > 0) {
      dressing = buildStageDressing(theme, seed, stage.camDist);
      mergeBySignature(dressing, { castShadow: true });
      root.add(dressing);
      portal = buildStagePortal(root, theme, dressing.userData.archZ as number);
    }

    // --- fog --------------------------------------------------------------
    // Rules 3 and 4. The dome carries `fog: false`, so this reaches the ground
    // and the band and nothing else.
    const { near, far } = showcaseFog(palette, stage.fogReach, stage.camDist);
    const color = horizonSkyColor(palette.bg, palette.backdropTop, opts.eyeY);
    if (scene.fog instanceof THREE.Fog) {
      scene.fog.color.copy(color);
      scene.fog.near = near;
      scene.fog.far = far;
    } else {
      scene.fog = new THREE.Fog(color.getHex(), near, far);
    }
    lastTheme = theme;
  }

  return {
    apply,
    update(dt: number): void {
      portal?.update(dt);
    },
    setStage(next: ShowcaseStage): void {
      const rebuild = next.bandScale !== stage.bandScale;
      const refog = next.camDist !== stage.camDist || next.fogReach !== stage.fogReach;
      if (!rebuild && !refog) return;
      stage = next;
      if (!rebuild && lastTheme) {
        // Only the depth changed: the band is unchanged, so re-fog and stop.
        const f = showcaseFog(lastTheme.palette, stage.fogReach, stage.camDist);
        if (scene.fog instanceof THREE.Fog) {
          scene.fog.near = f.near;
          scene.fog.far = f.far;
        }
        return;
      }
      // A rebuild rather than a cache of two bands: a stage switch is a tab
      // tap, the shop already rebuilds its whole diorama on one, and holding a
      // second band alive costs its geometry for the life of the page to save
      // a few milliseconds on an interaction the player initiated.
      if (lastTheme) apply(lastTheme);
    },
    setVisible(v: boolean): void {
      root.visible = v;
    },
    dispose(): void {
      clearBand();
      scene.remove(root);
      groundGeo.dispose();
      groundMat?.dispose();
      groundMat = null;
      scene.fog = null;
    },
  };
}
