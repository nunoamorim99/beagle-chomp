// SCRATCH: did a change to `ringedTail` move the OTHER tails?
// Hashes each critter's tail vertices and index, so "nothing else moved" is a
// statement rather than a hope.
import * as THREE from "three";
import { createHash } from "node:crypto";
import { makePropById } from "../src/render/board";
for (const id of ["critter-deer","critter-fox","critter-rabbit","critter-raccoon","critter-squirrel","critter-squirrel-explorer"]) {
  const p = makePropById(id, 0.29);
  p.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.name !== "tail") return;
    const h = createHash("sha1");
    h.update(Buffer.from((m.geometry.getAttribute("position").array as Float32Array).buffer));
    const idx = m.geometry.getIndex();
    if (idx) h.update(Buffer.from((idx.array as Uint16Array | Uint32Array).buffer));
    console.log(`${id.padEnd(26)} ${h.digest("hex").slice(0, 16)}  groups ${m.geometry.groups.map((g) => g.materialIndex).join(",") || "-"}`);
  });
}
