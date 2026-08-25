// OWNER: backend
//
// Run sessions: issuing them, and judging what comes back.
//
// The shape of the anti-cheat here is deliberate and worth stating once:
//
//   - The session's start time is written by Postgres. A client can lie about
//     everything it reports EXCEPT how long the server has known the run was in
//     progress, which is what the time bounds rest on.
//   - Coins are recomputed from the ACCEPTED values, never taken from the
//     request. A client cannot mint currency.
//   - challenge_progress advances only on a validated clear of an unlocked
//     level, so nobody unlocks the ladder with a POST.
//   - high_score is CLASSIC ONLY. Challenge modifiers (up to 5 ghosts at ×2
//     speed) make its scores incomparable, so ranking them together would hand
//     the leaderboard to whoever grinds the hardest challenge level.

import { withTransaction, query } from "../db.js";
import { env } from "../env.js";
import * as sessionsRepo from "../repo/gameSessions.js";
import * as usersRepo from "../repo/users.js";
import { toPublicProfile, type PublicProfile, type UserRow } from "../repo/types.js";
import { ApiError } from "../http/errors.js";
import { validateRun, MAX_RUN_HOURS, type RunSubmission } from "../validation/plausibility.js";
import { invalidateBoardCache } from "./boardCache.js";
import { CHALLENGE_LEVELS, CHALLENGE_LEVEL_COUNT } from "../catalog.generated.js";

/** A run quit mid-game never finishes its session (a quit isn't a score), so
 *  stale ones are swept rather than lingering against the open-session cap.
 *
 *  DERIVED from the validator's own ceiling, never hand-tuned. This was 10
 *  minutes once, and that number silently ate every good run: an open session
 *  older than 10 minutes is USUALLY a player still playing — classic mode is
 *  endless, and a 40,000-point run takes ~20. The sweeper would kill the
 *  session mid-game, the finish would land on a dead session, and the client
 *  read the 409 as "already submitted" — silence all the way down. The only
 *  age at which an open session is PROVABLY not a finishable run is the point
 *  where the validator would refuse it anyway (SESSION_TOO_OLD). */
const STALE_SESSION_MINUTES = MAX_RUN_HOURS * 60;

/** Enough for a couple of tabs or a reconnect; low enough that stockpiling
 *  session ids to finish later isn't practical. */
const MAX_OPEN_SESSIONS = 3;

export interface StartSessionResult {
  sessionId: string;
  serverTime: string;
}

export async function startSession(
  user: UserRow,
  modeInput: unknown,
  challengeIdxInput: unknown,
): Promise<StartSessionResult> {
  if (modeInput !== "classic" && modeInput !== "challenge") {
    throw new ApiError(400, "VALIDATION_FAILED", "Unknown game mode.");
  }
  const mode = modeInput;

  let challengeIdx: number | null = null;
  if (mode === "challenge") {
    // Check the type BEFORE coercing: Number(null) is 0 and Number("") is 0,
    // so a missing index would silently become "challenge level 1" and hand out
    // a session for a run the client never meant to start.
    if (typeof challengeIdxInput !== "number") {
      throw new ApiError(400, "VALIDATION_FAILED", "Challenge level is required.");
    }
    const idx = challengeIdxInput;
    if (!Number.isInteger(idx) || idx < 0 || idx >= CHALLENGE_LEVELS.length) {
      throw new ApiError(400, "VALIDATION_FAILED", "Unknown challenge level.");
    }
    // Refuse at issue time as well as at finish time: no point handing out a
    // session for a level the player can't legitimately clear.
    if (idx > user.challenge_progress) {
      throw new ApiError(409, "LEVEL_LOCKED", "You haven't unlocked that level yet.");
    }
    challengeIdx = idx;
  }

  await sessionsRepo.abandonStaleSessions(user.id, STALE_SESSION_MINUTES);

  // At the cap, retire the player's OLDEST open session instead of refusing.
  // Refusing used to be survivable when the sweep ran at 10 minutes; at the
  // 4-hour sweep it would mean "quit three runs and you're locked out for the
  // afternoon". Retiring keeps the same security property — a farmer still
  // can't hold more than MAX_OPEN_SESSIONS ids — and can never cost a real
  // run: even if the retired session WAS live on another device, its finish
  // is resurrected below.
  const open = await sessionsRepo.countOpenSessions(user.id);
  if (open >= MAX_OPEN_SESSIONS) {
    await sessionsRepo.abandonOldestOpenSession(user.id);
  }

  const session = await sessionsRepo.createSession(user.id, mode, challengeIdx);

  return {
    sessionId: session.id,
    // Returned for display only. The client must not compare its own clock
    // against this for anything load-bearing — all duration math is
    // finished_at - started_at, both server-side.
    serverTime: session.started_at.toISOString(),
  };
}

