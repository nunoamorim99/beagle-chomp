// OWNER: render-artist (IDEA-079)
//
// THE REFERENCE LOOK, AS A MATERIAL SYSTEM.
//
// `matcap.ts` generates one matcap. This file is the part that actually makes
// the style work, and the first attempt proved it by leaving it out: swapping
// every `toon()` for a matcap built from that material's OWN colour produced
// dark plastic, because our colours are dark. Measured across six themed
// islands (`scripts/_scratch-island-colors.ts`), the 45 distinct colours run
// **l 0.16 to 0.39**, with forest greens at 0.02-0.17 and Night City's greys at
// 0.03-0.16. The reference's single loudest rule is the opposite of that:
//
//   > Saturation lives in HUE, not in VALUE. Nothing is dark. The darkest thing
//   > on screen is a #0c0840 shadow at 20% alpha.
//
// Those colours are dark for a good reason that does not apply here: a board
// palette is tuned to sit UNDER a biscuit trail with a beagle on it, where
// contrast against the pickups is the whole job. On an island in an ocean
// nothing needs to be read against, so the constraint is gone and only its
// consequence is left.
//
// ---------------------------------------------------------------------------
// THREE THINGS, AND THE ORDER MATTERS
// ---------------------------------------------------------------------------
//
//  1. **A FIXED PALETTE THAT SNAPS.** Their highest-leverage pipeline idea is
//     that a mesh is assigned a matcap by NAME, from a library of 35 — so "an
//     artist physically cannot introduce an off-palette colour". Our meshes are
//     built in code and already carry a colour, so the equivalent is to SNAP
//     that colour to the nearest library entry. Same guarantee, no convention
//     to keep, and it reaches props authored years before this file. The snap
//     is dominated by HUE and only lightly by lightness, which is what lifts a
//     0.02 forest green into a real green instead of collapsing it to a grey.
//
//  2. **ONE SHARED BOUNCE.** Their cohesion trick, and it costs nothing: every
//     object in an area shares the bounce colour filling the matcap's outer
//     ring, so the whole scene reads as lit by one environment with zero lights
//     in it. Theirs is a warm sand, because their islands are sand. **Ours is
//     the SEA**, because the dominant thing around every one of these islands
//     is bright cyan water — and it ties the props to the new ocean for free.
//
//  3. **THE DECK IS BAKED, NOT MATCAPPED.** Their section 5 is explicit: "a
//     matcap on a large flat surface reveals itself immediately", so their
//     landmasses use baked 1024px textures on an unlit `MeshBasicMaterial`
//     instead. They are right, and it is not a small effect — an island deck is
//     the single biggest surface on this screen, and a matcap paints the whole
//     disc one flat value because every one of its normals points the same way.
//     We cannot bake in Blender and would not want to fetch the result, so the
//     bake is DRAWN, on the same canvas machinery every surface in this game
//     already uses.
//
// What we keep from our own stack: the renderer stays `NoToneMapping` + sRGB,
// which their section 4 independently arrives at and calls the one-line fix for
// "why do my bright colours look muddy". We already had it.

import * as THREE from "three";
import { makeMatcapTexture, MATCAP_OPTIONS, type MatcapOptions } from "./matcap.js";
import { MADBOX_STYLE_ON } from "./madboxFlag.js";
import { css, mix as mixRgb, rgbOf, rng, type RGB } from "./paint.js";

export interface PaletteEntry {
  /** `<base>On<bounce>` in spirit — the bounce half is a parameter here, so
   *  only the base is named. */
  id: string;
  hex: number;
}

/**
 * THE LIBRARY. Nineteen entries against their thirty-five, covering the hues
 * our islands actually use — the inventory script is the reason it is these
 * and not a guess.
 *
 * Every one is HIGH-KEY by construction: the lightest is 0.97 and the darkest
 * deliberate accent is 0.48. There is nothing below that on purpose. Their
 * palette note allows dark only as "deliberate contrast accents", and `slate`
 * is the one.
 */
export const MADBOX_PALETTE: readonly PaletteEntry[] = [
  { id: "white", hex: 0xfbfbf7 },
  { id: "cream", hex: 0xf7efdc },
  { id: "sand", hex: 0xf2d9a0 },
  { id: "gold", hex: 0xffd14d },
  { id: "wood", hex: 0xd89b62 },
  { id: "bark", hex: 0xb07d52 },
  { id: "coral", hex: 0xf97a6a },
  { id: "pink", hex: 0xf58fc0 },
  { id: "lime", hex: 0xbfe05a },
  { id: "grass", hex: 0x7fd463 },
  { id: "leaf", hex: 0x4fc07a },
  { id: "pine", hex: 0x3faa80 },
  { id: "teal", hex: 0x5fd6cf },
  { id: "sky", hex: 0x6fc8f5 },
  { id: "blue", hex: 0x4e9be8 },
  { id: "indigo", hex: 0x8e93e8 },
  { id: "violet", hex: 0xb98ce0 },
  { id: "stone", hex: 0xc2c5d0 },
  { id: "slate", hex: 0x767c90 },
];

