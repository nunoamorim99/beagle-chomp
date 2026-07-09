// OWNER: gameplay-engineer (IDEA-010 beagle skins — profile persistence;
// IDEA-012 extends this with skin ownership + the shop buy operation)
//
// localStorage persistence for player *profile/preference* state: equipped
// skins (beagle/enemy), owned skins (IDEA-012), and the coin wallet
// (IDEA-016/IDEA-017). This is UI/profile preference, not core gameplay state
// (CLAUDE.md's "no localStorage assumptions for core state" rule is scoped to
// score/lives/level), so persisting it is the same documented exception
// src/ui/sound.ts already relies on for the mute preference — and this module
// mirrors that file's defensive style exactly: every storage access wrapped
// in try/catch, graceful fallback to in-memory defaults, never throws.
//
// Browser-only (touches `window.localStorage`) but three-free, so — like
// sound.ts — it's importable from src/game/*, src/ui/*, and src/render/*
// alike without pulling `three` into pure logic.

import {
  BEAGLE_SKINS,
  DEFAULT_BEAGLE_SKIN_ID,
  getEquippedBeagleSkinId,
  setEquippedBeagleSkinId,
  getBeagleSkinPrice,
  ENEMY_SKINS,
  DEFAULT_ENEMY_SKIN_ID,
  getEquippedEnemySkinId,
  setEquippedEnemySkinId,
  getEnemySkinPrice,
} from "./cosmetics";

const PROFILE_STORAGE_KEY = "beagle-chomp:profile";

/** The persisted profile shape. Deliberately small at first; add fields as
 *  optional/defaulted so old saved blobs stay valid — see loadProfile's
 *  read-defensively-and-spread-over-defaults approach.
 *  `equippedEnemySkinId` (IDEA-009) was added after `equippedBeagleSkinId`
 *  shipped; old blobs on disk simply won't have the key, and loadProfile
 *  defaults it the same way a garbage/unknown value would.
 *  `coins` (IDEA-016/IDEA-017) was added later still, for the same reason:
 *  old blobs without the key default to 0, same as a garbage/negative/NaN
 *  value would.
 *  `ownedBeagleSkinIds`/`ownedEnemySkinIds` (IDEA-012) were added later
 *  still: old blobs without the keys default to just the default skin owned
 *  (["bagel"]/["ghost"]) — same fallback loadProfile already uses for a
 *  garbage/unknown-id value. */
export interface StoredProfile {
  equippedBeagleSkinId: string;
  equippedEnemySkinId: string;
  coins: number;
  ownedBeagleSkinIds: string[];
  ownedEnemySkinIds: string[];
}

function defaultProfile(): StoredProfile {
  return {
    equippedBeagleSkinId: DEFAULT_BEAGLE_SKIN_ID,
    equippedEnemySkinId: DEFAULT_ENEMY_SKIN_ID,
    coins: 0,
    ownedBeagleSkinIds: [DEFAULT_BEAGLE_SKIN_ID],
    ownedEnemySkinIds: [DEFAULT_ENEMY_SKIN_ID],
  };
}

/** A valid coin count: a finite, non-negative integer. Anything else
 *  (missing, NaN, negative, a string, Infinity, a float) degrades to 0 rather
 *  than propagating garbage into the wallet. Floats are floored rather than
 *  rejected outright, since coins are always awarded/added as whole numbers
 *  by this module's own writers — this guard is about surviving a corrupted
 *  or hand-edited blob, not about legitimate callers. */
