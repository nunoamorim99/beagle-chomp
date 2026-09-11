// OWNER: backend
//
// Sending Web Push (IDEA-052b).
//
// WHY `web-push` AND NOT HAND-ROLLED CRYPTO. This is the one place worth
// spending a dependency against the project's deliberately minimal list, and
// the reason is the failure mode rather than the effort. Web Push needs VAPID
// (an ES256 JWT per request) plus RFC 8291 payload encryption (ephemeral P-256
// ECDH, HKDF-SHA256, AES-128-GCM, and the aes128gcm content-coding framing).
// Node 22 has every primitive, so it is possible — but a single wrong byte in
// an HKDF info string still gets a 201 Created from the push service and the
// notification simply never arrives, on some platforms only. There is no local
// test that catches that. Unlike argon2 (whose file notes a one-file swap to
// scrypt), there is no way to be sure this is right except by using code that
// is already known to be.
//
// `web-push` has no native bindings, so the bookworm-slim-vs-alpine constraint
// that shaped the argon2 choice does not apply here.
//
// EVERYTHING HERE IS BEST-EFFORT. A push that fails must never fail the thing
// that triggered it: a player's run is banked whether or not their rival's
// phone buzzes, and an announcement is published whether or not the fan-out
// completes. Every send path swallows its errors and logs.

import webpush from "web-push";
import { env } from "../env.js";
import * as subs from "../repo/pushSubscriptions.js";
import type { PushSubscriptionRow } from "../repo/pushSubscriptions.js";

let configured = false;

/** Configure VAPID once, lazily. `env.pushEnabled` is only true when all three
 *  keys are set — a half-configured deploy already refused to boot. */
function ensureConfigured(): boolean {
  if (!env.pushEnabled) return false;
  if (!configured) {
    webpush.setVapidDetails(
      env.VAPID_SUBJECT as string,
      env.VAPID_PUBLIC_KEY as string,
      env.VAPID_PRIVATE_KEY as string,
    );
    configured = true;
  }
  return true;
}

export interface PushMessage {
  title: string;
  body: string;
  /** Where clicking it should land. Relative, so it works on any origin the
   *  game is served from. */
  url?: string;
  /** Collapses notifications: a second message with the same tag REPLACES the
   *  first rather than stacking. Two "you've been overtaken" alerts in a row
   *  should be one line on the lock screen, not two. */
  tag?: string;
  /** The large image in the notification shade, relative to the app's scope.
   *  Differs by KIND so a release note and a notice are distinguishable before
   *  a word is read. The small status-bar BADGE is not set here — it is one
   *  brand mark for everything, in push-sw.js. */
  icon?: string;
}

/**
 * How many pushes are in flight at once.
 *
 * The container is capped at 384 MB and shares a VPS with Postgres. Each send
 * is an HTTPS request with its own TLS session, so an unbounded
 * `Promise.all` over every subscriber is exactly the shape that turns a
 * successful announcement into an OOM. Ten is plenty: the fan-out is measured
 * in dozens, not thousands.
 */
const CONCURRENCY = 10;

/**
 * Send one message to many subscriptions, bounded.
 *
 * Returns how many were accepted. A 404 or 410 means the subscription is
 * genuinely gone — the browser rotated it, the app was removed, or this
 * project's own stale-shell recovery unregistered the service worker — so the
 * row is deleted. Anything else is counted as a soft failure and retried on the
 * next message rather than deleting a real subscriber over a transient outage.
 */
export async function sendToAll(
  targets: readonly PushSubscriptionRow[],
  message: PushMessage,
): Promise<number> {
  if (!ensureConfigured() || targets.length === 0) return 0;

  const payload = JSON.stringify(message);
  let delivered = 0;
  let removed = 0;

  const queue = [...targets];
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (;;) {
      const target = queue.pop();
      if (!target) return;
      try {
        await webpush.sendNotification(
          {
            endpoint: target.endpoint,
            keys: { p256dh: target.p256dh, auth: target.auth },
          },
          payload,
          // userVisibleOnly is enforced by the BROWSER at subscribe time, not
          // here; TTL is how long the push service holds a message for a device
          // that is offline. A day: a notification about a run from last week
          // is noise.
          { TTL: 86_400 },
        );
        delivered++;
        void subs.markDelivered(target.endpoint).catch(() => {});
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          removed++;
          void subs.remove(target.endpoint).catch(() => {});
        } else {
          void subs.markFailed(target.endpoint).catch(() => {});
        }
      }
    }
  });

  await Promise.all(workers);

  if (removed > 0) {
    console.log(`[push] ${delivered} delivered, ${removed} dead subscription(s) removed`);
  }
  return delivered;
}

/** Tell everyone who wants announcements that a note went live. */
export async function notifyAnnouncement(title: string, kind: string): Promise<void> {
  if (!ensureConfigured()) return;
  try {
    const targets = await subs.findAllForAnnouncements();
    await sendToAll(targets, {
      title: kind === "release" ? "Beagle Chomp updated" : "Beagle Chomp",
      body: title,
      url: "/?news=1",
      icon: kind === "release" ? "icons/notify-release.png" : "icons/notify-notice.png",
      // One tag for all announcements: if two are published in a day, the
      // second replaces the first rather than stacking two lines nobody reads.
      tag: "beagle-news",
    });
  } catch (err) {
    console.error("[push] announcement fan-out failed:", err);
  }
}

export interface RankTarget {
  userId: string;
  title: string;
  body: string;
}

/**
 * Tell the players a run just overtook.
 *
 * Each gets their OWN message — the rank in it is theirs — so this cannot be
 * one broadcast. Their cooldown is stamped only for those actually reached.
 */
export async function notifyRankAlerts(targets: readonly RankTarget[]): Promise<void> {
  if (!ensureConfigured() || targets.length === 0) return;
  try {
    const rows = await subs.findForUsers(
      targets.map((t) => t.userId),
      "rank",
    );
    const byUser = new Map<string, PushSubscriptionRow[]>();
    for (const row of rows) {
      const list = byUser.get(row.user_id) ?? [];
      list.push(row);
      byUser.set(row.user_id, list);
    }

    const alerted: string[] = [];
    for (const target of targets) {
      const devices = byUser.get(target.userId);
      if (!devices || devices.length === 0) continue;
      const sent = await sendToAll(devices, {
        title: target.title,
        body: target.body,
        url: "/?board=1",
        icon: "icons/notify-rank.png",
        // Per-user tag: a later alert replaces this player's previous one, so a
        // busy evening leaves one line rather than a column of them.
        tag: `beagle-rank-${target.userId}`,
      });
      if (sent > 0) alerted.push(target.userId);
    }

    // Only stamp the cooldown for players actually reached. Someone with no
    // working device has not been "told", and shouldn't be silenced for six
    // hours because of a failed send.
    await subs.markRankAlerted(alerted);
  } catch (err) {
    console.error("[push] rank alert fan-out failed:", err);
  }
}
