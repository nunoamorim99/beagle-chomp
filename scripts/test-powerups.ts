// OWNER: qa-test-engineer (IDEA-046)
//
// Headless tests for the power-up state machine. Imports the REAL modules, so a
// rebalance is checked against the shipping numbers rather than a copy.
//
// The section that matters most is "A shielded hit is not a death". That is one
// sentence of design — "when the user has power-up 1 and 2 and 5 but gets
// caught, they only lose the 5 and keep the others until they die" — and it is
// the kind of rule that survives being written and then quietly dies in a later
// refactor of the collision handler. Pinned here so it cannot.
//
// `npm run test:powerups`.

import {
  POWERUPS,
  POWERUP_THRESHOLDS,
  POWERUP_MULTIPLIER,
  POWERUP_SLOW_MULT,
  POWERUP_STAR_SPEED_MULT,
  POWERUP_SHIELD_GRACE_SECONDS,
  COIN_THRESHOLDS,
  LIFE_THRESHOLDS,
  FRUIT_THRESHOLDS,
  TIMING,
} from "../src/game/config";
import {
  createPowerupState,
  collect,
  tick,
  onCaught,
  onDeath,
  onLevelClear,
  biscuitMult,
  ghostMult,
  ghostSpeedMult,
  beagleSpeedMult,
  starActive,
  hasShield,
} from "../src/game/powerups";
import { shouldFireThreshold } from "../src/game/pickups";

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

// ===========================================================================
section("The registry");

ok("five power-ups ship", POWERUPS.length === 5, POWERUPS.length);
ok("ids are unique", new Set(POWERUPS.map((p) => p.id)).size === POWERUPS.length);
ok(
  "every timed power-up has a duration, and no other kind does",
  POWERUPS.every((p) => (p.kind === "timed" ? p.seconds > 0 : p.seconds === 0)),
  POWERUPS.map((p) => `${p.id}:${p.kind}:${p.seconds}`).join(" "),
);
ok("all three lifetimes are represented", new Set(POWERUPS.map((p) => p.kind)).size === 3);
// The shield SHIPPED BROKEN without this: absorbing a hit left the beagle
// inside the collision radius, so the next frame killed it anyway — spending
// the shield, the life and every other power-up held. The window has to be long
// enough to actually escape a ghost (4.6 tiles/sec), not a token frame or two.
ok(
  "the post-shield grace window is long enough to escape",
  POWERUP_SHIELD_GRACE_SECONDS >= 1 && POWERUP_SHIELD_GRACE_SECONDS <= 3,
  POWERUP_SHIELD_GRACE_SECONDS,
);
// The star IS a fright window with a speed boost on top, so it must not drift
// from the bone's. Two numbers for one duration is one number too many.
ok(
  "the star lasts exactly a bone's fright window",
  POWERUPS.find((p) => p.id === "star")?.seconds === TIMING.frightSeconds,
);
// WEIGHTS FOLLOW LIFETIME, and the ordering is the design (Nuno, from live
// play). It reads backwards until you see it: the timed pair are gone in
// seconds, so a spawn is the only way to ever hold one — they must be the most
// common. The doublers persist until you die, so a player who has one does not
// need another, and a duplicate spawn of one already held is a literal no-op
// (collect() refreshes a timer that is zero). Weighting them heavily spends
// spawns on nothing, which is exactly what the first cut did: doublers twice in
// one map, star and anchor unseen for a whole session.
{
  const w = (id: string) => POWERUPS.find((p) => p.id === id)!.weight;
  ok(
    "the timed power-ups are the most common",
    Math.min(w("slowGhosts"), w("star")) > w("shield"),
    POWERUPS.map((p) => `${p.id}:${p.weight}`).join(" "),
  );
  ok(
    "the shield sits between them and the doublers",
    w("shield") > Math.max(w("doubleBiscuit"), w("doubleGhost")),
  );
  ok(
    "the doublers are the rarest — you keep them, so you need fewer",
    Math.max(w("doubleBiscuit"), w("doubleGhost")) < Math.min(w("slowGhosts"), w("star")),
  );
}


