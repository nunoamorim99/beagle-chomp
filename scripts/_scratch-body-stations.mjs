// SCRATCH (IDEA-065 v12): turn the deer's three overlapping body ellipsoids
// into ONE sweep's station table.
//
// The point is that the shape does not change. Nuno tuned the chest, barrel
// and rump by hand in the editor; sampling their UNION's silhouette and
// fitting a sweep to it keeps that tuning and loses only the creases where
// the three surfaces cut each other.
const BLOBS = [
  // [cx, cy, cz, rx, ry, rz] — authored radii x the def's saved scale.
  [0, 1.55,  0.0,   0.45,  0.4627, 0.89 ],  // body   (scale 1, 0.873, 1)
  [0, 1.585, 0.374, 0.499, 0.4903, 0.574],  // chest  (scale 1.087, 0.925, 0.949)
  [0, 1.55, -0.57,  0.43,  0.3663, 0.44 ],  // rump   (pos y 1.55, scale 1, 0.814, 1)
];
const at = (z) => {
  let halfX = 0, top = -Infinity, bot = Infinity;
  for (const [, cy, cz, rx, ry, rz] of BLOBS) {
    const t = (z - cz) / rz;
    if (Math.abs(t) >= 1) continue;
    const f = Math.sqrt(1 - t * t);
    halfX = Math.max(halfX, rx * f);
    top = Math.max(top, cy + ry * f);
    bot = Math.min(bot, cy - ry * f);
  }
  return halfX > 0 ? { halfX, cy: (top + bot) / 2, halfY: (top - bot) / 2 } : null;
};
// The union's own z extent, then stations eased toward the ends so the caps
// are not a blunt disc.
let z0 = 0, z1 = 0;
for (const [, , cz, , , rz] of BLOBS) { z0 = Math.min(z0, cz - rz); z1 = Math.max(z1, cz + rz); }
const N = 13;
const rows = [];
for (let i = 0; i < N; i++) {
  const u = i / (N - 1);
  // Pull the samples IN from the exact ends: a station exactly at the tip has
  // zero radius, and a sweep capped by a zero-radius fan is a point, which
  // shows as a pinch. Half a percent in gives a small round cap instead.
  const z = z0 + (z1 - z0) * (0.004 + u * 0.992);
  const s = at(z);
  if (s) rows.push([z, s.cy, s.halfX, s.halfY]);
}
console.log(`// union z ${z0.toFixed(3)} .. ${z1.toFixed(3)}`);
for (const [z, cy, hx, hy] of rows) {
  console.log(`    { pos: [0, ${cy.toFixed(4)}, ${z.toFixed(4)}], rx: ${hx.toFixed(4)}, rz: ${hy.toFixed(4)} },`);
}
