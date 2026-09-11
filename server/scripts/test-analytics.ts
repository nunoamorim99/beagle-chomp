// OWNER: qa-test-engineer (IDEA-050)
//
// The pure analytics layer. DB-FREE — `src/analytics/aggregate.ts` imports
// nothing, least of all db.ts, which opens a Postgres pool on import and would
// put this whole suite out of `npm test`'s reach.
//
// What this suite is actually for: every function here answers a question with
// a number that will be shown to a human as fact, and most of the bugs
// available are not crashes. They are a rate that reads 0% when it should read
// "no data", a nemesis picked at random out of a tie, or a retention headline
// that drops the moment new players sign up. Those ship silently and are
// believed. So the edges are the tests.

import {
  percentile,
  buildCohortMatrix,
  headlineRetention,
  challengeStandings,
  hardestChallenges,
  tallySlots,
  topSlot,
  shares,
  rejectionHealth,
  ALARM_RATE,
} from "../src/analytics/aggregate.js";

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

const close = (a: number | null, b: number, eps = 1e-9): boolean =>
  a !== null && Math.abs(a - b) < eps;

// ---------------------------------------------------------------------------
section("percentile — nearest rank, never invented");

{
  const xs = [10, 20, 30, 40, 50];
  ok("p50 of five is the middle observation", percentile(xs, 50) === 30);
  ok("p100 is the largest", percentile(xs, 100) === 50);
  ok("p0 clamps to the smallest", percentile(xs, 0) === 10);
  // The property that matters: the answer is always a REAL observation, not an
  // interpolation between two of them. Same rule as http/metrics.ts.
  ok("p95 of [1,2] is an observed value", percentile([1, 2], 95) === 2);
  ok("an empty set has no percentile", percentile([], 50) === null);
  // Must not mutate the caller's array — these come straight off query rows.
  const original = [3, 1, 2];
  percentile(original, 50);
  ok("the input is left unsorted", JSON.stringify(original) === "[3,1,2]");
}

// ---------------------------------------------------------------------------
section("cohort matrix — the zero-fill IS the answer");

{
  const rows = [
    { cohort_day: "2026-09-01", cohort_size: 10, day_offset: 0, returned: 8 },
    { cohort_day: "2026-09-01", cohort_size: 10, day_offset: 1, returned: 4 },
    // no offset 2 row: nobody came back on day 2
    { cohort_day: "2026-09-01", cohort_size: 10, day_offset: 3, returned: 1 },
    { cohort_day: "2026-09-02", cohort_size: 4, day_offset: 0, returned: 4 },
  ];
  // asOf pinned: without it this suite would give different answers tomorrow.
  const matrix = buildCohortMatrix(rows, 3, new Date("2026-09-30T12:00:00Z"));

  ok("one row per cohort", matrix.length === 2);
  ok("cohorts are in date order", matrix[0].cohortDay === "2026-09-01");
  ok("every cohort is dense to maxOffset", matrix.every((c) => c.cells.length === 4));
  // The reason this function exists: a missing SQL row means ZERO returners,
  // and a hole in the grid would render as "no data" at the most important cell.
  ok("a missing offset becomes an explicit zero", matrix[0].cells[2].returned === 0);
  ok("…with a real 0 rate, not null or NaN", matrix[0].cells[2].rate === 0);
  ok("rates divide by cohort size", close(matrix[0].cells[1].rate, 0.4));
  // Day 0 is NOT automatically 1: a player who signed up and never started a
  // run is in the cohort and did not return.
  ok("day 0 can be below 1", close(matrix[0].cells[0].rate, 0.8));

  // A cohort whose window is shorter than the grid still gets its cells.
  ok("a young cohort is padded too", matrix[1].cells.length === 4 && matrix[1].cells[3].returned === 0);
}

{
  // Offsets outside the window are dropped rather than widening the grid.
  const matrix = buildCohortMatrix(
    [
      { cohort_day: "2026-09-01", cohort_size: 2, day_offset: 0, returned: 2 },
      { cohort_day: "2026-09-01", cohort_size: 2, day_offset: 99, returned: 2 },
      { cohort_day: "2026-09-01", cohort_size: 2, day_offset: -1, returned: 1 },
    ],
    3,
    new Date("2026-09-30T12:00:00Z"),
  );
  ok("an out-of-window offset does not widen the grid", matrix[0].cells.length === 4);
  ok("a negative offset is ignored", matrix[0].cells[0].returned === 2);
}

