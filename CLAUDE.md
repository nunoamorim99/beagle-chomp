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
The full game is built, shipped, and deployed (playable since v1.0; **now on v7.0 "Worth the Detour"**).

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
  — so **after changing `config.ts`, `mazes.json` or `challenges.ts`, run `npm run sync` in
  `server/`**, or honest runs will start being rejected. `npm run test:catalog` fails on drift.
- **The API measures itself** (IDEA-039): every request is timed by the outermost middleware and a
  p95-per-route table goes to the container log every 10 minutes, with `GET /metrics` for the JSON
  form (only exists when `METRICS_TOKEN` is set). Route labels are Hono's matched PATTERN, never
  the raw path — see `server/src/http/metrics.ts` and `server/README.md` § Observability. The
  `[slow-query]` line at 200 ms is deliberately STACK.md §6's own Redis trigger, so **Redis stays
  deferred until that line actually appears, or a second replica exists** — not on a hunch.
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
- **Pure logic** (`src/game/*`): `mazes.json`+`mazes.ts` (two **validated** mazes —
  connected, all pellets reachable, ghosts can leave the pen), `grid.ts` (tiles, tunnel
  wrap, walkability), `movement.ts` (tile-stepping model), `ghostAI.ts` (targeting with a
  dead-end-safe fallback), `state.ts` + `game.ts` (loop + state machine, the integration point).
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
     (108 KiB total) declared in `tokens.css`. **Never add a Google Fonts
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
- **Input / UI / PWA**: `src/input/{touch,keyboard}.ts`, `src/ui/{hud,sound,install}.ts`,
  `public/icons/*` (192, 512, 512-maskable).
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
  coin), **Board & Themes**, **Props**. Character and Pickups are the SAME
  machinery over a different registry and source file: part tree, inspector,
  generated code, real-source panel and save-in-place all read `sourceFile`
  off the def rather than assuming one file. Adding a mesh tab means adding a
  registry entry — not a parallel copy of the editor.
- **Tests**: `scripts/validate-maze.ts`, `scripts/sim-logic.ts` — import the real modules.
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
