// SCRATCH (IDEA-065 v29): which tails have a group whose material does not exist?
//
// `ringedTail`'s far cap is generated at t = 1 exactly, and the default band
// rule is `floor(t * bands) % 2` — which at t = 1 with `bands: 1` is **1**.
// A tail asking for no banding at all therefore put its apex fan in band 1,
// and a mesh carrying a one-element material array draws nothing for it.
// A hole, in silence.
import * as THREE from "three";
import { makePropById } from "../src/render/board";

for (const id of [
  "critter-deer",
  "critter-fox",
  "critter-rabbit",
  "critter-raccoon",
  "critter-squirrel",
  "critter-squirrel-explorer",
]) {
  const p = makePropById(id, 0.29);
  p.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.name !== "tail") return;
    const mats = Array.isArray(m.material) ? m.material.length : 1;
    const groups = m.geometry.groups;
    const bad = groups.filter((g) => Array.isArray(m.material) && g.materialIndex! >= mats);
    const tris = (m.geometry.getIndex()?.count ?? 0) / 3;
    console.log(
      `${id.padEnd(26)} ${tris} tris, ${mats} material(s), groups [` +
        groups.map((g) => `${g.materialIndex}:${g.count / 3}`).join(" ") +
        `]` +
        (bad.length ? `   <-- ${bad.reduce((n, g) => n + g.count / 3, 0)} UNDRAWN triangles` : ""),
    );
  });
}
