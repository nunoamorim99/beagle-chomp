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
import { luminance, surroundTextureKindFor, type SurroundKind } from "./surround";
import {
  type SurroundMaterials,
  disposeSurroundMaterials,
  makeSurroundMaterials,
  distantBroadleaf,
  distantConifer,
  distantDune,
  distantFlowerBorder,
  distantHedgeRun,
  distantHouse,
  distantRockOutcrop,
  distantShrubClump,
  distantTower,
} from "./surroundProps";
import { getPropDef } from "../game/props";
import { makePropFromDef, WALL_H } from "./board";
import { makeArchway } from "./archway";
import { wallGeometry, wallShapeFor } from "./hedgeWall";
import { wallTextureFor } from "./wallTexture";
import { toon } from "./toon";

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
 * The band, in world units from the stage's own centre, at `scale` 1.
 *
 * IT HAS MOVED TWICE, OUT AND THEN BACK, AND BOTH REASONS STILL HOLD.
 * Out first: at 26 the near ring's tree crowns read as pale HEXAGONS, because
 * a `lobedFoliageGeometry` at `detail: 0` is twenty faces — invisible on the
 * board where a crown is 15-40 px, glaring the moment it fills 80. 34 fixed
 * the faceting and the scale together.
 * Back in second, after Nuno: *"bring the trees closer to the dog."* He was
 * right, and the honest fix is not to undo the first one — it is that the
 * middle distance was EMPTY. `buildStageDressing` now fills 5-13 units with
 * the theme's REAL library props, which carry proper detail because they were
 * authored for a camera two tiles away. With those in place the band is a
 * horizon again rather than the only content, so it comes back to 26-52 and
 * the two ranges chain instead of leaving a gap of bare lawn between them.
 */
const BAND_INNER = 26;
const BAND_OUTER = 52;

/** The default fog reach for a stage that HAS a band: just past its far ring,
 *  so the horizon always finishes dissolving before the band runs out. */
export const SHOWCASE_FOG_REACH = BAND_OUTER;

/** The band's own extent, exported so a test can check the fog clears it. */
export const SHOWCASE_BAND = { inner: BAND_INNER, outer: BAND_OUTER } as const;


/**
 * The wedge behind the camera, which gets nothing.
 *
 * Every rig here looks from +Z toward the origin, so content at +Z beyond the
 * camera is out of frame at every aspect — and this is the one cheap cull
 * available, since the ground is a disc and the band is a ring. IDEA-069's
 * rule applies unchanged: cull what is EXPENSIVE (the props), never what is
 * cheap and load-bearing (the ground).
 */
const BEHIND_WEDGE = Math.PI * 0.55;

/** Exported so a test can check the cull actually happened. */
export const SHOWCASE_BEHIND_WEDGE = BEHIND_WEDGE;

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
 * Content for one theme, as a ring of distant objects.
 *
 * EVERY THEME USES ITS OWN VOCABULARY, taken from `surroundRecipe.ts` rather
 * than invented here: `palette.surround` already says which neighbourhood this
 * theme grows, and a showcase that put houses behind the Deep Forest would be
 * advertising the wrong thing on the one screen where a player is buying it.
 * `"none"` (Arcade Night) gets NOTHING, which preserves IDEA-066's deliberate
 * void — its fog IS its surround, and that is the look someone paid for.
 */
