// OWNER: render-artist (temporary placeholder, IDEA-010 v2.0)
//
// TEMPORARY skin-cycle button (#skinBtn in index.html) — a placeholder until
// the real shop/skin-picker UI (IDEA-012) lands. Delete this file (and the
// #skinBtn markup/CSS) once that ships.
//
// Layering: mirrors src/ui/sound.ts's attachMuteButton structure exactly
// (resolve the button, throw if missing, addEventListener, return a detach
// fn) but stays three-free/pure-DOM like every other src/ui/* module —
// applying a skin to a THREE.Group belongs to src/render/characters.ts, and
// src/ui/* has no existing precedent for importing render/*. Rather than
// import applyBeagleSkin here, this module takes an `onChange` callback and
// leaves the actual mesh recolor to the caller (src/game/game.ts, which
// already imports both game/cosmetics.ts and render/characters.ts) — keeping
// the DOM-wiring / three-mutation split clean, same spirit as CLAUDE.md's
// "keep pure game logic free of any three import" rule for src/game/*.
import {
  cycleBeagleSkinId,
  getBeagleSkin,
  getEquippedBeagleSkinId,
  type BeagleSkin,
  cycleEnemySkinId,
  getEnemySkin,
  getEquippedEnemySkinId,
  type EnemySkin,
} from "../game/cosmetics";
import { equipBeagleSkin, equipEnemySkin } from "../game/profileStore";

/**
 * Wires the HUD's temporary skin-cycle button (`#skinBtn`) to the cosmetics
 * profile: on click, cycles to the next BEAGLE_SKINS entry, persists it via
 * `equipBeagleSkin` (survives reload), and calls `onChange(nextSkin)` so the
 * caller can live-recolor the actual beagle mesh (via
 * `applyBeagleSkin(beagleMesh, nextSkin)` in render/characters.ts). Call once
 * from Game's constructor, alongside attachMuteButton. Returns a detach
 * function for symmetry with attachMuteButton/attachKeyboard/attachTouch.
 */
export function attachSkinButton(root: ParentNode, onChange?: (skin: BeagleSkin) => void): () => void {
  const btn = (root.querySelector("#skinBtn") ?? document.getElementById("skinBtn")) as HTMLButtonElement | null;
  if (!btn) {
    throw new Error("attachSkinButton: missing #skinBtn — check index.html");
  }

  function render(skin: BeagleSkin): void {
    // Minimal reflection of the current skin — a tiny tooltip via the title
    // attribute (native browser tooltip, zero extra markup) plus keeping the
    // aria-label descriptive for screen readers. Kept deliberately light —
    // this whole button is a placeholder for the real shop UI.
    btn!.title = `Beagle skin: ${skin.name} (tap to change)`;
    btn!.setAttribute("aria-label", `Change beagle skin (currently ${skin.name})`);
  }

  function onClick(): void {
    const nextId = cycleBeagleSkinId(getEquippedBeagleSkinId());
    equipBeagleSkin(nextId);
    const nextSkin = getBeagleSkin(nextId);
    render(nextSkin);
    onChange?.(nextSkin);
  }

  render(getBeagleSkin(getEquippedBeagleSkinId())); // reflect the persisted state immediately on load
  btn.addEventListener("click", onClick);

  return () => btn.removeEventListener("click", onClick);
}

/**
 * Wires the HUD's temporary enemy-skin-cycle button (`#enemyBtn`) to the
 * cosmetics profile — mirrors attachSkinButton exactly, but for the enemy
 * (ghost/beetle) skin registry instead of the beagle's. On click, cycles to
 * the next ENEMY_SKINS entry, persists it via `equipEnemySkin` (survives
 * reload), and calls `onChange(nextId)` so the caller can rebuild the actual
 * enemy meshes (via `makeEnemy` in render/characters.ts — the enemy skin
 * swaps the creature's FORM, not just a color, so unlike the beagle this
 * can't be an in-place material recolor; game.ts's `rebuildEnemySkins`
 * handles that). Call once from Game's constructor, alongside
 * attachSkinButton. Returns a detach function for symmetry with the other
 * attach* helpers.
 */
export function attachEnemyButton(root: ParentNode, onChange?: (skin: EnemySkin) => void): () => void {
  const btn = (root.querySelector("#enemyBtn") ?? document.getElementById("enemyBtn")) as HTMLButtonElement | null;
  if (!btn) {
    throw new Error("attachEnemyButton: missing #enemyBtn — check index.html");
  }

  function render(skin: EnemySkin): void {
    btn!.title = `Enemy skin: ${skin.name} (tap to change)`;
    btn!.setAttribute("aria-label", `Change enemy skin (currently ${skin.name})`);
  }

  function onClick(): void {
    const nextId = cycleEnemySkinId(getEquippedEnemySkinId());
    equipEnemySkin(nextId);
    const nextSkin = getEnemySkin(nextId);
    render(nextSkin);
    onChange?.(nextSkin);
  }

  render(getEnemySkin(getEquippedEnemySkinId())); // reflect the persisted state immediately on load
  btn.addEventListener("click", onClick);

  return () => btn.removeEventListener("click", onClick);
}
