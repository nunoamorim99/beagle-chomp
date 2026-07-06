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
Start with 3 lives. Ghost contact (not frightened) costs a life and resets positions.
0 lives → game over. Clear a map → next map, speeds ramp. Maps cycle; the run continues.

## Controls
- Desktop: Arrow keys / WASD.
- Mobile: swipe to steer (optional on-screen d-pad).
