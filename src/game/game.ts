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
import { initProfileFromStorage, getCoins, addCoins } from "./profileStore";
import { getEquippedEnemySkinId, getBeagleSkin } from "./cosmetics";

// Scatter-corner targets per ghost personality (prototype section 7,
// GHOST_DEFS): rose/chaser -> top-right, teal/ambusher -> top-left,
// amber/clyde -> bottom-left.
const GHOST_DEFS = [
  { color: COLORS.ghostRose, corner: { x: COLS - 2, y: 1 }, kind: "chaser" },
  { color: COLORS.ghostTeal, corner: { x: 1, y: 1 }, kind: "ambusher" },
  { color: COLORS.ghostAmber, corner: { x: 1, y: ROWS - 2 }, kind: "clyde" },
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

  private ghosts: GhostRig[] = [];

  private score = 0;
  private lives = 0;
  private levelIdx = 0;

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
    this.beagle = makeEntity(this.level.beagleSpawn.x, this.level.beagleSpawn.y, SPEEDS.beagle);

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
   * startLevel) are responsible for removing the old ones first so nothing
   * leaks across levels.
   */
  private buildLevel(idx: number): LevelAssets {
    const grid = new Grid(MAZES[idx % MAZE_COUNT]);
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
    this.shop.detach();
    this.menuScene.dispose();
    this.shopScene.dispose();
  }

  // ---- level flow (prototype startLevel, line 419) ----

  private startLevel(idx: number): void {
    this.disposeLevel(this.level);
    this.level = this.buildLevel(idx);

    this.levelIdx = idx;
    const mapNumber = (idx % MAZE_COUNT) + 1;
    const lap = idx >= MAZE_COUNT ? ` ·${Math.floor(idx / MAZE_COUNT) + 1}` : "";
    this.hud.setLevel(`${mapNumber}${lap}`);

    this.resetActors();
    this.mode = "ready";
    this.stateTimer = TIMING.readySeconds;
    this.hud.showBanner("Ready!");
  }

  // ---- actor (beagle + ghosts) reset (prototype resetActors, line 404) ----

  private resetActors(): void {
    this.beagle = makeEntity(this.level.beagleSpawn.x, this.level.beagleSpawn.y, SPEEDS.beagle);
    this.beagle.dir = { x: 0, y: 0 };
    this.beagle.queued = { x: -1, y: 0 };
    this.beagle.facing = { x: 0, y: 1 };

    // Remove old ghost meshes before rebuilding fresh ones (prototype 409:
    // ghosts.forEach(gh => scene.remove(gh.mesh))) so nothing leaks per level
    // or per death-reset.
    this.ghosts.forEach((rig) => this.rig.scene.remove(rig.mesh));
    const spawn = this.level.ghostSpawn;
    const enemySkinId = getEquippedEnemySkinId();
    this.ghosts = GHOST_DEFS.map((def, i) => {
      const mesh = makeEnemy(enemySkinId, def.color);
      this.rig.scene.add(mesh);
      const e = makeEntity(spawn.x, spawn.y, SPEEDS.ghost);
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
    this.frightTimer = TIMING.frightSeconds;
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
          // IDEA-018: "perfect fright" bonus life — there are always exactly
          // 3 ghosts (GHOST_DEFS), so a chain reaching 3 within one fright
          // window means all three were eaten before it ran out. Checked with
          // `=== 3` (not `>=`) so this can only ever fire once per fright
          // window — triggerFright() resets ghostEatChain to 0, so the chain
          // can't somehow reach 3 twice without a fresh bone in between.
          if (this.ghostEatChain === 3) this.grantLife();
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

  private gameOver(): void {
    this.mode = "over";
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
    gameOverMenuBtn?.addEventListener("click", () => {
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
      gh.e.speed = gh.state === "eaten" ? SPEEDS.eaten : gh.state === "frightened" ? SPEEDS.frightened : SPEEDS.ghost;
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
        if (this.stateTimer <= 0) this.startLevel(this.levelIdx + 1);
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
