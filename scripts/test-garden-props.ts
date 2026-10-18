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
import { PROP_LIBRARY, PROP_SHAPE_FIELDS, WALL_TOP_SHAPES, getPropDef, type PropParams } from "../src/game/props";
import { seedColorFor } from "../src/editor/propsSeedColors";
import { buildProps, makePropById } from "../src/render/board";
import { buildFence, fencePanelCount, FENCE_H } from "../src/render/fence";
import { buildGroundDetail, GROUND_DETAIL_PARAMS } from "../src/render/groundDetail";
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
section("A placement's scale COMPOSES with the def, and the caps hold anyway");

// IDEA-060 v5. `makePropFromDef` runs `applyPropParts` before returning, so a
// part edit at path "" is an edit to the ROOT — and buildProps/buildWallDecor
// used `mesh.scale.setScalar(placement.scale)`, which threw it away. It was
// not hypothetical: the treehouse def carried `{ path: "", scale: [3,3,3] }`
// and the birdhouse `[1.5,1.5,1.5]`, both authored in the editor's Props tab,
// and BOTH did nothing at all on the board while looking correct in the tab
// that authored them. Asserted as source text because the defect is in how the
// value is written, and a behavioural check needs a def that carries a root
// edit — which, now that the two have been folded into their placements, none
// of them do.
ok(
  "buildProps MULTIPLIES the placement scale in rather than assigning it",
  /mesh\.scale\.multiplyScalar\(placement\.scale\)/.test(boardSrc) &&
    !/mesh\.scale\.setScalar\(/.test(boardSrc),
  "a def-level root part edit must survive being placed",
);

// …and the height-safety caps must still bite, now that they are applied to
// the PRODUCT rather than to the placement's own factor.
function tallestOnRow(ty: number): number {
  const probe = {
    ...garden!,
    placements: [{ propId: "treehouse", tile: [4, ty] as [number, number], offset: [0, 0] as [number, number], rotationY: 0, scale: 2.9 }],
    wallDecor: [],
  };
  const g = new THREE.Group();
  const built = buildProps(g, probe);
  return built ? (built.children[0] as THREE.Object3D).scale.y : NaN;
}
ok("a tall prop on the SOUTH row is still capped", tallestOnRow(ROWS) <= 0.55 + 1e-9,
   String(tallestOnRow(ROWS)));
ok("…and on the NORTH row it keeps every bit of its authored scale",
   Math.abs(tallestOnRow(-1) - 2.9) < 1e-9, String(tallestOnRow(-1)));

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
  // The count is DERIVED from the params, not pinned. It used to assert
  // `> 40 && < 400`, calibrated when `chance` was 0.22 — and IDEA-062 v5 then
  // made `chance`/`apronChance` live knobs on the editor's World tab, so the
  // first person to turn the corridor rocks down (to 0, as it happens: the
  // corridor belongs to the biscuits) failed a suite that has nothing to say
  // about how many rocks a garden wants. Same lesson as the garden's
  // placement counts: a literal that tracks a tuning dial breaks on every
  // tune. What is actually worth asserting is that the scatter OBEYS its
  // dials — so measure the eligible population by forcing both chances to 1
  // and check the shipped count sits where the shipped chances put it.
  const shippedChance = GROUND_DETAIL_PARAMS.chance;
  const shippedApron = GROUND_DETAIL_PARAMS.apronChance;
  GROUND_DETAIL_PARAMS.chance = 1;
  GROUND_DETAIL_PARAMS.apronChance = 1;
  const everyTile = buildGroundDetail(new THREE.Group(), grids[0], "rocks", 0x9c9a90);
  GROUND_DETAIL_PARAMS.chance = shippedChance;
  GROUND_DETAIL_PARAMS.apronChance = shippedApron;
  const eligible = everyTile ? everyTile.count : 0;
  ok("there are eligible tiles to scatter over at all", eligible > 100, String(eligible));
  ok(
    "the scatter obeys its own chance dials",
    rocks.count > 0 && rocks.count <= eligible &&
      rocks.count <= Math.ceil(eligible * Math.max(shippedChance, shippedApron)) + 1,
    `${rocks.count} of ${eligible} eligible at chance ${shippedChance}/${shippedApron}`,
  );

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
// IDEA-066 MOVED THE TREEHOUSES OUT TO THE VERGE, and this assertion did not
// follow them — it kept reading `placements` and went red without anything
// being wrong with the garden. The claim worth making is that the landmark is
// PLANTED, not which of the three concentric layers it ended up on: the verge
// is where IDEA-066 says the big stuff goes, and a treehouse one tile from
// the hedge was the original complaint that started that whole idea.
const houses = [
  ...garden.placements.map((p) => ({ p, layer: "apron" as const })),
  ...garden.verge.map((p) => ({ p, layer: "verge" as const })),
].filter((h) => h.p.propId === "treehouse");
ok("the garden plants at least one treehouse landmark", houses.length >= 1);
// The COUNT is not the rule — Nuno added a second one at the opposite north
// corner, and there is no reason a board should not have two. The rule is
// WHERE: buildProps caps a "tall" prop hard anywhere but the north row, so a
// treehouse placed south or east is silently scaled to 0.55 and there would
// have been no point building it at this size.
// AND THE TWO LAYERS CAP DIFFERENTLY, which is the second half of what this
// assertion got wrong. buildProps caps a "tall" APRON prop on the south row
// and on both east/west columns, leaving only the north row free; buildVerge
// caps only the SOUTH, because the sightline sweep proved north, east and
// west cannot occlude the maze at any height out there — their shadow travels
// away from the board. So "somewhere it is not silently scaled to 0.55" is a
// different tile set per layer, and asserting the apron's answer against a
// verge placement is how this went red without anything being wrong.
for (const { p, layer } of houses) {
  const [tx, ty] = p.tile;
  const uncapped =
    layer === "apron"
      ? ty === -1
      : ty <= ROWS;
  ok(
    `…on ${layer} ground where a tall prop is not scale-capped (${p.tile})`,
    uncapped,
    `tx=${tx} ty=${ty}`,
  );
}
// IDEA-060 v3. The wall tops used to carry 29 STEMMED flower props; they went
// when the wall TEXTURE became a flowering hedge, because two flowering layers
// on one surface is one too many. The defs stay in the library — this was a
// placement decision, not a deletion.
//
// IT MUST TEST THE STEM, NOT THE NAME. The original check was
// `startsWith("flower-")`, which was exact when written and became wrong the
// moment IDEA-065 split the five flowers in two and named the stemless halves
// `flower-head-*` — props created SPECIFICALLY for wall tops, on Nuno's own
// observation that a stemmed flower reads wrong on a hedge crown because its
// stem has nothing to come out of. So the prefix matched exactly the props the
// rule was changed to allow, and the suite went red the first time anyone
// planted one. The rule is about the STEM: `flower-daisy` is out, `flower-head-
// daisy` is in.
const STEMMED_FLOWERS = PROP_LIBRARY.filter((p) => p.shape === "flower").map((p) => p.id);
ok(
  "no STEMMED flower props stand on the wall tops (a stem needs soil)",
  !garden.wallDecor.some((p) => STEMMED_FLOWERS.includes(p.propId)),
);
ok(
  "…and every wall-top prop is a shape WALL_TOP_SHAPES actually allows",
  garden.wallDecor.every((p) => WALL_TOP_SHAPES.includes(getPropDef(p.propId).shape)),
);
ok(
  "…but all five flowers are still in the library, buildable",
  ["daisy", "sunflower", "rose", "tulip", "blossom"].every(
    (k) => PROP_LIBRARY.some((d) => d.id === `flower-${k}`),
  ),
);
// THE LOAD-BEARING ONE. board.ts's buildWallTopDecor gives a theme ONE
// wall-top mechanism or the other and never both, so emptying this array does
// not remove the garden's wall-top decoration — it swaps it for the palette's
// ~40 density bloom spheres, which is the opposite of what taking the flowers
// off was for. The birdhouses are what hold the branch.
ok("the garden's wallDecor is not EMPTY", garden.wallDecor.length > 0);
// IDEA-066: this used to assert EVERY entry was a birdhouse, and the shipped
// data stopped satisfying it the moment Nuno hand-placed two blooms in the
// editor (174eded) -- so `npm run test` was red before this branch started.
// The over-specification was the bug: the rule the comment above states is
// that the BRANCH must be held, and a hand-placed bloom holds it exactly as
// well as a birdhouse. What is worth pinning is that the garden still carries
// its signature wall-top piece; that every entry is a legal wall-top shape is
// already asserted further down, against WALL_TOP_SHAPES.
ok(
  "…and the garden still carries its signature birdhouses",
  garden.wallDecor.some((p) => p.propId === "birdhouse"),
);
ok("the garden still has density blooms available as a palette fallback",
   garden.palette.bloomColors.length > 0 && garden.palette.bloomChance > 0,
   "so the swap above is real, not theoretical");
// A def should never carry a colour override that just restates another
// field's own default — and the editor put the DAISY's colours on the
// sunflower by seeding from a flat table. Caught after it had been saved.
for (const kind of ["sunflower", "rose", "tulip", "blossom"]) {
  const def = PROP_LIBRARY.find((d) => d.id === `flower-${kind}`);
  ok(
    `flower-${kind} does not carry the daisy's petal colour`,
    def?.params.petalColor !== 0xfaf6ec,
    "the editor's colour seed must follow flowerKind, not a constant",
  );
}
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


// ---------------------------------------------------------------------------
section("Every colour field the Props tab offers has a seed");

// THE DEFECT THIS EXISTS FOR HAS SHIPPED TWICE, and the second time it shipped
// six pure-white animals.
//
// The Props tab writes a seed value into `def.params` the moment it builds a
// control for a field the def has not set. For a COLOUR that seed used to fall
// back to `0xffffff`, so adding a colour field to PROP_SHAPE_FIELDS and
// forgetting to register a seed meant: select the prop, and white is written
// into its params; save, and white is in props.ts; and the factory's own
// per-kind palette is now unreachable because a def-level override exists.
//
// IDEA-060 hit it with `petalColor`/`centerColor` seeded from a flat table (a
// sunflower repainted as a daisy). IDEA-065 hit it with `furColor`,
// `bellyColor` and `accentColor` seeded from nothing at all. The flower
// version at least LOOKED like a bug; white looks like a lighting problem,
// which is why it survived a whole review pass.
//
// `seedColorFor` now returns undefined rather than white, and this is the
// check that makes the omission fail the build instead of the board.
const COLOR_FIELD = /Color$|Colors$/;
const seedProblems: string[] = [];
for (const [shape, fields] of Object.entries(PROP_SHAPE_FIELDS)) {
  for (const field of fields) {
    if (!COLOR_FIELD.test(field)) continue;
    // A colour LIST (foliageColors/facadeColors) is a different control with
    // its own seeding; this rule is about the single-colour swatch.
    if (field.endsWith("Colors")) continue;
    // Seed it the way the inspector would, for every kind the shape can be.
    const defs = PROP_LIBRARY.filter((d) => d.shape === shape);
    const cases: PropParams[] = defs.length ? defs.map((d) => d.params) : [{}];
    for (const params of cases) {
      const seed = seedColorFor(field, params);
      if (seed === undefined) {
        seedProblems.push(`${shape}.${String(field)}`);
      } else if (seed === 0xffffff) {
        // Not fatal on its own — a white thing may genuinely be white — but no
        // shipped prop has one, and it is the signature of the defect.
        seedProblems.push(`${shape}.${String(field)} seeds WHITE`);
      }
    }
  }
}
ok(
  "every single-colour prop field has a registered seed",
  seedProblems.length === 0,
  [...new Set(seedProblems)].join(", "),
);

// And the seed must be what the FACTORY would have used, or turning the
// control on silently repaints the prop you are looking at. Spot-checked
// against the two per-kind tables, which are the ones that can drift.
ok(
  "a critter seeds its OWN kind's fur, not another kind's",
  seedColorFor("furColor", { critterKind: "fox" }) !== seedColorFor("furColor", { critterKind: "raccoon" }),
);
ok(
  "a flower seeds its OWN kind's petal, not the daisy's",
  seedColorFor("petalColor", { flowerKind: "sunflower" }) !== seedColorFor("petalColor", { flowerKind: "daisy" }),
);

// A critter def may not DISAGREE with its kind's own palette.
//
// This asked for no override AT ALL until IDEA-065 v10, and that was the
// wrong shape of rule — it went red on a harmless editor action. The Props
// tab writes a seed into `def.params` the moment it builds a colour control
// (the whole subject of propsSeedColors.ts), so merely OPENING the deer's
// colours pinned three values into the def. Since v3 those seeds are the
// kind's own colours, so the pin is redundant rather than wrong, and a suite
// that fails on it teaches people to ignore it.
//
// What has to stay true is that the def never says something DIFFERENT from
// `CRITTER_COLORS`. That still catches the white-seed bug — white is not any
// kind's fur — and it catches the other half the strict rule was protecting:
// retune a kind's palette and a stale pin stops matching, which is exactly
// when someone needs to be told.
for (const d of PROP_LIBRARY.filter((x) => x.shape === "critter")) {
  const kind = String(d.params.critterKind ?? "");
  const disagrees = (["furColor", "bellyColor", "accentColor"] as const).filter((key) => {
    const pinned = d.params[key];
    if (pinned === undefined) return false;
    const map = { furColor: "furColor", bellyColor: "bellyColor", accentColor: "accentColor" } as const;
    return pinned !== seedColorFor(map[key], { critterKind: kind } as PropParams);
  });
  ok(
    `${d.id} never disagrees with its kind's own palette`,
    disagrees.length === 0,
    disagrees
      .map((k) => `${k}=#${Number(d.params[k]).toString(16)} vs the ${kind}'s own`)
      .join(", "),
  );
}


// ---------------------------------------------------------------------------
section("The deer's hind leg is a Z, which is what makes it not a table");

{
  // IDEA-065 v8. Nuno: *"the legs of the deer, they are literally sticks."*
  // They were four constant-radius capsules running hip to floor, and the two
  // things that fixes are both SHAPE invariants rather than tuning numbers —
  // which is the only reason they are asserted here. A deer's hind leg bends
  // backwards at the HOCK and its legs taper from a haunch to a shank; undo
  // either and the animal goes back to a barrel on four dowels, with nothing
  // to error and nothing in any other check to notice.
  const deer = makePropById("critter-deer", 0.17);
  deer.updateMatrixWorld(true);
  // LOCAL positions, not world ones. `makeForestCritter` gives the whole
  // animal a random yaw per instance (so a row of them is a group rather than
  // a rank), which rotates x and z — the first version of this check read
  // world coordinates and reported a correct leg as bending the wrong way.
  // Every leg part is a sibling in the body's own group, so their local
  // positions are already in the one frame where "behind" means anything.
  const at = (name: string): THREE.Vector3 | undefined => {
    let v: THREE.Vector3 | undefined;
    deer.traverse((o) => {
      if (o.name === name && !v) v = o.position.clone();
    });
    return v;
  };

  // `jointedLimb` names a ball per joint, so the chain is readable back off
  // the finished prop without knowing any of its numbers.
  const hip = at("legBRJoint0");
  const stifle = at("legBRJoint1");
  const hock = at("legBRJoint2");
  // The FETLOCK has no knuckle by design — it is the chain's last point and
  // the hoof caps it — so the foot is read off the hoof. The first version of
  // this check asked for `legBRJoint3` and failed a correct model, which is
  // this project's standing rule about suspecting the instrument.
  const fetlock = at("hoofBR");
  ok(
    "the hind leg has its three bending joints plus a hoof",
    [hip, stifle, hock, fetlock].every(Boolean),
    "jointedLimb names one ball per bend",
  );
  if (hip && stifle && hock && fetlock) {
    // The hock is the REARMOST point of the leg, behind both the joint above
    // it and the foot below it. A straight leg has no such point.
    ok(
      "the hock sits behind the stifle above it",
      hock.z < stifle.z - 0.02,
      `hock z ${hock.z.toFixed(3)} vs stifle ${stifle.z.toFixed(3)}`,
    );
    ok(
      "...and behind the fetlock below it",
      hock.z < fetlock.z - 0.01,
      `hock z ${hock.z.toFixed(3)} vs fetlock ${fetlock.z.toFixed(3)}`,
    );
    // And the joints descend, or the chain has folded back on itself.
    ok(
      "the chain runs downward from hip to hoof",
      hip.y > stifle.y && stifle.y > hock.y && hock.y > fetlock.y,
      [hip.y, stifle.y, hock.y, fetlock.y].map((n) => n.toFixed(2)).join(" > "),
    );
  }

  // THE TAPER, read off the cylinders' own parameters rather than measured:
  // a truncated cone knows its two radii, so this cannot drift from what was
  // built.
  const radiusOf = (name: string, end: "top" | "bottom"): number | undefined => {
    let r: number | undefined;
    deer.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.name !== name || r !== undefined) return;
      const p = (m.geometry as THREE.CylinderGeometry).parameters as
        | { radiusTop: number; radiusBottom: number }
        | undefined;
      if (p) r = end === "top" ? p.radiusTop : p.radiusBottom;
    });
    return r;
  };
  // The LAST segment, found rather than typed. The first version named
  // `legBRSeg2` and failed a correct model the moment the chain grew a
  // fetlock — an instrument pinned to a count it does not own.
  let lastSeg = -1;
  deer.traverse((o) => {
    const m = /^legBRSeg(\d+)$/.exec(o.name);
    if (m) lastSeg = Math.max(lastSeg, Number(m[1]));
  });
  const haunch = radiusOf("legBRSeg0", "bottom");
  const shank = radiusOf(`legBRSeg${lastSeg}`, "top");
  // TWO AND A HALF, NOT THREE, BECAUSE THE SUBJECT CHANGED (v11). The cone
  // used to BE the muscle, so its own taper was the whole story and three to
  // one described the shipped value. A deer's thigh is a rounded mass and a
  // truncated cone is a RULED surface — fattened to carry a haunch it reads
  // as a flat slab, which is what v11's first tuning shipped — so the muscle
  // is a blob over the cone now and the cone is slimmer. The threshold has to
  // follow the thing it measures, and what it still refuses is a DOWEL. The
  // haunch check below is where the muscle is asserted.
  ok(
    "the hind leg still tapers from hip to fetlock",
    haunch !== undefined && shank !== undefined && haunch / shank >= 2.5,
    `${haunch?.toFixed(3)} at the hip against ${shank?.toFixed(3)} at the fetlock`,
  );
  // And the HAUNCH is the widest thing on the leg — the reference's own
  // reading, where the limb is a swelling of the body that only becomes a
  // tube below the belly.
  let haunchR = 0;
  deer.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !/^haunch/.test(m.name)) return;
    const g = m.geometry.getAttribute("position");
    let w = 0;
    for (let i = 0; i < g.count; i++) w = Math.max(w, Math.abs(g.getX(i) * m.scale.x));
    haunchR = Math.max(haunchR, w);
  });
  ok(
    "the haunch is a real mass, several times the shank",
    shank !== undefined && haunchR / shank >= 3,
    `haunch ${haunchR.toFixed(3)} against shank ${shank?.toFixed(3)}`,
  );

  // The hooves are the one place `k.dark` reaches the ground, and they are
  // what stops a tapering leg reading as one that was cut off.
  let hooves = 0;
  deer.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && /^hoof/.test(o.name)) hooves++;
  });
  ok("all four feet have a hoof", hooves === 4, `${hooves} found`);
}


