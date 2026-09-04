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
import { ICON, icon } from "../ui/icons";

export interface DpadHandle {
  /** Show/hide without tearing down — the pad is hidden on the menu and while
   *  any full-screen page is open, then shown again for the next run. */
  setVisible: (visible: boolean) => void;
  detach: () => void;
}

// The glyphs are Material Symbols chevrons rather than the geometric-shape
// characters (▲◀▶▼) this used to carry. Those are text, so they picked up
// whatever the platform's fallback font decided — three different weights on
// three different phones — and at 60px they rendered as flat wedges, which is
// the one thing a key on a toon board must not look like.
const DIRECTIONS: Array<{ id: string; glyph: string; dir: Vec2; aria: string }> = [
  { id: "dpadUp", glyph: ICON.up, dir: { x: 0, y: -1 }, aria: "Move up" },
  { id: "dpadLeft", glyph: ICON.left, dir: { x: -1, y: 0 }, aria: "Move left" },
  { id: "dpadRight", glyph: ICON.right, dir: { x: 1, y: 0 }, aria: "Move right" },
  { id: "dpadDown", glyph: ICON.down, dir: { x: 0, y: 1 }, aria: "Move down" },
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

  for (const { id, glyph, dir, aria } of DIRECTIONS) {
    const button = document.createElement("button");
    button.type = "button";
    button.id = id;
    button.className = `dpad-btn dpad-${id.replace("dpad", "").toLowerCase()}`;
    button.appendChild(icon(glyph));
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
      // `body.dpad-on` lets anything else anchored to the bottom of the screen
      // get out of the pad's way — currently the power-up tray, which sits
      // just above it (see .powerups in style.css). Toggled HERE rather than
      // in game.ts because this module already owns "is the pad on screen",
      // and two places deciding that is how they drift apart.
      document.body.classList.toggle("dpad-on", visible);
    },
    detach(): void {
      pad.remove();
      document.body.classList.remove("dpad-on");
    },
  };
}
