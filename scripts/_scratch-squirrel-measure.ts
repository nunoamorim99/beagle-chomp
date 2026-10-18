// SCRATCH (IDEA-065 v28): the squirrel's plume against the reference.
//
// Measured on the prop AS IT SHIPS (`makePropById` applies props.ts's saved
// edits), in the BODY's frame — `makeForestCritter` gives every instance a
// random yaw, so world x/z is contaminated (the deer's leg check, v13).
import * as THREE from "three";
import { makePropById } from "../src/render/board";

for (const id of ["critter-squirrel", "critter-squirrel-explorer"]) {
  const g = makePropById(id, 0.29);
  if (!g) { console.log(`${id}: not in the library`); continue; }
  g.updateMatrixWorld(true);
  const inner = g.children[0];
  const toLocal = new THREE.Matrix4().copy(inner.matrixWorld).invert();
  const named = (n: string): THREE.Object3D | undefined => {
    let hit: THREE.Object3D | undefined;
    g.traverse((o) => { if (o.name === n && !hit) hit = o; });
    return hit;
  };
  const box = (o: THREE.Object3D | undefined): THREE.Box3 | null => {
    if (!o) return null;
    const b = new THREE.Box3();
    o.traverse((c) => {
      const m = c as THREE.Mesh;
      if (!m.isMesh) return;
      const p = m.geometry.getAttribute("position");
      for (let i = 0; i < p.count; i++) {
        b.expandByPoint(new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld).applyMatrix4(toLocal));
      }
    });
    return b.isEmpty() ? null : b;
  };
  const whole = box(g)!;
  const tail = box(named("tail"));
  const head = box(named("head"));
  const body = box(named("body")) ?? box(named("torso"));
  const H = whole.max.y - whole.min.y;
  const fmt = (b: THREE.Box3 | null, n: string) => {
    if (!b) return `${n}: absent`;
    const w = b.max.x - b.min.x, h = b.max.y - b.min.y, d = b.max.z - b.min.z;
    return `${n.padEnd(6)} w ${w.toFixed(3)}  h ${h.toFixed(3)}  d ${d.toFixed(3)}   y ${b.min.y.toFixed(2)}..${b.max.y.toFixed(2)}  z ${b.min.z.toFixed(2)}..${b.max.z.toFixed(2)}`;
  };
  console.log(`\n== ${id}   standing height ${H.toFixed(3)}`);
  console.log("  " + fmt(whole, "whole"));
  console.log("  " + fmt(body, "body"));
  console.log("  " + fmt(head, "head"));
  console.log("  " + fmt(tail, "tail"));
  if (tail && body && head) {
    console.log(
      `  tail height / standing   ${((tail.max.y - tail.min.y) / H).toFixed(3)}  (reference 0.98)\n` +
      `  tail depth  / body depth ${((tail.max.z - tail.min.z) / (body.max.z - body.min.z)).toFixed(3)}\n` +
      `  tail width  / body width ${((tail.max.x - tail.min.x) / (body.max.x - body.min.x)).toFixed(3)}  (reference 0.85)\n` +
      `  tail crest  vs head top  ${(tail.max.y - head.max.y >= 0 ? "+" : "")}${(tail.max.y - head.max.y).toFixed(3)}  (reference +, the crest is above the head)`,
    );
  }
  const t = named("tail") as THREE.Mesh | undefined;
  if (t?.isMesh) {
    const gr = t.geometry.groups;
    const tris = (t.geometry.getIndex()?.count ?? 0) / 3;
    console.log(`  tail mesh: ${tris} tris, ${gr.length} group(s) ${gr.map((x) => `${x.materialIndex}:${x.count / 3}`).join(" ")}`);
  }
}
