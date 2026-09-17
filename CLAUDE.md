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
The full game is built, shipped, and deployed (playable since v1.0; **now on v8.0 "Paying Attention"**).

**v5.0 made this a full-stack app.** It is no longer a static offline PWA:
- **Frontend** — `beaglechomp.nunoamorim.dev` (Cloudflare Pages). Needs `VITE_API_URL` at build time.
- **API** — `beaglechomp-api.nunoamorim.dev`, source in `server/` (Hono + Postgres + argon2id,
  deployed by Dokploy from this same repo — see `server/README.md` and root `STACK.md`).
- **Sign-in is required before play.** `src/main.ts` awaits the auth gate before `new Game()` exists;
  there is no guest mode. `profileStore.ts` kept all 19 synchronous signatures but now reads an
  in-memory cache hydrated from the server, so `game.ts`/`shop.ts`/`levelMap.ts` were untouched.
- **Scores are server-validated** (`server/src/validation/plausibility.ts`, pure + heavily tested).
  Reading a submission off the wire is `validation/wire.ts` — also pure, and pure ON PURPOSE:
  it used to live in `scoreService.ts`, which opens a Postgres pool on import, so no DB-free
  test could reach it and `levelIdxSequence` went un-sent AND un-read for a whole release
  (IDEA-040 v3). **Every field the client sends must be named in `wire.ts` or it is silently
  dropped** — add a field to `RunSubmission` and you add it there and to the round-trip test.
  Its constants are GENERATED from the real game modules by `server/scripts/sync-game-constants.ts`
  — so **after changing `config.ts`, `mazes.json`, `journey.ts` or `challenges.ts`, run
  `npm run sync` in `server/`**, or honest runs will start being rejected and challenge
  rewards will be judged against the old table. `npm run test:catalog` fails on drift.
  **`journey.ts` AND `challenges.ts` are both parsed as TEXT**, so the entry FORMAT of each
  is part of that contract — two sibling files, two literal arrays, and swapping which one
  is sliced ships a catalog with neither. See the 40-level ladder note and IDEA-078 below.
- **The API measures itself** (IDEA-039): every request is timed by the outermost middleware and a
  p95-per-route table goes to the container log every 10 minutes, with `GET /metrics` for the JSON
  form (only exists when `METRICS_TOKEN` is set). Route labels are Hono's matched PATTERN, never
  the raw path — see `server/src/http/metrics.ts` and `server/README.md` § Observability. The
  `[slow-query]` line at 200 ms is deliberately STACK.md §6's own Redis trigger, so **Redis stays
  deferred until that line actually appears, or a second replica exists** — not on a hunch.
- **THE ADMIN PORTAL IS RESPONSIVE NOW, AND THE INTERESTING RULE IS ABOUT SVG TYPE**
  (IDEA-075). Nuno, with a screenshot of a 1879px window: *"we have the screen only half the
  screen, lets make this dashboard responsive and use all the screen and available to see in
  all the devices."* The visible half was one declaration — `main` carried
  `max-width: 1200px` with no auto margin, so the portal sat in 63% of a 1920px monitor and
  47% of a 2560px one, pinned to the left. Measuring the rest first is what made it a pass
  rather than a one-line diff. `npm run test:admin-ui` (312 checks, 7 framings x 8 tabs)
  drives the real app with every API call stubbed — **no database and no API container** —
  and was verified by re-injecting all four original defects and watching it fail on each.
  Five rules are load-bearing.
  1. **A FIXED-VIEWBOX SVG AT `width:100%` SCALES ITS OWN TYPE**, so a font-size in the
     stylesheet is NOT the size on screen: `rendered = declared x (box / viewBox)`. One
     value of 11px was rendering anywhere from **6.2px to 28px** depending on which column
     the chart landed in, and both ends were already wrong on a 1280px laptop, long before
     anything went full-width. Two levers and both are needed — a **max-width per chart
     kind** (which is what makes a full-width shell survivable at all) and a **type bump
     when the container is narrow**.
  2. **THAT BUMP IS A CONTAINER QUERY, NOT A MEDIA QUERY, and that is the whole point:
     the chart rendering smallest was not on a narrow SCREEN, it was in a three-up COLUMN
     on a wide one.** A viewport query cannot see the case it has to fix. `.panel` carries
     `container-type: inline-size` for it, which also makes the panel width independent of
     its contents — a second guard against rule 3.
  3. **A GRID ITEM TAKES `min-width: auto`, WHICH RESOLVES TO ITS MIN-CONTENT SIZE.** A
     panel holding a nowrap eight-column table has a min-content of ~865px, so it refused
     to shrink to its track and pushed the DOCUMENT wider than the viewport — seven of the
     eight tabs overflowed a 390px phone sideways, the Difficulty tab by 475px, dragging
     their own headings and prose out of frame. This had nothing to do with the 1200px cap
     and would have survived fixing it. `min-width: 0` hands the overflow to `.scroll`.
  4. **auto-FIT WHILE THERE IS A SENSIBLE AMOUNT OF ROOM, auto-FILL ONCE THERE IS TOO
     MUCH.** The difference is what happens to tracks nothing occupies: auto-fit collapses
     them and the items absorb the space, right at 1280 and absurd at 1920, where three
     stat tiles each became 600px of empty card around a four-character number. Tables are
     the same problem from the other side — `width: 100%` put 700px of brown between two
     columns of a four-column table, so `table.data` sizes to CONTENT with a floor of
     `min(100%, 760px)`.
  5. **THE STICKY HEADER IS SWITCHED OFF ON PHONES, AND ITS QUERY NEEDS BOTH CLAUSES.**
     Topbar and tabs are one `.shell-head` (they were siblings, so branding stuck and the
     navigation scrolled away on tabs whose tables run several screens), sticky above
     700px wide AND 560px tall. On a phone header-plus-two-rows-of-tabs is a fifth of the
     viewport; at 844x390 landscape it would be a third — which is why the suite checks an
     844px-WIDE framing expecting a STATIC header.
  Prose is bounded where it is WRITTEN (`--prose: 92ch`), never by bounding the page.
  `.scroll` draws its own scroll shadow, because Chrome's overlay scrollbars show nothing
  at rest and a phone reader has no way to know four of eight columns are past the edge.
  The suite's thresholds are bounded at BOTH ends on purpose: a "nothing is too small"
  check passes happily on a chart that is far too big, and on a hidden element measuring
  zero. Its own framing table was wrong once before the code was — suspect the instrument
  first.
