// OWNER: render-artist
// Procedural wall surfaces, one per theme concept.
//
// Every theme used the same untextured box, so a hedge maze, a beach and a
// night city all read as the same moulded plastic in different colours. These
// give each concept a SURFACE — foliage, packed sand, brickwork — without
// shipping a single image file.
//
// Three rules the whole module follows:
//
//  1. GENERATED, never loaded. This project has no texture assets and is a
//     PWA — every KB is precached onto someone's phone. A canvas costs nothing
//     to ship and is built once at runtime.
//
//  2. THEY CARRY COLOUR, and this is the rule that changed. The first pass
//     painted luminance only, averaging near white, because a `map` MULTIPLIES
//     the material colour and a mid-grey texture would darken every theme's
//     carefully-tuned wall. The catch is what multiplication cannot do: the
//     brightest thing a luminance map can produce is the material's own
//     colour, so a hedge could only ever be "wall colour with darker holes in
//     it". Cartoon foliage is mostly the opposite — LIT leaves catching the
//     sun above the mass — and without them the hedge stayed a muddy mottle no
//     matter how the pattern was drawn. So these now bake `palette.wall` in as
//     their own ground and paint sibling tones on top, exactly as the floor
//     textures do, and every caller holds the material at WHITE. Don't tint it
//     twice. (Unlike the floor, the emissive is NOT driven by the map: wall
//     palettes lift by 0.15-0.28 in a near-black colour, which is far too
//     small to swamp a pattern the way the floor's ~0.3 did.)
//
//  3. SEAMLESS. Walls are one InstancedMesh of unit boxes, so every tile shows
//     the full 0..1 of the texture. Anything that does not tile edge-to-edge
//     turns the maze into a visible grid of stamps; anything that does reads
//     as one continuous surface running across the tiles.
//
// And the same CARTOON rule the floors follow (see floorTexture.ts's own
// block): a fixed handful of named tones per surface, real shapes rather than
// per-pixel scatter, nothing smaller than a couple of pixels. A wall drawn out
// of 2,600 one-pixel grains at a thousand brightnesses is a photograph, and it
// sat badly next to a beagle made of flat colour fields.
import * as THREE from "three";
import { css, lit, mix, rgbOf, rng, type RGB } from "./paint";

/** Which surface a theme's walls wear. */
export type WallTextureKind = "flat" | "hedge" | "sand" | "brick";

/**
 * Canvas pixels per wall face.
 *
 * A face is a unit cube side, so at the maze camera it is rarely more than
 * ~80px — but the shop diorama and the menu vignette put one right under the
 * player's nose, and 128 came out soft there. Every size below is a fraction
 * of this, so it is a pure resolution knob like floorTexture's own `S`.
 */
const SIZE = 256;

function canvas2d(): CanvasRenderingContext2D {
  const c = document.createElement("canvas");
  c.width = SIZE;
  c.height = SIZE;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("wallTexture: no 2d context");
  return ctx;
}

/**
 * Draws `paint` at the nine wrapped offsets so any shape crossing an edge is
 * also drawn on the opposite side. This is what makes the result tile: without
 * it every shape is clipped at the border and the seams read as a hard grid.
 *
 * Everything random must be decided BEFORE calling this — the nine passes have
 * to draw the identical shape, so a `rnd()` inside the callback would produce
 * nine different blobs and tear the seam wide open.
 */
function wrapped(paint: (dx: number, dy: number) => void): void {
  for (const dx of [-SIZE, 0, SIZE]) for (const dy of [-SIZE, 0, SIZE]) paint(dx, dy);
}

/**
 * One leaf cluster: five overlapping circles round a centre, so the silhouette
 * comes out scalloped like a clump of foliage instead of a perfect disc.
 *
 * The circles are computed up front and handed to `wrapped` as one shape, per
 * the note above.
 */
