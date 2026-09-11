// OWNER: pwa-mobile-engineer (IDEA-052b)
//
// Turning browser notifications on, and keeping the subscription alive.
//
// FIVE THINGS HERE ARE NOT PREFERENCES, THEY ARE PLATFORM RULES:
//
//   1. `Notification.requestPermission()` MUST be called from a user gesture,
//      SYNCHRONOUSLY. A call that happens after an `await` has lost transient
//      activation and fails — so `enable()` asks FIRST and does its async work
//      afterwards, which is the opposite of the natural order.
//   2. On iOS/iPadOS, push needs 16.4+ AND the game added to the Home Screen.
//      A plain Safari tab cannot subscribe at all. That turns install.ts's
//      "Tap Share, then Add to Home Screen" hint from a nicety into a
//      prerequisite, so the UI says so rather than failing opaquely.
//   3. `userVisibleOnly: true` is mandatory everywhere, and every push must
//      actually show something or the platform eventually revokes the
//      subscription.
//   4. A subscription is DISPOSABLE. Browsers rotate them; and this project has
//      a specific hazard besides — index.html's stale-shell recovery script
//      unregisters EVERY service worker after a failed asset load, taking the
//      subscription with it. So `syncOnBoot()` re-asserts rather than assuming.
//   5. `registerSW({ immediate: true })` in main.ts throws the registration
//      away, so the registration comes from `navigator.serviceWorker.ready`.
//      Never subscribe at module scope: the worker is not active yet, and rule
//      1 forbids it anyway.

import { fetchVapidKey, subscribePush, unsubscribePush } from "../net/endpoints";
import { isStandalone, isIOSSafari } from "./install";

export type PushSupport =
  | { state: "ready" }
  /** The browser has it, but iOS requires the app be installed first. */
  | { state: "needs-install"; reason: string }
  | { state: "unsupported"; reason: string }
  | { state: "denied"; reason: string };

/** Base64url → Uint8Array, which is the only shape `applicationServerKey`
 *  accepts. Written out rather than pulled from a library: it is six lines and
 *  a dependency here would be the only one in src/ui. */
function urlBase64ToUint8Array(base64: string): ArrayBuffer {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const buffer = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  // Returns the BUFFER, not the view: `applicationServerKey` is typed as
  // BufferSource, and a Uint8Array over a generic ArrayBufferLike does not
  // satisfy it under this lib target.
  return buffer;
}

/** Can this browser, right now, subscribe? Checked before showing a toggle, so
 *  nobody is offered a switch that cannot work. */
export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return { state: "unsupported", reason: "Not in a browser." };

  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    // iOS below 16.4 lands here, and so does a desktop browser with push
    // disabled. Distinguish the iOS case, because for those players there IS
    // something they can do about it.
    if (isIOSSafari() && !isStandalone()) {
      return {
        state: "needs-install",
        reason: "On iPhone and iPad, add Beagle Chomp to your Home Screen first.",
      };
    }
    return { state: "unsupported", reason: "This browser can't do notifications." };
  }

  // iOS 16.4+ exposes PushManager in a plain tab but refuses to subscribe until
  // the app is installed. Catching it here turns an opaque failure into an
  // instruction.
  if (isIOSSafari() && !isStandalone()) {
    return {
      state: "needs-install",
      reason: "Add Beagle Chomp to your Home Screen first, then turn this on.",
    };
  }

  if (Notification.permission === "denied") {
    return {
      state: "denied",
      // There is genuinely nothing the page can do — a denied permission can
      // only be reset in browser settings, and asking again is a no-op.
      reason: "Notifications are blocked for this site in your browser settings.",
    };
  }

  return { state: "ready" };
}

/** Is this device currently subscribed? */
export async function isSubscribed(): Promise<boolean> {
  try {
    if (!("serviceWorker" in navigator)) return false;
    const reg = await navigator.serviceWorker.ready;
    return (await reg.pushManager.getSubscription()) !== null;
  } catch {
    return false;
  }
}

/**
 * Ask for permission and subscribe.
 *
 * MUST be called directly from a click handler. The permission prompt is
 * requested BEFORE any `await`, because awaiting first loses the user gesture
 * and the call silently fails on iOS and Firefox.
 */
export async function enable(): Promise<{ ok: boolean; reason?: string }> {
  const support = pushSupport();
  if (support.state !== "ready") return { ok: false, reason: support.reason };

  // FIRST, synchronously, while the gesture is still live.
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return {
      ok: false,
      reason:
        permission === "denied"
          ? "You blocked notifications. You can change that in your browser settings."
          : "Notifications weren't turned on.",
    };
  }

  try {
    const [{ key }, reg] = await Promise.all([fetchVapidKey(), navigator.serviceWorker.ready]);

    // Reuse an existing subscription rather than creating a second: subscribing
    // twice with a different key throws, and browsers keep one per registration.
    const existing = await reg.pushManager.getSubscription();
    const sub =
      existing ??
      (await reg.pushManager.subscribe({
        // Mandatory. A silent push is not allowed, and a subscription that
        // sends them gets revoked.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      }));

    await sendToServer(sub);
    return { ok: true };
  } catch (err) {
    // NEVER surface the raw browser message here. Chromium's subscribe()
    // failure is literally "Registration failed - permission denied" even when
    // permission was just GRANTED — it means the browser could not reach its
    // push service (no profile signed in, a firewall, a fresh automation
    // profile). Shown verbatim that reads as a contradiction of what the player
    // just did, and there is nothing they can do with it.
    console.warn("[push] subscribe failed:", err);
    return {
      ok: false,
      reason:
        "Your browser couldn't set notifications up. This usually means it can't " +
        "reach its notification service — try again, or check you're not offline.",
    };
  }
}

/** Stop this device receiving. Unsubscribes the browser AND tells the server,
 *  in that order, so a failure leaves the server with a dead endpoint (which it
 *  cleans up on the next send) rather than the browser receiving pushes for a
 *  subscription the server has forgotten. */
export async function disable(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    const endpoint = sub.endpoint;
    await sub.unsubscribe().catch(() => {});
    await unsubscribePush(endpoint).catch(() => {});
  } catch {
    /* nothing useful to do — the toggle re-reads state either way */
  }
}

function sendToServer(sub: PushSubscription): Promise<void> {
  const json = sub.toJSON();
  const keys = json.keys ?? {};
  return subscribePush({
    endpoint: sub.endpoint,
    keys: { p256dh: keys.p256dh ?? "", auth: keys.auth ?? "" },
  });
}

/**
 * Re-assert an existing subscription on boot.
 *
 * Does NOT ask for permission and does NOT create a subscription — it only
 * tells the server about one the browser already has. That matters because the
 * server's row can disappear without the browser knowing: an account deleted
 * and remade, a database restored from backup, or this project's own
 * stale-shell recovery unregistering the worker and the client re-subscribing
 * to a NEW endpoint while the old row lingers.
 *
 * Cheap: one POST, only when a subscription actually exists.
 */
export async function syncOnBoot(): Promise<void> {
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    if (Notification.permission !== "granted") return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    await sendToServer(sub);
  } catch {
    // Best-effort. A failed re-assert costs one missed notification at worst,
    // and the next boot tries again.
  }
}
