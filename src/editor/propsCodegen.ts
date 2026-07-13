// OWNER: props library editor (IDEA-029, dev-only).
// Emits a ready-to-paste `PROP_LIBRARY` array from the current working
// library — formatted to match src/game/props.ts's existing entries
// byte-for-byte in shape: hex literals (0xRRGGBB), field order following
// PropParams' OWN declaration order (structure -> foliage/canopy ->
// building -> glowing head, exactly as props.ts declares them), arrays
// inline, trailing commas after every field (including the last), 2-space
// indent per nesting level. Round-trip contract: pasting the output as
// PROP_LIBRARY's array body (replacing everything between the `[` and `]`)
// must compile and reproduce the edited look — verified by
// scripts/test-editor-props.ts the same way test-editor-board.ts verifies
// formatThemeEntry (round-trip a live edit through `new Function` as a real
// array literal).
//
// Deliberately mirrors boardCodegen.ts's formatThemeEntry in spirit (same
// hex()/str() helpers, same "one entry per array element, params object
// inline") but is its own module — a prop's `params` field only ever
// includes keys the def actually SET (never every PropParams field with
// `undefined` placeholders), which is a different omission rule than
// ThemePalette's always-fully-populated object, so folding the two
// formatters into one shared module would need a branch per caller anyway.
import type { PropBaseShape } from "../game/props";
import type { WorkingPropDef, WorkingPropParams } from "./propsWorking";

function hex(n: number): string {
  return `0x${Math.max(0, Math.min(0xffffff, Math.round(n))).toString(16).padStart(6, "0")}`;
}

/** JSON.stringify escapes exactly what a JS string literal needs (quotes,
 *  backslashes, control chars) — id/name are free-text GUI fields the user
 *  can type anything into, same reasoning as boardCodegen.ts's own str(). */
function str(s: string): string {
  return JSON.stringify(s);
}

function colorsLiteral(colors: readonly number[]): string {
  return `[${colors.map(hex).join(", ")}]`;
}

/** Field order EXACTLY follows PropParams' own declaration in props.ts (see
 *  that file's doc comments grouping them structure / foliage-canopy /
 *  building / glowing-head) — a fixed emission order regardless of JS object
 *  key insertion order, so the output is stable and diffable against
 *  props.ts's own hand-authored entries. Only fields the def actually SET are
 *  emitted (props.ts's own convention: "a PropDef only lists what it
 *  overrides") — `undefined`/absent fields are skipped entirely, never
 *  emitted as `field: undefined,`. */
const PARAM_FIELD_ORDER: readonly (keyof WorkingPropParams)[] = [
  "height",
  "width",
  "segments",
  "tilt",
  "foliageColors",
  "trunkColor",
  "facadeColors",
  "windowRows",
  "windowCols",
  "windowColor",
  "windowEmissiveIntensity",
  "rooftop",
  "glowColor",
  "glowIntensity",
  "signBoardColor",
];

const COLOR_FIELDS = new Set<keyof WorkingPropParams>(["trunkColor", "windowColor", "glowColor", "signBoardColor"]);
const COLOR_LIST_FIELDS = new Set<keyof WorkingPropParams>(["foliageColors", "facadeColors"]);

/** Formats one param field as `key: value,` — colors as hex literals, color
 *  LISTS inline (`[0x.., 0x..]`), booleans/numbers as their own literal.
 *  Returns `null` for a field the def didn't set, so the caller can filter
 *  those out rather than emit `undefined`. */
function paramFieldLiteral(key: keyof WorkingPropParams, params: WorkingPropParams): string | null {
  const value = params[key];
  if (value === undefined) return null;
  if (COLOR_FIELDS.has(key)) return `${key}: ${hex(value as number)},`;
  if (COLOR_LIST_FIELDS.has(key)) return `${key}: ${colorsLiteral(value as readonly number[])},`;
  if (typeof value === "boolean") return `${key}: ${value},`;
  return `${key}: ${value},`;
}

/** Formats a def's `params: { ... }` field. An empty params object (every
 *  field at its factory default) emits `params: {},` on one line, matching
 *  how props.ts would author a bare-defaults def; a non-empty one emits one
 *  field per line at `i2` indent, matching every real PROP_LIBRARY entry
 *  (e.g. the streetlight/bloom/lamp-post entries above). */
function paramsLiteral(params: WorkingPropParams, i1: string, i2: string): string {
  const lines = PARAM_FIELD_ORDER.map((key) => paramFieldLiteral(key, params)).filter((l): l is string => l !== null);
  if (lines.length === 0) return `${i1}params: {},`;
  return [`${i1}params: {`, ...lines.map((l) => `${i2}${l}`), `${i1}},`].join("\n");
}

/** Formats one WorkingPropDef as a multi-line object literal (id/name/shape/
 *  params), `i1`-indented to sit as a direct element of the PROP_LIBRARY
 *  array — matches every hand-authored entry in props.ts (see e.g. the
 *  "shrub"/"oak"/"tower" entries: `{ id: ..., name: ..., shape: ...,
 *  params: {...} },`). */
function propEntryLiteral(def: WorkingPropDef, i1: string, i2: string, i3: string): string {
  return [
    `${i1}{`,
    `${i2}id: ${str(def.id)},`,
    `${i2}name: ${str(def.name)},`,
    `${i2}shape: ${str(def.shape)},`,
    paramsLiteral(def.params, i2, i3),
    `${i1}},`,
  ].join("\n");
}

/**
 * Formats `library` as a full `PROP_LIBRARY` array literal (the `export
 * const PROP_LIBRARY: readonly PropDef[] = [...] as const;` body's `[...]`
 * portion, WITH the surrounding `export const` declaration and `as const`
 * — a complete, paste-ready replacement for props.ts's own export, per the
 * task brief), one entry per theme, in the working array's current order
 * (whatever order add/duplicate/remove/reorder left it in — the codegen
 * never re-sorts). `indent` is the base indent (in spaces) of each entry —
 * 2 to match props.ts's own top-level array formatting.
 */
export function formatPropLibrary(library: readonly WorkingPropDef[], indent = 2): string {
  const i1 = " ".repeat(indent);
  const i2 = " ".repeat(indent + 2);
  const i3 = " ".repeat(indent + 4);
  const entries = library.map((def) => propEntryLiteral(def, i1, i2, i3)).join("\n");
  return [
    "export const PROP_LIBRARY: readonly PropDef[] = [",
    entries,
    "] as const;",
  ].join("\n");
}

/** Every shape name, for the inspector's dropdown — listed here (not derived
 *  from a type) since lil-gui's dropdown needs a label->value map and these
 *  ARE both the label and the value; matches PropBaseShape's own literal
 *  union in props.ts exactly (order follows that type's declaration). */
export const PROP_SHAPE_OPTIONS: readonly PropBaseShape[] = [
  "shrub",
  "tree",
  "pine",
  "palm",
  "building",
  "streetlight",
  "umbrella",
  "bloom",
  "sign",
];
