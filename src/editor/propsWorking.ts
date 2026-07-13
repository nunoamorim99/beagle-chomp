// OWNER: props library editor (IDEA-029, dev-only).
// Working-copy types + deep-copy for Props mode — same split/rationale as
// board mode's boardCodegen.ts (WorkingTheme/cloneWorkingTheme): PROP_LIBRARY
// entries are `readonly` (params.foliageColors/facadeColors are `readonly
// number[]`), so the inspector's color-list add/remove controls need a
// genuinely MUTABLE array to push/pop directly. A WorkingPropDef is that
// mutable shape; cloneWorkingLibrary is the ONLY place a PropDef becomes one,
// and it deep-copies (never aliases) so nothing here can observably touch
// src/game/props.ts's actual PROP_LIBRARY at runtime — mirrors
// boardCodegen.ts's own "nothing here ever holds a reference into the
// registry object itself" contract exactly.
//
// Kept separate from propsCodegen.ts (which OWNS turning a WorkingPropDef
// back into pasteable source) so this module stays a small, focused "what is
// the mutable shape + how do I get one" — codegen only ever READS these
// types, never defines them, matching boardCodegen.ts's own internal split
// (types + clone up top, formatter functions below) just promoted to two
// files here since propsCodegen.ts's own header already has a lot to say
// about the formatting contract.
import type { PropBaseShape, PropDef, PropParams } from "../game/props";
import { PROP_LIBRARY } from "../game/props";

/** Same shape as PropParams, but the two color-LIST fields
 *  (foliageColors/facadeColors) are genuinely mutable arrays — every other
 *  field is already a plain optional primitive, so no other override is
 *  needed. Structurally assignable back to PropParams wherever a PropDef is
 *  expected (makePropFromDef only ever READS params). */
export interface WorkingPropParams extends Omit<PropParams, "foliageColors" | "facadeColors"> {
  foliageColors?: number[];
  facadeColors?: number[];
}

/** Same shape as PropDef, with `params` widened to WorkingPropParams. */
export interface WorkingPropDef {
  id: string;
  name: string;
  shape: PropBaseShape;
  params: WorkingPropParams;
}

/** Deep-copies one registry PropDef into an independent WorkingPropDef —
 *  spreads `params` MINUS its two array fields (so the spread's inferred
 *  type never carries `readonly number[]` into a `number[]`-typed slot) and
 *  clones those two array fields explicitly, so pushing/popping a color can
 *  never mutate the registry's own `readonly number[]`. */
export function cloneWorkingPropDef(def: PropDef): WorkingPropDef {
  const { foliageColors, facadeColors, ...rest } = def.params;
  const params: WorkingPropParams = { ...rest };
  if (foliageColors) params.foliageColors = [...foliageColors];
  if (facadeColors) params.facadeColors = [...facadeColors];
  return { id: def.id, name: def.name, shape: def.shape, params };
}

/** Deep-copies the WHOLE library into working copies, in registry order —
 *  called once on Props-mode entry (main.ts), per the brief's "deep-copy
 *  working state from PROP_LIBRARY on mode entry (never mutate the
 *  registry)". Re-entering Props mode later in the same session reuses the
 *  already-loaded working array rather than re-cloning (see main.ts) — this
 *  function is only ever called the FIRST time, exactly like
 *  loadBaseTheme/cloneWorkingTheme is only called once per base-theme pick in
 *  board mode. */
export function cloneWorkingLibrary(): WorkingPropDef[] {
  return PROP_LIBRARY.map(cloneWorkingPropDef);
}

/** A fresh, minimal default def for "add prop ✚" — a shrub (the library's own
 *  DEFAULT_PROP_ID/first entry), matching how boardCodegen.ts's
 *  defaultThemeProp() picks a sensible, editable starting point rather than
 *  an empty shell. `id`/`name` are placeholders the caller (propsInspector.ts
 *  via main.ts) immediately uniquifies/labels — see uniquifyPropId below. */
export function defaultWorkingPropDef(id: string): WorkingPropDef {
  return {
    id,
    name: "New Prop",
    shape: "shrub",
    params: { foliageColors: [0x4e9a3e, 0x3f8f3a, 0x5fae4d], segments: 3 },
  };
}

/** Deep-copies `def` for "duplicate" — same shape as cloneWorkingPropDef but
 *  takes a WorkingPropDef (the currently-edited working copy, which may
 *  already differ from the registry) rather than a registry PropDef, so
 *  "duplicate" bases the clone on whatever the user is CURRENTLY looking at
 *  (per the brief: "duplicate the selected def (so a user can base
 *  'Skyscraper' on 'City Tower')"), not the original unedited registry entry.
 *  `newId`/`newName` are the caller's already-uniquified choices. */
export function duplicateWorkingPropDef(def: WorkingPropDef, newId: string, newName: string): WorkingPropDef {
  const params: WorkingPropParams = { ...def.params };
  if (def.params.foliageColors) params.foliageColors = [...def.params.foliageColors];
  if (def.params.facadeColors) params.facadeColors = [...def.params.facadeColors];
  return { id: newId, name: newName, shape: def.shape, params };
}

/** Returns `true` if `id` is used by any OTHER entry in `library` (excludes
 *  `excludeIndex` — the def currently being renamed, so renaming a def to its
 *  own unchanged id never flags itself as a collision). Shared by the
 *  add/duplicate "make unique" helper below and the inspector's live
 *  uniqueness guard on the id text field. */
function idInUse(library: readonly WorkingPropDef[], id: string, excludeIndex: number): boolean {
  return library.some((d, i) => i !== excludeIndex && d.id === id);
}

/** Uniquifies `baseId` against `library` (excluding `excludeIndex`) by
 *  appending "-2", "-3", … until free — the same "keep the base, suffix a
 *  counter" idiom main.ts's own sanitizeName uses for added character parts.
 *  Used for BOTH a fresh "add prop" id (`prop-N`) and a duplicate's id
 *  (`${source.id}-copy`, uniquified further if THAT'S also taken). */
export function uniquifyPropId(library: readonly WorkingPropDef[], baseId: string, excludeIndex = -1): string {
  if (!idInUse(library, baseId, excludeIndex)) return baseId;
  let i = 2;
  while (idInUse(library, `${baseId}-${i}`, excludeIndex)) i++;
  return `${baseId}-${i}`;
}

/** Generates the next fresh "add prop" id — `prop-N` where N is one past the
 *  highest existing `prop-<number>` id in `library` (falls back to `prop-1`
 *  if none exist yet), then uniquified against the whole library just in case
 *  a hand-authored def already happens to occupy that exact slot. Mirrors the
 *  spirit of main.ts's own `sanitizeName` counter-suffix idiom, scoped to the
 *  "prop-N" convention the brief asks for. */
export function nextPropId(library: readonly WorkingPropDef[]): string {
  let highest = 0;
  for (const d of library) {
    const m = /^prop-(\d+)$/.exec(d.id);
    if (m) highest = Math.max(highest, Number(m[1]));
  }
  return uniquifyPropId(library, `prop-${highest + 1}`);
}
