// OWNER: gameplay-engineer (IDEA-036 home menu carousel)
//
// Arrow controls for the menu's destination rail.
//
// The rail itself is pure CSS (`overflow-x` + `scroll-snap`), so swipe,
// trackpad, keyboard and Tab focus all work with no JavaScript at all. This
// module only adds the mouse-friendly arrows on top, and hides them when the
// rail has nothing to scroll — dead controls are worse than no controls.
//
// Deliberately NOT a slider library, and deliberately not owning the layout:
// if this module failed to load entirely, the menu would still be a usable
// scrolling row of buttons.

export interface MenuCarouselHandle {
  detach: () => void;
}

export function attachMenuCarousel(): MenuCarouselHandle {
  const viewport = document.querySelector<HTMLElement>(".carousel-viewport");
  const prev = document.getElementById("carouselPrev");
  const next = document.getElementById("carouselNext");

  // The menu markup is static, but this runs after sign-in — if any of it is
  // missing the rail still works, so degrade quietly rather than throwing.
  if (!viewport || !prev || !next) {
    return { detach: () => {} };
  }

  const listeners = new AbortController();
  const { signal } = listeners;

  /** Scroll by roughly one card, measured from the real DOM so it stays right
   *  if the card size changes at a breakpoint. */
  function step(direction: 1 | -1): void {
    const card = viewport!.querySelector<HTMLElement>(".carousel-item");
    const gap = 10;
    const amount = card ? card.offsetWidth + gap : viewport!.clientWidth * 0.6;
    viewport!.scrollBy({ left: direction * amount, behavior: "smooth" });
  }

  /** Hide arrows that can't do anything: nothing to scroll, or already at the
   *  end of the rail. */
  function syncArrows(): void {
    const scrollable = viewport!.scrollWidth > viewport!.clientWidth + 1;
    if (!scrollable) {
      prev!.classList.add("hidden-arrow");
      next!.classList.add("hidden-arrow");
      return;
    }

    const atStart = viewport!.scrollLeft <= 1;
    const atEnd =
      viewport!.scrollLeft + viewport!.clientWidth >= viewport!.scrollWidth - 1;

    prev!.classList.toggle("hidden-arrow", atStart);
    next!.classList.toggle("hidden-arrow", atEnd);
  }

  prev.addEventListener("click", () => step(-1), { signal });
  next.addEventListener("click", () => step(1), { signal });
  viewport.addEventListener("scroll", syncArrows, { signal, passive: true });
  window.addEventListener("resize", syncArrows, { signal });

  // The menu is hidden at first paint, so widths read as 0 until it's shown.
  // A ResizeObserver catches that transition without polling.
  const observer = new ResizeObserver(() => syncArrows());
  observer.observe(viewport);

  syncArrows();

  return {
    detach(): void {
      listeners.abort();
      observer.disconnect();
    },
  };
}
