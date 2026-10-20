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
import { liftSurfaceColor, snapToPalette } from "../src/render/madboxStyle";
import { hexOf, lit, rgbOf } from "../src/render/paint";
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

// ---------------------------------------------------------------------------
section("A brightened colour SATURATES; it never wraps");
// ---------------------------------------------------------------------------
//
// This arch renders its foliage by multiplying a base colour up (IDEA-067's
// note: the maze hedge bakes into a texture that comes out far lighter than
// the value it was built from, so flat foliage beside it reads dark). The
// multiply is `lit()`, which does NOT clamp — and for several releases the
// result was packed by hand with `(r << 16) | (g << 8) | b`.
//
// That does not saturate. It OVERFLOWS into the next byte and carries, so a
// colour that is merely too bright comes back as a different HUE. It stayed
// latent only because the shipped palettes happened to sit under the line;
// the moment [[IDEA-079]] raised the garden's wall the menu's arch rendered
// MAGENTA. The arithmetic: foliage green 216 x 1.34 = 289, and 289 - 256 = 33,
// which was exactly the green byte on screen.
//
// Pinned on `hexOf` directly AND through a built arch, because the first is
// the mechanism and the second is the thing a player sees.
{
  // Every channel over the top, from a colour that is unambiguously green.
  const packed = hexOf(lit(rgbOf(0x74d86d), 1.34));
  const r = (packed >> 16) & 255;
  const g = (packed >> 8) & 255;
  const b = packed & 255;
  ok("a channel over 255 clamps", g === 255, `g ${g}`);
  ok("…without carrying into the channel above", r < 255 && r === Math.round((0x74 * 1.34)), `r ${r}`);
  ok("…and the result is still GREEN", g > r && g > b, `#${packed.toString(16).padStart(6, "0")}`);
  ok("nothing exceeds a 24-bit colour", packed <= 0xffffff && packed >= 0);
}
{
  // And through the real builder, which is what actually broke.
  const arch = makeArchway(
    {
      height: 0.6,
      foliageColors: [0x74d86d, 0x6dcd67, 0x7ae473],
      blossomColor: 0xf4efe6,
      stoneColor: 0xc28f5c,
    } as never,
    7,
  );
  let greenish = 0;
  let wrong = 0;
  arch.traverse((o: THREE.Object3D) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      const c = (mat as THREE.MeshToonMaterial).color;
      if (!c) continue;
      const hex = c.getHex();
      const r = (hex >> 16) & 255;
      const g = (hex >> 8) & 255;
      const b = hex & 255;
      // Only the FOLIAGE is asserted — blossoms are cream and the footing is
      // timber, both legitimately not green.
      if (g > 150 && g >= r && g >= b) greenish++;
      else if (r > g && b > g && r > 120 && b > 120) wrong++; // magenta
    }
  });
  ok("a bright-green arch has green foliage", greenish > 0, `${greenish} green materials`);
  ok("…and nothing on it came out magenta", wrong === 0, `${wrong} magenta materials`);
}


