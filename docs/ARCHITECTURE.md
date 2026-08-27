# Architecture

## Layers
```
src/game/*   pure logic (NO three.js)  ── unit-testable in Node
src/render/* three.js scene + meshes   ── reads logic, never mutates it
src/input/*  keyboard + touch          ── emits queued directions
src/ui/*     DOM HUD + banners         ── owns the .hud + #center overlay (not the canvas)
src/game/game.ts  integration/loop     ── owns GameState, wires it all together
src/editor/* dev-only character editor ── reads render + game, NOTHING imports from it
```
`createHud(root): Hud` (src/ui/hud.ts) is the only writer of the HUD/#center DOM.
index.html ships the `.hud` stats (`#score`/`#level`/`#lives`) and an empty
`#center` container; hud.ts injects banners/panels into `#center` at runtime.
`game.ts` drives it purely through the `Hud` methods and never touches those nodes directly.

## Character editor (dev-only, IDEA-025)
`editor/index.html` + `src/editor/*` is a workbench page served by `npm run dev`
at `/editor/` (`npm run editor` opens it directly): pick a character, tweak its
real meshes live (lil-gui), add primitive parts, and copy the generated three.js
code into `src/render/characters.ts` — side by side with the builder's real
source (Vite `?raw`). It is dev-only **by construction**: the page is not a
rollup input, so `vite build` never bundles it — no editor code or lil-gui ever
reaches `dist/` or the PWA precache (see the note in vite.config.ts; never add
it to `rollupOptions.input`). `src/editor/*` may import three (like
`src/render/*`), imports read-only from render/game, and registers no service
worker; no game module may import from `src/editor/*`.

## Cel shading (IDEA-024 v2)
Every lit surface in the game is a `MeshToonMaterial` sharing ONE gradient
texture from `src/render/toon.ts`. One texture matters twice over: it is a
single GPU upload, and three.js keys shader programs partly on the gradient map,
so the whole scene stays on one program variant instead of one per material.

Two things the ramp depends on, both easy to undo by accident:
- `NearestFilter` + no mipmaps on the gradient. Without them the GPU
  interpolates the three texels and you get back the smooth falloff the toon
  material was chosen to escape.
- `renderer.toneMapping = NoToneMapping` (scene.ts, and the editor's stage
  matches it). ACESFilmic's shoulder re-compresses the top bands into a
  gradient — the banding of cel shading with none of the crispness.

Materials are built through `toon({...})` rather than `new MeshToonMaterial`, so
every surface picks up the shared ramp automatically. `roughness`/`metalness` do
not exist on a toon material; the editor asks (`roughnessOf`, `hasEmissive`)
before offering a control for a channel a given model may not have.

## Board surfaces (IDEA-043, IDEA-044)
Every theme's walls and floor wear a **procedurally drawn** surface — canvas at
runtime, never an image file, because this is a PWA that precaches everything
onto a phone. Two modules, and the difference between them is the point.

`wallTexture.ts` is **tile-local and cached**. Walls are one `InstancedMesh` of
unit boxes, so every tile shows the full 0..1 of the texture: the pattern must
tile seamlessly (each shape is drawn at nine wrapped offsets) and one 128px
canvas serves the whole maze for the session.

`floorTexture.ts` is **grid-derived and uncached**. The floor is a single
`PlaneGeometry(COLS+2, ROWS+2)` with plain 0..1 UVs, so tile `(tx,ty)` lands at
canvas `((tx+1.5)*S, (ty+1.5)*S)` — the `+1.5` being the one-tile apron plus a
half-tile to the centre — and the maze can be *painted into the texture*. That
is what lets the garden's stepping stones, the park's gravel walk and the road's
lane markings follow the corridors instead of repeating per tile. Every pattern
is expressed in terms of `K = S/16` — feature sizes scale with K, scatter counts
with K² — so `S` can be raised for crisper shapes without restyling any surface;
it went 16 → 32 when the garden's stones became ellipses and needed the fidelity.

Because it depends on the grid **and** the palette, it is rebuilt on every
theme/level change and the outgoing texture disposed in `syncBoardMaterials`; a
cache keyed by kind alone would paint level 1's corridors into level 2's floor.

