// Headless tests for the first-run coach (IDEA-040).
//   npx tsx scripts/test-tutorial.ts
//
// The coach runs over LIVE play, so the failure modes are all about timing and
// repetition: a tip firing twice, two tips stacking on the same frame, or a
// tip that never clears and sits over the maze forever. All of that is pure
// state, so it can be pinned exactly here rather than eyeballed in a browser.

import {
  createCoach,
  coachEvent,
  coachTick,
  coachComplete,
  coachStop,
  ALL_TIP_IDS,
} from "../src/game/tutorialCoach";

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

/** Run the clock forward in 60fps steps, collecting every tip id seen. */
function advance(state: ReturnType<typeof createCoach>, seconds: number): string[] {
  const seen: string[] = [];
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    const tip = coachTick(state, dt);
    if (tip && seen[seen.length - 1] !== tip.id) seen.push(tip.id);
  }
  return seen;
}

section("A tip appears when its subject does");
{
  const c = createCoach();
  ok("nothing shows before anything happens", coachTick(c, 1 / 60) === null);

  coachEvent(c, "levelStarted");
  const tip = coachTick(c, 1 / 60);
  ok("the movement tip appears at level start", tip?.id === "move", tip?.id);
  ok("it mentions swiping by default", /swipe/i.test(tip?.text ?? ""), tip?.text);
}

section("The control tip matches the player's scheme");
{
  const c = createCoach();
  coachEvent(c, "levelStarted", "dpad");
  const tip = coachTick(c, 1 / 60);
  ok("a D-pad player is told about the pad", /pad/i.test(tip?.text ?? ""), tip?.text);
  ok("…and NOT told to swipe", !/swipe/i.test(tip?.text ?? ""), tip?.text);
}

section("Each lesson is taught exactly once");
{
  const c = createCoach();
  ok("first biscuit queues a tip", coachEvent(c, "biscuitEaten"));
  ok("the second does not", !coachEvent(c, "biscuitEaten"));
  ok("nor the hundredth", !coachEvent(c, "biscuitEaten"));

  // The real repetition risk: bones get eaten several times per level.
  const c2 = createCoach();
  ok("first bone queues a tip", coachEvent(c2, "boneEaten"));
  ok("later bones do not", !coachEvent(c2, "boneEaten"));
}

section("Tips never stack — one at a time, in order");
{
  const c = createCoach();
  coachEvent(c, "levelStarted");
  coachEvent(c, "biscuitEaten");
  coachEvent(c, "boneEaten");

  // Three fired on the same frame. Only one may be on screen at any moment.
  const first = coachTick(c, 1 / 60);
  ok("only the first shows immediately", first?.id === "move", first?.id);

  const order = advance(c, 20);
  ok("all three show, in the order they fired",
    order.join(",") === "move,biscuits,fright", order.join(","));
}

section("A tip clears by itself");
{
  const c = createCoach();
  coachEvent(c, "biscuitEaten");
  coachTick(c, 1 / 60);
  // The tip lasts 5s; well past that nothing should remain.
  for (let t = 0; t < 8; t += 1 / 60) coachTick(c, 1 / 60);
  ok("nothing is left on screen after it expires", coachTick(c, 1 / 60) === null);
}

section("There is a gap between consecutive tips");
{
  const c = createCoach();
  coachEvent(c, "biscuitEaten"); // 5s
  coachEvent(c, "fruitSpawned"); // queued behind it

  let sawGap = false;
  let previous: string | null = "biscuits";
  coachTick(c, 1 / 60);
  for (let t = 0; t < 8; t += 1 / 60) {
    const tip = coachTick(c, 1 / 60);
    const id = tip?.id ?? null;
    // A null between two different tips is the gap doing its job.
    if (previous === "biscuits" && id === null) sawGap = true;
    if (id !== null) previous = id;
  }
  ok("the screen clears before the next tip", sawGap);
  ok("the queued tip does eventually show", previous === "fruit", previous);
}

section("Every lesson the brief asked for is covered");
{
  // Nuno's list: how to move, biscuits and fruit values, how to gain lives
  // (5,000 points / eating all enemies / golden bone), and that enemies are
  // only edible after a white bone.
  const c = createCoach();
  const events = [
    "levelStarted", "biscuitEaten", "nearBone", "boneEaten",
    "ghostEaten", "fruitSpawned", "goldenBoneSpawned", "scoreProgress",
  ] as const;
  for (const e of events) coachEvent(c, e);
  const shown = advance(c, 80);

  ok(`all ${ALL_TIP_IDS.length} tips are delivered`, shown.length === ALL_TIP_IDS.length,
    `${shown.length}: ${shown.join(",")}`);
  for (const id of ALL_TIP_IDS) {
    ok(`the "${id}" lesson is taught`, shown.includes(id));
  }
  ok("the coach reports itself complete", coachComplete(c));
}

section("Skipping stops everything");
{
  const c = createCoach();
  coachEvent(c, "levelStarted");
  coachEvent(c, "biscuitEaten");
  coachTick(c, 1 / 60);

  coachStop(c);
  ok("nothing is on screen after skipping", coachTick(c, 1 / 60) === null);
  ok("the queue is dropped", advance(c, 30).length === 0);
  ok("later events are ignored", !coachEvent(c, "boneEaten"));
}

section("An untaught lesson leaves the coach unfinished");
{
  // A player who never eats a bone hasn't learned the bone rule, so the coach
  // must NOT mark itself done — otherwise it would never be shown again.
  const c = createCoach();
  coachEvent(c, "levelStarted");
  coachEvent(c, "biscuitEaten");
  advance(c, 30);
  ok("not complete while lessons remain untaught", !coachComplete(c));
}

console.log(`\n${"-".repeat(60)}`);
console.log(`TUTORIAL: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