export interface FinishAcceptedResult {
  accepted: true;
  score: number;
  isNewHighScore: boolean;
  highScore: number;
  coinsAwarded: number;
  profile: PublicProfile;
}

export interface FinishRejectedResult {
  accepted: false;
  reasonCode: string;
  message: string;
  profile: PublicProfile;
}

export type FinishResult = FinishAcceptedResult | FinishRejectedResult;

function readSubmission(body: Record<string, unknown>): RunSubmission {
  const num = (value: unknown): number => (typeof value === "number" ? value : NaN);

  return {
    score: num(body.score),
    levelsCleared: num(body.levelsCleared),
    mazeIdxSequence: Array.isArray(body.mazeIdxSequence)
      ? (body.mazeIdxSequence as number[])
      : [],
    pelletsEaten: num(body.pelletsEaten),
    bonesEaten: num(body.bonesEaten),
    fruitEaten: num(body.fruitEaten),
    ghostsEaten: num(body.ghostsEaten),
    coinsCollected: num(body.coinsCollected),
    livesLost: num(body.livesLost),
    playSeconds: num(body.playSeconds),
  };
}

/**
 * Judge a completed run.
 *
 * A rejection is returned as HTTP 200 with `accepted: false`, not a 4xx: an
 * implausible score is a normal outcome of this endpoint, not a malformed
 * request. The client shows a message; the server logs the detail.
 */
