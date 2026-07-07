# Architecture

## Layers
```
src/game/*   pure logic (NO three.js)  ── unit-testable in Node
src/render/* three.js scene + meshes   ── reads logic, never mutates it
src/input/*  keyboard + touch          ── emits queued directions
src/ui/*     DOM HUD + banners         ── owns the .hud + #center overlay (not the canvas)
src/game/game.ts  integration/loop     ── owns GameState, wires it all together
```
`createHud(root): Hud` (src/ui/hud.ts) is the only writer of the HUD/#center DOM.
index.html ships the `.hud` stats (`#score`/`#level`/`#lives`) and an empty
`#center` container; hud.ts injects banners/panels into `#center` at runtime.
`game.ts` drives it purely through the `Hud` methods and never touches those nodes directly.

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
