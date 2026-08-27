// OWNER: render-artist
// Procedural floor surfaces, painted FROM THE MAZE GRID.
//
// The walls got their own surfaces (wallTexture.ts) but the ground stayed one
// flat colour in every theme. This is the other half — and it is a different
// problem, because half of what a floor should show follows the CORRIDORS: a
// garden has a trail of stones through its lawn, a park has gravel where
// people walk and grass where they don't, a road has markings down the middle
// of the lane.
//
// That is affordable because the floor is a single PlaneGeometry(COLS+2,
// ROWS+2) with plain 0..1 UVs. So a canvas of the same proportions maps one
// region per tile, and tile (tx, ty) lands at exactly
// ((tx + 1.5) * S, (ty + 1.5) * S) — the +1.5 being the one-tile apron plus a
// half-tile to reach the centre. Painting the maze into that canvas is then
// ordinary 2D drawing.
//
// WHY THESE PAINT IN COLOUR, unlike the wall textures. A `map` MULTIPLIES the
// material colour, so a luminance-only map can only ever carve shadow — the
// brightest thing it can produce is the material's own colour. That is fine on
// a wall, but it cannot draw a road: Night City's floor is 0x3a3640, so a
// "white" lane marking painted as grey(1) still rendered at 0.22 luminance,
// dark grey on darker grey, invisible. These textures therefore bake the
// theme's own floor colour in as their ground and paint real colours on top of
// it, and board.ts holds the material at white so the tint is not applied
// twice. That buys markings BRIGHTER than the base, and genuine hue changes —
// the park's lawn can be green over a tan palette.
//
// The other two rules still hold: generated not shipped, and no caching
// mistakes — these depend on the grid AND the palette, so they are rebuilt per
// theme and the old one disposed.
import * as THREE from "three";
import { COLS, ROWS, type Grid } from "../game/grid";

/** Which surface a theme's floor wears. */
export type FloorTextureKind = "flat" | "stone" | "earth" | "sand" | "parkGrass" | "road";

/**
 * Pixels per maze tile.
 *
 * 32, not 16: the garden's stepping stones are ELLIPSES, and at 16 they came
 * out as mush once the camera got close — one texture is stretched over the
 * whole ~21-unit plane. Everything below was tuned at 16 and is expressed in
 * terms of `K`, so raising S makes the drawn SHAPES crisper without changing
 * how any surface looks: feature sizes scale with K and scatter counts with K
 * squared, which holds both the size and the density of every noise pass
 * constant. Costs 672x736 (~1.9 MB RGBA), one live at a time — and nothing on
 * disk, which is the point of drawing these at runtime.
 */
const S = 32;

/** Pixel scale relative to the resolution these patterns were tuned at. */
const K = S / 16;

/** A scatter count at the tuned density, for `n` tuned at K = 1. */
const density = (n: number): number => Math.round(n * K * K);
const W = (COLS + 2) * S;
const H = (ROWS + 2) * S;

