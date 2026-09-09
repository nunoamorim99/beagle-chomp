// OWNER: gameplay-engineer (IDEA-019 accounts)
//
// The privacy notice. Linked from the signup form and the profile screen.
//
// Rendered client-side rather than served by the API, because STACK.md §2.1 is
// absolute: the API returns JSON only, never HTML. So this is a static screen
// in the Pages bundle like every other page in src/ui/*.
//
// The text is deliberately short and concrete. Everything it claims is
// enforceable and enforced: the users table has exactly those columns, there
// are no third-party scripts in the bundle, and "delete my account" is a real
// DELETE with cascades — not a soft-delete flag.
//
// IDEA-050 CHANGED WHAT IS TRUE HERE, so it changed the copy. This screen used
// to promise "No analytics, no ads, no tracking". Per-run gameplay statistics
// are now stored (run_stats), so that sentence would be a lie and has been
// replaced by what actually happens. The rest of the promise is unchanged and
// still enforced: no email, no name, no IP address, no device id, no third
// party, no ads, nothing following anyone to another site — and the stats
// cascade away with the account, which server/scripts/test-sessions.ts checks
// on every run.
//
// If this file and the schema ever disagree, the schema is what players get and
// this is the lie. Change them together.

export interface PrivacyHandle {
  /** `onClose` returns the player wherever they came from — the signup form or
   *  the profile screen — since this can be opened from either. */
  open: (onClose?: () => void) => void;
  close: () => void;
  detach: () => void;
  isOpen: () => boolean;
}

function require<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id) as T | null;
  if (!el) throw new Error(`attachPrivacy: missing element #${id} — check index.html`);
  return el;
}

export function attachPrivacy(): PrivacyHandle {
  const root = require<HTMLDivElement>("privacy");
  let isOpenState = false;
  let onCloseCallback: (() => void) | undefined;

  function render(): void {
    root.innerHTML = `
      <div class="privacy-sheet">
        <h1>Privacy</h1>

        <p class="privacy-lead">
          We store a username, a hashed password, a hashed recovery code, your
          score, credits, unlocked skins — and stats about the games you play.
          We don't collect email or any other personal data. We don't share
          anything with third parties. You can delete your account any time from
          the profile screen — it's permanent.
        </p>

        <h2>What that means in practice</h2>
        <ul>
          <li><strong>No email, ever.</strong> We never ask for one, so we can't
              email you — and there's no password-reset link. That's what the
              recovery code is for.</li>
          <li><strong>Passwords and recovery codes are hashed.</strong> We store
              a one-way hash, not the value. We cannot read either of them, and
              neither can anyone who obtained a copy of the database.</li>
          <li><strong>We keep stats about your games.</strong> How long a run
              lasted, how far you got, what you collected and which enemy caught
              you — saved against your username so we can balance the game and
              show you a summary of your own year. It's your play, not you.</li>
          <li><strong>No ads, no third-party tracking.</strong> There are no
              third-party scripts in this game at all, and nothing here follows
              you to any other site.</li>
          <li><strong>Delete means delete.</strong> The row is removed, along
              with your sessions, scores and stats. It isn't flagged as hidden
              and kept.</li>
        </ul>

        <h2>Pick a nickname</h2>
        <p>
          Your username is visible to other players on the leaderboard, so we'd
          suggest not using your real name.
        </p>

        <button type="button" id="privacyCloseBtn" class="btn-primary">Back</button>
      </div>
    `;

    root.querySelector("#privacyCloseBtn")?.addEventListener("click", () => close());
  }

  function close(): void {
    isOpenState = false;
    root.classList.add("hidden");
    document.body.classList.remove("privacy-open");
    root.innerHTML = "";

    const cb = onCloseCallback;
    onCloseCallback = undefined;
    cb?.();
  }

  return {
    open(onClose?: () => void): void {
      onCloseCallback = onClose;
      isOpenState = true;
      render();
      root.classList.remove("hidden");
      document.body.classList.add("privacy-open");
    },
    close,
    detach(): void {
      root.innerHTML = "";
      root.classList.add("hidden");
      document.body.classList.remove("privacy-open");
    },
    isOpen: () => isOpenState,
  };
}
