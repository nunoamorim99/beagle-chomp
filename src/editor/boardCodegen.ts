// OWNER: board & themes editor (IDEA-027, dev-only).
// Emits a ready-to-paste `MAZE_THEMES` entry from the current working
// palette/placements/wallDecor/id/name/price — formatted to match
// src/game/themes.ts's existing entries byte-for-byte in shape: hex literals
// (0xRRGGBB), the exact field order ThemePalette/MazeTheme declare them in,
// trailing commas after every field (including the last), 2-space indent
// bump per nesting level (matching themes.ts's own style throughout).
// Round-trip contract: pasting the output as a new array entry (or replacing
// an existing one) inside MAZE_THEMES must compile as-is and reproduce the
// edited look — verified two ways: scripts/test-editor-board.ts's "Copy
// theme code" checks (round-trip a live edit through `new Function` as a
// real object literal) and, by construction, formatThemeEntry's output was
// diffed byte-for-byte against themes.ts's own garden entry while this
// module was built (only the entry's descriptive // comments differ —
// formatThemeEntry deliberately emits none, since a theme's prose belongs to
// whoever curates it, not to a generated recipe).
//
// v4.1 "Set Dressing" (IDEA-030/031) rework: MazeTheme.props (a density
// population list) is GONE from themes.ts, replaced by two EXPLICIT
// placement arrays — `placements` (apron props) and `wallDecor` (wall-top
// components) — each a flat list of `{ propId, tile, ... }` entries
// referencing the reusable prop library (src/game/props.ts) by id rather
// than describing a shape/color/density population inline. WorkingTheme
// below mirrors that: `placements`/`wallDecor` are genuinely mutable ARRAYS
// (push/splice-able, unlike MazeTheme's `readonly` ones) so
// boardPlacement.ts's add/select/edit/remove flow can mutate them directly,
// exactly the same "mutable working copy of a readonly registry field" story
// WorkingPalette.bloomColors already told pre-v4.1 — just promoted from one
// array field to two whole placement arrays. Unlike bloomColors (a plain
// `number[]`) or the old WorkingThemeProp.colors, a PropPlacement/
// WallDecorPlacement entry is itself an object with a few primitive/tuple
// fields — those fields are edited IN PLACE on the object (boardPlacement.ts
// reassigns `.offset`/`.rotationY`/`.scale`/`.propId` directly), so no
// per-field mutable-override interface is needed the way WorkingPalette
// needed one for its color array — only the OUTER arrays need to be
// mutable, not `readonly`, and `tile`/`offset` need to be mutable TUPLES
// (not `readonly [number, number]`) so a single-axis assignment
// (`placement.offset[0] = x`) type-checks.
import type { MazeTheme, ThemePalette } from "../game/themes";
// IDEA-034 ("💾 Save to themes.ts"): the RAW source text of themes.ts, loaded
// via Vite's `?raw` import suffix (see fileExport.ts's identical
// `charactersSource` import for the established precedent — Vite treats a
// `?raw` import as "give me the file's exact text as a string", used here for
// the SAME reason fileExport.ts uses it on characters.ts: to splice an edited
// entry back into the file's real byte-for-byte formatting rather than
// regenerating the whole file from scratch and losing the human-authored
// prose comments the OTHER (non-edited) theme entries carry (see e.g. the
// "Identity note (two tuning passes)" comment on Night City below its own
// entry in themes.ts) — a full regeneration would silently discard every
// theme's own descriptive comments except the one being edited, which
// generateFullThemesFile must not do.
import themesSource from "../game/themes.ts?raw";

/** Same shape as ThemePalette, but `bloomColors` is a genuinely mutable
 *  array — a deep-copied WORKING palette the inspector's add/remove-bloom-
 *  color controls push/pop directly, unlike the registry's `readonly`
 *  MAZE_THEMES entries (see cloneWorkingTheme below, the only place a
 *  ThemePalette becomes a WorkingPalette). Structurally assignable back to
 *  ThemePalette wherever a MazeTheme is expected (applyBoardTheme, etc). */
export interface WorkingPalette extends Omit<ThemePalette, "bloomColors"> {
  bloomColors: number[];
}