{
  // Dates arrive as Date objects from node-postgres, not strings.
  const matrix = buildCohortMatrix(
    [{ cohort_day: new Date("2026-09-01T00:00:00Z"), cohort_size: 1, day_offset: 0, returned: 1 }],
    1,
    new Date("2026-09-30T12:00:00Z"),
  );
  ok("a Date cohort key becomes an ISO day", matrix[0].cohortDay === "2026-09-01");
}

// ---------------------------------------------------------------------------
section("headline retention — young cohorts must not drag it down");

{
  const matrix = buildCohortMatrix(
    [
      { cohort_day: "2026-09-01", cohort_size: 100, day_offset: 1, returned: 10 },
      { cohort_day: "2026-09-02", cohort_size: 2, day_offset: 1, returned: 2 },
    ],
    7,
    new Date("2026-09-30T12:00:00Z"),
  );
  const head = headlineRetention(matrix, [1]);
  // Weighted: 12 returners out of 102, NOT the average of 10% and 100%.
  ok("D1 is weighted by cohort size", close(head[1], 12 / 102), String(head[1]));
  ok("…and is not the mean of the rates", !close(head[1], 0.55));
}

{
  // Nobody has reached D30 yet — that is "no data", not 0%.
  const matrix = buildCohortMatrix(
    [{ cohort_day: "2026-09-01", cohort_size: 10, day_offset: 0, returned: 10 }],
    7,
    new Date("2026-09-30T12:00:00Z"),
  );
  const head = headlineRetention(matrix, [1, 30]);
  ok("an offset outside the grid reports null, not zero", head[30] === null, String(head[30]));
  ok("…while an in-grid zero reports 0", head[1] === 0, String(head[1]));
}

// ---------------------------------------------------------------------------
section("challenge standings — rates, and refusing to guess");

{
  const standings = challengeStandings([
    {
      challenge_idx: 0,
      attempts: 40,
      clears: 34,
      players_attempted: 12,
      players_cleared: 11,
      // node-postgres returns numeric/avg as STRINGS. Forgetting to coerce is
      // not a type error — it is a string landing in a chart.
      median_clear_seconds: "95.5",
      avg_deaths: "1.25",
    },
    {
      challenge_idx: 7,
      attempts: 0,
      clears: 0,
      players_attempted: 0,
      players_cleared: 0,
      median_clear_seconds: null,
      avg_deaths: null,
    },
  ]);

  ok("clear rate divides clears by attempts", close(standings[0].clearRate, 34 / 40));
  ok("numeric strings are coerced to numbers", standings[0].medianClearSeconds === 95.5);
  ok("…including averages", standings[0].avgDeaths === 1.25);
  ok("attempts-per-clear counts PLAYERS who got there", close(standings[0].attemptsPerClear, 40 / 11));
  // An untried level has no rate. Reporting 0% would say "impossible" about
  // content nobody has opened.
  ok("an untried level has a null rate, not 0", standings[1].clearRate === null);
  ok("…and null attempts-per-clear", standings[1].attemptsPerClear === null);
}

{
  const standings = challengeStandings([
    { challenge_idx: 0, attempts: 100, clears: 90, players_attempted: 20, players_cleared: 18, median_clear_seconds: null, avg_deaths: null },
    { challenge_idx: 1, attempts: 100, clears: 20, players_attempted: 20, players_cleared: 5, median_clear_seconds: null, avg_deaths: null },
    // One player, one failed go. 0% — and meaningless.
    { challenge_idx: 2, attempts: 1, clears: 0, players_attempted: 1, players_cleared: 0, median_clear_seconds: null, avg_deaths: null },
    { challenge_idx: 3, attempts: 0, clears: 0, players_attempted: 0, players_cleared: 0, median_clear_seconds: null, avg_deaths: null },
  ]);
  const { ranked, insufficient } = hardestChallenges(standings, 5);

  ok("hardest sorts first by clear rate", ranked[0].challengeIdx === 1, String(ranked[0]?.challengeIdx));
  ok("easiest sorts last", ranked[ranked.length - 1].challengeIdx === 0);
  // The two guards that stop a "hardest levels" chart being nonsense on thin data.
  ok("a level with one attempt is not ranked", !ranked.some((s) => s.challengeIdx === 2));
  ok("an untried level is not ranked", !ranked.some((s) => s.challengeIdx === 3));
  ok("…both are reported separately instead", insufficient.length === 2);
}

