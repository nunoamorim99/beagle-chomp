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
import { SPEEDS, SCORE, TIMING, COLORS } from "./config";
import { type GameMode, createInitialGameState } from "./state";
import { makeEntity, stepEntity, entityWorld, type Entity } from "./movement";
import { chooseGhostDir, type Ghost, type GlobalMode } from "./ghostAI";
import { attachKeyboard } from "../input/keyboard";
import { attachTouch } from "../input/touch";
import { createScene, type SceneRig } from "../render/scene";
import { createEffects, type Effects } from "../render/effects";
import { buildBoard, eatPellet, spawnFruit, clearFruit, spinDecor, type Board } from "../render/board";
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
import { attachSkinButton, attachEnemyButton } from "../ui/skin";
import { initProfileFromStorage } from "./profileStore";
import { getEquippedEnemySkinId } from "./cosmetics";

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
  beagleSpawn: Vec2;
  ghostSpawn: Vec2;
}

export class Game {
  private readonly rig: SceneRig;
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
  private readonly detachSkinButton: () => void;
  private readonly detachEnemyButton: () => void;

  private ghosts: GhostRig[] = [];

  private score = 0;
  private lives = 0;
  private levelIdx = 0;

  // Boots idle on the Start panel ("start" — see state.ts for why this is
  // distinct from "ready") and only ever leaves it via the Start button's
  // click handler calling startLevel(0).
  private mode: GameMode = "start";
  private stateTimer = 0;

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

  constructor(canvas: HTMLCanvasElement) {
    this.rig = createScene(canvas);
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

    // Temporary skin-cycle button (placeholder until the shop UI, IDEA-012,
    // lands) — see src/ui/skin.ts's doc comment for the layering rationale.
    // Lives alongside attachMuteButton with the same lifecycle (detached in
    // stop() below); resetActors() rebuilds ghosts but reuses this.beagleMesh,
    // so the equipped skin persists naturally across level resets/deaths.
    this.detachSkinButton = attachSkinButton(document.body, (skin) => {
      applyBeagleSkin(this.beagleMesh, skin);
    });

    // Temporary enemy-skin-cycle button (placeholder until the shop UI,
    // IDEA-012, lands), mirroring attachSkinButton above — see
    // src/ui/skin.ts's attachEnemyButton doc comment. Unlike the beagle
    // (recolored in place), enemy skins swap the creature's FORM, so the
    // onChange handler rebuilds the 3 enemy meshes in place rather than
    // recoloring existing materials (see rebuildEnemySkins below).
    this.detachEnemyButton = attachEnemyButton(document.body, () => {
      this.rebuildEnemySkins();
    });

    this.detachKeyboard = attachKeyboard((d) => { this.beagle.queued = d; });
    this.detachTouch = attachTouch(canvas, (d) => { this.beagle.queued = d; });

    const initial = createInitialGameState();
    this.score = initial.score;
    this.lives = initial.lives;
    this.hud.setScore(this.score);
    this.hud.setLives(this.lives);
    this.hud.setLevel("1");

    // Pose the beagle + spawn the ghosts for the idle preview behind the
    // start panel (prototype boot never calls resetActors before Start, but
    // its ghosts array starts empty and the beagle mesh sits at its default
    // transform — posing ours via resetActors gives an equivalent, slightly
    // livelier preview). Nothing steps while mode==="start" (see the "start"
    // case in update()), so this is purely a static pose until Start is clicked.
    this.resetActors();

    this.showStartPanel();
  }

  private showStartPanel(): void {
    const panel = this.hud.showPanel(
      '<div class="eyebrow">three.js &middot; maze chase</div>' +
      "<h1>Beagle Chomp</h1>" +
      "<p>Guide the beagle around the maze and munch every biscuit to clear the map. " +
      'Chomp a <b style="color:#fff">bone</b> and the ghosts turn scared &mdash; eat them ' +
      "for big points before they recover.</p>" +
      '<div class="keys"><b>Arrow keys</b> or <b>WASD</b> to move &middot; avoid the ghosts</div>' +
      '<button id="startBtn">Start</button>',
    );
    const startBtn = panel.querySelector<HTMLButtonElement>("#startBtn");
    startBtn?.addEventListener("click", () => {
      // The Start click is a guaranteed user gesture, so this is the primary
      // place audio unlocks (the first-input listeners in the constructor are
      // just a belt-and-suspenders fallback for anyone who somehow interacts
      // before clicking Start).
      this.sound.resume();
      const fresh = createInitialGameState();
      this.score = fresh.score;
      this.lives = fresh.lives;
      this.hud.setScore(this.score);
      this.hud.setLives(this.lives);
      this.startLevel(0);
    });
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
    let beagleSpawn: Vec2 = { x: 0, y: 0 };
    let ghostSpawn: Vec2 = { x: 0, y: 0 };

    grid.cells.forEach((row, y) => row.forEach((c, x) => {
      if (c === "." || c === "o") pellets.add(`${x},${y}`);
      else if (c === "F") fruitTiles.push({ x, y });
      else if (c === "P") beagleSpawn = { x, y };
      else if (c === "G") ghostSpawn = { x, y };
    }));

    return { grid, board, pellets, startPelletCount: pellets.size, fruitTiles, beagleSpawn, ghostSpawn };
  }

  /** Removes every mesh owned by the previous level's board from the scene (walls, floor, remaining pellets, fruit, hedge decor) so buildLevel's replacement never leaks. */
  private disposeLevel(level: LevelAssets): void {
    this.rig.scene.remove(level.board.walls, level.board.floor);
    level.board.pelletMeshes.forEach((p) => p.mesh.removeFromParent());
    if (level.board.fruit) this.rig.scene.remove(level.board.fruit);
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
    this.detachSkinButton();
    this.detachEnemyButton();
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
      this.sound.fruit();
    }
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

  private maybeSpawnFruit(): void {
    if (this.level.board.fruit || !this.level.fruitTiles.length) return;
    const eaten = this.level.startPelletCount - this.level.pellets.size;
    if (FRUIT_THRESHOLDS.includes(eaten as (typeof FRUIT_THRESHOLDS)[number])) {
      const tile = this.level.fruitTiles[(Math.random() * this.level.fruitTiles.length) | 0];
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
          this.effects.ghostEaten(gw.x, gw.z, SCORE.ghostBase * Math.pow(2, Math.min(this.ghostEatChain - 1, 3)));
          // 0-based within the fright window: ghostEatChain was just
          // incremented above, so the first ghost eaten has chain=1 here ->
          // pass chain-1=0, matching the exponent math on the two lines above.
          this.sound.eatGhost(this.ghostEatChain - 1);
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
      '<button id="againBtn">Play again</button>',
    );
    const againBtn = panel.querySelector<HTMLButtonElement>("#againBtn");
    againBtn?.addEventListener("click", () => {
      this.sound.resume();
      const fresh = createInitialGameState();
      this.score = fresh.score;
      this.lives = fresh.lives;
      this.hud.setScore(this.score);
      this.hud.setLives(this.lives);
      this.startLevel(0);
    });
  }

  // ---- per-mode update (prototype main loop, lines 662-691) ----

  private updatePlay(dt: number): void {
    this.advanceSchedule(dt);

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
        // Idle preview behind the Start panel: pose only, never counts down
        // or transitions on its own — the Start button's click handler is
        // the only way out (it calls startLevel(0), which sets mode="ready"
        // with a real stateTimer). Deliberately does NOT touch stateTimer.
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

    this.update(dt);

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
