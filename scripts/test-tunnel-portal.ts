// IDEA-083: guards the tunnel portals (src/render/tunnelPortal.ts).
//
// Three things can go wrong without anything erroring: a maze whose tunnel gets
// no portal, a theme that silently falls back to a borrowed colour, and a
// portal material the IDEA-079 matcap swap would replace (it swaps anything
// carrying a `.color`, which would turn the glow into a flat lit disc).
import * as THREE from "three";
import { Grid } from "../src/game/grid";
import { MAZES } from "../src/game/mazes";
import { MAZE_THEMES } from "../src/game/themes";
import { ARCH_PARAMS, archAperture, tunnelMouths } from "../src/render/archway";
import { getPropDef, type PropParams } from "../src/game/props";
import { PORTAL_COLORS, buildTunnelPortals, portalShapeFor } from "../src/render/tunnelPortal";

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string): void {
  if (cond) passed++;
  else failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${msg}`);
}

console.log("Every shipped theme picked its own portal colour");
for (const t of MAZE_THEMES) ok(!!PORTAL_COLORS[t.id], `"${t.id}" has a PORTAL_COLORS entry`);
const rims = MAZE_THEMES.map((t) => PORTAL_COLORS[t.id]?.rim);
ok(new Set(rims).size === rims.length, "no two themes share a rim colour");

console.log("\nThe doorway fills its own arch's opening and stays inside it");
for (const t of MAZE_THEMES) {
  const sh = portalShapeFor(t);
  if (!t.tunnelArch) {
    ok(sh.hw > 0.1 && sh.springY + sh.rise > 0.5, `"${t.id}" has no arch and still gets a real doorway`);
    continue;
  }
  const ap = archAperture((getPropDef(t.tunnelArch).params ?? {}) as PropParams);
  const k = ARCH_PARAMS.scale;
  ok(
    sh.hw <= ap.hw * k && sh.hw >= ap.hw * k * 0.85,
    `"${t.id}": width sits just inside the opening (${sh.hw.toFixed(3)} of ${(ap.hw * k).toFixed(3)})`,
  );
  const top = sh.springY + sh.rise;
  const apTop = (ap.springY + ap.rise) * k;
  ok(
    top <= apTop && top >= apTop * 0.9,
    `"${t.id}": height reaches the crown without passing it (${top.toFixed(3)} of ${apTop.toFixed(3)})`,
  );
}

console.log("\nEvery tunnel mouth of every maze gets a portal, on every theme");
let mouthsSeen = 0;
const failedBefore = failed;
MAZES.forEach((rows, i) => {
  const grid = new Grid(rows);
  const mouths = tunnelMouths(grid).length;
  mouthsSeen += mouths;
  for (const theme of MAZE_THEMES) {
    const scene = new THREE.Scene();
    const portals = buildTunnelPortals(scene, grid, theme);
    const count = portals ? portals.group.children.length : 0;
    if (count !== mouths) ok(false, `maze ${i} / ${theme.id}: ${count} portals for ${mouths} mouths`);
    portals?.dispose();
    if (scene.children.length !== 0) ok(false, `maze ${i} / ${theme.id}: dispose left the group in the scene`);
  }
});
ok(mouthsSeen > 0, `the instrument saw tunnels at all (${mouthsSeen} mouths across ${MAZES.length} mazes)`);
ok(failed === failedBefore, "a portal at every mouth, and dispose() removes it");

console.log("\nThe style swap cannot reach it");
{
  const scene = new THREE.Scene();
  const portals = buildTunnelPortals(scene, new Grid(MAZES[0]), MAZE_THEMES[0]);
  const mats = new Set<THREE.Material>();
  portals?.group.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (m) mats.add(m as THREE.Material);
  });
  ok(mats.size === 3, `three shared materials for the whole pair (got ${mats.size})`);
  for (const m of mats) {
    ok(m.type === "ShaderMaterial" && !("color" in m), `${m.type} has no .color for applyMadboxStyle to swap`);
    ok(m.blending === THREE.AdditiveBlending && !m.depthWrite, "additive and no depth write");
  }
  portals?.pulse(1);
  portals?.update(0.1);
  ok(true, "pulse + update run headless");
}

console.log("\n" + "-".repeat(60));
console.log(`TUNNEL PORTAL: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
