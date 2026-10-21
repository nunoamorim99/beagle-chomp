// SCRATCH (IDEA-081 phase 5): park biscuit vs the park floor, as each look draws it.
import * as THREE from "three";
import { MAZE_THEMES } from "../src/game/themes";
import { SURFACE_LIFT, liftSurfaceColor, snapToPalette } from "../src/render/madboxStyle";
const lum = (h: number) => { const c = new THREE.Color(h); return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; };
const park = MAZE_THEMES.find((t) => t.id === "park")!;
const f = park.palette.floor;
console.log("floor", f.toString(16), "L", lum(f).toFixed(3), "lifted", liftSurfaceColor(f, SURFACE_LIFT.floorL).toString(16), "L", lum(liftSurfaceColor(f, SURFACE_LIFT.floorL)).toFixed(3));
for (const c of [park.palette.biscuit, ...process.argv.slice(2).map((h) => parseInt(h, 16))]) {
  const e = snapToPalette(c);
  console.log(c.toString(16), "L", lum(c).toFixed(3), "->", e.id, lum(e.hex).toFixed(3));
}
