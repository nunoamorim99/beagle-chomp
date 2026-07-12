// OWNER: board & themes editor (IDEA-027, dev-only).
// The lil-gui control pane for BOARD mode: a base-theme picker (loads a deep
// working COPY of one of the 6 MAZE_THEMES — never mutates the registry
// object itself, see main.ts's loadBaseTheme) plus one folder per logical
// palette slot (Atmosphere / Walls / Floor / Biscuits / Blooms / Specks) —
// this is the "board slots" the tree pane (boardTree.ts) lists, and
// selecting a tree row opens/scrolls to the matching folder here (see
// focusSlot). Color fields follow inspector.ts's established `{ color:
// "#hexstring" }` proxy pattern (lil-gui's addColor also accepts a bare
// number property, but the codebase's one existing convention already reads
// via `.getHexString()` — matching it keeps the two inspectors consistent
// rather than introducing a second color-binding idiom).
//
// Two different LIVE-APPLY paths, per the brief:
//   - Walls/Floor/Biscuits/Atmosphere: mutate the shared materials/lights
//     directly (via `ctx.materials`/`ctx.lights`, handles main.ts hands us
//     off the live board/atmosphere) — cheap, no decor rebuild.
//   - Blooms/Specks: these change the SET of decorated tiles (not just a
//     color), so every change calls `ctx.onDecorChange()`, which re-runs
//     applyBoardTheme with the current working theme (rebuilds hedgeDecor).
//
// Same lil-gui gotchas this codebase has already hit apply here too:
//   - No explicit `step` on any control whose range is symmetric around a
//     value that isn't the range MIN (lil-gui anchors its step grid at the
//     range min) — none of our sliders need a step tighter than the
//     default, so this is avoidance-by-omission, but documented here so a
//     future intensity/chance slider addition remembers the trap.
//   - lil-gui swallows keydown on a focused widget (text/slider) — Ctrl+Z
//     while a color picker or number field has focus needs a blur first;
//     board mode has no undo (see main.ts's note), so this doesn't bite
//     TODAY, but if undo is added later, follow inspector.ts's blur-before-
//     history pattern in main.ts's keydown handler.
import GUI from "lil-gui";
import * as THREE from "three";
import { type BoardSlotId } from "./boardTree";
import { type WorkingTheme } from "./boardCodegen";
import { MAZE_THEMES } from "../game/themes";

const MAX_BLOOM_COLORS = 4;
const DEFAULT_NEW_BLOOM_COLOR = 0xffffff;

export interface BoardMaterialHandles {
  wall: THREE.MeshStandardMaterial;
  floor: THREE.MeshStandardMaterial;
  biscuit: THREE.MeshStandardMaterial;
}

export interface BoardLightHandles {
  hemi: THREE.HemisphereLight;
  sun: THREE.DirectionalLight;
  rim: THREE.DirectionalLight;
}

export interface BoardInspectorCallbacks {
  /** Base theme dropdown changed — id of the MAZE_THEMES entry to load a
   *  fresh working copy from (main.ts owns the deep-copy + full rebuild). */
  onBaseTheme(id: string): void;
  /** bg/backdropTop changed — main.ts applies to the boardStage + scene
   *  background color (no material handle for these two; boardStage owns
   *  them). */
  onAtmosphereBg(): void;
  /** Any bloom/speck field changed (color, add/remove, emissive, chance) —
   *  triggers applyBoardTheme (decor rebuild). */
  onDecorChange(): void;
  /** id/name/price text/number fields changed — no live visual effect, just
   *  keeps the "Copy theme code" output in sync (codegen reads the working
   *  theme directly, so this callback only exists for symmetry/logging). */
  onMetaChange(): void;
  /** Writes the formatted theme entry to the clipboard — returns a promise
   *  the button flashes success/failure off of (matches main.ts's copyBtn/
   *  copyFileBtn flash() pattern, scoped here to a lil-gui Controller's own
   *  .name() instead of a plain <button> element). */
  onCopyCode(): Promise<void>;
}

