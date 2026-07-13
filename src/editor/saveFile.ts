// OWNER: editor (IDEA-032, dev-only).
// Client half of the dev-only save-to-file endpoint (see vite.config.ts's
// editorSaveFile middleware). The editor's three export surfaces
// (character → characters.ts, board → themes.ts, props → props.ts) call
// saveEditorFile() to WRITE the generated source directly, instead of asking
// the user to copy the text and paste it into the right place — the paste-in-
// the-wrong-place mistake that shipped a broken beagle (see the project's
// editor-residue-hazard note). Copy-to-clipboard stays as a fallback.
//
// Dev-only by construction: the /__save-file route only exists under `vite`
// (the middleware is `apply: "serve"`), so in any built/deployed context the
// fetch simply 404s and saveEditorFile reports failure — the editor page
// itself never ships anyway (not a rollup input), so this is belt-and-braces.

/** The exact source paths the dev middleware will accept (kept in sync with
 *  vite.config.ts's EDITOR_SAVABLE_FILES — a mismatch just yields a 403). */
export type SavableFile =
  | "src/render/characters.ts"
  | "src/game/themes.ts"
  | "src/game/props.ts";

export interface SaveResult {
  ok: boolean;
  /** Present on failure — a short reason to surface in the button flash. */
  error?: string;
}

/**
 * POSTs the full file contents to the dev server, which writes it to disk.
 * Never throws — returns { ok:false, error } on any failure (endpoint absent
 * in a non-dev context, network error, server rejection) so the caller can
 * flash a message and fall back to the copy button.
 */
export async function saveEditorFile(path: SavableFile, contents: string): Promise<SaveResult> {
  try {
    const res = await fetch("/__save-file", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path, contents }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, error: detail || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    // Most commonly: the endpoint doesn't exist (not running under `vite`),
    // so fetch rejects or 404s. Treat every failure the same — the UI falls
    // back to "use the copy button".
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
