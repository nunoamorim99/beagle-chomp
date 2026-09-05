// OWNER: render-artist (IDEA-012 shop UI; IDEA-023 shop v2 page rework;
// IDEA-026 extends this with a third "Themes" tab)
//
// The real skin-picker UI: a full-screen dedicated PAGE (not an overlay panel
// — see IDEA-023) where the player spends coins (earned via IDEA-017 —
// maze pickups, the only source since IDEA-016 v2 removed the points
// conversion that had made everything here affordable in a run or two --
// IDEA-017) to unlock beagle/enemy skins and maze themes (IDEA-026), then
// equips them, browsing via a tab bar (Beagle Skins | Enemy Skins | Themes)
// plus a live 3D hero turntable (src/render/shopScene.ts, driven through the
// onPreview callback below) and a horizontally-scrollable card rail —
// character-select style. Replaces the v1 grid-of-cards overlay panel; the
// buy/equip DATA layer underneath is unchanged from v1.
//
// Three-free/pure-DOM, same split as every other src/ui/* module (mirrors
// src/ui/skin.ts's own doc comment): applying a skin to a THREE.Group/
// swapping the shop's 3D hero preview (INCLUDING re-theming the hero stage's
// board/scene for a theme card, IDEA-026) belongs to src/render/shopScene.ts
// + src/game/game.ts, so this module takes `onEquipBeagle`/`onEquipEnemy`/
// `onThemeChanged`/`onPreview` callbacks and leaves all mesh/scene work to the
// caller — this module never imports `three` or src/render/shopScene.ts's
// `ShopScene` type; `onPreview`'s `kind` + `id` is all the caller needs to
// decide whether to call showBeagle/showEnemy/showTheme on its own handle.
// All buy/equip/ownership operations go THROUGH src/game/profileStore.ts's
// API — this module never mutates coins/ownership itself, only reads live
// state to render + calls the guarded buy*/equip* functions.
import {
  BEAGLE_SKINS,
  ENEMY_SKINS,
  getEquippedBeagleSkinId,
  getEquippedEnemySkinId,
  visibleEnemySkins,
  TRIBUTE_BEAGLE_SKIN_ID,
  type BeagleSkin,
  type EnemySkin,
} from "../game/cosmetics";
import { MAZE_THEMES, getEquippedMazeThemeId, type MazeTheme } from "../game/themes";
import { ICON, iconHtml, plateHtml } from "./icons";
import {
  getCoins,
  isBeagleSkinOwned,
  isEnemySkinOwned,
  isMazeThemeOwned,
  buyBeagleSkin,
  buyEnemySkin,
  buyMazeTheme,
  equipBeagleSkin,
  equipEnemySkin,
  equipMazeTheme,
} from "../game/profileStore";

type TabKind = "beagle" | "enemy" | "theme";

/** A card shown in the shop rail: a BeagleSkin, an EnemySkin, or a
 *  MazeTheme (IDEA-026) — all three share the `{ id, name, price }` shape
 *  this module reads generically (see renderRailCard/renderHeroInfo), plus
 *  their own kind-specific data (coat / (icon-by-id) / palette) read only by
 *  the matching swatch builder. */
type ShopItem = BeagleSkin | EnemySkin | MazeTheme;

