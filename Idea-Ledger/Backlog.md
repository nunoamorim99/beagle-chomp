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
> New registered ideas go here. Next free ID: IDEA-029

### IDEA-019 — Player login & cross-device account recovery 💡
- **Priority:** 🟡
- **Area:** accounts
- **Description:** a login system that identifies the player and gives them a way to recover their
  account on other devices — at least until the game becomes a fully native app.
- **Notes:** prerequisite for a shared scoreboard ([[IDEA-020]]) and for persisting shop purchases
  across devices ([[IDEA-012]]). Backend/auth choice is TBD.
- **Dependencies:** —

### IDEA-020 — Shared scoreboard 💡
- **Priority:** 🟢
- **Area:** social
- **Description:** a scoreboard shared between players to create some healthy competitiveness.
- **Notes:** needs identity to attribute scores ([[IDEA-019]]) and a home in the menu ([[IDEA-021]]).
- **Dependencies:** [[IDEA-019]]



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
- **Dependencies:** —

## In progress 🔨
### IDEA-026 — Maze themes in the shop (garden · classic · forest · beach · park · city) 🔨
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

### IDEA-027 — Editor: edit the maze too (theme-aware board editing) 🔨
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

_(also building: [[IDEA-025]] v2 scope — delete any part — tracked on the delivered idea)_

## Delivered ✅
> Already in production. Do NOT delete. Each keeps its version history.

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
  (e.g. to try a character without a marking). Small, ships as the next vN on this idea.
- **Dependencies:** —
- **History:**
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
  back to character editing" → future refinement round expected, capture specifics via /idea then.
- **Dependencies:** —
- **History:**
  - **v1** (2026-07-10) — full model rebuild via a 3-variant judge panel (round 1) then a 2-technique fidelity rebuild (round 2, after Nuno's critique): chibi puppy proportions with a clearly visible body; ONE teardrop lathe ear per side rooted in the skull; flush painted-lens eyes (sclera/pupil/glint caps, no bulge); flush white blaze lune up the face; one smooth black saddle cap over the back; white bib/belly + socks; upright tapered flag tail with blended white tip (wag preserved). Decal-shell technique throughout — zero proud lumps. Verified: 4 skins × angles contact sheets, top-down direction strips (blaze front/saddle rear), menu showcase, live shop equip recolor, tsc/build/tests green; all `BeagleParts`/`coatMats` contracts intact, only `makeBeagle` changed. `characters.ts`. _(2341a47)_

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
