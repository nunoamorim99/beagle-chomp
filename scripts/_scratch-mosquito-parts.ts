// Per-part world bounds for makeMosquito, so an envelope overshoot names the
// part that caused it instead of being guessed at. Mirrors the flea's
// _scratch-flea-parts.ts.
//
//   npx tsx scripts/_scratch-mosquito-parts.ts
import * as THREE from "three";
import { makeMosquito } from "../src/render/characters";

const g = makeMosquito(0xe8615f);
g.updateMatrixWorld(true);

type Row = { name: string; x0: number; x1: number; y0: number; y1: number; z0: number; z1: number };
const rows: Row[] = [];
g.traverse((o) => {
  if (!(o instanceof THREE.Mesh)) return;
  const b = new THREE.Box3().setFromObject(o);
  rows.push({
    name: o.name || "(unnamed)",
    x0: b.min.x, x1: b.max.x, y0: b.min.y, y1: b.max.y, z0: b.min.z, z1: b.max.z,
  });
});

const all = new THREE.Box3().setFromObject(g);
console.log("ENVELOPE  w %s  h %s  l %s  floor %s  crown %s",
  (all.max.x - all.min.x).toFixed(3), (all.max.y - all.min.y).toFixed(3),
  (all.max.z - all.min.z).toFixed(3), all.min.y.toFixed(3), all.max.y.toFixed(3));
console.log("          x [%s .. %s]  z [%s .. %s]",
  all.min.x.toFixed(3), all.max.x.toFixed(3), all.min.z.toFixed(3), all.max.z.toFixed(3));

const named = (k: keyof Row, dir: 1 | -1) =>
  [...rows].sort((a, b) => (dir === 1 ? (b[k] as number) - (a[k] as number) : (a[k] as number) - (b[k] as number)))[0];

console.log("\nextremes:");
console.log("  max +Z (front) : %s  %s", named("z1", 1).name, named("z1", 1).z1.toFixed(3));
console.log("  min -Z (rear)  : %s  %s", named("z0", -1).name, named("z0", -1).z0.toFixed(3));
console.log("  max +Y (crown) : %s  %s", named("y1", 1).name, named("y1", 1).y1.toFixed(3));
console.log("  min -Y (floor) : %s  %s", named("y0", -1).name, named("y0", -1).y0.toFixed(3));
console.log("  max |X| (width): %s  %s", named("x1", 1).name, named("x1", 1).x1.toFixed(3));

// console.log's %s does NOT honour a width flag like %-18s: it leaves the flag
// in the output and shifts every later substitution by one, which garbles the
// whole table. Pad by hand instead.
const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n);
console.log("\nall parts (sorted by rear-most):");
for (const r of [...rows].sort((a, b) => a.z0 - b.z0).slice(0, 14)) {
  console.log(
    "  " + pad(r.name, 16) +
      " z[" + r.z0.toFixed(3) + ".." + r.z1.toFixed(3) + "]" +
      " y[" + r.y0.toFixed(3) + ".." + r.y1.toFixed(3) + "]" +
      " x[" + r.x0.toFixed(3) + ".." + r.x1.toFixed(3) + "]",
  );
}
