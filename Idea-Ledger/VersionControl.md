# VersionControl — beagle-chomp

Record of product versions: what shipped in each. Works in pair with Backlog.md.
- Backlog.md = what's left + per-idea history (IDEA level).
- VersionControl.md (this) = what shipped, grouped by product version (v1.0 / v2.0 / v2.1).

## How we version
Major.Minor:
- Major (1.0 → 2.0) — a group of new features (a planned release).
- Minor (2.0 → 2.1) — an increment/improvement to an existing feature.

Newest release sits at the **top** of "Version history" — the top entry is where the project is.

## 🚧 Unreleased
> Every `/ship` drops a line here so nothing shipped goes uncounted. When a release is cut, **all**
> lines here roll up into the numbered version below and this section is cleared (hold a line back
> only if you explicitly choose to).
_(nothing yet — all shipped work is captured in the versions below)_

## 📌 Planned
> Forward-looking targets from `/plan-version`. Each is a checklist of IDEAs intended for a
> future numbered release. Items move to Unreleased as they ship.

_(nothing planned yet — v4.0 "New Territory" was fulfilled and cut on 2026-07-12)_

## Version history

### v4.1 — Set Dressing (2026-07-13)
An increment on v4.0's themes: props became a proper set-dressing system you author and place by
hand. A reusable prop LIBRARY edited in the editor, explicit hand placement of every prop on the
board, and wall-top components (lamps, signals, blooms) placed per wall tile — all exporting back
into code. The six shipped themes look byte-for-position identical; every prop is now movable.
- **IDEA-029** — reusable prop library + a Props editor tab: 10 named parametric prop defs
  (shape + tunable params), a third editor mode with live preview and Copy-library-code.
- **IDEA-030** — explicit prop placement: density-scatter replaced by hand-placed
  `{ propId, tile, offset, rotation, scale }`; on-board slot markers to place/move/save.
- **IDEA-031** — wall-top components: per-wall-tile bloom/lamp/transit-sign placement,
  generalizing the old density blooms; Night City demoes hand-placed wall lamps.

### v4.0 — New Territory (2026-07-12)
The themes pillar: the world itself became personal. Six swappable maze themes sold through the
shop — each a full world with its own sky, lighting, materials and PROPS (a lit skyline behind
Night City, a pine ring around Deep Forest, umbrellas on Sunny Beach, shrubs in The Garden) —
plus the editor grew into the tool that authors them. Fulfilled the planned v4.0 in full.
- **IDEA-026** — maze themes in the shop: The Garden (free) · Arcade Night (the true v1.0
  black/blue) · Deep Forest · Sunny Beach · City Park · Night City; 🌳 shop tab with live 3D
  dioramas; instant re-theming (even mid-run, pellets preserved); theme props framing the board.
- **IDEA-027** — editor "Board & Themes" workbench: a real themed maze in the editor, every
  palette slot + prop population editable live, "Copy theme code" round-trips into themes.ts —
  new themes can be authored, not just tuned.
- **IDEA-025 v2** — editor: delete ANY selected part (original meshes/groups included) with
  exact-position undo and code export; the editor gained its first permanently committed
  Playwright suites (126 checks total).

### v3.2 — Trail Polish (2026-07-12)
Two playtest-driven touches: the challenge map earns a proper desktop layout, and the home
screen greets you with the dog you actually equipped.
- **IDEA-014 v2** — level-map desktop rework: full-width top bar, a right side panel with rich
  level details (blurb, twists, maze name, state), page-level scrolling; plus the hill-bleed
  clamp and circular node rings/pulse (no more black square around the current level).
- **IDEA-021 v3** — fix: the home-screen 3D showcase now boots with the player's equipped
  beagle — the profile loads before the menu scene builds its dog.

### v3.1 — Smooth Moves (2026-07-12)
A single targeted fix from playtesting: no more ghost teleports.
- **IDEA-002 v2** — ghosts "flicked/teleported" up to a full tile whenever they reversed mid-tile
  (every bone eaten, every scatter/chase flip). Reversals now swap the movement segment
  (A→B at p becomes B→A at 1−p, tunnel-wrap aware) for perfect positional continuity — verified
  to zero delta live and guarded by 27 regression assertions.

### v3.0 — New Tricks (2026-07-12)
The gameplay pillar: more game to play. Classic mode stopped repeating itself, lives became
earnable, and a whole new challenge mode arrived with its own garden-path level map. Fulfilled
the planned v3.0 in full — plus a farming-exploit fix the new work uncovered.
- **IDEA-015** — maze pool 2 → 5: The Courtyard (open plaza), The Warren (tight lattice) and The
  Crossroads (long arteries) join the rotation, all validator + sim green.
- **IDEA-018** — bonus lives (cap 5): a golden-bone maze pickup, a 5,000-point milestone, and a
  perfect-fright reward — with a 1-UP jingle.
