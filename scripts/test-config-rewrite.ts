// IDEA-062 v4: the pure half of the Balance tab.
//
// config.ts feeds the SERVER's plausibility bounds through `npm run sync`, so
// a rewrite that corrupts a number does not show up as a visual glitch — it
// shows up as honest runs being rejected in production with
// SCORE_ITEM_MISMATCH. That is worth a pure test with no browser in it.
//
// It runs against the REAL src/game/config.ts (never writing it), so a
// refactor of that file that breaks the rewriter fails here rather than in the
// editor.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyConfigEdits, readConfigNumber, formatNumber } from "../src/editor/configRewrite";
import { BALANCE_GROUPS, allBalancePaths } from "../src/editor/balanceFields";

let failures = 0;
function check(label: string, cond: boolean): void {
  if (cond) console.log(`  ok   ${label}`);
  else { console.log(`  FAIL ${label}`); failures++; }
}
function eq(label: string, a: unknown, b: unknown): void {
  if (JSON.stringify(a) === JSON.stringify(b)) console.log(`  ok   ${label}`);
  else { console.log(`  FAIL ${label}\n         expected ${JSON.stringify(b)}\n         actual   ${JSON.stringify(a)}`); failures++; }
}

const SRC = readFileSync(resolve("src/game/config.ts"), "utf-8");

console.log("=== reads the real config.ts ===");
{
  eq("SPEEDS.beagle", readConfigNumber(SRC, ["SPEEDS", "beagle"]), 5.2);
  eq("SCORE.biscuit", readConfigNumber(SRC, ["SCORE", "biscuit"]), 10);
  eq("TIMING.frightSeconds", readConfigNumber(SRC, ["TIMING", "frightSeconds"]), 7);
  eq("START_LIVES (a bare number, not an object)", readConfigNumber(SRC, ["START_LIVES"]), 3);
  eq("LIVES.milestonePoints", readConfigNumber(SRC, ["LIVES", "milestonePoints"]), 10000);
  eq("FRUIT_LIFESPAN_SECONDS", readConfigNumber(SRC, ["FRUIT_LIFESPAN_SECONDS"]), 20);
  eq("TIMING.schedule[0] (an array index)", readConfigNumber(SRC, ["TIMING", "schedule", 0]), 7);
  eq("TIMING.schedule[5] is the 1e9 'chase forever'", readConfigNumber(SRC, ["TIMING", "schedule", 5]), 1e9);
  eq("FRUIT_THRESHOLDS[2]", readConfigNumber(SRC, ["FRUIT_THRESHOLDS", 2]), 120);
}

console.log("\n=== writes ONE number and nothing else ===");
{
  const r = applyConfigEdits(SRC, [{ path: ["SPEEDS", "beagle"], value: 6.1 }]);
  eq("one edit applied", r.applied.length, 1);
  eq("nothing blocked", r.blocked, []);
  eq("the new value reads back", readConfigNumber(r.src, ["SPEEDS", "beagle"]), 6.1);
  check("same line count — no reflow", r.src.split("\n").length === SRC.split("\n").length);
  check(
    "exactly ONE line differs",
    r.src.split("\n").filter((l, i) => l !== SRC.split("\n")[i]).length === 1,
  );
  // The comments around it are the whole reason this is a token swap.
  check("the file's own header comment survives", r.src.startsWith("// Central tunables"));
  check("COINS' long explanatory comment survives", r.src.includes("there is NO points-to-coins conversion"));
  eq("its NEIGHBOUR in the same object is untouched", readConfigNumber(r.src, ["SPEEDS", "ghost"]), 4.6);
}

console.log("\n=== a nested key never matches an outer one by accident ===");
{
  // LIVES.max and (say) a `max` elsewhere must not collide. Prove the walk is
  // depth-scoped by editing one and reading the other back.
  const r = applyConfigEdits(SRC, [{ path: ["LIVES", "max"], value: 4 }]);
  eq("LIVES.max written", readConfigNumber(r.src, ["LIVES", "max"]), 4);
  eq("LIVES.milestonePoints untouched", readConfigNumber(r.src, ["LIVES", "milestonePoints"]), 10000);
  eq("COINS is untouched entirely", readConfigNumber(r.src, ["COINS", "pickupValue"]), readConfigNumber(SRC, ["COINS", "pickupValue"]));
}

console.log("\n=== array elements, including the last (no trailing comma) ===");
{
  const r = applyConfigEdits(SRC, [
    { path: ["TIMING", "schedule", 0], value: 9 },
    { path: ["FRUIT_THRESHOLDS", 3], value: 175 },
  ]);
  eq("schedule[0]", readConfigNumber(r.src, ["TIMING", "schedule", 0]), 9);
  eq("schedule[1] untouched", readConfigNumber(r.src, ["TIMING", "schedule", 1]), 20);
  eq("FRUIT_THRESHOLDS[3] (the last element)", readConfigNumber(r.src, ["FRUIT_THRESHOLDS", 3]), 175);
  eq("FRUIT_THRESHOLDS[0] untouched", readConfigNumber(r.src, ["FRUIT_THRESHOLDS", 0]), 40);
}