export interface ShopCallbacks {
  /** Fired right after a beagle skin is successfully equipped, so the caller
   *  can live-recolor the actual beagle mesh (applyBeagleSkin). */
  onEquipBeagle?: (skin: BeagleSkin) => void;
  /** Fired right after an enemy skin is successfully equipped, so the caller
   *  can rebuild the actual enemy meshes (rebuildEnemySkins). */
  onEquipEnemy?: (skin: EnemySkin) => void;
  /** IDEA-026: fired right after a maze theme is successfully equipped, so
   *  the caller can live-retheme the actual in-game scene/board
   *  (applySceneTheme/applyBoardTheme). Mirrors onEquipBeagle/onEquipEnemy
   *  exactly, one per tab kind. */
  onThemeChanged?: (theme: MazeTheme) => void;
  /** Fired right after any successful purchase (beagle skin, enemy skin, or
   *  maze theme — IDEA-026), so the caller can re-sync the HUD's own coin
   *  counter (`hud.setCoins(getCoins())`) — the shop page's own header
   *  balance already re-renders itself from live state on every action, but
   *  the HUD stat lives outside the shop page and would otherwise stay stale
   *  until the next in-game coin event. Not fired on a failed buy
   *  (insufficient funds/unknown id) since the wallet is unchanged in that
   *  case. */
  onCoinsChanged?: () => void;
  /** Fired when the shop page closes (back button), so a caller that renders
   *  its own coin display *underneath* the shop (IDEA-021's main menu) can
   *  refresh it — the player can only SPEND in the shop, never earn, but a
   *  purchase there does change the wallet the menu displayed before the shop
   *  opened. Not fired by anything else (e.g. never on open). */
  onClose?: () => void;
  /** IDEA-023: fired right when the shop page opens (before the first
   *  onPreview fires), so the caller can e.g. pause the game / swap the
   *  rendered scene to the shop's own 3D showcase (createShopScene()). */
  onOpen?: () => void;
  /** IDEA-023: fired whenever the shop's selection changes to a specific
   *  skin/theme — on open (the equipped item of the default tab), on a tab
   *  switch (the equipped item of the newly-active tab), and on every card
   *  tap (that card's item) — so the caller can drive the live 3D hero
   *  preview (shopScene.showBeagle/showEnemy/showTheme — IDEA-026 adds the
   *  "theme" kind). NOT fired after an equip of the already-selected card
   *  (see the task brief: "equipping the SELECTED skin doesn't need a
   *  preview rebuild, same model already shown"). */
  onPreview?: (kind: TabKind, id: string) => void;
}

/** Return shape of {@link attachShop}: `open()` lets any other UI (the main
 *  menu's Shop carousel card, IDEA-036) open the shop page,
 *  without synthesizing a click on that button; `detach()` is the usual
 *  teardown, same as every other attach* helper's return value; `isOpen()`
 *  (IDEA-023) lets the caller's frame loop branch on shop state (pausing
 *  gameplay while the page is up) without duplicating this module's own
 *  open/closed bookkeeping. */
export interface ShopHandle {
  /** Opens the shop page (re-renders it fresh first, so balance/ownership are
   *  always current), defaulting to the "beagle" tab with the equipped skin
   *  selected. */
  open: () => void;
  /** Unwires the HUD button listener and clears the page's contents. */
  detach: () => void;
  /** Whether the shop page is currently showing. */
  isOpen: () => boolean;
}

/** One icon per enemy skin id — purely decorative labelling for the shop card
 *  (enemy skins have no color data to swatch; see cosmetics.ts's EnemySkin doc
 *  comment). Falls back to the generic enemy face for any future id that isn't
 *  listed here, so a new skin never renders with no icon at all.
 *
 *  These were emoji (👻🪲🐝🐞). The bug and ladybug in particular rendered as
 *  full-colour cartoons in a completely different drawing style from the toon
 *  meshes they were labelling, and each platform drew its own. Material
 *  Symbols gives four monochrome glyphs that take the card's own colour. */
const ENEMY_ICONS: Record<string, string> = {
  ghost: ICON.enemies,
  beetle: "pest_control",
  bee: "hive",
  ladybug: "bug_report",
};

function enemyIcon(id: string): string {
  return ENEMY_ICONS[id] ?? ICON.enemies;
}

/** Converts a cosmetics hex color number (e.g. 0xc98a3c) to a CSS color string. */
function hexToCss(n: number): string {
  return `#${n.toString(16).padStart(6, "0")}`;
}

function getBeagleSkinById(id: string): BeagleSkin {
  return BEAGLE_SKINS.find((s) => s.id === id) ?? BEAGLE_SKINS[0];
}

function getEnemySkinById(id: string): EnemySkin {
  return ENEMY_SKINS.find((s) => s.id === id) ?? ENEMY_SKINS[0];
}

/** Mirrors getBeagleSkinById/getEnemySkinById exactly, for maze themes
 *  (IDEA-026). */
function getMazeThemeById(id: string): MazeTheme {
  return MAZE_THEMES.find((t) => t.id === id) ?? MAZE_THEMES[0];
}

