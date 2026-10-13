// SCRATCH: what does the shipped style do to a candidate colour?
//   npx tsx scripts/_scratch-snap-probe.ts <hex> [role] ...
import * as THREE from "three";
import { snapToPalette } from "../src/render/madboxStyle";

const lum = (hex: number) => {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
};
for (const arg of process.argv.slice(2)) {
  const [hexs, role] = arg.split(":");
  const hex = Number.parseInt(hexs.replace("#", ""), 16);
  const e = snapToPalette(hex, role);
  console.log(
    `#${hex.toString(16).padStart(6, "0")} ${role ? "[" + role + "]" : "       "} L ${lum(hex).toFixed(3)}` +
      `  ->  ${e.id.padEnd(8)} #${e.hex.toString(16).padStart(6, "0")} L ${lum(e.hex).toFixed(3)}`,
  );
}
