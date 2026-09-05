// Headless tests for the tutorial's CONTENT (IDEA-040 v2).
//   npx tsx scripts/test-tutorial-carousel.ts
//
// v1's copy shipped two errors that only a human playing the game caught, and
// both are the kind a type-checker never sees. This file exists so neither can
// come back:
//
//   1. It told a desktop player to "swipe anywhere", on a device with nothing
//      to swipe.
//   2. It said a life comes from chaining "all four" enemies. The life is
//      granted when the chain equals the LEVEL's ghost count — 3 in stages
//      1-2, 4 in stage 3, 1 on a bonus map — so naming any number is wrong
//      somewhere.

import { buildSlides } from "../src/ui/tutorialSlides";

let passed = 0;
let failed = 0;

function ok(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    console.log(`  FAIL ${label}${detail === undefined ? "" : ` — ${String(detail)}`}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

const desktop = buildSlides({ coarsePointer: false, scheme: "swipe" });
const phoneSwipe = buildSlides({ coarsePointer: true, scheme: "swipe" });
const phonePad = buildSlides({ coarsePointer: true, scheme: "dpad" });
const phoneStick = buildSlides({ coarsePointer: true, scheme: "stick" });

section("Shape");
// Six since IDEA-046. The count is pinned rather than left open because the
// tutorial is a wall between the player and the game they asked to play — a
// slide has to EARN its place, and a test that just counts whatever exists
// would never notice the wall getting taller.
ok("there are six slides", desktop.length === 6, desktop.length);
ok("every slide has a title and body",
  desktop.every((s) => s.title.length > 0 && s.body.length > 0));
ok("slide ids are unique", new Set(desktop.map((s) => s.id)).size === desktop.length);
ok("every slide stages a 3D subject",
  desktop.every((s) => ["beagle", "enemy", "maze", "goldenBone", "powerup"].includes(s.stage)),
  desktop.map((s) => s.stage).join(","));
// The lives slide shows the pickup it is describing, not a stand-in: the
// golden bone is the least familiar thing in the game, so a player needs to
// know what to look for.
// The power-ups slide stages real power-up meshes for the same reason the lives
// slide stages the real golden bone: these are the least familiar objects in the
// game, and a player needs to know what to LOOK for.
ok("the power-ups slide stages the power-ups",
  desktop.find((s) => s.id === "powerups")?.stage === "powerup");
ok("the lives slide stages the golden bone",
  desktop.find((s) => s.id === "lives")?.stage === "goldenBone",
  desktop.find((s) => s.id === "lives")?.stage);
ok("the order teaches move → collect → avoid → bones → power-ups → lives",
  desktop.map((s) => s.id).join(",") === "move,biscuits,pack,bones,powerups,lives",
  desktop.map((s) => s.id).join(","));

section("Movement copy follows the DEVICE, not the account");
{
  const d = desktop[0];
  ok("desktop is told about the keyboard", /arrow keys/i.test(d.body), d.body);
  ok("…including WASD", /w a s d/i.test(d.body), d.body);
  ok("…and NOT told to swipe", !/swipe/i.test(d.body), d.body);
  ok("…and NOT told about a pad", !/\bpad\b/i.test(d.body), d.body);
  ok("desktop gets the keys diagram", d.diagram === "keys", d.diagram);

  const s = phoneSwipe[0];
  ok("a swipe player is told to swipe", /swipe/i.test(s.body), s.body);
  ok("…and not about arrow keys", !/arrow keys/i.test(s.body), s.body);
  ok("swipe gets the swipe diagram", s.diagram === "swipe", s.diagram);

  const p = phonePad[0];
  ok("a D-pad player is told to tap the pad", /tap the pad/i.test(p.body), p.body);
  ok("…and not to swipe", !/swipe/i.test(p.body), p.body);
  ok("D-pad gets the pad diagram", p.diagram === "dpad", p.diagram);

  // IDEA-049. The stick's slide has one job the other two do not: say that the
  // thumb can STAY there. That is the whole reason to pick it over the pad, and
  // it is not something a player discovers by looking at a picture of a ball.
  const t = phoneStick[0];
  ok("a stick player is told about the stick", /\bstick\b/i.test(t.body), t.body);
  ok("…and told they can leave the thumb on it", /leave your thumb/i.test(t.body), t.body);
  ok("…and not to swipe", !/swipe/i.test(t.body), t.body);
  ok("stick gets the stick diagram", t.diagram === "stick", t.diagram);

  // Every scheme has to be answered. A scheme that falls through the if-chain
  // gets the SWIPE copy — correct-looking, and wrong for the player reading it.
  ok(
    "no two schemes get the same movement slide",
    new Set([s.body, p.body, t.body]).size === 3,
  );
}

section("No slide ever names a ghost count");
{
  // The bug that started this rewrite. "all four" is wrong on 14 of the 18
  // levels in a lap, so the copy must describe the rule, not a number.
  const numberWords = /\b(one|two|three|four|five|1|2|3|4|5)\s+(enem|ghost|of them|in the pack)/i;
  for (const set of [desktop, phoneSwipe, phonePad, phoneStick]) {
    for (const slide of set) {
      ok(
        `"${slide.id}" does not count the enemies`,
        !numberWords.test(slide.body),
        slide.body,
      );
    }
  }

  const lives = desktop.find((s) => s.id === "lives")!;
  ok("the lives slide says EVERY enemy", /every enemy/i.test(lives.body), lives.body);
  ok("…and still mentions the 10,000-point milestone", /10,000/.test(lives.body), lives.body);
  ok("…and the golden bone", /golden bone/i.test(lives.body), lives.body);
}

section("The rules the brief asked for are all covered");
{
  const all = desktop.map((s) => `${s.title} ${s.body}`).join(" ");
  ok("biscuits are worth 10", /10 points/i.test(all));
  ok("clearing them finishes the map", /finish(es)? the map/i.test(all));
  // IDEA-045: fruit no longer has "a" value, so the copy has to give the range
  // rather than a single number. Both ends are pinned — a tutorial that named
  // only the 100 would undersell the whole feature, and one that named only the
  // 500 would oversell it.
  ok("the fruit range is given, both ends", /100/.test(all) && /500/.test(all));
  ok("…and it says the good ones are rare", /show up least|least often|rare/i.test(all));
  ok("a bone makes enemies edible", /(scared and edible|only time you can eat)/i.test(all));
  ok("the ghost chain is spelled out", /200/.test(all) && /1600/.test(all));
  ok("touching an enemy costs a life", /costs a life/i.test(all));
}

section("Nothing promises what the game no longer does");
{
  const all = [desktop, phoneSwipe, phonePad].flat().map((s) => s.body).join(" ");
  // The install banner claimed offline play for five versions; same class of
  // rot, so the tutorial gets the same guard.
  ok("no slide mentions offline play", !/offline/i.test(all));
}

console.log(`\n${"-".repeat(60)}`);
console.log(`TUTORIAL CONTENT: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
