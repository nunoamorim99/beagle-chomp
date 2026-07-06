# CLAUDE.md — Beagle Chomp

A responsive, installable (PWA) maze-chase game built with **three.js + TypeScript + Vite**.
Guide a beagle around a maze, eat every biscuit to clear the map, chomp a bone to turn
the ghosts scared and edible. This file is the source of truth for how we build it.

## Commands
- `npm run dev` — start the dev server (Vite)
- `npm run build` — typecheck + production build
- `npm run test` — **run the headless logic tests** (maze validation + gameplay sim)
- `npm run validate` / `npm run sim` — the two tests individually

**Rule: after any change to `src/game/{grid,movement,ghostAI}.ts` or the maze data,
run `npm run test` and make it pass before you consider the task done.** These tests are
the safety net for the trickiest logic and run without a browser.

## Tech & conventions
- TypeScript **strict**. No `any` without a written reason.
- Keep **pure game logic** (`src/game/*`) free of any `three` import, so it stays
  unit-testable in Node. Only `src/render/*` and `src/main.ts` may import three.
- One responsibility per module. Compose the proven modules; don't reinvent them.
- No `localStorage`/`sessionStorage` assumptions for core state — keep state in memory.
- Balance numbers live in `src/game/config.ts`. Don't scatter magic numbers.

## What is already DONE and validated (do not rewrite lightly)
- `src/game/mazes.json` + `mazes.ts` — two mazes, **validated** (connected, all
  pellets reachable, ghosts can leave the pen).
- `src/game/grid.ts` — tiles, tunnel wrap, walkability.
- `src/game/movement.ts` — the tile-stepping movement model.
- `src/game/ghostAI.ts` — targeting AI with a dead-end-safe fallback.
- `scripts/validate-maze.ts`, `scripts/sim-logic.ts` — the tests, importing the real modules.
- `prototype/beagle-chomp.html` — a **fully working single-file version**. It is the
  reference implementation for everything still to build (render, loop, HUD).

## What is TODO (stubs that throw today)
`src/render/*`, `src/input/touch.ts`, `src/ui/hud.ts`, `src/game/{state,game}.ts`,
`public/icons/*`. Each stub names its owning agent and points at the reference.

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
