// OWNER: render-artist (IDEA-066 phase 5 — the world around the maze)
//
// The ground BEYOND the board, as a seamless tiling surface.
//
// WHY IT IS TILED WHERE THE BOARD'S FLOOR IS NOT. floorTexture.ts paints one
// canvas mapped 1:1 onto the board's own plane, because it is GRID-DERIVED —
// the park's gravel walk and the road's lane markings follow the corridors, so
// tile (tx,ty) has to land at a known place on the canvas. Nothing out here is
// grid-derived, and the surround plane is 100 x 80 units: one non-repeating
// canvas at the board's own 32px per tile would be 3200 x 2560, about 33 MB of
// RGBA, for a surface that has no per-tile information to carry. So it tiles,
// and that inverts the floor's caching rule too — this one IS cached by
// kind|colour, because there is no grid to paint into it and therefore no way
// for level 1's corridors to end up in level 2's ground.
//
// EIGHT TILES, NOT FOUR. On screen the surround runs 15-40 px per tile, so a
// 4-tile period is a 60-160 px repeat and reads as wallpaper; 8 is 120-320 px,
// and the props scattered on it carry the rest. At 32 px per tile — the same
// BOARD_S the floor painter uses, deliberately, so the two surfaces are the
// same picture at the same scale and the seam is invisible by construction
// rather than by tuning — that is a 256 x 256 canvas, a quarter of a megabyte.
//
// SEAMLESS IS NOT OPTIONAL and it is the real cost of this module. Every mark
// is drawn NINE times, offset by (+-SIZE, +-SIZE), so anything crossing an edge
// comes back on the far side. Which means every random decision must be made
// BEFORE `wrapped()` is called, or the nine passes draw nine different marks —
// the exact trap wallTexture.ts's own header records.
//
// And it follows the CARTOON rule: a fixed handful of NAMED tones, real shapes,
// nothing under a couple of pixels. The first floor pass in this project used
// per-pixel scatter off a continuous ramp and read as a photograph laid under a
// cel-shaded scene.
import * as THREE from "three";
import { type RGB, css, lit, mix, rgbOf, rng } from "./paint";

/** Which ground the surround wears. Mirrors FloorTextureKind's shape; "flat"
 *  means no map at all, which is what Arcade Night's clean void wants. */
export type SurroundTextureKind = "flat" | "lawn" | "earth" | "sand";

const TILES = 8;
const S = 32; // px per tile — BOARD_S, so the board floor and this match scale
const SIZE = TILES * S; // 256

/** Draw once per wrap offset. Decide everything random BEFORE calling this. */
function wrapped(paint: (dx: number, dy: number) => void): void {
  for (const dx of [-SIZE, 0, SIZE]) for (const dy of [-SIZE, 0, SIZE]) paint(dx, dy);
}

/** A short tuft of grass: three strokes from one root. Two pixels wide at the
 *  shipped resolution, which is the CARTOON rule's floor exactly. */
function tuft(g: CanvasRenderingContext2D, x: number, y: number, h: number, tone: string): void {
  g.strokeStyle = tone;
  g.lineWidth = 2;
  g.lineCap = "round";
  for (const lean of [-0.45, 0, 0.45]) {
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + lean * h * 0.5, y - h * 0.6, x + lean * h, y - h);
    g.stroke();
  }
}

function paintLawn(g: CanvasRenderingContext2D, base: RGB): void {
  const dark = lit(base, 0.88);
  const light = lit(base, 1.1);
  const r = rng(0x5ea1);

  // Broad mown bands. A lawn's one honest large-scale feature, and the only
  // thing here big enough to survive being 15 px a tile.
  g.fillStyle = css(base);
  g.fillRect(0, 0, SIZE, SIZE);
  g.fillStyle = css(mix(base, light, 0.5));
  for (let i = 0; i < TILES; i += 2) g.fillRect(0, i * S, SIZE, S);

  // Soft patches, decided up front so all nine passes agree.
  const patches = Array.from({ length: 10 }, () => ({
    x: r() * SIZE,
    y: r() * SIZE,
    rad: S * (0.6 + r() * 0.9),
    tone: css(mix(base, r() < 0.5 ? dark : light, 0.35)),
  }));
  for (const p of patches) {
    wrapped((dx, dy) => {
      g.fillStyle = p.tone;
      g.beginPath();
      g.ellipse(p.x + dx, p.y + dy, p.rad, p.rad * 0.7, 0, 0, Math.PI * 2);
      g.fill();
    });
  }

  const tufts = Array.from({ length: 46 }, () => ({
    x: r() * SIZE,
    y: r() * SIZE,
    h: S * (0.18 + r() * 0.16),
    tone: css(lit(base, 0.78 + r() * 0.1)),
  }));
  for (const t of tufts) wrapped((dx, dy) => tuft(g, t.x + dx, t.y + dy, t.h, t.tone));
}

