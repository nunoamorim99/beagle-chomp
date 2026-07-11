// OWNER: character editor (IDEA-025, dev-only).
// Undo/redo for editor actions (Ctrl+Z / Ctrl+Y). Entries are closure pairs —
// each knows how to undo and redo itself against the live objects and the
// EditLog. Rapid repeats of the same action (holding an arrow key to nudge)
// coalesce into one entry so a single Ctrl+Z reverts the whole nudge run.
export interface HistoryEntry {
  undo(): void;
  redo(): void;
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

export class History {
  private undoStack: StoredEntry[] = [];
  private redoStack: StoredEntry[] = [];

  /** Record an action that has ALREADY been applied to the scene. */
  push(entry: HistoryEntry): void {
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
      return;
    }
    this.undoStack.push({ ...entry, time: now });
    if (this.undoStack.length > MAX_ENTRIES) {
      const dropped = this.undoStack.shift();
      dropped?.onDiscard?.();
    }
  }

  undo(): boolean {
    const entry = this.undoStack.pop();
    if (!entry) return false;
    entry.undo();
    this.redoStack.push(entry);
    return true;
  }

  redo(): boolean {
    const entry = this.redoStack.pop();
    if (!entry) return false;
    entry.redo();
    this.undoStack.push(entry);
    return true;
  }

  /** Wipes both stacks (character switch — old entries point at dead objects). */
  clear(): void {
    this.discard(this.undoStack);
    this.discard(this.redoStack);
  }

  private discard(stack: StoredEntry[]): void {
    for (const entry of stack) entry.onDiscard?.();
    stack.length = 0;
  }
}
