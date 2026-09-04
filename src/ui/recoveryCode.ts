// OWNER: gameplay-engineer (IDEA-019 accounts)
//
// The blocking recovery-code screen.
//
// This is the most consequential screen in the game, and the only one whose
// requirements are non-negotiable. There is no email on file by design, so this
// code is the ONLY way back into an account. If the player dismisses this
// screen without saving it and later forgets their password, the account —
// coins, skins, themes, high score — is gone permanently, and nobody can
// restore it.
//
// Hence:
//   - No backdrop click to dismiss. No Escape key. No auto-timeout.
//   - Two deliberate actions required: tick a checkbox, then press a button.
//   - Copy that states the consequence plainly rather than reassuring.
//
// Shown twice in the product: after signup, and again after every recovery
// (consuming a code issues a new one, which must be presented with the same
// prominence — otherwise a player who recovers once quietly loses their safety
// net).
//
// Follows the attachX(root, callbacks) => handle pattern established by
// ui/shop.ts and ui/levelMap.ts. Zero `three` imports; pure DOM.

import { escapeHtml } from "./escape";
import { ICON, iconHtml } from "./icons";

export interface RecoveryCodeHandle {
  /** Show the screen. Resolves only when the player explicitly confirms. */
  open: (code: string, context: "signup" | "recovery") => Promise<void>;
  detach: () => void;
  isOpen: () => boolean;
}

function require<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id) as T | null;
  if (!el) {
    throw new Error(`attachRecoveryCode: missing element #${id} — check index.html`);
  }
  return el;
}

export function attachRecoveryCode(): RecoveryCodeHandle {
  const root = require<HTMLDivElement>("recoveryCode");
  let isOpenState = false;
  let resolveOpen: (() => void) | null = null;

  /** Swallow Escape while open. Capture phase so it never reaches anything
   *  else that might close a panel on Escape (the editor's inspector does, and
   *  future screens might). This is the keyboard half of "cannot be
   *  dismissed"; the absence of a backdrop handler is the pointer half. */
  function onKeyDown(event: KeyboardEvent): void {
    if (!isOpenState) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
    }
  }
  document.addEventListener("keydown", onKeyDown, true);

  function render(code: string, context: "signup" | "recovery"): void {
    const heading =
      context === "signup" ? "Save your recovery code" : "Here's your new recovery code";

    const intro =
      context === "signup"
        ? "Your account is created. Before you play, save this code somewhere safe."
        : "You just used your old code, so it no longer works. This is its replacement — save it now.";

    root.innerHTML = `
      <div class="recovery-sheet" role="dialog" aria-modal="true" aria-labelledby="recoveryHeading">
        <h1 id="recoveryHeading">${iconHtml(ICON.key)}${heading}</h1>
        <p class="recovery-intro">${intro}</p>

        <div class="recovery-code-box">
          <code id="recoveryCodeValue">${escapeHtml(code)}</code>
          <button type="button" id="recoveryCopyBtn" class="recovery-copy">${iconHtml(ICON.copy)}Copy</button>
        </div>

        <div class="recovery-warning">
          <p><strong>This is the only way back into your account.</strong></p>
          <ul>
            <li>We don't collect your email, so <strong>there is no password-reset email</strong>.</li>
            <li>Use it to reset a forgotten password, or to sign in on another device.</li>
            <li>It works <strong>once</strong> — after that you'll get a new one to save.</li>
            <li>If you lose this code <em>and</em> your password, the account is gone for
                good. Your coins, skins and high score go with it. Nobody can restore it.</li>
          </ul>
          <p class="recovery-action">Screenshot this screen, or write the code down, before continuing.</p>
        </div>

        <label class="recovery-confirm">
          <input type="checkbox" id="recoverySavedCheck" />
          <span>I've saved my recovery code somewhere safe</span>
        </label>

        <button type="button" id="recoveryContinueBtn" class="btn-primary" disabled>
          I've saved it — continue
        </button>
      </div>
    `;

    const check = root.querySelector<HTMLInputElement>("#recoverySavedCheck")!;
    const continueBtn = root.querySelector<HTMLButtonElement>("#recoveryContinueBtn")!;
    const copyBtn = root.querySelector<HTMLButtonElement>("#recoveryCopyBtn")!;

    // Two deliberate actions, not one. A single button is too easy to click
    // past on autopilot, and the cost of doing so here is unrecoverable.
    check.addEventListener("change", () => {
      continueBtn.disabled = !check.checked;
    });

    copyBtn.addEventListener("click", () => {
      void navigator.clipboard
        ?.writeText(code)
        .then(() => {
          copyBtn.innerHTML = `${iconHtml(ICON.check)}Copied`;
          setTimeout(() => {
            copyBtn.innerHTML = `${iconHtml(ICON.copy)}Copy`;
          }, 2000);
        })
        .catch(() => {
          // Clipboard can be blocked (permissions, insecure context). The code
          // is on screen and selectable, so this is a convenience, not a
          // dependency — say so rather than failing silently.
          copyBtn.textContent = "Select it manually";
          setTimeout(() => {
            copyBtn.innerHTML = `${iconHtml(ICON.copy)}Copy`;
          }, 2500);
        });
    });

    continueBtn.addEventListener("click", () => {
      if (!check.checked) return;
      close();
    });
  }

  function close(): void {
    isOpenState = false;
    root.classList.add("hidden");
    document.body.classList.remove("recovery-open");
    root.innerHTML = "";

    const resolve = resolveOpen;
    resolveOpen = null;
    resolve?.();
  }

  return {
    open(code: string, context: "signup" | "recovery"): Promise<void> {
      isOpenState = true;
      render(code, context);
      root.classList.remove("hidden");
      document.body.classList.add("recovery-open");

      // The promise is the mechanism that makes this blocking in the control
      // flow, not just visually: the caller awaits it, so nothing proceeds
      // until the player confirms.
      return new Promise<void>((resolve) => {
        resolveOpen = resolve;
      });
    },

    detach(): void {
      document.removeEventListener("keydown", onKeyDown, true);
      root.innerHTML = "";
      root.classList.add("hidden");
      document.body.classList.remove("recovery-open");
    },

    isOpen: () => isOpenState,
  };
}
