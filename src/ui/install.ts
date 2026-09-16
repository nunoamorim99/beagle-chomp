// OWNER: pwa-mobile-engineer
// Lightweight, non-blocking "install this app" affordance.
//
// Chromium (Android/desktop): listens for `beforeinstallprompt`, stashes the
// event, and reveals a small pill button; tapping it replays the browser's
// own install prompt via the stashed event's `.prompt()`. Hides itself once
// the user has answered (either choice) or once `appinstalled` fires.
//
// iOS Safari never fires `beforeinstallprompt` (no such API there) — instead
// this shows a one-line "Add to Home Screen" hint the first time the game
// loads in Mobile Safari's regular (non-standalone) browser tab, since that
// is the only install path Apple exposes (Share -> Add to Home Screen).
//
// DOM-only UX glue: does not import three or touch src/game/* state, and
// does not touch src/ui/hud.ts's existing Hud interface/contract — this is
// an independent small overlay element the caller (main.ts) mounts once.
import "./install.css";
import { ICON, iconHtml } from "./icons";

// `beforeinstallprompt` is a non-standard Chromium event with no lib.dom.d.ts
// typings; declare only the surface we use.
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export function isStandalone(): boolean {
  // Installed PWAs report display-mode:standalone (Chromium/desktop) or
  // navigator.standalone (iOS Safari's older, still-live vendor flag).
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.("(display-mode: standalone)").matches === true || nav.standalone === true;
}

export function isIOSSafari(): boolean {
  const ua = window.navigator.userAgent;
  const isIOS = /iphone|ipad|ipod/i.test(ua);
  // Exclude other iOS browsers that also include "Safari" in their UA
  // (Chrome/Firefox/Edge on iOS all embed WebKit but add their own token).
  const isOtherBrowser = /crios|fxios|edgios|opios/i.test(ua);
  return isIOS && !isOtherBrowser;
}

// ---------------------------------------------------------------------------
// THE SHARED INSTALL STATE (IDEA-074 v2)
//
// The stashed `beforeinstallprompt` event used to live inside
// `initInstallPrompt`'s closure, which was right while the top banner was the
// only thing offering an install. The News screen now offers it too, and a
// browser hands out ONE usable event: `prompt()` may be called once, and after
// that the event is spent. So the event lives HERE, at module scope, with one
// function that consumes it — anything else means two buttons racing for one
// event and whichever loses does nothing at all, silently.
//
// It is module state rather than a parameter for the ordering reason: the
// event fires whenever the browser decides the site is installable, which is
// usually long before the player opens the News screen. Something has to be
// listening from boot, and that is `initInstallPrompt()` at main.ts's top
// level.
// ---------------------------------------------------------------------------

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const installListeners = new Set<() => void>();

function notifyInstallChange(): void {
  for (const fn of installListeners) {
    try {
      fn();
    } catch {
      /* a listener's own failure must not stop the others */
    }
  }
}

/** What, if anything, this browser can be offered right now.
 *
 *  - `installed`  — running standalone; there is nothing to offer.
 *  - `prompt`     — Chromium stashed an event and we can raise the real dialog.
 *  - `ios-steps`  — iOS Safari, which has no install API at all: the only path
 *                   is Share → Add to Home Screen, so all we can do is say so.
 *                   It is also a PREREQUISITE there — iOS refuses push until
 *                   the app is installed (push.ts rule 2).
 *  - `none`       — no install path worth mentioning (a desktop browser that
 *                   has not offered one, or one already dismissed this visit).
 */
export type InstallOffer = "installed" | "prompt" | "ios-steps" | "none";

export function installOffer(): InstallOffer {
  if (isStandalone()) return "installed";
  if (deferredPrompt) return "prompt";
  if (isIOSSafari()) return "ios-steps";
  return "none";
}

