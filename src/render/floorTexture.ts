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
import { css, lit, mix, rgbOf, rng, type RGB } from "./paint";

/** Which surface a theme's floor wears. */
export type FloorTextureKind = "flat" | "lawn" | "earth" | "sand" | "parkGrass" | "road";

/**
 * Pixels per maze tile, on the board.
 *
 * 32, not 16: the garden's stepping stones are ELLIPSES, and at 16 they came
 * out as mush once the camera got close — one texture is stretched over the
 * whole ~21-unit plane. Every feature size below is a fraction of a tile and
 * every scatter is counted PER TILE, so this is a pure resolution knob: raise
 * it and the same picture comes out crisper, never restyled. That is what lets
 * a showcase patch run at a much higher one (see PREVIEW_S) without any of the
 * surfaces needing to know. Costs 672x736 (~1.9 MB RGBA) here, one live at a
 * time — and nothing on disk, which is the point of drawing these at runtime.
 */
const BOARD_S = 32;

/**
 * Pixels per tile in a showcase patch.
 *
 * Three times the board's, because a showcase magnifies its ground far more
 * than the maze camera ever does: the menu stretches a THREE-tile patch across
 * a disc that fills a third of the screen. At the board's 32 that came out
 * blurred, which reads as a smeared photo — the exact failure the cartoon
 * rewrite was for. A 3x3 patch at 96 is a 288x288 canvas: nothing.
 */
const PREVIEW_S = 96;

/**
 * The canvas being painted, described in TILE terms.
 *
 * The board is one sheet — COLS x ROWS plus a one-tile apron — but the menu
 * and shop showcases need these same surfaces over a HANDFUL of tiles rather
 * than a whole maze, and they have no Grid to derive them from. So every
 * pattern below works through this instead of the board's own dimensions.
 * Feature sizes and densities still come from S/K alone, which is what makes a
 * preview tile and a board tile the same picture at the same scale — the
 * showcase is honest about what the theme will look like underfoot.
 */
interface Sheet {
  cols: number;
  rows: number;
  W: number;
  H: number;
  /** Pixels per tile. Every drawn size is a fraction of this. */
  S: number;
  /** Hairline scale, for the handful of strokes too thin to express in tiles. */
  K: number;
  /** Canvas centre of tile (tx, ty). */
  cx(tx: number): number;
  cy(ty: number): number;
  /** Is tile (tx, ty) corridor? Out of bounds is never walkable. */
  walk(tx: number, ty: number): boolean;
}

/** The real board's sheet: the whole maze plus its one-tile apron. */
function boardSheet(grid: Grid): Sheet {
  return {
    cols: COLS,
    rows: ROWS,
    W: (COLS + 2) * BOARD_S,
    H: (ROWS + 2) * BOARD_S,
    S: BOARD_S,
    K: BOARD_S / 16,
    // The +1.5 is the one-tile apron plus a half-tile to reach the centre.
    cx: (tx) => (tx + 1.5) * BOARD_S,
    cy: (ty) => (ty + 1.5) * BOARD_S,
    walk: (x, y) => y >= 0 && y < ROWS && x >= 0 && x < COLS && grid.cells[y][x] !== "#",
  };
}

/**
 * A showcase sheet: `cells` rows of '#' (wall) and anything else (corridor),
 * edge to edge with NO apron — a preview frames its own patch, so every pixel
 * of the canvas is ground the player will see.
 */
