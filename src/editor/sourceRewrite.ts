// OWNER: character editor (IDEA-025 v3, dev-only).
// IN-PLACE source rewriting: the editor's Save edits the part's REAL
// definition instead of appending a generated override block before the
// builder's `return g;` (the old fileExport.ts behaviour).
//
// Why this module exists: the editor is a LEARNING tool first (IDEA-025) —
// you drag a part and you should see the exact line of three.js that produced
// it change. An appended block breaks that: the file becomes a definition
// followed by layers of corrections, blocks stack across sessions, and a
// deliberate change is indistinguishable from stray experiment residue (the
// editor-residue hazard, which shipped a chest-less beagle three times).
//
// Pure strings in, pure strings out — NO `three` import, so it is unit
// testable in Node (scripts/test-source-rewrite.ts) rather than only through
// Playwright.
//
// HONEST LIMITS — every one of these is reported, never faked:
//  * Parts declared inside a loop callback (the mirrored ears / side caps /
//    legs: one `const sideCap = ...` with a `s < 0 ? "sideCapL" : "sideCapR"`
//    name) have no per-side line to rewrite. Blocked, with a reason.
//  * Parts with no `const` of their own (auto-named tree nodes) likewise.
//  * A delete that would leave the variable referenced elsewhere in the
//    builder (`g.userData.parts`, a `.add()` of a child, `legs.push(...)`)
//    is refused rather than producing a file that will not compile.
import { findFunctionRange } from "./sourceParse";
import { runtimeOwnerFor, type Channel } from "./runtimeOwned";

/** Every rewrite either succeeds with new full-file text, or explains itself. */
export type RewriteResult =
  | { ok: true; src: string }
  | { ok: false; reason: string };

export type TransformProp = "position" | "rotation" | "scale";
export type Vec3 = readonly [number, number, number];

/** Matches codegen.ts's formatting so generated and rewritten code agree. */
function fmt(n: number): string {
  const r = Math.round(n * 1000) / 1000;
  return String(r === 0 ? 0 : r);
}

// --- statement scanning -----------------------------------------------------

export interface Statement {
  /** Index of the first non-whitespace character of the statement. */
  start: number;
  /** Index just past the statement's terminating `;`. */
  end: number;
  /** Index of the start of the statement's first line (indentation included),
   *  extended back over any contiguous comment lines that document it — a
   *  part's explanatory comment belongs to the part and dies with it. */
  lineStart: number;
  text: string;
  /** The leading whitespace of the statement's own line. */
  indent: string;
}

type ScanState = "code" | "line" | "block" | "single" | "double" | "template";

/**
 * Splits a function body into its TOP-LEVEL statements (depth 0 relative to
 * the body), comment- and string-aware. Statements nested inside a callback
 * or block are deliberately NOT returned — that is what makes loop-built
 * parts detectable as "not rewritable" instead of silently mangled.
 */