// ---------------------------------------------------------------------------
section("Every critter tail is a SOLID, not a tube you can see through");

{
  // IDEA-065 v16. Nuno: *"the tail is transparent."* He was describing a real
  // and measurable defect rather than a material problem: `ringedTail` wound
  // its walls `(a, c, d) / (a, d, b)`, the OPPOSITE orientation to
  // `taperedSweepGeometry`'s, so every wall normal pointed INWARD. A
  // back-facing wall is culled, so the near side of the tail was never drawn
  // and what reached the screen was the inside of the far wall — the body
  // visible straight through the tail, lit from the wrong side.
  //
  // IT IS ASSERTED ON FACE WINDING AND NOT ON A RENDER, because a render is
  // exactly what failed to catch it: an inside-out tube has the same
  // SILHOUETTE as a correct one, so it reads as a slightly oddly shaded tail
  // and nothing more. Three models shipped that way. It is also the SECOND
  // time this project has shipped this winding — `taperedSweepGeometry`
  // carries the first in its own header ("the dog rendered hollow").
  //
  // The test is a centroid proxy, so it asserts a MAJORITY rather than
  // unanimity: the squirrel's plume arcs back over itself far enough that the
  // mesh's own centroid sits outside the tube near the ends. Inverted, the
  // fox measured 518 of 528 faces the wrong way, so this is not a close call.
  for (const id of ["critter-fox", "critter-raccoon", "critter-squirrel"]) {
    const m = makePropById(id, 0.31);
    let found = false;
    m.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || mesh.name !== "tail") return;
      const idx = mesh.geometry.getIndex();
      if (!idx) return;
      found = true;
      const pos = mesh.geometry.getAttribute("position");
      const c = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) c.add(new THREE.Vector3().fromBufferAttribute(pos, i));
      c.divideScalar(pos.count);
      let out = 0;
      let inn = 0;
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      const d = new THREE.Vector3();
      for (let t = 0; t < idx.count; t += 3) {
        a.fromBufferAttribute(pos, idx.getX(t));
        b.fromBufferAttribute(pos, idx.getX(t + 1));
        d.fromBufferAttribute(pos, idx.getX(t + 2));
        const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a));
        const mid = a.clone().add(b).add(d).divideScalar(3).sub(c);
        if (n.dot(mid) > 0) out++;
        else inn++;
      }
      ok(`${id}'s tail faces outward`, out > inn * 4 && out > 50, `outward ${out}, inward ${inn}`);
    });
    ok(`${id} has a tail to check`, found);
  }

  // AND THE FOX'S IS CLOSED. An open tube has two visible rims, and hiding
  // them is what forced its white tip to be a BLOB wider than the final ring
  // — i.e. the one thing that stopped the brush ever coming to a point. A
  // closed surface has every edge shared by exactly two triangles.
  const fox = makePropById("critter-fox", 0.31);
  fox.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || mesh.name !== "tail") return;
    const idx = mesh.geometry.getIndex();
    if (!idx) return;
    const seen = new Map<string, number>();
    for (let t = 0; t < idx.count; t += 3) {
      const v = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)];
      for (let e = 0; e < 3; e++) {
        const pair = [v[e], v[(e + 1) % 3]].sort((p1, p2) => p1 - p2);
        const key = `${pair[0]}:${pair[1]}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
    }
    let open = 0;
    for (const n of seen.values()) if (n !== 2) open++;
    ok("the fox's brush is a closed solid (both ends capped)", open === 0, `${open} unshared edges`);
  });
}


// ---------------------------------------------------------------------------
section("The fox's head is the beagle's parts, each one editable and visible");

{
  // IDEA-065 v17, v18, then v19 — and this guard has been rewritten with each
  // of them, which is the useful thing about it. v17 asserted "there is no
  // separate muzzle" (the head was one sweep). v18 asserted the opposite plus
  // a tangency ratio between muzzle and skull. Both were pinning a SOLUTION,
  // and Nuno has now replaced the solution twice:
  //   *"the snout be only one piece can be difficult to edit now"*
  //   *"lets take the beagle head and make something like that, the same
  //    parts, then I edit the parts on the fox to look more like a fox"*
  //
  // **A TEST MUST NOT PIN NUMBERS ON A PART SOMEBODY IS ACTIVELY AUTHORING.**
  // The head is explicitly a starting point to be tuned in the Props tab, so
  // every shape ratio asserted here would fail on his next save and would be
  // read as a broken build. What is stable is the two things he actually
  // asked for, and one defect this project keeps shipping.
  const fox = makePropById("critter-fox", 0.31);
  fox.updateMatrixWorld(true);
  const named = (n: string): THREE.Object3D | undefined => {
    let hit: THREE.Object3D | undefined;
    fox.traverse((o) => {
      if (o.name === n && !hit) hit = o;
    });
    return hit;
  };

  // 1. THE PIECES ARE SEPARATE, NAMED AND MOVABLE. This is the requirement —
  // a part inside another mesh has no transform of its own and the editor
  // cannot reach it.
  for (const want of [
    "skull",
    "muzzle",
    "bridge",
    "nose",
    "jawMesh",
    "browSwellL",
    "browSwellR",
    "eyeL",
    "eyeR",
    "earL",
    "earR",
  ]) {
    ok(`'${want}' is its own part`, named(want) !== undefined);
  }

  // 2. NOTHING IS ENTIRELY BURIED IN THE SKULL. This project has shipped a
  // part that was built right, coloured right, placed right and behind
  // another surface SIX times (IDEA-057's nori belt, IDEA-058's mouth floor,
  // IDEA-059's flipped band normal, IDEA-060's birdhouse recess, IDEA-065's
  // five-in-one-session, and this idea's own first bridge, which sat 0.13
  // below the skull's crown). It survives any amount of editing, and no
  // render says it.
  const skull = named("skull") as THREE.Mesh | undefined;
  const head = named("head");
  if (skull && head) {
    skull.geometry.computeBoundingBox();
    const bb = skull.geometry.boundingBox!;
    const rx = (bb.max.x - bb.min.x) / 2;
    const ry = (bb.max.y - bb.min.y) / 2;
    const rz = (bb.max.z - bb.min.z) / 2;
    const c = new THREE.Vector3(
      (bb.max.x + bb.min.x) / 2,
      (bb.max.y + bb.min.y) / 2,
      (bb.max.z + bb.min.z) / 2,
    ).add(skull.position);
    const v = new THREE.Vector3();
    for (const want of ["muzzle", "bridge", "nose", "jawMesh", "browSwellL", "cheekL0"]) {
      const m = named(want) as THREE.Mesh | undefined;
      if (!m) continue;
      const pos = m.geometry.getAttribute("position");
      let outside = 0;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        m.localToWorld(v);
        head.worldToLocal(v);
        const d = ((v.x - c.x) / rx) ** 2 + ((v.y - c.y) / ry) ** 2 + ((v.z - c.z) / rz) ** 2;
        if (d > 1) outside++;
      }
      ok(
        `'${want}' is not buried inside the skull`,
        outside > pos.count * 0.03,
        `${outside} of ${pos.count} vertices outside`,
      );
    }
  }

  // 3. THE EAR, which Nuno has signed off (*"the only thing we can reuse is
  // the ears of the fox that are ok"*) and which is rank 1 of the animal.
  const shell = named("earLShell") as THREE.Mesh | undefined;
  ok("the ear has a shell to measure", shell !== undefined);
  if (shell) {
    shell.geometry.computeBoundingBox();
    const bb = shell.geometry.boundingBox!;
    const tall = bb.max.y - bb.min.y;
    const wide = bb.max.x - bb.min.x;
    ok(
      "the ear is a tall triangle, not a horn and not a blade",
      tall / wide > 1.4 && tall / wide < 2.4,
      `${(tall / wide).toFixed(2)} tall-for-wide`,
    );
    // THE INVARIANT IS A BROAD BASE, AND IT TOOK TWO WRONG CHECKS TO SAY SO.
    // First as a ratio between two sampled bands, whose threshold landed
    // exactly on the shipped value and failed a correct ear. Then as WHERE the
    // maximum sits — which sounds like the shape and is not, because the fox
    // profile and the rabbit profile both peak at 32% of the height, so that
    // one PASSED on the re-injected defect.
    const pos = shell.geometry.getAttribute("position");
    let widest = 0;
    let atBase = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = Math.abs(pos.getX(i));
      widest = Math.max(widest, x);
      if (pos.getY(i) - bb.min.y < tall * 0.06) atBase = Math.max(atBase, x);
    }
    ok(
      "the ear leaves the head BROAD (a fox's triangle), not on a narrow root (a rabbit's)",
      atBase > widest * 0.7,
      `base ${atBase.toFixed(3)} of a maximum ${widest.toFixed(3)}`,
    );
    ok(
      "the ear's dark back is a material group, not a separate solid",
      shell.geometry.groups.length === 2 && named("earLBack") === undefined,
    );
  }
}

// ---------------------------------------------------------------------------
section("The fox's legs are the beagle's legs, and its feet are on the floor");

{
  // IDEA-065 v20. Nuno: *"lets work on the legs now, lets improve a little bit
  // the legs and the paws, lets make something like the beagle legs on the fox
  // too."* Each leg used to be two `jointedLimb` chains plus a paw blob —
  // twelve top-level parts — because a material boundary mid-limb is the one
  // thing a jointed chain cannot express and the fox's stocking is exactly
  // that boundary. One swept mesh with a BAND says it instead.
  //
  // These are the invariants, not the numbers: the head's guard above records
  // why a test on a part somebody is authoring must not pin shape ratios.
  const fox = makePropById("critter-fox", 0.31);
  fox.updateMatrixWorld(true);
  const named = (n: string): THREE.Object3D | undefined => {
    let hit: THREE.Object3D | undefined;
    fox.traverse((o) => {
      if (o.name === n && !hit) hit = o;
    });
    return hit;
  };

  for (const leg of ["legFL", "legFR", "legBL", "legBR"]) {
    const pivot = named(leg);
    ok(`'${leg}' is one editable pivot`, pivot !== undefined && pivot.children.length === 2);
    const mesh = named(`${leg}Mesh`) as THREE.Mesh | undefined;
    ok(
      `'${leg}' carries its stocking as a material group`,
      mesh !== undefined &&
        mesh.geometry.groups.length === 2 &&
        Array.isArray(mesh.material) &&
        mesh.material.length === 2,
    );
  }

  // **A PAW IS WIDER THAN THE SHAFT IT HANGS FROM.** A bulb narrower than the
  // leg above it reads as a leg that was CUT OFF — IDEA-065 v8 learned this on
  // the deer's hooves, where the first pair ran wide, narrow, then a bead. The
  // beagle's paw is about 1.5x its shaft and the fox's is held to the same.
  for (const side of ["FL", "FR", "BL", "BR"]) {
    const paw = named(`paw${side}`) as THREE.Mesh | undefined;
    const mesh = named(`leg${side}Mesh`) as THREE.Mesh | undefined;
    if (!paw || !mesh) {
      ok(`paw${side} and its leg exist`, false);
      continue;
    }
    paw.geometry.computeBoundingBox();
    const pw = (paw.geometry.boundingBox!.max.x - paw.geometry.boundingBox!.min.x) / 2;
    // The shaft at the ankle: the widest |x| among the mesh's lowest vertices.
    const pos = mesh.geometry.getAttribute("position");
    let yMin = Infinity;
    for (let i = 0; i < pos.count; i++) yMin = Math.min(yMin, pos.getY(i));
    let shaft = 0;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) < yMin + 0.05) shaft = Math.max(shaft, Math.abs(pos.getX(i)));
    }
    ok(
      `paw${side} is wider than the leg it hangs from`,
      pw > shaft * 1.2 && pw < shaft * 2.2,
      `paw ${pw.toFixed(3)} against shaft ${shaft.toFixed(3)} (${(pw / shaft).toFixed(2)}x)`,
    );
  }

  // **AND ALL FOUR FEET ARE ON THE FLOOR.** A rest pose is not a floor and
  // only VERTICES say so (IDEA-060 rule 6): the tulip's strap leaf shipped
  // 0.14 units underground and the treehouse's tyre swing 0.023, and no render
  // showed either — a turntable has no floor there. Bounded at BOTH ends,
  // because "not underground" passes happily on a prop hovering in mid-air.
  //
  // MEASURED AGAINST THE MODEL'S OWN HEIGHT, not in world units. A critter is
  // scaled to its kind's standing height, so an absolute threshold is a
  // different threshold on every animal — the first version of this check
  // allowed 0.06 world units and PASSED on a foot re-injected 0.13 model units
  // off the ground, because the scale shrank the error under the bound. Third
  // instrument in this feature to report a pass on a defect it was written
  // for; suspect the instrument first.
  const v = new THREE.Vector3();
  let modelLow = Infinity;
  let modelHigh = -Infinity;
  fox.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const pos = m.geometry.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      m.localToWorld(v);
      modelLow = Math.min(modelLow, v.y);
      modelHigh = Math.max(modelHigh, v.y);
    }
  });
  const height = modelHigh - modelLow;
  // **AND THE ABSOLUTE VERSION OF THIS CHECK IS TAUTOLOGICAL HERE, WHICH IS
  // WORTH KNOWING BEFORE SOMEBODY WRITES IT AGAIN.** `fitToHeight` measures
  // the group's own lowest vertex and re-seats it at y = 0, so "the animal
  // floats" is UNREPRESENTABLE for a critter — lifting all four paws just
  // moves the model down with them. A check for it can never fail, and a test
  // that cannot fail is worse than no test because it reads as coverage. What
  // is left, and what is real, is ONE foot hanging while the others carry the
  // floor.
  for (const side of ["FL", "FR", "BL", "BR"]) {
    const paw = named(`paw${side}`) as THREE.Mesh | undefined;
    if (!paw) continue;
    const pos = paw.geometry.getAttribute("position");
    let low = Infinity;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      paw.localToWorld(v);
      low = Math.min(low, v.y);
    }
    ok(
      `paw${side} rests on the same floor as the rest of the model`,
      low - modelLow < height * 0.03,
      `${(((low - modelLow) / height) * 100).toFixed(1)}% of the model's height above its lowest point`,
    );
  }
}