- **IDEA-017 v3 + IDEA-003 v2** — fix: pickup spawn thresholds could refire after collection,
  letting players farm coins (and fruit points, latent since v1.0). Closed for every pickup.
- **IDEA-013** — challenge mode: 8 levels of twists (speed tiers, packs of 4-5 ghosts, short
  fright) from Warm-Up Walkies to Top Dog, with completion panels and persisted progress.
- **IDEA-014** — the garden path level map: paw-stamped cleared stones, a pulsing current level,
  locked stones ahead — pick, replay, and climb. Includes the post-playtest HUD/menu chrome fix.

### v2.1 — Groomed (2026-07-11)
The polish pass on v2.0: the beagle became a character worth showing off, and the shop became the
place to show it. Fulfilled the planned v2.1 in full, plus one unplanned dev tool.
- **IDEA-024** — beagle model glow-up: full rebuild with decal-shell surface painting — flush coat
  markings (no more proud lumps), painted-lens eyes, single teardrop ears, upright flag tail,
  chibi puppy proportions. All 4 coat skins recolor cleanly.
- **IDEA-023** — shop v2: a full-screen character-select page — 🐶/👾 tabs, a live 3D hero
  turntable of every skin, desktop chrome in a right side panel so the 3D stage stays clean;
  mid-run shopping now pauses the game.
- **IDEA-025** — in-project 3D character editor (dev tooling, not in the player build): /editor/
  workbench with part tree, orbit viewport, inspector, undo/redo, and code export — built to make
  future character work hands-on.

### v2.0 — The Garden (2026-07-09)
The cosmetics economy loop, complete and self-contained with no backend: skins to earn toward,
coins to earn them with, a shop to spend them in, and a real menu that welcomes you to it all.
Fulfilled the planned v2.0 in full.
- **IDEA-010** — beagle skins: 4 named coat patterns (Bagel · Cookie · Muffin · Pepper) + the
  cosmetics/profile foundation (skin registry, equipped state, localStorage persistence).
- **IDEA-009** — enemy skins: 4 swappable enemies (Ghost · Beetle · Bee · Ladybug), all keeping the
  frightened/eaten contract so the bone mechanic is untouched. Also fixed a latent eaten-state bug
  and gave the beagle its cute eyes.
- **IDEA-016** — earn coins from points: every 1000 points banks 1 coin, persisted immediately.
- **IDEA-017** — maze coin pickups: time-limited gold coins (4/level, 18s) — v2 places them on
  empty already-cleared tiles, pulling the player back across the maze for a real detour decision.
- **IDEA-012** — the shop: buy skins with coins (5 🪙; Bagel/Ghost free), equip what you own,
  ownership persisted. Closes the earn→spend→equip loop.
- **IDEA-021** — main menu: a full-screen welcome (v2) with a live 3D showcase of your equipped
  beagle on a garden patch — Play · Shop · your wallet; 🏠 quits a run back to the menu; game over
  offers Play again + Menu.

### v1.2 — Closer on phones (2026-07-09)
A small mobile framing fix: on phones the maze sat too far back, so the beagle and ghosts looked
tiny. The camera now pulls in on portrait screens so characters read much larger — while the whole
board stays on screen. Desktop/landscape framing is unchanged.
- **IDEA-022** — pull the camera in closer on phones: portrait viewports fit the maze by width so it
  fills the frame (camera ~18% closer on a typical phone); full board still visible, no maze tile clipped.

### v1.1 — Garden look (2026-07-08)
The maze becomes a bright daytime garden — the game's new visual identity — plus mobile and
readability fixes so it looks right everywhere.
- **IDEA-008** — garden theme as the default look: hedge-green walls, soil-brown floor, sky-blue sky, daylight lighting.
- **IDEA-011** — tasteful hedge-top detailing: sparse flowers (white/yellow/pink/red) + leaf specks.
- **IDEA-005 v2** — fix: HUD text (score/map/lives) is now readable on the sky-blue background.
- **IDEA-006 v2** — fix: mobile canvas was 2× the viewport (only the corner was visible); now fits the screen.

### v1.0 — Playable Beagle Chomp (2026-07-07)
The full maze-chase game shipped: guide a beagle around a maze, eat every biscuit to clear the map,
chomp a bone to turn the ghosts scared and edible — installable as a PWA and deployed to GitHub Pages.
- **IDEA-001** — headless logic foundation: maze validation + gameplay simulation (`npm run test`).
- **IDEA-002** — pure game logic core: grid/tunnel-wrap, tile-stepping movement, ghost AI, two validated mazes.
- **IDEA-003** — game loop & state machine (ready → play → dying | levelclear), scoring, collisions.
- **IDEA-004** — three.js render layer: scene, board, beagle/ghost meshes, effects.
- **IDEA-005** — controls, HUD & sound: keyboard + touch/swipe input, HUD, sound + mute.
- **IDEA-006** — PWA: installable + offline (vite-plugin-pwa), install UX, GitHub Pages deploy.
- **IDEA-007** — beagle app icon & favicon artwork.
