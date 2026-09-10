// Scratch: world bounds of every NAMED part of the pizza mascot.
//
// It exists because IDEA-057 proved the point twice over: a render shows a
// perfectly plausible model while three subsystems sit invisibly inside a
// solid, and an envelope that measures wrong tells you nothing about WHICH
// part is doing it. Look at the render to judge the shape; measure the parts
// to find out why it is that shape.
import * as THREE from "three";
import { makeEnemy } from "../src/render/characters";

const g = makeEnemy("pizza", 0xe8615f);
g.updateMatrixWorld(true);

const whole = new THREE.Box3().setFromObject(g);
const ws = whole.getSize(new THREE.Vector3());
console.log(
  `WHOLE  w ${ws.x.toFixed(4)}  h ${ws.y.toFixed(4)}  l ${ws.z.toFixed(4)}  ` +
    `w/h ${(ws.x / ws.y).toFixed(3)}  floor ${whole.min.y.toFixed(4)}`,
);
console.log("");

const only = process.argv[2];
const rows: { name: string; b: THREE.Box3; tris: number }[] = [];
g.traverse((o) => {
  if (!(o instanceof THREE.Mesh) || !o.name) return;
  if (only && !o.name.toLowerCase().includes(only.toLowerCase())) return;
  const geo = o.geometry;
  rows.push({
    name: o.name,
    b: new THREE.Box3().setFromObject(o),
    tris: Math.round(geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3),
  });
});

// Sorted by how far each part reaches out laterally, then up: the two numbers
// the whole design is budgeted against.
rows.sort((a, b) => Math.max(-b.b.min.x, b.b.max.x) - Math.max(-a.b.min.x, a.b.max.x));
for (const r of rows) {
  const reach = Math.max(-r.b.min.x, r.b.max.x);
  console.log(
    `${r.name.padEnd(18)} |x|max ${reach.toFixed(4)}  ` +
      `y [${r.b.min.y.toFixed(4)}, ${r.b.max.y.toFixed(4)}]  ` +
      `z [${r.b.min.z.toFixed(4)}, ${r.b.max.z.toFixed(4)}]  tris ${String(r.tris).padStart(5)}`,
  );
}