function sanitizeCoins(value: unknown): number {
  const n = typeof value === "number" ? value : NaN;
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function isKnownSkinId(id: unknown): id is string {
  return typeof id === "string" && BEAGLE_SKINS.some((s) => s.id === id);
}

function isKnownEnemySkinId(id: unknown): id is string {
  return typeof id === "string" && ENEMY_SKINS.some((s) => s.id === id);
}

/** Sanitizes a persisted "owned beagle skin ids" value (IDEA-012): anything
 *  that isn't an array degrades to just the default owned; array entries
 *  that aren't a known skin id are filtered out; and the default id is
 *  always unioned in afterwards so a corrupt/old blob (or one missing the
 *  default entirely) can never leave the player unable to use the default
 *  skin. De-duplicates as a side effect of the Set round-trip. */
function sanitizeOwnedBeagleSkinIds(value: unknown): string[] {
  const known = Array.isArray(value) ? value.filter(isKnownSkinId) : [];
  return Array.from(new Set([DEFAULT_BEAGLE_SKIN_ID, ...known]));
}

/** Mirrors sanitizeOwnedBeagleSkinIds exactly, for enemy skins. */
function sanitizeOwnedEnemySkinIds(value: unknown): string[] {
  const known = Array.isArray(value) ? value.filter(isKnownEnemySkinId) : [];
  return Array.from(new Set([DEFAULT_ENEMY_SKIN_ID, ...known]));
}

/**
 * Reads + parses the stored profile blob. Returns a fully-defaulted
 * `StoredProfile` on ANY failure: missing key, storage unavailable
 * (private browsing, quota, disabled storage, non-browser/Node
 * environments where `window` doesn't exist), garbage/corrupt JSON, or a
 * stored skin id that no longer matches a known skin (e.g. a removed skin) —
 * all degrade to the default rather than throwing or propagating `null`.
 */
export function loadProfile(): StoredProfile {
  try {
    const raw = window.localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!raw) return defaultProfile();

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return defaultProfile();

    const record = parsed as Record<string, unknown>;
    const candidate = record.equippedBeagleSkinId;
    const enemyCandidate = record.equippedEnemySkinId;
    return {
      ...defaultProfile(),
      equippedBeagleSkinId: isKnownSkinId(candidate) ? candidate : DEFAULT_BEAGLE_SKIN_ID,
      equippedEnemySkinId: isKnownEnemySkinId(enemyCandidate) ? enemyCandidate : DEFAULT_ENEMY_SKIN_ID,
      coins: sanitizeCoins(record.coins),
      ownedBeagleSkinIds: sanitizeOwnedBeagleSkinIds(record.ownedBeagleSkinIds),
      ownedEnemySkinIds: sanitizeOwnedEnemySkinIds(record.ownedEnemySkinIds),
    };
  } catch {
    // Covers `window`/`localStorage` being unavailable, JSON.parse throwing
    // on corrupt data, and any storage access throwing (e.g. Safari private
    // mode's quota-of-zero behaviour) — all treated the same way: fall back
    // to defaults, in-memory only for this session.
    return defaultProfile();
  }
}

/**
 * Persists just the equipped-skin field, via read-modify-write so any other
 * fields already in the stored blob (future coins/ownedSkinIds) survive
 * untouched. Guarded like every other storage access here — never throws.
 */