export function scanStatements(src: string, bodyStart: number, bodyEnd: number): Statement[] {
  const out: Statement[] = [];
  let depth = 0;
  let paren = 0;
  let state: ScanState = "code";
  let stmtStart = -1;
  let i = bodyStart;

  while (i < bodyEnd) {
    const c = src[i];
    const next = src[i + 1];

    if (state === "code") {
      if (c === "/" && next === "/") {
        state = "line";
        i += 2;
        continue;
      }
      if (c === "/" && next === "*") {
        state = "block";
        i += 2;
        continue;
      }
      if (c === "'") state = "single";
      else if (c === '"') state = "double";
      else if (c === "`") state = "template";
      else if (c === "{" || c === "[") depth++;
      else if (c === "}" || c === "]") {
        depth--;
        // A BLOCK statement (`for (…) { … }`, `if`, `while`) ends at its
        // closing brace — there is no `;` to wait for. Without this the
        // scanner ran straight past it and merged the loop with whatever
        // declaration came next, so that declaration became invisible: the
        // bee's `const sting` ended up buried inside a 577-character "for"
        // statement and the editor reported it as un-editable, loop-built,
        // when it is nothing of the sort.
        //
        // The catch is that braces also close object literals, arrow bodies
        // and class expressions, where the statement genuinely continues. The
        // next non-whitespace character tells them apart: an expression's
        // brace is always followed by something that carries on the expression
        // (`;`, `)`, `,`, `.`, `]`), while a block's is followed by the start
        // of the next statement.
        if (c === "}" && depth === 0 && paren === 0 && stmtStart !== -1) {
          const nextCh = nextCode(src, i + 1, bodyEnd);
          if (nextCh === "" || !";),.]:".includes(nextCh)) {
            out.push(makeStatement(src, stmtStart, i + 1));
            stmtStart = -1;
            i++;
            continue;
          }
        }
      } else if (c === "(") paren++;
      else if (c === ")") paren--;
      else if (depth === 0 && paren === 0 && c === ";") {
        if (stmtStart !== -1) {
          out.push(makeStatement(src, stmtStart, i + 1));
          stmtStart = -1;
        }
        i++;
        continue;
      }
      // The statement begins at the first non-whitespace code character.
      if (stmtStart === -1 && !/\s/.test(c)) stmtStart = i;
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
  return out;
}

/** The next character that is real code — skipping whitespace, line comments
 *  and block comments. Used to tell a block's closing brace from an
 *  expression's. Returns "" at the end of the body. */
function nextCode(src: string, from: number, end: number): string {
  let i = from;
  while (i < end) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      if (nl === -1 || nl >= end) return "";
      i = nl + 1;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const close = src.indexOf("*/", i + 2);
      if (close === -1 || close >= end) return "";
      i = close + 2;
      continue;
    }
    return c;
  }
  return "";
}

/** Extends a statement back over its own indentation and any contiguous
 *  `//` comment lines immediately above it (a part's documentation). */
function makeStatement(src: string, start: number, end: number): Statement {
  const ownLineStart = src.lastIndexOf("\n", start - 1) + 1;
  const indent = src.slice(ownLineStart, start);

  let lineStart = ownLineStart;
  for (;;) {
    const prevEnd = lineStart - 1; // the "\n" before this line
    if (prevEnd <= 0) break;
    const prevStart = src.lastIndexOf("\n", prevEnd - 1) + 1;
    const prevLine = src.slice(prevStart, prevEnd);
    if (!/^\s*\/\//.test(prevLine)) break;
    lineStart = prevStart;
  }

  return { start, end, lineStart, text: src.slice(start, end), indent };
}

/** Strips comments and string bodies so identifier checks never match text
 *  inside a comment (`// inside the haunch form`) or a `.name = "haunch"`. */
export function stripCommentsAndStrings(src: string): string {
  let out = "";
  let state: ScanState = "code";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (state === "code") {
      if (c === "/" && next === "/") {
        state = "line";
        i += 2;
        continue;
      }
      if (c === "/" && next === "*") {
        state = "block";
        i += 2;
        continue;
      }
      if (c === "'") {
        state = "single";
        i++;
        continue;
      }
      if (c === '"') {
        state = "double";
        i++;
        continue;
      }
      if (c === "`") {
        state = "template";
        i++;
        continue;
      }
      out += c;
    } else if (state === "line") {
      if (c === "\n") {
        state = "code";
        out += "\n";
      }
    } else if (state === "block") {
      if (c === "*" && next === "/") {
        state = "code";
        i++;
      }
    } else if (state === "single" || state === "double") {
      if (c === "\\") i++;
      else if ((state === "single" && c === "'") || (state === "double" && c === '"')) state = "code";
    } else if (c === "\\") i++;
    else if (c === "`") state = "code";
    i++;
  }
  return out;
}

// --- locating a part --------------------------------------------------------

