// OWNER: gameplay-engineer (IDEA-019 accounts)
//
// The profile screen: who you're signed in as, your stats, sign out, and the
// account deletion the privacy notice promises.
//
// Deletion is deliberately awkward. It is irreversible and takes coins, skins,
// themes and leaderboard place with it, so it needs a two-step reveal and a
// typed username — the same shape the server demands (confirmUsername must
// match, or it returns CONFIRMATION_MISMATCH).
//
// Follows the attachX(root, callbacks) => handle pattern; no `three` imports.

import { escapeHtml } from "./escape";
import { ICON, iconHtml, plateHtml } from "./icons";
import { getProfileCache, mutateProfileCache } from "../game/profileCache";
import { pushSupport, isSubscribed, enable, disable } from "./push";
import { getControlScheme, type ControlScheme } from "../game/profileStore";
// The ladder length, never a literal: IDEA-063 took it from 8 to 40 and this
// line was the one place still saying "/ 8" — a stat that reads as a bug the
// moment a player clears their ninth stone.
import { CHALLENGE_LEVEL_COUNT } from "../game/challenges";
import { logout as logoutRemote, deleteAccount, setNotifyPrefsRemote } from "../net/endpoints";
import { clearToken, ApiError } from "../net/api";
import { flushSync, clearSyncQueue } from "../net/profileSync";

export interface ProfileHandle {
  open: (username: string) => void;
  close: () => void;
  detach: () => void;
  isOpen: () => boolean;
}

export interface ProfileCallbacks {
  /** IDEA-038: switch between swipe and the on-screen D-pad. Routed through
   *  Game so the pad appears/disappears immediately rather than at the next
   *  run — the preference itself is persisted against the account. */
  onControlSchemeChange?: (scheme: ControlScheme) => void;
  /** Opens the how-to-play carousel. Wired in main.ts, like the rest of the
   *  account screen's callbacks. */
  onShowTutorial?: () => void;
  /** Sign-out and deletion both end the session, so the app must return to the
   *  auth gate. The caller owns that transition. */
  onSignedOut: () => void;
  onShowPrivacy: () => void;
  onClose?: () => void;
}

/** The three touch schemes, as one table rather than three near-identical
 *  blocks of markup and three near-identical listeners — which is what this was
 *  at two, and adding the third to it would have meant editing four places.
 *
 *  Each carries a NOTE, because the difference between these is a feeling and
 *  not a name: "Buttons" and "Stick" both mean "something on screen", and the
 *  one line under the row is where a player finds out which one is worth
 *  switching to. Only the chosen option's note is shown — three at once is a
 *  paragraph nobody reads on a settings screen. */
const CONTROL_OPTIONS: ReadonlyArray<{
  id: string;
  scheme: ControlScheme;
  glyph: string;
  label: string;
  note: string;
}> = [
  {
    id: "controlSwipe",
    scheme: "swipe",
    glyph: ICON.swipe,
    label: "Swipe",
    note: "Flick anywhere on the screen. Nothing covers the maze.",
  },
  {
    id: "controlDpad",
    scheme: "dpad",
    glyph: ICON.dpad,
    label: "Buttons",
    note: "Four keys under the maze. Tap the way you want to go.",
  },
  {
    id: "controlStick",
    scheme: "stick",
    glyph: ICON.stick,
    label: "Stick",
    note: "Rest your thumb on it and roll. The fastest way to turn — you never lift.",
  },
];

function require<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id) as T | null;
  if (!el) throw new Error(`attachProfile: missing element #${id} — check index.html`);
  return el;
}

