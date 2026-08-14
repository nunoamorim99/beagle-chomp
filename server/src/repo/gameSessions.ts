// OWNER: backend
//
// game_sessions + score_rejections access. Per STACK.md §2.7, SQL lives only in
// repo/*.
//
// The point of this table: the run's start time is written by POSTGRES, not by
// the client. That single fact is what makes the plausibility validator's time
// bounds meaningful — a client can lie about its score, but it cannot lie about
// how long the server has known the run was in progress.

import { query } from "../db.js";
import type { Executor } from "./types.js";
import type { PoolClient } from "pg";

export type SessionMode = "classic" | "challenge";
export type SessionStatus = "open" | "accepted" | "rejected" | "abandoned";

export interface GameSessionRow {
  id: string;
  user_id: string;
  mode: SessionMode;
  challenge_idx: number | null;
  started_at: Date;
  finished_at: Date | null;
  status: SessionStatus;
  reported_score: number | null;
  accepted_score: number | null;
}

const SESSION_COLUMNS = `
  id, user_id, mode, challenge_idx, started_at, finished_at,
  status, reported_score, accepted_score
`;

export async function createSession(
  userId: string,
  mode: SessionMode,
  challengeIdx: number | null,
): Promise<GameSessionRow> {
  const { rows } = await query<GameSessionRow>(
    `INSERT INTO game_sessions (user_id, mode, challenge_idx)
     VALUES ($1, $2, $3)
     RETURNING ${SESSION_COLUMNS}`,
    [userId, mode, challengeIdx],
  );
  return rows[0];
}

/** Fetch a session, scoped to its owner.
 *
 *  Scoping by user_id in the WHERE clause (rather than fetching then comparing)
 *  means another player's session id is indistinguishable from a nonexistent
 *  one — no information leaks about which ids exist. */
export async function findSessionForUser(
  sessionId: string,
  userId: string,
  client?: Executor,
): Promise<GameSessionRow | null> {
  const sql = `SELECT ${SESSION_COLUMNS} FROM game_sessions
                WHERE id = $1 AND user_id = $2`;
  const params = [sessionId, userId];
  const res = client
    ? await client.query<GameSessionRow>(sql, params)
    : await query<GameSessionRow>(sql, params);
  return res.rows[0] ?? null;
}

/** Lock a session for the finish transaction.
 *
 *  Required for the replay guard: two concurrent finishes for the same session
 *  must not both see status='open'. The lock makes "a session can only be
 *  finished once" an actual guarantee rather than a likely outcome. */
export async function findSessionForUpdate(
  sessionId: string,
  userId: string,
  client: PoolClient,
): Promise<GameSessionRow | null> {
  const { rows } = await client.query<GameSessionRow>(
    `SELECT ${SESSION_COLUMNS} FROM game_sessions
      WHERE id = $1 AND user_id = $2
      FOR UPDATE`,
    [sessionId, userId],
  );
  return rows[0] ?? null;
}

export async function finishSession(
  sessionId: string,
  status: Exclude<SessionStatus, "open">,
  reportedScore: number,
  acceptedScore: number | null,
  client?: Executor,
): Promise<void> {
  const sql = `UPDATE game_sessions
                  SET finished_at = now(), status = $2,
                      reported_score = $3, accepted_score = $4
                WHERE id = $1`;
  const params = [sessionId, status, reportedScore, acceptedScore];
  if (client) await client.query(sql, params);
  else await query(sql, params);
}

/** How many sessions this user has left open. Used to refuse a player who is
 *  stockpiling session ids to finish later with inflated scores. */
export async function countOpenSessions(userId: string): Promise<number> {
  const { rows } = await query<{ count: string }>(
    `SELECT count(*) AS count FROM game_sessions
      WHERE user_id = $1 AND status = 'open'`,
    [userId],
  );
  return Number(rows[0].count);
}

/** Mark stale open sessions as abandoned.
 *
 *  Runs before issuing a new session (cheap, and keeps the open-session count
 *  honest without needing a cron). A quit-to-menu never finishes its session —
 *  deliberately, since a quit isn't a score — so without this the count would
 *  creep up until a legitimate player was refused a new run. */
export async function abandonStaleSessions(
  userId: string,
  olderThanMinutes: number,
): Promise<number> {
  const res = await query(
    `UPDATE game_sessions
        SET status = 'abandoned', finished_at = now()
      WHERE user_id = $1
        AND status = 'open'
        AND started_at < now() - ($2 || ' minutes')::interval`,
    [userId, String(olderThanMinutes)],
  );
  return res.rowCount ?? 0;
}

/** Log a rejected submission. The brief: "Reject implausible submissions rather
 *  than silently clamping them. Log rejections."
 *
 *  This is also the tuning input — the plan holds the leaderboard back one
 *  increment so real rejection data can be reviewed before anyone sees a
 *  ranking, catching a bound that is too tight before it costs a real player a
 *  legitimate score. */
export async function logRejection(
  userId: string,
  sessionId: string,
  reasonCode: string,
  detail: unknown,
  client?: Executor,
): Promise<void> {
  const sql = `INSERT INTO score_rejections (user_id, session_id, reason_code, detail)
               VALUES ($1, $2, $3, $4)`;
  const params = [userId, sessionId, reasonCode, JSON.stringify(detail)];
  if (client) await client.query(sql, params);
  else await query(sql, params);
}
