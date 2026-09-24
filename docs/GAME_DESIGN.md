# Game Design — Beagle Chomp

> The source of truth for balance numbers is [`src/game/config.ts`](../src/game/config.ts),
> which carries the reasoning beside every value. This file is the shape of the
> design; that file is the arithmetic.

## Objective
Eat every biscuit on a map to advance. Avoid the enemies unless a bone is active.

## Entities
- **Beagle** (player): grid-locked, slightly faster than the enemies. Its coat is
  chosen in the shop and carries a **perk** (see below).
- **Biscuit** (`.`): +10, many per map.
- **Bone** (`o`): +50, and frightens every live enemy for 7s.
- **Fruit** (`F` tiles): four a map on a weighted ladder — apple 100, banana 200,
  carrot 300, strawberry 400, mango 500. The kind is rolled **at spawn and
  remembered**, never re-rolled when eaten, or the mango you crossed the maze for
  could pay out as an apple. Times out after 20s.
- **Coin**: five a map, on bare cleared floor by preference. Grants 1 coin with no
  points. Times out after 18s.
- **Golden bone**: once a map. Grants an extra life, capped at `LIVES.max`.
- **Power-up**: four a map, classic mode only. Times out after 18s.
- **Enemies**: three to five depending on the stage — chaser, ambusher and clyde
  personalities (see AI). Eleven skins are available in the shop; the skin is
  cosmetic and the behaviour is not.

## Scoring
| Action | Points |
|--------|--------|
| Biscuit | 10 |
| Bone | 50 |
| Fruit | 100 – 500 by kind |
| Eat an enemy (during one fright window) | 200 → 400 → 800 → 1600 |

## States & timing (defaults in src/game/config.ts)
- Speeds (tiles/s): beagle 5.2, enemy 4.6, frightened 3.0, eaten 9.0. The Journey's
  twist levels scale these per level, from 0.7x up to 2.2x.
- Fright window: 7s. Ready: 1.6s. Death pause: 1.3s.
- Global mode schedule (s): 7 scatter, 20 chase, 7, 20, 5, then chase forever.

## Enemy personalities

*(The code still says "ghost" throughout — `ghostAI.ts`, `ghostEatChain`, the
`ghosts` array. Only the player-facing wording changed, because ten of the eleven
shop skins are not ghosts. Renaming the internals would be churn for no benefit.)*

- **Chaser** — targets the beagle's tile.
- **Ambusher** — targets 4 tiles ahead of the beagle's facing.
- **Clyde** — chases when >8 tiles away, retreats to its corner when close.

## Lives & flow
Start with 3 lives (`START_LIVES`). A Start panel greets the player; pressing
Start shows a "Ready!" banner (`TIMING.readySeconds`), then play begins.

Contact with an enemy that is **not** frightened or eaten costs a life: the beagle spins
and shrinks in place (`TIMING.deathSeconds`), then either another "Ready!"
(actors reset to their spawns, next fright/schedule state cleared) or, at 0
lives, a Game Over panel with the final score and a "Play again" button that
resets score/lives and restarts from map 1.

Contact **while frightened** eats the enemy instead: it becomes eyes-only and
glides back to the pen at `SPEEDS.eaten`, then respawns into whatever the current
global scatter/chase mode is. Eating several within one fright window escalates the
score 200 → 400 → 800 → 1600 (`SCORE.ghostBase`, doubling each time, capped at the
4th).

Clearing every pellet on a map shows "Map Cleared!", then advances. See
**Progression** below: the cycle is 30 maps in six stages, and the map number is a
running count that never resets — lap 2's first map is Map 31.

Fruit appears at each of `FRUIT_THRESHOLDS` (40/80/120/160) pellets eaten on the
current map — four per map — on a fixed `F` tile. It is the most generous of the
three timed pickups at 20s, because it lands on the maze's fixed spots rather than
near the beagle: crossing the maze for a mango is a gamble rather than an errand
you run on the way past. An expired fruit **does not burn its threshold**, so a map
still gets four.

The five fruit meshes commit to five different **silhouettes** on purpose. Three of
them are round and warm, and at the game camera a fruit is a handful of pixels — the
first pass had a near-round gold mango that read as an orange apple, i.e. the 100 and
the 500 looked alike.

## Coins — the economy (IDEA-016 v2, IDEA-017)

**Coins come from the maze, and only the maze.** There is no points-to-coins
conversion — the five coin pickups a map are the entire economy, which is what
makes them worth detouring for. If earning is ever too slow, raise
`COINS.pickupValue`; do not reinstate a milestone.

A coin appears five times a map at pellet-eaten thresholds `COIN_THRESHOLDS`
= 15 / 55 / 90 / 125 / 155 — starting early, spread across a ~179-pellet map,
and offset from the fruit's 40/80/120/160 so the two essentially never spawn on
the same tick. Placement **prefers bare cleared floor**: it is drawn from every
walkable tile that does not currently hold a pellet, so the coin stands out
against corridors you have already eaten rather than hiding among the biscuits,
and grabbing it is a real detour rather than the path you were walking anyway.
It falls back to any walkable tile very early in a level, so a coin always
appears. Walking onto it grants `COINS.pickupValue` (1) with **no points**, and
it despawns after `COINS.lifespanSeconds` (18s) if not taken.

**The server is the authority.** `plausibility.ts` recomputes the award and
`scoreService` banks it; the client's balance is optimistic and reconciled to
the profile the API returns. A change that only touches `src/game` therefore
changes nothing at all.

`coinsDueFromScore` in `coins.ts` survives under its old name because bonus
LIVES still use the same maths on `LIVES.milestonePoints`. That is the one
points-milestone left, and it is fine because a life is not a currency: you
cannot bank or spend it.

## Power-ups (IDEA-046) — classic mode only