export interface BuilderBody {
  /** Whole-file source. */
  src: string;
  /** Index just after the builder's opening `{`. */
  bodyStart: number;
  /** Index of the builder's closing `}`. */
  bodyEnd: number;
  statements: Statement[];
}

/** Locates a builder and scans its top-level statements. */
export function readBuilder(src: string, builderName: string): BuilderBody | null {
  const range = findFunctionRange(src, builderName);
  if (!range) return null;
  const braceStart = src.indexOf("{", range.fnStart);
  if (braceStart === -1) return null;
  const bodyStart = braceStart + 1;
  const bodyEnd = range.end;
  return { src, bodyStart, bodyEnd, statements: scanStatements(src, bodyStart, bodyEnd) };
}

export interface PartSource {
  varName: string;
  /** Index into `statements` of the `const <varName> = ...` declaration. */
  declIndex: number;
  /** Indices of every top-level statement belonging to this part, ascending —
   *  the declaration plus each `<varName>.…` statement and the `.add(<varName>)`
   *  that parents it. */
  indices: number[];
}

const DECL_RE = (v: string): RegExp => new RegExp(`^const\\s+${escapeRe(v)}\\s*[:=]`);

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Every top-level statement that belongs to `varName`. */
export function findPart(body: BuilderBody, varName: string): PartSource | null {
  const decl = DECL_RE(varName);
  const receiver = new RegExp(`^${escapeRe(varName)}\\s*\\.`);
  const parented = new RegExp(`\\.add\\(\\s*${escapeRe(varName)}\\s*\\)`);

  let declIndex = -1;
  const indices: number[] = [];

  body.statements.forEach((stmt, idx) => {
    const code = stripCommentsAndStrings(stmt.text).trim();
    if (decl.test(code)) {
      if (declIndex !== -1) {
        declIndex = -2; // declared more than once — ambiguous
        return;
      }
      declIndex = idx;
      indices.push(idx);
      return;
    }
    if (receiver.test(code) || parented.test(code)) indices.push(idx);
  });

  if (declIndex < 0) return null;
  return { varName, declIndex, indices };
}

/**
 * Why a part cannot be rewritten in place, or null when it can.
 * This is the check the inspector should surface BEFORE the user spends time
 * dragging something whose edit could never be saved.
 */
export function rewriteBlocker(src: string, builderName: string, varName: string): string | null {
  if (!/^[A-Za-z_$][\w$]*$/.test(varName)) {
    return `"${varName}" is not a plain variable name in the source.`;
  }
  const body = readBuilder(src, builderName);
  if (!body) return `Could not locate ${builderName}() in the source.`;

  if (findPart(body, varName)) return null;

  // Distinguish "declared inside a loop/callback" from "not there at all" —
  // the mirrored parts are the common, explainable case.
  const bodyCode = stripCommentsAndStrings(src.slice(body.bodyStart, body.bodyEnd));
  if (DECL_RE(varName).test(bodyCode) || new RegExp(`\\bconst\\s+${escapeRe(varName)}\\b`).test(bodyCode)) {
    return (
      `"${varName}" is declared more than once in ${builderName}() — ` +
      `its definition is ambiguous, so an in-place edit could hit the wrong one.`
    );
  }
  return (
    `"${varName}" has no top-level \`const\` in ${builderName}() — it is built inside a loop ` +
    `or callback (the mirrored parts share one statement per pair), so there is no single ` +
    `line to rewrite. Give it its own const first, or edit both sides in the source.`
  );
}

// --- transform rewriting ----------------------------------------------------

/** The canonical statement text for a transform, matching codegen.ts. */
function transformStatement(varName: string, prop: TransformProp, v: Vec3): string {
  if (prop === "scale" && v[0] === v[1] && v[1] === v[2]) {
    return `${varName}.scale.setScalar(${fmt(v[0])});`;
  }
  return `${varName}.${prop}.set(${fmt(v[0])}, ${fmt(v[1])}, ${fmt(v[2])});`;
}