/**
 * Raise the browser's own install dialog. The stashed event is consumed
 * whatever the player answers — it cannot be replayed — so the offer drops
 * back to `none` and every listener is told. Chromium fires a fresh
 * `beforeinstallprompt` on a later visit if the site is still installable.
 */
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const prompt = deferredPrompt;
  if (!prompt) return "unavailable";
  deferredPrompt = null;
  notifyInstallChange();
  try {
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    return outcome;
  } catch {
    // Chromium throws if the event has already been used or the page lost its
    // activation. Nothing to tell the player that they cannot see for
    // themselves — the dialog either appeared or it did not.
    return "dismissed";
  }
}

/** Run `fn` whenever the offer above may have changed (an event arrived, was
 *  spent, or the app was installed). Returns an unsubscribe. */
export function onInstallChange(fn: () => void): () => void {
  installListeners.add(fn);
  return () => installListeners.delete(fn);
}

function buildBanner(message: string, buttonLabel: string | null): {
  el: HTMLDivElement;
  button: HTMLButtonElement | null;
  dismiss: HTMLButtonElement;
} {
  const el = document.createElement("div");
  el.className = "install-hint";
  el.innerHTML =
    // The app icon, so the banner reads as "this thing you're playing" rather
    // than an anonymous browser prompt. icon-192 is already in the PWA
    // precache, so it costs no extra request.
    '<img class="install-hint__icon" src="./icons/icon-192.png" alt="" ' +
    'width="40" height="40" decoding="async" />' +
    `<span class="install-hint__text">${message}</span>` +
    (buttonLabel
      ? `<button type="button" class="install-hint__action">${iconHtml(ICON.install)}${buttonLabel}</button>`
      : "") +
    `<button type="button" class="install-hint__dismiss" aria-label="Dismiss">${iconHtml(ICON.close)}</button>`;
  document.body.appendChild(el);
  // IDEA-006 v3: the banner is pinned to the TOP now, so the menu's title block
  // must move down out from under it. A body class keeps that entirely in CSS,
  // and means no gap is reserved when the banner isn't showing.
  document.body.classList.add("install-open");
  return {
    el,
    button: el.querySelector<HTMLButtonElement>(".install-hint__action"),
    dismiss: el.querySelector<HTMLButtonElement>(".install-hint__dismiss") as HTMLButtonElement,
  };
}

/**
 * Mounts the install affordance into `document.body`. Call once from
 * main.ts. Safe to call in any browser: it simply never shows anything if
 * neither the Chromium prompt event nor the iOS-Safari heuristic applies
 * (e.g. already installed, or a browser with no install path at all).
 */
export function initInstallPrompt(): void {
  if (isStandalone()) return; // already installed — never nag

  let banner: ReturnType<typeof buildBanner> | null = null;

  function teardown(): void {
    banner?.el.remove();
    banner = null;
    document.body.classList.remove("install-open");
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    teardown();
    // NOT "for offline play": since v5.0 the game needs a connection (sign-in
    // before play, server-validated scores), so promising offline play would be
    // a straight lie. What installing actually gives you is the full screen,
    // with no browser chrome — which is what the manifest's display:standalone
    // delivers.
    banner = buildBanner("Install Beagle Chomp for full-screen play", "Install");
    // The BANNER no longer owns the prompt — `promptInstall()` does, because the
    // News screen offers the same install and a browser only ever hands out one
    // usable `beforeinstallprompt` event. Two owners means one of them holds a
    // spent event and its button does nothing.
    banner.button?.addEventListener("click", () => {
      teardown();
      void promptInstall();
    });
    banner.dismiss.addEventListener("click", teardown);
    notifyInstallChange();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    teardown();
    notifyInstallChange();
  });

  // iOS Safari has no beforeinstallprompt at all; offer the manual-steps hint
  // instead, once per session (not persisted — CLAUDE.md keeps state in
  // memory, no localStorage assumptions for core state, and this is a
  // one-session nicety, not core state).
  if (isIOSSafari()) {
    banner = buildBanner("Tap Share, then “Add to Home Screen” to install", null);
    banner.dismiss.addEventListener("click", teardown);
  }
}