// ---------------------------------------------------------------------------
section("Every eared critter's ear inner clears its shell");

{
  // IDEA-065 v21. The raccoon's new pointed ear shipped for one render with
  // its inner leaf BURIED: the shell's half-depth at its widest is 0.205 of
  // the ear's length and the inner's is 0.66 of that, so stepping the inner
  // forward by less than their difference leaves its front face inside the
  // shell — and the ear renders as a solid flap with a speck on it. Built
  // right, coloured right, placed right, and behind another surface, which is
  // the defect this project has now shipped SEVEN times.
  //
  // Both parts are children of the same ear pivot, so pivot-local z is the one
  // frame in which "in front of" means anything — the pivot carries the ear's
  // whole tilt, splay and yaw, and in world space those turn a clean
  // comparison into noise.
  const front = (m: THREE.Mesh): number => {
    m.geometry.computeBoundingBox();
    return m.geometry.boundingBox!.max.z + m.position.z;
  };
  for (const id of ["critter-rabbit", "critter-raccoon", "critter-squirrel", "critter-fox"]) {
    const prop = makePropById(id, 0.29);
    let shell: THREE.Mesh | undefined;
    let inner: THREE.Mesh | undefined;
    prop.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (m.name === "earLShell") shell = m;
      if (m.name === "earLInner") inner = m;
    });
    if (!shell || !inner) {
      ok(`${id} has an ear shell and inner`, false);
      continue;
    }
    const sf = front(shell);
    const inf = front(inner);
    ok(
      `${id}'s ear inner stands clear of its shell`,
      inf > sf,
      `inner front ${inf.toFixed(4)} against shell front ${sf.toFixed(4)}`,
    );
  }
}

