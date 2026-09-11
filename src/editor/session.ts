// OWNER: editor (IDEA-062 v3, dev-only).
// A rolling autosave of the editor's in-progress work, plus the Restore /
// Discard bar that offers it back after a reload.
//
// WHY, given IDEA-062 v1 already stopped saves from reloading the page: a
// reload is still one Ctrl+R, one crashed tab, one hand-edit to a game file
// (which SHOULD still hot-reload — the HMR suppression is scoped to the
// editor's own writes and deliberately narrow), or one stale-chip Reload
// click away. Before this, every one of those cost an afternoon of prop
// tuning with no warning and no way back. The editor is a tool for
// converging on something you like over many small steps; a tool that can
// silently discard the last hour is one you stop trusting, which is exactly
// what Nuno described.
//
// WHAT IS AND IS NOT STORED, and the split is deliberate:
//
//   Props   — the whole working library. Pure data. Restores exactly.
//   Board   — the working theme + which registry theme it was cloned from.
//             Pure data. Restores exactly.
//   Mode    — which tab you were on.
//   Character/Pickups — the SELECTED ID ONLY, not the EditLog.
//
// The character EditLog is not serialisable as it stands: it holds live
// THREE.Object3D and Material references (`AddedPartRecord.object`) and keys
// its material baselines by `uuid`, so restoring it means REPLAYING every
// record against a freshly-built character rather than parsing a blob. That
// is a real piece of work and it is registered as a follow-up rather than
// half-done here. It is also the least painful gap: character edits are
// already written into the real source by "Save to characters.ts", whereas
// props and board work lives only in memory until you save, which is where
// the losses actually hurt.
//
// ON CLAUDE.md's "No localStorage/sessionStorage assumptions for core state":
// that rule is about the GAME's state (the PWA must not assume storage
// survives), and this is the dev-only editor — which already uses
// sessionStorage for its save report. Every access here is wrapped so that a
// browser refusing storage degrades to "no restore offer", never to an error.
import type { WorkingPropDef } from "./propsWorking";
import type { WorkingTheme } from "./boardCodegen";

const KEY = "beagle-editor:session:v1";
/** Older than this and the offer is not worth making — you have moved on, and
 *  a bar offering yesterday's half-finished shrub is noise. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Trailing debounce. Long enough that a slider drag writes once rather than
 *  sixty times, short enough that a crash loses at most a gesture. */
const DEBOUNCE_MS = 1500;

export type EditorMode = "character" | "pickups" | "board" | "props" | "balance" | "world";

export interface EditorSession {
  version: 1;
  savedAt: number;
  mode: EditorMode;
  /** The whole working prop library, including every part-edit layer. */
  props: { library: WorkingPropDef[]; selectedId: string | null } | null;
  /** The working theme plus the registry id it was cloned FROM — both are
   *  needed, because `theme.id` is free-text-editable (you can author a brand
   *  new theme starting from garden's palette) and the save path looks the
   *  entry up by the BASE id. */
  board: { baseThemeId: string; theme: WorkingTheme } | null;
  /** Mesh modes: the selected registry id only. See the header on why the
   *  EditLog itself is not here. */
  character: { id: string } | null;
}

export interface SessionHost {
  mode(): EditorMode;
  props(): EditorSession["props"];
  board(): EditorSession["board"];
  character(): EditorSession["character"];
}

/** Reads whatever is stored, or null — for an absent, corrupt, stale or
 *  wrong-version entry alike. A restore offer is a convenience; there is no
 *  failure here worth surfacing, only "no offer". */
export function readStoredSession(): EditorSession | null {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return null; // private window, blocked site data — no offer
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as EditorSession;
    if (parsed.version !== 1) return null;
    if (typeof parsed.savedAt !== "number") return null;
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Is there anything here worth offering back?
 *
 * The mesh tabs store only a selected id (see the header), so a session with
 * neither props nor board work is just "you were on the Character tab" — and
 * prompting about that is noise that teaches you to dismiss the bar without
 * reading it, which is exactly how a real restore offer gets missed later.
 *
 * It also fixes a loop that looked like Discard not working: Discard cleared
 * storage, then the page's own `pagehide` flush on the next reload wrote an
 * EMPTY session straight back, and the bar returned.
 */
export function sessionHasContent(session: EditorSession): boolean {
  return session.props !== null || session.board !== null;
}

export function clearStoredSession(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}

function write(session: EditorSession): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // Quota, or storage refused outright. A lost autosave is exactly the
    // situation this module existed to improve and cannot make worse —
    // nothing else depends on the write having happened.
  }
}

