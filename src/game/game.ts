// OWNER: gameplay-engineer (with render-artist for the sync layer)
// The integration layer: owns the GameState, wires input -> logic -> render,
// runs the fixed update, handles eating, collisions, lives, and level flow.
//
// ALL the hard logic already exists and is validated:
//   - grid.ts / movement.ts / ghostAI.ts  (proven, tested)
//   - full reference flow in /prototype/beagle-chomp.html (sections 7-11)
// This file composes those pieces, not reinvents them. After any change to
// movement or AI, run `npm run test` before considering it done.
//
// M4 scope: the full ready -> play -> (dying | levelclear) -> ... state
// machine on top of the M2/M3 beagle+ghost loop: bones trigger a fright
// window (edible, escalating-score ghosts that glide home as eyes and
// respawn), fruit bonuses, lives/collisions, and level progression across
// the two validated mazes (looping, with a lap indicator).
import { Grid, COLS, ROWS, worldX, worldZ, type Vec2 } from "./grid";
import { MAZES, MAZE_COUNT } from "./mazes";
import { SPEEDS, SCORE, TIMING, COLORS, COINS, COIN_THRESHOLDS, LIVES, LIFE_THRESHOLDS } from "./config";
import { coinsDueFromScore } from "./coins";
import { shouldFireThreshold } from "./pickups";
import { type GameMode, createInitialGameState } from "./state";
import {
  CLASSIC_MODIFIERS,
  CHALLENGE_LEVEL_COUNT,
  getChallengeLevel,
  type ChallengeModifiers,
} from "./challenges";
import { makeEntity, stepEntity, entityWorld, type Entity } from "./movement";
import { chooseGhostDir, type Ghost, type GlobalMode } from "./ghostAI";
import { attachKeyboard } from "../input/keyboard";
import { attachTouch } from "../input/touch";
import { createScene, type SceneRig } from "../render/scene";
import { createMenuScene, type MenuScene } from "../render/menuScene";
import { createShopScene, type ShopScene } from "../render/shopScene";
import { createEffects, type Effects } from "../render/effects";
import {
  buildBoard,
  eatPellet,
  spawnFruit,
  clearFruit,
  spawnCoin,
  clearCoin,
  spawnLife,
  clearLife,
  spinDecor,
  type Board,
} from "../render/board";
import {
  makeBeagle,
  makeGhost,
  makeEnemy,
  syncToEntity,
  applyGhostState,
  setBeagleDeath,
  resetBeagleScale,
  applyBeagleSkin,
} from "../render/characters";
import { createHud, type Hud } from "../ui/hud";
import { createSound, attachMuteButton, type Sound } from "../ui/sound";
import { attachShop, type ShopHandle } from "../ui/shop";
import {
  initProfileFromStorage,
  getCoins,
  addCoins,
  getChallengeProgress,
  advanceChallengeProgress,
} from "./profileStore";
import { getEquippedEnemySkinId, getBeagleSkin } from "./cosmetics";

// Scatter-corner targets per ghost personality (prototype section 7,
// GHOST_DEFS): rose/chaser -> top-right, teal/ambusher -> top-left,
// amber/clyde -> bottom-left. Classic mode only ever uses the first 3 of
// these 5 (see resetActors' `GHOST_DEFS.slice(0, activeModifiers.ghostCount)`
// below) — CLASSIC_MODIFIERS.ghostCount is always 3, so classic's actual
// on-screen ghosts (colors/corners/kinds/order) are byte-for-byte unchanged
// from before IDEA-013.
//
// IDEA-013 (Challenge Mode) generalizes this from 3 to 5 defs so challenge
// levels with ghostCount 4 or 5 have two more full personalities to draw on:
// #4 (violet) reuses the remaining 4th true corner of the board
// (bottom-right — the 3 classic defs already claim top-right/top-left/
// bottom-left), and #5 (leaf) uses a bottom-mid-edge point instead of
// reusing any of the 4 true corners a second time, so five simultaneous
// scatter targets are still five visually distinct directions around the
// board rather than two ghosts scattering to the same spot. Kinds mix
// "chaser"/"ambusher" for the two new personalities (mirroring the
// chaser/ambusher/clyde spread of the original 3, just without a second
// "clyde" — clyde's shyness rule reads oddly duplicated).
const GHOST_DEFS = [
  { color: COLORS.ghostRose, corner: { x: COLS - 2, y: 1 }, kind: "chaser" },
  { color: COLORS.ghostTeal, corner: { x: 1, y: 1 }, kind: "ambusher" },
  { color: COLORS.ghostAmber, corner: { x: 1, y: ROWS - 2 }, kind: "clyde" },
  { color: COLORS.ghostViolet, corner: { x: COLS - 2, y: ROWS - 2 }, kind: "chaser" },
  { color: COLORS.ghostLeaf, corner: { x: Math.floor((COLS - 1) / 2), y: ROWS - 2 }, kind: "ambusher" },
] as const;

// Seconds each ghost waits in the pen before its AI takes over, staggered so
// they don't all pour out of 'G' at once (prototype resetActors: i*0.9).
const RELEASE_STAGGER = 0.9;

// Collision radius in world units (prototype checkCollisions: d<0.55) — not a
// balance number in config.ts, just the geometric "close enough to touch"
// threshold for the beagle/ghost primitive models, so it's a named local
// const rather than a magic literal inline.
const COLLISION_RADIUS = 0.55;

// Pellets-eaten thresholds at which a fruit bonus appears (prototype
// maybeSpawnFruit: eaten===70 || eaten===140). Content pacing, not a balance
// dial in config.ts, so kept as a named local const.
const FRUIT_THRESHOLDS = [70, 140] as const;

interface GhostRig {
  gh: Ghost;
  mesh: ReturnType<typeof makeGhost>;
  releaseDelay: number;
}

/** Everything rebuilt per level: grid, board meshes, pellet/fruit-tile bookkeeping, spawns. */
interface LevelAssets {
  grid: Grid;
  board: Board;
  pellets: Set<string>;
  startPelletCount: number;
  fruitTiles: Vec2[];
  /** IDEA-017 follow-up: every beagle-walkable floor tile in the level
   *  (grid.walkable(x, y, false) — excludes walls and the ghost-only
   *  pen/door), precomputed once per level so maze-coin/bonus-life placement
   *  doesn't need to rescan the grid on every spawn. See pickRandomFreeTile
   *  (IDEA-018: generalized from the coin-only pickRandomCoinTile). */
  walkableTiles: Vec2[];
  beagleSpawn: Vec2;
  ghostSpawn: Vec2;
  // ---- pickup-threshold pointers (bugfix: each threshold fires ONCE per
  // level — see shouldFireThreshold in src/game/pickups.ts for the full
  // farming-exploit writeup). Deliberately live HERE, on LevelAssets, rather
  // than as their own Game fields like coinTile/lifeTile/fruitTile: they must
  // reset exactly once per FRESH level (a new maze, a new `pellets`/`eaten`
  // count — i.e. only in buildLevel), and must NOT reset on a same-level
  // death-respawn (resetActors(), called from the "dying" case in update())
  // since `eaten` itself doesn't reset on death — the beagle keeps its
  // pellet progress on the current map. Living on LevelAssets (rebuilt fresh
  // only by buildLevel, exactly like `pellets`/`startPelletCount`) gives them
  // precisely that lifetime for free, with no extra reset call sites needed.
  /** Index into COIN_THRESHOLDS of the next not-yet-fired threshold this level. */
  nextCoinThresholdIdx: number;
  /** Index into LIFE_THRESHOLDS of the next not-yet-fired threshold this level. */
  nextLifeThresholdIdx: number;
  /** Index into FRUIT_THRESHOLDS of the next not-yet-fired threshold this level. */
  nextFruitThresholdIdx: number;
}

export class Game {
  private readonly rig: SceneRig;
  // IDEA-021 v2: the full-screen menu's own dedicated scene/camera (a live
  // showcase of the equipped beagle) — created once and reused for every
  // menu visit (boot -> play -> menu -> play -> ...), never rebuilt. The
  // frame loop (see tick()) renders THIS instead of `rig` while mode==="start".
  private readonly menuScene: MenuScene;
  // IDEA-023 (shop v2): the shop page's own dedicated scene/camera (a live
  // turntable hero preview of whichever skin the player is browsing) —
  // created once alongside menuScene and reused for every shop visit, never
  // rebuilt. The frame loop renders THIS instead of `rig`/`menuScene` while
  // `shopOpen` is true (see tick()).
  private readonly shopScene: ShopScene;
  private readonly hud: Hud;
  private readonly effects: Effects;
  private readonly sound: Sound;
  private clock = { last: 0 };
  private rafHandle = 0;

  private level!: LevelAssets;

  private beagleMesh!: ReturnType<typeof makeBeagle>;
  private beagle!: Entity;
  private readonly detachKeyboard: () => void;
  private readonly detachTouch: () => void;
  private readonly detachMuteButton: () => void;
  private readonly detachAudioUnlock: () => void;
  private readonly shop: ShopHandle;
  private readonly detachHomeButton: () => void;
  private readonly detachMenuResize: () => void;
  private readonly detachPlayButton: () => void;
  private readonly detachMenuShopButton: () => void;
  private readonly detachChallengeButton: () => void;

  private ghosts: GhostRig[] = [];

  private score = 0;
  private lives = 0;
  private levelIdx = 0;