// ---------------------------------------------------------------------------
section("The raccoon's face carries what the reference does");

{
  // IDEA-065 v21. Nuno, with the reference: pointed ears, the WHITE around the
  // black mask, a snout of two jaws, and three whisker lines a side.
  //
  // Every one of these is a part that can be hidden or deleted in the Props
  // tab, so this asserts PRESENCE and SHAPE, never position — the whole head
  // is his to author and rule 23 records what happens to a test that pins
  // numbers on a part somebody is editing.
  const rac = makePropById("critter-raccoon", 0.29);
  const named = (n: string): THREE.Object3D | undefined => {
    let hit: THREE.Object3D | undefined;
    rac.traverse((o) => {
      if (o.name === n && !hit) hit = o;
    });
    return hit;
  };

  // **THE MASK IS PAINT ON THE SKULL, NOT PARTS ON IT** (v23, Nuno: *"the
  // mask and the browWhite should not be components and be colour pattern on
  // the skull"*). v21 asserted the opposite — that the white was its own part
  // — which was true of the build at the time and is now exactly the thing he
  // asked to be removed. Third guard in this animal's history to have pinned
  // a SOLUTION rather than the requirement; the requirement is that the mask
  // reads in three steps, black / white / fur, and a material group says that
  // without a patch that can come adrift from the surface it sits on.
  for (const gone of ["browWhiteL", "browWhiteR", "maskL", "maskR", "maskBridge"]) {
    ok(`'${gone}' is no longer a separate solid`, named(gone) === undefined);
  }
  const skull = named("skull") as THREE.Mesh | undefined;
  ok(
    "the skull carries fur, mask and white as three material groups",
    skull !== undefined &&
      skull.geometry.groups.length === 3 &&
      Array.isArray(skull.material) &&
      skull.material.length === 3,
    skull ? `${skull.geometry.groups.length} groups` : "no skull",
  );
  // ...and all three are actually USED. A band whose predicate never returns
  // its index leaves an empty group, which is not an error anywhere: the mesh
  // builds, the materials are valid, and the marking is simply absent.
  if (skull) {
    for (const [i, what] of ["fur", "the black mask", "the white surround"].entries()) {
      const grp = skull.geometry.groups.find((g) => g.materialIndex === i);
      ok(`${what} covers a real share of the skull`, grp !== undefined && grp.count > 60, `${grp?.count ?? 0} indices`);
    }
  }
  // **AND THE MASK'S EDGE IS CUT ALONG ITS OWN CURVE, NOT ALONG THE MESH'S
  // GRID** (v24, Nuno: *"behind the eyes the white and black pattern are
  // pixelized, lets make that smooth"*). Assigning whole quads to a band
  // follows edges that already exist, which is exact and is a STAIRCASE;
  // `splitCoatGroups` splits a straddling triangle along the region's true
  // boundary instead, the way the beagle's coat has since IDEA-047.
  //
  // The signature is where the vertices CAN be. A grid cut never creates a
  // vertex — every one of the black group's sits at one of the profile's own
  // heights, so there can be at most as many distinct Y values as the profile
  // has points (18). Splitting makes new vertices wherever the boundary
  // crosses an edge, at arbitrary heights, so there are many more. This also
  // fails if someone swaps back to a per-quad band, whatever resolution they
  // throw at it — which is the point, since resolution is a QUADRATIC bill
  // that never quite gets there.
  if (skull) {
    const pos = skull.geometry.getAttribute("position");
    const black = skull.geometry.groups.find((g) => g.materialIndex === 1);
    const ys = new Set<string>();
    if (black && !skull.geometry.getIndex()) {
      for (let i = black.start; i < black.start + black.count; i++) {
        ys.add(pos.getY(i).toFixed(4));
      }
    }
    ok(
      "the mask's edge is cut along its own curve, not along the mesh grid",
      ys.size > 30,
      `${ys.size} distinct vertex heights in the mask (a grid cut allows at most one per profile point)`,
    );
  }

  // **AND THE SKULL IS NOT A SPHERE.** A raccoon's head is widest at the
  // JOWLS, below the eye, where a sphere's widest point is its equator — and
  // it is wider than it is deep. `blob()` is a scaled sphere and can say the
  // second but not the first.
  if (skull) {
    const pos = skull.geometry.getAttribute("position");
    skull.geometry.computeBoundingBox();
    const bb = skull.geometry.boundingBox!;
    const midY = (bb.max.y + bb.min.y) / 2;
    const tall = bb.max.y - bb.min.y;
    let widestY = 0;
    let widest = 0;
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getZ(i));
      if (r > widest) {
        widest = r;
        widestY = pos.getY(i);
      }
    }
    ok(
      "the skull is widest BELOW its middle, at the jowls",
      widestY < midY - tall * 0.02,
      `widest at ${(((widestY - midY) / tall) * 100).toFixed(1)}% of its height from centre`,
    );
    ok(
      "the skull is wider than it is deep",
      bb.max.x - bb.min.x > (bb.max.z - bb.min.z) * 1.1,
      `${(bb.max.x - bb.min.x).toFixed(3)} wide against ${(bb.max.z - bb.min.z).toFixed(3)} deep`,
    );
  }
  // Two jaws, not one muzzle: here the crease between two solids is the
  // FEATURE, which is the one place in this file that is true.
  ok("the snout has an upper muzzle and a lower jaw", named("muzzle") !== undefined && named("jaw") !== undefined);
  // Three whiskers a side.
  for (const side of ["L", "R"]) {
    let n = 0;
    rac.traverse((o) => {
      if (o.name.startsWith(`whisker${side}`)) n++;
    });
    ok(`three whiskers on the ${side === "L" ? "left" : "right"}`, n === 3, `${n} found`);
  }

  // **POINTED, AND ASSERTED SO A BLOB CANNOT PASS.** `ear()` builds a
  // flattened sphere, which does come to a point at its pole in pure geometry
  // — so "the tip is narrow" is true of a blob too and separates nothing. What
  // does separate them is the width PART WAY UP: at 85% of its height a sphere
  // is still 71% of its maximum width, where a leaf tapering to a point is
  // under a quarter.
  const shell = named("earLShell") as THREE.Mesh | undefined;
  ok("the raccoon has an ear shell to measure", shell !== undefined);
  if (shell) {
    shell.geometry.computeBoundingBox();
    const bb = shell.geometry.boundingBox!;
    const tall = bb.max.y - bb.min.y;
    const pos = shell.geometry.getAttribute("position");
    let widest = 0;
    let high = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = Math.abs(pos.getX(i));
      widest = Math.max(widest, x);
      const t = (pos.getY(i) - bb.min.y) / tall;
      if (t > 0.82 && t < 0.88) high = Math.max(high, x);
    }
    ok(
      "the raccoon's ear tapers to a POINT, not a dome",
      high < widest * 0.35,
      `${((high / widest) * 100).toFixed(0)}% of its width still at 85% of its height`,
    );
  }
}

