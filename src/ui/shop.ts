// OWNER: render-artist (IDEA-012 shop UI)
//
// The real skin-picker UI: a storefront overlay where the player spends coins
// (earned via IDEA-016/IDEA-017) to unlock beagle/enemy skins, then equips
// them. Replaces the temporary #skinBtn/#enemyBtn cycle buttons (src/ui/skin.ts,
// now deleted) with an actual shop panel players can browse.
//
// Three-free/pure-DOM, same split as every other src/ui/* module (mirrors
// src/ui/skin.ts's own doc comment): applying a skin to a THREE.Group/rebuilding
// enemy meshes belongs to src/render/characters.ts + src/game/game.ts, so this
// module takes `onEquipBeagle`/`onEquipEnemy` callbacks and leaves the actual
// mesh work to the caller. All buy/equip/ownership operations go THROUGH
// src/game/profileStore.ts's API — this module never mutates coins/ownership
// itself, only reads live state to render + calls the guarded buy*/equip*
// functions.
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

export interface ShopCallbacks {
  /** Fired right after a beagle skin is successfully equipped, so the caller
   *  can live-recolor the actual beagle mesh (applyBeagleSkin). */
  onEquipBeagle?: (skin: BeagleSkin) => void;
  /** Fired right after an enemy skin is successfully equipped, so the caller
   *  can rebuild the actual enemy meshes (rebuildEnemySkins). */
  onEquipEnemy?: (skin: EnemySkin) => void;
  /** Fired right after any successful purchase (beagle or enemy skin), so the
   *  caller can re-sync the HUD's own coin counter (`hud.setCoins(getCoins())`)
   *  — the shop panel's own header balance already re-renders itself from
   *  live state on every action, but the HUD stat lives outside the shop
   *  overlay and would otherwise stay stale until the next in-game coin
   *  event. Not fired on a failed buy (insufficient funds/unknown id) since
   *  the wallet is unchanged in that case. */
  onCoinsChanged?: () => void;
  /** Fired when the shop overlay closes (X button), so a caller that renders
   *  its own coin display *underneath* the shop (IDEA-021's main menu) can
   *  refresh it — the player can only SPEND in the shop, never earn, but a
   *  purchase there does change the wallet the menu displayed before the shop
   *  opened. Not fired by anything else (e.g. never on open). */
  onClose?: () => void;
}

/** Return shape of {@link attachShop}: `open()` lets any other UI (the main
 *  menu's Shop button, IDEA-021) open the same overlay the HUD `#shopBtn`
 *  opens, without synthesizing a click on that button; `detach()` is the
 *  usual teardown, same as every other attach* helper's return value. */
export interface ShopHandle {
  /** Opens the shop overlay (re-renders it fresh first, so balance/ownership
   *  are always current) — the same action `#shopBtn` triggers. */
  open: () => void;
  /** Unwires the HUD button listener and clears the overlay's contents. */
  detach: () => void;
}

