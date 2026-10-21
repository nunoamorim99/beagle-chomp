// SCRATCH (IDEA-080 v2): beach biscuit vs the beach floor, as each look draws it.
import * as THREE from "three";
import { MAZE_THEMES } from "../src/game/themes";
import { snapToPalette, SURFACE_LIFT } from "../src/render/madboxStyle";
const lum = (h: number) => { const c = new THREE.Color(h); return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; };
const beach = MAZE_THEMES.find((t) => t.id === "beach")!;
console.log("SURFACE_LIFT", JSON.stringify(SURFACE_LIFT));
console.log("floor", beach.palette.floor.toString(16), "L", lum(beach.palette.floor).toFixed(3));
for (const c of process.argv.slice(2).map((h) => parseInt(h, 16))) {
  const e = snapToPalette(c);
  console.log(c.toString(16), "L", lum(c).toFixed(3), "->", e.id, lum(e.hex).toFixed(3));
}
