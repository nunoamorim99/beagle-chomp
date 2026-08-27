// OWNER: character editor (IDEA-025, dev-only).
// Undo/redo for editor actions (Ctrl+Z / Ctrl+Y). Entries are closure pairs —
// each knows how to undo and redo itself against the live objects and the
// EditLog. Rapid repeats of the same action (holding an arrow key to nudge)
// coalesce into one entry so a single Ctrl+Z reverts the whole nudge run.
export interface HistoryEntry {
  undo(): void;
  redo(): void;
  /** What the history panel calls this step ("move nose", "colour tan").
   *  Optional: an unlabelled entry still undoes, it just reads as "edit". */
  label?: string;
  /** Entries with the same key pushed within COALESCE_MS merge: the older
   *  entry keeps its undo (original value) and adopts the newer redo. */
  coalesceKey?: string;
  /** Called when the entry is discarded from history (redo stack wiped by a
   *  new action, or history cleared on character switch) — the hook where an
   *  undone "add part" disposes its orphaned geometry. */
  onDiscard?(): void;
}

const COALESCE_MS = 1000;
const MAX_ENTRIES = 200;

interface StoredEntry extends HistoryEntry {
  time: number;
}

/** One row of the history panel. */
export interface HistoryStep {
  label: string;
  /** True when this step is currently APPLIED — i.e. it is at or before the
   *  cursor. False for steps that have been undone but can still be redone. */
  done: boolean;
}

export class History {
  private undoStack: StoredEntry[] = [];
  private redoStack: StoredEntry[] = [];
  /** Fired whenever the stacks or the cursor move. Muted during goTo() so a
   *  jump across twenty steps repaints the panel once, not twenty times —
   *  the same trick the three.js editor's goToState does with its signals. */
  onChange: (() => void) | null = null;
  private muted = false;
  /** Non-null while a begin()/commit() transaction is open. */
  private txn: StoredEntry[] | null = null;

  private notify(): void {
    if (!this.muted) this.onChange?.();
  }

  /**
   * Starts a transaction: every push() until commit() is buffered instead of
   * landing on the stack, and commit() folds the lot into ONE entry.
   *
   * This is the reference editor's MultiCmdsCommand without the class — it
   * exists so "delete four selected parts" is one Ctrl+Z rather than four,
   * and so callers that already know how to do ONE thing (deletePart,
   * deleteOriginalPart) can be reused unchanged for the many case.
   */
  begin(): void {
    if (this.txn === null) this.txn = [];
  }

  /** Ends the transaction opened by begin(). No-op if nothing was pushed. */
  commit(label: string): void {
    const entries = this.txn;
    this.txn = null;
    if (!entries || entries.length === 0) return;
    if (entries.length === 1) {
      this.push({ ...entries[0], label: entries[0].label ?? label });
      return;
    }
    this.push({
      // Reverse on the way back: the last thing done is the first undone, or
      // an entry that depended on an earlier one unwinds against a state
      // that no longer exists.
      undo: () => {
        for (let i = entries.length - 1; i >= 0; i--) entries[i].undo();
      },
      redo: () => {
        for (const e of entries) e.redo();
      },
      onDiscard: () => {
        for (const e of entries) e.onDiscard?.();
      },
      label,
    });
  }

  /** Record an action that has ALREADY been applied to the scene. */
  push(entry: HistoryEntry): void {
    if (this.txn !== null) {
      // Inside a transaction: buffer, and deliberately skip coalescing —
      // the members of one transaction must all survive to be replayed.
      this.txn.push({ ...entry, time: 0 });
      return;
    }
    this.discard(this.redoStack);
    const now = performance.now();
    const top = this.undoStack[this.undoStack.length - 1];
    if (
      entry.coalesceKey !== undefined &&
      top !== undefined &&
      top.coalesceKey === entry.coalesceKey &&
      now - top.time < COALESCE_MS
    ) {
      top.redo = entry.redo; // keep top.undo (the value before the run began)
      top.time = now;
      this.notify();
      return;
    }
    this.undoStack.push({ ...entry, time: now });
    if (this.undoStack.length > MAX_ENTRIES) {
      const dropped = this.undoStack.shift();
      dropped?.onDiscard?.();
    }
    this.notify();
  }

  undo(): boolean {
    const entry = this.undoStack.pop();
    if (!entry) return false;
    entry.undo();
    this.redoStack.push(entry);
    this.notify();
    return true;
  }

  redo(): boolean {
    const entry = this.redoStack.pop();
    if (!entry) return false;
    entry.redo();
    this.undoStack.push(entry);
    this.notify();
    return true;
  }

  /**
   * Every step in chronological order, applied ones first.
   *
   * The redo stack is stored most-recently-undone LAST, so the undone steps
   * read chronologically only once it is reversed — get that backwards and
   * the panel lists the future in the wrong order.
   */
  list(): HistoryStep[] {
    const applied = this.undoStack.map((e) => ({ label: e.label ?? "edit", done: true }));
    const undone = [...this.redoStack]
      .reverse()
      .map((e) => ({ label: e.label ?? "edit", done: false }));
    return [...applied, ...undone];
  }

  /** How many steps are currently applied — the cursor position in list(). */
  position(): number {
    return this.undoStack.length;
  }

  /** Undo or redo until exactly `target` steps are applied. */
  goTo(target: number): void {
    const clamped = Math.max(0, Math.min(target, this.undoStack.length + this.redoStack.length));
    this.muted = true;
    try {
      while (this.undoStack.length > clamped) {
        if (!this.undo()) break;
      }
      while (this.undoStack.length < clamped) {
        if (!this.redo()) break;
      }
    } finally {
      this.muted = false;
    }
    this.notify();
  }

  /** Wipes both stacks (character switch — old entries point at dead objects). */
  clear(): void {
    this.discard(this.undoStack);
    this.discard(this.redoStack);
    this.notify();
  }

  private discard(stack: StoredEntry[]): void {
    for (const entry of stack) entry.onDiscard?.();
    stack.length = 0;
  }
}
