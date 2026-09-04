// OWNER: gameplay-engineer (structure) + render-artist (polish)
// Score / map / lives HUD and centre banners (Ready!, Map Cleared!, Game Over).
// Keep DOM overlay separate from the canvas. Contract below.

import { ICON, icon, plate } from "./icons";

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
  /** `banner` draws a stroked headline ABOVE the board — the design’s
   *  "GOOD RUN!" moment. Omit it for a plain board. */
  showPanel(html: string, banner?: string): HTMLElement;
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
 * Icon, colour and short name per power-up.
 *
 * The chip says BOTH glyph and word, because neither alone is enough: an icon
 * is instantly recognisable but ambiguous (an anchor could mean almost
 * anything), and a word alone is something you have to read mid-chase.
 * Together they are one glance.
 *
 * Names are short and shouty rather than the config's prose labels — "x2
 * Biscuits" fits a phone; "Double biscuits" wraps.
 *
 * COLOUR IS THE THIRD SIGNAL, and the design system's §07 makes it the
 * load-bearing one: the chip's OUTLINE is the power-up's own colour, which is
 * what lets five chips stay small and still be told apart peripherally. The
 * five values are the five enemy hues from §01, one each — that palette is
 * explicitly "reserved for state, never for chrome", and an active power-up
 * is exactly state. `ink` is the darkest tone of the same hue, for the glyph
 * on the plate, so a plate never needs a second outline inside it.
 */
const POWERUP_CHIPS: Record<
  string,
  { icon: string; name: string; color: string; ink: string }
> = {
  doubleBiscuit: { icon: ICON.biscuit, name: "x2 Biscuits", color: "#F0CF8E", ink: "#6B4A2F" },
  doubleGhost: { icon: ICON.enemies, name: "x2 Enemies", color: "#9B6BD6", ink: "#FFF7E8" },
  slowGhosts: { icon: ICON.anchor, name: "Slow", color: "#6FB84A", ink: "#17300C" },
  star: { icon: ICON.star, name: "Star", color: "#E8A23D", ink: "#4A2E08" },
  shield: { icon: ICON.shield, name: "Shield", color: "#53C7C0", ink: "#0E3B39" },
};

/** The fallback for a power-up the table doesn't know — violet, the one enemy
 *  hue not claimed above. */
const POWERUP_FALLBACK = { icon: ICON.power, color: "#9B6BD6", ink: "#FFF7E8" };

/** Seconds left at which a timed chip starts warning. About one corridor —
 *  long enough that seeing it is still actionable. */
const EXPIRING_AT = 3;