  // IDEA-013 (Challenge Mode): which mode the CURRENT run is — "classic" is
  // the default/idle-preview baseline (see the constructor and quitToMenu(),
  // both of which reset this explicitly) so a stray challenge run can never
  // leak its modifiers into a later classic run. `challengeIdx` is only
  // meaningful while gameKind==="challenge" — it's the index into
  // CHALLENGE_LEVELS of the level currently being played (see
  // startChallenge()). `activeModifiers` is what every speed/ghost-count/
  // fright-duration read in this class threads through — CLASSIC_MODIFIERS
  // for classic (a mathematical no-op on top of the raw config.ts numbers),
  // or a specific ChallengeLevel's modifiers while gameKind==="challenge".
  private gameKind: "classic" | "challenge" = "classic";
  private challengeIdx = 0;
  private activeModifiers: ChallengeModifiers = CLASSIC_MODIFIERS;

  // Boots idle on the Start panel ("start" — see state.ts for why this is
  // distinct from "ready") and only ever leaves it via the Start button's
  // click handler calling startLevel(0).
  private mode: GameMode = "start";
  private stateTimer = 0;

  // IDEA-023 (shop v2): whether the full-screen shop page is currently
  // showing, tracked via the shop's own onOpen/onClose callbacks (see the
  // constructor). While true, tick() freezes gameplay entirely (skips
  // update(dt), only advances shopScene's own turntable) and renders
  // shopScene instead of `rig`/`menuScene` — see tick() below.
  private shopOpen = false;

  // Fright window + escalating eat-chain score (prototype triggerFright/checkCollisions).
  private frightTimer = 0;
  private ghostEatChain = 0;

  // Global scatter/chase schedule: globalMode flips per TIMING.schedule,
  // modeClock counts seconds within the current entry, scheduleIdx is the
  // index into TIMING.schedule. Mirrors prototype's modeClock/SCHEDULE/globalMode.
  // Frozen (not advanced) while frightTimer>0 (prototype updatePlay 505-517).
  private globalMode: GlobalMode = "scatter";
  private modeClock = 0;
  private scheduleIdx = 0;

  // Current fruit tile, if any (board.fruit is only the mesh — the logic
  // needs the tile to know when the beagle has stepped onto it, and the
  // fruit-tile list to place new ones).
  private fruitTile: Vec2 | null = null;

  // IDEA-016/IDEA-017: current maze coin tile, if any (board.coin is only the
  // mesh — mirrors fruitTile exactly).
  private coinTile: Vec2 | null = null;

  // IDEA-017 follow-up: countdown (seconds) until the current coin
  // auto-despawns if not grabbed (COINS.lifespanSeconds) — a "grab it quick"
  // bonus, unlike the fruit which lingers until eaten. Only meaningful while
  // coinTile is non-null; only ticks during actual "play" (see updatePlay),
  // never during ready/dying/levelclear/start so a coin can't silently expire
  // while the player isn't even moving yet.
  private coinTimer = 0;

  // IDEA-016: how many coins this run's score has already banked, so
  // advanceSchedule-adjacent score changes only award the *newly* crossed
  // COINS.perPoints thresholds (coinsDueFromScore(this.score, ...) minus this
  // is the delta to bank). Reset to 0 whenever score resets to 0 (new game /
  // play-again) — NOT on level transitions, since score (and this counter)
  // carry across levels within one run.
  private coinsAwardedFromScore = 0;

  // IDEA-018: current maze bonus-life tile, if any (board.life is only the
  // mesh — mirrors coinTile/fruitTile exactly).
  private lifeTile: Vec2 | null = null;

  // IDEA-018: countdown (seconds) until the current life pickup auto-despawns
  // if not grabbed (LIVES.pickupLifespanSeconds) — mirrors coinTimer exactly,
  // including only ticking during actual "play" (see tickLifeLifespan).
  private lifeTimer = 0;

  // IDEA-018: how many bonus lives this run's score has already granted via
  // the points-milestone trigger (LIVES.milestonePoints), mirroring
  // coinsAwardedFromScore exactly — including the "advance even if the cap
  // blocked the actual grant" rule (see maybeAwardLivesFromScore) so a
  // milestone can never re-fire once already counted. Reset at the same 3
  // new-game sites as coinsAwardedFromScore.
  private livesAwardedFromScore = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.rig = createScene(canvas);
    this.menuScene = createMenuScene();
    this.shopScene = createShopScene();
    this.hud = createHud(document.body);
    // Constructed eagerly (cheap — just an AudioContext + a gain node); it
    // starts (or can start) "suspended" per the browser autoplay policy until
    // a real user gesture calls resume() (Start click, first input, or the
    // mute button — wired below and via attachMuteButton).
    this.sound = createSound();
    this.detachMuteButton = attachMuteButton(document.body, this.sound);

    // Unlock audio on the very first user gesture of any kind, in case the
    // player's first interaction isn't the Start button (e.g. taps the mute
    // button, or a keydown lands before the click somehow). Self-removing —
    // resume() is idempotent so re-calling it via the Start/Play-again
    // handlers below is harmless, but there's no reason to keep listening
    // once we've fired once.
    const unlockOnce = (): void => {
      this.sound.resume();
      this.detachAudioUnlock();
    };
    document.addEventListener("keydown", unlockOnce, { once: true });
    canvas.addEventListener("pointerdown", unlockOnce, { once: true });
    this.detachAudioUnlock = () => {
      document.removeEventListener("keydown", unlockOnce);
      canvas.removeEventListener("pointerdown", unlockOnce);
    };

    // Build a static preview board behind the start panel (prototype boot,
    // section 12: buildBoard(0); updateHUD(); before the Start click).
    this.level = this.buildLevel(0);
    this.effects = createEffects(this.rig.scene, this.rig.camera, canvas);

    // Load the persisted equipped-skin id (IDEA-010) BEFORE makeBeagle() so
    // the beagle boots already wearing whatever the player last picked —
    // makeBeagle()'s default param reads getEquippedBeagleSkin(), which this
    // populates from localStorage (falling back to the default "bagel" skin,
    // a byte-for-byte match of the original fixed palette, if nothing was
    // ever saved).
    initProfileFromStorage();
    this.beagleMesh = makeBeagle();
    this.rig.scene.add(this.beagleMesh);
    // IDEA-013: scaled by activeModifiers.speedMult (1 at boot, since
    // gameKind/activeModifiers default to the classic baseline — see the
    // field declarations above) so this stays a byte-for-byte no-op for
    // classic/the idle preview.
    this.beagle = makeEntity(this.level.beagleSpawn.x, this.level.beagleSpawn.y, SPEEDS.beagle * this.activeModifiers.speedMult);

    // The real shop UI (IDEA-012) — replaces the old skin/enemy cycle
    // buttons. Lives alongside attachMuteButton with the same lifecycle
    // (detached in stop() below); resetActors() rebuilds ghosts but reuses
    // this.beagleMesh, so the equipped skin persists naturally across level
    // resets/deaths. The shop stays three-free/pure-DOM (src/ui/shop.ts);
    // the actual mesh work happens here via these callbacks, mirroring how
    // attachSkinButton/attachEnemyButton used to hand it back to game.ts.
    this.shop = attachShop(document.body, {
      onEquipBeagle: (skin) => {
        applyBeagleSkin(this.beagleMesh, skin);
        // IDEA-021 v2: keep the menu's showcase beagle in sync live — the
        // shop overlays the full-screen menu, so equipping a skin should
        // recolor the dog the player can see right behind the shop panel,
        // not just the (currently hidden) in-game one.
        this.menuScene.setBeagleSkin(skin);
      },
      onEquipEnemy: () => {
        this.rebuildEnemySkins();
      },
      // The shop panel's own header balance already re-renders itself from
      // live state after every buy — but the HUD's coin stat lives outside
      // the shop overlay and would otherwise stay stale until the next
      // in-game coin event. Re-sync it here on every successful purchase.
      onCoinsChanged: () => {
        this.hud.setCoins(getCoins());
      },
      // IDEA-021: the main menu renders its own "N coins" line underneath the
      // shop overlay (opened via #menuShopBtn -> this.shop.open()). The
      // player can only spend in the shop, never earn, but a purchase there
      // still changes the wallet the menu displayed before it opened — so
      // re-render the menu on close to pick up any change. No-op (cheap) if
      // the menu isn't the panel currently showing.
      //
      // IDEA-023 (shop v2): also the single place `shopOpen` flips back off
      // and `body.shop-open` is removed — tick() reads `shopOpen` every
      // frame to decide whether to freeze gameplay and which scene to
      // render (see tick()), and the CSS rule keyed on body.shop-open hides
      // the HUD/menu chrome the full-screen shop page would otherwise sit
      // awkwardly on top of.
      onClose: () => {
        this.shopOpen = false;
        document.body.classList.remove("shop-open");
        if (this.mode === "start") this.showMenu();
      },
      // IDEA-023: the shop page just opened — freeze gameplay (tick() reads
      // this flag) and hide the HUD/menu chrome behind the full-screen page.
      onOpen: () => {
        this.shopOpen = true;
        document.body.classList.add("shop-open");
      },
      // IDEA-023: drives the shop page's own live 3D hero preview — fired on
      // open, on every tab switch, and on every card tap (never after
      // equipping the already-selected card, since the same model is already
      // shown — see shop.ts's onPreview doc comment).
      onPreview: (kind, id) => {
        if (kind === "beagle") this.shopScene.showBeagle(getBeagleSkin(id));
        else this.shopScene.showEnemy(id);
      },
    });

    this.detachKeyboard = attachKeyboard((d) => { this.beagle.queued = d; });
    this.detachTouch = attachTouch(canvas, (d) => { this.beagle.queued = d; });
    this.detachHomeButton = this.attachHomeButton();

