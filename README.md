# 🐶 Beagle Chomp

A responsive, installable **PWA** maze-chase game built with **three.js + TypeScript + Vite**.
Guide a beagle around a maze, munch every dog biscuit to clear the map, and chomp a bone to
turn the ghosts scared and edible.

> This repo ships with the **hard logic already built and validated** (mazes, movement,
> ghost AI) plus a full working single-file **prototype** as the reference. The remaining
> work (rendering, loop, UI, PWA, touch) is scaffolded as typed stubs, ready to build with
> the included Claude Code agents.

https://nunoamorim99.github.io/beagle-chomp/

## Quick start
```bash
npm install
npm run dev        # play the dev build
npm run test       # headless logic tests (no browser needed)
npm run build      # typecheck + production build
npm run preview    # serve the build (test PWA/offline here)
```
Requires Node 18+.

## Play it right now
The finished single-file prototype needs no build — just open
`prototype/beagle-chomp.html` in a browser. Arrow keys / WASD to move.

## Project structure
```
src/game/     pure logic — NO three.js (unit-testable)   [DONE + tested]
  grid.ts, movement.ts, ghostAI.ts, mazes.json, config.ts, state.ts, game.ts
src/render/   three.js scene, board, characters           [stubs → render-artist]
src/input/    keyboard (done), touch (stub)               [pwa-mobile-engineer]
src/ui/       HUD + banners                               [stub]
scripts/      headless tests (validate + sim)             [DONE]
prototype/    the full working reference implementation
docs/         PROJECT_PLAN, ARCHITECTURE, GAME_DESIGN, PROTOTYPE_NOTES
.claude/agents/  the six specialist agents
CLAUDE.md     the project guide Claude Code reads first
```

## Building it with Claude Code
Open this folder in Claude Code. The agents in `.claude/agents/` auto-route by task, or
call them by name. A sensible order (see `docs/PROJECT_PLAN.md`):

1. `Use render-artist to implement M1 — port the board and scene from the prototype into
   src/render and add a minimal loop so npm run dev shows the maze.`
2. `Use gameplay-engineer to implement M2 — beagle movement + keyboard, using the proven
   movement module.`
3. `Use gameplay-engineer and render-artist for M3 — ghosts on screen with AI.`
4. `Use gameplay-engineer for M4 — bones, edible ghosts, fruit, lives, level flow.`
5. `Use pwa-mobile-engineer for M5 — PWA install, offline, responsive, swipe controls.`

**Always run `npm run test` after logic changes** — the two headless tests are the safety
net for the trickiest movement/AI code.

## Installing as an app (PWA)
After `npm run build && npm run preview` (or deploying `dist/`), the browser will offer
"Install". On iOS Safari use Share → Add to Home Screen. Add the three icons under
`public/icons/` (see the README there) to make it fully installable.

## Tech
three.js · TypeScript (strict) · Vite · vite-plugin-pwa · tsx (for headless tests)