// The HUD lives entirely in the DOM overlay defined in index.html (.hud + #center).
// index.html guarantees these elements exist; we resolve them once and fail loudly
// if the markup drifts, rather than silently no-op-ing every frame.
// `maxLives` is PASSED, not imported: hud.ts is the DOM layer and must not reach
// into src/game (CLAUDE.md's layer rule), so game.ts hands it LIVES.max. It is
// required rather than defaulted, because a hard-coded 5 here would quietly stop
// matching the day the cap moves.
export function createHud(root: HTMLElement, maxLives: number): Hud {
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
  const levelLabelEl = require<HTMLElement>("levelLabel");
  const levelChipEl = require<HTMLElement>("levelChip");
  const livesEl = require<HTMLElement>("lives");
  const coinsEl = require<HTMLElement>("coins");
  const powerupsEl = require<HTMLElement>("powerups");
  const centerEl = require<HTMLElement>("center");

  function clearCenter(): void {
    centerEl.innerHTML = "";
  }

  // ---- the score readout (design system §09) ------------------------------
  //
  // "Scores count up over 600ms rather than snapping." A score that jumps is a
  // number changing; a score that runs up is a reward, and it is the only
  // animation in the HUD, so it costs nothing to read.
  //
  // Only INCREASES roll. A decrease is never a scoring event here — it is a
  // reset between runs — and watching 12 480 tick backwards to zero would read
  // as losing the points rather than starting again.
  const COUNT_MS = 600;
  let shownScore = 0;
  let targetScore = 0;
  let countFrame = 0;


  function stopCount(): void {
    if (countFrame !== 0) {
      cancelAnimationFrame(countFrame);
      countFrame = 0;
    }
  }

  function paintScore(n: number): void {
    // A thin space between thousands: it groups the digits without adding a
    // comma/period that would have to pick a locale.
    scoreEl.textContent = String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  }

  function rollScore(from: number, to: number): void {
    stopCount();
    const t0 = performance.now();
    const step = (now: number): void => {
      const t = Math.min(1, (now - t0) / COUNT_MS);
      // Ease out: the count sprints and settles, rather than crawling to the
      // final digit at a constant rate.
      const eased = 1 - (1 - t) * (1 - t);
      shownScore = Math.round(from + (to - from) * eased);
      paintScore(shownScore);
      if (t < 1) {
        countFrame = requestAnimationFrame(step);
      } else {
        countFrame = 0;
        shownScore = to;
      }
    };
    countFrame = requestAnimationFrame(step);
  }

  return {
    setScore(n: number): void {
      if (n === targetScore) return;
      targetScore = n;
      if (n < shownScore) {
        // A reset (or any decrease): snap.
        stopCount();
        shownScore = n;
        paintScore(n);
        return;
      }
      rollScore(shownScore, n);
    },

    setLevel(label: string): void {
      // The chip is an eyebrow plus a figure ("MAP 3"), which is the compact
      // shape the redesign asks for. But the label it is handed already names
      // itself — progression.ts returns "Map 3", "Bonus", "Bonus ·2", and the
      // challenge path returns "C5" — so blindly prefixing it produced
      // "MAP Map 3" and, worse, "MAP Bonus".
      //
      // Split it instead: a leading "Map " becomes the eyebrow and the rest
      // becomes the figure; anything else is shown whole with no eyebrow at
      // all. game.ts keeps passing one string and stays unaware of the chip.
      const asMap = /^Map\s+(.+)$/.exec(label);
      if (asMap) {
        levelLabelEl.textContent = "Map";
        levelLabelEl.hidden = false;
        levelEl.textContent = asMap[1];
      } else {
        levelLabelEl.hidden = true;
        levelEl.textContent = label;
      }
      levelChipEl.setAttribute("aria-label", `Current map: ${label}`);
    },

    setLives(n: number): void {
      // ALWAYS `maxLives` hearts, with only the ones you actually have filled in.
      //
      // The row used to be exactly as long as the lives you held, which made the
      // ceiling invisible: a new player starts on three and had no way to know a
      // fourth and a fifth existed to be earned (IDEA-018's bonus lives).
      // Drawing all five and dimming the empties turns the chip into a meter —
      // "3 of 5" — and tells the player what there is to play for.
      //
      // It also deletes the reason the previous version tracked a high-water
      // mark: a fixed-length row cannot shift when a life is lost or gained,
      // which is the whole thing that bookkeeping existed to guarantee.
      const lives = Math.min(Math.max(n, 0), maxLives);

      livesEl.innerHTML = "";
      livesEl.setAttribute("aria-label", `${lives} of ${maxLives} lives`);
      for (let i = 0; i < maxLives; i++) {
        livesEl.appendChild(icon(ICON.life, i < lives ? undefined : "life-spent"));
      }
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
        const chip = POWERUP_CHIPS[p.id] ?? { ...POWERUP_FALLBACK, name: p.label };
        const el = document.createElement("div");
        el.className = "powerup";
        // The chip's own hue, handed to CSS rather than hard-coded there —
        // style.css never has to know the roster, and adding a power-up is one
        // row in the table above.
        el.style.setProperty("--pu", chip.color);
        el.style.setProperty("--pu-ink", chip.ink);

        const timed = p.kind === "timed" && p.duration > 0;
        if (timed && p.remaining <= EXPIRING_AT) {
          // The last three seconds recolour the whole chip to the shared
          // warning orange (§07). Nothing marks the two HELD lifetimes: their
          // signal is the ABSENCE of a drain bar, which is the asymmetry the
          // design leans on rather than a badge nobody reads mid-chase.
          el.classList.add("expiring");
        }

        el.appendChild(plate("power", "hud"));
        // The plate is generic (`bolt` on violet by default); this chip wants
        // the power-up's own glyph and colour, which the --pu properties above
        // already supply to the CSS.
        const glyph = el.querySelector(".bc-i");
        if (glyph) glyph.textContent = chip.icon;

        el.setAttribute("aria-label", timed
          ? `${chip.name}, ${Math.ceil(p.remaining)} seconds left`
          : chip.name);
        const name = document.createElement("span");
        name.className = "name";
        name.textContent = chip.name;
        if (timed) {
          // Under the name, not beside it: the countdown is the one thing that
          // must be READ rather than recognised, and stacking keeps the chip
          // narrow, which is what decides how many fit across a phone.
          const time = document.createElement("span");
          time.className = "time";
          time.textContent = `${Math.ceil(p.remaining)}s`;
          name.appendChild(time);
        }
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
      centerEl.classList.remove("center--dim");
      const banner = document.createElement("div");
      banner.className = "banner";
      banner.textContent = text;
      // §07: banners are STROKED, not panelled — the 5px ink stroke in
      // style.css is what keeps them legible on sky, hedge and soil, so the
      // fill is free to carry meaning. Amber for the run's own beats, rose for
      // the end of it.
      banner.style.color = text.includes("Over") ? "var(--bc-rose)" : "var(--bc-amber)";
      centerEl.appendChild(banner);
      centerEl.classList.remove("hidden");
    },

    showPanel(html: string, banner?: string): HTMLElement {
      clearCenter();
      // A panel COVERS the run, so the scene behind it is dimmed — without
      // that, a board of dark chips sits on a bright maze and the eye keeps
      // being pulled back to the game it has just finished. A banner alone
      // (Ready!, Paused) does not dim: the player still needs to read the
      // board underneath it.
      centerEl.classList.add("center--dim");
      if (banner !== undefined) {
        const head = document.createElement("div");
        head.className = "banner result-banner";
        head.textContent = banner;
        centerEl.appendChild(head);
      }
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
      centerEl.classList.remove("center--dim");
      clearCenter();
    },
  };
}
