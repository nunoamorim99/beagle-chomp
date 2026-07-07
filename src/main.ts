// App entry. Registers the PWA service worker (via vite-plugin-pwa) and boots
// the game. The install prompt UX is owned by pwa-mobile-engineer.
import "./style.css";
import { registerSW } from "virtual:pwa-register";
import { Game } from "./game/game";
import { initInstallPrompt } from "./ui/install";

registerSW({ immediate: true });
initInstallPrompt();

const canvas = document.getElementById("scene") as HTMLCanvasElement;
const game = new Game(canvas);
game.start();

// Mobile URL-bar show/hide (and, on some browsers, pinch/orientation) change
// window.innerHeight without firing a plain 'resize' — visualViewport is the
// event that actually fires there. src/render/scene.ts already owns the
// camera-fit math and listens for window 'resize'; re-dispatch that same
// event instead of duplicating the fit logic here (least coupling — scene.ts
// stays the single place that recomputes the camera framing).
function triggerResize(): void {
  window.dispatchEvent(new Event("resize"));
}
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", triggerResize);
  window.visualViewport.addEventListener("scroll", triggerResize);
}
// Fires before layout has settled on some mobile browsers; a microtask-delayed
// follow-up re-fit catches the final post-rotation dimensions.
window.addEventListener("orientationchange", () => {
  triggerResize();
  setTimeout(triggerResize, 120);
});
