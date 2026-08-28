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

- (2026-08-28) IDEA-016 v2 — **coins now come from the maze and only the maze.** Scoring points no
  longer banks currency, so the coin pickups are the whole economy and worth going out of your way
  for. The shop had become somewhere you bought things rather than chose between them.
- (2026-08-28) IDEA-010 v2 — **Pac-Beagle**: a tribute coat with red boots and angry brows, which
  needed two new optional coat channels (paws and eyebrows) to exist at all. Owning it unlocks the
  **Ghost** as a secret free enemy skin, and the beetle becomes the free default in its place.
- (2026-08-28) IDEA-046 v1+v2 — **power-ups**: five pickups that change how a run plays rather
  than what it scores — double biscuits, double enemies, an anchor that slows the pack, a star
  that scares them and speeds you up, and a shield that takes one hit for you. Some run on a
  timer; the doublers and the shield stay with you from map to map until you lose a life. The
  shield shipped as a trap in the first cut — it absorbed the hit and then let the very next
  frame kill you — and now buys a real moment of invulnerability, which is the whole point of it.
- (2026-08-28) IDEA-045 v1 — the fruit became a ladder: apple 100, banana 200, carrot 300,
  strawberry 400, mango 500, on a weighted roll and four spawns a level instead of two. The rare
  ones are worth cutting across the maze for, and each one had to commit to its own silhouette —
  the first mango read as an orange apple, which would have made the 100 and the 500 look alike.
- (2026-08-28) IDEA-040 v3 — fix: the server never knew which level you were on. `levelIdxSequence`
  was neither sent by the client nor read by the server, so every classic run was judged as though
  it had three enemies — and a strong stage-3 run (four enemies) was rejected as impossible. Real
  lost scores. The body parser moved out of the module that opens a database pool, so the gap is
  testable now instead of invisible.
- (2026-08-28) IDEA-006 v4 — removed the GitHub Pages deploy. Right for v1.0's static PWA, dead
  since the move to Cloudflare Pages at v5.0, and quietly publishing a copy of the game with no API
  URL on every push since.
- (2026-08-27) IDEA-044 v1 — themed floor surfaces, painted from the maze grid: a trail of
  stepping stones through the garden's lawn, forest earth, beach sand, a park lawn with a
  gravel walk under the biscuits, and night-city asphalt with dashed lane markings.
- (2026-08-27) IDEA-043 v1 — themed wall surfaces: hedges, packed sand and brickwork, drawn
  procedurally at runtime so each theme's walls finally look like what the theme is about.
- (2026-08-27) IDEA-042 v1 — the editor grew a **Pickups** tab: the power bone, bonus-life
  bone, fruit and coin are now editable exactly like a character, with Save writing real
  source into board.ts. Built by generalising Character mode rather than copying it.
- (2026-08-27) IDEA-024 v2 — the game went cel-shaded: every lit surface on one shared 3-step toon
  ramp, tone mapping off so the bands stay crisp, the shipped beagle kept with broader ears, a
  thicker tail and a saddle that is finally black rather than dark brown, and a per-part shading
  dropdown in the character editor.

## 📌 Planned
> Forward-looking targets from `/plan-version`. Each is a checklist of IDEAs intended for a
> future numbered release. Items move to Unreleased as they ship.

_(nothing planned yet — v4.0 "New Territory" was fulfilled and cut on 2026-07-12)_

## Version history

### v6.0 — The Long Walk (2026-08-25)
The release where the walk got long. Five maps had become three laps of the same ground, so the
game grew to **fifteen maps in three stages**, each stage closing with a wide-open **bonus map**
generous enough to win a life back. Stage 3 brings a **fourth enemy** — and the mazes were
deliberately NOT widened to make room, because opening the corridors would refund the difficulty
the extra enemy exists to add. Past map 15 the cycle repeats at four enemies for good, and clearing
a full lap at that difficulty earns a **"Top Dog"** without ending the run.

New players no longer have to work it out mid-chase: a **tutorial** now runs before the first game,
illustrated with the LIVE game — your own beagle, your enemy skin, your maze theme — so it can never
drift out of step with what you actually see. It remembers per account, and the account screen can
bring it back.