function previewSheet(cells: readonly string[]): Sheet {
  const rows = cells.length;
  const cols = cells[0].length;
  return {
    cols,
    rows,
    W: cols * PREVIEW_S,
    H: rows * PREVIEW_S,
    S: PREVIEW_S,
    K: PREVIEW_S / 16,
    cx: (tx) => (tx + 0.5) * PREVIEW_S,
    cy: (ty) => (ty + 0.5) * PREVIEW_S,
    walk: (x, y) => y >= 0 && y < rows && x >= 0 && x < cols && cells[y][x] !== "#",
  };
}

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
  sh: Sheet,
  width: number,
  paint: string,
): void {
  ctx.fillStyle = paint;
  const half = width / 2;
  for (let y = 0; y < sh.rows; y++) {
    for (let x = 0; x < sh.cols; x++) {
      if (!sh.walk(x, y)) continue;
      ctx.fillRect(sh.cx(x) - half, sh.cy(y) - half, width, width);
      if (sh.walk(x + 1, y)) ctx.fillRect(sh.cx(x) - half, sh.cy(y) - half, sh.S + width, width);
      if (sh.walk(x, y + 1)) ctx.fillRect(sh.cx(x) - half, sh.cy(y) - half, width, sh.S + width);
    }
  }
}
// ---------------------------------------------------------------------------
// THE CARTOON RULE.
//
// The first pass drew these the way a photoreal texture is drawn: thousands of
// one-pixel scatter marks, each a random brightness off a continuous ramp. Up
// close that is grain; at the game camera it averages into mush. Next to a
// beagle built from flat colour fields with hard edges it read as a photograph
// someone had laid down under a cartoon.
//
// So every surface below follows the characters instead:
//
//  1. A FIXED, TINY PALETTE. Three or four tones per surface, named up front
//     and reused — never `lit(base, 0.6 + rnd() * 0.7)`, which is a thousand
//     shades and therefore noise. Flat fields of a few colours is exactly what
//     the cel ramp does to lighting, so the albedo agrees with the shading.
//
//  2. SHAPES, NOT SPECKS. A grass tuft is three tapered blades, a stone is an
//     ellipse with a keyline and one highlight, a leaf is a leaf. Nothing is
//     smaller than a couple of pixels, because anything that is disappears
//     into grain at maze distance.
//
//  3. KEYLINES ON THE HERO SHAPES. Stones and pebbles carry a darker outline,
//     the same trick as the beagle's inverted-hull outline — it is most of
//     what separates "drawn" from "rendered".
//
// Scatter is placed PER TILE rather than as a whole-canvas count, so a
// six-tile showcase patch and a full maze come out at identical density with
// no second number to keep in sync.

/** Places `n` jittered items in every tile, the apron included. */
function perTile(
  sh: Sheet,
  n: number,
  rnd: () => number,
  place: (x: number, y: number, tx: number, ty: number) => void,
): void {
  for (let ty = -1; ty <= sh.rows; ty++) {
    for (let tx = -1; tx <= sh.cols; tx++) {
      for (let i = 0; i < n; i++) {
        place(sh.cx(tx) + (rnd() - 0.5) * sh.S, sh.cy(ty) + (rnd() - 0.5) * sh.S, tx, ty);
      }
    }
  }
}

/**
 * A closed, gently irregular shape — the cartoon stand-in for a cloud of
 * scattered dots. Eight lobes joined by quadratic curves, so it comes out
 * organic but smooth-edged rather than polygonal.
 */
function blob(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rad: number,
  rnd: () => number,
): void {
  const N = 8;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const rr = rad * (0.72 + rnd() * 0.56);
    pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]);
  }
  const mid = (i: number): [number, number] => [
    (pts[i][0] + pts[(i + 1) % N][0]) / 2,
    (pts[i][1] + pts[(i + 1) % N][1]) / 2,
  ];
  ctx.beginPath();
  const [sx, sy] = mid(N - 1);
  ctx.moveTo(sx, sy);
  for (let i = 0; i < N; i++) {
    const [nx, ny] = mid(i);
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], nx, ny);
  }
  ctx.closePath();
  ctx.fill();
}

