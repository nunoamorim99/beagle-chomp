// IDEA-067: guards the tunnel arch — the hedge portal at the board's two
// crossings.
//
// Headless: it builds the real geometry in Node (the one canvas call in
// archway.ts is guarded for exactly this) and reads two sources as text, so it
// runs in the plain `npm run test` chain rather than needing a browser.
//
// FOUR THINGS IT EXISTS FOR, in order of how much each would cost to find.
//
//  1. THE ARCHES ARE DERIVED FROM THE GRID, SO THE GRID IS WHAT MUST BE
//     ASSERTED — on all THIRTY-SIX real mazes, not on a copy of the rule.
//     `theme.wallDecor` is the cautionary tale: a per-THEME position met a
//     per-MAZE layout and Night City's lamps hung in mid-air over open
//     corridor in 14 of 18 boards for two releases, rendering without a single
//     error (IDEA-060 rule 9). The equivalent failure here would be an arch
//     standing in front of a solid hedge, or a tunnel left unmarked.
//
//  2. A SEED TABLE THAT DISAGREES WITH ITS FACTORY REPAINTS THE PROP. The
//     Props tab writes a field's first value from propsInspector.ts's
//     hand-written FIELD_SEED_DEFAULT; the factory reads ARCH_DEFAULTS. If the
//     two differ then merely turning a control ON changes what is on screen,
//     and a save persists it. This project has shipped that defect twice —
//     IDEA-060's sunflower repainted in the daisy's colours, IDEA-065's six
//     white woodland animals — and both times in the COLOUR half of the
//     tables, which propsSeedColors.ts now guards. This is the NUMERIC half.
//
//  3. A PROP MUST STAND ON THE FLOOR AND FIT ITS TILE. Measured from
//     VERTICES, never `Box3.setFromObject`, which builds each child's box in
//     local space and transforms its eight corners — it over-reported the
//     garden shrub by 56% and the burger by 15%.
//
//  4. THE ARCH MUST READ IN PLAN. This is the one that cost a whole build.
//     The camera looks down 59 degrees, so a pier of height h hides everything
//     within h / tan(59) = 0.6h behind it, and the corridor between the piers
//     is only 0.86 x openW across in the camera's own horizontal heading. A
//     full-height portal — the reference literally — rendered as a plain green
//     slab with the aperture contributing exactly zero pixels. The inequality
//     below is that finding written down, so a future retune of `archRise` or
//     `archCrown` cannot quietly push the piers back up through it.
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { Grid, COLS, ROWS, TILE, worldX, worldZ } from "../src/game/grid";
import { MAZES } from "../src/game/mazes";
import { MAZE_THEMES } from "../src/game/themes";
import { PROP_SHAPE_FIELDS, getPropDef, type PropParams } from "../src/game/props";
import {
  ARCH_DEFAULTS,
  ARCH_PARAMS,
  archTransformFor,
  makeArchway,
  tunnelMouths,
} from "../src/render/archway";
import { buildTunnelArches } from "../src/render/board";

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
function section(title: string): void {
  console.log(`\n${title}`);
}

const garden = MAZE_THEMES.find((t) => t.id === "garden");
if (!garden) throw new Error("test-archway: no garden theme");

// ---------------------------------------------------------------------------
section("The grid is the authority on where an arch stands");

let mouthCounts = new Set<number>();
let allAtRow9 = true;
let allOnSide = true;
for (const rows of MAZES) {
  const grid = new Grid(rows as unknown as string[]);
  const mouths = tunnelMouths(grid);
  mouthCounts.add(mouths.length);
  for (const m of mouths) {
    if (m.ty !== 9) allAtRow9 = false;
    if (!(m.axis === "x" && (m.tx === 0 || m.tx === COLS - 1))) allOnSide = false;
  }
}
ok(
  "every one of the 36 mazes has exactly two tunnel mouths",
  mouthCounts.size === 1 && mouthCounts.has(2),
  `saw ${[...mouthCounts].join("/")}`,
);
ok("both are on row 9", allAtRow9);
ok("both are on the west and east borders", allOnSide);

// The inverse of IDEA-060 rule 9: an arch must never stand in front of a WALL.
let everyMouthIsWalkable = true;
let everyTunnelFound = true;
for (const rows of MAZES) {
  const grid = new Grid(rows as unknown as string[]);
  const found = new Set(tunnelMouths(grid).map((m) => `${m.tx},${m.ty}`));
  for (const m of tunnelMouths(grid)) {
    if (grid.cells[m.ty][m.tx] === "#") everyMouthIsWalkable = false;
  }
  for (let ty = 0; ty < ROWS; ty++) {
    for (const tx of [0, COLS - 1]) {
      if (grid.cells[ty][tx] === "T" && !found.has(`${tx},${ty}`)) everyTunnelFound = false;
    }
  }
}
ok("no arch is placed in front of a wall tile", everyMouthIsWalkable);
ok("and no tunnel in any maze is left unmarked", everyTunnelFound);

