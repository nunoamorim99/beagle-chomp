// OWNER: gameplay-engineer (IDEA-038 optional on-screen D-pad)
//
// An on-screen direction pad, offered as an ALTERNATIVE to swipe on touch
// devices. Nuno watched people play on phones with poor screens and found the
// swipe gesture frustrating — this gives those players something to press.
//
// Swipe (src/input/touch.ts) stays the default and is unchanged. Which one is
// active is a per-ACCOUNT preference (profileStore's `controlScheme`), so it
// follows the player to any device they sign in from.
//
// Feeds the SAME queued-direction model the keyboard and swipe already use, so
// no gameplay logic changes at all — game.ts just gets `onDir(d)` from a
// different source.
//
// Deliberately three-free and DOM-only: this is input, not render.

import type { Vec2 } from "../game/grid";

export interface DpadHandle {
  /** Show/hide without tearing down — the pad is hidden on the menu and while
   *  any full-screen page is open, then shown again for the next run. */
  setVisible: (visible: boolean) => void;
  detach: () => void;
}

const DIRECTIONS: Array<{ id: string; label: string; dir: Vec2; aria: string }> = [
  { id: "dpadUp", label: "▲", dir: { x: 0, y: -1 }, aria: "Move up" },
  { id: "dpadLeft", label: "◀", dir: { x: -1, y: 0 }, aria: "Move left" },
  { id: "dpadRight", label: "▶", dir: { x: 1, y: 0 }, aria: "Move right" },
  { id: "dpadDown", label: "▼", dir: { x: 0, y: 1 }, aria: "Move down" },
];

/**
 * Mount the D-pad into `root`.
 *
 * `onDir` receives the pressed direction; the game queues it exactly as it
 * queues a swipe or an arrow key, so the beagle turns at the next tile
 * boundary rather than snapping.
 */
export function attachDpad(root: HTMLElement, onDir: (d: Vec2) => void): DpadHandle {
  const pad = document.createElement("div");
  pad.className = "dpad hidden";
  pad.setAttribute("role", "group");
  pad.setAttribute("aria-label", "Direction pad");

  for (const { id, label, dir, aria } of DIRECTIONS) {
    const button = document.createElement("button");
    button.type = "button";
    button.id = id;
    button.className = `dpad-btn dpad-${id.replace("dpad", "").toLowerCase()}`;
    button.textContent = label;
    button.setAttribute("aria-label", aria);

    // pointerdown, not click: a direction should register the instant the
    // finger lands. Waiting for a full press-and-release adds latency the
    // player feels as the beagle "not responding".
    const press = (event: PointerEvent): void => {
      // Stops the browser turning the press into a scroll/zoom gesture, and
      // stops a synthetic click firing afterwards.
      event.preventDefault();
      onDir(dir);
    };
    button.addEventListener("pointerdown", press);

    // Holding a direction should keep steering: the beagle takes the turn at
    // the next junction it reaches, which is what a player expects from a
    // held button. Re-queueing on enter covers a thumb sliding across the pad.
    button.addEventListener("pointerenter", (event) => {
      if (event.buttons > 0) onDir(dir);
    });

    // Belt and braces for browsers that still synthesise touch events —
    // without this the page can scroll under the pad on older Safari.
    button.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });

    pad.appendChild(button);
  }

  root.appendChild(pad);

  return {
    setVisible(visible: boolean): void {
      pad.classList.toggle("hidden", !visible);
    },
    detach(): void {
      pad.remove();
    },
  };
}
