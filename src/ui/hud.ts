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
  /** IDEA-046: render the active power-up tray. Called on every event that can
   *  change the list — collected, expired, death, map cleared. */
  setPowerups(active: readonly HudPowerup[]): void;
  showBanner(text: string): void;
  showPanel(html: string): HTMLElement;
  hideCenter(): void;
}

/**
 * What the tray needs to draw one chip.
 *
 * Structurally identical to powerups.ts's ActivePowerup, and declared SEPARATELY
 * on purpose: hud.ts is the DOM layer and must not import from src/game, so the
 * dependency runs one way only (CLAUDE.md's layer rule). ActivePowerup satisfies
 * this shape, so game.ts passes it straight through with no adapter.
 */
export interface HudPowerup {
  id: string;
  label: string;
  kind: "timed" | "untilDeath" | "untilHit";
  remaining: number;
  duration: number;
}

/**
 * Icon and short name per power-up.
 *
 * The chip says BOTH, because neither alone is enough: an emoji is instantly
 * recognisable but ambiguous (an anchor could mean almost anything), and a word
 * alone is something you have to read mid-chase. Together they are one glance.
 *
 * Names are short and shouty rather than the config's prose labels — "x2
 * Biscuits" fits a phone; "Double biscuits" wraps.
 */
const POWERUP_CHIPS: Record<string, { icon: string; name: string }> = {
  doubleBiscuit: { icon: "🍪", name: "x2 Biscuits" },
  doubleGhost: { icon: "👻", name: "x2 Enemies" },
  slowGhosts: { icon: "⚓", name: "Slow" },
  star: { icon: "⭐", name: "Star" },
  shield: { icon: "🛡️", name: "Shield" },
};

/** Seconds left at which a timed chip starts warning. About one corridor —
 *  long enough that seeing it is still actionable. */
const EXPIRING_AT = 3;

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
  const powerupsEl = require<HTMLElement>("powerups");
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

    setPowerups(active: readonly HudPowerup[]): void {
      // Rebuilt wholesale rather than diffed. The list is at most five short
      // chips and only changes on discrete events (collect / expire / death /
      // map cleared) — never per frame — so a diff would be machinery earning
      // nothing.
      powerupsEl.innerHTML = "";

      for (const p of active) {
        const chip = POWERUP_CHIPS[p.id] ?? { icon: "✨", name: p.label };
        const el = document.createElement("div");
        el.className = "powerup";

        const timed = p.kind === "timed" && p.duration > 0;
        if (!timed) {
          // The two non-timed lifetimes get a coloured left edge instead of a
          // bar, so "held until something happens" is distinguishable from
          // "running out" without reading anything.
          el.classList.add(p.kind === "untilHit" ? "shielded" : "persistent");
        } else if (p.remaining <= EXPIRING_AT) {
          el.classList.add("expiring");
        }

        const icon = document.createElement("span");
        icon.className = "icon";
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = chip.icon;
        el.appendChild(icon);

        const name = document.createElement("span");
        name.className = "name";
        // Timed chips carry the countdown in the text as well as the bar: the
        // bar is peripheral vision, the number is for when you actually look.
        name.textContent = timed ? `${chip.name} ${Math.ceil(p.remaining)}s` : chip.name;
        el.appendChild(name);

        if (timed) {
          const bar = document.createElement("div");
          bar.className = "bar";
          const frac = Math.max(0, Math.min(1, p.remaining / p.duration));
          bar.style.width = `${frac * 100}%`;
          el.appendChild(bar);
        }

        powerupsEl.appendChild(el);
      }
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
