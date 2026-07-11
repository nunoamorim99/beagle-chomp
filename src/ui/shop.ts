// OWNER: render-artist (IDEA-012 shop UI; IDEA-023 shop v2 page rework)
//
// The real skin-picker UI: a full-screen dedicated PAGE (not an overlay panel
// — see IDEA-023) where the player spends coins (earned via IDEA-016/
// IDEA-017) to unlock beagle/enemy skins, then equips them, browsing via a
// tab bar (Beagle Skins | Enemy Skins) plus a live 3D hero turntable
// (src/render/shopScene.ts, driven through the onPreview callback below) and
// a horizontally-scrollable card rail — character-select style. Replaces the
// v1 grid-of-cards overlay panel; the buy/equip DATA layer underneath is
// unchanged from v1.
//
// Three-free/pure-DOM, same split as every other src/ui/* module (mirrors
// src/ui/skin.ts's own doc comment): applying a skin to a THREE.Group/
// swapping the shop's 3D hero preview belongs to src/render/shopScene.ts +
// src/game/game.ts, so this module takes `onEquipBeagle`/`onEquipEnemy`/
// `onPreview` callbacks and leaves all mesh work to the caller. All buy/
// equip/ownership operations go THROUGH src/game/profileStore.ts's API —
// this module never mutates coins/ownership itself, only reads live state to
// render + calls the guarded buy*/equip* functions.
import {
  BEAGLE_SKINS,
  ENEMY_SKINS,
  getEquippedBeagleSkinId,
  getEquippedEnemySkinId,
  type BeagleSkin,
  type EnemySkin,
} from "../game/cosmetics";
import {
  getCoins,
  isBeagleSkinOwned,
  isEnemySkinOwned,
  buyBeagleSkin,
  buyEnemySkin,
  equipBeagleSkin,
  equipEnemySkin,
} from "../game/profileStore";

type SkinKind = "beagle" | "enemy";

export interface ShopCallbacks {
  /** Fired right after a beagle skin is successfully equipped, so the caller
   *  can live-recolor the actual beagle mesh (applyBeagleSkin). */
  onEquipBeagle?: (skin: BeagleSkin) => void;
  /** Fired right after an enemy skin is successfully equipped, so the caller
   *  can rebuild the actual enemy meshes (rebuildEnemySkins). */
  onEquipEnemy?: (skin: EnemySkin) => void;
  /** Fired right after any successful purchase (beagle or enemy skin), so the
   *  caller can re-sync the HUD's own coin counter (`hud.setCoins(getCoins())`)
   *  — the shop page's own header balance already re-renders itself from
   *  live state on every action, but the HUD stat lives outside the shop page
   *  and would otherwise stay stale until the next in-game coin event. Not
   *  fired on a failed buy (insufficient funds/unknown id) since the wallet
   *  is unchanged in that case. */
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
  /** IDEA-023: fired whenever the shop's selection changes to a specific skin
   *  — on open (the equipped skin of the default tab), on a tab switch (the
   *  equipped skin of the newly-active tab), and on every card tap (that
   *  card's skin) — so the caller can drive the live 3D hero preview
   *  (shopScene.showBeagle/showEnemy). NOT fired after an equip of the
   *  already-selected card (see the task brief: "equipping the SELECTED skin
   *  doesn't need a preview rebuild, same model already shown"). */
  onPreview?: (kind: "beagle" | "enemy", id: string) => void;
}

/** Return shape of {@link attachShop}: `open()` lets any other UI (the main
 *  menu's Shop button, IDEA-021) open the same page the HUD `#shopBtn` opens,
 *  without synthesizing a click on that button; `detach()` is the usual
 *  teardown, same as every other attach* helper's return value; `isOpen()`
 *  (IDEA-023) lets the caller's frame loop branch on shop state (pausing
 *  gameplay while the page is up) without duplicating this module's own
 *  open/closed bookkeeping. */
export interface ShopHandle {
  /** Opens the shop page (re-renders it fresh first, so balance/ownership are
   *  always current), defaulting to the "beagle" tab with the equipped skin
   *  selected — the same action `#shopBtn` triggers. */
  open: () => void;
  /** Unwires the HUD button listener and clears the page's contents. */
  detach: () => void;
  /** Whether the shop page is currently showing. */
  isOpen: () => boolean;
}

