// Headless unit checks for src/editor/sourceRewrite.ts (IDEA-025 v3) — the
// in-place source rewriter behind the editor's Save. Same style as the other
// suites: assert + log, exit 1 on failure. Run: tsx scripts/test-source-rewrite.ts
// (wired into `npm run test` as test:source-rewrite).
//
// These run against the REAL src/render/characters.ts text, so they fail the
// moment the builder's shape drifts away from what the rewriter assumes —
// which is exactly the safety net the appended-block export never had.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  readBuilder,
  findPart,
  rewriteBlocker,
  setTransform,
  setMaterialColor,
  deletePart,
  scanStatements,
  stripCommentsAndStrings,
} from "../src/editor/sourceRewrite";
import { findFunctionRange } from "../src/editor/sourceParse";

const SRC = readFileSync(resolve("src/render/characters.ts"), "utf-8");
const BUILDER = "makeBeagle";

let failures = 0;
function check(label: string, cond: boolean): void {
  if (cond) {
    console.log(`  ok   ${label}`);
  } else {
    console.log(`  FAIL ${label}`);
    failures++;
  }
}

/** Code-only text of a builder, for assertions that must ignore comments. */
function builderCode(src: string, name = BUILDER): string {
  const body = readBuilder(src, name);
  if (!body) return "";
  return stripCommentsAndStrings(src.slice(body.bodyStart, body.bodyEnd));
}

function occurrences(haystack: string, needle: RegExp): number {
  return (haystack.match(new RegExp(needle.source, "g")) ?? []).length;
}

console.log("\n--- scanning ---");
{
  const body = readBuilder(SRC, BUILDER);
  check("readBuilder locates makeBeagle", body !== null);
  check("makeBeagle has many top-level statements", (body?.statements.length ?? 0) > 20);

  // Statement scanning must NOT descend into the forEach callbacks.
  const topLevel = body?.statements.map((s) => stripCommentsAndStrings(s.text).trim()) ?? [];
  check(
    "loop-nested statements are not returned as top-level",
    !topLevel.some((t) => t.startsWith("legPivot.")),
  );
  check(
    "the forEach itself IS one top-level statement",
    topLevel.some((t) => t.includes("forEach")),
  );
}

console.log("\n--- stripCommentsAndStrings ---");
{
  const stripped = stripCommentsAndStrings(`const a = 1; // haunch\nconst b = "haunch";`);
  check("comment mentions are removed", !/\/\/ haunch/.test(stripped));
  check("string contents are removed", !/"haunch"/.test(stripped));
  check("code survives", /const a = 1;/.test(stripped) && /const b = /.test(stripped));
}

console.log("\n--- findPart ---");
{
  const body = readBuilder(SRC, BUILDER)!;
  const haunch = findPart(body, "haunch");
  check("finds the haunch's declaration", haunch !== null);
  check(
    "collects the haunch's whole block (decl + name + scale + position + add)",
    (haunch?.indices.length ?? 0) >= 4,
  );

  const body2 = readBuilder(SRC, BUILDER)!;
  check("a loop-built part has no top-level decl", findPart(body2, "sideCap") === null);
}

console.log("\n--- rewriteBlocker (honest limits) ---");
{
  check("a top-level part is rewritable", rewriteBlocker(SRC, BUILDER, "haunch") === null);
  check("the body is rewritable", rewriteBlocker(SRC, BUILDER, "body") === null);

  const earBlock = rewriteBlocker(SRC, BUILDER, "earL");
  check("a mirrored/loop-built part is BLOCKED, not faked", earBlock !== null);
  check(
    "…and the reason explains the loop",
    !!earBlock && /loop|callback/i.test(earBlock),
  );
  console.log(`    earL → ${earBlock}`);

  const missing = rewriteBlocker(SRC, BUILDER, "notAThing");
  check("an unknown name is blocked", missing !== null);
  check("a non-identifier is blocked", rewriteBlocker(SRC, BUILDER, "0/1 child") !== null);
}

