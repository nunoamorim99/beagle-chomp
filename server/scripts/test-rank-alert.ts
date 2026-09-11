// OWNER: qa-test-engineer (IDEA-052b)
//
// Who gets told their score was beaten. DB-free.
//
// Every check here is about NOT sending something. The failure modes of a
// notification feature are all one-directional: tell someone something untrue
// about their own standing, or tell forty-nine people at once, and they turn
// notifications off — permanently, for every future message including the ones
// they wanted. So the interesting cases are the refusals.
//
// The tie rule is the one most likely to be got wrong by a later edit. The
// board orders `high_score DESC, high_score_at ASC`, so a player sitting on
// exactly the new score got there EARLIER and still outranks the runner. They
// have not been passed, and saying they have is a false claim.

import {
  whoWasOvertaken,
  rankAlertBody,
  type BoardEntry,
  type Runner,
} from "../src/notifications/rankAlert.js";

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

const NOW = new Date("2026-09-09T20:00:00Z");
const OPTS = { topN: 10, cooldownHours: 6, now: NOW };

/** A board entry. `at` is minutes before NOW, so "who got there first" is easy
 *  to read: a BIGGER number is EARLIER. */
function entry(
  userId: string,
  highScore: number,
  at = 60,
  over: Partial<BoardEntry> = {},
): BoardEntry {
  return {
    userId,
    username: userId,
    highScore,
    highScoreAt: new Date(NOW.getTime() - at * 60_000),
    notifyRank: true,
    lastAlertAt: null,
    ...over,
  };
}

const runner = (over: Partial<Runner> = {}): Runner => ({
  userId: "runner",
  username: "runner",
  previousBest: 0,
  newBest: 5000,
  ...over,
});

const ids = (rs: { userId: string }[]): string => rs.map((r) => r.userId).join(",");

// ---------------------------------------------------------------------------
section("the people actually passed");

{
  const board = [entry("first", 9000), entry("second", 6000), entry("third", 4000)];
  const out = whoWasOvertaken(runner({ newBest: 5000 }), board, OPTS);
  ok("only the player below the new score is told", ids(out) === "third", ids(out));
  ok("…and is told their NEW rank", out[0]?.newRank === 4, out[0]?.newRank);
  ok("…and who did it", out[0]?.passedBy === "runner" && out[0]?.passedByScore === 5000);
  // The two above the new score never moved.
  ok("nobody above the new score is told", !out.some((r) => r.userId === "first"));
}

{
  // Leaping the whole board tells everyone it passed — subject to the cap.
  const board = [entry("a", 900), entry("b", 800), entry("c", 700)];
  const out = whoWasOvertaken(runner({ newBest: 1000 }), board, OPTS);
  ok("passing three tells three", out.length === 3, ids(out));
  ok("…ordered by their new rank, closest to the top first", ids(out) === "a,b,c", ids(out));
}

// ---------------------------------------------------------------------------
section("the tie — the rule most likely to be broken later");

{
  // `tied` reached 5000 an hour ago; the runner reaches it NOW. The board sorts
  // `high_score DESC, high_score_at ASC`, so `tied` is still ahead.
  const board = [entry("tied", 5000, 60), entry("below", 4000)];
  const out = whoWasOvertaken(runner({ newBest: 5000 }), board, OPTS);
  ok("a player TIED at the new score is not told", !out.some((r) => r.userId === "tied"), ids(out));
  ok("…while the one genuinely passed still is", ids(out) === "below", ids(out));
}

{
  // One point more IS a pass, even against a much earlier timestamp.
  const board = [entry("tied", 5000, 10_000)];
  const out = whoWasOvertaken(runner({ newBest: 5001 }), board, OPTS);
  ok("one point above a tie IS a pass", ids(out) === "tied", ids(out));
}

// ---------------------------------------------------------------------------
section("what is refused");

