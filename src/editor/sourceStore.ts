// OWNER: editor (IDEA-062, dev-only).
// The editor's live view of the source files it can rewrite.
//
// WHY THIS EXISTS — and it is not a refactor, it is half of a bug fix.
//
// Every editor save path splices generated text into the file's EXISTING
// source: characters.ts/board.ts rewrite statements in place (sourceRewrite),
// themes.ts replaces one array entry by brace-matching (boardCodegen), and
// props.ts replaces the whole PROP_LIBRARY block (propsFileExport). All four
// used to read that source from a `?raw` import — which Vite resolves ONCE,
// at page load, and never updates.
//
// That was survivable only because of a second defect: saving anything
// triggered a Vite full page reload (no `import.meta.hot` anywhere in src/),
// which re-imported the `?raw` module and re-froze it at the new text. The
// reload was destroying every unsaved edit in every other tab, so it had to
// go — and the moment it went, the frozen snapshot became live data loss:
//
//     save #1 -> disk now has your first edit
//     save #2 -> splices into the PAGE-LOAD text, which has neither edit
//             -> writes a file where save #1 never happened
//
// i.e. fixing the reload alone would have made "saving deletes my previous
// change" WORSE, not better. So the two land together, and this module is
// the second half: one mutable store, seeded from the `?raw` imports, kept
// current by saveEditorFile from the exact bytes it POSTed.
//
// No round-trip read is needed or wanted. The client knows precisely what it
// sent; asking the server to read it back would add a failure mode (and a
// race with the watcher) to buy nothing.
import charactersSource from "../render/characters.ts?raw";
import boardSource from "../render/board.ts?raw";
import themesSource from "../game/themes.ts?raw";
import propsSource from "../game/props.ts?raw";
import configSource from "../game/config.ts?raw";
import fenceSource from "../render/fence.ts?raw";
import groundDetailSource from "../render/groundDetail.ts?raw";
// IDEA-066 phase 5 added SURROUND_PARAMS to SavableFile and to the World
// tab's catalogue and NOT here, which is a silent whole-panel failure rather
// than an error: `sourceTextFor` returns "" for an unregistered file,
// `readConfigNumber("")` returns null, and worldInspector.ts turns every one
// of the sixteen surround dials into a disabled "not found in
// src/render/surround.ts" row. It renders, it says something plausible, and
// the whole group is dead. THE THREE LISTS ARE ONE CONTRACT: SavableFile,
// vite.config.ts's EDITOR_SAVABLE_FILES, and this map — a file missing from
// the second is a 403 on save, and one missing from the third cannot be read
// at all.
import surroundSource from "../render/surround.ts?raw";
import archwaySource from "../render/archway.ts?raw";
import hedgeWallSource from "../render/hedgeWall.ts?raw";
// TYPE-ONLY on purpose: saveFile.ts imports setSourceText from here, so a
// value import would close a runtime cycle. `import type` is guaranteed to
// be erased; the inline `{ type X }` form can leave a bare side-effect
// import behind depending on the bundler's settings.
import type { SavableFile } from "./saveFile";

/** Current text per file. Seeded from the `?raw` imports — the exact bytes
 *  that shipped — and advanced by `setSourceText` on every successful save.
 *
 *  Keyed by `SavableFile` so a file the editor can DISPLAY is necessarily one
 *  it is also allowed to WRITE: the two lists cannot drift apart and leave a
 *  tab reading a file it can never save. (That contract came from
 *  sources.ts, which this module absorbs.) */
const texts = new Map<SavableFile, string>([
  ["src/render/characters.ts", charactersSource],
  ["src/render/board.ts", boardSource],
  ["src/game/themes.ts", themesSource],
  ["src/game/props.ts", propsSource],
  ["src/game/config.ts", configSource],
  ["src/render/fence.ts", fenceSource],
  ["src/render/groundDetail.ts", groundDetailSource],
  ["src/render/surround.ts", surroundSource],
  ["src/render/archway.ts", archwaySource],
  ["src/render/hedgeWall.ts", hedgeWallSource],
]);

/** Which files have been written this session. The file on disk is now ahead
 *  of the MODULE the page imported — see `isModuleStale`. */
const staleModules = new Set<SavableFile>();

type Listener = (file: SavableFile) => void;
const listeners = new Set<Listener>();

/** The file's current text — the page-load bytes, or whatever the editor has
 *  since written. Returns "" for a file with no registered source, matching
 *  the contract sources.ts established (callers treat "" as "can't rewrite
 *  this", never as "the file is empty"). */
export function sourceTextFor(file: SavableFile): string {
  return texts.get(file) ?? "";
}

/**
 * Record what was just written to `file`.
 *
 * Called by saveEditorFile on success only. Marks the file's imported MODULE
 * stale as a side effect, because that is precisely the moment it becomes so.
 */
export function setSourceText(file: SavableFile, text: string): void {
  texts.set(file, text);
  staleModules.add(file);
  for (const cb of listeners) cb(file);
}

/**
 * True once this session has written `file`.
 *
 * This is the honest cost of suppressing the reload, surfaced rather than
 * hidden. For the mesh tabs it matters: `buildCharacter()` rebuilds from the
 * IMPORTED characters.ts module, which is still the pre-save build, so
 * switching characters after a save would show the old mesh and look like the
 * save was lost. The editor shows a "saved to disk — reload to re-read it"
 * chip driven by this, instead of letting the user discover it.
 *
 * Board and Props are unaffected: their working theme / working library ARE
 * the truth, and the registry is only read for the base-theme dropdown.
 */
export function isModuleStale(file: SavableFile): boolean {
  return staleModules.has(file);
}

/** Any file written this session — drives the chip's visibility. */
export function hasStaleModules(): boolean {
  return staleModules.size > 0;
}

/** Subscribe to writes. Returns an unsubscribe, so a caller with a lifetime
 *  (a panel, a chip) can detach without the store growing a leak. */
export function onSourceChanged(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
