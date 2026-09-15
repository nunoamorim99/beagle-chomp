// IDEA-066 — the world around the maze, headless.
//
// Everything here is checkable without a browser, and the two most important
// assertions are ones no render could make:
//
//   - THE DRAW-CALL CEILING. `mergeBySignature` collapses the whole surround to
//     one mesh per distinct material, which is what makes hundreds of props
//     affordable. A builder that quietly calls `toon()` for itself instead of
//     taking the shared set still WORKS and still LOOKS right — it just adds a
//     draw call, invisibly, for ever. Review cannot catch that; a number can.
//
//   - THE KEEP-CLEAR RULE. A procedural plot landing on top of the maze is
//     invisible in a screenshot the moment anything else is standing there, and
//     it is exactly the class of bug `buildWallDecor` shipped for two releases.
//
//   npm run test:surround
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { COLS, ROWS } from "../src/game/grid";
import { SURROUND_PARAMS, SURROUND_VIEW, setSurroundView } from "../src/render/surround";
import {
  ensureSurround,
  disposeSurround,
  planPlots,
  planFringe,
  buildSurroundContent,
} from "../src/render/surroundRecipe";
import {
  makeSurroundMaterials,
  disposeSurroundMaterials,
  distantBed,
  distantBroadleaf,
  distantConifer,
  distantDune,
  distantHedgeRun,
  distantHouse,
  distantRockOutcrop,
  distantShrubClump,
  distantTower,
} from "../src/render/surroundProps";
import { MAZE_THEMES } from "../src/game/themes";
import { buildVerge } from "../src/render/board";
import { vergeCandidates, apronCandidates, VERGE_RINGS } from "../src/editor/boardPlacement";
import { Grid } from "../src/game/grid";
import { MAZES } from "../src/game/mazes";
import { WORLD_GROUPS } from "../src/editor/worldFields";
import { readConfigNumber } from "../src/editor/configRewrite";

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
    console.log("  ok   " + label);
  } else {
    failed++;
    console.log("  FAIL " + label + (detail ? "\n    " + detail : ""));
  }
}
function section(title: string): void {
  console.log("\n" + title);
}

const FLOOR_HALF_X = (COLS + 2) / 2;
const FLOOR_HALF_Z = (ROWS + 2) / 2;
const GARDEN = MAZE_THEMES.find((t) => t.id === "garden")!;

/** Snapshot the dials so a section that edits them cannot leak into the next. */
const BASE = { ...SURROUND_PARAMS };
function restoreParams(): void {
  Object.assign(SURROUND_PARAMS, BASE);
}

// ---------------------------------------------------------------------------
section("The recipe is deterministic");

{
  const a = planPlots();
  const b = planPlots();
  ok("planPlots returns the same plots twice", JSON.stringify(a) === JSON.stringify(b));
  const fa = planFringe();
  const fb = planFringe();
  ok("planFringe returns the same scatter twice", JSON.stringify(fa) === JSON.stringify(fb));
  ok("it produces some plots at all", a.length > 10, "got " + a.length);
  ok("...and some fringe", fa.length > 10, "got " + fa.length);
}

// ---------------------------------------------------------------------------
section("Nothing procedural lands on the board");

{
  const clearX = FLOOR_HALF_X + SURROUND_PARAMS.keepClear;
  const clearZ = FLOOR_HALF_Z + SURROUND_PARAMS.keepClear;
  const plots = planPlots();
  const bad = plots.filter(
    (p) => Math.abs(p.cx) - p.w / 2 < clearX && Math.abs(p.cz) - p.d / 2 < clearZ,
  );
  ok(
    "no plot rectangle overlaps the keep-clear box",
    bad.length === 0,
    bad.length ? `${bad.length} overlap, e.g. (${bad[0].cx.toFixed(1)}, ${bad[0].cz.toFixed(1)})` : "",
  );

  const fringe = planFringe();
  const badF = fringe.filter((f) => Math.abs(f.x) < clearX && Math.abs(f.z) < clearZ);
  ok(
    "no fringe item sits inside the keep-clear box",
    badF.length === 0,
    badF.length ? `${badF.length} inside, e.g. (${badF[0].x.toFixed(1)}, ${badF[0].z.toFixed(1)})` : "",
  );

  // The keep-clear box has to actually cover what it claims to: the apron ring
  // AND the verge rings the editor will author in. If VERGE_RINGS ever grows
  // past keepClear, a hand-placed prop and a procedural plot share a tile.
  ok(
    "keep-clear covers the apron and at least two verge rings",
    SURROUND_PARAMS.keepClear >= 3,
    "keepClear = " + SURROUND_PARAMS.keepClear,
  );
}

