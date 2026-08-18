// OWNER: backend
//
// auth_tokens access. Only sha256(token) is ever stored or queried — the
// plaintext exists solely in the response that issues it and in the client's
// localStorage. See auth/tokens.ts for why opaque tokens over JWTs.

import { query } from "../db.js";
import type { Executor, UserRow } from "./types.js";

export async function createToken(
  userId: string,
  tokenHash: Buffer,
  expiresAt: Date,
  client?: Executor,
): Promise<void> {
  const sql = `INSERT INTO auth_tokens (token_hash, user_id, expires_at)
               VALUES ($1, $2, $3)`;
  const params = [tokenHash, userId, expiresAt];
  if (client) await client.query(sql, params);
  else await query(sql, params);
}

/** Resolve a presented token to its user, in one round trip.
 *
 *  Expired rows are filtered in SQL rather than checked in JS so an expired
 *  token can never authenticate even if a caller forgets to compare dates. */
export async function findUserByToken(tokenHash: Buffer): Promise<UserRow | null> {
  const { rows } = await query<UserRow>(
    `SELECT u.id, u.username, u.username_lower, u.password_hash,
            u.recovery_code_hash, u.recovery_code_version, u.coins,
            u.challenge_progress, u.equipped_beagle_skin_id,
            u.equipped_enemy_skin_id, u.equipped_maze_theme_id,
            u.owned_beagle_skin_ids, u.owned_enemy_skin_ids,
            u.owned_maze_theme_ids, u.high_score, u.high_score_at,
            u.control_scheme, u.tutorial_done, u.created_at
       FROM auth_tokens t
       JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = $1
        AND t.expires_at > now()`,
    [tokenHash],
  );
  return rows[0] ?? null;
}

/** Sliding expiry: extend a token that is actively in use.
 *
 *  Rate-limited to at most one write per day per token (the `last_used_at`
 *  guard) — without it every authenticated request would issue an UPDATE,
 *  turning a read-only path into a write-heavy one for no benefit. */
export async function touchToken(
  tokenHash: Buffer,
  ttlDays: number,
): Promise<void> {
  await query(
    `UPDATE auth_tokens
        SET last_used_at = now(),
            expires_at   = now() + ($2 || ' days')::interval
      WHERE token_hash = $1
        AND last_used_at < now() - interval '1 day'`,
    [tokenHash, String(ttlDays)],
  );
}

export async function deleteToken(tokenHash: Buffer): Promise<void> {
  await query(`DELETE FROM auth_tokens WHERE token_hash = $1`, [tokenHash]);
}

/** Revoke every token for a user — i.e. sign out all devices.
 *
 *  Called when a password is reset via recovery code. That matters: the whole
 *  reason someone resets a password is that it may be compromised, so leaving
 *  other sessions alive would defeat the reset. */
export async function deleteAllTokensForUser(
  userId: string,
  client?: Executor,
): Promise<number> {
  const sql = `DELETE FROM auth_tokens WHERE user_id = $1`;
  const params = [userId];
  const res = client ? await client.query(sql, params) : await query(sql, params);
  return res.rowCount ?? 0;
}

/** Housekeeping for expired rows. Nothing depends on this for correctness —
 *  findUserByToken already excludes expired tokens — it just stops the table
 *  growing without bound. */
export async function deleteExpiredTokens(): Promise<number> {
  const res = await query(`DELETE FROM auth_tokens WHERE expires_at < now()`);
  return res.rowCount ?? 0;
}