export function buildShowcaseBand(
  kind: SurroundKind,
  m: SurroundMaterials,
  seed: number,
  scale: number,
): THREE.Group {
  const g = new THREE.Group();
  // `scale` 0 is GROUND ONLY, and the shop's diorama is why it exists. That rig
  // looks down at 33 degrees, so its horizon is off the top of the frame and
  // the ground already fills every pixel — IDEA-066's situation exactly, where
  // a bigger floor was the whole answer. A band there has nowhere to stand that
  // is both in frame and not in the way: inside the frame's own ground line it
  // sprawls hedges across the top of the picture, and past it the only thing
  // that ever shows is a CROPPED fragment at the very edge. Both were built and
  // both read as debris. Nothing is the right amount.
  if (kind === "none" || scale <= 0) return g;

  const inner = BAND_INNER * scale;
  const outer = BAND_OUTER * scale;
  // Three rings, near to far. A single ring reads as a fence of objects all
  // the same size; three at different depths is what makes it a landscape,
  // and the fog does the rest.
  const RINGS = 4;
  let n = 0;
  for (let ring = 0; ring < RINGS; ring++) {
    const t = ring / (RINGS - 1);
    const radius = inner + (outer - inner) * t;
    // Circumference grows with radius, so a fixed count would thin out the
    // far rings exactly where the eye reads the horizon line.
    //
    // THESE NUMBERS ARE WHAT MAKES IT A TREELINE RATHER THAN SOME TREES. The
    // first build ran 14/21/28 and, after the behind-camera wedge takes its
    // 28%, that is about seven objects spread across the whole visible
    // horizon — which renders as a few lonely props standing in a field, not
    // as a landscape. A horizon reads on being CONTINUOUS; the fog is what
    // stops a continuous one from becoming a wall.
    const count = Math.round((34 + ring * 14) * Math.min(1.6, scale));
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + hash(i * 3 + ring, seed) * 0.22;
      // Skip the wedge behind the camera (+Z).
      let d = Math.atan2(Math.sin(a), Math.cos(a)) - Math.PI / 2;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      if (Math.abs(d) < BEHIND_WEDGE / 2) continue;

      const r = radius * (0.9 + hash(i * 7 + ring, seed + 1) * 0.2);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const roll = hash(i * 11 + ring, seed + 2);
      const s = seed * 17 + ring * 101 + i;

      let child: THREE.Object3D;
      if (kind === "plots") {
        // A hedged field boundary is the garden's own horizon, so it is the
        // majority. Runs are aimed TANGENTIALLY (see below), which is what
        // makes them read as boundaries rather than as objects pointed at you.
        child =
          roll < 0.46
            ? distantHedgeRun(m, { length: 6 + hash(i, s) * 5, height: 0.62, seed: s })
            : roll < 0.7
              ? distantBroadleaf(m, { height: 2.1 + hash(i, s + 1) * 1.1, seed: s })
              : roll < 0.84
                ? distantHouse(m, { kind: hash(i, s + 2) < 0.6 ? "house" : "greenhouse", seed: s })
                : roll < 0.93
                  ? distantFlowerBorder(m, { length: 3 + hash(i, s + 3) * 2, seed: s })
                  : distantShrubClump(m, { radius: 0.6, seed: s });
      } else if (kind === "woodland") {
        child =
          roll < 0.82
            ? distantConifer(m, { height: 3.2 + hash(i, s) * 2.2, seed: s })
            : roll < 0.94
              ? distantBroadleaf(m, { height: 2.4 + hash(i, s + 1) * 1.0, seed: s })
              : distantShrubClump(m, { radius: 0.7, seed: s });
      } else if (kind === "dunes") {
        // A beach's read is the HORIZON, so almost nothing out there stands
        // up — IDEA-066's own note. Dunes and outcrops only.
        child =
          roll < 0.72
            ? distantDune(m, { seed: s })
            : roll < 0.9
              ? distantRockOutcrop(m, { seed: s })
              : distantShrubClump(m, { radius: 0.5, seed: s });
      } else if (kind === "parkland") {
        child =
          roll < 0.62
            ? distantBroadleaf(m, { height: 2.6 + hash(i, s) * 1.4, seed: s })
            : roll < 0.84
              ? distantHedgeRun(m, { length: 5 + hash(i, s + 1) * 4, height: 0.55, seed: s })
              : distantShrubClump(m, { radius: 0.7, seed: s });
      } else {
        child =
          roll < 0.86
            ? distantTower(m, { height: 3 + hash(i, s) * 5, seed: s })
            : distantBroadleaf(m, { height: 2.2, seed: s });
      }

      child.position.set(x, 0, z);
      // A HEDGE RUN IS BUILT ALONG ITS LOCAL +X, so a run aimed at the stage
      // is a hedge seen END-ON: one blob, and the whole point of a boundary
      // lost. Turning it a quarter past the radial direction lays it ACROSS
      // the view, which is what reads as a field edge on the horizon.
      // (`hedgePerimeter`'s own atan2(-dz, dx) sign trap, in a simpler form.)
      child.rotation.y = -a + Math.PI / 2 + (hash(i * 13 + ring, seed + 3) - 0.5) * 0.5;
      g.add(child);
      n++;
    }
  }
  // One mesh per distinct material for the whole band, exactly as the board's
  // surround does — and for the same reason: this is a few hundred objects and
  // a per-object draw call is not affordable on a menu that also renders a
  // fully animated character.
  mergeBySignature(g, { castShadow: false });
  g.traverse((o) => {
    o.castShadow = false;
    o.receiveShadow = false;
  });
  g.userData.itemCount = n;
  return g;
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
 *  3. **THE ARCH IS TINTED FROM THE PALETTE, NOT TAKEN FROM `tunnelArch`.**
 *     Only the garden names one, and deliberately — IDEA-067 rule 5 keeps a
 *     yew portal off the beach's tunnel mouths, and setting `tunnelArch` on
 *     five more themes to fix a MENU would change five BOARDS. `makeArchway`
 *     already takes `foliageColors`, `blossomColor` and `stoneColor` as
 *     params, so the showcase builds its own from the theme the same way
 *     `makeSurroundMaterials` does. Every theme gets a coherent arch and no
 *     board changes at all.
 *  4. **THE LANDMARKS ARE THE REAL LIBRARY PROPS**, `makePropFromDef` off
 *     `PROP_LIBRARY`, so the menu plants the same treehouse the garden does
 *     rather than a lookalike that drifts out of step with it — the standing
 *     reason `DIORAMA_SIGNATURE_IDS` exists. Arcade Night's list is EMPTY, as
 *     everywhere else: its void is what somebody paid 50 coins for.
 */
