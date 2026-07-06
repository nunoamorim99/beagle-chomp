# Project Plan — Beagle Chomp

## Vision
A charming, fast, installable maze-chase game. A beagle collects dog biscuits while
dodging ghosts; bones are the power-up that flips the hunt. Plays great on desktop and
phone, installs as a PWA, works offline.

## Scope (v1)
- Two validated mazes with level progression (speed ramps as you clear maps).
- Beagle with grid-locked movement; keyboard + touch.
- Three ghosts with distinct AI (chaser / ambusher / clyde), scatter/chase/frightened/eaten.
- Bone power-up, edible ghosts with escalating score, fruit bonus.
- Lives, score, HUD, ready/clear/game-over flow.
- Responsive layout, PWA install, offline play.

## Non-goals (v1)
- Online multiplayer, accounts, leaderboards backend.
- Hand-authored 3D models (start with primitives; glTF is a stretch goal).
- Sound is a stretch goal, not a blocker.

## Milestones & ownership
| # | Milestone | Owner(s) | Done when |
|---|-----------|----------|-----------|
| M0 | Scaffold + validated logic + tests | (done) | `npm run test` passes; `npm run dev` boots |
| M1 | Render the board | render-artist | Maze, floor, biscuits/bones render; camera frames it |
| M2 | Beagle movement + keyboard | gameplay-engineer | Beagle steers, turns at centres, eats biscuits |
| M3 | Ghosts + AI on screen | gameplay + render | 3 ghosts chase; scatter/chase cycle visible |
| M4 | Mechanics | gameplay-engineer | Bones→frightened, eat ghosts, fruit, lives, level flow |
| M5 | Responsive + PWA + touch | pwa-mobile-engineer | Installs on phone, swipe controls, offline, fits portrait |
| M6 | Polish | render-artist | Better beagle/ghost models or glTF, animation, juice |
| M7 | Audio + ship | any | Optional SFX; production build + deploy |

## Definition of done (every milestone)
- `npm run typecheck` clean, `npm run test` green.
- No regressions in the logic tests.
- Touched behaviour reflected in docs/GAME_DESIGN.md.

## Suggested first commands in Claude Code
1. "Use render-artist to implement M1: port the board + scene from /prototype into
   src/render, wire a minimal main loop so `npm run dev` shows the maze."
2. "Use gameplay-engineer to implement M2 using the proven movement module."
3. Continue milestone by milestone; run `npm run test` between logic changes.