/**
 * Opens a dedicated full-screen
 * shop PAGE (`#shop` in index.html — deliberately separate from `#center`/
 * `#mainMenu`, so it can cover either without clobbering them), and builds/
 * re-renders the page's contents: a header (back button, title, live coin
 * balance), a transparent hero stage (the 3D turntable preview shows through
 * from the canvas behind — driven entirely via the onPreview callback, this
 * module never touches three.js), and a `.shop-panel` grouping the Beagle/
 * Enemy/Themes tab bar (IDEA-026 adds the third tab), the card rail (the
 * current tab's items), and the hero info block (selected item's
 * name/price/one contextual action button).
 * `.shop-panel` is ONE markup styled two ways by CSS: a fixed-width right
 * SIDE PANEL next to a clean 3D stage on desktop (tabs top, rail vertically
 * scrolling, hero-info pinned to the panel bottom), collapsing to the
 * original full-width STACKED layout (tabs, then the hero stage, then
 * hero-info, then a horizontally-scrolling rail) on phone/narrow viewports
 * via a `max-width` media query — see style.css's `.shop-panel`/`.shop-hero`
 * rules for the responsive switch; this module renders the same DOM either way.
 *
 * Call once (alongside attachMuteButton) from Game's constructor. Returns a
 * {@link ShopHandle} (`{ open, detach, isOpen }`) rather than a bare detach
 * function (IDEA-021) so callers can open the page directly — which is now
 * the ONLY way in, since the HUD's shop button became Pause and the menu's
 * carousel card calls open() through this handle.
 */