// IDEA-063 took the ladder from 8 levels to 40, so most of it is untried on any
// given day. SQL returns NO ROW for a level nobody has opened, and a portal fed
// those rows would answer "which of the levels anyone has played is hardest"
// while looking like it answered "which level is the wall".
{
  const standings = challengeStandings(
    [
      { challenge_idx: 0, attempts: 12, clears: 9, players_attempted: 4, players_cleared: 3, median_clear_seconds: null, avg_deaths: null },
      { challenge_idx: 33, attempts: 7, clears: 1, players_attempted: 2, players_cleared: 1, median_clear_seconds: null, avg_deaths: null },
    ],
    40,
  );

  ok("the ladder is dense to its real length", standings.length === 40);
  ok("every index is its own position", standings.every((s, i) => s.challengeIdx === i));
  ok("a played level keeps its figures", standings[33].attempts === 7);
  // The whole point: an untried level is PRESENT and says nothing, rather than
  // being absent (invisible) or zero (a 0% clear rate, i.e. "impossible").
  ok("an untried level is present", standings[15].attempts === 0);
  ok("…with a null rate, never 0%", standings[15].clearRate === null);
  ok("…and no invented median", standings[15].medianClearSeconds === null);

  const { ranked, insufficient } = hardestChallenges(standings, 5);
  ok("only played levels are ranked", ranked.length === 2);
  ok("the 14%-clear level ranks hardest", ranked[0].challengeIdx === 33);
  ok("the other 38 are reported, not ranked", insufficient.length === 38);
}

// The count is a FLOOR, not a cap. A row past the end of the catalog means the
// server's generated catalog has drifted behind challenges.ts — the forgotten
// `npm run sync` this dashboard exists to surface — so it must survive to be
// seen rather than being quietly trimmed away.
{
  const standings = challengeStandings(
    [{ challenge_idx: 11, attempts: 3, clears: 0, players_attempted: 1, players_cleared: 0, median_clear_seconds: null, avg_deaths: null }],
    8,
  );
  ok("a level past the catalog's count is kept", standings.length === 12);
  ok("…with its attempts intact", standings[11].attempts === 3);
  ok("…and the gap below it filled", standings[9].attempts === 0);
}

// Called with no count at all (the shape every existing caller used), the list
// is still dense — just only as far as the data reaches.
{
  const standings = challengeStandings([
    { challenge_idx: 2, attempts: 5, clears: 5, players_attempted: 1, players_cleared: 1, median_clear_seconds: null, avg_deaths: null },
  ]);
  ok("with no count it is dense to the data", standings.length === 3);
}

// ---------------------------------------------------------------------------
section("slot tallies — zero is an answer, a tie is not");

const ENEMIES = ["Rose", "Teal", "Amber", "Violet", "Leaf"];

{
  const tallies = tallySlots(
    [
      { slot: 0, count: 30 },
      { slot: 2, count: 10 },
    ],
    ENEMIES,
  );
  ok("one entry per known slot", tallies.length === 5);
  ok("slots are named in order", tallies[0].label === "Rose" && tallies[4].label === "Leaf");
  // "The leaf one has never caught anyone" is a real finding; a missing row
  // would hide it.
  ok("an absent slot is an explicit zero", tallies[4].count === 0);
  ok("shares are of the total, not of the max", close(tallies[0].share, 0.75));
  ok("a zero slot has a zero share", tallies[4].share === 0);

  // Data recorded against an enemy the game no longer fields is dropped rather
  // than named — inventing a label would be worse than omitting it.
  const withGhostSlot = tallySlots([{ slot: 0, count: 1 }, { slot: 9, count: 99 }], ENEMIES);
  ok("an unknown slot is dropped", withGhostSlot.reduce((s, t) => s + t.count, 0) === 1);
  ok("…and does not distort the shares", withGhostSlot[0].share === 1);
}

{
  ok("the nemesis is the biggest tally", topSlot(tallySlots([{ slot: 1, count: 5 }, { slot: 3, count: 2 }], ENEMIES))?.label === "Teal");
  // A rewind that breaks a tie at random tells the player something untrue
  // about their own year. Better to say nothing.
  ok("a tie has no winner", topSlot(tallySlots([{ slot: 0, count: 4 }, { slot: 1, count: 4 }], ENEMIES)) === null);
  ok("no data has no winner", topSlot(tallySlots([], ENEMIES)) === null);
  // A three-way where one leads is still a clean answer.
  ok(
    "a clear leader beats two equals",
    topSlot(tallySlots([{ slot: 0, count: 9 }, { slot: 1, count: 4 }, { slot: 2, count: 4 }], ENEMIES))?.label === "Rose",
  );
}

// ---------------------------------------------------------------------------
section("shares");

