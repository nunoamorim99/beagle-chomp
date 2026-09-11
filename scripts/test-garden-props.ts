// IDEA-060: guards the garden rebuild — the fence, the reference-built props,
// and the wall-decor placement rule that turned out to be broken.
//
// Headless: it builds the real geometry in Node (nothing here touches a
// canvas or the DOM) and reads two sources as text, so it runs in the plain
// `npm run test` chain rather than needing a browser.
//
// Three things it exists for, in order of how much they cost to find:
//
//  1. A WALL-TOP PROP MUST BE ON A WALL. `wallDecor` is per-THEME and the wall
//     layout is per-MAZE, and until this run buildWallDecor never checked —
//     so the city's five lamps hung in mid-air over open corridor in 14 to 18
//     of the 18 mazes, one of them in ALL EIGHTEEN. It rendered without a
//     single error and nobody noticed for two releases.
//
//  2. A PROP MUST STAND ON THE FLOOR. Every prop's local origin is its base,
//     and buildProps places it at y = 0 — so a part that dips below its own
//     origin sinks into the ground. The tulip's strap leaves did exactly that
//     (0.14 units under), from a sign error no render would ever show.
//
//  3. THE SHIPPED PROPORTIONS ARE THE MEASURED ONES. Every ratio here comes
//     off .img2threejs/garden-props/measurements.json. They are asserted as
//     BANDS, not equalities — the point is to catch a prop that has drifted
//     into being a different object, not to freeze a tuning number.
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { Grid, COLS, ROWS } from "../src/game/grid";
import { MAZES } from "../src/game/mazes";
import { MAZE_THEMES } from "../src/game/themes";
import { PROP_LIBRARY, PROP_SHAPE_FIELDS, WALL_TOP_SHAPES, getPropDef } from "../src/game/props";
import { buildFence, fencePanelCount, FENCE_H } from "../src/render/fence";
import { buildGroundDetail } from "../src/render/groundDetail";
import { lobedRoughness } from "../src/render/foliage";
import {
  makeBirdhouse,
  makeBroadleafTree,
  makeGardenFlower,
  makeLeafShrub,
  makeTreehouse,
} from "../src/render/gardenProps";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    pass++;
    console.log("  ok   " + name);
  } else {
    fail++;
    console.log("  FAIL " + name + (detail ? "  — " + detail : ""));
  }
}
function section(t: string): void {
  console.log("\n" + t);
}

const grids = MAZES.map((m) => new Grid(m));
const garden = MAZE_THEMES.find((t) => t.id === "garden");
if (!garden) throw new Error("no garden theme");

// ---------------------------------------------------------------------------
section("A wall-top prop is always on a wall");

let floating = 0;
let worst = "";
for (const theme of MAZE_THEMES) {
  for (const p of theme.wallDecor) {
    const [x, y] = p.tile;
    const inBounds = x >= 0 && x < COLS && y >= 0 && y < ROWS;
    if (!inBounds) {
      floating++;
      worst = `${theme.id} ${p.propId} (${x},${y}) is off the grid`;
      continue;
    }
    const walls = grids.filter((g) => g.cells[y][x] === "#").length;
    // The build-time skip means a placement never floats; this asserts the
    // AUTHORING is worth the line, i.e. it shows up in a decent share of the
    // mazes rather than being dead data.
    if (walls < grids.length / 2) {
      floating++;
      worst = `${theme.id} ${p.propId} (${x},${y}) is wall in only ${walls}/${grids.length}`;
    }
  }
}
ok("every authored wall-top tile is a wall in at least half the mazes", floating === 0, worst);

const boardSrc = readFileSync("src/render/board.ts", "utf8");
ok(
  "buildWallDecor SKIPS a tile that is not a wall in the maze being built",
  /if \(grid\.cells\[ty\]\?\.\[tx\] !== "#"\) return;/.test(boardSrc),
  "the guard that stops a lamp hanging over a corridor",
);
ok(
  "…and it takes the grid to do it",
  /export function buildWallDecor\([\s\S]{0,200}?grid: Grid,/.test(boardSrc),
);

// ---------------------------------------------------------------------------
section("The fence");

ok("the garden has one", garden.palette.fence === "picket");
ok(
  "every other theme opts out rather than inheriting it",
  MAZE_THEMES.filter((t) => t.id !== "garden").every((t) => t.palette.fence === "none"),
);
ok("it is shorter than the wall it stands in front of", FENCE_H > 0 && FENCE_H < 0.5,
   "FENCE_H = " + FENCE_H);

for (let i = 0; i < grids.length; i++) {
  const g = grids[i];
  const n = fencePanelCount(g);
  let exposed = 0;
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (g.cells[y][x] !== "#") continue;
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const nx = x + dx;
        const ny = y + dy;
        const wall = ny >= 0 && ny < ROWS && nx >= 0 && nx < COLS && g.cells[ny][nx] === "#";
        if (!wall) exposed++;
      }
    }
  }
  if (i === 0) {
    ok("a panel goes on exactly the exposed wall faces", n === exposed, `${n} vs ${exposed}`);
  }
}

