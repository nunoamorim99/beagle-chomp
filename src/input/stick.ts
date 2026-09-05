// OWNER: gameplay-engineer (IDEA-049 thumbstick)
//
// An on-screen THUMBSTICK — the third touch scheme, alongside swipe
// (src/input/touch.ts) and the D-pad (src/input/dpad.ts).
//
// WHY IT EXISTS, in Nuno's words after playing: swipe costs you the LIFT. Every
// turn is press → drag → release → press again, and the beagle is past the
// junction by the time the thumb is back down. The stick keeps the thumb ON the
// control between turns, so a change of direction is a roll of the thumb — the
// gesture starts already in contact and the direction fires the instant the
// ball crosses the gate. The D-pad also avoids the lift, but only by making the
// player aim at a 60px key each time; a stick you hold needs no aiming at all.
//
// Feeds the SAME queued-direction model as the keyboard, swipe and the pad, so
// no gameplay logic changes: game.ts just gets `onDir(d)` from a third source.
// `Entity.queued` PERSISTS until something overwrites it (see movement.ts), so
// this module emits only when the resolved direction CHANGES — a held stick
// keeps asking for its direction for free, and a turn refused at one junction
// is still waiting at the next.
//
// Deliberately three-free and DOM-only: this is input, not render. The feel
// lives in `resolveStickDir` below, which is pure and has no DOM in it at all
// so scripts/test-thumbstick.ts can exercise it in node.

import type { Vec2 } from "../game/grid";

export interface StickHandle {
  /** Show/hide without tearing down — same contract as the D-pad's. */
  setVisible: (visible: boolean) => void;
  detach: () => void;
}

/**
 * How far the ball must leave the centre, as a fraction of the throw radius,
 * before it asks for a direction at all.
 *
 * A real arcade stick has a physical dead zone — the shaft moves a few degrees
 * inside the restrictor before it closes a switch — and a virtual one needs the
 * same or a thumb resting still on the ball twitches the beagle. Kept small
 * (a third of the throw) because the whole point of this control is that a
 * turn starts the moment the thumb moves.
 */
export const STICK_DEAD_ZONE = 0.32;

/**
 * How much the new axis must beat the held one by, before the stick switches
 * to it. 1 would put the switch exactly on the 45° diagonal, where a thumb
 * held near the corner chatters between two cardinals several times a second —
 * and each of those is a queued direction the beagle may actually take at the
 * next junction, so the chatter is not cosmetic, it steers you into a ghost.
 *
 * 1.2 puts the switch at atan(1.2) = 50.2° from the held axis, so the diagonal
 * sits inside a ~5° band that has to be crossed decisively rather than being
 * the boundary itself. The gate is ONE-SIDED on purpose: it resists LEAVING the
 * direction you are holding, and never resists entering one from rest.
 */
export const STICK_SWITCH_RATIO = 1.2;

const UP: Vec2 = { x: 0, y: -1 };
const DOWN: Vec2 = { x: 0, y: 1 };
const LEFT: Vec2 = { x: -1, y: 0 };
const RIGHT: Vec2 = { x: 1, y: 0 };

/**
 * The whole feel of the control, as a pure function: where is the ball, and
 * what is it asking for?
 *
 * `dx`/`dy` are the ball's offset from the plate centre in pixels (screen axes,
 * so +y is DOWN), `radius` is the stick's full throw in the same units, and
 * `current` is the direction this stick last emitted — or null when the thumb
 * is not on it.
 *
 * Returns the cardinal now being asked for, or null for "asking for nothing"
 * (inside the dead zone, with nothing held to fall back on). Never returns a
 * diagonal: the beagle moves on a grid, so an in-between reading has to resolve
 * to one of four answers or it is noise.
 *
 * Two rules, and the asymmetry between them is the point:
 *   - Switching AXIS (up → left) is gated by STICK_SWITCH_RATIO, so a thumb
 *     wandering near the diagonal keeps what it has instead of flickering.
 *   - REVERSING along the same axis (up → down) is instant and ungated. The
 *     beagle turns around on the spot, it is the one input a player makes in a
 *     panic, and there is no diagonal near it to be ambiguous about.
 */
