// OWNER: gameplay-engineer (IDEA-040 tutorial v2)
//
// The tutorial pop-up: one slide at a time, with a live 3D illustration behind
// each. Replaces v1's during-play captions, which Nuno tested and correctly
// called distracting — a tip arriving mid-chase competes with the chase.
//
// WHY IT STEPS RATHER THAN SCROLLS. The illustrations are the REAL game meshes,
// rendered by game.ts through the one existing renderer (exactly how the shop
// shows skins). A horizontally-scrolling rail would slide the HTML across a
// stationary 3D subject, so slides fade in place instead and the stage is
// fixed. Same carousel feel, no alignment fight — and the illustration can
// never go stale, because it is the game's own `makeBeagle`/`makeEnemy`/board
// code showing the player's OWN equipped skin and theme.
//
// The stage is a TRANSPARENT gap above the card, not a hole punched in it: the
// 3D shows through because nothing is painted there.

import { buildSlides, type TutorialSlide, type DeviceInput } from "./tutorialSlides";
import { escapeHtml } from "./escape";

export interface TutorialCarouselHandle {
  open: (opts?: { onDone?: () => void }) => void;
  close: () => void;
  isOpen: () => boolean;
  detach: () => void;
}

export interface TutorialCarouselCallbacks {
  /** Stage the 3D subject for the current slide. game.ts routes this to
   *  shopScene, which already knows how to build all three. */
  onStage: (stage: TutorialSlide["stage"]) => void;
  /** Read the device + preference at OPEN time, not at attach time: a player
   *  can switch to the D-pad and reopen the tutorial from the account screen,
   *  and the copy must follow. */
  readInput: () => DeviceInput;
}

function require<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id) as T | null;
  if (!el) throw new Error(`attachTutorialCarousel: missing #${id} — check index.html`);
  return el;
}

/** The flat input diagrams. 3D can show a beagle; it cannot show a gesture. */
function diagramHtml(kind: NonNullable<TutorialSlide["diagram"]>): string {
  if (kind === "keys") {
    return (
      '<div class="tut-keys" aria-hidden="true">' +
      '<span class="tut-key">W</span>' +
      '<span class="tut-key">A</span>' +
      '<span class="tut-key">S</span>' +
      '<span class="tut-key">D</span>' +
      '<span class="tut-keys-or">or</span>' +
      '<span class="tut-key">&#8593;</span>' +
      '<span class="tut-key">&#8592;</span>' +
      '<span class="tut-key">&#8595;</span>' +
      '<span class="tut-key">&#8594;</span>' +
      "</div>"
    );
  }
  if (kind === "dpad") {
    return (
      '<div class="tut-pad" aria-hidden="true">' +
      // The same chevrons the real D-pad draws (src/input/dpad.ts) — a
      // diagram of a control has to be a picture OF that control, and the
      // geometric-shape characters this used were a different family from
      // anything on screen.
      '<span class="tut-pad-btn tut-pad-up"><i class="bc-i">keyboard_arrow_up</i></span>' +
      '<span class="tut-pad-btn tut-pad-left"><i class="bc-i">keyboard_arrow_left</i></span>' +
      '<span class="tut-pad-btn tut-pad-right"><i class="bc-i">keyboard_arrow_right</i></span>' +
      '<span class="tut-pad-btn tut-pad-down"><i class="bc-i">keyboard_arrow_down</i></span>' +
      "</div>"
    );
  }
  if (kind === "stick") {
    // The real control, at diagram size: the plate, its four gates, and the
    // ball sitting off-centre in the one that is lit. A stick drawn at rest
    // says nothing about what it does — this one is mid-push.
    return (
      '<div class="tut-stick" aria-hidden="true">' +
      // Deliberately NOT .engaged: that turns the ball amber, and an amber ball
      // filling the diagram is the only thing you see. The ball stays ivory,
      // offset into a lit gate — which is the picture that says "push it".
      '<span class="stick-plate">' +
      '<span class="stick-gate stick-gate-up"></span>' +
      '<span class="stick-gate stick-gate-down"></span>' +
      '<span class="stick-gate stick-gate-left on"></span>' +
      '<span class="stick-gate stick-gate-right"></span>' +
      '<span class="stick-well"></span>' +
      '<span class="stick-ball"></span>' +
      "</span></div>"
    );
  }
  return (
    '<div class="tut-swipe" aria-hidden="true">' +
    '<span class="tut-swipe-track"><span class="tut-swipe-dot"></span></span>' +
    "</div>"
  );
}