The other half of this release is quieter and, for anyone who lost a score, more important: **runs
stopped disappearing.** Three separate causes were found and fixed — the sweeper killing games that
were still being played, a leaderboard query that scanned the whole table, and finally the plainest
one of all, "Play again" never opening a session, so every replay after your first death was
discarded in silence. The server also **learned to measure itself**, so the next bottleneck shows up
on a graph rather than in a complaint.

- **IDEA-040 v1+v2** — the game got three times bigger: 15 maps in three stages of five, each stage
  closed by a bonus map (wide open, one enemy, no white bones) worth enough biscuits to earn a life.
  Stage 3 adds a fourth enemy with the maze geometry left alone. Past map 15 the cycle repeats at
  four enemies, and a full lap at that difficulty earns a "Top Dog" congratulation. Plus the
  how-to-play tutorial: five slides before your first game, drawn with the live game, covering
  steering in the words that match your device, what biscuits and fruit are worth, that enemies are
  only edible after a white bone, and the three ways to earn a life. Remembered per ACCOUNT, so it
  never repeats on another device, and "View tutorial" on the account screen reopens it any time.
  _(v1 shipped this as coaching tips during play; v2 replaced them with the carousel after
  playtesting showed captions mid-chase distract rather than teach. Nothing appears during play.)_
- **IDEA-020 v5** — the last cause of the missing scores: the game-over panel's "Play again" never
  opened a server session, so every replay was discarded in silence — a player who died once and
  pressed the obvious button never scored again. Both entry points now go through one path that
  opens the session before the run can start. This is why every diagnostic came back empty: with no
  session, nothing ever reached the server to be logged.
- **IDEA-020 v4** — load-readiness for the score server: a partial index for the All-runs board
  query (was a sequential scan over a table that grows with every run ever played) and a 15-second
  board cache with immediate invalidation on classic accepts and account deletion — a crowd opening
  the leaderboard now costs one query per 15 s instead of one per viewer.
- **IDEA-020 v3** — the actual root cause of the lost scores: the session sweeper was killing runs
  still being played (any open session older than 10 minutes — but classic is endless, and a
  40,000-point run takes ~20). Fixed twice over: the sweep threshold now derives from the
  validator's 4-hour bound so they can't diverge, and a swept session is resurrected if its finish
  arrives — the sweep can be arbitrarily wrong and still never cost a score. The open-session cap
  now recycles the oldest session instead of refusing, so quitting three runs can't lock anyone out.
- **IDEA-039 v1** — the API now measures itself. Every request is timed and a p95-per-route table
  lands in the log every 10 minutes, with immediate warnings for any slow request and for any SQL
  statement over 200 ms — deliberately the exact threshold the stack doc names as the trigger for
  adding Redis, so that decision now waits on evidence rather than a hunch. `GET /metrics` serves
  the same data as JSON and does not exist at all unless a token is configured. Abandoned game
  sessions are also cleaned up after 90 days — only abandoned ones, never a scored run and never a
  rejection's audit trail, which is what the leaderboard history and the anti-cheat log are made of.
  At today's volume it deletes nothing, by design.


### v5.1 — Fair Play (2026-08-17)
The settling-in release after v5.0 went full-stack: the scoreboard learned to tell the truth, the
screens you meet first got their polish, and the shop finally has something worth saving for.

The headline is that **runs stopped going missing**. Players reported scores that never appeared —
one 16,000-point run showing as an old, lower record — and the cause was the submit itself: a single
network call with no retry, at the exact moment a player has something they care about, on exactly
the devices that drop connections. A finished run is now saved to your device before it's even sent,
and keeps trying until it lands.

- **IDEA-020 v2** — the scoreboard, honestly. Runs are persisted before the first send and retried
  on reconnect, on tab re-focus and at the next boot, so a dropped connection at game over can't
  cost you a score; when something does go wrong the game says so instead of leaving you to guess.
  A new **All runs** tab lists every attempt rather than one row per player — the same player can
  hold all three medals, and scores that were in the database with nowhere to show finally appear.
  Plus a "Your best" panel with your rank and the gap to 1st, top 10 with "Show all", your own row
  pinned in view when you rank below the cut, and a 🏆 button on the game-over panel.
