// Scratch: ask the editor's own rewriter whether each doubler part is savable.
import { readFileSync } from "node:fs";
import { rewriteBlocker } from "../src/editor/sourceRewrite";

const src = readFileSync("src/render/board.ts", "utf8");
const cases: [string, string][] = [
  ["makeDoubleBiscuit", "plate"],
  ["makeDoubleBiscuit", "biscuitX2Front"],
  ["makeDoubleBiscuit", "biscuitX2Back"],
  ["makeDoubleGhost", "plate"],
  ["makeDoubleGhost", "enemyX2Front"],
  ["makeDoubleGhost", "enemyX2Back"],
];
let bad = 0;
for (const [fn, v] of cases) {
  const blocker = rewriteBlocker(src, fn, v);
  if (blocker) { bad++; console.log(`  BLOCKED ${fn}/${v}: ${blocker}`); }
  else console.log(`  ok      ${fn}/${v}`);
}
console.log(bad ? `\n${bad} part(s) still unsavable` : "\nALL DOUBLER PARTS ARE SAVABLE");
