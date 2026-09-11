// OWNER: editor (IDEA-025, dev-only).
// The raw text of every file the editor can show and rewrite.
//
// Both the "Real source" panel and the save path need the file's ACTUAL text,
// and both used to hard-code a single `characters.ts?raw` import. Adding the
// Pickups tab (whose builders live in board.ts) meant either duplicating that
// import in two more places or putting it behind one lookup — this was the
// lookup.
//
// IDEA-062: the lookup MOVED to src/editor/sourceStore.ts, and this file is
// now a thin re-export so `fileExport.ts` and `main.ts` keep their imports.
// The reason is a bug, not tidiness: a `?raw` import is frozen at page load,
// and once editor saves stopped reloading the page (see vite.config.ts's
// handleHotUpdate) a second save would have spliced into page-load-era text
// and silently reverted the first. sourceStore holds ONE mutable copy that
// every save advances — read its header for the full account.
//
// The "what the panel shows and what Save rewrites are the same bytes that
// ship" guarantee is unchanged; it is now "…the same bytes that ship, plus
// whatever this session has already written", which is strictly what a
// second save needs to be correct.
export { sourceTextFor } from "./sourceStore";
