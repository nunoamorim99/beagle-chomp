# Game Design — Beagle Chomp

## Objective
Eat every biscuit on a map to advance. Avoid ghosts unless a bone is active.

## Entities
- **Beagle** (player): grid-locked, slightly faster than ghosts.
- **Biscuit** (`.`): +10, many per map.
- **Bone** (`o`): +50, power-up → all live ghosts frightened for 7s.
- **Fruit** (`F` tiles): appears at pellet-count thresholds; +100.
- **Ghosts** ×3: chaser, ambusher, clyde (see AI).

## Scoring
| Action | Points |
|--------|--------|
| Biscuit | 10 |
| Bone | 50 |
| Fruit | 100 |
| Eat ghost (during one fright window) | 200 → 400 → 800 → 1600 |

## States & timing (defaults in src/game/config.ts)
- Speeds (tiles/s): beagle 5.2, ghost 4.6, frightened 3.0, eaten 9.0.
- Fright window: 7s. Ready: 1.6s. Death pause: 1.3s.
- Global mode schedule (s): 7 scatter, 20 chase, 7, 20, 5, then chase forever.

## Ghost personalities
- **Chaser** — targets the beagle's tile.
- **Ambusher** — targets 4 tiles ahead of the beagle's facing.
- **Clyde** — chases when >8 tiles away, retreats to its corner when close.

## Lives & flow
Start with 3 lives (`START_LIVES`). A Start panel greets the player; pressing
Start shows a "Ready!" banner (`TIMING.readySeconds`), then play begins.

Ghost contact while **not** frightened/eaten costs a life: the beagle spins
and shrinks in place (`TIMING.deathSeconds`), then either another "Ready!"
(actors reset to their spawns, next fright/schedule state cleared) or, at 0
lives, a Game Over panel with the final score and a "Play again" button that
resets score/lives and restarts from map 1.

Ghost contact **while frightened** eats the ghost instead: it becomes
eyes-only and glides back to the ghost pen at `SPEEDS.eaten`, then respawns
into whatever the current global scatter/chase mode is. Eating multiple
ghosts within one fright window escalates the score 200 → 400 → 800 → 1600
(`SCORE.ghostBase`, doubling per ghost, capped at the 4th).

Clearing every pellet on a map shows "Map Cleared!", then advances to the
next map. Maps cycle (index `% MAZE_COUNT`); once a run loops past the last
map the Map HUD label gets a lap suffix (e.g. "1 ·2").

Fruit appears once 70 and once 140 pellets have been eaten on the current
map, placed on a random `F` tile; walking onto it scores `SCORE.fruit`.

## Controls
- Desktop: Arrow keys / WASD.
- Mobile: swipe to steer (optional on-screen d-pad).
