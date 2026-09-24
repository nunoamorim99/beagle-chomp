// OWNER: render-artist (IDEA-079)
//
// MADBOX-STYLE MATCAPS, GENERATED AT RUNTIME.
//
// A port of Nuno's `make-matcap.js` (from `MADBOX_STYLE.md`) onto a canvas,
// because the one thing this project will not do is fetch an asset. Their
// pipeline ships 35 hand-made 64x64 Basis textures; ours draws the same image
// with the same arithmetic when the scene is built, exactly as
// `wallTexture.ts` and `floorTexture.ts` already do for every surface in the
// maze. **That removes the objection that killed matcaps the first time they
// were considered here** — it was never the look, it was 35 fetched files in a
// PWA that generates everything.
//
// ---------------------------------------------------------------------------
// WHAT A MATCAP IS DOING, AND WHY IT IS NOT OUR TOON RAMP
// ---------------------------------------------------------------------------
//
// Both are "shade by looking something up rather than by lighting". The toon
// ramp looks up `dot(N, L)` in three hard steps; a matcap looks up the view
// space NORMAL in a full 2D image. The practical differences that matter here:
//
//  * A matcap carries a SPECULAR DOT and a COLOURED BOUNCE, which three steps
//    of one gradient cannot. Their document's whole cohesion trick is that the
//    bounce colour is shared across everything in an area, so a scene reads as
//    lit by one environment with literally zero lights in it.
//  * A matcap is smooth where the ramp BANDS. That cuts both ways: the banding
//    is what [[IDEA-068]] leans on to make a hedge crown read at 17 px, and it
//    is also what blotched the old sea.
//  * A matcap is fixed to the CAMERA, so it cannot tell you which way a
//    surface faces in the world. On a large flat surface it gives itself away
//    immediately, which is why their landmasses are baked instead — their own
//    section 5 says so.
//
// THE HONEST RISK, STATED UP FRONT: CLAUDE.md holds that `toon()` +
// `NoToneMapping` + one shared ramp are "one system, not a style preference",
// and a matcapped island map next to a toon-shaded maze is two looks in one
// game. This module exists so that can be JUDGED from a render rather than
// argued from principle. It is opt-in and nothing imports it by default.
//
// ---------------------------------------------------------------------------
// THE ADAPTATION THAT REPLACES THEIR BIGGEST PIPELINE IDEA
// ---------------------------------------------------------------------------
//
// Their highest-leverage trick is mesh-name-driven assignment: a Blender object
// called `blueOnOrange_boat_hull` gets the blue-on-orange matcap by regex. It
// exists because their meshes come out of Blender carrying names and nothing
// else.
//
// Ours come out of TypeScript already carrying a `toon({ color })`. So the
// colour is right there, and the equivalent move is to derive the matcap FROM
// THE MATERIAL rather than from a name — same zero-setup result, no convention
// to keep, and it applies to props that were authored years before this file.
// Caching is by quantised (base, bounce), so a whole island collapses to a
// handful of textures however many meshes it has.
//
// The bounce colour is the per-area one their cohesion depends on, and on this
// map the natural area is an ISLAND: everything on one island shares a bounce,
// so each reads as its own little world with its own light.

import * as THREE from "three";

export interface MatcapOptions {
  /** Pixels a side. 64 is not a typo — their own note is that anyone shipping
   *  512 is spending 64x the memory on a low-frequency gradient. */
  size: number;
  /** Their global grade, baked in here rather than patched into the shader.
   *  Same result, one less material override to keep in step. */
  contrast: number;
  brightness: number;
}

export const MATCAP_OPTIONS: MatcapOptions = {
  size: 64,
  contrast: 1.2,
  brightness: -0.24,
};

type RGB = [number, number, number];

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