const SHOWCASE_LANDMARKS: Readonly<Record<string, readonly string[]>> = {
  // The treehouse first because Nuno named it, and because it is the garden's
  // only singular prop — IDEA-060 built it for one apron corner and this is
  // the second place in the game it can stand at full size.
  garden: ["treehouse", "garden-tree", "garden-shrub", "flower-sunflower", "birdhouse"],
  forest: ["log-cabin", "pine", "nest-tree", "critter-deer", "pine"],
  beach: ["umbrella", "palm", "shrub", "palm"],
  park: ["oak", "streetlight", "shrub", "bloom"],
  city: ["tower", "streetlight", "lamp-post", "transit-sign"],
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

/** Where the wall run and the arch stand, in units behind the subject. */
// Pushed back from -3.6 after the desktop render: at 3.2 units of camera the
// arch's crown landed behind the "Beagle Chomp" title. The menu's own copy is
// part of the composition, not something to be drawn over.
const STAGE_WALL_Z = -4.2;
/** Half-length of the wall run, in tiles either side of the arch. */
const STAGE_WALL_TILES = 5;
/** The arch, as a fraction of its own 2.4-unit default height. */
/**
 * The arch, as a fraction of its own 2.4-unit default height.
 *
 * SIZED FOR THE PORTRAIT FRAME, WHICH IS MUCH NARROWER THAN IT LOOKS. The menu
 * dollies to 5.3 units on a phone and its vertical FOV is 42 degrees, so at
 * aspect 0.462 the HORIZONTAL half-angle is only 10.1 degrees — the visible
 * world at the wall's depth is about 3.2 units across. A first pass at 0.78
 * (1.87 units tall, ~1.4 wide) therefore filled 58% of the frame's width and
 * ran off the top: an arch that dwarfed the dog it was supposed to frame.
 * 0.56 is 1.34 units, which stands a little taller than the beagle and leaves
 * the wall run either side of it visible.
 */
const STAGE_ARCH_HEIGHT = 0.6;

function buildStageDressing(
  themeId: string,
  palette: ThemePalette,
  seed: number,
  camDist: number,
): THREE.Group {
  const g = new THREE.Group();
  g.name = "showcaseStage";

  // --- the wall run ---------------------------------------------------------
  const wallTex = wallTextureFor(palette.wallTexture, palette.wall);
  const wallMat = toon({
    color: wallTex ? 0xffffff : palette.wall,
    map: wallTex,
    emissive: palette.wallEmissive,
    emissiveIntensity: palette.wallEmissiveIntensity,
  });
  const wallGeo = wallGeometry(wallShapeFor(palette.wallTexture), WALL_H);
  for (let i = -STAGE_WALL_TILES; i <= STAGE_WALL_TILES; i++) {
    // The middle two tiles are the tunnel gap the arch stands in. One tile
    // would be the board's real opening; two is what lets the arch's piers sit
    // INSIDE the gap rather than against the wall's end faces, which at this
    // camera is the difference between a doorway and a hedge with a lump.
    if (i === 0 || i === -1) continue;
    const w = new THREE.Mesh(wallGeo, wallMat);
    w.position.set((i + 0.5) * 1, WALL_H / 2, STAGE_WALL_Z);
    // The same quarter-turn variety the maze gets, so a straight run is not
    // eleven copies of one block.
    w.rotation.y = (Math.PI / 2) * Math.floor(hash(i + 40, seed) * 4);
    w.castShadow = true;
    w.receiveShadow = true;
    g.add(w);
  }

  // --- the arch -------------------------------------------------------------
  const wall = new THREE.Color(palette.wall);
  const lift = (k: number): number =>
    new THREE.Color(wall.r, wall.g, wall.b).multiplyScalar(k).getHex();
  const arch = makeArchway(
    {
      height: STAGE_ARCH_HEIGHT,
      // Lifted off `palette.wall` for IDEA-067 rule 3's reason, unchanged: the
      // maze hedge bakes its colour into a TEXTURE that comes out far lighter
      // than the value it was built from, so flat foliage painted in the raw
      // palette colour reads dark beside the wall it stands in.
      foliageColors: [lift(1.34), lift(1.18), lift(1.5)],
      blossomColor: palette.bloomColors.length ? palette.bloomColors[0] : palette.biscuit,
      stoneColor: palette.fenceColor ?? palette.groundDetailColor,
    },
    hash(7, seed),
  );
  // Local +X spans the opening (see `archTransformFor`), so an unrotated arch
  // is one you look THROUGH along Z — which is where the camera is.
  // x = 0: the skipped tiles are centred at -0.5 and +0.5, so the gap they
  // leave is centred on the origin, which is also where the beagle stands.
  arch.position.set(0, 0, STAGE_WALL_Z);
  g.add(arch);

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
  const ids = SHOWCASE_LANDMARKS[themeId] ?? [];
  for (let i = 0; i < ids.length; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    // Landmark 0 is the one the theme is KNOWN by (the garden's treehouse) and
    // it gets the near-axis slot; each later one steps further out.
    // 0.24 rather than dead centre: at 8 units that is x = 1.9, which is just
    // inside a phone's ~2.4-unit half-width AND just outside the centred menu
    // title on desktop. Both framings, one number.
    const off = side * (0.24 + Math.floor(i / 2) * 0.34 + (hash(i * 5, seed) - 0.5) * 0.1);
    const rad = 7.5 + hash(i * 9, seed + 1) * 5.5;
    const prop = makePropFromDef(getPropDef(ids[i]), hash(i * 13, seed + 2));
    const px = Math.sin(off) * rad;
    const pz = -Math.cos(off) * rad;
    prop.position.set(px, 0, pz);
    if (SHOWCASE_FRONTED.has(ids[i])) {
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
  return g;
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
    if (mats) {
      disposeSurroundMaterials(mats);
      mats = null;
    }
  }

  function apply(theme: MazeTheme): void {
    const palette = theme.palette;
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
    band = buildShowcaseBand(palette.surround, mats, seed, stage.bandScale);
    root.add(band);

    // --- the near stage ---------------------------------------------------
    // Only where there is a band: a stage with `bandScale` 0 is the shop's
    // diorama, which brings its OWN walls and props and would be standing in
    // front of a second set of them.
    if (stage.bandScale > 0) {
      dressing = buildStageDressing(theme.id, palette, seed, stage.camDist);
      mergeBySignature(dressing, { castShadow: true });
      root.add(dressing);
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
