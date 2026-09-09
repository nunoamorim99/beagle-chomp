// OWNER: backend
//
// Shaping analytics rows into the answers the portal asks for (IDEA-050).
//
// PURE ON PURPOSE, and for a specific reason this codebase has already paid to
// learn: `db.ts` opens a Postgres pool the moment it is imported, so anything
// that imports it — directly or transitively — is unreachable from the DB-free
// suite. That is exactly how `readSubmission` went untested and dropped a field
// for a whole release (IDEA-040 v3, see validation/wire.ts). So the SQL lives in
// repo/analytics.ts and every judgement lives here, where `npm test` can reach
// it with no services running.
//
// The rule for deciding which side a piece of logic belongs on: if Postgres can
// express it in one honest aggregate, it goes in the repo. If it involves
// filling in absent values, dividing one count by another, or ranking things
// where the answer is disputable when the data is thin — it belongs here, with
// a test pinning what it does at the edges.

/** Nearest-rank percentile over an unsorted array.
 *
 *  Never interpolated — the same decision, and the same reason, as
 *  `percentile` in http/metrics.ts: an interpolated p95 invents a value that no
 *  observation actually had, which is exactly the kind of number that gets
 *  argued with. Sorts a copy; callers pass arrays they still own. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

export interface CohortCell {
  cohortDay: string;
  cohortSize: number;
  /** Day 0 is signup day. */
  dayOffset: number;
  returned: number;
  /** 0..1. Day 0 is not automatically 1 — a player who signed up and never
   *  started a run is in the cohort and did not return. */
  rate: number;
  /**
   * Whether this cohort has actually LIVED long enough to have this number.
   *
   * A cohort that signed up four days ago has not failed its D7 — it has not
   * had one. Before this flag existed the grid zero-filled every offset to the
   * window's width, so a four-day-old cohort rendered "0%" under D7, D14 and
   * D30, and `headlineRetention` counted those zeroes: every new signup
   * silently dragged the headline down, which is precisely backwards. Caught by
   * rendering the grid and reading it, not by a type error.
   *
   * `false` means "no data yet" and must never be drawn as 0%.
   */
  reached: boolean;
}

export interface CohortRow {
  cohortDay: string;
  cohortSize: number;
  /** Dense: one entry per offset 0..maxOffset, zero-filled. */
  cells: CohortCell[];
}

export interface RawCohortCell {
  cohort_day: Date | string;
  cohort_size: number;
  day_offset: number;
  returned: number;
}

const isoDay = (d: Date | string): string =>
  (typeof d === "string" ? d : d.toISOString()).slice(0, 10);

/**
 * Assemble a dense cohort matrix from the sparse (cohort, offset) rows SQL
 * returns.
 *
 * The zero-fill is the whole job. SQL returns a row only where somebody
 * actually came back, and a retention grid with holes in it reads as "no data"
 * exactly where the answer is "nobody" — which is the most important cell on
 * the chart. `maxOffset` is passed in rather than derived from the data for the
 * same reason: derived, the grid would silently narrow on a bad week and the
 * chart would look better than the truth.
 */
export function buildCohortMatrix(
  rows: readonly RawCohortCell[],
  maxOffset: number,
  asOf: Date = new Date(),
): CohortRow[] {
  const byCohort = new Map<string, { size: number; returned: Map<number, number> }>();

  for (const row of rows) {
    const day = isoDay(row.cohort_day);
    let entry = byCohort.get(day);
    if (!entry) {
      entry = { size: row.cohort_size, returned: new Map() };
      byCohort.set(day, entry);
    }
    // Offsets beyond the window are dropped rather than widening the grid.
    if (row.day_offset < 0 || row.day_offset > maxOffset) continue;
    entry.returned.set(row.day_offset, row.returned);
  }

  const DAY_MS = 86_400_000;
  const asOfDay = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());

  return [...byCohort.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([cohortDay, entry]) => {
      // How many whole days this cohort has actually lived. A cohort that signed
      // up today has reached offset 0 and nothing else.
      const age = Math.floor((asOfDay - Date.parse(`${cohortDay}T00:00:00Z`)) / DAY_MS);
      return {
        cohortDay,
        cohortSize: entry.size,
        cells: Array.from({ length: maxOffset + 1 }, (_unused, dayOffset) => {
          const returned = entry.returned.get(dayOffset) ?? 0;
          return {
            cohortDay,
            cohortSize: entry.size,
            dayOffset,
            returned,
            // Guarded: a cohort with no members cannot exist in the rows above,
            // but dividing by it would produce NaN and NaN serialises to null,
            // which the chart would draw as a gap rather than a zero.
            rate: entry.size > 0 ? returned / entry.size : 0,
            reached: Number.isFinite(age) ? dayOffset <= age : true,
          };
        }),
      };
    });
}

