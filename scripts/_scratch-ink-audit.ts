// Which colours in this game are INK (a marking that must stay dark) and which
// are a dark SURFACE that the high-key rule should lift?
//
// A lightness threshold alone cannot tell them apart: the beagle's saddle and
// Deep Forest's foliage sit within a few percent of each other. Saturation is
// what separates them, and this is the measurement that proves it.
import { BEAGLE_SKINS } from "../src/game/cosmetics.js";
import { MAZE_THEMES } from "../src/game/themes.js";

const hsl = (hex: number) => {
  const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return { h: 0, s: 0, l };
  const d = mx - mn;
  return { h: 0, s: l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn), l };
};
const row = (label: string, hex: number, verdict: string) => {
  const c = hsl(hex);
  console.log(
    label.padEnd(26),
    `#${hex.toString(16).padStart(6, "0")}`,
    `l${c.l.toFixed(3)}`,
    `s${c.s.toFixed(3)}`,
    " ",
    verdict,
  );
};

console.log("\nBEAGLE COATS — the black channel is a MARKING and must survive");
for (const sk of BEAGLE_SKINS) {
  const c = sk.coat as unknown as Record<string, number | undefined>;
  for (const ch of ["black", "tan", "white", "ear", "paw"]) {
    if (typeof c[ch] === "number") row(`${sk.id}.${ch}`, c[ch]!, ch === "black" ? "<- must stay dark" : "");
  }
}

console.log("\nDARK THEME SURFACES — these SHOULD lift");
for (const t of MAZE_THEMES) {
  const p = t.palette;
  for (const [slot, hex] of [["wall", p.wall], ["floor", p.floor], ["surroundGround", p.surroundGround]] as const) {
    const c = hsl(hex);
    if (c.l < 0.32) row(`${t.id}.${slot}`, hex, "");
  }
}