function paintEarth(g: CanvasRenderingContext2D, base: RGB): void {
  const r = rng(0x3b17);
  g.fillStyle = css(base);
  g.fillRect(0, 0, SIZE, SIZE);

  const patches = Array.from({ length: 16 }, () => ({
    x: r() * SIZE,
    y: r() * SIZE,
    rad: S * (0.4 + r() * 0.8),
    tone: css(lit(base, 0.84 + r() * 0.3)),
  }));
  for (const p of patches) {
    wrapped((dx, dy) => {
      g.fillStyle = p.tone;
      g.beginPath();
      g.ellipse(p.x + dx, p.y + dy, p.rad, p.rad * 0.72, r() * 0, 0, Math.PI * 2);
      g.fill();
    });
  }

  // Leaf litter: short dashes, the forest floor's one readable mark.
  const leaves = Array.from({ length: 40 }, () => ({
    x: r() * SIZE,
    y: r() * SIZE,
    a: r() * Math.PI,
    len: S * (0.14 + r() * 0.1),
    tone: css(mix(base, [0.45, 0.36, 0.2], 0.4 + r() * 0.3)),
  }));
  for (const l of leaves) {
    wrapped((dx, dy) => {
      g.strokeStyle = l.tone;
      g.lineWidth = 2;
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(l.x + dx - Math.cos(l.a) * l.len, l.y + dy - Math.sin(l.a) * l.len);
      g.lineTo(l.x + dx + Math.cos(l.a) * l.len, l.y + dy + Math.sin(l.a) * l.len);
      g.stroke();
    });
  }
}

function paintSand(g: CanvasRenderingContext2D, base: RGB): void {
  const r = rng(0x7c4d);
  g.fillStyle = css(base);
  g.fillRect(0, 0, SIZE, SIZE);

  // Wind ripples. A beach's identity at any distance, and the reason this kind
  // exists at all rather than reusing `earth`.
  const rows = 14;
  for (let i = 0; i < rows; i++) {
    const y = (i / rows) * SIZE;
    const amp = S * (0.12 + r() * 0.1);
    const tone = css(lit(base, i % 2 ? 0.93 : 1.06));
    wrapped((dx, dy) => {
      g.strokeStyle = tone;
      g.lineWidth = 2;
      g.beginPath();
      for (let x = 0; x <= SIZE; x += 8) {
        const yy = y + dy + Math.sin((x / SIZE) * Math.PI * 4 + i) * amp;
        if (x === 0) g.moveTo(x + dx, yy);
        else g.lineTo(x + dx, yy);
      }
      g.stroke();
    });
  }
}

/** kind|baseHex -> texture. Never disposed: a handful of small entries shared
 *  by every board, exactly like wallTextureFor's cache. */
const cache = new Map<string, THREE.Texture>();

export function surroundTextureFor(
  kind: SurroundTextureKind,
  baseHex: number,
): THREE.Texture | null {
  if (kind === "flat") return null;
  const key = `${kind}|${baseHex}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const g = canvas.getContext("2d");
  if (!g) return null;

  // It BAKES the colour in, like every other surface here, so the caller holds
  // its material at white. A map multiplies, so tinting twice is the trap.
  const base = rgbOf(baseHex);
  if (kind === "lawn") paintLawn(g, base);
  else if (kind === "earth") paintEarth(g, base);
  else paintSand(g, base);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  cache.set(key, tex);
  return tex;
}

/** For tests: how many tiles one period of the texture covers, so a caller can
 *  set `repeat` without a second copy of the number. */
export const SURROUND_TEXTURE_TILES = TILES;
