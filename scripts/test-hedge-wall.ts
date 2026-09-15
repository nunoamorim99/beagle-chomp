// IDEA-068: guards the hedge wall — the maze wall that stopped being a box.
//
// Headless: it builds the real geometry in Node and reads two sources as text,
// so it runs in the plain `npm run test` chain.
//
// FOUR THINGS IT EXISTS FOR, and three of them are invisible defects — the
// kind this project keeps shipping because the render looks right.
//
//  1. THE SEAM. ~200 tiles share ONE block and butt against each other at
//     their faces. A flank that dents INWARD opens a gap you can see straight
//     through the wall, and a crown that is displaced differently on two
//     abutting edges leaves a step at every tile boundary — a grid, which is
//     the exact thing this feature removes. Both are asserted on the real
//     vertices, including under the 90-degree instance rotations, because the
//     rule has to hold for every pair of tiles that can ever meet.
//
//  2. THE CLEARANCES. `buildHedgeDecor` and `buildWallDecor` put blooms, leaf
//     specks and wall-top props at WALL_H + 0.04 / 0.06 / 0.08. Those are
//     among the tightest numbers in the renderer, and IDEA-068 made the crown
//     move underneath them. A crown that rises ABOVE WALL_H swallows a bloom
//     whole and nothing errors.
//
//  3. THE CORRIDOR. A corridor is one tile and the beagle is ~0.6 across.
//     Every wall face that bulges is bulging INTO a corridor, so the dials
//     have a gameplay ceiling and not merely a taste one.
//
//  4. A BOX THEME IS BYTE-IDENTICAL. Night City's brick and the beach's sand
//     must come back with the geometry they had before this existed — not
//     "close enough", the same.
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { TILE } from "../src/game/grid";
import { MAZE_THEMES } from "../src/game/themes";
import { WALL_H } from "../src/render/board";
import {
  HEDGE_WALL_PARAMS,
  wallGeometry,
  wallHeightScale,
  wallShapeFor,
} from "../src/render/hedgeWall";

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
function section(t: string): void {
  console.log(`\n${t}`);
}

const HALF = TILE / 2;
const EPS = 1e-6;

const hedge = wallGeometry("hedge", WALL_H);
const box = wallGeometry("box", WALL_H);
const hp = hedge.getAttribute("position") as THREE.BufferAttribute;

// ---------------------------------------------------------------------------
section("The seam: ~200 tiles share one block and butt against each other");

// A flank may only ever move OUTWARD. Inward is a hole through the wall: two
// tiles butt at their faces, so outward merely overlaps (invisible, and what a
// hedge does) while inward opens a gap you can see straight through.
{
  let nearest = Infinity;
  for (let i = 0; i < hp.count; i++) {
    const x = hp.getX(i);
    const z = hp.getZ(i);
    if (Math.abs(x) > HALF - 1e-3) nearest = Math.min(nearest, Math.abs(x));
    if (Math.abs(z) > HALF - 1e-3) nearest = Math.min(nearest, Math.abs(z));
  }
  ok(
    "no flank is ever dented inward — outward-only, so neighbours always overlap",
    nearest >= HALF - 1e-6,
    `nearest flank vertex at ${nearest.toFixed(5)} against ${HALF}`,
  );
}

/**
 * The crown height along one edge, in the tile's own frame after `turns`
 * quarter rotations.
 *
 * MEASURED WITH THE BULGE TURNED OFF, and the reason is worth keeping: the
 * flank bulge is at its maximum AT the crown, so a crown edge vertex does not
 * sit at |x| = 0.5 at all — it sits at 0.5 plus whatever the bulge moved it.
 * The first version of this test looked for vertices exactly on the face and
 * found NONE, in all four rotations, and reported a sound model as a broken
 * seam. Zeroing one dial to isolate the other is what `test-garden-props.ts`
 * already does with the rock scatter's two chances; the bulge cannot break the
 * crown seam anyway, because it only moves vertices horizontally and only
 * outward, which the check above pins separately.
 */
function crownEdgeProfile(edge: "x+" | "x-", turns: number, geo: THREE.BufferGeometry): number[] {
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const m = new THREE.Matrix4().makeRotationY((turns * Math.PI) / 2);
  const v = new THREE.Vector3();
  const top = WALL_H / 2;
  const samples = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(m);
    if (v.y < top - HEDGE_WALL_PARAMS.crownDip - 1e-3) continue;
    const want = edge === "x+" ? HALF : -HALF;
    if (Math.abs(v.x - want) > 1e-3) continue;
    // Keyed by |along| so a reversed edge parameter compares like with like —
    // a quarter turn can run the same physical edge the other way, and an EVEN
    // profile is exactly what makes that irrelevant.
    samples.set(Math.abs(v.z).toFixed(4), v.y);
  }
  return [...samples.entries()].sort((a, b) => Number(a[0]) - Number(b[0])).map((e) => e[1]);
}