/**
 * Wires the HUD's shop button (`#shopBtn`) to open a dedicated shop overlay
 * (`#shop` in index.html — deliberately separate from `#center`, so the shop
 * can be opened over the Start/GameOver panel or mid-play without clobbering
 * either), and builds/re-renders the shop's contents: a coin balance header
 * plus "Beagle Skins" / "Enemy Skins" sections, each listing its registry as
 * cards with a contextual Buy/Equip/Equipped/can't-afford action.
 *
 * Call once (alongside attachMuteButton) from Game's constructor. Returns a
 * {@link ShopHandle} (`{ open, detach }`) rather than a bare detach function
 * (IDEA-021) so callers outside the HUD button — e.g. the main menu's Shop
 * button — can open the exact same overlay/state instead of hacking a
 * synthetic click on `#shopBtn`.
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

  function open(): void {
    render();
    shopRoot.classList.remove("hidden");
  }

  function close(): void {
    shopRoot.classList.add("hidden");
    callbacks.onClose?.();
  }

  function onShopBtnClick(): void {
    open();
  }

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

  /** Builds one card's inner HTML (swatch, name, price/status line, action
   *  button) — shared shape for both beagle + enemy cards, since the
   *  Buy/Equip/Equipped/can't-afford state machine is identical for both. */
  function renderCard(opts: {
    id: string;
    name: string;
    price: number;
    swatchHtml: string;
    equipped: boolean;
    owned: boolean;
    coins: number;
  }): string {
    const { id, name, price, swatchHtml, equipped, owned, coins } = opts;

    let statusLine: string;
    let actionHtml: string;
    if (equipped) {
      statusLine = "Equipped";
      actionHtml = '<button type="button" class="shop-action equipped" disabled>Equipped</button>';
    } else if (owned) {
      statusLine = "Owned";
      actionHtml = `<button type="button" class="shop-action" data-action="equip" data-id="${id}">Equip</button>`;
    } else if (coins >= price) {
      statusLine = `${price} \u{1FA99}`;
      actionHtml = `<button type="button" class="shop-action shop-buy" data-action="buy" data-id="${id}">Buy &middot; ${price} \u{1FA99}</button>`;
    } else {
      const need = price - coins;
      statusLine = `${price} \u{1FA99}`;
      actionHtml = `<button type="button" class="shop-action" disabled>Need ${need} more \u{1FA99}</button>`;
    }

    return (
      `<div class="shop-card${equipped ? " shop-card-equipped" : ""}" data-card-id="${id}">` +
      swatchHtml +
      '<div class="shop-card-body">' +
      `<div class="shop-card-name">${name}</div>` +
      `<div class="shop-card-status">${statusLine}</div>` +
      "</div>" +
      actionHtml +
      "</div>"
    );
  }

  function renderBeagleSection(): string {
    const coins = getCoins();
    const equippedId = getEquippedBeagleSkinId();
    const cards = BEAGLE_SKINS.map((skin) =>
      renderCard({
        id: skin.id,
        name: skin.name,
        price: skin.price,
        swatchHtml: beagleSwatch(skin),
        equipped: skin.id === equippedId,
        owned: isBeagleSkinOwned(skin.id),
        coins,
      }),
    ).join("");
    return `<section class="shop-section"><h2>Beagle Skins</h2><div class="shop-grid">${cards}</div></section>`;
  }

  function renderEnemySection(): string {
    const coins = getCoins();
    const equippedId = getEquippedEnemySkinId();
    const cards = ENEMY_SKINS.map((skin) =>
      renderCard({
        id: skin.id,
        name: skin.name,
        price: skin.price,
        swatchHtml: enemySwatch(skin),
        equipped: skin.id === equippedId,
        owned: isEnemySkinOwned(skin.id),
        coins,
      }),
    ).join("");
    return `<section class="shop-section"><h2>Enemy Skins</h2><div class="shop-grid">${cards}</div></section>`;
  }

  function render(): void {
    shopRoot.innerHTML =
      '<div class="shop-panel">' +
      '<div class="shop-header">' +
      '<div class="shop-title">Shop</div>' +
      `<div class="shop-balance"><span aria-hidden="true">\u{1FA99}</span> ${getCoins()}</div>` +
      '<button type="button" class="shop-close" id="shopCloseBtn" aria-label="Close shop">&times;</button>' +
      "</div>" +
      '<div class="shop-body">' +
      renderBeagleSection() +
      renderEnemySection() +
      "</div>" +
      "</div>";

    const closeBtn = shopRoot.querySelector<HTMLButtonElement>("#shopCloseBtn");
    closeBtn?.addEventListener("click", close);

    shopRoot.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => onCardAction(btn));
    });
  }

  function onCardAction(btn: HTMLButtonElement): void {
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    if (!id) return;

    const isBeagle = BEAGLE_SKINS.some((s) => s.id === id);
    const isEnemy = !isBeagle && ENEMY_SKINS.some((s) => s.id === id);

    if (action === "buy") {
      if (isBeagle) {
        if (buyBeagleSkin(id).ok) callbacks.onCoinsChanged?.();
      } else if (isEnemy) {
        if (buyEnemySkin(id).ok) callbacks.onCoinsChanged?.();
      }
    } else if (action === "equip") {
      if (isBeagle) {
        if (equipBeagleSkin(id)) callbacks.onEquipBeagle?.(getBeagleSkinById(id));
      } else if (isEnemy) {
        if (equipEnemySkin(id)) callbacks.onEquipEnemy?.(getEnemySkinById(id));
      }
    }
    render(); // re-render so balance/ownership/equipped state stay fresh
  }

  function getBeagleSkinById(id: string): BeagleSkin {
    return BEAGLE_SKINS.find((s) => s.id === id) ?? BEAGLE_SKINS[0];
  }

  function getEnemySkinById(id: string): EnemySkin {
    return ENEMY_SKINS.find((s) => s.id === id) ?? ENEMY_SKINS[0];
  }

  shopBtn.addEventListener("click", onShopBtnClick);

  return {
    open,
    detach: () => {
      shopBtn.removeEventListener("click", onShopBtnClick);
      shopRoot.innerHTML = "";
    },
  };
}
