// OWNER: gameplay-engineer (structure) + render-artist (polish)
// Score / map / lives HUD and centre banners (Ready!, Map Cleared!, Game Over).
// Keep DOM overlay separate from the canvas. Contract below.
export interface Hud {
  setScore(n: number): void;
  setLevel(label: string): void;
  setLives(n: number): void;
  showBanner(text: string): void;
  showPanel(html: string): HTMLElement;
  hideCenter(): void;
}

export function createHud(_root: HTMLElement): Hud {
  // TODO: port the HUD/overlay from /prototype (section 9).
  throw new Error("createHud not implemented — see /prototype");
}