const scene = new THREE.Group();
const fence = buildFence(scene, grids[0], 0xa9743f);
ok("buildFence returns an InstancedMesh", fence instanceof THREE.InstancedMesh);
if (fence) {
  ok("it is ONE draw call for the whole maze", scene.children.length === 1);
  const geo = fence.geometry;
  // The rails are painted darker than the pickets through a vertex colour, so
  // a gap reads as a gap. Without the tonal step across it the whole thing
  // renders as a solid skirting board — which is what the first build did.
  ok("the panel carries vertex colours", geo.getAttribute("color") !== undefined);
  const col = geo.getAttribute("color");
  const shades = new Set<number>();
  for (let i = 0; i < col.count; i++) shades.add(Math.round(col.getX(i) * 100));
  ok("…with two distinct tones, picket and rail", shades.size === 2, [...shades].join("/"));
  const mat = fence.material as THREE.Material & { vertexColors: boolean };
  ok("…and the material actually reads them", mat.vertexColors === true);

  // The pitch has to divide the tile exactly or every tile boundary shows a
  // seam. Measured from the geometry rather than from the constant.
  const pos = geo.getAttribute("position");
  let minX = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    minX = Math.min(minX, pos.getX(i));
    maxX = Math.max(maxX, pos.getX(i));
    maxY = Math.max(maxY, pos.getY(i));
  }
  ok("a panel spans exactly one tile", Math.abs(maxX - minX - 1) < 1e-6, `${maxX - minX}`);
  ok("…and stands FENCE_H tall", Math.abs(maxY - FENCE_H) < 1e-6, `${maxY}`);

  const tris = pos.count / 3;
  // The panel is instanced once per exposed face — ~440 on a real maze — so
  // its triangle count is multiplied by 440 and is a budget number, not a
  // detail preference. The first build ran 5 arc segments and cost 95k.
  ok("the whole maze's fence stays under 70k triangles", tris * fence.count < 70000,
     `${Math.round(tris * fence.count)}`);
}

// ---------------------------------------------------------------------------
section("The ground dressing is geometry, and it stays off the biscuits");

ok("the garden scatters rocks", garden.palette.groundDetail === "rocks");
ok(
  "every other theme opts out rather than inheriting them",
  MAZE_THEMES.filter((t) => t.id !== "garden").every((t) => t.palette.groundDetail === "none"),
);
ok(
  "the garden's floor is plain grass again — the stones are no longer painted into it",
  garden.palette.floorTexture === "lawn",
);
// The kind itself is gone — only the prose recording WHY it went is left, so
// this checks the type and the dispatch rather than the whole file text.
const floorSrc = readFileSync("src/render/floorTexture.ts", "utf8");
ok(
  "…and the painted path is no longer a FloorTextureKind",
  !/export type FloorTextureKind[^;]*gardenPath/.test(floorSrc),
);
ok(
  "…nor a branch anything can still reach",
  !/kind === "gardenPath"/.test(floorSrc),
  "a dead kind carrying a long justification for a decision that was reversed",
);

const rockScene = new THREE.Group();
const rocks = buildGroundDetail(rockScene, grids[0], "rocks", 0x9c9a90);
ok("buildGroundDetail returns an InstancedMesh", rocks instanceof THREE.InstancedMesh);
ok("…and nothing at all for a theme that opts out",
   buildGroundDetail(new THREE.Group(), grids[0], "none", 0x9c9a90) === null);
