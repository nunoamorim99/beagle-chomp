// OWNER: backend
//
// announcements access (IDEA-052). Per STACK.md §2.7, SQL lives only in repo/*.
//
// The invariant this module protects: A DRAFT IS INVISIBLE TO PLAYERS.
// `published_at IS NULL` is the only thing standing between a half-written note
// and every player's News screen, so the player-facing reads below filter on it
// in SQL rather than trusting a caller to pass the right flag. The admin reads
// are separate functions with different names for the same reason — there is no
// `includeDrafts` boolean anyone can get backwards.

import { query } from "../db.js";
import type { Executor } from "./types.js";

export type AnnouncementKind = "release" | "notice";

export interface AnnouncementRow {
  id: string;
  kind: AnnouncementKind;
  version: string | null;
  title: string;
  body: string;
  published_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = `id, kind, version, title, body, published_at, created_at, updated_at`;

// --- player-facing ----------------------------------------------------------

/** Published notes, newest first. Drafts cannot appear here. */
export async function listPublished(limit: number): Promise<AnnouncementRow[]> {
  const { rows } = await query<AnnouncementRow>(
    `SELECT ${COLUMNS} FROM announcements
      WHERE published_at IS NOT NULL
      ORDER BY published_at DESC
      LIMIT $1`,
    [limit],
  );
  return rows;
}

/**
 * How many published notes are newer than the player's last visit.
 *
 * A NULL `seenAt` means they have never opened the screen, and that counts
 * EVERYTHING as unread rather than nothing — see the migration for why.
 */
export async function countUnread(seenAt: Date | null): Promise<number> {
  const { rows } = await query<{ count: string }>(
    `SELECT count(*) AS count FROM announcements
      WHERE published_at IS NOT NULL
        AND ($1::timestamptz IS NULL OR published_at > $1)`,
    [seenAt],
  );
  // Postgres returns count() as bigint, which node-postgres hands back as a
  // STRING to avoid narrowing arbitrary precision. Number() or it concatenates.
  return Number(rows[0].count);
}

/** Mark everything currently published as seen. Stamped with the SERVER's
 *  clock, never a client-supplied time — a client that could set this forward
 *  would silently suppress notes it had not shown anyone. */
export async function markSeen(userId: string, client?: Executor): Promise<void> {
  const sql = `UPDATE users SET announcements_seen_at = now() WHERE id = $1`;
  if (client) await client.query(sql, [userId]);
  else await query(sql, [userId]);
}

// --- operator-facing --------------------------------------------------------

/** Everything, drafts included. Only ever reachable behind requireAdmin. */
export async function listAll(limit: number): Promise<AnnouncementRow[]> {
  const { rows } = await query<AnnouncementRow>(
    `SELECT ${COLUMNS} FROM announcements
      ORDER BY COALESCE(published_at, created_at) DESC
      LIMIT $1`,
    [limit],
  );
  return rows;
}

export async function findById(id: string): Promise<AnnouncementRow | null> {
  const { rows } = await query<AnnouncementRow>(
    `SELECT ${COLUMNS} FROM announcements WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export interface CreateInput {
  kind: AnnouncementKind;
  version: string | null;
  title: string;
  body: string;
}

/** Always created as a DRAFT. Publishing is a separate, deliberate act — there
 *  is no "create and publish" in one call, because the composer's Save should
 *  never be one mis-click away from every player's screen. */
export async function create(input: CreateInput): Promise<AnnouncementRow> {
  const { rows } = await query<AnnouncementRow>(
    `INSERT INTO announcements (kind, version, title, body)
     VALUES ($1, $2, $3, $4)
     RETURNING ${COLUMNS}`,
    [input.kind, input.version, input.title, input.body],
  );
  return rows[0];
}

export interface UpdateInput {
  kind?: AnnouncementKind;
  version?: string | null;
  title?: string;
  body?: string;
}

/** Edit in place. COALESCE so an omitted field keeps its value — the composer
 *  can PATCH one field without resending the body. */
export async function update(id: string, input: UpdateInput): Promise<AnnouncementRow | null> {
  const { rows } = await query<AnnouncementRow>(
    `UPDATE announcements
        SET kind    = COALESCE($2, kind),
            version = CASE WHEN $3::boolean THEN $4 ELSE version END,
            title   = COALESCE($5, title),
            body    = COALESCE($6, body),
            updated_at = now()
      WHERE id = $1
      RETURNING ${COLUMNS}`,
    [
      id,
      input.kind ?? null,
      // `version` is nullable, so COALESCE cannot distinguish "clear it" from
      // "leave it alone" — a caller sending null means CLEAR. This flag carries
      // that distinction explicitly instead of losing it.
      Object.prototype.hasOwnProperty.call(input, "version"),
      input.version ?? null,
      input.title ?? null,
      input.body ?? null,
    ],
  );
  return rows[0] ?? null;
}

/** Publish, or un-publish (pull a note back to draft). Idempotent: publishing
 *  an already-published note leaves its original published_at alone, so pulling
 *  it back and re-publishing does not silently re-notify everyone as new. */
export async function setPublished(id: string, published: boolean): Promise<AnnouncementRow | null> {
  const { rows } = await query<AnnouncementRow>(
    `UPDATE announcements
        SET published_at = CASE
              WHEN $2 AND published_at IS NULL THEN now()
              WHEN $2 THEN published_at
              ELSE NULL
            END,
            updated_at = now()
      WHERE id = $1
      RETURNING ${COLUMNS}`,
    [id, published],
  );
  return rows[0] ?? null;
}

export async function remove(id: string): Promise<boolean> {
  const res = await query(`DELETE FROM announcements WHERE id = $1`, [id]);
  return (res.rowCount ?? 0) > 0;
}
