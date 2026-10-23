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
  ISLAND_SET_PIECES,
} from "../src/render/surroundRecipe";
import {
  distantAnchor,
  distantBarrel,
  distantCannon,
  distantCoinPile,
  distantCrate,
  distantJungleBush,
  distantPalm,
  distantPirateFlag,
  distantPistols,
  distantRopeCoil,
  distantShipWheel,
  distantShipwreck,
  distantSkullPost,
  distantSwordInSand,
  distantTreasureChest,
} from "../src/render/islandProps";
import {
  makeSurroundMaterials,
  disposeSurroundMaterials,
  distantBed,
  distantBroadleaf,
  distantClippedHedge,
  distantConifer,
  distantDune,
  distantFloweringShrub,
  distantPicketFence,
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
import { SEASIDE_PARAMS, inSea, shoreZ } from "../src/render/seaside";
import { floorAccentsFor, pavingColorFor } from "../src/render/floorTexture";
import { snapToPalette } from "../src/render/madboxStyle";
import { MADBOX_STYLE_ON } from "../src/render/madboxFlag";
import { LAKE, PARK_PARAMS, PLAYGROUND, avenueHalfWidth, inParkZone } from "../src/render/parkLayout";
import { CITY_PARAMS, crossingX, sideWalkBand, streetBands } from "../src/render/cityLayout";

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
const FOREST = MAZE_THEMES.find((t) => t.id === "forest")!;

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
    ["clippedHedge", distantClippedHedge(mats, { length: 4, seed: 4 }), 0.02],
    ["broadleaf", distantBroadleaf(mats, { seed: 5 }), 0.02],
    ["conifer", distantConifer(mats, { seed: 6 }), 0.02],
    ["shrubClump", distantShrubClump(mats, { seed: 7 }), 0.15],
    ["bed", distantBed(mats, { seed: 8 }), 0.02],
    ["tower", distantTower(mats, { seed: 9 }), 0.02],
    ["dune", distantDune(mats, { seed: 10 }), 0.7],
    ["rockOutcrop", distantRockOutcrop(mats, { seed: 11 }), 0.15],
    ["picketFence", distantPicketFence(mats, { length: 6, seed: 12 }), 0.02],
    ["floweringShrub", distantFloweringShrub(mats, { seed: 13 }), 0.15],
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
section("The conifer is the hero pine, and it arrives in a shape the band can weld");

{
  // IDEA-065 v4 swapped `distantConifer`'s three cones for `pineWhorlStack`,
  // the same geometry `makeForestPine` is built from. Two traps came with it,
  // both hit for real while writing it, and neither is visible in a render or
  // catchable by the checks above.
  const mats = makeSurroundMaterials(FOREST.palette);
  for (const detail of [0, 1] as const) {
    const g = distantConifer(mats, { seed: 12, detail });
    const meshes: THREE.Mesh[] = [];
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });

    // TRAP 1: A MATERIAL ARRAY SURVIVES `mergeBySignature` WHOLE AND COSTS A
    // DRAW CALL PER GROUP (IDEA-067 rule 7). The hero's canopy is one mesh
    // with two material groups, which is right for a prop and catastrophic
    // here — 459 trees would arrive as ~1,200 draw calls in a band that
    // spends six. The "<= 18 draw calls" check below does catch it, but it
    // catches it as a number nobody can trace back to a cause.
    ok(
      `conifer(detail ${detail}): no mesh carries a material ARRAY`,
      meshes.every((m) => !Array.isArray(m.material)),
      "mergeBySignature skips these by contract, so each group becomes a draw call",
    );

    // TRAP 2: THE DARK SIDE CAN VANISH IN SILENCE. `whorlProfile` classifies
    // strips as lit or shaded by COUNT, and at the reduced profile detents
    // the hero's point-count happened to classify every strip as LIT — a tree
    // correctly built, correctly merged, inside budget, using only the shared
    // set, and painted entirely in one green. Every assertion above passes on
    // it. What actually defines a tier from above is the dark line under each
    // rim, so losing the shaded group costs the whole silhouette.
    const lit = meshes.find((m) => m.name === "canopyLit");
    const dark = meshes.find((m) => m.name === "canopyDark");
    ok(`conifer(detail ${detail}): has a lit canopy`, lit !== undefined);
    ok(`conifer(detail ${detail}): has a SHADED canopy`, dark !== undefined);
    const triCount = (m?: THREE.Mesh) =>
      m ? (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3 : 0;
    const share = triCount(dark) / Math.max(1, triCount(lit) + triCount(dark));
    ok(
      `conifer(detail ${detail}): the shaded side is a real share of the tree`,
      share > 0.15 && share < 0.6,
      `${(share * 100).toFixed(1)}% of the canopy`,
    );
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
  const kinds = ["none", "plots", "woodland", "dunes", "parkland", "cityblocks", "island"];
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
section("The garden is planted, not built (IDEA-083)");

// Nuno: *"this maze has too much noise around it and I don't feel this is a
// garden — remove all the houses and treehouses, just trees and shrubs with
// flowers, groups of the props' flowers, and fences making squares."* The
// merge welds the band into one mesh per material, so every question about
// WHAT was placed has to be asked of `buildSurroundContent`, before it.
{
  const mats = makeSurroundMaterials(GARDEN.palette);
  const host = buildSurroundContent("plots", mats);
  const count = (pred: (c: THREE.Object3D) => boolean): number => host.children.filter(pred).length;
  const buildings = count((c) => c.name.startsWith("building-"));
  ok("the garden's surround builds no house, shed or greenhouse", buildings === 0, `${buildings} buildings`);
  // A fence is a group of pickets; a hedge run is a group of `hedge*` blobs.
  const isFence = (c: THREE.Object3D): boolean => c.children.some((k) => k.name.startsWith("picket"));
  const fences = count(isFence);
  ok("the plots are fenced", fences > 40, `${fences} fence runs`);
  const patches = count((c) => c.children.some((k) => k.name.startsWith("flower") && k.children.length > 0));
  ok("the Props tab's flowers are planted in patches", patches > 10, `${patches} patches`);
  const shrubs = count((c) => c.children.some((k) => k.name.startsWith("bloom")) && c.children.some((k) => k.name.startsWith("blob")));
  ok("there are flowering shrubs", shrubs > 10, `${shrubs} shrubs`);

  // Every flower in every patch landed on the SHARED set — the patch builds
  // the library's flower, which makes its own materials, and swaps them.
  // Miss one and the draw-call check below fails as a bare number.
  const known = new Set<THREE.Material>(Object.values(mats));
  let foreign = 0;
  host.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && !known.has(mesh.material as THREE.Material)) foreign++;
  });
  ok("every mesh in the band uses the shared material set", foreign === 0, `${foreign} foreign`);
  host.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) mesh.geometry.dispose();
  });
  disposeSurroundMaterials(mats);
}