/** Canvas centre of tile (tx, ty) — the apron offset baked in. */
function cx(tx: number): number {
  return (tx + 1.5) * S;
}
function cy(ty: number): number {
  return (ty + 1.5) * S;
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A colour as 0..1 components — the form all the mixing below works in. */
type RGB = readonly [number, number, number];

function rgbOf(hex: number): RGB {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

function css(c: RGB): string {
  const b = (v: number): number => Math.max(0, Math.min(255, Math.round(v * 255)));
  return "rgb(" + b(c[0]) + "," + b(c[1]) + "," + b(c[2]) + ")";
}

/** Linear blend; t = 0 keeps `a`, t = 1 reaches `b`. */
function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Same hue, scaled brightness — the cheap way to get a sibling shade. */
function lit(c: RGB, k: number): RGB {
  return [c[0] * k, c[1] * k, c[2] * k];
}

const walkable = (grid: Grid, x: number, y: number): boolean =>
  y >= 0 && y < ROWS && x >= 0 && x < COLS && grid.cells[y][x] !== "#";

/**
 * Paints the corridor network as a connected ribbon of `width` px.
 *
 * Every walkable tile gets a blob at its centre plus a bar reaching to each
 * walkable neighbour, so the result is continuous through junctions and
 * corners rather than a grid of disconnected squares. Only right and down
 * neighbours are joined — the left/up pairs are drawn by the neighbour's own
 * pass, so each link is painted once.
 */
function paintCorridors(
  ctx: CanvasRenderingContext2D,
  grid: Grid,
  width: number,
  paint: string,
): void {
  ctx.fillStyle = paint;
  const half = width / 2;
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (!walkable(grid, x, y)) continue;
      ctx.fillRect(cx(x) - half, cy(y) - half, width, width);
      if (walkable(grid, x + 1, y)) ctx.fillRect(cx(x) - half, cy(y) - half, S + width, width);
      if (walkable(grid, x, y + 1)) ctx.fillRect(cx(x) - half, cy(y) - half, width, S + width);
    }
  }
}

/** Garden: a trail of rounded stepping stones through a tended lawn. */
function drawStone(ctx: CanvasRenderingContext2D, grid: Grid, base: RGB): void {
  // A garden is PLANTED, so the ground is lawn and the path is a trail of
  // separate stones with grass showing between them — not a paved run. The
  // first pass laid continuous flagstones and read as a patio. A slightly
  // fresher green than the park's, since that is the other grass theme and the
  // two should not be the same picture.
  const lawn = mix(base, [0.3, 0.5, 0.2], 0.87);
  ctx.fillStyle = css(lawn);
  ctx.fillRect(0, 0, W, H);
  const r = rng(0x5709e);
  for (let i = 0; i < density(6600); i++) {
    ctx.fillStyle = css(lit(lawn, 0.64 + r() * 0.68));
    ctx.fillRect(Math.floor(r() * W), Math.floor(r() * H), K, K * (1 + Math.floor(r() * 2)));
  }

  const stone = mix(base, [0.56, 0.55, 0.51], 0.85);
  /** One rounded stone, seated on the grass by its own contact shadow. */
  const step = (px: number, py: number, rx: number, ry: number, rot: number): void => {
    const oval = (ox: number, oy: number, ax: number, ay: number, fill: string): void => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.ellipse(px + ox, py + oy, ax, ay, rot, 0, Math.PI * 2);
      ctx.fill();
    };
    // Shadow first, offset down. Without it a stone reads as a sticker printed
    // on the lawn rather than something lying on it. Kept shallow: a deep one
    // plus a strong highlight turns a stepping stone into a boulder.
    oval(0, ry * 0.12, rx * 1.05, ry * 1.05, css(lit(lawn, 0.72)));
    const face = lit(stone, 0.9 + r() * 0.2);
    oval(0, 0, rx, ry, css(face));
    // A barely-lighter crown — enough to keep it from being a flat disc, not
    // enough to make it a sphere. These are laid IN the lawn, seen from above.
    oval(-rx * 0.12, -ry * 0.14, rx * 0.7, ry * 0.66, css(lit(face, 1.08)));
    // A few grains of darker mineral, which is what stops a stone at this size
    // from reading as a plastic pebble.
    for (let i = 0; i < 4; i++) {
      const a = r() * Math.PI * 2;
      const d = Math.sqrt(r()) * 0.62;
      oval(Math.cos(a) * rx * d, Math.sin(a) * ry * d, rx * 0.13, ry * 0.11, css(lit(face, 0.84)));
    }
  };

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (!walkable(grid, x, y)) continue;
      // Well under half a tile across, so consecutive stones never touch and
      // the trail stays a trail — that gap, and the grass in it, IS the effect.
      const rx = S * (0.23 + r() * 0.05);
      step(
        cx(x) + (r() - 0.5) * S * 0.12,
        cy(y) + (r() - 0.5) * S * 0.12,
        rx,
        rx * (0.8 + r() * 0.3),
        r() * Math.PI,
      );
      // Every so often a pebble alongside, which breaks the one-per-tile
      // rhythm that would otherwise read as a grid of dots.
      if (r() < 0.24) {
        const pr = S * (0.09 + r() * 0.05);
        step(
          cx(x) + (r() - 0.5) * S * 0.66,
          cy(y) + (r() - 0.5) * S * 0.66,
          pr,
          pr * (0.8 + r() * 0.3),
          r() * Math.PI,
        );
      }
    }
  }
}

