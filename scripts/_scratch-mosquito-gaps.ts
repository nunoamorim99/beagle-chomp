// Proves every mosquito leg joint is CONTAINED in a solid.
//
// This is a containment test on purpose, and it is the same check IDEA-053 had
// to add for the flea. A distance-to-nearest-vertex check cannot tell inside
// from outside: it happily reports a knuckle ball's own radius as a "gap" while
// missing a limb that has genuinely come apart. So this walks each leg's
// centreline and asks, at every sample, whether the point lies inside at least
// one capsule or sphere of that leg.
//
// The defect it guards: CapsuleGeometry's `length` argument is the CYLINDER
// only — the caps add `radius` on top. A segment sized as a FRACTION of its
// joint span leaves a gap, and axial overlap does not close the open wedge
// ACROSS a ~132° fold. The flea's hind leg shipped in three visible pieces from
// exactly this.
//
//   npx tsx scripts/_scratch-mosquito-gaps.ts
import * as THREE from "three";
import { makeMosquito } from "../src/render/characters";

const g = makeMosquito(0xe8615f);
g.updateMatrixWorld(true);

type Solid =
  | { kind: "capsule"; a: THREE.Vector3; b: THREE.Vector3; r: number; name: string }
  | { kind: "sphere"; c: THREE.Vector3; r: number; name: string };

const LEG_TAGS = ["FL", "FR", "ML", "MR", "HL", "HR"];
const solids = new Map<string, Solid[]>();
for (const t of LEG_TAGS) solids.set(t, []);

g.traverse((o) => {
  if (!(o instanceof THREE.Mesh)) return;
  const m = /^(femur|tibia|foot|knee|ankle)([FMH][LR])$/.exec(o.name);
  if (!m) return;
  const [, part, tag] = m;
  const p = o.geometry.parameters as { radius: number; length?: number };
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  o.getWorldPosition(pos);
  o.getWorldQuaternion(quat);
  if (part === "knee" || part === "ankle") {
    solids.get(tag)!.push({ kind: "sphere", c: pos.clone(), r: p.radius, name: o.name });
  } else {
    const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(quat);
    const half = (p.length ?? 0) / 2;
    solids.get(tag)!.push({
      kind: "capsule",
      a: pos.clone().addScaledVector(axis, -half),
      b: pos.clone().addScaledVector(axis, half),
      r: p.radius,
      name: o.name,
    });
  }
});

function inside(pt: THREE.Vector3, s: Solid): boolean {
  if (s.kind === "sphere") return pt.distanceTo(s.c) <= s.r + 1e-9;
  const ab = s.b.clone().sub(s.a);
  const t = THREE.MathUtils.clamp(pt.clone().sub(s.a).dot(ab) / ab.lengthSq(), 0, 1);
  return pt.distanceTo(s.a.clone().addScaledVector(ab, t)) <= s.r + 1e-9;
}

let worstGap = 0;
let failures = 0;
let sampled = 0;

for (const tag of LEG_TAGS) {
  const list = solids.get(tag)!;
  const caps = list.filter((s): s is Extract<Solid, { kind: "capsule" }> => s.kind === "capsule");
  const order = ["femur", "tibia", "foot"].map((n) => caps.find((c) => c.name.startsWith(n))!);
  if (order.some((c) => !c)) throw new Error(`leg ${tag}: missing a segment`);

  // Centreline: femur.a → femur.b → tibia.b → foot.b, chained by proximity so a
  // capsule authored "backwards" cannot silently pass.
  const chain: THREE.Vector3[] = [order[0].a.clone()];
  let cursor = order[0].a.clone();
  for (const c of order) {
    const far = c.a.distanceTo(cursor) < c.b.distanceTo(cursor) ? c.b : c.a;
    chain.push(far.clone());
    cursor = far.clone();
  }

  for (let i = 0; i < chain.length - 1; i++) {
    const STEPS = 200;
    for (let k = 0; k <= STEPS; k++) {
      const pt = chain[i].clone().lerp(chain[i + 1], k / STEPS);
      sampled++;
      if (list.some((s) => inside(pt, s))) continue;
      failures++;
      // report how far outside the nearest solid it is
      const d = Math.min(
        ...list.map((s) =>
          s.kind === "sphere"
            ? pt.distanceTo(s.c) - s.r
            : (() => {
                const ab = s.b.clone().sub(s.a);
                const t = THREE.MathUtils.clamp(pt.clone().sub(s.a).dot(ab) / ab.lengthSq(), 0, 1);
                return pt.distanceTo(s.a.clone().addScaledVector(ab, t)) - s.r;
              })(),
        ),
      );
      worstGap = Math.max(worstGap, d);
      if (failures <= 8) {
        console.log(
          `  GAP leg ${tag} seg${i} t=${(k / STEPS).toFixed(3)} outside by ${d.toFixed(5)}`,
        );
      }
    }
  }
}

console.log(`sampled ${sampled} centreline points across ${LEG_TAGS.length} legs`);
console.log(`solids per leg: ${solids.get("FL")!.length} (3 capsules + 2 knuckles)`);
if (failures) {
  console.log(`FAIL: ${failures} samples outside every solid; worst ${worstGap.toFixed(5)}`);
  process.exit(1);
}
console.log("PASS: every leg centreline point is contained in a solid");
