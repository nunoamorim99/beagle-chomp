// Timeline maths for the kraken vignette. Pure, no three import.

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
/** Normalised progress of `p` inside [a, b]. */
export const range = (p: number, a: number, b: number): number => clamp01((p - a) / (b - a));
export const easeInQuad = (x: number): number => x * x;
export const easeInCubic = (x: number): number => x * x * x;
export const easeInOutCubic = (x: number): number =>
  x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
export const easeInOutSine = (x: number): number => -(Math.cos(Math.PI * x) - 1) / 2;
export const easeOutBack = (x: number, s = 1.70158): number => {
  const c3 = s + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2);
};
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
