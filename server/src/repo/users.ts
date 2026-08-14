// OWNER: backend
//
// User row access. Per STACK.md §2.7 this file and its siblings in repo/ are
// the ONLY place SQL is written — services and routes never import `query`.
// That is what keeps "add a cache later" a one-layer change, and it means every
// query touching users is reviewable in one file.
//
// All queries are parameterised. No string interpolation, ever.

import { query, pool } from "../db.js";
import type { Executor, UserRow } from "./types.js";

const USER_COLUMNS = `
  id, username, username_lower, password_hash, recovery_code_hash,
  recovery_code_version, coins, challenge_progress,
  equipped_beagle_skin_id, equipped_enemy_skin_id, equipped_maze_theme_id,
  owned_beagle_skin_ids, owned_enemy_skin_ids, owned_maze_theme_ids,
  high_score, high_score_at, created_at
`;

function run(client: Executor) {
  return client
    ? <T extends UserRow>(text: string, params: readonly unknown[]) =>
        client.query<T>(text, params as unknown[])
    : <T extends UserRow>(text: string, params: readonly unknown[]) =>
        query<T>(text, params);
}

export interface CreateUserInput {
  username: string;
  passwordHash: string;
  recoveryCodeHash: string;
}

/** Insert a new account. Throws on duplicate username — callers should catch
 *  Postgres error 23505 and surface USERNAME_TAKEN rather than pre-checking,
 *  since a check-then-insert races with a concurrent signup. */
export async function createUser(
  input: CreateUserInput,
  client?: Executor,
): Promise<UserRow> {
  const { rows } = await run(client)<UserRow>(
    `INSERT INTO users (username, username_lower, password_hash, recovery_code_hash)
     VALUES ($1, LOWER($1), $2, $3)
     RETURNING ${USER_COLUMNS}`,
    [input.username, input.passwordHash, input.recoveryCodeHash],
  );
  return rows[0];
}

/** Postgres unique-violation. Used to turn a duplicate-username insert into a
 *  clean 409 instead of a 500. */
export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "23505"
  );
}