export interface SessionRecorder {
  /** Something changed — schedule a write. Cheap to call on every gesture. */
  touch(): void;
  /** Write immediately (page hiding, tab closing). */
  flush(): void;
  dispose(): void;
}

/**
 * Starts recording. `host` is read lazily at write time rather than passed as
 * data, so a caller never has to remember to hand over a fresh snapshot —
 * `touch()` from anywhere is enough.
 */
export function startSessionRecorder(host: SessionHost): SessionRecorder {
  let timer: number | null = null;

  function snapshot(): EditorSession {
    return {
      version: 1,
      savedAt: Date.now(),
      mode: host.mode(),
      props: host.props(),
      board: host.board(),
      character: host.character(),
    };
  }

  function flush(): void {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    const next = snapshot();
    // Never write an empty session over a real one, and never write one at
    // all — see sessionHasContent. A page that has only ever sat on the
    // Character tab has nothing to offer back, and writing it would bury
    // whatever genuinely was there.
    if (!sessionHasContent(next)) return;
    write(next);
  }

  function touch(): void {
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(flush, DEBOUNCE_MS);
  }

  // `pagehide` is the reliable one — `beforeunload` is not fired in every
  // close path and `unload` is actively discouraged. `visibilitychange`
  // catches a tab being backgrounded before the machine sleeps or the browser
  // discards it.
  const onHide = (): void => flush();
  const onVisibility = (): void => {
    if (document.visibilityState === "hidden") flush();
  };
  window.addEventListener("pagehide", onHide);
  document.addEventListener("visibilitychange", onVisibility);

  return {
    touch,
    flush,
    dispose(): void {
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}

/**
 * Renders the Restore / Discard bar into `host`.
 *
 * **Nothing is applied until Restore is clicked.** An automatic restore would
 * be fewer clicks and the wrong default: coming back to a fresh editor and
 * finding yesterday's abandoned experiment already loaded — silently, over
 * the real registry values — is the same class of surprise this whole pass
 * exists to remove. The bar states what it has and lets you choose.
 */
export function showRestoreBar(
  host: HTMLElement,
  session: EditorSession,
  onRestore: () => void,
  onDiscard: () => void,
): void {
  const bar = document.createElement("div");
  bar.id = "sessionBar";

  const when = new Date(session.savedAt);
  const sameDay = new Date().toDateString() === when.toDateString();
  const stamp = when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const parts: string[] = [];
  if (session.props) parts.push("prop library");
  if (session.board) parts.push(`theme “${session.board.theme.name}”`);

  const text = document.createElement("span");
  text.id = "sessionBarText";
  text.textContent =
    parts.length > 0
      ? `Unsaved editor work from ${stamp}${sameDay ? " today" : ` on ${when.toLocaleDateString()}`} — ${parts.join(" and ")}.`
      : `An editor session from ${stamp}${sameDay ? " today" : ""}.`;

  // Say the gap out loud rather than letting it be discovered. Character part
  // edits are not in here (see the header), and a user who assumes otherwise
  // would restore, see their beagle unchanged, and distrust the whole bar.
  const caveat = document.createElement("span");
  caveat.id = "sessionBarCaveat";
  caveat.textContent = "Character/Pickups part edits are not restored — only the selected model.";

  const restore = document.createElement("button");
  restore.id = "sessionBarRestore";
  restore.type = "button";
  restore.textContent = "Restore";
  restore.addEventListener("click", () => {
    bar.remove();
    onRestore();
  });

  const discard = document.createElement("button");
  discard.id = "sessionBarDiscard";
  discard.type = "button";
  discard.textContent = "Discard";
  discard.addEventListener("click", () => {
    bar.remove();
    onDiscard();
  });

  bar.append(text, caveat, restore, discard);
  host.prepend(bar);
}
