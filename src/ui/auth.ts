// OWNER: gameplay-engineer (IDEA-019 accounts)
//
// The auth gate: the app's front door. Sign-in is required before play — no
// guest mode — so this screen has no back-out. It resolves only once a player
// is authenticated and their profile is in the cache.
//
// Four views in one module because they share state and transition into each
// other constantly (signup → recovery screen → done; login → forgot → recover).
// Splitting them would mean threading that state through three files.
//
// Follows the attachX(root, callbacks) => handle pattern; no `three` imports.

import { escapeHtml } from "./escape";
import { signup, login, recover, type AuthResponse } from "../net/endpoints";
import { setToken, ApiError } from "../net/api";
import { setProfileCache } from "../game/profileCache";
import { fromServerProfile } from "../game/profileMapping";

type View = "choose" | "signup" | "login" | "recover";

export interface AuthGateHandle {
  /** Show the gate. Resolves with the signed-in username once done. */
  open: () => Promise<string>;
  detach: () => void;
  isOpen: () => boolean;
}

export interface AuthGateCallbacks {
  /** Show the blocking recovery-code screen. Awaited before the gate resolves,
   *  so a new account can never reach the menu without seeing its code. */
  onRecoveryCode: (code: string, context: "signup" | "recovery") => Promise<void>;
  /** Open the privacy notice, returning here when closed. */
  onShowPrivacy: () => void;
}

function require<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id) as T | null;
  if (!el) throw new Error(`attachAuthGate: missing element #${id} — check index.html`);
  return el;
}