// ---------------------------------------------------------------------------
section("The beach has a sea to the north, sunbathers to the south and open sides");

// IDEA-080. Nuno: *"lets add instead a sea on the top on the north part of the
// maze and on the left we will add some beach towels and umbrella, on the
// right we will add some tents."* Then (v4): *"the east and west sides don't
// need to have any decoration, so let's put the towels and the umbrellas on
// the south side and remove the things on the sides."*
{
  restoreParams();
  const BEACH = MAZE_THEMES.find((t) => t.id === "beach")!;
  ok("the beach still grows the coast kind", BEACH.palette.surround === "dunes");

  // --- the coast's own geometry, sampled across the whole ground -----------
  let nearest = -Infinity;
  for (let x = -SURROUND_PARAMS.halfWidth; x <= SURROUND_PARAMS.halfWidth; x += 0.25) {
    nearest = Math.max(nearest, shoreZ(x));
  }
  // The WATER at its highest run up the sand must stay out of the verge —
  // that ring is for hand-placed props, and a palm in the surf is a defect
  // nobody would ever have placed on purpose.
  const vergeEdge = -(FLOOR_HALF_Z + VERGE_RINGS);
  ok(
    "the swash never runs into the verge",
    nearest + SEASIDE_PARAMS.swashReach < vergeEdge - 0.3,
    `water reaches z ${(nearest + SEASIDE_PARAMS.swashReach).toFixed(2)} against the verge at ${vergeEdge}`,
  );
  // The wet band is paint on the ground and may cross the verge, but never the
  // board's own floor — a dark stripe across the maze's apron would read as a
  // shadow the board does not have.
  ok(
    "the wet sand stops short of the board's floor",
    nearest + SEASIDE_PARAMS.swashReach + SEASIDE_PARAMS.wetWidth < -FLOOR_HALF_Z - 0.5,
    `wet sand reaches z ${(nearest + SEASIDE_PARAMS.swashReach + SEASIDE_PARAMS.wetWidth).toFixed(2)}`,
  );
  // BOUNDED AT BOTH ENDS: a coast pushed far enough out to pass the two checks
  // above for free is one a 16:9 desktop never sees (its frame ends at
  // z = -21.2, measured by _scratch-surround-coverage.ts).
  let farthest = Infinity;
  for (let x = -32; x <= 32; x += 0.25) farthest = Math.min(farthest, shoreZ(x));
  ok("…and the sea is in shot on a desktop", farthest > -19.5, `farthest coast z ${farthest.toFixed(2)}`);

  // --- what stands on the beach --------------------------------------------
  const mats = makeSurroundMaterials(BEACH.palette);
  const host = buildSurroundContent("dunes", mats);
  let spots = 0;
  let tents = 0;
  let notSouth = 0;
  let wet = 0;
  let dunes = 0;
  for (const child of host.children) {
    const isSpot = child.name === "beach-spot";
    const isTent = child.name.startsWith("tent-");
    if (child.getObjectByName("dune")) dunes++;
    if (!isSpot && !isTent) continue;
    if (isSpot) spots++;
    else tents++;
    const x = child.position.x;
    const z = child.position.z;
    // South of the board's own floor — anything level with the maze is on a
    // side, which is exactly what v4 cleared.
    if (z <= FLOOR_HALF_Z) notSouth++;
    // Dry means above the swash's highest reach AND its wet band.
    if (inSea(x, z, SEASIDE_PARAMS.swashReach + SEASIDE_PARAMS.wetWidth)) wet++;
  }
  ok("there are sunbathers", spots > 6, `${spots} beach spots`);
  ok("the campsite is gone", tents === 0, `${tents} tents`);
  ok("everything stands SOUTH of the board — the sides are open sand", notSouth === 0, `${notSouth} beside or above the maze`);
  // Edge to edge, not a patch: the south band includes its corner plots.
  const xs = host.children.filter((c) => c.name === "beach-spot").map((c) => c.position.x);
  ok(
    "…and the sunbathers run along both halves of the south",
    xs.some((x) => x < -COLS / 2) && xs.some((x) => x > COLS / 2),
    `x from ${Math.min(...xs).toFixed(1)} to ${Math.max(...xs).toFixed(1)}`,
  );
  ok("nothing is pitched in the water or on the wet sand", wet === 0, `${wet} in the surf`);
  ok("the dunes are gone", dunes === 0, `${dunes} dunes`);
  host.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) mesh.geometry.dispose();
  });
  disposeSurroundMaterials(mats);

  // --- the sea itself -------------------------------------------------------
  const scene = new THREE.Group();
  const g = ensureSurround(scene, BEACH.palette.surround, BEACH.palette)!;
  const sea = g.getObjectByName("sea") as THREE.Mesh | undefined;
  const shore = g.getObjectByName("shore") as THREE.Mesh | undefined;
  ok("the beach's surround carries a sea and a shore", !!sea && !!shore);
  // WOUND TO FACE UP — the defect that renders as NOTHING, because a FrontSide
  // plane facing down is culled whole. journeyWater.ts's ribbon shipped it
  // once; measured on every triangle rather than on the first.
  for (const [name, mesh] of [["sea", sea], ["shore", shore]] as const) {
    if (!mesh) continue;
    const pos = mesh.geometry.getAttribute("position");
    const idx = mesh.geometry.index!;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    let down = 0;
    for (let i = 0; i < idx.count; i += 3) {
      a.fromBufferAttribute(pos, idx.getX(i));
      b.fromBufferAttribute(pos, idx.getX(i + 1));
      c.fromBufferAttribute(pos, idx.getX(i + 2));
      if (b.sub(a).cross(c.sub(a)).y <= 0) down++;
    }
    ok(`the ${name} faces up on every triangle`, down === 0, `${down} facing down`);
    // A ShaderMaterial is what keeps IDEA-079's swap off it: no `color`, so
    // `applyMadboxStyle` passes it by. A toon sea would be snapped to a
    // matcap and lose its gradient and its surf.
    ok(
      `the ${name} is its own shader, not a styleable material`,
      (mesh.material as THREE.Material).type === "ShaderMaterial",
    );
  }
  ok("the sea casts and takes no shadow", !!sea && !sea.castShadow && !sea.receiveShadow);
  disposeSurround();
  const garden = ensureSurround(new THREE.Group(), GARDEN.palette.surround, GARDEN.palette)!;
  ok("…and no other theme has one", !garden.getObjectByName("seaside"));
  disposeSurround();
}

