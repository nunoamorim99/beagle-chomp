// OWNER: ui (design system §03 — Icons)
//
// One icon family for the whole interface: Material Symbols Rounded, FILL 1,
// wght 700, loaded once in index.html.
//
// WHY THIS MODULE EXISTS. Before it, chrome glyphs were emoji written inline
// at ~20 call sites. Emoji leave the interface at the mercy of each platform's
// font — a coin and a dog render differently on iOS, Android and Chrome, and
// none of the three matched a toon beagle. Worse, they carry their own colour,
// so they could never take part in the ink-outline language the rest of the
// design system is built on.
//
// TWO SHAPES, deliberately:
//
//   icon()  — a chrome glyph. Inherits its size and colour from whatever it
//             sits in, so it stays optically matched to the text beside it.
//
//   plate() — a GAME OBJECT (coin, biscuit, bone, life, fruit, power-up).
//             A lit coloured square with the ink outline and bottom edge,
//             because these are things you collect in the maze two inches
//             away, not bullet points. §03: "Fill comes from the object's own
//             3D colour; the glyph takes the darkest tone of that hue."
//
// Both come in a DOM form and an HTML-string form, because the UI modules are
// split between createElement (leaderboard, hud, dpad — anywhere player-authored
// strings are involved) and template literals (game-over panels, profile).
// The string forms take names from the frozen table below only, so neither can
// become an injection route.
//
// Deliberately three-free and dependency-free: this is presentation, and it is
// imported by modules that must stay cheap.

/**
 * Every glyph the interface is allowed to use, by ROLE rather than by icon
 * name — call sites say `ICON.back`, not `"arrow_back"`, so swapping the
 * drawing of a role is one edit here.
 *
 * Names are Material Symbols ligatures and were checked against the family's
 * own codepoints list; an unknown name does not fall back, it renders as the
 * literal word.
 */
export const ICON = {
  // ---- navigation / chrome ----
  play: "play_arrow",
  replay: "replay",
  pause: "pause",
  menu: "home",
  back: "arrow_back",
  prev: "chevron_left",
  next: "chevron_right",
  close: "close",
  settings: "settings",
  info: "info",
  error: "error",
  offline: "wifi_off",
  copy: "content_copy",
  key: "key",
  /** The auth screens: a name badge, a recovery key, a reveal toggle. */
  username: "badge",
  recoveryKey: "vpn_key",
  reveal: "visibility",
  check: "check",
  lock: "lock",
  logout: "logout",
  delete: "delete",
  install: "download",

  // ---- destinations ----
  challenge: "trophy",
  shop: "storefront",
  board: "leaderboard",
  account: "person",
  themes: "park",
  enemies: "sentiment_very_dissatisfied",
  beagle: "pets",

  // ---- input ----
  swipe: "swipe",
  dpad: "stadia_controller",
  /** IDEA-049. A real Material Symbols name, verified the only way that
   *  actually proves it: the 47-name subset came back 272 bytes heavier than
   *  the 46-name one, where a name the family does not have adds 24 bytes of
   *  ligature string and no outline at all. */
  stick: "joystick",
  up: "keyboard_arrow_up",
  down: "keyboard_arrow_down",
  left: "keyboard_arrow_left",
  right: "keyboard_arrow_right",

  // ---- sound ----
  soundOn: "volume_up",
  soundOff: "volume_off",

  // ---- game objects (also the plate glyphs) ----
  coin: "paid",
  biscuit: "cookie",
  bone: "pets",
  life: "favorite",
  fruit: "nutrition",
  power: "bolt",
  shield: "shield",
  star: "star",
  anchor: "anchor",
  trophy: "trophy",
  medal: "military_tech",
} as const;

export type IconName = (typeof ICON)[keyof typeof ICON];

/** The object kinds that have a plate colour in tokens.css. */
export type PlateKind =
  | "coin"
  | "biscuit"
  | "bone"
  | "life"
  | "fruit"
  | "power"
  | "trophy";

/** Which framing a plate is drawn at — §03: "52px on menus, 34px in the HUD,
 *  26px inline". */
export type PlateSize = "menu" | "hud" | "inline";

const PLATE_GLYPH: Record<PlateKind, string> = {
  coin: ICON.coin,
  biscuit: ICON.biscuit,
  bone: ICON.bone,
  life: ICON.life,
  fruit: ICON.fruit,
  power: ICON.power,
  trophy: ICON.trophy,
};

/**
 * A chrome glyph as a DOM node.
 *
 * Always `aria-hidden`: an icon is never the accessible name. Every call site
 * pairs it with real text or gives the surrounding control an `aria-label` —
 * a screen reader that announced "play_arrow" would be worse than one that
 * announced nothing.
 */
export function icon(name: string, className?: string): HTMLElement {
  const el = document.createElement("i");
  el.className = className ? `bc-i ${className}` : "bc-i";
  el.setAttribute("aria-hidden", "true");
  el.textContent = name;
  return el;
}

/**
 * Swap the glyph inside a control that already has one (the mute button, the
 * pause button).
 *
 * The rule this exists to enforce: an icon element carries its LIGATURE NAME
 * as its text, so writing `host.textContent = ICON.pause` on the BUTTON
 * destroys the `<i>` and leaves the word "pause" printed on it. Every caller
 * therefore has to write into the inner element instead — and if that element
 * is missing (markup drift, a stale cached index.html), the honest response is
 * to CREATE it, not to fall back to the host and print the name.
 *
 * That fallback is not hypothetical: a stale document served from the PWA
 * cache, paired with current JS, is exactly how buttons ended up reading
 * "volume_up" and "play_arrow" in a bug report.
 */
export function setGlyph(host: Element, name: string): void {
  const existing = host.querySelector<HTMLElement>(".bc-i");
  if (existing) {
    existing.textContent = name;
    return;
  }
  host.textContent = "";
  host.appendChild(icon(name));
}

/**
 * The same glyph as an HTML string, for the modules that build panels from
 * template literals.
 *
 * `name` is a ligature from ICON above — a fixed vocabulary of letters and
 * underscores — so this cannot carry markup even though it is concatenated
 * into innerHTML. The guard below makes that structural rather than a
 * convention someone has to remember.
 */
export function iconHtml(name: string, className?: string): string {
  const cls = className ? `bc-i ${className}` : "bc-i";
  return `<i class="${cls}" aria-hidden="true">${safeName(name)}</i>`;
}

/** An icon plate (a game object) as a DOM node. */
export function plate(
  kind: PlateKind,
  size: PlateSize = "menu",
  className?: string,
): HTMLElement {
  const el = document.createElement("span");
  el.className = plateClass(kind, size, className);
  el.setAttribute("aria-hidden", "true");
  el.appendChild(icon(PLATE_GLYPH[kind]));
  return el;
}

/** An icon plate as an HTML string. */
export function plateHtml(
  kind: PlateKind,
  size: PlateSize = "menu",
  className?: string,
): string {
  return (
    `<span class="${plateClass(kind, size, className)}" aria-hidden="true">` +
    iconHtml(PLATE_GLYPH[kind]) +
    `</span>`
  );
}

function plateClass(kind: PlateKind, size: PlateSize, extra?: string): string {
  const sizeCls = size === "menu" ? "" : ` bc-plate--${size}`;
  return `bc-plate bc-plate--${kind}${sizeCls}${extra ? ` ${extra}` : ""}`;
}

/** Strips anything that is not a ligature character. Belt and braces for the
 *  string forms above — see iconHtml's comment. */
function safeName(name: string): string {
  return name.replace(/[^a-z0-9_]/gi, "");
}