/**
 * Rewrites `<varName>.<prop>` in the builder to `v`, editing the REAL lines:
 * existing `.set(...)` / `.setScalar(...)` / `.x = …` / `.copy(…)` statements
 * for that property are replaced by one canonical statement in the position
 * of the first of them; if the part has no statement for that property yet,
 * one is inserted directly after the part's declaration (and its `.name = …`
 * line, so the part's block keeps reading decl → name → transform → add).
 */
export function setTransform(
  src: string,
  builderName: string,
  varName: string,
  prop: TransformProp,
  v: Vec3,
): RewriteResult {
  const blocker = rewriteBlocker(src, builderName, varName);
  if (blocker) return { ok: false, reason: blocker };

  const body = readBuilder(src, builderName);
  if (!body) return { ok: false, reason: `Could not locate ${builderName}().` };
  const part = findPart(body, varName);
  if (!part) return { ok: false, reason: `Could not locate "${varName}".` };

  const propRe = new RegExp(`^${escapeRe(varName)}\\s*\\.\\s*${prop}\\b`);
  const existing = part.indices.filter((idx) =>
    propRe.test(stripCommentsAndStrings(body.statements[idx].text).trim()),
  );

  const statement = transformStatement(varName, prop, v);

  if (existing.length > 0) {
    // Replace the first, drop the rest — collapsing `.position.y = …` style
    // axis assignments into one authoritative statement.
    const keep = body.statements[existing[0]];
    const drop = existing.slice(1).map((idx) => body.statements[idx]);
    let out = spliceStatement(src, keep, keep.indent + statement);
    // Remove the extras back-to-front so earlier offsets stay valid.
    for (const stmt of [...drop].sort((a, b) => b.start - a.start)) {
      out = removeStatementFrom(out, stmt);
    }
    return { ok: true, src: out };
  }

  // No statement for this property yet — insert after the decl + `.name =`.
  const nameRe = new RegExp(`^${escapeRe(varName)}\\s*\\.\\s*name\\b`);
  let anchorIdx = part.declIndex;
  for (const idx of part.indices) {
    if (idx > anchorIdx && nameRe.test(stripCommentsAndStrings(body.statements[idx].text).trim())) {
      anchorIdx = idx;
    }
  }
  const anchor = body.statements[anchorIdx];
  const insertion = `\n${anchor.indent}${statement}`;
  return { ok: true, src: src.slice(0, anchor.end) + insertion + src.slice(anchor.end) };
}

/** Replaces one statement's full lines (comments included) with `text`. */
function spliceStatement(src: string, stmt: Statement, text: string): string {
  // Keep the statement's documenting comments — only the code line changes.
  const codeLineStart = src.lastIndexOf("\n", stmt.start - 1) + 1;
  return src.slice(0, codeLineStart) + text + src.slice(stmt.end);
}

/** Removes a statement and its own line (plus its documenting comments). */
function removeStatementFrom(src: string, stmt: Statement, withComments = false): string {
  const from = withComments ? stmt.lineStart : src.lastIndexOf("\n", stmt.start - 1) + 1;
  let to = stmt.end;
  // Swallow the rest of the line (trailing comment) and its newline.
  const nl = src.indexOf("\n", to);
  to = nl === -1 ? src.length : nl + 1;
  return src.slice(0, from) + src.slice(to);
}

// --- deletion ---------------------------------------------------------------

/**
 * Removes a part's definition entirely — declaration, its documenting
 * comments, every `<varName>.…` statement, and the `.add(<varName>)` that
 * parents it.
 *
 * REFUSES when the variable would still be referenced afterwards (a child
 * `.add()`ed to it, `g.userData.parts`, `legs.push(...)`) — deleting those
 * parts needs a human decision, and producing source that will not compile is
 * exactly the failure mode this whole module exists to end.
 */