/** Same shape as PropPlacement (themes.ts), but `tile`/`offset` are
 *  genuinely mutable 2-tuples (the registry's are `readonly [number,
 *  number]`) — a placement's `tile` never changes after creation (see
 *  boardPlacement.ts: a slot pick either selects the EXISTING placement at
 *  that tile or creates a NEW one there — there's no "drag this placement to
 *  a different tile" gesture in this version), but `offset` IS edited in
 *  place by the inspector's X/Z sliders and the arrow-key nudge, so both
 *  need to be non-readonly to assign into (`placement.offset = [x, z]` /
 *  `placement.offset[0] = x`) without a type error. Structurally assignable
 *  back to PropPlacement wherever a MazeTheme is expected
 *  (applyBoardTheme/buildProps only ever READ these fields). */
export interface WorkingPropPlacement {
  propId: string;
  tile: [number, number];
  offset: [number, number];
  rotationY: number;
  scale: number;
}

/** Same shape as WallDecorPlacement (themes.ts), mutable `tile` for the same
 *  structural-assignability reason as WorkingPropPlacement above (no
 *  `offset` field — wall-top placements sit dead-center on their tile, see
 *  themes.ts's WallDecorPlacement doc comment). */
export interface WorkingWallDecorPlacement {
  propId: string;
  tile: [number, number];
  rotationY: number;
  scale: number;
}

export interface WorkingTheme {
  id: string;
  name: string;
  price: number;
  palette: WorkingPalette;
  /** Mutable working copy of MazeTheme.placements (IDEA-030, apron props) —
   *  boardPlacement.ts's add/remove/select flow pushes/splices this array
   *  directly (see boardPlacement.ts's addPlacement/removePlacement), same
   *  "genuinely mutable array, not the registry's readonly one" story as
   *  bloomColors above, just promoted to a whole placement-object array. */
  placements: WorkingPropPlacement[];
  /** Mutable working copy of MazeTheme.wallDecor (IDEA-031, wall-top
   *  components) — same mutability story as `placements` above, kept as a
   *  SEPARATE array (not a `placements` entry with a "kind" flag) because a
   *  wall-top placement has a materially different shape (no `offset`,
   *  different height seating in the render layer — see board.ts's
   *  buildWallDecor vs buildProps) and a different candidate-tile set (wall
   *  tiles, not apron tiles) — keeping them as two arrays mirrors
   *  MazeTheme's own field split exactly, so codegen/clone/inspector never
   *  need a runtime "which kind is this entry" branch. */
  wallDecor: WorkingWallDecorPlacement[];
}

/** Deep-copies a registry MazeTheme into an independent WorkingTheme —
 *  the ONLY way board mode reads a MAZE_THEMES entry; nothing here or in
 *  main.ts/boardInspector.ts/boardPlacement.ts ever holds a reference into
 *  the registry object itself, so editing in the editor can never corrupt
 *  (or even observably touch) `src/game/themes.ts`'s MAZE_THEMES at runtime.
 *  `placements`/`wallDecor` entries are copied as fresh objects (not just a
 *  fresh outer array of the SAME inner objects) so editing one placement's
 *  `.offset`/`.rotationY` can never reach back into the registry's own
 *  frozen entry either — the same "genuinely independent, not just a
 *  shallow array copy" discipline bloomColors' `[...theme.palette.
 *  bloomColors]` already applied to a flat number array, just repeated
 *  per-object here since placements are objects, not numbers. */
export function cloneWorkingTheme(theme: MazeTheme): WorkingTheme {
  return {
    id: theme.id,
    name: theme.name,
    price: theme.price,
    palette: { ...theme.palette, bloomColors: [...theme.palette.bloomColors] },
    placements: theme.placements.map((p) => ({
      propId: p.propId,
      tile: [p.tile[0], p.tile[1]],
      offset: [p.offset[0], p.offset[1]],
      rotationY: p.rotationY,
      scale: p.scale,
    })),
    wallDecor: theme.wallDecor.map((p) => ({
      propId: p.propId,
      tile: [p.tile[0], p.tile[1]],
      rotationY: p.rotationY,
      scale: p.scale,
    })),
  };
}

function hex(n: number): string {
  return `0x${Math.max(0, Math.min(0xffffff, Math.round(n))).toString(16).padStart(6, "0")}`;
}

/** JSON.stringify escapes exactly what a JS string literal needs (quotes,
 *  backslashes, control chars) — reused here instead of hand-rolling that,
 *  since id/name are free-text GUI fields the user can type anything into. */