/** A little emoji per enemy skin id — purely decorative labelling for the
 *  shop card (enemy skins have no color data to swatch; see cosmetics.ts's
 *  EnemySkin doc comment). Falls back to a neutral ghost icon for any future
 *  id that isn't listed here, so a new skin never renders with no icon at all. */
const ENEMY_ICONS: Record<string, string> = {
  ghost: "\u{1F47B}", // 👻
  beetle: "\u{1FAB2}", // 🪲
  bee: "\u{1F41D}", // 🐝
  ladybug: "\u{1F41E}", // 🐞
};

function enemyIcon(id: string): string {
  return ENEMY_ICONS[id] ?? "\u{1F47B}";
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

/**
 * Wires the HUD's shop button (`#shopBtn`) to open a dedicated full-screen
 * shop PAGE (`#shop` in index.html — deliberately separate from `#center`/
 * `#mainMenu`, so it can cover either without clobbering them), and builds/
 * re-renders the page's contents: a header (back button, title, live coin
 * balance), a transparent hero stage (the 3D turntable preview shows through
 * from the canvas behind — driven entirely via the onPreview callback, this
 * module never touches three.js), and a `.shop-panel` grouping the Beagle/
 * Enemy tab bar, the card rail (the current tab's skins), and the hero info
 * block (selected skin's name/price/one contextual action button).
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
 * function (IDEA-021) so callers outside the HUD button — e.g. the main
 * menu's Shop button — can open the exact same page/state instead of hacking
 * a synthetic click on `#shopBtn`.
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

  const shopBtn = require<HTMLButtonElement>("shopBtn");
  const shopRoot = require<HTMLElement>("shop");

  // ---- selection state ----
  // `tab` is which registry is browsed; `selectedId` is the currently
  // highlighted/previewed skin WITHIN that tab (defaults to that tab's
  // equipped skin on open/tab-switch — see selectTab below).
  let tab: SkinKind = "beagle";
  let selectedId: string = getEquippedBeagleSkinId();
  let isOpenState = false;

  function currentRegistry(): readonly (BeagleSkin | EnemySkin)[] {
    return tab === "beagle" ? BEAGLE_SKINS : ENEMY_SKINS;
  }

  function currentEquippedId(): string {
    return tab === "beagle" ? getEquippedBeagleSkinId() : getEquippedEnemySkinId();
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

  function onShopBtnClick(): void {
    open();
  }

  function selectTab(next: SkinKind): void {
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
    return `<div class="skin-swatch skin-swatch-icon" aria-hidden="true">${enemyIcon(skin.id)}</div>`;
  }

  function swatchFor(skin: BeagleSkin | EnemySkin): string {
    return tab === "beagle" ? beagleSwatch(skin as BeagleSkin) : enemySwatch(skin as EnemySkin);
  }

  /** A compact rail card: swatch + name + a small state chip (Equipped/Owned/
   *  price). No action button here — buying/equipping happens via the ONE
   *  contextual button in the hero info block, for whichever card is
   *  currently selected (see renderHeroInfo). */
  function renderRailCard(skin: BeagleSkin | EnemySkin, owned: boolean, equipped: boolean): string {
    const chip = equipped ? "Equipped" : owned ? "Owned" : `${skin.price} \u{1FA99}`;
    const classes = ["shop-rail-card"];
    if (skin.id === selectedId) classes.push("shop-rail-card-selected");
    if (equipped) classes.push("shop-rail-card-equipped");
    return (
      `<button type="button" class="${classes.join(" ")}" data-card-id="${skin.id}">` +
      swatchFor(skin) +
      '<div class="shop-rail-card-body">' +
      `<div class="shop-rail-card-name">${skin.name}</div>` +
      `<div class="shop-rail-card-chip">${chip}</div>` +
      "</div>" +
      "</button>"
    );
  }

  function renderRail(): string {
    const equippedId = currentEquippedId();
    const cards = currentRegistry()
      .map((skin) => {
        const owned = tab === "beagle" ? isBeagleSkinOwned(skin.id) : isEnemySkinOwned(skin.id);
        return renderRailCard(skin, owned, skin.id === equippedId);
      })
      .join("");
    return `<div class="shop-rail" id="shopRail">${cards}</div>`;
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
    const skin = currentRegistry().find((s) => s.id === selectedId) ?? currentRegistry()[0];
    const owned = tab === "beagle" ? isBeagleSkinOwned(skin.id) : isEnemySkinOwned(skin.id);
    const equipped = skin.id === currentEquippedId();
    const coins = getCoins();

    let priceLine: string;
    let actionHtml: string;
    if (equipped) {
      priceLine = "";
      actionHtml = '<button type="button" class="shop-hero-action equipped" disabled>Equipped</button>';
    } else if (owned) {
      priceLine = "Owned";
      actionHtml = `<button type="button" class="shop-hero-action" data-action="equip" data-id="${skin.id}">Equip</button>`;
    } else if (coins >= skin.price) {
      priceLine = `${skin.price} \u{1FA99}`;
      actionHtml = `<button type="button" class="shop-hero-action shop-buy" data-action="buy" data-id="${skin.id}">Buy &middot; ${skin.price} \u{1FA99}</button>`;
    } else {
      const need = skin.price - coins;
      priceLine = `${skin.price} \u{1FA99}`;
      actionHtml = `<button type="button" class="shop-hero-action" disabled>Need ${need} more \u{1FA99}</button>`;
    }

    return (
      '<div class="shop-hero-info">' +
      `<div class="shop-hero-name">${skin.name}</div>` +
      `<div class="shop-hero-price">${priceLine}</div>` +
      actionHtml +
      "</div>"
    );
  }

  function renderTabs(): string {
    const beagleActive = tab === "beagle" ? " shop-tab-active" : "";
    const enemyActive = tab === "enemy" ? " shop-tab-active" : "";
    return (
      '<div class="shop-tabs" role="tablist">' +
      `<button type="button" class="shop-tab${beagleActive}" data-tab="beagle" role="tab" aria-selected="${tab === "beagle"}">\u{1F436} Beagle Skins</button>` +
      `<button type="button" class="shop-tab${enemyActive}" data-tab="enemy" role="tab" aria-selected="${tab === "enemy"}">\u{1F47E} Enemy Skins</button>` +
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
      '<button type="button" class="shop-back" id="shopBackBtn" aria-label="Back to menu">&larr; Menu</button>' +
      '<div class="shop-title">Shop</div>' +
      `<div class="shop-balance"><span aria-hidden="true">\u{1FA99}</span> ${getCoins()}</div>` +
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
      btn.addEventListener("click", () => selectTab(btn.dataset.tab as SkinKind));
    });

    shopRoot.querySelectorAll<HTMLButtonElement>("[data-card-id]").forEach((btn) => {
      btn.addEventListener("click", () => selectCard(btn.dataset.cardId ?? ""));
    });

    shopRoot.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => onHeroAction(btn));
    });

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
      if (tab === "beagle") {
        if (buyBeagleSkin(id).ok) callbacks.onCoinsChanged?.();
      } else {
        if (buyEnemySkin(id).ok) callbacks.onCoinsChanged?.();
      }
    } else if (action === "equip") {
      // Equipping the SELECTED skin doesn't need a preview rebuild (the same
      // model is already shown in the hero region) — onPreview is
      // deliberately NOT fired here, only onEquipBeagle/onEquipEnemy so the
      // caller can recolor/rebuild the ACTUAL in-game mesh.
      if (tab === "beagle") {
        if (equipBeagleSkin(id)) callbacks.onEquipBeagle?.(getBeagleSkinById(id));
      } else {
        if (equipEnemySkin(id)) callbacks.onEquipEnemy?.(getEnemySkinById(id));
      }
    }
    render(); // re-render so balance/ownership/equipped state stay fresh
  }

  shopBtn.addEventListener("click", onShopBtnClick);

  return {
    open,
    isOpen: () => isOpenState,
    detach: () => {
      shopBtn.removeEventListener("click", onShopBtnClick);
      shopRoot.innerHTML = "";
    },
  };
}