// ---------------------------------------------------------------------------
section("The raccoon's tail is the fox's brush wearing the raccoon's rings");

{
  // IDEA-065 v22. Nuno: *"lets make one tail with the same shape of the fox
  // but with the stripes pattern of the raccoon."* `ringedTail` already held
  // both halves — a control-point `profile` for the FORM and `bands` for an
  // alternating COLOUR — so the fox takes the first with `tipFrom` and the
  // raccoon takes the first with `bands`.
  const rac = makePropById("critter-raccoon", 0.29);
  let tail: THREE.Mesh | undefined;
  rac.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.name === "tail") tail = m;
  });
  ok("the raccoon has a tail", tail !== undefined);
  if (tail) {
    // The rings: two material groups alternating down the tail.
    ok(
      "the tail carries its rings as two material groups",
      tail.geometry.groups.length === 2 &&
        Array.isArray(tail.material) &&
        tail.material.length === 2,
      `${tail.geometry.groups.length} groups`,
    );
    // Capped, like the fox's. An open tube has two visible rims, and hiding
    // the far one is what used to force a blob onto the end of a brush.
    const idx = tail.geometry.getIndex();
    if (idx) {
      const seen = new Map<string, number>();
      for (let t = 0; t < idx.count; t += 3) {
        const v = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)];
        for (let e = 0; e < 3; e++) {
          const pair = [v[e], v[(e + 1) % 3]].sort((a, b) => a - b);
          seen.set(`${pair[0]}:${pair[1]}`, (seen.get(`${pair[0]}:${pair[1]}`) ?? 0) + 1);
        }
      }
      let open = 0;
      for (const n of seen.values()) if (n !== 2) open++;
      ok("the raccoon's tail is a closed solid (both ends capped)", open === 0, `${open} unshared edges`);
    }
    // THE BRUSH TAPERS TO A POINT, measured on the TIP CAP'S OWN FAN.
    //
    // The first version of this parameterised the tail along Z and failed a
    // correct model at 0.188 against 0.324 — because the tail SWEEPS UP, so
    // its z-extent is not its length and "the last 6% of z" scooped up fat
    // rings from two thirds of the way along. A swept form has no convenient
    // axis, and picking one is how an instrument ends up measuring something
    // else with confidence.
    //
    // `ringedTail` closes the far end with a fan around a single apex vertex,
    // which it pushes LAST — so the apex's own triangle-neighbours are
    // exactly the final ring, whatever the sweep does in between and whatever
    // the ring and radial counts are retuned to. That is the tip, by
    // construction rather than by a threshold.
    const pos = tail.geometry.getAttribute("position");
    const apex = pos.count - 1;
    const a = new THREE.Vector3().fromBufferAttribute(pos, apex);
    const b = new THREE.Vector3();
    let tip = 0;
    if (idx) {
      for (let t = 0; t < idx.count; t += 3) {
        const v = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)];
        if (!v.includes(apex)) continue;
        for (const n of v) {
          if (n === apex) continue;
          tip = Math.max(tip, b.fromBufferAttribute(pos, n).distanceTo(a));
        }
      }
    }
    let fat = 0;
    for (let i = 0; i < pos.count; i++) fat = Math.max(fat, Math.abs(pos.getX(i)));
    ok(
      "the tail comes to a point rather than a stump",
      tip > 0 && tip < fat * 0.25,
      `tip ring ${tip.toFixed(3)} against a widest half-section of ${fat.toFixed(3)}`,
    );
  }
}

