// OWNER: render-artist
// The small drawing kit the two procedural surface modules share.
//
// wallTexture.ts and floorTexture.ts both paint a theme's own colour into a
// canvas, so both need the same handful of things: a colour as components you
// can mix, a deterministic PRNG, and the two blends every pattern is built out
// of. They each had their own copy, which is one edit away from the two
// halves of a theme drifting apart.
//
// Nothing here touches three or the DOM — it is arithmetic and a colour
// string, so a surface module stays the only place that knows about a canvas.

/** A colour as 0..1 components — the form all the mixing below works in. */
export type RGB = readonly [number, number, number];

export function rgbOf(hex: number): RGB {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

export function css(c: RGB): string {
  const b = (v: number): number => Math.max(0, Math.min(255, Math.round(v * 255)));
  return "rgb(" + b(c[0]) + "," + b(c[1]) + "," + b(c[2]) + ")";
}

/** Linear blend; t = 0 keeps `a`, t = 1 reaches `b`. */
export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Same hue, scaled brightness — the cheap way to get a sibling shade. */
export function lit(c: RGB, k: number): RGB {
  return [c[0] * k, c[1] * k, c[2] * k];
}

/**
 * Deterministic PRNG (mulberry32).
 *
 * Every pattern must be identical on every device and every reload — a wall
 * that reshuffles its leaves when you re-enter the maze would be its own kind
 * of wrong, and it would make the theme screenshots untestable.
 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