- **IDEA-035 v1** — the login screen leads with the app icon and game name, then Create-account /
  Login tabs (signing up is the default) with the recovery-code option below.
- **IDEA-036 v1** — home menu reworked: the "three.js · maze chase" eyebrow is gone and the
  destinations became a swipeable carousel — Play included — so the beagle stays the hero of the
  screen instead of being crowded by five stacked buttons.
- **IDEA-037 v1** — the menu showcase now shows your equipped MAZE THEME, not just your skin: sky,
  ground, hedges, blooms and lighting all follow the theme you're wearing.
- **IDEA-038 v1** — an optional on-screen D-pad for phones, for players who find the swipe gesture
  fiddly. Swipe stays the default; the choice is saved to your account, so it follows you to any
  device.
- **IDEA-012 v2** — cosmetic prices raised: beagle and enemy skins 5 → **25**, maze themes 5–10 →
  **50**. At 5 coins a skin was about one good run, so nothing in the shop was worth saving for.
  First price change since the server became authoritative, so it needed a catalog re-sync — the
  drift test caught all 11 mismatches before they could reach a player.
- **IDEA-006 v3** — the PWA install banner is readable on a phone at last. It was a round-cornered
  pill anchored to the bottom that deformed into an unreadable lozenge when its text wrapped,
  directly over the menu buttons. Now a top-pinned banner that stacks properly on narrow screens,
  with real touch targets, clear of both the buttons and the game's title.

**Note on the lost scores:** this stops the loss from here on. Runs whose results never reached the
server before v5.1 are gone — the server can't score what it never received.

### v5.0 — Signed In (2026-08-14)
Beagle Chomp stopped being a static offline PWA and became a full-stack game. It now knows who you
are: your coins, skins, themes and progress live on an account rather than in one browser's storage,
so they follow you across devices — and there's a shared board to compare high scores on.

Deployed to the self-hosted platform in `STACK.md`: a Dockerised JSON API on
**beaglechomp-api.nunoamorim.dev** (Hono + Postgres + argon2id, via Dokploy) with the frontend moved
to **beaglechomp.nunoamorim.dev** on Cloudflare Pages. This was also the first app on that platform,
which proved the Cloudflare Origin Certificate + orange-cloud method §10 requires before História's
irreplaceable data migrates.

- **IDEA-019** — player accounts & cross-device recovery: username + password, **no email ever**,
  and a single-use recovery code that both resets a forgotten password and signs you in on a new
  device. Consuming one issues a replacement, shown on a genuinely blocking screen — with no email
  on file it's the only way back into an account, so it can't be dismissed by a stray click.
  Sign-in is required before play, enforced structurally rather than by scattered checks.
- **IDEA-020** — shared **classic-mode** scoreboard, and the score pipeline that makes it worth
  trusting: server-issued, server-timestamped run tickets, and scores validated against what the
  game can physically produce before they count. Implausible runs are rejected outright rather than
  clamped, and logged. Coins and challenge progress are computed server-side, so neither can be
  forged. Challenge runs are deliberately unranked — their modifiers make those scores
  incomparable.

**Breaking:** a save-wipe release. There is no local→account migration, by decision — profile state
moved from `localStorage` to the account, and the old blob is deliberately left untouched on disk
rather than read or deleted.

### v4.2 — Editor Power (2026-07-13)
The editor grew teeth: apply-your-edits safely, sculpt props part-by-part, and dress the board by
hand. Driven by Nuno hitting the copy-paste footgun (a broken beagle shipped) and wanting real
direct manipulation, not sliders.
- **IDEA-032** — save-to-file: a dev-only endpoint writes characters.ts / themes.ts / props.ts
  directly from the editor ("💾 Save" buttons) — no more paste-in-the-wrong-place. Root-cause fix
  for the residue hazard.
- **IDEA-033** — props as part-assemblies: select a component (a tower's window, a tree's crown),
  move/scale/recolor it, add primitive parts, delete parts — props edited like the beagle. Shipped
  defs render byte-identically.
- **IDEA-034** — fuller on-board editing: pulsing highlighted slots showing where props go,
  first-class rotation ([ / ] keys), move/scale/add/delete for apron props and wall components.

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