/** Forest: bare earth everywhere, with clods and dry leaf litter. */
function drawEarth(ctx: CanvasRenderingContext2D, base: RGB): void {
  ctx.fillStyle = css(base);
  ctx.fillRect(0, 0, W, H);
  const r = rng(0xea27);
  // Clods, both lighter and darker than the ground, so the surface breaks up
  // in both directions instead of only accumulating shadow.
  for (let i = 0; i < density(900); i++) {
    const rad = K * (1 + r() * 4);
    ctx.fillStyle = css(lit(base, 0.6 + r() * 0.75));
    ctx.beginPath();
    ctx.arc(r() * W, r() * H, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  // Leaf litter: small elongated flecks in dry ochre — the one thing here that
  // is a different HUE and not just a different brightness.
  const leaf = mix(base, [0.62, 0.44, 0.14], 0.6);
  for (let i = 0; i < density(300); i++) {
    ctx.fillStyle = css(lit(leaf, 0.75 + r() * 0.5));
    ctx.fillRect(r() * W, r() * H, K * (1 + r() * 3), K);
  }
}

/** Beach: fine grain plus wind ripples. */
function drawSandFloor(ctx: CanvasRenderingContext2D, base: RGB): void {
  ctx.fillStyle = css(base);
  ctx.fillRect(0, 0, W, H);
  const r = rng(0x5a11d);
  // Ripples: long shallow waves, the read that separates sand from noise. Each
  // is a shadow line with a lit crest just above it, which is what gives the
  // surface a direction instead of a texture.
  ctx.lineWidth = 1.5 * K;
  // Ripple COUNT scales linearly: they span the width, so their density is
  // per-row, not per-area.
  for (let i = 0; i < Math.round(46 * K); i++) {
    const y0 = r() * H;
    const wobble = 3 + r() * 2;
    const wave = (x: number): number => y0 + Math.sin((x / W) * Math.PI * wobble + i) * 3 * K;
    for (const [dy, k] of [
      [0, 0.74],
      [-2 * K, 1.16],
    ] as const) {
      ctx.strokeStyle = css(lit(base, k));
      ctx.beginPath();
      for (let x = 0; x <= W; x += 6 * K) {
        if (x === 0) ctx.moveTo(x, wave(x) + dy);
        else ctx.lineTo(x, wave(x) + dy);
      }
      ctx.stroke();
    }
  }
  for (let i = 0; i < density(5200); i++) {
    ctx.fillStyle = css(lit(base, 0.8 + r() * 0.42));
    ctx.fillRect(Math.floor(r() * W), Math.floor(r() * H), K, K);
  }
}

/** City park: real grass everywhere, a gravel path only where the dog walks. */
function drawParkGrass(ctx: CanvasRenderingContext2D, grid: Grid, base: RGB): void {
  // The lawn is GREEN, not a shade of the palette's tan. This is the whole
  // reason these textures carry colour: the theme keeps its warm floor tone for
  // the gravel, and the planted half gets the hue it actually needs.
  const lawn = mix(base, [0.24, 0.44, 0.16], 0.88);
  ctx.fillStyle = css(lawn);
  ctx.fillRect(0, 0, W, H);
  const r = rng(0x9a55);
  // Grass: short blades, light and dark, dense.
  for (let i = 0; i < density(6200); i++) {
    ctx.fillStyle = css(lit(lawn, 0.62 + r() * 0.7));
    ctx.fillRect(Math.floor(r() * W), Math.floor(r() * H), K, K * (1 + Math.floor(r() * 2)));
  }
  // The path is NARROWER than the corridor (0.55 of a tile), so grass shows
  // along both verges — that strip of green either side of the walking line is
  // the whole idea, and a full-tile path would erase it.
  const gravel = mix(base, [0.76, 0.69, 0.55], 0.7);
  paintCorridors(ctx, grid, S * 0.46, css(gravel));
  // Grit, clipped to the path by simply re-rolling inside it.
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (!walkable(grid, x, y)) continue;
      for (let i = 0; i < density(14); i++) {
        ctx.fillStyle = css(lit(gravel, 0.72 + r() * 0.44));
        ctx.fillRect(cx(x) - S * 0.22 + r() * S * 0.44, cy(y) - S * 0.22 + r() * S * 0.44, K, K);
      }
    }
  }
}

