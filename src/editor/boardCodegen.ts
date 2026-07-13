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