export function attachShop(root: ParentNode, callbacks: ShopCallbacks = {}): ShopHandle {
  const scope: ParentNode = root ?? document;

  function require<T extends HTMLElement>(id: string): T {
    const el = (scope.querySelector(`#${id}`) ?? document.getElementById(id)) as T | null;
    if (!el) {
      throw new Error(`attachShop: missing #${id} — check index.html`);
    }
    return el;
  }

  // The HUD's shop button is gone (replaced by Pause): the shop is reached
  // from the menu's carousel now, which calls open() through ShopHandle.
  const shopRoot = require<HTMLElement>("shop");

  // ---- selection state ----
  // `tab` is which registry is browsed; `selectedId` is the currently
  // highlighted/previewed item WITHIN that tab (defaults to that tab's
  // equipped item on open/tab-switch — see selectTab below).
  let tab: TabKind = "beagle";
  let selectedId: string = getEquippedBeagleSkinId();
  let isOpenState = false;

  function currentRegistry(): readonly ShopItem[] {
    if (tab === "beagle") return BEAGLE_SKINS;
    // Not ENEMY_SKINS: the ghost is hidden until it is earned — see
    // cosmetics.ts's visibleEnemySkins for the rule. Asked fresh on every call
    // rather than cached, because the unlock can happen WHILE the shop is open:
    // buy the Pac-Beagle coat on the Beagle tab, switch to Enemies, and the
    // ghost is waiting there.
    if (tab === "enemy") {
      return visibleEnemySkins(isBeagleSkinOwned(TRIBUTE_BEAGLE_SKIN_ID), isEnemySkinOwned);
    }
    return MAZE_THEMES;
  }

  function currentEquippedId(): string {
    if (tab === "beagle") return getEquippedBeagleSkinId();
    if (tab === "enemy") return getEquippedEnemySkinId();
    return getEquippedMazeThemeId();
  }

  /** Whether a given item id (within the CURRENT tab) is owned — a single
   *  dispatch point so renderRailCard/renderHeroInfo don't each need their
   *  own three-way tab branch. Mirrors the shape of currentRegistry/
   *  currentEquippedId above. */
  function currentIsOwned(id: string): boolean {
    if (tab === "beagle") return isBeagleSkinOwned(id);
    if (tab === "enemy") return isEnemySkinOwned(id);
    return isMazeThemeOwned(id);
  }

  function open(): void {
    isOpenState = true;
    tab = "beagle";
    selectedId = getEquippedBeagleSkinId();
    render();
    shopRoot.classList.remove("hidden");
    callbacks.onOpen?.();
    callbacks.onPreview?.(tab, selectedId);
  }

  function close(): void {
    isOpenState = false;
    shopRoot.classList.add("hidden");
    callbacks.onClose?.();
  }

  function selectTab(next: TabKind): void {
    if (tab === next) return;
    tab = next;
    selectedId = currentEquippedId();
    render();
    callbacks.onPreview?.(tab, selectedId);
  }

  function selectCard(id: string): void {
    if (selectedId === id) return;
    selectedId = id;
    render();
    callbacks.onPreview?.(tab, selectedId);
  }

  // ---- markup builders ----

  function beagleSwatch(skin: BeagleSkin): string {
    const { tan, white, black, ear } = skin.coat;
    return (
      '<div class="skin-swatch" aria-hidden="true">' +
      `<span class="swatch-dot" style="background:${hexToCss(tan)}"></span>` +
      `<span class="swatch-dot" style="background:${hexToCss(white)}"></span>` +
      `<span class="swatch-dot" style="background:${hexToCss(black)}"></span>` +
      `<span class="swatch-dot" style="background:${hexToCss(ear)}"></span>` +
      "</div>"
    );
  }

  function enemySwatch(skin: EnemySkin): string {
    return `<div class="skin-swatch skin-swatch-icon" aria-hidden="true">${iconHtml(enemyIcon(skin.id))}</div>`;
  }

  /** IDEA-026: a 4-dot swatch for a maze theme, mirroring beagleSwatch's
   *  shape exactly but reading from the theme's palette instead of a coat —
   *  wall + floor (the two dominant board materials) + biscuit (the pickup
   *  tint, which is close to identical across most themes but still varies
   *  slightly) + the theme's first bloom accent color (the hedge-decor pop
   *  that most differentiates one theme's "mood" from another's), so each
   *  theme card reads as a distinct at-a-glance palette. */
  function themeSwatch(theme: MazeTheme): string {
    const { wall, floor, biscuit, bloomColors } = theme.palette;
    const accent = bloomColors[0] ?? wall;
    return (
      '<div class="skin-swatch" aria-hidden="true">' +
      `<span class="swatch-dot" style="background:${hexToCss(wall)}"></span>` +
      `<span class="swatch-dot" style="background:${hexToCss(floor)}"></span>` +
      `<span class="swatch-dot" style="background:${hexToCss(biscuit)}"></span>` +
      `<span class="swatch-dot" style="background:${hexToCss(accent)}"></span>` +
      "</div>"
    );
  }

  function swatchFor(item: ShopItem): string {
    if (tab === "beagle") return beagleSwatch(item as BeagleSkin);
    if (tab === "enemy") return enemySwatch(item as EnemySkin);
    return themeSwatch(item as MazeTheme);
  }

  /** A compact rail card: swatch + name + a small state chip (Equipped/Owned/
   *  price). No action button here — buying/equipping happens via the ONE
   *  contextual button in the hero info block, for whichever card is
   *  currently selected (see renderHeroInfo). */
  function renderRailCard(item: ShopItem, owned: boolean, equipped: boolean): string {
    // §06 gives a card three signals and forbids mixing them: SELECTION is an
    // amber outline, OWNERSHIP a green badge, LOCKED a dimmed card. Ownership
    // used to be spelled with the word "Owned" in the same grey as a price,
    // which put two different facts in one slot.
    const chip = equipped
      ? `${iconHtml(ICON.check)}ON`
      : owned
        ? `${iconHtml(ICON.check)}Owned`
        : `${iconHtml(ICON.coin)}${item.price}`;
    const classes = ["shop-rail-card"];
    if (item.id === selectedId) classes.push("shop-rail-card-selected");
    if (equipped || owned) classes.push("shop-rail-card-equipped");
    // §06's third signal: an unowned card is dimmed, so "can't use this yet"
    // is legible without reading the price.
    if (!owned) classes.push("shop-rail-card-locked");
    return (
      `<button type="button" class="${classes.join(" ")}" data-card-id="${item.id}">` +
      swatchFor(item) +
      '<div class="shop-rail-card-body">' +
      `<div class="shop-rail-card-name">${item.name}</div>` +
      `<div class="shop-rail-card-chip">${chip}</div>` +
      "</div>" +
      "</button>"
    );
  }

  function renderRail(): string {
    const equippedId = currentEquippedId();
    const cards = currentRegistry()
      .map((item) => renderRailCard(item, currentIsOwned(item.id), item.id === equippedId))
      .join("");
    // The rail’s own scroll indicator, not the browser’s.
    //
    // Chrome uses OVERLAY scrollbars here — measured, the rail’s offsetHeight and
    // clientHeight are identical on both desktop and touch — so the native bar
    // takes no space and fades out at rest however it is styled. That left the
    // only hint that there are more skins past the edge invisible until you were
    // already scrolling, which is exactly when you no longer need it.
    //
    // Drawn as a groove and a thumb in the interface’s own language, sized and
    // positioned from scrollLeft by syncRailBar() below, and hidden entirely when
    // the rail has nothing to scroll — a dead indicator is worse than none.
    return (
      `<div class="shop-rail" id="shopRail">${cards}</div>` +
      '<div class="shop-rail-bar" id="shopRailBar" aria-hidden="true">' +
      '<div class="shop-rail-bar-thumb" id="shopRailThumb"></div>' +
      "</div>"
    );
  }

  /** Point the indicator at the rail’s current scroll position. Cheap enough to
   *  run on every scroll event: two style writes, no layout reads beyond the
   *  three the rail already tracks. */
  function syncRailBar(): void {
    const rail = shopRoot.querySelector<HTMLElement>("#shopRail");
    const bar = shopRoot.querySelector<HTMLElement>("#shopRailBar");
    const thumb = shopRoot.querySelector<HTMLElement>("#shopRailThumb");
    if (!rail || !bar || !thumb) return;

    const overflow = rail.scrollWidth - rail.clientWidth;
    // 2px of slack: a rail that overflows by a hair is not worth an indicator.
    if (overflow <= 2) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    const visible = rail.clientWidth / rail.scrollWidth;
    const at = rail.scrollLeft / rail.scrollWidth;
    thumb.style.width = `${visible * 100}%`;
    thumb.style.left = `${at * 100}%`;
  }

  /** The hero info block: selected skin's name, a price/status line, and ONE
   *  contextual action button (Equipped/Equip/Buy/can't-afford) — mirrors v1's
   *  renderCard action logic exactly, just relocated to a single spot that
   *  always targets whichever skin is selected rather than one button per card.
   *
   *  The status line deliberately COMPLEMENTS the button rather than restating
   *  it: when equipped, the highlighted "Equipped" button already says it all,
   *  so the status line is left empty rather than also reading "Equipped"
   *  (was a literal duplicate — "Bagel · Equipped · [Equipped]"). */
  function renderHeroInfo(): string {
    const item = currentRegistry().find((s) => s.id === selectedId) ?? currentRegistry()[0];
    const owned = currentIsOwned(item.id);
    const equipped = item.id === currentEquippedId();
    const coins = getCoins();

    // THE PRICE LIVES IN THE BUTTON.
    //
    // It used to sit on its own line beside the name, so the info bar said the
    // name, then the price, then a button that said the price again — and left
    // no room for the one thing this shop had never told anyone: what the item
    // actually looks like. Moving the figure onto the action frees that line
    // for the blurb, and puts the cost on the control that spends it.
    let actionHtml: string;
    if (equipped) {
      actionHtml = `<button type="button" class="shop-hero-action equipped" disabled>${iconHtml(ICON.check)}Equipped</button>`;
    } else if (owned) {
      actionHtml = `<button type="button" class="shop-hero-action btn-confirm" data-action="equip" data-id="${item.id}">${iconHtml(ICON.check)}Equip</button>`;
    } else if (coins >= item.price) {
      actionHtml = `<button type="button" class="shop-hero-action" data-action="buy" data-id="${item.id}">${iconHtml(ICON.coin)}${item.price}</button>`;
    } else {
      const need = item.price - coins;
      // §05's disabled button: it keeps its edge and says exactly what is
      // missing ("Need 60 more"), because a flat greyed button reads as broken
      // rather than as a goal.
      actionHtml = `<button type="button" class="shop-hero-action" disabled>Need ${need} more</button>`;
    }

    return (
      '<div class="shop-hero-info">' +
      '<div class="shop-hero-body">' +
      `<div class="shop-hero-name">${item.name}</div>` +
      `<div class="shop-hero-blurb">${item.blurb}</div>` +
      "</div>" +
      actionHtml +
      "</div>"
    );
  }

  function renderTabs(): string {
    const beagleActive = tab === "beagle" ? " shop-tab-active" : "";
    const enemyActive = tab === "enemy" ? " shop-tab-active" : "";
    const themeActive = tab === "theme" ? " shop-tab-active" : "";
    return (
      '<div class="shop-tabs" role="tablist">' +
      // Labels shortened along with the icons: three tabs share one row on a
      // 390px phone, and "Beagle Skins / Enemy Skins / Themes" only fitted by
      // shrinking the type below the display font's 14px floor (§02).
      `<button type="button" class="shop-tab${beagleActive}" data-tab="beagle" role="tab" aria-selected="${tab === "beagle"}">${iconHtml(ICON.beagle)}Beagle</button>` +
      `<button type="button" class="shop-tab${enemyActive}" data-tab="enemy" role="tab" aria-selected="${tab === "enemy"}">${iconHtml(ICON.enemies)}Enemies</button>` +
      `<button type="button" class="shop-tab${themeActive}" data-tab="theme" role="tab" aria-selected="${tab === "theme"}">${iconHtml(ICON.themes)}Themes</button>` +
      "</div>"
    );
  }

  function render(): void {
    // Single DOM structure styled two ways (desktop side panel vs. phone
    // stacked layout — see the .shop-panel/.shop-hero CSS rules) rather than
    // two separate markups: `.shop-panel` groups tabs+rail+hero-info as one
    // flex column so desktop CSS can pin it as a fixed-width right sidebar
    // (tabs top, rail vertically scrolling the middle, hero-info pinned to
    // the panel's own bottom) with zero DOM changes; `.shop-hero` (the
    // transparent stage spacer) stays a SIBLING of `.shop-panel`, never
    // nested inside it, so it's free to claim the entire left stage region
    // on desktop instead of being squeezed into the narrow panel column. On
    // phone, CSS flexbox `order` reinserts `.shop-hero` between the tabs and
    // the info block (see the media query) to reproduce the exact stacked
    // order already shipped (tabs -> hero -> info -> rail), without a second
    // render path.
    shopRoot.innerHTML =
      '<div class="shop-page">' +
      '<div class="shop-header">' +
      // Icon-only, like the map's and the leaderboard's: the word cost a third
      // of a 390px header to repeat what the arrow says, and the header needs
      // that room for the balance chip.
      `<button type="button" class="shop-back" id="shopBackBtn" aria-label="Back to menu">${iconHtml(ICON.back)}</button>` +
      '<div class="shop-title">Shop</div>' +
      `<div class="shop-balance">${plateHtml("coin", "inline")}${getCoins()}</div>` +
      "</div>" +
      '<div class="shop-stage">' +
      '<div class="shop-hero" aria-hidden="true"></div>' +
      '<div class="shop-panel">' +
      renderTabs() +
      renderRail() +
      renderHeroInfo() +
      "</div>" +
      "</div>" +
      "</div>";

    const backBtn = shopRoot.querySelector<HTMLButtonElement>("#shopBackBtn");
    backBtn?.addEventListener("click", close);

    shopRoot.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((btn) => {
      btn.addEventListener("click", () => selectTab(btn.dataset.tab as TabKind));
    });

    shopRoot.querySelectorAll<HTMLButtonElement>("[data-card-id]").forEach((btn) => {
      btn.addEventListener("click", () => selectCard(btn.dataset.cardId ?? ""));
    });

    shopRoot.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => onHeroAction(btn));
    });

    // The indicator is rebuilt with the rail on every render, so the listener
    // goes on with it — the old rail node is discarded, and its listener with it.
    const rail = shopRoot.querySelector<HTMLElement>("#shopRail");
    rail?.addEventListener("scroll", syncRailBar, { passive: true });
    // Measure after layout: scrollWidth is 0 until the cards have been laid out.
    requestAnimationFrame(syncRailBar);

    // Keep the selected rail card scrolled into view (e.g. after a tab
    // switch lands on an equipped skin that isn't the first card).
    const selectedCard = shopRoot.querySelector<HTMLElement>(".shop-rail-card-selected");
    selectedCard?.scrollIntoView({ block: "nearest", inline: "center" });
  }

  function onHeroAction(btn: HTMLButtonElement): void {
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    if (!id) return;

    if (action === "buy") {
      let ok: boolean;
      if (tab === "beagle") ok = buyBeagleSkin(id).ok;
      else if (tab === "enemy") ok = buyEnemySkin(id).ok;
      else ok = buyMazeTheme(id).ok;
      if (ok) callbacks.onCoinsChanged?.();
    } else if (action === "equip") {
      // Equipping the SELECTED item doesn't need a preview rebuild (the same
      // model/scene is already shown in the hero region) — onPreview is
      // deliberately NOT fired here, only onEquipBeagle/onEquipEnemy/
      // onThemeChanged so the caller can recolor/rebuild the ACTUAL in-game
      // mesh/scene.
      if (tab === "beagle") {
        if (equipBeagleSkin(id)) callbacks.onEquipBeagle?.(getBeagleSkinById(id));
      } else if (tab === "enemy") {
        if (equipEnemySkin(id)) callbacks.onEquipEnemy?.(getEnemySkinById(id));
      } else {
        if (equipMazeTheme(id)) callbacks.onThemeChanged?.(getMazeThemeById(id));
      }
    }
    render(); // re-render so balance/ownership/equipped state stay fresh
  }

  return {
    open,
    isOpen: () => isOpenState,
    detach: () => {
      shopRoot.innerHTML = "";
    },
  };
}
