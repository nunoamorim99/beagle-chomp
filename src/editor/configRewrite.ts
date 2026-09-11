// OWNER: editor (IDEA-062 v4, dev-only).
// Rewrites a NUMBER inside one of src/game/config.ts's exported literals,
// leaving every byte around it alone.
//
// config.ts is the most heavily COMMENTED file in the game — most of its
// numbers carry a paragraph explaining why they are that number and what
// happened when they were something else (read COINS or LIVES). Regenerating
// the file from a data model, the way boardCodegen regenerates a theme entry,
// would throw all of that away. So this is a surgical token replacement: find
// the statement, walk to the value at a path, swap the numeric token.
//
// It is PURE and has no `three` or DOM dependency, so it is testable in Node —
// scripts/test-config-rewrite.ts. That matters more here than for the other
// writers: config.ts feeds the SERVER's plausibility bounds through
// `npm run sync`, so a rewrite that corrupts a number does not produce a
// visual glitch, it produces honest runs being rejected in production.
//
// LIMITS, deliberately narrow and honestly reported:
//  - Only NUMBER leaves at a known path. Never adds or removes an array
//    element, never touches a string or a boolean.
//  - Refuses anything whose current value is not a plain numeric literal
//    (an expression, a reference, `1e9` is fine but `60 * 60` is not).
// Anything it cannot do it REPORTS rather than approximating, the same
// contract sourceRewrite.ts's applyEditLog has — a silent near-miss in this
// file is worse than a refusal.
/**
 * A same-LENGTH copy of `src` with every comment body and string body replaced
 * by spaces (newlines kept, so line numbers survive too).
 *
 * sourceRewrite.ts exports `stripCommentsAndStrings`, and reusing it was the
 * first attempt — but it DELETES those spans rather than blanking them, so
 * every index it yields is shifted relative to the original and every lookup
 * here resolved to the wrong byte. Length preservation is the whole
 * requirement: this module scans the masked copy and then splices the
 * ORIGINAL at the offsets it finds.
 *
 * That matters more in config.ts than almost anywhere else in the project —
 * it is mostly prose. `COINS` alone carries a dozen lines explaining why the
 * points-to-coins conversion was removed, and the word `pickupValue` appears
 * in that prose as well as in the code.
 */
function maskNonCode(src: string): string {
  const out = src.split("");
  let i = 0;
  let state: "code" | "line" | "block" | "single" | "double" | "template" = "code";
  const blank = (at: number): void => {
    if (out[at] !== "\n") out[at] = " ";
  };
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (state === "code") {
      if (c === "/" && next === "/") { state = "line"; blank(i); blank(i + 1); i += 2; continue; }
      if (c === "/" && next === "*") { state = "block"; blank(i); blank(i + 1); i += 2; continue; }
      if (c === "'") { state = "single"; i++; continue; }
      if (c === '"') { state = "double"; i++; continue; }
      if (c === "`") { state = "template"; i++; continue; }
      i++;
      continue;
    }
    if (state === "line") {
      if (c === "\n") state = "code";
      else blank(i);
      i++;
      continue;
    }
    if (state === "block") {
      if (c === "*" && next === "/") { blank(i); blank(i + 1); state = "code"; i += 2; continue; }
      blank(i);
      i++;
      continue;
    }
    // inside a string/template: blank the body, keep the closing quote so the
    // scanner still sees a well-formed token boundary
    if (c === "\\") { blank(i); blank(i + 1); i += 2; continue; }
    if ((state === "single" && c === "'") || (state === "double" && c === '"') || (state === "template" && c === "`")) {
      state = "code";
      i++;
      continue;
    }
    blank(i);
    i++;
  }
  return out.join("");
}

/** Where a number lives: the exported const, then object keys / array indices
 *  down to it. `["SPEEDS", "beagle"]` or `["FRUITS", 2, "points"]`. */
export type ConfigPath = readonly (string | number)[];

export interface ConfigEdit {
  path: ConfigPath;
  value: number;
}

export interface ConfigRewriteResult {
  src: string;
  applied: ConfigPath[];
  /** Each entry is a path that could NOT be written, with why. Surfaced in
   *  the UI rather than swallowed. */
  blocked: { path: ConfigPath; reason: string }[];
}

/** A plain numeric literal, including negatives, decimals and exponents.
 *  `1e9` (TIMING.schedule's "chase forever") must match; `60 * 60` must not. */
const NUMBER_RE = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

/** Finds `export const NAME` and returns the index just after its `=`.
 *  Searches the MASKED copy so a mention of the name inside one of this
 *  file's many explanatory paragraphs can never be mistaken for the
 *  declaration — and the mask is the same LENGTH as the original, so the
 *  index it yields splices the original correctly. */
function findDeclValueStart(src: string, name: string): number | null {
  const scan = maskNonCode(src);
  const re = new RegExp(`\\bexport\\s+const\\s+${name}\\b`, "g");
  const m = re.exec(scan);
  if (!m) return null;
  const eq = scan.indexOf("=", m.index + m[0].length);
  if (eq === -1) return null;
  return eq + 1;
}

/** Skips whitespace in the stripped copy (so a comment between a key and its
 *  value is stepped over too — config.ts has plenty). */
