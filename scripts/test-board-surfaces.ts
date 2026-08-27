// Guards the themed wall + floor SURFACES, and the one failure mode that has
// no other safety net.
//
// The board editor's theme writer (src/editor/boardCodegen.ts) emits a palette
// field by field, by hand. Nothing makes it emit a field it does not know
// about: add a key to ThemePalette, forget the writer, and every theme saved
// from the editor silently loses that key — the file still compiles, the game
// still runs, and the setting just quietly reverts. That is exactly how a
// wallTexture or floorTexture would go missing, so this asserts the writer
// covers EVERY declared key.
//
// Headless and dependency-free: it reads the two sources as text and checks
// the palette data, so it runs in the plain `npm run test` chain rather than
// needing a browser like the lil-gui suites do.
import { readFileSync } from "node:fs";
import { MAZE_THEMES } from "../src/game/themes";

let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    pass++;
    console.log("  ok   " + name);
  } else {
    fail++;
    console.log("  FAIL " + name + (detail ? "\n    " + detail : ""));
  }
}

function section(title: string): void {
  console.log("\n" + title);
}

const themesSrc = readFileSync("src/game/themes.ts", "utf8");
const codegenSrc = readFileSync("src/editor/boardCodegen.ts", "utf8");

// ---------------------------------------------------------------------------
section("Every ThemePalette field survives a save");

const ifaceMatch = /export interface ThemePalette \{([\s\S]*?)\n\}/.exec(themesSrc);
ok("ThemePalette is declared in themes.ts", ifaceMatch !== null);

if (ifaceMatch) {
  // Property lines only: skip comments, blank lines and nested closers.
  const keys = ifaceMatch[1]
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("//") && !l.startsWith("*") && !l.startsWith("/*"))
    .map((l) => /^([A-Za-z_][A-Za-z0-9_]*)\??\s*:/.exec(l)?.[1])
    .filter((k): k is string => Boolean(k));

  ok("found the palette's fields", keys.length > 10, "got " + keys.length);
  for (const k of keys) {
    ok(
      "boardCodegen writes " + k,
      new RegExp("\\b" + k + ":").test(codegenSrc),
      "add `" + k + "` to the palette writer, or saved themes will drop it",
    );
  }
}

// ---------------------------------------------------------------------------
section("Every theme names a real surface");

// Kept in step with the two unions by reading them out of the render modules —
// a kind renamed there and not here should fail loudly, not silently pass.
const kindsOf = (file: string, name: string): string[] => {
  const src = readFileSync(file, "utf8");
  const m = new RegExp("export type " + name + " =([^;]+);").exec(src);
  return m ? [...m[1].matchAll(/"([a-zA-Z]+)"/g)].map((x) => x[1]) : [];
};
const wallKinds = kindsOf("src/render/wallTexture.ts", "WallTextureKind");
const floorKinds = kindsOf("src/render/floorTexture.ts", "FloorTextureKind");

ok("WallTextureKind parsed", wallKinds.length >= 2, wallKinds.join(","));
ok("FloorTextureKind parsed", floorKinds.length >= 2, floorKinds.join(","));

for (const t of MAZE_THEMES) {
  ok(
    t.name + ": wall surface is a known kind",
    wallKinds.includes(t.palette.wallTexture),
    t.palette.wallTexture + " not in " + wallKinds.join("|"),
  );
  ok(
    t.name + ": ground is a known kind",
    floorKinds.includes(t.palette.floorTexture),
    t.palette.floorTexture + " not in " + floorKinds.join("|"),
  );
}

// The editor's two dropdowns are hand-written lists. If they drift from the
// unions a kind becomes unreachable in the workbench even though the game can
// render it.
section("The editor can reach every surface");
const inspectorSrc = readFileSync("src/editor/boardInspector.ts", "utf8");
for (const k of wallKinds) {
  ok('wall surface "' + k + '" is offered in the inspector', inspectorSrc.includes('"' + k + '"'));
}
for (const k of floorKinds) {
  ok('ground "' + k + '" is offered in the inspector', inspectorSrc.includes('"' + k + '"'));
}

// ---------------------------------------------------------------------------
section("The ground textures stay grid-derived");

const floorSrc = readFileSync("src/render/floorTexture.ts", "utf8");
const boardSrc = readFileSync("src/render/board.ts", "utf8");