// ---------------------------------------------------------------------------
section("The squirrel is the only critter whose tail clears its head");

{
  // IDEA-065 rule 4: these six are separated by SILHOUETTE, not colour, and
  // the squirrel's plume arcing up and OVER its back is the one tail in the
  // set that rises above the head. Three of them are the same tan, so that
  // one fact is most of what tells a squirrel from a raccoon at any size.
  //
  // v22 raised the raccoon's tail into the fox's brush shape, which is
  // exactly the change that could have collapsed the pair — so the rule is
  // pinned from BOTH sides here. An assertion that only said "the raccoon's
  // tail is low" would pass just as well on a squirrel whose plume had been
  // flattened, and the separation would be gone either way.
  const topOf = (prop: THREE.Object3D, name: string): number | undefined => {
    let top: number | undefined;
    prop.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || m.name !== name) return;
      m.geometry.computeBoundingBox();
      const v = new THREE.Vector3(0, m.geometry.boundingBox!.max.y, 0);
      m.localToWorld(v);
      top = top === undefined ? v.y : Math.max(top, v.y);
    });
    return top;
  };
  const headTop = (prop: THREE.Object3D): number | undefined => topOf(prop, "skull");

  for (const [id, above] of [
    ["critter-raccoon", false],
    ["critter-squirrel", true],
  ] as const) {
    const prop = makePropById(id, 0.29);
    prop.updateMatrixWorld(true);
    const t = topOf(prop, "tail");
    const h = headTop(prop);
    if (t === undefined || h === undefined) {
      ok(`${id} has a tail and a skull to compare`, false);
      continue;
    }
    ok(
      above ? `${id}'s tail rises ABOVE its head` : `${id}'s tail stays BELOW its head`,
      above ? t > h : t < h,
      `tail top ${t.toFixed(3)} against skull top ${h.toFixed(3)}`,
    );
  }
}