function str(s: string): string {
  return JSON.stringify(s);
}

function bloomColorsLiteral(colors: readonly number[]): string {
  if (colors.length === 0) return "[]";
  return `[${colors.map(hex).join(", ")}]`;
}

/** Formats a `[number, number]` tuple field (tile/offset) as a compact
 *  inline array literal — matches every hand-authored PropPlacement/
 *  WallDecorPlacement entry in themes.ts (e.g. `tile: [19, 4]`, `offset:
 *  [-0.24, -0.162]`). Tile coords are always integers (round defensively —
 *  a slot pick always assigns integers, but this keeps the emitted code
 *  honest even if a future float tile coord ever slipped in); offset/scale/
 *  rotationY keep their exact float precision. */
function tileLiteral([x, y]: readonly [number, number]): string {
  return `[${Math.round(x)}, ${Math.round(y)}]`;
}
function offsetLiteral([x, z]: readonly [number, number]): string {
  return `[${x}, ${z}]`;
}

/** Formats one PropPlacement as a single-line object literal — field order
 *  propId/tile/offset/rotationY/scale, exactly matching every hand-authored
 *  entry in themes.ts's `placements: [...]` arrays (see e.g. garden's shrub
 *  lines: `{ propId: "shrub", tile: [19, 4], offset: [-0.24, -0.162],
 *  rotationY: 5.691, scale: 0.949 },`). One placement per line — themes.ts
 *  never wraps a placement entry across lines, so this deliberately doesn't
 *  either. */
function placementEntryLiteral(p: WorkingPropPlacement): string {
  return `{ propId: ${str(p.propId)}, tile: ${tileLiteral(p.tile)}, offset: ${offsetLiteral(p.offset)}, rotationY: ${p.rotationY}, scale: ${p.scale} },`;
}

/** Formats one WallDecorPlacement as a single-line object literal — field
 *  order propId/tile/rotationY/scale, matching themes.ts's `wallDecor:
 *  [...]` entries (see e.g. city's lamp-post lines: `{ propId: "lamp-post",
 *  tile: [3, 3], rotationY: 0, scale: 1 },`). No `offset` field (wall-top
 *  placements have none — see WorkingWallDecorPlacement's doc comment). */
function wallDecorEntryLiteral(p: WorkingWallDecorPlacement): string {
  return `{ propId: ${str(p.propId)}, tile: ${tileLiteral(p.tile)}, rotationY: ${p.rotationY}, scale: ${p.scale} },`;
}

/** Formats a `placements: [...]` or `wallDecor: [...]` array FIELD,
 *  `i1`-indented to sit as a sibling of `palette:` inside the theme object,
 *  with each entry one level deeper (`i2`) — matches themes.ts's `wallDecor:
 *  [],` one-liner for an empty array (garden/forest/beach/park) and its
 *  multi-line bracketed form otherwise (city). `fieldName` and `entryFn` are
 *  parameterized so this one function serves both `placements` (PropPlacement
 *  entries) and `wallDecor` (WallDecorPlacement entries) without duplicating
 *  the empty-vs-multiline branching twice. */
function placementArrayLiteral<T>(
  fieldName: string,
  entries: readonly T[],
  entryFn: (entry: T) => string,
  i1: string,
  i2: string,
): string {
  if (entries.length === 0) return `${i1}${fieldName}: [],`;
  const lines = entries.map((entry) => `${i2}${entryFn(entry)}`).join("\n");
  return [`${i1}${fieldName}: [`, lines, `${i1}],`].join("\n");
}

/**
 * Formats `theme` as a `MazeTheme` object literal, matching themes.ts's
 * existing entries: same field order as the ThemePalette interface
 * declaration (bg/backdropTop, wall.../floor.../biscuit..., hemi.../sun.../
 * rim..., bloom.../speck...) followed by `placements` then `wallDecor`
 * (matching MazeTheme's own field order: id/name/price/palette/placements/
 * wallDecor), same 2-space-per-level indent, trailing comma after every
 * field including the last (themes.ts's own style — see any entry in
 * MAZE_THEMES), and hex-number literals for every color slot. `indent` is
 * the base indent (in spaces) of the entry itself — 2 to match a fresh array
 * entry pasted at MAZE_THEMES's top level.
 */