The floor also breaks two of the wall module's rules, both for the same reason —
**a `map` multiplies, so it can only darken**:
- The wall textures are luminance-only near white, leaving `palette.wall` in
  charge of hue. The floor textures **carry real colour**, because multiply
  caps a marking at the material's own brightness: Night City's floor is
  `0x3a3640`, so a `grey(1)` lane stripe rendered at 0.22 luminance and was
  invisible. Instead each floor texture bakes `palette.floor` in as its ground,
  and `board.ts` sets `matFloor.color` to **white** so the tint is not applied
  twice. The same freedom is what makes the park's lawn green over a tan palette.
- The texture is assigned to **`emissiveMap` as well as `map`**. Floor palettes
  carry a flat emissive lift added *after* the multiply, which washed the pattern
  out on the dark themes; driving the emissive with the same texture makes the
  dark parts of the pattern dim the lift too.

Both kinds are editable from the board editor (Walls ▸ *surface*, Floor ▸
*ground*) and — the part with no compiler behind it — must be emitted by
`boardCodegen.ts`, which writes palette fields explicitly. A field the writer
does not know about is silently dropped from every saved theme;
`scripts/test-board-surfaces.ts` fails if any `ThemePalette` key is missing from it.

## Editor tabs and the two "mesh" modes
`/editor/` has four tabs. **Character** and **Pickups** are the same code path:
one registry of builder defs, each carrying `builderName` + `sourceFile`, driven
through the shared part tree / inspector / codegen / source view / save. Board
and Props are different — they generate whole files from their own data models
rather than rewriting statements in place.

Adding a mesh tab is therefore: a registry list, a mode string, a button. The
three things that must move together, or the tab half-works:
- `SavableFile` (saveFile.ts) **and** `EDITOR_SAVABLE_FILES` (vite.config.ts) —
  the dev save endpoint 403s anything not in both.
- `EDITOR_SOURCES` (sources.ts) — the `?raw` text the source panel shows and
  the save path rewrites. Keyed by `SavableFile` so a file the editor can read
  is necessarily one it can write.
- The mesh-mode gates in main.ts (`meshMode`, the keyboard handler's early
  return, the picking/highlight accessors). Both bugs the Pickups tab shipped
  with in its first run were a missed gate: the props library rendered into the
  part tree, and arrow-key nudges did nothing so Save said "No edits yet".

A builder must be `export`ed and its parts `.name`d — `findFunctionRange` looks
for `export function <name>(`, and the tree/save address parts by name.

## Coordinate system
Grid tile `(tx, ty)` maps to world:
```
worldX = (tx - OX) * TILE      OX = (COLS-1)/2
worldZ = (ty - OZ) * TILE      OZ = (ROWS-1)/2
```
Directions: `up = -Z`, `down = +Z`, `left = -X`, `right = +X`.
Model facing: `yaw = atan2(dir.x, dir.y)` (models built nose-toward +Z).

## Entity + movement model (tile-stepping)
An entity has `{tx,ty, dir, queued, progress, speed, facing}`. `stepEntity` advances
`progress` along `dir`; when it crosses a tile centre it snaps to the new tile, fires
`onArrive`, wraps tunnels, and only then may change direction (to `queued` if walkable,
else keep going, else stop). Renderers call `entityWorld(e)` to get the interpolated
position. This is why turns feel grid-locked but smooth. **Validated in sim-logic.ts.**

## Ghost AI
At each tile a ghost picks, among walkable non-reversing neighbours, the one nearest its
target tile. Targets by state: eaten→pen, scatter→corner, chase→per personality
(chaser=beagle, ambusher=beagle+4·facing, clyde=beagle if far else corner). Frightened =
random. If the only move is a reversal (dead-end), it is allowed — so ghosts never stick.

## Game loop / state machine
```
ready ──timer──▶ play ──all pellets eaten──▶ levelclear ──▶ (next map) ready
                  │
                  └─ ghost hit (not frightened) ──▶ dying ──▶ ready | over
```
Per frame: update(dt) → sync meshes to entities → renderer.render. Global scatter/chase
timer drives non-frightened ghosts; a bone starts a fright window with escalating ghost
scores. See prototype sections 7–11 for the concrete reference.

## Render sync
`src/render` owns meshes keyed to entities and pellet tiles. On eat, remove the pellet
mesh for that tile. Ghost meshes recolour by state via `userData` handles. Keep all walls
in one `InstancedMesh`.