{
  const out = shares([
    { value: "garden", runs: 60, players: 6 },
    { value: "city", runs: 40, players: 3 },
    { value: null, runs: 100, players: 9 },
  ]);
  ok("nulls are dropped from the list", out.length === 2);
  ok("biggest first", out[0].value === "garden");
  // The null rows are the pre-IDEA-050 backfill, which genuinely does not know
  // what was equipped. They still count in the denominator, because claiming
  // garden is 60% of all runs when it is 60% of the runs we KNOW about would
  // overstate it.
  ok("the denominator includes unknown runs", close(out[0].share, 0.3), String(out[0].share));
  ok("an empty input is an empty list", shares([]).length === 0);
}

// ---------------------------------------------------------------------------
section("rejection health — the forgotten-sync alarm");

{
  const quiet = rejectionHealth([{ accepted: 100, rejected: 1 }]);
  ok("a normal day is not alarming", !quiet.alarming);
  ok("…and still reports its rate", close(quiet.rejectionRate, 1 / 101));

  const broken = rejectionHealth([{ accepted: 50, rejected: 50 }]);
  ok("half the runs refused IS alarming", broken.alarming);
  ok("…at the documented threshold", broken.rejectionRate !== null && broken.rejectionRate >= ALARM_RATE);

  // One bad run on a quiet day is 50% and means nothing. The minimum-volume
  // guard is what stops this alarm crying wolf every morning.
  const thin = rejectionHealth([{ accepted: 1, rejected: 1 }]);
  ok("a two-run day is never alarming", !thin.alarming, String(thin.rejectionRate));

  const nothing = rejectionHealth([]);
  ok("no finishes means no rate", nothing.rejectionRate === null);
  ok("…and no alarm", !nothing.alarming);

  // Sums across days, not just the last one.
  const week = rejectionHealth([
    { accepted: 10, rejected: 0 },
    { accepted: 10, rejected: 0 },
    { accepted: 0, rejected: 10 },
  ]);
  ok("days are summed", week.totalAccepted === 20 && week.totalRejected === 10);
}

// ---------------------------------------------------------------------------
section("a cohort younger than an offset has NO number, not a zero");

// THE BUG THIS EXISTS FOR, and it was found by rendering the grid and reading
// it rather than by any test: the matrix zero-filled every offset out to the
// window's width regardless of how old a cohort was. A cohort that signed up
// four days ago showed "0%" under D7, D14 and D30 — and headlineRetention
// counted those zeroes, so every new signup silently dragged the headline
// number DOWN. Backwards, entirely believable on screen, and invisible to the
// type system.
{
  const matrix = buildCohortMatrix(
    [{ cohort_day: "2026-09-05", cohort_size: 11, day_offset: 0, returned: 8 }],
    30,
    new Date("2026-09-09T10:00:00Z"), // four days later
  );
  const cells = matrix[0].cells;
  ok("day 0 is reached", cells[0].reached === true);
  ok("day 4 is reached — exactly its age", cells[4].reached === true);
  ok("day 5 is NOT reached", cells[5].reached === false);
  ok("D7 is not reached", cells[7].reached === false);
  ok("D30 is not reached", cells[30].reached === false);
  // The cell still exists and still carries 0. `reached` is what the grid and
  // the headline read, so neither can render it as a real zero.
  ok("an unreached cell is still present in the dense grid", cells[7] !== undefined);

  const head = headlineRetention(matrix, [1, 7, 30]);
  ok("D7 reports null, not 0%", head[7] === null, String(head[7]));
  ok("D30 reports null, not 0%", head[30] === null, String(head[30]));
  // D1 IS reached and genuinely nobody came back — that must still read 0.
  ok("D1 is a real zero", head[1] === 0, String(head[1]));
}

{
  // A mature cohort and a day-old one together: only the mature one may count.
  const matrix = buildCohortMatrix(
    [
      { cohort_day: "2026-08-01", cohort_size: 100, day_offset: 7, returned: 30 },
      { cohort_day: "2026-09-08", cohort_size: 50, day_offset: 0, returned: 50 },
    ],
    30,
    new Date("2026-09-09T10:00:00Z"),
  );
  const head = headlineRetention(matrix, [7]);
  // 30/100 from the mature cohort ONLY. If the day-old one leaked in it would
  // read 30/150 = 20%.
  ok("a day-old cohort does not dilute D7", close(head[7], 0.3), String(head[7]));
}

console.log(`\n${"-".repeat(60)}`);
console.log(`ANALYTICS: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