export function resolveStickDir(
  dx: number,
  dy: number,
  radius: number,
  current: Vec2 | null,
): Vec2 | null {
  // A zero/negative radius would make every position "outside the dead zone"
  // by division-by-zero. Treat a collapsed stick as untouched — this shows up
  // for real when the element is measured while still display:none.
  if (!(radius > 0)) return current;

  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const dist = Math.hypot(dx, dy);
  // A non-finite reading must not become a direction. Every comparison below is
  // FALSE against NaN, including the dead-zone test — so without this guard a
  // NaN pointer position falls all the way through to the last line and steers
  // the beagle up. Cheap, and the alternative is a bug that only ever appears
  // as "it turned on its own".
  if (!Number.isFinite(dist)) return current;
  if (dist < STICK_DEAD_ZONE * radius) return current;

  const wantsHorizontal = ax >= ay;

  // Hysteresis, but only against the axis actually being held.
  if (current) {
    const holdingHorizontal = current.x !== 0;
    if (wantsHorizontal !== holdingHorizontal) {
      const challenger = wantsHorizontal ? ax : ay;
      const incumbent = wantsHorizontal ? ay : ax;
      if (challenger < incumbent * STICK_SWITCH_RATIO) return current;
    }
  }

  if (wantsHorizontal) return dx > 0 ? RIGHT : LEFT;
  return dy > 0 ? DOWN : UP;
}

/** The engaged-gate class suffix for a direction — "up" | "down" | "left" |
 *  "right". Exported for the test, which checks the visual and the logic agree
 *  about which way the stick is pointing. */
export function stickGateName(dir: Vec2 | null): string | null {
  if (!dir) return null;
  if (dir.x > 0) return "right";
  if (dir.x < 0) return "left";
  if (dir.y > 0) return "down";
  if (dir.y < 0) return "up";
  return null;
}

const GATES = ["up", "down", "left", "right"] as const;

/**
 * Mount the thumbstick into `root`.
 *
 * The markup is a fixed capture pad (bigger than the plate, so a thumb landing
 * near the stick still grabs it) holding the plate, its four gate notches and
 * the ball. The ball is moved with a CSS custom property rather than by writing
 * `style.transform`, so the stylesheet keeps ownership of how it is drawn —
 * including its return-to-centre, which is a transition there and nothing here.
 */
