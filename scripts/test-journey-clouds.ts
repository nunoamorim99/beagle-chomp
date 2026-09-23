// Guards the clouds over locked chapters (IDEA-079).
//
// Pure, so it runs in `npm run test`. Two of these encode defects that reached
// a render, and neither would have been obvious from the code.

import * as THREE from "three";
import { JOURNEY_CHAPTERS, JOURNEY_LEVEL_COUNT } from "../src/game/journey.js";
import { makeJourneyClouds, CLOUD_PARAMS } from "../src/render/journeyClouds.js";

let pass = 0;
let fail = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `  — ${detail}` : ""}`); }
}

const chapters = JOURNEY_CHAPTERS.map((ch, i) => ({
  from: ch.from,
  zFrom: -ch.from * 7,
  zTo: -(ch.from + ch.count - 1) * 7 - i,
}));

console.log("\nOne bank per chapter, and a chapter is the unit that unlocks");
{
  const c = makeJourneyClouds(chapters);
  const banks: THREE.Mesh[] = [];
  c.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && /^cloud-chapter-/.test(m.name)) banks.push(m);
  });
  ok("a bank for every chapter", banks.length === chapters.length, `${banks.length}/${chapters.length}`);
  ok("…merged, so each is ONE mesh", new Set(banks.map((b) => b.name)).size === banks.length);
  c.dispose();
}

console.log("\nLocked chapters are clouded; cleared ones are not");
{
  for (const [progress, expectClear] of [[0, 1], [JOURNEY_LEVEL_COUNT, JOURNEY_CHAPTERS.length]] as const) {
    const c = makeJourneyClouds(chapters);
    c.setProgress(progress);
    let clear = 0;
    c.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !m.visible) clear++;
    });
    ok(
      `at progress ${progress}, ${expectClear} chapter(s) are clear`,
      clear === expectClear,
      `${clear}`,
    );
    c.dispose();
  }
}

console.log("\nThe first setProgress SNAPS, later ones EASE");
// Banks are built locked. Without the snap, the first open shows weather over
// every chapter the player finished long ago and then lifts it — a second of
// nothing happening on ground they already cleared.
{
  const c = makeJourneyClouds(chapters);
  c.setProgress(JOURNEY_LEVEL_COUNT);
  let visibleNow = 0;
  c.group.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.visible) visibleNow++; });
  ok("everything already cleared is clear IMMEDIATELY", visibleNow === 0, `${visibleNow} still up`);

  // And a chapter that unlocks later must not pop: it eases.
  const c2 = makeJourneyClouds(chapters);
  c2.setProgress(0);
  const before: number[] = [];
  c2.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) before.push((m.material as THREE.MeshMatcapMaterial).opacity);
  });
  c2.setProgress(JOURNEY_LEVEL_COUNT);
  c2.update(0.05);
  const after: number[] = [];
  c2.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) after.push((m.material as THREE.MeshMatcapMaterial).opacity);
  });
  const moved = after.some((v, i) => v < before[i]);
  const gone = after.every((v) => v === 0);
  ok("a later unlock starts fading", moved, `${before[1]} -> ${after[1]}`);
  ok("…rather than vanishing in one frame", !gone);
  c.dispose();
  c2.dispose();
}

console.log("\nShrouded, never hidden");
{
  ok("the bank is translucent", CLOUD_PARAMS.opacity > 0.1 && CLOUD_PARAMS.opacity < 0.8,
    `${CLOUD_PARAMS.opacity}`);
  // THE CORRIDOR. A puff landing on a deck reads as fog on the GROUND rather
  // than sky above it — at this camera a cloud three units up projects onto
  // the island behind it with no depth cue to separate them. An island's
  // radius is 2.1, so nothing may reach inside that.
  const c = makeJourneyClouds(chapters);
  let minAbsX = Infinity;
  c.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) minAbsX = Math.min(minAbsX, Math.abs(p.getX(i)));
  });
  ok("no puff reaches over an island", minAbsX >= 2.1, `closest ${minAbsX.toFixed(2)}`);
  ok("…and the gap is wider than an island's radius", CLOUD_PARAMS.centreGap > 2.1);
  c.dispose();
}

console.log("\n" + "-".repeat(60));
console.log(`JOURNEY CLOUDS: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
