// OWNER: gameplay-engineer (IDEA-040 first-run tutorial)
//
// The on-screen half of the coach: a caption strip over live play, plus a Skip
// button. All decisions about WHICH tip and WHEN live in
// src/game/tutorialCoach.ts — this file only renders what it is handed.
//
// Deliberately non-blocking. It never captures input, never pauses the game and
// never waits for acknowledgement: the beagle is being chased while this is on
// screen. `pointer-events` is off for the strip itself so a swipe that starts
// on top of the caption still steers (src/input/touch.ts listens on the
// window), and only the Skip button is clickable.

export interface TutorialHandle {
  /** Show a tip, replacing whatever is there. */
  show: (text: string) => void;
  /** Clear the caption but keep the coach mounted. */
  clear: () => void;
  /** Remove everything, including the Skip button. */
  detach: () => void;
}

export interface TutorialCallbacks {
  /** The player pressed Skip. */
  onSkip: () => void;
}

export function attachTutorial(callbacks: TutorialCallbacks): TutorialHandle {
  const root = document.createElement("div");
  root.className = "tutorial";
  // aria-live so a screen reader announces each tip as it arrives, without
  // moving focus away from the game.
  root.setAttribute("aria-live", "polite");

  const caption = document.createElement("p");
  caption.className = "tutorial-tip";

  const skip = document.createElement("button");
  skip.type = "button";
  skip.className = "tutorial-skip";
  skip.textContent = "Skip tips";
  skip.addEventListener("click", () => callbacks.onSkip());

  root.append(caption, skip);
  document.body.append(root);
  document.body.classList.add("tutorial-open");

  let visible = false;

  return {
    show(text: string): void {
      caption.textContent = text;
      if (!visible) {
        visible = true;
        caption.classList.add("is-visible");
      }
    },
    clear(): void {
      if (!visible) return;
      visible = false;
      caption.classList.remove("is-visible");
    },
    detach(): void {
      root.remove();
      document.body.classList.remove("tutorial-open");
    },
  };
}