export function attachTutorialCarousel(
  callbacks: TutorialCarouselCallbacks,
): TutorialCarouselHandle {
  const root = require<HTMLDivElement>("tutorial");

  let slides: TutorialSlide[] = [];
  let index = 0;
  let openState = false;
  let onDone: (() => void) | undefined;
  let keyHandler: ((e: KeyboardEvent) => void) | null = null;

  function render(): void {
    const slide = slides[index];
    const last = index === slides.length - 1;

    root.innerHTML =
      // The stage is deliberately empty and unpainted — the 3D behind shows
      // through it. aria-hidden because it carries no information a screen
      // reader can use; the text below says everything.
      '<div class="tut-stage" aria-hidden="true"></div>' +
      '<div class="tut-card" role="dialog" aria-modal="true" aria-label="How to play">' +
      (slide.diagram ? diagramHtml(slide.diagram) : "") +
      `<h2 class="tut-title">${escapeHtml(slide.title)}</h2>` +
      `<p class="tut-body">${escapeHtml(slide.body)}</p>` +
      '<div class="tut-dots" role="tablist" aria-label="Tutorial progress">' +
      slides
        .map(
          (s, i) =>
            `<button type="button" role="tab" class="tut-dot${i === index ? " is-active" : ""}" ` +
            `data-idx="${i}" aria-selected="${i === index}" ` +
            `aria-label="Step ${i + 1} of ${slides.length}: ${escapeHtml(s.title)}"></button>`,
        )
        .join("") +
      "</div>" +
      '<div class="tut-actions">' +
      `<button type="button" class="btn-secondary tut-back"${index === 0 ? " disabled" : ""}>Back</button>` +
      `<button type="button" class="tut-next">${last ? "Got it" : "Next"}</button>` +
      "</div>" +
      (last ? "" : '<button type="button" class="btn-link tut-skip">Skip</button>') +
      "</div>";

    root.querySelector(".tut-back")?.addEventListener("click", () => go(index - 1));
    root.querySelector(".tut-next")?.addEventListener("click", () => {
      if (last) finish();
      else go(index + 1);
    });
    root.querySelector(".tut-skip")?.addEventListener("click", () => finish());
    for (const dot of root.querySelectorAll<HTMLButtonElement>(".tut-dot")) {
      dot.addEventListener("click", () => go(Number(dot.dataset.idx)));
    }

    // Stage the 3D for this slide. Called on every render (not only on
    // change) so reopening the tutorial restages correctly — shopScene's
    // showX() are all no-op-safe to repeat.
    callbacks.onStage(slide.stage);
  }

  function go(next: number): void {
    if (next < 0 || next >= slides.length || next === index) return;
    index = next;
    render();
  }

  function finish(): void {
    close();
    onDone?.();
  }

  function close(): void {
    openState = false;
    root.classList.add("hidden");
    document.body.classList.remove("tutorial-open");
    root.innerHTML = "";
    if (keyHandler) {
      window.removeEventListener("keydown", keyHandler);
      keyHandler = null;
    }
  }

  return {
    open(opts): void {
      onDone = opts?.onDone;
      // Rebuilt per open: the device and the control preference can both have
      // changed since last time.
      slides = buildSlides(callbacks.readInput());
      index = 0;
      openState = true;
      root.classList.remove("hidden");
      document.body.classList.add("tutorial-open");
      render();

      // Arrow keys page through it. Deliberately NOT Escape-to-close: on the
      // first run this is the only explanation the player gets, so leaving is
      // a decision (Skip / Got it), not a stray keypress.
      keyHandler = (e: KeyboardEvent) => {
        if (!openState) return;
        if (e.key === "ArrowRight") { e.preventDefault(); go(index + 1); }
        else if (e.key === "ArrowLeft") { e.preventDefault(); go(index - 1); }
      };
      window.addEventListener("keydown", keyHandler);
    },
    close,
    isOpen: () => openState,
    detach(): void {
      close();
    },
  };
}