export function deletePart(src: string, builderName: string, varName: string): RewriteResult {
  const blocker = rewriteBlocker(src, builderName, varName);
  if (blocker) return { ok: false, reason: blocker };

  const body = readBuilder(src, builderName);
  if (!body) return { ok: false, reason: `Could not locate ${builderName}().` };
  const part = findPart(body, varName);
  if (!part) return { ok: false, reason: `Could not locate "${varName}".` };

  // Anything attached TO this part would be orphaned by the delete.
  const childAdd = new RegExp(`^${escapeRe(varName)}\\s*\\.\\s*add\\s*\\(`);
  for (const idx of part.indices) {
    const code = stripCommentsAndStrings(body.statements[idx].text).trim();
    if (childAdd.test(code)) {
      return {
        ok: false,
        reason:
          `"${varName}" has other parts attached to it (\`${code.split("\n")[0]}\`). ` +
          `Delete or re-parent those first — removing it now would orphan them.`,
      };
    }
  }

  const stmts = part.indices.map((idx) => body.statements[idx]);
  let out = src;
  for (const stmt of [...stmts].sort((a, b) => b.start - a.start)) {
    out = removeStatementFrom(out, stmt, true);
  }

  // The invariant that keeps the file compiling: after the delete, the name
  // must be gone from the builder's CODE (comments may still mention the
  // form, which is fine and often still true of the silhouette).
  const after = readBuilder(out, builderName);
  if (!after) return { ok: false, reason: "The delete left the builder unparseable — aborted." };
  // PROPERTY names are not references to the variable: `{ nose: noseMat }`
  // and `coat.nose` both contain the word `nose` without using the part, and
  // a conservative match there refuses a delete that would compile fine.
  // (Shorthand `{ nose }` IS a reference and still matches — only `name:`
  // keys and `.name` accesses are dropped.)
  const leftover = stripCommentsAndStrings(out.slice(after.bodyStart, after.bodyEnd))
    .replace(new RegExp(String.raw`\b${escapeRe(varName)}\s*:`, "g"), " ")
    .replace(new RegExp(String.raw`\.\s*${escapeRe(varName)}\b`, "g"), " ");
  const stillUsed = new RegExp(`\\b${escapeRe(varName)}\\b`).test(leftover);
  if (stillUsed) {
    return {
      ok: false,
      reason:
        `"${varName}" is still referenced elsewhere in ${builderName}() (userData, an array, ` +
        `or another part), so removing its definition would not compile. Unhook those uses first.`,
    };
  }

  return { ok: true, src: out };
}

// --- visibility & material --------------------------------------------------

/** Rewrites/inserts `<varName>.visible = <value>;` in the part's own block. */
export function setVisible(
  src: string,
  builderName: string,
  varName: string,
  value: boolean,
): RewriteResult {
  const blocker = rewriteBlocker(src, builderName, varName);
  if (blocker) return { ok: false, reason: blocker };

  const body = readBuilder(src, builderName);
  if (!body) return { ok: false, reason: `Could not locate ${builderName}().` };
  const part = findPart(body, varName);
  if (!part) return { ok: false, reason: `Could not locate "${varName}".` };

  const visRe = new RegExp(`^${escapeRe(varName)}\\s*\\.\\s*visible\\b`);
  const statement = `${varName}.visible = ${value};`;
  const existing = part.indices.filter((idx) =>
    visRe.test(stripCommentsAndStrings(body.statements[idx].text).trim()),
  );
  if (existing.length > 0) {
    const stmt = body.statements[existing[0]];
    return { ok: true, src: spliceStatement(src, stmt, stmt.indent + statement) };
  }
  const decl = body.statements[part.declIndex];
  return {
    ok: true,
    src: src.slice(0, decl.end) + `\n${decl.indent}${statement}` + src.slice(decl.end),
  };
}

