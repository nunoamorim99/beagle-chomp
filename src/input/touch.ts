// OWNER: pwa-mobile-engineer
// Swipe-to-steer for phones. Contract: attachTouch(el, onDir). Detect the
// dominant axis of a swipe and emit the matching cardinal direction. Consider a
// small dead-zone and an optional on-screen d-pad fallback (see PROJECT_PLAN M5).
import { DIRS, Vec2 } from "../game/grid";

export function attachTouch(_el: HTMLElement, _onDir: (d: Vec2) => void): () => void {
  // TODO(pwa-mobile-engineer)
  void DIRS;
  return () => {};
}