// ---------------------------------------------------------------------------
section("It obeys its dials rather than a literal count");

{
  // IDEA-062 v5's lesson, and this project has now learned it twice: a test that
  // pins a number the editor exposes as a slider fails the first time someone
  // turns the slider, with no opinion on whether they were right to.
  restoreParams();
  SURROUND_PARAMS.density = 0;
  ok("density 0 produces no plots", planPlots().length === 0);
  SURROUND_PARAMS.density = 1;
  const full = planPlots().length;
  SURROUND_PARAMS.density = 0.5;
  const half = planPlots().length;
  ok("density 1 produces more plots than 0.5", full > half, `${full} vs ${half}`);
  ok("...and 0.5 produces more than none", half > 0);

  restoreParams();
  SURROUND_PARAMS.fringeDensity = 0;
  ok("fringeDensity 0 produces no fringe", planFringe().length === 0);
  restoreParams();

  // The size ramp has to actually ramp.
  const plots = planPlots();
  const near = plots.reduce((a, b) => (a.out < b.out ? a : b));
  const far = plots.reduce((a, b) => (a.out > b.out ? a : b));
  ok("a far plot is scaled up relative to a near one", far.scale > near.scale, `${far.scale.toFixed(2)} vs ${near.scale.toFixed(2)}`);
}

// ---------------------------------------------------------------------------
section("The hash seed band is its own");

{
  const src = readFileSync("src/render/surroundRecipe.ts", "utf8");
  const m = /SURROUND_HASH_SEED = (\d+)/.exec(src);
  ok("surroundRecipe declares a seed band", m !== null);
  if (m) {
    const seed = Number(m[1]);
    // Taken: buildHedgeDecor 1-7, buildProps 200/201, buildWallDecor 301,
    // groundDetail 401-406 (it adds 400 to its own salt internally).
    const taken = [
      [1, 7],
      [200, 201],
      [301, 301],
      [401, 406],
    ];
    const hi = seed + 39;
    const clash = taken.filter(([lo, up]) => seed <= up && hi >= lo);
    ok("600-639 collides with no other system's band", clash.length === 0, JSON.stringify(clash));
  }
}

// ---------------------------------------------------------------------------
section("Every builder is addressable and stands on the ground");