export function formatThemeEntry(theme: WorkingTheme, indent = 2): string {
  const i0 = " ".repeat(indent);
  const i1 = " ".repeat(indent + 2);
  const i2 = " ".repeat(indent + 4);
  const p = theme.palette;

  const paletteLines = [
    `${i2}bg: ${hex(p.bg)},`,
    `${i2}backdropTop: ${hex(p.backdropTop)},`,
    `${i2}wall: ${hex(p.wall)},`,
    `${i2}wallEmissive: ${hex(p.wallEmissive)},`,
    `${i2}wallEmissiveIntensity: ${p.wallEmissiveIntensity},`,
    `${i2}floor: ${hex(p.floor)},`,
    `${i2}floorEmissive: ${hex(p.floorEmissive)},`,
    `${i2}floorEmissiveIntensity: ${p.floorEmissiveIntensity},`,
    `${i2}biscuit: ${hex(p.biscuit)},`,
    `${i2}biscuitEmissive: ${hex(p.biscuitEmissive)},`,
    `${i2}biscuitEmissiveIntensity: ${p.biscuitEmissiveIntensity},`,
    `${i2}hemiSky: ${hex(p.hemiSky)},`,
    `${i2}hemiGround: ${hex(p.hemiGround)},`,
    `${i2}hemiIntensity: ${p.hemiIntensity},`,
    `${i2}sunColor: ${hex(p.sunColor)},`,
    `${i2}sunIntensity: ${p.sunIntensity},`,
    `${i2}rimColor: ${hex(p.rimColor)},`,
    `${i2}rimIntensity: ${p.rimIntensity},`,
    `${i2}bloomColors: ${bloomColorsLiteral(p.bloomColors)},`,
    `${i2}bloomEmissiveIntensity: ${p.bloomEmissiveIntensity},`,
    `${i2}bloomChance: ${p.bloomChance},`,
    `${i2}speckColor: ${hex(p.speckColor)},`,
    `${i2}speckEmissive: ${hex(p.speckEmissive)},`,
    `${i2}speckChance: ${p.speckChance},`,
  ].join("\n");

  return [
    `${i0}{`,
    `${i1}id: ${str(theme.id)},`,
    `${i1}name: ${str(theme.name)},`,
    `${i1}price: ${theme.price},`,
    `${i1}palette: {`,
    paletteLines,
    `${i1}},`,
    placementArrayLiteral("placements", theme.placements, placementEntryLiteral, i1, i2),
    placementArrayLiteral("wallDecor", theme.wallDecor, wallDecorEntryLiteral, i1, i2),
    `${i0}},`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// IDEA-034 "💾 Save to themes.ts" — writes the COMPLETE themes.ts back to
// disk with the working theme's entry spliced into MAZE_THEMES, exactly like
// characters.ts's IDEA-032 "Save to characters.ts" writes the complete file
// (see fileExport.ts's generateFullFile + main.ts's saveFileBtn). Unlike that
// character-mode flow (which INSERTS a fresh edit block just before a fixed
// `return g;`, always additive, never replacing existing code), a theme SAVE
// must REPLACE the one array entry that changed — themes.ts's entries are
// hand-authored data with their OWN descriptive comments per theme
// (see e.g. Night City's "Identity note" comment above), so regenerating the
// WHOLE array from workingTheme + the 5 untouched registry entries would
// silently drop every comment except the one theme being edited. Splicing
// only the ONE matching entry's text (found by brace-counting, not full
// re-serialization — see findEntrySpan below) preserves every other entry
// completely untouched, byte-for-byte, comments included.

/** A [start, end) span of source text, `end` exclusive (matches how
 *  `.slice(start, end)` is used everywhere below — mirrors sourceParse.ts's
 *  own FunctionRange shape, just for an object-literal entry instead of a
 *  whole function). */
interface EntrySpan {
  start: number;
  end: number;
}

/** Comment/string-aware brace-matcher: given the index of an OPENING `{`,
 *  returns the index of its matching CLOSING `}` (inclusive of neither
 *  bracket in the semantics — this returns the closer's own index, matching
 *  sourceParse.ts's findFunctionRange's own `end` field, which is likewise
 *  "the index of the closing brace itself"). Skips `//` and `/* *\/` comments
 *  and `'…'`/`"…"`/`` `…` `` string/template literals so a `{`/`}` INSIDE a
 *  comment or string (there are none in themes.ts today, but a future
 *  hand-added descriptive comment easily could contain one) never desyncs
 *  the depth count. Returns null if the braces never balance before the
 *  source ends (a malformed/hand-edited themes.ts) — every caller here
 *  treats that as "give up, fall back to the copy-code button" rather than
 *  crash, per this whole file's own established failure mode (see
 *  saveEditorFile's own "never throws" discipline). This is the SAME state
 *  machine as sourceParse.ts's findFunctionRange, generalized to start from
 *  an already-known `{` index instead of also having to locate the `{` after
 *  a function-name marker — not imported from there because that module
 *  scans FOR a `export function name(` marker specifically, a materially
 *  different first step than this module's own "I already know where the
 *  array's `[` is, now split it" starting point. */
function matchBrace(src: string, openIdx: number): number | null {
  let depth = 0;
  let i = openIdx;
  let state: "code" | "line" | "block" | "single" | "double" | "template" = "code";
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (state === "code") {
      if (c === "/" && next === "/") state = "line";
      else if (c === "/" && next === "*") state = "block";
      else if (c === "'") state = "single";
      else if (c === '"') state = "double";
      else if (c === "`") state = "template";
      else if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) return i;
      }
    } else if (state === "line") {
      if (c === "\n") state = "code";
    } else if (state === "block") {
      if (c === "*" && next === "/") {
        state = "code";
        i++;
      }
    } else if (state === "single" || state === "double") {
      if (c === "\\") i++;
      else if ((state === "single" && c === "'") || (state === "double" && c === '"')) state = "code";
    } else {
      // template literal — no ${}-nesting support needed; themes.ts has none
      if (c === "\\") i++;
      else if (c === "`") state = "code";
    }
    i++;
  }
  return null; // unbalanced
}