console.log("\n=== many edits in one pass ===");
{
  const r = applyConfigEdits(SRC, [
    { path: ["SPEEDS", "beagle"], value: 6 },
    { path: ["SPEEDS", "ghost"], value: 5 },
    { path: ["SCORE", "biscuit"], value: 15 },
    { path: ["LIVES", "max"], value: 6 },
  ]);
  eq("all four applied", r.applied.length, 4);
  eq("beagle", readConfigNumber(r.src, ["SPEEDS", "beagle"]), 6);
  eq("ghost", readConfigNumber(r.src, ["SPEEDS", "ghost"]), 5);
  eq("biscuit", readConfigNumber(r.src, ["SCORE", "biscuit"]), 15);
  eq("lives max", readConfigNumber(r.src, ["LIVES", "max"]), 6);
  check("still the same line count", r.src.split("\n").length === SRC.split("\n").length);
}

console.log("\n=== refuses rather than guessing ===");
{
  const r = applyConfigEdits(SRC, [
    { path: ["NOT_A_REAL_EXPORT", "x"], value: 1 },
    { path: ["SPEEDS", "notAKey"], value: 1 },
    { path: ["SPEEDS", "beagle"], value: 7 },
  ]);
  eq("the good one still applied", r.applied.length, 1);
  eq("two blocked", r.blocked.length, 2);
  check("and each says why", r.blocked.every((b) => b.reason.length > 0));
  eq("the good edit really landed", readConfigNumber(r.src, ["SPEEDS", "beagle"]), 7);
}

console.log("\n=== float noise never reaches the file ===");
{
  eq("5.2 + 0.1 does not become 5.300000000000001", formatNumber(5.2 + 0.1), "5.3");
  eq("an integer stays an integer", formatNumber(10), "10");
  eq("a negative survives", formatNumber(-0.25), "-0.25");
  const r = applyConfigEdits(SRC, [{ path: ["SPEEDS", "beagle"], value: 0.1 + 0.2 }]);
  check("and through a real write", r.src.includes("beagle: 0.3,"));
}

console.log("\n=== the result still parses as TypeScript-ish source ===");
{
  const r = applyConfigEdits(SRC, [{ path: ["SPEEDS", "beagle"], value: 6.1 }]);
  const open = (r.src.match(/\{/g) ?? []).length;
  const close = (r.src.match(/\}/g) ?? []).length;
  check(`braces balance (${open}/${close})`, open === close);
  const ob = (r.src.match(/\[/g) ?? []).length;
  const cb = (r.src.match(/\]/g) ?? []).length;
  check(`brackets balance (${ob}/${cb})`, ob === cb);
}

console.log("\n=== EVERY field the Balance tab offers resolves in the real config.ts ===");
console.log("    (the catalogue is hand-written, so a renamed or removed number");
console.log("     would otherwise render as a control wired to nothing)");
{
  const bad: string[] = [];
  for (const path of allBalancePaths()) {
    if (readConfigNumber(SRC, path) === null) bad.push(path.join("."));
  }
  check(
    `all ${allBalancePaths().length} paths resolve${bad.length ? " — MISSING: " + bad.join(", ") : ""}`,
    bad.length === 0,
  );

  // Every field's CURRENT value must sit inside the range its own slider
  // offers, or opening the tab would silently clamp a shipped number the
  // moment anything near it was touched.
  const outOfRange: string[] = [];
  for (const group of BALANCE_GROUPS) {
    for (const f of group.fields) {
      const v = readConfigNumber(SRC, f.path);
      if (v === null) continue;
      if (v < f.min || v > f.max) outOfRange.push(`${f.path.join(".")}=${v} not in [${f.min}, ${f.max}]`);
    }
  }
  check(
    `every shipped value is inside its own slider range${outOfRange.length ? " — " + outOfRange.join("; ") : ""}`,
    outOfRange.length === 0,
  );

  const labels = BALANCE_GROUPS.flatMap((g) => g.fields.map((f) => `${g.title}/${f.label}`));
  check("no duplicate group/label pair", new Set(labels).size === labels.length);
  const paths = allBalancePaths().map((p) => p.join("."));
  check("no path is offered twice", new Set(paths).size === paths.length);
}

console.log("\n" + "-".repeat(60));
if (failures === 0) console.log("CONFIG REWRITE: all passed");
else { console.log(`CONFIG REWRITE: ${failures} FAILED`); process.exit(1); }