export function attachAuthGate(callbacks: AuthGateCallbacks): AuthGateHandle {
  const root = require<HTMLDivElement>("authGate");

  let isOpenState = false;
  let view: View = "choose";
  let busy = false;
  let error = "";
  let resolveOpen: ((username: string) => void) | null = null;

  /** Adopt a successful auth response: store the token, hydrate the profile
   *  cache, show the recovery code if one came back, then finish. */
  async function completeAuth(result: AuthResponse, context: "signup" | "recovery"): Promise<void> {
    setToken(result.token);
    setProfileCache(fromServerProfile(result.profile));

    // Signup and recovery both return a plaintext code that will never be
    // shown again. Awaiting here is what makes the screen genuinely blocking.
    if (result.recoveryCode) {
      await callbacks.onRecoveryCode(result.recoveryCode, context);
    }

    finish(result.user.username);
  }

  function finish(username: string): void {
    isOpenState = false;
    root.classList.add("hidden");
    document.body.classList.remove("auth-open");
    root.innerHTML = "";

    const resolve = resolveOpen;
    resolveOpen = null;
    resolve?.(username);
  }

  function setBusy(next: boolean): void {
    busy = next;
    root.querySelectorAll<HTMLButtonElement>("button").forEach((b) => {
      b.disabled = next;
    });
  }

  function fail(err: unknown): void {
    error =
      err instanceof ApiError
        ? err.message
        : "Something went wrong. Please try again.";
    setBusy(false);
    render();
  }

  function go(next: View): void {
    view = next;
    error = "";
    render();
  }

  // --- views ----------------------------------------------------------------

  function renderChoose(): string {
    return `
      <div class="auth-card">
        <h1 class="auth-title">🐶 Beagle Chomp</h1>
        <p class="auth-sub">Sign in to play, keep your coins, and join the leaderboard.</p>
        <div class="auth-actions">
          <button type="button" id="goSignup" class="btn-primary">Create an account</button>
          <button type="button" id="goLogin" class="btn-secondary">I already have one</button>
          <button type="button" id="goRecover" class="btn-link">I have a recovery code</button>
        </div>
      </div>
    `;
  }

  function renderSignup(): string {
    // The username input's `pattern` is set in JS (see wire()), not here.
    // Browsers compile that attribute with the RegExp "v" flag, where an
    // unescaped "-" inside a character class is a syntax error — and writing
    // the escape in this template literal doesn't survive, because esbuild
    // normalises the redundant string escape away before the browser sees it.
    // Assigning the attribute at runtime sidesteps the transform entirely.
    return `
      <div class="auth-card">
        <h1 class="auth-title">Create an account</h1>
        <form id="signupForm" class="auth-form" autocomplete="off">
          <label for="signupUsername">Username</label>
          <input id="signupUsername" name="username" type="text" required
                 minlength="3" maxlength="20"
                 autocapitalize="none" autocorrect="off" spellcheck="false" />
          <p class="auth-hint">
            3–20 characters: letters, numbers, hyphens, underscores.
            <strong>Pick a nickname, not your real name</strong> — it's shown on the leaderboard.
          </p>

          <label for="signupPassword">Password</label>
          <input id="signupPassword" name="password" type="password" required
                 minlength="8" autocomplete="new-password" />
          <p class="auth-hint">At least 8 characters.</p>

          ${errorHtml()}

          <button type="submit" class="btn-primary">Create account</button>
          <button type="button" id="backToChoose" class="btn-link">Back</button>
        </form>
        <p class="auth-legal">
          We store a username, a hashed password, a hashed recovery code, your score,
          coins and unlocked skins — nothing else.
          <button type="button" id="privacyLink" class="btn-link inline">Privacy notice</button>
        </p>
      </div>
    `;
  }

  function renderLogin(): string {
    return `
      <div class="auth-card">
        <h1 class="auth-title">Welcome back</h1>
        <form id="loginForm" class="auth-form" autocomplete="off">
          <label for="loginUsername">Username</label>
          <input id="loginUsername" name="username" type="text" required
                 autocapitalize="none" autocorrect="off" spellcheck="false" />

          <label for="loginPassword">Password</label>
          <input id="loginPassword" name="password" type="password" required
                 autocomplete="current-password" />

          ${errorHtml()}

          <button type="submit" class="btn-primary">Sign in</button>
          <button type="button" id="goRecoverFromLogin" class="btn-link">
            Forgot your password?
          </button>
          <button type="button" id="backToChoose" class="btn-link">Back</button>
        </form>
      </div>
    `;
  }

  function renderRecover(): string {
    return `
      <div class="auth-card">
        <h1 class="auth-title">Use a recovery code</h1>
        <p class="auth-sub">
          Sign in on a new device, or set a new password if you've forgotten yours.
        </p>
        <form id="recoverForm" class="auth-form" autocomplete="off">
          <label for="recoverUsername">Username</label>
          <input id="recoverUsername" name="username" type="text" required
                 autocapitalize="none" autocorrect="off" spellcheck="false" />

          <label for="recoverCode">Recovery code</label>
          <input id="recoverCode" name="recoveryCode" type="text" required
                 placeholder="BEAGLE-XXXX-XXXX-XXXX"
                 autocapitalize="characters" autocorrect="off" spellcheck="false" />
          <p class="auth-hint">Dashes and capitals are optional — we'll sort it out.</p>

          <label class="auth-checkbox">
            <input type="checkbox" id="alsoResetPassword" />
            <span>Also set a new password</span>
          </label>

          <div id="newPasswordRow" class="auth-hidden">
            <label for="recoverNewPassword">New password</label>
            <input id="recoverNewPassword" name="newPassword" type="password"
                   minlength="8" autocomplete="new-password" />
            <p class="auth-hint">
              At least 8 characters. This signs you out on every other device.
            </p>
          </div>

          ${errorHtml()}

          <button type="submit" class="btn-primary">Continue</button>
          <button type="button" id="backToChoose" class="btn-link">Back</button>
        </form>
        <p class="auth-legal">
          Your code is used up once it works — we'll show you a new one to save.
        </p>
      </div>
    `;
  }

  function errorHtml(): string {
    return error ? `<p class="auth-error" role="alert">${escapeHtml(error)}</p>` : "";
  }

  // --- wiring ---------------------------------------------------------------

  function render(): void {
    root.innerHTML =
      view === "choose"
        ? renderChoose()
        : view === "signup"
          ? renderSignup()
          : view === "login"
            ? renderLogin()
            : renderRecover();

    root.querySelector("#goSignup")?.addEventListener("click", () => go("signup"));
    root.querySelector("#goLogin")?.addEventListener("click", () => go("login"));
    root.querySelector("#goRecover")?.addEventListener("click", () => go("recover"));
    root.querySelector("#goRecoverFromLogin")?.addEventListener("click", () => go("recover"));
    root.querySelector("#backToChoose")?.addEventListener("click", () => go("choose"));
    root.querySelector("#privacyLink")?.addEventListener("click", () => callbacks.onShowPrivacy());

    // Set here rather than in the markup: see renderSignup's note. The escape
    // must reach the browser intact, and a build transform would strip it from
    // a string literal in the template.
    const usernameInput = root.querySelector<HTMLInputElement>("#signupUsername");
    if (usernameInput) usernameInput.pattern = "[A-Za-z0-9_" + String.fromCharCode(92) + "-]+";

    const alsoReset = root.querySelector<HTMLInputElement>("#alsoResetPassword");
    const passwordRow = root.querySelector<HTMLDivElement>("#newPasswordRow");
    alsoReset?.addEventListener("change", () => {
      passwordRow?.classList.toggle("auth-hidden", !alsoReset.checked);
    });

    root.querySelector<HTMLFormElement>("#signupForm")?.addEventListener("submit", (e) => {
      e.preventDefault();
      if (busy) return;
      const username = (root.querySelector<HTMLInputElement>("#signupUsername")?.value ?? "").trim();
      const password = root.querySelector<HTMLInputElement>("#signupPassword")?.value ?? "";
      setBusy(true);
      signup(username, password)
        .then((r) => completeAuth(r, "signup"))
        .catch(fail);
    });

    root.querySelector<HTMLFormElement>("#loginForm")?.addEventListener("submit", (e) => {
      e.preventDefault();
      if (busy) return;
      const username = (root.querySelector<HTMLInputElement>("#loginUsername")?.value ?? "").trim();
      const password = root.querySelector<HTMLInputElement>("#loginPassword")?.value ?? "";
      setBusy(true);
      login(username, password)
        // Login never returns a recoveryCode, so the context is unused here —
        // pass "recovery" rather than "signup" so that if the server ever did
        // return one, the copy wouldn't claim the account was just created.
        .then((r) => completeAuth(r, "recovery"))
        .catch(fail);
    });

    root.querySelector<HTMLFormElement>("#recoverForm")?.addEventListener("submit", (e) => {
      e.preventDefault();
      if (busy) return;
      const username = (root.querySelector<HTMLInputElement>("#recoverUsername")?.value ?? "").trim();
      const code = (root.querySelector<HTMLInputElement>("#recoverCode")?.value ?? "").trim();
      const wantsReset = root.querySelector<HTMLInputElement>("#alsoResetPassword")?.checked ?? false;
      const newPassword = wantsReset
        ? (root.querySelector<HTMLInputElement>("#recoverNewPassword")?.value ?? "")
        : undefined;

      setBusy(true);
      recover(username, code, newPassword)
        .then((r) => completeAuth(r, "recovery"))
        .catch(fail);
    });
  }

  return {
    open(): Promise<string> {
      isOpenState = true;
      view = "choose";
      error = "";
      busy = false;
      render();
      root.classList.remove("hidden");
      document.body.classList.add("auth-open");

      return new Promise<string>((resolve) => {
        resolveOpen = resolve;
      });
    },

    detach(): void {
      root.innerHTML = "";
      root.classList.add("hidden");
      document.body.classList.remove("auth-open");
    },

    isOpen: () => isOpenState,
  };
}