const g0 = new Grid(MAZES[0] as unknown as string[]);
const t0 = tunnelMouths(g0).map((m) => archTransformFor(m));
ok(
  "the arch stands OUTSIDE the board's own wall face",
  t0.every((t) => Math.abs(t.x) > Math.abs(worldX(0)) + 0.4),
  t0.map((t) => t.x.toFixed(2)).join(" / "),
);
ok(
  "it is centred on the tunnel row",
  t0.every((t) => Math.abs(t.z - worldZ(9)) < 1e-9),
);
ok(
  "and turned a quarter so it spans the corridor rather than lying along it",
  t0.every((t) => Math.abs(t.rotationY - Math.PI / 2 - ARCH_PARAMS.yaw) < 1e-9),
);
ok(
  "the same grid twice gives the same answer",
  JSON.stringify(tunnelMouths(new Grid(MAZES[0] as unknown as string[]))) ===
    JSON.stringify(tunnelMouths(g0)),
);

// ---------------------------------------------------------------------------
section("The theme chooses WHICH arch, never where");

ok("the garden names a tunnel arch", typeof garden.tunnelArch === "string");
ok(
  "…and it is a real prop of the archway shape",
  getPropDef(garden.tunnelArch ?? "").shape === "archway",
);
ok(
  "a theme without one builds nothing at all",
  buildTunnelArches(new THREE.Group(), g0, { ...garden, tunnelArch: undefined }) === null,
);
const built = buildTunnelArches(new THREE.Group(), g0, garden);
ok("the garden builds one group", built !== null);
ok(
  "…carrying one merged mesh per distinct material, not one per prop",
  (() => {
    if (!built) return false;
    let meshes = 0;
    built.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes++;
    });
    // Two arches, five materials between them; mergeBySignature welds the two
    // copies of each. The ceiling is what catches a future builder quietly
    // calling toon() a sixth time — a failure with no visual symptom at all.
    return meshes > 0 && meshes <= 6;
  })(),
);

// ---------------------------------------------------------------------------
section("The seed table and the factory agree");

const inspectorSrc = readFileSync("src/editor/propsInspector.ts", "utf8");
const seedBlock = inspectorSrc.slice(
  inspectorSrc.indexOf("const FIELD_SEED_DEFAULT"),
  inspectorSrc.indexOf("const FIELD_LABEL"),
);
const pairs: Array<[string, keyof typeof ARCH_DEFAULTS]> = [
  ["archOpening", "opening"],
  ["archRise", "rise"],
  ["archCurve", "curve"],
  ["archPier", "pier"],
  ["archDepth", "depth"],
  ["archCrown", "crown"],
  ["archRibbon", "ribbon"],
  ["archCrest", "crest"],
  ["archBlossoms", "blossoms"],
];
for (const [field, key] of pairs) {
  const m = new RegExp(`${field}:\\s*([0-9.]+)`).exec(seedBlock);
  ok(
    `the Props tab seeds "${field}" with the factory's own default`,
    m !== null && Math.abs(Number(m[1]) - (ARCH_DEFAULTS[key] as number)) < 1e-9,
    m ? `${m[1]} vs ${ARCH_DEFAULTS[key]}` : "not seeded at all",
  );
}

const shipped = getPropDef("hedge-arch").params as PropParams;
for (const [field, key] of pairs) {
  const v = (shipped as unknown as Record<string, number>)[field];
  ok(
    `the shipped "Hedge Arch" spells out "${field}" at the measured value`,
    v !== undefined && Math.abs(v - (ARCH_DEFAULTS[key] as number)) < 1e-9,
    `${v} vs ${ARCH_DEFAULTS[key]}`,
  );
}
for (const [field] of pairs) {
  ok(
    `the Props tab offers "${field}"`,
    (PROP_SHAPE_FIELDS.archway as readonly string[]).includes(field),
  );
}

// ---------------------------------------------------------------------------
section("The mesh itself");

/** World-space vertex bounds. NEVER Box3.setFromObject — see the header. */
function vertexBounds(root: THREE.Object3D): {
  lo: THREE.Vector3;
  hi: THREE.Vector3;
  tris: number;
} {
  root.updateWorldMatrix(true, true);
  const lo = new THREE.Vector3(Infinity, Infinity, Infinity);
  const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const v = new THREE.Vector3();
  let tris = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const pos = mesh.geometry.getAttribute("position");
    tris += pos.count / 3;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      lo.min(v);
      hi.max(v);
    }
  });
  return { lo, hi, tris };
}

