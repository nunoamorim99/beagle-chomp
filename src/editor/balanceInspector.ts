// OWNER: editor (IDEA-062 v4, dev-only).
// The Balance tab's lil-gui pane: one folder per BALANCE_GROUPS entry, a
// slider per field, a Save button, and the `npm run sync` gate.
//
// No 3D preview here, deliberately. Every other tab edits something you can
// look at; these are numbers whose effect is only visible by PLAYING, and a
// viewport showing an idle beagle beside a "ghost speed" slider would imply a
// feedback loop that does not exist. The tab is a form.
//
// THE SYNC GATE IS THIS TAB'S MAIN FEATURE, not decoration. CLAUDE.md is
// emphatic: change config.ts and you must run `npm run sync` in `server/`, or
// the server's plausibility bounds drift from the game's and honest runs start
// being rejected with SCORE_ITEM_MISMATCH — in production, silently, with
// nothing failing locally. So a successful save does not flash a tick and
// vanish; it leaves a panel up with the exact commands until it is dismissed.
import GUI from "lil-gui";
import { BALANCE_GROUPS, type BalanceField } from "./balanceFields";
import { readConfigNumber, type ConfigPath } from "./configRewrite";

export interface BalanceInspectorCallbacks {
  /** Current source text — read fresh per rebuild so the controls show what
   *  the FILE says, including edits saved earlier this session. */
  source(): string;
  /** A slider moved. The value is not written to disk here; the tab keeps a
   *  pending map and writes on Save. */
  onEdit(path: ConfigPath, value: number): void;
  /** Save clicked. Resolves with what landed and what could not. */
  onSave(): Promise<{ ok: boolean; error?: string; applied: number; blocked: { path: ConfigPath; reason: string }[] }>;
  /** Revert every pending edit back to what the file says. */
  onRevert(): void;
}

export interface BalanceInspector {
  /** (Re)builds every folder from the current source. */
  rebuild(): void;
  /** How many edits are waiting to be written. */
  pendingCount(): number;
  destroy(): void;
}

