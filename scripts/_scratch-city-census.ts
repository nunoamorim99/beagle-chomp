// IDEA-082: Night City's surround — draw calls, triangles, and what is in it.
import * as THREE from "three";
import { MAZE_THEMES } from "../src/game/themes";
import { ensureSurround, buildSurroundContent, disposeSurround } from "../src/render/surroundRecipe";
import { makeSurroundMaterials } from "../src/render/surroundProps";
import { setSurroundView } from "../src/render/surround";
const city = MAZE_THEMES.find((t) => t.id === "city")!;
for (const [label, view] of [["full", null], ["phone", [15.3, 22.4, -38.7]], ["desktop", [31.6, 11.9, -21.2]]] as const) {
  if (view) setSurroundView(view[0], view[1], view[2]);
  const raw = buildSurroundContent("cityblocks", makeSurroundMaterials(city.palette));
  const counts: Record<string, number> = {};
  raw.getObjectByName("city-streets")!.children.forEach((c) => (counts[c.name] = (counts[c.name] ?? 0) + 1));
  const g = ensureSurround(new THREE.Group(), "cityblocks", city.palette)!;
  let meshes = 0, tris = 0;
  g.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh) return; meshes++; const p = m.geometry.attributes.position; tris += (m.geometry.index ? m.geometry.index.count : p.count) / 3; });
  console.log(label, "calls", meshes, "tris", Math.round(tris), JSON.stringify(counts));
  disposeSurround();
}
