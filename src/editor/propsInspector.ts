// OWNER: props library editor (IDEA-029, dev-only).
// The lil-gui control pane for PROPS mode: library ops at the top (add /
// duplicate / remove) then, for the currently selected def, name/id/shape
// followed by ONLY the params PROP_SHAPE_FIELDS[shape] lists, in that order
// (see src/game/props.ts — the render factories independently ignore
// irrelevant fields, but the INSPECTOR only ever shows the ones that matter
// for the selected shape, so there's never a "window count" slider on a
// shrub). Every change calls `cb.onChange()`, which main.ts turns into a
// live preview rebuild (`makePropFromDef` — see propsStage.ts/main.ts).
//
// Structural changes (id edit, shape swap, add/duplicate/remove) rebuild the
// WHOLE per-def folder — same "destroy this one folder, rebuild it" shape
// boardInspector.ts's buildPropsFolder/buildBloomsFolder already use for
// their own structural edits (lil-gui has no primitive for inserting/
// removing a single controller in place), reused here rather than
// reinvented.
//
// Color-list fields (foliageColors/facadeColors) follow the exact
// add/remove-color pattern boardInspector.ts's buildBloomsFolder established
// (1..4 entries, `addColor` bound to a `hexProxy` over one array index, plus
// trailing add/remove buttons) — matched here field-for-field so the two
// inspectors read as the same idiom.
import GUI from "lil-gui";
import * as THREE from "three";
import { PROP_SHAPE_FIELDS, type PropBaseShape, type PropParams } from "../game/props";
import { PROP_SHAPE_OPTIONS } from "./propsCodegen";
import { uniquifyPropId, type WorkingPropDef } from "./propsWorking";

const MIN_COLORS = 1;
const MAX_COLORS = 4;
const DEFAULT_NEW_COLOR = 0xffffff;

/** Which PropParams keys are single colors vs. booleans vs. plain
 *  number sliders (the color-LIST fields, foliageColors/facadeColors, are
 *  dispatched by an explicit shape check in buildFieldControl instead of a
 *  Set — TS can narrow `key` to exactly those two literal keys from the
 *  `===`/`||` check, which a Set.has() lookup can't do) — drives which
 *  lil-gui control each field in PROP_SHAPE_FIELDS[shape] gets. Kept here
 *  (not in props.ts) since this is purely an editor-UI concern, mirroring
 *  PROP_SHAPE_FIELDS' own placement rationale ("purely a UI concern; kept
 *  here beside PropParams so the two never drift" — same logic, this module
 *  is the one place that actually RENDERS controls from it). */
const SINGLE_COLOR_FIELDS = new Set<keyof PropParams>(["trunkColor", "windowColor", "glowColor", "signBoardColor"]);
const BOOLEAN_FIELDS = new Set<keyof PropParams>(["rooftop"]);

/** Slider range/step per numeric field, per the task brief's exact numbers.
 *  A field not listed here (there are none today — every numeric PropParams
 *  field the brief specifies a range for) would fall back to a generic 0..2
 *  range, but every field PROP_SHAPE_FIELDS ever lists a numeric one for IS
 *  covered, so that fallback never actually triggers — kept only so a future
 *  PropParams field addition degrades gracefully instead of throwing. */
const SLIDER_RANGE: Partial<Record<keyof PropParams, readonly [number, number, number]>> = {
  height: [0.3, 2.5, 0.01],
  width: [0.4, 2, 0.01],
  segments: [1, 4, 1],
  tilt: [0, 0.6, 0.01],
  windowRows: [0, 4, 1],
  windowCols: [0, 4, 1],
  glowIntensity: [0, 1.5, 0.01],
  windowEmissiveIntensity: [0, 1.5, 0.01],
};

/** Default value a numeric field snaps to the FIRST time it's turned on (a
 *  field absent from `params` has no slider until this seeds it) — matches
 *  each factory's own documented default in props.ts's PropParams doc, so
 *  turning a field "on" never surprises with an off-brand starting value. */