const arch = makeArchway(getPropDef("hedge-arch").params as PropParams, 0.37);
const b = vertexBounds(arch);
ok("the arch stands ON the ground", b.lo.y > -0.02, `lo.y = ${b.lo.y.toFixed(4)}`);
ok(
  "it is the authored height",
  Math.abs(b.hi.y - ARCH_DEFAULTS.baseHeight) < 0.25,
  `${b.hi.y.toFixed(3)} vs ${ARCH_DEFAULTS.baseHeight}`,
);
ok(
  "it clears the maze hedge by a real margin — it is the landmark, not a wall",
  b.hi.y > 1.9,
  `${b.hi.y.toFixed(3)}`,
);
// The real limit is THREE TILES: the tunnel corridor plus the wall either
// side of it. Past that the arch is standing on a corridor the beagle uses.
// (The old bound was 2.4, which was the shipped value at the time rather
// than a constraint — and IDEA-067 v2 legitimately grew the feet past it.)
ok(
  "its span straddles the corridor without swallowing its neighbours",
  b.hi.x - b.lo.x > 1.5 && b.hi.x - b.lo.x < 3 * TILE,
  `${(b.hi.x - b.lo.x).toFixed(3)}`,
);
ok(
  "it is shallower than a tile, so it reads as a portal and not a covered way",
  b.hi.z - b.lo.z < 1.0,
  `${(b.hi.z - b.lo.z).toFixed(3)}`,
);
ok(
  "and it is cheap — this is a fixture on every board of every level",
  b.tris < 3000,
  `${b.tris} tris`,
);

// Rule 4: the arch has to read IN PLAN.
{
  const H = ARCH_DEFAULTS.baseHeight;
  const openW = H * ARCH_DEFAULTS.opening;
  const rise = (openW / 2) * ARCH_DEFAULTS.rise;
  const bandT = H * ARCH_DEFAULTS.crown;
  const pierH = H - rise - bandT;
  // 0.6 = 1 / tan(59 degrees); 0.86 = the camera's horizontal heading crossing
  // the corridor, which runs perpendicular to it at the tunnel mouth.
  ok(
    "the piers are low enough that the corridor shows between them",
    pierH / Math.tan((59 * Math.PI) / 180) < 0.86 * openW,
    `hides ${(pierH * 0.6).toFixed(2)} of ${(0.86 * openW).toFixed(2)}`,
  );
  ok(
    "…and still tall enough to read as piers rather than kerbs",
    pierH > 1.0,
    `${pierH.toFixed(2)}`,
  );
}

// Three tunings, and they must be three different ARCHES rather than three
// colourways — that is the whole reason the shape carries a dozen dials.
{
  const ids = ["hedge-arch", "hedge-arch-gothic", "hedge-arch-topiary"];
  const shapes = ids.map((id) => {
    const p = getPropDef(id).params as PropParams;
    const h = ARCH_DEFAULTS.baseHeight * (p.height ?? 1);
    const ow = h * (p.archOpening ?? ARCH_DEFAULTS.opening) * (p.width ?? 1);
    return {
      id,
      aspect: (h / ow).toFixed(3),
      curve: p.archCurve,
      rise: p.archRise,
    };
  });
  ok(
    "the three shipped arches differ in their head CURVE, not only in colour",
    new Set(shapes.map((s) => s.curve)).size === 3,
    shapes.map((s) => `${s.id}:${s.curve}`).join(" "),
  );
  ok(
    "…and in how far each springs",
    new Set(shapes.map((s) => s.rise)).size === 3,
  );
  ok(
    "…and in their overall proportion",
    new Set(shapes.map((s) => s.aspect)).size === 3,
    shapes.map((s) => `${s.id}:${s.aspect}`).join(" "),
  );
}

// ---------------------------------------------------------------------------
section("The save path carries it");

const codegen = readFileSync("src/editor/boardCodegen.ts", "utf8");
ok(
  "boardCodegen writes MazeTheme.tunnelArch",
  /tunnelArch: \$\{str\(theme\.tunnelArch\)\}/.test(codegen),
);
ok(
  "…and cloneWorkingTheme carries it in",
  /tunnelArch: theme\.tunnelArch/.test(codegen),
);
// The three-list contract: SavableFile, vite's allow-list, and the source
// store. A file missing from the second is a 403 on save; one missing from
// the third cannot be READ, which renders as a panel of disabled "not found"
// rows and is how the surround's own sixteen dials shipped dead.
const saveSrc = readFileSync("src/editor/saveFile.ts", "utf8");
const viteSrc = readFileSync("vite.config.ts", "utf8");
const storeSrc = readFileSync("src/editor/sourceStore.ts", "utf8");
for (const file of ["src/render/archway.ts", "src/render/surround.ts"]) {
  ok(`"${file}" is a SavableFile`, saveSrc.includes(`"${file}"`));
  ok(`…and is on vite's write allow-list`, viteSrc.includes(`"${file}"`));
  ok(`…and has a registered source, so the World tab can read it`, storeSrc.includes(`"${file}"`));
}

console.log(`\n${"-".repeat(60)}`);
console.log(`ARCHWAY: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
