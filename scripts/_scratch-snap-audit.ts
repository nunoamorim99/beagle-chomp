// What does every island colour actually snap to? A palette that "unifies" by
// sending the beach's sand to a brown and the city's grey to a violet is not a
// palette, it is a bug with a colour scheme.
import * as THREE from "three";
import { JOURNEY_LEVELS } from "../src/game/journey.js";
import { makeJourneyIsland } from "../src/render/journeyIsland.js";
import { snapToPalette } from "../src/render/madboxStyle.js";

const hsl = (hex: number): string => {
  const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return `h  -  s0.00 l${l.toFixed(2)}`;
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h: number;
  if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (mx === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return `h${(h * 360).toFixed(0).padStart(3)} s${s.toFixed(2)} l${l.toFixed(2)}`;
};

for (const idx of [6, 7, 8, 9, 10, 11]) {
  const lv = JOURNEY_LEVELS[idx];
  const isl = makeJourneyIsland(lv, idx, undefined, "signature");
  const rows: string[] = [];
  isl.group.traverse((o: THREE.Object3D) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    mats.forEach((mat, i) => {
      const c = (mat as THREE.MeshStandardMaterial).color;
      if (!c) return;
      const hex = c.getHex();
      const role = m.name === "island-body" ? (i === 1 ? "DECK" : "skirt") : m.name === "island-beach" ? "BEACH" : "";
      if (role) rows.push(`    ${role.padEnd(6)} #${hex.toString(16).padStart(6, "0")} ${hsl(hex)}  ->  ${snapToPalette(hex, m.name).id}`);
    });
  });
  console.log(`${idx} ${lv.themeId}`);
  for (const r of [...new Set(rows)]) console.log(r);
}