export function createBalanceInspector(
  container: HTMLElement,
  cb: BalanceInspectorCallbacks,
): BalanceInspector {
  const gui = new GUI({ container, title: "Balance — src/game/config.ts" });
  /** path -> pending value. Cleared on save and on revert. */
  const pending = new Map<string, number>();

  const saveBtn = document.createElement("button");
  saveBtn.id = "saveConfigFileBtn";
  saveBtn.className = "save-btn";
  const SAVE_LABEL = "💾 Save config.ts → then sync the server";
  saveBtn.textContent = SAVE_LABEL;
  saveBtn.title =
    "Writes your changes into src/game/config.ts (dev server only). " +
    "You MUST then run `npm run sync` in server/ — the server validates every score against these numbers.";

  const syncPanel = document.createElement("div");
  syncPanel.id = "syncPanel";
  syncPanel.hidden = true;

  function showSyncPanel(applied: number, blocked: { path: ConfigPath; reason: string }[]): void {
    syncPanel.textContent = "";

    const head = document.createElement("strong");
    head.textContent = `Saved ${applied} change${applied === 1 ? "" : "s"} to config.ts.`;
    syncPanel.append(head);

    const body = document.createElement("p");
    body.textContent =
      "The server validates every submitted score against these numbers. Until you re-sync it, " +
      "honest runs will start being rejected with SCORE_ITEM_MISMATCH — and nothing will fail locally to tell you.";
    syncPanel.append(body);

    const cmd = document.createElement("code");
    cmd.textContent = "cd server && npm run sync && npm run test:catalog";
    syncPanel.append(cmd);

    const copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = "Copy";
    copy.addEventListener("click", () => {
      void navigator.clipboard.writeText("cd server && npm run sync && npm run test:catalog").then(() => {
        copy.textContent = "Copied ✓";
        window.setTimeout(() => { copy.textContent = "Copy"; }, 1400);
      });
    });
    syncPanel.append(copy);

    if (blocked.length > 0) {
      const warn = document.createElement("p");
      warn.className = "sync-blocked";
      warn.textContent = `${blocked.length} value(s) could NOT be written: ${blocked
        .map((b) => `${b.path.join(".")} — ${b.reason}`)
        .join("; ")}`;
      syncPanel.append(warn);
    }

    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "sync-dismiss";
    dismiss.textContent = "Dismiss";
    dismiss.addEventListener("click", () => { syncPanel.hidden = true; });
    syncPanel.append(dismiss);

    syncPanel.hidden = false;
  }

  saveBtn.addEventListener("click", () => {
    const original = saveBtn.textContent ?? SAVE_LABEL;
    saveBtn.disabled = true;
    void cb.onSave().then((r) => {
      saveBtn.disabled = false;
      if (!r.ok) {
        saveBtn.classList.remove("copied");
        saveBtn.textContent = `Save failed — ${r.error ?? "unknown"}`;
        window.setTimeout(() => { saveBtn.textContent = original; }, 2400);
        return;
      }
      pending.clear();
      saveBtn.classList.add("copied");
      saveBtn.textContent = `Saved ✓ ${r.applied} change(s)`;
      window.setTimeout(() => {
        saveBtn.classList.remove("copied");
        saveBtn.textContent = SAVE_LABEL;
      }, 2000);
      showSyncPanel(r.applied, r.blocked);
      rebuild(); // re-seed every control from the file we just wrote
    });
  });

  const revertBtn = document.createElement("button");
  revertBtn.id = "revertConfigBtn";
  revertBtn.className = "copy-btn";
  revertBtn.textContent = "Revert unsaved";
  revertBtn.title = "Put every slider back to what src/game/config.ts currently says.";
  revertBtn.addEventListener("click", () => {
    pending.clear();
    cb.onRevert();
    rebuild();
  });

  container.prepend(syncPanel);
  container.prepend(revertBtn);
  container.prepend(saveBtn);

  const folders: GUI[] = [];

  function addField(folder: GUI, field: BalanceField, src: string): void {
    const current = readConfigNumber(src, field.path);
    if (current === null) {
      // The catalogue is hand-written (balanceFields.ts) and config.ts can be
      // refactored under it. Say so rather than rendering a slider bound to a
      // number that is not there — IDEA-041's rule.
      folder
        .add({ missing: "not found in config.ts" }, "missing")
        .name(field.label)
        .disable();
      return;
    }
    const key = field.path.join(".");
    const state = { [field.label]: pending.get(key) ?? current };
    const ctrl = folder
      .add(state, field.label, field.min, field.max, field.step)
      .onChange((v: number) => {
        pending.set(key, v);
        cb.onEdit(field.path, v);
      });
    ctrl.domElement.dataset.testid = `balance:${key}`;
    if (field.hint) ctrl.domElement.setAttribute("title", field.hint);
  }

  function rebuild(): void {
    for (const f of folders) f.destroy();
    folders.length = 0;
    const src = cb.source();
    for (const group of BALANCE_GROUPS) {
      const folder = gui.addFolder(group.title);
      // OPEN, not closed. The pane lays the groups out in columns (see
      // editor.css's mode-balance block), so all eight fit side by side —
      // and a balance pass is playing speeds off against score off against
      // the spawn thresholds, which means seeing them together rather than
      // opening one at a time.
      folders.push(folder);
      if (group.note) {
        const note = document.createElement("div");
        note.className = "balance-note";
        note.textContent = group.note;
        folder.domElement.querySelector(".lil-children")?.prepend(note);
      }
      for (const field of group.fields) addField(folder, field, src);
    }
  }

  rebuild();

  return {
    rebuild,
    pendingCount: () => pending.size,
    destroy(): void {
      gui.destroy();
      saveBtn.remove();
      revertBtn.remove();
      syncPanel.remove();
    },
  };
}
