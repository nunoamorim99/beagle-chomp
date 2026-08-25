// Live regression test for the enemy idle wobble (animateGhostHem).
//
// THE BUG THIS GUARDS. animateGhostHem used to write ABSOLUTE values —
// `hem[i].position.y = 0.02 + wave` — throwing away whatever the builder had
// authored. The ghost's hem pieces happen to sit at exactly y = 0.02, so it
// looked fine there. But the BEE's stripe blobs and the LADYBUG's spots are
// placed on their body surface at y around 0.50 by bodySurfaceY/spotSurfaceY,
// and the first animated frame dropped every one of them to y = 0.02 — the
// spots fell off the bug onto the floor.
//
// It shipped, because it is invisible everywhere you would normally look: the
// character editor does not idle-animate enemies, so the models always looked
// correct there. Only a running game showed it. Hence this test — it builds the
// real meshes and actually runs a few frames of syncToEntity.
//
// Run: tsx scripts/test-enemy-idle.ts (npm run test:enemy-idle).
import * as THREE from "three";
import { makeEnemy, syncToEntity } from "../src/render/characters";
import { type Entity } from "../src/game/movement";

let failures = 0;
function check(label: string, cond: boolean): void {
  if (cond) {
    console.log(`  ok   ${label}`);
  } else {
    console.log(`  FAIL ${label}`);
    failures++;
  }
}

/** A stationary entity — idle is when the wobble runs. */
function idleEntity(): Entity {
  return {
    tile: { x: 1, y: 1 },
    dir: { x: 0, y: 0 },
    queued: { x: 0, y: 0 },
    facing: { x: 0, y: 1 },
    progress: 0,
    speed: 0,
  } as unknown as Entity;
}

const SKINS = ["ghost", "beetle", "bee", "ladybug"] as const;

for (const skin of SKINS) {
  console.log(`\n--- ${skin} ---`);
  const g = makeEnemy(skin, 0xff6688);

  const hem = g.userData.hem as THREE.Mesh[];
  // `skirt` is OPTIONAL: a character can decline the shared breathe. The
  // ladybug does — a breathing rim slid in and out of the tilted shell it is
  // meant to seal — and supplies a body bob of its own instead.
  const skirt = g.userData.skirt as THREE.Mesh | undefined;
  check(`${skin}: exposes a hem array`, Array.isArray(hem));

  const hemRest = hem.map((m) => m.position.y);
  const skirtRest = skirt
    ? { x: skirt.scale.x, y: skirt.scale.y, z: skirt.scale.z }
    : null;

  // Run a spread of frames so the wobble passes through several phases.
  const e = idleEntity();
  for (let i = 0; i < 40; i++) syncToEntity(g, e, 0.032);

  if (hem.length > 0) {
    // Every piece must still be within the wobble's amplitude of where it was
    // authored. The old bug moved them by ~0.5, so this is a wide margin that
    // still catches it decisively.
    const TOL = 0.05; // HEM_WOBBLE_HEIGHT is 0.02
    const drift = hem.map((m, i) => Math.abs(m.position.y - hemRest[i]));
    const worst = Math.max(...drift);
    check(
      `${skin}: hem pieces stay at their authored height (worst drift ${worst.toFixed(4)})`,
      worst <= TOL,
    );
    check(
      `${skin}: …and none collapsed toward the floor`,
      hem.every((m, i) => !(hemRest[i] > 0.2 && m.position.y < 0.1)),
    );
    // It must still actually MOVE, or "relative" could just mean "frozen".
    let moved = false;
    for (let i = 0; i < 40; i++) {
      syncToEntity(g, e, 0.032);
      if (hem.some((m, j) => Math.abs(m.position.y - hemRest[j]) > 1e-4)) moved = true;
    }
    check(`${skin}: hem still wobbles (the animation is alive)`, moved);
  } else {
    console.log(`  --   ${skin} has no hem pieces (by design)`);
  }

  // The skirt breathes around its AUTHORED scale, not around 1.
  if (skirt && skirtRest) {
    check(
      `${skin}: skirt breathes around its authored scale (${skirtRest.x})`,
      Math.abs(skirt.scale.x - skirtRest.x) <= skirtRest.x * 0.1,
    );
    check(`${skin}: skirt keeps its authored y scale`, Math.abs(skirt.scale.y - skirtRest.y) < 1e-6);
  } else {
    console.log(`  --   ${skin} declines the shared skirt breathe (by design)`);
  }
}

// The beetle authors a non-1 skirt scale, which is the case that proves the
// wobble is genuinely relative rather than coincidentally correct at 1.
console.log("\n--- the beetle's non-default skirt scale ---");
{
  const g = makeEnemy("beetle", 0xff6688);
  const skirt = g.userData.skirt as THREE.Mesh;
  check("beetle authors a skirt scale that is not 1", Math.abs(skirt.scale.x - 1) > 1e-6);
  const authored = skirt.scale.x;
  const e = idleEntity();
  for (let i = 0; i < 40; i++) syncToEntity(g, e, 0.032);
  check(
    `beetle: skirt still near its authored ${authored} after animating (${skirt.scale.x.toFixed(4)})`,
    Math.abs(skirt.scale.x - authored) <= authored * 0.1,
  );
}

console.log(`\n${failures === 0 ? "ALL ENEMY-IDLE CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
if (failures > 0) process.exit(1);