// ===========================================================================
section("Collecting");

{
  const s = createPowerupState();
  ok("a fresh state holds nothing", s.active.length === 0);
  ok("…and every multiplier is neutral", biscuitMult(s) === 1 && ghostMult(s) === 1 && ghostSpeedMult(s) === 1 && beagleSpeedMult(s) === 1);

  collect(s, "doubleBiscuit");
  ok("collecting the biscuit doubler doubles biscuits", biscuitMult(s) === POWERUP_MULTIPLIER);
  ok("…and leaves the enemy doubler alone", ghostMult(s) === 1);

  collect(s, "slowGhosts");
  ok("the anchor slows enemies", ghostSpeedMult(s) === POWERUP_SLOW_MULT);
  collect(s, "star");
  ok("the star speeds the beagle", beagleSpeedMult(s) === POWERUP_STAR_SPEED_MULT);
  ok("…and reports itself, so the fright window can be kept topped up", starActive(s));
}

// Refresh, NOT stack. A second anchor restarts the clock; a second x2 does not
// become x4 — that would make a lucky double spawn uncatchable and would mean
// the server's score ceiling had to allow an unbounded multiplier.
{
  const s = createPowerupState();
  collect(s, "doubleBiscuit");
  collect(s, "doubleBiscuit");
  ok("collecting a doubler twice does not stack it", biscuitMult(s) === POWERUP_MULTIPLIER);
  ok("…and does not hold it twice", s.active.length === 1, s.active.length);

  collect(s, "slowGhosts");
  tick(s, 5);
  const partlySpent = s.active.find((a) => a.id === "slowGhosts")!.remaining;
  collect(s, "slowGhosts");
  const refreshed = s.active.find((a) => a.id === "slowGhosts")!.remaining;
  ok("collecting a timed one again refreshes its clock", refreshed > partlySpent, `${partlySpent} -> ${refreshed}`);
}

// ===========================================================================
section("Timed ones run down; the others do not");

{
  const s = createPowerupState();
  collect(s, "slowGhosts");
  collect(s, "doubleBiscuit");
  collect(s, "shield");

  const anchor = POWERUPS.find((p) => p.id === "slowGhosts")!.seconds;
  tick(s, anchor - 0.1);
  ok("the anchor is still up just before it expires", ghostSpeedMult(s) === POWERUP_SLOW_MULT);
  tick(s, 0.2);
  ok("…and gone just after", ghostSpeedMult(s) === 1);

  ok("expiring the anchor did not touch the doubler", biscuitMult(s) === POWERUP_MULTIPLIER);
  ok("…nor the shield", hasShield(s));

  // A huge dt (a tab restored from the background, a breakpoint) must expire
  // things cleanly rather than leaving a negative countdown on the HUD.
  collect(s, "star");
  tick(s, 9999);
  ok("an absurd dt expires timed power-ups rather than going negative", !starActive(s));
  ok("…and still leaves the untimed ones", biscuitMult(s) === POWERUP_MULTIPLIER && hasShield(s));
}

{
  const s = createPowerupState();
  collect(s, "slowGhosts");
  tick(s, 0);
  tick(s, -5);
  tick(s, NaN);
  ok("a zero, negative or NaN dt is ignored rather than corrupting the clock", ghostSpeedMult(s) === POWERUP_SLOW_MULT);
}

// ===========================================================================
section("A shielded hit is NOT a death (the rule this module exists for)");

// Nuno: "when the user has power-up 1 and 2 and 5 but gets caught, they only
// lose the 5 and keep the others until they die."
{
  const s = createPowerupState();
  collect(s, "doubleBiscuit");
  collect(s, "doubleGhost");
  collect(s, "shield");

  const outcome = onCaught(s);
  ok("being caught while shielded returns \"shielded\", not \"died\"", outcome === "shielded", outcome);
  ok("the shield is spent", !hasShield(s));
  ok("the biscuit doubler SURVIVES", biscuitMult(s) === POWERUP_MULTIPLIER);
  ok("the enemy doubler SURVIVES", ghostMult(s) === POWERUP_MULTIPLIER);

  // The next hit, with no shield left, is a real death.
  ok("the NEXT hit is a death", onCaught(s) === "died");
  ok("…and onCaught alone does not clear anything — the caller decides when the death resolves",
    biscuitMult(s) === POWERUP_MULTIPLIER);
  onDeath(s);
  ok("…until onDeath, which clears everything", s.active.length === 0);
}