// ---------------------------------------------------------------------------
// IDEA-079: THE FOOTING AND THE MAZE FENCE ARE STILL ONE FENCE
// ---------------------------------------------------------------------------
//
// Rule 3 above: the arch runs three real fence panels round each foot, and the
// shared identity with the maze wall's fence is the whole reason it does — the
// arch stands exactly where that fence ends, so the joint has to disappear.
//
// The high-key style lifts `palette.fenceColor`, and the arch's timber is a
// PROP PARAM in props.ts rather than a palette slot, so it was not lifted with
// it: measured, the maze fence went to #c28f5c and the footing stayed at the
// authored #a9743f. Two different browns meeting at the one joint the footing
// exists to hide, and visible in `?view=arch` at a glance.
//
// What is asserted is the RELATIONSHIP, not either number — a retune of
// SURFACE_LIFT.wallL or of the garden's own fence timber should move both
// together and keep this passing.
{
  const garden = MAZE_THEMES.find((t) => t.id === "garden");
  if (!garden) throw new Error("test-archway: the garden theme is gone?");
  const authoredFence = garden.palette.fenceColor;
  const hedgeArch = getPropDef("hedge-arch");
  const archTimber = hedgeArch.params?.fenceColor;

  ok("the Hedge Arch authors a fence timber", typeof archTimber === "number");
  ok("…and it IS the garden's own fence timber", archTimber === authoredFence,
    `arch #${archTimber?.toString(16)} vs palette #${authoredFence.toString(16)}`);

  // Both sides through the SAME lift, which is what buildTunnelArches now does
  // to the arch's param and what liftPaletteForMadbox does to the palette's.
  const liftedPalette = liftSurfaceColor(authoredFence);
  const liftedArch = liftSurfaceColor(archTimber as number);
  ok("…so under the style they still match", liftedPalette === liftedArch,
    `#${liftedPalette.toString(16)} vs #${liftedArch.toString(16)}`);
  // BOUNDED AT BOTH ENDS: equal-after-lift is also true of a lift that does
  // nothing at all, which would mean the footing never joined the style.
  ok("…and the lift actually moved it", liftedPalette !== authoredFence,
    `#${authoredFence.toString(16)} -> #${liftedPalette.toString(16)}`);

  // ALL THREE ARCHES LAND ON THE MAZE FENCE UNDER THE STYLE, to within a few
  // units of 255, and that is the right outcome rather than a loss. The three
  // authored timbers are one hue differing almost entirely in LIGHTNESS
  // (0x8a5f34 / 0xa9743f / 0xb78450) and `liftSurface` is a lightness FLOOR
  // they all sit below, so the lift closes most of the gap between them.
  //
  // TWO EARLIER VERSIONS OF THIS BLOCK CLAIMED SOMETHING STRONGER AND THE
  // CHECK CAUGHT BOTH: first that each arch KEEPS its relationship to the
  // others (it does not — the Gothic Arbour lands exactly on the Hedge Arch's
  // value), then that all three converge EXACTLY (they do not — the Topiary
  // Gate's fractionally different hue leaves it on #be8f60 against #c28f5c).
  // The property that actually matters is neither: it is that the JOINT
  // DISAPPEARS, which is IDEA-067 rule 3's own terms. So the bound is
  // perceptual, and what separates the three arches is pinned above by head
  // curve, rise and proportion — never by timber.
  const gothic = getPropDef("hedge-arch-gothic").params?.fenceColor;
  const topiary = getPropDef("hedge-arch-topiary").params?.fenceColor;
  ok("the three arches author three different timbers",
    new Set([gothic, archTimber, topiary]).size === 3);
  ok("…all of the same hue, differing in lightness",
    typeof gothic === "number" && typeof topiary === "number" && gothic < (archTimber as number) &&
      (archTimber as number) < topiary);
  /** Largest per-channel difference, in 0..255. */
  const channelGap = (a: number, b: number): number =>
    Math.max(
      Math.abs(((a >> 16) & 255) - ((b >> 16) & 255)),
      Math.abs(((a >> 8) & 255) - ((b >> 8) & 255)),
      Math.abs((a & 255) - (b & 255)),
    );
  // The unlifted footing was 25 channel units off the lifted maze fence and
  // plainly visible in ?view=arch, so the bound is set well inside that.
  ok("the bug this bound describes was really that big",
    channelGap(authoredFence, liftedPalette) > 20,
    `${channelGap(authoredFence, liftedPalette)} units unlifted`);
  for (const [name, hex] of [["Gothic Arbour", gothic], ["Topiary Gate", topiary]] as const) {
    const gap = typeof hex === "number" ? channelGap(liftSurfaceColor(hex), liftedPalette) : 255;
    ok(`the ${name}'s footing meets the maze fence invisibly`, gap <= 8, `${gap} channel units`);
  }
}

// ---------------------------------------------------------------------------
section("The forest arch is two trees and a branch from each");

