# CLAUDE.md — Beagle Chomp

A responsive, installable (PWA) maze-chase game built with **three.js + TypeScript + Vite**.
Guide a beagle around a maze, eat every biscuit to clear the map, chomp a bone to turn
the ghosts scared and edible. This file is the source of truth for how we build it.

## Commands
- `npm run dev` — start the dev server (Vite)
- `npm run editor` — dev server + open the **character editor** (`/editor/`, dev-only page)
- `npm run build` — typecheck + production build
- `npm run test` — **run the headless logic tests** (maze validation + gameplay sim)
- `npm run validate` / `npm run sim` — the two tests individually

**Rule: after any change to `src/game/{grid,movement,ghostAI}.ts` or the maze data,
run `npm run test` and make it pass before you consider the task done.** These tests are
the safety net for the trickiest logic and run without a browser.

## Tech & conventions
- TypeScript **strict**. No `any` without a written reason.
- Keep **pure game logic** (`src/game/*`) free of any `three` import, so it stays
  unit-testable in Node. Only `src/render/*`, `src/editor/*` (the dev-only character
  editor — never in the production build) and `src/main.ts` may import three.
- One responsibility per module. Compose the proven modules; don't reinvent them.
- No `localStorage`/`sessionStorage` assumptions for core state — keep state in memory.
- Balance numbers live in `src/game/config.ts`. Don't scatter magic numbers.

## What is BUILT (do not rewrite lightly)
The full game is built, shipped, and deployed (playable since v1.0; now on v1.2).
- **Pure logic** (`src/game/*`): `mazes.json`+`mazes.ts` (two **validated** mazes —
  connected, all pellets reachable, ghosts can leave the pen), `grid.ts` (tiles, tunnel
  wrap, walkability), `movement.ts` (tile-stepping model), `ghostAI.ts` (targeting with a
  dead-end-safe fallback), `state.ts` + `game.ts` (loop + state machine, the integration point).
- **Render layer** (`src/render/*`): `scene.ts`, `board.ts`, `characters.ts`, `effects.ts`.
- **Input / UI / PWA**: `src/input/{touch,keyboard}.ts`, `src/ui/{hud,sound,install}.ts`,
  `public/icons/*` (192, 512, 512-maskable).
- **Tests**: `scripts/validate-maze.ts`, `scripts/sim-logic.ts` — import the real modules.
- **Character editor** (`editor/index.html` + `src/editor/*`): dev-only workbench at
  `/editor/` — tweak the real character meshes live, add parts, copy the generated
  three.js code into `characters.ts`. Not a rollup input, so it never ships (see
  vite.config.ts note + docs/ARCHITECTURE.md).
- `prototype/beagle-chomp.html` — a fully working single-file version. Now a **historical
  reference artifact** (render/loop/HUD are shipped), not a to-build spec.

## What is next
No stubs remain. Current and future work is tracked in the **Idea-Ledger**
(`Idea-Ledger/Backlog.md` + `VersionControl.md`) — the source of truth for what we build
and ship next.

## Architecture (see docs/ARCHITECTURE.md for detail)
- **Coordinate system:** grid tile `(tx,ty)` → world `((tx-OX)*TILE, y, (ty-OZ)*TILE)`.
  `up = -Z`, `down = +Z`, `left = -X`, `right = +X`.
- **Entity model:** everything moves on the tile grid via `stepEntity`; renderers read
  `entityWorld(e)` each frame and never mutate logic.
- **Game loop:** fixed-ish update → sync meshes → render. State machine:
  `ready → play → (dying | levelclear) → …`.

## The team of agents (see .claude/agents/)
- **game-architect** — module boundaries, integration reviews, keeps docs current.
- **gameplay-engineer** — movement, AI, state machine, scoring, collisions, input.
- **render-artist** — three.js scene, meshes, materials, lighting, camera, animation.
- **pwa-mobile-engineer** — PWA/offline/install, responsive canvas, touch controls.
- **qa-test-engineer** — headless tests, regression sims, playtest checklists.
- **level-designer** — authoring + validating new mazes.

Delegate the matching slice to the matching agent. Keep pure logic and render layers
decoupled so agents can work in parallel.