/**
 * THE INK SET — the exception to "nothing is dark", and it is a DECLARED role
 * rather than a measured one.
 *
 * Nuno's call, and the right one: the beagle's black saddle is not a dark
 * surface that the style should lift, it is a MARKING, and a tricolor beagle
 * without it is a different dog. The same goes for a pupil, a nose, and the
 * dark accents eight img2threejs runs spent making the enemy cast readable.
 *
 * **COLOUR CANNOT DECIDE THIS, AND THAT IS WHY THERE IS A TAG.** Measured:
 * Cookie's saddle is #3a2416 (l 0.157, s 0.450) and Deep Forest's foliage is
 * #1b3f21 (l 0.176, s 0.400) — a marking that must stay dark and a surface
 * that must lift, two hundredths apart in BOTH dimensions. Every threshold I
 * could pick is a coin flip between them, and a coin flip that silently
 * repaints a character is worse than no rule. So a material declares itself
 * with `userData.madboxRole = "ink"` and nothing is inferred. This is the
 * reference's own answer in our idiom: they assign by mesh NAME because
 * nothing about a colour says what it is for.
 *
 * These entries are NOT reachable from an ordinary snap — they are excluded
 * from the surface palette entirely, so "the palette is high-key" stays
 * literally true and ink can only arrive on purpose.
 *
 * Three, not one, because ink has a temperature: a warm saddle, a cool one and
 * a true near-black. A matcap built from these is not a flat black blob — it
 * keeps the specular dot and the bounce rim, which is exactly the glossy dark
 * plastic the reference's own sheet ends on.
 */
export const MADBOX_INK: readonly PaletteEntry[] = [
  { id: "ink", hex: 0x2b2724 },
  { id: "inkWarm", hex: 0x4a3222 },
  { id: "inkCool", hex: 0x272b33 },
];

/**
 * The default bounce: a light sea-cyan.
 *
 * Right for the JOURNEY MAP, where every island genuinely is surrounded by
 * ocean and one shared bounce is what makes the whole chain read as one place.
 * Wrong for a BOARD — see `boardBounce`.
 */
export const MADBOX_BOUNCE = 0x7fd0f2;

/**
 * The bounce for a BOARD, derived from the theme it is standing in.
 *
 * Nuno, playing the garden: *"the shadows look too blue, like all the
 * components have a blue glowing or shadow."* He is describing the bounce
 * exactly. It fills the area OUTSIDE the matcap's normal disk, so it becomes
 * the RIM at every grazing angle and the fill on every turned-away face — a
 * saturated cyan there puts a cold edge on every object on screen. On an
 * ocean that is the environment; on a lawn it is a light source that is not
 * there.
 *
 * So it comes from what is ACTUALLY around the object: the theme's sky and
 * its ground, weighted toward the ground because that is what a prop sits on
 * and what most of the hemisphere below it is made of. That is the reference's
 * own rule — one shared bounce per AREA, picked to be the colour of that area
 * — rather than one global colour for a game with six of them.
 *
 * Desaturated on the way, because a bounce is ambient light rather than a
 * paint: it should tint an edge, not colour it.
 */
export function boardBounce(palette: object): number {
  const p = palette as { bg?: number; surroundGround?: number };
  const sky = p.bg ?? 0xffffff;
  const ground = p.surroundGround ?? 0xffffff;
  const mixed = new THREE.Color(sky).lerp(new THREE.Color(ground), 0.6);
  const hsl = { h: 0, s: 0, l: 0 };
  mixed.getHSL(hsl);
  // Held light and only lightly coloured. The previous global cyan measured
  // s 0.79; anything near that reads as a coloured light rather than as the
  // room the object is in.
  return mixed.setHSL(hsl.h, Math.min(hsl.s, 0.3), Math.max(hsl.l, 0.72)).getHex();
}

// --- colour maths, in sRGB ---------------------------------------------------
//
// Deliberately NOT `THREE.Color.getHSL`. Under colour management that returns
// HSL of the LINEAR triple, and the first version of the inventory script read
// #3f8f3a as lightness 0.16 when its perceptual lightness is 0.39 — which would
// have had this file "correcting" a darkness that was mostly a unit error.

interface Hsl {
  h: number;
  s: number;
  l: number;
}

function hexToHsl(hex: number): Hsl {
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return { h: 0, s: 0, l };
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h: number;
  if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (mx === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h, s, l };
}

function hueDist(a: number, b: number): number {
  const d = Math.abs(a - b);
  return d > 0.5 ? 1 - d : d;
}

const NEUTRAL_IDS = new Set(["white", "stone", "slate", "cream"]);

/**
 * Below this saturation a colour is treated as a neutral and matched against
 * the greys alone.
 *
 * 0.18, and the first value was 0.12, which is a real defect rather than a
 * preference: Night City's deck measures **s 0.13**, a hair over the line, so
 * it took a hue and the whole island rendered VIOLET while its own skirt at
 * s 0.08 correctly stayed slate. One object, two halves of the palette. Every
 * desaturated colour in this game sits in that band, because a grey with a
 * faint warm or cool lean is how all of them are authored.
 */
export const NEUTRAL_MAX_S = 0.18;

/**
 * Roles that name their own palette entry, which is the reference's
 * mesh-name-driven assignment surfacing where we happen to have a name.
 *
 * A beach is SAND. Snapping it by colour is how the garden's came out LIME —
 * its source tone is a blend of the deck's green and a warm sand, so it
 * measures as a yellow-green and matches one honestly. Colour cannot know the
 * thing is a beach; the name can.
 */
const ROLE_ENTRY: Record<string, string> = { "island-beach": "sand" };