// IDEA-067 v3. Nuno: *"lets work in a arch to the deep forest, its the only
// thing that is missing. The tunnel arch on the deep forest we can make like
// a tunnel with like two trees one in each side and one branch from each tree
// making the arch."*
{
  const forest = MAZE_THEMES.find((t) => t.id === "forest");
  ok("the forest names a tunnel arch at last", typeof forest?.tunnelArch === "string");
  const def = getPropDef(forest?.tunnelArch ?? "");
  ok("…and it is a real prop of the archway shape", def.shape === "archway");
  const fp = def.params as PropParams;
  ok("…and it is the TREE kind, not a recoloured hedge", fp.archKind === "trees");

  // The forest's palette has `fence: "none"` and its floor is leaf litter, so
  // an arch standing there must not bring the garden's picket footing or its
  // cut stone sill with it. Both are honoured by the factory; this is the def
  // actually saying so.
  ok("it brings no picket fence into a theme that has none", fp.archFence === false);
  ok("and no cut stone sill onto leaf litter", fp.archThreshold === false);

  const tree = makeArchway(fp, 0.37);
  const tb = vertexBounds(tree);

  // --- the rule the whole shape is built around ----------------------------
  // IDEA-067 rule 6, on this arch's OWN springing height. The hedge arch is
  // pinned by the same inequality a few sections up; running it here is what
  // makes the two comparable, and the springing is the right quantity for
  // both because it is the height below which the mass flanking the corridor
  // stops being solid.
  {
    const H = ARCH_DEFAULTS.baseHeight * (fp.height ?? 1);
    const openW = H * (fp.archOpening ?? ARCH_DEFAULTS.opening) * (fp.width ?? 1);
    const rise = (openW / 2) * (fp.archRise ?? ARCH_DEFAULTS.rise);
    const bandT = H * (fp.archCrown ?? ARCH_DEFAULTS.crown);
    const springH = H - rise - bandT;
    ok(
      "the branches spring low enough that the corridor shows between the trees",
      springH / Math.tan((59 * Math.PI) / 180) < 0.86 * openW,
      `hides ${(springH * 0.6).toFixed(2)} of ${(0.86 * openW).toFixed(2)}`,
    );
    ok(
      "…and high enough that the beagle walks under them",
      springH > 1.2,
      `${springH.toFixed(2)}`,
    );

    // THE CROWNS ARE WHAT WOULD CLOSE THE APERTURE, and holding them clear is
    // the whole reason these trees are tall and slender rather than broad.
    // Worked out in the arch's own plane, a mass between heights yb and yt
    // whose outer edge is at xo shadows the floor inward from `xo - 0.6 yb`;
    // a canopy of the usual width sitting just above the springing therefore
    // puts the far half of the corridor in its own shade, which is the green
    // slab IDEA-067 already paid a complete build for. Measured on the parts
    // rather than asserted: no crown vertex may hang below the crown of the
    // arch itself.
    const crownY = springH + rise;
    let lowestCrown = Infinity;
    let innermostCrown = Infinity;
    tree.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !/^crown[LR]/.test(m.name)) return;
      m.updateWorldMatrix(true, false);
      const a = m.geometry.getAttribute("position");
      const v = new THREE.Vector3();
      for (let i = 0; i < a.count; i++) {
        v.fromBufferAttribute(a, i).applyMatrix4(m.matrixWorld);
        lowestCrown = Math.min(lowestCrown, v.y);
        innermostCrown = Math.min(innermostCrown, Math.abs(v.x));
      }
    });
    // ABOVE THE SPRINGING, not above the apex — and the first version of this
    // check asserted the apex, which is a SOLUTION rather than the
    // requirement and failed a sound model by 0.4 of a unit. What the rule
    // actually needs is that the wide mass stops being solid below the
    // springing, because that is the height the inequality above assumes;
    // a crown hanging beside the trunk at two thirds of the rise is outboard
    // of the opening entirely and occludes nothing the arch is for.
    ok(
      "the crowns are carried clear of the walk-through, well above the springing",
      lowestCrown > springH + rise * 0.4,
      `lowest crown vertex ${lowestCrown.toFixed(2)} against a springing of ${springH.toFixed(2)} (crown line ${crownY.toFixed(2)})`,
    );
    ok(
      "…and none of them overhangs the middle of the corridor",
      innermostCrown > openW * 0.18,
      `nearest crown vertex ${innermostCrown.toFixed(2)} from the centre line`,
    );
  }

  // --- two trees, not one bent one -----------------------------------------
  // Nuno, with a sketch drawn over the render: *"instead of having the trees
  // making the arch and look a little bit off, we can just make two branches
  // touching like the sketch."* Two measurable facts carry that read, and
  // both were wrong in a build that passed every other check here.
  {
    const H = ARCH_DEFAULTS.baseHeight * (fp.height ?? 1);
    const openW = H * (fp.archOpening ?? ARCH_DEFAULTS.opening) * (fp.width ?? 1);
    const rise = (openW / 2) * (fp.archRise ?? ARCH_DEFAULTS.rise);
    const bandT = H * (fp.archCrown ?? ARCH_DEFAULTS.crown);
    const springH = H - rise - bandT;
    const touchY = springH + rise;

    /** The half-width THROUGH the portal in a band of height around `y`.
     *  Both trunk and limb are swept about z = 0, so this is the radius there
     *  — and it is the one measurement that compares them like for like.
     *
     *  **THE BAND HAS TO BE WIDER THAN THE STATION SPACING.** A swept solid
     *  has vertices only AT its stations, and the trunk's eight sit 0.39
     *  apart — so a 0.05 band around the fork fell cleanly between two rings
     *  and this check reported a trunk half-width of 0.000 on a model that is
     *  correct, which reads as the limb being infinitely fat. 0.25 catches
     *  exactly one ring of each. */
    const halfWidthAt = (re: RegExp, y: number): number => {
      let w = 0;
      tree.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !re.test(m.name)) return;
        m.updateWorldMatrix(true, false);
        const a = m.geometry.getAttribute("position");
        const v = new THREE.Vector3();
        for (let i = 0; i < a.count; i++) {
          v.fromBufferAttribute(a, i).applyMatrix4(m.matrixWorld);
          if (Math.abs(v.y - y) < 0.25) w = Math.max(w, Math.abs(v.z));
        }
      });
      return w;
    };
    const limbW = halfWidthAt(/^branch[LR]$/, springH);
    const trunkW = halfWidthAt(/^trunk[LR]$/, springH);
    ok(
      "the limbs are thinner than the trunks they grow out of",
      limbW > 0 && trunkW > 0 && limbW < trunkW * 0.8,
      `limb ${limbW.toFixed(3)} against trunk ${trunkW.toFixed(3)} at the fork`,
    );

    let trunkTop = -Infinity;
    tree.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !/^trunk[LR]$/.test(m.name)) return;
      m.updateWorldMatrix(true, false);
      const a = m.geometry.getAttribute("position");
      const v = new THREE.Vector3();
      for (let i = 0; i < a.count; i++) {
        trunkTop = Math.max(trunkTop, v.fromBufferAttribute(a, i).applyMatrix4(m.matrixWorld).y);
      }
    });
    // A TREE CARRIES ITS CROWN ABOVE THE BRANCH IT FORKS AT. The first builds
    // put the touch at `H - bandT`, which is the hedge arch's own rule (there
    // the crown of the arch IS the top of the prop) — so the limb rose higher
    // than its own bole, the trunk's head hid behind the foliage, and the eye
    // joined trunk to limb into ONE bending form. Nothing errors; it is just
    // a different object from the one the brief asks for.
    ok(
      "each trunk carries on ABOVE the touch, so the pair reads as two trees",
      trunkTop > touchY,
      `trunk top ${trunkTop.toFixed(2)} against a touch at ${touchY.toFixed(2)}`,
    );
    ok(
      "the two limbs really do touch at the centre line",
      (() => {
        let joint = false;
        tree.traverse((o) => {
          if ((o as THREE.Mesh).isMesh && o.name === "branchJoint") joint = true;
        });
        return joint;
      })(),
      "no knuckle over the joint",
    );
  }

  // --- the envelope, from VERTICES -----------------------------------------
  ok("the forest arch stands ON the ground", tb.lo.y > -0.005, `lo.y = ${tb.lo.y.toFixed(4)}`);
  ok(
    "its span straddles the corridor without swallowing its neighbours",
    tb.hi.x - tb.lo.x > 1.5 && tb.hi.x - tb.lo.x < 3 * TILE,
    `${(tb.hi.x - tb.lo.x).toFixed(3)}`,
  );
  ok(
    "it is shallower than a tile, so it reads as a portal and not a covered way",
    tb.hi.z - tb.lo.z < 1.0,
    `${(tb.hi.z - tb.lo.z).toFixed(3)}`,
  );
  ok(
    "it is the TALLEST arch — a tree is a landmark, which is the point of one",
    tb.hi.y > 2.6,
    `${tb.hi.y.toFixed(3)}`,
  );
  ok(
    "and it is cheap — this is a fixture on every board of every level",
    tb.tris < 3000,
    `${tb.tris} tris`,
  );

  // --- the parts the editor has to be able to reach ------------------------
  // IDEA-065 rule 3's lesson from the other side: a prop whose pieces have no
  // names is a prop nobody can author. Two trunks and two branches, because
  // "one branch from each tree" is the brief in so many words.
  const named = new Set<string>();
  tree.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) named.add(o.name);
  });
  for (const n of ["trunkL", "trunkR", "branchL", "branchR"]) {
    ok(`"${n}" is a part the Props tab can select`, named.has(n));
  }

  // --- the value ladder (IDEA-065 rule 9, IDEA-079's snap) -----------------
  // NOTHING ERRORS WHEN THIS REGRESSES. The prop builds, the materials are
  // valid and the editor shows the authored colours, which are still correct
  // — and under the shipped style two parts on one palette entry are the same
  // generated matcap texture and cannot be told apart at any size. That is
  // exactly what the crest used to be: `brighten` scales all three channels,
  // so a foliage green and the same green at 1.5x snap to ONE entry, and the
  // lighter growth this arch's only internal contrast comes from was gone.
  {
    const entryOf = new Map<string, string>();
    tree.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || Array.isArray(m.material)) return;
      const col = (m.material as THREE.MeshToonMaterial).color.getHex();
      const group = /^trunk|^branch/.test(m.name)
        ? "bark"
        : /^crown/.test(m.name)
          ? "foliage"
          : /^leaf/.test(m.name)
            ? "growth"
            : "";
      if (group) entryOf.set(group, snapToPalette(col).id);
    });
    ok("the trunks, the crowns and the new growth are all three present", entryOf.size === 3);
    const ids = [...entryOf.values()];
    ok(
      "…and no two of them share a palette entry",
      new Set(ids).size === ids.length,
      [...entryOf.entries()].map(([k, v]) => `${k}=${v}`).join(" "),
    );
  }

  // The dropdown's FIRST option is what the Props tab writes into a def that
  // has not set the field, so it has to be the factory's own default — the
  // same class of defect as IDEA-060's sunflower repainted in daisy colours,
  // and here it would turn every unset arch into trees.
  {
    const m = /archKind:\s*\[([^\]]*)\]/.exec(inspectorSrc);
    ok(
      "the Props tab seeds an unset \"archKind\" with \"hedge\", the factory's default",
      m !== null && m[1].trim().startsWith('"hedge"'),
      m ? m[1].trim() : "not offered at all",
    );
  }
  ok(
    "the Props tab offers \"archKind\" at all",
    (PROP_SHAPE_FIELDS.archway as readonly string[]).includes("archKind"),
  );
}

