# Backlog — beagle-chomp

Living backlog of ideas. Two purposes:
1. For the human: capture ideas as they arise so they aren't lost.
2. For Claude: the starting point each session — read this, pick an idea, plan, build.

> How to use: say an idea (or run `/idea`) → it lands in the Inbox below. `/idea-triage`
> registers each one with an ID. When chosen (`/buildi`), an idea goes In progress and then to
> Delivered (never deleted — keep the version history). When a group of ideas ships, it's also
> recorded in VersionControl.md as a product version (v1.0, v2.0…). The two files work as a pair.

## State legend
- 💡 Idea · 🔨 In progress · ✅ Delivered · ❄️ Paused · 🗑️ Discarded
- Priority: 🔴 high · 🟡 medium · 🟢 low (optional)

## 📥 Inbox (raw captures — untriaged)
> `/idea` appends raw notes here with a date. `/idea-triage` turns them into registered ideas
> below, then clears them from here. Don't assign IDs in the Inbox.
_(empty — nothing to triage)_

## Backlog (open ideas)
> New registered ideas go here. Next free ID: IDEA-050

### IDEA-028 — Challenge twist: moving walls / maze changes mid-level 💡
- **Priority:** 🟢
- **Area:** modes
- **Registered:** 2026-07-12
- **Description:** a challenge level where the maze changes after a few seconds or the walls move
  around mid-level — the twist from the original challenge-mode vision that got deferred.
- **Notes:** deferred from [[IDEA-013]] v1 (captured 2026-07-11). The hard part: LIVE grid
  mutation with validator-grade guarantees ([[IDEA-001]]) — connectivity, pellet reachability, pen
  exit, and never crushing/trapping an entity mid-move; the render layer needs walls that animate
  in/out. Would slot into `challenges.ts` as a new modifier level (a C9, or replacing a mid-ladder
  level) and appear on the level map ([[IDEA-014]]).
- **v2** (2026-09-04) — the SCREENS, from the companion design file "Redesigned
  Screens.dc.html". v1 built the component system; this applies it to the six
  screens and changes their structure where the design asks for it. The menu
  carousel is deleted (Play becomes a full-width block, four destinations
  become a fixed 4-up row that fits without scrolling, `menuCarousel.ts` gone);
  `.hud` becomes two columns with the chrome row inside the right one instead
  of fixed at a measured offset; game over becomes a result BOARD with maps
  cleared, coins earned and the gap to the personal best; the challenge map
  gains a progress bar, padlock-faced locked stones and a "Play stone N"
  button; the leaderboard gets numbered gold/silver/bronze rank plates; and
  shop items gain a required `blurb`, with the price moved onto the action
  button to make room for it. Two findings worth keeping: a `<br>` contributes
  no whitespace to `textContent`, so the two-line menu title was announced as
  "BeagleChomp" until a real space went before the break; and the fonts had to
  be SELF-HOSTED and subset (108 KiB) after a blocked Google Fonts request on
  Nuno’s machine printed every icon’s ligature name on its own button
  ("arrow_back Menu") — which also exposed that Google’s icon subsetter does
  not preserve the private-use CODEPOINTS, so glyphs are addressed by ligature
  everywhere, SVG included. `test-menu-ui.ts` rewritten for the tile row;
  `test-leaderboard-ui.ts` for the rank plates.
- **Dependencies:** —

## In progress 🔨

### IDEA-048 — Toon boards, not glass panels: a real design system for the 2D layer 🔨
- **Priority:** 🔴
- **Area:** ui
- **Registered:** 2026-09-04
- **Description:** the game renders cel-shaded — flat fills, banded light, dark contact edges —
  and the interface did the opposite: translucent grey glass with hairline borders, the
  vocabulary of a settings app. Chrome read as something laid ON the game rather than part of
  it. Designed in Claude Design (`Beagle Chomp Design System.dc.html`, 10 sections: colour,
  type, icons, surfaces, buttons, controls, HUD, readability, motion, sound) and implemented
  across the whole 2D layer.
- **Notes:** built on branch `rework-interface`. New `src/ui/tokens.css` (palette lifted from
  `config.ts`/`themes.ts`, geometry, type, motion) with every component in `style.css` rebuilt
  on it; new `src/ui/icons.ts` retires every emoji in favour of Material Symbols Rounded plus
  icon PLATES for game objects; new interface sound layer on the existing synth (`sound.ui` —
  one wooden tap for every press via a single delegated listener, a fourth up for selections,
  purchase/equip/unlocked/error/screen cues, a menu bed, and a 6 dB duck while a run is on).
  Four findings are written into the code and CLAUDE.md because each was a real failure caught
  in a render, not a preference: `backdrop-filter` is gone everywhere (a full-screen composite
  per frame over a live WebGL canvas); dimming must be PAINT and never `opacity`, since a
  translucent shop card over the 3D turntable picks up the sky and the whole rail turns
  blue-grey; a full-bleed BROWN backdrop leaves a bark board’s ink outline sitting between two
  browns and the line vanishes, so the identity screens ground on night-garden green-black; and
  the §09 idle bob animates the Play card’s ICON rather than the card, because bobbing the card
  made the most-pressed control a permanently moving target and hung every Playwright click on
  `#playBtn`. Verified by screenshotting every screen against a live API — auth, recovery,
  menu, shop, challenge map, leaderboard, account, tutorial and a real run with the HUD,
  power-up tray and D-pad on screen.
- **Dependencies:** —

### IDEA-047 — The beagle, rebuilt from a real reference 🔨
- **Priority:** 🔴
- **Area:** render
- **Registered:** 2026-09-02
- **Description:** (Nuno) the main character works but doesn't look like a beagle — "I want to
  build a realistic beagle that persons look and see a dog of the breed beagle, keeping the toon
  of the game." A reference image (cartoon-3D beagle puppy, tricolor) went into
  `.img2threejs/reference/beagle/` and the img2threejs skill's full staged pipeline ran over it.