const FIELD_SEED_DEFAULT: Partial<Record<keyof PropParams, number>> = {
  height: 1,
  width: 1,
  segments: 3,
  tilt: 0.2,
  windowRows: 2,
  windowCols: 2,
  windowColor: 0xf4d060,
  windowEmissiveIntensity: 1,
  trunkColor: 0x6b4a2f,
  glowColor: 0xf4d060,
  glowIntensity: 0.9,
  signBoardColor: 0x33333c,
};

const FIELD_LABEL: Partial<Record<keyof PropParams, string>> = {
  height: "height",
  width: "width",
  segments: "segments",
  tilt: "tilt",
  trunkColor: "trunk color",
  foliageColors: "foliage colors",
  facadeColors: "facade colors",
  windowRows: "window rows",
  windowCols: "window cols",
  windowColor: "window color",
  windowEmissiveIntensity: "window emissive intensity",
  rooftop: "rooftop",
  glowColor: "glow color",
  glowIntensity: "glow intensity",
  signBoardColor: "sign board color",
};

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

export interface PropsInspectorCallbacks {
  /** Any field on the SELECTED def changed (name/shape/param) — rebuilds the
   *  live preview via makePropFromDef. */
  onChange(): void;
  /** id text field committed — `before`/`after` so main.ts can warn if the
   *  rename orphans placements (see the used-by note on the id field below).
   *  Uniqueness is already enforced by the time this fires (see the id
   *  controller's onFinishChange). */
  onIdChanged(before: string, after: string): void;
  /** "add prop ✚" clicked — main.ts pushes a fresh default def onto the
   *  working library, returns its id so the inspector can select it. */
  onAdd(): string;
  /** "duplicate" clicked for the CURRENTLY selected def — main.ts pushes the
   *  clone, returns its id so the inspector can select it. */
  onDuplicate(): string;
  /** "remove" clicked for the CURRENTLY selected def — main.ts splices it out
   *  of the working library (guarded: never the last one). Returns the id to
   *  select next (the previous def, or the new first one), or null if the
   *  remove was refused (last-one guard). */
  onRemove(): string | null;
  /** How many theme placements/wallDecor entries reference `id` right now —
   *  scans MAZE_THEMES (see main.ts) so the "used by N" note stays live as
   *  the user renames/removes. */
  usedByCount(id: string): number;
}

export interface PropsInspector {
  /** Rebuilds every control from the CURRENT working library + `selectedId`
   *  — called on Props-mode entry and after any library-op (add/duplicate/
   *  remove) or an id rename that needs the "used by" note refreshed. */
  setLibrary(library: readonly WorkingPropDef[], selectedId: string | null): void;
  destroy(): void;
}

