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
  /** Resolves once the screen is actually gone. It holds out the rest of one
   *  wordmark-fill cycle when the load finished faster than the animation, so the
   *  loader is seen rather than flickered. */
  hide: () => Promise<void>;
}

function require<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id) as T | null;
  if (!el) throw new Error(`attachBootScreen: missing element #${id} — check index.html`);
  return el;
}

/**
 * How long the loading screen stays up at minimum.
 *
 * Against a local API `restoreSession()` answers in well under 200ms, so the
 * loader appeared, started filling, and vanished part-way through — which
 * reads as a flicker rather than as loading. Holding for one full fill makes
 * the screen say what it is there to say. Matched to the `bc-fill` cycle in
 * style.css: change one and change the other.
 */
const MIN_LOADING_MS = 900;

export function attachBootScreen(): BootScreenHandle {
  const root = require<HTMLDivElement>("boot");
  /** When the current loading screen went up; null when it is not showing. */
  let loadingSince: number | null = null;

  function show(html: string): void {
    root.innerHTML = `<div class="boot-sheet">${html}</div>`;
    root.classList.remove("hidden");
    document.body.classList.add("boot-open");
  }

  return {
    showLoading(message = "Loading…"): void {
      loadingSince = Date.now();
      // Design system §09's fill-left-to-right loader, now drawn with the
      // brand WORDMARK instead of a bone — "no spinner, and nothing borrowed
      // from the arcade original" still holds. Two layers (style.css
      // .wordmark-loader): the wordmark's silhouette as a dark socket, and the
      // real full-colour wordmark revealed over it by an animated clip. It is
      // the same SVG the menu heading uses and index.html preloads, so it is
      // usually in cache before this screen goes up.
      show(`
        <div class="wordmark-loader" role="progressbar" aria-label="${message}">
          <div class="wordmark-loader__well"></div>
          <img class="wordmark-loader__fill" src="./brand/beagle-chomp-wordmark.svg"
               alt="" width="603" height="360" />
        </div>
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

    async hide(): Promise<void> {
      // Hold out the rest of one fill cycle if the load beat the animation to
      // it. Only ever waits after showLoading — hide() is also called once the
      // auth gate closes, when this screen was never up.
      if (loadingSince !== null) {
        const shownFor = Date.now() - loadingSince;
        if (shownFor < MIN_LOADING_MS) {
          await new Promise((r) => setTimeout(r, MIN_LOADING_MS - shownFor));
        }
        loadingSince = null;
      }
      root.classList.add("hidden");
      document.body.classList.remove("boot-open");
      root.innerHTML = "";
    },
  };
}
