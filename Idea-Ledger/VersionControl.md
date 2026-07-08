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
- (2026-07-08) IDEA-008 v1 — garden theme is the new default look (hedge-green walls, soil-brown floor, sky-blue bg).
- (2026-07-08) IDEA-006 v2 — fix: mobile canvas was 2× the viewport (only the corner showed); now fits the screen.

## 📌 Planned
> Forward-looking targets from `/plan-version`. Each is a checklist of IDEAs intended for a
> future numbered release. Items move to Unreleased as they ship.

### v1.1 — Garden look [planned]
A quick visual identity win: re-skin the maze to a garden and add tasteful detail. Render-only,
no new systems — the base every later map theme builds on.
- [x] IDEA-008 — Garden theme as the default maze look (brown floor, green walls) — shipped 2026-07-08
- [ ] IDEA-011 — Detail & texture pass on the maps (leaves/flowers; neon for future themes)

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
