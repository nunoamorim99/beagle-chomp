// SCRATCH (IDEA-065 v5): where does every one of the cabin's authored colours
// land once the shipped style snaps it?
//
// The cabin is authored in `toon()` (the rule) and drawn as a matcap over a
// SNAPPED palette entry, so what a player sees is not the number in the source
// file. This prints both, with the lightness of each, because the snap rewards
// the higher-key candidate by a standing 0.22 and that is what collapses a
// value step.
import * as THREE from "three";
import { MAZE_THEMES } from "../src/game/themes";
import { snapToPalette, boardBounce, liftSurfaceColor } from "../src/render/madboxStyle";
import { makePropById } from "../src/render/board";

const FOREST = MAZE_THEMES.find((t) => t.id === "forest")!;
void boardBounce;
void liftSurfaceColor;

const lum = (hex: number) => {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
};

const cabin = makePropById("log-cabin", 0.44);
const seen = new Map<number, { parts: string[]; role?: string }>();
cabin.traverse((o) => {
  const m = o as THREE.Mesh;
  if (!m.isMesh) return;
  for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
    const any = mat as THREE.MeshToonMaterial;
    if (!any.color) continue;
    const hex = any.color.getHex();
    const row: { parts: string[]; role?: string } =
      seen.get(hex) ?? { parts: [], role: any.userData?.madboxRole as string | undefined };
    row.parts.push(m.name || "(unnamed)");
    seen.set(hex, row);
  }
});

console.log(`forest palette.wall = #${FOREST.palette.wall.toString(16)}\n`);
console.log("authored        L     ->  snapped          L     delta   parts");
const rows = [...seen.entries()].sort((a, b) => lum(b[0]) - lum(a[0]));
for (const [hex, row] of rows) {
  const e = snapToPalette(hex, row.role);
  const a = lum(hex);
  const b = lum(e.hex);
  console.log(
    `#${hex.toString(16).padStart(6, "0")}  ${a.toFixed(3)}  ->  ` +
      `${e.id.padEnd(7)} #${e.hex.toString(16).padStart(6, "0")}  ${b.toFixed(3)}  ` +
      `${(b - a >= 0 ? "+" : "") + (b - a).toFixed(3)}   ${[...new Set(row.parts)].slice(0, 4).join(" ")}`,
  );
}

// The question the whole review turns on: does the roof still stand apart
// from the wall after the snap? Read off the REAL materials rather than from
// hexes typed here, which is how the first version of this probe went stale
// the moment the colours it was written for changed.
const by = (name: string) => {
  let hex: number | undefined;
  let role: string | undefined;
  cabin.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.name !== name) return;
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshToonMaterial;
    hex = mat.color.getHex();
    role = (mat.userData as { madboxRole?: string }).madboxRole;
  });
  if (hex === undefined) throw new Error("no part named " + name);
  return snapToPalette(hex, role);
};
const pairs: Array<[string, string]> = [
  ["courses", "roofL"],
  ["courses", "cornerEnds"],
  ["courses", "door"],
  ["roofL", "shingle0"],
  ["roofL", "ridgeCap"],
  ["courses", "body"],
];
console.log("");
console.log("the ladder, as the player sees it:");
for (const [a, b] of pairs) {
  const ea = by(a);
  const eb = by(b);
  console.log(
    `  ${(a + " vs " + b).padEnd(26)} ${ea.id.padEnd(8)} ${lum(ea.hex).toFixed(3)} | ` +
      `${eb.id.padEnd(8)} ${lum(eb.hex).toFixed(3)}  ->  ${Math.abs(lum(ea.hex) - lum(eb.hex)).toFixed(3)} apart`,
  );
}