export async function finishSession(
  user: UserRow,
  sessionId: string,
  body: Record<string, unknown>,
): Promise<FinishResult> {
  const submission = readSubmission(body);

  // Captured inside the transaction, acted on AFTER it commits: invalidating
  // mid-transaction would let a concurrent board read re-fill the cache with
  // pre-commit data, and the player opening the board from the game-over
  // panel would not see the run they just finished.
  let acceptedClassic = false;

  const result = await withTransaction(async (client) => {
    const session = await sessionsRepo.findSessionForUpdate(sessionId, user.id, client);

    // Also covers another user's session id — indistinguishable from a
    // nonexistent one, so nothing leaks about which ids exist.
    if (!session) {
      throw new ApiError(404, "NOT_FOUND", "That run wasn't found.");
    }

    // The replay guard. The row lock above is what makes it airtight. Only a
    // CONSIDERED verdict is terminal: 'accepted' (already scored — a retry
    // must not double-count) and 'rejected' (already judged implausible).
    if (session.status === "accepted" || session.status === "rejected") {
      throw new ApiError(409, "SESSION_ALREADY_FINISHED", "That run was already submitted.");
    }

    // RESURRECTION: 'abandoned' is a housekeeping label, not a verdict — the
    // sweeper's guess that the player wasn't coming back. A finish arriving
    // now proves the guess wrong, and everything needed to judge the run
    // (started_at, mode, challenge_idx) is still on the row. This is the
    // second line of defence behind the sweep threshold: whatever the sweeper
    // does, a real finish can always still score. Before this, a sweep that
    // outpaced a live run turned its finish into a 409 the client rightly
    // reads as "already submitted" — a silent loss with no trace anywhere.
    if (session.status === "abandoned") {
      console.log(`[finish] resurrecting swept session ${sessionId} for user ${user.id}`);
    }

    // Duration from the SERVER's clock at both ends — the number the client
    // cannot forge, and the whole reason sessions are server-issued.
    const { rows } = await client.query<{ elapsed: string }>(
      `SELECT EXTRACT(EPOCH FROM (now() - started_at)) AS elapsed
         FROM game_sessions WHERE id = $1`,
      [sessionId],
    );
    const elapsedServerSeconds = Number(rows[0].elapsed);

    const verdict = validateRun(submission, {
      elapsedServerSeconds,
      mode: session.mode,
      challengeIdx: session.challenge_idx,
      currentChallengeProgress: user.challenge_progress,
    });

    if (!verdict.accepted) {
      await sessionsRepo.finishSession(sessionId, "rejected", submission.score, null, client);
      await sessionsRepo.logRejection(
        user.id,
        sessionId,
        verdict.reasonCode,
        verdict.detail,
        client,
      );

      const fresh = (await usersRepo.findById(user.id, client)) ?? user;
      return {
        accepted: false as const,
        reasonCode: verdict.reasonCode,
        message: "That run didn't add up, so the score wasn't recorded.",
        profile: toPublicProfile(fresh),
      };
    }

    // --- accepted -----------------------------------------------------------
    await sessionsRepo.finishSession(
      sessionId,
      "accepted",
      submission.score,
      submission.score,
      client,
    );

    const isClassic = session.mode === "classic";
    const isNewHighScore = isClassic && submission.score > user.high_score;

    // CLASSIC ONLY. A challenge run never touches high_score — see the note at
    // the top of this file for why the two aren't comparable.
    if (isNewHighScore) {
      await client.query(
        `UPDATE users SET high_score = $2, high_score_at = now() WHERE id = $1`,
        [user.id, submission.score],
      );
    }

    // A challenge clear advances progress — max-write, so replaying an earlier
    // level can never lock the player out of ones they already cleared.
    if (
      session.mode === "challenge" &&
      session.challenge_idx !== null &&
      submission.levelsCleared >= 1
    ) {
      const next = Math.min(session.challenge_idx + 1, CHALLENGE_LEVEL_COUNT);
      await client.query(
        `UPDATE users SET challenge_progress = GREATEST(challenge_progress, $2) WHERE id = $1`,
        [user.id, next],
      );
    }

    // Coins from the validator's own recomputation — both modes pay out, since
    // coins are a wallet rather than a ranking.
    if (verdict.coinsAwarded > 0) {
      await client.query(`UPDATE users SET coins = coins + $2 WHERE id = $1`, [
        user.id,
        verdict.coinsAwarded,
      ]);
    }

    const fresh = (await usersRepo.findById(user.id, client)) ?? user;

    // Every accepted classic run changes the boards: a new row on All-runs,
    // and possibly a new personal best on Players. Challenge runs touch
    // neither (unranked), so they leave the cache alone.
    acceptedClassic = isClassic;

    return {
      accepted: true as const,
      score: submission.score,
      isNewHighScore,
      highScore: fresh.high_score,
      coinsAwarded: verdict.coinsAwarded,
      profile: toPublicProfile(fresh),
    };
  });

  if (acceptedClassic) invalidateBoardCache();
  return result;
}

/** Global sweeper for sessions belonging to players who never came back.
 *  Called on an interval from index.ts. */
export async function sweepStaleSessions(): Promise<number> {
  const res = await query(
    `UPDATE game_sessions
        SET status = 'abandoned', finished_at = now()
      WHERE status = 'open'
        AND started_at < now() - ($1 || ' minutes')::interval`,
    [String(STALE_SESSION_MINUTES)],
  );
  return res.rowCount ?? 0;
}

/**
 * IDEA-039 P2: delete abandoned sessions past the retention window.
 *
 * Ordering matters and is not accidental — index.ts runs the SWEEP first and
 * this second. The sweep is what turns a quit-to-menu into an 'abandoned' row;
 * running the purge before it would leave the newest quits un-aged for a full
 * cycle. Harmless either way, but the intent is "age it, then eventually
 * collect it".
 *
 * Returns the number deleted. `SESSION_RETENTION_DAYS=0` disables it entirely,
 * and at today's volume a 90-day window deletes nothing at all — which is the
 * intended behaviour, not a bug. See repo.deleteOldAbandonedSessions for why
 * only 'abandoned' rows are ever eligible.
 */
export async function purgeOldSessions(): Promise<number> {
  if (env.SESSION_RETENTION_DAYS <= 0) return 0;
  return sessionsRepo.deleteOldAbandonedSessions(env.SESSION_RETENTION_DAYS);
}