function norm(v: RGB): RGB {
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function rgbOf(hex: number): RGB {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

// Key light upper-left toward the viewer, bounce lower-right behind — the two
// directions from their generator, kept because the specular dot's position is
// half of what makes every object look like part of one scene.
const KEY = norm([-0.45, 0.62, 0.64]);
const BOUNCE_DIR = norm([0.55, -0.55, 0.25]);

/**
 * Draw one matcap.
 *
 * The anatomy, from their section 3.2, and every line here is one bullet of it:
 * high-key low-contrast body (wrapped diffuse, never fully dark), one small
 * crisp specular dot upper-left, a coloured bounce from lower-right, and the
 * area OUTSIDE the normal disk filled with the bounce colour so it becomes the
 * rim tint at grazing angles.
 *
 * That last one is the part people skip and it is the most important: it is
 * what puts a consistent silhouette light on every object without a rim pass.
 */
export function makeMatcapTexture(
  base: number,
  bounce: number,
  opts: MatcapOptions = MATCAP_OPTIONS,
): THREE.CanvasTexture | null {
  // Headless guard, as journeyIsland.ts's deck texture carries: the cost
  // spike runs in Node where there is no document, and a throw there would
  // make a measuring script fail as though the scene were broken.
  if (typeof document === "undefined") return null;

  const S = opts.size;
  const cv = document.createElement("canvas");
  cv.width = S;
  cv.height = S;
  const g = cv.getContext("2d");
  if (!g) return null;

  const baseC = rgbOf(base);
  const bounceC = rgbOf(bounce);
  const img = g.createImageData(S, S);
  const px = img.data;

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = ((x + 0.5) / S) * 2 - 1;
      const v = 1 - ((y + 0.5) / S) * 2;
      const r2 = u * u + v * v;
      const o = (y * S + x) * 4;

      if (r2 > 1) {
        // Outside the disk. This is the rim/silhouette tint, not padding.
        px[o] = bounceC[0] * 255;
        px[o + 1] = bounceC[1] * 255;
        px[o + 2] = bounceC[2] * 255;
        px[o + 3] = 255;
        continue;
      }

      const w = Math.sqrt(1 - r2);
      const ndl = clamp01(u * KEY[0] + v * KEY[1] + w * KEY[2]);
      const ndb = clamp01(u * BOUNCE_DIR[0] + v * BOUNCE_DIR[1] + w * BOUNCE_DIR[2]);

      // WRAPPED diffuse: the 0.5/0.5 remap is what keeps it high-key. A plain
      // Lambert here gives a dark side, and "nothing is dark" is their single
      // strongest palette rule — saturation lives in hue, not in value.
      const diff = Math.pow(ndl * 0.5 + 0.5, 1.15);
      let c: RGB = [
        baseC[0] * (0.62 + 0.46 * diff),
        baseC[1] * (0.62 + 0.46 * diff),
        baseC[2] * (0.62 + 0.46 * diff),
      ];

      // Coloured bounce, tinted toward the area colour.
      c = mix(c, mix(c, bounceC, 0.85), Math.pow(ndb, 2.2) * 0.55);

      // Fresnel toward the silhouette.
      const fres = Math.pow(1 - w, 3.5);
      c = mix(c, [bounceC[0] * 0.6 + 0.4, bounceC[1] * 0.6 + 0.4, bounceC[2] * 0.6 + 0.4], fres * 0.45);

      // The crisp specular dot. Small and tight, never a broad blown highlight.
      const sd = Math.hypot(u + 0.42, v - 0.46);
      c = mix(c, [1, 1, 1], Math.pow(clamp01(1 - sd / 0.24), 2) * 0.9);

      // Broad soft sheen along the lit side.
      c = mix(c, [1, 1, 1], Math.pow(ndl, 7) * 0.25);

      // Antialias the silhouette against the bounce fill.
      const edge = clamp01((1 - Math.sqrt(r2)) * S * 0.5);
      c = mix(bounceC, c, edge);

      // Their global grade, baked rather than applied as a shader uniform.
      px[o] = clamp01(c[0] * opts.contrast + opts.brightness) * 255;
      px[o + 1] = clamp01(c[1] * opts.contrast + opts.brightness) * 255;
      px[o + 2] = clamp01(c[2] * opts.contrast + opts.brightness) * 255;
      px[o + 3] = 255;
    }
  }

  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  // Colour data, so sRGB. Getting this wrong is the "everything is too dark"
  // bug one layer down from [[IDEA-072]]'s.
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