if (rocks) {
  ok("it is ONE draw call for the whole board", rockScene.children.length === 1);
  ok("it scatters a sensible number", rocks.count > 40 && rocks.count < 400, String(rocks.count));

  // THE RULE THIS FILE EXISTS FOR, on the ground layer. Biscuits sit at tile
  // centres; a rock there would sit under the pellet the player is tracking
  // and, once the pellet is eaten, leave something that still looks like one.
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  let nearest = Infinity;
  let tallest = 0;
  for (let i = 0; i < rocks.count; i++) {
    rocks.getMatrixAt(i, m);
    pos.setFromMatrixPosition(m);
    // Distance from the nearest tile centre, in tiles. worldX/worldZ put a
    // centre on every integer offset from the board's own origin.
    const dx = pos.x - Math.round(pos.x - 0.5 + 0.5) + 0.5 - 0.5;
    const dz = pos.z - Math.round(pos.z - 0.5 + 0.5) + 0.5 - 0.5;
    nearest = Math.min(nearest, Math.hypot(dx, dz));
    tallest = Math.max(tallest, pos.y);
  }
  ok("no rock is closer than a fifth of a tile to a tile centre", nearest > 0.2, nearest.toFixed(3));
  ok("every rock hugs the ground rather than standing in the corridor", tallest < 0.12, tallest.toFixed(3));

  // Grey per-instance tint, so it MULTIPLIES the palette's stone colour rather
  // than replacing it. Written as a full colour while the material also
  // carried one, every rock rendered at colour-squared and read as dirt.
  const ic = rocks.instanceColor;
  ok("per-instance tone is carried as instanceColor", ic !== null);
  if (ic) {
    let grey = true;
    for (let i = 0; i < ic.count; i++) {
      if (Math.abs(ic.getX(i) - ic.getY(i)) > 1e-6 || Math.abs(ic.getY(i) - ic.getZ(i)) > 1e-6) grey = false;
    }
    ok("…and it is GREY, so the palette still owns the hue", grey);
  }
}

// ---------------------------------------------------------------------------
section("Foliage carries the measured leafiness");

// The shrub reference's traced outline has sd/mean = 0.135 where a sphere has
// 0.0. This is the number that made every plant in the game stop being a
// sphere, so it gets an explicit control alongside it.
ok("a shape with no lobing measures zero", lobedRoughness({ amplitude: 0 }) < 1e-9);
const rough = lobedRoughness();
ok("the shipped default lands in the reference's band (0.10-0.145)",
   rough >= 0.1 && rough <= 0.145, rough.toFixed(4));

// ---------------------------------------------------------------------------
section("Every prop stands on the floor and fits its measured proportions");

const SUBJECTS: Array<{
  name: string;
  make: () => THREE.Group;
  /** [min, max] width over height, from measurements.json. */
  ratio: [number, number];
  maxHeight: number;
}> = [
  { name: "garden-shrub", make: () => makeLeafShrub({}, 0.31), ratio: [1.0, 1.35], maxHeight: 0.7 },
  { name: "garden-tree", make: () => makeBroadleafTree({}, 0.42), ratio: [0.78, 1.1], maxHeight: 1.4 },
  // Taller and a touch narrower than the reference's 0.846 since v2 lifted the
  // canopy clear of the roof — a deliberate trade recorded in gardenProps.ts:
  // the red gable is the model's most recognisable feature and burying half of
  // it in leaves to keep a proportion honest is the wrong way round.
  { name: "treehouse", make: () => makeTreehouse({}, 0.5), ratio: [0.75, 0.95], maxHeight: 2.6 },
  { name: "birdhouse", make: () => makeBirdhouse({}, 0.27), ratio: [0.52, 0.72], maxHeight: 0.9 },
  { name: "daisy", make: () => makeGardenFlower({ flowerKind: "daisy" }, 0.2), ratio: [0.4, 0.95], maxHeight: 0.45 },
  { name: "sunflower", make: () => makeGardenFlower({ flowerKind: "sunflower" }, 0.6), ratio: [0.4, 0.95], maxHeight: 0.45 },
  { name: "rose", make: () => makeGardenFlower({ flowerKind: "rose" }, 0.35), ratio: [0.4, 0.95], maxHeight: 0.45 },
  { name: "tulip", make: () => makeGardenFlower({ flowerKind: "tulip" }, 0.75), ratio: [0.28, 0.95], maxHeight: 0.45 },
  { name: "blossom", make: () => makeGardenFlower({ flowerKind: "blossom" }, 0.15), ratio: [0.4, 0.95], maxHeight: 0.45 },
];