{
  const mats = makeSurroundMaterials(GARDEN.palette);
  // `sink` is how far below y = 0 a subject is ALLOWED to reach, and it is
  // declared per subject rather than relaxed globally.
  //
  // Anything BUILT stands on the ground: a house or a tower that sinks is
  // simply mispositioned. Anything GROWN or HEAPED sits INTO it, and that is
  // not a defect — a hedge balanced exactly on the turf reads as furniture,
  // and a dune is a mound, so its equator belongs at ground level. What must
  // never happen is the other direction: a prop that FLOATS. That is the
  // defect this project keeps shipping (IDEA-065's perched bird sat 0.067
  // above its own branch, the flower heads 0.029 under the floor), and no
  // render says either one out loud.
  //
  // The dune's allowance is the largest and it costs something real: roughly
  // half its triangles are under an opaque ground plane. Bounded here so the
  // waste stays a decision rather than a drift.
  const subjects: Array<[string, THREE.Group, number]> = [
    ["house", distantHouse(mats, { kind: "house", seed: 1 }), 0.02],
    ["shed", distantHouse(mats, { kind: "shed", seed: 2 }), 0.02],
    ["greenhouse", distantHouse(mats, { kind: "greenhouse", seed: 3 }), 0.02],
    ["hedgeRun", distantHedgeRun(mats, { length: 6, seed: 4 }), 0.25],
    ["broadleaf", distantBroadleaf(mats, { seed: 5 }), 0.02],
    ["conifer", distantConifer(mats, { seed: 6 }), 0.02],
    ["shrubClump", distantShrubClump(mats, { seed: 7 }), 0.15],
    ["bed", distantBed(mats, { seed: 8 }), 0.02],
    ["tower", distantTower(mats, { seed: 9 }), 0.02],
    ["dune", distantDune(mats, { seed: 10 }), 0.7],
    ["rockOutcrop", distantRockOutcrop(mats, { seed: 11 }), 0.15],
  ];

  const known = new Set<THREE.Material>(Object.values(mats));
  for (const [name, g, sink] of subjects) {
    g.updateMatrixWorld(true);
    let meshes = 0;
    let named = 0;
    let lowest = Infinity;
    let tris = 0;
    let foreign = 0;
    g.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      meshes++;
      if (mesh.name) named++;
      const mat = mesh.material as THREE.Material;
      if (!known.has(mat)) foreign++;
      const pos = mesh.geometry.attributes.position;
      tris += (mesh.geometry.index ? mesh.geometry.index.count : pos.count) / 3;
      // MEASURED FROM VERTICES. Box3.setFromObject builds each child's box in
      // LOCAL space and transforms its eight corners, so it over-reports any
      // off-axis rotation — it read the garden shrub 56% too wide.
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        if (v.y < lowest) lowest = v.y;
      }
    });
    ok(`${name}: every mesh is named`, named === meshes, `${named}/${meshes}`);
    ok(`${name}: does not sink past its allowance`, lowest > -sink, "lowest y = " + lowest.toFixed(3));
    ok(`${name}: touches the ground rather than floating`, lowest < 0.05, "lowest y = " + lowest.toFixed(3));
    ok(`${name}: uses only the shared material set`, foreign === 0, `${foreign} foreign material(s)`);
    ok(`${name}: within its triangle budget`, tris <= 600, Math.round(tris) + " tris");
  }
  disposeSurroundMaterials(mats);
}

// ---------------------------------------------------------------------------
section("The whole surround collapses to a handful of draw calls");

{
  restoreParams();
  for (const theme of MAZE_THEMES) {
    const scene = new THREE.Group();
    const g = ensureSurround(scene, theme.palette.surround, theme.palette);
    if (theme.palette.surround === "none") {
      ok(`${theme.id}: "none" costs no geometry at all`, g === null);
      continue;
    }
    let meshes = 0;
    let tris = 0;
    g!.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      meshes++;
      const pos = m.geometry.attributes.position;
      tris += (m.geometry.index ? m.geometry.index.count : pos.count) / 3;
    });
    // The ceiling is the shared material set's size plus slack. It cannot grow
    // with density, and if it does, a builder stopped taking the set.
    ok(`${theme.id}: <= 18 draw calls`, meshes <= 18, meshes + " meshes");
    ok(`${theme.id}: <= 140k triangles`, tris <= 140000, Math.round(tris) + " tris");
    ok(`${theme.id}: casts no shadows`, (() => {
      let bad = 0;
      g!.traverse((o) => {
        if ((o as THREE.Mesh).isMesh && o.castShadow) bad++;
      });
      return bad === 0;
    })(), "the merged batch overlaps the key light's shadow camera");
    disposeSurround();
  }
}

// ---------------------------------------------------------------------------
section("Every theme names a real surround, and the ground always exists");

{
  const kinds = ["none", "plots", "woodland", "dunes", "parkland", "cityblocks"];
  for (const t of MAZE_THEMES) {
    ok(`${t.id}: surround "${t.palette.surround}" is a real kind`, kinds.includes(t.palette.surround));
    // The no-sky-gap guarantee is unconditional, so there is no "none" for the
    // ground — a theme that wants the old void sets surroundGround to its bg.
    ok(`${t.id}: declares a surround ground colour`, typeof t.palette.surroundGround === "number");
  }
  ok(
    "the ground plane reaches past the widest frame",
    SURROUND_PARAMS.halfWidth >= 43 && SURROUND_PARAMS.zFar <= -43 && SURROUND_PARAMS.zNear >= 25,
    `x ${SURROUND_PARAMS.halfWidth}, z ${SURROUND_PARAMS.zFar}..${SURROUND_PARAMS.zNear}`,
  );
}

