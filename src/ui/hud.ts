// OWNER: gameplay-engineer (structure) + render-artist (polish)
// Score / map / lives HUD and centre banners (Ready!, Map Cleared!, Game Over).
// Keep DOM overlay separate from the canvas. Contract below.
export interface Hud {
  setScore(n: number): void;
  setLevel(label: string): void;
  setLives(n: number): void;
  /** IDEA-016/IDEA-017: the persistent coin wallet display (distinct from
   *  score — coins survive across runs). */
  setCoins(n: number): void;
  showBanner(text: string): void;
  showPanel(html: string): HTMLElement;
  hideCenter(): void;
}

// The HUD lives entirely in the DOM overlay defined in index.html (.hud + #center).
// index.html guarantees these elements exist; we resolve them once and fail loudly
// if the markup drifts, rather than silently no-op-ing every frame.
export function createHud(root: HTMLElement): Hud {
  const scope: ParentNode = root ?? document;

  function require<T extends HTMLElement>(id: string): T {
    const el = (scope.querySelector(`#${id}`) ?? document.getElementById(id)) as T | null;
    if (!el) {
      throw new Error(`createHud: missing HUD element #${id} — check index.html`);
    }
    return el;
  }

  const scoreEl = require<HTMLElement>("score");
  const levelEl = require<HTMLElement>("level");
  const livesEl = require<HTMLElement>("lives");
  const coinsEl = require<HTMLElement>("coins");
  const centerEl = require<HTMLElement>("center");

  function clearCenter(): void {
    centerEl.innerHTML = "";
  }

  return {
    setScore(n: number): void {
      scoreEl.textContent = String(n);
    },

    setLevel(label: string): void {
      levelEl.textContent = label;
    },

    setLives(n: number): void {
      // one dog per life; an em dash when the beagle is out of lives (prototype §9)
      livesEl.textContent = "🐶".repeat(Math.max(n, 0)) || "—";
    },

    setCoins(n: number): void {
      coinsEl.textContent = String(Math.max(n, 0));
    },

    showBanner(text: string): void {
      clearCenter();
      const banner = document.createElement("div");
      banner.className = "banner";
      banner.textContent = text;
      banner.style.color = text.includes("Over") ? "var(--danger)" : "var(--accent)";
      centerEl.appendChild(banner);
      centerEl.classList.remove("hidden");
    },

    showPanel(html: string): HTMLElement {
      clearCenter();
      const panel = document.createElement("div");
      panel.className = "panel";
      panel.innerHTML = html;
      centerEl.appendChild(panel);
      centerEl.classList.remove("hidden");
      // returned so the caller can wire buttons inside the panel (e.g. Play again)
      return panel;
    },

    hideCenter(): void {
      centerEl.classList.add("hidden");
      clearCenter();
    },
  };
}
