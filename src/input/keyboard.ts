// OWNER: gameplay-engineer
// Maps Arrow/WASD to a queued direction. Contract: attachKeyboard(onDir).
import { DIRS, Vec2 } from "../game/grid";

export function attachKeyboard(onDir: (d: Vec2) => void): () => void {
  const map: Record<string, Vec2> = {
    ArrowUp: DIRS.up, KeyW: DIRS.up, ArrowDown: DIRS.down, KeyS: DIRS.down,
    ArrowLeft: DIRS.left, KeyA: DIRS.left, ArrowRight: DIRS.right, KeyD: DIRS.right,
  };
  const handler = (e: KeyboardEvent) => {
    const d = map[e.code];
    if (d) { e.preventDefault(); onDir(d); }
  };
  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}