/** D1 / D7 / D30 across every cohort in the window, weighted by cohort size.
 *
 *  Weighted rather than an average-of-rates: a 2-player cohort at 100% and a
 *  200-player cohort at 10% is not 55% retention, and the unweighted number
 *  swings wildly in exactly the low-volume situation this project is in. */
export function headlineRetention(
  matrix: readonly CohortRow[],
  offsets: readonly number[] = [1, 7, 30],
): Record<number, number | null> {
  const out: Record<number, number | null> = {};
  for (const offset of offsets) {
    let size = 0;
    let returned = 0;
    for (const cohort of matrix) {
      const cell = cohort.cells[offset];
      // Only cohorts OLD ENOUGH to have reached this offset may count. A cohort
      // that signed up yesterday has not failed its D7 — it has not had one —
      // and letting it contribute a zero drags every headline number down as
      // soon as new players arrive, which is precisely backwards.
      //
      // `reached` is what carries that, NOT the array length: the grid is dense
      // to the window's width, so `cells.length <= offset` is false for every
      // cohort and was never actually excluding anything. That bug was visible
      // on screen (D7 reading 0% for a four-day-old cohort) and invisible to
      // the type system.
      if (!cell || !cell.reached) continue;
      size += cohort.cohortSize;
      returned += cell.returned;
    }
    out[offset] = size > 0 ? returned / size : null;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Difficulty
// ---------------------------------------------------------------------------

export interface ChallengeStanding {
  challengeIdx: number;
  attempts: number;
  clears: number;
  /** clears ÷ attempts, or null when nobody has tried it. */
  clearRate: number | null;
  playersAttempted: number;
  playersCleared: number;
  /** attempts ÷ playersCleared — how many goes it takes a player who
   *  eventually gets there. null until at least one player has. */
  attemptsPerClear: number | null;
  medianClearSeconds: number | null;
  avgDeaths: number | null;
}

export interface RawChallengeRow {
  challenge_idx: number;
  attempts: number;
  clears: number;
  players_attempted: number;
  players_cleared: number;
  median_clear_seconds: number | string | null;
  avg_deaths: number | string | null;
}

/** Postgres returns numeric/avg as a STRING through node-postgres (it will not
 *  silently narrow arbitrary precision to a float64), so every average and
 *  percentile has to be coerced. Forgetting is not a type error — it is a
 *  string concatenating into a chart. */
const num = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

export function challengeStandings(rows: readonly RawChallengeRow[]): ChallengeStanding[] {
  return rows.map((r) => ({
    challengeIdx: r.challenge_idx,
    attempts: r.attempts,
    clears: r.clears,
    clearRate: r.attempts > 0 ? r.clears / r.attempts : null,
    playersAttempted: r.players_attempted,
    playersCleared: r.players_cleared,
    attemptsPerClear: r.players_cleared > 0 ? r.attempts / r.players_cleared : null,
    medianClearSeconds: num(r.median_clear_seconds),
    avgDeaths: num(r.avg_deaths),
  }));
}

/**
 * Rank the challenge levels by how hard they actually are.
 *
 * Hardest first, by clear RATE — not by attempt count, which mostly measures
 * how many people got that far. Levels nobody has attempted sort LAST rather
 * than first: an untried level has a null rate, and treating that as 0% would
 * put the newest content at the top of a "hardest" list on no evidence.
 *
 * `minAttempts` exists for the same reason. One player failing once is a 0%
 * clear rate and means nothing; below the threshold a level is reported but not
 * ranked, so the portal can show it greyed rather than pretending.
 */
export function hardestChallenges(
  standings: readonly ChallengeStanding[],
  minAttempts = 5,
): { ranked: ChallengeStanding[]; insufficient: ChallengeStanding[] } {
  const ranked = standings
    .filter((s) => s.attempts >= minAttempts && s.clearRate !== null)
    .sort((a, b) => (a.clearRate ?? 1) - (b.clearRate ?? 1));
  const insufficient = standings.filter((s) => s.attempts < minAttempts || s.clearRate === null);
  return { ranked, insufficient };
}

// ---------------------------------------------------------------------------
// Slots (enemies, fruit) and shares
// ---------------------------------------------------------------------------

export interface SlotTally {
  slot: number;
  label: string;
  count: number;
  share: number;
}

/**
 * Turn sparse `(slot, count)` rows into one entry per known slot, named.
 *
 * Zero-filled against `labels`, because "the leaf one has never caught anyone"
 * is a real and interesting answer that a missing row would hide. Slots outside
 * the label list are dropped: that means data recorded against an enemy the
 * game no longer fields, and inventing a name for it would be worse than
 * omitting it.
 */
export function tallySlots(
  rows: readonly { slot: number; count: number }[],
  labels: readonly string[],
): SlotTally[] {
  const counts = new Map<number, number>();
  for (const row of rows) {
    if (row.slot < 0 || row.slot >= labels.length) continue;
    counts.set(row.slot, (counts.get(row.slot) ?? 0) + row.count);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  return labels.map((label, slot) => {
    const count = counts.get(slot) ?? 0;
    return { slot, label, count, share: total > 0 ? count / total : 0 };
  });
}

/** The slot with the most against it, or null on a tie or no data.
 *
 *  Null on a TIE is deliberate: "your nemesis was the rose one" is a claim, and
 *  a rewind that picks one of two equals at random is telling the player
 *  something untrue about their own year. The caller shows nothing instead. */
export function topSlot(tallies: readonly SlotTally[]): SlotTally | null {
  let best: SlotTally | null = null;
  let tied = false;
  for (const t of tallies) {
    if (t.count === 0) continue;
    if (!best || t.count > best.count) {
      best = t;
      tied = false;
    } else if (t.count === best.count) {
      tied = true;
    }
  }
  return tied ? null : best;
}

export interface Share {
  value: string;
  runs: number;
  players: number;
  share: number;
}

/** Percentage share of runs per value, biggest first. */
export function shares(rows: readonly { value: string | null; runs: number; players: number }[]): Share[] {
  const total = rows.reduce((sum, r) => sum + r.runs, 0);
  return rows
    .filter((r): r is { value: string; runs: number; players: number } => r.value !== null)
    .map((r) => ({
      value: r.value,
      runs: r.runs,
      players: r.players,
      share: total > 0 ? r.runs / total : 0,
    }))
    .sort((a, b) => b.runs - a.runs);
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export interface RejectionHealth {
  totalAccepted: number;
  totalRejected: number;
  /** rejected ÷ (accepted + rejected), or null before any run finished. */
  rejectionRate: number | null;
  /** True when the rate is high enough to be worth looking at. */
  alarming: boolean;
}

/**
 * Is the validator refusing honest runs?
 *
 * `ALARM_RATE` is 5%, and the number is a judgement rather than a measurement:
 * cheating is rare on a game with no prizes, so a rejection rate this high is
 * far more likely to mean the server's catalog has drifted from the game's
 * (a forgotten `npm run sync`) than that players suddenly started cheating.
 * That is the failure this alarm exists to catch, because the last time it
 * happened it was found by a player losing a personal best.
 *
 * `minFinishes` keeps a quiet day from raising it: one rejection out of two
 * runs is 50% and means nothing.
 */
export const ALARM_RATE = 0.05;

export function rejectionHealth(
  rows: readonly { accepted: number; rejected: number }[],
  minFinishes = 20,
): RejectionHealth {
  const totalAccepted = rows.reduce((sum, r) => sum + r.accepted, 0);
  const totalRejected = rows.reduce((sum, r) => sum + r.rejected, 0);
  const finishes = totalAccepted + totalRejected;
  const rejectionRate = finishes > 0 ? totalRejected / finishes : null;
  return {
    totalAccepted,
    totalRejected,
    rejectionRate,
    alarming: finishes >= minFinishes && rejectionRate !== null && rejectionRate >= ALARM_RATE,
  };
}