export interface BoardInspector {
  /** Rebuilds every folder from `theme` — called after a base-theme load
   *  (main.ts holds a fresh working copy + fresh material/light handles by
   *  then, since a new base theme means a full board rebuild). `baseThemeId`
   *  is the registry id the working copy was cloned FROM (main.ts's own
   *  record, not re-derived from `theme.id` — the working id is a free-text
   *  field the user may have already changed while authoring a new theme),
   *  purely so the base-theme dropdown reflects what's actually loaded. */
  setTheme(
    theme: WorkingTheme,
    baseThemeId: string,
    materials: BoardMaterialHandles,
    lights: BoardLightHandles,
  ): void;
  /** Opens (and scrolls to) the folder for a tree-pane slot selection. */
  focusSlot(id: BoardSlotId): void;
  destroy(): void;
}

/** A `{ color: "#hex" }` proxy bound to a get/set pair on a PLAIN number
 *  field (a palette slot with no live THREE.Color counterpart to bind
 *  directly, e.g. bg/backdropTop/speckColor — see colorProxy below for the
 *  THREE.Color-backed sibling used for material/light color properties). */
function hexProxy(get: () => number, set: (v: number) => void): { color: string } {
  return {
    get color(): string {
      return `#${get().toString(16).padStart(6, "0")}`;
    },
    set color(v: string) {
      set(new THREE.Color(v).getHex());
    },
  };
}

/** Builds a `{ color: "#hex" }` proxy bound to one axis of a THREE.Color
 *  instance (material.color / light.color / light.groundColor) — the exact
 *  shape inspector.ts's material folder already uses, generalized here since
 *  board mode has many more color slots than one material. */
function colorProxy(c: THREE.Color): { color: string } {
  return {
    get color(): string {
      return `#${c.getHexString()}`;
    },
    set color(v: string) {
      c.set(v);
    },
  };
}

