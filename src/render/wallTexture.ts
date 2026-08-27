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
//     PWA — every KB is precached onto someone's phone. A 128px canvas costs
//     nothing to ship and is built once at runtime.
//
//  2. LUMINANCE ONLY, averaging near white. The texture is a `map`, and three
//     MULTIPLIES it by the material colour — so a mid-grey texture would
//     darken every theme's carefully-tuned wall. These paint pattern as
//     shadow on a near-white ground, which leaves `palette.wall` in charge of
//     hue and only carves relief into it.
//
//  3. SEAMLESS. Walls are one InstancedMesh of unit boxes, so every tile shows
//     the full 0..1 of the texture. Anything that does not tile edge-to-edge
//     turns the maze into a visible grid of stamps; anything that does reads
//     as one continuous surface running across the tiles.
import * as THREE from "three";

/** Which surface a theme's walls wear. */
export type WallTextureKind = "flat" | "hedge" | "sand" | "brick";

const SIZE = 128;

/**
 * Deterministic PRNG (mulberry32). The pattern must be identical on every
 * device and every reload — a wall that reshuffles its leaves when you
 * re-enter the maze would be its own kind of wrong, and it would make the
 * theme screenshots untestable.
 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
 * it every blob is clipped at the border and the seams read as a hard grid.
 */
function wrapped(paint: (dx: number, dy: number) => void): void {
  for (const dx of [-SIZE, 0, SIZE]) for (const dy of [-SIZE, 0, SIZE]) paint(dx, dy);
}

/** Dense foliage: overlapping leaf clusters, darker in the gaps between them. */
function drawHedge(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = "#efefef";
  ctx.fillRect(0, 0, SIZE, SIZE);
  const r = rng(0x5eed1);
  // Two passes: broad clumps first for large-scale variation, then small
  // leaves on top so the surface has detail at both the maze-wide and
  // stand-next-to-it viewing distances.
  // Three passes, deepest first: broad clumps for large-scale variation, then
  // leaves, then a sparse pass of near-black gaps. The gaps are what sell it —
  // a hedge reads as foliage because you can see INTO it in places, and
  // without them the two lighter passes just look like mottled paint.
  for (const [count, min, max, dark] of [
    [40, 14, 26, 0.3],
    [190, 4, 8, 0.34],
    [70, 2, 4, 0.52],
  ] as const) {
    for (let i = 0; i < count; i++) {
      const x = r() * SIZE;
      const y = r() * SIZE;
      const rad = min + r() * (max - min);
      const shade = Math.round(255 * (1 - dark * (0.45 + r() * 0.55)));
      ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
      wrapped((dx, dy) => {
        ctx.beginPath();
        ctx.arc(x + dx, y + dy, rad, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }
}

/** Packed sand: soft horizontal bedding lines plus fine grain. */
function drawSand(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = "#f4f4f4";
  ctx.fillRect(0, 0, SIZE, SIZE);
  const r = rng(0x5a4d);
  // Bedding: broad, soft, horizontal — sand slumps into layers, and the
  // horizontal read is most of what separates it from noise.
  for (let i = 0; i < 9; i++) {
    const y = r() * SIZE;
    const h = 4 + r() * 11;
    const shade = Math.round(255 * (1 - 0.1 * (0.4 + r() * 0.6)));
    ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
    wrapped((dx, dy) => ctx.fillRect(dx, y + dy, SIZE, h));
  }
  // Grain: single pixels, dense enough to read as texture rather than dust.
  for (let i = 0; i < 2600; i++) {
    const shade = Math.round(255 * (1 - 0.2 * r()));
    ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
    ctx.fillRect(Math.floor(r() * SIZE), Math.floor(r() * SIZE), 1, 1);
  }
}

/** Brickwork in running bond, with recessed mortar courses. */
function drawBrick(ctx: CanvasRenderingContext2D): void {
  const ROWS = 8;
  const H = SIZE / ROWS;
  const W = SIZE / 4; // 4 bricks per row, so the half-brick offset also tiles
  const MORTAR = 2.5;
  // Mortar is the DARK ground the bricks sit proud of — drawn first, then
  // each brick painted over it inset by the joint width.
  ctx.fillStyle = "#c8c8c8";
  ctx.fillRect(0, 0, SIZE, SIZE);
  const r = rng(0xb0cc);
  for (let row = 0; row < ROWS; row++) {
    // Running bond: every other course shifts half a brick. Because the offset
    // is exactly half of an exact divisor of the width, the pattern still
    // tiles across the seam.
    const offset = row % 2 === 0 ? 0 : W / 2;
    for (let col = -1; col < 5; col++) {
      const x = col * W + offset;
      const y = row * H;
      // Bricks vary slightly so a wall is not a perfect stamp repeated.
      const shade = Math.round(255 * (1 - 0.06 * r()));
      ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
      wrapped((dx, dy) =>
        ctx.fillRect(x + MORTAR / 2 + dx, y + MORTAR / 2 + dy, W - MORTAR, H - MORTAR),
      );
    }
  }
}

const cache = new Map<WallTextureKind, THREE.Texture | null>();

/**
 * The texture for `kind`, or null for "flat" (no map at all — an untextured
 * wall is a legitimate art choice, and it is the arcade theme's).
 *
 * Cached: one canvas and one GPU upload per kind for the whole session, shared
 * by every wall instance and reused across theme switches.
 */
export function wallTextureFor(kind: WallTextureKind): THREE.Texture | null {
  if (cache.has(kind)) return cache.get(kind) ?? null;
  let tex: THREE.Texture | null = null;
  if (kind !== "flat") {
    const ctx = canvas2d();
    if (kind === "hedge") drawHedge(ctx);
    else if (kind === "sand") drawSand(ctx);
    else drawBrick(ctx);
    tex = new THREE.CanvasTexture(ctx.canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    // The map is albedo, so it is sRGB — leaving it linear washes the pattern
    // out to almost nothing under the cel ramp.
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
  }
  cache.set(kind, tex);
  return tex;
}
