// What the surface lift does to EVERY theme, not just the garden.
//
// The specific worry: liftSurface forces saturation up to 0.34 for anything
// above a 0.06 floor. A near-grey sits just over that line with a hue that is
// essentially noise — so it can come back as a VIVID arbitrary colour. That is
// the same shape as the bug that turned Night City's island violet, and it was
// never checked on the board palettes.
import { MAZE_THEMES } from "../src/game/themes.js";
import { liftPaletteForMadbox, NEUTRAL_MAX_S } from "../src/render/madboxStyle.js";

const hsl = (hex: number) => {
  const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return { h: 0, s: 0, l };
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h: number;
  if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (mx === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h, s, l };
};
const hx = (n: number) => "#" + n.toString(16).padStart(6, "0");
const SLOTS = ["floor", "wall", "surroundGround", "fenceColor", "groundDetailColor"] as const;

let flagged = 0;
for (const t of MAZE_THEMES) {
  const before: Record<string, number> = {};
  const p = t.palette as unknown as Record<string, number>;
  for (const s of SLOTS) if (typeof p[s] === "number") before[s] = p[s];
  const res = liftPaletteForMadbox(t.id, t.palette);
  console.log(`\n${t.name} (${t.id})${res === null ? "   [EXEMPT]" : ""}`);
  for (const s of SLOTS) {
    if (before[s] === undefined) continue;
    const a = hsl(before[s]);
    const b = hsl(p[s]);
    // A saturation JUMP on a near-grey is the danger: its hue is noise, so
    // forcing saturation invents a colour nobody chose.
    // THE SAME LINE THE CODE USES. A threshold of its own drifts away from
    // the thing it is checking and then flags a boundary case as a bug —
    // City Park at s 0.19 is a real warm tan, and the audit called it an
    // invention only because it was using 0.2 where the code uses 0.18.
    const invented = a.s < NEUTRAL_MAX_S && b.s > a.s + 0.02;
    if (invented) flagged++;
    console.log(
      `  ${s.padEnd(18)} ${hx(before[s])} s${a.s.toFixed(2)} l${a.l.toFixed(2)}  ->  ` +
        `${hx(p[s])} s${b.s.toFixed(2)} l${b.l.toFixed(2)}` +
        (invented ? "   <-- INVENTED COLOUR (near-grey pushed to saturation)" : ""),
    );
  }
}
console.log(`\n${flagged} slot(s) flagged`);
