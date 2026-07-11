// OWNER: character editor (IDEA-025, dev-only).
// Comment/string-aware scanning of characters.ts source text, shared by the
// source-view panel (extract a builder to display) and the full-file export
// (find where to inject the edit block). Fails soft: callers get null and
// fall back to whole-file behavior.

export interface FunctionRange {
  /** Index of the extraction start — the jsdoc block above the function if
   *  there is one, else the `export function` keyword itself. */
  start: number;
  /** Index of `export function name(`. */
  fnStart: number;
  /** Index of the function's closing `}`. */
  end: number;
}

/** Locates `export function <name>(...)` { ... } via brace counting that
 *  skips comments and strings. Returns null if not found or unbalanced. */
export function findFunctionRange(src: string, name: string): FunctionRange | null {
  const marker = `export function ${name}(`;
  const fnStart = src.indexOf(marker);
  if (fnStart === -1) return null;

  // Include the jsdoc block immediately above, if any.
  let start = fnStart;
  const trimmed = src.slice(0, fnStart).trimEnd();
  if (trimmed.endsWith("*/")) {
    const open = trimmed.lastIndexOf("/**");
    if (open !== -1) start = open;
  }

  const braceStart = src.indexOf("{", fnStart);
  if (braceStart === -1) return null;
  let depth = 0;
  let i = braceStart;
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
        if (depth === 0) return { start, fnStart, end: i };
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
      else if ((state === "single" && c === "'") || (state === "double" && c === '"'))
        state = "code";
    } else {
      // template literal — good enough without ${}-nesting for this file
      if (c === "\\") i++;
      else if (c === "`") state = "code";
    }
    i++;
  }
  return null; // unbalanced
}
