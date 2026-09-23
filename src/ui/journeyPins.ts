// OWNER: gameplay-engineer (IDEA-079)
//
// THE PIN LAYER — the level buttons on the island map, as ordinary HTML sitting
// over the WebGL canvas.
//
// ---------------------------------------------------------------------------
// WHY NOT SPRITES IN THE SCENE
// ---------------------------------------------------------------------------
//
// This is the madbox teardown's best structural idea and it is worth more HERE
// than it is there, because [[IDEA-048]] already gave this project a full 2D
// design system. Pins in HTML means locked / unlocked / current / cleared are
// CSS variants built from tokens we already own — the ink outline, the sunk
// bottom border, dim-by-paint, the icon plates — instead of four more shader
// paths and a texture atlas.
//
// It also keeps what `levelMap.ts` spent two revisions earning and what a 3D
// sprite would quietly throw away:
//   * real focus rings and a real keyboard tab order;
//   * screen-reader labels, on a screen whose whole job is saying what is where;
//   * text that stays sharp at any zoom, because it is text;
//   * a LOCKED pin that is still SELECTABLE ([[IDEA-063]] v2 — looking ahead is
//     what this screen is for), with the refusal said on the Play button rather
//     than by making the pin inert.
//
// The only cost is one `project()` per pin per frame, which is nothing.
//
// ---------------------------------------------------------------------------
// THE JS WRITES TWO NUMBERS; CSS DOES THE REST
// ---------------------------------------------------------------------------
//
// Per frame this module sets `--x` and `--y` custom properties and toggles a
// class. It never touches `transform`, colour, size or opacity — all of that
// lives in the stylesheet, keyed off the state classes, so the look can be
// retuned without going near the render loop. Writing a custom property is also
// dramatically cheaper than writing a full transform string forty times a
// frame, because it does not re-parse a declaration.
//
// No `three` import: positions arrive already projected. That keeps this in the
// DOM layer where the rest of src/ui lives.

export type PinState = "locked" | "current" | "unlocked" | "cleared";

export interface PinLevel {
  /** Stable id, used as the DOM id and handed back on select. */
  id: string;
  /** 1-based number shown on the pin. */
  number: number;
  /** The level's own name — "Classic Garden", "The Back Garden". The teardown
   *  calls naming "most of why the map feels like a place rather than a menu",
   *  and journey.ts has carried these since IDEA-063. */
  name: string;
  state: PinState;
}

export interface ProjectedPoint {
  x: number;
  y: number;
  onScreen: boolean;
  /** World units from the camera. */
  distance: number;
}

export interface JourneyPinsOptions {
  levels: readonly PinLevel[];
  /** World-to-screen for pin `i`, in CSS pixels. */
  project: (index: number) => ProjectedPoint;
  /** True while the map is being dragged — pins fade out, because a surface you
   *  are dragging should not also be offering buttons under your thumb. */
  isDragging: () => boolean;
  onSelect: (level: PinLevel, index: number) => void;
  /**
   * The distance band, in world units, over which a pin recedes: at `near` it is
   * full size, past `far` it is dropped entirely.
   *
   * NOT a style choice, and the NEAR end is the half people get wrong. The
   * camera looks well past its own position, so NOTHING in frame is ever close
   * to zero units away — normalising from the camera instead of from the front
   * of the frame makes every pin on screen read as distant at once. Measure the
   * band against what is actually visible.
   *
   * Dropping the far ones matters because the chain compresses toward the
   * horizon: beyond a few islands six labels land in the same forty pixels.
   */
  fade?: { near: number; far: number };
  /**
   * Keep a pin this many CSS pixels clear of the viewport edge.
   *
   * The chain meanders in x, so an island near the frame edge projects a pin
   * that hangs off it — and a label reading "e Hedge Spiral" is worse than one
   * sitting a few pixels off its island. The nudge is bounded by the pin's own
   * half-width, so it never travels far enough to point at a neighbour.
   */
  edgeMargin?: number;
}

export interface JourneyPinsHandle {
  /** Call once per frame, after the camera has been updated. */
  update: () => void;
  /** Re-paint the states without rebuilding the DOM — for when progress changes
   *  under an open map. */
  setStates: (states: readonly PinState[]) => void;
  /** Which pin is selected, or null. Drawn as a class, not a second element. */
  setSelected: (id: string | null) => void;
  detach: () => void;
}