/** Three tapered blades fanning out of one point — a tuft of grass, drawn. */
function tuft(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  h: number,
  rnd: () => number,
): void {
  for (let i = 0; i < 3; i++) {
    const lean = (i - 1) * 0.42 + (rnd() - 0.5) * 0.3;
    const hh = h * (0.68 + rnd() * 0.5);
    const w = Math.max(1, h * 0.26);
    ctx.beginPath();
    ctx.moveTo(x - w / 2, y);
    ctx.lineTo(x + lean * hh, y - hh);
    ctx.lineTo(x + w / 2, y);
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * A rounded stone: flat face, darker keyline, one highlight.
 *
 * The keyline is the whole point — a few flat tones and an outline is how a
 * cartoon draws a rock, and it survives being shrunk to a dozen pixels in a
 * way a soft gradient does not.
 */
function stone(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  rot: number,
  face: RGB,
  line: RGB,
  hi: RGB,
): void {
  const oval = (ox: number, oy: number, ax: number, ay: number): void => {
    ctx.beginPath();
    ctx.ellipse(x + ox, y + oy, ax, ay, rot, 0, Math.PI * 2);
  };
  oval(0, 0, rx, ry);
  ctx.fillStyle = css(face);
  ctx.fill();
  // ONE ring, kept thin. The first pass drew a contact shadow at 1.06x the
  // radius as well, and the two together made every stone a grey doughnut —
  // shadow rim, keyline, face, highlight, four bands on a shape 16px across.
  // The keyline alone does both jobs: it outlines AND it seats.
  ctx.strokeStyle = css(line);
  ctx.lineWidth = Math.max(1, rx * 0.12);
  ctx.stroke();
  // A crescent, not a blob: a small ellipse pushed up-left and squashed reads
  // as the lit top of a rounded thing at any size.
  oval(-rx * 0.26, -ry * 0.3, rx * 0.42, ry * 0.28);
  ctx.fillStyle = css(hi);
  ctx.fill();
}

/**
 * Garden: lawn, and nothing else.
 *
 * This one has been round the houses. It began as a trail of stepping stones
 * through the grass, which is the obvious thing a garden maze wants — but the
 * corridors are only a tile wide, so ANY path drawn down them competes with
 * the biscuit trail the player is actually reading, and the stones kept
 * winning. A neat diagonal run of flagstones read better than the scattered
 * version it replaced and still lost that fight.
 *
 * So the garden is now the quiet theme: a tended lawn, and the corridors are
 * corridors because of what is NOT planted on them. The other five surfaces
 * carry the detail; this one carries the biscuits. It is also the one grass
 * theme with no path in it, which is what keeps it distinct from the park.
 *
 * That leaves it grid-independent, like `earth` and `sand` — nothing here
 * reads `sh.walk`. It still goes through the same uncached path, since the
 * palette can change under it and the caller owns disposal either way.
 */
function drawLawn(ctx: CanvasRenderingContext2D, sh: Sheet, base: RGB): void {
  // A slightly fresher green than the park's, since that is the other grass
  // theme and the two should not be the same picture.
  const lawn = mix(base, [0.3, 0.5, 0.2], 0.87);
  const dark = lit(lawn, 0.86);
  const light = lit(lawn, 1.16);
  const r = rng(0x5709e);

  ctx.fillStyle = css(lawn);
  ctx.fillRect(0, 0, sh.W, sh.H);

  // Broad tonal patches, and only that. No tufts: at four a tile they were a
  // rash of dark dots, and even at two they read as busy rather than tended.
  // Three flat greens in soft drifts is what a cel-shaded lawn wants — the
  // mown-in banding of a real one, without a single mark small enough to
  // alias into grain at the maze camera.
  perTile(sh, 1, r, (x, y) => {
    if (r() > 0.4) return;
    ctx.fillStyle = css(r() < 0.5 ? dark : light);
    blob(ctx, x, y, sh.S * (0.5 + r() * 0.5), r);
  });
}

/**
 * Forest: bare earth, and nothing on it.
 *
 * It carried dry leaf litter — the one mark in the whole set that was a
 * different HUE rather than a different brightness — and a few keylined
 * pebbles. Both are gone for the reason the garden's stones went: a corridor
 * is one tile wide, so anything scattered along it competes with the biscuit
 * trail, and warm ochre flecks on a dark brown floor pulled the eye hardest of
 * all. The pebbles went with them rather than leaving one lone kind of clutter
 * behind on a floor that is meant to read as bare.
 *
 * What is left is the clods, which are broad enough to be ground rather than
 * things lying on it.
 */
function drawEarth(ctx: CanvasRenderingContext2D, sh: Sheet, base: RGB): void {
  const dark = lit(base, 0.82);
  const light = lit(base, 1.16);
  const r = rng(0xea27);

  ctx.fillStyle = css(base);
  ctx.fillRect(0, 0, sh.W, sh.H);

  // Clods, both lighter and darker than the ground, so the surface breaks up
  // in both directions instead of only accumulating shadow — a handful of
  // readable patches rather than 900 dots.
  perTile(sh, 1, r, (x, y) => {
    if (r() > 0.5) return;
    ctx.fillStyle = css(r() < 0.5 ? dark : light);
    blob(ctx, x, y, sh.S * (0.28 + r() * 0.34), r);
  });
}

/** Beach: wind ripples in clean bands, with the odd shell. */
function drawSandFloor(ctx: CanvasRenderingContext2D, sh: Sheet, base: RGB): void {
  const trough = lit(base, 0.88);
  const crest = lit(base, 1.13);
  const r = rng(0x5a11d);

  ctx.fillStyle = css(base);
  ctx.fillRect(0, 0, sh.W, sh.H);

  // Ripples: long shallow waves, the read that separates sand from noise. Each
  // is a shadow band with a lit crest riding just above it — two flat strokes,
  // not a gradient, so the pair still reads as one rounded ridge once the cel
  // ramp has had its way with the lighting.
  ctx.lineCap = "round";
  const spacing = sh.S * 0.62;
  for (let i = 0; i * spacing < sh.H + spacing; i++) {
    const y0 = i * spacing + (r() - 0.5) * spacing * 0.5;
    const wobble = 2 + r() * 2;
    const phase = r() * Math.PI * 2;
    const amp = sh.S * (0.14 + r() * 0.12);
    const wave = (x: number): number => y0 + Math.sin((x / sh.W) * Math.PI * wobble + phase) * amp;
    for (const [dy, colour, w] of [
      [0, trough, 0.13],
      [-sh.S * 0.1, crest, 0.09],
    ] as const) {
      ctx.strokeStyle = css(colour);
      ctx.lineWidth = sh.S * w;
      ctx.beginPath();
      for (let x = 0; x <= sh.W; x += sh.S * 0.25) {
        if (x === 0) ctx.moveTo(x, wave(x) + dy);
        else ctx.lineTo(x, wave(x) + dy);
      }
      ctx.stroke();
    }
  }

  // Shells and worn pebbles, sparse — the beach's equivalent of the garden's
  // stray pebble, and the only thing on it carrying a keyline.
  const shell = mix(base, [1, 0.96, 0.9], 0.5);
  perTile(sh, 1, r, (x, y) => {
    if (r() > 0.12) return;
    const rx = sh.S * (0.07 + r() * 0.05);
    stone(ctx, x, y, rx, rx * 0.78, r() * Math.PI, shell, lit(shell, 0.66), lit(shell, 1.12));
  });
}

/** City park: real grass everywhere, a gravel path only where the dog walks. */
function drawParkGrass(ctx: CanvasRenderingContext2D, sh: Sheet, base: RGB): void {
  // The lawn is GREEN, not a shade of the palette's tan. This is the whole
  // reason these textures carry colour: the theme keeps its warm floor tone for
  // the gravel, and the planted half gets the hue it actually needs.
  const lawn = mix(base, [0.24, 0.44, 0.16], 0.88);
  const lawnDark = lit(lawn, 0.86);
  const lawnLight = lit(lawn, 1.16);
  const tuftDark = lit(lawn, 0.7);
  const r = rng(0x9a55);

  ctx.fillStyle = css(lawn);
  ctx.fillRect(0, 0, sh.W, sh.H);

  perTile(sh, 1, r, (x, y) => {
    if (r() > 0.32) return;
    ctx.fillStyle = css(r() < 0.5 ? lawnDark : lawnLight);
    blob(ctx, x, y, sh.S * (0.45 + r() * 0.4), r);
  });
  ctx.fillStyle = css(tuftDark);
  perTile(sh, 2, r, (x, y) => tuft(ctx, x, y, sh.S * 0.3, r));
  ctx.fillStyle = css(lawnLight);
  perTile(sh, 1, r, (x, y) => {
    if (r() > 0.5) return;
    tuft(ctx, x, y, sh.S * 0.24, r);
  });

  // The path is NARROWER than the corridor (0.46 of a tile), so grass shows
  // along both verges — that strip of green either side of the walking line is
  // the whole idea, and a full-tile path would erase it.
  //
  // Laid down twice: once fatter in a darker tone, then the gravel inside it.
  // That leaves a clean keyline all the way round the path, which is what
  // stops a flat tan ribbon from reading as a hole cut in the lawn.
  const gravel = mix(base, [0.76, 0.69, 0.55], 0.7);
  const edge = lit(gravel, 0.68);
  paintCorridors(ctx, sh, sh.S * 0.46 + Math.max(2, sh.K * 1.6) * 2, css(edge));
  paintCorridors(ctx, sh, sh.S * 0.46, css(gravel));

  // Grit as actual pebbles, kept on the path by simply re-rolling inside it.
  const grit = [lit(gravel, 0.78), lit(gravel, 1.14)] as const;
  for (let y = 0; y < sh.rows; y++) {
    for (let x = 0; x < sh.cols; x++) {
      if (!sh.walk(x, y)) continue;
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = css(grit[i % 2]);
        ctx.beginPath();
        ctx.ellipse(
          sh.cx(x) + (r() - 0.5) * sh.S * 0.34,
          sh.cy(y) + (r() - 0.5) * sh.S * 0.34,
          sh.S * (0.03 + r() * 0.025),
          sh.S * (0.025 + r() * 0.02),
          r() * Math.PI,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }
  }
}

/** Night city: asphalt lanes with a dashed centre line. */
function drawRoad(ctx: CanvasRenderingContext2D, sh: Sheet, base: RGB): void {
  // Off-road is pavement — lifted off the palette so the kerb line reads.
  const pavement = mix(base, [1, 1, 1], 0.24);
  const asphalt = mix(base, [0.08, 0.08, 0.1], 0.74);
  const worn = lit(asphalt, 1.22);
  const r = rng(0x20ad);

  ctx.fillStyle = css(pavement);
  ctx.fillRect(0, 0, sh.W, sh.H);
  // Paving slabs: a plain grid of joints. Cheap, and it is the one thing that
  // says "pavement" rather than "a lighter bit of road".
  ctx.strokeStyle = css(lit(pavement, 0.88));
  ctx.lineWidth = Math.max(1, sh.K);
  ctx.beginPath();
  for (let x = 0; x <= sh.W; x += sh.S * 0.5) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, sh.H);
  }
  for (let y = 0; y <= sh.H; y += sh.S * 0.5) {
    ctx.moveTo(0, y);
    ctx.lineTo(sh.W, y);
  }
  ctx.stroke();

  paintCorridors(ctx, sh, sh.S, css(asphalt));
  // Worn patches, as a few broad shapes rather than 3,000 grains of grit.
  perTile(sh, 1, r, (x, y, tx, ty) => {
    if (!sh.walk(tx, ty) || r() > 0.3) return;
    ctx.fillStyle = css(worn);
    blob(ctx, x, y, sh.S * (0.22 + r() * 0.2), r);
  });

  // Dashes down the middle of each straight run. Junctions are skipped: a dash
  // through a crossroads reads as a mistake, and real roads leave them clear.
  // This near-white is only reachable because the map carries colour — as a
  // luminance map it came out at the floor's own 0.22 and vanished.
  ctx.fillStyle = css([0.95, 0.93, 0.82]);
  const D = sh.S * 0.34;
  const T = Math.max(sh.K, Math.round(sh.S * 0.12));
  for (let y = 0; y < sh.rows; y++) {
    for (let x = 0; x < sh.cols; x++) {
      if (!sh.walk(x, y)) continue;
      const h = sh.walk(x - 1, y) && sh.walk(x + 1, y);
      const v = sh.walk(x, y - 1) && sh.walk(x, y + 1);
      if (h === v) continue; // a junction, a corner, or a dead end — leave clear
      if (h) ctx.fillRect(sh.cx(x) - D / 2, sh.cy(y) - T / 2, D, T);
      else ctx.fillRect(sh.cx(x) - T / 2, sh.cy(y) - D / 2, T, D);
    }
  }
}

/** Paints `kind` onto `sh` and hands back the texture, or null for "flat". */
function render(kind: FloorTextureKind, sh: Sheet, baseHex: number): THREE.Texture | null {
  if (kind === "flat") return null;
  const c = document.createElement("canvas");
  c.width = sh.W;
  c.height = sh.H;
  const ctx = c.getContext("2d");
  if (!ctx) return null;

  const base = rgbOf(baseHex);
  if (kind === "lawn") drawLawn(ctx, sh, base);
  else if (kind === "earth") drawEarth(ctx, sh, base);
  else if (kind === "sand") drawSandFloor(ctx, sh, base);
  else if (kind === "parkGrass") drawParkGrass(ctx, sh, base);
  else drawRoad(ctx, sh, base);

  const tex = new THREE.CanvasTexture(c);
  // No repeat: the texture IS the surface, mapped 1:1 onto its plane.
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
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
  return render(kind, boardSheet(grid), baseHex);
}

/**
 * The same surface over a small hand-authored patch, for the menu showcase and
 * the shop previews — which have a ground to paint but no maze behind it.
 *
 * `cells` is that patch: '#' is wall, anything else is corridor. It matters,
 * because half of what a floor theme says is said BY the corridors — the
 * garden's stepping stones, the park's gravel walk, the road's lane markings
 * all follow them. A showcase with no walls in its patch would render as an
 * unbroken sheet of path and lose exactly the detail the player is there to
 * look at, so callers pass a patch whose corridors match the ground the
 * camera can actually see.
 *
 * Same disposal contract as floorTextureFor: the caller owns the result.
 */
export function floorPreviewTexture(
  kind: FloorTextureKind,
  cells: readonly string[],
  baseHex: number,
): THREE.Texture | null {
  return render(kind, previewSheet(cells), baseHex);
}