const v = new THREE.Vector3();
let tallest = "";
for (const s of SUBJECTS) {
  const g = s.make();
  g.updateMatrixWorld(true);
  const lo = new THREE.Vector3(Infinity, Infinity, Infinity);
  const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  let named = 0;
  let meshes = 0;
  g.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    meshes++;
    if (o.name) named++;
    const pos = o.geometry.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      lo.min(v);
      hi.max(v);
    }
  });
  const w = hi.x - lo.x;
  const h = hi.y - lo.y;
  // MEASURED FROM VERTICES, never from Box3.setFromObject: that builds each
  // mesh's box in local space and transforms its corners, so any child with an
  // off-axis rotation is over-reported — 56% on the shrub, which spins its
  // own mass so two of them are not the same shrub.
  ok(`${s.name} sits on the floor`, lo.y > -0.02, `floor ${lo.y.toFixed(3)}`);
  ok(`${s.name} is ${s.ratio[0]}-${s.ratio[1]} wide over tall`,
     w / h >= s.ratio[0] && w / h <= s.ratio[1], (w / h).toFixed(3));
  ok(`${s.name} is under ${s.maxHeight} tall`, h <= s.maxHeight, h.toFixed(3));
  ok(`${s.name} names every mesh for the part editor`, named === meshes, `${named}/${meshes}`);
  if (h > 1) tallest = s.name;
}
ok("the treehouse is the only prop over a unit tall", tallest === "treehouse", tallest);

// ---------------------------------------------------------------------------
section("The library and the theme agree");

for (const def of PROP_LIBRARY) {
  ok(`"${def.id}" has editor fields declared for its shape`,
     PROP_SHAPE_FIELDS[def.shape] !== undefined && PROP_SHAPE_FIELDS[def.shape].length > 0);
}
for (const p of [...garden.placements, ...garden.wallDecor]) {
  ok(`garden references a real prop: "${p.propId}"`, getPropDef(p.propId).id === p.propId);
}
ok(
  "the garden no longer uses the old sphere-stack shrub or oak",
  ![...garden.placements].some((p) => p.propId === "shrub" || p.propId === "oak"),
);
ok(
  "…while the forest and the park still do, untouched",
  MAZE_THEMES.filter((t) => t.id === "forest" || t.id === "park")
    .some((t) => t.placements.some((p) => p.propId === "shrub" || p.propId === "oak")),
);
ok("exactly one treehouse, and it is the board's landmark",
   garden.placements.filter((p) => p.propId === "treehouse").length === 1);
const th = garden.placements.find((p) => p.propId === "treehouse");
// buildProps caps a "tall" prop hard anywhere but the north row, so a
// treehouse placed south or east would be scaled to 0.55 and there would have
// been no point building it.
ok("…on the north apron row, where a tall prop is not scale-capped",
   th !== undefined && th.tile[1] === -1, th ? `tile ${th.tile}` : "missing");
ok("all five flowers are actually planted",
   ["daisy", "sunflower", "rose", "tulip", "blossom"].every((k) =>
     garden.wallDecor.some((p) => p.propId === `flower-${k}`)));
ok("every wall-top piece is a shape allowed on a wall top",
   garden.wallDecor.every((p) => WALL_TOP_SHAPES.includes(getPropDef(p.propId).shape)));
ok(
  "no two wall-top pieces share a tile",
  new Set(garden.wallDecor.map((p) => p.tile.join(","))).size === garden.wallDecor.length,
);

// ---------------------------------------------------------------------------
section("The props writer emits every PropParams field");

// Same guard, and the same reasoning, as test-board-surfaces.ts's palette
// check: src/editor/propsCodegen.ts lists the fields it emits BY HAND, so a
// new PropParams key that is not in that list is silently dropped from every
// def saved out of the editor's Props tab. The file still compiles and the
// game still runs; the setting just quietly reverts.
const propsSrc = readFileSync("src/game/props.ts", "utf8");
const codegenSrc = readFileSync("src/editor/propsCodegen.ts", "utf8");
const iface = /export interface PropParams \{([\s\S]*?)\n\}/.exec(propsSrc);
ok("PropParams is declared in props.ts", iface !== null);
if (iface) {
  const keys = [...iface[1].matchAll(/^ {2}([A-Za-z][A-Za-z0-9]*)\??:/gm)].map((m) => m[1]);
  ok("found the param fields", keys.length > 10, "got " + keys.length);
  const order = /const PARAM_FIELD_ORDER[\s\S]*?\n\];/.exec(codegenSrc)?.[0] ?? "";
  for (const k of keys) {
    ok(
      `propsCodegen emits "${k}"`,
      order.includes(`"${k}"`),
      "add it to PARAM_FIELD_ORDER, or saved defs will drop it",
    );
  }
}
ok(
  "…and it quotes a STRING field rather than emitting a bare identifier",
  /typeof value === "string"/.test(codegenSrc),
  "flowerKind would otherwise emit as `flowerKind: daisy,` and not compile",
);

console.log("\n" + "-".repeat(60));
console.log(`GARDEN PROPS: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