console.log("\n--- setTransform: rewrites the REAL line ---");
{
  const before = builderCode(SRC);
  check(
    "precondition: haunch.position.set exists exactly once",
    occurrences(before, /haunch\.position\.set/) === 1,
  );

  const r = setTransform(SRC, BUILDER, "haunch", "position", [0, 0.5, -0.3]);
  check("setTransform succeeds on the haunch", r.ok);
  if (r.ok) {
    const after = builderCode(r.src);
    check("the new value is present", /haunch\.position\.set\(0, 0\.5, -0\.3\)/.test(after));
    check("the old value is gone", !/haunch\.position\.set\(0, 0\.3, -0\.28\)/.test(after));
    check(
      "still exactly ONE haunch.position.set — no appended duplicate",
      occurrences(after, /haunch\.position\.set/) === 1,
    );
    check(
      "no generated edit block was appended",
      !/Character Editor edits \(generated/.test(r.src.slice(r.src.indexOf("haunch"))) ||
        occurrences(builderCode(r.src), /haunch\.position\.set/) === 1,
    );
    check("the file still parses as a function", findFunctionRange(r.src, BUILDER) !== null);
    check(
      "the file length changed only slightly (a line edit, not an insert)",
      Math.abs(r.src.length - SRC.length) < 40,
    );
    check(
      "the part's documenting comment is preserved",
      /soft hip bulge that never breaks the saddle seam/.test(r.src),
    );
  }
}

console.log("\n--- setTransform: collapses axis assignments ---");
{
  // tailShaft uses `tailShaft.position.y = 0.15;` — a single-axis assignment.
  const before = builderCode(SRC);
  check("precondition: tailShaft.position.y exists", /tailShaft\.position\.y\s*=/.test(before));

  const r = setTransform(SRC, BUILDER, "tailShaft", "position", [0, 0.2, 0.05]);
  check("setTransform succeeds on tailShaft", r.ok);
  if (r.ok) {
    const after = builderCode(r.src);
    check("axis form was replaced by a canonical .set", /tailShaft\.position\.set\(0, 0\.2, 0\.05\)/.test(after));
    check("the old axis assignment is gone", !/tailShaft\.position\.y\s*=/.test(after));
  }
}

console.log("\n--- setTransform: inserts when the property has no statement ---");
{
  // `chest` has scale + position but no rotation.
  const before = builderCode(SRC);
  check("precondition: chest has no rotation statement", !/chest\.rotation/.test(before));

  const r = setTransform(SRC, BUILDER, "chest", "rotation", [0, 0.3, 0]);
  check("setTransform succeeds", r.ok);
  if (r.ok) {
    const after = builderCode(r.src);
    check("a rotation statement was inserted", /chest\.rotation\.set\(0, 0\.3, 0\)/.test(after));
    check("it sits inside the chest's own block, before g.add(chest)", (() => {
      const rot = after.indexOf("chest.rotation.set");
      const add = after.indexOf("g.add(chest)");
      const decl = after.indexOf("const chest");
      return decl < rot && rot < add;
    })());
    check("the file still parses", findFunctionRange(r.src, BUILDER) !== null);
  }
}

console.log("\n--- setTransform: uniform scale uses setScalar ---");
{
  const r = setTransform(SRC, BUILDER, "chest", "scale", [1.2, 1.2, 1.2]);
  check("setTransform succeeds", r.ok);
  if (r.ok) check("uniform scale emits setScalar", /chest\.scale\.setScalar\(1\.2\)/.test(builderCode(r.src)));

  const r2 = setTransform(SRC, BUILDER, "chest", "scale", [1.2, 1, 0.8]);
  check("non-uniform scale emits .set", r2.ok && /chest\.scale\.set\(1\.2, 1, 0\.8\)/.test(builderCode(r2.src)));
}

console.log("\n--- setMaterialColor ---");
{
  // A builder-owned literal colour IS rewritable. This was missing entirely:
  // every colour edit used to be refused, including the many fixed materials a
  // builder declares outright, like an eye's sclera.
  const fake = [
    "export function makeThing(): THREE.Group {",
    "  const g = new THREE.Group();",
    "  const sclera = new THREE.MeshStandardMaterial({ color: 0xfdf9f2, roughness: 0.4 });",
    "  const skinned = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });",
    "  return g;",
    "}",
    "",
  ].join("\n");

  const ok = setMaterialColor(fake, "makeThing", "sclera", 0x112233);
  check("a literal colour is rewritten", ok.ok);
  if (ok.ok) {
    check("…to the new hex", /color: 0x112233/.test(ok.src));
    check("…and the old one is gone", !/0xfdf9f2/.test(ok.src));
    check("…leaving roughness alone", /roughness: 0\.4/.test(ok.src));
  }

  const blocked = setMaterialColor(fake, "makeThing", "skinned", 0x112233);
  check("a colour passed IN is refused, not mangled", !blocked.ok);
  if (!blocked.ok) {
    check("…and the reason names where it really lives", /config\.ts|cosmetics\.ts/.test(blocked.reason));
    console.log(`    skinned -> ${blocked.reason}`);
  }
}

console.log("\n--- setTransform: blocked parts are refused ---");
{
  const r = setTransform(SRC, BUILDER, "earL", "rotation", [0, 0, 0.5]);
  check("a loop-built part cannot be transformed in place", !r.ok);
  check("…and the source is untouched (no partial write)", !r.ok);
}

console.log("\n--- deletePart ---");
{
  const r = deletePart(SRC, BUILDER, "chest");
  check("deleting the chest succeeds", r.ok);
  if (r.ok) {
    const after = builderCode(r.src);
    check("the const is gone", !/const chest\b/.test(after));
    check("the .add is gone", !/g\.add\(chest\)/.test(after));
    check("no reference to chest survives in code", !/\bchest\b/.test(after));
    check("the file still parses", findFunctionRange(r.src, BUILDER) !== null);
    check(
      "no removeFromParent residue is produced",
      !/chest\.removeFromParent/.test(r.src),
    );
    check("the deleted part's comment went with it", !/A white form giving fullness under the chin/.test(r.src));
  }
}

console.log("\n--- deletePart: refuses what would not compile ---");
{
  // `tail` both has children AND is exposed on g.userData.parts — either
  // guard alone is enough to refuse it (the children check fires first).
  const r = deletePart(SRC, BUILDER, "tail");
  check("deleting an animated, parented part is REFUSED", !r.ok);
  if (!r.ok) console.log(`    tail → ${r.reason}`);

  // `tailTilt` has children added to it.
  const r2 = deletePart(SRC, BUILDER, "tailTilt");
  check("deleting a part with children attached is REFUSED", !r2.ok);
  if (!r2.ok) {
    check("…and the reason names the orphaning risk", /attached|orphan/i.test(r2.reason));
    console.log(`    tailTilt → ${r2.reason}`);
  }

  const r3 = deletePart(SRC, BUILDER, "earL");
  check("deleting a loop-built part is REFUSED", !r3.ok);
}

console.log("\n--- deletePart: the leftover-reference guard ---");
{
  // A part with NO children, but still named elsewhere in the builder — the
  // case that would otherwise emit source that does not compile. Synthetic, so
  // the guard stays covered no matter how characters.ts's shape changes.
  const fake = [
    "export function makeThing(): THREE.Group {",
    "  const g = new THREE.Group();",
    "  // A lonely marker.",
    "  const marker = new THREE.Mesh(geo, mat);",
    '  marker.name = "marker";',
    "  marker.position.set(0, 1, 0);",
    "  g.add(marker);",
    "  g.userData.parts = { marker };",
    "  return g;",
    "}",
    "",
  ].join("\n");

  const blocked = deletePart(fake, "makeThing", "marker");
  check("a part still referenced in userData is REFUSED", !blocked.ok);
  if (!blocked.ok) {
    check("…and the reason names the leftover reference", /still referenced/i.test(blocked.reason));
    console.log(`    marker → ${blocked.reason}`);
  }

  // The same part with the userData reference removed — now safe to delete.
  const freed = fake.replace("  g.userData.parts = { marker };\n", "");
  const ok = deletePart(freed, "makeThing", "marker");
  check("once unhooked, the same part deletes cleanly", ok.ok);
  if (ok.ok) {
    check("the whole block went, comment included", !/marker/.test(ok.src) && !/A lonely marker/.test(ok.src));
    check(
      "the rest of the builder survives",
      /const g = new THREE\.Group\(\);/.test(ok.src) && /return g;/.test(ok.src),
    );
  }
}

console.log("\n--- idempotence / round-trip ---");
{
  const once = setTransform(SRC, BUILDER, "haunch", "position", [0, 0.5, -0.3]);
  check("first rewrite ok", once.ok);
  if (once.ok) {
    const twice = setTransform(once.src, BUILDER, "haunch", "position", [0, 0.5, -0.3]);
    check("re-saving the same value is a no-op", twice.ok && twice.src === once.src);

    const third = setTransform(once.src, BUILDER, "haunch", "position", [1, 1, 1]);
    check("a second edit replaces rather than stacks", third.ok && occurrences(builderCode(third.src), /haunch\.position\.set/) === 1);
  }
}

console.log("\n--- scanStatements: block statements terminate ---");
{
  // A `for`/`if`/`while` block ends at its closing brace, not at a semicolon.
  // The scanner used to run straight past it and swallow whatever declaration
  // came next — which is exactly how the bee's `const sting` disappeared into
  // a 577-character "for" statement and was reported as un-editable.
  const sample = [
    "{",
    "  for (let i = 0; i < 2; i++) {",
    "    const inner = 1;",
    "  }",
    "  const after = new THREE.Mesh(geo, mat);",
    "  after.name = \"after\";",
    "  const obj = { a: 1, b: 2 };",
    "  arr.forEach((s) => { s.x = 1; });",
    "  const tail = 9;",
    "}",
  ].join("\n");
  const stmts = scanStatements(sample, 1, sample.length - 1);
  const texts = stmts.map((st) => stripCommentsAndStrings(st.text).trim().replace(/\s+/g, " "));
  check("the for loop is its OWN statement", texts.some((t) => t.startsWith("for") && !t.includes("after")));
  check("the declaration after it survives separately", texts.some((t) => t.startsWith("const after")));
  check("…and is not swallowed by the loop", !texts.some((t) => t.startsWith("for") && t.includes("const after")));
  // Object literals and arrow bodies also close with a brace, but there the
  // statement genuinely continues — they must NOT be split.
  check("an object literal is not split at its brace", texts.some((t) => t.startsWith("const obj = {") && t.endsWith("};")));
  check("an arrow callback is not split at its brace", texts.some((t) => t.startsWith("arr.forEach") && t.endsWith(");")));
  check("the statement after a callback survives", texts.some((t) => t.startsWith("const tail")));
}

console.log("\n--- scanStatements: nesting is respected ---");
{
  const sample = `{
  const a = 1;
  arr.forEach((s) => {
    const b = 2;
    b.x = 3;
  });
  const c = "a; b";
  c.y = 4;
}`;
  const stmts = scanStatements(sample, 1, sample.length - 1);
  const texts = stmts.map((s) => stripCommentsAndStrings(s.text).trim());
  check("top-level statement count is 4", stmts.length === 4);
  check("the forEach is one statement", texts.some((t) => t.startsWith("arr.forEach")));
  check("a semicolon inside a string does not split", texts.some((t) => t.startsWith("const c =")));
  check("nested statements are excluded", !texts.some((t) => t === "b.x = 3;"));
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
if (failures > 0) process.exit(1);
