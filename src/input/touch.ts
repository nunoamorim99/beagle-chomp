// OWNER: pwa-mobile-engineer
// Swipe-to-steer for phones. Contract: attachTouch(el, onDir). Detect the
// dominant axis of a swipe and emit the matching cardinal direction. Consider a
// small dead-zone and an optional on-screen d-pad fallback (see PROJECT_PLAN M5).
//
// Mirrors src/input/keyboard.ts's shape (attach fn -> detach fn, calls
// onDir(d) with a DIRS value) but the input source is a swipe gesture instead
// of a keymap. DOM-only, no game internals beyond DIRS/Vec2 — kept three-free
// per CLAUDE.md's "src/game/* and src/input/* stay import-three-free" rule
// (this module isn't in src/game, but it composes with it, so the same
// discipline applies: only ../game/grid is imported).
import { DIRS, Vec2 } from "../game/grid";

// Minimum swipe distance (px) on the dominant axis before it counts as a
// steer instead of a tap/jitter. Small enough that a quick thumb-flick (e.g.
// steering away from a wall) reliably registers, big enough to still ignore
// a stationary tap or a couple pixels of finger tremor. Tuned down from 24
// after playtesting showed fast flicks under ~20px were being swallowed.
const DEAD_ZONE_PX = 14;

// A swipe re-emits mid-gesture once the finger has travelled this many
// *additional* pixels past the last emit point (nice-to-have continuous
// feel called out in the task; still gated by the same dominant-axis logic
// each time so a diagonal drag can't emit two different directions between
// re-checks). Tightened from 40 so a curving held-drag re-steers promptly.
const CONTINUOUS_STEP_PX = 22;

interface GestureState {
  startX: number;
  startY: number;
  lastEmitX: number;
  lastEmitY: number;
  hasEmitted: boolean;
  pointerId: number;
}

/** Picks the DIRS cardinal for whichever axis moved further, given a raw dx/dy. */
function dominantDir(dx: number, dy: number): Vec2 {
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx > 0 ? DIRS.right : DIRS.left;
  }
  // Screen Y grows downward, so a negative dy (finger moved up) is DIRS.up.
  return dy > 0 ? DIRS.down : DIRS.up;
}

/**
 * Attaches swipe-to-steer touch handling to `el` (typically the game canvas).
 * Emits a DIRS cardinal via `onDir` once a swipe crosses DEAD_ZONE_PX on its
 * dominant axis, then again every CONTINUOUS_STEP_PX travelled after that
 * while the same gesture continues (a held drag re-steers without lifting
 * the finger). Returns a detach function that removes every listener added.
 *
 * Fast-flick fallback: if a gesture ends (pointerup) having crossed
 * DEAD_ZONE_PX overall but never emitted mid-swipe (the whole flick landed
 * between move events), it emits once from the start->end delta so a quick
 * flick can never register as nothing — this is what makes a snappy turn
 * away from a wall (e.g. the ghost-pen wall) reliably register instead of
 * feeling "stuck".
 *
 * Uses Pointer Events (covers touch + mouse/pen in one API, and is what
 * modern iOS/Android Safari & Chrome support), plus `touchmove` with
 * `{ passive:false }` + `preventDefault` on the element itself as
 * belt-and-suspenders against page scroll/rubber-banding during a swipe —
 * CSS already sets touch-action:none/overscroll-behavior:none globally
 * (src/style.css), this just guarantees it even if that ever regresses.
 */
export function attachTouch(el: HTMLElement, onDir: (d: Vec2) => void): () => void {
  let gesture: GestureState | null = null;

  function onPointerDown(e: PointerEvent): void {
    // Only track one gesture at a time; ignore secondary touches (pinch etc.)
    if (gesture) return;
    gesture = {
      startX: e.clientX,
      startY: e.clientY,
      lastEmitX: e.clientX,
      lastEmitY: e.clientY,
      hasEmitted: false,
      pointerId: e.pointerId,
    };
    // Best-effort: some browsers/synthetic-event sources can reject capture
    // (e.g. NotFoundError if the pointer is no longer considered "active" by
    // the time this runs) — capture is a nicety for reliable move/up
    // delivery, not required for the swipe logic itself, so never let it
    // throw out of this handler.
    try {
      el.setPointerCapture?.(e.pointerId);
    } catch {
      /* ignore — gesture tracking continues via our own pointerId matching */
    }
  }

  function onPointerMove(e: PointerEvent): void {
    if (!gesture || e.pointerId !== gesture.pointerId) return;
    const dxTotal = e.clientX - gesture.startX;
    const dyTotal = e.clientY - gesture.startY;
    if (Math.max(Math.abs(dxTotal), Math.abs(dyTotal)) < DEAD_ZONE_PX) return;

    // Continuous re-steer: after the first emit, only fire again once the
    // finger has moved another CONTINUOUS_STEP_PX from the last emit point,
    // so a slow drag doesn't spam onDir every pixel.
    if (gesture.hasEmitted) {
      const dxSinceEmit = e.clientX - gesture.lastEmitX;
      const dySinceEmit = e.clientY - gesture.lastEmitY;
      if (Math.max(Math.abs(dxSinceEmit), Math.abs(dySinceEmit)) < CONTINUOUS_STEP_PX) return;
    }

    onDir(dominantDir(dxTotal, dyTotal));
    gesture.lastEmitX = e.clientX;
    gesture.lastEmitY = e.clientY;
    gesture.hasEmitted = true;
  }

  function endGesture(e: PointerEvent): void {
    if (!gesture || e.pointerId !== gesture.pointerId) return;
    // Fast-flick safety net: a very quick swipe can end (pointerup/cancel)
    // having crossed DEAD_ZONE_PX overall without ever having emitted mid-
    // gesture — e.g. all the travel arrived in a single coalesced pointermove
    // that fires after the up, or the up wins a race with a pending move on
    // some browsers/devices. Only fire on pointerup (not pointercancel,
    // which means the gesture was aborted, not completed) and only if
    // nothing already emitted this gesture, so a normal swipe that already
    // steered never double-turns here.
    if (e.type === "pointerup" && !gesture.hasEmitted) {
      const dxTotal = e.clientX - gesture.startX;
      const dyTotal = e.clientY - gesture.startY;
      if (Math.max(Math.abs(dxTotal), Math.abs(dyTotal)) >= DEAD_ZONE_PX) {
        onDir(dominantDir(dxTotal, dyTotal));
      }
    }
    gesture = null;
  }

  // preventDefault on touchmove is belt-and-suspenders: CSS touch-action:none
  // (src/style.css, on html/body and #scene) already stops browser gesture
  // handling, but Safari has historically needed the JS-side veto too to
  // fully suppress rubber-banding/scroll during a swipe.
  function onTouchMove(e: TouchEvent): void {
    if (gesture) e.preventDefault();
  }

  el.addEventListener("pointerdown", onPointerDown);
  el.addEventListener("pointermove", onPointerMove);
  el.addEventListener("pointerup", endGesture);
  el.addEventListener("pointercancel", endGesture);
  el.addEventListener("touchmove", onTouchMove, { passive: false });

  return () => {
    el.removeEventListener("pointerdown", onPointerDown);
    el.removeEventListener("pointermove", onPointerMove);
    el.removeEventListener("pointerup", endGesture);
    el.removeEventListener("pointercancel", endGesture);
    el.removeEventListener("touchmove", onTouchMove);
  };
}