{
  // A shielded hit must not consume a second shield, and must not eat a timed
  // power-up that happens to be running.
  const s = createPowerupState();
  collect(s, "shield");
  collect(s, "star");
  ok("caught while shielded and starred", onCaught(s) === "shielded");
  ok("…the star keeps running", starActive(s));
  ok("…and only the shield went", s.active.length === 1);
}

{
  const s = createPowerupState();
  ok("being caught holding nothing is a death", onCaught(s) === "died");
  onDeath(s);
  ok("onDeath on an empty state is harmless", s.active.length === 0);
}

// ===========================================================================
section("Clearing the map keeps what you earned");

{
  const s = createPowerupState();
  collect(s, "doubleBiscuit");
  collect(s, "doubleGhost");
  collect(s, "shield");
  collect(s, "slowGhosts");
  collect(s, "star");

  onLevelClear(s);
  ok("the biscuit doubler carries to the next map", biscuitMult(s) === POWERUP_MULTIPLIER);
  ok("the enemy doubler carries", ghostMult(s) === POWERUP_MULTIPLIER);
  ok("the shield carries", hasShield(s));
  // Carrying a countdown across the level-clear beat and the next READY pause
  // would hand the player two seconds of an eight second power-up, which reads
  // as a bug rather than a bonus.
  ok("the anchor does NOT carry", ghostSpeedMult(s) === 1);
  ok("the star does NOT carry", !starActive(s));
}

{
  // A run held across several maps: the doublers should still be there.
  const s = createPowerupState();
  collect(s, "doubleBiscuit");
  onLevelClear(s);
  onLevelClear(s);
  onLevelClear(s);
  ok("a doubler survives three cleared maps", biscuitMult(s) === POWERUP_MULTIPLIER);
  onDeath(s);
  ok("…and only a real death takes it", biscuitMult(s) === 1);
}

// ===========================================================================
section("Spawn thresholds");

ok("four power-ups a level", POWERUP_THRESHOLDS.length === 4, POWERUP_THRESHOLDS.length);
ok(
  "thresholds are sorted ascending",
  POWERUP_THRESHOLDS.every((t, i) => i === 0 || t > POWERUP_THRESHOLDS[i - 1]),
  POWERUP_THRESHOLDS.join(","),
);
ok(
  "the last one is reachable on the thinnest maze (175 biscuits)",
  POWERUP_THRESHOLDS[POWERUP_THRESHOLDS.length - 1] < 175,
);
{
  // Widened to number[]: each list is an `as const` tuple of its own literal
  // types, and TypeScript would refuse the comparison outright otherwise —
  // which is a very confident way of not checking anything.
  const others: number[] = [...COIN_THRESHOLDS, ...LIFE_THRESHOLDS, ...FRUIT_THRESHOLDS];
  const mine: number[] = [...POWERUP_THRESHOLDS];
  const clash = mine.filter((t) => others.includes(t));
  ok("no power-up threshold collides with a coin, fruit or bonus-life one", clash.length === 0, clash.join(","));
}

// The same farming guard every other pickup has. A refiring threshold on a
// fruit was worth a repeated 500; on a shield it would be an unkillable run.
{
  let idx = 0;
  let fired = 0;
  for (let eaten = 0; eaten <= 179; eaten++) {
    for (let repeat = 0; repeat < 3; repeat++) {
      if (shouldFireThreshold(eaten, POWERUP_THRESHOLDS, idx)) {
        fired++;
        idx++;
      }
    }
  }
  ok(
    "a full level fires exactly one power-up spawn per threshold, however often it is asked",
    fired === POWERUP_THRESHOLDS.length,
    fired,
  );
}

console.log(`\n${"-".repeat(60)}`);
console.log(`POWER-UPS: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
