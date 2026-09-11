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
     (which hardcodes mazeIdx 0-4) is untouched.
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
  **AND SAVING A THEME FROM THE EDITOR DELETES THAT THEME'S OWN COMMENTS.**
  `boardCodegen` regenerates the edited theme's entry, so prose inside
  `palette: {}` does not survive — other themes are spliced through verbatim,
  which is why only the edited one loses anything. Put notes ABOVE `palette:`.
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
  **WHAT THE CLAY RENDER SAYS, AND IT IS WORTH KNOWING**: with every map
  stripped (`/preview-board/?flat=1`), the fence and the wall-top flowers are
  still there as real silhouettes — and the HEDGE IS STILL A PLAIN BOX. All of
  its leafiness is paint. That is a deliberate constraint (walls are one
  InstancedMesh of unit boxes, for the draw call and for corridor legibility),
  not an oversight, and the fence is what puts real geometry at the wall base.
- **Input / UI / PWA**: `src/input/{touch,keyboard,dpad,stick}.ts`, `src/ui/{hud,sound,install}.ts`,
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
