// OWNER: character editor (IDEA-025, dev-only).
// The raw text of every file the editor can show and rewrite.
//
// Both the "Real source" panel and the save path need the file's ACTUAL text,
// and both used to hard-code a single `characters.ts?raw` import. Adding the
// Pickups tab (whose builders live in board.ts) meant either duplicating that
// import in two more places or putting it behind one lookup — this is the
// lookup.
//
// Vite's `?raw` gives the file as a string at build time, so what the panel
// shows and what Save rewrites are the same bytes that ship. That is the whole
// reason the editor can claim it never drifts from the game.
import charactersSource from "../render/characters.ts?raw";
import boardSource from "../render/board.ts?raw";
import { type SavableFile } from "./saveFile";

/**
 * Raw text by path. Keyed by `SavableFile` so a file the editor can DISPLAY is
 * necessarily one it is also allowed to WRITE — the two lists cannot drift
 * apart and leave a tab that reads a file it can never save.
 *
 * themes.ts and props.ts are absent on purpose: the Board and Props tabs
 * generate whole files from their own data models rather than rewriting
 * statements in place, so they never need the source text.
 */
export const EDITOR_SOURCES: Partial<Record<SavableFile, string>> = {
  "src/render/characters.ts": charactersSource,
  "src/render/board.ts": boardSource,
};

/** Raw text for `file`, or "" when that file has no registered source. */
export function sourceTextFor(file: SavableFile): string {
  return EDITOR_SOURCES[file] ?? "";
}
