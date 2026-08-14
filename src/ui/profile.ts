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
import { getProfileCache } from "../game/profileCache";
import { logout as logoutRemote, deleteAccount } from "../net/endpoints";
import { clearToken, ApiError } from "../net/api";
import { flushSync, clearSyncQueue } from "../net/profileSync";

export interface ProfileHandle {
  open: (username: string) => void;
  close: () => void;
  detach: () => void;
  isOpen: () => boolean;
}

export interface ProfileCallbacks {
  /** Sign-out and deletion both end the session, so the app must return to the
   *  auth gate. The caller owns that transition. */
  onSignedOut: () => void;
  onShowPrivacy: () => void;
  onClose?: () => void;
}

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
          <div><dt>Coins</dt><dd>🪙 ${profile.coins}</dd></div>
          <div><dt>Unlocked</dt><dd>${owned} items</dd></div>
          <div><dt>Challenge</dt><dd>${profile.challengeProgress} / 8 unlocked</dd></div>
        </dl>

        ${error ? `<p class="auth-error" role="alert">${escapeHtml(error)}</p>` : ""}

        <div class="profile-actions">
          <button type="button" id="profilePrivacyBtn" class="btn-secondary">Privacy notice</button>
          <button type="button" id="profileSignOutBtn" class="btn-secondary">Sign out</button>
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
                Delete my account permanently
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