// ---------------------------------------------------------------------------
section("The squirrel's plume has volume, clumps and ONE colour");

{
  // IDEA-065 v29. Nuno: *"lets start by the tail, in the reference the tails
  // are more volume and more fluffy."*
  //
  // **THE COLOUR CHECK IS THE ONE THAT MATTERS AND IT IS THE LEAST OBVIOUS.**
  // v28's first pass gave the plume a cream band along the outer edge of its
  // curl, reasoning from the cream tip blob it replaced. Neither reference has
  // a pale marking on the tail at all - and because the curl arcs over the
  // back, its outer side is exactly the face the play camera looks down on, so
  // the marking covered the whole visible plume and read as a blanket. Nothing
  // errors: two materials, two groups, a perfectly valid mesh.
  //
  // Asserting "one material" alone would pass on a plume painted entirely in
  // the BELLY cream, which is the same defect with the band widened to 360
  // degrees - so it is pinned against the haunch's own material object.
  const sq = makePropById("critter-squirrel", 0.29);
  sq.updateMatrixWorld(true);
  const findSq = (n: string): THREE.Mesh | undefined => {
    let hit: THREE.Mesh | undefined;
    sq.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.name === n && !hit) hit = m;
    });
    return hit;
  };
  const plume = findSq("tail");
  const haunch = findSq("haunch");
  const bib = findSq("bib");
  if (!plume || !haunch || !bib) {
    ok("the squirrel has a tail, a haunch and a bib to compare", false);
  } else {
    const mats = Array.isArray(plume.material) ? plume.material : [plume.material];
    ok(
      "the squirrel's plume is ONE colour",
      new Set(mats).size === 1 && plume.geometry.groups.length <= 1,
      `${new Set(mats).size} material(s), ${plume.geometry.groups.length} group(s)`,
    );
    ok(
      "and that colour is the body's fur, not the belly cream",
      mats[0] === haunch.material && mats[0] !== bib.material,
    );
    // EVERY GROUP MUST HAVE A MATERIAL. `ringedTail`'s far cap is generated at
    // t = 1 exactly, where the default band rule `floor(t * bands) % 2` is 1
    // even when `bands` is 1 - so a tail asking for no banding at all put its
    // apex fan in a band whose material does not exist, and three.js drew
    // nothing there. A hole in the tip, in silence.
    const orphan = plume.geometry.groups.filter((gr) => (gr.materialIndex ?? 0) >= mats.length);
    ok(
      "no group of the plume points at a material that does not exist",
      orphan.length === 0,
      `${orphan.reduce((n, gr) => n + gr.count / 3, 0)} undrawn triangles`,
    );

    // --- the shape, read off the ring layout the geometry stamps -----------
    //
    // A swept form has no convenient axis, so this reads the RINGS rather than
    // slicing by a coordinate - the trap the raccoon's tip check fell into
    // when it parameterised a tail that sweeps UP along z. `ringedTail` writes
    // (rings, radial) onto the geometry for exactly this; a test that
    // re-derived them from a vertex count would be pinning a number it does
    // not own.
    const info = plume.geometry.userData.tail as
      | { rings: number; radial: number; fluff: { lobes: number } | null }
      | undefined;
    if (!info) {
      ok("the plume's geometry carries its ring layout", false);
    } else {
      const { rings, radial } = info;
      const pos = plume.geometry.getAttribute("position");
      ok(
        "the ring layout accounts for every vertex (the two apexes aside)",
        pos.count === (rings + 1) * radial + 2,
        `${pos.count} against ${(rings + 1) * radial + 2}`,
      );
      /** One ring's radii about its own centroid. */
      const ringAt = (i: number): number[] => {
        const c = new THREE.Vector3();
        const v: THREE.Vector3[] = [];
        for (let j = 0; j < radial; j++) {
          const q = new THREE.Vector3().fromBufferAttribute(pos, i * radial + j);
          v.push(q);
          c.add(q);
        }
        c.divideScalar(radial);
        return v.map((q) => q.distanceTo(c));
      };
      const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length;

      // 1. A BULGE, NOT A TAPER. A straight cone reads as a carrot and a
      //    constant tube as a sausage; the reference's plume is narrow where
      //    it leaves the rump and broad for most of the climb. Bounded at both
      //    ends - a bulge at the very tip is a club.
      let fatIdx = 0;
      let fat = 0;
      for (let i = 0; i <= rings; i++) {
        const r = mean(ringAt(i));
        if (r > fat) {
          fat = r;
          fatIdx = i;
        }
      }
      const tFat = fatIdx / rings;
      ok(
        "the plume is widest well inside its own length",
        tFat > 0.25 && tFat < 0.75,
        `widest at t=${tFat.toFixed(2)}`,
      );
      ok(
        "and it is a real bulge over the root",
        fat > mean(ringAt(0)) * 1.8,
        `${fat.toFixed(3)} against a root of ${mean(ringAt(0)).toFixed(3)}`,
      );

      // 2. IT IS FLUFFED, AND THE CLUMP COUNT IS PINNED. A ring's radius
      //    wanders around its own mean, and how MANY times it crosses that
      //    mean is twice the lobe count - which pins the fluff AND that
      //    `radial` samples it finely enough for the lobes to exist at all.
      //    The surround's conifer serration is the precedent: at one segment
      //    per tooth the cosine is sampled once per period, every sample lands
      //    on the same phase, and the whole feature silently does nothing.
      //
      //    **READ THE RING WITH THE WIDEST SPREAD, NEVER A FIXED ONE.** The
      //    tufts SPIRAL, so where a crest sits relative to a vertex column
      //    changes down the tail - and at six columns per lobe a crest landing
      //    midway between two is sampled at 0.90 of its true height while the
      //    trough between them is sampled at 0.017 above its floor. Measured,
      //    one fixed mid ring reported max/min anywhere from 1.21 to 1.36 and
      //    the convexity ratio from 1.16 to 1.36 on the SAME model, purely by
      //    which ring it picked: a guard that fails on the phase of a sine, in
      //    a project that has already recorded that exact trap once
      //    (`test-editor-board`'s pulsing marker). The best-phase ring is
      //    stable, and it costs the check nothing - a symmetric wave sampled
      //    at an even number of columns per period is exactly as far above its
      //    mean as below it at EVERY phase, so the defect still reads 1.000
      //    wherever it is measured.
      let mid = ringAt(0);
      let spread = 0;
      for (let i = 1; i < rings; i++) {
        const r = ringAt(i);
        const sp = Math.max(...r) / Math.min(...r);
        if (sp > spread) {
          spread = sp;
          mid = r;
        }
      }
      const midMean = mean(mid);
      ok(
        "the plume's cross-section is lobed, not circular",
        spread > 1.2 && spread < 2.2,
        `max/min ${spread.toFixed(3)}`,
      );
      let crossings = 0;
      for (let j = 0; j < radial; j++) {
        if (mid[j] >= midMean !== mid[(j + 1) % radial] >= midMean) crossings++;
      }
      ok(
        "and it has the lobe count it asked for",
        info.fluff !== null && crossings === info.fluff.lobes * 2,
        `${crossings} crossings against ${(info.fluff?.lobes ?? 0) * 2} expected`,
      );

      // 3. THE CLUMPS RUN ALONG IT TOO. Lobes alone are straight ridges, which
      //    is a fluted column. The scallops along the length are what break
      //    them into the handful of fur clumps the reference's outline is made
      //    of, so the mean ring radius must itself wander rather than climb
      //    and fall once.
      const means: number[] = [];
      for (let i = 0; i <= rings; i++) means.push(mean(ringAt(i)));
      let turns = 0;
      for (let i = 1; i < means.length - 1; i++) {
        if (means[i] - means[i - 1] >= 0 !== means[i + 1] - means[i] >= 0) turns++;
      }
      ok(
        "the plume's profile scallops along its length",
        turns >= 3 && turns <= 12,
        `${turns} turning points`,
      );

      // 4. THE TUFTS ARE CONVEX, NOT CREASES. The first build perturbed the
      //    radius with a plain cosine, so every bump bought an equally deep
      //    valley — and a valley cut across a curved surface is a FOLD. The
      //    plume came back a crumpled sheet: right volume, right width, made
      //    of creases, and nothing in the geometry was invalid. A tuft sticks
      //    OUT of a mass, so a ring must rise further above its own mean than
      //    it falls below it.
      //
      //    THE RATIO IS THE EXPONENT, so the threshold is a real bound on it:
      //    `up / down` is `(1 - m) / m` for `tuft`'s own mean m, which runs
      //    1.000 at exponent 1 (the symmetric wave), 1.220 at 1.3, 1.356 at
      //    the shipped 1.5 and 1.607 at 1.9. At 1.25 this passes anything
      //    meaningfully convex and fails the wave it replaced. Read off the
      //    widest-spread ring, for the sampling reason above.
      const up = Math.max(...mid) - midMean;
      const down = midMean - Math.min(...mid);
      ok(
        "the plume's fluff bulges outward rather than denting inward",
        up > down * 1.25,
        `+${up.toFixed(3)} against -${down.toFixed(3)}`,
      );

      // 5. AND THEY SPIRAL. Tufts that sit at the same azimuth on every ring
      //    are not tufts, they are FLUTES running the whole length — the
      //    other half of the crumpled-sheet defect, and the one a silhouette
      //    check cannot see because the outline is identical either way.
      //
      //    **MEASURED AS THE PHASE OF THE LOBE HARMONIC, NOT AS THE ARGMAX.**
      //    The first version took the widest COLUMN of each ring, and it
      //    PASSED the defect it exists for. With `lobes` dividing `radial` the
      //    six peaks land on exact columns, so the maximum is a six-way TIE
      //    and which one wins is decided by float noise — a different one per
      //    ring, which reads as a large random drift on a tail with no spiral
      //    at all. The first Fourier harmonic has a phase whatever the
      //    sampling does, and it is zero-amplitude-safe: an unfluffed tube
      //    gives a constant phase and fails this too.
      //
      //    Accumulated ring to ring rather than measured end to end, because
      //    a crest angle is only unambiguous within one lobe's width — over
      //    the whole tail the true drift is larger than that and an end-to-end
      //    reading wraps.
      const lobes = info.fluff?.lobes ?? 6;
      const crestPhase = (i: number): number => {
        const r = ringAt(i);
        let sx = 0;
        let sy = 0;
        for (let j = 0; j < radial; j++) {
          const a = ((j / radial) * Math.PI * 2) * lobes;
          sx += r[j] * Math.cos(a);
          sy += r[j] * Math.sin(a);
        }
        return Math.atan2(sy, sx);
      };
      let drift = 0;
      for (let i = 1; i < rings; i++) {
        let step = crestPhase(i + 1) - crestPhase(i);
        while (step > Math.PI) step -= Math.PI * 2;
        while (step < -Math.PI) step += Math.PI * 2;
        drift += step;
      }
      ok(
        "the plume's tufts spiral rather than running as straight flutes",
        Math.abs(drift) > 1 && Math.abs(drift) < Math.PI * 4,
        `the lobe phase travels ${drift.toFixed(2)} rad between root and tip`,
      );
    }

    // 4. VOLUME, AGAINST THE BODY RATHER THAN IN ABSOLUTE UNITS - a prop is
    //    placed at any scale, so a threshold in world units is a test of the
    //    placement. Measured on a labelled grid, the explorer reference's
    //    plume is 0.71 of the body's width. Bounded at both ends: a tail wider
    //    than the animal is a problem of its own.
    const spanOf = (m: THREE.Mesh, axis: "x" | "y"): number => {
      m.geometry.computeBoundingBox();
      const b = m.geometry.boundingBox!;
      const sc = axis === "x" ? m.scale.x : m.scale.y;
      return (b.max[axis] - b.min[axis]) * sc;
    };
    const ratio = spanOf(plume, "x") / spanOf(haunch, "x");
    ok(
      "the plume is a mass on the scale of the body, not a rope",
      ratio > 0.6 && ratio < 1.15,
      `tail/haunch width ${ratio.toFixed(3)} (reference 0.71)`,
    );
  }
}