export function createPropsInspector(
  container: HTMLElement,
  cb: PropsInspectorCallbacks,
): PropsInspector {
  const gui = new GUI({ container, title: "Props Library" });

  const libraryFolder = gui.addFolder("Library");
  libraryFolder
    .add({ add: () => { const id = cb.onAdd(); refreshAfterStructuralChange(id); } }, "add")
    .name("add prop ✚");
  const duplicateCtrl = libraryFolder
    .add({ duplicate: () => { const id = cb.onDuplicate(); refreshAfterStructuralChange(id); } }, "duplicate")
    .name("duplicate 📄");
  const removeCtrl = libraryFolder
    .add({ remove: () => { const id = cb.onRemove(); refreshAfterStructuralChange(id); } }, "remove")
    .name("remove 🗑");

  let defFolder: GUI | null = null;
  let currentLibrary: readonly WorkingPropDef[] = [];
  let currentSelectedId: string | null = null;

  /** After add/duplicate/remove: main.ts already mutated its own working
   *  array by the time these fire, but this MODULE's `currentLibrary`
   *  snapshot is now stale (a different length) — a full setLibrary() call
   *  (main.ts's own responsibility, triggered indirectly here) is the only
   *  correct way to pick up the new array + move selection, mirroring
   *  boardInspector.ts's buildPropsFolder(theme) re-entrant rebuild calls
   *  after its own add/remove buttons. Guarded by `newSelectedId === null`
   *  (the remove-last-one refusal) — a no-op refresh in that case, so the
   *  refused removal leaves the UI untouched rather than clearing selection. */
  function refreshAfterStructuralChange(newSelectedId: string | null): void {
    if (newSelectedId === null) return; // guard refused (e.g. "last prop")
    cb.onChange(); // main.ts's own onChange rebuilds currentLibrary + calls setLibrary
  }

  function buildColorListField(folder: GUI, def: WorkingPropDef, key: "foliageColors" | "facadeColors"): void {
    const label = FIELD_LABEL[key] ?? key;
    // Params object may not have this array yet (an optional field) — seed a
    // sensible starting list the FIRST time this field is shown, matching
    // the shape's own factory default so turning it "on" isn't jarring.
    if (!def.params[key]) {
      def.params[key] = [0x4e9a3e, 0x3f8f3a, 0x5fae4d];
    }
    const list = def.params[key] as number[];

    list.forEach((_, i) => {
      folder
        .addColor(hexProxy(() => list[i], (v) => { list[i] = v; }), "color")
        .name(`${label} ${i + 1}`)
        .onChange(() => cb.onChange());
    });

    if (list.length < MAX_COLORS) {
      folder
        .add({ add: () => {
          list.push(DEFAULT_NEW_COLOR);
          rebuildDefFolder();
          cb.onChange();
        } }, "add")
        .name(`add ${label.replace(/s$/, "")} (${list.length}/${MAX_COLORS}) ➕`);
    }
    if (list.length > MIN_COLORS) {
      folder
        .add({ remove: () => {
          list.pop();
          rebuildDefFolder();
          cb.onChange();
        } }, "remove")
        .name(`remove last ${label.replace(/s$/, "")} ➖`);
    }
  }

  function buildSingleColorField(folder: GUI, def: WorkingPropDef, key: keyof PropParams): void {
    const label = FIELD_LABEL[key] ?? key;
    const seed = FIELD_SEED_DEFAULT[key] ?? 0xffffff;
    if (def.params[key] === undefined) (def.params as Record<string, unknown>)[key] = seed;
    folder
      .addColor(
        hexProxy(
          () => def.params[key] as number,
          (v) => { (def.params as Record<string, unknown>)[key] = v; },
        ),
        "color",
      )
      .name(label)
      .onChange(() => cb.onChange());
  }

  function buildNumberField(folder: GUI, def: WorkingPropDef, key: keyof PropParams): void {
    const label = FIELD_LABEL[key] ?? key;
    const [lo, hi, step] = SLIDER_RANGE[key] ?? [0, 2, 0.01];
    const seed = FIELD_SEED_DEFAULT[key] ?? lo;
    if (def.params[key] === undefined) (def.params as Record<string, unknown>)[key] = seed;
    folder
      .add(def.params as Record<string, number>, key as string, lo, hi, step)
      .name(label)
      .onChange(() => cb.onChange());
  }

  function buildBooleanField(folder: GUI, def: WorkingPropDef, key: keyof PropParams): void {
    const label = FIELD_LABEL[key] ?? key;
    if (def.params[key] === undefined) (def.params as Record<string, unknown>)[key] = true;
    folder
      .add(def.params as Record<string, boolean>, key as string)
      .name(label)
      .onChange(() => cb.onChange());
  }

  function buildFieldControl(folder: GUI, def: WorkingPropDef, key: keyof PropParams): void {
    if (key === "foliageColors" || key === "facadeColors") {
      buildColorListField(folder, def, key);
    } else if (SINGLE_COLOR_FIELDS.has(key)) {
      buildSingleColorField(folder, def, key);
    } else if (BOOLEAN_FIELDS.has(key)) {
      buildBooleanField(folder, def, key);
    } else {
      buildNumberField(folder, def, key);
    }
  }

  /** Rebuilds the per-def folder (name/id/shape + PROP_SHAPE_FIELDS[shape]'s
   *  controls) from `currentLibrary`/`currentSelectedId` — the one function
   *  every structural change (shape swap, color add/remove, id rename)
   *  eventually calls, mirroring boardInspector.ts's buildPropsFolder/
   *  buildBloomsFolder rebuild-the-whole-folder idiom for the same reason:
   *  lil-gui has no primitive for inserting/removing a single controller (or
   *  renaming a folder's title) in place. */
  function rebuildDefFolder(): void {
    defFolder?.destroy();
    defFolder = null;

    const def = currentSelectedId ? currentLibrary.find((d) => d.id === currentSelectedId) : undefined;
    duplicateCtrl.enable(!!def);
    removeCtrl.enable(!!def && currentLibrary.length > 1);
    if (!def) return;

    const folder = gui.addFolder(`Selected: ${def.name}`);
    defFolder = folder;

    folder.add(def, "name").name("name").onChange(() => {
      cb.onChange();
      // Name isn't the folder title's ONLY source of truth (the tree row's
      // label is), but re-titling the "Selected: X" folder keeps it in sync
      // with a live name edit too — cheapest correct fix is a full rebuild,
      // same as every other structural change here.
      rebuildDefFolder();
    });

    // id: free text, but must stay unique against every OTHER def — enforced
    // on commit (onFinishChange), not on every keystroke (onChange), so
    // typing "tow" while renaming "tower" -> "towering" doesn't collide with
    // itself mid-edit. A collision is silently uniquified (never rejected/
    // reverted) so the field always ends in a valid state; onIdChanged fires
    // with before/after so main.ts can warn if the OLD id was in use.
    const idState = { id: def.id };
    const idBefore = { value: def.id };
    folder
      .add(idState, "id")
      .name("id")
      .onFinishChange((raw: string) => {
        const trimmed = raw.trim();
        const before = idBefore.value;
        const wanted = trimmed.length > 0 ? trimmed : before;
        const unique = uniquifyPropId(currentLibrary, wanted, currentLibrary.indexOf(def));
        def.id = unique;
        idState.id = unique;
        idBefore.value = unique;
        if (unique !== before) cb.onIdChanged(before, unique);
        cb.onChange();
        rebuildDefFolder(); // refresh the used-by note + tree badge
      });

    const shapeOptions: Record<string, PropBaseShape> = {};
    for (const s of PROP_SHAPE_OPTIONS) shapeOptions[s] = s;
    folder
      .add(def, "shape", shapeOptions)
      .name("shape")
      .onChange(() => {
        // IDEA-033: a shape swap changes which FACTORY builds this def, so
        // any saved part-edit layer's paths ("2/1", "trunk"…) addressed the
        // OLD factory's tree and are meaningless against the new one —
        // drop them rather than let them silently no-op forever (board.ts's
        // applyPropPartEdit degrades a stale path to a no-op, which is
        // correct for a TRANSIENT mismatch like segments changing a lobe
        // count, but a permanent shape swap should just clear the slate).
        delete def.parts;
        // Shape swap re-derives which param controls show (PROP_SHAPE_FIELDS
        // keyed by the NEW shape) — structural, full rebuild.
        cb.onChange();
        rebuildDefFolder();
      });

    const usedBy = cb.usedByCount(def.id);
    if (usedBy > 0) {
      // lil-gui's `.name()` (not the bound property's own value) is the
      // visible label — a disabled controller with an EMPTY bound value and
      // the actual message passed to `.name()` is the standard lil-gui idiom
      // for a plain informational row (no property key ever renders on
      // screen; `.add({ note: "" }, "note")`'s "note" is purely the internal
      // binding key, invisible once `.name()` overrides the label).
      const note = folder.add({ note: "" }, "note").name(`used by ${usedBy} placement${usedBy === 1 ? "" : "s"} 🔗`);
      note.disable();
      note.domElement.classList.add("props-used-by-note");
    }

    for (const key of PROP_SHAPE_FIELDS[def.shape]) {
      buildFieldControl(folder, def, key);
    }
  }

  return {
    setLibrary(library: readonly WorkingPropDef[], selectedId: string | null): void {
      currentLibrary = library;
      currentSelectedId = selectedId;
      rebuildDefFolder();
    },
    destroy(): void {
      gui.destroy();
    },
  };
}
