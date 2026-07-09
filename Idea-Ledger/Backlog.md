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
_(nothing yet)_

## Backlog (open ideas)
> New registered ideas go here. Next free ID: IDEA-023

### IDEA-009 — Enemy skin system (break away from the classic ghost) 💡
- **Priority:** 🟡
- **Area:** skins
- **Description:** be able to change the appearance of the enemies. The goal is to escape the
  traditional Pac-Man look — instead of the classic ghost, offer something different that fits the
  game's theme. The current ghost stays available as one skin, but it shouldn't have to be the main
  one; design another cool appearance and make enemy skins swappable.
- **Notes:** merged from two captures describing the same feature. Ghost = one option among several.
  Skins are sold through the shop ([[IDEA-012]]).
- **Dependencies:** —

### IDEA-010 — Beagle skins named after coat patterns 💡
- **Priority:** 🟡
- **Area:** skins
- **Description:** skins for the beagle. Beagles come in many coat-color patterns, so have one skin
  per pattern, and give each skin a pet name — e.g. the standard one could be "Bagel", another
  "Cookie", another "Muffin". Each skin has its own name.
- **Notes:** playful naming is part of the appeal. Sold through the shop ([[IDEA-012]]).
- **Dependencies:** —

### IDEA-012 — Shop system for skins & themes 💡
- **Priority:** 🟡
- **Area:** shop
- **Description:** a shop that lets the player buy beagle skins, enemy skins, and map skins/themes.
  The single storefront for all cosmetic unlocks.
- **Notes:** spends the coin currency earned in classic mode ([[IDEA-016]], [[IDEA-017]]). Sells the
  cosmetics from [[IDEA-009]], [[IDEA-010]], and map themes built on [[IDEA-008]]/[[IDEA-011]].
- **Dependencies:** [[IDEA-009]], [[IDEA-010]]

### IDEA-013 — Challenge mode: per-level twists 💡
- **Priority:** 🟡
- **Area:** modes
- **Description:** a new game mode using the same core game system but with a different challenge as
  the player advances through levels. Level 1 plays like the classic game; level 2 is speed x2;
  level 3 has more enemies; level 4 the maze changes after a few seconds or the walls move around —
  and so on. Each level throws a new twist at the player.
- **Notes:** reuses the classic engine; the twists are modifiers layered on top. Pairs with the
  level select ([[IDEA-014]]).
- **Dependencies:** —

### IDEA-014 — Level map / level select for challenge mode 💡
- **Priority:** 🟢
- **Area:** modes
- **Description:** let the player see the levels that exist in the new challenge mode and pick the
  one they want to play — like a level map.
- **Notes:** the front end for [[IDEA-013]]; reached from the main menu ([[IDEA-020]]).
- **Dependencies:** [[IDEA-013]]

### IDEA-015 — Classic mode: change the maze each level 💡
- **Priority:** 🟡
- **Area:** modes
- **Description:** in the classic mode, when the player clears a level, change something to keep it
  fresh. Proposal: swap the maze on each level so there's something different to challenge the
  player instead of replaying the same board.
- **Notes:** needs a pool of mazes to rotate through (level-designer work). Ties into the maze-detail
  themes ([[IDEA-011]]).
- **Dependencies:** —

### IDEA-016 — Classic mode: earn coins from points 💡
- **Priority:** 🟡
- **Area:** economy
- **Description:** in classic mode, add a points system where reaching a number of points converts
  into a coin for the shop system. Playing well earns shop currency.
- **Notes:** the primary coin source; the coin is the shop currency ([[IDEA-012]]). Distinct from the
  free coin pickup ([[IDEA-017]]).
- **Dependencies:** [[IDEA-012]]

### IDEA-017 — Classic mode: coin pickups in the maze 💡
- **Priority:** 🟢
- **Area:** economy
- **Description:** in classic mode, at random, a coin appears in the maze like the fruit does — but
  this one grants the player a coin directly, no points needed. A gift, essentially.
- **Notes:** same coin currency as [[IDEA-016]], but earned by pickup rather than by scoring. Spends
  in the shop ([[IDEA-012]]).
- **Dependencies:** [[IDEA-012]]

### IDEA-018 — Bonus lives: pickups & milestones 💡
- **Priority:** 🟢
- **Area:** economy
- **Description:** same logic as the classic-mode coins, but for lives. Give the player extra lives
  via: a bone appearing at random in the maze, or after a big group of points, or when they eat all
  3 enemies in a single power-up.
- **Notes:** mirrors the coin-drop mechanic ([[IDEA-017]]) but rewards lives. The "eat 3 enemies →
  bone" trigger ties into scoring in [[IDEA-003]].
- **Dependencies:** —

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

### IDEA-021 — Main menu (modes · shop · profile · scoreboard) 💡
- **Priority:** 🟡
- **Area:** menu
- **Description:** a good game menu that lets the player navigate between game modes, the shop, their
  profile, and the scoreboard. The hub that ties the whole app together.
- **Notes:** the navigation surface for [[IDEA-012]], [[IDEA-013]]/[[IDEA-014]], [[IDEA-019]], and
  [[IDEA-020]]. Worth designing once the sections it links to are scoped.
- **Dependencies:** —

## In progress 🔨
_(nothing yet)_

## Delivered ✅
> Already in production. Do NOT delete. Each keeps its version history.

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
  - **v1** (2026-07-09) — portrait width-fit: `ndcTargetX` ramps 0.97→1.05 and `ndcTargetY` 0.97→1.30 as aspect narrows toward 0.46, plus `tightenFitDistance` bidirectional refine (portrait only). Camera ~18% closer on a typical phone; full board still framed. `scene.ts`. _(PENDING)_

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