// ---------------------------------------------------------------------------
section("The park: an avenue east and west, a lake north, a playground south");

// IDEA-081. Nuno's layout, after the first build put the lake and the
// playground east and west, where a phone cannot see them: *"the path instead
// of being on north and south pass to be in east and west and the lake on
// north and the park on south."*
{
  restoreParams();
  const PARK = MAZE_THEMES.find((t) => t.id === "park")!;
  ok("the park still grows the parkland kind", PARK.palette.surround === "parkland");
  const mats = makeSurroundMaterials(PARK.palette);
  const host = buildSurroundContent("parkland", mats);
  const az = PARK_PARAMS.avenueZ;

  // --- the avenue -------------------------------------------------------------
  // It leaves the board where the beagle does: the tunnel is row 9 on every
  // maze, so pin the avenue to the GRID rather than to its own constant.
  const tunnelRows = new Set<number>();
  for (const maze of MAZES) for (const ty of new Grid(maze).tunnelRows) tunnelRows.add(ty);
  ok(
    "the avenue runs along the maze's tunnel row",
    tunnelRows.size === 1 && az === [...tunnelRows][0] - (ROWS - 1) / 2,
    `tunnel rows ${[...tunnelRows]}, avenue z ${az}`,
  );
  const paths = host.children.filter((c) => c.name === "park-path");
  ok(
    "there is a path east AND a path west",
    paths.some((p) => p.position.x < 0) && paths.some((p) => p.position.x > 0),
    `${paths.length} paths`,
  );
  ok("both paths run straight along that row", paths.every((p) => p.position.z === az));
  // They must START AT THE BOARD, or the path is a strip floating in a field.
  // Measured from vertices: the path is rotated, so Box3 would over-report.
  ok(
    "both paths reach the board's floor edge",
    paths.every((p) => {
      p.updateMatrixWorld(true);
      let near = Infinity;
      const v = new THREE.Vector3();
      p.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || mesh.name !== "paving") return;
        const pos = mesh.geometry.getAttribute("position");
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
          near = Math.min(near, Math.abs(v.x));
        }
      });
      return Math.abs(near - FLOOR_HALF_X) < 0.05;
    }),
  );
  const benches = host.children.filter((c) => c.name === "park-bench");
  const bins = host.children.filter((c) => c.name === "park-bin");
  ok(
    "benches line both sides, east and west",
    [-1, 1].every((end) =>
      [-1, 1].every((side) =>
        benches.some((b) => Math.sign(b.position.x) === end && Math.sign(b.position.z - az) === side),
      ),
    ),
    `${benches.length} benches`,
  );
  ok("there are a FEW bins, fewer than benches", bins.length > 0 && bins.length < benches.length, `${bins.length} bins`);
  // A bench's sitting side is its local +Z. Facing the path means +Z points
  // back toward the avenue's line — wrong-signed, it sits with its back to it.
  const v = new THREE.Vector3();
  const facingAway = benches.filter((b) => {
    v.set(0, 0, 1).applyEuler(b.rotation);
    return v.z * (b.position.z - az) >= 0;
  });
  ok("every avenue bench faces the path", facingAway.length === 0, `${facingAway.length} face away`);
  const own = host.children.filter((c) => c.userData.avenue);
  ok("the avenue's own trees and hedges are tagged", own.length > 0, `${own.length}`);
  // The furniture keeps out of the verge, which is hand-placed ground.
  const clearX = FLOOR_HALF_X + SURROUND_PARAMS.keepClear;
  const clearZ = FLOOR_HALF_Z + SURROUND_PARAMS.keepClear;
  const inVerge = [...benches, ...bins, ...own].filter(
    (c) => Math.abs(c.position.x) < clearX && Math.abs(c.position.z) < clearZ,
  );
  ok("no avenue furniture stands in the verge", inVerge.length === 0, `${inVerge.length} inside`);
  ok(
    "the reserved ground covers the avenue's own tree row",
    avenueHalfWidth() > PARK_PARAMS.pathWidth / 2 + PARK_PARAMS.outerRow,
  );

  // --- nothing else stands on the park's zones ---------------------------------
  // MEASURED INDEPENDENTLY of parkLayout's own `inParkZone`: when this check
  // called that function, gutting it removed the reservation AND blinded the
  // check in one edit, and it passed on the defect it exists for.
  const onParkGround = (x: number, z: number): boolean => {
    const G = PLAYGROUND;
    const inPlay = Math.abs(x - G.cx) < G.width / 2 + G.reserve && Math.abs(z - G.cz) < G.depth / 2 + G.reserve;
    // The lake's water and path, by its own numbers: an ellipse 1.12x the
    // radii (the shore wobble's ceiling) plus the path.
    const lx = (LAKE.rx + LAKE.pathOffset) * 1.12 + LAKE.pathWidth;
    const lz = (LAKE.rz + LAKE.pathOffset) * 1.12 + LAKE.pathWidth;
    const inWater = ((x - LAKE.cx) / lx) ** 2 + ((z - LAKE.cz) / lz) ** 2 < 1;
    const onAvenue = Math.abs(z - az) < avenueHalfWidth() && Math.abs(x) > FLOOR_HALF_X;
    return inPlay || inWater || onAvenue;
  };
  const intruders = host.children.filter(
    (c) =>
      !c.name.startsWith("park-") &&
      c.name !== "playground" &&
      !c.userData.avenue &&
      onParkGround(c.position.x, c.position.z),
  );
  ok(
    "no plot or fringe item stands on the avenue, the lake or the playground",
    intruders.length === 0,
    intruders.length
      ? `${intruders.length}, e.g. ${intruders[0].name || "(unnamed)"} at (${intruders[0].position.x.toFixed(1)}, ${intruders[0].position.z.toFixed(1)})`
      : "",
  );
  ok("each zone's ground is reserved", [
    [PLAYGROUND.cx, PLAYGROUND.cz],
    [LAKE.cx, LAKE.cz],
    [FLOOR_HALF_X + 6, az],
    [-FLOOR_HALF_X - 6, az],
  ].every(([x, z]) => inParkZone(x, z)));

  /** World-space XZ extent of the named meshes under `root`, from VERTICES. */
  const extent = (root: THREE.Object3D, names?: string[]): { x0: number; x1: number; z0: number; z1: number } => {
    root.updateMatrixWorld(true);
    const e = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
    const p = new THREE.Vector3();
    const visit = (o: THREE.Object3D): void => {
      o.traverse((n) => {
        const mesh = n as THREE.Mesh;
        if (!mesh.isMesh) return;
        const pos = mesh.geometry.getAttribute("position");
        for (let i = 0; i < pos.count; i++) {
          p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
          e.x0 = Math.min(e.x0, p.x);
          e.x1 = Math.max(e.x1, p.x);
          e.z0 = Math.min(e.z0, p.z);
          e.z1 = Math.max(e.z1, p.z);
        }
      });
    };
    if (names) for (const n of names) visit(root.getObjectByName(n)!);
    else visit(root);
    return e;
  };

  // --- the lake ------------------------------------------------------------------
  // Nuno: *"a lake with some flora and duck and a path around the lake to
  // indicate the people walk around there."*
  const lake = host.getObjectByName("park-lake");
  ok("there is a lake", !!lake);
  if (lake) {
    ok("…NORTH of the board", LAKE.cz < -FLOOR_HALF_Z && Math.abs(LAKE.cx) < 1);
    for (const piece of ["lake", "lake-path", "duck", "reeds", "lily"]) {
      ok(`…with ${piece}`, !!lake.getObjectByName(piece));
    }
    const all = extent(lake);
    ok("…entirely outside the keep-clear box", all.z1 < -clearZ, `south edge at z ${all.z1.toFixed(2)} against ${-clearZ}`);
    // Framed for BOTH screens. A phone sees the north band whole; measured off
    // the portrait render its frame is about +-11 units wide at the lake's
    // near shore. A desktop's frame ends at z -21.2, so the near shore AND the
    // ducks must sit south of that or a desktop shows no lake at all.
    const water = extent(lake, ["lake", "lake-path"]);
    ok("…the water and its path fit a phone's width", water.x0 > -12 && water.x1 < 12, `x ${water.x0.toFixed(2)}..${water.x1.toFixed(2)}`);
    ok("…and a desktop sees its near shore", water.z1 > -19, `near shore at z ${water.z1.toFixed(2)}`);
    for (const name of ["bank", "shallows", "deep", "gravel"]) {
      const mesh = lake.getObjectByName(name) as THREE.Mesh;
      const pos = mesh.geometry.getAttribute("position");
      const idx = mesh.geometry.index!;
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      const c = new THREE.Vector3();
      let down = 0;
      for (let i = 0; i < idx.count; i += 3) {
        a.fromBufferAttribute(pos, idx.getX(i));
        b.fromBufferAttribute(pos, idx.getX(i + 1));
        c.fromBufferAttribute(pos, idx.getX(i + 2));
        if (b.sub(a).cross(c.sub(a)).y < 0) down++;
      }
      // Wound the other way it is culled whole and renders as nothing.
      ok(`the lake's ${name} faces up on every triangle`, down === 0, `${down} facing down`);
    }
    const ducks = lake.children.filter((c) => c.name === "duck");
    const dry = ducks.filter(
      (d) => ((d.position.x - LAKE.cx) / LAKE.rx) ** 2 + ((d.position.z - LAKE.cz) / LAKE.rz) ** 2 > 0.85,
    );
    ok("there are ducks, and every one is on the water", ducks.length >= 4 && dry.length === 0, `${ducks.length} ducks, ${dry.length} ashore`);
    ok("…floating, not sunk to the lake bed", ducks.every((d) => d.position.y > 0.02));
    ok("…and the family is on the near half, where a desktop sees it", ducks.filter((d) => d.position.z > -21.2).length >= 4);
    const lakeBenches = lake.children.filter((c) => c.name === "park-bench");
    const away = lakeBenches.filter((b) => {
      v.set(0, 0, 1).applyEuler(b.rotation);
      return v.x * (LAKE.cx - b.position.x) + v.z * (LAKE.cz - b.position.z) <= 0;
    });
    ok("benches by the lake face the water", lakeBenches.length > 0 && away.length === 0, `${lakeBenches.length} benches, ${away.length} facing away`);
  }

  // --- the playground ----------------------------------------------------------
  // Nuno: *"a kids park with a slide and a climbing toy we use to see and a
  // swing."*
  const play = host.getObjectByName("playground");
  ok("there is a playground", !!play);
  if (play) {
    ok("…SOUTH of the board", play.position.z > FLOOR_HALF_Z && Math.abs(play.position.x) < 1);
    for (const piece of ["play-slide", "play-dome", "play-swing", "play-area"]) {
      ok(`…with its ${piece.slice(5)}`, !!play.getObjectByName(piece));
    }
    const e = extent(play);
    ok("…entirely outside the keep-clear box", e.z0 > clearZ, `north edge at z ${e.z0.toFixed(2)} against ${clearZ}`);
    // The south band is the phone's alone: its frame ends at z +22.4 and is
    // only ~+-10 units wide down there. Measured off the portrait render.
    const pad = extent(play, ["play-area"]);
    ok("…and its fenced area fits a phone's frame", pad.z1 < 22 && pad.x0 > -10 && pad.x1 < 10, `x ${pad.x0.toFixed(2)}..${pad.x1.toFixed(2)}, z ..${pad.z1.toFixed(2)}`);
    // The chute runs DOWN-frame (+Z), toward the viewer. Turned away, it is
    // foreshortened behind its own platform and the slide reads as a hut.
    const chute = play.getObjectByName("chute")!;
    const cdir = new THREE.Vector3(0, 0, 1).transformDirection(chute.matrixWorld);
    ok("…its slide's chute runs toward the camera and downhill", cdir.z > 0.5 && cdir.y < -0.2, `dir ${cdir.toArray().map((n) => n.toFixed(2))}`);
    // The gate faces the MAZE: no fence post in the middle of the north side.
    const posts = play.getObjectByName("play-area")!.children.filter((c) => c.name.startsWith("post"));
    const blocking = posts.filter((p) => Math.abs(p.position.x) < 0.5 && p.position.z < 0);
    ok("…and its gate faces the maze", blocking.length === 0 && posts.length > 0, `${blocking.length} posts across the gate`);
    // Nothing tall in the nearest, unfogged band under the controls.
    let top = 0;
    const tv = new THREE.Vector3();
    play.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const pos = mesh.geometry.getAttribute("position");
      for (let i = 0; i < pos.count; i++) top = Math.max(top, tv.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).y);
    });
    ok("…and nothing in it stands taller than the south band allows", top < 2.6, `top at y ${top.toFixed(2)}`);
  }

  // No flower beds anywhere in the park (Nuno, twice: first the lawns', then
  // the avenue's). A bed is the one group with a "kerb" mesh in it.
  const beds = host.children.filter((c) => c.getObjectByName("kerb"));
  ok("no flower beds anywhere in the park", beds.length === 0, `${beds.length} beds`);
  // The avenue's trees are joined by low hedges, one behind every bench.
  const hedges = host.children.filter((c) => c.name === "avenue-hedge");
  const avBenches = benches.filter((b) => Math.abs(b.position.z - az) < avenueHalfWidth());
  ok("a hedge stands behind every avenue bench", hedges.length > 0 && hedges.length === avBenches.length, `${hedges.length} hedges, ${avBenches.length} benches`);
  ok(
    "…low enough to read as a fence, not as more maze",
    PARK_PARAMS.hedgeHeight <= 0.6,
    `hedgeHeight ${PARK_PARAMS.hedgeHeight}`,
  );
  // And it must not reach INTO a trunk — the gap is what makes the trees
  // read as standing in the hedge line rather than buried in it.
  const trees = own.filter((c) => c.name !== "avenue-hedge");
  const hv = new THREE.Vector3();
  let buried = 0;
  for (const h of hedges) {
    h.updateMatrixWorld(true);
    let x0 = Infinity;
    let x1 = -Infinity;
    h.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const pos = mesh.geometry.getAttribute("position");
      for (let i = 0; i < pos.count; i++) {
        hv.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        x0 = Math.min(x0, hv.x);
        x1 = Math.max(x1, hv.x);
      }
    });
    for (const t of trees) {
      if (Math.abs(t.position.z - h.position.z) > 0.01) continue;
      if (t.position.x > x0 + 0.05 && t.position.x < x1 - 0.05) buried++;
    }
  }
  ok("no avenue tree's trunk stands inside a hedge", buried === 0, `${buried} buried`);
  // A park has no sheds — those came from the garden's south-fringe rule.
  const buildings = host.children.filter((c) => c.name.startsWith("building-"));
  ok("the park has no houses, sheds or greenhouses", buildings.length === 0, `${buildings.length} buildings`);
  host.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) mesh.geometry.dispose();
  });
  disposeSurroundMaterials(mats);
}