{
  const board = [entry("victim", 4000)];

  // The runner did not improve on themselves, so they cannot have moved.
  ok(
    "a run that does not beat the runner's own best tells nobody",
    whoWasOvertaken(runner({ previousBest: 6000, newBest: 5000 }), board, OPTS).length === 0,
  );
  ok(
    "…and neither does one that exactly equals it",
    whoWasOvertaken(runner({ previousBest: 5000, newBest: 5000 }), board, OPTS).length === 0,
  );

  // Never tell the runner about their own run. The victim sits BETWEEN the
  // runner's old and new best — someone already below the runner was never
  // passed at all, however much the runner improved, and the first draft of
  // this test got that wrong rather than the code doing so.
  const withRunner = [entry("runner", 4000), entry("victim", 4500)];
  const out = whoWasOvertaken(runner({ previousBest: 4000, newBest: 5000 }), withRunner, OPTS);
  ok("the runner is never told about themselves", !out.some((r) => r.userId === "runner"), ids(out));
  ok("…but the player they passed is", ids(out) === "victim", ids(out));

  // The converse, stated as its own check because it is the non-obvious half:
  // improving a score that was ALREADY above someone moves nobody.
  const below = [entry("runner", 4000), entry("wasAlreadyBelow", 3000)];
  ok(
    "improving a score already above someone tells them nothing",
    whoWasOvertaken(runner({ previousBest: 4000, newBest: 5000 }), below, OPTS).length === 0,
  );

  // Opted out.
  ok(
    "a player who turned rank alerts off is not told",
    whoWasOvertaken(runner(), [entry("victim", 4000, 60, { notifyRank: false })], OPTS).length === 0,
  );
}

{
  // The cap. Being pushed from #340 to #341 is not news.
  const board = Array.from({ length: 40 }, (_u, i) => entry(`p${i}`, 4000 - i));
  const out = whoWasOvertaken(runner({ newBest: 5000 }), board, OPTS);
  ok("only the top N are told, not everyone passed", out.length === 10, `${out.length}`);
  ok("…and it is the TOP ten, not any ten", ids(out) === "p0,p1,p2,p3,p4,p5,p6,p7,p8,p9", ids(out));

  // A player outside the cap is silently skipped, not queued.
  ok("nobody outside the cap appears", !out.some((r) => r.userId === "p30"));
}

{
  // The cooldown: one good evening cannot fire ten alerts at one victim.
  const recent = entry("victim", 4000, 60, {
    lastAlertAt: new Date(NOW.getTime() - 2 * 3_600_000),
  });
  ok(
    "a player alerted 2h ago is not alerted again at a 6h cooldown",
    whoWasOvertaken(runner(), [recent], OPTS).length === 0,
  );

  const old = entry("victim", 4000, 60, {
    lastAlertAt: new Date(NOW.getTime() - 7 * 3_600_000),
  });
  ok(
    "…but one alerted 7h ago is",
    whoWasOvertaken(runner(), [old], OPTS).length === 1,
  );

  // Exactly at the boundary counts as elapsed — an off-by-one here would mean
  // an alert silently skipped for one player forever if the timing lined up.
  const exact = entry("victim", 4000, 60, {
    lastAlertAt: new Date(NOW.getTime() - 6 * 3_600_000),
  });
  ok("…and exactly at the cooldown it is allowed", whoWasOvertaken(runner(), [exact], OPTS).length === 1);
}

// ---------------------------------------------------------------------------
section("edge shapes that must not throw");

{
  ok("an empty board tells nobody", whoWasOvertaken(runner(), [], OPTS).length === 0);
  ok(
    "a board holding only the runner tells nobody",
    whoWasOvertaken(runner({ previousBest: 100 }), [entry("runner", 100)], OPTS).length === 0,
  );
  // A first-ever high score: previousBest 0, and everyone below is genuinely
  // passed. This is the case that would fan out widest without the cap.
  const board = [entry("a", 10), entry("b", 5)];
  ok(
    "a first-ever high score still works",
    whoWasOvertaken(runner({ previousBest: 0, newBest: 100 }), board, OPTS).length === 2,
  );
  // Players sitting on 0 are unranked — the board index is partial
  // (WHERE high_score > 0) — so they are never in `board` to begin with.
}

// ---------------------------------------------------------------------------
section("the message");

{
  const out = whoWasOvertaken(runner({ newBest: 5000 }), [entry("victim", 4000)], OPTS);
  const body = rankAlertBody(out[0]);
  ok("names who passed them", body.includes("runner"), body);
  ok("…and where they are now", body.includes("#2"), body);
  // Every platform truncates, and iOS gives no actions/image/badge to lean on.
  ok("…in one short line", body.length <= 90 && !body.includes("\n"), `${body.length} chars`);
}

console.log(`\n${"-".repeat(60)}`);
console.log(`RANK ALERT: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
