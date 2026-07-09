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
- (2026-07-09) IDEA-010 v1 — beagle skins: 4 named coat patterns (Bagel/Cookie/Muffin/Pepper) + the cosmetics/profile foundation (skin registry, equipped state, localStorage persistence) and a temporary switcher. First feature of v2.0 "The Garden".
- (2026-07-09) IDEA-009 v1 — enemy skins: 4 swappable enemies (Ghost/Beetle/Bee/Ladybug) via a makeEnemy factory, all keeping the frightened/eaten state contract; enemy-skin persistence added to the shared profile. Also fixed a latent eaten-state bug and gave the beagle cute eyes. Second feature of v2.0 "The Garden".
- (2026-07-09) IDEA-016 + IDEA-017 v1 — coins: earn 1 coin per 1000 points, plus grab time-limited gold coins that spawn on random maze tiles (4/level, 18s each). HUD coin counter + a coin field on the persisted profile. The currency for the shop. Third feature of v2.0 "The Garden".
- (2026-07-09) IDEA-012 v1 — the shop: 🛒 storefront overlay to buy skins with coins (5 🪙 each; Bagel/Ghost free) and equip owned ones; ownership persisted in the profile; replaces the temporary skin-cycle buttons. Closes the earn→spend→equip economy loop. Fourth feature of v2.0 "The Garden".
- (2026-07-09) IDEA-017 v2 — maze coins now spawn on empty already-cleared tiles (not among biscuits), so they stand out and pull the player back to cleared areas — a real detour decision.
- (2026-07-09) IDEA-021 v1 — main menu: boot lands on a hub (Play · Shop · coin balance), a 🏠 button quits a run back to the menu, and game over offers Play again + Menu. Scoped to what exists — no dead placeholders. Fifth and final feature of v2.0 "The Garden".
- (2026-07-09) IDEA-021 v2 — full-screen main menu: a dedicated welcome screen (no HUD/popup) with a live 3D showcase of the player's equipped beagle on a garden patch; equipping in the shop updates the showcased dog live; portrait camera framing.

## 📌 Planned
> Forward-looking targets from `/plan-version`. Each is a checklist of IDEAs intended for a
> future numbered release. Items move to Unreleased as they ship.

### v2.0 — The Garden [planned]
The cosmetics economy loop: skins to earn toward, coins to earn them with, a shop to spend in, and
a real menu to reach it all. A complete self-contained loop with no backend dependency.
- [ ] IDEA-010 — Beagle skins named after coat patterns (Bagel, Cookie, Muffin…)
- [ ] IDEA-009 — Enemy skin system (ghost becomes one option among several)
- [ ] IDEA-016 — Classic mode: earn coins from points
- [ ] IDEA-017 — Classic mode: coin pickups in the maze
- [ ] IDEA-012 — Shop system for skins & themes
- [ ] IDEA-021 — Main menu (modes · shop · profile · scoreboard)

## Version history

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