// ---------------------------------------------------------------------------
section("The park's floor is the park's ground: its lawn and its path");

// IDEA-081. Nuno: *"the floor of this maze should follow the color path of the
// path we have on the west and east side and the green part should be the same
// color as the environment green color."*
{
  const PARK = MAZE_THEMES.find((t) => t.id === "park")!;
  const acc = floorAccentsFor(PARK.palette);
  // The lawn: measured before this, the board's own border rendered at
  // (55, 90, 34) against the surround's (120, 150, 93) — a dark frame round
  // the maze. Same colour, same material, same light is the whole fix.
  ok("the board's lawn is painted in the surround's own ground colour", acc.lawn === PARK.palette.surroundGround);
  // The path: ONE definition shared with the avenue's paving material, so the
  // walk cannot change colour where it leaves the board through the tunnel.
  const mats = makeSurroundMaterials(PARK.palette);
  ok(
    "the avenue's paving IS the shared paving colour",
    mats.wallLight.color.getHex() === pavingColorFor(PARK.palette.surroundGround),
    `material #${mats.wallLight.color.getHexString()} against #${pavingColorFor(PARK.palette.surroundGround).toString(16)}`,
  );
  disposeSurroundMaterials(mats);
  // The corridors must be the avenue's HUE. Under the shipped style the avenue
  // is drawn as its SNAPPED palette entry, so painting the paving hex straight
  // gave a grey beige corridor beside a warm sand path. Compared as a hue, not
  // as "which entry would this snap to": a board texture is never snapped, so
  // that question measures something that does not happen — and the first
  // version of this check failed a correct floor on exactly that, the scaled
  // colour sitting just over the gold/sand boundary it is never put through.
  const paving = pavingColorFor(PARK.palette.surroundGround);
  const drawn = MADBOX_STYLE_ON ? snapToPalette(paving).hex : paving;
  const hsl = (hex: number): { h: number; s: number; l: number } => new THREE.Color(hex).getHSL({ h: 0, s: 0, l: 0 });
  const dh = acc.path === undefined ? 1 : Math.abs(hsl(acc.path).h - hsl(drawn).h);
  ok(
    "the corridors are the hue the avenue is drawn in",
    Math.min(dh, 1 - dh) * 360 < 3,
    `corridor #${acc.path?.toString(16)} against #${drawn.toString(16)}, ${(Math.min(dh, 1 - dh) * 360).toFixed(1)} degrees apart`,
  );
  ok("…edged in the avenue's own kerb stone", acc.kerb === PARK.palette.groundDetailColor);

  // THE BISCUIT TRAIL HAS TO READ ON A PHONE (Nuno, after playing: "the
  // contrast is not the best... allow the user see clearly the dots"). A
  // biscuit there is about five pixels across, so hue is worth nothing and
  // VALUE is everything. Measured on the phone render: 3.1:1 with a sand walk
  // and a `bark` biscuit, 10.9:1 with a cream walk and an ink one.
  //
  // The biscuit is a declared INK marking — the high-key palette's darkest
  // warm rung is `bark` (#b07d52), and no authored colour can get below it.
  ok("the park's biscuit trail is drawn from the ink set", PARK.inkBiscuits === true);
  ok("…and lands on the WARM ink, a chocolate rather than a hole", snapToPalette(PARK.palette.biscuit, "ink").id === "inkWarm");
  // Bounded in PAINT terms, before lighting, so this holds whatever the scene
  // does: the walk as painted against the biscuit's ink entry. WCAG's 4.5:1 is
  // the floor for body text, which is the right bar for a small mark the
  // player reads constantly.
  if (MADBOX_STYLE_ON && acc.path !== undefined) {
    const relL = (hex: number): number => {
      const ch = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((v) => {
        const c = v / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
    };
    const walk = relL(acc.path);
    const dot = relL(snapToPalette(PARK.palette.biscuit, "ink").hex);
    const ratio = (walk + 0.05) / (dot + 0.05);
    ok("the painted walk and the biscuit clear 4.5:1", ratio >= 4.5, `${ratio.toFixed(2)}:1`);
  }
  // And nobody else's floor moves: every other theme paints exactly as before.
  const others = MAZE_THEMES.filter((t) => t.id !== "park" && t.palette.floorTexture !== "parkGrass");
  ok("no other theme's floor takes accents", others.every((t) => Object.keys(floorAccentsFor(t.palette)).length === 0));
}

// ---------------------------------------------------------------------------
section("IDEA-082: Night City is streets, cars, trees and fewer, finished buildings");

{
  // Nuno: *"on the board night city lets remove the props around the maze ...
  // lets make less buildings but lets add a road on the north and south sides
  // and in the road some cars. On the sides lets have a building and some
  // trees. On the sides of the north and south road lets have a walking path
  // and trees on the sides of the road."*
  restoreParams();
  const CITY = MAZE_THEMES.find((t) => t.id === "city")!;
  ok("the props around Night City's maze are gone", CITY.placements.length === 0 && CITY.verge.length === 0);
  const host = buildSurroundContent("cityblocks", makeSurroundMaterials(CITY.palette));
  const streets = host.getObjectByName("city-streets");
  ok("the city is laid out as streets", !!streets);
  if (streets) {
    const kids = streets.children;
    const named = (n: string): THREE.Object3D[] => kids.filter((c) => c.name === n);
    const S = streetBands();
    const roads = named("city-road");
    ok(
      "a road on the NORTH and one on the SOUTH",
      roads.length === 2 &&
        roads.some((r) => Math.abs(r.position.z + S.roadCentre) < 1e-6) &&
        roads.some((r) => Math.abs(r.position.z - S.roadCentre) < 1e-6),
    );
    const clearZ = FLOOR_HALF_Z + SURROUND_PARAMS.keepClear;
    ok("the street starts outside the keep-clear box", S.nearWalk[0] > clearZ, `${S.nearWalk[0]} vs ${clearZ}`);
    // Framed for both screens: a desktop sees north to z -21.2, a phone south
    // to +22.4. Measured off the rigs (IDEA-066/069).
    ok("…and ends inside both frames", S.farWalk[1] < 21.2, `outer edge at ${S.farWalk[1]}`);

    // Rule 3: every vehicle on a road, in a lane, facing the way it goes.
    const cars = kids.filter((c) => /^city-(car|taxi|bus)$/.test(c.name));
    ok(
      "there is traffic on both roads",
      cars.some((c) => c.position.z < 0) && cars.some((c) => c.position.z > 0),
      `${cars.length} vehicles`,
    );
    const v = new THREE.Vector3();
    const wrongWay = cars.filter((c) => {
      v.set(1, 0, 0).applyEuler(c.rotation);
      const roadZ = Math.sign(c.position.z) * S.roadCentre;
      const laneDir = c.position.z > roadZ ? 1 : -1; // the near lane drives +X
      return Math.sign(v.x) !== laneDir || Math.abs(c.position.z - roadZ) > CITY_PARAMS.roadWidth / 2 - 0.4;
    });
    ok("every vehicle is in a lane, facing the way its lane goes", wrongWay.length === 0, `${wrongWay.length} wrong`);
    const cx = crossingX();
    const onZebra = cars.filter((c) => Math.abs(Math.abs(c.position.x) - cx) < CITY_PARAMS.crossingWidth / 2 + 0.6);
    ok("no vehicle stands on a zebra", onZebra.length === 0, `${onZebra.length}`);
    ok("both roads have both crossings", named("city-crosswalk").length === 4);

    // Pavements and trees on BOTH sides of BOTH roads.
    const trees = named("city-tree");
    const onBand = (z: number, [a, b]: [number, number]): boolean => Math.abs(z) >= a && Math.abs(z) <= b;
    for (const [label, sgn] of [["north", -1], ["south", 1]] as const) {
      const mine = trees.filter((t) => Math.sign(t.position.z) === sgn);
      ok(`${label}: street trees on the near pavement`, mine.some((t) => onBand(t.position.z, S.nearWalk)));
      ok(`${label}: …and on the far one`, mine.some((t) => onBand(t.position.z, S.farWalk)));
    }
    ok("no tree stands in a road", trees.every((t) => !onBand(t.position.z, S.road)));

    // East and west: buildings and trees past the side pavement.
    const [sx0] = sideWalkBand();
    for (const [label, sgn] of [["east", 1], ["west", -1]] as const) {
      const side = (o: THREE.Object3D): boolean =>
        Math.sign(o.position.x) === sgn && Math.abs(o.position.z) < S.nearWalk[0] && Math.abs(o.position.x) > sx0;
      ok(`${label}: buildings`, named("city-building").some(side));
      ok(`${label}: …and trees`, trees.some(side));
    }

    // Nothing built on a street, and nothing built SOUTH of the south road
    // (cityLayout rule 2: the phone's nearest, unfogged band, under the controls).
    const buildings = named("city-building");
    const onStreet = buildings.filter(
      (b) => Math.abs(b.position.z) > S.nearWalk[0] - 0.3 && Math.abs(b.position.z) < S.farWalk[1] + 0.3,
    );
    ok("no building stands on a street", onStreet.length === 0, `${onStreet.length}`);
    ok("nothing is built south of the south street", buildings.every((b) => b.position.z < S.nearWalk[0]));

    // "Too basic": each one has a bottom, a top and a front, and lit windows.
    const b0 = buildings[0];
    for (const piece of ["shopfront", "awning", "cornice", "body", "plinth"]) {
      ok(`a building carries its ${piece}`, !!b0?.getObjectByName(piece));
    }
    const litMat = (b0?.getObjectByName("shopfront") as THREE.Mesh | undefined)?.material;
    ok("…and lit windows", !!b0 && b0.children.some((c) => c.name.includes("win") && (c as THREE.Mesh).material === litMat));
  }
}

// ---------------------------------------------------------------------------
section("Pirate Island: palms, ship's gear, treasure, and a wreck on the water (IDEA-085)");

{
  const ISLAND = MAZE_THEMES.find((t) => t.id === "island")!;
  ok("the island theme grows the island kind", ISLAND?.palette.surround === "island");
  restoreParams();
  const mats = makeSurroundMaterials(ISLAND.palette);
  const known = new Set<THREE.Material>(Object.values(mats));

  /** World-space vertex scan: lowest y, triangle count, named/foreign meshes. */
  const scan = (g: THREE.Object3D) => {
    g.updateMatrixWorld(true);
    let meshes = 0, named = 0, foreign = 0, tris = 0, lowest = Infinity;
    const v = new THREE.Vector3();
    g.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      meshes++;
      if (mesh.name) named++;
      if (!known.has(mesh.material as THREE.Material)) foreign++;
      const pos = mesh.geometry.attributes.position;
      tris += (mesh.geometry.index ? mesh.geometry.index.count : pos.count) / 3;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        if (v.y < lowest) lowest = v.y;
      }
    });
    return { meshes, named, foreign, tris, lowest };
  };

  // Same contract as every distant builder above: on the ground (a little
  // sunk is fine for a thing lying IN sand; floating never is), named, the
  // shared set only, and the surround's 600-triangle budget.
  const subjects: Array<[string, THREE.Group, number]> = [
    ["palm", distantPalm(mats, { seed: 1 }), 0.02],
    ["jungleBush", distantJungleBush(mats, { seed: 2 }), 0.15],
    ["cannon", distantCannon(mats, { seed: 3 }), 0.02],
    ["pirateFlag", distantPirateFlag(mats, { seed: 4 }), 0.02],
    ["shipWheel", distantShipWheel(mats, { seed: 5 }), 0.15],
    ["barrel", distantBarrel(mats, { seed: 6, tipped: false }), 0.02],
    ["barrelTipped", distantBarrel(mats, { seed: 6, tipped: true }), 0.02],
    ["crate", distantCrate(mats), 0.02],
    ["anchor", distantAnchor(mats, { seed: 7 }), 0.12],
    ["ropeCoil", distantRopeCoil(mats), 0.02],
    ["sword", distantSwordInSand(mats, { seed: 8 }), 0.15],
    ["pistols", distantPistols(mats, { seed: 9 }), 0.02],
    ["skullPost", distantSkullPost(mats, { seed: 10 }), 0.02],
    ["coinPile", distantCoinPile(mats, { seed: 11 }), 0.1],
    ["treasureChest", distantTreasureChest(mats, { seed: 12 }), 0.02],
  ];
  for (const [name, g, sink] of subjects) {
    const s = scan(g);
    ok(`${name}: every mesh is named`, s.named === s.meshes, `${s.named}/${s.meshes}`);
    ok(`${name}: does not sink past its allowance`, s.lowest > -sink, "lowest y = " + s.lowest.toFixed(3));
    ok(`${name}: touches the ground rather than floating`, s.lowest < 0.05, "lowest y = " + s.lowest.toFixed(3));
    ok(`${name}: uses only the shared material set`, s.foreign === 0, `${s.foreign} foreign`);
    ok(`${name}: within its triangle budget`, s.tris <= 600, Math.round(s.tris) + " tris");
  }

  // The wreck is a LANDMARK built once, so it gets its own ceiling — and it
  // must stand IN the water: every part of it north of the swash.
  const wreck = ISLAND_SET_PIECES.find((p) => p.name === "wreck")!;
  const ws = scan(distantShipwreck(mats, { seed: 5 }));
  ok("shipwreck: every mesh is named", ws.named === ws.meshes, `${ws.named}/${ws.meshes}`);
  ok("shipwreck: uses only the shared material set", ws.foreign === 0);
  ok("shipwreck: within its landmark budget", ws.tris <= 3000, Math.round(ws.tris) + " tris");
  {
    const site = wreck.build(mats);
    site.position.x += wreck.x;
    site.position.z += wreck.z;
    site.updateMatrixWorld(true);
    const hull = site.getObjectByName("hull") as THREE.Mesh;
    const pos = hull.geometry.attributes.position;
    const v = new THREE.Vector3();
    let dry = 0;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(hull.matrixWorld);
      if (!inSea(v.x, v.z, -SEASIDE_PARAMS.swashReach)) dry++;
    }
    ok("the wreck's hull lies wholly in the sea (Nuno: 'the ship should be on the water')", dry === 0, `${dry} hull vertices on the beach`);
    ok("…and on the NORTH-WEST, as asked", wreck.x < -3 && wreck.z < -16);
  }

  // Every DRY set piece stands outside the keep-clear box, so no procedural
  // gear can land on the verge or the apron Nuno will be placing props on.
  const clearX = (COLS + 2) / 2 + SURROUND_PARAMS.keepClear;
  const clearZ = (ROWS + 2) / 2 + SURROUND_PARAMS.keepClear;
  for (const p of ISLAND_SET_PIECES) {
    const outside = Math.abs(p.x) >= clearX || Math.abs(p.z) >= clearZ;
    ok(`set piece "${p.name}" stands outside the keep-clear box or at sea`, outside || inSea(p.x, p.z));
  }
  const hoard = ISLAND_SET_PIECES.find((p) => p.name === "hoard")!;
  ok("the treasure is SOUTH of the board", hoard.z > clearZ);
  ok(
    "there is ship's gear on BOTH sides",
    ISLAND_SET_PIECES.some((p) => p.x <= -clearX) && ISLAND_SET_PIECES.some((p) => p.x >= clearX),
  );

  // The tarred hull and the iron are MARKINGS: without the declared role the
  // shipped style lifts them to `slate`, a blue-grey (IDEA-065 rule 10).
  ok("the hull is declared ink", mats.hull.userData.madboxRole === "ink");
  ok("the iron is declared ink", mats.iron.userData.madboxRole === "ink");
  // And the three light woods/cloths are three different rungs.
  const entry = (mat: THREE.MeshToonMaterial) => snapToPalette(mat.color.getHex()).id;
  const rungs = [entry(mats.plank), entry(mats.palmBark), entry(mats.canvas), entry(mats.gold)];
  ok("plank, palm bark, sailcloth and gold land on four palette entries", new Set(rungs).size === 4, rungs.join(" / "));

  // The whole island in the real recipe: the sea is built with it, and nothing
  // dry stands in the surf.
  const host = buildSurroundContent("island", mats);
  let wet = 0;
  host.updateMatrixWorld(true);
  for (const c of host.children) {
    if (c.name === "wreck-site" || c.name === "sunken-mast") continue;
    if (inSea(c.position.x, c.position.z, SEASIDE_PARAMS.swashReach)) wet++;
  }
  ok("nothing on the beach stands in the surf", wet === 0, `${wet} in the water`);
  disposeSurroundMaterials(mats);
  const scene = new THREE.Group();
  const built = ensureSurround(scene, "island", ISLAND.palette)!;
  ok("the island builds its sea", !!built.getObjectByName("sea") && !!built.getObjectByName("shore"));
  disposeSurround();
}

restoreParams();
console.log("\n" + "-".repeat(60));
console.log(`SURROUND: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
