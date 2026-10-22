// SCRATCH: what each Journey island's deck colour snaps to under the shipped
// style, with the boot-time palette lift applied first (as main.ts does).
import { MAZE_THEMES } from "../src/game/themes";
import { liftPaletteForMadbox, snapToPalette } from "../src/render/madboxStyle";
for (const t of MAZE_THEMES) liftPaletteForMadbox(t.id, t.palette);
for (const t of MAZE_THEMES) {
  const g = t.palette.surroundGround;
  const e = snapToPalette(g);
  console.log(t.id.padEnd(8), "#" + g.toString(16).padStart(6, "0"), "->", e.id, "#" + e.hex.toString(16));
}
for (const h of process.argv.slice(2)) {
  const e = snapToPalette(parseInt(h, 16));
  console.log("probe", h, "->", e.id, "#" + e.hex.toString(16));
}