export function saveEquippedBeagleSkinId(id: string): void {
  try {
    const current = loadProfile();
    const next: StoredProfile = { ...current, equippedBeagleSkinId: id };
    window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable/throwing — keep the pick in memory for this
       session only (cosmetics.ts's equipped-id state already reflects it);
       nothing else to do, and this must never throw upward */
  }
}

/**
 * Persists just the equipped-enemy-skin field, via read-modify-write so the
 * beagle field (and any other future fields) already in the stored blob
 * survive untouched. Mirrors saveEquippedBeagleSkinId exactly.
 */
export function saveEquippedEnemySkinId(id: string): void {
  try {
    const current = loadProfile();
    const next: StoredProfile = { ...current, equippedEnemySkinId: id };
    window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable/throwing — keep the pick in memory for this
       session only (cosmetics.ts's equipped-id state already reflects it);
       nothing else to do, and this must never throw upward */
  }
}

/**
 * Persists just the coins field, via read-modify-write so the skin fields
 * already in the stored blob survive untouched — mirrors
 * saveEquippedBeagleSkinId/saveEquippedEnemySkinId exactly. Internal: callers
 * outside this module should go through getCoins/addCoins below.
 */
function saveCoins(total: number): void {
  try {
    const current = loadProfile();
    const next: StoredProfile = { ...current, coins: sanitizeCoins(total) };
    window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable/throwing — keep the wallet in memory for this
       session only (the caller's own view of the total, if any, is
       unaffected); nothing else to do, and this must never throw upward */
  }
}

/**
 * Reads the persisted coin wallet (IDEA-016/IDEA-017). Degrades to 0 on any
 * failure via loadProfile's own defensive handling — never throws.
 */
export function getCoins(): number {
  return loadProfile().coins;
}

/**
 * Adds `n` coins to the persisted wallet (read-modify-write, so the skin
 * fields survive) and clamps the result to >= 0. `n` may be negative in
 * principle (e.g. a future shop spend), but the total is always floored at 0
 * rather than going negative. Guarded like every other storage access here —
 * never throws.
 */
export function addCoins(n: number): void {
  const delta = Number.isFinite(n) ? n : 0;
  const current = getCoins();
  const next = Math.max(0, current + delta);
  saveCoins(next);
}

// ---------------------------------------------------------------------------
// IDEA-012: skin ownership + the shop buy operation. The owned-ids arrays
// live in the same StoredProfile blob (see loadProfile's sanitize step
// above), so every read/write here goes through the same
// read-modify-write pattern the rest of this module already uses — no new
// storage key, no separate persistence path.

/** Reads the persisted set of owned beagle skin ids. Always includes the
 *  default id (loadProfile's sanitize step guarantees this) — degrades to
 *  `[DEFAULT_BEAGLE_SKIN_ID]` on any storage failure via loadProfile. */
export function getOwnedBeagleSkinIds(): string[] {
  return loadProfile().ownedBeagleSkinIds;
}

/** Reads the persisted set of owned enemy skin ids. Mirrors
 *  getOwnedBeagleSkinIds exactly. */
export function getOwnedEnemySkinIds(): string[] {
  return loadProfile().ownedEnemySkinIds;
}

/** Whether a given beagle skin id is owned. The default skin is always
 *  owned (loadProfile's sanitize step guarantees it's always present in the
 *  owned array), so this is true for it even before loadProfile ever runs
 *  (e.g. called against a totally fresh profile). Unknown ids are never
 *  "owned" (they can't be equipped/rendered anyway). */
export function isBeagleSkinOwned(id: string): boolean {
  if (id === DEFAULT_BEAGLE_SKIN_ID) return true;
  return getOwnedBeagleSkinIds().includes(id);
}

/** Whether a given enemy skin id is owned. Mirrors isBeagleSkinOwned
 *  exactly. */
export function isEnemySkinOwned(id: string): boolean {
  if (id === DEFAULT_ENEMY_SKIN_ID) return true;
  return getOwnedEnemySkinIds().includes(id);
}

/** The result shape every buy operation returns. `ok:false` always leaves
 *  coins/ownership completely unchanged (never a partial charge) — see each
 *  reason below:
 *    - "already-owned": the id was already owned; no coins were charged
 *      (buying is refused rather than treated as a harmless no-op re-buy, so
 *      the UI never risks double-charging by calling buy twice).
 *    - "insufficient-coins": the wallet has less than the skin's price.
 *    - "unknown": the id doesn't match any registered skin. */
export interface BuyResult {
  ok: boolean;
  reason?: "already-owned" | "insufficient-coins" | "unknown";
}

/**
 * Atomically checks the wallet has at least `price` coins and, if so,
 * deducts them — all against a single freshly-loaded profile snapshot, so
 * there's no window where a caller could observe coins deducted without the
 * corresponding owned-id also being added (buyBeagleSkin/buyEnemySkin below
 * fold this into the same read-modify-write as the ownership update).
 * Returns the new coin total on success, or `null` if funds were
 * insufficient (in which case the blob is left untouched by this
 * function — the caller decides whether/how to persist).
 */
function trySpend(profile: StoredProfile, price: number): number | null {
  if (profile.coins < price) return null;
  return profile.coins - price;
}

/**
 * Guarded shop purchase for a beagle skin. Never throws. On success, deducts
 * the skin's price from coins AND adds the id to the owned list in ONE
 * read-modify-write of the profile blob (see trySpend), so a purchase can
 * never be observed half-applied (coins gone but skin not owned, or vice
 * versa). Already-owned ids and unknown ids are both refused before any
 * coins are touched.
 */
export function buyBeagleSkin(id: string): BuyResult {
  if (!isKnownSkinId(id)) return { ok: false, reason: "unknown" };

  const profile = loadProfile();
  if (profile.ownedBeagleSkinIds.includes(id)) return { ok: false, reason: "already-owned" };

  const price = getBeagleSkinPrice(id);
  const newCoins = trySpend(profile, price);
  if (newCoins === null) return { ok: false, reason: "insufficient-coins" };

  const next: StoredProfile = {
    ...profile,
    coins: newCoins,
    ownedBeagleSkinIds: [...profile.ownedBeagleSkinIds, id],
  };
  persistProfile(next);
  return { ok: true };
}

/** Guarded shop purchase for an enemy skin. Mirrors buyBeagleSkin exactly. */
export function buyEnemySkin(id: string): BuyResult {
  if (!isKnownEnemySkinId(id)) return { ok: false, reason: "unknown" };

  const profile = loadProfile();
  if (profile.ownedEnemySkinIds.includes(id)) return { ok: false, reason: "already-owned" };

  const price = getEnemySkinPrice(id);
  const newCoins = trySpend(profile, price);
  if (newCoins === null) return { ok: false, reason: "insufficient-coins" };

  const next: StoredProfile = {
    ...profile,
    coins: newCoins,
    ownedEnemySkinIds: [...profile.ownedEnemySkinIds, id],
  };
  persistProfile(next);
  return { ok: true };
}

/**
 * Writes a full StoredProfile snapshot in one shot (used by the buy
 * operations above so the coin-deduct and owned-add land in the exact same
 * localStorage write). Guarded like every other storage write here — never
 * throws; if storage is unavailable the purchase simply doesn't persist
 * (matching every other write in this module's behaviour under a
 * private-mode/disabled-storage failure).
 */
function persistProfile(profile: StoredProfile): void {
  try {
    window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
  } catch {
    /* storage unavailable/throwing — the purchase doesn't persist for this
       session; nothing else to do, and this must never throw upward */
  }
}

// ---------------------------------------------------------------------------
// Bridge between this module's persistence and cosmetics.ts's in-memory
// equipped state. Lives here (not in cosmetics.ts) so the dependency arrow
// stays one-directional — profileStore.ts -> cosmetics.ts — and cosmetics.ts
// stays free of any storage/browser dependency, per its own docstring.

/** Reads the persisted profile (if any) and applies its equipped-skin id to
 *  cosmetics.ts's in-memory state, so a page reload resumes the player's
 *  last pick. Call once during boot (e.g. from src/game/game.ts's setup),
 *  before any UI reads getEquippedBeagleSkin(). Safe to call even when
 *  storage/`window` isn't available — loadProfile() degrades to the default
 *  in that case, so this just re-affirms cosmetics.ts's existing default.
 *
 *  Safety net (IDEA-012): if the persisted equipped id somehow isn't owned
 *  (shouldn't happen via normal equip/buy flow, but guards a hand-edited or
 *  pre-shop blob where an equipped skin was never actually purchased), falls
 *  back to the default id instead of equipping an unowned skin. */
export function initProfileFromStorage(): void {
  const profile = loadProfile();
  setEquippedBeagleSkinId(
    profile.ownedBeagleSkinIds.includes(profile.equippedBeagleSkinId)
      ? profile.equippedBeagleSkinId
      : DEFAULT_BEAGLE_SKIN_ID,
  );
  setEquippedEnemySkinId(
    profile.ownedEnemySkinIds.includes(profile.equippedEnemySkinId)
      ? profile.equippedEnemySkinId
      : DEFAULT_ENEMY_SKIN_ID,
  );
}

/** Equips a skin AND persists the choice — but ONLY if it's owned (IDEA-012
 *  gating: the shop must only let players equip skins they've bought).
 *  Unknown ids are also refused (isBeagleSkinOwned is false for them). The
 *  default id is always owned, so it always equips successfully. Returns
 *  whether the equip happened, so shop UI can react (e.g. show a "buy
 *  first" hint) — callers that don't care about the outcome can ignore the
 *  return value. cosmetics.ts's plain setEquippedBeagleSkinId stays
 *  available for tests/callers that want in-memory-only, ungated state. */
export function equipBeagleSkin(id: string): boolean {
  if (!isBeagleSkinOwned(id)) return false;
  setEquippedBeagleSkinId(id);
  saveEquippedBeagleSkinId(getEquippedBeagleSkinId());
  return true;
}

/** Equips an enemy skin AND persists the choice, mirroring equipBeagleSkin
 *  exactly (including the IDEA-012 ownership gate and boolean return). */
export function equipEnemySkin(id: string): boolean {
  if (!isEnemySkinOwned(id)) return false;
  setEquippedEnemySkinId(id);
  saveEquippedEnemySkinId(getEquippedEnemySkinId());
  return true;
}