export async function findById(
  id: string,
  client?: Executor,
): Promise<UserRow | null> {
  const { rows } = await run(client)<UserRow>(
    `SELECT ${USER_COLUMNS} FROM users WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/** Look up by username, case-insensitively (the login path). */
export async function findByUsername(
  username: string,
  client?: Executor,
): Promise<UserRow | null> {
  const { rows } = await run(client)<UserRow>(
    `SELECT ${USER_COLUMNS} FROM users WHERE username_lower = LOWER($1)`,
    [username],
  );
  return rows[0] ?? null;
}

/** Look up by username and LOCK the row until the transaction ends.
 *
 *  Required for recovery-code consumption: without the lock, two concurrent
 *  requests presenting the same code could both read it as valid before either
 *  writes the replacement — and the code would have been used twice. The lock
 *  is what makes single-use an actual guarantee rather than a race that is
 *  merely unlikely. MUST be called inside withTransaction. */
export async function findByUsernameForUpdate(
  username: string,
  client: PoolClientRequired,
): Promise<UserRow | null> {
  const { rows } = await client.query<UserRow>(
    `SELECT ${USER_COLUMNS} FROM users WHERE username_lower = LOWER($1) FOR UPDATE`,
    [username],
  );
  return rows[0] ?? null;
}

/** Same, by id — used by the purchase flow so coins can't be double-spent by
 *  two concurrent requests. */
export async function findByIdForUpdate(
  id: string,
  client: PoolClientRequired,
): Promise<UserRow | null> {
  const { rows } = await client.query<UserRow>(
    `SELECT ${USER_COLUMNS} FROM users WHERE id = $1 FOR UPDATE`,
    [id],
  );
  return rows[0] ?? null;
}

/** A client is mandatory here — these lock rows, so they only make sense
 *  inside a transaction. Typed separately to make that a compile error. */
type PoolClientRequired = NonNullable<Executor>;

export async function updatePasswordHash(
  userId: string,
  passwordHash: string,
  client?: Executor,
): Promise<void> {
  await run(client)(
    `UPDATE users SET password_hash = $2 WHERE id = $1`,
    [userId, passwordHash],
  );
}

/** Replace the recovery code hash and bump its version. Called when a code is
 *  consumed — the old one dies the moment this commits. */
export async function rotateRecoveryCode(
  userId: string,
  newHash: string,
  client?: Executor,
): Promise<number> {
  const { rows } = await run(client)<UserRow>(
    `UPDATE users
        SET recovery_code_hash = $2,
            recovery_code_version = recovery_code_version + 1
      WHERE id = $1
      RETURNING ${USER_COLUMNS}`,
    [userId, newHash],
  );
  return rows[0].recovery_code_version;
}

export interface EquipUpdate {
  beagleSkinId?: string;
  enemySkinId?: string;
  mazeThemeId?: string;
}

/** Update any subset of the three equipped slots. Ownership is validated in the
 *  service layer before this is called. */
export async function updateEquipped(
  userId: string,
  update: EquipUpdate,
  client?: Executor,
): Promise<UserRow> {
  const { rows } = await run(client)<UserRow>(
    `UPDATE users
        SET equipped_beagle_skin_id = COALESCE($2, equipped_beagle_skin_id),
            equipped_enemy_skin_id  = COALESCE($3, equipped_enemy_skin_id),
            equipped_maze_theme_id  = COALESCE($4, equipped_maze_theme_id)
      WHERE id = $1
      RETURNING ${USER_COLUMNS}`,
    [
      userId,
      update.beagleSkinId ?? null,
      update.enemySkinId ?? null,
      update.mazeThemeId ?? null,
    ],
  );
  return rows[0];
}

export type CosmeticKind = "beagle" | "enemy" | "theme";

const OWNED_COLUMN: Record<CosmeticKind, string> = {
  beagle: "owned_beagle_skin_ids",
  enemy: "owned_enemy_skin_ids",
  theme: "owned_maze_theme_ids",
};

/** Deduct coins and grant an item in ONE statement.
 *
 *  Doing both together (rather than an UPDATE for coins and another for
 *  ownership) means there is no instant where the player has paid but owns
 *  nothing — the same atomicity the client-side `trySpend` already guarantees
 *  in profileStore.ts. Still call it inside a transaction with the row locked,
 *  so the price check and the deduction see the same balance. */
export async function purchaseItem(
  userId: string,
  kind: CosmeticKind,
  itemId: string,
  price: number,
  client?: Executor,
): Promise<UserRow> {
  const column = OWNED_COLUMN[kind];
  const { rows } = await run(client)<UserRow>(
    `UPDATE users
        SET coins = coins - $3,
            ${column} = array_append(${column}, $2)
      WHERE id = $1
      RETURNING ${USER_COLUMNS}`,
    [userId, itemId, price],
  );
  return rows[0];
}

/** Hard delete. Every FK into users is ON DELETE CASCADE, so tokens, game
 *  sessions and rejection logs go with it — "delete my account" leaves nothing
 *  behind, which is what the privacy notice promises. */
export async function deleteUser(userId: string, client?: Executor): Promise<void> {
  await run(client)(`DELETE FROM users WHERE id = $1`, [userId]);
}

export interface LeaderboardEntry {
  username: string;
  highScore: number;
}

/** Top N by classic-mode high score. Challenge runs never write high_score
 *  (their modifiers make scores incomparable), so no mode filter is needed —
 *  see the leaderboard-scope note in the plan. */
export async function topScores(limit: number): Promise<LeaderboardEntry[]> {
  const { rows } = await pool.query<{ username: string; high_score: number }>(
    `SELECT username, high_score
       FROM users
      WHERE high_score > 0
      ORDER BY high_score DESC, high_score_at ASC
      LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({ username: r.username, highScore: r.high_score }));
}

/** 1-based rank for a score. Counting users strictly above is cheap and avoids
 *  a window function over the whole table. */
export async function rankForScore(score: number): Promise<number> {
  const { rows } = await pool.query<{ rank: string }>(
    `SELECT count(*) + 1 AS rank FROM users WHERE high_score > $1`,
    [score],
  );
  return Number(rows[0].rank);
}