{
  const savedBulge = HEDGE_WALL_PARAMS.bulge;
  HEDGE_WALL_PARAMS.bulge = 0;
  const flat = wallGeometry("hedge", WALL_H);
  HEDGE_WALL_PARAMS.bulge = savedBulge;

  let worst = 0;
  let worstPair = "";
  let sampled = 0;
  for (let a = 0; a < 4; a++) {
    for (let b = 0; b < 4; b++) {
      const left = crownEdgeProfile("x+", a, flat);
      const right = crownEdgeProfile("x-", b, flat);
      sampled = left.length;
      if (left.length !== right.length || left.length === 0) {
        worst = Infinity;
        worstPair = `turns ${a}/${b}: ${left.length} vs ${right.length} samples`;
        continue;
      }
      for (let i = 0; i < left.length; i++) {
        const d = Math.abs(left[i] - right[i]);
        if (d > worst) {
          worst = d;
          worstPair = `turns ${a}/${b}`;
        }
      }
    }
  }
  ok("the seam test actually sampled an edge", sampled > 0, `${sampled} vertices`);
  ok(
    "the crown matches across a seam for every pair of the four rotations",
    worst < 1e-6,
    `worst ${worst === Infinity ? "n/a" : worst.toFixed(6)} at ${worstPair}`,
  );
  flat.dispose();
}

// ---------------------------------------------------------------------------
section("The clearances everything on the crown depends on");

{
  let highest = -Infinity;
  for (let i = 0; i < hp.count; i++) highest = Math.max(highest, hp.getY(i));
  ok(
    "the crown never rises ABOVE WALL_H — blooms sit at +0.04 and would be swallowed",
    highest <= WALL_H / 2 + 1e-9,
    `highest ${(highest + WALL_H / 2).toFixed(4)} against ${WALL_H}`,
  );
  ok(
    "…and it does actually dip, or the whole feature is a no-op",
    HEDGE_WALL_PARAMS.crownDip > 0.02,
  );
}
{
  // The per-tile height is the OTHER half of the same promise.
  let worstScale = 1;
  for (let h = 0; h <= 1; h += 1 / 64) worstScale = Math.min(worstScale, wallHeightScale(h, "hedge"));
  ok(
    "a tile's crown is never scaled ABOVE its full height either",
    wallHeightScale(0, "hedge") <= 1 && wallHeightScale(1, "hedge") <= 1,
  );
  ok(
    "…and never so low the wall stops reading as a wall",
    worstScale > 0.8,
    `worst ${worstScale.toFixed(3)}`,
  );
}

// ---------------------------------------------------------------------------
section("The corridor a bulge grows into");

{
  let widest = 0;
  for (let i = 0; i < hp.count; i++) {
    widest = Math.max(widest, Math.abs(hp.getX(i)), Math.abs(hp.getZ(i)));
  }
  const corridor = TILE - 2 * (widest - HALF);
  ok(
    "two facing walls still leave the beagle room down a one-tile corridor",
    corridor > 0.72,
    `${corridor.toFixed(3)} against a beagle ~0.6 across`,
  );
  // fence.ts stands its pickets proud at 0.54 and only FENCE_H = 0.3 tall, so
  // the bulge has to be ~nothing at the foot or it swallows them.
  let footWidest = 0;
  for (let i = 0; i < hp.count; i++) {
    if (hp.getY(i) > -WALL_H / 2 + 0.3) continue;
    footWidest = Math.max(footWidest, Math.abs(hp.getX(i)), Math.abs(hp.getZ(i)));
  }
  ok(
    "and the foot stays behind the picket fence, which stands at 0.54",
    footWidest < 0.54,
    `widest below FENCE_H is ${footWidest.toFixed(4)}`,
  );
}

// ---------------------------------------------------------------------------
section("A box theme is untouched, and which themes are which");

{
  const plain = new THREE.BoxGeometry(TILE, WALL_H, TILE);
  const a = box.getAttribute("position").array as Float32Array;
  const b = plain.getAttribute("position").array as Float32Array;
  let same = a.length === b.length;
  if (same) for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > EPS) same = false;
  ok("a box theme gets literally BoxGeometry, not an unmoved hedge block", same);
  ok("…and its tiles are never scaled either", wallHeightScale(0.9, "box") === 1);
}
for (const t of MAZE_THEMES) {
  const shape = wallShapeFor(t.palette.wallTexture);
  const wantsHedge = t.palette.wallTexture === "hedge" || t.palette.wallTexture === "hedgeFlower";
  ok(`"${t.id}" (${t.palette.wallTexture}) gets the ${shape} block`, shape === (wantsHedge ? "hedge" : "box"));
}

{
  const tris = hp.count / 3;
  ok(
    "the block stays cheap — this is multiplied by every wall tile on the board",
    tris <= 260,
    `${tris} tris x ~200 tiles`,
  );
}

// ---------------------------------------------------------------------------
section("The save path carries it");

const saveSrc = readFileSync("src/editor/saveFile.ts", "utf8");
const viteSrc = readFileSync("vite.config.ts", "utf8");
const storeSrc = readFileSync("src/editor/sourceStore.ts", "utf8");
const fieldsSrc = readFileSync("src/editor/worldFields.ts", "utf8");
const f = "src/render/hedgeWall.ts";
ok(`"${f}" is a SavableFile`, saveSrc.includes(`"${f}"`));
ok("…and is on vite's write allow-list", viteSrc.includes(`"${f}"`));
ok("…and has a registered source, so the World tab can read it", storeSrc.includes(`"${f}"`));
for (const key of Object.keys(HEDGE_WALL_PARAMS)) {
  ok(`the World tab exposes "${key}"`, fieldsSrc.includes(`"${key}"`));
}

console.log(`\n${"-".repeat(60)}`);
console.log(`HEDGE WALL: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