/**
 * Rewrites a material's `roughness:` in its `new THREE.MeshStandardMaterial({…})`
 * construction — a real, single-owner value, so it edits cleanly in place.
 *
 * Material COLOUR is deliberately not handled here: for the beagle's four coat
 * materials the colour is owned by the equipped skin (`applyBeagleSkin` resets
 * it from `skin.coat` on every apply), and for the enemies it arrives as a
 * constructor argument — so writing a literal into characters.ts would be
 * overwritten at runtime. That is IDEA-041's job; until then the caller is told
 * why rather than being handed a change that silently will not stick.
 */
export function setMaterialRoughness(
  src: string,
  builderName: string,
  varName: string,
  value: number,
): RewriteResult {
  const blocker = rewriteBlocker(src, builderName, varName);
  if (blocker) return { ok: false, reason: blocker };

  const body = readBuilder(src, builderName);
  if (!body) return { ok: false, reason: `Could not locate ${builderName}().` };
  const part = findPart(body, varName);
  if (!part) return { ok: false, reason: `Could not locate "${varName}".` };

  const decl = body.statements[part.declIndex];
  if (!/MeshStandardMaterial/.test(decl.text)) {
    return { ok: false, reason: `"${varName}" is not a MeshStandardMaterial declaration.` };
  }

  const rough = /roughness:\s*[\d.]+/;
  let text: string;
  if (rough.test(decl.text)) {
    text = decl.text.replace(rough, `roughness: ${fmt(value)}`);
  } else if (/\{\s*[^}]*\}/.test(decl.text)) {
    text = decl.text.replace(/(\{\s*[^}]*?)(\s*\})/, `$1, roughness: ${fmt(value)}$2`);
  } else {
    return { ok: false, reason: `Could not find where to set roughness on "${varName}".` };
  }
  return { ok: true, src: spliceStatement(src, decl, decl.indent + text) };
}

/**
 * Rewrites a material's `color:` in its `new THREE.MeshStandardMaterial({…})`
 * construction, when that colour is a LITERAL the builder owns.
 *
 * This was simply missing: every colour edit was refused with "nothing owns
 * this colour as a literal", which is true of the team-coloured body materials
 * (they take `color` as an argument) and of the beagle's coat (the skin owns
 * it) — but flatly wrong for the many fixed materials a builder declares
 * outright, like an eye's sclera. Those are as rewritable as roughness is.
 */
