// App entry. Registers the PWA service worker (via vite-plugin-pwa) and boots
// the game. The install prompt UX is owned by pwa-mobile-engineer.
import "./style.css";
import { registerSW } from "virtual:pwa-register";
import { Game } from "./game/game";

registerSW({ immediate: true });

const canvas = document.getElementById("scene") as HTMLCanvasElement;
const game = new Game(canvas);
game.start();
