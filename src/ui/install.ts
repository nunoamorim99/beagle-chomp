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

function isStandalone(): boolean {
  // Installed PWAs report display-mode:standalone (Chromium/desktop) or
  // navigator.standalone (iOS Safari's older, still-live vendor flag).
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.("(display-mode: standalone)").matches === true || nav.standalone === true;
}

function isIOSSafari(): boolean {
  const ua = window.navigator.userAgent;
  const isIOS = /iphone|ipad|ipod/i.test(ua);
  // Exclude other iOS browsers that also include "Safari" in their UA
  // (Chrome/Firefox/Edge on iOS all embed WebKit but add their own token).
  const isOtherBrowser = /crios|fxios|edgios|opios/i.test(ua);
  return isIOS && !isOtherBrowser;
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

  let deferredPrompt: BeforeInstallPromptEvent | null = null;
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
    banner.button?.addEventListener("click", () => {
      const prompt = deferredPrompt;
      if (!prompt) return;
      deferredPrompt = null;
      teardown();
      void prompt.prompt();
      void prompt.userChoice.then(() => { /* no-op: banner already dismissed */ });
    });
    banner.dismiss.addEventListener("click", teardown);
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    teardown();
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
