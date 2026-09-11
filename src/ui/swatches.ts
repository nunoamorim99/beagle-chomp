// OWNER: gameplay-engineer (IDEA-064 tutorial v3)
//
// Shop swatch markup that more than one screen draws.
//
// `beagleSwatchHtml` lived inside `attachShop`'s closure until the tutorial
// grew a slide listing every coat and what it does (IDEA-064). It never used
// any of that closure's state — it is a pure function of a BeagleSkin — and a
// second hand-copy of a 24x24 paw is exactly the drift this codebase keeps
// writing down: the ENEMY_ICONS raw-string bug and boardCodegen's hand-written
// field list are the same defect in different files. One paw, two callers.
//
// No `three`, no DOM: it returns a string, so the shop, the tutorial and any
// test can all ask for it.
import type { BeagleSkin } from "../game/cosmetics";

/** Converts a cosmetics hex color number (e.g. 0xc98a3c) to a CSS color string. */
export function hexToCss(n: number): string {
  return `#${n.toString(16).padStart(6, "0")}`;
}

/**
 * A PAW, painted in the coat's own colours (Nuno's call, replacing four
 * colour dots).
 *
 * The dots carried the right information and said nothing about what the
 * information was FOR: four swatches in a row is a palette chip, and this is
 * a shop that sells dogs. A paw says "beagle" before you have read the name,
 * and it can carry more of the coat than the dots did — five channels rather
 * than four, including the boots, which is the Pac-Beagle's whole silhouette.
 *
 * WHY INLINE SVG AND NOT A GLYPH. `ICON.beagle` is Material Symbols' `pets`,
 * which is a paw — and a font glyph takes exactly ONE colour. The entire
 * point here is showing four or five at once, so this has to be real
 * geometry. It is also why this is not a plate: a plate is one lit square
 * with one glyph on it.
 *
 * THE MAPPING MIRRORS WHERE EACH COLOUR SITS ON THE DOG, which is what makes
 * it readable rather than decorative:
 *   pad          -> `tan`, the body colour and the largest mass here too
 *   pad's inner  -> `paw ?? white`, the foot colour; falls back to the belly
 *                   for every coat that does not ask for boots (see
 *                   BeagleCoat.paw — the paws WERE painted `white` before
 *                   that channel existed, so the fallback is exact)
 *   outer toes   -> `ear`, the coat's mid-brown / blend band
 *   inner toes   -> `black`, the saddle and markings
 *
 * Every shape is stroked in the system ink (§01: outline everything, 3px of
 * `--bc-outline`), NOT in the coat's own `black` — a coat whose "black" is a
 * soft brown (Muffin's 0x9c7248) would otherwise lose its outline on the one
 * card that needs it most, and the ink is what ties this to the toon meshes
 * behind it. Stroke width is in the SVG's own units, so it scales with the
 * card rather than needing a second value for the phone layout.
 *
 * `extraClass` is how the tutorial asks for the same paw at list size without
 * a second copy of the geometry — the SVG is unitless, so the caller's CSS is
 * the only thing that decides how big it is.
 */
export function beagleSwatchHtml(skin: BeagleSkin, extraClass = ""): string {
  const { tan, white, black, ear } = skin.coat;
  const sock = skin.coat.paw ?? white;
  // A 24x24 viewBox: four toe beans across the top, one big pad below. The
  // outer pair sit lower and are tilted outward, which is what stops the row
  // reading as four identical circles.
  return (
    `<div class="skin-swatch skin-swatch-paw${extraClass ? ` ${extraClass}` : ""}" aria-hidden="true">` +
    '<svg viewBox="0 0 24 24" class="paw-swatch">' +
    `<g stroke="var(--bc-outline)" stroke-width="1.3" stroke-linejoin="round">` +
    // outer toes (ear)
    `<ellipse cx="4.1" cy="10.2" rx="2.9" ry="3.5" transform="rotate(-24 4.1 10.2)" fill="${hexToCss(ear)}"/>` +
    `<ellipse cx="19.9" cy="10.2" rx="2.9" ry="3.5" transform="rotate(24 19.9 10.2)" fill="${hexToCss(ear)}"/>` +
    // inner toes (black / markings)
    `<ellipse cx="9.3" cy="6.2" rx="2.9" ry="3.6" transform="rotate(-9 9.3 6.2)" fill="${hexToCss(black)}"/>` +
    `<ellipse cx="14.7" cy="6.2" rx="2.9" ry="3.6" transform="rotate(9 14.7 6.2)" fill="${hexToCss(black)}"/>` +
    // The pad (tan), with the foot colour as a SOLE at its bottom edge.
    //
    // The sole was a concentric ellipse in the middle of the pad first, and
    // at 48px a wide oval with a lighter oval centred inside it reads as an
    // EYE — which on a card selling a dog is worse than no marking at all.
    // Sitting it low and clipping it to the pad's own lower curve makes it a
    // sole, which is where a foot's pale marking actually is.
    `<path d="M12 11.6c4.3 0 7.2 2.8 7.2 5.8 0 2.7-2.5 4.5-7.2 4.5s-7.2-1.8-7.2-4.5c0-3 2.9-5.8 7.2-5.8z" fill="${hexToCss(tan)}"/>` +
    `<path d="M12 17.1c2.9 0 5 .7 6.1 1.7-.9 1.8-3.1 3.1-6.1 3.1s-5.2-1.3-6.1-3.1c1.1-1 3.2-1.7 6.1-1.7z" fill="${hexToCss(sock)}"/>` +
    "</g>" +
    "</svg>" +
    "</div>"
  );
}