function clump(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rad: number,
  rnd: () => number,
): void {
  const lobes: Array<[number, number, number]> = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rnd() * 0.7;
    const d = rad * 0.46 * rnd();
    lobes.push([Math.cos(a) * d, Math.sin(a) * d, rad * (0.58 + rnd() * 0.42)]);
  }
  wrapped((dx, dy) => {
    for (const [ox, oy, r] of lobes) {
      ctx.beginPath();
      ctx.arc(x + ox + dx, y + oy + dy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/**
 * Dense foliage, built up from dark to light.
 *
 * The order is the whole trick and it is the opposite of the first pass's. The
 * ground is the hedge's SHADOWED INTERIOR, then progressively smaller and
 * LIGHTER clusters sit on top of it — which is how foliage actually reads,
 * and it is only reachable now the texture carries colour. A few near-black
 * gaps go on last, because a hedge reads as foliage partly because you can see
 * into it in places.
 */
function drawHedge(ctx: CanvasRenderingContext2D, base: RGB): void {
  // The tonal range is deliberately NARROWER than a real hedge's. Up close
  // more contrast looks better, but a wall face is a couple of dozen pixels at
  // the game camera, and a 0.42-to-1.32 spread turned the maze into a field of
  // high-contrast speckle you could no longer trace corridors through. Legible
  // beats lush: this is a maze first.
  const deep = lit(base, 0.54);
  const shade = lit(base, 0.76);
  const mid = base;
  const light = lit(base, 1.2);
  const pop = mix(lit(base, 1.26), [0.85, 0.95, 0.5], 0.14);
  const r = rng(0x5eed1);

  ctx.fillStyle = css(deep);
  ctx.fillRect(0, 0, SIZE, SIZE);

  // FEWER, BIGGER clusters than the first cut. A wall face is one maze tile,
  // which at the game camera is roughly 25px on screen — so a cluster at a
  // tenth of the face is 2.5px there and aliases straight back into the
  // speckle this rewrite exists to remove. At a quarter of the face the same
  // shape survives the distance, and the maze stops reading as one green mass.
  for (const [count, min, max, tone] of [
    [12, 0.15, 0.26, shade],
    [16, 0.1, 0.17, mid],
    [16, 0.07, 0.12, light],
    [10, 0.045, 0.075, pop],
  ] as const) {
    ctx.fillStyle = css(tone);
    for (let i = 0; i < count; i++) {
      clump(ctx, r() * SIZE, r() * SIZE, SIZE * (min + r() * (max - min)), r);
    }
  }

  // The gaps. Few, and the darkest thing on the wall.
  ctx.fillStyle = css(deep);
  for (let i = 0; i < 6; i++) {
    clump(ctx, r() * SIZE, r() * SIZE, SIZE * (0.028 + r() * 0.03), r);
  }
}

/** Packed sand: broad wind-blown bedding bands and the odd worn pebble. */
function drawSand(ctx: CanvasRenderingContext2D, base: RGB): void {
  const trough = lit(base, 0.86);
  const crest = lit(base, 1.12);
  const r = rng(0x5a4d);

  ctx.fillStyle = css(base);
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Bedding: broad, soft, horizontal — sand slumps into layers, and the
  // horizontal read is most of what separates it from noise. Each band is a
  // thick wavy stroke, with a lighter crest riding just above it so the pair
  // reads as one rounded ridge (the same two-flat-strokes trick the beach
  // FLOOR uses, which keeps the two halves of the theme telling one story).
  //
  // The wave completes a whole number of cycles across the face, which is what
  // lets it meet itself at the left/right seam.
  // FOUR bands, not six. At six the trough/crest pairs came out evenly spaced
  // and evenly thick, and twelve parallel lines on a face reads as corrugated
  // card — or wood grain — rather than sand. Fewer, broader, and with real
  // variation in where they sit is the difference.
  ctx.lineCap = "butt";
  const BANDS = 4;
  for (let i = 0; i < BANDS; i++) {
    const y0 = ((i + 0.5) / BANDS) * SIZE + (r() - 0.5) * (SIZE / BANDS) * 0.75;
    const cycles = 1 + Math.floor(r() * 2);
    const phase = r() * Math.PI * 2;
    const amp = SIZE * (0.03 + r() * 0.035);
    const thick = 0.06 + r() * 0.045;
    const wave = (x: number): number => Math.sin((x / SIZE) * Math.PI * 2 * cycles + phase) * amp;
    for (const [dy, tone, w] of [
      [0, trough, thick],
      [-SIZE * 0.055, crest, thick * 0.6],
    ] as const) {
      ctx.strokeStyle = css(tone);
      ctx.lineWidth = SIZE * w;
      wrapped((dx, dyy) => {
        ctx.beginPath();
        for (let x = 0; x <= SIZE; x += SIZE / 32) {
          const px = x + dx;
          const py = y0 + wave(x) + dy + dyy;
          if (x === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      });
    }
  }

  // Worn pebbles pressed into the face — a handful of real shapes where the
  // first pass had 2,600 single pixels.
  for (let i = 0; i < 16; i++) {
    const x = r() * SIZE;
    const y = r() * SIZE;
    const rad = SIZE * (0.008 + r() * 0.009);
    const tone = r() < 0.5 ? lit(base, 0.8) : lit(base, 1.16);
    const rot = r() * Math.PI;
    ctx.fillStyle = css(tone);
    wrapped((dx, dy) => {
      ctx.beginPath();
      ctx.ellipse(x + dx, y + dy, rad, rad * 0.72, rot, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}

/** Brickwork in running bond, with recessed mortar courses. */
function drawBrick(ctx: CanvasRenderingContext2D, base: RGB): void {
  // Five courses of three, not eight of four. Real brick is finer than this,
  // but a face is one maze TILE across and at the game camera eight courses
  // per tile collapsed back into a texture — chunky and countable is the
  // cartoon read, the same call as fewer/bigger grass tufts on the floor.
  const ROWS = 5;
  const H = SIZE / ROWS;
  const W = SIZE / 3; // whole number per row, so the half-brick offset also tiles
  const MORTAR = SIZE * 0.018;
  // Mortar is the DARK ground the bricks sit proud of — drawn first, then each
  // brick painted over it inset by the joint width. It is properly dark now:
  // the luminance version could only pull it 6% off the wall colour before the
  // whole face started reading grey, so the courses barely showed.
  const mortar = lit(base, 0.56);
  // Three brick tones, assigned per brick. Three, not "1 - 0.06 * random":
  // a handful of distinct shades reads as brickwork, a continuous ramp reads
  // as dirt.
  const tones = [lit(base, 1.08), base, lit(base, 0.88)] as const;
  const r = rng(0xb0cc);

  ctx.fillStyle = css(mortar);
  ctx.fillRect(0, 0, SIZE, SIZE);

  for (let row = 0; row < ROWS; row++) {
    // Running bond: every other course shifts half a brick. Because the offset
    // is exactly half of an exact divisor of the width, the pattern still
    // tiles across the seam.
    const offset = row % 2 === 0 ? 0 : W / 2;
    for (let col = -1; col < 4; col++) {
      const x = col * W + offset;
      const y = row * H;
      const tone = tones[Math.floor(r() * tones.length)];
      const bx = x + MORTAR / 2;
      const by = y + MORTAR / 2;
      const bw = W - MORTAR;
      const bh = H - MORTAR;
      wrapped((dx, dy) => {
        ctx.fillStyle = css(tone);
        ctx.fillRect(bx + dx, by + dy, bw, bh);
        // A lit top edge on every brick — the cartoon version of a chamfer,
        // and the cheapest way to stop a wall of flat rectangles reading as
        // printed-on squares. Only reachable because the map carries colour.
        ctx.fillStyle = css(lit(tone, 1.16));
        ctx.fillRect(bx + dx, by + dy, bw, Math.max(1, SIZE * 0.006));
      });
    }
  }
}

/**
 * Cached by kind AND colour, since these now bake the palette in.
 *
 * Unbounded on purpose: a theme's wall colour is a fixed literal, so in the
 * game this tops out at one entry per themed surface (four today, ~260 KB
 * all told) and every wall in the maze plus every showcase hedge shares them.
 * Nothing ever disposes one, which is what lets callers treat the result as
 * borrowed. The board editor can add a few more while a colour is being
 * dragged; it is dev-only and they are small.
 */
const cache = new Map<string, THREE.Texture | null>();

/**
 * The texture for `kind` over `baseHex`, or null for "flat" (no map at all —
 * an untextured wall is a legitimate art choice, and it is the arcade theme's).
 *
 * `baseHex` is the theme's own wall colour, painted in as the ground. The
 * caller must then leave the material WHITE, or the tint lands twice — see
 * rule 2 in the header.
 */
export function wallTextureFor(kind: WallTextureKind, baseHex: number): THREE.Texture | null {
  const key = kind + "|" + baseHex;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  let tex: THREE.Texture | null = null;
  if (kind !== "flat") {
    const ctx = canvas2d();
    const base = rgbOf(baseHex);
    if (kind === "hedge") drawHedge(ctx, base);
    else if (kind === "sand") drawSand(ctx, base);
    else drawBrick(ctx, base);
    tex = new THREE.CanvasTexture(ctx.canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    // The map is albedo, so it is sRGB — leaving it linear washes the pattern
    // out to almost nothing under the cel ramp.
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
  }
  cache.set(key, tex);
  return tex;
}
