// OWNER: render-artist (IDEA-079)
//
// ONE SWITCH FOR THE REFERENCE MATERIAL SYSTEM, read once at module load.
//
// Its own file because BOTH halves of the style need it and they live on
// opposite sides of the app: `main.ts` lifts the theme palettes before anything
// reads one, and `game.ts` swaps materials as each level is built. A flag those
// two disagreed about would give a board whose walls were lifted and whose
// props were not, which looks like a tuning problem rather than a bug.
//
// READ ONCE, deliberately. Both halves have to see the same answer, and the
// palette lift is a one-way edit to the shared `MAZE_THEMES` entries — a value
// that changed mid-session would leave half the game lifted.
//
// `localStorage` here is the documented exception, exactly as `ambience.ts`'s
// volume is: this is a DEVICE-level look preference while the style is being
// judged, not game state, and every access degrades to "off" rather than to an
// error.

/**
 * THE NEW STYLE IS THE DEFAULT. Classic is the opt-out.
 *
 * It began behind an opt-in flag while it was being judged, and stayed there
 * through the board, the characters, the pickups, the menus, the shop, the
 * walls and the bounce. It is now what the game looks like — so a `false` here
 * has to be something a player CHOSE, not the absence of a choice.
 *
 * That inversion matters beyond the game: the EDITOR now previews in it by
 * default too. Nuno's point is the whole reason — *"how will I edit the
 * components if I cannot see the editor with the right materials?"* An editor
 * that shows a different art direction from the one that ships is a tool you
 * have to correct for in your head on every edit.
 *
 * Node has neither `location` nor `localStorage`, and a headless test asking
 * what the game looks like should get the same answer a player does, so the
 * catch returns the default rather than false.
 */
function read(): boolean {
  try {
    const q = new URLSearchParams(location.search).get("style");
    if (q === "madbox") {
      localStorage.removeItem("bc_style");
      return true;
    }
    if (q === "classic") {
      localStorage.setItem("bc_style", "classic");
      return false;
    }
    return localStorage.getItem("bc_style") !== "classic";
  } catch {
    return true;
  }
}

export const MADBOX_STYLE_ON = read();

/**
 * Switch the look and RELOAD.
 *
 * The reload is not laziness, it is the contract. `MADBOX_STYLE_ON` is read
 * ONCE at module load because both halves of the style have to agree about it,
 * and because the palette lift is a ONE-WAY edit to the shared `MAZE_THEMES`
 * entries — flipping it live would leave a board whose walls were lifted and
 * whose props were not, which looks like a tuning problem rather than a bug.
 *
 * Reloading also means the switch is honest about what it is: this is a whole
 * art direction, not a checkbox.
 */
export function setMadboxStyle(on: boolean): void {
  try {
    // The stored value is the OPT-OUT, so the default needs nothing stored —
    // and a device that has never chosen gets the current look rather than a
    // frozen copy of whatever was default when it last played.
    if (on) localStorage.removeItem("bc_style");
    else localStorage.setItem("bc_style", "classic");
  } catch {
    // A device that refuses storage simply cannot remember the choice; the
    // reload below still applies it for this session via the URL.
  }
  // The choice is written into the URL EXPLICITLY rather than just reloading.
  // Two reasons: it replaces any stale `?style=` that would otherwise outvote
  // the setting the player just made, and it is what carries the choice on a
  // device whose storage threw above — without it, that reload would land back
  // on the default and the toggle would look broken.
  location.href = location.pathname + (on ? "?style=madbox" : "?style=classic");
}