function skipSpace(scan: string, i: number): number {
  while (i < scan.length && /\s/.test(scan[i])) i++;
  return i;
}

/** Walks from `{` to the value of `key`, at THIS brace depth only — a nested
 *  object's identically-named key must never be mistaken for the outer one.
 *  Returns the index of the value's first character. */
function findKeyValue(scan: string, objStart: number, key: string): number | null {
  let i = skipSpace(scan, objStart);
  if (scan[i] !== "{") return null;
  i++;
  let depth = 0;
  while (i < scan.length) {
    const c = scan[i];
    if (depth === 0) {
      // A key at this level: an identifier (or a quoted key, whose quotes the
      // stripper has already blanked to spaces) followed by a colon.
      const km = /[A-Za-z_$][\w$]*/y;
      km.lastIndex = i;
      const m = km.exec(scan);
      if (m) {
        const afterKey = skipSpace(scan, km.lastIndex);
        if (scan[afterKey] === ":") {
          if (m[0] === key) return skipSpace(scan, afterKey + 1);
          i = afterKey + 1;
          continue;
        }
      }
    }
    if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      if (depth === 0) return null; // end of this object — key absent
      depth--;
    }
    i++;
  }
  return null;
}

/** Walks from `[` to element `index` at THIS bracket depth. */
function findIndexValue(scan: string, arrStart: number, index: number): number | null {
  let i = skipSpace(scan, arrStart);
  if (scan[i] !== "[") return null;
  i++;
  let depth = 0;
  let n = 0;
  let elementStart = skipSpace(scan, i);
  while (i < scan.length) {
    const c = scan[i];
    if (depth === 0) {
      // NOTE: no early `return null` on `]` here. config.ts writes its arrays
      // with NO trailing comma (`[40, 80, 120, 160] as const`), so the LAST
      // element is delimited by the closing bracket itself — bailing out on
      // `]` before the closing branch below gets to compare `n` made the final
      // element of every array unreachable, which is exactly the one an
      // author is most likely to be retuning.
      if (c === ",") {
        if (n === index) return elementStart;
        n++;
        elementStart = skipSpace(scan, i + 1);
        i = elementStart;
        continue;
      }
    }
    if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      if (depth === 0) {
        // Closing the array with a final element that had no trailing comma.
        return n === index ? elementStart : null;
      }
      depth--;
    }
    i++;
  }
  return null;
}

/** Resolves a full path to the index of its value's first character. */
function resolvePath(src: string, path: ConfigPath): number | { error: string } {
  const [head, ...rest] = path;
  if (typeof head !== "string") return { error: "a path must start with an exported name" };
  const declAt = findDeclValueStart(src, head);
  if (declAt === null) return { error: `no \`export const ${head}\` in config.ts` };
  const scan = maskNonCode(src);
  let at = skipSpace(scan, declAt);
  for (const step of rest) {
    const next =
      typeof step === "number" ? findIndexValue(scan, at, step) : findKeyValue(scan, at, step);
    if (next === null) return { error: `could not resolve \`${String(step)}\` in ${path.join(".")}` };
    at = next;
  }
  return at;
}

/**
 * Applies every edit, in one pass, right-to-left so earlier offsets stay valid.
 *
 * Never throws: a path that cannot be resolved, or whose current value is not
 * a plain numeric literal, lands in `blocked` with a reason for the UI to
 * show. Writing a partial file is fine and intended — the edits that DID
 * resolve are real, and the report says which did not.
 */
export function applyConfigEdits(src: string, edits: readonly ConfigEdit[]): ConfigRewriteResult {
  const blocked: ConfigRewriteResult["blocked"] = [];
  const resolved: { at: number; end: number; text: string; path: ConfigPath }[] = [];

  for (const edit of edits) {
    const at = resolvePath(src, edit.path);
    if (typeof at !== "number") {
      blocked.push({ path: edit.path, reason: at.error });
      continue;
    }
    NUMBER_RE.lastIndex = at;
    const m = NUMBER_RE.exec(src);
    if (!m || m.index !== at) {
      blocked.push({
        path: edit.path,
        reason: "the current value is not a plain number — this editor only retunes numeric literals",
      });
      continue;
    }
    resolved.push({ at, end: at + m[0].length, text: formatNumber(edit.value), path: edit.path });
  }

  let out = src;
  for (const r of [...resolved].sort((a, b) => b.at - a.at)) {
    out = out.slice(0, r.at) + r.text + out.slice(r.end);
  }
  return { src: out, applied: resolved.map((r) => r.path), blocked };
}

/** Formats a number the way config.ts already writes them: no exponent for
 *  ordinary values, no trailing ".0", and float noise trimmed — `5.2 + 0.1`
 *  must not land in the file as `5.300000000000001`. */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toFixed(6)));
}

/** Reads the current number at a path, or null — used to seed the controls
 *  from the file itself rather than from the imported module, so what a slider
 *  shows is what the SOURCE says even after an earlier save this session. */
export function readConfigNumber(src: string, path: ConfigPath): number | null {
  const at = resolvePath(src, path);
  if (typeof at !== "number") return null;
  NUMBER_RE.lastIndex = at;
  const m = NUMBER_RE.exec(src);
  if (!m || m.index !== at) return null;
  return Number(m[0]);
}