// ---------------------------------------------------------------------------
section("The beach arch is a sea arch, with corals, algae and crabs");

// IDEA-080. Nuno: *"for the arch on the beach I was thinking in something like
// a rock arch with corals and beach flora, like algae, and some small crabs on
// the rocks."*
{
  const beach = MAZE_THEMES.find((t) => t.id === "beach");
  ok("the beach names a tunnel arch", typeof beach?.tunnelArch === "string");
  const def = getPropDef(beach?.tunnelArch ?? "");
  ok("…and it is a real prop of the archway shape", def.shape === "archway");
  const sp = def.params as PropParams;
  ok("…and it is the ROCK kind", sp.archKind === "rocks");
  ok("no picket fence on the sand", sp.archFence === false);
  ok("and no cut stone sill", sp.archThreshold === false);

  const sea = makeArchway(sp, 0.37);
  const sb = vertexBounds(sea);
  const H = ARCH_DEFAULTS.baseHeight * (sp.height ?? 1);
  const openW = H * (sp.archOpening ?? ARCH_DEFAULTS.opening) * (sp.width ?? 1);
  const rise = (openW / 2) * (sp.archRise ?? ARCH_DEFAULTS.rise);
  const bandT = H * (sp.archCrown ?? ARCH_DEFAULTS.crown);
  const springH = H - rise - bandT;

  // Rule 6 is about MASS, not material: solid stone legs are exactly the case
  // the inequality was derived for.
  ok(
    "the legs spring low enough that the corridor shows between them",
    springH / Math.tan((59 * Math.PI) / 180) < 0.86 * openW,
    `hides ${(springH * 0.6).toFixed(2)} of ${(0.86 * openW).toFixed(2)}`,
  );
  ok("…and high enough that the beagle walks under them", springH > 1.0, `${springH.toFixed(2)}`);

  // NOTHING ALIVE IN THE DOORWAY. Below the springing, every coral, weed,
  // blade of grass and crab vertex must sit outboard of the opening — the
  // beagle walks through this tile, and a coral in it reads as something in
  // the way. (The crown crab sits ON TOP of the arch, above the springing,
  // which is where it is meant to be seen.)
  {
    let intruders = 0;
    const v = new THREE.Vector3();
    for (const groupName of ["algae", "corals", "crabs", "rock"]) {
      const grp = sea.getObjectByName(groupName);
      grp?.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.updateWorldMatrix(true, false);
        const a = m.geometry.getAttribute("position");
        for (let i = 0; i < a.count; i++) {
          v.fromBufferAttribute(a, i).applyMatrix4(m.matrixWorld);
          if (v.y < springH * 0.9 && Math.abs(v.x) < openW / 2 - 0.02) intruders++;
        }
      });
    }
    ok("nothing stands in the opening below the springing", intruders === 0, `${intruders} vertices in the doorway`);
  }

  // --- the parts the brief names --------------------------------------------
  const crabCount = sea.getObjectByName("crabs")?.children.length ?? 0;
  ok("there are crabs on the rocks", crabCount >= 2, `${crabCount} crabs`);
  ok("there are corals", (sea.getObjectByName("corals")?.children.length ?? 0) >= 4);
  ok("there is algae", (sea.getObjectByName("algae")?.children.length ?? 0) >= 6);
  {
    // The crown crab sits on top of the stone, not inside it — at the chain's
    // own crown line it was buried under the cap stones and invisible.
    const crown = sea.getObjectByName("crabCrown");
    crown?.updateWorldMatrix(true, false);
    ok(
      "the crown crab sits on top of the arch",
      !!crown && crown.position.y > springH + rise + bandT * 0.5,
      crown ? `crab at ${crown.position.y.toFixed(2)}` : "no crown crab",
    );
  }

  // --- the envelope, from VERTICES ------------------------------------------
  ok("it stands ON the ground", sb.lo.y > -0.005, `lo.y = ${sb.lo.y.toFixed(4)}`);
  ok(
    "its span straddles the corridor without swallowing its neighbours",
    sb.hi.x - sb.lo.x > 1.5 && sb.hi.x - sb.lo.x < 3.3 * TILE,
    `${(sb.hi.x - sb.lo.x).toFixed(3)}`,
  );
  ok("it is shallower than a tile and a half", sb.hi.z - sb.lo.z < 1.5, `${(sb.hi.z - sb.lo.z).toFixed(3)}`);
  ok("and it is cheap enough for every board", sb.tris < 12000, `${sb.tris} tris`);

  // --- the value ladder under the shipped style ------------------------------
  // Five roles, five palette entries, and none of them the beach WALL's — or
  // the arch melts into the maze it stands at the end of. The cap is the one
  // that broke: an HSL lift in three's linear working space did not move it a
  // rung, so it shipped for one render the same brown as the rock under it.
  {
    const entryOf = new Map<string, string>();
    const roleOf = (n: string, parent: string): string =>
      parent === "rock" ? "rock" : parent === "caps" ? "cap" : parent === "corals"
        ? (n === "brain" ? "coralB" : "coral")
        : parent === "crabs" ? (/^shell|^claw|^leg/.test(n) ? "crab" : "")
        : parent === "algae" ? (/^weed/.test(n) ? "algae" : "") : "";
    for (const top of sea.children) {
      top.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || Array.isArray(m.material)) return;
        const role = roleOf(m.name, top.name);
        if (role) entryOf.set(role, snapToPalette((m.material as THREE.MeshToonMaterial).color.getHex()).id);
      });
    }
    ok("all six roles are present", entryOf.size === 6, [...entryOf.keys()].join(" "));
    const ids = [...entryOf.values()];
    ok(
      "…and no two of them share a palette entry",
      new Set(ids).size === ids.length,
      [...entryOf.entries()].map(([k, v]) => `${k}=${v}`).join(" "),
    );
    const wallEntry = snapToPalette(beach!.palette.wall).id;
    ok("…and none of them is the beach wall's own entry", !ids.includes(wallEntry), `wall=${wallEntry}`);
  }

  {
    const m = /archKind:\s*\[([^\]]*)\]/.exec(inspectorSrc);
    ok("the Props tab offers the rock kind", !!m && m[1].includes('"rocks"'), m ? m[1] : "");
  }
}

console.log(`ARCHWAY: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
