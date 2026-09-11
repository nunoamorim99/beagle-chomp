// IDEA-060: tune the foliage lobe field against the shrub reference's MEASURED
// silhouette roughness — sd/mean of the outline radius = 0.135, see
// .img2threejs/garden-props/measurements.json. A sphere measures 0.0; every
// plant this project shipped before was spheres.
//
// The reference's 0.135 is inflated by a few long sprigs (max/mean 1.38), so
// a solid lobed mass should land in the low end of that band, ~0.10-0.14.
import { lobedFoliageGeometry, lobedRoughness } from "../src/render/foliage";

// Control first, ALWAYS. This is what caught two broken instruments: a shape
// with no lobing at all must read 0.
console.log("control (amplitude 0):", lobedRoughness({ amplitude: 0 }).toFixed(4), "\n");

console.log("lobes  sharp  amp    roughness");
for (const lobes of [8, 12, 16, 22]) {
  for (const sharpness of [6, 10, 16]) {
    for (const amplitude of [0.12, 0.18, 0.24, 0.3]) {
      const rough = lobedRoughness({ lobes, sharpness, amplitude, seed: 7 });
      const flag = rough >= 0.1 && rough <= 0.145 ? "  <- in band" : "";
      console.log(
        `${String(lobes).padStart(5)}  ${String(sharpness).padStart(5)}  ${amplitude.toFixed(2)}   ${rough.toFixed(4)}${flag}`,
      );
    }
  }
}
const g = lobedFoliageGeometry(1, { detail: 2 });
console.log("\nshipped detail 2 costs", g.attributes.position.count / 3, "tris");
