// OWNER: props library editor (IDEA-029/033, dev-only).
// "Save to props.ts" / "Copy full file": produces the COMPLETE src/game/
// props.ts text with the working library's CURRENT PROP_LIBRARY array
// (including any IDEA-033 part edits) spliced in — the props.ts analogue of
// src/editor/fileExport.ts's generateFullFile for characters.ts. Simpler
// than that module in one respect: characters.ts's edits are a DELTA block
// injected just before a builder's `return g;` (the authored source stays,
// the delta layers on top at runtime), because character edits are
// individually small and the builder itself is hand-authored prose worth
// preserving untouched. props.ts's PROP_LIBRARY, by contrast, is already a
// single exported array — formatPropLibrary (propsCodegen.ts) rebuilds that
// WHOLE array from the working copy every time (add/remove/edit all show up
// immediately), so the correct full-file operation is a straight REPLACEMENT
// of the existing `export const PROP_LIBRARY: readonly PropDef[] = [...]
// as const;` block with the freshly-formatted one — there's no per-entry
// delta to inject, and no "keep the old block, my edits it stack" concern
// fileExport.ts's own header discusses at length (that concern is inherent
// to injecting one MORE block on top of prior ones; here there is only ever
// the ONE array, fully regenerated, so nothing can stack).
import propsSource from "../game/props.ts?raw";
import { formatPropLibrary } from "./propsCodegen";
import { type WorkingPropDef } from "./propsWorking";

const MARKER = "export const PROP_LIBRARY: readonly PropDef[] = [";
const CLOSER = "] as const;";

/**
 * The full modified props.ts, or null when the `export const PROP_LIBRARY =
 * [...] as const;` block can't be located in the raw source (a defensive
 * fallback the caller uses to fall back to "use Copy library code instead" —
 * mirrors fileExport.ts's own null-on-not-found contract exactly, even
 * though in practice this block is a fixed, hand-authored export that should
 * always be found unless props.ts itself is mid-refactor).
 */
export function generateFullPropsFile(library: readonly WorkingPropDef[]): string | null {
  const src = propsSource;
  const start = src.indexOf(MARKER);
  if (start === -1) return null;
  const closerIdx = src.indexOf(CLOSER, start);
  if (closerIdx === -1) return null;
  const end = closerIdx + CLOSER.length;

  const replacement = formatPropLibrary(library, 2);
  return src.slice(0, start) + replacement + src.slice(end);
}
