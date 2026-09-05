// Headless checks for the IDEA-049 thumbstick's FEEL.
//
//   npx tsx scripts/test-thumbstick.ts
//
// `resolveStickDir` is the whole control — everything else in src/input/stick.ts
// is DOM plumbing around it. It is pure for exactly this reason: the failures
// worth catching here (a dead zone that lets a resting thumb steer, a diagonal
// that chatters between two cardinals, a reversal that the anti-chatter gate
// swallows) are all cases you would have to notice by FEEL in a browser, on a
// phone, mid-run. Here they are arithmetic.
//
// Imports the real module. It touches `document` only inside attachStick, so
// node can load it — the same discipline src/game/* keeps.

import {
  resolveStickDir,
  stickGateName,
  STICK_DEAD_ZONE,
  STICK_SWITCH_RATIO,
} from "../src/input/stick";
import type { Vec2 } from "../src/game/grid";

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

const R = 34; // the real throw radius at the shipped size: (124 - 58) / 2
const UP: Vec2 = { x: 0, y: -1 };
const DOWN: Vec2 = { x: 0, y: 1 };
const LEFT: Vec2 = { x: -1, y: 0 };
const RIGHT: Vec2 = { x: 1, y: 0 };

const name = (d: Vec2 | null): string => stickGateName(d) ?? "none";
const same = (a: Vec2 | null, b: Vec2 | null): boolean =>
  a === null || b === null ? a === b : a.x === b.x && a.y === b.y;

/** Push the stick at `deg` clockwise from "up", at `frac` of full throw. */
function push(deg: number, frac: number, current: Vec2 | null = null): Vec2 | null {
  const rad = (deg * Math.PI) / 180;
  // Screen axes: +y is DOWN, so "up" is -y.
  return resolveStickDir(Math.sin(rad) * frac * R, -Math.cos(rad) * frac * R, R, current);
}

// ---------------------------------------------------------------------------
section("The dead zone");

ok("dead centre asks for nothing", push(0, 0) === null);
ok(
  "a thumb resting just inside the dead zone asks for nothing",
  push(0, STICK_DEAD_ZONE - 0.02) === null,
);
ok(
  "just past the dead zone it commits",
  same(push(0, STICK_DEAD_ZONE + 0.02), UP),
  name(push(0, STICK_DEAD_ZONE + 0.02)),
);
ok(
  "the dead zone is RADIAL, not per-axis — a diagonal nudge is still inside it",
  // Both axes are under the threshold on their own; the vector is not. If the
  // check were per-axis this would read as a direction from a thumb that has
  // barely moved.
  resolveStickDir(0.7 * STICK_DEAD_ZONE * R, 0.7 * STICK_DEAD_ZONE * R, R, null) === null,
);
ok(
  "inside the dead zone a HELD direction is kept, not cancelled",
  // Letting go of the direction as the thumb passes through the middle would
  // make every reversal flicker through "nothing" — and the beagle has no
  // "stop" to flicker to.
  same(push(0, 0.1, LEFT), LEFT),
);

// ---------------------------------------------------------------------------
section("Cardinals, from rest");

ok("push up", same(push(0, 1), UP), name(push(0, 1)));
ok("push right", same(push(90, 1), RIGHT), name(push(90, 1)));
ok("push down", same(push(180, 1), DOWN), name(push(180, 1)));
ok("push left", same(push(270, 1), LEFT), name(push(270, 1)));

ok(
  "it never answers with a diagonal",
  [0, 45, 90, 135, 180, 225, 270, 315, 30, 60, 200].every((deg) => {
    const d = push(deg, 1);
    return d !== null && (d.x === 0) !== (d.y === 0);
  }),
);

ok(
  "past the throw it still reads — a clamped ball is not a shorter push",
  same(push(90, 3), RIGHT),
);

// ---------------------------------------------------------------------------
section("The diagonal gate (anti-chatter)");

// A thumb parked on the up/right diagonal, wandering by a degree or two. Without
// hysteresis every wobble flips the answer, and every flip is a real queued
// direction the beagle can act on at the next junction.
ok(
  "holding up, a wobble onto the diagonal keeps up",
  same(push(46, 1, UP), UP),
  name(push(46, 1, UP)),
);
ok(
  "holding right, the same wobble keeps right",
  same(push(44, 1, RIGHT), RIGHT),
  name(push(44, 1, RIGHT)),
);
ok(
  "a decisive move off the diagonal does switch",
  same(push(70, 1, UP), RIGHT),
  name(push(70, 1, UP)),
);
{
  // The new axis has to beat the held one by STICK_SWITCH_RATIO, so the switch
  // sits at atan(ratio) from the held axis — PAST the 45° diagonal, not short
  // of it. (Written the other way round first, and the test caught it: at 40.8°
  // off "up" the horizontal axis is not even the larger one yet, so nothing can
  // switch there whatever the ratio says.)
  const switchDeg = (Math.atan(STICK_SWITCH_RATIO) * 180) / Math.PI;
  ok(
    `the gate closes at ~${switchDeg.toFixed(1)}°, a few degrees past the diagonal`,
    switchDeg > 45 && switchDeg < 55,
    switchDeg,
  );
  ok(
    "one degree inside the gate keeps the held direction",
    same(push(switchDeg - 1, 1, UP), UP),
  );
  ok(
    "one degree outside it switches",
    same(push(switchDeg + 1, 1, UP), RIGHT),
  );
}
ok(
  "the gate is symmetric across all four held directions",
  [
    [UP, 46, UP],
    [DOWN, 134, DOWN],
    [LEFT, 314, LEFT],
    [RIGHT, 44, RIGHT],
  ].every(([held, deg, want]) => same(push(deg as number, 1, held as Vec2), want as Vec2)),
);

// ---------------------------------------------------------------------------
section("Reversal is instant");

// The one input a player makes in a panic. There is no diagonal near it to be
// ambiguous about, so the anti-chatter gate must NOT apply — a reversal that
// waits for a 1.2x margin is a reversal that arrives after the ghost.
ok("up → down, straight through", same(push(180, 1, UP), DOWN), name(push(180, 1, UP)));
ok("left → right, straight through", same(push(90, 1, LEFT), RIGHT));
ok(
  "and it reverses the moment it leaves the dead zone",
  same(push(180, STICK_DEAD_ZONE + 0.02, UP), DOWN),
);

// ---------------------------------------------------------------------------
section("Degenerate input");

ok(
  "a stick measured while hidden (zero radius) changes nothing",
  // getBoundingClientRect on a display:none element is all zeroes. Dividing by
  // it would make the dead-zone test `0 < 0` — false — so EVERY reading would
  // count as a full push, including the pointerdown at dead centre.
  same(resolveStickDir(0, 0, 0, LEFT), LEFT),
);
ok("zero radius from rest still asks for nothing", resolveStickDir(9, 9, 0, null) === null);
ok(
  "NaN cannot become a direction",
  resolveStickDir(NaN, NaN, R, null) === null,
);

// ---------------------------------------------------------------------------
section("The gate name matches the logic");

ok("up lights the up gate", stickGateName(UP) === "up");
ok("down lights the down gate", stickGateName(DOWN) === "down");
ok("left lights the left gate", stickGateName(LEFT) === "left");
ok("right lights the right gate", stickGateName(RIGHT) === "right");
ok("nothing held lights nothing", stickGateName(null) === null);
ok("a zero vector lights nothing", stickGateName({ x: 0, y: 0 }) === null);

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
