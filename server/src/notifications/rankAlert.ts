// OWNER: backend
//
// Who gets told their score was beaten (IDEA-052b).
//
// PURE — no database, no clock, no network. Same reason as validation/wire.ts
// and analytics/aggregate.ts: the service layer imports db.ts, which opens a
// Postgres pool on import, and this is exactly the kind of fiddly
// ordering/tie-breaking logic that must be testable with no services running.
//
// WHY THE TRIGGER IS FREE. The Players board ranks by PERSONAL BEST, one row
// per player (users.high_score, with users_high_score_idx ordering
// `high_score DESC, high_score_at ASC`). A player's position on it can
// therefore only change when they set a new personal best — which is precisely
// the moment `finishSession` already computes as `isNewHighScore`. There is
// nothing to poll and no board to diff.
//
// WHAT THIS FILE REFUSES TO DO. It will not tell someone they were passed when
// they were not, and it will not tell forty-nine people at once. Both of those
// are how a notification feature becomes a muted notification feature.

/** One row of the board, as it stood BEFORE the run that displaced anyone. */
export interface BoardEntry {
  userId: string;
  username: string;
  highScore: number;
  /** Tie-break: at equal scores, whoever got there FIRST ranks higher. */
  highScoreAt: Date;
  /** Whether this player wants rank alerts at all. */
  notifyRank: boolean;
  /** When they were last told, or null. Drives the cooldown. */
  lastAlertAt: Date | null;
}

export interface Runner {
  userId: string;
  username: string;
  /** Their personal best BEFORE this run. */
  previousBest: number;
  /** The score just accepted. */
  newBest: number;
}

export interface Recipient {
  userId: string;
  username: string;
  /** Where they sit on the board NOW, 1-based. */
  newRank: number;
  /** Who passed them. */
  passedBy: string;
  passedByScore: number;
}

export interface AlertOptions {
  /** Only players who were within this many places of the top are told. */
  topN: number;
  /** Hours since a player's last alert before they may get another. */
  cooldownHours: number;
  /** "Now", passed in so this stays pure and testable. */
  now: Date;
}

const HOUR_MS = 3_600_000;

/**
 * Rank the board the way Postgres does: score descending, and at equal scores
 * whoever reached it FIRST comes first. Returns a NEW array.
 */
function ranked(board: readonly BoardEntry[]): BoardEntry[] {
  return [...board].sort((a, b) => {
    if (b.highScore !== a.highScore) return b.highScore - a.highScore;
    return a.highScoreAt.getTime() - b.highScoreAt.getTime();
  });
}

/**
 * Who did this run actually overtake, and which of them should be told.
 *
 * `board` is the state BEFORE the run — including the runner's own old row, if
 * they had one. The runner's new position is computed from `newBest` with a
 * high_score_at of NOW, which is what the database will write.
 *
 * The tie rule is the subtle part and it is not cosmetic. A player sitting on
 * exactly the new score got there EARLIER, so they still rank above the runner
 * and have NOT been passed. Telling them otherwise would be a false claim about
 * their own standing, which is worse than saying nothing.
 */
export function whoWasOvertaken(
  runner: Runner,
  board: readonly BoardEntry[],
  opts: AlertOptions,
): Recipient[] {
  // A run that did not improve on the runner's own best cannot move them.
  if (runner.newBest <= runner.previousBest) return [];

  const before = ranked(board);

  // Where each player stood before. Only those who were near the top are ever
  // told — being pushed from #340 to #341 is not news, and saying so trains
  // people to mute you.
  const rankBefore = new Map<string, number>();
  before.forEach((e, i) => rankBefore.set(e.userId, i + 1));

  // The board AFTER: the runner's row replaced (or added) at the new score,
  // stamped now — so they sort LAST among equals, exactly as Postgres will
  // order them once high_score_at is updated.
  const after = ranked([
    ...board.filter((e) => e.userId !== runner.userId),
    {
      userId: runner.userId,
      username: runner.username,
      highScore: runner.newBest,
      highScoreAt: opts.now,
      notifyRank: false,
      lastAlertAt: null,
    },
  ]);
  const rankAfter = new Map<string, number>();
  after.forEach((e, i) => rankAfter.set(e.userId, i + 1));

  const out: Recipient[] = [];
  for (const entry of board) {
    if (entry.userId === runner.userId) continue;
    if (!entry.notifyRank) continue;

    const was = rankBefore.get(entry.userId);
    const now = rankAfter.get(entry.userId);
    if (was === undefined || now === undefined) continue;

    // Did they actually move DOWN? This is the check that gets the tie right
    // without special-casing it: a player tied at the new score keeps their
    // position, so `now === was` and they are not told.
    if (now <= was) continue;

    // Only the top of the board is worth interrupting someone about.
    if (was > opts.topN) continue;

    // One alert per player per cooldown, however busy the evening.
    if (
      entry.lastAlertAt !== null &&
      opts.now.getTime() - entry.lastAlertAt.getTime() < opts.cooldownHours * HOUR_MS
    ) {
      continue;
    }

    out.push({
      userId: entry.userId,
      username: entry.username,
      newRank: now,
      passedBy: runner.username,
      passedByScore: runner.newBest,
    });
  }

  // Closest to the top first, so a capped fan-out drops the least important.
  return out.sort((a, b) => a.newRank - b.newRank);
}

/** The message itself. One line, because a notification is a headline and
 *  every platform truncates the rest — and on iOS there is no `actions`,
 *  `image` or `badge` to lean on either. */
export function rankAlertBody(r: Recipient): string {
  return `${r.passedBy} just passed your score. You're #${r.newRank} now.`;
}

export const RANK_ALERT_TITLE = "You've been overtaken";