/** Splits the `MAZE_THEMES: readonly MazeTheme[] = [ ... ]` array body into
 *  its top-level entry spans — each span covers exactly one `{ id: ...,
 *  ... }` object literal, INCLUDING its own leading indentation whitespace up
 *  to (but not past) the previous entry's trailing `\n`, so replacing a span
 *  with a freshly `formatThemeEntry`-generated string (which itself starts
 *  with its own `i0`-indented `{`) reproduces the exact same indent/blank-
 *  line rhythm the file already has. Returns null if `MAZE_THEMES`'s opening
 *  `[` can't be found or its matching `]` never resolves (a malformed/
 *  drastically-hand-edited themes.ts) — same "fail soft, let the caller fall
 *  back" contract as matchBrace. */
function findThemeEntrySpans(src: string): EntrySpan[] | null {
  const arrayMarker = "export const MAZE_THEMES: readonly MazeTheme[] = [";
  const arrayStart = src.indexOf(arrayMarker);
  if (arrayStart === -1) return null;
  const bracketOpen = arrayStart + arrayMarker.length - 1; // the "[" itself
  const bracketClose = findMatchingBracket(src, bracketOpen);
  if (bracketClose === null) return null;

  const spans: EntrySpan[] = [];
  let i = bracketOpen + 1;
  while (i < bracketClose) {
    const c = src[i];
    if (c === "{") {
      // This entry's span starts at the BEGINNING OF ITS LINE (so the
      // replacement swallows the entry's own leading indentation exactly
      // once, rather than the caller having to re-indent a bare `{`) — walk
      // back to the character right after the previous `\n`.
      let lineStart = i;
      while (lineStart > 0 && src[lineStart - 1] !== "\n") lineStart--;
      const entryClose = matchBrace(src, i);
      if (entryClose === null) return null;
      // Include the entry's own trailing `,` (and nothing after it) in the
      // span — themes.ts's own style puts a trailing comma after EVERY
      // entry, including the last (see this file's own header comment on
      // formatThemeEntry's contract), so `entryClose + 1` (the comma) is
      // always safe to include without an existence check.
      const afterComma = src[entryClose + 1] === "," ? entryClose + 2 : entryClose + 1;
      spans.push({ start: lineStart, end: afterComma });
      i = afterComma;
    } else {
      i++;
    }
  }
  return spans;
}

/** Same brace-counting idea as matchBrace, specialized for `[`/`]` instead of
 *  `{`/`}` — MAZE_THEMES's own outer array delimiter. A separate tiny
 *  function rather than parameterizing matchBrace over which bracket pair to
 *  track: the two are used in genuinely different places (matchBrace finds
 *  an ENTRY's `}`, this finds the whole ARRAY's `]`) and sharing one
 *  parameterized implementation would cost more in signature complexity than
 *  the ~20 duplicated lines save. */
