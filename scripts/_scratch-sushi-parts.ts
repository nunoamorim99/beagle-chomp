// Scratch: per-part triangle and bounds breakdown for a sushi skin.
import * as THREE from "three";
import { makeEnemy } from "../src/render/characters";

const id = process.env.MODEL ?? "maki";
const g = makeEnemy(id, 0xe8615f);
g.updateMatrixWorld(true);
const byPrefix = new Map<string, { tris: number; n: number }>();
let total = 0;
g.traverse((o) => {
  if (!(o instanceof THREE.Mesh)) return;
  const geo = o.geometry;
  const t = geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
  total += t;
  const key = o.name.replace(/[0-9]+$/, "").replace(/[LR]$/, "");
  const e = byPrefix.get(key) ?? { tris: 0, n: 0 };
  e.tris += t;
  e.n++;
  byPrefix.set(key, e);
});
for (const [k, v] of [...byPrefix.entries()].sort((a, b) => b[1].tris - a[1].tris)) {
  console.log(`${k.padEnd(16)} n=${String(v.n).padStart(3)}  tris=${String(Math.round(v.tris)).padStart(6)}`);
}
console.log("TOTAL", Math.round(total));
