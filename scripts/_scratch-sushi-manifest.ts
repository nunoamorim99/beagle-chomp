// Scratch: dump a shipped skin's part manifest for img2threejs's part-coverage
// gate (every model must be explodable AND clickable — a structure check, not a
// pixel one). Names come from the real builder, so an unnamed mesh shows up as
// a blank and fails the gate rather than passing silently.
import * as THREE from "three";
import { makeEnemy } from "../src/render/characters";
import { writeFileSync } from "node:fs";

const id = process.env.MODEL ?? "maki";
const g = makeEnemy(id, 0xe8615f);
g.updateMatrixWorld(true);
const parts: { id: string; name: string; type: string; parent: string }[] = [];
g.traverse((o) => {
  if (o === g) return;
  if (!o.name) return;
  parts.push({
    id: o.name,
    name: o.name,
    type: o instanceof THREE.Mesh ? "mesh" : "group",
    parent: o.parent?.name || "root",
  });
});
const out = process.env.OUT ?? `.img2threejs/${id}/parts.json`;
writeFileSync(out, JSON.stringify({ parts }, null, 1));
console.log(out, parts.length, "named parts;", parts.filter((p) => p.type === "group").length, "pivots");
