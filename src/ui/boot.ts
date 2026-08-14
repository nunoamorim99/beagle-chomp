// OWNER: gameplay-engineer (IDEA-019 accounts)
//
// The boot splash and the offline screen.
//
// The game is online-only by design (the brief: gameplay requires a live
// connection; the service worker may cache the app shell but there is no
// offline queueing). That creates a failure mode the game never had before:
// the PWA shell loads instantly from the precache, then cannot reach the API.
//
// Without this screen that looks like a hang. With it, the player gets a plain
// explanation and a retry button.

export interface BootScreenHandle {
  showLoading: (message?: string) => void;
  /** Offline/unreachable. Resolves when the player asks to retry. */
  showOffline: (detail: string) => Promise<void>;
  /** Unrecoverable (e.g. VITE_API_URL missing) — no retry offered. */
  showFatal: (detail: string) => void;
  hide: () => void;
}

function require<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id) as T | null;
  if (!el) throw new Error(`attachBootScreen: missing element #${id} — check index.html`);
  return el;
}

export function attachBootScreen(): BootScreenHandle {
  const root = require<HTMLDivElement>("boot");

  function show(html: string): void {
    root.innerHTML = `<div class="boot-sheet">${html}</div>`;
    root.classList.remove("hidden");
    document.body.classList.add("boot-open");
  }

  return {
    showLoading(message = "Loading…"): void {
      show(`
        <div class="boot-spinner" aria-hidden="true">🐶</div>
        <p class="boot-message">${message}</p>
      `);
    },

    showOffline(detail: string): Promise<void> {
      return new Promise<void>((resolve) => {
        show(`
          <h1>Can't reach Beagle Chomp</h1>
          <p class="boot-message">${detail}</p>
          <p class="boot-hint">
            The game needs a connection to play — your coins, skins and scores
            live on your account, not on this device.
          </p>
          <button type="button" id="bootRetryBtn" class="btn-primary">Try again</button>
        `);
        root.querySelector("#bootRetryBtn")?.addEventListener("click", () => resolve(), {
          once: true,
        });
      });
    },

    showFatal(detail: string): void {
      show(`
        <h1>Something's misconfigured</h1>
        <p class="boot-message">${detail}</p>
      `);
    },

    hide(): void {
      root.classList.add("hidden");
      document.body.classList.remove("boot-open");
      root.innerHTML = "";
    },
  };
}