ok(
  "floorTextureFor takes the grid and the palette colour",
  /export function floorTextureFor\([\s\S]*?grid: Grid,[\s\S]*?baseHex: number,/.test(floorSrc),
);
ok(
  "the ground texture is NOT cached by kind",
  !/const cache = new Map<FloorTextureKind/.test(floorSrc),
  "a cache keyed by kind alone paints level 1's corridors into level 2's floor",
);
ok(
  "board.ts disposes the outgoing ground texture",
  /matFloor\.map\?\.dispose\(\)/.test(boardSrc),
  "one leaked canvas texture per level adds up across a run",
);
ok(
  "a textured floor is left white so the palette is not applied twice",
  /matFloor\.color\.set\(nextFloor \? 0xffffff : palette\.floor\)/.test(boardSrc),
  "the colour is baked into the canvas; tinting again squares it towards black",
);

// The WALL surfaces carry colour on the same terms as of the cartoon pass —
// they have to, since a multiply can never paint a leaf lighter than the wall
// it sits on. Same white-material contract, and one extra clause of its own:
// the cache key must include the colour, or every theme after the first gets
// the first one's wall painted into it.
const wallSrc = readFileSync("src/render/wallTexture.ts", "utf8");

ok(
  "wallTextureFor takes the palette colour it bakes in",
  /export function wallTextureFor\(kind: WallTextureKind, baseHex: number\)/.test(wallSrc),
);
ok(
  "the wall surface is cached by kind AND colour",
  /const key = kind \+ "\|" \+ baseHex/.test(wallSrc),
  "keyed by kind alone, the first theme's wall colour is baked into every other theme",
);
ok(
  "a textured wall is left white so the palette is not applied twice",
  /matWall\.color\.set\(wallMap \? 0xffffff : palette\.wall\)/.test(boardSrc),
);
ok(
  "the board editor binds wall colour to the PALETTE, not to the material",
  /addColor\(\{ color: "#" \+ p\.wall\.toString\(16\)/.test(
    readFileSync("src/editor/boardInspector.ts", "utf8"),
  ),
  "a textured wall material is held at white, so a swatch bound to it double-tints",
);

// ---------------------------------------------------------------------------
section("The showcases wear the same surfaces as the board");

const menuSrc = readFileSync("src/render/menuScene.ts", "utf8");
const shopSrc = readFileSync("src/render/shopScene.ts", "utf8");
const showcaseSrc = readFileSync("src/render/showcaseSurface.ts", "utf8");

for (const [name, src] of [
  ["the menu vignette", menuSrc],
  ["the shop's character stage", shopSrc],
] as const) {
  ok(
    name + " applies the theme's procedural surfaces",
    /applyShowcaseSurfaces\(/.test(src),
    "without it a showcase re-themes by colour alone and shows less of a theme than the maze does",
  );
}
ok(
  "the shop diorama wears the board's own wall texture",
  /wallTextureFor\(palette\.wallTexture, palette\.wall\)/.test(shopSrc),
);
ok(
  "the shop diorama draws its own ground",
  /floorPreviewTexture\(palette\.floorTexture, DIORAMA_FLOOR_CELLS, palette\.floor\)/.test(shopSrc),
);
ok(
  "a textured showcase floor is left white so the palette is not applied twice",
  /m\.color\.setHex\(next \? 0xffffff : palette\.floor\)/.test(showcaseSrc),
);
ok(
  "and so is a textured showcase wall",
  /m\.color\.setHex\(wallMap \? 0xffffff : palette\.wall\)/.test(showcaseSrc),
);
ok(
  "the shop diorama holds its textured wall white too",
  /color: wallTex \? 0xffffff : palette\.wall/.test(shopSrc),
);
ok(
  "the diorama disposes the ground it owns",
  /userData\.floorTexture as THREE\.Texture \| undefined\)\?\.dispose\(\)/.test(shopSrc),
  "browsing the Themes tab would otherwise leak one canvas texture per tap",
);

// The diorama paints its ground from a hand-written tile patch, and the maze
// corner it stages is a SECOND hand-written list. Nothing links them: move a
// wall block and the stepping stones / lane markings keep following the old
// corridors — a preview that quietly lies about the theme it is selling. So
// the two are checked against each other here.
const wallBlock = shopSrc.slice(shopSrc.indexOf("const DIORAMA_WALL_TILES"));
const wallTiles = [
  ...wallBlock.slice(0, wallBlock.indexOf("];")).matchAll(/\[\s*(-?\d+)\s*,\s*(-?\d+)\s*\]/g),
].map((m) => [Number(m[1]), Number(m[2])] as [number, number]);
const cellsBlock = shopSrc.slice(shopSrc.indexOf("const DIORAMA_FLOOR_CELLS"));
const cells = [...cellsBlock.slice(0, cellsBlock.indexOf("];")).matchAll(/"([.#]+)"/g)].map(
  (m) => m[1],
);

ok("the diorama's wall run and ground patch were both found", cells.length > 0 && wallTiles.length > 0);
// Cell (c, r) is diorama tile (c - 1, r - 1) — see DIORAMA_FLOOR_CELLS.
const walledCells = new Set<string>();
cells.forEach((row, r) => {
  [...row].forEach((ch, c) => {
    if (ch === "#") walledCells.add(c - 1 + "," + (r - 1));
  });
});
ok(
  "every diorama wall block stands on a wall tile of the ground patch",
  wallTiles.every(([tx, tz]) => walledCells.has(tx + "," + tz)),
  "wall run " + JSON.stringify(wallTiles) + " vs patch " + JSON.stringify([...walledCells]),
);
ok(
  "and the patch invents no wall the diorama does not build",
  walledCells.size === wallTiles.length,
  "a wall tile with no block on it paints a bald patch of ground in plain view",
);

// ---------------------------------------------------------------------------
console.log("\n" + "-".repeat(60));
console.log("BOARD SURFACES: " + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);
