// OWNER: backend
//
// push_subscriptions access (IDEA-052b). Per STACK.md §2.7, SQL lives only in
// repo/*.
//
// Closest sibling is repo/tokens.ts: a small credential-ish table keyed by
// something the client presents, owned by a user, cascading on delete.
//
// THE INVARIANT: A SUBSCRIPTION TABLE IS DISPOSABLE. Every row here can stop
// working without warning and without the player doing anything wrong — a
// browser rotates its subscription, the app is removed from the Home Screen,
// or (in this codebase specifically) index.html's stale-shell recovery script
// unregisters EVERY service worker after a failed asset load, which silently
// destroys the subscription with it. So nothing treats a missing row as an
// error, the client re-subscribes on boot rather than assuming its row survived,
// and a definite gone-response deletes rather than retries.

import { query } from "../db.js";
import type { Executor } from "./types.js";

export interface PushSubscriptionRow {
  endpoint: string;
  user_id: string;
  p256dh: string;
  auth: string;
  created_at: Date;
  last_ok_at: Date | null;
  failure_count: number;
}

const COLUMNS = `endpoint, user_id, p256dh, auth, created_at, last_ok_at, failure_count`;

export interface SaveInput {
  endpoint: string;
  userId: string;
  p256dh: string;
  auth: string;
}

/**
 * Record a subscription, or refresh one that already exists.
 *
 * UPSERT on the endpoint, which the push service guarantees unique per
 * subscription — so a browser re-subscribing (which it does on its own
 * schedule, and which this client does on every boot) updates its keys instead
 * of accumulating a second row for the same device.
 *
 * The user_id is overwritten too, deliberately: a shared machine where a second
 * player signs in produces the SAME endpoint, and the subscription must follow
 * whoever is actually signed in. Leaving it would send one player's alerts to
 * another's browser.
 */
export async function save(input: SaveInput, client?: Executor): Promise<void> {
  const sql = `
    INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (endpoint) DO UPDATE
      SET user_id = EXCLUDED.user_id,
          p256dh  = EXCLUDED.p256dh,
          auth    = EXCLUDED.auth,
          failure_count = 0`;
  const params = [input.endpoint, input.userId, input.p256dh, input.auth];
  if (client) await client.query(sql, params);
  else await query(sql, params);
}

/** Every device belonging to these users that WANTS this kind of message.
 *
 *  The preference is joined here rather than filtered by a caller, so there is
 *  no path that fans out to someone who turned the kind off. */
export async function findForUsers(
  userIds: readonly string[],
  kind: "announcements" | "rank",
): Promise<PushSubscriptionRow[]> {
  if (userIds.length === 0) return [];
  const column = kind === "announcements" ? "notify_announcements" : "notify_rank";
  const { rows } = await query<PushSubscriptionRow>(
    `SELECT ${COLUMNS.split(", ").map((c) => `s.${c}`).join(", ")}
       FROM push_subscriptions s
       JOIN users u ON u.id = s.user_id
      WHERE s.user_id = ANY($1::uuid[])
        AND u.${column}`,
    [userIds],
  );
  return rows;
}

/** Everyone who wants announcements. Used when a note is published. */
export async function findAllForAnnouncements(): Promise<PushSubscriptionRow[]> {
  const { rows } = await query<PushSubscriptionRow>(
    `SELECT ${COLUMNS.split(", ").map((c) => `s.${c}`).join(", ")}
       FROM push_subscriptions s
       JOIN users u ON u.id = s.user_id
      WHERE u.notify_announcements`,
  );
  return rows;
}

/** The push service said this subscription is gone (404/410). Not an error —
 *  the expected end of a subscription's life. */
export async function remove(endpoint: string): Promise<void> {
  await query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [endpoint]);
}

/** Scoped by user so one player cannot unsubscribe another's device by posting
 *  a guessed endpoint. */
export async function removeForUser(endpoint: string, userId: string): Promise<void> {
  await query(`DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2`, [
    endpoint,
    userId,
  ]);
}

export async function markDelivered(endpoint: string): Promise<void> {
  await query(
    `UPDATE push_subscriptions SET last_ok_at = now(), failure_count = 0 WHERE endpoint = $1`,
    [endpoint],
  );
}

/** A SOFT failure — a timeout, a 500 from the push service. Counted rather than
 *  acted on, because a transient outage must not delete real subscriptions. */
export async function markFailed(endpoint: string): Promise<void> {
  await query(
    `UPDATE push_subscriptions SET failure_count = failure_count + 1 WHERE endpoint = $1`,
    [endpoint],
  );
}

/** Stamp the cooldown after telling someone their score was beaten. */
export async function markRankAlerted(userIds: readonly string[]): Promise<void> {
  if (userIds.length === 0) return;
  await query(`UPDATE users SET last_rank_alert_at = now() WHERE id = ANY($1::uuid[])`, [userIds]);
}
