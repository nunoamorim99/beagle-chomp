// Scratch: the burger through the REAL game path, not the preview harness.
//
// /preview-rework/ calls makeEnemy() directly. The game goes through
// cosmetics -> shop -> game.ts -> applyGhostState -> syncToEntity, and the
// preview exercises none of that. This checks the contract the game actually
// depends on.
import * as THREE from "three";
import { makeEnemy, applyGhostState, type GhostUserData } from "../src/render/characters";
import { ENEMY_SKINS, getEnemySkin } from "../src/game/cosmetics";
import { ENEMY_SLOTS } from "../src/game/config";

let fails = 0;
const check = (name: string, ok: boolean) => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) fails++;
};

const skin = ENEMY_SKINS.find((s) => s.id === "burger");
check("burger is in the shop registry", !!skin);
check("burger resolves through getEnemySkin", getEnemySkin("burger").id === "burger");
check("burger has a blurb", !!skin?.blurb && skin.blurb.length > 8);

for (const slot of ENEMY_SLOTS) {
  const g = makeEnemy("burger", slot.color);
  const ud = g.userData as GhostUserData;
  check(`${slot.id}: builds with the slot colour`, ud.bodyMat.color.getHex() === slot.color);
  check(`${slot.id}: has pupil pivots`, ud.pupPivots.length === 2);
  check(`${slot.id}: has its own behaviour`, typeof ud.behaviour?.animate === "function");
  check(`${slot.id}: opts out of the shared hem`, ud.hem.length === 0);
  check(`${slot.id}: accentMats is empty (the banding must survive)`, (ud.accentMats ?? []).length === 0);

  // The three states the game drives, and back again. The round trip is the
  // part that has broken before: a builder that forgets pupBaseColor gets its
  // pupils quietly repainted ghost-blue on the way home.
  const bodyBefore = ud.bodyMat.color.getHex();
  const pupBefore = ud.pupM.color.getHex();
  applyGhostState(g, "frightened", { x: 0, y: 1 });
  check(`${slot.id}: frightened repaints the bread`, ud.bodyMat.color.getHex() !== bodyBefore);
  applyGhostState(g, "eaten", { x: 0, y: 1 });
  applyGhostState(g, "chase", { x: 0, y: 1 });
  check(`${slot.id}: chase restores the team colour`, ud.bodyMat.color.getHex() === bodyBefore);
  check(`${slot.id}: chase restores the pupil colour`, ud.pupM.color.getHex() === pupBefore);

  // The pitch must SURVIVE a state change - IDEA-056 rule 3. applyGhostState
  // writes rotation.x on the ROOT, so a pitch authored there would be gone.
  const stack = g.getObjectByName("stack")!;
  check(`${slot.id}: the play-camera pitch survives a state change`, Math.abs(stack.rotation.x) > 0.2);

  // The REST envelope: measured from vertices, because Box3.setFromObject
  // over-reports any child with an off-axis rotation and this model has two.
  const v = new THREE.Vector3();
  const measure = (): THREE.Box3 => {
    const b = new THREE.Box3();
    g.updateMatrixWorld(true);
    g.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        b.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld));
      }
    });
    return b;
  };
  const rest = measure();
  const size = rest.getSize(new THREE.Vector3());
  check(`${slot.id}: fits a maze tile (${size.x.toFixed(3)} x ${size.z.toFixed(3)})`, size.x < 1 && size.z < 1);
  check(`${slot.id}: stands on the floor at rest (${rest.min.y.toFixed(3)})`, Math.abs(rest.min.y) < 0.02);

  // And the ANIMATED envelope, which is a different question and has a
  // different answer. A stride swings a boot whose toe projects on +Z, and
  // rotating that about X drops it below its rest height — every enemy in this
  // cast sinks a little (ghost 0.035, pizza 0.029, crab 0.022) and none of it
  // is visible in a still. The bar is the cast's own worst, not zero.
  let sink = 0;
  let animWidth = 0;
  for (let i = 0; i <= 60; i++) {
    const t = (i / 60) * 2.4;
    ud.behaviour?.animate?.(t, t * 0.7, 1);
    const b = measure();
    sink = Math.max(sink, rest.min.y - b.min.y);
    animWidth = Math.max(animWidth, b.max.x - b.min.x);
  }
  check(`${slot.id}: the walk cycle leaves the pitch alone`, Math.abs(stack.rotation.x) > 0.2);
  check(`${slot.id}: stride sink ${sink.toFixed(3)} is within the cast's range`, sink <= 0.035);
  check(
    `${slot.id}: animated width ${animWidth.toFixed(3)} does not take the crab's 0.861`,
    animWidth < 0.861,
  );
}

console.log(fails ? `\nBURGER IN-GAME: ${fails} FAILED` : "\nBURGER IN-GAME: all checks passed");
process.exit(fails ? 1 : 0);