// ---------------------------------------------------------------------------
// The World tab writes these by TEXT SUBSTITUTION at a named path, so a
// renamed dial does not fail to compile — it silently renders a control bound
// to nothing, which worldInspector shows as "not found in <file>" and which
// nobody reads while dragging a slider. test-config-rewrite.ts guards
// balanceFields exactly this way; this is that pattern applied to the
// surround, and it is the only thing standing between a rename and a pane
// full of dead controls.
section("Every surround dial the World tab offers actually resolves");

{
  restoreParams();
  const src = readFileSync("src/render/surround.ts", "utf8");
  const fields = WORLD_GROUPS.flatMap((g) => g.fields).filter(
    (f) => f.path[0] === "SURROUND_PARAMS",
  );
  ok("the World tab exposes the surround at all", fields.length > 0, fields.length + " fields");
  const live = SURROUND_PARAMS as unknown as Record<string, number>;
  for (const f of fields) {
    const key = f.path.join(".");
    const read = readConfigNumber(src, f.path);
    ok(key + " resolves in surround.ts", read !== null, "configRewrite could not find it");
    if (read === null) continue;
    const now = live[String(f.path[1])];
    ok(key + ": the source and the live table agree", read === now, read + " vs " + now);
    ok(
      key + ": the shipped value is inside its own slider range",
      read >= f.min && read <= f.max,
      read + " outside [" + f.min + ", " + f.max + "]",
    );
  }
  // Every dial reachable, or it is a number nobody can tune.
  const exposed = new Set(fields.map((f) => String(f.path[1])));
  for (const key of Object.keys(live)) {
    ok("SURROUND_PARAMS." + key + " is exposed in the World tab", exposed.has(key));
  }
}

// ---------------------------------------------------------------------------
// IDEA-066 phase 3. The verge is the hand-authored ring between the apron and
// the procedural surround, and the assertion that matters most is the one
// SPANNING those two systems: a verge tile inside the surround's keep-clear
// box is safe, a verge tile outside it shares ground with a procedural plot.
// Nothing in either module can notice that on its own.
section("The verge is reachable, bounded, and never shares ground with a plot");

{
  restoreParams();
  const grid = new Grid(MAZES[0]);
  const verge = vergeCandidates(grid);
  const apron = new Set(apronCandidates(grid).map(([x, y]) => x + "," + y));

  ok("the verge offers slots at all", verge.length > 100, verge.length + " tiles");
  ok(
    "no verge tile is also an apron tile",
    verge.every(([x, y]) => !apron.has(x + "," + y)),
  );
  ok(
    "no verge tile is inside the maze",
    verge.every(([x, y]) => x < 0 || x >= COLS || y < 0 || y >= ROWS),
  );

  // The tunnel exclusion, extended outward. apronCandidates only masks its own
  // two columns; a shed parked in a tunnel mouth two rings out is just as much
  // in the way, and it is the one sightline a player's eye travels down.
  const blocked = new Set<number>();
  grid.tunnelRows.forEach((ty) => {
    blocked.add(ty - 1);
    blocked.add(ty);
    blocked.add(ty + 1);
  });
  ok(
    "no verge tile sits in a tunnel sightline",
    verge.every(([, y]) => !(y >= 0 && y < ROWS && blocked.has(y))),
  );

  // THE CROSS-SYSTEM ONE. worldX(tx) = tx - (COLS-1)/2, worldZ(ty) = ty -
  // (ROWS-1)/2; the keep-clear box is the board floor plus SURROUND_PARAMS.
  // keepClear. Raise VERGE_RINGS without raising keepClear and this fails,
  // which is exactly when a hand-placed prop and a procedural plot collide.
  const clearX = FLOOR_HALF_X + SURROUND_PARAMS.keepClear;
  const clearZ = FLOOR_HALF_Z + SURROUND_PARAMS.keepClear;
  const escaped = verge.filter(([tx, ty]) => {
    const wx = Math.abs(tx - (COLS - 1) / 2);
    const wz = Math.abs(ty - (ROWS - 1) / 2);
    return wx > clearX || wz > clearZ;
  });
  ok(
    "every verge tile is inside the surround's keep-clear box",
    escaped.length === 0,
    escaped.length
      ? escaped.length + " escape, e.g. tile " + escaped[0] + " (VERGE_RINGS " + VERGE_RINGS + " vs keepClear " + SURROUND_PARAMS.keepClear + ")"
      : "",
  );
}

