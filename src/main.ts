// App entry. Registers the PWA service worker (via vite-plugin-pwa), signs the
// player in, then boots the game.
//
// IDEA-019 made the boot flow load-bearing rather than incidental. Two rules
// are enforced structurally here rather than by checks scattered through the
// game:
//
//   1. SIGN-IN BEFORE PLAY. `new Game()` is not constructed until a player is
//      authenticated. There is no guest mode to fall back to, so there is no
//      code path that can accidentally start a run without an account.
//
//   2. THE PROFILE CACHE IS HYDRATED FIRST. game.ts's constructor calls
//      initProfileFromCache() as its very first statement, because
//      createMenuScene() bakes the showcase beagle from the equipped skin at
//      construction time. Getting this order wrong is exactly the IDEA-021 v3
//      bug (the menu showed the default dog after equipping another skin), so
//      getProfileCache() now THROWS rather than returning defaults.
//
// The install prompt UX is owned by pwa-mobile-engineer.

import "./style.css";
import { registerSW } from "virtual:pwa-register";
import { Game } from "./game/game";
import { initInstallPrompt } from "./ui/install";
import { attachBootScreen } from "./ui/boot";
import { attachAuthGate } from "./ui/auth";
import { attachRecoveryCode } from "./ui/recoveryCode";
import { attachPrivacy } from "./ui/privacy";
import { attachProfile } from "./ui/profile";
import { attachLeaderboard } from "./ui/leaderboard";
import { me } from "./net/endpoints";
import {
  getToken,
  clearToken,
  ApiError,
  setUnauthorizedHandler,
  assertApiConfigured,
} from "./net/api";
import { setProfileCache, clearProfileCache } from "./game/profileCache";
import { fromServerProfile } from "./game/profileMapping";

registerSW({ immediate: true });
initInstallPrompt();

const boot = attachBootScreen();
const recoveryCode = attachRecoveryCode();
const privacy = attachPrivacy();
const authGate = attachAuthGate({
  onRecoveryCode: (code, context) => recoveryCode.open(code, context),
  onShowPrivacy: () => privacy.open(),
});

/** Try to restore a stored session.
 *
 *  Three outcomes, and the distinction matters:
 *    - restored      → a valid token; play on.
 *    - needs-signin  → the server rejected the token (revoked, expired, or the
 *                      account was deleted elsewhere). Clear it and sign in.
 *    - offline       → we never got an answer. Do NOT clear the token: a
 *                      transient outage must not strand someone who would
 *                      otherwise still be signed in. */
type RestoreOutcome = "restored" | "needs-signin" | "offline";

/** The signed-in player's display name. Needed by the profile screen (and its
 *  delete-account confirmation), so it's captured wherever a session begins —
 *  restored at boot, or returned by the auth gate. */
let currentUsername = "";

/** Scopes every listener wired for the CURRENT session, so signing out and
 *  signing back in doesn't stack duplicates. */
let sessionListeners: AbortController | null = null;

async function restoreSession(): Promise<RestoreOutcome> {
  const token = getToken();
  if (!token) return "needs-signin";

  try {
    const { user, profile } = await me();
    setProfileCache(fromServerProfile(profile));
    currentUsername = user.username;
    return "restored";
  } catch (err) {
    if (err instanceof ApiError && err.isNetworkError) return "offline";
    clearToken();
    return "needs-signin";
  }
}

async function startApp(): Promise<void> {
  try {
    assertApiConfigured();
  } catch (err) {
    boot.showFatal(err instanceof Error ? err.message : String(err));
    return;
  }

  boot.showLoading("Waking the beagle…");

  // Retry loop: an offline boot parks here until the connection returns, rather
  // than dumping the player into a broken menu.
  let outcome = await restoreSession();
  while (outcome === "offline") {
    await boot.showOffline("We couldn't reach the game's server.");
    boot.showLoading("Trying again…");
    outcome = await restoreSession();
  }

  if (outcome === "needs-signin") {
    boot.hide();
    // Resolves only once the player is authenticated AND — for a new account or
    // a consumed recovery code — has confirmed they saved their recovery code.
    currentUsername = await authGate.open();
  }

  boot.hide();

  // Only now is it safe to construct the game: the profile cache is hydrated,
  // so initProfileFromCache() in the Game constructor has something to read.
  const canvas = document.getElementById("scene") as HTMLCanvasElement;
  const game = new Game(canvas);
  game.start();

  // The account screen is wired HERE rather than in game.ts, deliberately: the
  // game layer knows nothing about accounts, and keeping it that way means all
  // of IDEA-019 stays out of the game loop.
  const profile = attachProfile({
    onSignedOut: () => {
      game.stop();
      clearProfileCache();
      void startApp();
    },
    onShowPrivacy: () => privacy.open(() => profile.open(currentUsername)),
  });

  // startApp() re-runs on sign-out and on a mid-session 401, so this listener
  // would stack a duplicate each time. AbortController gives us one handle that
  // removes it regardless of how the session ends.
  sessionListeners?.abort();
  sessionListeners = new AbortController();

  document.getElementById("menuProfileBtn")?.addEventListener(
    "click",
    () => profile.open(currentUsername),
    { signal: sessionListeners.signal },
  );

  // IDEA-020: classic-mode scoreboard, opened from the menu.
  const leaderboard = attachLeaderboard();
  document.getElementById("menuLeaderboardBtn")?.addEventListener(
    "click",
    () => leaderboard.open(),
    { signal: sessionListeners.signal },
  );

  // If the server ever rejects our token mid-session (deleted on another
  // device, revoked by a password reset), drop everything and go back to the
  // gate rather than leaving a game running against a dead session.
  setUnauthorizedHandler(() => {
    game.stop();
    profile.detach();
    leaderboard.detach();
    clearProfileCache();
    void startApp();
  });
}

void startApp();

// Mobile URL-bar show/hide (and, on some browsers, pinch/orientation) change
// window.innerHeight without firing a plain 'resize' — visualViewport is the
// event that actually fires there. src/render/scene.ts already owns the
// camera-fit math and listens for window 'resize'; re-dispatch that same
// event instead of duplicating the fit logic here (least coupling — scene.ts
// stays the single place that recomputes the camera framing).
function triggerResize(): void {
  window.dispatchEvent(new Event("resize"));
}
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", triggerResize);
  window.visualViewport.addEventListener("scroll", triggerResize);
}
// Fires before layout has settled on some mobile browsers; a microtask-delayed
// follow-up re-fit catches the final post-rotation dimensions.
window.addEventListener("orientationchange", () => {
  triggerResize();
  setTimeout(triggerResize, 120);
});