    // IDEA-021 v2: #playBtn/#menuShopBtn are now static markup in index.html
    // (the full-screen #mainMenu overlay), not rebuilt every showMenu() call
    // like the old hud.showPanel() HTML was — so they're wired ONCE here,
    // not inside showMenu().
    const playBtn = document.getElementById("playBtn") as HTMLButtonElement | null;
    if (!playBtn) throw new Error("Game: missing #playBtn — check index.html");
    const onPlayClick = (): void => {
      // The Play click is a guaranteed user gesture, so this is the primary
      // place audio unlocks (the first-input listeners in the constructor are
      // just a belt-and-suspenders fallback for anyone who somehow interacts
      // before clicking Play).
      this.sound.resume();
      this.hideMenu();
      const fresh = createInitialGameState();
      this.score = fresh.score;
      this.lives = fresh.lives;
      this.coinsAwardedFromScore = 0;
      this.livesAwardedFromScore = 0;
      this.hud.setScore(this.score);
      this.hud.setLives(this.lives);
      this.startLevel(0);
    };
    playBtn.addEventListener("click", onPlayClick);
    this.detachPlayButton = () => playBtn.removeEventListener("click", onPlayClick);

    const menuShopBtn = document.getElementById("menuShopBtn") as HTMLButtonElement | null;
    if (!menuShopBtn) throw new Error("Game: missing #menuShopBtn — check index.html");
    const onMenuShopClick = (): void => this.shop.open();
    menuShopBtn.addEventListener("click", onMenuShopClick);
    this.detachMenuShopButton = () => menuShopBtn.removeEventListener("click", onMenuShopClick);

    // IDEA-013 (Challenge Mode): #challengeBtn is static markup in
    // index.html's #mainMenu (between Play and Shop), wired once here
    // exactly like playBtn/menuShopBtn above. Continues at the player's
    // highest unlocked level (getChallengeProgress()) — if every level has
    // already been cleared (challengeProgress === CHALLENGE_LEVEL_COUNT),
    // startChallenge's own clamp lands on the LAST level (COUNT-1) rather
    // than a phantom one-past-the-end level, per its own doc comment.
    const challengeBtn = document.getElementById("challengeBtn") as HTMLButtonElement | null;
    if (!challengeBtn) throw new Error("Game: missing #challengeBtn — check index.html");
    const onChallengeClick = (): void => {
      this.sound.resume();
      this.hideMenu();
      this.startChallenge(getChallengeProgress());
    };
    challengeBtn.addEventListener("click", onChallengeClick);
    this.detachChallengeButton = () => challengeBtn.removeEventListener("click", onChallengeClick);

    // IDEA-021 v2 / IDEA-023: the menu scene's and shop scene's cameras are
    // both plain perspective cams (no maze-fit math) — just need their
    // aspect kept current, independent of scene.ts's own resize() (which
    // already has its own window listener).
    const onMenuResize = (): void => {
      const aspect = window.innerWidth / window.innerHeight;
      this.menuScene.resize(aspect);
      this.shopScene.resize(aspect);
    };
    window.addEventListener("resize", onMenuResize);
    onMenuResize();
    this.detachMenuResize = () => window.removeEventListener("resize", onMenuResize);

    const initial = createInitialGameState();
    this.score = initial.score;
    this.lives = initial.lives;
    this.coinsAwardedFromScore = 0;
    this.livesAwardedFromScore = 0;
    this.hud.setScore(this.score);
    this.hud.setLives(this.lives);
    this.hud.setLevel("1");
    // IDEA-016/IDEA-017: reflect the persisted wallet immediately on boot,
    // before any run-scoped scoring/pickups happen (coins survive across runs
    // even though score/lives reset above).
    this.hud.setCoins(getCoins());

    // Pose the beagle + spawn the ghosts for the idle preview behind the
    // start panel (prototype boot never calls resetActors before Start, but
    // its ghosts array starts empty and the beagle mesh sits at its default
    // transform — posing ours via resetActors gives an equivalent, slightly
    // livelier preview). Nothing steps while mode==="start" (see the "start"
    // case in update()), so this is purely a static pose until Start is clicked.
    this.resetActors();

