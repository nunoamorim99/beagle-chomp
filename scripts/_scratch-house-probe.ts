// IDEA-066 phase 4: do the built buildings match the tables they were built from?
//
// The ratios that decide these subjects — the house being wider than tall, the
// greenhouse being long and low on a dark plinth — are exactly the kind of
// number that looks right in a render and is wrong in the mesh, because a
// chimney, an eaves band or a plinth adds height nobody notices. So they are
// MEASURED, from vertices, against the per-subject measurement files.
//
// Vertices, never Box3.setFromObject: that builds each child's box in LOCAL
// space and transforms its eight corners, so any off-axis child over-reports
// (it read the garden shrub 56% too wide).
//
// EACH KIND IS CHECKED AGAINST ITS OWN TABLE. The first version of this probe
// held the shed and the greenhouse to the HOUSE's numbers and reported seven
// failures against a build that was correct — the harness being wrong rather
// than the code, which is a thing this project has learned to suspect first.
//
//   npx tsx scripts/_scratch-house-probe.ts
import * as THREE from "three";
import { readFileSync } from "node:fs";
import { MAZE_THEMES } from "../src/game/themes";
import { makeSurroundMaterials, distantHouse, type HouseKind } from "../src/render/surroundProps";

const load = (dir: string) =>
  JSON.parse(readFileSync(`.img2threejs/${dir}/measurements.json`, "utf8"));
const HOUSE = load("garden-house");
const GREENHOUSE = load("garden-greenhouse");
const mats = makeSurroundMaterials(MAZE_THEMES[0].palette);

/** World-space extent of a named subtree, measured from its vertices. */
function extent(root: THREE.Object3D, filter?: (name: string) => boolean) {
  root.updateMatrixWorld(true);
  const lo = new THREE.Vector3(Infinity, Infinity, Infinity);
  const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const v = new THREE.Vector3();
  let found = false;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (filter && !filter(m.name)) return;
    found = true;
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      lo.min(v);
      hi.max(v);
    }
  });
  return found ? { lo, hi, w: hi.x - lo.x, h: hi.y - lo.y, d: hi.z - lo.z } : null;
}

function tris(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const pos = m.geometry.attributes.position;
    n += (m.geometry.index ? m.geometry.index.count : pos.count) / 3;
  });
  return n;
}

let bad = 0;
const row = (label: string, got: number, expect?: number, tol = 0.06): void => {
  if (expect === undefined) {
    console.log(`       ${label.padEnd(24)} ${got.toFixed(3)}`);
    return;
  }
  const off = Math.abs(got - expect) / Math.max(1e-6, Math.abs(expect));
  const ok = off <= tol;
  if (!ok) bad++;
  console.log(
    `  ${ok ? "ok  " : "OFF "} ${label.padEnd(24)} ${got.toFixed(3)}   spec ${expect.toFixed(3)}   ${(off * 100).toFixed(1)}%`,
  );
};

const SUBJECTS: Array<{ kind: HouseKind; table?: Record<string, number>; budget: number }> = [
  { kind: "house", table: HOUSE.shippedRatios, budget: 450 },
  { kind: "greenhouse", table: GREENHOUSE.shippedRatios, budget: 200 },
  { kind: "shed", budget: 450 },
];

for (const { kind, table, budget } of SUBJECTS) {
  // A fixed EW of 1, so every printed figure IS the ratio.
  const g = distantHouse(mats, { kind, eavesWidth: 1, seed: 1 });
  const all = extent(g)!;
  const body = extent(g, (n) => n === "body")!;
  const roof = extent(g, (n) => n === "roof")!;
  const chim = extent(g, (n) => n === "chimney");
  const plinth = extent(g, (n) => n === "plinth");
  const t = Math.round(tris(g));

  console.log(`\n${kind.toUpperCase()}  (eavesWidth = 1 — every figure below is a ratio)`);
  console.log(`  ${t <= budget ? "ok  " : "OFF "} ${"triangles".padEnd(24)} ${t}   budget <= ${budget}`);
  if (t > budget) bad++;

  row("overall width", all.w);
  row("overall height", all.h, table?.totalHeight);
  row("width / height", all.w / all.h, table?.widthOverHeight);
  row("wall height", body.h, table?.glassWallHeight ?? table?.wallHeight);
  row("roof rise", roof.h, table?.roofRise);
  row("depth", body.d, table?.depth);
  if (plinth) row("plinth height", plinth.h, table?.plinthHeight);
  if (chim) {
    row("chimney width", chim.w, table?.chimneyWidth);
    row("chimney above ridge", chim.hi.y - (body.lo.y + body.h + roof.h), table?.chimneyAboveRidge);
  }

  // Applies to all three: this is what separates the whole family from the
  // treehouse, the log cabin and the city tower.
  const wide = all.w / all.h;
  const wideOk = wide > 1.2;
  if (!wideOk) bad++;
  console.log(
    `  ${wideOk ? "ok  " : "OFF "} ${"wider than tall".padEnd(24)} ${wide.toFixed(3)}   need > 1.200`,
  );

  const sink = all.lo.y;
  const sunk = sink < -0.02;
  if (sunk) bad++;
  console.log(`  ${sunk ? "OFF " : "ok  "} ${"stands on the floor".padEnd(24)} ${sink.toFixed(3)}`);
}

// The pair share a plot, so the number that matters most is how far APART they
// read — not either one's own fidelity. IDEA-056's rule: verify a pair against
// each other, never each alone.
const h = extent(distantHouse(mats, { kind: "house", eavesWidth: 1, seed: 1 }))!;
const gh = extent(distantHouse(mats, { kind: "greenhouse", eavesWidth: 1, seed: 1 }))!;
const sep = gh.w / gh.h / (h.w / h.h);
const sepOk = sep > 1.35;
if (!sepOk) bad++;
console.log(
  `\n  ${sepOk ? "ok  " : "OFF "} house vs greenhouse aspect separation   x${sep.toFixed(2)}   need > x1.35`,
);
console.log(`     house ${(h.w / h.h).toFixed(2)} : greenhouse ${(gh.w / gh.h).toFixed(2)} wide-over-tall`);

console.log(`\n${bad === 0 ? "MATCHES THE TABLES" : bad + " FIGURE(S) OFF"}`);
if (bad) process.exitCode = 1;