- **The FRUIT is a LADDER, not a flat 100** (IDEA-045): five fruits — apple 100,
  banana 200, carrot 300, strawberry 400, mango 500 — on a weighted roll
  (`FRUITS` in `config.ts`, `rollFruit` in `fruits.ts`), four per map instead of
  two. Three things are load-bearing. The kind is chosen at SPAWN and remembered
  (`Game.fruitKind`), never re-rolled at eat time, or the mango you crossed the
  maze for could pay out as an apple. The five meshes commit to five different
  SILHOUETTES, because three of them are round and warm and at the game camera a
  fruit is a handful of pixels — the first pass had a near-round gold mango that
  read as an orange apple, i.e. the 100 and the 500 looked alike. And the server
  prices runs against `MAX_FRUIT_POINTS`/`MIN_FRUIT_POINTS`, so the client now
  reports `fruitPoints` (the exact total) alongside the count — **change a number
  in `FRUITS` and you must run `npm run sync` in `server/`** or honest runs start
  failing `SCORE_ITEM_MISMATCH`. `FRUIT_THRESHOLDS` moved from `game.ts` to
  `config.ts` for the same reason. **The fruit is TIMED** — it despawns after
  `FRUIT_LIFESPAN_SECONDS` (20s, the most generous of the three timed pickups
  because it lands on the maze's fixed `F` tiles rather than near the beagle),
  so crossing the maze for a mango is a gamble instead of an errand you run on
  the way past. An expired fruit does not burn its threshold: `maybeSpawnFruit`'s
  board-occupied guard sits BEFORE the threshold check, so a map still gets four.
- **POWER-UPS change the rules, not the score** (IDEA-046): five pickups —
  x2 biscuits, x2 enemies, an anchor that slows the pack, a star that
  frightens them and speeds the beagle, and a shield. The design is in
  `src/game/powerups.ts`, which is pure and exists for one sentence: **a
  shielded hit is NOT a death.** `onCaught()` returns `"shielded" | "died"` —
  a third outcome between "nothing happened" and "you lost a life" — so the
  two doublers survive it. They also survive clearing a map, which is why
  `PowerupState` is RUN-scoped on `Game` and not on `LevelAssets`. Three
  lifetimes (`timed` / `untilDeath` / `untilHit`) and the asymmetry between
  them is the feature, not an implementation detail. **Classic only** —
  a challenge run reporting a power-up is rejected outright, because every
  challenge score already on the board was set without them. The two doublers
  multiply score, so `plausibility.ts`'s ceiling is sized from what the run
  actually REPORTS collecting; the score FLOOR is deliberately left
  un-multiplied, since a doubler collected late means most pellets were eaten
  at face value.
- **EVERY BEAGLE HAS A POWER, AND THE SHOP SELLS BEAGLES RATHER THAN SKINS**
  (IDEA-064). A coat is no longer a colour swap: `BeagleSkin.perk` is
  REQUIRED, the five are distinct, and the mapping is an identity of the coat
  (`cosmetics.ts`) while the magnitudes are balance numbers
  (`config.ts`'s `BEAGLE_PERKS`). **`src/game/perks.ts` is the only thing
  allowed to join them** — Bagel opens every MAP holding a shield, Cookie
  grants a life at the start of every MAP, Muffin doubles every coin pickup,
  Pepper adds 100 to every fruit, and the Pac-Beagle's perk is paid at the till
  (it unlocks the Ghost and the Arcade Night board). Nine rules:
  1. **PERKS ARE CLASSIC ONLY, and that rule lives in ONE function.** Every
     accessor in `perks.ts` takes the run's `kind` and returns the NEUTRAL
     value for a challenge run — there is no way to ask without saying which
     mode is running. Same reasoning as power-ups (IDEA-046): every challenge
     score already on the board was set without them.
  2. **THE SERVER PRICES THREE OF THE FOUR, SO A PERK IS A `npm run sync`.**
     Muffin doubles the coin AWARD (`plausibility.ts` is the authority on
     coins; the client's add is optimistic and reconciled), Cookie widens
     `LIVES_IMPOSSIBLE` by one per level PLAYED, and Pepper moves the EXACT
     fruit total a score is checked against — `fruitKindCounts` collapses the
     band to a single number, so a bonus the server does not add is an honest
     run REJECTED. `catalog.generated.ts` carries `BEAGLE_PERK_BY_SKIN` and
     `BEAGLE_PERKS`, both generated; `test-catalog.ts` fails on drift.
  3. **THE COAT IS SNAPSHOTTED WHEN THE RUN STARTS**
     (`game_sessions.beagle_skin_id`, migration 011), never read off the user
     row at finish. Equipping is free and instant, so reading it late would let
     a player take Bagel's shield through the run and swap to Muffin on the
     menu before the score posts — two perks from one run. Same shape as
     `challenge_idx`: what a run IS gets decided when it begins. An unknown id
     resolves to the default coat's perk, which cannot inflate anything.
  4. **BAGEL'S SHIELD IS NEVER REPORTED AS A COLLECTED POWER-UP.** It is
     granted through `powerups.ts`'s own `collect` so it behaves as a shield in
     every respect, and deliberately not passed to `recordPowerup` — it was not
     picked up off the floor, it cannot add a point, and a challenge run
     reporting a power-up is rejected outright.
  5. **THAT SHIELD IS PER MAP, AND IT COSTS THE VALIDATOR NOTHING** (v4, Nuno:
     *"lets make this beagle have a shield in every map"*). It was once per run
     in v1, which is the other honest reading of "starts with a shield" and the
     weaker one: one map's protection across a thirty-map classic run stops
     mattering by map three, where one per map is a coat you keep choosing. The
     grant moved from `startClassicRun` to `startLevel`, where it now sits
     beside Cookie's life — the two perks are the same rule wearing two coats,
     and both read `this.gameKind`, which `startLevel` sets to `"classic"` on
     its first line. Two things fall out of it:
     - **STACKING IS UNREPRESENTABLE RATHER THAN CLAMPED.** A shield is
       `untilHit`, so it SURVIVES a cleared map (IDEA-046's asymmetry), and
       `collect` REFRESHES a power-up already held instead of pushing a second.
       A player who reaches map 4 unhit is therefore holding exactly one shield,
       not four, with no guard anywhere. Raising `shieldsPerMap` above 1 would
       break that silently — the second would queue behind the first — which is
       why `test-perks.ts` pins the number and says why.
     - **THE SERVER NEEDED NO CHANGE AT ALL**, and it is worth knowing which
       perks have that property. The shield absorbs a hit; it adds no point,
       grants no life and is never reported as a collected power-up, so
       `perksFor` has nothing to widen for it. The same move on Cookie's life
       would have been a bound (`LIVES_IMPOSSIBLE` is per level PLAYED) and a
       `npm run sync`. Dying does NOT refill it either: the cadence is the MAP,
       exactly as Cookie's is.
     The perk id and the balance key were renamed with it — `shieldPerMap` /
     `BEAGLE_PERKS.shieldsPerMap` / `perkShieldsPerMap`, matching
     `extraLifePerMap` field for field, because the two now answer the same
     question and a `startShield` sitting beside them would be the only name in
     the file that no longer described when it fires.
  6. **THE FREE COAT HAS A REAL PERK ON PURPOSE.** Bagel is what every player
     starts on; a blank slot there would make "beagles have powers" something
     you only discover after spending 25 coins.
  7. **THE FLEA IS THE DEFAULT ENEMY SKIN** and the beetle is now a 25-coin
     sibling. The enemy a player meets before buying anything should say what
     THIS game is, and a flea belongs on the dog in a way a beetle in a garden
     does not.
  8. **A HELD SHIELD IS DRAWN ON THE DOG** (v5, Nuno: *"can we add something
     visual? Like a buble around the beagle... this way we have a visual
     indicator"*). `src/render/shieldBubble.ts` carries the full reasoning;
     four things are worth knowing from here.
     - **A SPHERE THAT CONTAINS THE BEAGLE IS WIDER THAN THE CORRIDOR.**
       Measured from vertices (`scripts/_scratch-beagle-bounds.ts`), the dog is
       0.453 x 0.866 x 0.908 and its tightest enclosing sphere has radius
       0.553 about y = 0.43 — **1.106 tiles**, against a corridor of one. So
       the bubble is an ELLIPSOID AIMED ALONG THE DOG'S HEADING: narrow across
       the corridor, where there is no room, long along it, where there is.
       The clearance is not uniform either, because IDEA-068's hedge bulges
       OUTWARD with height (`0.105 * t^1.7`), so the tightest gap (0.055) is
       at the bubble's own widest point rather than at the floor.
     - **A TRANSLUCENT SHELL ALONE IS A SMUDGE; THE RINGS ARE WHAT READ.**
       IDEA-068's lesson at one more scale — at 18.6 CSS px a tile, a shape
       does not carry and a hard VALUE STEP does. The first build was two
       shells and rendered as a grey bloom that could have been the dog's own
       shadow. It ships with two bright HORIZONTAL latitude rings (equator plus
       one at 0.62 of the half-height, whose radius is DERIVED as
       `sqrt(1 - h^2)` so it cannot drift off the shell). Horizontal because
       this camera looks down 59 degrees: a horizontal circle reads face-on at
       every heading, where a vertical one would swing from a wide ellipse to
       an edge-on line as the beagle turned a corner — a state readout that
       comes and goes with the direction of travel.
     - **IT IS A SIBLING OF THE BEAGLE, NOT A CHILD.** That group breathes,
       waddles, is scaled to nothing by the death animation and is strobed
       invisible twelve times a second during the post-hit grace blink. The
       bubble copies position and yaw and inherits none of it.
     - **AND IT IS DRIVEN OFF `hasShield()`, NOT OFF THE EVENTS.** Every
       appearance and disappearance is derived from that one edge in
       `update()`, so no call site can grant, spend, clear or carry a shield
       over a map boundary and forget to tell the bubble — the failure mode the
       tray chip has to be hand-synced against at seven sites. It is
       `MeshBasicMaterial`, unlit: the second deliberate exception to the
       cel-shading rule after the eye glint, because a toon ramp would band a
       bubble into three flat regions and the dark one reads as dirt on the
       glass. Spent on a hit it BURSTS (`effects.shieldBroke`, a cyan ring at
       the dog) rather than just going out — otherwise a shield that saved you
       and a shield that ran out look identical. `powerups.ts` has advertised
       `hasShield()` as being "for the HUD and for the beagle's bubble" since
       IDEA-046 and the export sat unused for four releases.
  9. **CHANGING `DEFAULT_ENEMY_SKIN_ID` IS A MIGRATION, and it was missed
     twice.** `001_init.sql` still defaulted `equipped_enemy_skin_id` and
     `owned_enemy_skin_ids` to **`'ghost'`** — written when the ghost WAS the
     default, and never moved when the beetle took over or when the flea did.
     So the server handed the Ghost to every account it ever created, owned and
     equipped, and **`visibleEnemySkins`' kind-to-legacy-accounts clause
     (`|| isOwned(id)`) then matched literally everybody** — "buy the
     Pac-Beagle to unlock the Ghost" was unreachable copy for a thing every
     player already had, and the client gate was working exactly as written the
     whole time. `012_default_enemy_skin_flea.sql` moves the defaults, revokes
     the Ghost from accounts that do not own the tribute coat (nobody chose it
     — it arrived as a column default), and re-points anyone left equipped to
     something they no longer own. **Arcade Night needs no equivalent**: it was
     never a default and could only be reached by paying 50 coins, so everyone
     who owns it bought it.
  **THE ARCADE NIGHT BOARD IS NOW THE GHOST'S OTHER HALF.** `MazeTheme.secret`
  + `TRIBUTE_MAZE_THEME_ID` + `visibleMazeThemes` mirror the enemy-skin rule
  field for field, and the theme's price dropped from 50 to **0** — it is
  GRANTED by `buyBeagleSkin`, not bought, which needs no special path because
  `buyCosmetic` refuses on `coins < price` and the server's catalog agrees.
  `initProfileFromCache` BACKFILLS both tributes for anyone who bought the coat
  before the board joined the bundle; without that they would own the coat and
  be shown a price for something it advertises as unlocking.
  **THE SHOP CARDS WERE REDRAWN WITH IT** (v2, Nuno's call), and one of the
  three changes was fixing something live and broken:
  - **A beagle's swatch is a PAW painted in the coat's colours**, not four
    colour dots. `beagleSwatch` emits inline SVG, which it must: the whole
    point is showing four channels at once and a font glyph takes exactly one
    colour, so `ICON.beagle`'s own paw could never do this. The mapping mirrors
    where each colour sits on the dog — pad `tan`, outer toes `ear`, inner toes
    `black`, sole `paw ?? white` — and the sole is at the pad's BOTTOM EDGE
    because a lighter oval centred inside a wide one reads as an EYE at 48px,
    which is worse on a card selling a dog than no marking at all. Stroked in
    the system ink, never the coat's own `black`: Muffin's "black" is a soft
    brown and would lose its outline entirely.
  - **THE ENEMY CARDS WERE PRINTING THEIR OWN LIGATURE NAMES, and had been for
    three releases.** `ENEMY_ICONS` held RAW STRINGS (`"pest_control"`,
    `"hive"`, `"bug_report"`) instead of `ICON` roles. The font subset is cut
    from the values in ICON and nothing else, so those three glyphs were never
    in the file — and the Beetle, Bee and Ladybug cards rendered the words
    PEST_CONTROL, HIVE and BUG_REPORT in 26px text clean across the rail.
    `test-icon-font.ts` could not catch it because it builds its list from ICON
    too: **the three names that were not in ICON were exactly the three it
    could not test.** It now also REFUSES any snake_case string literal in a
    module that draws icons (blunt, cheap, and the precise shape of the defect
    — every multi-word ligature is snake_case and this codebase is otherwise
    camelCase). Verified by re-injecting the original bug and watching it fail.
  - **Enemies are marked by CATEGORY, themes one-each.** Material Symbols has
    no crab, flea, mosquito or sushi, so eleven distinct marks was never
    available — the honest choice was eleven near-misses or three true ones, and
    the card already carries its name. Six bugs (`ICON.critter`), four dinners
    (`ICON.food`), one special (`ICON.secret`, the ghost — the only enemy that
    is not a creature and the only one you unlock). Themes DO get one each,
    because there are six and the family has a true glyph for every one; each
    is drawn in its own `wall` colour on its own `floor` colour with
    `biscuit` + bloom accent as a band beneath, so the palette information the
    four dots carried is all still there, doing jobs instead of sitting in a
    row. The band does not repeat `wall` — the glyph is already drawn in it.
    `ICON.themes` moved from `park` to `palette` so the Themes TAB stops
    wearing the City Park theme's own mark.
  **The subset was re-cut to 59 names** (11.0 KiB; the five faces total 100
  KiB). `npm run test:icon-font` is the only thing that proves a re-cut worked
  — Google's CSS endpoint answers 200 for a name the family does not have.
  **The Pac-Beagle sits LAST in `BEAGLE_SKINS`** (Nuno's call): it costs twice
  its siblings, is the only coat that changes the model's silhouette, and its
  perk buys two other items rather than changing a run — so the rail reads as
  four comparable coats and then the special one. Nothing is indexed by
  position (`getBeagleSkin` and the default are both resolved by id).
  **The perk is shown in the shop's hero info** (`.shop-hero-perk`, beagle tab
  only) on `ICON.power` — already in the font subset — and deliberately NOT in
  amber, which §04 reserves for the one next action on a screen.
  `scripts/test-perks.ts` covers the pure rules, `server/scripts/test-catalog.ts`
  the drift, `server/scripts/test-plausibility.ts` each perk in both directions,
  and **`scripts/test-beagle-perks-ui.ts` (`npm run test:perks-ui`) drives the
  REAL app** — which is what found the database defaults: no pure test can see
  a column default, and every rule in `cosmetics.ts` was correct. v3 gave it a
  SECOND map, through the dev-only `window.__game` hook
  (`test-progression-ui.ts`'s own shortcut), because "the run opens shielded"
  is the one assertion that would still have passed had the grant never moved.
  v5 added the bubble's own three (it is in the scene, it is visible while a
  shield is held, and it is ON the dog), plus the negative on Cookie — an
  indicator that is always on indicates nothing. The shield's CYAN is
  hand-copied between `hud.ts`'s tray chip and `shieldBubble.ts` because no
  module is allowed to be imported by both (`hud.ts` may not reach `src/game`),
  so `test-powerups.ts` reads both files as TEXT and fails on drift — the same
  treatment `boardCodegen`'s palette fields get, and verified by flipping one
  digit and watching it fail.
  It also stopped waiting on **`networkidle`**: measured on this stack a cold
  browser context leaves one Vite dep request (`workbox-window`) open
  indefinitely, so the wait never returned on a page that was fully
  interactive — and the `waitForSelector` that is the real readiness signal was
  already on the line below it. The dev server also wants a navigation timeout
  well past Playwright's 30s default here: a hard reload refetches the whole
  module graph across a Windows bind mount.
  **THE TUTORIAL TEACHES THE FIVE POWERS, AND ITS LIST IS DERIVED** (v3). The
  carousel's seventh and last slide is the coat list, and every line in it is
  `BeagleSkin.perk.label` read off `cosmetics.ts` — the SAME string the shop
  card prints, never a paraphrase. `test-tutorial-carousel.ts` asserts every
  coat appears, in `BEAGLE_SKINS` order, with its label verbatim, so a sixth
  coat or a reworded perk updates the tutorial by existing. It is last because
  every line leans on a slide above it (a shield, a life, a fruit, a coin), and
  it carries the two facts the perks make load-bearing and nothing else in the
  game ever said: **perks are classic only**, and **coins come from the maze and
  nowhere else** (IDEA-016 v2 removed the points conversion silently). The paw
  beside each row is `src/ui/swatches.ts`'s `beagleSwatchHtml` — lifted out of
  `shop.ts`'s closure so there is ONE paw, not two that look alike until someone
  retunes one.
  **AND `#tutorial` OVERFLOWS DOWNWARD, NOT UPWARD.** It justified its flex
  column to `flex-end`, which overflows at the START — and overflow at the start
  of a scroll container cannot be reached, so a card taller than the screen lost
  its title and its copy off the top with no way to scroll back. Measured at
  844x390 the deck runs 312 / 335 / 268 / 313 / 358 / 290 / 451 against 390px of
  viewport: **five of the seven slides were already doing it**, and the coat
  list (451) is only the one that made it impossible to miss. Now
  `justify-content:flex-start` + `overflow-y:auto`, with the stage's own
  flex-grow putting the card in the same place whenever there is room — the
  `margin:auto` rule in §08, applied to an overlay.
  `scripts/test-tutorial-ui.ts` (`npm run test:tutorial-ui`) MEASURES the card
  at both framings; it is also where the slide count now comes from the DOTS
  rather than a literal, which had read `five` since IDEA-046 made it six.
- **COINS COME FROM THE MAZE, AND ONLY THE MAZE** (IDEA-016 v2): the
  points-to-coins conversion is gone — no "every N points banks a coin". The
  five coin pickups per level are the entire economy, which is what makes them
  worth detouring for. **The SERVER is the authority**: `plausibility.ts`
  recomputes the award and `scoreService` banks it, and the client reconciles
  its optimistic balance to the returned profile — so a change here that only
  touches `src/game` changes nothing at all. If earning is ever too slow, raise
  `COINS.pickupValue`, don't reinstate a milestone. `coinsDueFromScore` in
  `coins.ts` survives under its old name because bonus LIVES still use the same
  maths on `LIVES.milestonePoints` — that is the one points-milestone left, and
  it is fine because a life is not a currency: you can't bank or spend it.
- **Pure logic** (`src/game/*`): `mazes.json`+`mazes.ts` (**36 validated** mazes —
  connected, all pellets reachable, ghosts can leave the pen), `grid.ts` (tiles, tunnel
  wrap, walkability), `movement.ts` (tile-stepping model), `ghostAI.ts` (targeting with a
  dead-end-safe fallback), `state.ts` + `game.ts` (loop + state machine, the integration point).
- **THE CYCLE IS 30 MAPS AND THE MAP NUMBER NEVER RESETS** (IDEA-061). Six stages
  of five numbered maps, each closed by a bonus level: 36 mazes, 36 levels a lap.
  `progression.ts` is still the one place difficulty is tuned. Five rules:
  1. **Maps 1-15 are byte-for-byte the progression they always were** — same
     maze, same enemy count (3 / 3 / 4). The new stages EXTEND the ramp to
     4 / 5 / 5 rather than redistributing it, because fifteen maps players
     already know must not change difficulty underneath them. Stages 5-6 field
     the violet and leaf enemies, which classic mode had never used.
  2. **`mapNumber` is a RUNNING COUNT, not a position** — lap 2's first map is
     **Map 31**, not "Map 1 ·2", and the lap suffix is gone because the figure
     now carries the lap. The MAZE repeats (Map 31 is maze 0 again); the count
     does not, so `mapNumber` is never an index into anything.
  3. **The three original bonus mazes MOVED from [15..17] to [30..32]** to make
     room for maps 16-30. Invisible, because nothing stores a bonus maze by
     index: a run's `mazeIdxSequence` is CHECKED against `planLevel()` rather
     than compared with an older run's. Mazes 0-4 stay put, so challenge mode
     was untouched — it hardcoded mazeIdx 0-4 at the time. IDEA-063 extended it
     to all thirty PLAYABLE mazes (never the bonus ones), so the exclusion of
     [30..35] is now load-bearing in two places rather than one.
  4. **A bonus map has NO bones and its pen stands FREE** — no wall tile may
     touch the ring around the pen, or the house reads as a lump fused to a
     wall instead of sitting in a meadow. `test-progression.ts` enforces both;
     all three new bonus maps failed the second rule on the first pass.
  5. **The HUD figure is no longer one character wide.** Measured at 390px the
     map chip runs 75.5px at "5" to 92.8 at "115", and "Bonus" is 94.9 — wider
     than any of them — so a numbered map can never be what wraps that row. See
     the note above `.hud-chip--tight .v` in `style.css`.
  **Two bugs this turned up in code that had shipped**, both invisible to every
  check that existed: **maze 10 and maze 14 were byte-identical** (a duplicate
  is a perfectly valid maze, so nothing complained — `validate-maze.ts` and
  `test-progression.ts` now both reject repeats), and **the validator never
  asserted `REQUIRED_MAZE_COUNT`** although `progression.ts` had claimed it did
  since IDEA-040.
- **CHALLENGES ARE GOALS WITH REWARDS, AND THE SERVER DECIDES EVERY ONE OF THEM**
  (IDEA-078). Nuno: *"develop a logic to create challenges... like In one run get
  5 coins, and this will reward the players 5 coins... a menu with a full list of
  challenges and we can make categories like collect, scores, levels... to
  motivate the players and give more purpose."* **75 challenges** in
  `src/game/challenges.ts` — the file [[IDEA-077]]'s rename freed — over three
  categories and both modes, claimed on a full-screen page
  (`src/ui/challenges.ts`) reached from a trophy chip beside the menu's coins.
  Nine rules are load-bearing.
  1. **THE REWARD IS COINS, SO THE SERVER OWNS THE JUDGEMENT.** Coins are
     server-authoritative — `plausibility.ts` recomputes every award,
     `scoreService` banks it, and the client reconciles to the returned profile
     (IDEA-016 v2) — so a challenge the CLIENT judged complete would be a coin
     the client minted, gone on the next sync. There is exactly **one**
     evaluator, `server/src/validation/challenges.ts`, and `src/game/challenges.ts`
     is deliberately not it: it holds the definition TABLE and the screen's view
     layer and judges nothing. The API returns `value`/`target`/`reward` and the
     screen draws THOSE, so an unsynced client cannot show a player a target the
     server is not applying.
  2. **PROGRESS IS DERIVED, NEVER ACCUMULATED — and that is why the whole
     feature needed one table and no counters.** [[IDEA-050]]'s `run_stats`
     already keeps one row per finished run with the validated telemetry, keyed
     to the account and indexed on `(user_id, finished_at)`. So "in one run" is a
     `MAX`, "in general" is a `SUM`, and a Journey per-level fact is a
     `COUNT(DISTINCT challenge_idx)` — **one conditional-aggregate query grouped
     by mode returns every number the ladder needs**. A per-challenge counter
     written at run finish would be a second copy of a truth that table already
     holds. *(The original plan scoped v1 to single-run only on the assumption
     that lifetime totals needed accumulators; reading migration 006 is what
     reversed it, and Nuno's own lists were half "in general".)*
     Two honest costs, both recorded rather than fixed: `run_stats` is written
     AFTER the finish transaction commits (IDEA-050's invariant is that
     statistics must never cost a player their score), so a process that dies in
     that window loses one run's contribution; and rows backfilled by 006 carry
     zeroed item counts, so lifetime totals start at 006 rather than at a
     player's first ever game.
  3. **A CHALLENGE MAY ONLY READ A FIELD THE VALIDATOR ALREADY BOUNDS.** Every
     metric resolves to a `run_stats` column `plausibility.ts` checks, and the
     query filters `accepted = true` — that table records REJECTED runs too, so
     the ceiling on a farmed score has to stay a ceiling on a farmed reward.
  4. **BOTH MODES HAVE THEIR OWN SET, AND THE MODE SCOPE IS NOT OPTIONAL**
     (Nuno: *"classic mode and journey mode will have dedicated challenges"*).
     Power-ups and beagle perks are classic-only and a Journey run reporting one
     is rejected outright ([[IDEA-046]], [[IDEA-064]] rule 1), so an unscoped
     goal is either uncompletable in half the game or scored against
     perk-assisted numbers in one mode and bare ones in the other. `"both"`
     exists, folds `max` for a personal best and `+` for a lifetime total, and is
     deliberately unused so far.
  5. **"ON THE FIRST TRY" IS NOT SHIPPABLE AND "FIRST CLEAR" IS.** Nuno asked
     for it by name. It is a cross-run fact, and the obvious implementation —
     count prior `game_sessions` at that `challenge_idx` — is a lie twice over:
     quitting to the menu is free and leaves an `abandoned` row, so "no prior
     attempt" stays true after any number of retries; and
     `deleteOldAbandonedSessions` purges those rows past
     `SESSION_RETENTION_DAYS` ([[IDEA-039]] P2), so even the leaky count decays.
     The honest substitute needs nothing new: at finish the transaction holds
     `session.challenge_idx` and `user.challenge_progress`, and unlocking is
     strictly sequential, so `challenge_idx === challenge_progress` means "this
     level was still your frontier". **Do not ship a challenge a retry beats** —
     a farmable goal is worse than a missing one.
  6. **`CHALLENGES` IS A LITERAL ARRAY AND MUST STAY ONE.** 75 entries is
     exactly the size at which a `ladder()` helper is tempting, and that is
     [[IDEA-063]] rule 6 verbatim: `sync-game-constants.ts` parses this file as
     TEXT, a generated array regexes to nothing, the catalog ships zero
     challenges, every local test passes, and nobody can claim anything in
     production. **Adding or retuning a challenge means `npm run sync` in
     `server/`**; `npm run test:catalog` fails on drift and the sync's own count
     guard refuses a short parse. Only the four JUDGED fields cross — id, mode,
     metric, target, reward. Names, blurbs and categories stay client-side, so
     rewording a blurb is not a deploy and deliberately does not fail the drift
     test.
  7. **THE REWARD IS CLAIMED, NOT AUTO-PAID, AND THAT IS WHAT GIVES THE SCREEN A
     JOB** (Nuno's call). Auto-paying needs no table and no endpoint — and
     leaves a list you can only read, which nobody opens twice. The claim is the
     only new state: `challenge_claims` (migration 014), whose PRIMARY KEY
     `(user_id, challenge_id)` is what makes a double payout impossible rather
     than unlikely — two requests racing both read "not claimed", and only the
     insert decides. `reward_coins` is stored on the row so a later rebalance
     cannot restate what somebody was actually paid. **An id is therefore never
     reused**: a retired id leaves its claim rows behind.
  8. **THE ENTRY POINT IS A CHIP BESIDE THE COINS, NOT A FIFTH TILE.** The
     destination row is a fixed 4-up grid and [[IDEA-036]] v3 deleted the
     carousel precisely because five items did not fit 390px; `test-menu-ui.ts`
     asserts every tile is on screen without scrolling. The wallet and the chip
     are ONE group in the bar, because `.menu-bar` is space-between with two
     children and a third loose child spreads coin/trophy/actions evenly across
     the width. The badge is GREEN (`--bc-go`), never amber: §04 reserves amber
     for the single next action on a screen and the menu's is Play. The badge is
     also the reason rewards are claimed — an auto-paying version has nothing to
     count — and it is refreshed by `Game`'s new `onMenuShown` hook, because a
     RUN is the only thing that can complete a challenge and every run ends at
     `showMenu()`. **`Game.refreshWallet()` exists for the other half**: the
     screen sits ABOVE the menu, so nothing repaints the wallet behind it when a
     claim lands.
  9. **PER-MAP CEILINGS ARE MEASURED, AND TWO OF THEM SURPRISE PEOPLE.** A board
     holds **5 coins** (`COIN_THRESHOLDS`) but only **4 fruit**
     (`FRUIT_THRESHOLDS`) and every one of the 36 mazes carries **4 bones** — so
     Nuno's "collect all 5 fruits in each level" is uncompletable and ships as
     4. It also means the four "in one run" ladders are NOT equally hard at the
     same number (30 enemies is two or three maps; 30 bones is eight; fruit is
     hardest because it is TIMED), which is why the reward runs
     enemies < coins < bones < fruit at every tier. `COINS_PER_MAP` /
     `FRUIT_PER_MAP` / `JOURNEY_GHOST_TARGET` are named constants checked
     against `config.ts` itself, and the BLURBS are checked against them too —
     a correct constant under a card that says "all 5 fruits" is still a lie.
  **Nuno's forty "do it in each level" goals collapse into ladders.** Four kinds
  across 40 Journey levels is 120 rows on a screen whose job is telling a player
  what to do next; each is "do it in N DIFFERENT levels" instead — the same
  achievement, one `COUNT(DISTINCT challenge_idx)`, and it reads as a ladder like
  everything else.
  **The economy is bounded at BOTH ends.** The whole ladder pays 713 against a
  shop costing ~550, earned across hundreds of maps. The upper bound is the real
  risk (five coins a map stops being worth detouring for, which is the entire
  point of [[IDEA-016]] v2 deleting the points conversion); the lower one matters
  too, because a ladder paying a rounding error is what a well-meaning "let's not
  unbalance it" retune produces. `test-challenge-ladder.ts` pins the band.
  **Four suites, and they overlap on purpose.** `scripts/test-challenge-ladder.ts`
  (43 checks, in `npm run test`) reads the SOURCE table, so a bad entry fails
  before a sync; `server/scripts/test-challenges.ts` (39) reads the GENERATED
  one; `server/scripts/test-challenges-db.ts` (33) covers what only exists with
  Postgres — the aggregate, the mode mapping, that **bigint comes back as a
  STRING** (`"90" >= 100` is true on a string compare, so a missing `Number()`
  passes some challenges and fails others at random), and two claims racing; and
  `npm run test:challenges-ui` (38) drives the real app.
  **TWO INSTRUMENT FAILURES WORTH THE TALLY, both this project's standing rule.**
  A `\b` that reached the sync script as a literal BACKSPACE byte made the
  challenge parse return zero — caught by the count guard, which is the whole
  reason it exists. And the UI suite's header check **passed on the injected
  defect**: `.map-back` is a fixed 44px box, so adding a "Menu" label does not
  move its `getBoundingClientRect` by one pixel — the text spills OUT of it and
  the title is drawn over the spill. A rect comparison cannot see that; the
  button's own `scrollWidth - clientWidth` can. Suspect the instrument first.
  **And a query pair inside a transaction must be SEQUENTIAL.** A single
  `PoolClient` cannot run two statements at once — pg queues them today and
  throws in pg@9 — so the claim path awaits its two reads in order while the
  list endpoint, which has no client, runs them concurrently off the pool. It
  surfaced only as a DeprecationWarning under a passing test.
- **THE MODE IS CALLED THE JOURNEY, AND THE RENAME IS COPY-ONLY** (IDEA-077).
  "Level" already means ONE MAP OF ANY RUN here — the HUD chip says "Map 3",
  there is `levelIdxSequence`, `startLevel`, `planLevel` and a level MAP — so
  naming the mode "Levels" (Nuno's other candidate) would have made every
  sentence ambiguous. It is also what frees the word **Challenges** for
  IDEA-078's goals-and-rewards screen; two destinations wearing one word and
  one trophy is how a player learns that neither means anything, so the mode
  took `ICON.journey` (`route`, the winding path its own level map draws) and
  the trophy went to Challenges. **What a player READS changed; what crosses
  the wire or sits in Postgres did not** — `mode: "challenge"`,
  `PublicProfile.challengeProgress`, `users.challenge_progress`,
  `game_sessions.challenge_idx` and its named CHECK `challenge_idx_matches_mode`
  all keep their names, because renaming any of them is a migration plus a
  lockstep deploy for zero player benefit. The one structural move was
  `src/game/challenges.ts` -> **`src/game/journey.ts`**, done at rename time
  rather than later precisely because `challenges.ts` is now IDEA-078's file:
  `sync-game-constants.ts` opens the ladder **by PATH, as TEXT**, so pointing
  it at the wrong existing file ships a catalog with zero journey levels while
  every local test passes. `scripts/test-journey-naming.ts` (28 checks, in
  `npm run test`) guards all three halves — the path the sync script really
  opens, the wire/DB names being untouched, and the player-facing copy — and
  was verified by re-injecting each defect and watching it fail.
- **CHALLENGE MODE IS 40 LEVELS IN TWO CHAPTERS, AND THE FIRST THIRTY HAVE NO
  TWISTS** (IDEA-063). `journey.ts` is still the one place a Journey level
  is defined, and classic mode still never consults it. Seven rules:
  1. **Levels 1-30 are THE GRAND TOUR: one level per PLAYABLE maze, in maze
     order, at literally `CLASSIC_MODIFIERS`.** Three enemies, classic pace, the
     full fright window, the same fruit and golden bones classic has. They exist
     because classic only ever shows a player the maps its progression hands
     out, so most players will never meet maze 23 — the tour is how you meet all
     thirty, one short self-contained run at a time. **Do not "improve" one of
     them with a twist**: the chapter's value is that it is the same game thirty
     times, so the BOARD is the only variable. `test-cosmetics.ts` asserts it
     field-for-field.
  2. **The six BONUS mazes are excluded** (indices 30-35, `BONUS_MAZE_START`). A
     bonus board is a wide-open one-enemy point farm designed as a reward
     between classic stages; a whole challenge level of one is a level with
     nothing in it.
  3. **EVERY LEVEL FORCES A THEME, OWNED OR NOT** — `themeId` on
     `ChallengeLevel`, `THEME_CYCLE[idx % 6]` with no hand-typed exception, so
     across the thirty tour levels each of the shop's six themes appears exactly
     five times. That is the tour's second job: a player who bought one theme
     has never seen the other five. `buildLevel(mazeIdx, forcedTheme?)` applies
     it. **The board re-themes for free and the ATMOSPHERE does not** — the
     board is rebuilt per level, while sky/fog/backdrop/lights are mutated in
     place by `rig.applySceneTheme`, so `Game.sceneThemeId` tracks what the
     scene currently WEARS (not what is equipped) and `restoreEquippedTheme()`
     puts it back in `showMenu()`. Without that, one Night City challenge leaves
     the menu sitting under a black sky, which reads as the shop having been
     changed behind the player's back.
  4. **Levels 31-40 are THE TWISTS**: IDEA-013's eight, byte-for-byte, plus two
     new. The eight are what every challenge score already on the board was set
     on and what the server prices a submission against, so they keep their
     names, mazes and dials; the test pins them by NAME. The two new ones go in
     the only directions the original eight never used — **L39 "Dream Walk" is
     the only level below classic pace (0.7x) and the only fright window LONGER
     than classic's (12s)**, and L40 "Last Dog Standing" is the new ceiling
     (2.2x, five enemies, a 1.5s fright) on maze 29, the tour's last board.
     With three dials and eight levels already spent on "faster, and more of
     them", turning one the other way is the honest way to add a ninth.
  5. **NO POWER-UPS, IN EITHER CHAPTER** — unchanged. `maybeSpawnPowerup`
     refuses outside classic and `plausibility.ts` rejects a challenge run
     reporting one. The dial a future twist would turn is a power-up GRANTED by
     the level, never one lying on the floor.
  6. **`CHALLENGE_LEVELS` IS FORTY LITERAL ENTRIES BECAUSE THE SERVER PARSES
     THIS FILE AS TEXT.** `sync-game-constants.ts` cannot import across the
     frontend's bundler moduleResolution boundary, so it regexes
     `mazeIdx: N` + `modifiers: { ... }` out of the source. A generated array
     regexes to nothing, the catalog ships zero challenge levels, and every
     honest challenge run starts failing validation. Its count guard used to be
     the literal `!== 8` — i.e. the one check protecting the parse was a hand-
     copy of the thing it checked; it now counts `name:` in the sliced array and
     asserts the two agree, whatever the number is. **Changing this file still
     means `npm run sync` in `server/`.**
  7. **GOING PAST 8 LEVELS IS A MIGRATION, AND TWO COLUMNS BOUND IT** —
     `users.challenge_progress` (CHECK 0..8) and, the dangerous one,
     `game_sessions.challenge_idx` (CHECK 0..7), which is checked when a run
     STARTS: without it, tapping Play on stone 9 fails at `beginRunSession` with
     the error nowhere near the level map that produced the index.
     `010_challenge_levels_40.sql` widens both, dropping the old CHECKs by
     LOOKUP (005's reasoning) while deliberately sparing the NAMED
     `challenge_idx_matches_mode`, which mentions the same column and says
     something else entirely. It also **resets every account's
     `challenge_progress` to 0** (Nuno's call): the stored number means "levels
     of the ladder cleared" and the ladder was rebuilt underneath it, so leaving
     it would relabel eight hard-won twist clears as eight easy tour ones.
  **THE LEVEL MAP GREW A CHAPTER RAIL, AND ONE OLD BUG ONLY 40 STONES COULD
  FIND.** `CHALLENGE_CHAPTERS` (in `journey.ts`, DERIVED from
  `TOUR_LEVEL_COUNT` so a new maze cannot leave a stone with no chapter) is six
  tour stages of five — matching classic's own `MAPS_PER_STAGE`, so "stage 4"
  means the same five mazes in both modes — plus one twist chapter of ten.
  Four things:
  - **A LOCKED STONE IS SELECTABLE** (v2, Nuno). `selectNode` used to
    early-return on one, so for a new player thirty-nine of the forty levels
    were padlocks with nothing behind them — on the screen whose whole job is
    now showing what the game contains. Tapping one fills the panel with its
    name, blurb, theme and twists; only `playSelected` still refuses. It is
    therefore NOT `aria-disabled` (it is a control that does something) and NOT
    `tabindex="-1"`; what it cannot do is said on the disabled Play button,
    which reads **"Clear stone N first"** — unlocking is strictly sequential, so
    `progress + 1` is the one fact a disabled "Play stone 27" leaves the player
    to work out for themselves.
  - **The rail SCROLLS, it never SELECTS.** Selection arms the Play button, and
    a chip that did both would let a player tap "jump to stage 4" then "Play
    stone 16" without ever having looked at stone 16. Looking ahead at a locked
    chapter is exactly what the screen is for, so a locked chip is dimmed by
    PAINT and still clickable.
  - **A STONE'S FACE IS CENTRED BY A MEASURED `dy`, NEVER BY
    `dominant-baseline`** (v2, Nuno: the padlocks are not in the middle of their
    dots). `dominant-baseline="middle"` offsets by half the X-HEIGHT, a Latin
    typography notion an ICON font has no opinion about. Baloo 2's digits landed
    within a third of a pixel of centre that way, so the numbers looked right and
    the construction looked correct — while the padlock, whose ink spans nearly
    the whole em box, sat ~4px high on a 40px stone. `scripts/_scratch-glyph-center.ts`
    draws each glyph into a 2D canvas and scans the alpha channel for its real
    ink box: the padlock runs -0.985em to -0.055em off the baseline (so
    `dy="0.52em"`) and the digits -0.605em to +0.005em (`dy="0.3025em"`). In EM
    so it tracks font-size — a two-digit stone already renders smaller. That
    script also carries its own cautionary tale: `parseFloat("700 200px ...")`
    returns the WEIGHT, and the first run reported a full-em glyph as 0.27em
    with four decimal places of confidence.
  - **A chip click must NOT call `render()`.** `render()` ends by scrolling the
    SELECTED node into view, so re-rendering scrolls the trail straight back and
    the jump looks like a dead button. Only the lit chip is written to the DOM.
  - **`.map-page` had to become `flex:0 0 auto` on desktop.** It was
    `flex:1 1 auto` inside a fixed-height `#levelMap`, i.e. exactly one viewport
    tall while the trail overflowed it — and a sticky element cannot leave its
    containing block, so past the first screen the sticky header AND the sticky
    side panel both scrolled away, leaving a bare trail with no back button and
    no Play. At 8 stones the trail was ~700px and the page barely scrolled, so
    nothing ever tested it; at 40 it is ~4 000px.
  - **The side panel's sticky offset is MEASURED, not a literal.** It was `72px`
    — the height of a one-row header — and the rail's second row slid the
    panel's own title under it. `levelMap.ts` publishes the header's measured
    height as `--map-header-h` after every render; the header also grows when
    the title wraps.
  Node y positions are one precomputed TABLE (`NODE_Y`), not
  `height - idx * spacing`, because the chapter gaps make the spacing
  non-uniform and three readers (node, trail path, banner) must not each answer
  "how many boundaries are below me" for themselves. `scripts/_scratch-levelmap-check.ts`
  measures the rail, stones and panel at 390x844 and 1280x800;
  `scripts/_scratch-challenge-theme.ts` unlocks the ladder straight in the dev
  DB and photographs a forced-theme run — **it carries no canvas colour probe on
  purpose**: the renderer runs without `preserveDrawingBuffer`, so reading a
  pixel out of band returns a cleared buffer and every such comparison is two
  blacks, which is how the first version confidently reported that a working
  feature did not work.
- **Render layer** (`src/render/*`): `scene.ts`, `board.ts`, `characters.ts`,
  `effects.ts`, plus `toon.ts` — the shared 3-step cel ramp.
- **The whole scene is CEL-SHADED** (IDEA-024 v2): every lit surface is a
  `MeshToonMaterial` on the one gradient from `src/render/toon.ts`, and the
  renderer runs with `NoToneMapping` — a filmic curve re-compresses the ramp's
  bands and undoes the point of it. Build materials with `toon({...})`, never
  `new THREE.MeshStandardMaterial`; `roughness`/`metalness` do not exist on a
  toon material. The eye glint is the one deliberate exception: it is
  `MeshBasicMaterial` (unlit), because a toon ramp quantises a highlight into
  the same band as everything else facing the light and it stops reading as a
  catchlight.
- **The character editor knows about it**: `isEditableMaterial` accepts every
  model its new `shading` dropdown can produce (toon/standard/phong/lambert/
  basic), and controls for channels a given model lacks — `roughness`,
  `emissive` — are omitted rather than shown wired to nothing (IDEA-041's rule).
- **THE BEAGLE IS A REFERENCE REBUILD** (IDEA-047, branch `rework-beagle-character`):
  `makeBeagle()` is built over `src/render/beagleSculpt.ts` — station-swept solids
  (`taperedSweepGeometry`), revolved profiles (`latheFromProfile`) and
  `splitCoatGroups`, which cuts the tricolor coat into PER-TRIANGLE MATERIAL GROUPS
  on the shared tan/black/white toon materials, so `applyBeagleSkin` keeps
  recolouring the whole dog in place. A triangle that straddles a region edge
  is SPLIT along the region's true curve (band planes exact, blob/capsule
  fields bisected), so the seams are clean lines, not zigzags along whatever
  triangle edges the sweep had — the first pass's "spiky" markings. The numbers in the data tables above
  `makeBeagle` were measured off the reference image in head-units by the
  img2threejs pipeline and locked by its proportion gates — the whole evidence
  trail (reference, spec, per-pass renders, review history, `state.json`) lives in
  `.img2threejs/`; re-run that pipeline rather than eyeballing the tables. The
  pipeline's generated factory stays in `src/render/rework/` (never imported by
  production) with `/preview-rework/` + `scripts/shoot-rework.ts` as its harness;
  `/preview/` still renders the real `makeBeagle`. The editor/rewriter tests use
  `makeBeagle`'s source as their corpus — they now reference neck/tailTilt/nose/
  muzzle/browLInner (the loop-built refusal fixture); change the builder and re-check them.
- **`preview/index.html`** — a dev-only page at `/preview/` (`npm run dev`) that
  renders the real `makeBeagle()` with orbit controls, six preset camera angles
  (`?view=`) and part isolation (`?solo=`). Not a rollup input, so it never
  ships (same construction as `/editor/`).
- **THE FLEA IS THE SECOND img2threejs REBUILD** (IDEA-053): a fifth enemy skin,
  `makeFlea()` in `characters.ts`. It follows IDEA-047's split exactly — the
  pipeline's generated factory sits unused in `src/render/rework/`, and the
  SHIPPED mesh is hand-authored from the numbers the pipeline locked (proportion
  base **HD = 0.32**, the head diameter; every dimension derives from it). The
  whole evidence trail is `.img2threejs/flea/` — **a per-subject workspace, so a
  new run never overwrites the beagle's**; do the same for the next one.
  Four rules are load-bearing:
  1. **The segment bands and the jumping hind leg ARE the identity** (ranks 1
     and 2 of the reference read). The game already ships a beetle and a
     ladybug; a flea that loses either joins that cluster, which is the spec's
     own #1 recorded risk. It was hit twice — the first stance read as a beetle
     in the comparison sheet, and the first two hind legs read as a rudder and
     then a twig.
  2. **`creaseMat` is deliberately NOT in `accentMats`.** It started on the
     shared dark accent, which does follow the frightened recolour — so
     frightened painted body and creases the same blue and the banding vanished
     exactly when the player is chasing it. This is `GhostUserData`'s documented
     small-accent-vs-large-accent rule applied correctly: the limbs, antennae
     and belly are a large share of the silhouette and DO recolour; six
     hairlines do not.
  3. **A map-stripped clay render is worth capturing** (`/preview-rework/?flat=1`).
     It is what found rule 2 — in normal colour the model looked finished.
  4. **The reference is a watermarked stock image.** No pixel of it is used as
     colour or PBR evidence, and projection was rejected partly for that reason.
- **THE CRAB IS THE THIRD img2threejs REBUILD** (IDEA-054): a sixth enemy skin,
  `makeCrab()` in `characters.ts`. Same split as IDEA-047 and IDEA-053 — the
  generated factory sits unused in `src/render/rework/createCrabModel.ts` and the
  SHIPPED mesh is hand-authored from the numbers the pipeline locked. Evidence in
  `.img2threejs/crab/`. **The proportion base is CW = 0.56, the CARAPACE WIDTH,
  not a head diameter**: a crab's head is fused into its carapace, so a "head
  height" would be an invented boundary and every ratio would inherit it. Four
  rules are load-bearing:
  1. **BEING THE WIDEST IS THE IDENTITY.** 0.896 wide × 0.726 tall — the only
     enemy wider than it is tall, past the ladybug's 0.849. Every other skin is
     a bug of roughly one silhouette; a tall crab joins that cluster and the skin
     has no reason to exist.
  2. **The pincer gap is rank 1, and it is sized from READABILITY, not from the
     reference.** Scaled honestly from the measured ~32° it closed into a solid
     gold wedge at review size. It also failed twice on AIM: pointed forward the
     upper finger hid the lower one and the gap vanished into its own
     foreshortening; swung purely inward each claw read as a flat flipper.
     Down-and-inward from a chunky palm is what opens it to the camera.
  3. **A surface patch aimed straight at the viewer reads as a STICKER.** The
     face panel only stopped looking stuck on when its pole was tilted
     down-and-forward AND the patch was cut wide enough to reach the silhouette,
     so its boundary is a LINE across the shell rather than a closed oval inside
     it. Same construction as the ladybug's shell decals and the flea's bands:
     share the shell's own centre, scale and position, vary only `factor`.
  4. **`creaseDark`, `browDark` and `apronCream` are OUT of `accentMats`** —
     IDEA-053's rule applied up front rather than rediscovered.
  5. **THE TEAM COLOUR REACHES THE CARAPACE DOME AND NOTHING ELSE** (v2, Nuno's
     note). The face panel and the whole chela shipped GOLD — a measured
     #FFC756 lower face and a #F7BE55 claw horn, each a full value step lighter
     than the part carrying it. Both are now `CRAB_LIMB`, so the model is one
     team-coloured shell over one red body, and `accentMats` collapsed from
     `[limbMat, faceMat, clawMat]` to `[limbMat]`. Two reasons it is better here
     than in the reference, and both are about this game rather than about
     crabs: the gold sat within a few percent of the **amber team hue**
     (`0xe8a23d`), so on one team of five the face panel and the dome closed
     into a single mass and the crab lost its two-tone entirely; and the pincer
     gap is NEGATIVE SPACE, so it reads on its hole rather than on the horn
     being lighter than the arm — nothing that carries identity was being paid
     for by the gold. The carapace LIP earns its keep here, not less: it is the
     one geometric event marking where the team colour stops.
     `scripts/_scratch-crab-review.ts` is the sheet — play camera, frightened,
     clay and all five hues, which is the only instrument that could have caught
     the amber collision.
- **A REVIEW CAMERA MISMATCH REPORTS AS A MODEL DEFECT.** `/preview-rework/` now
  takes **`?fov=`** because of it. img2threejs's Tier 1 compares the render
  against the reference image, and these references are product renders on a long
  lens; capturing at the viewer's comfortable 32° default inflates the
  near-camera limbs. Measured on the crab: at 32° the gate reported a 0.584
  scale error and a 0.068 aspect error, and the model measured 1.126 wide:tall
  against the reference's 1.231 — i.e. it read as TALLER. Near-orthographic the
  same model measures **1.403**, wider than the reference, the opposite of what
  the gate said. At `fov=12` with a matched distance both deltas pass (0.0083 /
  0.0199). `shoot-rework.ts` takes `FOV`, `DIST` and `EL` for exactly this.
  Silhouette IoU still fails (0.599) and is deliberately NOT chased — that is
  the skill's own documented photo-vs-procedural miscalibration, and the Divine
  Eye's objectness signal (0.648) downgrades its own reject to `probe`.
- **THE MOSQUITO IS THE FOURTH img2threejs REBUILD** (IDEA-055): a seventh enemy
  skin, `makeMosquito()` in `characters.ts`, following the same split — the
  generated factory sits unused in `src/render/rework/` and the SHIPPED mesh is
  hand-authored from the numbers the pipeline locked. Evidence in
  `.img2threejs/mosquito/`. Five rules are load-bearing:
  1. **Proportion base HD = 0.27, deliberately NOT the 0.32 the bee and flea
     use.** A mosquito is a LONGER animal at the same envelope: at 0.32 it
     measured 0.90 along Z, past the beetle's 0.872 which is the cast's ceiling.
     The head is 16% smaller than the bee's, which is what the reference shows.
  2. **The whole model is built against the BEE.** The bee already has
     translucent veined wings, antennae, a three-mass diagonal body, six legs and
     a hover. Colour cannot separate them — both take the team colour and both
     are recoloured again when frightened — so SILHOUETTE carries the entire
     identity. The measured separators: ONE wing pair not two; 1.90 HD wings vs
     the bee's 0.85 HD forewing; abdomen aspect 0.51 and POINTED vs its rounded
     1.15 HD; a 0.73 HD proboscis where the bee has nothing; legs splayed wider
     than the body vs its tucked four. **Verify by rendering both at the SAME
     team colour and the SAME play-camera angle**, never by assertion.
  3. **The abdomen is a LATHE of a measured 41-point profile, not a capsule**,
     and its creases are per-triangle MATERIAL GROUPS on that lathe assigned by
     RING index. Classifying by a triangle's own mean height instead makes the
     two halves of every quad land on opposite sides of a boundary, and the band
     edge zigzags around the circumference — IDEA-047's "spiky markings" defect
     in a new place. `creaseMat` is out of `accentMats`, per IDEA-053's rule 2.
  4. **Aim long parts with `setFromUnitVectors`, not hand-written Euler angles.**
     The abdomen and the proboscis were both authored with `rotation.x` and both
     came out inverted — the abdomen forward-down, tucked under the model's own
     head. What exposed it was the measured ENVELOPE (0.67 long against a solved
     0.842), not the render.
  5. **Tune against the PLAY camera, which sits at 59° elevation**
     (`scene.ts` BASE_POS), not a turntable's default 12°. The reference's 60°
     abdomen droop points almost straight down that view axis and foreshortens to
     a stub; 44° trails it visibly. The map-stripped clay render is what showed
     this — in colour it looked finished.
- **THE SUSHI PAIR IS THE FIFTH AND SIXTH img2threejs REBUILD** (IDEA-056 maki,
  IDEA-057 nigiri): an eighth and ninth enemy skin, `makeSushiMaki()` and
  `makeNigiri()` in `characters.ts`, over shared geometry machinery in
  **`src/render/sushiSculpt.ts`** (squircles, band clipping, banded tubes, the
  smooth `squirclePillow`). Same split as every rebuild before them — the
  generated factories sit unused in `src/render/rework/` and the shipped meshes
  are hand-authored from the numbers the runs locked. Evidence in
  `.img2threejs/maki/` and `.img2threejs/nigiri/`.
  **They exist because every other enemy is a BUG. These are FOOD, and they
  STAND UP** — the two things the cast could not say. Six rules are load-bearing:
  1. **They ship as a PAIR and each is built against the other as its main
     risk.** Both take the team colour and both are recoloured again when
     frightened, so colour cannot separate them (IDEA-055's bee rule). Seven
     measured silhouette separators do — round drum vs squared block, dark
     dominant mass vs pale, a saturated plug face vs a smooth panel, big
     brow-topped eyes with a cyan iris ring vs small upright ones under a gold
     lid line (0.139 across against 0.072 — the nigiri's were half-lidded until
     IDEA-057 v2 opened them, so the separator is SIZE and furniture now, not
     how far each is closed), an open mouth cavity vs a closed curve,
     boots vs bare feet, and a tail fan where the maki has nothing above its
     crown. Plus an eighth that is not a shape: **they recolour in OPPOSITE
     places** — the maki's `bodyMat` is its WRAPPER, the nigiri's is its
     TOPPING, so one keeps a pale centre and the other a pale body. **Verify by
     rendering BOTH at the same team colour and the same play-camera angle**
     (`scripts/_scratch-sushi-pair.ts`), never by assertion.
  2. **Neither has a head, so neither uses one.** ND = the nori disc diameter
     (0.62); RW = the rice block WIDTH (0.56). The crab's carapace-width
     reasoning: an invented boundary is inherited by every ratio under it.
  3. **The maki's −18° pitch is a PLAY-CAMERA decision and it must live on an
     INNER group.** `applyGhostState` assigns `mesh.rotation.x` on the ROOT
     every time the state changes, so a pitch authored there is erased the first
     time the beagle eats a bone. It exists because a vertical cut face projects
     at cos(59) = 0.515 from the game camera, and that face is identity rank 1.
  4. **`ExtrudeGeometry`'s `bevelSize` grows OUTWARD.** A block extruded from a
     0.560 × 0.403 footprint with `bevelSize: 0.045` measures 0.650 × 0.493, and
     everything positioned against that footprint ends up INSIDE it — the nigiri
     lost its nori belt, its whole grain skirt and its entire face at once, three
     systems, one cause, none of them wrong in itself. **Measuring the parts is
     what finds this**; the render shows a perfectly plausible plain block. An
     extrusion is also non-indexed, so its bevel steps cannot be smoothed and the
     toon ramp quantises them into rectangular patches. Use `squirclePillow()`.
  5. **A surface band is cut by RING index, never by a triangle's own mean**
     (IDEA-055 rule 3), and **the valleys of a k-lobe oscillation are at
     (2n−1)/2k, not k/n** — testing for the peaks gave the prawn one pale stripe
     instead of six, which reads as SALMON, the one thing the topping must not be.
  6. **A cap that DRAPES cannot end in a flat rim.** The nigiri's prawn is wider
     than its rice block on purpose, so a clean half-tube's horizontally-cut
     open edge overhangs with nothing under it — a hard seam all round and
     daylight at the shoulder. Lowering it cannot help: the block is a pillow,
     narrower at every height above its mid-point, so it is never as wide as the
     cap. `CAP_WRAP` carries the arc past the horizontal so the rim curls DOWN
     onto the flank, and it is bounded at BOTH ends — too little brings the
     machined edge back, too much (0.38) drapes to the belt and buries the rice
     skirt, costing the two-mass stack from every side view.
  7. **Small fixed accents stay out of `accentMats`** — the maki's nori lap
     laminations, the nigiri's belt and pale bands. The nigiri's `accentMats` is
     EMPTY on purpose: the rice block is the largest mass and the obvious
     candidate, but block and cap going blue together collapses the two-mass
     stack exactly while the player is chasing it.
  8. **EVERY ENEMY'S EYE IS THE SAME STACK**: a cream sclera BALL, a dark pupil
     CAP and a catchlight on a pivot inside it, with the flattening carried by
     the shared parent GROUP so the caps stay flush however flat the lens is.
     Deviating is not a style choice, it is a STATE bug: `applyEnemyLook`
     whitens `pupM` for the frightened look, which reads as a blank stare only
     because there is a sclera behind it. The nigiri first shipped its eye as a
     single dark cap in `pupM` with a lid line on top — so frightened turned the
     WHOLE eye cream-on-cream against a cream rice block and the face lost its
     eyes at exactly the moment the player is chasing it (IDEA-053 rule 2 in a
     new place). On a PALE body the sclera also needs a boundary of its own: the
     nigiri's gold lid is a hooded RIM (the crab's collar) rather than a line, so
     the eye stays outlined in all three states. Keep it narrow and near-
     VERTICAL — swept wide about an up-and-forward axis it projects onto the
     flattened lens's front face and the eye reads as a brass button.
- **THE PIZZA SLICE IS THE SEVENTH img2threejs REBUILD** (IDEA-058): a tenth
  enemy skin, `makePizza()` in `characters.ts`, over new geometry machinery in
  **`src/render/pizzaSculpt.ts`**. Same split as every rebuild before it — the
  generated factory sits unused in `src/render/rework/createPizzaModel.ts` and
  the shipped mesh is hand-authored from the numbers the run locked. Evidence in
  `.img2threejs/pizza/`.
  **It exists because every other enemy is an animate OBJECT. This one is a
  PERSON**: it has HAIR (the crust, worn as a pompadour), it WEARS things
  (white mitts and boots — nothing else in the cast wears anything), and it
  WALKS. Proportion base **SH = the SLICE HEIGHT** (0.72), for the crab's
  reason a third time: the face is painted on the body, so there is no head to
  measure and a head-unit would be an invention every ratio inherited.
  Six rules are load-bearing:
  1. **BEING VERTICAL IS THE IDENTITY.** 0.611 wide x 0.873 tall — the tallest
     in the cast and the only one clearly taller than wide. It is also the only
     TRIANGLE. Every number that costs width was cut against that, twice: the
     crust's spiral termini MEASURED 0.330 on the first build (wider than the
     gloves, and the widest thing on the model), so `crustSweepPoints` gained a
     `tuck` that pulls the ends inward as they curl forward.
  2. **ONE OUTLINE, THREE PARTS.** `sectorOutline()` produces the wedge solid,
     the cheese plate on it, and the arc the crust is swept along — so the
     dough rim is uniform BY CONSTRUCTION. The plate is the same call with
     `edgeInset` set, because an inset sector is a sector whose apex has slid up
     the axis by `inset / sin(alpha)`. Anything scattered on the plate is placed
     in `(u, y)` where u is a FRACTION of `sectorHalfWidth` at that height, so a
     topping cannot clip through the rim whatever the sector angle becomes.
  3. **RUBBER HOSE MEANS NO ELBOWS AND NO KNEES**, and it is a measurement, not
     a simplification: the reference's arm ink-run is the same width at two
     scanlines 100 px apart across a large change of direction, with no taper
     and no joint bulge. Every limb is ONE swept tube of constant radius and the
     bend lives in its own curve — which also makes the flea's and the crab's
     joint-gap defect unrepresentable rather than merely absent.
  4. **A HOLE IS ONLY A HOLE IF THERE IS DARK BEHIND IT.** The mouth is a real
     aperture cut out of the plate's `Shape`, and its dark floor was first
     authored at `T/2 - 0.008` — INSIDE the wedge — so the wedge's own tan front
     face showed through instead and the grin rendered as a pout. IDEA-057's
     buried nori belt in a new place: correctly built, correctly coloured, and
     behind another surface. The render says nothing; the z arithmetic does.
  5. **A torus ARC is not symmetric, so its mirror is a REFLECTION**
     (`pi - a0 - A`), never a rotation by pi. Mirrored the wrong way the model
     had one brow and one stray tick — and once both were visible, the SIGN of
     their tilt was the whole difference between friendly and a scowl.
  6. **bodyMat is the CHEESE PLATE — the FACE.** A third distinct arrangement
     after the maki (wrapper) and the nigiri (topping). `accentMats` is
     `[crustMat]`, shared by the quiff and both boots, so the frightened blue
     lands at the top AND the bottom of the figure. The crust's normal colour is
     a baked BROWN-orange deliberately outside all five team hues — the amber
     team is a warm orange and a crust in that family would collapse the
     bread/cheese two-tone on exactly one team. The pepperoni is deeper than the
     reference's salmon for the same reason (salmon is invisible on the rose
     team's plate) AND raised, so it survives on geometry where it loses on hue.
     The gloves stay white and out of everything.
  The **-18 degree body pitch** is a play-camera decision on an INNER group, for
  IDEA-056 rule 3's reason. Separation from the other two food skins is
  RENDERED, not asserted (`scripts/_scratch-food-trio.ts`).
- **THE HAMBURGER IS THE EIGHTH img2threejs REBUILD** (IDEA-059): an eleventh
  enemy skin, `makeBurger()` in `characters.ts`, over new geometry machinery in
  **`src/render/burgerSculpt.ts`**. Same split as every rebuild before it, with
  one difference recorded below. Evidence in `.img2threejs/burger/`.
  **It exists because ten enemies have a body that is ONE mass wearing marks;
  this one's body is a STACK** — six contrasting bands piled up. Proportion base
  **BH = the STACK HEIGHT** (0.62), the crown of the top bun to the underside of
  the bottom one: no head for the fourth subject running, because the face is
  painted on band 1 of the body. Seven rules are load-bearing.
  1. **A BAND MUST BE A LEDGE IN THE SILHOUETTE, NOT A STRIPE ON IT.** This
     model's one real defect, and it was found twice by two instruments before
     it was fixed in the right place. In colour it came back a red EGG with a
     stripe round its middle; retuned, the **CLAY render** (`?flat=1`) showed
     the same thing again — a ball with a ruffled skirt, because the entire
     six-band identity was being carried by PAINT and the only geometric events
     on the body were the frill and the boots. The fix is that the patty ships
     WIDER than the top bun, the bottom bun AND the frill's own troughs (0.372
     against 0.330 / 0.275 / 0.368), inverting the reference, so the profile is
     a real step sequence: narrow cap, ruffled waist, wide dark ledge, narrow
     base.
  2. **THE REFERENCE'S OWN DIVISION DOES NOT SURVIVE THIS RENDERER.** Measured
     0.632 bun / 0.218 garnish / 0.149 base; shipped 0.53 / 0.30 / 0.17. The
     drawing gets away with a bun that is 63% of the stack because its bun is
     ORANGE against four loud garnish colours and every region carries an ink
     KEYLINE. Here `bodyMat` is the BREAD, so both bun masses take the same team
     hue, and this project has no outline pass at all — two same-coloured domes
     a fifth of the stack apart simply close into one form.
  3. **`bodyMat` IS THE BREAD — TWO DISJOINT MASSES.** A fourth distinct
     arrangement after the maki (its wrapper), the nigiri (its topping) and the
     pizza (its face plate): the first skin whose team colour appears in two
     separate places with fixed colour clamped between them. **`accentMats` is
     EMPTY on purpose** and it is the most load-bearing empty list in the file —
     the patty is the obvious addition, being the largest fixed mass, and adding
     it would turn bread AND meat blue together and collapse the stack to one
     blue lump exactly while the player is chasing it (IDEA-053 rule 2, applied
     to the biggest accent rather than to six hairlines).
  4. **THE CHEESE'S FOUR DRIPS ARE ONE MECHANISM.** A square laid on a circle
     overhangs at exactly four places by construction, so `squircleSlab` droops
     whatever sticks out past `supportRadius` (the patty's own radius) and the
     drips place themselves — the pizza's `sectorOutline` reasoning in a new
     place. **A squircle's diagonal radius is `halfWidth * 2^(0.5 - 1/n)`**, not
     `2^(1/n)`: at the first build's n = 2.4 that is a 6% bulge, i.e. very
     nearly a circle, and the whole mechanism was present and producing nothing.
     It ships at n = 6.
  5. **AT THE PLAY CAMERA THE STACK IS NOT WHAT A PLAYER SEES, AND THAT IS
     RECORDED RATHER THAN FOUGHT.** From 59 degrees of elevation the six bands
     are stacked along the one axis the camera foreshortens AND the top bun
     occludes what is under it, so the play read is a **sesame dome, a garnish
     ring, a face and a raised hand**. Every available fix was taken — the bun
     narrowed to 0.330, the patty widened past it, the cheese corners pushed
     past the frill's troughs, and the whole stack pitched back 15 degrees on an
     INNER group (IDEA-056 rule 3) — and together they roughly double what the
     band contributes from above. The rest is the camera. The full six bands are
     what the shop, the menu vignette and any lower angle show.
  6. **THE SESAME IS SIZED FOR THE JOB, NOT FOR THE REFERENCE** — 38 seeds at
     ~1.5x the measured 0.023 BH. The reference's bun reads as bread on its
     colour alone; this one's is a different hue on every team, so the seeds are
     the only mark on the model's largest mass that says "bread" on all five and
     on the frightened blue. `scatterOnBand`'s `crownBias` is an EXPONENT and
     must be **> 1** to crowd the crown; below 1 it crowds the base, which does
     not look like a bug, it looks like a bun with bald patches.
  7. **A LIMB BURIED IN A SOLID LOOKS EXACTLY LIKE A LIMB THAT WAS NEVER
     BUILT**, and this model hit that twice. First on the SIGN: `rotation.z`
     positive swings a part toward +x only when it hangs at **-y**, and the
     original raised arm pointed UP, so +0.46 on the +x shoulder folded the
     whole arm, hand and cuff inside the bun (the maki lost both of its arms the
     same way). Then on the HEIGHT: with both arms hung from the garnish line
     the hoses ran DOWN THROUGH the patty — the widest thing on the body — so
     each limb was buried for its whole length and only the mitt emerged
     underneath, reading as a white blob stuck to the side. Shoulders now hang
     from the patty's UNDERSIDE, where the arm runs past the much narrower
     bottom bun and clears the silhouette.
  8. **THE FACE'S FAITHFUL MEASUREMENTS WERE THE THING THAT MADE IT CREEPY**
     (v2, Nuno's note). Three of them, all correct off the reference and all
     wrong once lit in three dimensions: a sclera taller than it is wide (the
     shape a *glare* is drawn with), a small pupil marooned mid-white with clear
     space all the way round it (the doll stare), and the reference's jagged
     four-sided catchlight (which reads as a flash of light rather than as a
     highlight). It ships round-sclera, big-pupil-resting-low, two soft round
     catchlights, thinner and higher brows. **Generalisable, and the most
     useful thing this run produced:** a flat drawing carries its own
     compensations — an ink keyline round every region, a stylised highlight
     that reads as shorthand — and a toon mesh has none of them, so measuring
     the reference correctly is necessary and not sufficient. Only the render
     can tell you a right measurement became the wrong shape.
  9. **THE MOUTH IS AN OPEN GRIN AND IT IS BUILT INSIDE-OUT FROM THE PIZZA'S**
     (v3, Nuno's note: "make one mouth like the pizza slice"). A thin dark curve
     on a big round face is a MARK, and a mark has no depth — it sits on the bun
     the way a drawn-on smile sits on a balloon. But the pizza's construction
     does not port: its face is a flat plate, so its mouth is a real HOLE with a
     dark floor behind it, and this face is a revolved DOME with nothing to cut
     and nothing flat behind it. So the mouth is four thin layers lying ON the
     surface — cavity, tongue, tooth strip, ink lip — every one generated from
     the SAME aperture by `smilePatch` at its own `vFrom`/`vTo` slice, which is
     what stops them disagreeing about where the mouth is. Two things are
     load-bearing: it is a **grid**, not a triangulated outline (`ShapeGeometry`
     only emits contour vertices, so a 37-degree-wide patch would be spanned by
     triangles that cut across the curvature and sink into the bun); and **dark
     has to stay the dominant thing inside it** or it stops reading as open,
     which is the lesson the pizza's tooth band learned first. Aspect 3.2:1
     against the pizza's 1.8:1 — a mouth belongs to the face it is on, and this
     one is a wide dome.
     **A fifth layer was built and CUT: an ink lip round the whole aperture.**
     The argument for it was that this bun takes the TEAM COLOUR and a dark
     patch on a violet dome reads as a sticker rather than as an opening — which
     is sound, and which the render does not support. On all five hues and on
     the frightened blue the cavity is already the darkest thing on the face by
     a distance, the tooth strip gives the top lip a hard edge of its own and
     the tongue puts a second value step inside, so the mouth reads as an
     opening on its own contents. What the lip added was WEIGHT: 0.0062 of ink
     round an aperture only 0.066 tall is a tenth of the mouth's height spent
     outlining it, and it closed the grin up. Nuno called it; worth keeping as a
     record because the reasoning was reasonable and only the render could
     settle it.
  10. **A SURFACE NORMAL IS NOT A RADIUS, AND GETTING ITS SIGN WRONG IS
     INVISIBLE.** `bandNormal` in `burgerSculpt.ts` shipped with `(dy, -dr)`
     where the outward normal is `(-dy, dr)`. On a dome the profile expands as
     it descends, so the true normal tilts UP off horizontal — and with the sign
     flipped, everything "lifted off the surface" was pushed INTO it instead.
     Two systems, one character: the entire mouth interior rendered behind the
     bun (an ink lip drawing a perfect grin around a bun-coloured hole), and all
     38 sesame seeds were sunk 0.005 into the dome and oriented upside down,
     which no render says at all. `scatterOnBand` had its own inline copy of the
     same arithmetic, carrying the same error — it now calls `bandNormal`.
     Third appearance of the family after IDEA-057's nori belt and IDEA-058's
     mouth floor: a part built right, coloured right, placed right, and behind
     another surface.
  11. **A PATCH GRID'S OBVIOUS WINDING FACES INWARD.** Columns running left to
     right and rows running DOWN cross to an INWARD normal, so `a, b, b+1` gives
     a back-face-culled patch that renders as nothing. It looks exactly like the
     sign bug above and is a different cause, which is why both are written
     down: the mouth was invisible for two separate reasons at once.
  12. **A POSE THAT SURVIVES ONE FRAME IS NOT A POSE THAT SURVIVES A LOOP.**
     The reference's raised two-finger V was built, reviewed, rendered and cut
     (v2). It was the only set of fingers in the enemy cast and it read
     beautifully standing still — but this character spends the whole game
     WALKING at the player, and a gesture held rigidly through a stride reads as
     a stuck arm rather than as a greeting. It also forced the two arms to be
     non-mirrors, which is a thing a walk cycle fights. Both arms now hang and
     counter-swing.
  Two fixed colours are pushed off their sampled values because `bodyMat` is a
  team hue: the **patty** to a deep brown (a red-brown patty vanishes into the
  rose team's bun) and the **onion** to a deeper purple, for the same reason.
  The lettuce/LEAF-team collision is bounded and on the record rather than
  solved. Separation from the other three food skins is RENDERED, not asserted
  (`scripts/_scratch-food-quartet.ts`), and the whole review set — play camera,
  frightened, clay and all five team hues — is one sheet from
  `scripts/_scratch-burger-review.ts`.
- **THE GENERATOR IS FAIL-CLOSED AND THIS SUBJECT LEGITIMATELY BLOCKS IT.**
  IDEA-059 is the first run where `generate_threejs_factory.py` wrote no
  factory, so `src/render/rework/` has no `createBurgerModel.ts` and the BLOCKED
  artifact is kept at `.img2threejs/burger/generation-BLOCKED.json` instead. The
  cause is structural, not a shallow spec: `--strict-quality` requires a
  roughness/normal/bump/displacement response from some material, while the
  schema's own evidence-bearing **`textureless`** escape — which this subject
  qualifies for, and which every material here declares with the measurements
  (66.18% of the reference is a single flat value) — FORBIDS exactly those
  fields. The two gates are mutually exclusive for any textureless material, and
  `MeshToonMaterial` has no roughness channel to describe anyway. Writing one to
  clear the gate would put a number in the spec that nothing will ever read,
  which the escape's own docstring calls worse than a missing value. Recorded in
  the spec's `gateCalibration`, same category as IDEA-054's silhouette-IoU
  finding. It changes nothing about the shipped result: the generated factory
  has been unused since IDEA-047.
- **A REST POSE IS NOT AN ENVELOPE.** Every published number for these skins is
  a still, and the walk cycle is not the still: a stride swings a boot whose toe
  projects on +Z, and rotating that about X drops it BELOW its rest height, so
  the foot sinks into the maze floor for part of every step. The whole cast does
  it (ghost 0.035, pizza 0.029, crab 0.022, maki 0.014) and none of it is
  visible in any render. Worse, a swinging limb can make a model WIDER than it
  measures standing: the burger's raised hand is the furthest-out thing on it,
  and a symmetric wave took its animated width to 0.895 — past the crab's 0.861,
  which is the crab's own recorded identity claim, and past the mosquito's
  animated 0.861 too. The fix is worth reusing: **make the gesture ONE-SIDED**,
  swinging inward from the authored pose only, so the envelope is set by the
  rest pose and the motion can be almost twice as large for free.
  `scripts/_scratch-cast-animated.ts` measures sink and animated width across
  the cast; `scripts/_scratch-burger-ingame.ts` asserts a skin's whole game
  contract (all five team hues, the frightened/eaten/chase round trip, the pitch
  surviving both a state change and the walk, tile fit, rest floor, stride sink
  and animated width) — the preview harness calls `makeEnemy` directly and
  exercises none of that.
- **`Box3.setFromObject` OVER-REPORTS ANY CHILD WITH AN OFF-AXIS ROTATION.** It
  builds each mesh's box in LOCAL space and transforms its eight corners, so a
  disc of radius 0.300 turned 45 degrees about Y measures 0.424 across. The
  burger has two such children (the cheese, deliberately turned so its corners
  face the camera, and the under-frill) and between them they made
  `_scratch-enemy-cast.ts` report a 0.930-wide model whose real width is 0.842 —
  15%, and the difference between "wider than the crab" (the crab's own recorded
  identity claim) and comfortably inside the pack. **`scripts/_scratch-exact-cast.ts`
  measures the cast from VERTICES** and prints the box-based figure alongside
  with its inflation, which is how the whole table below is now known to be
  optimistic for six of the eleven skins.
- **A REVIEW-HARNESS MISMATCH REPORTS AS A MODEL DEFECT — AGAIN.** After
  `?fov=` (IDEA-054), `/preview-rework/` now also takes **`?bg=none`** and
  **`?shadow=0`**. `turntable_gate.py` separates model from background BY
  COLOUR and flood-fills any enclosed region as an interior HOLE; on the default
  warm stone it reported a 378 × 374 px hole in the dead centre of a solid maki
  — its own cream rice and its ground shadow. A dark backdrop and a saturated
  one both made the gate report `segmentationReliable: false` rather than guess,
  which is it behaving correctly and still telling you nothing. Rendering on
  TRANSPARENT and reading the mask from ALPHA is the answer, and **it needs both
  halves**: `scene.background = null` + `setClearAlpha(0)` + the PAGE's own CSS
  background cleared, AND `page.screenshot({ omitBackground: true })` in
  `shoot-rework.ts`. Missing the shooter half looks exactly like a pass.
- **`preview-rework/index.html`** grew a **`?model=`** switch (`beagle` ·
  `flea-gen`/`crab-gen`/`mosquito-gen`/`maki-gen` = the generated factories ·
  `flea`/`crab`/`mosquito`/`maki`/`nigiri`/`pizza`/`burger`/`beetle`/`bee`/
  `ladybug`/`ghost` = the REAL shipped builders),
  plus **`?state=frightened|eaten`**, **`?flat=1`**, **`?fov=`**, **`?bg=`**
  (a hex, or `none` for transparent) and **`?shadow=0`**.
  `scripts/shoot-rework.ts` takes `MODEL=<id>` and writes a non-beagle subject's
  turntable under `.img2threejs/<id>/renders/`; `TOON`, `FLAT`, `STATE`, `FOV`,
  `DIST`, `EL`, `BG` and `SHADOW` set the rest. `scripts/_scratch-enemy-cast.ts`
  measures the whole cast in one line — use it before guessing a size or
  triangle budget for a new skin, and `scripts/_scratch-sushi-probe.ts` /
  `scripts/_scratch-pizza-probe.ts` / `scripts/_scratch-burger-probe.ts` measure
  NAMED PARTS when something renders as nothing — or when the ENVELOPE is wrong
  and you need to know which part is doing it.
  **Use `scripts/_scratch-exact-cast.ts`, not `_scratch-enemy-cast.ts`, for any
  number you are going to act on** — see the `Box3` note above. The real
  VERTEX-measured numbers (tris / crown / width):
  ghost 8 256 / 0.660 / 0.610, flea 12 828 / 0.593 / 0.511,
  mosquito 13 648 / 0.758 / 0.729, nigiri 14 624 / 0.793 / 0.789,
  **pizza 15 748 / 0.831 / 0.594**, crab 16 676 / 0.683 / 0.861,
  bee 16 868 / 0.783 / 0.508, **burger 17 758 / 0.797 / 0.842**,
  maki 18 072 / 0.837 / 0.802, beetle 18 088 / 0.765 / 0.672,
  ladybug 20 624 / 0.608 / 0.807.
  **The pizza is the tallest and the only one clearly taller than it is wide**
  (0.72 wide-over-tall against a cast running 0.94-1.27); the crab is still the
  widest and the burger is second.
- **A limb capsule must be sized from its JOINT SPAN, never from a fraction of
  it.** `CapsuleGeometry`'s length argument is the CYLINDER only — the caps add
  `radius` on top. The flea's legs first passed 0.72/0.82/0.80 of each segment
  and left the round caps to cover the rest, which holds only while the radius
  is large relative to the segment. It is on the front and middle legs and is
  NOT on the HIND leg, which is twice as long and (at `girth` 0.72) thinner: the
  femur fell 0.0134 short of the knee and the tibia 0.0111 short of the ankle,
  so the jumping leg rendered in three visibly separated pieces. Segments now
  span `L` with half a radius of overlap, and a **knuckle ball sits at every
  knee and ankle** — overlap closes a gap along the limb's axis but not ACROSS a
  132° fold, where two tangent capsules leave an open wedge.
  `scripts/_scratch-flea-gaps.ts` proves all 12 joints are CONTAINED in a solid;
  it is a containment test on purpose, since a distance-to-nearest-vertex check
  cannot tell inside from outside and reports a joint ball's own radius as a gap.
  **The crab makes the defect unrepresentable instead of merely absent**: every
  segment is a CYLINDER spanning its joint exactly, with a knuckle ball AT each
  joint, so no radius/length arithmetic can reintroduce a gap.
  `scripts/_scratch-crab-gaps.ts` proves all **34** joints contained — and it
  was wrong twice first, in ways worth knowing because both produced CONFIDENT
  FALSE ALARMS on a sound model. (a) A cylinder's end cap is COPLANAR with its
  own joint, so a look-at-the-first-face-hit method reads 25 of 26 directions as
  escaping from a point sitting dead centre in a ball. (b) First-face cannot
  handle a UNION at all: a neighbouring solid's outer surface lying between the
  joint and its own ball's far side reads as "outside". Use a PARITY count over
  the union (+1 back face, −1 front face; inside when the total is positive).
  (c) And tilt the ray directions off-axis — a ray fired exactly along ±Y from a
  sphere's centre exits through the degenerate pole fan, where a ray-triangle
  test can be missed by every adjacent triangle at once.
- **THE 2D LAYER HAS A DESIGN SYSTEM** (IDEA-048, "Toon boards, not glass panels"):
  the tokens live in **`src/ui/tokens.css`** and every component in
  `src/style.css` is built from them. Read tokens.css before touching any
  interface CSS — it carries the palette, the geometry and the reasoning.
  Five rules are load-bearing:
  1. **Outline everything.** A 3px `--bc-outline` (`#1B1512`) around every 2D
     element. It ties the chrome to the toon meshes behind it AND guarantees
     contrast on sky, hedge and soil alike — a hairline white border is
     invisible on mid-green, which is what the HUD sits on half the time.
  2. **Depth is a thick BOTTOM BORDER, and pressing sinks into it.** No drop
     shadows and **no `backdrop-filter`** — a blur is a full-screen composite
     every frame on top of a live WebGL canvas, and it makes chrome read as OS
     furniture. Press removes the extra border and moves the face down by the
     same amount, so the box never changes size under a thumb.
  3. **Dim by PAINT, never by `opacity`.** Anything over the live 3D that goes
     translucent picks up the sky and turns blue-grey — the exact glass look
     this replaced. A locked shop card gets a darker fill, not 65% alpha.
  4. **Colour comes from the world.** Hedge, soil, biscuit, sky, beagle tan and
     the five enemy hues are already on screen in 3D; the UI uses those values.
     The five enemy hues are reserved for STATE (power-up chips), never chrome,
     and **amber marks the single next action on a screen** — two amber things
     means one is wrong.
  5. **Three fonts, one icon family — all SELF-HOSTED AND SUBSET.** Baloo 2
     (display) · Quicksand (body) · DM Mono (anything that ticks or lines up),
     plus Material Symbols Rounded, as five woff2 files in `src/ui/fonts/`
     (100 KiB total) declared in `tokens.css`. **Never add a Google Fonts
     `<link>`.** They shipped that way once and a blocked CDN request took the
     entire visual language down — system-fallback type, tofu on the level map,
     and every icon printing its own ligature name ("arrow_back Menu"). This is
     an offline-capable PWA whose textures and sounds are already generated
     rather than fetched; type was the last thing phoning out, on the boot path.
     **There are no emoji in the interface** — they were at the mercy of each
     platform's font and carried their own colour, so they could never join the
     ink-outline language. Go through **`src/ui/icons.ts`**: `ICON` names a
     ROLE, `icon()`/`iconHtml()` draw a chrome glyph, and `plate()`/`plateHtml()`
     draw a GAME OBJECT (coin/biscuit/bone/life/fruit/power-up) as a lit
     outlined square, because those are things you collect in the maze rather
     than bullet points. Three traps:
     - **Adding an icon means re-cutting the subset** (recipe in `tokens.css`).
       The font holds only the 46 names `ICON` lists; anything else renders as
       that word in plain text.
     - **Address glyphs by LIGATURE NAME, never by codepoint** — including
       inside SVG `<text>`, where ligatures do resolve. Subsetting does not
       preserve Material Symbols' private-use codepoints (`U+E668` survived the
       cut, `U+E899` did not), which is the opposite of what `levelMap.ts`
       originally assumed.
     - An icon element holds its ligature name as its TEXT, so writing
       `textContent` on a button containing one deletes the icon — pause, mute
       and the menu coin line each rewrite the inner `<i>` instead.
  **THE SIX SCREENS WERE REDESIGNED TOO** ("Redesigned Screens.dc.html", the
  companion file to the component system). What changed structurally, beyond
  paint:
  - **The menu carousel is GONE.** It existed because five buttons did not fit
    a 390px row; Play was promoted to its own full-width block and the four
    destinations became a fixed 4-up grid, which does fit. The rail, its
    arrows, its `@property` edge-fade mask and `src/ui/menuCarousel.ts` all
    went with it. Adding a FIFTH destination would bring the problem back —
    `test-menu-ui.ts` asserts every tile is on screen without scrolling.
  - **`.hud` is TWO COLUMNS**, not a three-way space-between. The chrome row
    lives inside the right column instead of being `position:fixed` at a
    measured offset that had to be re-tuned whenever anything above it changed
    height.
  - **`hud.setLevel` splits its label.** It is handed "Map 3" / "Bonus" / "C5",
    and the chip is an eyebrow plus a figure, so a leading "Map " becomes the
    eyebrow and anything else is shown whole. Prefixing blindly produced
    "MAP Bonus".
  - **Game over is a RESULT BOARD**: a stroked banner over a board carrying the
    score, maps cleared, coins earned and the gap to the personal best. The
    first three come from the telemetry the run already keeps for the server;
    the best arrives with the submit response and is filled in by
    `showBestLine` AFTER the board is up, so the panel never waits on a round
    trip. `showPanel(html, banner?)` grew the optional banner for it, and adds
    `center--dim` — a panel covers the run, so the scene behind it dims; a
    banner alone does not.
  - **Shop items have a `blurb`**, required on `BeagleSkin`, `EnemySkin` and
    `MazeTheme`. The price moved onto the action button to make room for it —
    the info bar used to say the name, the price, and then a button saying the
    price again. A new theme needs a blurb in `themes.ts` AND in
    `boardCodegen.ts`’s writer (the same hand-written-field trap the palette
    has; `test-board-surfaces` guards it).
  - **Rank is a numbered PLATE** on the leaderboard (gold/silver/bronze), not a
    medal glyph: at row size three medals are three near-identical discs and
    the reader still has to count rows.
  - **`<br>` contributes no whitespace to `textContent`.** The two-line menu
    title needs a real space before the break or its accessible name is
    "BeagleChomp".
  **The lives chip always draws `LIVES.max` hearts** and dims the ones not yet
  earned, so the ceiling is visible from a player’s first run rather than only
  after they earn a fourth. `createHud(root, maxLives)` takes the cap as an
  ARGUMENT — hud.ts is the DOM layer and must not import from `src/game` — and
  game.ts passes `LIVES.max`. A fixed-length row also removes the reason the
  old code tracked a high-water mark: it cannot shift when a life changes.
  The row is on a 4px budget: at 390px there are 362px, the score column takes
  157 and the gap 8, so map (75) + lives must fit 197. Five hearts at 16px with
  a 2px gap and 8px padding measure 110, which fits by four pixels — change any
  of those and re-measure, or lives drops to a line of its own.
  **THE AUTH GATE OPENS IN THE GARDEN** (the design file’s two newest screens).
  Sky above, a hedge horizon below, and only the FORM is a board — brand, tabs,
  the recovery row and the legal line sit on the sky, which is why those two
  text blocks are DARK ink (cream on pale blue is the one pairing §08 rules
  out). Three things to know before editing it:
  - **`.auth-card--gate` vs `.auth-card`.** The same class renders the RECOVERY
    view, which is still a real board — so the transparent treatment is scoped
    to the modifier, and it must sit AFTER the shared sheet rule. Same
    specificity, so order decides: putting it before is exactly how the gate
    first rendered as a full-screen slab of bark with dark text on it.
  - **The card is `min-height:100%`** so `.auth-panel`’s `flex:1` has something
    to grow into — that is what pins Create account / Log in to the bottom of
    the form board. Spacing is on a measured budget: at `--bc-s3` gaps the
    privacy line fell 15px below the fold on a 390×844 screen.
  - **The login screen remembers who last played** (`bc_last_player` in
    localStorage — username and high score, both already public, never a
    token). Written in `completeAuth` from the response the server just sent,
    so the card shows real data; absent on a device that has never signed in,
    which is exactly when it would be a lie.
  Adding those screens grew ICON by three roles (`badge`, `vpn_key`,
  `visibility`), which meant **re-cutting the font subset** — the rule in
  `tokens.css` is not theoretical, and a name that is not in the file renders as
  that word on the button.
  **A looping animation on a CONTROL needs `reducedMotion: "reduce"` in the
  browser tests.** Playwright will not click an element whose bounding box
  never settles, so the menu’s bobbing Play button hangs every click on
  `#playBtn` forever. The stylesheet already cancels every animation under
  `prefers-reduced-motion`, so the Playwright contexts ask for it — the product
  keeps the motion and the suites get a still button. Add the option to any new
  context that drives the real UI.
  **Two rendering traps this project has now hit twice each:**
  - **Never put `max-height:100%` on a sheet inside a scrolling page.** It caps
    the board at the viewport while the page keeps scrolling, so the surface
    stops mid-content and the last controls sit on the bare background. The
    sheets size to their content and centre with `margin:auto` — an auto margin
    collapses to zero when there is no room, whereas `align-items:center`
    pushes an over-tall item’s top out of the scrollable area entirely.
  - **Chrome here uses OVERLAY scrollbars** (measured: `offsetHeight ===
    clientHeight` on a scroller, desktop and touch alike), so `::-webkit-
    scrollbar` styling is invisible at rest however loud it is. A scroll cue
    that has to be seen before you scroll must be drawn by the app — see the
    shop rail’s `.shop-rail-bar` and `syncRailBar()`.
  **THE POWER-UP TRAY SITS UNDER THE MAZE, AND THE SPACE THERE IS TINY.**
  `src/render/scene.ts` publishes **`--bc-board-bottom`** (the board AABB's
  lowest projected corner, recomputed in `resize()`) because the maze is 3D and
  its camera dollies with the aspect ratio — CSS cannot know where it ends, and
  a guess is wrong on the next phone and wrong again on rotation. The tray is a
  single horizontal row anchored to that value.
  **Measure before changing it.** On a 390×844 phone the board ends at y=620
  and the D-pad starts at y=636: sixteen pixels. So the tray CANNOT stay under
  the board once the pad is on, and how far it has to move is not knowable in
  CSS — the row wraps to more lines as more power-ups are held. Hence the rule:
  **swipe anchors the tray's TOP to the board; the D-pad anchors its BOTTOM to
  the pad.** The second is exact at any number of lines (it can never reach the
  pad) and grows upward over the board's lower edge instead, which is fine —
  this tray has always been a scrim readout ON the play area. A guessed row
  height was the version that failed, and it failed by exactly one line.
  `body.dpad-on` is the switch, toggled by `src/input/dpad.ts`'s `setVisible`,
  which owns "is the pad on screen" so nothing else decides it. Under 480px
  tall the board fills the whole height, so the tray sits bottom-left and is
  narrowed to stop short of the centred pad rather than lifted over the maze.
  **Both control schemes must stay playable**, at 390, 360 AND landscape. Every
  failure found here was geometry, and every one was found by measuring rather
  than by looking — a container that spans the full width will also report a
  false overlap, so measure the CHIPS.
  **`src/ui/sound.ts` gained an interface layer** (`sound.ui`): one wooden tap
  for every press, the same tap a fourth up for a selection, plus purchase /
  equip / unlocked / error / screen cues and a menu bed. `attachUiSounds()`
  wires the tap with ONE delegated listener rather than a call per button, and
  the whole layer ducks 6 dB while a run is on (`setRunActive`), so a menu tap
  can never mask a chomp.
  **The idle bob animates the Play card's ICON, not the card.** Bobbing the
  card made the game's most-pressed control a permanently moving target and
  hung every Playwright click on `#playBtn` — an element whose bounding box
  never settles never becomes actionable. Any new decoration on a control has
  to leave the hit target still.
- **THE BOARD IS THE NINTH img2threejs SUBJECT, AND THE FIRST THAT IS NOT A
  CHARACTER** (IDEA-060, garden theme). Eight runs before it were enemy skins:
  one mesh, reviewed on a turntable, judged on whether it reads as itself.
  A board is the opposite problem — 200 instanced walls at ~25px a face, a
  grid-derived floor, and dressing that must never win a fight against the
  biscuit trail — so it gets its own harness, **`/preview-board/`**
  (`?theme=` · `?maze=` · `?view=game|close|hero|top` · `?flat=1` · `?fence=0`),
  shot by `scripts/shoot-board.ts`. `view=game` is shot at **390x844**, not at
  the turntable's square 1000: the whole question about a board surface is
  whether it survives being that small. Evidence in `.img2threejs/garden-wall/`,
  `garden-props/` and `garden-board/`.
  Nine rules are load-bearing.
  1. **THE FENCE IS GEOMETRY BECAUSE DAYLIGHT IS.** The garden's wall is a
     flowering shrub behind a picket fence. The flowers went into the hedge
     TEXTURE (they are 7px marks on a 363px reference wall); the fence could
     not, because a picket fence is separate uprights with GAPS between them
     and a gap is the one thing a map cannot draw — and a wall is one box
     wearing one material on all six sides, so a painted fence would appear on
     the wall's TOP. `src/render/fence.ts` builds one panel per exposed wall
     face as a single InstancedMesh (~440 panels, 152 tris each, 67k total,
     ONE draw call). **The pitch must divide the tile exactly** — 4 pickets at
     0.25 — or every tile boundary shows a seam and a straight run reads as a
     row of separate gates. `palette.fence`/`fenceColor` are per-theme; only
     the garden has one. **Nuno's fence is WOOD, not the reference's white**,
     so the colour comes from the project's own trunk-brown family and no
     pixel of the reference.
  2. **A GAP ONLY READS AS A GAP IF SOMETHING STEPS ACROSS IT.** The rails
     behind the pickets started the same brown as the pickets, so a gap showed
     brown-behind-brown and the whole fence rendered as a SKIRTING BOARD —
     every picket outline gone, the one feature it exists for. They are now
     darker through a **vertex colour** (grey, so it multiplies the palette's
     own timber hue), which keeps the fence at one draw call where a second
     material would not.
  3. **EVERY PLANT IN THIS GAME WAS A SPHERE, AND THERE IS A NUMBER FOR THAT.**
     The shrub reference's traced outline has a radius sd/mean of **0.135**;
     a sphere measures 0.0. `src/render/foliage.ts`'s `lobedFoliageGeometry`
     is an icosphere pushed toward lobe directions to carry it, and
     `lobedRoughness` measures the same figure back — calibrated defaults
     (16 lobes / sharpness 10 / amplitude 0.24) land on 0.1350. **Measure the
     FIELD, not a built mesh**: binning a mesh's vertices by angle reads its
     own tessellation, and a control detail-4 icosphere — roughness zero by
     definition — scored 0.1667 while a UV sphere scored 0.0000. Always run
     the zero-amplitude control; two instruments produced confident wrong
     numbers before it did.
  4. **THE NUMBER SAYS HOW FAR THE OUTLINE WANDERS, NOT HOW OFTEN.** The first
     shrub hit 0.135 exactly and rendered as a BOULDER — facets the size of
     the clumps and clumps the size of the bush. Lobe COUNT and subdivision
     are the other half and no measurement carries them.
  5. **AIM A PART WITH A FRAME, NOT WITH EULER ANGLES** (IDEA-055 rule 4,
     third occurrence). Three.js applies an XYZ Euler as Rx*Ry*Rz, so a
     `rotation.z` lean written beside a `rotation.y` spin is itself rotated by
     that spin. Every rose whorl and tulip petal came out facing TANGENTIALLY:
     the rose rendered as a pinwheel and the tulip's cup could not close.
     `shellPivot()` is the fix — spin the pivot, place at +Z inside it, tilt
     about X, where negative means in and positive means out, at every azimuth.
  6. **A REST POSE IS NOT A FLOOR, AND ONLY VERTICES SAY SO.** The tulip's
     left strap leaf sat **0.14 units underground** from a sign error, and the
     treehouse's tyre swing 0.023 under because a torus hangs by its own outer
     radius. Neither is visible in any render — a turntable has no floor
     there. `scripts/_scratch-prop-measure.ts` walks world-space vertices, and
     it must: `Box3.setFromObject` over-reported the shrub by **56%** because
     it spins its own mass (CLAUDE.md's existing `Box3` note, in a new place).
  7. **A HOLE IS ONLY A HOLE IF THERE IS DARK BEHIND IT** (IDEA-058 rule 4,
     hit again inside the file whose own header states it). The birdhouse's
     entrance is cut out of its front `Shape`, but the box behind it was
     `boxD - wallT` deep and butted straight against the pierced wall — so
     what showed through the aperture was the BODY'S OWN FRONT FACE in the
     same tan wood, and the entrance rendered as a painted arch. The dark
     plate was built, correctly coloured, and buried inside the body. A hole
     needs a **recess** to look into.
  8. **THE GROUND DRESSING IS GEOMETRY, AND THAT SETTLED AN ARGUMENT THE
     TEXTURE COULD NOT WIN.** The garden's stepping stones were painted into
     the floor first (`floorTexture.ts`, a `gardenPath` kind, now deleted) and
     needed three separate concessions to stop them fighting the biscuit
     trail: the lawn's own VALUE, because the floor's `emissiveMap` is that
     same texture and a pale mark is lit twice and blooms into fog; a
     different HUE from the biscuit, because brightness is not a signal that
     survives 25px a tile; and a heavy KEYLINE, because once the value step
     was gone the outline was all that was left. Every one of those is a
     constraint of PAINTING a floor. **`src/render/groundDetail.ts` ships them
     as real rock meshes instead** — one InstancedMesh, silhouette plus lit top
     plus shaded side plus contact shadow — and the floor goes back to plain
     grass (`lawn`). Three rules: **nothing sits at a tile CENTRE** (biscuits
     do, and a rock there reads as a pickup that will not go away), rocks stay
     under a fifth of a tile tall so a corridor never looks blocked, and the
     per-instance `setColorAt` tint is **GREY**, so it multiplies the palette's
     stone colour rather than replacing it — written as a full colour while the
     material also carried one, every rock rendered at colour-squared and the
     board came back speckled with what looked like dirt.
  9. **A WALL-TOP PROP MUST BE ON A WALL, AND FOR TWO RELEASES NONE OF THEM
     WERE.** `theme.wallDecor` is per-THEME while the wall layout is per-MAZE,
     and `buildWallDecor` never checked — so Night City's five hand-placed
     lamps hung in mid-air over open corridor in 14 to 18 of the 18 mazes, and
     the one at (9, 9) has **never been on a wall in any of them**. It
     rendered without a single error. `buildWallDecor` now takes the grid and
     SKIPS a non-wall tile (skipping, not clamping — a themed board is allowed
     to dress differently on different layouts, and inventing a position the
     author did not choose is worse). The city's five were re-pointed onto
     tiles that are wall in 15+ of 18; its own rebuild is a later session's.
     `scripts/_scratch-walldecor-audit.ts` found it, `test-garden-props.ts`
     guards it. **81 of the 399 tiles are wall in every maze.**
  **THE GARDEN'S PROPS ARE NEW SHAPES, NOT BETTER OLD ONES.** `shrub` and
  `tree` are referenced 38 and 23 times across the garden, the forest and the
  park; rewriting them in place would silently re-dress two themes nobody has
  reviewed. So `src/render/gardenProps.ts` adds `leafShrub`, `broadleafTree`,
  `treehouse`, `flower` (five kinds) and `birdhouse`, and only the garden's own
  placements are repointed. The **treehouse is the only prop in the game placed
  singularly** — at the maze's NW apron corner, which is the skyline row where
  `buildProps`' height-safety rules let a "tall" prop stand at full scale;
  anywhere nearer the camera it is clamped to 0.55 and there would be no point
  building it. The tree's measured **four-fold root flare** (0.117 of its width
  at the shoulder, 0.473 at the ground) is the most characterful number in the
  whole set and a `CylinderGeometry` cannot express it —
  `flaredTrunkProfile` lathes a concave one.
  **THE FIVE FLOWERS ARE SEPARATED BY SHAPE, BECAUSE TWO OF THEM ARE THE SAME
  RED** (IDEA-056 rule 1 again): a layered BALL against a closed CUP. Verified
  by rendering all five together at the play camera's 59 degrees
  (`scripts/_scratch-flower-sheet.ts`), never asserted — that sheet is what
  showed the rose as a broken artichoke and the tulip as a lampshade while
  every unit check passed.
  **`propsCodegen.ts` AND `boardCodegen.ts` BOTH WRITE THEIR FIELDS BY HAND**,
  so a new `PropParams` or `ThemePalette` key that is not in their lists is
  silently dropped from anything saved in the editor. `flowerKind` is also the
  first STRING either has ever had, and unquoted it emitted `flowerKind: daisy,`
  — a props.ts that does not compile. `test-garden-props.ts` now guards the
  props writer the way `test-board-surfaces.ts` guards the palette one.
  **AND SAVING A THEME FROM THE EDITOR DELETES THAT THEME'S OWN COMMENTS —
  ALL OF THEM.** `boardCodegen` regenerates the edited theme's WHOLE entry, so
  nothing written anywhere inside it survives: not inside `palette: {}`, and
  not above it either. (An earlier version of this note said prose above
  `palette:` was safe. It is not — that was inferred from the suite's
  "preserves Night City's own prose" check, which passes because Night City is
  a theme the save did NOT edit. Other themes are spliced through verbatim;
  the edited one is rebuilt from data.) **So themes.ts cannot hold
  documentation about a theme at all.** Anything load-bearing goes in the code
  that enforces it or in a test — the garden's "wallDecor must never be empty
  or the density blooms come back" rule lives in board.ts's buildWallTopDecor
  and in test-garden-props.ts for exactly this reason. Anything pinning a
  theme's numbers has the same problem from the other side: a count literal in
  a test breaks every time someone plants a prop, so read it from
  MAZE_THEMES instead.
  Worse, `test-editor-board.ts` edits the REAL `src/game/themes.ts` and
  restores it in a `finally` — which covers a failed assertion but NOT the
  process being killed, and piping that suite through `head` or `tail` closes
  stdout, raises EPIPE and kills it. That happened here and left a themes.ts
  carrying two stray slider values, two junk placements from the click tests
  and no comments. The suite now writes a `themes.ts.bak` sidecar before its
  first write and restores from one it finds on startup; **a stale `.bak` is
  the signal that a previous run was killed**. Do not pipe that suite into
  `head`/`tail` — redirect to a file and read it.
  **THREE THINGS THE FIRST REVIEW PASS CHANGED**, all of them the same defect
  in different clothes — something correctly built and entirely hidden.
  (a) Both buildings showed daylight between the wall top and the roof. A
  gable roof that OVERHANGS spans wider than the box it covers, so at the
  box's own edge the slab is still `rise * (1 - boxW/roofSpan)` above the
  wall, and that wedge is open front and back. The fill is NOT a triangle —
  its top follows the roof's slope and its sides stop at the box's width,
  which makes it a pentagon (`gableFillGeometry`). (b) The treehouse's canopy
  sat ON the ridge and buried the red roof, which is the model's most
  recognisable feature; it now clears it. **A canopy that OVERLAPS the roof
  and a canopy that is CONNECTED to the tree are not the same requirement**,
  and solving the second with the first costs the building. (c) The two
  under-deck braces did no visible job and are gone; the foliage skirt now
  hangs off a real BRANCH, aimed with `setFromUnitVectors` from its two
  endpoints. That branch was invisible twice before it worked — first routed
  straight through the house body, then buried between the trunk's flare and
  the leaves — which is the birdhouse's own buried-plate defect twice more.
  **v3 THINNED THE FLOWERS, AND THE RULE IS ABOUT LAYERS.** The wall tops
  carried 29 hand-placed flower props AND the hedge texture carried six
  daisies a face. Nuno: "they are perfect but since the ownshrub fence has the
  flower is to much." The props came off and the texture went to FOUR. Which
  layer survives is not a toss-up: the texture is the wall's own identity (the
  reference is a shrub IN BLOOM) and it dresses all ~200 walls, where the
  props only ever reached 34 tiles. Note the count has now come down twice for
  one reason worth keeping — THE REFERENCE SHOWS ONE FACE OF ONE HEDGE, while
  the texture wraps six sides of 200 boxes, so matching its density produces a
  pattern rather than a scatter. Taking the flowers off is also what surfaced
  the buildWallTopDecor trap above: emptying `wallDecor` entirely would have
  switched ~40 density bloom spheres back ON.
  **A SEED DEFAULT THAT DEPENDS ON ANOTHER FIELD CANNOT BE A CONSTANT.** The
  props editor seeds a field's first value from a flat field-to-number table,
  and IDEA-060 put `petalColor`/`centerColor` in it — so opening "petal color"
  on the Sunflower silently repainted it in the DAISY's cream and gold and
  wrote that into props.ts on the next save. Caught after it had shipped into
  the library. They now seed per `flowerKind` (`FLOWER_SEED_COLORS`), and
  test-garden-props.ts asserts no flower def carries the daisy's petal colour.
  **v4/v5 RESIZED THE PROPS, AND THE FIRST EXPLANATION FOR WHY THEY WERE SMALL
  WAS WRONG.** Nuno: "the treehouse are to small", then "the birdhouse is to
  small to. The trees should be bigger to". v4 claimed an apron prop's visible
  height was `height * scale - WALL_H` and that the treehouse was therefore
  showing 1.478 of its 2.478 units. That is the answer for a camera LEVEL with
  the hedge crown. This one looks DOWN, and the portrait fit dollies it to
  y = 49.9 / z = 29.1 rather than BASE_POS's 27 / 15.5 — so the grazing ray
  over the occluding wall's far top edge passes **y = 0.382** at the apron
  tile, and the treehouse was **85% visible at scale 1**. It was not occluded;
  it was simply too small on a 390px screen at the far edge of a 46-degree
  frustum. `scripts/_scratch-apron-sightline.ts` reads the real camera off the
  running page and solves it; do that rather than reasoning from BASE_POS,
  which is not where the camera ends up.
  **THE FOUR APRON ZONES ARE NOT EQUIVALENT, AND THAT IS THE USEFUL PART.**
  NORTH (ty = -1) is the only occluded one (visible above 0.382); SOUTH
  (ty = ROWS) is unoccluded and NEAREST the camera, which is why it carries the
  hardest cap; EAST/WEST columns stand beside the board in profile, unoccluded;
  wall tops sit ON the crown at y = 1.08 and are capped by nothing. So the
  garden's shrubs are the real occlusion case — 0.446 tall means only 0.064 of
  each NORTH-row one cleared the sight line at scale 1, a green smudge, against
  siblings on the other rows that were merely small. They ship at ~2.1x on the
  north row and 1.35x elsewhere; the trees at 1.6x, the wall-top birdhouses at
  2.1x (0.62 -> 1.3), the treehouse at 1.8.
  **RETUNE A ROW BY MULTIPLYING, NEVER BY ASSIGNING.** Every placement carries
  its own hand-authored jitter (the shrubs run 0.81..1.21) so a row does not
  read as clones. A flat assignment looks right in the diff, right in the
  average, and turns twelve bushes into twelve copies of one bush.
  The editor's scale slider runs 0.4..3 (raised from 2 so 1.8 is not against
  the ceiling) and covers apron AND wall-top placements — they share one
  Placement folder. It is duplicated in `boardInspector.ts` and
  `boardPlacement.ts`, which must stay in lockstep; the real camera-safety
  limits are `SOUTH_ROW_TALL_SCALE_CAP` (0.55) and `EAST_WEST_TALL_SCALE_CAP`
  (1.0), enforced at render time in `buildProps`.
  **AND SIZING A PROP IN THE PROPS TAB DID NOTHING ON THE BOARD.** A part edit
  at path `""` is an edit to the prop's ROOT, and `makePropFromDef` applies it
  before returning — then `buildProps` and `buildWallDecor` both wrote
  `mesh.scale.setScalar(placement.scale)` over the top of it. So a def-level
  resize was discarded the moment the prop was placed, while looking perfectly
  correct in the tab that authored it. Found because Nuno had done it TWICE
  trying to fix this very complaint: the treehouse def carried
  `{ path: "", scale: [3,3,3] }` and the birdhouse `[1.5,1.5,1.5]`, both inert.
  Both builders now `multiplyScalar`, and `buildProps` applies the two
  height-safety caps to the PRODUCT rather than to the placement's own factor —
  otherwise a def with a root scale walks straight through a cap whose whole
  job is bounding how big the thing ends up in front of the camera. The two
  dead root edits were folded into their placements rather than kept: per-def
  sizing already has a home in `params.height`/`width`, and a hidden 3x inside
  a def while the slider reads 0.6 is worse than either lever alone.
  `test-garden-props.ts` pins the multiply and both caps.
  **AND A TEST MUST NOT PIN A NUMBER THE EDITOR NOW EXPOSES AS A DIAL.**
  `test-garden-props.ts` asserted the rock scatter was `> 40 && < 400`,
  calibrated when `chance` was 0.22 — then IDEA-062 v5's World tab made
  `chance`/`apronChance` live knobs, and the first person to turn corridor
  rocks down to 0 (the corridor belongs to the biscuits) failed a suite with no
  opinion on how many rocks a garden wants. It now measures the eligible
  population by forcing both chances to 1 and asserts the scatter OBEYS its
  dials. Second occurrence of the same lesson after the garden's placement
  counts; the trigger is a literal that tracks a tuning number.
  **WHAT THE CLAY RENDER SAYS, AND IT IS WORTH KNOWING**: with every map
  stripped (`/preview-board/?flat=1`), the fence and the wall-top flowers are
  still there as real silhouettes — and the HEDGE IS STILL A PLAIN BOX. All of
  its leafiness is paint. That is a deliberate constraint (walls are one
  InstancedMesh of unit boxes, for the draw call and for corridor legibility),
  not an oversight, and the fence is what puts real geometry at the wall base.
- **THE DEEP FOREST IS THE SECOND img2threejs BOARD** (IDEA-065, after the
  garden). Nuno's brief: the wall and the ground stay, the work is all in the
  PROPS. Eleven subjects from references, in `src/render/forestProps.ts` (the
  pine, the log cabin, the nest tree, the perched bird),
  `src/render/forestCritters.ts` (six animals) and `makeGardenFlowerHead` in
  `gardenProps.ts`. Seven rules are load-bearing.
  1. **THE PINE IS A REWRITE IN PLACE, AND IT IS THE ONE EXCEPTION TO
     IDEA-060's RULE.** That rule was about `shrub` and `tree`, which the park
     and the forest both use — rewriting one silently re-dresses a theme
     nobody is reviewing. `pine` is referenced by the forest and NOTHING ELSE,
     and the forest is the theme under review, so the reason does not apply;
     keeping a cone-stack "Pine" beside a real one would be two library
     entries with the same name. **What was wrong with it is `foliage.ts`'s
     own lesson one shape along**: every plant in this game was a SPHERE and
     every conifer is a smooth CONE. Measured
     (`scripts/_scratch-pine-profile.mjs`), a cartoon pine's half-width
     oscillates with sd **0.092 of its maximum** down the trunk, in **9 tiers**
     at a period of 0.092 of the height, with a needle sawtooth reaching 0.09
     on top. A cone measures 0.0 on both.
  2. **THE WHORL COUNT COMES FROM A RATIO, NOT FROM COUNTING.** The reference's
     tier spacing is **0.26 of its reach**; six whorls over this canopy measure
     0.45, and at that ratio a stack of drooping skirts stops reading as one
     textured cone and becomes a pile of MUSHROOM CAPS. Eight lands on 0.30.
     Two more numbers were wrong in ways only the render explained:
     `PINE_TREND` is the SMOOTHED profile (the tiers are measured by smoothing
     them away, so its peak sample is 0.77 and a tree built to it measures
     0.607 w/h against a reference at 0.718) — the missing 0.23 is what the
     smoothing removed and the RIM is the local maximum, so `TIER_RIM` carries
     it, **as a multiplier**: added flat, a boost sized for the widest whorl is
     two thirds of the trend at the top one and a wide plate with a needle
     above it is a PARASOL. And eight deep serration teeth do not read as a
     coarse edge, they read as eight round LOBES — i.e. a pine CONE.
  3. **DRAW CALLS, NOT TRIANGLES, ARE THIS PROJECT'S PROP BUDGET — and the
     forest is where that was first measured.** `scripts/_scratch-mesh-census.ts`:
     garden **220** prop meshes / 22k triangles, park 120 / 16k, city 314 / 5k,
     and the forest's first build **393 / 141k**. A pine was ten meshes and
     there are thirty-five of them. **`src/render/propMerge.ts`** is the answer
     in two shapes — `mergeGrouped` for parts that already carry material
     groups (the pine's whorls, lit-top over shaded-underside) and
     `collapseByMaterial` for a hand-assembled prop (one mesh per material).
     It now applies to EVERY theme's board, not just the forest's: the garden
     went 220 prop meshes -> **104** and its wall decor 76 -> 52, same pixels.
     **WHERE `collapseByMaterial` IS CALLED IS THE WHOLE DESIGN, AND GETTING
     IT WRONG COST A REAL EDIT.** It belongs in `buildProps` and
     `buildWallDecor` — the BOARD — and NOWHERE ELSE. Put in the prop
     factories first, so `makePropFromDef` returned a collapsed prop: that is
     the same object the EDITOR builds its part tree from, so every named
     primitive (`ring`, `pupil`, `earL`) became an opaque `merged0..N`, one
     per material. Nuno went looking for the perched bird's EYE, found only
     `merged3` — the gold iris material shared by BOTH eyes — recoloured it,
     and saved `{ path: "3", color: 0xffffff }` into props.ts: a white-eyed
     bird, and a path that means a different part in every future build. The
     factory hands back the full named tree (what the editor authors and what
     `applyPropParts` addresses); the board collapses the instance it places.
     It also bakes transforms RELATIVE to the root, never to the world, so the
     placement transform and IDEA-062's cap-the-PRODUCT rule are untouched.
     **And when a prop has a part a theme should be able to recolour, give it
     a NAMED PARAM** (`eyeColor` on the bird) rather than leaving it to be
     hunted for in the part tree — that hunt is what produced the white bird.
  4. **SIX ANIMALS ARE ONE `PropBaseShape`, AND THE RISK IS COLOUR.**
     `critterKind` follows `flowerKind`'s precedent — they share a body plan
     and differ in the SHAPES of its parts. IDEA-056 rule 1 bites harder here
     than it did for the sushi pair because there are six and **three are the
     same orange**: a fox, a squirrel and a deer are all warm tan in their
     references. So the silhouette carries all of it — a rabbit's two tall
     ears, a raccoon's ringed tail and mask, a squirrel's plume arcing OVER
     its back, a fox's brush held level, a deer's antlers and legs, and the
     explorer's hat and staff (the only prop in this game that carries an
     object). **Verify by rendering all six together**
     (`scripts/_scratch-critter-sheet.ts`, play camera AND clay), never by
     assertion.
  5. **THE ANIMALS GO ON THE SOUTH ROW, AND THAT IS THE PLACEMENT IDEA.** They
     are the `"low"` height class, so they are the only new prop here the
     camera-safety caps do not touch — and the south apron is UNOCCLUDED and
     NEAREST the camera (IDEA-060's four-zone note). It is the one zone on the
     board where something knee-high is legible. A pine there is clamped to
     0.55 and reads as a shrub; a deer reads as a deer. **A LANDMARK ALSO
     NEEDS ITS NEIGHBOURS CLEARED, not just its own tile** — an apron pine is
     2.2 units against a cabin at 1.95, so dropping only the tile each
     landmark stands on left both buried.
  6. **AT THE PLAY CAMERA THE CABIN IS ITS ROOF, and that is recorded rather
     than fought.** The reference is a three-quarter view from ground level
     where the log wall is most of the building. The game looks DOWN at 59
     degrees — a vertical wall projects at cos(59) = 0.515 of its height while
     a 45-degree roof projects at nearly its full area — AND the cabin stands
     on the north apron, the only occluded zone, where the hedge hides
     everything below y = 0.382, which is most of the wall. So the roof got a
     pale ridge cap, a pale bargeboard, four thin DARK shingle joints and a
     shallower pitch. (Built at 0.2 of the slope in the pale trim colour the
     joints covered four fifths of the roof and inverted it — a pale planked
     lid with dark lines, where the reference is a dark roof with darker
     joints.) The corner log-ends and the courses are still the identity and
     are what the shop stage and any lower angle show.
  7. **THE FLOWERS SPLIT IN TWO** (Nuno: *"they look better on the props of the
     board than on the wall because they have the stem"*). `flower` LEFT
     `WALL_TOP_SHAPES` and `flowerHead` joined it — the same five heads with no
     stem and no leaves, as a thin wrapper on `makeGardenFlower` rather than a
     copy, because the five heads are genuinely different constructions and a
     second copy is five chances to retune one and not the other.
  **AND A COLOUR FIELD WITHOUT A SEED PAINTS THE PROP WHITE.** The Props tab
  writes a seed into `def.params` the moment it builds a control for an unset
  field; for a colour that fallback used to be `0xffffff`. IDEA-065 added
  `furColor`/`bellyColor`/`accentColor` and registered no seed, so SELECTING a
  critter wrote white into its params and a save persisted it — all six
  woodland animals shipped pure white with their per-kind palettes intact and
  unreachable, because a def-level override now existed. IDEA-060 hit the same
  thing with `petalColor`/`centerColor` and left the rule in a comment: **a
  seed default that depends on another field's value cannot be a constant.**
  The second occurrence was harder to find than the first because a repainted
  flower looks like a bug and white looks like a lighting problem. It is now
  enforced: **`src/editor/propsSeedColors.ts`** is a PURE module (no lil-gui,
  no DOM, importable by a Node test) holding the flat table, the two per-kind
  tables and `seedColorFor`, which returns **undefined rather than white** when
  nothing knows; `test-garden-props.ts` fails the build on any single-colour
  field in `PROP_SHAPE_FIELDS` that has no seed, seeds white, or seeds another
  kind's colour. **Adding a colour param means adding its seed.**
  **FIVE BURIED-PART DEFECTS IN ONE SESSION**, worth recording as a rate rather
  than as five incidents. The family is IDEA-057's nori belt, IDEA-058's mouth
  floor and IDEA-059's flipped band normal: a part built right, coloured right,
  placed right, and behind another surface. Here: the cabin's door and windows
  placed against the wall PLANE while the round log courses bulge `logR` past
  it; the nest tree's whole hollow, nest and chick placed at a fixed radius on
  a trunk that is a LATHE (at the hollow's own height the bark is at 0.208 and
  the assembly was at 0.148); the perched bird floating 0.067 above its own
  branch; the flower heads sinking 0.029 BELOW the floor once the stem went;
  and every inner ear positioned in the ear pivot's units while the ear shell's
  was a fraction of its LENGTH — which on the fox read as two black ANTENNAE.
  The last was fixed by taking the position away from the caller entirely,
  which is IDEA-054's make-it-unrepresentable lesson.
  **AND A REVIEW-HARNESS MISMATCH REPORTED AS A MODEL DEFECT FOR THE THIRD
  TIME** (after `?fov=` in IDEA-054 and `?bg=none` in IDEA-056):
  `/preview-rework/`'s `?toon=1` could not read a material ARRAY, so the pine —
  the first prop with per-triangle groups — rendered WHITE, and review round
  one read it as the model having lost its colours. New measuring instruments:
  `scripts/_scratch-measure-forest.mjs` (bbox + normalised width profile on an
  alpha OR near-white background), `_scratch-pine-profile.mjs` (tier period,
  tier amplitude, serration depth), `_scratch-palette.mjs` (dominant colours BY
  AREA — and note that on an INKED reference those are the keylines, not the
  surfaces, so a flat region has to be point-probed), `_scratch-crop-forest.mjs`
  and `_scratch-critter-sheet.ts`.
- **THE GROUND USED TO STOP ONE TILE PAST THE MAZE** (IDEA-066, all five phases).
  Nuno, after playing: *"around the maze looks so empty… all the props are
  literally side by side the maze… the user should feel she is inside a garden,
  or inside a forest, on a real beach."* Both halves are literal.
  `board.ts`'s floor is ONE `PlaneGeometry(COLS + 2, ROWS + 2)` — 21 x 23 units,
  the maze plus exactly one tile — and past its edge there was no geometry at
  all. And `apronCandidates` enumerates one ring and nothing else, which is why
  every prop is shoulder to shoulder with the hedge.
  **THE "EMPTY SKY" WAS NEVER SKY — IT WAS THE GROUND RUNNING OUT.** The camera
  pitches 59.3 degrees down with a 23 degree half-FOV, so the TOP edge of the
  frame points 36.3 degrees **downward** and meets y = 0 at z = -21.2 on a
  desktop and z = -38.7 on a phone. **The horizon is never in shot at any
  aspect** (`scripts/_scratch-surround-coverage.ts` sweeps eight and reports zero
  rays escaping above it), which is the whole reason this is a bigger floor
  rather than a skybox. Measured, **68% of sampled frame pixels landed off the
  board's floor**; that number is the void.
  Three concentric layers, each with its own data shape and its own merge:
  **apron** (unchanged), **verge** (hand-authored) and
  **surround** (procedural). Seven rules are load-bearing.
  1. **THE EXTENT IS MEASURED AND DELIBERATELY OVERSIZED.** The sweep says the
     frame needs |x| >= 42.7 and z from -42.1 to +24.4; `SURROUND_PARAMS` ships
     50 / -50 / +30. Do NOT trim to the minimum — a visible world edge at an
     aspect nobody tested is catastrophic and the margin costs one quad. The
     plane runs **under** the board floor (y = -0.02 against -0.01) rather than
     butting against it, so there is no joint to align, no crack and no z-fight.
  2. **THE SURROUND'S COLOUR IS THE FLOOR TEXTURE'S MEAN, NOT `palette.floor`.**
     The first build reasoned that floorTexture.ts "bakes palette.floor in as its
     ground" — which is true, and then the lawn painter covers it. The garden's
     floor is **soil** and its texture is **grass**, 48/255 apart, so a brown
     field shipped around a green maze. `_scratch-surround-seam.ts` reads the
     real floor canvas and prints the value to paste in.
  3. **AND ITS EMISSIVE MUST BE SCALED BY THAT MEAN'S LUMINANCE.** board.ts sets
     `matFloor.emissiveMap`, so the board's lift is MODULATED by its texture
     while a flat plane gets it at full strength — a hard bright line right
     around the maze, from a value everybody checked and nobody compared. The
     exception is a `"flat"` floorTexture (Arcade Night): no map on either side,
     so no scaling, or the surround comes back darker than the board.
  4. **DRAW CALLS ARE THE BUDGET, AND `mergeBySignature` IS WHY THIS IS
     AFFORDABLE.** Four hundred props the old way is ~1,400 draw calls.
     Bucketing by what a material LOOKS like rather than which object it is
     collapses the whole band to **one mesh per distinct material** — measured
     **13-14 calls / ~120k triangles**, and that does not grow with density.
     The key is STAMPED BY `toon()` from its own parameter bag
     (`userData.toonKey`), never computed from the material: enumerating fields
     means one day forgetting one, and a key that is too LOOSE welds two
     different materials and silently repaints a part. An unstamped material
     falls back to its uuid, so unknown input can cost a draw call but never
     correctness. **Surround and verge only — never a character**, because
     welding is only safe where nothing is recoloured, animated or part-edited.
  5. **THE LATTICE IS THE IDEA, NOT THE OBJECTS ON IT.** A scatter of trees and
     houses on grass reads as a scatter of trees and houses on grass; the same
     objects inside **hedged plots separated by lanes** read as other gardens.
     A plot overlapping the keep-clear box is **dropped whole, never clipped** —
     a half-plot sliced at the board's edge reads as a bug, a missing one reads
     as "that is where the maze is". Everything inside a plot is placed in PLOT
     FRACTIONS so it cannot escape its own hedge.
  6. **THE SOUTH BAND IS DIFFERENT AND IT IS THE HARDEST TUNING CALL.** Desktop's
     frame ends at z = +11.9, portrait's at +22.4 — so south is portrait-only, at
     ZERO fog, at the largest on-screen size anything in the surround ever has,
     and directly under the HUD and D-pad. Only ONE plot row is ever visible
     there. Rule 4 said no buildings; the first build read that as no height at
     all and left a fifth of a portrait frame as bare lawn. Trees came back,
     hard-capped near a wall's height (the solved occlusion limit at that
     distance is 3.85 — crowding, not occlusion, is the constraint).
     `_scratch-surround-sightline.ts` solves all of it and reports that **only
     the south band can ever occlude the maze**: north, east and west shadow
     AWAY from the board at every height and every aspect. **The shipped apron
     caps are AESTHETIC, not geometric** — 0.55 against a real limit of 1.28 —
     so do not copy them outward. And the binding camera is the TALL PHONE, not
     the desktop: it sits higher but much further back, so its ray is the
     shallowest. Reasoning from `BASE_POS` gives 2.70 instead of 1.28.
  7. **RULE 2 LEFT A HOLE, AND THE FRINGE FILLS IT.** A plot row straddling the
     keep-clear boundary is dropped whole, which on the south side (one visible
     row) left the nearest five units bare. `planFringe` scatters LOW content on
     a 2-tile grid in that annulus. Its jitter is half a cell and the grid starts
     ON the boundary, so **the jitter is applied and then re-tested** — the first
     version walked eight items back inside the keep-clear box, into the verge
     the rule exists to protect. `scripts/test-surround.ts` found it.
  **THE VERGE IS THE HAND-AUTHORED RING, AND IT IS A SEPARATE ARRAY** (phase 3).
  `MazeTheme.verge` holds `PropPlacement`s on rings 2-3, offered by a third
  `PlacementSubMode` over `vergeCandidates` (~180 slots, `VERGE_RINGS = 2`).
  This is the direct answer to *"the treehouse is a good detail but is too close
  to the maze and can only be put in specific places"* — the apron only ever had
  two corners that would take one uncapped.
  1. **REUSING `placements` WITH OUT-OF-APRON TILES CREATES UNREACHABLE DATA,**
     three ways, and any one of them disqualifies it: the editor builds a marker
     per tile from `apronCandidates` and a marker is the ONLY way to select a
     placement, so a verge entry could be typed in and never moved or deleted
     again; `buildProps`' caps key on `ty === ROWS` / `tx === -1 || tx === COLS`,
     so every tall verge prop would be SILENTLY uncapped (the
     buildWallDecor-never-checked-for-a-wall shape exactly); and the two layers
     want different shadow and merge treatment.
  2. **ONE CAP, SOUTH ONLY, AND IT IS AESTHETIC.**
     `VERGE_SOUTH_TALL_SCALE_CAP = 1.2` against a solved limit of **3.85** at
     ring 1 and 6.41 at ring 2. North, east and west cannot occlude the maze at
     ANY height — their shadow ray travels away from the board. Do not copy the
     apron's 0.55 outward; that one is also aesthetic (its own geometric limit
     is 1.28) and it was tuned for a prop one tile from the hedge.
  3. **THE APRON AND THE VERGE ARE THE SAME DATA SHAPE, SO THE EDITOR BRANCHES
     ON PROP-VS-WALL**, not on three arms. `isPropSubMode()` and
     `placementsFor()` are the only two places the split becomes a field name —
     which is why `boardInspector.ts` and `placementGizmo.ts` needed no change
     at all.
  4. **THE TUNNEL EXCLUSION IS EXTENDED OUTWARD.** `apronCandidates` only masks
     `tx === -1` and `tx === COLS` because that is the only column it has; a
     shed parked in a tunnel mouth two rings out is just as much in the way, and
     a tunnel is the one sightline a player's eye travels down.
  5. **`mergeBySignature` NOW DISPOSES THE MATERIALS IT ORPHANS**, and the verge
     is why. Every prop factory builds its OWN materials, so twenty verge shrubs
     are twenty identical-looking material objects; welding them leaves
     nineteen referenced by nothing, which would leak a GPU program per prop for
     the life of the page. `collapseByMaterial` cannot hit this (it keys by
     identity, so every bucket has exactly one material), which is why the merge
     shipped without it.
  6. **EVERY VERGE TILE MUST SIT INSIDE `SURROUND_PARAMS.keepClear`**, or a
     hand-placed prop and a procedural plot share ground. Neither module can see
     that on its own; `test-surround.ts` asserts it across both, so raising
     `VERGE_RINGS` without raising `keepClear` fails the build.
  **AND A TEST MUST NOT HARDCODE A TILE IT DOES NOT OWN.**
  `test-editor-board.ts` pinned `[19, 4]` as "garden's first authored shrub".
  That was true when written and silently wrong from IDEA-060's prop
  re-authoring onward — `[19, 4]` is a placement in the BEACH, PARK and CITY
  themes and in no other. So the suite had been clicking an EMPTY slot,
  auto-creating a placement there, and failing **eight** checks that read as
  eight unrelated broken features (markers, rotation, scale, the folder's
  control count) because not one of them names a tile. It now derives the tile
  from `GARDEN.placements[0]`. Its sibling one section down had moved the
  density-bloom test off the garden when IDEA-060 filled that theme's
  `wallDecor`, and then IDEA-065 did the same to the forest — that one now picks
  the theme by the PROPERTY it needs (empty `wallDecor`, non-zero
  `bloomChance`) rather than by name. Both had been red before this branch
  started; the suite is green now for the first time in a while.
  **FOUR THINGS THE RENDER SAID AND NO ASSERTION COULD.** A hedge run alternating
  lit/dark per blob is not shading, it is a **chain of beads** — one material per
  run, few wide overlapping blobs, is what makes it a hedge (and it cost 37k
  triangles to learn that shrinking the step was not the fix). A greenhouse
  sharing the WINDOW glass is a **charcoal slab**: a window must be the darkest
  thing on a building and a greenhouse the lightest, so they are two materials.
  A flower bed on `groundAccent` is a **pale rectangle on grass** and on `trunk`
  it is a **red brick** — soil needs its own dark desaturated tone. And a dune
  mixed halfway to pale sand is a **boulder**: a dune is made of the same sand it
  sits on, so the only thing separating it is how light falls on a curve.
  **Per-theme fog** (`palette.fogNear`/`fogFar`, absolute world units at the base
  dolly) replaced the global 30/55. `resize()` scales both by `dist / baseDist`,
  which is what lands the top of frame at the same fog on BOTH framings, and that
  match is not luck. Tuned in phase 5 — see that section for the values and for
  why `near` barely moved.
  `surround: SurroundKind` is a palette slot like `fence`/`groundDetail`, so
  `test-board-surfaces` guards it for free; **Arcade Night takes `"none"`** and
  its clean void is preserved exactly. The GROUND has no "none" on purpose — the
  no-sky-gap guarantee is unconditional, and a theme wanting the old look sets
  `surroundGround` to its own `bg`.
  **`Board.surround` is BORROWED, not owned** — the only slot in that struct that
  is. The recipe never reads the grid, so it is identical on all 36 maps and
  `ensureSurround` caches it across levels; `disposeLevel` must leave it alone.
  It is keyed on the VALUES of `SURROUND_PARAMS` rather than a revision counter,
  which is what makes the World tab's live preview work with no invalidation call
  anyone can forget.
  **TWO LIVE BUGS FOUND WHILE PLANNING THIS, BOTH FIXED.**
  `MazeTheme.secret` was never written by `formatThemeEntry`, so saving Arcade
  Night from the Board tab **deleted `secret: true`** and would have listed the
  Pac-Beagle's tribute board free in every player's shop — `test-board-surfaces`
  guarded `ThemePalette` keys only, never `MazeTheme`'s own fields, and now
  guards both. And `npm run test` was **already red**: a garden wall-top bloom
  sat on a tile that is wall in 16 of 36 mazes (IDEA-061 grew the set without
  re-auditing), and an assertion demanded every garden wall-top be a birdhouse,
  which Nuno's own editor session had contradicted.
  **PHASE 4 IS THE GARDEN'S ART, AND IT IS A DIFFERENT BRIEF FROM AN ENEMY
  SKIN.** Three img2threejs runs off Nuno's references — a neighbour HOUSE
  (`.img2threejs/garden-house/`), a GREENHOUSE (`garden-greenhouse/`) and a
  boundary HEDGEROW (`garden-hedgerow/`) — each with a `measurements.json`
  carrying the measured table, the shipped table, and every deviation with its
  reason. Read those rather than re-deriving a number by eye.
  **LANDMARKS ARE READ OFF A LABELLED GRID, NEVER ESTIMATED**
  (`.img2threejs/garden-house/grid.py` overlays a percentage grid on any
  reference and writes a cropped variant). Measuring a proportion by eye is how
  a "measured" table ends up being a guess with decimals on it.
  Five rules, and the first is the one that generalises.
  1. **A DISTANT SUBJECT IS A DIFFERENT BRIEF, SO IT GETS DIFFERENT GATES.**
     These are seen at 15-40px from ONE fixed camera, never magnified, never
     orbited, never team-recoloured, never animated. The turntable and
     silhouette-IoU gates are calibrated for a hero object filling the frame and
     have nothing to measure here; no PBR extraction either, because every
     reference is watermarked stock (shape evidence only) and `MeshToonMaterial`
     has no roughness channel to describe. Recorded in each spec's
     `gateCalibration`, same category as IDEA-054's IoU finding and IDEA-059's
     legitimate generator block. The review instrument is
     `/preview-board/?theme=garden&view=game` at 390x844 plus the clay render.
  2. **THE HOUSE SHIPS WIDER THAN ITS REFERENCE — 1.39 AGAINST A MEASURED
     1.16.** Proportion base **EW = the EAVES WIDTH** (not height: a house's
     height depends on whether the chimney is in frame, and this one's is). At
     twenty pixels 1.16 reads as SQUARE, which costs rank 1 entirely — and rank
     1 is the only thing separating this from the treehouse, the log cabin and
     the city tower, all of which are tall-narrow or a slab. The width is bought
     by flattening the roof (35.8 degrees against a measured 52.4), NEVER by
     widening the box: a wider box is a hall and a plot has to hold it. The
     chimney is rank 2 and keeps the reference's numbers almost exactly,
     including the **off-centre** offset — centred, it reads as a finial on the
     ridge rather than as a chimney.
  3. **AT THE PLAY CAMERA THE HOUSE IS ITS ROOF, AND THE CLAY RENDER IS WHAT
     SAID SO.** A vertical wall projects at cos(59) = 0.515 while the roof is
     seen almost in plan, so the two windows on the front face contribute
     NOTHING from above (they are kept for the shop stage and lower angles, not
     for the board) and the roof was one undifferentiated dark mass. A **pale
     ridge cap** is twelve triangles and the difference between a roof and a
     lump — the same fix IDEA-065's log cabin needed, for the same reason.
  4. **THE GREENHOUSE'S RANK 1 IS ITS BRICK PLINTH, WHICH THE REFERENCE
     VOLUNTEERED.** The brief asked for a gable and a glazing grid; what
     survives at twenty pixels is that the pale box stands on a DARK base —
     ~3px of dark under a pale mass. A glazing bar at that size is nothing; a
     value step is everything. Its own base is **GW = the GABLE span**, read on
     the reference's near end because that end is face-on and the long axis is
     buried in perspective; GW = EW/2 makes it LOW AND LONG, **2.08
     wide-over-tall against the house's 1.40**. That separation is the number
     that matters, because the two share a plot and get compared — so
     `_scratch-house-probe.ts` asserts the RATIO BETWEEN THEM, not just each
     one's own fidelity (IDEA-056's pair rule). It reuses `soil` for the plinth
     rather than adding an eighteenth material, and deliberately has no ridge
     cap and no eaves band: pale-on-pale adds nothing, and the plinth is already
     doing the mass separation.
  5. **THE HEDGEROW'S TOP IS SECTIONS WITH STEPS, NOT PER-BLOB JITTER.** The
     reference shows three visible notches across a run where one maintained
     section ends and the next begins, each section fairly flat. At twenty
     pixels per-blob radius jitter is noise; a step is legible and reads as
     something somebody clips. **The receding height decay is deliberately NOT
     transferred** — it is perspective in the photograph, not shape in the
     hedge, and reproducing it would build a wedge. Height stays a GAME rule
     (crown <= 0.7 x WALL_H) rather than a measured one: the reference cannot
     supply an absolute scale, and it would not matter if it could, because the
     maze wall is exactly one tile tall everywhere and a surround hedge that
     reads as MORE MAZE is a gameplay bug.
  **AND A PROBE MUST BE HELD TO THE RIGHT TABLE.** `_scratch-house-probe.ts`
  measures every building from VERTICES against its own `measurements.json`
  (never `Box3.setFromObject` — 56% over-report on a rotated child). Its first
  version held the shed and the greenhouse to the HOUSE's numbers and reported
  seven failures against a build that was correct: the harness being wrong
  rather than the code, which is the thing to suspect first here. The shed has
  no table of its own and gets only the rules that apply to all three — wider
  than tall, on the floor, inside budget.
  **PHASE 5 IS THE NEIGHBOURHOOD, THE FOG AND THE GROUND.** Three things, and
  the first is the one Nuno asked for by name ("a balance between the houses and
  greenhouses and the gardens").
  1. **PLOTS ARE IRREGULAR QUADRILATERALS, NOT JITTERED RECTANGLES.** Every
     corner is jittered on its own, bounded to 0.35 of the LANE so two
     neighbours can never close the street between them. A field of jittered
     rectangles still reads as a grid — the jitter moves them without changing
     what they are. Content is placed by BILINEAR interpolation between the four
     corners, so rule 3 holds harder than before: nothing can escape its own
     hedge whatever shape the quad takes. And a hedge run is built along its
     local +X, so aiming it down an edge needs **`atan2(-dz, dx)`**, not
     `atan2(dz, dx)` — the wrong sign mirrors every run and leaves the boundary
     crossing its own corners.
  2. **PLOTS HAVE ARCHETYPES, AND THE MIX IS THE DIAL.** Every plot used to run
     one recipe — house + trees + shrubs + beds, every time — which reads as an
     estate built in one afternoon. Four kinds now, from one hash roll against
     cumulative bands (`houseChance`, `allotmentChance`, `orchardChance`, and
     whatever is left is LAWN): a house and its garden, an **allotment** with a
     greenhouse and no house at all (the one that makes the place read as WORKED
     rather than developed), an orchard, and lawn. **Keep some lawn** — it is
     not a gap, it is what stops the surround reading as wall-to-wall stuff, and
     the hedges alone still carry the lattice. The SOUTH band takes orchards and
     lawns only, whatever the mix says, for the reason it has always had.
     Cheaper as well as better: the garden's surround went 123k triangles to
     **99k**, because a lawn plot is not a house plot.
  3. **THE FOG IS TUNED, AND `near` DELIBERATELY BARELY MOVED.** The board's own
     far edge sits 38.2 units from the base camera, so pushing `near` past that
     takes the MAZE to zero fog — a real change to a look that was tuned, and
     not one the surround needs. What the surround needs is `far`, and only the
     open themes need it far: garden 34/92, park 34/85, beach 38/104 against
     forest 30/60, city 28/54 and Arcade Night 26/46, which pull IN. That split
     is the whole reason this became per-theme rather than one global pair.
  4. **THE SURROUND GROUND TILES WHERE THE BOARD'S FLOOR DOES NOT**
     (`surroundTexture.ts`). floorTexture.ts maps one canvas 1:1 onto the board
     plane because it is GRID-DERIVED; nothing out here is, and one
     non-repeating canvas over 100 x 80 units at the same 32px/tile would be
     3200 x 2560 — about 33 MB of RGBA for a surface with no per-tile
     information to carry. So it tiles at **8 tiles** (not 4: on screen the
     surround runs 15-40px a tile, so a 4-tile period is a 60-160px repeat and
     reads as wallpaper), and that inverts the floor's caching rule — this one
     **IS** cached by `kind|hex`, because there is no grid to paint in and
     therefore no way for level 1's corridors to reach level 2's ground. Every
     mark is drawn NINE times for seamlessness, so every random decision must be
     made BEFORE `wrapped()` or the nine passes draw nine different marks.
     **The kind is DERIVED from `palette.floorTexture`, not a second palette
     field** — the two have to relate, so a separate slot would only ever be a
     chance for them to disagree, and the seam is where a disagreement shows.
     `road` maps to flat on purpose: Night City's lane markings follow the
     corridors, and there is no grid out here for markings to lead anywhere.
  **AND A THIRD HARNESS REPORTED A FALSE FAILURE, WHICH IS WORTH THE TALLY.**
  `_scratch-surround-seam.ts` read the surround MATERIAL's colour — which
  correctly became `0xffffff` the moment the ground gained a map, because a
  textured surface bakes its colour in and holds the material white. It
  confidently declared four sound themes broken. It now samples the surround
  TEXTURE's mean and compares it against the floor texture's mean: the same
  measurement on both sides. Third in this feature after the probe held to the
  wrong table and the verge cap read off a `scale` the merge had baked away.
  **When a check fails here, suspect the instrument first.**
  **A finding bigger than this feature, captured and NOT acted on**: Arcade Night
  ships zero props and still costs **198 draw calls**, of which **176 are
  individual biscuit meshes**. Instancing the pellets would save more than the
  entire surround is budgeted to spend. It is in the ledger Inbox.
  Instruments: `_scratch-surround-{coverage,sightline,seam,sheet}.ts`, and
  `_scratch-mesh-census.ts` now reports `renderer.info.render.calls` plus the
  before-table. **Budgets are DELTAS over that table**, because the garden already
  sat at 356 calls and an absolute ceiling below it is a test nobody can pass.
- **THE TUNNEL WAS UNMARKED, AND IT IS THE ONLY CROSSING THE GAME HAS**
  (IDEA-067). Nuno, after IDEA-066 landed: *"something on the sides that connect
  the beagle to go to one side to the other, is like a arch fence… for this
  theme the garden I have this reference"*
  (`.img2threejs/reference/boardwalls/archhedgerow.png`, a clipped yew wall with
  an arched portal cut through it) *"make the necessary changes to allow the
  edit of that component to allow create other and try other things."*
  That sentence names exactly one thing. Measured across all **36** shipped
  mazes there is ONE crossing and it is identical on every board: **row 9, west
  and east** — the only two tiles in the whole 19x21 border that are not wall,
  since every other apparent gap is `" "` VOID rather than floor. Nothing
  whatsoever marked either end; the beagle simply stopped existing at the edge.
  `src/render/archway.ts` is the prop, `buildTunnelArches` in board.ts is the
  fixture, and the evidence trail is `.img2threejs/garden-arch/`. Seven rules.
  1. **AT THIS CAMERA AN ARCH READS IN PLAN, NOT IN ELEVATION — so the opening
     has to be open to the SKY, not to the far side.** The single most useful
     thing this run produced, and it cost a complete build. The first version
     was the reference literally (a 2.05-unit hedge wall, 0.75 deep, portal cut
     through, standing across the tunnel mouth) and it rendered as a **plain
     green slab**: not approximately, the aperture contributed **exactly zero
     pixels**, and the only thing on screen hinting at an opening was the grey
     threshold slab poking out at the corridor. The cause is obvious once a
     render shows it — the arch spans the tunnel, the tunnel runs east-west, so
     the two jambs stand NORTH and SOUTH of the corridor, i.e. **one directly
     behind the other along the camera's own horizontal heading**, and the near
     jamb eclipsed the whole portal. The arithmetic afterwards says what the
     shape has to BE: the camera looks down 59 degrees, so a pier of height `h`
     hides everything within `h / tan(59) = 0.6h` behind it, and the corridor is
     one tile across which the camera's horizontal heading crosses at 0.86 of
     that — so the far side shows only while **`0.6h < 0.86 x openW`**. At the
     reference's full-height jambs that needs an opening three tiles wide, which
     is not a garden arch. Hence **two clipped piers 1.35 units tall with an
     arched band springing between them** — an arbour rather than a portal,
     which is also much closer to what a garden arch over a path actually is.
     `scripts/test-archway.ts` asserts that inequality directly, so a retune of
     `archRise` or `archCrown` cannot quietly push the piers back up through it.
     **Every portal, gate, doorway or window this project ever builds on the
     board has the same problem and the same answer.**
  2. **IT IS ONE CONTINUOUS CHAIN OF FOLIAGE — UP ONE LEG, ROUND THE HEAD AND
     DOWN THE OTHER — AND NOWHERE IN IT IS THERE A BOX** (v2, Nuno: *"the
     massive blocks we have on the bottom I don't like it, I prefer if
     everything was like the hedge arch... make the arch look more a plant and
     not a block"*). v1 had two `BoxGeometry` piers wearing the wall texture,
     which was defensible on paper — the maze hedge is literally a box wearing
     that texture, so the arch matched it exactly — and wrong for a reason the
     maze wall does not have: a WALL is a long run seen end-on at 25px, where a
     box is all anyone can read anyway, while an ARCH is a single object the
     eye goes to, seen against open lawn, with a lobed organic band already
     growing out of its top. A flat-faced block under a lumpy arch does not
     read as the bottom of the same plant; it reads as two masonry posts
     someone rested a hedge on.
     So `archPier` now sets how much THICKER the chain is at the feet than at
     the crown and the radius eases between them by height (cubic, so the
     thickening lives in the bottom third — a linear taper is a CONE, which is
     a different plant), and `archHedgeTexture` went with the boxes: a wall
     texture is authored to wrap a unit BOX and an icosphere's UVs are nothing
     like that, so keeping the dial would be a control wired to nothing.
     Three tuning rules carried over from `surroundProps.ts`'s
     `distantHedgeRun` and they are all load-bearing: **ONE material for the
     whole run** (alternating tones per blob is not shading, it is a string of
     beads); **space by ARC LENGTH and by the LOCAL radius**, because a fixed
     step leaves the thin crown as beads and the thick feet as one smooth
     sausage; and **build the path as ONE polyline**, or the chain has a joint
     exactly where the leg meets the arch, which is the whole complaint.
     (`ExtrudeGeometry` was the first attempt at the band and read as a flat
     dark FLOATING RIBBON, because its default UV generator lays UVs out in
     WORLD units — a band 0.34 wide samples a 0.34 slice of a texture built to
     cover a unit box, i.e. almost a flat colour, and whichever one that slice
     landed on.)
  3. **`palette.wall` IS NOT THE COLOUR OF THE WALL A PLAYER SEES**, and the
     fourth verdict is that the arch came back a dark green sausage lying
     against a bright hedge. wallTexture.ts bakes that value into a texture and
     its own header says why the texture comes out far lighter: *cartoon foliage
     is mostly LIT leaves ABOVE the mass, which multiplication cannot reach*. So
     flat foliage painted in `palette.wall` beside a textured hedge reads dark.
     The arch's foliage ships at **1.34x** and its crest at **1.5x**, which is
     not a fudge — it is matching the surface that is on screen rather than the
     number it was generated from.
     **WHAT MAKES IT BELONG TO THE WALL IS THE FENCE, NOT A SHARED TEXTURE**
     (v2, and Nuno asked for it by name: *"on the bottom have a fence like the
     wall maze"*). `fence.ts` now exports `fencePanelGeometry(widthTiles)` and
     the arch runs three panels round each foot — the same pickets, the same
     pitch, the same dark rails behind the gaps, driven by the same
     `FENCE_PARAMS`, so the World tab's dials move the maze's fence and the
     arch's together. That shared identity is doing real work: the arch stands
     exactly where the maze wall's own fence ends. **A short run keeps the
     picket WIDTH and PITCH and changes the COUNT** — scaling a one-tile panel
     is the obvious move and it is wrong twice, halving the picket to ~2px
     (under the cartoon floor) and breaking IDEA-060 rule 1's divides-the-tile
     constraint. Three panels and not four: the fourth would face INTO the
     opening, which is the doorway.
  4. **THE THIRD VERDICT WAS THAT IT READ AS ONE MORE BUSH** — correctly built,
     correctly placed, and lost because the lawn, the hedge and the arch are all
     green. Most of its blossoms moved from the piers to the **BAND**: the band
     is the part that clears the hedge line, so it is the only part with
     different ground behind it and the only part a player can pick out from
     across the board. Flowering the piers decorates the half that is already
     lost against the wall.
  5. **IT IS A PROP AND A FIXTURE AT THE SAME TIME, DELIBERATELY.** `archway` is
     a normal `PropBaseShape` with **twelve dials** (opening, rise, head curve
     from 1.1 gothic to 4 flat, pier width, depth, band thickness, band depth,
     crest raggedness, blossoms, threshold, hedge surface, plus three colours),
     so it is authored in the Props tab and hand-placeable on the apron or the
     verge like anything else — and it ships in **three tunings that are three
     different ARCHES rather than three colourways** (Hedge Arch, Gothic Arbour,
     Topiary Gate), which `test-archway.ts` pins by asserting the three differ in
     head curve, in rise and in proportion. AND `buildTunnelArches` reads the
     **GRID** and stands one at every tunnel it finds. The second exists because
     a per-THEME placement meeting a per-MAZE layout is exactly how `wallDecor`
     hung Night City's lamps in mid-air over open corridor in 14 of 18 boards for
     two releases (IDEA-060 rule 9). `MazeTheme.tunnelArch` is a prop ID, so a
     theme answers **which**, never **where**; only the garden names one, because
     a yew portal at a beach tunnel mouth is not a beach.
  6. **VERTEX COLOURS HAVE TO SURVIVE A MERGE, AND UNTIL v2 THEY DID NOT**
     (`propMerge.ts`). Both merges carried `position` and `normal` and nothing
     else, so any geometry with a `color` attribute lost it — and a material
     with `vertexColors: true` and no colour attribute renders **pure black**,
     not untinted. The arch's footing is what found it: fence.ts paints its
     dark rails with a grey vertex colour (so the palette still owns the timber
     hue and the whole maze fence stays ONE draw call), and the arch came back
     with six black slabs at its feet on an otherwise correct model. The merge
     now allocates a colour buffer only when something in the bucket has one
     and fills WHITE for those that do not — the identity for a multiply, so
     mixing a plain prop into a vertex-coloured bucket cannot darken it.
     Latent for every future vertex-coloured prop, not just this one.
  7. **A MATERIAL-ARRAY MESH COSTS A DRAW CALL PER GROUP, NOT PER MATERIAL** —
     and `mergeBySignature` skips material arrays by contract, so it cannot weld
     one away either. The piers first used `BoxGeometry`'s own six per-face
     groups to darken the face looking into the opening: elegant, free, and
     **24 draw calls for two arches**, where the entire surround spends 14. The
     reveal is a separate thin JAMB instead, which welds — and it protrudes
     0.015 INTO the opening rather than sitting flush, because a plate at exactly
     the pier's own face is the buried-part defect this project has now shipped
     five times. Measured after both fixes: **5 draw calls / 1,816 triangles for
     BOTH arches**, garden frame 353 calls / 251k triangles.
  8. **THE TWO ENDS OF ONE TUNNEL SHARE ONE INSTANCE HASH.** Everywhere else in
     board.ts a prop is varied by its own tile so a row does not read as clones.
     These two are the two ends of the same gate, and a different green at each
     end is a continuity error, not variety. It also halves the merge: two
     identical arches weld to one mesh per material, two differently-tinted ones
     weld to none.
  **AND THE THREE TUNINGS WERE UNREACHABLE** (v2, Nuno: *"I see you made 3 but
  I can't change them on the board"*). `tunnelArch` was a `MazeTheme` field
  with no control anywhere, so the only way to try the Gothic Arbour was to
  hand-edit themes.ts — which is precisely what the Board tab exists to stop,
  and three arches nobody can switch between are one arch and two dead library
  entries. It is a board SLOT now (`BoardSlotId` gained `"tunnelArch"`, so it
  gets a row in the left-hand tree, which is how anyone discovers the tab has
  an opinion about it), and its options are DERIVED from `PROP_LIBRARY` by
  shape — authoring a fourth arch in the Props tab puts it in the list by
  existing. It lives with the theme rather than in the World tab for the reason
  the field is on `MazeTheme` at all: this answers WHICH, which is the theme's
  business, while `ARCH_PARAMS`' four dials answer WHERE, which is the board's.
  **AND A BLOSSOM NEEDS A GOLD EYE OR IT IS A PEBBLE.** The arch's daisies were
  cream icosahedra — a fine 3px speck at the play camera and unmistakably
  GRAVEL at any closer angle, which is what the `?view=arch` review shot showed.
  The maze wall's painted daisies have always had a gold centre; that one mark
  is the entire difference between a flower and a stone. They are also squashed
  along their own outward normal and aimed out of the foliage, which is the
  geometric equivalent of painting one flat on a face.
  **`/preview-board/` GAINED `?view=arch`** — the west tunnel mouth at a low
  three-quarter. `game` is still the only view that decides anything (a board
  fixture that reads ONLY in `arch` does not read), but a 40px arc on a phone
  cannot be judged for CONSTRUCTION, and "is that a plant or a block" is only
  answerable from somewhere you can see it.
  A fourth `PropHeightClass`, **`"portal"`**, exists for the hand-placed case:
  an archway is the first prop in the library that is mostly a HOLE, so "how
  much of the play area does this mass hide" is the wrong question about it, and
  capping it as `"tall"` crushes a 2.4-unit portal to 1.3 on the south row —
  the exact complaint that cost a whole session on the treehouse. Its south cap
  is **geometric rather than aesthetic** (unlike every cap above it) and is
  written as `1.28 / ARCH_DEFAULTS.baseHeight` so the two cannot drift.
  **AND THE WORLD TAB'S SURROUND PANEL HAD BEEN DEAD SINCE IDEA-066 SHIPPED IT.**
  Phase 5 added `src/render/surround.ts` to `SavableFile` and to `worldFields.ts`
  and NOT to `sourceStore.ts` — so `sourceTextFor` returned `""`,
  `readConfigNumber` returned null, and all **sixteen** surround dials rendered as
  disabled "not found in src/render/surround.ts" rows. It renders, it says
  something plausible, and the whole group is inert. **THE THREE LISTS ARE ONE
  CONTRACT**: `SavableFile`, `vite.config.ts`'s `EDITOR_SAVABLE_FILES`, and
  `sourceStore.ts`'s map — a file missing from the second is a 403 on save, and
  one missing from the third cannot be READ at all. `test-archway.ts` asserts it
  for both files. Two assertions in `test-garden-props.ts` were also left red by
  IDEA-066 and are fixed here: the treehouses moved to the verge and the checks
  kept reading `placements`, then asserted the APRON's cap rule (`ty === -1`)
  against a VERGE placement, where the cap is south-only.
- **THE MAZE WALL STOPPED BEING A BOX** (IDEA-068). Nuno: *"the maze walls
  look too geometrical and I was thinking, since they are simulating a plant,
  if we can add a little texture, not be so straight and look more like a
  hedge."* He was attacking something this file already carried as a known
  compromise — IDEA-060's clay-render note: *"the HEDGE IS STILL A PLAIN BOX.
  All of its leafiness is paint."* `src/render/hedgeWall.ts` is the answer;
  `scripts/test-hedge-wall.ts` (27 checks, in `npm run test`) guards it.
  **WHAT READS AT 17 PIXELS A TILE IS NOT THE BUMPS — IT IS THE TOON RAMP.**
  Measured off the real render, the board spans 325 CSS px for 19 tiles, so a
  0.08-unit feature is 1.4 px and cannot read as a shape (the same arithmetic
  that made a literal grass blade one pixel, and killed that idea in one
  paragraph). What DOES read is a change of value over a large area: the scene
  is cel-shaded on a 3-step ramp that quantises by the surface NORMAL, so a
  flat top face is one uniform band of green while an undulating one falls
  into two or three and the wall top mottles. **The mottling is the feature;
  the geometry is only how it is produced.** Five constraints, every one
  forced rather than chosen.
  1. **ONE SHARED GEOMETRY, SO THE VARIETY LIVES IN THE INSTANCE MATRIX.** The
     walls are a single InstancedMesh — one draw call for the whole maze, the
     reason a 200-tile board costs less than its biscuits. Every tile gets the
     same lump; what differs is a QUARTER TURN (90-degree steps only, because
     a free angle takes the block's corners off the lattice and opens gaps at
     every junction) and a per-tile CROWN HEIGHT, which is the strongest
     anti-grid signal available because it reads as separately clipped
     sections rather than one extruded ribbon.
  2. **THE FLANKS BULGE OUTWARD ONLY.** Neighbouring tiles butt at their
     faces, so outward merely overlaps — invisible, and what a hedge does —
     while inward opens a gap you can see straight through the wall. Making it
     one-signed makes the defect unrepresentable rather than merely avoided.
  3. **THE CROWN DIPS DOWNWARD ONLY.** `buildHedgeDecor` and `buildWallDecor`
     place blooms, leaf specks and wall-top props at `WALL_H` + 0.04 / 0.06 /
     0.08 — among the tightest numbers in the renderer — and IDEA-068 made the
     crown move underneath them. An upward bump swallows a bloom whole and
     nothing errors. The three of them now read `wallCrownY(tx, ty, shape)`,
     the SAME function the instance matrix uses, so a tile's crown has one
     answer and four callers instead of a constant that used to be true.
  4. **A SEPARABLE EVEN FUNCTION IS WHAT LETS THE CROWN CROSS A SEAM.** The
     first build faded the crown to zero at every tile edge, which guarantees
     neighbours meet flush — and guarantees every tile is its own dome. On a
     straight run that reads as a row of CUSHIONS: a different grid, not less
     of one. `ridge(x) + ridge(z)` with `ridge` EVEN and tile-periodic is
     flush at the seam WITHOUT being zero there (on the +X edge the height is
     `ridge(0.5) + ridge(z)`, on the neighbour's -X edge `ridge(-0.5) +
     ridge(z)`, equal because `ridge` is even), and it survives the four
     rotations because the expression is symmetric in x and z. So the crown
     rolls continuously along a whole run. `crownRoll` mixes it against an
     asymmetric per-tile term that DOES fade at the edges — the asymmetry is
     what makes the four rotations produce four tiles rather than one tile
     turned round, since a symmetric crown is rotation-invariant and rotating
     it buys exactly nothing.
  5. **IT IS DERIVED FROM `wallTexture`, NOT A NEW PALETTE FIELD.** Hedge and
     hedgeFlower get the lumpy block; sand, brick and Arcade Night's flat keep
     their boxes, and `test-hedge-wall.ts` asserts a box theme gets *literally*
     `BoxGeometry` rather than an unmoved hedge block. Deriving is
     `surroundTextureFor`'s reasoning: the two have to relate, so a separate
     slot is only ever a chance for them to disagree. The FOREST and the PARK
     get it too, deliberately — they are hedges wearing the same texture.
     A re-theme must therefore SWAP THE GEOMETRY and re-write the instance
     matrices, exactly as the fence and the ground detail are rebuilt: leaving
     it out stands Night City's brick on the garden's lumpy block, which
     renders perfectly and looks like a texture bug.
  **THE CLAY RENDER IS WHAT SET THE AMPLITUDES**, and the first pass failed it:
  in colour the walls read as convincingly soft, and with every map stripped
  they were still flat-topped slabs with slightly rounded edges — all of the
  softness was the texture, which is IDEA-059's burger lesson in a new place.
  They ship at roughly double that first tuning, and the clay now shows a
  genuinely rolling crown with real steps between sections. Cost: ~38k
  triangles across the maze against the box's 2.4k, and **still one draw call**.
  **AND A TEST THAT LOOKS FOR A VERTEX WHERE IT USED TO BE REPORTS A SOUND
  MODEL AS BROKEN.** The seam check first looked for crown vertices at exactly
  `|x| = 0.5` and found NONE in any of the four rotations — because the flank
  bulge is at its maximum AT the crown, so those vertices sit at 0.5 plus the
  bulge. It measures with `bulge` temporarily zeroed instead (the params table
  is mutable precisely so a test can isolate one dial, as `test-garden-props`
  already does with the rock scatter), and pins outward-only separately.
  **TWO STALE ASSERTIONS FIXED**, both the same family as everything else here.
  `test-garden-props` forbade any wall-top prop whose id starts with
  `flower-` — exact when written, and wrong the moment IDEA-065 split the
  flowers and named the stemless halves `flower-head-*`, which exist
  SPECIFICALLY for wall tops. The rule is about the STEM, so it now tests the
  SHAPE. And `test-editor-board`'s hand-typed list of tree rows went stale the
  moment IDEA-067 added a seventh board slot; it is derived from `BOARD_SLOTS`.
- **THE PHONE WAS DRAWING A NEIGHBOURHOOD IT COULD NOT SEE, AND THE TRAY WAS
  UNDER THE THUMB** (IDEA-069). Four of Nuno's notes off one play session, and
  three of them are the same shape: something sized for the union of every case
  instead of for the case in front of it.
  1. **THE SURROUND IS CULLED TO THE FRAME'S OWN GROUND FOOTPRINT.** *"Much of
     that doesn't show, so we can optimize the render of the maps for mobile to
     only render the necessary to cover the view."* `SURROUND_PARAMS` ships the
     UNION of all eight sampled aspects (halfWidth 50) because one baked recipe
     had to satisfy every one of them — but a PORTRAIT frame reaches |x| ~15.3
     and z -38.7..+22.4, while a 16:9 desktop reaches |x| ~31.6 but only
     -21.2..+11.9. So a phone was building, merging, uploading and drawing a
     band more than three times wider than it can see, and a desktop one far
     deeper. `scene.ts`'s `resize()` drops the four frustum corners onto y = 0
     — exact rather than sampled, and sound only because
     `_scratch-surround-coverage.ts` proved THE HORIZON IS NEVER IN SHOT so all
     four rays hit — and hands the box to `SURROUND_VIEW`. Measured saving on a
     phone: garden surround **98,948 -> 34,264 triangles (-65%)**, forest -63%,
     park -61%, city -67%, beach -51%; Night City's whole frame drops 35%. Draw
     calls are unchanged, because the merge is by material and the material set
     did not move.
     Three things keep it safe. **THE GROUND PLANE IS NOT CULLED** — it is two
     triangles, and IDEA-066 rule 1 is explicit that a visible world edge at an
     untested aspect is catastrophic while the margin costs nothing; only the
     PROPS are culled, which is the entire cost. The box carries a **6-unit
     margin** and is **clamped in both directions** — never past the ground that
     exists, never tighter than the keep-clear box, so a frame that somehow
     measures tiny cannot delete the neighbourhood. And it is **quantised to 4
     units**, because a resize fires on every pixel of a window drag and the
     key would otherwise rebuild several hundred props per frame.
     The view is part of the content key, so `ensureSurround` rebuilds on a
     real change and no-ops otherwise; `refreshSurroundForView` is how a
     resize — which happens in `scene.ts`, with the camera and no idea what
     theme is on — reaches the board, which knows the theme and never hears
     about a resize. It remembers the last build rather than threading a
     rebuild callback through `buildBoard`, `applyBoardTheme` and every caller.
  2. **THE POWER-UP TRAY MOVED ABOVE THE BOARD.** *"When a player uses the
     buttons or joystick the power-ups are on the same zone."* It sat UNDER the
     maze, which is exactly where both control schemes live — so the readout
     you glance at mid-chase was under the hand steering with it. The whole
     apparatus that existed to manage that (anchor to the pad, grow upward, a
     rule per scheme, `--bc-pad-block` so neither had to ask which was on
     screen) is **deleted**, not adjusted: moving the tray to the other side of
     the board removes the collision instead of arbitrating it. `scene.ts` now
     publishes **`--bc-board-top`** beside `--bc-board-bottom`, for the same
     reason it always published the bottom — the maze is 3D and CSS cannot know
     where it starts. Anchored by its BOTTOM so the row grows upward as it
     wraps, which is exact at any number of chips where a top anchor plus a
     guessed height is one line from putting chips on the maze.
     **MEASURED BEFORE SHIPPING** (`_scratch-tray-band.ts`, the real rig at six
     framings): the band above the board is 152px at 390x844, 132px at 360x780,
     168px at 414x896 and 69px at 820x900 — against a 42px chip. Landscape has
     no band at all (-44px at 844x390), which is why the two landscape blocks
     that put the tray in a corner or a side rail are untouched and still win.
  3. **THE D-PAD'S GAP WENT TO ZERO.** *"Put closer the buttons, the arrows be
     more close."* The pad is a 3x3 grid with an empty centre, so its gap is
     added to the hole TWICE — at `--bc-s2` the arrows sat 76px apart on a 60px
     button. `--bc-dpad-gap: 0` makes the hole exactly one button wide, which is
     the classic proportion and as tight as this construction goes: tightening
     further means shrinking `--bc-touch-dpad`, already near the 44px a thumb
     needs.
  **AND A CHECK THAT SAMPLES A SINE TWICE IS A COIN FLIP.**
  `test-editor-board`'s "the empty marker's opacity PULSES" read the value
  twice 700 ms apart against a `sin(t * 2.4)` pulse — 1.68 rad, which is EQUAL
  at both ends whenever the pair straddles a peak symmetrically. It failed a
  sound build once in three runs. It now takes max-minus-min over six samples
  across a full period, which is strictly STRONGER (a static value still
  fails, and every phase of a pulsing one passes) rather than a threshold
  loosened until it stopped complaining. Fourth stale/fragile assertion in
  that one suite in a day, after the hardcoded tile, `placements[0]` and the
  typed-out tree rows.
  4. **THE FLOWERING HEDGE WENT TO TWO DAISIES A FACE.** *"The hedge flower
     have too much flowers, lets make the hedge flower with less flowers, like
     just a few flower to be more clean."* Nuno had already voted with the
     editor — he moved the garden OFF `hedgeFlower` onto the plain `hedge`
     rather than keep it. The count has now come down THREE times (14 -> 6 -> 4
     -> 2) and every time for the reason worth stating plainly: **the reference
     shows ONE FACE OF ONE HEDGE, while this texture wraps all six sides of
     every one of ~200 boxes**, so whatever density looks right in isolation is
     multiplied by twelve hundred faces and the sum is a pattern rather than a
     scatter. The garden is back on `hedgeFlower` with the thinner count —
     without that the change would have had no visible effect at all.
- **THE TRAY WENT TO THE TOP OF THE BAND, AND THE SOUTH GOT BUILT ON**
  (IDEA-070). Two notes off the next play session, and the second one is mostly
  a lesson about measuring before tuning.
  1. **THE POWER-UP TRAY ANCHORS TO THE HUD, NOT TO THE BOARD.** Nuno: *"put
     them more up, right below the coins and the control buttons — this way the
     tags of the power-ups don't mess around with the ambient, right now they
     are hiding some trees."* IDEA-069 put the tray in the band above the maze
     and anchored it to `--bc-board-top`, which parks it at the BOTTOM of that
     band — on the neighbourhood. The chips are chrome and belong against the
     chrome, so `hud.ts` now publishes **`--bc-hud-bottom`** and the tray hangs
     off that, growing DOWNWARD into the band.
     **It is measured with a `ResizeObserver`, not a constant**, and that is the
     load-bearing part: the row's height is CONTENT-dependent — the map chip
     runs from "5" to "115" to "Bonus", the score column grows with the figure,
     a narrow phone can wrap the whole row — so a literal offset is one that has
     to be re-tuned whenever anything above it changes, which is the exact trap
     the HUD's chrome row was rebuilt to escape in IDEA-048. A `resize` listener
     would not do: the row changes height when its CONTENT changes, which a
     window resize never hears about.
     Downward is now the safe direction (the worst case is a row touching the
     top of the maze, where this tray has always been a scrim readout anyway);
     upward would put it through the HUD.
  2. **THE SOUTH BAND LOOKED EMPTY BECAUSE ALMOST NOTHING WAS EVER BUILT THERE,
     AND THE ARCHETYPE MIX WAS NOT THE REASON.** Nuno: *"on the bottom of the
     maze, on the zone we have the buttons and the joystick, we should balance
     the world — there are no houses or greenhouses there."* The obvious fix is
     to let the south PLOTS take buildings, and that is done
     (`southAllotmentChance`) — but **measured, it barely shows**. On a phone
     the visible south window is z 14.5..22.4 and the plot lattice lands at
     22.5..24.1: exactly ONE plot falls inside it. Tuning the mix harder would
     have changed almost nothing and looked like the change had failed.
     **The FRINGE is the layer that owns that annulus** — IDEA-066 rule 7 added
     it for precisely this gap ("a plot row straddling the keep-clear boundary
     is dropped whole, which on the south side left the nearest five units
     bare") — so that is where a south building has to come from.
     `southFringeBuildings` is the dial that actually fills the band.
     **GREENHOUSES, NOT SHEDS, AND THAT IS A VALUE DECISION.** The first tuning
     split them evenly and the render said no: a shed is a small RED roof, the
     flower beds out here are small dark RED rectangles, and at that size on
     dark lawn the two are the same mark. A greenhouse is PALE — its identity
     rank 1 is a pale box on a dark plinth — so it is the one building in the
     set that separates from everything already standing there. It ships 78%
     greenhouse.
     Both south buildings are held to about three quarters of their eaves
     width, the same lever every other south branch in that file already pulls:
     the band is unfogged, nearest the camera and the largest anything in the
     surround ever draws, so a building at full size there does not read as
     further away, it reads as bigger than the maze. A full HOUSE still never
     appears in the south.
  **AND THE SUITE CAUGHT THE MISSING DIAL BEFORE THE EDITOR DID.**
  `test-surround.ts` asserts that every `SURROUND_PARAMS` field resolves in the
  World tab, so adding `southAllotmentChance` failed the build until it was
  exposed — which is that check working exactly as intended, and the reason a
  new dial cannot ship as a number only its author knows about.
- **THE NEIGHBOURHOOD'S ART: GLASS, BEDS AND BORDERS** (IDEA-071). Four notes off
  the play session after IDEA-070, all about the surround's ART rather than its
  machinery, plus one defect that turned out to be structural. Seven rules.
  1. **THE TOON RAMP HAS A BAND BOUNDARY AND YOU CAN SOLVE FOR IT.** The single
     most reusable thing this run produced. `toonGradient()` is three texels
     (70/160/255) sampled with `NearestFilter`, so a lit surface is in the TOP
     band whenever `dot(N, L) > 2/3`. The key light sits at (6, 20, 10), i.e.
     `L = (0.259, 0.864, 0.432)`. At the greenhouse's measured 18.3-degree roof
     pitch both slopes measure **0.90 and 0.74** against that — both over 2/3 —
     so the gable was painted ONE uniform value and the building rendered as a
     blank white card lying on the grass, which is exactly what Nuno reported as
     *"the greenhouses are not transparent, it's just a small white house."*
     Solving `0.864 cos a - 0.259 sin a = 2/3` puts the split at **25.6
     degrees**; it ships at 27.5. **Before deciding a form is not reading,
     compute whether this renderer can distinguish its planes at all** — and
     note the same arithmetic says a gable whose ridge points along the light's
     own azimuth (59 degrees off +x) can never split, at ANY pitch, which is why
     rule 2 exists as well.
  2. **A PAINTED LINE READS AT EVERY YAW; A SHADED EDGE DOES NOT.** The
     greenhouse gets a thin dark RIDGE in `m.glass` as well as the steeper
     pitch — IDEA-060's pale ridge cap on the house, inverted, twelve triangles,
     and no extra draw call because that material is already on the building.
  3. **A GLAZING GRID IS BELOW THE RESOLUTION FLOOR, AND THE ARITHMETIC IS WORTH
     KEEPING.** The building is ~25 CSS px across on a 390px phone, so one world
     unit is ~15 px and a bar thick enough to reach the CARTOON floor of 2 px is
     `EW * 0.08` — four of them would be 59% of the roof. So the roof is broken
     up by whole dark PANES instead of by the lines between them, which is also
     what a glasshouse looks like from above: some panes return the sky and some
     return the dark interior. They lie **FLUSH** — they shipped for one render
     as vents propped open at -0.55 rad, and a thin box tilted that far
     foreshortens from 59 degrees into a **TRIANGLE**, so it read as three black
     wedges on a white slab, i.e. as damage rather than as glazing.
  4. **PHOTOGRAPH OR DRAWING: the question decides, and the greenhouse is the
     proof.** Nuno asked whether the cartoon references he had been sending were
     easier to read than the photographs he sent for these three. Use a
     **PHOTOGRAPH** when the question is proportion, value structure, or what a
     thing is made of; use a **DRAWING** when the question is silhouette and
     identity. A cartoon greenhouse is drawn as a white box with lines on it, so
     it would have CONFIRMED the bug; the photograph is what said a real one has
     a pale translucent roof and CLEAR walls you see a dark interior through —
     so the walls are the **darkest** part of the building, not the lightest.
     IDEA-059 rule 8's caveat sits on top of this and is not replaced by it: a
     flat drawing carries its own compensations (an ink keyline, a stylised
     highlight) that a toon mesh has none of, so measuring the reference
     correctly is necessary and not sufficient.
  5. **THE FLOWER BEDS ARE ROUND, AND ROUND IS RANK 1.** *"The flower beds don't
     look like flowers."* They were a brown RECTANGLE carrying four small
     spheres of two colours, spaced apart — four separated dots on dirt read as
     pebbles. Rebuilt from the reference as a pale stone kerb ring round dark
     mulch (the greenhouse plinth's two-mass trick, which the reference
     volunteers just as plainly), a packed mass of blooms on a **golden-angle
     `sqrt(t)` spiral** so they distribute evenly BY AREA and overlap into one
     form, and a centre sapling. Being round is what does most of the work:
     everything else out there is a rectangle, so a disc is instantly not a
     building. `SurroundMaterials` gained a **`bloomC`** for it — every theme's
     `bloomColors` carries three or four hues and the set was throwing the
     middle ones away, so the garden's [cream, yellow, pink, red] shipped as
     cream and red only. One extra draw call against a measured 13-14 of an 18
     ceiling; a fourth would not obviously be affordable.
  6. **THE FLOWERING SHRUB IS A BORDER, NOT A SHRUB, AND THAT COST TWO BUILDS.**
     The reference is a border of forsythia, berberis and aubretia — plants with
     **no green left**, solid blocks of one saturated colour, which is an ideal
     subject here because it is pure hue over a large area and needs no detail.
     Built first as the brief sounded — an object, drifted, scattered through
     the plots — it rendered as **LITTER**: a saturated mass 0.9 units tall
     alone on a lawn is a red crisp packet, and a detail-0 icosphere's faceting,
     which green-on-green hides completely, is glaring the moment the colour is
     loud. Built second as a tight run it was a string of **BEADS**, because
     `distantHedgeRun`'s 2.4h step against a 2.16h blob is a hair under
     continuous and only gets away with it *between two greens* — between two
     saturated hues every seam is a hard edge. It ships as a LOW (0.22-0.30) run
     of few, very wide (2.8x along, 1.9x across), heavily overlapping blobs in
     contiguous HUE blocks, laid just inside one of the plot's own hedges.
     **The placement is the difference between a border and litter**, for the
     same reason `hedgePerimeter` exists one scale up: the boundaries are what
     turn a scatter of objects into somebody's garden. Deliberately absent from
     the FRINGE, which has no hedge to stand against and is the nearest,
     least-fogged, largest-on-screen part of the whole band.
  7. **"WE HAVE GREENHOUSES INSIDE THE HOUSES" WAS NOT A SPACING NUMBER, WHICH
     IS WHY NUDGING ONE NEVER FIXED IT.** Two causes stacked. The outbuilding
     always offset in `u` and barely in `v` — correct for an east/west plot and
     wrong for a north or south one, where it left the two 1.78 units apart
     needing 1.9. And underneath that, **it does not fit**: a house runs up to
     4.7 x 3.7 world units at the top of `plot.scale` and an outbuilding
     2.3 x 2.7, in a plot of 7 x 6, so 3.7 + 2.7 > 6 and 4.7 + 2.3 = 7 exactly —
     on those plots there is no pair of fractions that works and every choice is
     just choosing where to clip. It is now SOLVED rather than tuned: four
     candidate corners are tried against the house's real **vertex-measured**
     footprint (never `Box3.setFromObject`, which over-reports a rotated child
     by up to 56%, and every building here is placed with a rotation), and a
     plot that cannot fit one simply has none. About one house plot in ten loses
     its shed — a missing shed is invisible, a shed inside a house is the first
     thing anyone sees. The allotment's greenhouse/shed pair gets the same
     solve.
  **AND THE MERGE IS WHY THAT DEFECT HAD NO TEST.** `mergeBySignature` welds the
  whole band into one mesh per material, so by the time anything can look at the
  finished group every object's identity is gone. **`buildSurroundContent`** is
  the band UNMERGED, split out of `ensureSurround` purely so a test can reach it,
  and `distantHouse` now names its group `building-<kind>` so the test can find
  them again; `test-surround.ts` measures all 92 against each other.
  Its own first version asserted `overlap < gap`, which reads perfectly well and
  **PERMITS** an overlap of up to `gap` instead of requiring one — it passed five
  pairs clipping by exactly 0.12, 0.07 and 0.03, i.e. by precisely the tolerance
  it thought it was enforcing. A gap is a NEGATIVE overlap.
  Instrument: `scripts/_scratch-building-overlap.ts` prints every overlapping
  pair with both footprints, which is what turned "they look wrong" into the
  plot-does-not-fit arithmetic above.
- **THE MENU AND THE SHOP GOT THE AMBIENCE TOO** (IDEA-072,
  `src/render/showcaseSurround.ts`). Nuno, after IDEA-071: *"the preview of the
  home screen and the shop — since we have now this logic of the ambience,
  let's bring that to the menus... and hide the blue part."* The blue part was
  literal and it was most of both screens: the menu beagle stood on a
  1.15-radius soil disc with three hedge blocks behind it and, past the rim, NO
  GEOMETRY AT ALL — about 70% of a 390x844 frame was gradient dome, and the
  disc read as a diorama on a table. Eight rules.
  1. **THE BOARD'S FIX DOES NOT PORT, AND THE CAMERA IS WHY.** IDEA-066 could
     answer "empty sky" with a bigger floor because
     `_scratch-surround-coverage.ts` had PROVED the board's horizon is never in
     shot: it pitches 59 degrees down with a 23-degree half-FOV, so the top of
     frame still points 36 degrees DOWNWARD. These rigs are nothing like that,
     and the numbers are worth keeping because they decide everything below:
     **menu 14.2 degrees of elevation (horizon 17% from the top of frame),
     shop character 9.5 (27% from the top), shop diorama 33.3 (horizon OFF the
     top).** On the two character stages ground can only ever fill UP TO that
     line; what fills the rest is **things that stand up on it**. So the module
     is a ground plane AND a fogged band of the theme's own neighbourhood
     sitting on the horizon — where the board needed only the first.
  2. **THE SKY ABOVE THE HORIZON STAYS SKY**, deliberately. It is where sky is,
     and it is where the menu's title, the coin chip and the shop's tab rail
     sit. The brief was "hide the blue part", not "fill the frame".
  3. **THE BAND IS FAR, AND THAT IS ARITHMETIC.** The subject is ~0.6 units at
     3.2-5.3, so the frame is only ~4 units tall where it stands and a 2.2-unit
     house at 8 units would be half the screen. It ships at **34-60 units**,
     retuned from a first pass at 26-44 for a second reason: a
     `lobedFoliageGeometry` at `detail: 0` is twenty faces, invisible on the
     board at 15-40px and GLARING at 80 — the near ring's tree crowns came back
     as pale hexagons, which is IDEA-071's flowering-border lesson in a new
     place. Pushing the ring out fixes the faceting and the scale together.
  4. **A HORIZON READS ON BEING CONTINUOUS.** The first build ran 14/21/28 per
     ring and, after the behind-camera wedge takes its 28%, that is about seven
     objects across the whole visible horizon — a few lonely props in a field.
     It ships at 34/48/62/76 over four rings, and the fog is what stops
     continuous from becoming a wall.
  5. **THE BACKDROP DOME RENDERS ~40% DARKER THAN ITS PALETTE SAYS, AND HAS
     SINCE IDEA-021.** Those gradient shaders are hand-written and set
     `gl_FragColor` with no colour-space conversion, so the renderer's
     linear-to-sRGB output step never runs on them and the sky is displayed as
     its LINEAR triple read raw. Measured to the byte: `palette.bg` 0x9ecbe8 =
     (158, 203, 232) renders as **(87, 152, 206)**, which is exactly its own
     linear (0.342, 0.597, 0.807) shown as if sRGB. **Deliberately NOT fixed
     here** — correcting the shader would change the sky on the menu, both shop
     stages and the game's own backdrop at once, which is a visual change to
     something tuned by eye and nothing to do with this feature. It matters
     because FOG is converted properly: handed the palette hex it lands ~40%
     too light and paints a pale band across the horizon, precisely where this
     feature has to be invisible. `horizonSkyColor` hands the dome's linear
     triple back as an sRGB triple, which reproduces what the screen shows.
  6. **FOG REACH AND BAND EXTENT ARE TWO NUMBERS, AND FOG IS MEASURED FROM THE
     CAMERA.** Two separate defects, each of which rendered as nothing and
     neither of which any render explains. (a) The far plane was first derived
     from the band's outer radius measured **from the stage centre** — true
     enough for the character rigs at 3.2 and 3.6 units out, and false for the
     diorama at **10.6**, whose band at radius 12.9-22.8 is 23-33 units from
     the camera against a far plane of 21.7: built, merged, added to the scene,
     invisible. (b) Then reach was still derived from the band, so a stage with
     NO band got a far plane at its own camera distance and the theme diorama
     came back as an **empty blue screen** with the model fogged out from eight
     units away. `ShowcaseStage` now carries `bandScale`, `camDist` and
     `fogReach` separately; only the near/far RATIO is taken from the palette,
     because that is what actually carries the per-theme character (garden and
     beach 2.7, a long soft fade; forest and city 1.9-2.0, depth swallowed).
  7. **THE DIORAMA GETS GROUND AND FOG AND NO BAND**, solved rather than
     guessed. Its camera sits 9.2 units from the stage centre horizontally at
     33.3 degrees with a 20-degree half-FOV, so the top of frame points 13.3
     degrees DOWN and meets the ground **17 units past the stage centre**. A
     band inside that line sprawls hedges and flower borders across the top of
     the picture at near-full saturation; past it, the only thing that ever
     reaches the screen is a CROPPED fragment along the frame edge. Both were
     rendered and both read as debris. `bandScale: 0` is the contract, and the
     ground alone is IDEA-066's answer applied where it does fit.
  8. **`surroundTextureFor` IS A CACHE, AND WRITING `repeat` ON WHAT IT RETURNS
     REACHES THE BOARD.** The first version set the showcase's tiling straight
     onto the texture the board's own surround holds — same object, one
     `repeat` — so opening the shop and then starting a run would have tiled the
     board's ground at the menu's density, whichever built last. It clones
     instead (sharing `.source`, so no second upload), which is also where the
     **anisotropy** goes: a ground plane seen from 3 units up is the textbook
     anisotropic case and isotropic minification smeared the lawn's tonal blobs
     into dark lenses. The board never needed it because it looks DOWN at 59
     degrees. The clones are never disposed, for `surroundTextureFor`'s own
     reason — and because disposing one would free the source the original
     still needs.
  **v2 PUT THE GAME ITSELF BEHIND THE DOG**, after Nuno: *"bring the trees
  closer to the dog, and the main props of each theme like the walls of each
  theme should appear, the treehouse of the garden for example. Another thing
  we can make is to put the beagle stopped and behind him the arch of each
  theme."* Three asks, and ONE composition answers all of them because it is a
  place the game already has: **a tunnel mouth.** A run of the theme's real
  maze wall, an arch standing in the gap, the beagle in front of it facing out.
  `buildStageDressing` is that stage, and it is both a portrait and a
  screenshot of the game. Six rules.
  1. **THIS IS THE ONE CAMERA AN ARCH READS ON, and it contradicts IDEA-067
     unless you know which camera each note is about.** That rule says an arch
     at the PLAY camera reads in PLAN, not elevation — the board pitches 59
     degrees down, so a portal's near jamb eclipses its own opening and the
     whole thing renders as a green slab, which is why the shipped arch is a
     low arbour. Here the camera sits at 14 degrees, nearly level, and an arch
     facing it reads exactly as an arch. Same prop, opposite constraint.
  2. **THE ARCH IS TINTED FROM THE PALETTE, NOT TAKEN FROM `theme.tunnelArch`.**
     Only the garden names one, deliberately — IDEA-067 rule 5 keeps a yew
     portal off the beach's tunnel mouths, and setting `tunnelArch` on five
     more themes to fix a MENU would change five BOARDS. `makeArchway` already
     takes `foliageColors`, `blossomColor` and `stoneColor` as params, so the
     showcase builds its own from the theme exactly as `makeSurroundMaterials`
     does: every theme gets a coherent arch and no board changes at all.
  3. **THE WALL IS THE REAL ONE**, `wallGeometry` + `wallShapeFor` +
     `wallTextureFor` — the same block and the same cached texture the maze
     builds from, so a hedge theme gets IDEA-068's lumpy crown and Night City
     its brick. What it replaces says why the ask was needed: the menu's
     stand-in was five 0.5 x 0.28 boxes and the shop's was two 0.42 x 0.26
     ones, i.e. a doll's-house hedge. Both are now `visible = false` rather
     than deleted, because `applyPatchTheme` still tints them and because they
     are what the scene falls back to if the dressing is ever switched off.
  4. **THE LANDMARKS ARE THE REAL LIBRARY PROPS.** `makePropFromDef` off
     `PROP_LIBRARY`, so the menu plants the same treehouse the garden does
     rather than a lookalike that drifts out of step with it — the standing
     reason `DIORAMA_SIGNATURE_IDS` exists. Arcade Night's list is EMPTY, as
     everywhere else in this feature.
  5. **A PORTRAIT FRAME IS MUCH NARROWER THAN IT LOOKS, AND IT IS WHAT SIZES
     EVERYTHING.** The menu dollies to 5.3 units on a phone at a 42-degree
     VERTICAL FOV, so at aspect 0.462 the HORIZONTAL half-angle is only 10.1
     degrees — the visible world at the wall's depth is about 3.2 units across.
     A first pass at `archHeight` 0.78 was 1.87 units tall and ~1.4 wide, which
     filled 58% of that width and ran off the top of the frame: an arch that
     dwarfed the dog it was meant to frame. It ships at 0.6, and the stage sits
     at z = -4.2 rather than -3.6 because at the closer desktop dolly the
     crown landed behind the "Beagle Chomp" title.
  6. **A LANDMARK WITH A FRONT TURNS IT TOWARD THE VIEWER** (Nuno: *"rotate
     the treehouse to have the front of the treehouse pointing to the user"*).
     Every landmark was taking a random yaw, which is right for a tree and
     wrong for a building — a treehouse showing its blank side wall is the same
     prop with its one recognisable face turned away. `SHOWCASE_FRONTED` names
     the ones with a face and **membership is VERIFIED, not guessed**, because
     the whole thing turns on which way a prop's local axes point and being
     wrong shows the BACK: the treehouse's door, window and plank grooves all
     sit at `bodyD / 2` on **+Z** (`gardenProps.ts`) and the log cabin's door
     and step at `halfL + proud`, likewise +Z (`forestProps.ts`). That is the
     house style, but it is a CONVENTION rather than a guarantee. It aims at
     the CAMERA rather than at world +Z — a landmark 1.9 units off the centre
     line and 8 back is about 10 degrees round, and squaring it to the world
     still shows a sliver of side wall. Organic props keep their random yaw
     deliberately: a tree has no front, and a row all turned the same way is a
     row of clones.
  7. **AND THE TURNTABLE IS OFF ON THE MENU ONLY.** A spin exists to show a
     coat from every angle, which is the SHOP's job. The menu's job is a
     portrait, and a dog revolving inside a fixed archway reads as a display
     turntable in a shop window — the same "diorama on a table" note this whole
     feature started from. `TURNTABLE_SPEED` is kept as a named constant, not
     deleted: it is a staging decision and reversible in one line.
  **THE BAND CAME BACK IN, 34 TO 26, AND THE HONEST FIX WAS NOT UNDOING v1.**
  v1 pushed it OUT to 34 because at 26 the near ring's tree crowns read as pale
  HEXAGONS — a `lobedFoliageGeometry` at `detail: 0` is twenty faces, invisible
  on the board where a crown is 15-40 px and glaring the moment it fills 80.
  Nuno's "closer" note was about a different thing: the MIDDLE DISTANCE was
  empty. With `buildStageDressing` filling 5-13 units with library props — which
  carry proper detail, having been authored for a camera two tiles away — the
  band is a horizon again rather than the only content, so it comes back to
  26-52 and the two ranges chain instead of leaving bare lawn between them.
  **AND `mergeBySignature` WAS DROPPING `uv`, ONE ATTRIBUTE ALONG FROM THE
  VERTEX COLOURS IDEA-067 FOUND.** A merged geometry with no UVs samples texel
  (0, 0) for every vertex, so a TEXTURED material comes back as one flat colour
  — the corner of its own canvas. It stayed latent through the whole surround
  because nothing out there carries a map (`makeSurroundMaterials` builds plain
  `toon` colours), and it surfaced the instant a showcase stood the real maze
  wall behind the beagle: eleven hedge blocks rendered as plain green boxes.
  Fixed in `propMerge.ts` with the same treatment the colour attribute got.
  **THE THEMES TAB NOW ADVERTISES THE THEME, NOT THE ONE YOU OWN.** `showTheme`
  applies the STAGED theme's palette to the surround, so tapping Deep Forest
  puts the diorama on forest earth under forest fog. The sky stays the equipped
  theme's (the dome is only lerped 35% by `tintAtmosphere`), and that mismatch
  is invisible on that one stage for a concrete reason — its horizon is off the
  top of the frame, so there is no sky-to-ground seam on screen to disagree at.
  `restoreAtmosphere()` puts the surround back, and the surround call lives
  INSIDE that function rather than beside its four call sites, which is the
  same reason the function exists at all.
  `scripts/test-showcase-surround.ts` (85 checks, in `npm run test`) is pure and
  guards the four invisible defects plus the two contracts — the SUBJECT is at
  zero fog on every theme at every stage (the constraint that binds all the
  others: a hazy dog is worse than the void it replaced), the fog clears the
  band, `scale: 0` and `"none"` both build nothing, and the band merges to one
  mesh per material. Its own first version failed the BEACH on a correct model
  by asserting no vertex sits below zero: `distantDune` is a blob centred at
  y = 0 and flattened to 0.12, so half of it is under the sand ON PURPOSE. It
  asserts nothing is entirely BURIED instead. Suspect the instrument first.
  `scripts/_scratch-showcase-sheet.ts` is the browser sheet — menu plus all
  three shop tabs plus every theme card, at phone and desktop. **Signup is
  rate-limited to 5/hour per IP**, which is two runs, so it takes `KEEP=1` to
  leave an account behind and `USER_NAME=<name>` to log back into it.
- **THE WORLD HAS A SOUND NOW, AND TWO BUTTONS DECIDE WHICH HALF YOU HEAR**
  (IDEA-073). Nuno: *"lets add music, like a relax ambience music related to
  each theme... the garden we can keep the birds we already have but lets put
  that on the game moment too. On the beach the sound of the waves. On the deep
  forest something related to the forest. On the city some car sound but
  relax."* Then: *"add a new button to silence the beds on the gaming moment and
  let the one we have to silence the eating biscuits. On the profile account
  menu add a section to manage the volume."* `src/ui/ambience.ts` is the engine,
  `scripts/test-ambience.ts` (35 checks, in `npm run test`) guards it.
  **THE ASSESSMENT THAT OPENED IT IS THE PART WORTH KEEPING, because the
  question turns on something easy to get wrong: there is no "sound API" here
  that supplies sounds.** `sound.ts` is ~900 lines of hand-written Web Audio
  synthesis and this project ships ZERO audio assets. So "can we have waves"
  was never a lookup, it was "can we build one" — and the four Nuno named are
  the four best cases synthesis has, because surf, wind and distant traffic are
  all literally filtered noise with a slow swell on the cutoff, and birdsong is
  a short pitch sweep. **Two of the five were already written and nailed to the
  menu**: `chirp()` was the garden, and the menu bed's own "distant traffic"
  low-passed to 320 Hz was the city. Seven rules.
  1. **AMBIENCE YES, MUSIC NO — AND THAT IS A RECOMMENDATION, NOT A LIMIT.** A
     composed melody would need audio files (~200 KB-1 MB a theme, precached,
     fetched), which breaks the generated-never-fetched rule this project got
     burned by once already with the Google Fonts incident. It is also the
     wrong thing: in a chase game a melody loops and grates inside three
     minutes where a texture never does. **Arcade Night gets SILENCE** (Nuno's
     call) — it is the neon tribute board whose `surround` is already `"none"`.
  2. **THE BEDS STAY OUT OF THE CHOMP'S BAND, AND THAT IS THE WHOLE ANSWER TO
     "feels good anyway".** `biscuit()` is a 340-520 Hz triangle blip and it is
     the most frequent sound in the game, so every bed lives at the EXTREMES —
     rumble and traffic under ~320 Hz, leaves and birds over ~1.2 kHz — and the
     middle is left to the cues. It is a FREQUENCY split, not a volume fight.
     Measured by `scripts/_scratch-bed-spectrum.ts`, which renders each bed in
     an `OfflineAudioContext` and filters it into three bands: the five run
     0.010-0.027 rms against the chomp's 0.16 peak, with the chomp's own band
     at 9-26% of the bed's low band.
  3. **RELAXING IS A TIME-SCALE, NOT A LEVEL.** Every modulator runs at
     0.026-0.058 Hz (17 to 38 seconds a cycle) and every pair on one bed is
     deliberately INCOMMENSURATE, so the combined swell never repeats on a
     period the ear can learn. Events are on a random interval for the reason
     the menu bed's birds always were: anything on a fixed timer reads as a
     machine.
  4. **THE MEASUREMENT FOUND A REAL LEAK THAT NO AMOUNT OF READING THE NUMBERS
     WOULD HAVE.** The forest's leaf layer was a bandpass at 1900 Hz — clearly
     above the chomp — with **Q 0.5** swinging +-700. A Q that low is very
     broad, so at the bottom of the swing its lower SKIRT reached down into the
     340-520 Hz band, and the forest alone measured a mid band as loud as its
     low. Rule 2 was being honoured by the centre frequency and broken by the
     skirt. It ships at 2200 / Q 0.9 / +-500 and now measures the cleanest of
     the five (9%).
  5. **THE TWO MUTES ARE TWO BUSES, AND THE OLD ONE KEEPS ITS NAME.**
     `master` forks into `sfxBus` (game cues, with `uiBus` under them) and
     `bedBus`. `setMuted`/`bc_muted` still mean EFFECTS, so nothing that
     already called them changed; `setBedMuted`/`bc_bed_muted` are new. Each
     bus carries its own persisted volume, and the bed's is RAMPED over 60 ms
     rather than assigned — a slider being dragged writes it on every input
     event and stepping a live noise bed's gain is audible as zipper noise.
     **Persistence is `localStorage`, deliberately NOT the account**: volume is
     a DEVICE preference (the same player wants it off on a phone in public and
     on at a desk), and it avoids a migration — which, per the control-scheme
     note, is what adding a per-account column costs.
  6. **THE BED FOLLOWS `sceneThemeId`, NOT THE EQUIPPED THEME.** A challenge
     level forces its own theme, owned or not, so keying the bed off what the
     player owns would leave the ears in a different place from the eyes — the
     audio version of the bug `restoreEquippedTheme` exists to stop. One
     `syncAmbience()` reads what the board WEARS, and every site that can
     change the scene theme calls it unconditionally, which is free because
     **`ambience()` no-ops when the bed is already playing**. That no-op is
     load-bearing rather than an optimisation: classic mode plays up to 36
     levels on one theme and `startLevel` calls this every time, so without it
     the bed would tear down and cross-fade at every level boundary — an
     audible hiccup on the one sound that is meant to be seamless. For the same
     reason `hideMenu` does NOT stop the bed: a run starts in the place the
     menu was standing in.
  7. **`MazeTheme.ambience` IS REQUIRED, UNLIKE `secret` AND `tunnelArch`.** A
     theme with the field missing does not compile; a theme with `"none"` is
     silent and builds perfectly, which is the real failure mode — so
     `test-ambience.ts` asserts exactly one theme is silent and that it is
     Arcade Night, and that **no two themes share a bed** (a sixth theme is
     added by duplicating an entry, and the bed is the field most likely to be
     left pointing at its donor). The theme answers WHICH and `ambience.ts`
     answers HOW, exactly the split `tunnelArch` draws. `boardCodegen` writes
     it as a quoted literal — unquoted emits `ambience: birds,`, a themes.ts
     that does not compile.
  **THE NOISE BUFFER IS SIX SECONDS, NOT `sound.ts`'S 1.5.** That one is fine
  for one-shots and for a heavily low-passed rumble, where a 1.5 s period is
  below anything the ear picks out — but a BRIGHT looping layer develops an
  audible 1.5-second pulse within a few passes, and a bed that ticks is the
  opposite of what this module is for.
  **v2 PUT THE MENU BACK TO ONE BUTTON.** Nuno: *"on the main menu we can only
  have one button because we only have one sound on the menus; on the game yes
  keep the two buttons."* A RUN has both layers going at once and they compete
  for the same ears, which is the entire reason the split exists; a menu does
  not, so two controls there are two switches for one decision. The menu's is
  therefore `.sound-btn`, a **MASTER** toggle over both flags, and NOT
  `.mute-btn` — `attachMuteButton` claims every `.mute-btn` on the page for the
  effects flag, so leaving that class on it would have quietly made it an
  effects-only control again. Master rather than bed-only is the one judgement
  call: the bed is the only thing you hear CONTINUOUSLY on the menu, so
  bed-only is the other honest reading — but the interface taps play there too
  and the menu is the only place this button can be reached before a run, so
  bed-only would strand them behind a slider on the account screen. It is a
  regression on what this same button did before the split. **OFF means BOTH
  are off**, and pressing it half-muted silences the rest rather than un-muting
  half: "make it quiet" is what a player means by pressing a speaker with a
  line through it, and the alternative makes the icon lie about its own state.
  **AND TWO TOGGLES OVER OVERLAPPING STATE NEEDED A SUBSCRIPTION.** Muting
  effects in the HUD changes what the menu's master button ought to be drawing.
  Before the split that was free — one handler drove every `.mute-btn` — so
  `sound.onStateChange` is what replaces it, and every attached button
  re-renders on any mute change. Without it the menu icon is exactly the "two
  attachments that could disagree about whether sound is off" that
  `attachToggle`'s own comment warns against.
  **THE FOURTH HUD BUTTON WAS MEASURED, AND THE MEASUREMENT NEEDED A CONTROL.**
  `.hud-buttons` went from three 44px squircles to four (148px -> 200px) on a
  row this file documents as having four pixels of slack.
  `scripts/_scratch-hud-band.ts` measures the real stylesheet at five framings
  WITH the new button and again with it hidden — and the control is the whole
  design, because its first version reported the phone framings broken and the
  control reported *exactly the same two wrapped rows and the same 176px HUD
  without the new button*. The synthetic worst case it builds is simply heavier
  than the real one (injected `<i>` hearts are not what `setLives` draws). The
  real answer: one row at 360, 390, 414, landscape and desktop, HUD height
  unchanged at 134px, map/lives untouched. `flex-wrap` is there only so a FIFTH
  button degrades to a second line instead of off the screen.
  **AND THE ICON SUBSET WAS RE-CUT FOR ONE GLYPH.** `graphic_eq` — an
  equaliser bar, deliberately not a second speaker, because two speaker icons
  side by side is a puzzle the player has to press to solve. The OFF state does
  reuse `volume_off`, because "off" has one vocabulary in this interface.
  `npm run test:icon-font` is still the only thing that proves a re-cut worked,
  and it caught something first: its snake_case refusal flagged the three new
  `bc_*` storage keys, which belong in its deliberately one-by-one
  `ALLOWED_SNAKE_LITERALS` rather than being pattern-matched away.
  **FOUR INSTRUMENTS REPORTED FALSE FAILURES IN ONE SESSION, WHICH IS A RATE
  WORTH RECORDING.** The HUD worst case (no control); the spectrum probe
  demanding a HIGH band it had itself documented as unrenderable, then
  **measuring band energy in NOISE with a Goertzel at four discrete
  frequencies** — the right tool for "is this TONE present" and a coin flip for
  "how much energy is in this band", wandering 3-5x run to run until it was
  replaced by an actual bandpass filter (stretching the window to 45 s did
  nothing, because the problem was never the averaging time); and a glyph-width
  check that passed at **0px** on an element the auth gate had hidden, which is
  how every "narrower than 40px" test passes on a hidden node. **Suspect the
  instrument first, and give every threshold a lower bound as well as an upper
  one.**
- **THE SCREEN A NOTIFICATION LANDS ON NEVER ASKED FOR ONE, AND A BROKEN RECORD
  ONLY SPOKE TO THE TOP TEN** (IDEA-074). Nuno: *"on the notification screen we
  should add some message to incentivate the user to active the notification…
  and then when active this message desappear… for the other players that have
  at least one run lets send a generic message like 'Looks like someone break
  their record, lets make better'."* Two halves of the same complaint —
  IDEA-052b built the push channel and then barely used it. Eight rules.
  1. **THE INVITATION IS ON THE NEWS SCREEN, WHICH IS WHERE A PUSH OPENS**
     (`push-sw.js` opens `/?news=1`). It was the one screen in the game that
     never mentioned notifications, while the only switch sat three taps into
     the account screen under a heading most players never open — so the
     feature's whole audience was "people who went looking for it". The card
     lives between the header and the LIST, never inside it: the list is the
     scroller, and an invitation that scrolls away is one most players never
     see.
  2. **IT IS NOT DISMISSIBLE, AND IT SAYS NOTHING WHERE THERE IS NOTHING TO
     SAY.** Turning notifications on is its only exit, which is the ask. But a
     browser that cannot do push, or one where the player has already said no at
     the OS level, gets NO card — a `denied` permission can only be reset in
     browser settings, so a banner about it on every visit is nagging rather
     than inviting (the account screen still explains it). iOS before the Home
     Screen install is the exception and gets the instruction with NO button,
     per push.ts's own rule that a button which cannot work is worse than none.
  3. **THE `.hidden` CLASS, NEVER THE `hidden` ATTRIBUTE.** This project has no
     `[hidden]` rule of its own and the UA's is a plain `display:none` that ANY
     author `display:` beats — `.news-invite{display:flex}` does. The first
     build rendered a 362x34 EMPTY BOARD at the top of the screen: visible,
     outlined, carrying nothing. `.hidden` is `!important` and is what the rest
     of the UI uses.
  4. **`navigator.serviceWorker.ready` DOES NOT REJECT WHEN THERE IS NO WORKER —
     IT NEVER SETTLES.** That is the normal state after index.html's stale-shell
     recovery unregisters everything (taking the subscription with it), i.e.
     exactly the device that has just silently lost its subscription and most
     needs to be offered it back. Unbounded, it left the account screen on
     "Checking…" forever and would have hidden this card forever. `isSubscribed`
     is bounded at 6s and times out to "no", which is the safe direction —
     `enable()` reuses an existing subscription rather than creating a second.
  5. **THE CONFIRMATION EXISTS BECAUSE VANISHING ON A PRESS READS AS FAILURE.**
     The card says "You're on the list" for the one render the player is looking
     at it, and is gone on every later visit. A FAILED subscribe likewise leaves
     the card up with the reason in place — vanishing on failure would look
     exactly like success, the worst available outcome here. The CTA is
     `btn-confirm` GREEN and deliberately not amber: §04 reserves amber for the
     single next action on a screen and this screen's is Back.
  6. **THE NUDGE IS BOUNDED IN FOUR WAYS AND ALL FOUR LIVE IN THE PURE MODULE.**
     `whoToNudge` sits beside `whoWasOvertaken` in `notifications/rankAlert.ts`,
     so every rule is testable with no database: the runner is never told about
     their own run; **nobody getting the SPECIFIC alert gets the generic one
     too** (two pushes about one run is how you lose the channel for good); a
     player who has never finished an accepted run is never nudged ("can you do
     better?" means nothing to someone with no record of their own); and it is
     one per player per cooldown under a hard cap. When the cap bites it keeps
     the players who have gone LONGEST without hearing from the board, so a
     capped fan-out rotates through the player base instead of hitting the same
     rows every time. `repo/pushSubscriptions.findNudgeCandidates` is driven by
     the SUBSCRIPTION table, not by `users` — that is what bounds the read — and
     returns `has_played` rather than filtering on it, because that is policy.
  7. **THE NUDGE'S COOLDOWN IS ITS OWN COLUMN, AND THAT IS THE ONE DECISION
     WORTH A MIGRATION** (`users.last_board_nudge_at`, 013). Sharing
     `last_rank_alert_at` was cheaper and wrong: a generic nudge at 20:05 would
     silence the 20:30 message telling a player they had actually been passed —
     the valuable one suppressed by the cheap one, and only for the players near
     the top, who are precisely who the specific alert exists for. Two columns
     also let the cooldowns differ, which they should: `RANK_NUDGE_COOLDOWN_HOURS`
     is 12 against the alert's 6, because EVERY accepted personal best anywhere
     on the board fires a nudge. `RANK_NUDGE_MAX_RECIPIENTS` 0 turns it off.
     The body names nobody and no score — it reaches everyone who plays, most of
     whom are nowhere near whoever just moved, and "Dave is on 4,200" told to a
     player whose best is 900 is a reason to stop rather than to start. Both
     kinds share the per-user `beagle-rank-<id>` TAG, so a player has at most one
     board line on their lock screen and the specific one replaces the generic.
     The two fan-outs are CHAINED, not both fired: `sendToAll`'s concurrency
     ceiling is sized for a 384 MB container holding ONE fan-out's worth of TLS
     sessions.
  8. **A PLAYWRIGHT `addInitScript` FUNCTION DOES NOT SURVIVE tsx.** esbuild's
     keepNames wraps a named function expression in `__name(…)` — including an
     arrow that takes its name from an object property, which `get: () => …`
     does — and Playwright serialises the SOURCE into the page, where `__name`
     does not exist. The whole init script dies on one ReferenceError, every
     stub silently fails to apply, and the browser's real state is what the app
     sees: it looks exactly like the feature not working. Pass
     `{ content: "…" }`. Headless Chromium also reports
     `Notification.permission` as **"denied"** whatever the context grants, which
     `test-news-ui.ts` now uses as a free assertion (a blocked browser gets no
     card) and stubs past for the two positive cases.
  **v2 MADE IT A SET-UP CARD WITH TWO STEPS** (Nuno: *"add more explicit where
  to activate the notification and how to install the beagle chomp, like add a
  button to install the app if not installed"*). Four more rules.
  9. **INSTALL AND NOTIFICATIONS BELONG ON ONE CARD BECAUSE ON iOS ONE IS THE
     PREREQUISITE OF THE OTHER.** iPhone and iPad refuse push entirely until
     the game is on the Home Screen (push.ts rule 2), so v1's card there was
     offering something the player could not have. Everywhere else the two are
     independent, which is why they are two ROWS with their own buttons and not
     a numbered sequence. The card hides only when there is nothing left to
     offer.
  10. **A BROWSER HANDS OUT ONE USABLE `beforeinstallprompt`, SO ONE FUNCTION
     OWNS IT.** `prompt()` may be called once and the event is then spent. It
     used to live in `initInstallPrompt`'s closure, which was right while the
     top banner was the only caller; now `install.ts` keeps it at MODULE scope
     behind `installOffer()` / `promptInstall()` / `onInstallChange()`, and the
     banner goes through the same function. Two owners means two buttons racing
     for one event and whichever loses does nothing at all, silently. Module
     scope rather than a parameter for the ORDERING reason: the event fires
     whenever the browser decides the site is installable, usually long before
     the player opens the News screen, so something must be listening from boot
     — `initInstallPrompt()` at main.ts's top level. `onInstallChange` is what
     lets a card already on screen GROW its Install row instead of waiting for
     a close-and-reopen, and pressing Install must make the row DISAPPEAR: the
     offer is spent whatever the player answered, and a row left behind is a
     button that silently does nothing from then on.
  11. **EXACTLY ONE STEP IS GREEN, AND IT IS THE CARD'S REASON.** Notifications
     whenever they are on offer (that is what this screen is); install only
     when it is all there is. The first build keyed the green off
     `steps.length === 1`, which gave TWO wood buttons in the two-step case —
     caught by the suite, which asserts one of each rather than "the button is
     green". Amber is not available at all: §04 keeps it for the screen's one
     next action, which here is Back.
  12. **WHERE, NOT JUST WHETHER.** The card's footnote names **Account →
     Notifications**. "Turn them on" with no address leaves a player who later
     wants them OFF with nowhere to go, and that is the state that ends with
     someone blocking the site at the browser level — which is the one state
     nothing in the app can undo. The copy is also on a HEIGHT budget: with
     both steps the card is 392px of an 844px phone, and every line pushes the
     notes it sits above further down.
  `MazeTheme`-style drift is guarded the usual way: `userColumns()` in
  `repo/types.ts` is the one list mirroring the `users` table and the new column
  is in it. `server/scripts/test-rank-alert.ts` covers the pure rules (43 checks)
  and `npm run test:news-ui` (59 checks) drives the real card in every state,
  install row included — dispatching a real `beforeinstallprompt` the way
  `test-menu-ui.ts` does, so it exercises install.ts rather than a copy of it.
- **THE GAME SCREEN IS THREE LINES NOW, AND THE TRAY GOT OUT OF THE MAZE**
  (IDEA-076). Nuno, after a play session: *"the interface now have another
  button and when the player have 4 power ups the tags of the power ups are
  above the maze and make hard to play... the score can have the same size as
  map numeration, we can put the label score and in front in one line the
  score... Then below the coins and lives as it is. Below one row with the
  controllers buttons but at this moment the home screen button are below the
  sounds and play and pause button. Then below this row the power ups but the
  power ups the tags could be a little smaller."* Three complaints; the first
  two are ONE cause and the third is what that cause did to the tray.
  1. **A TWO-COLUMN HUD MAKES EVERY ROW AS WIDE AS THE WIDEST THING IN ITS
     COLUMN, AND THAT IS WHAT WRAPPED THE HOME BUTTON.** IDEA-073 put a fourth
     squircle in `.hud-buttons` (148px -> 200), which sat in the right column
     with map+lives; the left column wanted 174 for the score chip; 174 + 8 +
     200 is 382 against 362 of usable width at 390px, so the columns shrank and
     the button row wrapped. `.hud` is a COLUMN of full-width `.hud-line`s
     instead — score|map, coins|lives, chrome — and each line has the whole
     screen to spend. Measured: four buttons on ONE row at 360, 390 and 414,
     and the HUD 228px tall -> **180**.
  2. **THE SCORE IS INLINE AT THE MAP'S OWN 22px, AND THAT IS ONE CHANGE RATHER
     THAN TWO.** A stacked label over a 26px figure is a 56px block and cannot
     share a line with a 46px chip without reading as a block beside it; inline
     at 22 they are 50 and 46. The plate came down 38 -> 32 with it (still the
     biggest in the HUD; the wallet's is 26), which also buys 6px of band.
     `.stat:not(.coin-stat) .bc-plate` rather than relying on source order —
     the wallet is a `.stat` too and its own plate rule has the same
     specificity.
  3. **THE CHIP SIZE IS ARITHMETIC, NOT TASTE.** The tray lives in the band
     between the HUD and the board, so how many chips fit ACROSS decides how
     many LINES deep it is, which decides whether it clears the board at all.
     THE NAME IS THE DOMINANT TERM in a chip's width — 9px with the .1em
     tracking dropped takes "x2 Biscuits" from 77px to ~59 — and THE PLATE SETS
     THE HEIGHT, because the stacked name+countdown is shorter than it. Four
     chips went 383px (always two lines at 390) to **333**, clearing the board
     by 42px at 390, 22 at 360 and 58 at 414. Five still take two lines, which
     fit at 390 and 414 and overrun the board's AABB top corner by 20px at 360
     — inside the one tile of margin `BOARD_CORNERS` carries, so still not over
     a corridor. The tray's own offset went `--bc-s2` -> `--bc-s1` for the same
     budget.
  4. **THE PHONE CHIP BREAKPOINT IS 480px, NOT 399.** A 414px phone is not
     short of WIDTH, but at the full-size chips four measured 380 against 386
     and wrapped by six pixels, and a large phone's band is no deeper in
     proportion than a small one's. The compact chip is the PHONE chip. The
     landscape block's copy of those numbers is kept in lockstep with it.
  5. **THREE LINES IS A PHONE ANSWER, SO IT STOPS AT 600px.** Above that the
     chrome row rejoins the chips in a grid cell of its own (`grid-template-
     areas:"top tools" "mid tools"`) and the HUD is **128px** — smaller than
     the 134 it was before this pass. Without that, a portrait tablet at
     820x900, where the camera pulls the board up to y=181, would have been
     left a **1px** band for a 42px chip; it has 53. Nothing in the render
     layer moved: `--bc-board-top` is unchanged.
  **`scripts/_scratch-hud-rows.ts` IS THE INSTRUMENT**, and it was wrong three
  times before the code was — which is this project's own standing rule, so
  suspect it first.
  - **PUBLISHING A CUSTOM PROPERTY AND READING A `calc()` THAT USES IT IN THE
    SAME TASK GIVES YOU THE OLD VALUE.** Measured: `--bc-hud-bottom` read back
    as **500px** on the tray element itself while `getComputedStyle(tray).top`
    still read **104px** — the 96px fallback plus 8 — and two rAFs later read
    508. `getBoundingClientRect()` does not flush it either. So setup and
    measurement are two `page.evaluate` calls across a frame. Without that the
    instrument reports the tray sitting under a 96px HUD that is actually 180
    tall, which is a confident wrong answer about the one number the whole
    feature turns on.
  - **AWAIT `document.fonts.ready` BEFORE MEASURING ANYTHING HOLDING AN ICON.**
    An unresolved ligature renders as the WORD: five hearts reading "favorite"
    span **279px** against a real 110. That is exactly the inflation
    `_scratch-hud-band.ts` recorded and could not explain — and it is why
    IDEA-073's "the four buttons stay on ONE line at 360, 390, 414" was wrong.
    With the layout that far out of shape the button row was never measured in
    its real context at all.
  - **"ON ONE LINE" IS VERTICAL OVERLAP, NEVER AN EQUAL `top`.** The two chips
    on a line are different heights and `align-items:center` offsets the
    shorter one, so comparing tops reports a correct line as two rows.
  **AND `test-progression-ui.ts` HAD FOUR SEPARATE STALE THINGS IN IT**, all
  pre-existing, which together made it un-runnable and one of which made it
  lie: no `reducedMotion: "reduce"` on the context (so `click("#playBtn")` times
  out on the bobbing card — it was the last browser suite in the project
  missing it), `waitUntil: "networkidle"` (never returns here — `workbox-window`
  stays open), an inner named arrow inside `page.evaluate` (esbuild's `__name`
  helper, IDEA-074's trap), half its label assertions comparing `#level`'s
  FIGURE against "Map 6" since IDEA-048 split the chip, and — the one that
  matters — **the how-to-play carousel opens over the first run and
  `body.tutorial-open` sets `.hud{display:none}`, so every HUD rect read 0x0
  while the game ran perfectly.** The old assertion was
  `Math.abs(chip.top - lives.top) < 4`, which PASSES on 0 - 0: it had been
  measuring a hidden element and reporting a pass. Every check there is bounded
  at both ends now, starting with a non-zero width.

- **Input / UI / PWA**: `src/input/{touch,keyboard,dpad,stick}.ts`, `src/ui/{hud,sound,ambience,install}.ts`,
  `public/icons/*` (192, 512, 512-maskable).
- **THERE ARE THREE TOUCH SCHEMES** (IDEA-049): swipe (default), the D-pad, and the
  **THUMBSTICK**. All three feed the same `beagle.queued = d`, so gameplay knows nothing
  about which is on. Six things are load-bearing:
  - **`ControlScheme` is a per-ACCOUNT column with a CHECK constraint.** Adding a scheme
    is a MIGRATION (`005_control_scheme_stick.sql`) plus `profileService`'s list plus the
    client type — miss the migration and the API answers 400 and the client's optimistic
    choice is reverted on the next sync, which looks exactly like the toggle not working.
    Migration 005 drops the old CHECK by LOOKUP, not by guessed name: a wrong guess leaves
    both constraints and every write of the new value fails in production only.
  - **The feel is one pure function**, `resolveStickDir` in `src/input/stick.ts`, tested
    headlessly by `scripts/test-thumbstick.ts`. Its two rules are asymmetric on purpose:
    switching AXIS is gated by `STICK_SWITCH_RATIO` (the switch sits at atan(1.2) = 50.2°,
    a few degrees PAST the diagonal, so a thumb parked on the corner cannot chatter), while
    REVERSING along the same axis is instant and ungated. Inside the dead zone the held
    direction is KEPT, never cancelled — the beagle has no "stop" to flicker to.
  - **It emits only on CHANGE.** `Entity.queued` persists until overwritten (movement.ts),
    so a held stick keeps asking for free and a turn refused at one junction is still
    waiting at the next.
  - **`.stick-well`'s inset IS the throw.** stick.ts measures that element, not the plate,
    so the ball can never ride out over the gate it is lighting, and the landscape and
    tutorial sizes need no second copy of any number in JS.
  - **Three tones or it is a black disc.** Bezel `--bc-wood`, well `--bc-ink`, ball
    `--bc-biscuit`. The first pass used `--bc-scrim-raised` on `--bc-ink` and the whole
    control read as one hole with a dot in it. The ball's bottom edge is a WARM shade, not
    the ink one — ink on a near-black well is invisible. The circle's depth is a 0-blur
    `box-shadow`, because a thicker `border-bottom` on `border-radius:50%` deforms the
    circle into an egg.
  - **In LANDSCAPE the stick moves to the bottom-left**, unlike the D-pad, which stays
    centred. The board fills the height there, so a centred filled circle sits on the part
    of the maze you are reading — and a phone held at both ends has no thumb in the middle.
    The power-up tray is re-aimed to start to its right; `--bc-pad-block` is set per scheme
    on `body.dpad-on` / `body.stick-on` so the tray never has to ask which control is up.
  `scripts/test-stick-ui.ts` (`npm run test:stick-ui`) measures all of it in the real app
  at 390×844 and in landscape — including that every icon renders as a GLYPH rather than
  its ligature name, which is the one check that can catch the font subset going stale.
  **Signup is rate-limited to 5/hour per IP**, so a rerun after a few passes needs
  `docker compose restart api`.
- **Wall surfaces are PROCEDURAL** (`src/render/wallTexture.ts`): each theme's
  palette carries a `wallTexture` kind — `hedge` (garden/forest/park), `sand`
  (beach), `brick` (city), `flat` (arcade) — drawn to a 256px canvas at runtime,
  never loaded. Three rules: generated not shipped (this is a PWA with no
  texture assets); **they carry COLOUR** — they bake `palette.wall` in and every
  caller holds the material at **white** (a luminance map can only ever darken,
  and cartoon foliage is mostly LIT leaves *above* the mass, which multiplication
  cannot reach); and seamless (walls are one InstancedMesh of unit boxes, so each
  tile shows the full 0..1 — a non-tiling pattern turns the maze into a grid of
  stamps; anything random must be decided BEFORE `wrapped()`, or the nine passes
  draw nine different blobs). Cached by **kind AND colour**, never disposed —
  a handful of small entries, shared by the board and every showcase. Unlike the
  floor the emissive is NOT map-driven: wall palettes lift by only 0.15–0.28.
  Swapping the map needs `material.needsUpdate` — null↔texture changes the
  shader program.
- Both surface modules follow **the CARTOON rule** and share `render/paint.ts`
  (RGB/mix/lit/css/rng): a fixed handful of *named* tones per surface, real
  shapes rather than per-pixel scatter, keylines on the hero shapes, and nothing
  smaller than a couple of pixels. Tune at BOTH framings — a wall face is ~25px
  at the game camera, so detail that looks right in the showcase aliases back
  into speckle in play. Keep each texture's mean close to `palette.wall` /
  `palette.floor` or a theme's tuned colour relationships drift.
- **Floor surfaces are PROCEDURAL AND GRID-DERIVED** (`src/render/floorTexture.ts`):
  `floorTexture` kinds `lawn`/`earth`/`sand`/`parkGrass`/`road`/`flat`. The floor
  is one `PlaneGeometry(COLS+2, ROWS+2)` with plain 0..1 UVs, so tile `(tx,ty)`
  maps to canvas `((tx+1.5)*S, (ty+1.5)*S)` and the maze itself can be painted in
  — that's how the park's gravel walk and the road markings follow the corridors.
  (`lawn`, `earth` and `sand` ignore the grid; the garden is deliberately the
  quiet theme — a path down a one-tile corridor competes with the biscuit trail
  the player is actually reading, which is why its stones were dropped.) A **`Sheet`** describes what is being painted in
  TILE terms (`cols/rows/W/H/S/K/cx/cy/walk`) — the board is one sheet, a small
  showcase patch is another — so the same surfaces serve the maze and the
  menu/shop previews. Every feature size is a fraction of `sh.S` and every
  scatter is counted PER TILE, which makes `S` a pure resolution knob: the board
  runs at 32, a preview patch at 96 (it is magnified far more), same picture.
  **They are drawn CARTOON, not photoreal** — three or four named tones per
  surface, real shapes (tufts, keylined stones, leaves) and nothing under a
  couple of pixels. The first pass used per-pixel scatter off a continuous ramp
  and read as a photograph laid under a cel-shaded scene. Two more rules differ
  from the walls, both load-bearing:
  1. **They carry COLOUR.** A `map` multiplies, so the brightest thing a
     luminance map can make is the material's own colour — on Night City's
     `0x3a3640` floor a `grey(1)` lane marking still rendered at 0.22 and was
     invisible. So the texture bakes `palette.floor` in as its ground and
     `board.ts` holds `matFloor.color` at **white**. Don't tint it twice.
  2. **The map also drives `emissiveMap`.** Floor palettes add a flat emissive
     lift *after* the multiply, which swamped the pattern on the dark themes.
  Grid-derived means **not cached** (a cache keyed by kind would paint level 1's
  corridors into level 2's floor) — `syncBoardMaterials` disposes the outgoing one.
- **The showcases wear the same surfaces** (`src/render/showcaseSurface.ts`): the
  menu vignette and the shop's character stage both call `applyShowcaseSurfaces`,
  which puts `wallTextureFor`'s shared texture on their hedges and paints their
  ground with `floorPreviewTexture` over a small hand-authored tile patch. The
  shop's theme diorama does the same with its own patch — which must stay in
  step with `DIORAMA_WALL_TILES`, and `test-board-surfaces.ts` checks that it
  does. Same white-material and `emissiveMap` rules as the board.
- **Character editor tabs** (`/editor/`, dev-only): **Character** (characters.ts),
  **Pickups** (the maze items in board.ts — power bone, bonus-life bone, fruit,
  coin), **Board & Themes**, **Props**, and **Balance** (IDEA-062 v4 —
  src/game/config.ts's numbers). Character and Pickups are the SAME
  machinery over a different registry and source file: part tree, inspector,
  generated code, real-source panel and save-in-place all read `sourceFile`
  off the def rather than assuming one file. Adding a mesh tab means adding a
  registry entry — not a parallel copy of the editor.
- **SAVING NO LONGER COSTS YOU WORK** (IDEA-062 v1). Three defects, one fix, and
  they had to land together — fixing any one alone makes another WORSE. Read
  this before touching any save path.
  1. **A PART-EDIT SAVE MERGES; IT MUST NEVER REPLACE.** `def.parts = log
     .toPropPartLayer()` was the single worst bug this editor has had. The log's
     baselines are snapshotted from a mesh `makePropFromDef` has ALREADY run
     `applyPropParts` over, so the layer it produces describes only THIS
     session's deltas — and assigning that as the whole field deleted every
     previously-saved edit. The `treehouse` def was found in the working tree
     having gone from **seven part edits to one**. `PropPartEditLog` now holds
     the def's saved layer (`snapshot(nodes, saved)`) and `mergeIntoSaved()`
     folds the session onto it **per PATH and per CHANNEL** — a saved `scale`
     survives a session that only moved `position`. `toPropPartLayer()` still
     exists and is still correct at what it claims; it is simply not the value
     `def.parts` may be set to.
     Two corollaries: a previously-ADDED part is re-adopted by NAME
     (`board.ts`'s `addPropPart` sets `mesh.name = added.id`, so no shipped
     render change was needed) — without adoption the log's `added` comes back
     empty and the merge would delete every added part. And because the merge
     makes a saved edit sticky, **"reset to factory" is not a nicety**: dragging
     a part back by hand only returns it to its SAVED pose, since the saved
     value IS the baseline. `scripts/test-prop-part-merge.ts` is a PURE test in
     `npm run test`, deliberately not a browser one — the defect only appears on
     the SECOND session over a def, and no Playwright suite saved twice.
  2. **AN EDITOR SAVE MUST NOT RELOAD THE PAGE.** Nothing in `src/` handles
     `import.meta.hot`, so writing any file in the editor's module graph fell
     back to Vite's `full-reload` — and a Props save therefore destroyed the
     Board tab's unsaved placements, both undo stacks, the camera and the
     selection. `vite.config.ts`'s `editorSaveFile` plugin now records a
     **CONTENT HASH** of what it wrote and `handleHotUpdate` returns `[]` when
     the file on disk matches it. Content, not a time window: under Docker the
     watcher polls and its latency is unbounded, so a timestamp either expires
     early (the reload comes back intermittently, which is worse than always)
     or swallows a genuine hand-edit. **The acceptance test is that a HAND edit
     still reloads** — suppression that is too broad looks exactly like success.
     Every write also drops a one-generation `<file>.editorbak` sidecar
     (gitignored).
  3. **THE `?raw` SNAPSHOTS WERE FROZEN AT PAGE LOAD, AND ONLY THE RELOAD HID
     IT.** Every save path splices into the file's EXISTING source. That source
     came from `?raw` imports, which Vite resolves once. The reload used to
     refresh them as a side effect — so the instant rule 2 landed, save #2 would
     have spliced into text predating save #1 and silently reverted it. i.e.
     fixing the reload ALONE would have made "saving deletes my previous change"
     worse. **`src/editor/sourceStore.ts`** is the second half: one mutable
     store, seeded from the `?raw` imports, advanced by `saveEditorFile` from
     the exact bytes it POSTed (no round-trip read — the client already knows
     what it sent). `sources.ts` is now a re-export of it; `boardCodegen.ts` and
     `propsFileExport.ts` read through it.
  The honest cost of rule 2, surfaced rather than hidden: for the MESH tabs the
  imported module now lags the file on disk, so a character switch after a save
  rebuilds from pre-save source. `rebaselineAfterSave()` does the work the
  reload used to (clearing `userData.editorAdded` on saved parts is the part
  that is silent when missed — `EditLog.touchTransform` early-returns on an
  added node, so a part left flagged stops recording ANY further move), and the
  **`#staleChip`** offers the reload as a choice. Board and Props need no
  rebaseline: `workingTheme`/`workingLibrary` ARE the truth.
- **THE GIZMO REACHES EVERY TAB, AND BOARD MODE HAS UNDO** (IDEA-062 v2).
  `createGizmo` was always generic (`attach(objects[])`,
  `onCommit(channel, changes)`); it was simply wired to `gizmoBar.hidden =
  !meshMode`. That one line was most of why Board and Props read as a preview
  rather than a workbench — both already had a selection AND a full
  transform-commit path, and neither had a handle. `currentGizmoTarget()` +
  `syncGizmo()` in `main.ts` are the single routing point; every selection
  path and `setMode` call them, so no mode can drift onto its own attach path.
  Four rules are load-bearing:
  1. **A BOARD PLACEMENT IS DRIVEN THROUGH A PROXY, NEVER THE PROP MESH**
     (`src/editor/placementGizmo.ts`). Two independent reasons, and the second
     destroys data silently: the prop mesh does not survive an edit (every
     placement change runs `rebuildBoardFromWorkingTheme`, disposing the very
     object the gizmo holds), and **`buildProps` CLAMPS a `"tall"` prop's
     scale** on the south row and the east/west columns
     (`SOUTH_ROW_TALL_SCALE_CAP` / `EAST_WEST_TALL_SCALE_CAP`). Read the
     transform back off the mesh and a placement authored at 1.8 comes back as
     0.55 — on ANY drag, including a pure rotate — and nothing on screen
     changes to tell you, because the mesh was already being drawn clamped.
     The proxy is positioned FROM the data and every commit writes back through
     the inspector's own clamps, then **snaps the proxy onto the stored value**
     so the handle can never drift from what was saved.
  2. **THE HANDLE SHOWS ONLY WHAT THE DATA CAN HOLD.** A `PropPlacement` is
     `{ propId, tile, offset:[x,z], rotationY, scale }` and the wall-top
     variant has **no `offset` at all** — so translate offers X/Z (nothing for
     a wall placement), rotate offers Y only, and scale is one uniform number.
     `Gizmo.setAxes` is the mechanism; IDEA-041's rule applied to a 3D handle.
     Note `TransformControls` only draws its uniform (XYZE) handle when all
     three `show*` flags are true (`TransformControls.js:1475` at r169), so a
     uniform-scale target must pass all three and collapse the result itself.
  3. **THE BAR STAYS UP; ONLY THE THREE TRANSFORM BUTTONS DIM.** Hiding the
     whole strip when nothing is selected was the first attempt and it is
     wrong: shading, the orientation cube, the scene readout and Focus all
     control how you are LOOKING, not what is selected, so it took away five
     working controls to hide three idle ones. Export/Ref DO go, in board and
     props — they act on the character group, which those modes do not have.
  4. **BOARD UNDO IS A COARSE `WorkingTheme` SNAPSHOT** — exactly the exit
     `main.ts`'s own "UNDO DECISION" note proposed and declined. Both its
     objections stand and are answered by the shape rather than argued with: a
     structural edit and a base-theme swap are just two more snapshots.
     `cloneWorkingTheme` was already the primitive, so `history.ts` gained no
     new vocabulary. The one subtlety is `boardBaseline`: lil-gui binds
     controllers straight to `workingTheme`, so by the time an `onChange`
     arrives the pre-edit value is gone — carrying a baseline forward is what
     lets undo work **without threading an onGestureStart/End pair through
     every one of the inspector's several dozen controls**. `restoreWorkingTheme`
     must reset it, or the next edit records a pair spanning the undo itself
     and one Ctrl+Z jumps two steps. It also **re-selects the tile** after
     restoring (`boardPlacement.reselect`) — `syncFromTheme` clears the
     selection, which is right for a theme swap and maddening for an undo.
  A theme snapshot is a palette plus ~50 small placement objects: a few kB, a
  few hundred at the 200-entry cap. `scripts/test-editor-board.ts` drives a
  REAL drag (probing outward from `proxyScreenXY()` for a handle rather than
  hard-coding a pixel offset the camera framing would invalidate) and pins the
  clamp-drift regression directly.
- **THE EDITOR AUTOSAVES, AND OFFERS THE WORK BACK** (IDEA-062 v3,
  `src/editor/session.ts`). v1 stopped SAVES from reloading the page, but a
  reload is still one Ctrl+R, one crashed tab, one hand-edit to a game file
  (which must still hot-reload — the HMR suppression is deliberately narrow)
  or one stale-chip Reload away, and every one of those used to cost an
  afternoon of prop tuning silently. A 1.5 s trailing debounce mirrors the
  working state into `localStorage` (plus `pagehide`/`visibilitychange`), and
  on load a Restore / Discard bar offers it back. Three rules:
  1. **NOTHING IS APPLIED UNTIL RESTORE IS CLICKED.** An automatic restore is
     fewer clicks and the wrong default — arriving at a fresh editor to find
     yesterday's abandoned experiment already loaded over the real registry
     values is the same class of surprise this whole pass exists to remove.
  2. **THE CHARACTER `EditLog` IS DELIBERATELY NOT STORED**, and the bar says
     so. It holds live `Object3D`/`Material` references and keys material
     baselines by `uuid`, so restoring it means REPLAYING every record against
     a freshly-built character — real work, registered as a follow-up rather
     than half-done. It is also the least painful gap: character edits are
     written into the real source by Save, whereas props and board work lives
     only in memory until you save, which is where the losses actually hurt.
  3. **`localStorage` here is the documented exception to the no-storage
     rule**, which is about the GAME's state in a PWA. Every access is in a
     `try/catch` that degrades to "no restore offer", never to an error — the
     same idiom `stashSaveReport` already used for `sessionStorage`.
  The recorder CHAINS onto each history's existing `onChange` rather than
  replacing it; the history panels are driven by those hooks and stealing one
  would silently blank a panel.
- **THE BALANCE TAB EDITS `config.ts`, AND ITS MAIN FEATURE IS THE SYNC GATE**
  (IDEA-062 v4). A fifth tab, and the first that edits the game's NUMBERS
  rather than its meshes. Five things are load-bearing:
  1. **A TOKEN SWAP, NEVER A REGENERATION.** `config.ts` is the most heavily
     COMMENTED file in the game — most of its numbers carry a paragraph on why
     they are that number and what happened when they were something else
     (read `COINS` or `LIVES`). Regenerating it the way `boardCodegen`
     regenerates a theme entry would throw all of that away. `configRewrite.ts`
     finds the statement, walks to the value at a path and swaps the numeric
     token: same line count, same bytes everywhere else.
  2. **THE MASK MUST PRESERVE LENGTH.** Reusing `sourceRewrite.ts`'s
     `stripCommentsAndStrings` was the first attempt and it silently resolved
     every lookup to the wrong byte: it DELETES comment/string spans rather
     than blanking them, so its indices do not line up with the original.
     `maskNonCode` blanks to spaces instead. This matters here more than
     anywhere — `config.ts` is mostly prose, and words like `pickupValue`
     appear in that prose as well as in the code.
  3. **THE LAST ELEMENT OF AN ARRAY IS THE ONE YOU ARE MOST LIKELY TO RETUNE**,
     and it was unreachable for a while: `config.ts` writes its arrays with no
     trailing comma, so the final element is delimited by `]` — and an early
     `return null` on `]` fired before the closing branch could compare the
     index.
  4. **ONLY NUMBER LEAVES AT KNOWN PATHS.** Never adds or removes an array
     element: a sixth fruit changes `FruitId`, `rollFruit`, five pickup
     builders, `catalog.generated.ts` and the server's plausibility bounds.
     That is a feature, not a slider. Anything it cannot write is REPORTED,
     never approximated. `balanceFields.ts` is the hand-written catalogue —
     same trap as `propsCodegen`'s field list, except `test-config-rewrite.ts`
     resolves all 46 paths against the real `config.ts` AND checks every
     shipped value sits inside its own slider range, so a rename fails the
     build rather than rendering a control wired to nothing.
  5. **THE SYNC PANEL DOES NOT AUTO-HIDE.** CLAUDE.md's rule is that changing
     `config.ts` requires `cd server && npm run sync`, and the failure mode if
     you forget is uniquely nasty: honest runs start being rejected with
     `SCORE_ITEM_MISMATCH` in PRODUCTION while nothing fails locally. So the
     save button says it before you click, and a successful save leaves a panel
     up with the exact commands until you dismiss it. Editing `mazes.json` will
     need the same gate.
  No 3D preview, deliberately — these are values whose effect is only visible
  by playing, and a viewport showing an idle beagle beside a "ghost speed"
  slider would imply a feedback loop that does not exist. The tab is a form,
  and `.mode-balance` gives the GUI pane the whole width. Edits are PENDING
  until Save (the other tabs mutate a working copy live); a half-dragged slider
  writing a real game number every frame would be the worst possible behaviour
  for a file this load-bearing.
  **A GRID AREA THAT DOES NOT EXIST DOES NOT HIDE THE ELEMENT THAT NAMES IT.**
  `#editorApp` is a CSS grid and every pane claims an area — `tree`, `viewport`,
  `gui`, `code`. A mode template that simply omits one does NOT drop that pane:
  the browser AUTO-PLACES it into an implicit track. Balance shipped its first
  layout that way and it looked like a styling nit and was not — the mode bar
  was squeezed to 566px (wrapping "Board & Themes" onto three lines), the pane
  became a small island floating in the top-left, and the 3D SKY was still
  sitting there on the right in a tab that has no scene at all. Any mode
  dropping a pane must `display: none` it. It cost the World tab too, which
  inherited board mode's left column and rendered the PROP LIBRARY — 19 rows of
  props in a tab about fences.
- **THE WORLD TAB REACHES THE GARDEN MACHINERY NO PALETTE CAN** (IDEA-062 v5).
  A sixth tab over `fence.ts` and `groundDetail.ts` — the IDEA-060 numbers that
  are neither a theme palette field nor a prop param. Four things:
  1. **`FENCE_PARAMS` / `GROUND_DETAIL_PARAMS` are NAMED MUTABLE TABLES**, not
     module `const`s. The alternative was threading a `params` argument through
     `buildFence` → `buildPanelGeometry` → `picketShape`, which changes three
     signatures so one dev-only pane can pass an override every shipped call
     site would leave empty. The contract: production never writes them, the
     editor does, and then writes the values back to THOSE literals so the file
     stays the source of truth.
  2. **IT BORROWS BOARD MODE'S STAGE.** Every number here is judged by looking
     at the board, so it renders one — and because `applyBoardTheme` already
     rebuilds both the fence and the ground detail, the existing board rebuild
     IS the live-preview mechanism, with no second path to drift from what the
     game draws. Slot picking is off: a click landing on a marker would plant
     a prop nobody asked for. Edits apply LIVE here and are written on Save —
     the opposite of Balance, and right for the same reason Balance is the
     other way round.
  3. **THE FENCE READOUT IS THE POINT, NOT DECORATION.** A wall face is ~25px
     at the game camera, so a picket and its gap are single-digit pixel counts
     and the CARTOON rule's floor is "nothing smaller than a couple of pixels".
     `fenceReadability()` reports both while you drag. Its floor is **1.95px,
     not 2.0**: the shipped fence (4 pickets, 0.17 wide) lands on exactly 2.0,
     so a hard `>= 2` had the reference configuration flip in and out of "too
     thin" on float noise alone — an instrument that cries wolf about the value
     it is calibrated against teaches you to ignore it.
  4. **`pickets` IS A CONSTRAINT, NOT A PREFERENCE.** `PITCH = TILE / pickets`
     must divide the tile exactly or every tile boundary seams and a straight
     run reads as a row of separate gates. It is an integer stepper and a typed
     value is rounded.
  **`foliage.ts` is deliberately ABSENT**, and this is the most useful thing
  the tab's scoping records: `lobedFoliageGeometry` is already options-driven
  so live tuning would be free — but all six `gardenProps.ts` call sites
  override `lobes`/`sharpness`/`detail` explicitly, so a control bound to the
  module defaults would change NOTHING. That is IDEA-041's rule violated in the
  most misleading way available. Lifting those six into a named
  `GARDEN_FOLIAGE` table is the prerequisite. `wallTexture.ts`/`floorTexture.ts`
  are out for a blunter reason: ~1000 lines of hand-authored painters with no
  parameter surface at all.
- **Tests**: `scripts/validate-maze.ts`, `scripts/sim-logic.ts` — import the real modules.
  **`sim-logic.ts`'s bot PATHFINDS as of IDEA-061, and the bar is a CLEARED BOARD.**
  It used to pick whichever legal turn shortened the straight-line distance to the
  nearest pellet, which in a maze is not a plan: measured, it wedged into a 3-to-17
  tile loop in **every one of the eighteen shipped mazes** and differed only in how
  long it wandered first, so `eaten > 50` was a coin-flip on geometry (maze 7 passed
  with 59) that eight sound new mazes tripped. It now runs a BFS over
  **(tile, incoming direction)** — the no-reverse rule belongs in the SEARCH, not in a
  filter applied after the target is picked — and decides inside `onArrive` the way the
  ghosts always have, because deciding in the outer tick plans from the tile being LEFT
  and lands every turn one tile late. All 36 mazes now clear 100% in under 73s of a
  180s budget, so "the bot eats everything" is a real reachability assertion.
  `scripts/test-cosmetics.ts` pins the enemy-skin REGISTRY — its count (now TEN), its order and
  the ghost's secret/free pair. Adding a skin means editing it, and that is the point: the list is a contract
  the server's `catalog.generated.ts` mirrors, so a silent addition is a client/server drift.
  `scripts/test-runtime-owned.ts` counts one `pupilPivotL/R` naming site per enemy for the same
  reason.
  `scripts/test-powerups.ts` covers the power-up state machine — most of it is the
  shielded-hit rule, in the exact combination Nuno described (holding 1, 2 and 5, caught,
  keeps 1 and 2). `scripts/test-fruits.ts` covers the fruit ladder: the weighted roll's exact boundaries
  (deterministic — `rollFruit` takes an injectable rand), that value rises as weight falls,
  that no fruit threshold collides with a coin or bonus-life one, and that each threshold
  still fires exactly once per level (the v1.0 farming exploit, now worth 500 a pop).
  `scripts/test-board-surfaces.ts` guards the one silent failure in the theme pipeline:
  **`src/editor/boardCodegen.ts` writes a palette field by field, by hand**, so a new
  `ThemePalette` key that the writer doesn't know about is quietly dropped from every
  theme saved in the editor. Add a palette field → add it to the writer.
- **The editor has DIRECT MANIPULATION** (three.js-editor parity work): a
  `TransformControls` gizmo on the selected part (`src/editor/gizmo.ts`), a
  click-to-jump history panel, a foldable outliner with geometry badges and
  drag-reparenting, and viewport furniture — orientation cube, scene readout,
  solid/wireframe/normals shading (`src/editor/viewportExtras.ts`). Four rules
  hold this together:
  1. **The gizmo commits through `pushTransformHistory`** — the same function
     the inspector's number fields use. A drag and a typed coordinate are the
     same edit to the EditLog, the undo stack and codegen. Never add a second
     command path.
  2. **Keys are `W`/`E`/`T` + `Q`/`F`, not the reference editor's `W`/`E`/`R`.**
     `R` and `S` are held modifiers for arrow-key rotate/scale nudging here.
  3. **Only editor-ADDED parts can be reparented.** They codegen as
     `<parentVar>.add(<name>)`, so a move is representable; an original part's
     parent is written by the builder and a move would silently vanish on save.
     For the same reason there is no sibling REORDER — `add()` appends.
  4. **Shading overrides are a way of LOOKING, never a saved property.**
     "normals" swaps `mesh.material`, so anything reading materials off the
     scene graph must go through `withRealMaterials()` or it rebuilds the
     material registry around a fake shared material.
- **MULTI-SELECT**: Ctrl/Shift-click, `A` for all/none. `selection` is the set,
  `selected` is its PRIMARY (`selection[0]`) — everything that edits ONE thing
  (inspector, source marker) keys off the primary, everything that can act on
  MANY (gizmo, Delete) reads the set. That split is why multi-select landed
  without touching `inspector.ts`. The gizmo mirrors the primary's movement as
  a DELTA (translate/rotate) or a RATIO (scale) from each part's own
  mouse-down pose, so dragging two ears moves both rather than collapsing them
  together. `history.begin()`/`commit()` folds N edits into one undo step.
- **ANIMATION TIMELINE** (`src/editor/timeline.ts`, the Animation tab): play /
  pause / step / scrub. **There are no `AnimationClip`s here** — our characters
  are animated procedurally by `syncToEntity`/`applyGhostState`, so "time" is
  accumulated `dt` fed to the real animate() call, and scrubbing back means
  restore-and-replay. Tracks are **discovered by sampling** the cycle and
  keeping the channels that actually move, which answers the IDEA-041 question
  directly: *which parts does the runtime own?* Exactly one driver steps the
  animation — the timeline while its tab is open, the free-running preview
  otherwise.
- **glTF IN AND OUT** (`src/editor/assets.ts`): export the character as `.glb`;
  load a `.glb`/`.gltf` as a **reference model** (button or drag onto the
  viewport). The hard boundary: **a reference can never be saved.** Codegen
  emits constructor calls, and there is no such expression for an arbitrary
  triangle soup — so a reference is tagged `editorOverlay`, which keeps it out
  of the part tree, picking, the scene readout and every codegen path. No
  DRACO/KTX2/meshopt: those open COMPRESSED assets and this project ships none.
  Both addons are dynamically imported, and the editor still never ships.
  All of the above is guarded by `scripts/test-editor-viewport.ts`
  (`npm run test:editor:viewport`), including a real export→reimport round-trip.
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

## The three.js specialist pack (`.claude/agents/threejs-*`)
Fourteen deep-domain three.js agents sit alongside the six project agents above:
`threejs-tech-lead` (route here for anything vague or cross-domain) plus
scene-architect, geometry-engineer, material-lookdev, texture-pipeline,
lighting-shadows, tsl-shader-engineer, animation-rigging, character-controller,
asset-pipeline, camera-interaction, physics-collision, postfx-compositor,
performance-optimizer, vfx-audio.

**The project agents own the game; the `threejs-*` agents own three.js technique.**
`render-artist` still owns `src/render/*` and pulls a specialist in for the technique.
The full split is the table at the end of `.claude/agents/_shared/routing.md`.

Shared rules live in `.claude/agents/_shared/`: `conventions.md` (every specialist
reads it first), `taxonomy.md`, `routing.md`, and `api-surface/` — a greppable dump of
every symbol that actually exists in the installed three.js, so "is this a real API?"
is a grep, not a guess. **Regenerate it after every three.js upgrade:**
`node .claude/agents/_shared/tools/gen-api-surface.mjs`.

### three.js rules for this project
The pack ships generic WebGPU/TSL advice. **This project is not that stack**, and
`conventions.md` §−1 records the difference — these rules win:
- **`THREE.WebGLRenderer` on three r169.** Import everything from `three`. Never from
  `three/webgpu` or `three/tsl`: at r169 they are one browser-only bundle and node
  materials do not render on WebGL. Proposing TSL is proposing a renderer migration.
- **`MeshToonMaterial` via `toon()`, `NoToneMapping`, one shared 3-step ramp** — see
  the cel-shading rules above. Not a style preference; the three are one system.
- **No glTF assets, no physics engine, no post-processing.** Meshes and textures are
  built in code, movement is tile-stepping on the grid. Adding any of those three is a
  stack change: raise it, don't slip it in.
- **1 world unit = 1 maze tile** (`TILE = 1`), not 1 metre.
- **Verify APIs against the installed package** (`api-surface/`, `node_modules/three/src`,
  the `.d.ts` files) before using anything you are not certain of at this revision.
  Never invent a property, constant or import path. The pack's rename table is upstream
  history — several rows run backwards at r169 and are flagged there.
- Colour management is on: colour textures tagged sRGB, data maps left linear.
- Every class that allocates GPU resources or DOM listeners exposes `dispose()`.
  No allocation inside the render loop.