// ---------------------------------------------------------------------------
section("The verge cap is south-only, and applied to the PRODUCT");

{
  // The treehouse is `tall` and ships at 2.478 units; 2.9 is past the cap on
  // any row that has one. buildVerge multiplies the placement scale onto a def
  // that may already carry a root part edit, so the cap has to bound the
  // PRODUCT — IDEA-062's rule, and the birdhouse is the def that proved it.
  const mk = (tile: [number, number]) => ({
    ...MAZE_THEMES[0],
    verge: [{ propId: "treehouse", tile, offset: [0, 0] as [number, number], rotationY: 0, scale: 2.9 }],
  });
  // MEASURED FROM VERTICES, not from `scale.x`. mergeBySignature bakes every
  // child's transform into the merged geometry and leaves the result at
  // identity, so reading the scale back off the object returns 1 whatever was
  // applied — the first version of this test asserted exactly that, and the
  // SOUTH case passed by accident because 1 is under the cap. Same family as
  // this project's Box3 note: measure the thing, never a property that merely
  // describes it.
  const heightOf = (tile: [number, number]): number => {
    const scene = new THREE.Group();
    const g = buildVerge(scene, mk(tile) as unknown as (typeof MAZE_THEMES)[number])!;
    g.updateMatrixWorld(true);
    let top = -Infinity;
    const v = new THREE.Vector3();
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const pos = m.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        if (v.y > top) top = v.y;
      }
    });
    return top;
  };
  /** The treehouse measures 2.478 units tall at scale 1. */
  const TREEHOUSE_H = 2.478;

  // South verge: ty > ROWS.
  const south = heightOf([9, ROWS + 1]);
  ok(
    "a tall prop is capped on the south verge",
    south < TREEHOUSE_H * 1.25,
    "top = " + south.toFixed(2) + " (uncapped would be ~" + (TREEHOUSE_H * 2.9).toFixed(2) + ")",
  );
  // North, east and west cannot occlude the maze at ANY height — their shadow
  // ray travels away from the board. Solved, not assumed: see
  // scripts/_scratch-surround-sightline.ts.
  const north = heightOf([9, -2]);
  ok("...and NOT on the north verge", north > TREEHOUSE_H * 2, "top = " + north.toFixed(2));
  const east = heightOf([COLS + 1, 9]);
  ok("...nor on the east verge", east > TREEHOUSE_H * 2, "top = " + east.toFixed(2));
}

// ---------------------------------------------------------------------------
section("IDEA-069: the band is culled to what the camera can see");