/** Night city: asphalt lanes with a dashed centre line. */
function drawRoad(ctx: CanvasRenderingContext2D, grid: Grid, base: RGB): void {
  // Off-road is pavement — lifted off the palette so the kerb line reads.
  ctx.fillStyle = css(mix(base, [1, 1, 1], 0.24));
  ctx.fillRect(0, 0, W, H);
  const asphalt = mix(base, [0.08, 0.08, 0.1], 0.74);
  paintCorridors(ctx, grid, S, css(asphalt));
  const r = rng(0x20ad);
  for (let i = 0; i < density(3000); i++) {
    ctx.fillStyle = css(lit(asphalt, 0.7 + r() * 0.75));
    ctx.fillRect(Math.floor(r() * W), Math.floor(r() * H), K, K);
  }
  // Dashes down the middle of each straight run. Junctions are skipped: a dash
  // through a crossroads reads as a mistake, and real roads leave them clear.
  // This near-white is only reachable because the map carries colour — as a
  // luminance map it came out at the floor's own 0.22 and vanished.
  ctx.fillStyle = css([0.95, 0.93, 0.82]);
  const D = S * 0.34;
  const T = Math.max(K, Math.round(S * 0.12));
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (!walkable(grid, x, y)) continue;
      const h = walkable(grid, x - 1, y) && walkable(grid, x + 1, y);
      const v = walkable(grid, x, y - 1) && walkable(grid, x, y + 1);
      if (h === v) continue; // a junction, a corner, or a dead end — leave clear
      if (h) ctx.fillRect(cx(x) - D / 2, cy(y) - T / 2, D, T);
      else ctx.fillRect(cx(x) - T / 2, cy(y) - D / 2, T, D);
    }
  }
}

/**
 * Builds the floor texture for `kind`, or null for "flat".
 *
 * `baseHex` is the theme's own floor colour, painted in as the ground — see the
 * header. The caller must then leave the material white, or the tint lands
 * twice.
 *
 * NOT cached: these depend on the maze grid AND the palette, so a cache keyed
 * by kind alone would hand level 2 the level-1 layout painted into its floor.
 * The caller owns disposal — see board.ts's syncBoardMaterials.
 */
export function floorTextureFor(
  kind: FloorTextureKind,
  grid: Grid,
  baseHex: number,
): THREE.Texture | null {
  if (kind === "flat") return null;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  if (!ctx) return null;

  const base = rgbOf(baseHex);
  if (kind === "stone") drawStone(ctx, grid, base);
  else if (kind === "earth") drawEarth(ctx, base);
  else if (kind === "sand") drawSandFloor(ctx, base);
  else if (kind === "parkGrass") drawParkGrass(ctx, grid, base);
  else drawRoad(ctx, grid, base);

  const tex = new THREE.CanvasTexture(c);
  // No repeat: this texture IS the board, mapped 1:1 onto the floor plane.
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}