export function attachProfile(callbacks: ProfileCallbacks): ProfileHandle {
  const root = require<HTMLDivElement>("profile");

  let isOpenState = false;
  let username = "";
  let confirmingDelete = false;
  let busy = false;
  let error = "";

  function render(): void {
    const profile = getProfileCache();
    const scheme = getControlScheme();
    const owned =
      profile.ownedBeagleSkinIds.length +
      profile.ownedEnemySkinIds.length +
      profile.ownedMazeThemeIds.length;

    root.innerHTML = `
      <div class="profile-sheet">
        <header class="profile-header">
          <h1>${escapeHtml(username)}</h1>
          <button type="button" id="profileCloseBtn" class="btn-link">Close</button>
        </header>

        <dl class="profile-stats">
          <div><dt>Coins</dt><dd>${plateHtml("coin", "inline")}${profile.coins}</dd></div>
          <div><dt>Unlocked</dt><dd>${owned} items</dd></div>
          <div><dt>Challenge</dt><dd>${profile.challengeProgress} / ${CHALLENGE_LEVEL_COUNT} unlocked</dd></div>
        </dl>

        ${error ? `<p class="auth-error" role="alert">${iconHtml(ICON.error)}${escapeHtml(error)}</p>` : ""}

        <section class="profile-setting">
          <h2>Controls</h2>
          <p>How you steer the beagle on a touchscreen.</p>
          <div class="control-choice" role="group" aria-label="Control scheme">
            ${CONTROL_OPTIONS.map(
              (opt) => `
              <button type="button" id="${opt.id}"
                      class="control-option${scheme === opt.scheme ? " is-active" : ""}"
                      aria-pressed="${scheme === opt.scheme}">
                <span class="control-icon bc-i" aria-hidden="true">${opt.glyph}</span>
                <span>${opt.label}</span>
              </button>`,
            ).join("")}
          </div>
          <p class="control-note">${escapeHtml(
            CONTROL_OPTIONS.find((o) => o.scheme === scheme)?.note ?? "",
          )}</p>
        </section>

        <section class="profile-setting" id="notifySection">
          <h2>Notifications</h2>
          <p>
            Get told when the game updates, or when someone beats your score.
          </p>
          <div id="notifyBody">
            <p class="control-note">Checking…</p>
          </div>
        </section>

        <section class="profile-setting">
          <h2>How to play</h2>
          <p>A quick refresher on biscuits, bones and staying alive.</p>
          <button type="button" id="replayTutorialBtn" class="btn-secondary">
            View tutorial
          </button>
        </section>

        <div class="profile-actions">
          <button type="button" id="profilePrivacyBtn" class="btn-secondary">Privacy notice</button>
          <button type="button" id="profileSignOutBtn" class="btn-secondary">${iconHtml(ICON.logout)}Sign out</button>
        </div>

        <section class="profile-danger">
          ${
            confirmingDelete
              ? `
            <h2>Delete your account?</h2>
            <p>
              This removes your account and everything in it — coins, skins,
              themes, high score, leaderboard place. <strong>It cannot be
              undone</strong>, and we can't restore it for you.
            </p>
            <label for="deleteConfirmInput">Type <code>${escapeHtml(username)}</code> to confirm</label>
            <input id="deleteConfirmInput" type="text" autocapitalize="none"
                   autocorrect="off" spellcheck="false" />
            <div class="profile-danger-actions">
              <button type="button" id="deleteCancelBtn" class="btn-secondary">Cancel</button>
              <button type="button" id="deleteConfirmBtn" class="btn-danger">
                ${iconHtml(ICON.delete)}Delete my account permanently
              </button>
            </div>
          `
              : `
            <button type="button" id="deleteRevealBtn" class="btn-link danger">
              Delete my account
            </button>
          `
          }
        </section>
      </div>
    `;

    wire();
  }

  function wire(): void {
    root.querySelector("#profileCloseBtn")?.addEventListener("click", () => close());
    root.querySelector("#profilePrivacyBtn")?.addEventListener("click", () => {
      callbacks.onShowPrivacy();
    });

    for (const opt of CONTROL_OPTIONS) {
      root.querySelector(`#${opt.id}`)?.addEventListener("click", () => {
        callbacks.onControlSchemeChange?.(opt.scheme);
        render();
      });
    }

    // Painted after the synchronous render, since it has to consult the service
    // worker — see paintNotifications.
    void paintNotifications();

    root.querySelector("#replayTutorialBtn")?.addEventListener("click", () => {
      // Opens the carousel there and then. The older version only set
      // tutorial_done back to false and promised tips "next game" — a delayed,
      // invisible effect for someone who wanted to check a rule now.
      close();
      callbacks.onShowTutorial?.();
    });

    root.querySelector("#profileSignOutBtn")?.addEventListener("click", () => {
      void signOut();
    });

    root.querySelector("#deleteRevealBtn")?.addEventListener("click", () => {
      confirmingDelete = true;
      error = "";
      render();
    });

    root.querySelector("#deleteCancelBtn")?.addEventListener("click", () => {
      confirmingDelete = false;
      error = "";
      render();
    });

    root.querySelector("#deleteConfirmBtn")?.addEventListener("click", () => {
      const typed = root.querySelector<HTMLInputElement>("#deleteConfirmInput")?.value ?? "";
      void confirmDelete(typed);
    });
  }

  async function signOut(): Promise<void> {
    if (busy) return;
    busy = true;

    // Let any queued profile writes land before the token dies, or a purchase
    // made seconds ago would be lost.
    await flushSync(3_000);

    try {
      await logoutRemote();
    } catch {
      // A failed logout only means the server-side row survives until it
      // expires. Locally we're signed out regardless, which is what the player
      // asked for — never block on this.
    }

    clearSyncQueue();
    clearToken();
    busy = false;
    close();
    callbacks.onSignedOut();
  }

  async function confirmDelete(typed: string): Promise<void> {
    if (busy) return;

    if (typed.trim().toLowerCase() !== username.toLowerCase()) {
      error = "That doesn't match your username.";
      render();
      return;
    }

    busy = true;
    error = "";
    try {
      // Drop pending writes rather than flushing: they'd race the delete and
      // fail against an account that no longer exists.
      clearSyncQueue();
      await deleteAccount(typed.trim());
      clearToken();
      busy = false;
      close();
      callbacks.onSignedOut();
    } catch (err) {
      busy = false;
      error =
        err instanceof ApiError ? err.message : "Couldn't delete the account. Try again.";
      render();
    }
  }

  function close(): void {
    isOpenState = false;
    confirmingDelete = false;
    error = "";
    root.classList.add("hidden");
    document.body.classList.remove("profile-open");
    root.innerHTML = "";
    callbacks.onClose?.();
  }

  /**
   * The notifications section.
   *
   * Painted ASYNCHRONOUSLY, after the rest of the screen, because deciding what
   * to show needs `navigator.serviceWorker.ready` and a look at the current
   * subscription. Blocking the whole account screen on the service worker would
   * be a visible stall for a section most players will never open.
   *
   * TWO SWITCHES, and they are not the same thing:
   *   - the DEVICE switch (browser permission + a push subscription) lives in
   *     the browser and has to be turned on per device;
   *   - the KIND switches live on the account and follow the player everywhere.
   * The kind switches only appear once the device is on, because offering
   * settings that cannot do anything yet is worse than offering none.
   */
  async function paintNotifications(): Promise<void> {
    const host = root.querySelector("#notifyBody");
    if (!host) return;

    const support = pushSupport();
    if (support.state !== "ready") {
      // Say WHY, and on iOS what to do about it. An inert toggle with no
      // explanation is worse than no toggle at all.
      host.innerHTML = `<p class="control-note">${escapeHtml(support.reason)}</p>`;
      return;
    }

    const on = await isSubscribed();
    const profile = getProfileCache();

    host.innerHTML = `
      <button type="button" id="notifyToggleBtn" class="btn-secondary">
        ${on ? "Turn off on this device" : "Turn on for this device"}
      </button>
      <p class="control-note" id="notifyNote">${
        on ? "This device will get notifications." : "Notifications are off on this device."
      }</p>
      ${
        on
          ? `<div class="notify-kinds">
               <label class="notify-kind">
                 <input type="checkbox" id="notifyUpdates" ${
                   profile.notifyAnnouncements ? "checked" : ""
                 } />
                 <span>Game updates and notices</span>
               </label>
               <label class="notify-kind">
                 <input type="checkbox" id="notifyRank" ${profile.notifyRank ? "checked" : ""} />
                 <span>When someone beats your score</span>
               </label>
             </div>`
          : ""
      }`;

    // enable() asks for permission SYNCHRONOUSLY before it awaits anything, so
    // it must be called straight from the gesture — nothing awaited here first.
    host.querySelector("#notifyToggleBtn")?.addEventListener("click", () => {
      if (on) {
        void disable().then(() => paintNotifications());
        return;
      }
      void enable().then((res) => {
        if (!res.ok && res.reason) {
          const note = host.querySelector("#notifyNote");
          if (note) note.textContent = res.reason;
          return undefined;
        }
        return paintNotifications();
      });
    });

    const kind = (id: string, key: "notifyAnnouncements" | "notifyRank"): void => {
      host.querySelector("#" + id)?.addEventListener("change", (e) => {
        const value = (e.target as HTMLInputElement).checked;
        // Optimistic locally, authoritative on the server — the same shape the
        // control scheme and tutorial flags already use.
        mutateProfileCache((p) => ({ ...p, [key]: value }));
        void setNotifyPrefsRemote({ [key]: value }).catch(() => {
          mutateProfileCache((p) => ({ ...p, [key]: !value }));
          void paintNotifications();
        });
      });
    };
    kind("notifyUpdates", "notifyAnnouncements");
    kind("notifyRank", "notifyRank");
  }

  return {
    open(name: string): void {
      username = name;
      isOpenState = true;
      confirmingDelete = false;
      error = "";
      render();
      root.classList.remove("hidden");
      document.body.classList.add("profile-open");
    },
    close,
    detach(): void {
      root.innerHTML = "";
      root.classList.add("hidden");
      document.body.classList.remove("profile-open");
    },
    isOpen: () => isOpenState,
  };
}