export function createBoardInspector(
  container: HTMLElement,
  cb: BoardInspectorCallbacks,
): BoardInspector {
  const gui = new GUI({ container, title: "Board & Themes" });

  const baseThemeOptions: Record<string, string> = {};
  for (const t of MAZE_THEMES) baseThemeOptions[t.name] = t.id;
  const baseState = { baseThemeId: MAZE_THEMES[0].id };
  const baseThemeCtrl = gui
    .add(baseState, "baseThemeId", baseThemeOptions)
    .name("base theme")
    .onChange((id: string) => cb.onBaseTheme(id));

  // --- meta (id/name/price) — always present. Each controller's `.object`/
  // `.property` are rebound to the CURRENT working theme by setTheme below
  // (see idCtrl/nameCtrl/priceCtrl there) — lil-gui's own setValue() already
  // writes `object[property] = value` before calling onChange (see
  // Controller.setValue in lil-gui's source), so these onChange handlers
  // exist ONLY to notify main.ts (onMetaChange), not to duplicate the write:
  // there is no separate "current theme" variable to keep in sync here.
  const metaFolder = gui.addFolder("Theme identity");
  metaFolder.add({ id: "" }, "id").name("id").onChange(() => cb.onMetaChange());
  // (name/price added right after id below — keeping the same `.controllers`
  // array reference so setTheme can re-bind all three by fixed index without
  // re-adding controllers on every theme load.)
  const metaCtrls = metaFolder.controllers;
  metaFolder.add({ name: "" }, "name").onChange(() => cb.onMetaChange());
  metaFolder.add({ price: 0 }, "price", 0, 999, 1).onChange(() => cb.onMetaChange());

  const COPY_LABEL = "Copy theme code 📋";
  const copyCtrl = gui
    .add({ copy: () => {
      void cb
        .onCopyCode()
        .then(() => flashCopyLabel("Copied ✓ paste into MAZE_THEMES"))
        .catch(() => flashCopyLabel("Copy failed — clipboard blocked"));
    } }, "copy")
    .name(COPY_LABEL);
  // TEST-SUPPORT ONLY: the button's own LABEL TEXT is transient (flashes to
  // "Copied ✓ ..." for 1.6s after every click — see flashCopyLabel below), so
  // a Playwright suite clicking it twice in quick succession (spot-checking
  // two different edits back to back) can't reliably find it by visible text
  // alone. A stable data-testid on the real DOM button gives
  // scripts/test-editor-board.ts a click target that survives the flash —
  // harmless to players (never rendered, never styled off).
  copyCtrl.domElement.dataset.testid = "copy-theme-code";

  function flashCopyLabel(message: string): void {
    copyCtrl.name(message);
    window.setTimeout(() => copyCtrl.name(COPY_LABEL), 1600);
  }

  const folders: Partial<Record<BoardSlotId, GUI>> = {};

  function clearSlotFolders(): void {
    for (const key of Object.keys(folders) as BoardSlotId[]) {
      folders[key]?.destroy();
      delete folders[key];
    }
  }

  function buildAtmosphereFolder(theme: WorkingTheme, lights: BoardLightHandles): void {
    const folder = gui.addFolder("Atmosphere");
    folders.atmosphere = folder;
    const p = theme.palette;

    folder
      .addColor(hexProxy(() => p.bg, (v) => { p.bg = v; }), "color")
      .name("sky (bg)")
      .onChange(() => cb.onAtmosphereBg());
    folder
      .addColor(hexProxy(() => p.backdropTop, (v) => { p.backdropTop = v; }), "color")
      .name("backdrop top")
      .onChange(() => cb.onAtmosphereBg());

    folder
      .addColor(colorProxy(lights.hemi.color), "color")
      .name("hemi sky")
      .onChange((v: string) => { p.hemiSky = new THREE.Color(v).getHex(); });
    folder
      .addColor(colorProxy(lights.hemi.groundColor), "color")
      .name("hemi ground")
      .onChange((v: string) => { p.hemiGround = new THREE.Color(v).getHex(); });
    folder
      .add(lights.hemi, "intensity", 0, 2, 0.01)
      .name("hemi intensity")
      .onChange((v: number) => { p.hemiIntensity = v; });

    folder
      .addColor(colorProxy(lights.sun.color), "color")
      .name("sun color")
      .onChange((v: string) => { p.sunColor = new THREE.Color(v).getHex(); });
    folder
      .add(lights.sun, "intensity", 0, 2, 0.01)
      .name("sun intensity")
      .onChange((v: number) => { p.sunIntensity = v; });

    folder
      .addColor(colorProxy(lights.rim.color), "color")
      .name("rim color")
      .onChange((v: string) => { p.rimColor = new THREE.Color(v).getHex(); });
    folder
      .add(lights.rim, "intensity", 0, 2, 0.01)
      .name("rim intensity")
      .onChange((v: number) => { p.rimIntensity = v; });
  }

  function buildWallsFolder(theme: WorkingTheme, wall: THREE.MeshStandardMaterial): void {
    const folder = gui.addFolder("Walls");
    folders.walls = folder;
    const p = theme.palette;
    folder
      .addColor(colorProxy(wall.color), "color")
      .name("wall color")
      .onChange((v: string) => { p.wall = new THREE.Color(v).getHex(); });
    folder
      .addColor(colorProxy(wall.emissive), "color")
      .name("wall emissive")
      .onChange((v: string) => { p.wallEmissive = new THREE.Color(v).getHex(); });
    folder
      .add(wall, "emissiveIntensity", 0, 2, 0.01)
      .name("emissive intensity")
      .onChange((v: number) => { p.wallEmissiveIntensity = v; });
  }

  function buildFloorFolder(theme: WorkingTheme, floor: THREE.MeshStandardMaterial): void {
    const folder = gui.addFolder("Floor");
    folders.floor = folder;
    const p = theme.palette;
    folder
      .addColor(colorProxy(floor.color), "color")
      .name("floor color")
      .onChange((v: string) => { p.floor = new THREE.Color(v).getHex(); });
    folder
      .addColor(colorProxy(floor.emissive), "color")
      .name("floor emissive")
      .onChange((v: string) => { p.floorEmissive = new THREE.Color(v).getHex(); });
    folder
      .add(floor, "emissiveIntensity", 0, 2, 0.01)
      .name("emissive intensity")
      .onChange((v: number) => { p.floorEmissiveIntensity = v; });
  }

  function buildBiscuitsFolder(theme: WorkingTheme, biscuit: THREE.MeshStandardMaterial): void {
    const folder = gui.addFolder("Biscuits");
    folders.biscuits = folder;
    const p = theme.palette;
    folder
      .addColor(colorProxy(biscuit.color), "color")
      .name("biscuit color")
      .onChange((v: string) => { p.biscuit = new THREE.Color(v).getHex(); });
    folder
      .addColor(colorProxy(biscuit.emissive), "color")
      .name("biscuit emissive")
      .onChange((v: string) => { p.biscuitEmissive = new THREE.Color(v).getHex(); });
    folder
      .add(biscuit, "emissiveIntensity", 0, 2, 0.01)
      .name("emissive intensity")
      .onChange((v: number) => { p.biscuitEmissiveIntensity = v; });
  }

  /** Rebuilds the Blooms folder's color-list controls from
   *  `theme.palette.bloomColors` — called on first build AND whenever a
   *  color is added/removed (the CONTROL COUNT changes, which lil-gui has no
   *  "insert one more addColor" primitive for, so the simplest correct
   *  approach is destroy-and-rebuild-this-one-folder, same shape as
   *  inspector.ts's whole-folder rebuild-per-selection). */
  function buildBloomsFolder(theme: WorkingTheme): void {
    folders.blooms?.destroy();
    const folder = gui.addFolder("Blooms");
    folders.blooms = folder;
    const p = theme.palette;
    const colors = p.bloomColors; // WorkingPalette's bloomColors is genuinely mutable (see boardCodegen.ts)

    colors.forEach((_, i) => {
      folder
        .addColor(
          hexProxy(
            () => colors[i],
            (v) => { colors[i] = v; },
          ),
          "color",
        )
        .name(`bloom ${i + 1}`)
        .onChange(() => cb.onDecorChange());
    });

    if (colors.length < MAX_BLOOM_COLORS) {
      folder
        .add({ add: () => {
          colors.push(DEFAULT_NEW_BLOOM_COLOR);
          buildBloomsFolder(theme);
          cb.onDecorChange();
        } }, "add")
        .name(`add bloom color (${colors.length}/${MAX_BLOOM_COLORS}) ➕`);
    }
    if (colors.length > 0) {
      folder
        .add({ remove: () => {
          colors.pop();
          buildBloomsFolder(theme);
          cb.onDecorChange();
        } }, "remove")
        .name("remove last bloom color ➖");
    }

    folder
      .add(p, "bloomEmissiveIntensity", 0, 2, 0.01)
      .name("bloom emissive intensity")
      .onChange(() => cb.onDecorChange());
    folder
      .add(p, "bloomChance", 0, 0.5, 0.01)
      .name("bloom chance")
      .onChange(() => cb.onDecorChange());
  }

  function buildSpecksFolder(theme: WorkingTheme): void {
    const folder = gui.addFolder("Specks");
    folders.specks = folder;
    const p = theme.palette;
    folder
      .addColor(hexProxy(() => p.speckColor, (v) => { p.speckColor = v; }), "color")
      .name("speck color")
      .onChange(() => cb.onDecorChange());
    folder
      .addColor(hexProxy(() => p.speckEmissive, (v) => { p.speckEmissive = v; }), "color")
      .name("speck emissive")
      .onChange(() => cb.onDecorChange());
    folder
      .add(p, "speckChance", 0, 0.6, 0.01)
      .name("speck chance")
      .onChange(() => cb.onDecorChange());
  }

  return {
    setTheme(
      theme: WorkingTheme,
      baseThemeId: string,
      materials: BoardMaterialHandles,
      lights: BoardLightHandles,
    ): void {
      baseState.baseThemeId = baseThemeId;
      baseThemeCtrl.updateDisplay();

      // Re-bind the three meta text/number controllers to `theme`'s own
      // fields — lil-gui controllers stay bound to whatever object/property
      // they were constructed with, so a fresh working theme (a new object)
      // needs its `.object` swapped onto each controller directly (see the
      // "Theme identity" folder's construction above for why there's no
      // separate mirror variable to reassign here).
      const idCtrl = metaCtrls[0];
      const nameCtrl = metaCtrls[1];
      const priceCtrl = metaCtrls[2];
      idCtrl.object = theme;
      idCtrl.property = "id";
      nameCtrl.object = theme;
      nameCtrl.property = "name";
      priceCtrl.object = theme;
      priceCtrl.property = "price";
      idCtrl.updateDisplay();
      nameCtrl.updateDisplay();
      priceCtrl.updateDisplay();

      clearSlotFolders();
      buildAtmosphereFolder(theme, lights);
      buildWallsFolder(theme, materials.wall);
      buildFloorFolder(theme, materials.floor);
      buildBiscuitsFolder(theme, materials.biscuit);
      buildBloomsFolder(theme);
      buildSpecksFolder(theme);
    },
    focusSlot(id: BoardSlotId): void {
      const folder = folders[id];
      if (!folder) return;
      folder.open();
      folder.domElement.scrollIntoView({ block: "nearest" });
    },
    destroy(): void {
      gui.destroy();
    },
  };
}