export function attachJourneyPins(
  root: HTMLElement,
  opts: JourneyPinsOptions,
): JourneyPinsHandle {
  const list = document.createElement("ul");
  list.className = "jp-list";
  // The list itself takes no pointer events so a drag passes through to the
  // canvas; only the buttons take them back. Without this the map is dead
  // wherever a pin happens to be, which on a dense chain is most of the screen.
  list.style.pointerEvents = "none";

  const items: HTMLLIElement[] = [];
  const buttons: HTMLButtonElement[] = [];
  const live = new AbortController();

  opts.levels.forEach((level, i) => {
    const li = document.createElement("li");
    li.className = "jp-item";
    li.id = `jp-${level.id}`;
    // --index drives a staggered entry animation entirely in CSS.
    li.style.setProperty("--index", String(i));

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "jp-pin";
    btn.style.pointerEvents = "auto";
    // textContent, not innerHTML: these are our own strings today, and the one
    // screen that renders other people's is the leaderboard — but a pin layer
    // is exactly the kind of thing that later gets handed a name from data.
    const num = document.createElement("span");
    num.className = "jp-num";
    num.textContent = String(level.number);
    const label = document.createElement("span");
    label.className = "jp-label";
    label.textContent = level.name;
    btn.append(num, label);

    // The accessible name carries the state, because the visual difference
    // between locked and unlocked is paint and paint is not announced.
    btn.setAttribute("aria-label", `${level.number}. ${level.name}`);
    btn.addEventListener("click", () => opts.onSelect(level, i), { signal: live.signal });

    li.append(btn);
    list.append(li);
    items.push(li);
    buttons.push(btn);
  });

  root.append(list);

  // Measured against the shipped rig: the near edge of frame sits ~20 units out
  // and the chain is 7 apart, so this band covers about five islands.
  const fade = opts.fade ?? { near: 22, far: 62 };
  const edgeMargin = opts.edgeMargin ?? 8;
  let states: PinState[] = opts.levels.map((l) => l.state);
  let selected: string | null = null;

  function paint(): void {
    opts.levels.forEach((level, i) => {
      const li = items[i];
      const st = states[i];
      li.classList.toggle("is-locked", st === "locked");
      li.classList.toggle("is-current", st === "current");
      li.classList.toggle("is-cleared", st === "cleared");
      li.classList.toggle("is-selected", level.id === selected);
      // NOT aria-disabled and NOT tabindex -1: a locked pin is a control that
      // DOES something (it fills the panel), and only Play refuses. IDEA-063 v2
      // learned this the hard way — early-returning on a locked stone left a
      // new player with thirty-nine padlocks and nothing behind any of them.
      buttons[i].setAttribute(
        "aria-label",
        st === "locked"
          ? `${level.number}. ${level.name}, locked`
          : `${level.number}. ${level.name}`,
      );
    });
  }
  paint();

  let wasDragging = false;

  function update(): void {
    const dragging = opts.isDragging();
    if (dragging !== wasDragging) {
      list.classList.toggle("is-dragging", dragging);
      wasDragging = dragging;
    }

    for (let i = 0; i < items.length; i++) {
      const p = opts.project(i);
      const li = items[i];
      if (!p.onScreen) {
        // `visible` is a class rather than a style write, so the fade is CSS's
        // business. Skipping the position write for an off-screen pin also
        // means the numbers never carry the nonsense a behind-camera projection
        // produces.
        if (li.classList.contains("is-visible")) li.classList.remove("is-visible");
        continue;
      }
      if (p.distance > fade.far) {
        if (li.classList.contains("is-visible")) li.classList.remove("is-visible");
        continue;
      }
      // Nudged in off the edge, never more than half its own width, so a pin at
      // the side of the frame stays readable without being dragged onto its
      // neighbour's island. Measured from the BUTTON, because the li has no
      // width of its own.
      const halfW = buttons[i].offsetWidth / 2;
      const lo = Math.min(edgeMargin + halfW, p.x + halfW);
      const hi = Math.max(window.innerWidth - edgeMargin - halfW, p.x - halfW);
      const x = Math.min(Math.max(p.x, lo), hi);
      // Rounded: a pin at x = 193.4718 forces sub-pixel compositing every frame
      // for a position nobody can see the difference in.
      li.style.setProperty("--x", `${Math.round(x)}px`);
      li.style.setProperty("--y", `${Math.round(p.y)}px`);
      // Handed to CSS as a number so the shrink-and-fade with distance is the
      // stylesheet's business, not the render loop's.
      const d = Math.min(1, Math.max(0, (p.distance - fade.near) / (fade.far - fade.near)));
      li.style.setProperty("--depth", d.toFixed(3));
      // THE NAME IS WHAT COLLIDES, NOT THE PIN. Past halfway the label is
      // dropped and the pin collapses to its number badge — the chain is
      // compressing toward the horizon, so the names are the first thing to
      // stop fitting and the last thing a player needs at that distance.
      const far = d > 0.5;
      if (far !== li.classList.contains("is-far")) li.classList.toggle("is-far", far);
      if (!li.classList.contains("is-visible")) li.classList.add("is-visible");
    }
  }

  return {
    update,
    setStates(next: readonly PinState[]): void {
      states = [...next];
      paint();
    },
    setSelected(id: string | null): void {
      selected = id;
      paint();
    },
    detach(): void {
      live.abort();
      list.remove();
    },
  };
}