    this.showMenu();
  }

  /**
   * The main menu (IDEA-021 v2) — a FULL-SCREEN dedicated welcome screen with
   * a live 3D beagle showcase (menuScene), replacing the old "popup panel
   * over the maze + HUD" boot experience. The boot screen, and the screen
   * returned to via game-over's "Menu" button or the in-HUD 🏠 quit button.
   * Deliberately shows ONLY Play + Shop + the coin wallet (no placeholder
   * slots for future modes/profile/scoreboard — scope confirmed for v2.0).
   * Re-reads getCoins() fresh on every call so the wallet line is never stale
   * after a run (coins earned) or a shop visit (coins spent) — see the
   * `onClose`/`onCoinsChanged` shop callbacks in the constructor, which both
   * call back into this method while mode is "start".
   *
   * Hides the HUD/game center panel (hud.hideCenter() + body.menu-open, which
   * the CSS uses to hide the .hud strip and its floating buttons) and reveals
   * #mainMenu — the frame loop (tick()) is what actually switches which
   * scene/camera gets rendered while mode==="start" (see below).
   */
  private showMenu(): void {
    this.hud.hideCenter();
    document.body.classList.add("menu-open");

    const mainMenu = document.getElementById("mainMenu");
    if (!mainMenu) throw new Error("showMenu: missing #mainMenu — check index.html");
    mainMenu.classList.remove("hidden");

    const coinLine = document.getElementById("menuCoinLine");
    if (coinLine) coinLine.textContent = `\u{1FA99} ${getCoins()} coins`;
  }

  /** Leaves the full-screen menu (Play click / any other exit) — hides
   *  #mainMenu and the body-level HUD-hiding class so the HUD/game scene
   *  render normally again. Called from the Play button's handler; mode is
   *  advanced by startLevel() right after. */
  private hideMenu(): void {
    const mainMenu = document.getElementById("mainMenu");
    mainMenu?.classList.add("hidden");
    document.body.classList.remove("menu-open");
  }

  /**
   * Builds everything that depends on a specific maze: the Grid, the render
   * Board (walls/floor/pellet meshes), the mutable pellet set, the fruit-tile
   * list, and the P/G spawn tiles. Pure construction — does not touch scene
   * membership of any *previous* level's meshes; callers (constructor,
   * startLevel, startChallenge) are responsible for removing the old ones
   * first so nothing leaks across levels.
   *
   * `mazeIdx` is the ALREADY-RESOLVED index into MAZES (0..MAZE_COUNT-1) —
   * this method itself does no modulo/lap math. That resolution is entirely
   * the caller's job (IDEA-013 refactor): startLevel (classic) resolves it
   * as `idx % MAZE_COUNT` so an ever-increasing classic level index loops
   * through the maze pool with laps, exactly as before this refactor;
   * startChallenge (Challenge Mode) resolves it as the fixed
   * `CHALLENGE_LEVELS[idx].mazeIdx`, which is never subject to any lap
   * arithmetic. Splitting the resolution out here is what keeps classic's
   * own behavior byte-for-byte identical: `buildLevel(idx % MAZE_COUNT)`
   * from startLevel computes exactly the same maze this method used to pick
   * internally via `MAZES[idx % MAZE_COUNT]`.
   */
  private buildLevel(mazeIdx: number): LevelAssets {
    const grid = new Grid(MAZES[mazeIdx]);
    const board = buildBoard(this.rig.scene, grid);

    const pellets = new Set<string>();
    const fruitTiles: Vec2[] = [];
    const walkableTiles: Vec2[] = [];
    let beagleSpawn: Vec2 = { x: 0, y: 0 };
    let ghostSpawn: Vec2 = { x: 0, y: 0 };

    grid.cells.forEach((row, y) => row.forEach((c, x) => {
      if (c === "." || c === "o") pellets.add(`${x},${y}`);
      else if (c === "F") fruitTiles.push({ x, y });
      else if (c === "P") beagleSpawn = { x, y };
      else if (c === "G") ghostSpawn = { x, y };
      // IDEA-017 follow-up: the beagle-walkable set for maze-coin placement —
      // grid.walkable(x, y, false) is the robust source of truth (excludes
      // walls "#"/void " " and the ghost-only pen/door "="/"-"/"G"), rather
      // than hardcoding the floor-tile character list here.
      if (grid.walkable(x, y, false)) walkableTiles.push({ x, y });
    }));

    return {
      grid,
      board,
      pellets,
      startPelletCount: pellets.size,
      fruitTiles,
      walkableTiles,
      beagleSpawn,
      ghostSpawn,
      nextCoinThresholdIdx: 0,
      nextLifeThresholdIdx: 0,
      nextFruitThresholdIdx: 0,
    };
  }

  /** Removes every mesh owned by the previous level's board from the scene (walls, floor, remaining pellets, fruit, coin, bonus life, hedge decor) so buildLevel's replacement never leaks. */
  private disposeLevel(level: LevelAssets): void {
    this.rig.scene.remove(level.board.walls, level.board.floor);
    level.board.pelletMeshes.forEach((p) => p.mesh.removeFromParent());
    if (level.board.fruit) this.rig.scene.remove(level.board.fruit);
    if (level.board.coin) this.rig.scene.remove(level.board.coin);
    if (level.board.life) this.rig.scene.remove(level.board.life);
    level.board.hedgeDecor.forEach((m) => this.rig.scene.remove(m));
  }

  start(): void {
    this.clock.last = performance.now();
    this.rafHandle = requestAnimationFrame(this.tick);
  }

  stop(): void {
    cancelAnimationFrame(this.rafHandle);
    this.detachKeyboard();
    this.detachTouch();
    this.detachMuteButton();
    this.detachAudioUnlock();
    this.detachHomeButton();
    this.detachMenuResize();
    this.detachPlayButton();
    this.detachMenuShopButton();
    this.detachChallengeButton();
    this.shop.detach();
    this.menuScene.dispose();
    this.shopScene.dispose();
  }

  // ---- level flow (prototype startLevel, line 419) ----

  /**
   * CLASSIC MODE level flow — unchanged behavior from before IDEA-013.
   * `idx` is the ever-increasing classic level index (0-based, loops through
   * MAZES with a lap indicator once idx >= MAZE_COUNT — see mapNumber/lap
   * below). Always resolves gameKind/activeModifiers to the classic baseline
   * before building, so calling this can never leave a stray challenge
   * modifier active (defence in depth alongside the Play button handler and
   * quitToMenu(), which already set these explicitly at every classic entry
   * point).
   */
  private startLevel(idx: number): void {
    this.gameKind = "classic";
    this.activeModifiers = CLASSIC_MODIFIERS;

    this.disposeLevel(this.level);
    this.level = this.buildLevel(idx % MAZE_COUNT);

    this.levelIdx = idx;
    const mapNumber = (idx % MAZE_COUNT) + 1;
    const lap = idx >= MAZE_COUNT ? ` ·${Math.floor(idx / MAZE_COUNT) + 1}` : "";
    this.hud.setLevel(`${mapNumber}${lap}`);

    this.resetActors();
    this.mode = "ready";
    this.stateTimer = TIMING.readySeconds;
    this.hud.showBanner("Ready!");
  }

  // ---- Challenge Mode level flow (IDEA-013) ----

  /**
   * CHALLENGE MODE level flow — mirrors startLevel's shape (dispose old
   * level, build the new one, reset actors, enter "ready") but resolves the
   * maze from the fixed CHALLENGE_LEVELS table instead of a looping
   * `idx % MAZE_COUNT`, and sets gameKind/challengeIdx/activeModifiers so
   * every speed/ghost-count/fright-duration read elsewhere in this class
   * (resetActors, updatePlay, triggerFright) picks up this level's twist.
   * `idx` is clamped via getChallengeLevel (never throws for an
   * out-of-range idx, e.g. a corrupt persisted challengeProgress) —
   * `this.challengeIdx`/the HUD label are set from THAT CLAMPED index
   * (`level`'s own position in CHALLENGE_LEVELS via getChallengeLevel's
   * clamp), not the raw `idx` passed in, so a caller passing
   * CHALLENGE_LEVEL_COUNT (the "all cleared" sentinel — see
   * profileStore.ts's StoredProfile doc comment) correctly lands on and
   * tracks the LAST real level (index COUNT-1), not a phantom one-past-the-
   * end level.
   *
   * ALWAYS a FRESH run: score/lives reset exactly like the Play button's
   * handler does (createInitialGameState + the same 3 counter resets),
   * since a challenge run is its own self-contained playthrough, not a
   * continuation of whatever classic run (if any) was last in progress.
   * Called from the #challengeBtn handler (fresh run, entering at the
   * highest unlocked level), the challenge level-complete panel's "Next
   * level" button, and the game-over panel's "Play again" button while
   * gameKind==="challenge" (both restart/advance a challenge run, not a
   * classic one — see gameOver()/levelClear()'s challenge branches below).
   */
  private startChallenge(idx: number): void {
    // Same clamp getChallengeLevel itself applies internally (see
    // challenges.ts) — duplicated here (rather than reverse-looking-up the
    // returned level's index) so resolvedIdx is unambiguously "the index
    // that produced this exact level", with no reliance on array reference
    // identity between the two calls.
    const safeIdx = Number.isFinite(idx) ? Math.floor(idx) : 0;
    const resolvedIdx = Math.max(0, Math.min(safeIdx, CHALLENGE_LEVEL_COUNT - 1));
    const level = getChallengeLevel(resolvedIdx);

    this.gameKind = "challenge";
    this.challengeIdx = resolvedIdx;
    this.activeModifiers = level.modifiers;

    const fresh = createInitialGameState();
    this.score = fresh.score;
    this.lives = fresh.lives;
    this.coinsAwardedFromScore = 0;
    this.livesAwardedFromScore = 0;
    this.hud.setScore(this.score);
    this.hud.setLives(this.lives);

    this.disposeLevel(this.level);
    this.level = this.buildLevel(level.mazeIdx);

    // Small, readable challenge-level HUD label (e.g. "C3") — distinct from
    // classic's "map · lap" label so the player can always tell which mode
    // they're in from the HUD alone.
    this.hud.setLevel(`C${resolvedIdx + 1}`);

    this.resetActors();
    this.mode = "ready";
    this.stateTimer = TIMING.readySeconds;
    this.hud.showBanner("Ready!");
  }

  // ---- actor (beagle + ghosts) reset (prototype resetActors, line 404) ----

  private resetActors(): void {
    // IDEA-013: scaled by activeModifiers.speedMult — CLASSIC_MODIFIERS'
    // speedMult is 1, so this is a byte-for-byte no-op for every classic
    // call site (startLevel's death-respawn/level-transition resets).
    this.beagle = makeEntity(this.level.beagleSpawn.x, this.level.beagleSpawn.y, SPEEDS.beagle * this.activeModifiers.speedMult);
    this.beagle.dir = { x: 0, y: 0 };
    this.beagle.queued = { x: -1, y: 0 };
    this.beagle.facing = { x: 0, y: 1 };

    // Remove old ghost meshes before rebuilding fresh ones (prototype 409:
    // ghosts.forEach(gh => scene.remove(gh.mesh))) so nothing leaks per level
    // or per death-reset.
    this.ghosts.forEach((rig) => this.rig.scene.remove(rig.mesh));
    const spawn = this.level.ghostSpawn;
    const enemySkinId = getEquippedEnemySkinId();
    // IDEA-013: only the first activeModifiers.ghostCount of the 5 GHOST_DEFS
    // are built — CLASSIC_MODIFIERS.ghostCount is 3, the original fixed
    // count, so classic (and the idle menu preview, which also runs through
    // resetActors — see the constructor) still gets exactly the same 3
    // ghosts, in the same order, as before this refactor.
    this.ghosts = GHOST_DEFS.slice(0, this.activeModifiers.ghostCount).map((def, i) => {
      const mesh = makeEnemy(enemySkinId, def.color);
      this.rig.scene.add(mesh);
      // IDEA-013: scaled by activeModifiers.ghostSpeedMult for the same
      // "byte-for-byte no-op in classic" reason as the beagle above — the
      // per-frame reassignment in updatePlay (SPEEDS.ghost/frightened/eaten
      // * ghostSpeedMult) overwrites this on the very next "play" frame
      // regardless, but setting it correctly here too keeps the Entity
      // internally consistent from the moment it's created (e.g. during the
      // "ready" countdown, before "play" ever runs).
      const e = makeEntity(spawn.x, spawn.y, SPEEDS.ghost * this.activeModifiers.ghostSpeedMult);
      e.dir = { x: 0, y: -1 };
      e.queued = { x: 0, y: -1 };
      const gh: Ghost = { e, state: "scatter", kind: def.kind, corner: def.corner };
      return { gh, mesh, releaseDelay: i * RELEASE_STAGGER };
    });

    this.frightTimer = 0;
    this.ghostEatChain = 0;
    this.modeClock = 0;
    this.scheduleIdx = 0;
    this.globalMode = "scatter";

    if (this.level.board.fruit) clearFruit(this.level.board, this.rig.scene);
    this.fruitTile = null;

    this.despawnCoin();
    this.despawnLife();
  }

  // ---- maze coin lifecycle helper (IDEA-017 follow-up: time-limited coin) ----

  /**
   * Clears the current maze coin (mesh + tile + countdown), if any — the one
   * place all three fields are reset together, so every call site (pickup in
   * eatAt, teardown in resetActors, and the lifespan expiry in updatePlay)
   * stays consistent and a stale timer can never "carry over" onto a coin
   * spawned later. Safe to call when there is no coin on the board.
   */
  private despawnCoin(): void {
    if (this.level.board.coin) clearCoin(this.level.board, this.rig.scene);
    this.coinTile = null;
    this.coinTimer = 0;
  }

  // ---- maze bonus-life lifecycle helper (IDEA-018, mirrors despawnCoin) ----

  /**
   * Clears the current maze bonus-life pickup (mesh + tile + countdown), if
   * any — the one place all three fields are reset together, mirroring
   * despawnCoin exactly, so every call site (pickup in eatAt, teardown in
   * resetActors, and the lifespan expiry in tickLifeLifespan) stays
   * consistent and a stale timer can never "carry over" onto a life pickup
   * spawned later. Safe to call when there is no life pickup on the board.
   */
  private despawnLife(): void {
    if (this.level.board.life) clearLife(this.level.board, this.rig.scene);
    this.lifeTile = null;
    this.lifeTimer = 0;
  }

  // ---- live enemy-skin switch (IDEA-009, temporary switcher) ----

  /**
   * Rebuilds the 3 enemy meshes in place for a just-changed equipped enemy
   * skin (e.g. ghost <-> beetle), preserving every ghost's logic object
   * (`gh` — its Entity, state, kind, corner) and `releaseDelay` untouched;
   * only the THREE.Group is swapped. This is a live, mid-run rebuild (not
   * deferred to the next resetActors) so the switcher button reflects
   * immediately, matching the beagle skin button's instant feedback.
   *
   * Safe to call at any time, including mid-fright/mid-eaten: the new mesh
   * is freshly built at `applyGhostState`'s "normal" baseline (own
   * baseColor, everything visible), but the very next syncToEntity/
   * applyGhostState call in the frame loop (updatePlay or syncAllPosed, both
   * of which run every mode except "start"/"over" — and this button is only
   * reachable while the HUD/canvas exist, i.e. never during those two) will
   * immediately reapply the ghost's actual current `state`/position, so any
   * single-frame "looks normal" flash is not observable in practice.
   */
  private rebuildEnemySkins(): void {
    const skinId = getEquippedEnemySkinId();
    // IDEA-013: this.ghosts is built via GHOST_DEFS.slice(0, ghostCount) in
    // resetActors(), so its index `i` still lines up 1:1 with GHOST_DEFS[i]
    // even when ghostCount < GHOST_DEFS.length (a slice from 0 preserves the
    // original indices) — GHOST_DEFS[i].color below is still the right color
    // for whichever subset of ghosts a challenge level actually built.
    this.ghosts = this.ghosts.map((rig, i) => {
      this.rig.scene.remove(rig.mesh);
      const mesh = makeEnemy(skinId, GHOST_DEFS[i].color);
      this.rig.scene.add(mesh);
      return { ...rig, mesh };
    });
  }

  // ---- eating (prototype eatAt, line 470) ----

  private onBeagleArrive = (e: Entity): void => {
    this.eatAt(e.tx, e.ty);
    this.maybeSpawnFruit();
    this.maybeSpawnCoin();
    this.maybeSpawnLife();
  };

  private eatAt(tx: number, ty: number): void {
    const key = `${tx},${ty}`;
    if (this.level.pellets.has(key)) {
      const kind = eatPellet(this.level.board, key);
      if (kind) {
        this.level.pellets.delete(key);
        this.effects.pelletEaten(worldX(tx), worldZ(ty), kind);
        if (kind === "bone") {
          this.score += SCORE.bone;
          this.effects.scorePopup(worldX(tx), worldZ(ty), SCORE.bone);
          this.sound.bone();
          this.triggerFright();
        } else {
          this.score += SCORE.biscuit;
          this.effects.scorePopup(worldX(tx), worldZ(ty), SCORE.biscuit);
          this.sound.biscuit();
        }
        this.hud.setScore(this.score);
        this.maybeAwardCoinsFromScore();
        this.maybeAwardLivesFromScore();
        if (this.level.pellets.size <= 0) this.levelClear();
      }
    }

    if (this.fruitTile && this.fruitTile.x === tx && this.fruitTile.y === ty) {
      clearFruit(this.level.board, this.rig.scene);
      this.fruitTile = null;
      this.score += SCORE.fruit;
      this.effects.pelletEaten(worldX(tx), worldZ(ty), "biscuit");
      this.effects.scorePopup(worldX(tx), worldZ(ty), SCORE.fruit);
      this.hud.setScore(this.score);
      this.maybeAwardCoinsFromScore();
      this.maybeAwardLivesFromScore();
      this.sound.fruit();
    }

    // IDEA-017: maze coin pickup — a free coin, no points (mirrors the fruit
    // block above, but banks straight to the persisted wallet instead of score).
    // Grabbed in time, i.e. before the lifespan countdown (see updatePlay)
    // reaches 0 — despawnCoin() clears the tile/timer together so there's no
    // stale countdown left running against whatever coin spawns next.
    if (this.coinTile && this.coinTile.x === tx && this.coinTile.y === ty) {
      this.despawnCoin();
      addCoins(COINS.pickupValue);
      this.hud.setCoins(getCoins());
      this.effects.pelletEaten(worldX(tx), worldZ(ty), "biscuit");
      this.sound.coin();
    }

    // IDEA-018: maze bonus-life pickup (a golden bone) — grants a life
    // directly, no points (mirrors the coin block above). Grabbed in time,
    // i.e. before the lifespan countdown (see tickLifeLifespan) reaches 0 —
    // despawnLife() clears the tile/timer together so there's no stale
    // countdown left running against whatever life pickup spawns next.
    // Consumed even if the beagle is already at LIVES.max: grantLife() is a
    // no-op in that case (no sound, no extra life), but the pickup itself
    // still disappears rather than lingering on the board.
    if (this.lifeTile && this.lifeTile.x === tx && this.lifeTile.y === ty) {
      this.despawnLife();
      this.grantLife();
      this.effects.pelletEaten(worldX(tx), worldZ(ty), "bone");
    }
  }

  // ---- coins (IDEA-016 points->coins, IDEA-017 maze pickup) ----

  /**
   * Banks any coins newly earned since the last check, based on cumulative
   * run score crossing COINS.perPoints thresholds (IDEA-016). Called after
   * every score change. Handles a single scoring event crossing multiple
   * thresholds at once (e.g. a big ghost-eat chain) by banking the full
   * delta in one call. Coins are persisted immediately (see profileStore's
   * addCoins) — they survive even if the beagle dies right after.
   */
  private maybeAwardCoinsFromScore(): void {
    const due = coinsDueFromScore(this.score, COINS.perPoints);
    if (due > this.coinsAwardedFromScore) {
      const earned = due - this.coinsAwardedFromScore;
      this.coinsAwardedFromScore = due;
      addCoins(earned);
      this.hud.setCoins(getCoins());
      this.sound.coin();
    }
  }

  // ---- maze coin pickup spawn (IDEA-017, mirrors maybeSpawnFruit) ----

  /**
   * BUGFIX (live-verified farming exploit): the gate used to be
   * `COIN_THRESHOLDS.includes(eaten)`, which re-fires on the SAME eaten-pellet
   * tick that the previous coin at that same threshold was just collected —
   * eating a coin doesn't change `eaten`, so the very next maybeSpawnCoin()
   * call (same beagle arrival, right after eatAt's pickup branch) would see
   * `board.coin` null again and the threshold still matching, and respawn a
   * coin the player could farm by oscillating over the tile. Now gated by
   * `shouldFireThreshold` against a monotonic per-level index pointer
   * (`this.level.nextCoinThresholdIdx`, reset once per fresh level in
   * buildLevel — see LevelAssets), so each of COIN_THRESHOLDS' 4 entries
   * fires exactly once per level no matter how many times a coin is
   * spawned/eaten in between.
   */
  private maybeSpawnCoin(): void {
    if (this.level.board.coin) return;
    const eaten = this.level.startPelletCount - this.level.pellets.size;
    if (!shouldFireThreshold(eaten, COIN_THRESHOLDS, this.level.nextCoinThresholdIdx)) return;

    // Excludes the beagle's current tile and the active fruit tile — same
    // pool a coin has always avoided (see pickRandomFreeTile's doc comment;
    // this call's exclude set is unchanged from before the IDEA-018 refactor).
    const exclude: Vec2[] = [{ x: this.beagle.tx, y: this.beagle.ty }];
    if (this.fruitTile) exclude.push(this.fruitTile);
    const tile = this.pickRandomFreeTile(exclude);
    if (!tile) return; // level has no walkable tiles at all — shouldn't happen for a validated maze

    this.level.nextCoinThresholdIdx++;
    this.coinTile = tile;
    this.coinTimer = COINS.lifespanSeconds;
    spawnCoin(this.level.board, this.rig.scene, tile.x, tile.y);
  }

  /**
   * Picks a random tile for a maze pickup (coin or bonus life), PREFERRING
   * bare/cleared floor: a beagle-walkable tile (this.level.walkableTiles,
   * precomputed once per level in buildLevel) that does NOT currently hold a
   * pellet. Landing on already-eaten corridors makes the pickup stand out
   * against empty floor instead of hiding among the biscuits, and turns
   * grabbing it into a real detour decision rather than "walk the path you
   * were on anyway."
   *
   * Falls back to any walkable tile (excluding `exclude` where possible) if
   * the level has no empty tiles yet (very early on, before anything's been
   * cleared) — a pickup should still appear rather than being skipped.
   * `exclude` lets each caller name whichever other tiles it must avoid
   * doubling up with (e.g. the coin spawn excludes the beagle + fruit tiles;
   * the life spawn additionally excludes the coin tile) from both candidate
   * pools where at least one other option exists, so a pickup can't spawn
   * already-grabbed the instant it appears or double up with another pickup.
   * Returns null only if the level has no walkable tiles at all, which should
   * never happen for a validated maze.
   *
   * IDEA-018: generalized from the original pickRandomCoinTile (IDEA-017) so
   * both the coin and bonus-life spawns share one implementation — the coin's
   * own behavior (candidate pool, exclusion set, fallback order) is
   * byte-for-byte unchanged, just parameterized via `exclude` instead of a
   * hardcoded beagle+fruit check.
   */
  private pickRandomFreeTile(exclude: Vec2[]): Vec2 | null {
    const isBlocked = (t: Vec2): boolean => exclude.some((b) => b.x === t.x && b.y === t.y);

    const pickFrom = (tiles: Vec2[]): Vec2 | null => {
      if (tiles.length === 0) return null;
      const clear = tiles.filter((t) => !isBlocked(t));
      const pool = clear.length > 0 ? clear : tiles;
      return pool[(Math.random() * pool.length) | 0];
    };

    const emptyTiles = this.level.walkableTiles.filter((t) => !this.level.pellets.has(`${t.x},${t.y}`));
    return pickFrom(emptyTiles) ?? pickFrom(this.level.walkableTiles);
  }

  // ---- maze coin lifespan countdown (IDEA-017 follow-up) ----

  /**
   * Ticks the current coin's despawn countdown (only called from updatePlay,
   * i.e. only during actual "play" — never ready/dying/levelclear/start, so a
   * coin can't expire while the player isn't even moving yet). Auto-despawns
   * the coin with no award once the timer runs out — a distinct, urgent
   * "grab it quick" bonus rather than a permanent fixture like the fruit.
   */
  private tickCoinLifespan(dt: number): void {
    if (!this.coinTile) return;
    this.coinTimer -= dt;
    if (this.coinTimer <= 0) this.despawnCoin();
  }

  // ---- bonus lives (IDEA-018: maze pickup, points milestone, perfect fright) ----

  /**
   * Central grant point for ALL THREE bonus-life triggers (maze pickup,
   * points milestone, perfect fright) — every trigger calls this rather than
   * incrementing `this.lives` directly, so the cap/HUD/sound side effects can
   * never drift out of sync between triggers. No-ops (no HUD update, no
   * sound) once lives are already at LIVES.max — a bonus life is simply
   * wasted at the cap, matching how coins have no upper bound but lives
   * deliberately do. Returns whether a life was actually granted, in case a
   * caller ever needs to know (none currently do, but mirrors the "boolean
   * outcome" shape profileStore's buy* operations use).
   */
  private grantLife(): boolean {
    if (this.lives >= LIVES.max) return false;
    this.lives++;
    this.hud.setLives(this.lives);
    this.sound.extraLife();
    return true;
  }

  /**
   * Banks any bonus lives newly earned since the last check, based on
   * cumulative run score crossing LIVES.milestonePoints thresholds — mirrors
   * maybeAwardCoinsFromScore exactly (same coinsDueFromScore helper, just a
   * different divisor and counter), including handling a single scoring
   * event crossing multiple thresholds at once. Called after every score
   * change (the same 3 eatAt call sites as maybeAwardCoinsFromScore).
   *
   * Crucially, `livesAwardedFromScore` always advances to `due`, even when
   * grantLife() is capped out and returns false — otherwise a milestone
   * reached while already at LIVES.max would silently re-fire (and instantly
   * grant a life) the moment the player's life count later drops back below
   * the cap, which would be a confusing "free life out of nowhere" rather
   * than a fresh milestone.
   */
  private maybeAwardLivesFromScore(): void {
    const due = coinsDueFromScore(this.score, LIVES.milestonePoints);
    if (due > this.livesAwardedFromScore) {
      const newlyDue = due - this.livesAwardedFromScore;
      this.livesAwardedFromScore = due;
      for (let i = 0; i < newlyDue; i++) this.grantLife();
    }
  }

  // ---- maze bonus-life pickup spawn (IDEA-018, mirrors maybeSpawnCoin) ----

  /**
   * BUGFIX (live-verified farming exploit — see maybeSpawnCoin's identical
   * writeup): the gate used to be `LIFE_THRESHOLDS.includes(eaten)`, which
   * re-fired on the SAME eaten-pellet tick a life pickup was just collected —
   * verified live oscillating the beagle over a golden bone drove lives
   * 3→5 (cap) within ~220ms, `eaten` never changing. Now gated by
   * `shouldFireThreshold` against a monotonic per-level index pointer
   * (`this.level.nextLifeThresholdIdx`, reset once per fresh level in
   * buildLevel — see LevelAssets), so LIFE_THRESHOLDS' single entry fires
   * exactly once per level no matter how many times the pickup is
   * spawned/eaten in between.
   */
  private maybeSpawnLife(): void {
    if (this.level.board.life) return;
    const eaten = this.level.startPelletCount - this.level.pellets.size;
    if (!shouldFireThreshold(eaten, LIFE_THRESHOLDS, this.level.nextLifeThresholdIdx)) return;

    // Excludes the beagle's current tile, the active fruit tile, AND the
    // active coin tile (unlike the coin spawn, which only avoids beagle +
    // fruit) — a golden bone should never double up with a maze coin sitting
    // on the same tile.
    const exclude: Vec2[] = [{ x: this.beagle.tx, y: this.beagle.ty }];
    if (this.fruitTile) exclude.push(this.fruitTile);
    if (this.coinTile) exclude.push(this.coinTile);
    const tile = this.pickRandomFreeTile(exclude);
    if (!tile) return; // level has no walkable tiles at all — shouldn't happen for a validated maze

    this.level.nextLifeThresholdIdx++;
    this.lifeTile = tile;
    this.lifeTimer = LIVES.pickupLifespanSeconds;
    spawnLife(this.level.board, this.rig.scene, tile.x, tile.y);
  }

  // ---- maze bonus-life lifespan countdown (IDEA-018, mirrors tickCoinLifespan) ----

  /**
   * Ticks the current life pickup's despawn countdown (only called from
   * updatePlay, i.e. only during actual "play" — never
   * ready/dying/levelclear/start, so it can't expire while the player isn't
   * even moving yet). Auto-despawns with no award once the timer runs out —
   * mirrors tickCoinLifespan exactly.
   */
  private tickLifeLifespan(dt: number): void {
    if (!this.lifeTile) return;
    this.lifeTimer -= dt;
    if (this.lifeTimer <= 0) this.despawnLife();
  }

  // ---- fright window (prototype triggerFright/e_reverse, line 485) ----

  private triggerFright(): void {
    // IDEA-013: activeModifiers.frightSeconds replaces the raw
    // TIMING.frightSeconds literal — CLASSIC_MODIFIERS.frightSeconds IS
    // TIMING.frightSeconds (see challenges.ts), so this is a byte-for-byte
    // no-op in classic mode.
    this.frightTimer = this.activeModifiers.frightSeconds;
    this.ghostEatChain = 0;
    this.ghosts.forEach(({ gh }) => {
      if (gh.state !== "eaten") {
        gh.state = "frightened";
        Game.reverseGhost(gh);
      }
    });
    this.effects.frightStarted();
    this.sound.frightStart();
  }

  private static reverseGhost(gh: Ghost): void {
    gh.e.dir = { x: -gh.e.dir.x, y: -gh.e.dir.y };
    gh.e.queued = { ...gh.e.dir };
  }

  // ---- fruit (prototype maybeSpawnFruit, line 491) ----

  /**
   * BUGFIX (live-verified farming exploit — this one's existed since v1.0,
   * unmasked by IDEA-018's live testing): the gate used to be
   * `FRUIT_THRESHOLDS.includes(eaten)`, which re-fires on the SAME
   * eaten-pellet tick a fruit at that threshold was just eaten (+100 points)
   * — eating fruit doesn't change `eaten`, so the very next maybeSpawnFruit()
   * call (same beagle arrival, right after eatAt's fruit-pickup branch) would
   * see `board.fruit` null again and the threshold still matching, and
   * respawn fruit the player could farm for repeated +100s by oscillating
   * over the tile. Now gated by `shouldFireThreshold` against a monotonic
   * per-level index pointer (`this.level.nextFruitThresholdIdx`, reset once
   * per fresh level in buildLevel — see LevelAssets), so each of
   * FRUIT_THRESHOLDS' 2 entries fires exactly once per level no matter how
   * many times fruit is spawned/eaten in between.
   */
  private maybeSpawnFruit(): void {
    if (this.level.board.fruit || !this.level.fruitTiles.length) return;
    const eaten = this.level.startPelletCount - this.level.pellets.size;
    if (shouldFireThreshold(eaten, FRUIT_THRESHOLDS, this.level.nextFruitThresholdIdx)) {
      const tile = this.level.fruitTiles[(Math.random() * this.level.fruitTiles.length) | 0];
      this.level.nextFruitThresholdIdx++;
      this.fruitTile = tile;
      spawnFruit(this.level.board, this.rig.scene, tile.x, tile.y);
    }
  }

  // ---- scatter/chase schedule (prototype updatePlay, lines 504-517) ----

  private advanceSchedule(dt: number): void {
    if (this.frightTimer <= 0) {
      this.modeClock += dt;
      const schedule = TIMING.schedule;
      if (this.scheduleIdx < schedule.length && this.modeClock >= schedule[this.scheduleIdx]) {
        this.modeClock = 0;
        this.scheduleIdx++;
        this.globalMode = this.globalMode === "scatter" ? "chase" : "scatter";
        this.ghosts.forEach(({ gh }) => {
          if (gh.state === "scatter" || gh.state === "chase") {
            gh.state = this.globalMode;
            Game.reverseGhost(gh);
          }
        });
      }
    } else {
      this.frightTimer -= dt;
      if (this.frightTimer <= 0) {
        this.ghosts.forEach(({ gh }) => { if (gh.state === "frightened") gh.state = this.globalMode; });
      }
    }
  }

  // ---- collisions (prototype checkCollisions, line 540) ----

  private checkCollisions(): void {
    const bw = entityWorld(this.beagle);
    for (const rig of this.ghosts) {
      if (rig.releaseDelay > 0) continue;
      const gh = rig.gh;
      const gw = entityWorld(gh.e);
      const d = Math.hypot(bw.x - gw.x, bw.z - gw.z);
      if (d < COLLISION_RADIUS) {
        if (gh.state === "frightened") {
          gh.state = "eaten";
          this.ghostEatChain++;
          this.score += SCORE.ghostBase * Math.pow(2, Math.min(this.ghostEatChain - 1, 3));
          this.hud.setScore(this.score);
          this.maybeAwardCoinsFromScore();
          this.maybeAwardLivesFromScore();
          this.effects.ghostEaten(gw.x, gw.z, SCORE.ghostBase * Math.pow(2, Math.min(this.ghostEatChain - 1, 3)));
          // 0-based within the fright window: ghostEatChain was just
          // incremented above, so the first ghost eaten has chain=1 here ->
          // pass chain-1=0, matching the exponent math on the two lines above.
          this.sound.eatGhost(this.ghostEatChain - 1);
          // IDEA-018: "perfect fright" bonus life — a chain reaching the
          // level's full ghost count within one fright window means every
          // ghost currently in play was eaten before it ran out.
          // IDEA-013: generalized from a hardcoded `=== 3` to
          // `=== activeModifiers.ghostCount` — classic's ghostCount is
          // always 3 (CLASSIC_MODIFIERS), so this is byte-for-byte identical
          // there, while a challenge level with 4 or 5 ghosts now requires
          // eating that many, not just 3, to earn the bonus. Checked with
          // `===` (not `>=`) so this can only ever fire once per fright
          // window — triggerFright() resets ghostEatChain to 0, so the chain
          // can't somehow reach the full count twice without a fresh bone in
          // between.
          if (this.ghostEatChain === this.activeModifiers.ghostCount) this.grantLife();
        } else if (gh.state !== "eaten") {
          this.beagleDies();
          return;
        }
      }
    }
  }

  private beagleDies(): void {
    this.mode = "dying";
    this.stateTimer = TIMING.deathSeconds;
    this.lives--;
    this.hud.setLives(this.lives);
    const bw = entityWorld(this.beagle);
    this.effects.beagleDied(bw.x, bw.z);
    this.sound.death();
  }

  private levelClear(): void {
    this.mode = "levelclear";
    this.stateTimer = TIMING.readySeconds;
    this.hud.showBanner("Map Cleared!");
    this.effects.levelCleared();
    this.sound.levelClear();
  }

  // ---- Challenge Mode level-complete panel (IDEA-013) ----

  /**
   * Fired once the "levelclear" banner's stateTimer runs out WHILE
   * gameKind==="challenge" (see the "levelclear" case in update() below) —
   * takes over from classic's plain timer-driven auto-advance
   * (`startLevel(this.levelIdx + 1)`) with a completion PANEL instead, since
   * challenge levels are discrete, named, curated levels rather than an
   * infinite looping lap counter. Persists progress first
   * (advanceChallengeProgress — a max-write, so replaying an already-
   * cleared level can never regress the unlock), then shows either:
   *   - the last level (challengeIdx === CHALLENGE_LEVEL_COUNT-1): an
   *     "ALL CLEAR" congratulations panel with only a Menu button (there is
   *     no "next level" to advance to).
   *   - any earlier level: the just-cleared level's own name plus the NEXT
   *     level's blurb (previews the upcoming twist), with a "Next level"
   *     button (advances to challengeIdx+1) and a "Menu" button (mirrors
   *     quitToMenu's classic-baseline reset).
   *
   * Sets mode to "over" (the existing idle mode gameOver() also uses) as its
   * very first move — CRITICAL: without this, mode would stay "levelclear"
   * with a now-negative stateTimer, and update()'s "levelclear" case would
   * re-enter this method (or call startLevel) on EVERY subsequent frame,
   * since its own `if (this.stateTimer <= 0)` check keeps re-passing forever
   * once stateTimer has gone negative. "over" is update()'s documented
   * do-nothing case (`// idle — the game-over panel's own buttons drive the
   * next transition`), which is exactly the semantics this panel needs too —
   * only the panel's own "Next level"/"Menu" buttons should ever move things
   * on from here.
   */
  private challengeLevelComplete(): void {
    this.mode = "over";
    advanceChallengeProgress(this.challengeIdx);

    const isLast = this.challengeIdx >= CHALLENGE_LEVEL_COUNT - 1;
    const clearedLevel = getChallengeLevel(this.challengeIdx);

    if (isLast) {
      const panel = this.hud.showPanel(
        '<div class="eyebrow">challenge complete</div>' +
        "<h1>All Clear! \u{1F3C6}</h1>" +
        `<p>You beat every challenge level, finishing with <strong>${clearedLevel.name}</strong>. The whole pack bows to the top dog.</p>` +
        '<div class="menu-actions">' +
        '<button id="challengeMenuBtn" class="btn-secondary">Menu</button>' +
        "</div>",
      );
      this.wireChallengeMenuButton(panel);
      return;
    }

    const nextLevel = getChallengeLevel(this.challengeIdx + 1);
    const panel = this.hud.showPanel(
      `<div class="eyebrow">${clearedLevel.name} cleared</div>` +
      `<h1>Level ${this.challengeIdx + 2}: ${nextLevel.name}</h1>` +
      `<p>${nextLevel.blurb}</p>` +
      '<div class="menu-actions">' +
      '<button id="nextChallengeBtn">Next level</button>' +
      '<button id="challengeMenuBtn" class="btn-secondary">Menu</button>' +
      "</div>",
    );
    const nextBtn = panel.querySelector<HTMLButtonElement>("#nextChallengeBtn");
    nextBtn?.addEventListener("click", () => {
      this.sound.resume();
      this.startChallenge(this.challengeIdx + 1);
    });
    this.wireChallengeMenuButton(panel);
  }

  /** Wires the "Menu" button shared by both challengeLevelComplete() panels
   *  (the mid-run "next level" panel and the final "ALL CLEAR" panel) —
   *  mirrors quitToMenu()/gameOver()'s gameOverMenuBtn handler exactly
   *  (classic-baseline reset + fresh score/lives + idle menu), factored out
   *  since both panel branches above need the identical handler. */
  private wireChallengeMenuButton(panel: HTMLElement): void {
    const menuBtn = panel.querySelector<HTMLButtonElement>("#challengeMenuBtn");
    menuBtn?.addEventListener("click", () => {
      this.gameKind = "classic";
      this.activeModifiers = CLASSIC_MODIFIERS;

      const fresh = createInitialGameState();
      this.score = fresh.score;
      this.lives = fresh.lives;
      this.coinsAwardedFromScore = 0;
      this.livesAwardedFromScore = 0;
      this.hud.setScore(this.score);
      this.hud.setLives(this.lives);
      this.resetActors();
      this.mode = "start";
      this.showMenu();
    });
  }

  private gameOver(): void {
    this.mode = "over";
    // IDEA-013: the "Play again" button restarts THE SAME challenge level
    // when the run that just ended was a challenge run, rather than always
    // jumping to classic level 0 — losing a challenge level shouldn't dump
    // the player back into classic. The panel copy/subtext stays identical
    // either way (only the button's own handler branches).
    const isChallenge = this.gameKind === "challenge";
    const panel = this.hud.showPanel(
      '<div class="eyebrow">final score</div>' +
      `<h1>${this.score}</h1>` +
      "<p>The pack got the better of the beagle this time.</p>" +
      '<div class="menu-actions">' +
      '<button id="againBtn">Play again</button>' +
      '<button id="gameOverMenuBtn" class="btn-secondary">Menu</button>' +
      "</div>",
    );
    const againBtn = panel.querySelector<HTMLButtonElement>("#againBtn");
    againBtn?.addEventListener("click", () => {
      this.sound.resume();
      if (isChallenge) {
        // startChallenge() itself resets score/lives/coinsAwardedFromScore/
        // livesAwardedFromScore (see its own doc comment) — no need to
        // duplicate that here.
        this.startChallenge(this.challengeIdx);
        return;
      }
      const fresh = createInitialGameState();
      this.score = fresh.score;
      this.lives = fresh.lives;
      this.coinsAwardedFromScore = 0;
      this.livesAwardedFromScore = 0;
      this.hud.setScore(this.score);
      this.hud.setLives(this.lives);
      this.startLevel(0);
    });

    const gameOverMenuBtn = panel.querySelector<HTMLButtonElement>("#gameOverMenuBtn");
    // IDEA-021: from game over, "Menu" returns to the idle menu instead of
    // starting a fresh run. The run just ended (mode is already "over", no
    // stateTimer pending, no fright/collision state to worry about), so this
    // is simpler than the mid-run quit path (quitToMenu) below: just reset
    // actors/score/lives to fresh-looking idle values and show the menu.
    // Keeps the CURRENT level as the idle backdrop (matches boot's own
    // preview behavior — buildLevel is not re-run) rather than rebuilding
    // level 0, since a game over can happen on any level and re-showing that
    // same level's board underneath the menu is visually seamless.
    //
    // IDEA-013: also resets gameKind/activeModifiers to the classic baseline
    // (mirrors quitToMenu()) — from game over, "Menu" must return to the
    // SAME classic-baseline idle preview quitToMenu uses, not leave a just-
    // ended challenge run's extra ghosts/speed active behind the menu.
    gameOverMenuBtn?.addEventListener("click", () => {
      this.gameKind = "classic";
      this.activeModifiers = CLASSIC_MODIFIERS;

      const fresh = createInitialGameState();
      this.score = fresh.score;
      this.lives = fresh.lives;
      this.coinsAwardedFromScore = 0;
      this.livesAwardedFromScore = 0;
      this.hud.setScore(this.score);
      this.hud.setLives(this.lives);
      this.resetActors();
      this.mode = "start";
      this.showMenu();
    });
  }

  // ---- quit-to-menu (IDEA-021: the 🏠 HUD button) ----

  /** Wires the HUD's 🏠 "back to menu" button. Owned here (not shop.ts/hud.ts)
   *  since it needs direct access to the run-abandoning state reset below. */
  private attachHomeButton(): () => void {
    const btn = document.getElementById("homeBtn") as HTMLButtonElement | null;
    if (!btn) throw new Error("attachHomeButton: missing #homeBtn — check index.html");
    const onClick = (): void => this.quitToMenu();
    btn.addEventListener("click", onClick);
    return () => btn.removeEventListener("click", onClick);
  }

  /**
   * Abandons the run in progress (any mode except "start", where it's a
   * no-op — the menu is already showing) and returns to the idle menu, the
   * same place game over's "Menu" button lands. The abandoned run's score is
   * discarded; coins already banked persist (profileStore, untouched here) —
   * that's the intended design (coins are a separate wallet from score).
   *
   * Switching `mode` away from "dying"/"levelclear"/"ready" is sufficient to
   * neutralize their pending `stateTimer` countdowns: update()'s switch only
   * reads/advances stateTimer for the mode that's CURRENTLY active, so once
   * mode is "start" nothing will ever check that stale timer again (see
   * update()'s per-mode cases — none of them run once mode !== their case).
   *
   * resetActors() (same helper startLevel/death-respawn use) rebuilds the
   * ghosts fresh at "scatter" and clears frightTimer/ghostEatChain/
   * modeClock/scheduleIdx/fruit/coin/life (IDEA-018), so quitting mid-fright
   * (or mid-chase, mid-anything) can never leak stale state into the idle
   * preview — there's nothing fright-specific left to reset beyond what
   * resetActors already does.
   *
   * One thing resetActors() does NOT touch: the beagle MESH's own transient
   * scale/rotation from a mid-flight "dying" spin-shrink (setBeagleDeath —
   * resetActors only rebuilds the logic Entity, not the mesh). The normal
   * "dying" completion path calls resetBeagleScale() before resetActors() for
   * exactly this reason (see the "dying" case in update()); quitting mid-death
   * must do the same so the idle preview never shows a shrunk/mid-spin beagle.
   * Harmless no-op if death wasn't in progress (scale/rotation are already at
   * rest, so setScalar to the same value is a no-op).
   */
  private quitToMenu(): void {
    if (this.mode === "start") return;

    this.hud.hideCenter();
    resetBeagleScale(this.beagleMesh);

    // IDEA-013: quitting always returns to the CLASSIC baseline — the idle
    // menu's preview (posed via resetActors() below, which reads
    // activeModifiers) must never keep showing a challenge level's extra
    // ghosts/speed after the player has backed out of a challenge run.
    this.gameKind = "classic";
    this.activeModifiers = CLASSIC_MODIFIERS;

    const fresh = createInitialGameState();
    this.score = fresh.score;
    this.lives = fresh.lives;
    this.coinsAwardedFromScore = 0;
    this.livesAwardedFromScore = 0;
    this.hud.setScore(this.score);
    this.hud.setLives(this.lives);

    this.resetActors();
    this.mode = "start";
    this.showMenu();
  }

  // ---- per-mode update (prototype main loop, lines 662-691) ----

  private updatePlay(dt: number): void {
    this.advanceSchedule(dt);
    this.tickCoinLifespan(dt);
    this.tickLifeLifespan(dt);

    stepEntity(this.beagle, dt, this.level.grid, false, this.onBeagleArrive);
    syncToEntity(this.beagleMesh, this.beagle, dt);

    this.ghosts.forEach((rig) => {
      if (rig.releaseDelay > 0) {
        rig.releaseDelay -= dt;
        syncToEntity(rig.mesh, rig.gh.e, dt);
        applyGhostState(rig.mesh, rig.gh.state, rig.gh.e.dir);
        return;
      }
      const gh = rig.gh;
      const spawn = this.level.ghostSpawn;
      // IDEA-013: every tier scaled by activeModifiers.ghostSpeedMult (1 in
      // classic — byte-for-byte no-op) so a fast challenge level's eaten/
      // frightened ghosts stay just as proportionally fast/slow as its
      // normal-state ghosts, keeping the whole speed relationship coherent
      // rather than only the "normal" tier scaling up.
      const ghostSpeedMult = this.activeModifiers.ghostSpeedMult;
      gh.e.speed = (gh.state === "eaten" ? SPEEDS.eaten : gh.state === "frightened" ? SPEEDS.frightened : SPEEDS.ghost) * ghostSpeedMult;
      stepEntity(gh.e, dt, this.level.grid, true, (e) => {
        if (gh.state === "eaten" && e.tx === spawn.x && e.ty === spawn.y) {
          gh.state = this.globalMode; // respawned to current global mode
        }
        chooseGhostDir(gh, {
          grid: this.level.grid,
          beagle: this.beagle,
          globalMode: this.globalMode,
          ghostSpawn: spawn,
        });
      });
      syncToEntity(rig.mesh, gh.e, dt);
      applyGhostState(rig.mesh, gh.state, gh.e.dir);
    });

    spinDecor(this.level.board, dt);
    this.checkCollisions();
  }

  /** Poses everyone without stepping them (ready/levelclear countdowns, dying's ghosts). */
  private syncAllPosed(dt: number): void {
    syncToEntity(this.beagleMesh, this.beagle, dt);
    this.ghosts.forEach((rig) => {
      syncToEntity(rig.mesh, rig.gh.e, dt);
      applyGhostState(rig.mesh, rig.gh.state, rig.gh.e.dir);
    });
    spinDecor(this.level.board, dt);
  }

  private update(dt: number): void {
    this.effects.update(dt);
    switch (this.mode) {
      case "start": {
        // IDEA-021 v2: the game scene/HUD are hidden entirely behind the
        // full-screen menu now, so posing the game actors here is harmless
        // busywork rather than a visible "preview" — kept anyway (cheap,
        // avoids a discontinuity if mode flips back to "ready" mid-frame)
        // since the game scene simply isn't rendered while mode==="start"
        // (see tick() below, which renders menuScene instead). Never counts
        // down or transitions on its own — the Play button's click handler
        // is the only way out (it calls startLevel(0), which sets
        // mode="ready" with a real stateTimer). Deliberately does NOT touch
        // stateTimer. The menu scene's own idle animation is advanced
        // separately, from tick(), regardless of `mode`.
        this.syncAllPosed(dt);
        break;
      }
      case "ready": {
        this.syncAllPosed(dt);
        this.stateTimer -= dt;
        if (this.stateTimer <= 0) {
          this.hud.hideCenter();
          this.mode = "play";
          this.sound.readyGo();
        }
        break;
      }
      case "play": {
        this.updatePlay(dt);
        break;
      }
      case "dying": {
        const k = Math.max(Math.min(this.stateTimer / TIMING.deathSeconds, 1), 0);
        setBeagleDeath(this.beagleMesh, k, dt);
        this.ghosts.forEach((rig) => {
          syncToEntity(rig.mesh, rig.gh.e, dt);
          applyGhostState(rig.mesh, rig.gh.state, rig.gh.e.dir);
        });
        this.stateTimer -= dt;
        if (this.stateTimer <= 0) {
          resetBeagleScale(this.beagleMesh);
          if (this.lives <= 0) {
            this.gameOver();
          } else {
            this.resetActors();
            this.mode = "ready";
            this.stateTimer = TIMING.deathSeconds;
            this.hud.showBanner("Ready!");
          }
        }
        break;
      }
      case "levelclear": {
        this.syncAllPosed(dt);
        this.stateTimer -= dt;
        if (this.stateTimer <= 0) {
          // IDEA-013: challenge levels show a completion panel (named level,
          // next-level blurb, "Next level"/"Menu" buttons — or an "ALL
          // CLEAR" panel after the last level) instead of classic's plain
          // auto-advance to the next map. Classic's own branch
          // (`startLevel(this.levelIdx + 1)`) is completely unchanged.
          if (this.gameKind === "challenge") this.challengeLevelComplete();
          else this.startLevel(this.levelIdx + 1);
        }
        break;
      }
      case "over":
        // idle — the game-over panel's "Play again" button drives the next transition.
        break;
    }
  }

  private tick = (now: number): void => {
    const dt = Math.min((now - this.clock.last) / 1000, 0.05);
    this.clock.last = now;

    // IDEA-023 (shop v2): while the full-screen shop page is up, FREEZE
    // gameplay entirely — skip this.update(dt) so play/ready/dying/
    // levelclear timers and the beagle/ghosts don't advance underneath the
    // shop, and render the shop's own live hero-preview scene instead of
    // `rig`/`menuScene`. Ordered BEFORE the mode==="start" branch below so
    // opening the shop from the main menu (where mode is already "start")
    // renders the shop, not the menu, and so a mid-run shop visit correctly
    // freezes play instead of falling through to the normal game render.
    // Resumes exactly where the player left off on close: nothing here
    // mutates any game-state timer, it just doesn't advance it for as long
    // as shopOpen stays true.
    if (this.shopOpen) {
      this.shopScene.update(dt);
      this.rig.renderer.render(this.shopScene.scene, this.shopScene.camera);
      this.rafHandle = requestAnimationFrame(this.tick);
      return;
    }

    this.update(dt);

    // IDEA-021 v2: while the full-screen menu is up, render the menu's own
    // scene/camera (the live beagle showcase) instead of the game rig — the
    // maze/HUD are hidden (see showMenu()) and shouldn't even be drawn.
    if (this.mode === "start") {
      this.menuScene.update(dt);
      this.rig.renderer.render(this.menuScene.scene, this.menuScene.camera);
      this.rafHandle = requestAnimationFrame(this.tick);
      return;
    }

    // Camera shake: a transient offset added right before render and removed
    // right after, so resize()'s own base camera.position is never corrupted
    // (see render/effects.ts's shakeOffset doc comment).
    const shake = this.effects.shakeOffset;
    this.rig.camera.position.x += shake.x;
    this.rig.camera.position.y += shake.y;
    this.rig.camera.position.z += shake.z;
    this.rig.renderer.render(this.rig.scene, this.rig.camera);
    this.rig.camera.position.x -= shake.x;
    this.rig.camera.position.y -= shake.y;
    this.rig.camera.position.z -= shake.z;

    this.rafHandle = requestAnimationFrame(this.tick);
  };
}
