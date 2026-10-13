// SCRATCH (IDEA-065 v10): a prop's path -> name map, dumped as JSON.
//
// It exists for ONE job: migrating a def's saved `parts.edits` across a
// structural change. A part edit addresses by INDEX PATH, so grouping four
// loose meshes into a parent re-points every edit after them — silently, onto
// a different part, with nothing to error. Names are stable across such a
// change where paths are not, so the migration is old path -> NAME -> new
// path, and this prints either side of it.
import { makePropById } from "../src/render/board";
import * as THREE from "three";

const id = process.argv[2] ?? "critter-deer";
const prop = makePropById(id, 0.17);
const out: Record<string, string> = {};
const walk = (o: THREE.Object3D, path: string) => {
  o.children.forEach((c, i) => {
    const p = path ? `${path}/${i}` : String(i);
    out[p] = c.name || `(unnamed:${p})`;
    walk(c, p);
  });
};
walk(prop, "");
console.log(JSON.stringify(out, null, 0));