{
  const P = SURROUND_PARAMS;
  const savedView = { ...SURROUND_VIEW };
  const restoreView = (): void => {
    SURROUND_VIEW.halfX = savedView.halfX;
    SURROUND_VIEW.zNear = savedView.zNear;
    SURROUND_VIEW.zFar = savedView.zFar;
  };

  // A phone's measured footprint, straight off _scratch-surround-coverage.ts.
  setSurroundView(15.3, 22.4, -38.7);
  const phone = { ...SURROUND_VIEW };
  ok(
    "a portrait footprint narrows the band well inside the shipped extent",
    phone.halfX < P.halfWidth * 0.6,
    `halfX ${phone.halfX} against ${P.halfWidth}`,
  );
  ok(
    "...with a margin, so the box is never TIGHTER than what was measured",
    phone.halfX > 15.3 && phone.zNear > 22.4 && phone.zFar < -38.7,
    `${phone.halfX} / ${phone.zNear} / ${phone.zFar}`,
  );
  const phonePlots = planPlots().length;
  ok("...and it still builds a neighbourhood, not an empty band", phonePlots > 20, `${phonePlots} plots`);

  // The shipped extent is a CEILING: there is no ground past it to stand on.
  setSurroundView(999, 999, -999);
  ok(
    "a runaway footprint is clamped to the ground that actually exists",
    SURROUND_VIEW.halfX <= P.halfWidth &&
      SURROUND_VIEW.zNear <= P.zNear &&
      SURROUND_VIEW.zFar >= P.zFar,
    `${SURROUND_VIEW.halfX} / ${SURROUND_VIEW.zNear} / ${SURROUND_VIEW.zFar}`,
  );
  const fullPlots = planPlots().length;
  ok("...and that is the most plots there can ever be", fullPlots >= phonePlots);
  ok(
    "the cull is worth doing at all - a phone builds materially less",
    phonePlots < fullPlots * 0.75,
    `${phonePlots} against ${fullPlots}`,
  );

  // And a FLOOR, so a frame that somehow measures tiny cannot delete the
  // neighbourhood out from under the keep-clear box.
  setSurroundView(0, 0, 0);
  ok(
    "a nonsense footprint cannot empty the band",
    SURROUND_VIEW.halfX >= 20 && planPlots().length > 0,
    `halfX ${SURROUND_VIEW.halfX}, ${planPlots().length} plots`,
  );

  // Quantisation. A resize fires on every pixel of a window drag, and this is
  // the only thing stopping several hundred props rebuilding on each frame.
  setSurroundView(15.3, 22.4, -38.7);
  ok(
    "a sub-quantum change reports NO change, so a drag cannot thrash",
    setSurroundView(15.6, 22.6, -38.9) === false,
  );
  ok("...but a real one does", setSurroundView(31.6, 11.9, -21.2) === true);

  restoreView();
}

// ---------------------------------------------------------------------------
section("No building stands inside another one");

// NUNO'S REPORT, and it had no test because it could not have one: the merge
// welds the whole band into one mesh per material, so by the time anything can
// look at the finished group every object's identity is gone. The recipe is
// now split at `buildSurroundContent` for exactly this.
//
// Measured from VERTICES, never `Box3.setFromObject` -- it builds each mesh's
// box in LOCAL space and transforms the eight corners, so a rotated child
// over-reports by up to 56% (CLAUDE.md's standing note), and EVERY building
// here is placed with a rotation.
{
  const mats = makeSurroundMaterials(GARDEN.palette);
  const host = buildSurroundContent("plots", mats);

  type Foot = { name: string; x0: number; x1: number; z0: number; z1: number };
  const feet: Foot[] = [];
  for (const child of host.children) {
    if (!child.name.startsWith("building-")) continue;
    child.updateWorldMatrix(true, true);
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    const v = new THREE.Vector3();
    child.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const pos = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        if (v.x < x0) x0 = v.x;
        if (v.x > x1) x1 = v.x;
        if (v.z < z0) z0 = v.z;
        if (v.z > z1) z1 = v.z;
      }
    });
    feet.push({ name: child.name, x0, x1, z0, z1 });
  }

  ok("the probe found buildings at all", feet.length > 10, `${feet.length} buildings`);

  // Footprints may not INTERSECT. A shared wall would be a terrace and this is
  // a lattice of detached plots, so any overlap at all is the defect.
  let worst = 0;
  let worstPair = "";
  for (let i = 0; i < feet.length; i++) {
    for (let j = i + 1; j < feet.length; j++) {
      const a = feet[i];
      const b = feet[j];
      const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      const oz = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
      if (ox <= 0 || oz <= 0) continue;
      const area = ox * oz;
      if (area > worst) {
        worst = area;
        worstPair = `${a.name} / ${b.name}`;
      }
    }
  }
  ok(
    "no two building footprints overlap anywhere in the band",
    worst === 0,
    `worst ${worst.toFixed(3)} sq units at ${worstPair}`,
  );
  host.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) mesh.geometry.dispose();
  });
}

restoreParams();
console.log("\n" + "-".repeat(60));
console.log(`SURROUND: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
