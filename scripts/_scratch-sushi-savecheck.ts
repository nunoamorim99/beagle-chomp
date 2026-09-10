// Scratch: which parts of a builder can the editor's save-in-place actually
// write? The editor uses a part's mesh NAME as the source variable name, so a
// part built inside a loop (or whose variable is named differently from its
// mesh) has no single line to rewrite and the save is refused.
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { makeEnemy } from "../src/render/characters";
import { rewriteBlocker } from "../src/editor/sourceRewrite";

const id = process.env.MODEL ?? "nigiri";
const builder = process.env.BUILDER ?? (id === "nigiri" ? "makeNigiri" : "makeSushiMaki");
const src = readFileSync("src/render/characters.ts", "utf8");

const g = makeEnemy(id, 0xe8615f);
const ok: string[] = [];
const blocked: string[] = [];
g.traverse((o) => {
  if (o === g || !o.name) return;
  if (!(o instanceof THREE.Mesh) && !(o instanceof THREE.Group)) return;
  const why = rewriteBlocker(src, builder, o.name);
  (why === null ? ok : blocked).push(why === null ? o.name : `${o.name} — ${why.slice(0, 60)}…`);
});
console.log(`${builder}: ${ok.length} SAVEABLE, ${blocked.length} BLOCKED`);
console.log("\nSAVEABLE:\n  " + ok.join("\n  "));
console.log("\nBLOCKED (first 20):\n  " + blocked.slice(0, 20).join("\n  "));