function findMatchingBracket(src: string, openIdx: number): number | null {
  let depth = 0;
  let i = openIdx;
  let state: "code" | "line" | "block" | "single" | "double" | "template" = "code";
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (state === "code") {
      if (c === "/" && next === "/") state = "line";
      else if (c === "/" && next === "*") state = "block";
      else if (c === "'") state = "single";
      else if (c === '"') state = "double";
      else if (c === "`") state = "template";
      else if (c === "[") depth++;
      else if (c === "]") {
        depth--;
        if (depth === 0) return i;
      }
    } else if (state === "line") {
      if (c === "\n") state = "code";
    } else if (state === "block") {
      if (c === "*" && next === "/") {
        state = "code";
        i++;
      }
    } else if (state === "single" || state === "double") {
      if (c === "\\") i++;
      else if ((state === "single" && c === "'") || (state === "double" && c === '"')) state = "code";
    } else {
      if (c === "\\") i++;
      else if (c === "`") state = "code";
    }
    i++;
  }
  return null;
}

/** Finds which entry span (if any) contains `id: "<themeId>",` as ITS OWN
 *  first field, right after the entry's own opening `{` (skipping only
 *  whitespace between them) — every hand-authored themes.ts entry AND every
 *  formatThemeEntry-generated one puts `id` first (see formatThemeEntry's own
 *  field-order contract), so this is a reliable, simple match rather than a
 *  full JS-object parse. Matching on the id's OWN entry position (not just
 *  "does this span contain the string anywhere") avoids a false match if a
 *  theme's `name` field or a comment happened to also contain the literal id
 *  string elsewhere. */
function findSpanForId(src: string, spans: readonly EntrySpan[], id: string): EntrySpan | undefined {
  const needle = `id: ${str(id)},`;
  return spans.find((span) => {
    const entryText = src.slice(span.start, span.end);
    const braceIdx = entryText.indexOf("{");
    if (braceIdx === -1) return false;
    const afterBrace = entryText.slice(braceIdx + 1).trimStart();
    return afterBrace.startsWith(needle);
  });
}

/**
 * Produces the COMPLETE themes.ts source with `theme`'s entry written back
 * into MAZE_THEMES — replacing the entry whose `id` matches `baseThemeId`
 * (the registry id this working theme was originally cloned FROM — NOT
 * necessarily `theme.id`, since the id field is free-text-editable; see
 * main.ts's own `loadedBaseThemeId` bookkeeping) if `baseThemeId` still
 * exists in the file, or APPENDING a brand-new entry to the end of the array
 * if it doesn't (covers both "I edited theme X in place" and "I authored a
 * whole new theme starting from X's palette as a base" — the "authoring a
 * NEW theme: editable id/name/price still works" section of
 * scripts/test-editor-board.ts already exercises the latter shape via "Copy
 * theme code"; this is the same authoring flow, just saved to disk instead
 * of the clipboard).
 *
 * Returns null if MAZE_THEMES's own array delimiters can't be located at all
 * (a themes.ts edited into an unrecognizable shape) — the caller falls back
 * to the "Copy theme code" button, mirroring generateFullFile's own
 * null-on-failure contract in fileExport.ts.
 */
export function generateFullThemesFile(theme: WorkingTheme, baseThemeId: string): string | null {
  const src = themesSource;
  const spans = findThemeEntrySpans(src);
  if (!spans) return null;

  const formatted = formatThemeEntry(theme, 2);
  const targetSpan = findSpanForId(src, spans, baseThemeId);

  if (targetSpan) {
    return src.slice(0, targetSpan.start) + formatted + "\n" + src.slice(targetSpan.end);
  }

  // baseThemeId no longer exists in the file (or was never a registry id in
  // the first place) — append as a new final entry, right before the LAST
  // existing span's own end (so it lands inside the array, before the
  // closing `] as const;`, with the same one-entry-per-line rhythm every
  // other entry already has).
  const lastSpan = spans[spans.length - 1];
  if (!lastSpan) return null; // MAZE_THEMES somehow has zero entries — nothing to anchor an append to
  return src.slice(0, lastSpan.end) + formatted + "\n" + src.slice(lastSpan.end);
}