export function attachStick(root: HTMLElement, onDir: (d: Vec2) => void): StickHandle {
  const pad = document.createElement("div");
  pad.className = "stick hidden";
  pad.setAttribute("role", "group");
  pad.setAttribute("aria-label", "Thumbstick");

  const plate = document.createElement("div");
  plate.className = "stick-plate";

  const gates: Record<string, HTMLElement> = {};
  for (const name of GATES) {
    const gate = document.createElement("span");
    gate.className = `stick-gate stick-gate-${name}`;
    gates[name] = gate;
    plate.appendChild(gate);
  }

  const well = document.createElement("span");
  well.className = "stick-well";
  plate.appendChild(well);

  const ball = document.createElement("span");
  ball.className = "stick-ball";
  plate.appendChild(ball);

  pad.appendChild(plate);
  root.appendChild(pad);

  // Live gesture state. `centre` is measured once per gesture: the plate is
  // position:fixed so it cannot move mid-drag, and re-measuring per pointermove
  // would be a forced layout on every frame of the one interaction that has to
  // stay smooth.
  let pointerId: number | null = null;
  let centreX = 0;
  let centreY = 0;
  let throwRadius = 0;
  let held: Vec2 | null = null;

  function setBall(dx: number, dy: number): void {
    plate.style.setProperty("--sx", `${dx.toFixed(1)}px`);
    plate.style.setProperty("--sy", `${dy.toFixed(1)}px`);
  }

  function setGate(dir: Vec2 | null): void {
    const name = stickGateName(dir);
    for (const gate of GATES) gates[gate].classList.toggle("on", gate === name);
    plate.classList.toggle("engaged", name !== null);
  }

  function release(): void {
    pointerId = null;
    // The ball springs back and the gates go dark, but the DIRECTION is not
    // cancelled: the beagle keeps the heading it was given, exactly as it does
    // when a swipe ends or an arrow key is let go. Clearing `held` means the
    // next gesture always re-emits its first direction rather than silently
    // agreeing with a stale one.
    held = null;
    setBall(0, 0);
    setGate(null);
    plate.classList.remove("grabbed");
  }

  function onPointerDown(e: PointerEvent): void {
    if (pointerId !== null) return; // one thumb at a time; ignore a second touch
    // Measured from the WELL, not the plate: the well is the recessed track
    // the ball rides in, and its rim is where the four gates sit. Taking the
    // throw from the plate instead would let the ball ride out over the gate it
    // is lighting. Both are concentric, so this gives the centre as well.
    //
    // Read from the DOM rather than duplicated from the stylesheet, so the
    // landscape and tutorial-diagram sizes need no second copy of the numbers
    // here — .stick-well's inset IS the feel, and it is set in one place.
    const box = well.getBoundingClientRect();
    if (box.width <= 0) return; // measured while hidden — nothing to steer with
    pointerId = e.pointerId;
    centreX = box.left + box.width / 2;
    centreY = box.top + box.height / 2;
    throwRadius = Math.max(1, (box.width - ball.getBoundingClientRect().width) / 2);
    plate.classList.add("grabbed");
    // Stops the press turning into a scroll/zoom or a long-press callout.
    e.preventDefault();
    try {
      pad.setPointerCapture?.(e.pointerId);
    } catch {
      /* ignore — the pointerId match below is what actually tracks the gesture */
    }
    move(e);
  }

  function move(e: PointerEvent): void {
    const dx = e.clientX - centreX;
    const dy = e.clientY - centreY;

    // The ball follows the thumb, clamped to the throw. Clamping rather than
    // letting it escape is what makes the control feel like a stick with a
    // restrictor plate rather than a dot being dragged around.
    const dist = Math.hypot(dx, dy);
    const scale = dist > throwRadius ? throwRadius / dist : 1;
    setBall(dx * scale, dy * scale);

    const next = resolveStickDir(dx, dy, throwRadius, held);
    if (!next) {
      setGate(null);
      return;
    }
    setGate(next);
    if (held && next.x === held.x && next.y === held.y) return;
    held = next;
    onDir(next);
  }

  function onPointerMove(e: PointerEvent): void {
    if (pointerId === null || e.pointerId !== pointerId) return;
    move(e);
  }

  function onPointerUp(e: PointerEvent): void {
    if (pointerId === null || e.pointerId !== pointerId) return;
    release();
  }

  // Belt and braces against page scroll under the thumb, same reasoning as
  // touch.ts: CSS touch-action:none already covers it, but Safari has
  // historically needed the JS-side veto too.
  function onTouchMove(e: TouchEvent): void {
    if (pointerId !== null) e.preventDefault();
  }

  pad.addEventListener("pointerdown", onPointerDown);
  pad.addEventListener("pointermove", onPointerMove);
  pad.addEventListener("pointerup", onPointerUp);
  pad.addEventListener("pointercancel", onPointerUp);
  pad.addEventListener("touchmove", onTouchMove, { passive: false });

  return {
    setVisible(visible: boolean): void {
      pad.classList.toggle("hidden", !visible);
      // Same switch the D-pad owns for itself: anything anchored to the bottom
      // of the screen (the power-up tray) needs to know a control is down
      // there. Each scheme owns its own class so nothing has to decide which
      // one is on — see the --bc-pad-block rules in style.css.
      document.body.classList.toggle("stick-on", visible);
      if (!visible) release();
    },
    detach(): void {
      pad.removeEventListener("pointerdown", onPointerDown);
      pad.removeEventListener("pointermove", onPointerMove);
      pad.removeEventListener("pointerup", onPointerUp);
      pad.removeEventListener("pointercancel", onPointerUp);
      pad.removeEventListener("touchmove", onTouchMove);
      pad.remove();
      document.body.classList.remove("stick-on");
    },
  };
}
