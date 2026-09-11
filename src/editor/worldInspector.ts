// OWNER: editor (IDEA-062 v5, dev-only).
// The World tab's pane: the IDEA-060 garden machinery that no theme palette
// can reach — the picket fence's geometry and the ground dressing's scatter.
//
// Unlike Balance, this tab HAS a live preview, and it has to: every number in
// here is judged by looking at the board. It reuses board mode's own stage
// rather than building a second one, so what you tune is literally what the
// game draws.
//
// Edits apply LIVE (the params object is mutated and the board rebuilt) and
// are written to disk on Save — the opposite of Balance, and right for the
// same reason Balance is the other way round: here the feedback loop IS the
// point.
import GUI from "lil-gui";
import { WORLD_GROUPS, fenceReadability, type WorldField } from "./worldFields";
import { readConfigNumber } from "./configRewrite";
import type { SavableFile } from "./saveFile";

export interface WorldInspectorCallbacks {
  source(file: SavableFile): string;
  /** Mutate the live params object and rebuild the board. */
  onEdit(field: WorldField, value: number): void;
  /** Save clicked. */
  onSave(): Promise<{ ok: boolean; error?: string; applied: number; blocked: string[] }>;
  onRevert(): void;
  /** Current live value of a field — read back from the params object rather
   *  than the file, so the readout follows an unsaved drag. */
  liveValue(field: WorldField): number;
}

export interface WorldInspector {
  rebuild(): void;
  destroy(): void;
}

export function createWorldInspector(
  container: HTMLElement,
  cb: WorldInspectorCallbacks,
): WorldInspector {
  const gui = new GUI({ container, title: "World — fence & ground dressing" });

  const saveBtn = document.createElement("button");
  saveBtn.id = "saveWorldFileBtn";
  saveBtn.className = "save-btn";
  const SAVE_LABEL = "💾 Save fence.ts + groundDetail.ts";
  saveBtn.textContent = SAVE_LABEL;
  saveBtn.title = "Write these numbers back into their own params objects (dev server only).";

  const revertBtn = document.createElement("button");
  revertBtn.id = "revertWorldBtn";
  revertBtn.className = "copy-btn";
  revertBtn.textContent = "Revert unsaved";

  /**
   * The instrument. A wall face is ~25px at the game camera, so a picket and
   * its gap are single-digit pixel counts — and the CARTOON rule's floor is
   * "nothing smaller than a couple of pixels". This is the only place in the
   * tool where that rule can be checked WHILE dragging rather than after
   * shooting a render, which is the difference between tuning and guessing.
   */
  const readout = document.createElement("div");
  readout.id = "fenceReadout";

  function refreshReadout(): void {
    const pickets = cb.liveValue(findField("FENCE_PARAMS", "pickets"));
    const width = cb.liveValue(findField("FENCE_PARAMS", "picketWidth"));
    const r = fenceReadability(pickets, width);
    readout.textContent =
      `At the game camera (~25px a tile): picket ${r.picketPx.toFixed(1)}px · ` +
      `gap ${r.gapPx.toFixed(1)}px` +
      (r.ok ? "" : "  ⚠ under the ~2px cartoon floor — this will alias into speckle in play");
    readout.classList.toggle("warn", !r.ok);
  }

  function findField(objectName: string, key: string): WorldField {
    for (const g of WORLD_GROUPS) {
      for (const f of g.fields) {
        if (f.path[0] === objectName && f.path[1] === key) return f;
      }
    }
    throw new Error(`worldInspector: no field ${objectName}.${key}`);
  }

  saveBtn.addEventListener("click", () => {
    saveBtn.disabled = true;
    void cb.onSave().then((r) => {
      saveBtn.disabled = false;
      saveBtn.classList.toggle("copied", r.ok);
      saveBtn.textContent = r.ok
        ? `Saved ✓ ${r.applied} value(s)`
        : `Save failed — ${r.error ?? r.blocked.join("; ")}`;
      window.setTimeout(() => {
        saveBtn.classList.remove("copied");
        saveBtn.textContent = SAVE_LABEL;
      }, 2200);
    });
  });

  revertBtn.addEventListener("click", () => {
    cb.onRevert();
    rebuild();
  });

  container.prepend(readout);
  container.prepend(revertBtn);
  container.prepend(saveBtn);

  const folders: GUI[] = [];

  function rebuild(): void {
    for (const f of folders) f.destroy();
    folders.length = 0;
    for (const group of WORLD_GROUPS) {
      const folder = gui.addFolder(group.title);
      folders.push(folder);
      if (group.note) {
        const note = document.createElement("div");
        note.className = "balance-note";
        note.textContent = group.note;
        folder.domElement.querySelector(".lil-children")?.prepend(note);
      }
      for (const field of group.fields) {
        const src = cb.source(field.file);
        const fromFile = readConfigNumber(src, field.path);
        if (fromFile === null) {
          // The catalogue is hand-written and these are render modules that can
          // be refactored under it — say so rather than binding a slider to
          // nothing (IDEA-041's rule).
          folder.add({ missing: `not found in ${field.file}` }, "missing").name(field.label).disable();
          continue;
        }
        const state = { [field.label]: cb.liveValue(field) };
        const ctrl = folder
          .add(state, field.label, field.min, field.max, field.integer ? 1 : field.step)
          .onChange((v: number) => {
            // `pickets` must stay a whole number or the pitch stops dividing
            // the tile and every tile boundary seams. lil-gui's step already
            // enforces it for the slider; rounding here covers a typed value.
            const value = field.integer ? Math.round(v) : v;
            cb.onEdit(field, value);
            refreshReadout();
          });
        ctrl.domElement.dataset.testid = `world:${field.path.join(".")}`;
        if (field.hint) ctrl.domElement.setAttribute("title", field.hint);
      }
    }
    refreshReadout();
  }

  rebuild();

  return {
    rebuild,
    destroy(): void {
      gui.destroy();
      saveBtn.remove();
      revertBtn.remove();
      readout.remove();
    },
  };
}