Five pickups that change the RULES rather than the score: x2 biscuits,
x2 enemies, an anchor that slows the pack, a star that frightens them and speeds
the beagle, and a shield. Four a map at `POWERUP_THRESHOLDS`
(30 / 70 / 105 / 145), each despawning after 18 seconds — the tightest of the
three timed pickups.

The design exists for one sentence: **a shielded hit is not a death.**
`onCaught()` returns `"shielded" | "died"`, a third outcome between "nothing
happened" and "you lost a life", so the two doublers survive it. They survive
clearing a map too, which is why power-up state is RUN-scoped. Three lifetimes
— `timed`, `untilDeath`, `untilHit` — and the asymmetry between them is the
feature.

**A Journey run reporting a power-up is rejected outright**, because every
Journey score already on the board was set without them.

## Beagle perks (IDEA-064) — also classic only

The shop sells beagles, not skins: every coat carries a power, and the mapping
lives in `src/game/perks.ts` — the only module allowed to join a coat's identity
to its balance numbers.

| Coat | Perk |
|---|---|
| Bagel (free) | Opens every map holding a shield |
| Cookie | An extra life at the start of every map |
| Muffin | Every coin pickup is worth double |
| Pepper | Every fruit pays 100 more |
| Pac-Beagle | Unlocks the Ghost enemy and the Arcade Night board |

Every accessor in `perks.ts` takes the run's mode and returns the NEUTRAL value
for a Journey run — there is no way to ask without saying which mode is running.
The coat is **snapshotted when the run starts** (`game_sessions.beagle_skin_id`),
never read off the user row at the end: equipping is free and instant, so
reading it late would let a player take Bagel's shield through a run and swap to
Muffin before the score posts.

The free coat has a real perk on purpose. Bagel is what everyone starts on, and
a blank slot there would make "beagles have powers" something you only discover
after spending 25 coins.

## Bonus lives (IDEA-018)

Lives are per-run and capped at `LIVES.max` (5). Three triggers all grant one
through `Game.grantLife()`, which silently no-ops at the cap:

- **A golden bone** — once a map, at pellet threshold `LIFE_THRESHOLDS` (130),
  deliberately offset from every coin and fruit threshold. Time-limited like the
  others; consumed even at the cap.
- **A points milestone** — every `LIVES.milestonePoints` (10,000) of run score.
  The counter always advances to the crossed threshold even when capped, so a
  milestone reached at full lives can never silently re-fire later.
- **A perfect fright** — eating every enemy within one fright window.

The HUD always draws `LIVES.max` hearts and dims the ones not yet earned, so the
ceiling is visible from a player's first run rather than only after they earn a
fourth.

## Progression (IDEA-061)

Classic is a **30-map cycle in six stages of five**, each stage closed by a
bonus level: 36 mazes, 36 levels a lap. Enemy counts ramp 3 / 3 / 4 / 4 / 5 / 5
across the stages — maps 1-15 are byte-for-byte the progression they always
were, because fifteen maps players already know must not change difficulty
underneath them.

**The map number is a running count, not a position.** Lap 2's first map is
Map 31, not "Map 1 ·2". The maze repeats; the count does not.

A bonus map has no bones and its pen stands free — no wall tile may touch the
ring around it, or the house reads as a lump fused to a wall rather than sitting
in a meadow.

## The Journey (IDEA-063, IDEA-077)

Forty levels in two chapters.

- **Levels 1-30, the Grand Tour** — one level per playable maze, in maze order,
  at literally classic's own modifiers. They exist because classic only ever
  shows a player the maps its progression hands out, so most players will never
  meet maze 23. **Do not "improve" one of them with a twist**: the chapter's
  value is that it is the same game thirty times, so the board is the only
  variable. Every level also forces a theme, owned or not, cycling all six — a
  player who bought one theme has never seen the other five.
- **Levels 31-40, the Twists** — the original eight, byte-for-byte, plus two
  that go in the only directions the first eight never used: one *below* classic
  pace with a *longer* fright window, and one new ceiling.

No power-ups and no perks in either chapter.

## Challenges (IDEA-078)

114 goals across three categories and both modes, claimed from a full-screen
screen reached by the trophy beside the menu's coins.

**The server decides every one of them.** Coins are server-authoritative, so a
challenge the client judged complete would be a coin the client minted, gone on
the next sync. `src/game/challenges.ts` holds the definition table and the view
layer and judges nothing; the API returns value/target/reward and the screen
draws those.

**Progress is derived, never accumulated.** `run_stats` already keeps one row
per finished run, so "in one run" is a `MAX`, "in general" is a `SUM`, and a
per-level fact is a `COUNT(DISTINCT ...)` — one query returns every number the
ladder needs, and a per-challenge counter would be a second copy of a truth that
table already holds.

Rewards are **claimed, not auto-paid**. Auto-paying needs no table and no
endpoint, and leaves a list you can only read, which nobody opens twice.

## Controls (IDEA-049)

- **Desktop** — arrow keys / WASD.
- **Touch** — three schemes, chosen per account: **swipe** (the default), an
  on-screen **D-pad**, and a **thumbstick**. All three feed the same
  `beagle.queued` direction, so the gameplay layer knows nothing about which is on.

The thumbstick's feel is one pure function, `resolveStickDir`, and its two rules are
asymmetric on purpose. Switching AXIS is gated a few degrees past the diagonal, so a
thumb parked on the corner cannot chatter; REVERSING along the same axis is instant
and ungated. Inside the dead zone the held direction is **kept, never cancelled** —
the beagle has no "stop" to flicker to.

Direction is emitted only on CHANGE. `Entity.queued` persists until overwritten, so a
held stick keeps asking for free, and a turn refused at one junction is still waiting
at the next.
