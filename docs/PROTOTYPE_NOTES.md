# Prototype notes

`prototype/beagle-chomp.html` is a complete, working single-file version of the game
(three.js via CDN). It exists as the **reference implementation** — lift proven code from
it rather than guessing.

## What the prototype already proves
- The two mazes are playable and fair (validated headlessly first).
- The tile-stepping movement feels right and never sticks.
- The three-ghost AI produces distinct, readable behaviour.
- Bone→frightened→eat-ghost, fruit, lives, and map progression all work.

## Map from prototype sections → target modules
| Prototype section | Target module |
|-------------------|---------------|
| 2 Three boilerplate | `src/render/scene.ts` |
| 3 Board building | `src/render/board.ts` |
| 6 Character models | `src/render/characters.ts` |
| 4 Grid helpers | `src/game/grid.ts` (done) |
| 5 Movement | `src/game/movement.ts` (done) |
| 7 Ghost AI | `src/game/ghostAI.ts` (done) |
| 8–11 Gameplay/HUD/loop | `src/game/game.ts` + `src/ui/hud.ts` |

## Known caveat to improve
The beagle turns exactly at tile centres (no early "cornering"). If it feels stiff,
add a small pre-turn window — this is the first feel-tuning task (gameplay-engineer).