/**
 * Snap a colour to the palette.
 *
 * HUE DOMINATES, and that is the whole point rather than a tuning choice: a
 * lightness-led match sends every dark green and every dark grey to the same
 * bottom entry, which is exactly how a "unified palette" turns into mud. At
 * these weights Deep Forest's 0x1b3f21 (l 0.18) lands on `pine` rather than on
 * `slate`, and Night City's 0x33333c lands on `slate` rather than on a colour.
 *
 * A near-grey has no meaningful hue, so it is matched against the neutrals
 * alone — otherwise float noise in the red and blue channels decides whether a
 * paving stone comes out pink or blue.
 */
export function snapToPalette(hex: number, role?: string): PaletteEntry {
  // The ink role short-circuits everything: a marking is matched only against
  // the ink set, by hue and lightness, so a warm saddle stays warm and a cool
  // one stays cool without either being lifted.
  if (role === "ink") {
    const t = hexToHsl(hex);
    let best = MADBOX_INK[0];
    let bestD = Infinity;
    for (const e of MADBOX_INK) {
      const c = hexToHsl(e.hex);
      const d = 1.4 * hueDist(t.h, c.h) * (t.s < 0.12 ? 0 : 1) + Math.abs(t.l - c.l);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }
  const forced = role ? ROLE_ENTRY[role] : undefined;
  if (forced) {
    const e = MADBOX_PALETTE.find((x) => x.id === forced);
    if (e) return e;
  }

  const t = hexToHsl(hex);
  const neutral = t.s < NEUTRAL_MAX_S;
  let best = MADBOX_PALETTE[0];
  let bestD = Infinity;
  for (const e of MADBOX_PALETTE) {
    if (neutral !== NEUTRAL_IDS.has(e.id)) continue;
    const c = hexToHsl(e.hex);
    // THE LAST TERM IS THE STYLE, AND THE FIRST VERSION HAD IT BACKWARDS.
    //
    // Matching the target's own LIGHTNESS is the obvious thing and it defeats
    // the entire exercise: our colours are dark, so every match is pulled to
    // whichever palette entry is darkest near that hue. Measured, the beach's
    // sand (l 0.61) lost to `wood` by exactly that term and the island came
    // back brown. Lightness distance is nearly weightless now; instead there
    // is a standing REWARD for the higher-key candidate, so a tie between two
    // entries of one hue always resolves upward. That is the reference's rule
    // — saturation lives in hue, not in value — written as arithmetic.
    const d = neutral
      ? Math.abs(t.l - c.l)
      : 3.0 * hueDist(t.h, c.h) +
        0.3 * Math.abs(t.s - c.s) +
        0.1 * Math.abs(t.l - c.l) +
        0.22 * (1 - c.l);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

/**
 * A BAKED-LOOKING DECK, drawn rather than baked.
 *
 * Three things, and the third is the one that earns its place:
 *
 *  * a broad soft lift toward the centre, which is what a baked sky dome gives
 *    a flat disc and what a matcap cannot;
 *  * low-frequency mottling, so a 200-pixel disc is not one flat value;
 *  * **a hard ambient-occlusion ring at the rim.** This is the same idea as the
 *    shore ribbon's `pow(vUv.y, 7)` contact shadow, on the other side of the
 *    waterline, and it is what stops the deck reading as a sticker laid on the
 *    island. Baked lighting's whole advantage over a matcap is that it knows
 *    where the edges of the object are; throwing that away would leave no
 *    reason to bake at all.
 *
 * The UVs work out for free: `CylinderGeometry`'s top cap maps the disc into
 * the unit square centred on (0.5, 0.5), so a radial gradient in canvas space
 * is a radial gradient on the deck.
 */
export function bakedDeckTexture(hex: number, size = 256): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const cv = document.createElement("canvas");
  cv.width = size;
  cv.height = size;
  const g = cv.getContext("2d");
  if (!g) return null;

  // PAINTED THROUGH `paint.ts`, NOT THROUGH `THREE.Color`, AND THAT IS NOT A
  // STYLE PREFERENCE. `new THREE.Color(hex)` converts sRGB to the LINEAR
  // working space, so reading `.r/.g/.b` back and writing them as canvas bytes
  // paints the linear triple as though it were sRGB — [[IDEA-072]]'s ~40%
  // darkening, which the header of this very file warns about. It shipped here
  // anyway for one render: `slate` (#767c90) came out (46, 51, 71) and Night
  // City's deck was a near-black hole. paint.ts works in sRGB bytes end to end,
  // which is why every other generated surface in this game uses it.
  const base = rgbOf(hex);
  const lighter = mixRgb(base, [1, 1, 1], 0.2);
  const darker = mixRgb(base, [0, 0, 0], 0.18);
  const rgba = (c: RGB, a: number): string =>
    a >= 1 ? css(c) : `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;

  g.fillStyle = css(base);
  g.fillRect(0, 0, size, size);

  // Centre lift — what a baked sky dome gives a flat disc and what a matcap
  // cannot, since every normal on this cap points the same way.
  const lift = g.createRadialGradient(size * 0.42, size * 0.38, 0, size * 0.5, size * 0.5, size * 0.55);
  lift.addColorStop(0, rgba(lighter, 1));
  lift.addColorStop(1, rgba(lighter, 0));
  g.fillStyle = lift;
  g.fillRect(0, 0, size, size);

  // Mottling, on paint.ts's own seeded generator rather than Math.random: two
  // islands of one theme must not differ, and a cache keyed on the colour would
  // hand out whichever was drawn first regardless.
  const rnd = rng(hex ^ 0x9e37);
  for (let i = 0; i < 26; i++) {
    const r = size * (0.06 + rnd() * 0.12);
    g.fillStyle = rgba(rnd() > 0.5 ? lighter : darker, 0.16);
    g.beginPath();
    g.ellipse(rnd() * size, rnd() * size, r, r * (0.6 + rnd() * 0.5), rnd() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }

  // STARTS AT 0.44 OF THE RADIUS, NOT 0.34. The disc fills 0..0.5 of the UV
  // square, so a ring beginning at 0.34 darkens the outer third of the RADIUS
  // — which is over half the AREA, and it dragged every deck a full value step
  // below its own palette entry. A contact shadow is a hug, not a vignette.
  const ao = g.createRadialGradient(size / 2, size / 2, size * 0.44, size / 2, size / 2, size * 0.5);
  ao.addColorStop(0, rgba(darker, 0));
  ao.addColorStop(0.7, rgba(darker, 0.18));
  ao.addColorStop(1, rgba(darker, 0.55));
  g.fillStyle = ao;
  g.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * THE NEUTRAL MATCAP — a WHITE base, so `material.color` still tints it.
 *
 * three.js's matcap shader ends with `outgoingLight = diffuseColor.rgb *
 * matcapColor.rgb`, so a white-based matcap multiplied by the material's own
 * colour gives that colour with the matcap's shading on it. That is what makes
 * a RUNTIME-RECOLOURED object styleable at all: every existing
 * `material.color.setHex()` keeps meaning what it meant.
 *
 * The alternative — baking the snapped colour into the texture and holding the
 * material white — is better for static surfaces (it is what gives the palette
 * its grip) and is exactly wrong here, because a later recolour would then
 * MULTIPLY the baked colour rather than replace it.
 */
const NEUTRAL_BASE = 0xffffff;

export interface MadboxCaches {
  matcap: Map<string, THREE.MeshMatcapMaterial>;
  deck: Map<number, THREE.MeshBasicMaterial>;
  /**
   * The neutral tint TEXTURE, one per bounce.
   *
   * The texture is the expensive half of a tint and the ONLY half that is safe
   * to share, because it is generated from `NEUTRAL_BASE` and carries no
   * colour of its own. Keyed by bounce alone, so a board's worth of tinted
   * characters costs exactly one 64px canvas.
   */
  tintTex: Map<number, THREE.Texture>;
  /**
   * One matcap material per SOURCE MATERIAL — the half that must NEVER be
   * shared. See the tint branch in `applyMadboxStyle` for what sharing cost.
   *
   * A WeakMap rather than a Map because these are per-INSTANCE now: a level
   * builds five enemies and throws them away, so a strong map would hold every
   * material of every level a session ever played. Keyed by the source
   * material, the entry leaves when the level does.
   */
  tint: WeakMap<THREE.Material, THREE.MeshMatcapMaterial>;
}

/**
 * The caches the BOARD's own styling shares.
 *
 * Module-level and never disposed, exactly as `wallTextureFor`'s cache is and
 * for the same reason: it is a handful of 64px textures keyed by palette
 * entry, the entries are global, and every board in the session wants the same
 * ones. The journey map keeps its OWN caches because it disposes them with its
 * scene — sharing would free textures the board still holds.
 */
let sharedBoard: MadboxCaches | null = null;

/**
 * Style something that arrives AFTER the level was built — a power-up, a
 * fruit, a coin.
 *
 * These are spawned mid-run by `board.ts`, long after `buildLevel` ran its
 * scene-wide pass, so nothing else was ever going to reach them. Putting the
 * call inside the spawners rather than at their call sites is deliberate: a
 * pickup added later is styled by existing, instead of by somebody remembering
 * this file.
 *
 * Self-gating on the flag AND on the theme, because board.ts should not have
 * to know either rule.
 *
 * **TINT MODE, NEVER THE PALETTE SNAP — a pickup's colour IS its identity.**
 *
 * The snap is right for scenery, where the point is that nothing can be
 * off-palette. It is wrong here, and the audit is blunt about how wrong: the
 * carrot's orange (#e8721f) snapped to `wood`, a TAN, and the mango's gold to
 * `sand`, while two of the mango's own tones collapsed onto a single `lime`.
 * [[IDEA-045]] exists because these five are worth 100 to 500 points and have
 * to read as five different things at a handful of pixels — its own recorded
 * failure is a near-round gold mango that read as an orange apple, i.e. the
 * 100 and the 500 looking alike. Repainting them through a nineteen-entry
 * palette walks straight back into that.
 *
 * Same judgement as the enemy cast and the beagle's coat: where the colour
 * carries meaning, keep it and shade it; only scenery gets snapped.
 */
export function styleSpawned(obj: THREE.Object3D, palette: object): void {
  if (!MADBOX_STYLE_ON || !shouldStyleBoard(palette)) return;
  sharedBoard ??= makeMadboxCaches();
  applyMadboxStyle(obj, boardBounce(palette), sharedBoard, undefined, { tint: true });
}

export function makeMadboxCaches(): MadboxCaches {
  return { matcap: new Map(), deck: new Map(), tintTex: new Map(), tint: new WeakMap() };
}

function matcapFor(
  hex: number,
  bounce: number,
  caches: MadboxCaches,
  opts: MatcapOptions,
  role?: string,
): THREE.MeshMatcapMaterial | null {
  const entry = snapToPalette(hex, role);
  const key = `${entry.id}|${bounce}`;
  let m = caches.matcap.get(key);
  if (!m) {
    const tex = makeMatcapTexture(entry.hex, bounce, opts);
    if (!tex) return null;
    m = new THREE.MeshMatcapMaterial({ matcap: tex });
    m.name = `matcap-${entry.id}`;
    caches.matcap.set(key, m);
  }
  return m;
}

function deckFor(hex: number, caches: MadboxCaches): THREE.MeshBasicMaterial | null {
  const snapped = snapToPalette(hex).hex;
  let m = caches.deck.get(snapped);
  if (!m) {
    const tex = bakedDeckTexture(snapped);
    if (!tex) return null;
    // Unlit, and the texture carries the colour — so the material is held at
    // white. Tinting it as well is this project's oldest surface bug
    // (`board.ts`'s floor rule) and it darkens by exactly the colour squared.
    m = new THREE.MeshBasicMaterial({ map: tex });
    m.name = "madbox-deck";
    caches.deck.set(snapped, m);
  }
  return m;
}

/**
 * Restyle a whole island.
 *
 * The deck is picked out by NAME rather than by guessing from the geometry,
 * because `island-body` is one mesh carrying `[skirt, top, skirt]` — the cap is
 * material index 1 and nothing about the mesh says so at runtime.
 *
 * **RETURNS THE MATERIAL SWAPS IT MADE**, and a caller holding material
 * REFERENCES must use them: replacing `mesh.material` does not update anything
 * pointing at the old object. `makeBeagle` keeps its eight coat materials in
 * `userData.coatMats` and `applyBeagleSkin` writes through them, so without a
 * remap equipping a coat silently stops changing the dog — writing a colour to
 * an orphaned material is not an error. Returned rather than handed to a
 * callback so `src/game/game.ts` can pass it straight on without naming a
 * `three` type, which that directory is not allowed to import.
 *
 * Skipped, both deliberately: anything already carrying a `map` (the arcade
 * island's neon deck is that theme's entire identity and a matcap would relight
 * it into a flat disc) and anything already unlit (its rim light, which is
 * unlit precisely so the toon ramp cannot band it).
 */
/** A material the restyle may have replaced — it swaps toon for matcap. */
export type StyleableMat = THREE.MeshToonMaterial | THREE.MeshMatcapMaterial;

/**
 * Set a material's emissive lift, where it HAS one.
 *
 * A matcap has no emissive channel — the shading IS the texture — so every
 * showcase that repaints a themed surface has to go through this. TypeScript
 * points at each call site the moment a material type widens, which is how the
 * menu's were found; the enemy cast has the same collision and hides it at
 * RUNTIME, because there the materials are reached through a loosely-typed
 * `userData` bag that lets `.emissive.setHex()` past the compiler.
 *
 * Losing the lift is accepted and bounded: these palettes add a flat emissive
 * on top of a colour, and a matcap is already high-key, so what goes is a few
 * percent of brightness on a surface that gained far more from the style.
 */
export function setEmissiveIfPresent(
  mat: StyleableMat,
  hex: number,
  intensity: number,
): void {
  if (!("emissive" in mat)) return;
  mat.emissive.setHex(hex);
  mat.emissiveIntensity = intensity;
}

export interface MadboxStyleHooks {
  /**
   * Keep each material's OWN colour as a tint over a neutral matcap instead of
   * baking a snapped colour in.
   *
   * Required for anything recoloured at runtime — the beagle's coat, a
   * showcase's themed patch. Without it those `setHex` calls land on a
   * material held at white and do nothing visible, or double-tint a baked one.
   */
  tint?: boolean;
}

export function applyMadboxStyle(
  root: THREE.Object3D,
  bounce: number = MADBOX_BOUNCE,
  caches: MadboxCaches = makeMadboxCaches(),
  opts: MatcapOptions = MATCAP_OPTIONS,
  hooks: MadboxStyleHooks = {},
): ReadonlyMap<THREE.Material, THREE.Material> {
  const swaps = new Map<THREE.Material, THREE.Material>();
  walk(root);
  return swaps;

  function walk(o: THREE.Object3D, tintHere = false): void {
    // AN ENEMY IS SKIPPED WHOLE — A DECISION, NOT A GAP.
    //
    // It began as a safety measure and the measurements turned it into the
    // right answer. Three things, in the order they were found:
    //
    // `applyGhostState` and `applyEnemyLook` drive `bodyMat`/`accentMats`
    // colours at RUNTIME — five team hues, the frightened blue, the eaten
    // white pupils. In a matcap the colour lives in a texture, so every one of
    // those `color.setHex()` calls would silently do nothing: the enemies
    // would stop turning blue when you eat a bone. That is not a restyle
    // regression, it is the player losing the signal that tells them when they
    // can chase.
    //
    // Second, a matcap HAS NO EMISSIVE CHANNEL, and the cast uses one for
    // real: every body carries `emissive: <team colour>` at 0.14-0.15 and the
    // eyes `0xffffff` at 0.45, which is what makes them pop at 25 px. Porting
    // would mean rebuilding that as an unlit layer AND guarding six emissive
    // writes in `applyGhostState`.
    //
    // Third, and the one that settles it: **THE TEAM HUES ARE ALREADY IN THE
    // STYLE.** Measured, rose/teal/amber/violet/leaf run l 0.506-0.629 at
    // s 0.44-0.79, and the frightened blue l 0.465 s 0.688 — sitting inside
    // this palette's own band (mean 0.673, entries 0.46-0.98). "Saturation
    // lives in hue, not in value" already describes them. There is no colour
    // correction to apply, so all a conversion would buy is a change of
    // SHADING MODEL, at the cost of the emissive and the risk of the state
    // machine. The reference mixes models for exactly this kind of reason —
    // matcaps for props, unlit bakes for landmasses.
    //
    // Detected from `GhostUserData.bodyMat` on the group rather than by
    // stamping eleven skins: the field already means "this character's colour
    // is driven from outside", which is exactly the question being asked.
    // ENEMIES ARE STYLED IN TINT MODE WHEREVER THEY ARE FOUND, never baked.
    //
    // Their colours are driven at RUNTIME — five team hues, the frightened
    // blue, the eaten white pupils — so the colour has to stay ON the material
    // for `color.setHex()` to keep meaning something. A baked matcap would
    // hold it at white and those calls would do nothing at all: the enemies
    // would stop turning blue when you eat a bone, which is the player losing
    // the signal that says when they can chase.
    //
    // The caller must also run `remapEnemyMaterials` over the group, because
    // the state machine reaches these through `userData` references that a
    // material swap leaves pointing at nothing drawn.
    const isEnemy = !!(o.userData as { bodyMat?: unknown }).bodyMat;

    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      const isDeckMesh = mesh.name === "island-body";
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const next = mats.map((m, i) => {
        const lit = m as THREE.Material & {
          color?: THREE.Color;
          map?: THREE.Texture | null;
          vertexColors?: boolean;
        };
        if (!lit.color) return m;
        // ALREADY STYLED. **THIS FUNCTION MUST BE IDEMPOTENT** and the first
        // version was not, which cost a whole debugging pass.
        //
        // `MeshMatcapMaterial.color` is WHITE by convention — the colour lives
        // in the texture — so a second pass reads 0xffffff, snaps it to the
        // `white` entry and replaces a correct matcap with a white one. It is
        // not hypothetical: `buildLevel` runs the swap on the whole scene every
        // level, and the SURROUND is cached and borrowed across levels
        // ([[IDEA-066]]), so it was styled once correctly and then whitened on
        // the very next pass. Every distant house, rock, hedgerow and flower
        // border came back pure white while the apron props beside them — which
        // ARE rebuilt per level, so they were only ever styled once — looked
        // perfect. That asymmetry is what made it look like a distance or fog
        // problem rather than a double application.
        if (m.type === "MeshMatcapMaterial") return m;
        // SKIPPED, and each for the same underlying reason: the colour is not
        // in `material.color`, so a matcap generated from it would be a matcap
        // of the wrong colour.
        //
        //  * a MAP bakes the colour in and the material is held white (the
        //    board's own floor rule) — and for the arcade deck the map IS the
        //    theme;
        //  * `vertexColors` puts the colour in the ATTRIBUTE and likewise holds
        //    the material white. This one shipped for one render and the whole
        //    surround came back WHITE — every fence rail, distant house, rock
        //    and flower border, because `mergeBySignature` welds the band into
        //    vertex-coloured buckets and all of them read 0xffffff. Same family
        //    as [[IDEA-067]]'s merge dropping the colour attribute, which
        //    rendered BLACK; the colour simply is not where the reader looks.
        //  * unlit is unlit on purpose (a rim light, a catchlight).
        if (m.type === "MeshBasicMaterial" || lit.map || lit.vertexColors) return m;
        const hex = lit.color.getHex();

        if (hooks.tint || tintHere) {
          // ONE SHARED TEXTURE, AND A MATERIAL PER SOURCE MATERIAL. The
          // second half is the whole point of tint mode — each keeps its own
          // `color` for a later recolour to write to — and the first version
          // keyed the cache on that COLOUR, which quietly made it the
          // opposite: every part authored in one hue, across every character
          // in the game, shared ONE material object.
          //
          // Measured, three ghosts in a run shared 132 materials, and the
          // flea's warm-brown creases rendered #000000 in a run against
          // #4a2510 in the shop — because something else holding the same
          // object had recoloured it. Everything tinted is recoloured in
          // place by design (`applyGhostState` drives the team hues and the
          // frightened blue, `applyBeagleSkin` the coat, `applyEnemyLook`'s
          // restore path writes every `spiritMats` entry), so a shared tint
          // material is one character painting another.
          //
          // The key is therefore the SOURCE MATERIAL's identity. Characters
          // already build their own materials per instance, so this restores
          // the 1:1 mapping they had before the style and costs no draw call:
          // the matcap TEXTURE is still shared, and a material's colour is a
          // uniform rather than a shader feature.
          let tm = caches.tint.get(m);
          if (!tm) {
            let tex = caches.tintTex.get(bounce);
            if (!tex) {
              const made = makeMatcapTexture(NEUTRAL_BASE, bounce, opts);
              if (!made) return m;
              tex = made;
              caches.tintTex.set(bounce, tex);
            }
            tm = new THREE.MeshMatcapMaterial({ matcap: tex, color: hex });
            tm.name = `matcap-tint-${lit.color.getHexString()}`;
            // THE SOURCE'S userData COMES WITH IT, AND THAT IS NOT A DETAIL.
            //
            // The character layer stamps state ON THE MATERIAL: every enemy
            // accent carries `userData.baseColor` and every spirit material a
            // `userData.spiritBase`, and `applyEnemyLook` reads them back to
            // repaint an enemy for its NORMAL and post-eaten looks. A fresh
            // matcap has an empty bag, so `m.color.setHex(m.userData.baseColor)`
            // became `setHex(undefined)` — which is not a no-op, it is BLACK.
            //
            // Measured on the flea: 52 of its 74 materials rendered #000000 in
            // a run against #4a2510 in the shop, because the shop's hero is
            // static and never calls `applyGhostState`. That asymmetry is the
            // whole reason it looked like a shop-versus-game problem.
            //
            // Copied wholesale rather than by naming the two keys, so anything
            // the character layer stamps in future survives by default. Safe
            // ONLY because a tint material is 1:1 with its source — the bake
            // branch shares one material per palette entry, so the same copy
            // there would let the last caller win.
            Object.assign(tm.userData, lit.userData);
            caches.tint.set(m, tm);
          }
          swaps.set(m, tm);
          return tm;
        }

        if (isDeckMesh && i === 1) return deckFor(hex, caches) ?? m;
        // A MATERIAL'S OWN DECLARED ROLE BEATS ITS MESH'S NAME. The mesh name
        // is a fallback for things we happen to have named (a beach); the tag
        // is how a character says "this is a marking" from the file that built
        // it.
        const declared = (m.userData as { madboxRole?: string } | undefined)?.madboxRole;
        const swapped = matcapFor(hex, bounce, caches, opts, declared ?? mesh.name);
        if (swapped) swaps.set(m, swapped);
        return swapped ?? m;
      });
      mesh.material = Array.isArray(mesh.material) ? next : next[0];
    }

    // Hand-walked rather than `traverse`, because `traverse` has no way to skip
    // a SUBTREE and the enemy rule above needs exactly that.
    for (const child of o.children) walk(child, tintHere || isEnemy);
  }
}

// ---------------------------------------------------------------------------
// THE SURFACE LIFT
// ---------------------------------------------------------------------------

/**
 * Lift a theme palette's SURFACE colours into the high-key range.
 *
 * This is the half of the style that a material swap cannot reach. The maze
 * wall and the floor are TEXTURED — `wallTexture.ts` and `floorTexture.ts` bake
 * a palette colour in as their ground — so `applyMadboxStyle` skips them by
 * contract and the board comes back byte-identical. Measured on the garden:
 * a straight restyle changed the props and left the maze, which is most of the
 * screen, exactly as it was.
 *
 * So the lift happens one step earlier, on the VALUES the textures are
 * generated from. Same code path, different numbers, which is also the only
 * honest way to A/B it.
 *
 * **THE CONSTRAINT THE ISLAND MAP NEVER HAD IS PELLET CONTRAST.** Those
 * palettes are dark *because* biscuits have to read against them at 17 px a
 * tile. So the lift is bounded, not maximal: it raises lightness toward a
 * target and stops, and the floor is held further back than the walls, because
 * the floor is the thing the pellets are seen against and the walls are not.
 *
 * Arcade Night is excluded outright. Its black is not a dark surface to be
 * corrected, it is the theme — neon on black is the entire idea, and it is
 * exactly the "deliberate contrast accent" the reference's own palette rule
 * carves out.
 */
export const SURFACE_LIFT = {
  /** Floors stop here. Lower than the walls: the biscuits are read against
   *  THIS surface and nothing else. */
  floorL: 0.46,
  sandFloorL: 0.66,
  sandWallL: 0.74,
  /** Walls can go further — nothing is read against them, and the hedge is
   *  what carries the theme's colour at a glance. */
  wallL: 0.56,
  /** Everything outside the board. Furthest, because it is behind the play
   *  area and its job is atmosphere rather than legibility. */
  outsideL: 0.6,
  /**
   * Saturation floor, applied ONLY to surfaces that already read as a colour.
   *
   * Raising lightness in HSL washes a colour out, so a surface that gains
   * brightness has to gain some saturation with it — the reference's rule is
   * that saturation lives in hue, not value.
   *
   * **BUT A NEAR-GREY HAS NO HUE TO AMPLIFY, only noise, so forcing this on
   * one INVENTS a colour nobody chose.** The first version gated on s > 0.06
   * and Night City's floor (#3a3640, s 0.08) came out **#6d4d9d — a vivid
   * purple**, with its surround to match: a grey concrete theme with lilac
   * roads. Caught by auditing all six palettes rather than by looking at the
   * garden again, which is the only theme the gate happened to be safe on.
   *
   * The gate is `NEUTRAL_MAX_S`, deliberately the same line the palette SNAP
   * uses to decide whether a colour has a hue worth matching. It is the same
   * question, so it should not have two answers.
   */
  minS: 0.34,
} as const;

/**
 * A theme is exempt when its SKY is dark.
 *
 * DERIVED, not a list of ids, and that is the point: a theme whose backdrop is
 * night is telling you what it is, and brightening its ground contradicts it.
 * Arcade Night falls out of this rule rather than being named by it, and a
 * future night theme is covered by existing.
 *
 * Found by rendering all six rather than by reasoning: Night City passed every
 * numeric check — its greys stayed grey once the saturation gate was fixed —
 * and still came back WRONG, because a lifted ground under a night sky simply
 * is not night any more. Classic reads as a dark street with lit windows; the
 * lifted one reads as an overcast afternoon. That is the reference's own
 * "deliberate contrast accent" carve-out, and it is exactly why the palette
 * rule is "nothing is dark" rather than "nothing is ever dark".
 *
 * 0.4 separates cleanly and is not near anything: the daylight skies measure
 * 0.60 to 0.80 and the two night ones 0.25 and 0.04.
 */
const NIGHT_SKY_MAX_L = 0.4;

/**
 * Whether a BOARD in this theme should be restyled at all.
 *
 * A night theme is exempt from the WHOLE style, not just the surface lift, and
 * the render is what settled it. Exempting only the lift brought Night City's
 * maze back to its dark purple — and left its surround bright, because the
 * matcap SNAP had pushed every distant building to a high-key palette entry.
 * Cream tower blocks under a night sky are the same contradiction the lift
 * made, arriving by the other half of the system.
 *
 * Scoped to the BOARD on purpose. The journey map applies the style to all six
 * themes' islands and should keep doing so: an island is a small object seen
 * among five others, where Arcade Night's neon deck reads as a deliberate dark
 * accent beside them. A BOARD fills the screen and sets the mood on its own.
 */
export function shouldStyleBoard(palette: object): boolean {
  return !isNightTheme(palette);
}

function isNightTheme(palette: object): boolean {
  const bg = (palette as { bg?: number }).bg;
  return typeof bg === "number" && hexToHsl(bg).l < NIGHT_SKY_MAX_L;
}

/**
 * Lift ONE surface colour toward the high-key range.
 *
 * Exported because a surface colour is not always in a palette slot. The
 * tunnel arch's fence timber is a PROP PARAM (`props.ts`), authored per arch
 * — and the Hedge Arch's was deliberately set to `palette.fenceColor`'s own
 * shipped value, so that the arch's footing and the maze wall's fence read as
 * ONE fence where they meet ([[IDEA-067]] rule 3). Lifting the palette and not
 * the param broke exactly that: measured, the maze fence went to #c28f5c while
 * the arch's footing stayed #a9743f, and the two are visibly different browns
 * at the one place the whole footing exists to tie together.
 *
 * Applied to the BUILT material, never written back into `props.ts` — the same
 * rule the Board tab's own lift follows, for the same reason: lift authored
 * data in place and the next save commits it.
 */
export function liftSurfaceColor(hex: number, targetL: number = SURFACE_LIFT.wallL): number {
  return liftSurface(hex, targetL);
}

function liftSurface(hex: number, targetL: number): number {
  const c = hexToHsl(hex);
  // Never DARKEN. A palette slot already above target is one somebody chose.
  const l = Math.max(c.l, targetL);
  const s = c.s < NEUTRAL_MAX_S ? c.s : Math.max(c.s, SURFACE_LIFT.minS);
  const col = new THREE.Color();
  col.setHSL(c.h, s, l, THREE.SRGBColorSpace);
  return col.getHex(THREE.SRGBColorSpace);
}

/**
 * Rewrite a palette in place for the high-key style.
 *
 * IN PLACE and on the real `MAZE_THEMES` entry, deliberately: the board reads
 * the EQUIPPED theme rather than taking a palette as an argument, and
 * `preview-board`'s own `?fence=0` A/B already works this way for the same
 * reason — the comparison has to be one code path with different values or it
 * is not a comparison. Returns the slots it changed so a caller can restore.
 */
export function liftPaletteForMadbox(
  themeId: string,
  // Deliberately loose. `ThemePalette` has string-literal and array members, so
  // it does not satisfy a `Record<string, number>` index signature — and this
  // function only ever touches five named numeric slots, checking each one's
  // type before it writes. Naming the real type here would make src/render
  // depend on a game type to do that, and the preview harness drives it with a
  // patched palette object anyway.
  palette: object,
): Record<string, number> | null {
  // `themeId` is kept in the signature for callers and tests that think in
  // ids; the DECISION is made from the palette, so nothing has to be listed.
  void themeId;
  if (isNightTheme(palette)) return null;
  const before: Record<string, number> = {};
  // SAND IS LIGHT BY NATURE, AND A SINGLE TARGET CANNOT SAY THAT.
  //
  // The lift raises a surface TOWARD a target and stops. Sunny Beach's floor
  // is #9a8258 at lightness 0.47 and the floor target is 0.46 — so it was
  // already "bright enough" and the lift did literally nothing to it, which is
  // why the beach stayed dark while every other theme moved. The number was
  // right for soil and lawn and wrong for the one surface that is supposed to
  // be the lightest thing on the board.
  //
  // So the target is chosen by WHAT THE SURFACE IS, using the texture kind the
  // palette already declares. Nothing new to keep in step: a theme that
  // changes its `floorTexture` changes its target by saying so.
  const sandFloor = (palette as { floorTexture?: string }).floorTexture === "sand";
  const sandWall = (palette as { wallTexture?: string }).wallTexture === "sand";
  const plan: Array<[string, number]> = [
    ["floor", sandFloor ? SURFACE_LIFT.sandFloorL : SURFACE_LIFT.floorL],
    ["wall", sandWall ? SURFACE_LIFT.sandWallL : SURFACE_LIFT.wallL],
    // The ground OUTSIDE the board follows the floor's own nature: on the
    // beach it is the same sand, and leaving it on the generic target put
    // muddy brown right up against cream dunes — the dunes are matcapped
    // props snapped to the palette's `sand`, so the mismatch was between two
    // halves of the same beach.
    ["surroundGround", sandFloor ? SURFACE_LIFT.sandFloorL : SURFACE_LIFT.outsideL],
    ["fenceColor", SURFACE_LIFT.wallL],
    ["groundDetailColor", SURFACE_LIFT.outsideL],
  ];
  const mut = palette as unknown as Record<string, unknown>;
  for (const [slot, target] of plan) {
    const v = mut[slot];
    if (typeof v !== "number") continue;
    before[slot] = v;
    mut[slot] = liftSurface(v, target);
  }
  return before;
}