// ---------------------------------------------------------------------------
section("The raccoon has hands and feet, and they are mirror images");

{
  // IDEA-065 v25. Nuno: *"lets focus on the paws, the arms and the feet, lets
  // improve this to look like a really cute paw instead a pill."* A raccoon's
  // hands are its signature — long dark fingers on a small palm — and a
  // capsule says none of it.
  const rac = makePropById("critter-raccoon", 0.29);
  rac.updateMatrixWorld(true);
  const named = (n: string): THREE.Object3D | undefined => {
    let hit: THREE.Object3D | undefined;
    rac.traverse((o) => {
      if (o.name === n && !hit) hit = o;
    });
    return hit;
  };

  for (const n of ["handL", "handR", "palmL", "palmR", "soleL", "soleR"]) {
    ok(`'${n}' exists`, named(n) !== undefined);
  }
  // Matched on the full `<stem><side><index>` name, not a prefix: the toes
  // hang in a group called `toesL`/`toesR`, which `startsWith("toe")` counts
  // as two more toes. The instrument reported 10 on a correct model.
  for (const [stem, want] of [["finger", 8], ["toe", 8]] as const) {
    let n = 0;
    rac.traverse((o) => {
      const tail = o.name.slice(stem.length);
      if (o.name.startsWith(stem) && tail.length === 2 && (tail[0] === "L" || tail[0] === "R") && tail[1] >= "0" && tail[1] <= "9") n++;
    });
    ok(`${want} ${stem}s in total`, n === want, `${n} found`);
  }

  // **THE HAND HANGS INSIDE THE ARM.** props.ts carries a hand-authored
  // position against `armL`/`armR`, so a hand built as a sibling would stay
  // behind wherever the arm is moved to — and nothing would error.
  for (const side of ["L", "R"]) {
    const hand = named(`hand${side}`);
    ok(
      `hand${side} is a child of arm${side}, so it follows a saved arm edit`,
      hand?.parent?.name === `arm${side}`,
      `parent is '${hand?.parent?.name ?? "none"}'`,
    );
  }

  // **WHAT IS NOT ASSERTED HERE, AND WHY** (v27). Two checks lived here and
  // are gone: that the hands are MIRROR IMAGES, and that their fingertips
  // REST ON THE BIB. Both were true of the pose v26 built and both are now
  // wrong requirements — Nuno posed the arms into a WAVE, so one hand is
  // raised and the other crosses the chest, and neither fact survives that.
  //
  // That is the third time a guard on this one animal has pinned a SOLUTION
  // rather than a requirement (v21 asserted the white mask was its own part;
  // v18 asserted the fox's muzzle was not). The pattern is the same every
  // time: the thing asserted was a property of the arrangement that happened
  // to be current, on a prop somebody is actively authoring. Rule 23. What is
  // left below is what the CODE owes regardless of pose.

  // **A FINGER MUST BE THICK ENOUGH TO READ DARK.** A matcap is sampled by
  // the view-space normal, so a thin rod seen side-on has almost every normal
  // in the matcap's outer disk — the BOUNCE colour — and renders nearly WHITE
  // however dark its material is (v25). The fingers shipped that way once.
  // Thickness against LENGTH is the thing that fixes it, so that is the
  // ratio pinned; it is a property of the geometry and survives any pose.
  for (const n of ["fingerL0", "toeL0"]) {
    const f = named(n) as THREE.Mesh | undefined;
    if (!f) {
      ok(`${n} exists`, false);
      continue;
    }
    f.geometry.computeBoundingBox();
    const bb = f.geometry.boundingBox!;
    const len = bb.max.y - bb.min.y;
    const wide = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
    ok(
      `${n} is thick enough to read dark under a matcap`,
      wide / len > 0.4,
      `${(wide / len).toFixed(2)} wide-over-long`,
    );
  }

}

console.log("\n" + "-".repeat(60));
console.log(`GARDEN PROPS: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
