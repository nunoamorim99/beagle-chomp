# Game Design — Beagle Chomp

## Objective
Eat every biscuit on a map to advance. Avoid ghosts unless a bone is active.

## Entities
- **Beagle** (player): grid-locked, slightly faster than ghosts.
- **Biscuit** (`.`): +10, many per map.
- **Bone** (`o`): +50, power-up → all live ghosts frightened for 7s.
- **Fruit** (`F` tiles): appears at pellet-count thresholds; +100.
- **Coin** (spawns on a random walkable/reachable tile, preferring bare
  cleared floor, IDEA-017): appears 4 times per map at pellet-count
  thresholds; grants 1 coin directly (no points) to the persistent wallet;
  auto-despawns if not grabbed in time.
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

## Coins (IDEA-016 / IDEA-017)
Coins are a **persistent wallet** (`localStorage`, separate from the per-run
score/lives), meant to fund a future shop. Two ways to earn them:

- **From points (IDEA-016):** every `COINS.perPoints` (1000) points of
  cumulative run score banks 1 coin, immediately, to the persisted wallet —
  it survives even if the beagle dies right after. A single scoring event
  that crosses several thresholds at once (e.g. a big ghost-eat chain) banks
  all of them together. The score->coins counter resets to 0 at the start of
  each new game/"Play again", but the banked wallet itself never resets.
- **Maze coin pickup (IDEA-017):** a coin appears 4 times per map, at pellet-
  eaten thresholds `COIN_THRESHOLDS` = 20 / 60 / 105 / 150 — starting early
  (so a coin turns up soon after the level begins, not a third of the way
  through) and spread across a ~179-pellet map, offset from the fruit's
  70/140 thresholds so a coin and fruit essentially never spawn on the same
  tick. Placement PREFERS bare/cleared floor: it's drawn from every
  beagle-walkable tile in the level (`grid.walkable(x, y, false)`,
  precomputed once per level as `LevelAssets.walkableTiles` — not just the
  designated `F` fruit spots) that does **not** currently hold a pellet, so
  the coin stands out against already-eaten corridors instead of hiding
  among the biscuits, and grabbing it means a real detour rather than
  "walk the path you were on anyway." Falls back to any walkable tile if
  nothing's been cleared yet (very early in a level) so a coin still always
  appears. Either pool avoids the beagle's current tile and the active fruit
  tile where another candidate exists. Walking onto it grants
  `COINS.pickupValue` (1) coin directly with **no points**. Unlike the fruit,
  the coin is **time-limited**: it auto-despawns after `COINS.lifespanSeconds`
  (18s) if not grabbed, banking nothing — a distinct, urgent "grab it quick"
  bonus; 18s (rather than a shorter window) gives the player time to actually
  reach a coin that spawns across the map before it expires. At ~40-45
  pellets between thresholds, a coin's lifespan always expires (or gets
  grabbed) well before the next threshold fires, so spawns never collide with
  each other. The countdown only runs during actual play (not
  ready/dying/levelclear/start) and resets cleanly whenever the coin is
  picked up, expires, or the level/run resets.

Coins are shown in the HUD (`#coins`) alongside score/lives, initialized from
the persisted wallet at boot.

## Controls
- Desktop: Arrow keys / WASD.
- Mobile: swipe to steer (optional on-screen d-pad).