/** A material construction a builder can own the colour of. */
const MATERIAL_DECL_RE = /\btoon\(|new THREE\.Mesh[A-Za-z]*Material\(/;

/**
 * Colour-literal → variable name for every material a builder declares
 * (`const x = toon({ color: 0x… })` / `new THREE.Mesh…Material({ color: 0x… })`).
 * The editor only sees runtime materials, not the lines that made them, so
 * this is how a fixed material like an eye's sclera gets its REAL name back:
 * match by colour, but only where the colour is unique within the builder —
 * two declarations sharing a hex are left unnamed rather than guessed.
 */
export function materialDeclsByColor(src: string, builderName: string): Map<number, string> {
  const body = readBuilder(src, builderName);
  const byColor = new Map<number, string>();
  const ambiguous = new Set<number>();
  if (!body) return byColor;
  for (const stmt of body.statements) {
    const code = stripCommentsAndStrings(stmt.text).trim();
    const m = /^const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:toon\(|new THREE\.Mesh[A-Za-z]*Material\()\s*\{[^}]*?color:\s*0x([0-9a-fA-F]+)/.exec(code);
    if (!m) continue;
    const hex = parseInt(m[2], 16);
    if (byColor.has(hex) || ambiguous.has(hex)) {
      byColor.delete(hex);
      ambiguous.add(hex);
      continue;
    }
    byColor.set(hex, m[1]);
  }
  return byColor;
}

export function setMaterialColor(
  src: string,
  builderName: string,
  varName: string,
  hex: number,
): RewriteResult {
  const blocker = rewriteBlocker(src, builderName, varName);
  if (blocker) return { ok: false, reason: blocker };

  const body = readBuilder(src, builderName);
  if (!body) return { ok: false, reason: `Could not locate ${builderName}().` };
  const part = findPart(body, varName);
  if (!part) return { ok: false, reason: `Could not locate "${varName}".` };

  const decl = body.statements[part.declIndex];
  // Any material construction the builders use: the project's toon() factory
  // (every lit surface) or a raw THREE.Mesh*Material (the unlit glints). The
  // old MeshStandardMaterial-only gate refused every colour on a cel-shaded
  // character, which is exactly the surface the editor exists to tune.
  if (!MATERIAL_DECL_RE.test(decl.text)) {
    return { ok: false, reason: `"${varName}" is not a material declaration (toon({…}) or new THREE.Mesh…Material({…})).` };
  }

  const literal = /color:\s*0x[0-9a-fA-F]+/;
  if (!literal.test(decl.text)) {
    // `color` with no literal means the value arrives from outside — the team
    // colour argument, a skin, a shared constant. Saying so is more useful than
    // a generic refusal, because it points at where the colour really lives.
    return {
      ok: false,
      reason:
        `"${varName}" does not hold its colour as a literal — it is passed into ${builderName}() ` +
        `or read from a shared constant, so there is no hex here to rewrite. Enemy team colours ` +
        `live in src/game/config.ts (COLORS) and beagle coats in src/game/cosmetics.ts.`,
    };
  }

  const text = decl.text.replace(literal, `color: 0x${hex.toString(16).padStart(6, "0")}`);
  return { ok: true, src: spliceStatement(src, decl, decl.indent + text) };
}

// --- applying a whole editing session ---------------------------------------

/** What the editor changed, in plain data — deliberately free of `three` and
 *  of EditLog itself, so this module stays Node-testable. main.ts adapts. */
export interface EditLogInput {
  transforms: Array<{
    varName: string;
    isAutoNamed: boolean;
    locator: string;
    position?: Vec3;
    rotation?: Vec3;
    scale?: Vec3;
    visible?: boolean;
  }>;
  deletions: Array<{ varName: string; isAutoNamed: boolean; locator: string }>;
  /** New parts, already rendered to code lines by codegen.ts — genuinely new
   *  definitions, so they are INSERTED (there is nothing to rewrite), but as
   *  ordinary code with no "generated edits" markers. */
  additions: Array<{ name: string; lines: string[] }>;
  materials: Array<{ varName: string; color?: number; roughness?: number }>;
}

export interface ApplyReport {
  src: string;
  /** Human descriptions of what was written, for the save confirmation. */
  applied: string[];
  /** What could not be written in place, each with the reason to show. */
  blocked: Array<{ what: string; reason: string }>;
}

/**
 * Applies an editing session to the source, editing real definitions.
 *
 * Nothing is ever appended as an override block: an edit either lands on the
 * line that owns it, or it is reported as blocked. That is the whole point —
 * a file that still reads like code someone wrote, and a user who is told the
 * truth about what did and did not save.
 */
export function applyEditLog(
  src: string,
  builderName: string,
  log: EditLogInput,
): ApplyReport {
  let out = src;
  const applied: string[] = [];
  const blocked: ApplyReport["blocked"] = [];

  const deleted = new Set(log.deletions.map((d) => d.varName));

  const step = (what: string, result: RewriteResult): void => {
    if (result.ok) {
      out = result.src;
      applied.push(what);
    } else {
      blocked.push({ what, reason: result.reason });
    }
  };

  const describe = (varName: string, isAutoNamed: boolean, locator: string): string =>
    isAutoNamed ? `${locator} (unnamed in the source)` : varName;

  /**
   * IDEA-041: refuse a channel the RUNTIME owns before trying to write it.
   * The rewrite would succeed and the file would be correct — and the value
   * would still be overwritten on the next frame. Saying so is the only
   * honest outcome. Returns true when the edit was blocked.
   */
  const blockIfRuntimeOwned = (label: string, varName: string, channel: Channel): boolean => {
    const owned = runtimeOwnerFor(builderName, varName, channel);
    if (!owned) return false;
    blocked.push({
      what: `${label}.${channel}`,
      reason: owned.owner ? `${owned.reason} Change it in ${owned.owner}.` : owned.reason,
    });
    return true;
  };

  // 1. Transforms — skipped for parts that are also being deleted.
  for (const t of log.transforms) {
    if (deleted.has(t.varName)) continue;
    const label = describe(t.varName, t.isAutoNamed, t.locator);
    if (t.isAutoNamed) {
      blocked.push({
        what: label,
        reason:
          `This part has no variable name in ${builderName}() yet, so there is no definition ` +
          `to edit. Give it a local const in the source first.`,
      });
      continue;
    }
    if (t.position && !blockIfRuntimeOwned(label, t.varName, "position")) {
      step(`${label}.position`, setTransform(out, builderName, t.varName, "position", t.position));
    }
    if (t.rotation && !blockIfRuntimeOwned(label, t.varName, "rotation")) {
      step(`${label}.rotation`, setTransform(out, builderName, t.varName, "rotation", t.rotation));
    }
    if (t.scale && !blockIfRuntimeOwned(label, t.varName, "scale")) {
      step(`${label}.scale`, setTransform(out, builderName, t.varName, "scale", t.scale));
    }
    if (t.visible !== undefined && !blockIfRuntimeOwned(label, t.varName, "visible")) {
      step(`${label}.visible`, setVisible(out, builderName, t.varName, t.visible));
    }
  }

  // 2. Materials — roughness is genuinely owned by the builder; colour is
  //    usually not (IDEA-041), so it goes through the same ownership check.
  for (const m of log.materials) {
    if (m.roughness !== undefined && !blockIfRuntimeOwned(m.varName, m.varName, "roughness")) {
      step(`${m.varName} roughness`, setMaterialRoughness(out, builderName, m.varName, m.roughness));
    }
    if (m.color !== undefined && !blockIfRuntimeOwned(m.varName, m.varName, "color")) {
      // Not runtime-owned, so it may well be a literal the builder declares —
      // setMaterialColor rewrites it if so, and explains where the value really
      // lives if it does not.
      step(`${m.varName} colour`, setMaterialColor(out, builderName, m.varName, m.color));
    }
  }

  // 3. Deletions — the part's whole block goes, comment and all.
  for (const d of log.deletions) {
    const label = describe(d.varName, d.isAutoNamed, d.locator);
    if (d.isAutoNamed) {
      blocked.push({
        what: label,
        reason: `This part has no variable name in ${builderName}(), so its definition cannot be located.`,
      });
      continue;
    }
    step(`delete ${label}`, deletePart(out, builderName, d.varName));
  }

  // 4. Additions — new code, inserted before the builder's `return g;`.
  for (const a of log.additions) {
    const body = readBuilder(out, builderName);
    if (!body) {
      blocked.push({ what: `add ${a.name}`, reason: `Could not locate ${builderName}().` });
      continue;
    }
    const ret = [...body.statements].reverse().find((s) =>
      /^return\s+\w+\s*;$/.test(stripCommentsAndStrings(s.text).trim()),
    );
    if (!ret) {
      blocked.push({ what: `add ${a.name}`, reason: `Could not find ${builderName}()'s return statement.` });
      continue;
    }
    const indent = ret.indent;
    const block = a.lines.map((l) => `${indent}${l}`).join("\n");
    const lineStart = out.lastIndexOf("\n", ret.start - 1) + 1;
    out = out.slice(0, lineStart) + block + "\n\n" + out.slice(lineStart);
    applied.push(`add ${a.name}`);
  }

  return { src: out, applied, blocked };
}
