// SCRATCH (IDEA-081): which palette entry the park gate's foliage lands on,
// against the maze wall's own.
import { SURFACE_LIFT, liftSurfaceColor, snapToPalette } from "../src/render/madboxStyle";
import { hexOf, lit, rgbOf } from "../src/render/paint";
const wall = 0x5aa348;
const h = (n: number) => "#" + n.toString(16).padStart(6, "0");
console.log("wall", h(wall), "lifted", h(liftSurfaceColor(wall, SURFACE_LIFT.wallL)), "->", snapToPalette(liftSurfaceColor(wall, SURFACE_LIFT.wallL)).id);
for (const a of process.argv.slice(2).map((x) => parseInt(x, 16))) {
  const b = hexOf(lit(rgbOf(a), 1.34));
  console.log("authored", h(a), "x1.34", h(b), "->", snapToPalette(b).id, h(snapToPalette(b).hex));
}
