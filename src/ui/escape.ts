// OWNER: gameplay-engineer (IDEA-019/IDEA-020)
//
// HTML escaping for any string that did not originate in this codebase.
//
// Why this exists: every full-screen page in src/ui/* renders by assigning
// innerHTML (shop.ts, levelMap.ts, hud.showPanel). That was entirely safe while
// every interpolated value was a hardcoded constant. With accounts and a shared
// leaderboard, OTHER PLAYERS' USERNAMES now enter that pipeline — the first
// server-controlled, user-authored strings the UI has ever rendered.
//
// Defence in depth, three layers:
//   1. The server's username regex (^[A-Za-z0-9_-]{3,20}$) makes markup
//      impossible to store in the first place. That is the real fix.
//   2. This helper, applied to every remote string anyway — because a future
//      relaxation of that regex should not silently become an XSS hole.
//   3. leaderboard.ts builds its rows with createElement + textContent rather
//      than innerHTML, so the one screen carrying other users' data has no
//      injection surface at all.

/** Escape the five characters that matter in HTML text and attribute contexts.
 *
 *  Ampersand must be replaced FIRST — doing it later would double-escape the
 *  entities introduced by the other replacements (`<` → `&lt;` → `&amp;lt;`). */
export function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
