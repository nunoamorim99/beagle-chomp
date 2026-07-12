// OWNER: board & themes editor (IDEA-027, dev-only).
// Emits a ready-to-paste `MAZE_THEMES` entry from the current working
// palette/id/name/price — formatted to match src/game/themes.ts's existing
// entries byte-for-byte in shape: hex literals (0xRRGGBB), the exact field
// order ThemePalette declares them in, trailing commas after every field
// (including the last), 2-space indent bump per nesting level (matching
// themes.ts's own style throughout). Round-trip contract: pasting the
// output as a new array entry (or replacing an existing one) inside
// MAZE_THEMES must compile as-is and reproduce the edited look — verified
// two ways: scripts/test-editor-board.ts's "Copy theme code" checks
// (round-trip a live edit through `new Function` as a real object literal)
// and, by construction, formatThemeEntry's output was diffed byte-for-byte
// against themes.ts's own garden entry while this module was built (only
// the entry's descriptive // comments differ — formatThemeEntry
// deliberately emits none, since a theme's prose belongs to whoever curates
// it, not to a generated recipe).
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

export interface WorkingTheme {
  id: string;
  name: string;
  price: number;
  palette: WorkingPalette;
}

/** Deep-copies a registry MazeTheme into an independent WorkingTheme —
 *  the ONLY way board mode reads a MAZE_THEMES entry; nothing here or in
 *  main.ts/boardInspector.ts ever holds a reference into the registry
 *  object itself, so editing in the editor can never corrupt (or even
 *  observably touch) `src/game/themes.ts`'s MAZE_THEMES at runtime. */
export function cloneWorkingTheme(theme: MazeTheme): WorkingTheme {
  return {
    id: theme.id,
    name: theme.name,
    price: theme.price,
    palette: { ...theme.palette, bloomColors: [...theme.palette.bloomColors] },
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

/**
 * Formats `theme` as a `MazeTheme` object literal, matching themes.ts's
 * existing entries: same field order as the ThemePalette interface
 * declaration (bg/backdropTop, wall.../floor.../biscuit..., hemi.../sun.../
 * rim..., bloom.../speck...), same 2-space-per-level indent, trailing comma
 * after every field including the last (themes.ts's own style — see any
 * entry in MAZE_THEMES), and hex-number literals for every color slot.
 * `indent` is the base indent (in spaces) of the entry itself — 2 to match a
 * fresh array entry pasted at MAZE_THEMES's top level.
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
    `${i0}},`,
  ].join("\n");
}