- **Notes:** built on branch `rework-beagle-character`. The pipeline's whole evidence trail lives
  in `.img2threejs/` — anatomy measured off the reference in head-units (chibi 2.8 HU, ears 0.88
  HH hanging to chin, muzzle 0.40 HH, flag tail with white tip), a strict-validated sculpt spec,
  8 locked build passes each gated by turntable/multi-angle/interior-difference reviews, and a
  pose-articulation proof. Integration: `makeBeagle()` in characters.ts rebuilt over a new
  `beagleSculpt.ts` geometry engine (station sweeps + lathe profiles + per-triangle coat-region
  material groups) keeping the FULL contract — BeagleParts pivots for syncToEntity, coatMats for
  the skin shop, the Pac-Beagle brow accessory, jaw chomp. Dev harnesses added:
  `/preview-rework/` + `scripts/shoot-rework.ts`. Tier-1 IoU gate documented as reconstruction-
  mode-miscalibrated (the skill's own caveat) — evidence in
  `.img2threejs/evidence/tier1-reconstruction-caveat.md`.
- **Dependencies:** —

### IDEA-025 v3 — The editor saves REAL source, not an override block 🔨
- **Priority:** 🔴
- **Area:** tooling
- **Registered:** 2026-08-25
- **Description:** (Nuno) "My idea of building this editor was to understand better the three.js
  library... looking at the files makes it a little bit difficult, with the editor I can see the
  piece of code I'm editing and that allows me to understand better what I'm making. But having this
  editor which looks like a Blender interface and then when I hit save the things don't save is
  frustrating. The editor should allow me to edit and then on saving the corresponding files should
  be saved and updated without losing anything — like I was actually changing code." Today Save
  appends a generated `// --- Character Editor edits ---` block before the builder's `return g;`
  instead of editing the part's real definition, so the file reads as a definition followed by
  layers of corrections, blocks stack across sessions, and a deliberate change is indistinguishable
  from stray experiment residue.
- **Notes:** iteration on the delivered [[IDEA-025]] (ships as its **v3**). What Save must do
  instead: rewrite the real lines — move the haunch and line 188's `haunch.position.set(...)`
  changes; delete a part and its `const` block goes. Nothing appended, no markers, the file stays
  hand-written. This also retires the [[editor-residue-hazard]] at the root (it has bitten three
  times, most recently `545d5cc`) — and folds in Nuno's **intentional** chest+haunch removal as
  clean source (confirmed 2026-08-25: the beagle looks better without them, so the LOOK does not
  change, only how it's expressed). The source panel should show a live **diff of what Save will
  write**: that's the learning surface the whole editor exists for — drag a part, watch the exact
  three.js line change. Sibling of [[IDEA-041]].
- **Dependencies:** —

### IDEA-041 — Editor controls that edit values the runtime overwrites 🔨
- **Priority:** 🔴
- **Area:** tooling
- **Registered:** 2026-08-25
- **Description:** parts of the character editor are convincing-looking controls wired to nothing.
  Rotate an ear, the tail, a leg or the jaw and Save writes the line correctly — then the game
  overwrites it 60 times a second, so it can never survive. Recolour the coat and the skin system
  resets it. This is a large share of "I hit save and it doesn't save": the editor is letting you
  edit values that aren't the source of truth, which is the opposite of what it was built for.
- **Notes:** found 2026-08-25 while diagnosing Nuno's frustration with saving. Concretely:
  `characters.ts:1270-1279` (`syncToEntity`) writes `tail.rotation.y`, `earL/earR.rotation.x`, all
  four `legs[].rotation.x` and `jaw.rotation.x` every frame; `applyBeagleSkin`
  (`characters.ts:459`) sets all 4 coat material colours from `skin.coat`. Fix: route each control
  to its TRUE owner (coat colour to the skin def in `cosmetics.ts`; an animated joint's rest pose to
  the constant inside the animation formula) or, where routing isn't sensible, disable the control
  and say WHY in the inspector — "driven by `syncToEntity` each frame" is itself a three.js lesson,
  which suits [[IDEA-025]]'s learning goal. Sibling of the v3 save work.
  **2026-09-03 (with [[IDEA-047]]):** colour edits on a builder's FIXED materials now save in
  place — `setMaterialColor` accepts `toon({ color })` and any `new THREE.Mesh…Material({ color })`
  literal (it was MeshStandardMaterial-only, i.e. nothing on a cel-shaded character), and the
  editor resolves a runtime material to its real variable name via `material.name` or a unique
  colour literal in the builder (`materialDeclsByColor`). Coat + paw + brow stay skin-owned and
  refuse with the reason; the beagle's nose/sclera/rim/iris/pupil/glint are editable.
- **Dependencies:** —

## Delivered ✅
> Already in production. Do NOT delete. Each keeps its version history.

### IDEA-049 — Thumbstick: a third touch control, and the retro one ✅
- **Priority:** 🟡
- **Area:** ux
- **Registered:** 2026-09-05
- **Description:** Nuno, from playing it: swipe costs you the LIFT. Every turn is
  press → drag → release → press again, and the beagle is already past the junction by
  the time the thumb is back down. A thumbstick keeps the thumb ON the control, so a
  turn is a roll of the thumb rather than a whole new gesture — and it brings the
  arcade cabinet's own control back to a game that already looks like one.
- **Notes:** a THIRD scheme, not a replacement — swipe stays the default and the D-pad
  ([[IDEA-038]]) stays for players who want discrete keys. `control_scheme` is a per-account
  column with a CHECK constraint, so this is full-stack: a migration, server validation, the
  client types, and a third option in the account screen. The feel lives in one pure function
  (`resolveStickDir`) so it is testable headlessly like the rest of the game logic.
- **Dependencies:** [[IDEA-038]], [[IDEA-048]]
- **History:**
  - **v1** (2026-09-05) — the thumbstick, front to back. A fixed 4-way stick at the
    bottom of the screen you keep the thumb ON, drawn as an arcade ball top in a
    wooden gate plate. `src/input/stick.ts` (DOM) over one pure `resolveStickDir`
    (feel), `scripts/test-thumbstick.ts` (30 checks) and `scripts/test-stick-ui.ts`
    (27 measured in the real app, both orientations). Full-stack: migration 005
    widens the `control_scheme` CHECK, `profileService` validates against a list,
    and the account screen's control row became a three-option table with a note
    for the chosen scheme. `ICON.stick` meant re-cutting the Material Symbols
    subset to 47 names.

    Four findings are written into the code because each was a real failure, not a
    preference. **The anti-chatter gate sits at atan(ratio) = 50.2°, PAST the
    diagonal, not atan(1/ratio) short of it** — written the other way round first
    and the headless test caught it, because at 40.8° off "up" the horizontal axis
    is not even the larger one yet. **A non-finite pointer reading fell through
    every comparison and steered the beagle up**, since each of them is false
    against NaN. **Three tones or it is a black disc**: the first pass built the
    control out of `--bc-scrim-raised` on `--bc-ink` and panel, well, gates and
    outline merged into one hole with a pale dot in it; and the ball's ink bottom
    edge is invisible on a near-black well, so it is a warm shade instead. **The
    stick moves to the bottom-left in landscape**, unlike the D-pad, which stays
    centred — the board fills the height there and a filled circle in the middle
    sits on the part of the maze you are reading. Both were found by LOOKING at a
    render, not by an assertion, all of which passed.



### IDEA-046 — Power-ups: pickups that change how the run plays ✅
- **Priority:** 🔴
- **Area:** gameplay
- **Registered:** 2026-08-28
- **Description:** (Nuno) "I was thinking of adding components we can take to give us advantages…
  instead of points these give advantages." Five of them, each with its own visual: **x2 biscuits**
  (a x2 badge), **x2 enemy** (the same x2 in another colour), **slow down the enemies** (an anchor),
  **a flashing bone** that frightens the pack AND makes the beagle faster, like Mario's star, and a
  **shield** that lets one enemy catch you without losing a life. They appear at random on the maze
  like the fruits do. "On the UI we should have a space where the active power-ups appear, to let the
  user know which power-ups they have."
- **Notes:** The lifetime rules are Nuno's and they are the interesting part — three different kinds
  of "until":
  · **timed** — anchor and star run on a countdown;
  · **until you die** — x2 biscuits and x2 enemy persist, *and survive clearing the map*;
  · **until you are caught** — the shield is spent on the hit that would have killed you.
  "When the user has power-up 1 and 2 and 5 but gets caught, they only lose the 5 and keep the others
  until they die." So a shielded hit is explicitly NOT a death: it consumes the shield and the two
  doublers live on. Decided 2026-08-28: **classic mode only** — challenge levels are meant to be pure
  dial-twists on the proven engine, and letting power-ups in would make every challenge score already
  on record incomparable. Spawning reuses `pickRandomFreeTile` + the once-per-threshold gate from
  `pickups.ts` (the anti-farming fix) rather than a new mechanism. The doublers multiply score, so
  `plausibility.ts`'s ceilings have to be raised in proportion or honest runs get rejected —
  `runTelemetry` needs to report what was collected so the server can size the bound. New tutorial
  slides land as an **[[IDEA-040]] v3**, not a new id. Sibling of [[IDEA-045]].
- **Dependencies:** [[IDEA-045]] ✅ shipped 2026-08-28 (shares the spawn/threshold plumbing and the same validator surgery —
  building the fruits first means the power-ups inherit a pipeline that already works)
- **History:**
  - **v1** (2026-08-28) — five power-ups that change how a run plays instead of what it scores:
    **x2 biscuits**, **x2 enemies**, an **anchor** that slows the pack, a **star** that frightens
    them and speeds the beagle, and a **shield**. The design lives in a pure `powerups.ts` and
    exists for one sentence of Nuno's — *"when the user has power-up 1 and 2 and 5 but gets caught,
    they only lose the 5 and keep the others until they die"* — which says a **shielded hit is not
    a death**. `onCaught()` returns `"shielded" | "died"`, a third outcome between "nothing
    happened" and "you lost a life", so the doublers provably survive it; spread across the
    collision handler that distinction would be one `if` somebody later simplifies away.
    Three lifetimes (`timed` / `untilDeath` / `untilHit`) and the asymmetry between them IS the
    feature: the doublers and the shield also survive clearing a map, which is why `PowerupState`
    is run-scoped on `Game` and not on `LevelAssets`. `game.ts` gained no new mechanisms — the
    anchor is one more factor on the ghost-speed multiplier that was already there and the star
    calls the existing `triggerFright()`. HUD tray with a drain bar for the timed pair and a
    coloured edge for the persistent ones. Classic only. 50 headless checks.
    _(33004c0 api, a63c9e9 frontend)_
  - **v2** (2026-08-28) — three rounds of live play, and the fix that mattered was a **bug, not a
    number**. **The shield was a trap.** Absorbing a hit left the beagle still inside
    `COLLISION_RADIUS`, so the next frame ran the check again with no shield left and killed the
    player anyway — spending the shield, the life AND every other power-up held. Worst in the
    head-on case, where the ghost reverses into the beagle's own direction and the beagle is
    FASTER than a ghost (5.2 vs 4.6), so it closes rather than escapes. Now a **1.5s untouchable
    window** with a blink, covering every ghost rather than the one that hit — being bounced into
    a second pursuer would have made the first shield worthless. This is what makes it the
    "second chance" the idea asked for; without it "preserve everything" was true for one frame.
    Also from play: **spawn counts up** (power-ups 2 → 3 → 4, coins 4 → 5, fruit and the golden
    bone unchanged — 14 spawn events a map now, no two sharing a pellet tick), and **the weights
    re-derived from LIFETIME rather than power** (timed 26 each, shield 20, doublers 14). That
    ordering reads backwards until you see it: a doubler is kept until you die, so a player who
    has one does not need another — and a duplicate spawn of one already held is a literal no-op,
    since `collect()` refreshes a timer that is zero. Weighting them by strength, as v1 did, spent
    most spawns on nothing: Nuno saw both doublers twice in one map and never once saw the star or
    the anchor. Finally the **star stopped being a bone**: it was a glowing power bone on the
    reasoning that it does what a bone does, and the maze is full of bones — so the one pickup
    that should stop you mid-corridor looked like scenery.
    _(a63c9e9 — the same frontend commit as v1: all three rounds of play happened on the
    branch, before it was cut)_

### IDEA-045 — A basket of fruits, each worth a different score ✅
- **Priority:** 🟡
- **Area:** gameplay
- **Registered:** 2026-08-28
- **Description:** (Nuno) "Beside the inspiration for the game being Pac-Man, we changed the concept
  to a real-life case. Now let's start adding little things that will make this game feel like a
  different thing." Today there is one fruit worth a flat 100. Instead: five fruits with five
  values — Apple 100, Banana 200, Carrot 300, Strawberry 400, Mango 500 — and "the fruits with more
  value appear less times, in order to give the user a reason to take the opportunity and change the
  gameplay."
- **Notes:** Decided with Nuno on 2026-08-28: **4 fruits per map** (up from 2) so the tier ladder is
  actually readable inside a single map, and a **single weighted roll** used on every map (Apple 40 /
  Banana 25 / Carrot 18 / Strawberry 12 / Mango 5) rather than a level-gated ladder — a Mango on map 1
  is a lucky moment, which is the whole point. Five meshes replace `makeFruit()` in `board.ts`, all
  five registered in the editor's **Pickups** tab ([[IDEA-042]]) so they are editable like any other
  pickup. The awkward part is NOT the game: `server/src/validation/plausibility.ts` prices fruit at a
  single `SCORING.fruit`, so both MAX-1 (`maxLevelScore`) and MAX-5 (`itemFloor`/`itemCeiling`) must
  learn a min/max fruit value or every honest run starts failing SCORE_ITEM_MISMATCH. `npm run sync`
  in `server/` is mandatory after this. Tutorial copy names "100" out loud and must change ([[IDEA-040]]).
  Sibling of [[IDEA-046]] — same session, deliberately split so the fruits can ship on their own.
- **Closed out:** the look pass flagged on 2026-08-28 turned out not to be needed — after playing
  with the four-per-map pacing Nuno's verdict was "the fruits is perfect". Recorded rather than
  silently dropped, since the note was written here in the first place.
- **Dependencies:** —
- **History:**
  - **v1** (2026-08-28) — five fruits on a weighted roll: apple 100 / banana 200 / carrot 300 /
    strawberry 400 / mango 500, at 40/25/18/12/5, four spawns a level instead of two. The kind is
    rolled at SPAWN and remembered, never re-rolled on eat — otherwise the mango you crossed the
    maze for could pay out as an apple. `FRUIT_THRESHOLDS` moved from a module-local const in
    `game.ts` to `config.ts` beside the new `FRUITS` table, because the server's sync step reads
    both from that one file. New pure `fruits.ts` (`rollFruit` takes an injectable rand, so the
    distribution is asserted at its exact boundaries rather than sampled) and
    `scripts/test-fruits.ts`, 34 checks.
    **Two things the meshes taught us, both caught by LOOKING rather than by tests:** the first
    mango was a near-round gold ball with a green leaf and rendered as an orange APPLE — the 100 and
    the 500 sharing a silhouette, which is the one thing this set cannot afford; and the banana,
    sized to match the apple on paper, read as a sliver, because a crescent is mostly empty space
    inside its own bounding box. Shapes get judged against their NEIGHBOURS at the size they are
    actually seen. Same lesson as [[IDEA-006]] v3.
    **The awkward half was the server**, as triage predicted: `plausibility.ts` priced fruit at one
    `SCORING.fruit`, so MAX-1 and MAX-5 both had to learn a range, the client now reports
    `fruitPoints` (pinned from both sides — under-reporting drags the score floor down and buys room
    to invent points elsewhere), and a latent bug surfaced: `maxLevelScore` bounded fruit by
    `min(fruitTiles, thresholds)`, but only one fruit is ever on the board and `spawnFruit` REPLACES
    it, so the `F` tile count was never the real limit — it just happened to equal 2 as well. At
    four thresholds that would have rejected anyone who ate four fruits. A regression test also
    turned out to be checking nothing: "score ONE point over the ceiling" hardcoded 8001 against a
    ceiling written as 8000 elsewhere, and silently started ACCEPTING once the ceiling moved.
    Shipped as two commits, API first — a client scoring 500s against the old validator is rejected
    by SCORE_ITEM_MISMATCH, while old-client/new-API is safe by construction.
    _(a7bb449 api, 3ed425d frontend)_

### IDEA-039 — Server scale hygiene: metrics, session retention, Redis threshold ✅
- **Priority:** 🟡
- **Area:** backend
- **Registered:** 2026-08-18
- **Description:** the "later" items from the load-readiness assessment — the server should be
  prepared for a big group of requests before that traffic actually arrives. Three pieces, in the
  order they'll matter:
  1. **Request timing metrics** — a cheap per-request duration log (p95 per route is enough). Right
     now the first real bottleneck would be diagnosed by player complaint rather than by graph.
     Do this one FIRST, before any traffic push — it's what tells us when the other two are due.
  2. **`game_sessions` retention** — the table grows with every run ever played, forever. The
     All-runs board only reads accepted classic runs (now index-covered), but at some volume old
     rows deserve archiving or summarising. Not urgent at today's scale; the metrics say when.
  3. **Redis** — rate limits and the board cache are in-memory and per-process, which is CORRECT
     for one container (STACK.md §6 defers Redis deliberately). The moment the API runs a second
     replica, limits halve and cache invalidation stops crossing processes — that's the trigger,
     not before.
- **Notes:** registered from the 2026-08-18 assessment after the sweeper fix. What was done
  immediately instead (P1+P2, [[IDEA-020]] v4): the partial index for the All-runs query and the
  15-second board cache. What was assessed as fine without changes: rate limiting keyed on
  CF-Connecting-IP, the once-a-day token-touch throttle, argon2's natural 4-at-a-time threadpool
  ceiling, pool sizing, and the static frontend living entirely on Cloudflare's edge.

  **2026-08-25, on scope:** built as pieces 1 and 2. Piece 3 (Redis) was deliberately NOT built —
  costed first at Nuno's request. It is the one item STACK.md §6 lists under "do NOT add unless I
  ask", and with a single container it is a strict downgrade: it replaces an in-process Map lookup
  with a network hop, adds a failure mode (Redis down → fail open and drop rate limiting, or fail
  closed and lock every player out?), and spends ~64–128 MB of the CX23's RAM — which is the very
  budget §6 names as the trigger for a second VPS. Both of its real triggers (a second replica; a
  query measurably over ~200 ms) are now INSTRUMENTED rather than guessed at, by the p95 table and
  the `[slow-query]` line respectively. Piece 2 was worth doing now only because it costs €0 and
  can be made safe by construction; the measured growth rate is ~250 bytes per run played, i.e.
  ~9 MB/year at 100 runs/day, so a 90-day window deletes nothing today on purpose.
- **Dependencies:** —
- **History:**
  - **v1** (2026-08-25) — the API now measures itself, and the two deferred pieces have real
    triggers instead of hunches. **Every request is timed by the OUTERMOST middleware**, so the
    number is what a player actually waits for — CORS, the body cap, auth, argon2, the pool wait,
    the query, serialisation. A p95-per-route table goes to the container log every 10 minutes
    (silent when the window saw no traffic, so an idle API never trains anyone to ignore the log),
    a `[slow]` line fires immediately for any single request over 1s, and `GET /metrics` serves the
    same data as JSON — **404ing entirely unless `METRICS_TOKEN` is set**, with a wrong token
    getting the same 404 rather than a 401 that would confirm it exists. Cost is two `Date.now()`
    calls and one array write per request; memory is bounded by construction at 64 route keys ×
    512 samples (~256 KB) no matter the uptime.
    **`[slow-query]` sits at 200 ms deliberately** — that is STACK.md §6's own wording for the
    Redis trigger, so the trigger is now instrumented rather than guessed. It covers transaction
    statements too, via a proxied client: purchases and recovery-code consumption never pass
    through `query()`, which would have left the hole exactly where the heaviest work happens.
    Statement text only, never params — those carry usernames and token hashes.
    **Retention deletes only `abandoned` sessions** past 90 days. The status filter IS the safety
    argument: `accepted` rows ARE the All-runs board, and deleting a `rejected` row cascades away
    its `score_rejections` audit entry — proven by deliberately removing the filter and watching
    the audit log go to ZERO. At ~250 bytes per run played it deletes nothing at today's volume,
    on purpose.
    **Two bugs found by testing rather than reading.** `routePath(c, -1)` already includes the
    mount prefix, so the first draft keyed every route as `/api/v1/api/v1/...`. Worse: with two
    sub-apps mounted at the SAME prefix each declaring its own `use("*")` stack, the real handler
    sits in the MIDDLE of `matchedRoutes` and a sibling's wildcard sorts last — so `.at(-1)` filed
    `/api/v1/profile`, the leaderboard and every login under `(unmatched)`. The unit tests passed
    happily; only curling a running server exposed it, because a test app with ONE sub-app cannot
    reproduce the shape. The tests now build the real shape, and all four new guards were verified
    to fail loudly before being restored.
    **Redis was costed and deliberately NOT built** — see Notes.
    584 game + 56 metrics + 55 catalog + 58 plausibility + 43 auth-unit + 96 auth-db + 67 session
    checks pass. No Dokploy change required: every new variable has a working default.
    `server/src/http/{metrics,metrics-middleware}.ts`, `server/src/routes/metrics.ts`,
    `server/src/{db,env,index}.ts`, `server/src/repo/gameSessions.ts`,
    `server/src/services/scoreService.ts`, `server/scripts/test-metrics.ts`,
    `server/scripts/test-sessions.ts`, `server/.env.example`, `server/README.md`, `CLAUDE.md`.

### IDEA-040 — 15 maps in three stages, bonus levels, and a first-run tutorial ✅
- **Priority:** 🔴
- **Area:** modes · onboarding
- **Registered:** 2026-08-18
- **Description:** more maps — five wasn't enough once Nuno hit 41,000 points and had played the
  whole pool three times. Fifteen maps in three groups of five, each group followed by a BONUS map
  (few walls, one enemy) as a reward and a chance to earn lives. Stage 3 adds a fourth enemy. After
  map 15 the cycle repeats at four enemies for good, and clearing a full lap at that difficulty
  earns a congratulation. Plus a tutorial the first time someone plays, teaching the swipe, the
  value of biscuits and fruit, the three ways to earn a life, and that enemies are only edible
  after a white bone.
- **Notes:** **Stage 3's mazes are deliberately NOT widened for the 4th enemy** (Nuno, 2026-08-18:
  "the idea to add one more enemy is exactly that, improve the difficult so lets keep the maze just
  add the enemy") — opening the corridors up would refund the difficulty the extra enemy exists to
  add. If stage 3 ever proves too punishing the lever is `progression.ts`, never the geometry.
  Bonus numbering sits BETWEEN map numbers, so the maps stay 1–15 and a lap is 18 levels.
- **Dependencies:** [[IDEA-020]] (the validator had to learn per-level ghost counts first)
- **History:**
  - **v1** (2026-08-18) — the whole progression, the 13 new mazes, and the coached tutorial.
    **`planLevel()` is the one place progression is decided** (`src/game/progression.ts`, pure):
    which maze, how many enemies, what the HUD says. Everything else reads from it, and the SERVER
    vendors a generated copy — because a level's score ceiling depends on its ghost count, and a
    4-ghost stage-3 level legitimately out-scores what a 3-ghost one could. Sizing every level at 3
    would have rejected honest runs, which is exactly the failure that cost real players their
    scores in v5.0–v5.1. Generated rather than hand-copied, with the catalog drift test
    cross-checking 72 levels; verified the guard bites by deliberately breaking it twice.
    Submissions now carry `levelIdxSequence`, which is CHECKED rather than trusted — the server
    re-derives each level's maze from it and refuses a mismatch (`LEVEL_PLAN_MISMATCH`). Absent for
    older clients, which fall back to the 3-ghost assumption, so no queued run was lost by the
    deploy.
    **13 new mazes** (5 stage-2, 5 stage-3, 3 bonus), all passing the validator and the sim.
    Bonus maps carry 248–270 biscuits against ~190, so banking the 5,000 for a life is realistic.
    **Every maze now shares one byte-identical ghost pen.** Nine had drifted, including one whose
    pen had no side walls at all — a ghost stepped out through what looked like a solid roof, which
    is what Nuno saw on the first bonus map. Bonus maps also lost their white bones: a fright
    window there means eating the lone enemy for a free life on top of an already generous haul,
    and the golden bone already covers earning a life.
    **The tutorial coaches rather than lectures** (`tutorialCoach.ts`, pure + `ui/tutorial.ts`).
    Each tip fires when its subject is on screen; the game never pauses; the strip cannot swallow a
    swipe; Skip is always there. `tutorial_done` lives on the account (migration 004) so learning
    on a phone doesn't mean being re-taught on a laptop, and existing players were backfilled as
    taught. The account screen can bring the tips back.
    Two bugs found by testing rather than reading: `repo/tokens.ts` keeps its own column list for
    the token JOIN, so `tutorial_done` reached `/api/v1/profile` but not `/auth/me` — the tutorial
    silently replayed for players who had finished it (now guarded by comparing the two row
    shapes); and `:has(.dpad)` matched the pad element even while hidden, lifting the caption 190px
    onto the board for every swipe player.
    Also worth recording: the throwaway harness used to iterate on maze drafts let the beagle
    REVERSE, which the real sim bot forbids. That one difference invented dead-ends, and four
    mazes were "fixed" that were never broken — caught only because the same harness flagged two
    SHIPPED mazes as failing too.
    571 game + 30 browser-UI + 310 server checks.
    `src/game/{progression,tutorialCoach,runTelemetry,game,profileStore,profileMapping}.ts`,
    `src/ui/{tutorial,profile}.ts`, `src/net/{endpoints,profileSync}.ts`, `src/game/mazes.json`,
    `style.css`, `server/migrations/004_tutorial_done.sql`, `server/src/repo/{users,tokens,types}.ts`,
    `services/profileService.ts`, `routes/profile.ts`, `validation/plausibility.ts`,
    `scripts/sync-game-constants.ts`, and six test scripts.
    _(9bc0438, d227d17, a1ba99a, 77661eb, cd5947a, a309175, d284a0c)_
  - **v2** (2026-08-18) — **the tutorial rewritten as a pop-up carousel**, after Nuno played v1
    and reported the right problem: coaching captions arriving mid-chase *distract* rather than
    teach. A player being hunted has no attention left for a caption. So everything moved to five
    slides shown BEFORE the first run, and nothing appears during play any more (`tutorialCoach.ts`
    and `ui/tutorial.ts` were deleted outright rather than left dead).
    **The illustrations are the live game, not pictures.** Each slide stages a real subject through
    the existing `shopScene` — the player's own equipped beagle, their enemy skin, their maze theme
    (whose diorama already carries a biscuit trail and a bone), and the golden bone. That needed no
    new rendering at all: `game.ts` already renders `shopScene` through the one renderer while the
    shop is open, so the tutorial rides the same branch. Chosen over pre-rendered PNGs precisely
    because images go stale silently — this project has been bitten by that class of drift three
    times (the editor-residue hazard, the maze harness, the `tokens.ts` column list). `makeLifeBone`
    was exported from `board.ts` for the golden-bone slide, so the least familiar pickup in the game
    is shown as the exact mesh the player must recognise mid-run.
    Slides step one at a time with Next/Back/dots rather than scrolling sideways, because sliding
    HTML across a stationary 3D subject would be a permanent alignment fight. Input gestures are the
    one thing 3D cannot show, so slide 1 carries a flat CSS diagram — keys, swipe arc or D-pad.
    **Two copy errors fixed, both caught by a human playing rather than by any check.** "Chain all
    four in one bone" was wrong on 14 of the 18 levels in a lap: the life is granted when the chain
    equals THAT LEVEL's ghost count (3 in stages 1-2, 4 in stage 3, 1 on a bonus map), so the copy
    now says "every enemy" and a test asserts no slide ever names a number. And movement copy told
    desktop players to "swipe anywhere"; it now follows the DEVICE via
    `matchMedia("(pointer: coarse)")` — a capability check, never a UA sniff — while swipe-vs-D-pad
    still comes from the account.
    The tutorial also moved AHEAD of `beginRunSession()`: a session is timestamped when the server
    issues it, so opening it first burned the player's run clock while they read. And the account
    screen's button became **"View tutorial"**, opening the carousel immediately rather than setting
    a flag and promising tips "next game" — a delayed, invisible effect for someone who just wanted
    to check a rule.
    42 content assertions (device copy for all three input cases, the no-ghost-count rule, full
    coverage of the brief) plus a browser pass over the real flow. 584 game checks green.
    `src/ui/{tutorialSlides,tutorialCarousel,profile}.ts` (first two new),
    `src/render/{shopScene,board}.ts`, `src/game/game.ts`, `src/main.ts`, `index.html`, `style.css`,
    `scripts/test-tutorial-carousel.ts` (new, replacing `test-tutorial.ts`),
    `scripts/test-tutorial-ui.ts`. _(1b02d5c)_
  - **v3** (2026-08-28) — fix: **the server never knew which level you were on.** `levelIdxSequence`
    was collected by `runTelemetry` and understood by the validator from the day v1 shipped, and was
    neither SENT by the client nor READ by the server — two independent halves of the same gap. So
    every classic run was judged as though it had three enemies, and stage 3 (classic level 12+) has
    four: a strong run there legitimately outscores what three allow and was rejected as
    LEVEL_SCORE_CAP_EXCEEDED. Real lost scores, same family as v5.1's three.
    Neither half was catchable, and that is the part worth keeping: the body parser lived in
    `scoreService.ts`, which opens a Postgres pool on import, so no DB-free test could build a body
    and check what came out. It moved to a pure `server/src/validation/wire.ts` with a round-trip
    test that fails when a field of `RunSubmission` is forgotten in the parser — **every field the
    client sends must be named there or it is silently dropped.** The bug is pinned both ways:
    accepted with the sequence, LEVEL_SCORE_CAP_EXCEEDED without it. Found while shipping
    [[IDEA-045]], which touched the same payload. _(a7bb449 api, 3ed425d frontend)_

### IDEA-035 — Login screen: favicon, title, and Create-account / Login tabs ✅
- **Priority:** 🟡
- **Area:** accounts
- **Registered:** 2026-08-14
- **Description:** put the favicon on the screen with the game name below it, then the message about
  creating an account to keep everything. Below that, two TABS — "Create account" and "Login" — with
  Create account as the default; selecting Login shows the login form. Below the tabs, the option to
  use a recovery code.
- **Dependencies:** [[IDEA-019]]
- **History:**
  - **v1** (2026-08-14) — the gate now leads with IDENTITY rather than a form: app icon, "Beagle
    Chomp", and one line on why an account is worth having. The old three-button "choose" view is
    gone; the four internal views collapse to two (a tabbed main screen + recovery). **Create
    account is the default tab** — a brand-new player is the common case, and the previous layout
    made signing up merely one option among three. Recovery sits below the tabs, deliberately
    quieter: it's the rare path, and a third equal button cluttered the common one. Since signup is
    now the landing state, every browser test that used to click `#goSignup` just waits for the
    form. `src/ui/auth.ts`, `style.css`, `scripts/test-auth-ui.ts` (44 checks). _(25a50ed)_

### IDEA-037 — Show the equipped MAZE THEME on the menu showcase ✅
- **Priority:** 🟢
- **Area:** menu
- **Registered:** 2026-08-14
- **Description:** when a player selects a different theme, the menu preview should show the
  selected theme — the same way it already shows the equipped beagle skin.
- **Dependencies:** [[IDEA-026]]
- **History:**
  - **v1** (2026-08-14) — the menu vignette is now theme-aware. This was bigger than a palette swap,
    as triage flagged: `menuScene.ts` builds its OWN garden scene (turf patch, hedge arc, blooms,
    sky dome, 3-light rig) rather than using `board.ts`, so none of [[IDEA-026]]'s board re-theming
    applied to it. New `applyTheme()` maps a `ThemePalette` onto every themed surface — sky gradient
    stops, soil, grass rim, hedges, blooms and all three lights — mutating materials IN PLACE, the
    same technique `applyBoardTheme` uses, so re-theming is instant and allocates nothing. The
    equipped theme is applied at build time (no garden flash on first paint) and live from the shop
    via `onThemeChanged`, exactly as `onEquipBeagle` already recolours the showcase dog. Arcade
    Night ships an empty bloom palette by design, so blooms fall back to the biscuit colour rather
    than rendering black. Verified with Night City: purple dusk sky, blue city walls, dark floor and
    the beagle lit by that theme's sodium-amber rig. `render/menuScene.ts`, `game.ts`. _(25a50ed)_

### IDEA-038 — Optional on-screen D-pad for mobile ✅
- **Priority:** 🟡
- **Area:** ux
- **Registered:** 2026-08-14
- **Description:** add the option to have BUTTONS instead of finger swipes on mobile — watching
  people play on phones with a not-so-good screen, the gameplay can be frustrating.
- **Notes:** Nuno saw this with real players, which is the strongest signal the backlog has had.
- **Dependencies:** —
- **History:**
  - **v1** (2026-08-14) — an OPTIONAL on-screen D-pad. Swipe ([[IDEA-005]]) stays the default and is
    untouched; this is an alternative, chosen per player. The pad feeds the **same queued-direction
    model** the keyboard and swipe already share, so no gameplay logic changed at all — `game.ts`
    just receives `onDir(d)` from another source. `pointerdown` rather than `click` so a direction
    registers the instant the finger lands (waiting for press-and-release reads as the beagle "not
    responding"), plus `touch-action:none` and preventDefault so a thumb resting on the pad can't
    scroll or zoom the page.
    The preference lives on the **ACCOUNT** (migration `002_control_scheme.sql`), not in
    localStorage: someone who prefers buttons prefers them on every phone they sign in from, and
    since [[IDEA-019]] the profile is the natural home for that — it reaches the client through the
    same synchronous `profileStore` façade as everything else. Toggle lives in the profile screen as
    two labelled cards rather than a switch, so it's obvious what each option means before choosing.
    Verified end-to-end on a 390×844 phone: hidden by default, appears after the toggle, **pressing
    it actually steers** (score 20 from eating), hidden under every full-screen page, and the
    preference survives a reload.
    `src/input/dpad.ts` (new), `server/migrations/002_control_scheme.sql` (new), `game.ts`,
    `profileStore.ts`, `profileMapping.ts`, `net/{endpoints,profileSync}.ts`, `ui/profile.ts`,
    `main.ts`, `style.css`, server `repo/{types,users,tokens}.ts` +
    `services/profileService.ts` + `routes/profile.ts`. _(25a50ed)_

### IDEA-036 — Home menu: drop the eyebrow, carousel the buttons ✅
- **Priority:** 🟡
- **Area:** menu
- **Registered:** 2026-08-14
- **Description:** on the home menu, keep the "Beagle Chomp" title but remove the
  "three.js · maze chase" eyebrow above it. Then turn the button options into a carousel below the
  beagle so they look better on screen. On desktop, move the beagle preview a little up and put the
  buttons below it; keep mobile the same way so the two stay uniform.
- **Notes:** the menu had grown to five buttons after [[IDEA-019]]/[[IDEA-020]] — fine at two,
  crowding the 3D showcase at five.
- **Dependencies:** —
- **History:**
  - **v1** (2026-08-14) — the eyebrow is gone (a v2.0 framing device from [[IDEA-021]] v2 that had
    outlived its purpose), **Play** stays a standalone primary action, and the four destinations
    (Challenge · Shop · Leaderboard · Account) became a **carousel** so the beagle stays the hero of
    the screen. Built on native `overflow-x` + `scroll-snap` rather than a JS slider: swipe,
    trackpad, arrow keys and Tab focus all work for free, and it degrades to a plain scrolling row
    if `menuCarousel.ts` never loads — the arrows are a mouse convenience, not the mechanism, and
    hide themselves when there's nothing to scroll. The beagle was raised by lowering `menuScene`'s
    **LOOK TARGET** (0.5 → 0.34) rather than moving the camera, because the portrait dolly distance
    was tuned by projection math and derives from the camera/target pair — re-aiming re-frames the
    shot without disturbing it. One bug caught by screenshot: `scroll-snap-align:center` plus the
    centring edge padding made the rail open part-scrolled, cropping "Challenge" to "nge"; now
    start-aligned with modest padding, and the test screenshots the menu BEFORE its own scrolling
    loop so it shows what a player actually first sees.
    `index.html`, `style.css`, `src/ui/menuCarousel.ts` (new), `main.ts`, `render/menuScene.ts`,
    `scripts/test-menu-ui.ts` (new, 45 checks across desktop 1280×800 + phone 390×844). _(cc4b5d1)_

### IDEA-020 — Shared scoreboard ✅
- **Priority:** 🟢
- **Area:** social
- **Description:** a scoreboard shared between players to create some healthy competitiveness.
- **Notes:** needed identity to attribute scores ([[IDEA-019]]) and a home in the menu
  ([[IDEA-021]]). **Scope decision (2026-08-14, Nuno): CLASSIC MODE ONLY.** Challenge runs are
  deliberately unranked — their modifiers (up to 5 ghosts at ×2 speed, ghost-chain ceiling
  18,400/level vs classic's 5,600) make scores incomparable, so mixing them would hand the board to
  whoever grinds the hardest challenge level. If challenge is ever ranked it wants per-level bests
  (`best_score` per `challenge_idx`) — a new table, not a widened `high_score`.
- **Dependencies:** [[IDEA-019]]
- **History:**
  - **v1** (2026-08-14) — the shared board, plus the score pipeline that makes it trustworthy.
    Shipped in two increments.
    **Scores are server-validated.** A run gets a server-issued ticket before it starts, and the
    submitted score is judged against what the game can physically produce. The bound that does the
    real work is per-LEVEL, not per-run: classic is endless so total score is unbounded, but score
    per level isn't — every point comes from eating something finite (maze 2 with 3 ghosts caps at
    exactly **8000**) and the level count is bounded by elapsed time. That turns "unbounded score"
    into arithmetic rather than a heuristic. Elapsed time comes from `game_sessions.started_at`,
    written by Postgres: a client can lie about its score but not about how long the server has
    known the run was in progress.
    Also enforced server-side: coins recomputed from the accepted score (a client can't mint them);
    `challenge_progress` advances only on a validated clear of an already-unlocked level (closing
    the "unlock the ladder with one POST" hole); a row lock on finish making the replay guard
    airtight. Rejections return HTTP 200 with `accepted:false` (an implausible run is a normal
    outcome, not a malformed request) and are logged to `score_rejections` with enough detail to
    diagnose one in a single query — which paid off during the build, catching a test payload that
    asked for 420 pellets on a 175-pellet maze.
    Validator constants are **generated** from the real game modules (pellet counts from
    `mazes.json`, `SCORE`/`SPEEDS`/`TIMING` from `config.ts`, `FRUIT_THRESHOLDS` from `game.ts`,
    modifiers from `challenges.ts`), because if the game rebalances and the server doesn't follow,
    honest runs would start being rejected. Pinned regression assertions caught my own arithmetic
    error while writing them (maze 0 is 7750, not 7550 — the code was right).
    **The board itself** is classic-only and says so on screen, and its rows are built with
    `createElement`/`textContent` rather than `innerHTML` — the one screen rendering strings
    authored by other players, so injection is structurally impossible rather than
    escaped-and-hopefully-correct.
    Verified by playing a real run in a browser (13 checks: real input, real deaths, stored score
    matches the panel) and across two accounts (21 checks: Bob sees Alice's score, ordering
    correct, every username node asserted free of element children), plus 49 plausibility and 40
    session tests.
    `server/src/validation/plausibility.ts` (new), `services/scoreService.ts` +
    `repo/gameSessions.ts` + `routes/sessions.ts` (new), `scripts/sync-game-constants.ts`,
    `src/game/runTelemetry.ts` (new), `game.ts`, `src/ui/leaderboard.ts` (new), `main.ts`,
    `index.html`, `style.css`, `scripts/test-{plausibility,sessions,score-ui,leaderboard-ui}.ts`
    (new). _(6b3ef88, c30b690)_
  - **v2** (2026-08-17) — **runs stopped going missing**, and the board started telling the whole
    truth. Driven by players reporting scores that never appeared — one 16,000-point run showing as
    an old, lower record.
    **The root cause was the submit itself**: a single `fetch` with no retry. One dropped packet at
    the moment the last life was lost and the run was gone for good — at exactly the moment a player
    has something they care about, on exactly the devices that drop connections. Worse, profile
    writes had retried with backoff since v5.0, so the thing players cared most about had the
    weakest guarantee.
    Runs are now **persisted to the device before the first network attempt**, synchronously at game
    over, then retried with backoff and flushed on reconnect, on tab re-focus and at the next boot.
    The first cut of this persisted only after the retries exhausted (~4s), which still lost the run
    for anyone who died and swiped the app away — the normal way to leave a game over. Retrying is
    safe because the server's replay guard already accepts a session exactly once and answers 409 to
    every later attempt, so a retry after a request that succeeded but lost its RESPONSE cannot
    double-count. Each queued run stores the token that owns it: without that, signing in as someone
    else would post it under the new token, the server would answer 404, and a real score would be
    silently binned. `finishSession` also sends with `keepalive` so a closing tab is allowed to
    finish the request — a fast path, not the guarantee.
    **A dropped score is no longer invisible.** The game-over panel says when a run wasn't recorded,
    distinguishing "saved on your device, will send when you're back online" from "couldn't be
    recorded" — the old code reported a discarded run as pending, promising a delivery that was
    never coming. Before this, a lost run was indistinguishable from a broken leaderboard unless
    DevTools happened to be open.
    **The board was also hiding real scores.** It showed one row per player, so a player's other
    runs were invisible even when they were among the best ever posted — Chorizo's 13,840 and 13,040
    were in the database the whole time with nowhere to show. A second **All runs** tab lists every
    accepted classic run, one row per attempt, so the same player can hold several places including
    all three medals. No schema change: `game_sessions` had recorded every attempt all along.
    Plus: opens at the top 10 with a pinned "Show all"; a "Your best" panel with your score, rank and
    the gap to 1st; your own row sticks to the bottom when you rank below the cut (it previously sat
    at row 11, below the fold, defeating the point); own-row matching by user id rather than by
    comparing usernames; a 🏆 Leaderboard button on the game-over panel (classic only — challenge
    runs are unranked); and consistent number grouping, since pt-PT left 4-digit scores ungrouped so
    "7400" sat beside "40 800".
    **Worth recording honestly:** the original complaint was investigated first and the board turned
    out to be right — Chorizo's two accepted runs were 9540 and 6680, so the max-write correctly kept
    9540, and the run that "went missing" had been quit to the menu (which by design never scores).
    The tests had covered a WORSE later run leaving `high_score` alone but never a BETTER one raising
    it — the exact direction being reported — so that gap is now pinned through the real submit path.
    Verified in a real browser through real offline mode: queued while offline, survives a reload,
    drains on reconnect, lands on the leaderboard, and is not stolen by another account. Confirmed
    again against production after deploy, with the connection killed mid-run.
    `src/net/runSubmit.ts` (new), `net/api.ts`, `net/endpoints.ts`, `game.ts`, `main.ts`,
    `src/ui/leaderboard.ts`, `style.css`, `server/src/repo/{gameSessions,users}.ts`,
    `services/profileService.ts`, `routes/profile.ts`,
    `scripts/test-run-queue.ts` (new), `server/scripts/test-{sessions,auth}.ts`.
    _(c520d6d, 3b70f1d, b52148b, c45040f, bc167f0)_
  - **v3** (2026-08-18) — **the ACTUAL root cause of the lost scores, found and fixed** after the
    bug survived v5.1: a 40,000-point, 20-minute run vanished with no message the day after "Fair
    Play" shipped. Nuno's theory — "could the session expire during a long run?" — was exactly
    right.
    **The session sweeper was killing live games.** `STALE_SESSION_MINUTES = 10`: every 10 minutes
    the server marked ANY open session older than 10 minutes as `abandoned`, written to garbage-
    collect quit runs — but classic mode is endless, and 10 minutes is not "stale", it's a player
    doing well. Past that line the eventual finish landed on a dead session, the server answered
    409 SESSION_ALREADY_FINISHED, and the client — correctly, for the meaning 409 was supposed to
    have — treated it as "already submitted" and said nothing. No rejection logged, no notice, no
    trace. **The better the run, the more certain the loss**, which is why the reports were always
    big scores: 16,000 (~7-11 min), then 40,000 (~20 min).
    **v2's conclusion corrected:** it recorded Chorizo's missing run as "quit to the menu, by
    design". Wrong. Both of Chorizo's `abandoned` rows carry finished_at **16:39:18.864664 —
    identical to the microsecond** — one sweeper batch UPDATE, ~11 minutes after the sessions
    started. The 16,000 run was still being played when the sweeper killed it. (Also honestly:
    v5.1's durable-submit work was real but aimed at the wrong failure — network loss — so it
    couldn't have fixed this; the 409 path was its silent-success case.)
    **The fix is two independent defences, so no future tuning can reintroduce the bug:**
    (1) the sweep threshold is now DERIVED from the validator's own SESSION_TOO_OLD bound
    (`MAX_RUN_HOURS * 60` = 4 h, newly exported so the two can't diverge) — the only age at which
    an open session is provably not a finishable run is the age the validator would refuse anyway;
    (2) **resurrection** — `abandoned` is now a housekeeping guess, not a verdict: a finish
    arriving on a swept session within the validator window is judged normally and scores fully
    (started_at is still on the row, so elapsed-time validation is untouched). Only `accepted` and
    `rejected` are terminal, keeping the replay guard airtight. The sweep can now be arbitrarily
    wrong and still never cost a score.
    Consequence handled: with a 4-hour sweep, the old open-session cap ("4th run refused") would
    have locked out anyone who quit 3 runs in an afternoon — the cap now retires the player's
    oldest open session instead of refusing, same anti-stockpiling property, and even a wrongly
    retired live run is saved by resurrection.
    Pinned by 7 new session tests: a 20-minute-old open session survives the sweep; a 5-hour-old
    one doesn't; a swept 25-minute run is resurrected by its finish and banks its score; a
    resurrected session still can't be finished twice; the cap recycles without ever refusing.
    58/58 sessions, 710 checks across all suites. Client untouched — after this, 409 really does
    mean "already answered".
    `server/src/services/scoreService.ts`, `repo/gameSessions.ts`, `validation/plausibility.ts`
    (exports `MAX_RUN_HOURS`), `index.ts`, `scripts/test-sessions.ts`.
  - **v4** (2026-08-18) — load-readiness (P1+P2 of the scale assessment; the "later" items are
    [[IDEA-039]]). **P1:** the All-runs query had no supporting index — EXPLAIN showed a
    sequential scan + sort over `game_sessions`, a table that grows with every run ever played,
    executed on every board open. Migration 003 adds a partial index matching the query's exact
    predicate and sort (`accepted_score DESC, finished_at ASC` where accepted+classic), so the
    planner walks it top-down and stops at LIMIT; the count query rides the same index. **P2:** a
    15-second in-memory board cache in the service layer — the seam `db.ts` reserved for exactly
    this. The cache holds RAW rows only; the "that's you" highlight is derived per request, so one
    cached board serves every viewer without leaking one player's highlight to another. Immediate
    invalidation on the two events that change the boards: a classic accept (fired AFTER the
    transaction commits, so the game-over 🏆 button always shows the run just played) and account
    deletion (hard delete is a privacy promise — no 15-second ghost rows). Challenge accepts leave
    the cache alone (unranked). Pinned by a cache-existence probe in the DB tests (a raw-SQL score
    write must NOT appear in the cached rows) plus `__resetBoardCache()` for tests that bypass the
    services. 245 server checks green.
    `server/migrations/003_run_board_index.sql` (new), `src/services/boardCache.ts` (new),
    `services/{profileService,scoreService}.ts`, `scripts/test-auth.ts`.
  - **v5** (2026-08-18) — **the last cause of the missing scores: "Play again" never opened a
    server session.** Reported as a 19,000-point run vanishing on a freshly wiped database, and
    confirmed by Nuno reproducing it.
    `beginRunSession()` was called from exactly two places — the Play button and challenge mode.
    The game-over panel's "Play again" called `startLevel(0)` directly, bypassing it. So the replay
    had no session id, and `submitRun()` bails on its FIRST line when that is null — before any
    notice, rejection log, or trace. Every classic run started with "Play again" was discarded in
    silence. A player who died once and pressed the obvious button never scored again. It also
    skipped the telemetry reset `beginRunSession` performs, so a replay counted the previous run's
    pellets on top of its own.
    **This is why three rounds of diagnostics came back empty.** With no session, nothing reaches
    the server at all: there is no rejection to log and no abandoned row to find. Production
    confirmed it — 0 rejections, 0 accepted-but-unrecorded, and only THREE session rows total, with
    the 19,000 run among none of them. The absence was the evidence.
    It survived this long because the sweeper bug (v3) masked it: long runs died to the sweeper,
    short ones to this, both silent and identical from outside. Fixing the sweeper removed the
    noisier cause and left this exposed — which is why it read as "the bug came back" on a database
    where every run was a new account pressing Play again.
    Both entry points now route through one `startClassicRun()` that resets the counters, opens the
    session, and only then starts map 1 — making the failure structurally impossible rather than
    fixing this one instance.
    New `scripts/test-replay-session.ts` presses "Play again", which **no test had ever done** —
    precisely why it hid. Verified the test actually bites: reintroducing the old call fails it with
    "session id — null" and telemetry showing `levels:2`, the exact pollution described. 7/7 with
    the fix. Verified live by Nuno: replays now reach the leaderboard.
    `src/game/game.ts`, `scripts/test-replay-session.ts` (new). _(1671e3a)_

### IDEA-019 — Player login & cross-device account recovery ✅
- **Priority:** 🟡
- **Area:** accounts
- **Description:** a login system that identifies the player and gives them a way to recover their
  account on other devices — at least until the game becomes a fully native app.
- **Notes:** prerequisite for a shared scoreboard ([[IDEA-020]]) and for persisting shop purchases
  across devices ([[IDEA-012]]). Turned the game from a static offline PWA into a full-stack app:
  first project deployed on the Dokploy/VPS platform described in `STACK.md`, and the one that
  **proved the Cloudflare Origin Certificate + orange-cloud method end to end** (STACK.md §10's
  stated precondition before História's irreplaceable data migrates).
- **Dependencies:** —
- **History:**
  - **v1** (2026-08-14) — accounts, live at **beaglechomp.nunoamorim.dev** +
    **beaglechomp-api.nunoamorim.dev**. Shipped in two increments behind a health-only deploy that
    de-risked the infrastructure before any product code existed.
    **Auth model — no email, ever** (Nuno's brief): username + password only, argon2id hashes, and a
    single-use **recovery code** (`BEAGLE-XXXX-XXXX-XXXX`, 60 bits from a Crockford alphabet with no
    I/L/O/U so a hand-transcribed code can't be mis-read) that both resets a forgotten password and
    signs in on a new device. Consuming one issues a replacement, shown with equal prominence.
    Single-use is enforced by a row lock (`SELECT … FOR UPDATE` around verify+rotate in one
    transaction), not by timing — and the new password is validated **before** the code is consumed,
    so a typo'd password can't burn the code and leave the player locked out holding a dead one (the
    worst failure this system can produce; there's a test for it).
    A password reset revokes every other token; a new-device sign-in deliberately doesn't.
    **Sign-in before play is structural**, not a scattered check: `main.ts` awaits the auth gate
    before `new Game()` exists. No guest mode, no local→account migration (hard cut, agreed: Nuno
    was the only player). **The blocking recovery screen** is a functional requirement — with no
    email on file it's the only thing between a player and a permanently lost account — so Escape,
    backdrop clicks and stray clicks all fail to dismiss it; only checkbox + button does.
    **Client refactor:** `profileStore.ts` moved from localStorage to a server-backed cache while
    keeping all 19 exports' EXACT synchronous signatures — `game.ts`/`shop.ts`/`levelMap.ts` (~27
    call sites, several in the frame loop) compile untouched. Writes are optimistic locally and
    reconciled by a background sync queue. `getProfileCache()` now THROWS when unhydrated rather
    than returning defaults, because silent defaulting is exactly how the [[IDEA-021]] v3 bug
    shipped. Prices come from a generated catalog (`npm run sync` from the real registries) with a
    drift test — the client never sends a price.
    Deviations recorded in STACK.md rather than left as drift: hand-rolled auth instead of Better
    Auth (the recovery flow has no equivalent there), one Postgres service per project (Dokploy has
    no UI to add a database to an existing service), and §8's "no recovery flow" amended.
    Browser-driven verification caught a bug no headless test could: the username `pattern`
    attribute was silently disabled — browsers compile it with the RegExp `v` flag where an
    unescaped `-` in a character class is a syntax error, and the escape doesn't survive esbuild.
    Verified on production: **32 UI checks · 86 DB tests · 43 auth units · 43 catalog**, plus the
    full game suite, typecheck and build.
    `server/` (new: Hono + pg + argon2, 20 modules), `src/net/*` (new), `src/game/profileCache.ts` +
    `profileMapping.ts` (new), `profileStore.ts` (rewritten), `src/ui/{auth,recoveryCode,profile,
    privacy,boot,escape}.ts` (new), `main.ts`, `index.html`, `style.css`,
    `scripts/test-auth-ui.ts` (new), `test-cosmetics.ts`, `STACK.md`. _(24dcaee, 2804e38, f11fe3b)_

### IDEA-032 — Save-to-file for the editor (stop the copy-paste footgun) ✅
- **Priority:** 🔴
- **Area:** tooling
- **Registered:** 2026-07-13
- **Description:** the character editor's "Copy full file" produces the WHOLE `characters.ts` (edit
  block injected before `return g;`) — so it must REPLACE the file, but nothing says that, and
  pasting it at the END stacks generated blocks and deletes body parts (shipped a three-legged
  beagle, [[editor-residue-hazard]]). Add a **"Save to file"** button that writes the file directly
  via a tiny dev-only Vite middleware (works only under `npm run dev`) — no copy-paste, no
  wrong-place risk. Keep the copy buttons as a fallback with clearer labels + inline instructions
  (Copy edits = paste before `return g;`; Copy full file = replaces the whole file).
- **Notes:** Nuno hit this directly. Applies to ALL editor export surfaces: character
  `characters.ts`, Board&Themes `themes.ts`, Props `props.ts`. The middleware whitelists exactly
  those three paths, dev-only (never in the built PWA). Kills the recurring residue hazard at the
  root. First item of v4.2.
- **Dependencies:** [[IDEA-025]]
- **History:**
  - **v1** (2026-07-13) — the save-to-file fix, first item of v4.2 "Editor Power". A DEV-ONLY Vite middleware (`/__save-file`, `apply:"serve"` so it's never in the production build) writes exactly three whitelisted, path-contained source files (`characters.ts` / `themes.ts` / `props.ts`). `saveFile.ts` client helper (never throws; falls back on failure). Character mode gets a prominent green "💾 Save to characters.ts" that writes the file directly — no copy-paste, no wrong-place risk, no stacking (this is the root-cause fix for the three-legged-beagle residue: [[editor-residue-hazard]]). Copy buttons kept as clearly-relabelled fallbacks ("paste before return g;" / "replaces the whole file"). Board/Props modes got their own "Save to themes.ts"/"Save to props.ts" via [[IDEA-034]]/[[IDEA-033]]. Verified live: edit → Save → one clean block before makeBeagle's return g;, typechecks; endpoint absent from dist. `vite.config.ts`, `src/editor/saveFile.ts` (new), `main.ts`, `editor/index.html`, `editor.css`. _(63faaf5)_

### IDEA-033 — Props as editable part-assemblies (per-component editing) ✅
- **Priority:** 🟡
- **Area:** tooling
- **Registered:** 2026-07-13
- **Description:** props in the Props tab become part-assemblies edited like the beagle: select a
  component (a building's window, a tree's crown, a lamp's head) → move/scale/recolor it, ADD new
  primitive parts, DELETE parts. Today's parametric-only model "doesn't give much more
  possibilities" (Nuno) — this makes props first-class editable models with a part tree +
  inspector, reusing the character editor's part-editing machinery.
- **Notes:** Nuno: "select one component of the props and edit, like the beagle… add more
  components or delete." Big: props stop being pure `PropParams` bundles and gain an editable part
  list (the parametric defs become the STARTING geometry, then per-part edits layer on — same
  decal-shell/part-inspector approach as [[IDEA-025]]). Export via [[IDEA-032]]'s save-to-file.
  Builds on [[IDEA-029]]. Keep the existing 10 defs working as the base shapes.
- **Dependencies:** [[IDEA-029]], [[IDEA-025]]
- **History:**
  - **v1** (2026-07-13) — props became editable PART-ASSEMBLIES (Nuno: "select one component of the prop and edit, like the beagle… add more components or delete"), second item of v4.2. `PropDef` gains an OPTIONAL `parts` layer (`PropPartEdit` transform/color/visibility addressed by a DFS path + `AddedPropPart` primitives) applied ON TOP of the parametric base shape; every shipped def omits it, so all 6 boards render byte-identically. `board.ts`'s 9 factories now NAME every mesh (base/window0..N, trunk/crown0..N, …) and `makePropFromDef` applies `parts` after building the base. The Props tab gains a real per-prop COMPONENT tree + per-part inspector (transform/material/visibility), add-primitive-part, delete-part, its own undo stack, and keyboard nudge — the same direct manipulation as the character editor ([[IDEA-025]]) — plus "💾 Save to props.ts" ([[IDEA-032]]). Two real flush-sequencing bugs caught in build (def-switch writing edits onto the wrong def; a redundant rebuild silently deleting a saved `parts` field). `props.ts`, `board.ts`, `src/editor/propPartEditLog.ts`+`propsPartInspector.ts`+`propsPartCodegen.ts`+`propsFileExport.ts` (new) + `propsCodegen/propsWorking/propsInspector.ts`, `main.ts`, `editor/index.html`, `editor.css`, `scripts/test-editor-props.ts`. _(e6e5061)_

### IDEA-034 — Fuller on-board prop editing (move · rotate · scale · add · delete · highlighted slots) ✅
- **Priority:** 🟡
- **Area:** tooling
- **Registered:** 2026-07-13
- **Description:** on Board & Themes, edit placed props in place with more power: select a placed
  prop and move / ROTATE / scale it (Nuno specifically wants rotation), add props to highlighted
  empty slots, delete placed ones — for both apron props AND wall components. Clear visual
  HIGHLIGHTING of every valid spot while placing. (Per-placement color is intentionally NOT
  included — Nuno: "if I want a different-color umbrella I create a prop for that"; color lives in
  the library [[IDEA-033]].)
- **Notes:** Nuno: "add and delete… edit the position and the rotation and the blooms or wall maze
  components, with the indication where I can put this." Extends [[IDEA-030]]/[[IDEA-031]]'s
  placement editing (which already has slot markers + offset/rotation/scale sliders) toward a more
  visible, direct-manipulation flow: brighten/animate the valid-slot highlight, make rotation
  first-class, ensure add+delete are obvious for both apron and wall sub-modes. Export via
  [[IDEA-032]].
- **Dependencies:** [[IDEA-030]], [[IDEA-031]]
- **History:**
  - **v1** (2026-07-13) — fuller ON-BOARD prop editing (Nuno: "add and delete, edit the position and rotation, with indication where I can put this"), third item of v4.2. Empty slot markers now PULSE (a shared sine wave), read LARGER and blue vs filled — an unmistakable "put things here" affordance, for both apron and wall sub-modes. Rotation is first-class: `[`/`]` rotate the selected placement (Shift = quarter-turn coarse, Alt = fine), wrapped to [0, 2π); an on-screen hint spells the whole vocabulary out (click a highlighted slot to plant · arrows nudge · [ / ] rotate · - / = scale · Delete removes). Move/scale/add/delete work for apron props AND wall components. "💾 Save to themes.ts" ([[IDEA-032]]) writes the whole file (generateFullThemesFile splices the edited theme back into MAZE_THEMES). Per-placement color deliberately NOT added — color lives in the prop library ([[IDEA-033]]), Nuno's call. (The build was completed by an agent that died mid-run before testing; the 3 remaining failures were diagnosed as test bugs — a rotation-wrap expectation + HMR-reload state leaks — and fixed; the implementation was sound.) `src/editor/boardPlacement.ts`, `boardInspector.ts`, `boardTree.ts`, `boardCodegen.ts`, `main.ts`, `scripts/test-editor-board.ts`. _(e6e5061)_
  - **v2** (2026-07-13) — fix (Nuno: "I just don't see the highlight places to add a new prop on the board"): the v1 slot markers were flat discs lying ON the floor — from the board's steep top-down camera they compressed to near-invisible slivers and got occluded by neighbouring props, so empty slots read as invisible even though they pulsed in data. Added a raised BEACON: a bright light-blue octahedron "diamond" that HOVERS ~0.6 units above each EMPTY slot (bobs + spins + pulses), standing clear of the floor and any prop so it's unmistakable from above. Shows only while a slot is empty AND its sub-mode is active; vanishes when filled/selected. The flat disc stays the click target (raycast unchanged). Fixed a paint/visibility ordering coupling along the way (beacon visibility now reads `subMode` directly, not a possibly-stale `mesh.visible`). Verified live: beacons ring the whole apron on an empty (Arcade Night) board and fill the gaps between planted props on the garden board. `boardPlacement.ts`. _(64cc7fb)_


### IDEA-029 — Reusable prop library + a Props editor tab ✅
- **Priority:** 🟡
- **Area:** tooling
- **Registered:** 2026-07-13
- **Description:** props stop being inline per-theme populations and become a shared LIBRARY of
  named, reusable, tunable definitions, edited in a dedicated **Props tab** in the editor. Each
  library prop is one of the base shapes (tree/pine/palm/shrub/building/streetlight/umbrella/…)
  with editable parameters — name, colors, proportions (height/width/segments), window counts,
  tilt, glow — so the same "Oak" or "Skyscraper" can be reused across themes and personalized
  later. Copy-code export like the other editor tabs.
- **Notes:** Nuno: "have on the editor the tab to edit the props… reuse the props on different
  themes… personalize the props later." Refactors [[IDEA-026]]'s `ThemeProp` (kind+density) into
  a `PropDef` registry (`props.ts`, pure, mirrors themes.ts/cosmetics.ts) that the render factories
  in `board.ts` read. Chosen scope: TUNABLE PARAMETRIC props (not raw-primitive assembly — that
  would be a second character-editor, a later idea). Foundation for [[IDEA-030]] (placement) and
  [[IDEA-031]] (wall components). Extends the editor built in [[IDEA-025]]/[[IDEA-027]].
- **Dependencies:** [[IDEA-026]]
- **History:**
  - **v1** (2026-07-13) — the prop LIBRARY + a Props editor tab, first item of v4.1 "Set Dressing". `props.ts` (new pure module, mirrors themes.ts/cosmetics.ts): `PropDef { id, name, shape, params }` with 10 named reusable defs (Shrub, Oak Tree, Pine, Palm, City Tower, Streetlight, Beach Umbrella + wall pieces Flower Bloom, Wall Lamp, Transit Signal). `PropParams` is an all-optional tunable bundle (height/width/segments/tilt/foliageColors/trunkColor/facadeColors/windowRows/windowCols/windowColor/windowEmissiveIntensity/rooftop/glowColor/glowIntensity/signBoardColor), each with a documented default the render factory applies; `PROP_SHAPE_FIELDS` drives which controls the editor shows per shape. board.ts's prop factories became PARAMETRIC (every field drives geometry) behind `makePropFromDef(def, hash)`/`makePropById`. Editor gains a THIRD mode "Props": a library editor with a live turntabled 3D preview per selected prop, shape-aware lil-gui controls, add/duplicate/remove, a "used by N placements" badge (scans every theme), and "Copy library code" that round-trips into props.ts. New `propsWorking/propsCodegen/propsTree/propsInspector.ts` + main.ts mode wiring; `scripts/test-editor-props.ts` (69 checks, `npm run test:editor:props`). `props.ts` (new), `board.ts`, `shopScene.ts`, `src/editor/props*.ts` (4 new), `main.ts`, `editor/index.html`, `editor.css`, `package.json`. _(c33e6d8)_

### IDEA-030 — Explicit prop placement on the board (place · move · save) ✅
- **Priority:** 🟡
- **Area:** tooling
- **Registered:** 2026-07-13
- **Description:** replace density-scatter with HAND placement. A theme carries a list of explicit
  placements `{ propId, tile, offset, rotation, scale }` on the apron ring; in the editor's Board
  & Themes mode you see the available apron slots, click one, choose a library prop, adjust its
  position/rotation/scale, and save. Total control over where every prop sits — "fix some props
  position" instead of random.
- **Notes:** Nuno: "edit the position of the props… select the place, choose the props, adjust the
  position and save." The current hash-scattered [[IDEA-026]] props are CONVERTED into concrete
  saved placements as the starting content, so the 6 themes look unchanged on first load but every
  prop becomes individually movable. Props still stay OUTSIDE the maze (apron only — Nuno confirmed
  that part is "exactly what we should do"), and keep the per-side height-cap safety so a placement
  can't block the camera. Consumes the [[IDEA-029]] library; placements export in the theme code
  ([[IDEA-027]]'s Copy theme code).
- **Dependencies:** [[IDEA-029]]
- **History:**
  - **v1** (2026-07-13) — explicit HAND placement (Nuno: "select the place, choose the props, adjust the position and save"), second item of v4.1 "Set Dressing". `MazeTheme.props` (IDEA-026 density populations) replaced by `placements: PropPlacement[]` — `{ propId, tile, offset, rotationY, scale }`, each prop sitting at a chosen spot referencing a library def ([[IDEA-029]]). The 6 shipped themes' scattered props were CONVERTED to concrete saved placements by replaying the real v4.0 scatter algorithm against the real grid (counts identical — garden 29, forest/park/city 40, beach 23), so every board is byte-for-position unchanged but every prop is now individually movable. board.ts `buildProps` consumes placements; a render-time per-side height cap (south row clamps tall shapes, east/west caps to ≤1.0) protects hand-authored placements from blocking the camera. Editor Board & Themes mode gains on-board placement: faint SLOT MARKERS on every apron-ring candidate tile (solid circles — a real bug fixed: ring markers were unhittable by a center raycast), click to place/select, lil-gui offset/rotation/scale + prop-swap + remove, arrow-key nudge, live apply through applyBoardTheme; "Copy theme code" emits the placements. Props stay OUTSIDE the maze (apron only), as Nuno confirmed. `themes.ts`, `board.ts`, `src/editor/boardPlacement.ts` (new), `boardInspector.ts`, `boardTree.ts`, `boardCodegen.ts`, `main.ts`, `scripts/test-editor-board.ts` (96 checks). _(c33e6d8)_

### IDEA-031 — Wall-top component slots (blooms OR lamps · signals · …) ✅
- **Priority:** 🟢
- **Area:** tooling
- **Registered:** 2026-07-13
- **Description:** generalize the wall-top bloom layer into placeable COMPONENT slots: per wall
  tile, choose what sits on top — blooms (as today), a lamp, a transit signal, or other simple
  pieces — and pick which wall tiles carry them, adjusting height/rotation. Blooms stay perfect on
  some maps; others get street furniture instead.
- **Notes:** Nuno: "add components in the place of the blooms… lamps, transit signals, simple
  things… choose on the maze wall where to place it." Reuses [[IDEA-029]]'s library + [[IDEA-030]]'s
  placement system, just on wall tops instead of the apron. Supersedes [[IDEA-011]]'s density-bloom
  model with explicit per-tile component placement (keeps a bloom component so the garden look is
  preserved). Chosen scope: pick-component-per-wall + place (not new density kinds).
- **Dependencies:** [[IDEA-029]], [[IDEA-030]]
- **History:**
  - **v1** (2026-07-13) — wall-top COMPONENTS (Nuno: "add components in the place of the blooms... lamps, transit signals... choose on the maze wall where to place it"), third item of v4.1 "Set Dressing". `MazeTheme.wallDecor: WallDecorPlacement[]` generalizes IDEA-011's density blooms into per-wall-tile components referencing library props ([[IDEA-029]]) — bloom / wall lamp / transit sign. An EMPTY wallDecor falls back to the palette's scattered density blooms (garden/forest/beach/park unchanged); Night City ships 5 hand-placed lamp/signal wall pieces as the demo. New `bloom` + `sign` render factories (small wall-top scale); wall decor folded into `board.hedgeDecor` (widened to Object3D[]) so no game.ts teardown change was needed. Editor "Wall components" sub-mode: markers on every wall-tile top, place/adjust, exports in wallDecor. `themes.ts`, `board.ts`, `src/editor/boardPlacement.ts`, `boardInspector.ts`, `boardTree.ts`, `scripts/test-editor-board.ts`. _(c33e6d8)_


### IDEA-026 — Maze themes in the shop (garden · classic · forest · beach · park · city) ✅
- **Priority:** 🟡
- **Area:** theme
- **Registered:** 2026-07-12
- **Description:** add maze skins to the shop too — themes for the maze so the player can
  personalize it. The default is the garden, but we can have the classic one in black and blue,
  then add a few variations: forest, beach, park, city, etc.
- **Notes:** the future scope that [[IDEA-012]] and [[IDEA-023]] explicitly deferred ("map themes
  need a theme-swap system first"). The groundwork anticipated it: the palette lives centrally in
  `config.ts` COLORS ([[IDEA-008]]) and the hedge-top detailing was built as a per-theme hook
  ([[IDEA-011]]) — a theme = palette + wall/floor materials + decor set (+ sky/lighting). Sold and
  equipped through the shop like skins (profile blob gains equipped/owned themes; shop gets the
  themes tab [[IDEA-023]] reserved). "Classic black and blue" honors the pre-garden v1.0 look.
  Per-theme decor detailing pairs with the maze editor idea ([[IDEA-027]]).
- **Dependencies:** — (shop [[IDEA-012]] already delivered)
- **History:**
  - **v1** (2026-07-12) — the theme system + storefront + WORLD PROPS, first item of v4.0 "New Territory". Pure `themes.ts` registry (mirrors cosmetics.ts): 6 themes — **The Garden** (free default, palette regression-guarded byte-for-byte), **Arcade Night** (5🪙, the exact v1.0 black/blue palette recovered from git history, deliberately clean/propless), **Deep Forest**, **Sunny Beach**, **City Park**, **Night City** (10🪙). A theme = full palette (bg/backdrop/walls/floor/biscuits/3-light rig/bloom+speck decor) + PROPS (Nuno's follow-up ask): shrub/tree/pine/palm/building/streetlight/umbrella populations on the board's apron ring — deterministic placement, tunnel mouths excluded, per-side height caps so the city SKYLINE (lit windows!) rises behind the board and never blocks the camera; forest reads as a clearing in a pine ring, beach gets umbrellas + palms, park gets trees + lamps. Shop gains the 🌳 Themes tab (4-dot palette swatches) with live 3D maze-corner DIORAMAS per theme incl. signature props; buy/equip mirrors skins (atomic, ownership-gated, persisted). Re-theming is LIVE: shared materials mutate in place + decor/props rebuild — works mid-run with every eaten pellet preserved, and survives resize + reload. Menu showcase deliberately stays garden. Build fixes caught in screenshot review: backdrop dome captured module-scope colors at import time (booted under the garden sky), diorama camera 2.4x too close, Night City reading as an Arcade Night clone (now purple-dusk + sodium-amber identity), shared trunk material that dispose would corrupt, city draw-call trim. `themes.ts` (new), `profileStore.ts`, `shop.ts`, `board.ts`, `scene.ts`, `shopScene.ts`, `game.ts`, `scripts/test-cosmetics.ts`. _(935a411, 17f722c)_

### IDEA-027 — Editor: edit the maze too (theme-aware board editing) ✅
- **Priority:** 🟢
- **Area:** tooling
- **Registered:** 2026-07-12
- **Description:** the editor should allow editing the maze too — this way we can add a personal
  touch for each theme, make the maze more relatable to its theme, and upgrade the visuals.
- **Notes:** grows the character editor ([[IDEA-025]]) a second workbench: the BOARD. A different
  problem than characters — the board is generated per-tile from grid data as instanced meshes
  (`render/board.ts`), not a hand-built group — so this likely means editing the theme RECIPE live
  (wall/floor/rim materials, decor placement, flower palette) and exporting the recipe code,
  rather than dragging individual meshes. Purpose-built for theme detailing ([[IDEA-026]]): pick a
  theme, tweak its look, copy the code.
- **Dependencies:** [[IDEA-026]] (soft — could prototype on the garden theme alone)
- **History:**
  - **v1** (2026-07-12) — the "Board & Themes" workbench, second item of v4.0 "New Territory". The /editor/ page gains a mode toggle: pick any of the 6 themes as a base and see a REAL validated maze (built by the actual `buildBoard`) under that theme's own atmosphere, orbit-framed via scene.ts's real fit math. EVERYTHING edits live through lil-gui — Atmosphere/Walls/Floor/Biscuits/Blooms/Specks folders plus a PROPS panel (Nuno's ask: add/remove/tune the shrub/building/streetlight/umbrella/... populations per theme — kind dropdown, density, scale band, up to 4 colors) — all applying through the real `applyBoardTheme` so the preview is honest. "Copy theme code" emits a paste-ready `MAZE_THEMES` entry (id/name/price editable, so brand-new themes can be authored, not just tuned); format byte-compatible with themes.ts, round-trip verified. Switching back to Character restores the workbench exactly (nothing torn down). Board mode ships without undo by design (the base-theme dropdown is the reset; documented). New committed Playwright suite `scripts/test-editor-board.ts` (86 checks incl. live prop-mesh-count assertions); `npm run test:editor` now runs character (40) + board (86). Dev-only boundary verified (dist/ greps clean). `src/editor/board*.ts` (4 new), `main.ts`, `stage.ts`, `editor/index.html`, `editor.css`, `package.json`. _(9fba958, 17f722c)_


### IDEA-014 — Level map / level select for challenge mode ✅
- **Priority:** 🟢
- **Area:** modes
- **Description:** let the player see the levels that exist in the new challenge mode and pick the
  one they want to play — like a level map.
- **Notes:** the front end for [[IDEA-013]]; reached from the main menu ([[IDEA-020]]).
  Fourth/final build of v3.0 "New Tricks". Replaces the menu 🏆 button's auto-continue with a
  proper selection screen; `challengeProgress` ([[IDEA-013]]) provides locked/unlocked/cleared
  states; CHALLENGE_LEVELS provides names/blurbs/mazes for the cards.
- **Dependencies:** [[IDEA-013]]
- **History:**
  - **v1** (2026-07-12) — the 🏆 Challenge button now opens a full-screen GARDEN PATH level map (`ui/levelMap.ts`, three-free): a winding SVG trail with the 8 levels as stepping stones — cleared = hedge-green with a 🐾 stamp, current = pulsing gold, locked = dimmed with a 🔒; tap a stone → footer shows name + blurb + twist summary → ▶ Play starts exactly that level; cleared levels replayable; grounded hedge hills anchor C1 (start) and C8 (summit) and scroll with the trail; "n/8 cleared" header. Post-playtest fix (Nuno's report): the map's Play path closed the page WITHOUT firing onClose, leaving `body.map-open` set — the HUD stayed hidden all run and the menu's buttons stayed hidden after game-over → Menu; close() now always fires onClose (verified live: HUD visible on a map-launched run, game-over→Menu buttons visible, Back path regression-checked). Build iterations also fixed tap fall-through (pointer-events) and scroll-position timing, and compressed the trail so a screen shows the journey (~5-6 stones desktop, ~7 phone). `levelMap.ts` (new), `game.ts`, `index.html`, `style.css`. _(51df1ce)_
  - **v2** (2026-07-12) — desktop layout rework (Nuno's spec): full-width sticky top bar like the shop's; a right SIDE PANEL replacing the cramped footer (level name, full blurb, twist list line-by-line, "on {maze}" via new `MAZE_NAMES` in `challenges.ts`, state, big ▶ Play); and PAGE-level scrolling (scrollbar at the window edge, trail scrolls under the header). Mobile byte-identical. Fixes folded in: summit/ground hills clamped so they can never bleed behind the header/page edges (getBBox-verified), and the "black square around the current node" bug — SVG `<g>` nodes get the browser's rectangular native focus outline, and mouse clicks dodge `:focus-visible` in Chromium, so the old suppression never fired; now unconditional `outline:none` + SVG-native circular stroke rings (box-shadow doesn't paint on SVG circles) + a keyboard-only circular gold focus ring + a smooth ease-in-out breathing pulse (frame-sampled, no snap). `levelMap.ts`, `challenges.ts`, `style.css`. _(fc9996d)_


### IDEA-013 — Challenge mode: per-level twists ✅
- **Priority:** 🟡
- **Area:** modes
- **Description:** a new game mode using the same core game system but with a different challenge as
  the player advances through levels. Level 1 plays like the classic game; level 2 is speed x2;
  level 3 has more enemies; level 4 the maze changes after a few seconds or the walls move around —
  and so on. Each level throws a new twist at the player.
- **Notes:** reuses the classic engine; the twists are modifiers layered on top. Pairs with the
  level select ([[IDEA-014]]).
  Third build of v3.0 "New Tricks" — the release's centerpiece. Rides the proven engine as a
  MODIFIER layer; the 5-maze pool ([[IDEA-015]]) provides board variety; menu ([[IDEA-021]]) gets
  the mode's entry point; [[IDEA-014]] adds the level map afterwards.
- **Dependencies:** —
- **History:**
  - **v1** (2026-07-11) — 8-level challenge mode as a pure MODIFIER layer over the classic engine (`challenges.ts`, three-free: speedMult/ghostSpeedMult/ghostCount 3-5/frightSeconds per level; classic runs the explicit baseline and is verified untouched). Levels C1 "Warm-Up Walkies" → C8 "Top Dog" (speed ×2 + 5 ghosts + 3s fright on The Crossroads), dog-punny names + blurbs, all 5 pool mazes used. GHOST_DEFS generalized 3→5 (new team colors ghostViolet 0x9b6bd6 + ghostLeaf 0x6fb84a, 4th corner + bottom-mid spawns, enemy skins apply automatically); perfect-fright life bonus fixed to scale with pack size (was hardcoded 3). Menu gains 🏆 Challenge (continues at highest unlocked); per-level completion panels + an All Clear 🏆 finale; game-over "Play again" restarts the same challenge level. `challengeProgress` persisted in the profile blob (max-write, back-compat) — feeds [[IDEA-014]]'s level map next. Full coins/lives economy active in challenge levels. Moving-walls twist deferred to the Inbox. Verified live: C1 baseline vs C8 (5 ghosts @ ×2, fright 3), progress persists to all-clear=8, classic pristine, zero errors; build + tests green. `challenges.ts` (new), `game.ts`, `config.ts`, `profileStore.ts`, `index.html`, `scripts/test-cosmetics.ts`. _(325377f)_


### IDEA-018 — Bonus lives: pickups & milestones ✅
- **Priority:** 🟢
- **Area:** economy
- **Description:** same logic as the classic-mode coins, but for lives. Give the player extra lives
  via: a bone appearing at random in the maze, or after a big group of points, or when they eat all
  3 enemies in a single power-up.
- **Notes:** mirrors the coin-drop mechanic ([[IDEA-017]]) but rewards lives. The "eat 3 enemies →
  bone" trigger ties into scoring in [[IDEA-003]].
  Second build of v3.0 "New Tricks". All three proposed triggers have proven machinery to mirror:
  the maze pickup ([[IDEA-017]]'s coin spawn/despawn), the points milestone ([[IDEA-016]]'s
  coinsDueFromScore), and the perfect-fright bonus (game.ts's ghostEatChain already counts).
- **Dependencies:** —
- **History:**
  - **v1** (2026-07-11) — three extra-life triggers, all through one cap-aware `grantLife()` (max 5, START_LIVES 3, happy 1-UP jingle): a **golden bone** maze pickup (once per level at pellet 130, empty-tile placement, 18s despawn — big glowing gold, unmistakable vs white power-bones), a **5,000-point milestone** (reuses `coinsDueFromScore`), and a **perfect fright** (all 3 enemies in one bone). Lives stay per-run in memory (core-state rule — no persistence). Verification caught a real exploit: threshold spawn gates REFIRED after a pickup was consumed (eaten count unchanged) → infinite farming; latent in coins ([[IDEA-017]]) and the v1.0 fruit ([[IDEA-003]]) too. Fixed for all three with once-per-level threshold pointers on `LevelAssets` + pure `shouldFireThreshold` (`pickups.ts`, new) + 17 regression assertions; farm re-repro'd dead live (exactly +1, no respawn, twice). `config.ts`, `game.ts`, `pickups.ts`, `board.ts`, `sound.ts`, `scripts/test-cosmetics.ts`. _(3db894d)_


### IDEA-015 — Classic mode: change the maze each level ✅
- **Priority:** 🟡
- **Area:** modes
- **Description:** in the classic mode, when the player clears a level, change something to keep it
  fresh. Proposal: swap the maze on each level so there's something different to challenge the
  player instead of replaying the same board.
- **Notes:** needs a pool of mazes to rotate through (level-designer work). Ties into the maze-detail
  themes ([[IDEA-011]]).
  First build of v3.0 "New Tricks". Awareness: the ROTATION mechanism already ships (levelClear →
  startLevel(idx+1) → MAZES[idx % MAZE_COUNT], HUD "MAP n · lap") — the gap is the POOL (only 2
  mazes). This build = author new validated mazes; the pool later feeds challenge mode ([[IDEA-013]]).
- **Dependencies:** —
- **History:**
  - **v1** (2026-07-11) — maze pool grown 2 → 5 with three new authored boards, each a distinct personality: **The Courtyard** (open central plaza, lone pillars, risky sightlines, 204 pellets), **The Warren** (dense pillar lattice, narrow paths everywhere, 202), **The Crossroads** (big hedge slabs, long arteries + tunnel wrap, 180). Pure 69-line append to `mazes.json` — zero engine changes (rotation/HUD/camera/decor/spawns are all grid-driven). All 5 mazes pass the validator + full gameplay sim; the sim caught two authoring issues (corridor-spacing stall, spawn-funnel) that were fixed before ship. `mazes.json`. _(37fae8b)_


### IDEA-023 — Shop v2: dedicated page with tabs + 3D skin gallery ✅
- **Priority:** 🟡
- **Area:** shop
- **Description:** improve the shop experience — a page dedicated to the shop, with tabs so the
  player selects the kind of skin they want to buy. For the skin showcase, cards with images or a
  gallery with the 3D of the skin — for the beagles AND the enemies: see them in a kind of gallery
  with the 3D model and the name. Themes can come later.
- **Notes:** UX redesign of the delivered shop ([[IDEA-012]]) — the current overlay works but shows
  color-dot swatches (beagles) and emoji (enemies). The 3D gallery idea pairs naturally with the
  menu's live showcase tech ([[IDEA-021]] v2's `menuScene` — small per-card 3D previews or one
  rotating preview per tab). Themes tab stays future scope until a theme-swap system exists.
  Second/final planned item of v2.1 "Groomed" — built after [[IDEA-024]] so the gallery showcases
  the rebuilt model. Presentation-only redesign: the buy/equip/ownership data layer from
  [[IDEA-012]] is reused unchanged.
- **Dependencies:** [[IDEA-012]]
- **History:**
  - **v1** (2026-07-11) — the shop became a full-screen character-select page: header (back · title · live 🪙 balance), 🐶/👾 tabs, a LIVE 3D hero turntable (new `render/shopScene.ts`, same garden-vignette language as the menu showcase; hero swaps rebuild + dispose cleanly; enemies previewed in team rose) and a card rail/list. Desktop puts all chrome in a RIGHT SIDE PANEL (tabs → vertical card list → info+action pinned at bottom) so the 3D stage stays clean — owner-requested layout; phone keeps the stacked layout (one DOM, `display:contents` + `order` responsive switch). Opening the shop now PAUSES a mid-run game (full-screen page; the old overlay let ghosts hunt you invisibly). Buy/equip data layer from [[IDEA-012]] reused unchanged. Verified live: tabs, hero swaps, real buy+equip (coins deduct, persists), can't-afford state, pause/resume, desktop+phone, zero errors; build+tests green. `shopScene.ts` (new), `shop.ts`, `game.ts`, `index.html`, `style.css`. _(83d1c12)_


### IDEA-044 — Themed floor surfaces, painted from the maze grid ✅
- **Priority:** 🟡
- **Area:** render
- **Registered:** 2026-08-27
- **Description:** (Nuno) "Now let's work on the floor. On the Garden we can make the surface look
  like a stone path resembling a neatly arranged or well-tended garden. On the Deep Forest, stick
  with the forest interior and make the floor look like a patch of earth. On the Sunny Beach the
  floor should look like sand. On the City Park, recreate city parks where there's grass on the
  ground but a gravel path — which in this case would be placed underneath the cookies where the
  beagle will walk, while the rest is covered in grass. On the Night City we can make a road, with
  white dash stripes."
- **Notes:** the other half of [[IDEA-043]], and a materially harder one: half of what a floor
  should show follows the CORRIDORS, not the tile. Affordable only because the floor is a single
  `PlaneGeometry(COLS+2, ROWS+2)` with plain 0..1 UVs, so tile `(tx,ty)` lands at a known canvas
  pixel and painting the maze into the texture is ordinary 2D drawing.
- **Dependencies:** [[IDEA-043]], [[IDEA-026]]
- **History:**
  - **v1** (2026-08-27) — `ThemePalette` gained a `floorTexture` kind and `src/render/floorTexture.ts` paints it from the live `Grid`: **stone** (garden — a trail of rounded stepping stones through a tended lawn, each well under half a tile across so grass shows in the gaps, seated with a shallow contact shadow and specked with darker mineral; the first pass laid continuous flagstones and read as a patio, so Nuno asked for rounded rocks, more space and grass), **earth** (deep forest — clods lighter AND darker than the ground, plus dry-ochre leaf litter), **sand** (beach — wind ripples drawn as a shadow line with a lit crest above it, over fine grain), **parkGrass** (city park — a green lawn with a gravel walk NARROWER than the corridor, 0.46 of a tile, so grass shows along both verges and the biscuits sit on the path), **road** (night city — asphalt lanes with a dashed centre line, junctions deliberately left clear), **flat** (arcade night unchanged). Two findings drove the whole design and are written into the module header. First, the textures had to carry COLOUR, unlike the wall ones: a `map` multiplies the material colour, so the brightest thing a luminance map can produce is the material's own colour — Night City's floor is `0x3a3640`, so a "white" lane marking painted as `grey(1)` still rendered at 0.22 luminance and was invisible. The floor texture therefore bakes `palette.floor` in as its own ground and `board.ts` holds the material at white so the tint is not applied twice; that also buys real hue changes, which is how the park's lawn is green over a tan palette. Second, every floor palette carries a flat emissive lift added AFTER the multiply, which swamped the pattern on the dark themes — so the same texture also drives `emissiveMap`, and the dark parts of the pattern dim the lift with it. Grid-derived means deliberately UNCACHED (a cache keyed by kind alone would paint level 1's corridors into level 2's floor) with the outgoing texture disposed on every theme change. Editable from the board editor's Floor folder (new "ground" dropdown, routed through `onDecorChange` because it needs the live grid); the floor-colour picker was rebound to the palette and rebuilds on finish, since the material is now held at white. New committed suite `scripts/test-board-surfaces.ts` (`npm run test:board-surfaces`, 56 checks, in the main `npm run test` chain) — its core check is that `boardCodegen` emits EVERY declared `ThemePalette` field, which is the silent failure mode both this idea and [[IDEA-043]] had to dodge by hand; it was mutation-tested to confirm it actually fails when a field is dropped. Texture resolution is `S = 32` px/tile (672x736, ~1.9 MB, one live at a time) with every pattern written in terms of `K = S/16` — feature sizes scale with K, scatter counts with K squared — so raising it for the garden's ellipses left the other five surfaces pixel-identical. `floorTexture.ts` (new), `themes.ts`, `board.ts`, `boardInspector.ts`, `boardCodegen.ts`, `package.json`.

### IDEA-043 — Themed wall surfaces (hedge / sand / brick) ✅
- **Priority:** 🟡
- **Area:** render
- **Registered:** 2026-08-27
- **Description:** (Nuno) "We have themes and each theme has a concept but the wall looks a solid
  piece of plastic on all of them. My idea is we can give some texture on the theme wall — per
  example on the garden, Deep Forest and City Park the wall could look more like a maze of shrubs.
  On the Sunny Beach the wall could look more like blocks of sand. On the Night City the wall could
  look like actually brick walls."
- **Notes:** a theme's concept was only ever carried by its COLOURS, so six themes were the same
  moulded box in six tints. Solved with procedural canvas textures rather than image assets —
  the project ships no texture files and is a PWA, so every KB is precached onto a phone.
- **Dependencies:** [[IDEA-026]]
- **History:**
  - **v1** (2026-08-27) — `ThemePalette` gained a `wallTexture` kind and `src/render/wallTexture.ts` draws each one to a 128px canvas at runtime: **hedge** (garden, deep forest, city park — three passes of leaf clumps with a sparse near-black gap pass, which is what makes it read as foliage you can see INTO rather than mottled paint), **sand** (beach — soft horizontal bedding plus fine grain), **brick** (night city — running bond with recessed mortar), **flat** (arcade night keeps its clean neon). Three rules the module holds to, each written down with its failure mode: generated-not-shipped; luminance-only averaging near white, because the map MULTIPLIES `palette.wall` and a mid-grey texture would darken every theme's tuned colour; and seamless, because walls are one InstancedMesh of unit boxes so every tile shows the full 0..1 and a non-tiling pattern would turn the maze into a visible grid of stamps. Editable live from the board editor's Walls folder (new "surface" dropdown) and — the part that would have silently broken — EMITTED by `boardCodegen`, which writes palette fields explicitly, so without it saving a theme would have quietly dropped the field. Also fixed a genuinely stale check while in there: `test-editor-board`'s round-trip pinned Arcade Night's price at 5 and had been failing on every run since [[IDEA-012]] v2 raised themes to 50; it now derives the price from the real theme, and that suite is fully green for the first time in a while. `wallTexture.ts` (new), `themes.ts`, `board.ts`, `boardInspector.ts`, `boardCodegen.ts`, `scripts/test-editor-board.ts`.

### IDEA-042 — Editor tab for the maze pickups (bones, fruit, coin) ✅
- **Priority:** 🟡
- **Area:** tooling
- **Registered:** 2026-08-27
- **Description:** (Nuno) "I was thinking to now improve the bones of the game. And for that
  create on the editor a tab to manage this kind of components, like bones, fruits." The maze
  pickups had no editing surface at all — the beagle, the enemies, the board and the props each
  had one, but the bone (the thing that turns the ghosts edible, i.e. the most important object
  in the game after the dog) could only be changed by hand-editing board.ts.
- **Notes:** scoped with Nuno to a MESH WORKBENCH over all four pickups (not spawn/balance
  tuning, which is a different kind of panel — sliders over config.ts, still unbuilt). The design
  finding that made it cheap: Character mode's machinery is not character-specific. Part tree,
  inspector, codegen, source view and save-in-place all work off a builder def, so Pickups is the
  same code path with a different registry and `sourceFile`. Sibling of [[IDEA-025]] v3 and
  [[IDEA-041]] — it inherits both (Save writes real source; inert controls are hidden rather than
  shown wired to nothing).
- **Dependencies:** [[IDEA-025]]
- **History:**
  - **v1** (2026-08-27) — a fourth `/editor/` tab, **Pickups**, editing the power bone, bonus-life bone, fruit and coin exactly as Character mode edits a dog: pick one, click a part, nudge/scale/rotate/recolour it live, and 💾 Save rewrites the real declaration in `src/render/board.ts`. Built by GENERALISING rather than duplicating — `CharacterDef` gained `sourceFile`, and `sourceView`/`fileExport` now read the raw text through a new `sources.ts` lookup instead of a hard-coded `characters.ts?raw`, so both tabs share one implementation and the tab inherits every future Character-mode improvement. Supporting changes: `makeBone` exported (the parser needs `export function <name>(`), all four builders' parts `.name`d (`shaft`, `knuckleLF`…, `apple`/`leaf`, `body`/`rim`/`emboss*`) so the tree is readable and Save can address them, `board.ts` added to BOTH save allow-lists, and the Save button now names the file it will actually write. Pickups correctly show no skin, no team colour and no animation dropdown (nothing in the game moves a pickup's sub-parts — an "off"-only dropdown would be exactly the dead control [[IDEA-041]] is about). Two bugs found and fixed by the new suite before shipping: the mode fell through to the props branch so the PROP LIBRARY rendered into the part tree, and the arrow-key nudge was gated on `mode === "character"` so Save reported "No edits yet". New committed suite `scripts/test-editor-pickups.ts` (`npm run test:editor:pickups`, 30 checks incl. a real write-and-restore of board.ts); build + all suites green. `registry.ts`, `sources.ts` (new), `sourceView.ts`, `fileExport.ts`, `inspector.ts`, `main.ts`, `saveFile.ts`, `board.ts`, `editor/index.html`, `vite.config.ts`, `package.json`.

### IDEA-025 — In-project 3D character editor (dev-only /editor/ page) ✅
- **Priority:** 🟡
- **Area:** tooling
- **Registered:** 2026-07-10
- **Description:** like in other projects, personalizing the characters is hard — but here it should
  be easier because the characters are pure code. An editor page inside the project: select a
  character, see its 3D model, edit all the components and add new ones, with the changes applied
  live on the character — and see the code too. The goal is for someone who doesn't know three.js
  to explore what it can do, watch the changes happen on the character AND on the code, and learn
  what each function does — more control over character editing. The editors found online are too
  confusing to learn from. Started on this project, but could later grow into a three.js editor
  usable in any project — for now, one editor in this project to reach the goal easily.
- **Notes:** dev-only — served by `npm run dev` at `/editor/`, never in the production build/PWA
  (`editor/index.html` is not a rollup input). New `src/editor/*` layer allowed to import three
  (CLAUDE.md layer rule amended). Part-inspector approach: tweak the real meshes (transform/material)
  via lil-gui (the same controls library as three.js's own examples, so the learning transfers),
  add primitive parts, and copy the generated three.js code into `characters.ts` — side by side with
  the real source of the builder (Vite `?raw`). After Nuno's first hands-on ("exactly what I want"),
  a comfort round was added: Ctrl+Z/Ctrl+Y undo-redo (arrow-nudge runs coalesce into one undo),
  arrow-key nudging of the selected part (Shift = coarse, Alt = fine, Ctrl = depth axis; hold S =
  uniform scale nudge; hold R = rotate — ←/→ yaw, ↑/↓ pitch, Ctrl roll), Esc deselect, and **"Copy full file"** — the whole `characters.ts` with the
  session's edits already injected before the builder's `return g;`, so applying the work is
  paste-the-file, no hunting for the right line. Export stays copy-paste (no auto-write to source).
  Round 3 (also Nuno's feedback): free camera **orbit** (drag to rotate around the character,
  scroll to zoom — OrbitControls; auto-turntable now defaults off) and a **"selection highlight"
  toggle** to hide the pink wireframe when judging the result. Follows Nuno's "later I will
  come back to character editing" note on [[IDEA-024]]; pairs with the shop 3D gallery
  ([[IDEA-023]]). Future: enemy idle animations, auto-write-to-source, ghost frightened/eaten
  preview, the generic any-project editor.
  **Queued v2 scope (triaged 2026-07-12):** allow deleting ANY selected component/part — today the
  🗑 delete button exists only for editor-added parts (original model parts are protected, see
  `inspector.ts`); Nuno wants to delete a component or a selected part of the original model too
  (e.g. to try a character without a marking). Shipped as **v2** (2026-07-12) — see History.
- **Dependencies:** —
- **History:**
  - **v2** (2026-07-12) — delete ANY selected part (Nuno's ask; third item of v4.0 "New Territory"): the 🗑 action now works on every node except the character root — original meshes AND groups (a group shows "delete part + N inside"), not just editor-added parts. Undo restores the part at its EXACT original sibling index (hand-rolled `insertChildAt` — THREE's `add()` only appends); original parts are never disposed while restorable. Deleted originals export as `<varName>.removeFromParent();` in both Copy edits and Copy full file; undone deletes emit nothing. Delete key wired with the same capture-phase/text-field guards. Plus a NEW COMMITTED Playwright suite `scripts/test-editor.ts` (`npm run test:editor`, 40 checks) — the v1 session's "65 checks" were never committed, so the editor finally has a permanent regression net. `editLog.ts`, `codegen.ts`, `inspector.ts`, `main.ts`, `scripts/test-editor.ts` (new), `package.json`. _(552d3d3)_
  - **v1** (2026-07-11) — the learning workbench: `/editor/` dev-only page (`npm run editor`) with a 3-pane layout — part tree (real source names via a 59-name `.name` pass in `characters.ts`, the only game-code change, non-visual) | live 3D viewport (menuScene's daylight rig, orbit camera, idle animation with auto-pause on select, click-to-pick raycast, wireframe/BoxHelper highlight with a show/hide toggle) | lil-gui inspector (transform/material/visibility per part, character + skin + team-color pickers, add/delete primitive parts). Bottom panel: Generated code (tree-ordered, real variable names, edits wiggled back to baseline drop out) ⇄ Real source (`?raw`, brace-count extraction, selecting a part marks the line that creates it), with **Copy edits** + **Copy full file** (edit block injected before the builder's `return g;` — round-trip verified: exported file builds, tests pass, edits appear in the real game). Full undo/redo (gesture-level; nudge runs coalesce into one Ctrl+Z) + keyboard nudging (arrows = move, S = scale, R = rotate; Shift/Alt/Ctrl step modifiers). Dev-only by construction: not a rollup input → dist/ has zero editor code (verified, incl. lil-gui + OrbitControls). 65 automated Playwright checks across 4 suites; build/tests green. Gotchas for next time: lil-gui step grids anchor at the range MIN (never step an irrational min like -π); lil-gui swallows keydown on focused widgets (global shortcuts need a capture-phase listener). `editor/index.html`, `src/editor/*` (12 modules), `characters.ts` (names only), `CLAUDE.md`, `docs/ARCHITECTURE.md`, `vite.config.ts` (comment only), `package.json`. _(7970749)_

### IDEA-024 — Beagle model glow-up (cuter: ears, eyes, coat pigmentation) ✅
- **Priority:** 🟡
- **Area:** render
- **Description:** improve the beagle visual — turn their appearance cuter than it is. Improve the
  ears and the eyes. The body should have richer pigmentation instead of one big oval circle on the
  body — we can improve that.
- **Notes:** model polish on the beagle built in [[IDEA-004]]. Nuno's quality bar: portfolio-grade
  three.js characters (bruno-simon.com / summer-afternoon refs). A first "blob-assembly" pass was
  REJECTED (markings as proud lumps, double-blob ears, bulging eyes, tail into the body) — the
  shipped model was rebuilt with **decal-shell surface painting**: every marking is a paper-thin
  partial-sphere cap hugging the base geometry (≤~1% rise), so the coat reads painted-on. All
  markings still ride the 4 coat slots, so the skins ([[IDEA-010]]) recolor cleanly — verified live
  through the shop. First build of v2.1 "Groomed" (before [[IDEA-023]] so the gallery shows this
  model). Nuno: "a really good improvement — just a few touches to be perfect; later I will come
  back to character editing" → that round became **v2** (2026-08-27). It began as a full anatomy
  rebuild against a breed standard; Nuno reviewed it and chose to keep the SHIPPED model instead,
  taking only the new cel-shaded materials plus two silhouette touches. Worth remembering: the
  materials did more for the character than the geometry rewrite did.
- **Dependencies:** —
- **History:**
  - **v1** (2026-07-10) — full model rebuild via a 3-variant judge panel (round 1) then a 2-technique fidelity rebuild (round 2, after Nuno's critique): chibi puppy proportions with a clearly visible body; ONE teardrop lathe ear per side rooted in the skull; flush painted-lens eyes (sclera/pupil/glint caps, no bulge); flush white blaze lune up the face; one smooth black saddle cap over the back; white bib/belly + socks; upright tapered flag tail with blended white tip (wag preserved). Decal-shell technique throughout — zero proud lumps. Verified: 4 skins × angles contact sheets, top-down direction strips (blaze front/saddle rear), menu showcase, live shop equip recolor, tsc/build/tests green; all `BeagleParts`/`coatMats` contracts intact, only `makeBeagle` changed. `characters.ts`. _(2341a47)_
  - **v2** (2026-08-27) — the game went CEL-SHADED, and the beagle came along rather than being replaced. Every lit surface — beagle, all four enemies, the board, props and both showcase scenes — is now a `MeshToonMaterial` on one shared 3-step ramp (`src/render/toon.ts`), with `NoToneMapping` on the renderer because ACESFilmic's shoulder re-compresses the top bands and undoes the banding entirely. The eye glint is deliberately unlit `MeshBasicMaterial`: a toon ramp quantises a highlight into the same band as everything else facing the light, so a shaded glint stops being a catchlight. Default coat retuned for the flatter shading (`config.ts` + bagel), and the saddle made actually BLACK (`0x4a2a1e` -> `0x1b1815`): the old value was a dark brown that passed for black on a 5 cm nose but plainly did not over the whole back, and on a tricolour beagle the saddle and the nose are the same colour. Not `0x000000` — the toon ramp's lowest band multiplies by ~0.27, so pure black leaves a shadow side with no information in it. `COLORS.beagleBlack` and the bagel coat move together or `test-cosmetics` fails, which is the point of that check: equipping the default skin must stay a visual no-op. The MODEL is the shipped v1 decal-shell beagle, kept as-is with two touches: ears broadened and flared (0.55 -> 0.72 wide, 0.2 -> 0.34 rad out) so they break the head's silhouette instead of vanishing into its edge under flat shading, and a thicker tail so it reads as a tail rather than an antenna. A full anatomy rebuild against a breed standard was built and REJECTED along the way — Nuno preferred the existing character with the new materials; the exploration is in this session's history, not in the tree. **Editor:** a new per-part `shading` dropdown (toon/standard/phong/lambert/basic) auditions any lighting model live, swapping by material identity so a shared coat changes everywhere at once; marked preview-only because the model is a scene-wide choice with nowhere in the builder to save it. Three real bugs fixed behind it — rebuilding the folder from inside its own onChange left lil-gui with a detached element, the uuid-keyed material registry was orphaned by a swap, and `reshade` now re-points `userData.coatMats` or skin changes would silently stop working. Plus a dev-only `/preview/` page (orbit controls, six preset angles, part isolation). `toon.ts` (new), `characters.ts`, `board.ts`, `menuScene.ts`, `shopScene.ts`, `scene.ts`, `config.ts`, `cosmetics.ts`, `src/editor/*`, `preview/` (new).


### IDEA-021 — Main menu (modes · shop · profile · scoreboard) ✅
- **Priority:** 🟡
- **Area:** menu
- **Description:** a good game menu that lets the player navigate between game modes, the shop, their
  profile, and the scoreboard. The hub that ties the whole app together.
- **Notes:** the navigation surface for [[IDEA-012]], [[IDEA-013]]/[[IDEA-014]], [[IDEA-019]], and
  [[IDEA-020]]. Fifth/final build of v2.0 "The Garden". First cut deliberately scopes to what EXISTS —
  Play + Shop ([[IDEA-012]]) + coin balance — with NO dead placeholders; modes/profile/scoreboard
  slots arrive when their features ship ([[IDEA-013]], [[IDEA-019]], [[IDEA-020]]). Absorbed the old
  Start panel rather than duplicating it. Also added a 🏠 quit-to-menu HUD button and a "Menu" button
  on the game-over panel.
- **Dependencies:** —
- **History:**
  - **v1** (2026-07-09) — the hub: boot lands on a menu (title, 🪙 wallet line read fresh from `getCoins()`, ▶ Play primary + 🛒 Shop secondary buttons, controls hint). Menu opens the shop via a new `ShopHandle.open()` (attachShop now returns `{open, detach}` + an `onClose` callback that re-renders the menu so the wallet stays fresh after in-shop spending). 🏠 HUD button quits a run back to the menu (`quitToMenu()`: hideCenter → resetBeagleScale → fresh game state → resetActors → mode="start" → menu; banked coins persist, run score discarded; safe no-op on the menu). Game over now offers "Play again" + "Menu" (keeps the current level as the idle backdrop). Verified live: boot→menu, menu→shop→close, menu→play, play→🏠→menu→play-again, double-🏠 safe, coins persist, desktop + phone, zero errors. `game.ts`, `ui/shop.ts`, `index.html`, `style.css`. _(0363bf4)_
  - **v2** (2026-07-09) — full-screen dedicated menu (was a popup panel over the maze + HUD, which felt like walking into the middle of a game). Boot now lands on a proper welcome screen: a live three.js menu scene (`render/menuScene.ts`) — the player's **equipped beagle** idling (slow turntable + tail wag/ear sway/breathing) on a turf-rimmed garden patch with a hedge arc + hedge-top blooms behind, under the daytime sky — with the title, 🪙 balance, and ▶ Play / 🛒 Shop floating over it (`#mainMenu` overlay). HUD + chrome hidden on the menu (`body.menu-open`); frame loop renders the menu scene while `mode==="start"`. Equipping a beagle skin from the shop updates the showcased dog live. Portrait phones dolly the menu camera back (3.27→5.3 toward aspect 0.46) so the dog stays a centered hero. Took 3 composition rounds (eye-level camera, smaller patch, symmetric hedge arc; Shop-button contrast). Verified live desktop + phone, all flows, zero errors. `menuScene.ts` (new), `game.ts`, `index.html`, `style.css`. _(5c6ca0f)_
  - **v3** (2026-07-12) — fix (Nuno's report: home screen showed the DEFAULT beagle after buying + equipping another skin): `createMenuScene()` baked the showcase dog before `initProfileFromStorage()` loaded the equipped skin — the shop's live `setBeagleSkin` masked it until the next full page load. The profile now loads at the very top of the Game constructor, before anything builds a beagle. Verified with the exact repro (Cookie equipped in storage → fresh load → chocolate showcase). `game.ts`. _(fc9996d)_

### IDEA-012 — Shop system for skins & themes ✅
- **Priority:** 🟡
- **Area:** shop
- **Description:** a shop that lets the player buy beagle skins, enemy skins, and map skins/themes.
  The single storefront for all cosmetic unlocks.
- **Notes:** spends the coin currency earned in classic mode ([[IDEA-016]], [[IDEA-017]]). Sells the
  cosmetics from [[IDEA-009]], [[IDEA-010]]. Fourth build of v2.0 "The Garden" — closes the economy
  loop: earn coins playing → spend in the shop → equip. Introduced the **owned-skins** concept
  (Bagel + Ghost free/owned by default; the other 6 skins cost 5 🪙) with equip gated on ownership.
  Replaced the temporary 🐶/👾 cycle switchers (`ui/skin.ts` deleted) with the real storefront (🛒
  HUD button). Map THEMES stay future scope — they need a theme-swap system first (builds on
  [[IDEA-008]]/[[IDEA-011]]); the shop UI takes a themes section when that exists.
- **Dependencies:** [[IDEA-009]], [[IDEA-010]]
- **History:**
  - **v1** (2026-07-09) — the storefront: 🛒 HUD button opens a dedicated overlay (own `#shop` container, never fights the Start/GameOver panel) with live coin balance + Beagle/Enemy sections; per-skin cards (coat-color swatches for beagles, icons for enemies) with contextual actions — Equipped / Equip / Buy · 5 🪙 / "Need N more 🪙". Data layer: `price` on both skin registries; `ownedBeagleSkinIds`/`ownedEnemySkinIds` in the profile blob (defaults always owned, defensive load); `buyBeagleSkin`/`buyEnemySkin` (atomic coin-deduct + unlock in one write; refuses already-owned/insufficient/unknown); `equipBeagleSkin`/`equipEnemySkin` now gated on ownership (return boolean); boot fallback if equipped-but-unowned. HUD coin counter syncs live on purchase (`onCoinsChanged`). Responsive desktop + phone (cards stack, ≥44px targets). Verified live end-to-end with real clicks: buy 12→7 🪙, unlock, equip (beagle recolors live), reload persists all. `ui/shop.ts` (new), `ui/skin.ts` (deleted), `cosmetics.ts`, `profileStore.ts`, `game.ts`, `index.html`, `style.css`, `scripts/test-cosmetics.ts`. _(9126a00)_
  - **v2** (2026-08-14) — prices raised: beagle skins **5 → 25**, enemy skins **5 → 25**, maze
    themes **5–10 → 50**. Nuno after playing v5.0: "it's too easy to buy a skin" — at 5 coins a skin
    was roughly one good run, so cosmetics had no pull. The first price change since [[IDEA-020]]
    made the SERVER authoritative, which is the interesting part: prices now live in BOTH
    `cosmetics.ts`/`themes.ts` and the generated `server/src/catalog.generated.ts`, so `npm run sync`
    in `server/` is mandatory or the shop says 25 while the server charges 5. The drift test caught
    all 11 mismatches with the fix in its own message — exactly what it was written for. Existing
    owners unaffected (ownership is stored, not re-charged). Test scenarios were reworked to DERIVE
    their wallets from the real prices so the next rebalance doesn't break them again.
    `cosmetics.ts`, `themes.ts`, `server/src/catalog.generated.ts`, `scripts/test-cosmetics.ts`.
    _(cc4b5d1)_

### IDEA-016 — Classic mode: earn coins from points ✅
- **Priority:** 🟡
- **Area:** economy
- **Description:** in classic mode, add a points system where reaching a number of points converts
  into a coin for the shop system. Playing well earns shop currency.
- **Notes:** the primary coin source; the coin is the shop currency ([[IDEA-012]]). Distinct from the
  free coin pickup ([[IDEA-017]]). Third build of v2.0 "The Garden" — built together with [[IDEA-017]]
  (shared coin currency). The [[IDEA-012]] dep is spend-only; earning/banking works standalone now.
  Adds a `coins` field to the same `beagle-chomp:profile` blob the skins use, a HUD coin counter, and
  a points→coins conversion rule.
- **Dependencies:** [[IDEA-012]] (spend-only; not blocking)
- **History:**
  - **v1** (2026-07-09) — every `COINS.perPoints` (1000) points banks 1 coin, immediately + persisted (survives a death or reload). Pure `coinsDueFromScore(score, perPoints)` helper (`src/game/coins.ts`) crosses multiple thresholds in one big scoring event; `coinsAwardedFromScore` bookkeeping resets per-run but the wallet accumulates across games. `coins` field added to the profile blob (`profileStore.ts`, back-compatible: `getCoins`/`addCoins`, garbage/negative/NaN → 0). HUD coin counter (`hud.setCoins`, `#coins` stat) + a coin "ching" (`sound.coin`). 24 headless assertions. Verified live: score→coins math, persistence across reload, zero errors. `coins.ts`, `config.ts`, `game.ts`, `profileStore.ts`, `hud.ts`, `sound.ts`, `index.html`, `style.css`, `scripts/test-cosmetics.ts`. _(f561491)_
  - **v2** (2026-08-28) — **the mechanic this idea IS was removed.** (Nuno) "The only way to gain
    coins is collecting the coins that appear on the map — forget the logic to make a number of
    points give coins." By v7.0 the shop had stopped being a place where anything was a decision:
    a decent run banked coins from score AND from pickups, so an item was affordable in a run or
    two and nothing in it was ever weighed. Coins now come from the maze and only the maze, which
    is what makes the five pickups a level worth detouring for.
    **Deleted on BOTH sides, and that is the point.** The server is the authority — `plausibility.ts`
    recomputes the award, `scoreService` banks it, and the client reconciles its optimistic local
    balance to the returned profile — so removing the client's half alone would have changed
    nothing and the milestone would have kept running from the server. `COINS.perPoints` is gone
    from `config.ts` and `coinsPerPoints` from the generated catalog.
    `coinsDueFromScore` SURVIVES under its old name: bonus lives ([[IDEA-018]]) use identical maths
    on `LIVES.milestonePoints`, and that is now the only points-milestone in the game — which is
    fine, because a life is not a currency. You cannot bank it, spend it, or hold more than
    `LIVES.max`, so "score well, survive longer" stays a reward rather than an economy.
    If earning turns out too slow, the number to raise is `COINS.pickupValue` — not a reinstated
    milestone. Kept as a version of this idea rather than a discard: the idea is the coin ECONOMY,
    and it still exists, it just has one source now instead of two. See [[IDEA-017]] for the
    pickups that are that source.
    _(0d22364 — both halves in ONE commit, unlike the fruit and power-up ships. No new field
    crosses the wire here and the client only ever displays the balance the server returns, so
    there was nothing for an API-first split to protect.)_

### IDEA-017 — Classic mode: coin pickups in the maze ✅
- **Priority:** 🟢
- **Area:** economy
- **Description:** in classic mode, at random, a coin appears in the maze like the fruit does — but
  this one grants the player a coin directly, no points needed. A gift, essentially.
- **Notes:** same coin currency as [[IDEA-016]], but earned by pickup rather than by scoring. Spends
  in the shop ([[IDEA-012]]). Built together with [[IDEA-016]]; reuses the fruit spawn/collect
  mechanism to drop a collectible coin in the maze.
- **Dependencies:** [[IDEA-012]] (spend-only; not blocking)
- **History:**
  - **v1** (2026-07-09) — a gold coin (rim + emboss, glowing, spins) spawns in the maze like the fruit and grants 1 coin on pickup (no points). Unlike the fruit it **auto-despawns** after `COINS.lifespanSeconds` — a "grab it quick" bonus. Tuned to **4 coins per level** at pellet-eaten `[20, 60, 105, 150]` (first one early so it's actually encountered), placed on a **random reachable tile** (drawn from the remaining-pellet set, not just fruit spots), with an **18s** lifespan so a coin across the map is reachable before it vanishes. `makeCoin`/`spawnCoin`/`clearCoin`/`board.coin` + coin spin in `spinDecor` (`board.ts`); `despawnCoin()` single-teardown helper + `tickCoinLifespan` (play-only) + `pickRandomCoinTile` (`game.ts`). Verified live (instrumented): coin spawns on threshold at a random tile with the countdown running, banks on pickup, no errors. `board.ts`, `game.ts`, `config.ts`. _(f561491)_
  - **v2** (2026-07-09) — placement rework: coins now spawn on **EMPTY walkable tiles** (already-cleared corridors) instead of tiles that still hold a biscuit — so the coin stands out against bare floor AND creates a real decision (detour back to a cleared area, or press on). New `walkableTiles` precomputed per level (`grid.walkable(x,y,false)` scan in `buildLevel`); `pickRandomCoinTile` prefers the empty set (walkable minus pellets minus beagle/fruit tiles) and falls back to any walkable tile so a spawn never skips. Verified (instrumented): 200/200 picks on empty tiles, 0 on biscuits. `game.ts`. _(9126a00)_
  - **v3** (2026-07-11) — fix: the coin spawn threshold could REFIRE after the coin was grabbed without eating another pellet (same-`eaten` re-pass), allowing coin farming. Once-per-level threshold pointers (`shouldFireThreshold`, shipped with [[IDEA-018]]). `game.ts`, `pickups.ts`. _(3db894d)_

### IDEA-009 — Enemy skin system (break away from the classic ghost) ✅
- **Priority:** 🟡
- **Area:** skins
- **Description:** be able to change the appearance of the enemies. The goal is to escape the
  traditional Pac-Man look — instead of the classic ghost, offer something different that fits the
  game's theme. The current ghost stays available as one skin, but it shouldn't have to be the main
  one; design another cool appearance and make enemy skins swappable.
- **Notes:** merged from two captures describing the same feature. Ghost = one option among several.
  Skins are sold through the shop ([[IDEA-012]]). Second build of v2.0 "The Garden" — reuses the
  cosmetics/profile foundation from [[IDEA-010]]. Shipped a set of **4 enemy skins**: Ghost (classic,
  default), Garden Beetle, Bee (flat surface-hugging stripe bands), Ladybug (7 black spots on the
  shell). Every skin keeps the ghost's contract — 3 team colors (chaser/ambusher/clyde), a frightened
  recolor, an eaten eyes-only state, direction-tracking eyes — so the bone mechanic is unchanged.
  Along the way: fixed a latent **eaten-state bug in `applyGhostState`** (it hid the top-level group,
  which short-circuited the eyes — affected the ghost too) and gave the **beagle the same cute eyes**
  (white eyeball + calm dark-brown pupil; beagle-specific, enemies keep blue). Temporary 👾 HUD button
  cycles enemy skins (placeholder, absorbed by the shop [[IDEA-012]] later).
- **Dependencies:** —
- **History:**
  - **v1** (2026-07-09) — 4 enemy skins via a `makeEnemy(skinId, color)` factory: Ghost + new Beetle/Bee/Ladybug creatures, all satisfying the `GhostUserData` state contract (frightened/eaten/eye-tracking). Enemy-skin registry + persistence added to the shared cosmetics/profile foundation (same `beagle-chomp:profile` blob, back-compatible). Fixed `applyGhostState` eaten bug (`mesh.traverse`→`mesh.children.forEach`). Beagle got the cute eyes too. Temporary `#enemyBtn` switcher (`ui/skin.ts`). Verified live: 4-way cycle+persist, all states per skin, zero errors; build + tests green (test roster → 4 skins). `characters.ts`, `game.ts`, `cosmetics.ts`, `profileStore.ts`, `ui/skin.ts`, `index.html`, `style.css`, `scripts/test-cosmetics.ts`. _(688cf6e)_

### IDEA-010 — Beagle skins named after coat patterns ✅
- **Priority:** 🟡
- **Area:** skins
- **Description:** skins for the beagle. Beagles come in many coat-color patterns, so have one skin
  per pattern, and give each skin a pet name — e.g. the standard one could be "Bagel", another
  "Cookie", another "Muffin". Each skin has its own name.
- **Notes:** playful naming is part of the appeal. Sold through the shop ([[IDEA-012]]). First build
  of v2.0 "The Garden" — includes the shared cosmetics/profile foundation (skin registry + equipped
  state + localStorage persistence) that later skins ([[IDEA-009]]) and the shop ([[IDEA-012]]) reuse.
  Until the shop lands, a temporary 🐶 HUD button cycles the skins (placeholder, absorbed by [[IDEA-012]]).
- **Dependencies:** —
- **History:**
  - **v1** (2026-07-09) — 4 beagle coat skins: **Bagel** (classic tricolor, default & unchanged), **Cookie** (chocolate/liver), **Muffin** (lemon & white), **Pepper** (blue-tick grey). New pure `cosmetics.ts` (skin registry + equipped state, three-free) + `profileStore.ts` (localStorage persistence, guarded, following the mute-preference precedent); `makeBeagle(skin)` + `applyBeagleSkin()` restyle the mesh in place; temporary `#skinBtn` switcher (`ui/skin.ts`, three-free via callback). Cycle+wrap+persist verified; 29 headless assertions incl. a Bagel==old-colors regression guard. `cosmetics.ts`, `profileStore.ts`, `ui/skin.ts`, `characters.ts`, `game.ts`, `index.html`, `style.css`, `scripts/test-cosmetics.ts`. _(a5a0b9f)_
  - **v2** (2026-08-28) — **Pac-Beagle**, a tribute coat, and the first skin to need the model to
    change rather than just recolour. Two new OPTIONAL channels on `BeagleCoat`, both no-ops for
    every coat written before them: `paw` falls back to `white` (which is exactly what paws were
    painted with), and `brow` is meaningful by its ABSENCE — the beagle has no brows unless a skin
    asks for them, and it is the brows that make this one read as the tribute rather than a
    recolour. The meshes are always built and hidden, never conditionally created, because a live
    skin switch recolours an existing model in place — anything a skin can turn on has to already
    be there to turn on.
    Owning it unlocks the **Ghost enemy skin**, which becomes secret and free; the shop asks
    `visibleEnemySkins()` fresh on every call rather than caching, so the unlock lands while the
    shop is open. That swap also made the **beetle the free default enemy** (`ghost` -> `beetle`,
    beetle 25 -> 0 coins).
    Built in a parallel session; recorded here after the fact rather than left uncounted, since
    the ledger's invariant is that nothing shipped goes unrecorded. Cross-links [[IDEA-009]] (the
    enemy-skin system it makes secret) and [[IDEA-012]] (the shop that sells it).
    One process note worth keeping: the API half of this shipped EARLY and by accident —
    `npm run sync` regenerates the server catalog from the WORKING TREE, so running it during
    [[IDEA-045]] baked this skin's price, the new default enemy and the beetle's price change into
    a deploy that was nominally about fruit. No harm (the API knowing a price before the shop
    offers it is what API-first is for), but **check `git diff server/src/catalog.generated.ts`
    before committing a sync.** _(2216ac8)_

### IDEA-022 — Pull the camera in closer on phones ✅
- **Area:** ux
- **Description:** on mobile phones the map felt too far away — the beagle and enemies came out
  small and hard to make out. Bring the view closer to the screen on phones so the player can see
  the characters better. A tighter, more zoomed-in framing tuned for small screens.
- **Notes:** distinct from [[IDEA-006]] v2, which fixed the canvas *sizing* bug (only the top-left
  corner showed). This was about camera *distance* on phones. The board is roughly square, so on a
  tall/narrow portrait viewport the binding constraint is maze **width** — relaxing only the vertical
  fit was a no-op. Fix: on portrait (aspect < 1) relax BOTH NDC fit targets so the maze fills nearly
  the full frame width, plus a bidirectional tightening pass to remove leftover dolly slack.
  Landscape/desktop (aspect >= 1) is byte-for-byte unchanged. All in `scene.ts`. Verified live at
  390×844 (whole board still on screen, no tile clipped) and desktop (framing identical to before).
- **Dependencies:** —
- **History:**
  - **v1** (2026-07-09) — portrait width-fit: `ndcTargetX` ramps 0.97→1.05 and `ndcTargetY` 0.97→1.30 as aspect narrows toward 0.46, plus `tightenFitDistance` bidirectional refine (portrait only). Camera ~18% closer on a typical phone; full board still framed. `scene.ts`. _(e3d5017)_

### IDEA-011 — Detail & texture pass on the maps ✅
- **Area:** theme
- **Description:** upgrade the appearance of the maps with more detail and texture — without
  overdoing it. Things like leaves and flowers on the maze walls for the garden theme; a
  future/neon-line look on the walls if a skin is future-themed. Keep it tasteful, theme-driven.
- **Notes:** shipped sparse flower blooms (white/yellow/pink/red) + occasional leaf specks on the
  hedge tops — ~1 in 5 wall tiles, placed by a stable positional hash so the layout is consistent
  across level rebuilds. Batched into one InstancedMesh per color (walls stay a single InstancedMesh).
  Builds on the garden default ([[IDEA-008]]); the per-theme detailing hook is where future shop
  themes ([[IDEA-012]]) will carry their own look (e.g. neon lines for a future theme). Verified live.
- **Dependencies:** [[IDEA-008]]
- **History:**
  - **v1** (2026-07-08) — sparse hedge-top flowers + leaf specks (positional-hash placement, per-color InstancedMesh); level-teardown cleanup in game.ts. `board.ts`, `game.ts`. _(db12a3b)_

### IDEA-008 — Garden theme as the default maze look ✅
- **Area:** theme
- **Description:** change the maze colors to something more original and tied to the beagle theme —
  make it feel like a garden. Brown floor, green walls. This should be the default look of the game,
  not the previous palette.
- **Notes:** shipped as a **bright daytime garden** — hedge-green walls, warm soil-brown floor, soft
  blue sky. All driven by the central `COLORS` palette in `config.ts` (plus material/lighting
  follow-through in `board.ts`/`scene.ts`), so a future theme system can swap it cleanly. Detail/
  texture pass is still [[IDEA-011]]; this is the first of the swappable map themes for the shop
  ([[IDEA-012]]). Verified live in-browser (desktop + phone) before shipping.
- **Dependencies:** —
- **History:**
  - **v1** (2026-07-08) — daytime garden palette: sky-blue bg, hedge-green walls, soil-brown floor; lighting retuned to daylight. `config.ts`, `board.ts`, `scene.ts`. _(8226b88)_

### IDEA-001 — Headless logic foundation (maze validation + gameplay sim) ✅
- **Area:** testing
- **Description:** a browser-free safety net for the trickiest logic. Validate every maze
  (connected, all pellets reachable, ghosts can leave the pen) and simulate a full game run in
  Node so movement, ghost AI, and scoring can be trusted without opening a browser.
- **Notes:** the tests import the real modules, not copies, so they can't drift. `npm run test`
  runs both. This is the rule the whole project leans on: after any change to grid/movement/ghostAI
  or maze data, this must pass. Sim currently reports all mazes valid and logic OK.
- **Dependencies:** —
- **History:**
  - **v1** (2026-07-06) — `scripts/validate-maze.ts` + `scripts/sim-logic.ts`, wired to `npm run test`. _(eafc965)_

### IDEA-002 — Pure game logic core (grid, movement, ghost AI, mazes) ✅
- **Area:** gameplay
- **Description:** the deterministic heart of the game, kept completely free of three.js so it
  stays unit-testable in Node. Tile grid with tunnel wrap and walkability, tile-stepping movement,
  ghost targeting AI with a dead-end-safe fallback, and two validated mazes.
- **Notes:** hard rule — no `three` import anywhere in `src/game/*`. Balance numbers live in
  `src/game/config.ts`, not scattered as magic numbers. Two mazes ship, both validated by IDEA-001.
- **Dependencies:** [[IDEA-001]]
- **History:**
  - **v1** (2026-07-07) — `grid.ts`, `movement.ts`, `ghostAI.ts`, `config.ts`, `mazes.json/.ts`. _(a426ced)_
  - **v2** (2026-07-12) — fix (Nuno's playtest report: enemies "flick and teleport"): reversing a ghost mid-tile flipped `dir` without adjusting `tx/ty/progress`, so `entityWorld`'s interpolation jumped up to a full tile backwards — on EVERY bone eaten and every scatter/chase flip. New pure `reverseEntity(e, grid)` in `movement.ts` swaps the segment (A→B at p becomes B→A at 1−p, tunnel-wrap aware) for perfect continuity; both `reverseGhost` call sites updated. 27 regression assertions incl. an old-bug guard (naive flip = 0.8-tile jump at p=0.4) + live zero-delta verification (mid-tile ghost at p=0.69 → delta 0). `movement.ts`, `game.ts`, `scripts/test-cosmetics.ts`. _(d0a6dca)_

### IDEA-003 — Game loop & state machine ✅
- **Area:** gameplay
- **Description:** the thing that turns the pure logic into a playable game — fixed-ish update →
  sync meshes → render, driven by a state machine (`ready → play → dying | levelclear → …`).
  Scoring, collisions, bone/scared-ghost handling, level flow.
- **Notes:** renderers read entity world positions each frame and never mutate logic — the
  logic/render decoupling from CLAUDE.md holds here.
- **Dependencies:** [[IDEA-002]]
- **History:**
  - **v1** (2026-07-07) — `src/game/game.ts` + `src/game/state.ts`, `main.ts` wiring. _(a426ced)_
  - **v2** (2026-07-11) — fix: latent since v1.0, the fruit spawn threshold could REFIRE after the fruit was eaten (pellet count unchanged), allowing +100 farming by oscillating on the tile. Same once-per-level pointer fix as [[IDEA-018]]/[[IDEA-017]]. `game.ts`. _(3db894d)_

### IDEA-004 — three.js render layer (scene, board, characters, effects) ✅
- **Area:** render
- **Description:** the whole visual game built in three.js — scene/camera/lights, the maze board,
  character meshes (beagle + ghosts) from primitives, materials and shadows, and effects like the
  score popups and scared/eaten states.
- **Notes:** ~1600 lines across `scene.ts`, `board.ts`, `characters.ts`, `effects.ts`. Reads the
  logic layer, never writes it.
- **Dependencies:** [[IDEA-003]]
- **History:**
  - **v1** (2026-07-07) — full render layer under `src/render/*`. _(a426ced)_

### IDEA-005 — Controls, HUD & sound ✅
- **Area:** ux
- **Description:** everything the player touches — keyboard controls, touch/swipe controls for
  phones, the on-screen HUD (score/lives/level), and a sound layer with a mute toggle.
- **Notes:** `input/keyboard.ts`, `input/touch.ts`, `ui/hud.ts`, `ui/sound.ts`. Touch handling is
  what makes it phone-playable alongside the PWA install (IDEA-006).
- **Dependencies:** [[IDEA-003]]
- **History:**
  - **v1** (2026-07-07) — keyboard + swipe input, HUD, sound + mute button. _(a426ced)_
  - **v2** (2026-07-08) — fix: HUD text (SCORE/MAP/LIVES labels + values) was low-contrast on the new sky-blue garden background. Switched to crisp white with a soft white halo, scoped to `.hud` so the dark-backed panel/banner are untouched. `style.css`. _(d582774)_

### IDEA-006 — PWA: installable, offline, deployed ✅
- **Area:** pwa
- **Description:** make it a real installable app — PWA manifest + service worker via
  vite-plugin-pwa, an install-prompt UX, and automatic deploy to GitHub Pages so it's live and
  updatable.
- **Notes:** `ui/install.ts` + `install.css`, `vite-plugin-pwa` config, `.github/workflows/deploy.yml`.
  Responsive-canvas fit lives here too (see v2).
- **Dependencies:** [[IDEA-004]], [[IDEA-005]]
- **History:**
  - **v1** (2026-07-07) — PWA config, install UX, GitHub Pages deploy workflow. _(a426ced)_
  - **v2** (2026-07-08) — fix: canvas was sized to `viewport × devicePixelRatio` on phones (only the top-left corner was visible). `renderer.setSize(w, h)` now sets the canvas CSS size to the logical viewport while the buffer stays 2× for sharpness. Verified full-maze framing in portrait + landscape. `scene.ts`. _(8226b88)_
  - **v3** (2026-08-14) — the install banner, rebuilt. Nuno: "on mobile screens it looks like a
    rounded button and we can't read the text". The v1 pill was `border-radius:999px` on a flex ROW
    anchored to the BOTTOM — at ~360px the row wrapped, and a 999px radius on a now-tall box renders
    as a lozenge that crops its own text, sitting over the menu buttons (the exact place the player
    taps). Now a **top-pinned banner** with a fixed 14px radius that can't deform, a CSS grid on
    narrow screens (message + ✕ on row one, full-width action below) and ≥44px touch targets.
    A `body.install-open` class shifts the menu title down so the banner can't cover the game's own
    name. Settled against [[IDEA-036]]'s new menu layout, as triage flagged. Two bugs here were
    caught by LOOKING at screenshots rather than by assertions that all passed: the ✕ stranded on
    its own line, and the banner over the title. `install.css`, `install.ts`, `style.css`,
    `scripts/test-menu-ui.ts` (new, 45 checks across desktop + phone). _(cc4b5d1)_
  - **v4** (2026-08-28) — removed the GitHub Pages deploy this idea introduced in v1. It was right
    for v1.0, when the game was a static offline PWA; the host moved to **Cloudflare Pages at v5.0**
    when the game became full-stack, and the workflow was never deleted. Since then it had been
    publishing a build with no `VITE_API_URL` on every frontend push — a public copy of the game
    that boots straight into "cannot reach its server" (`api.ts` falls back to `""`, and `boot.ts`
    treats that as unrecoverable). Nuno unpublished the Pages site; the workflow and the dead README
    link are gone. STACK.md is deliberately untouched — "GitHub Pages acceptable for throwaways" is
    still the standing cross-project policy, it just is not this project any more. Also worth an
    ops check: `CORS_ORIGINS` in Dokploy should list the Cloudflare origin and nothing else, since
    an Origin is scheme+host+port and a `github.io` entry allows EVERY project on that account.
    _(31fef47)_

### IDEA-007 — Beagle app icon & favicon artwork ✅
- **Area:** brand
- **Description:** replace placeholder icons with real beagle artwork — the maskable/standard PWA
  icons and the browser favicon — so the installed app and the tab both look finished.
- **Notes:** `public/icons/*` (192, 512, 512-maskable) and `public/favicon-*.png`.
- **Dependencies:** [[IDEA-006]]
- **History:**
  - **v1** (2026-07-07) — beagle icon set + favicons. _(d8526be)_

## Paused / Discarded
> Kept on purpose. Paused so it isn't lost; discarded so the *reason* is preserved.
_(nothing yet)_
