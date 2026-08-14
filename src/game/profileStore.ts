// OWNER: gameplay-engineer (IDEA-010 skins → IDEA-012 shop → IDEA-019 accounts)
//
// Player profile state: equipped/owned cosmetics, the coin wallet, and
// challenge progress.
//
// ============================================================================
// IDEA-019 changed WHERE this lives, but deliberately NOT how it is called.
// ============================================================================
//
// Until v4.2 this module read and wrote a single localStorage blob. It now
// reads and writes an in-memory cache (profileCache.ts) that is hydrated from
// the server at sign-in, with mutations pushed back through a background sync
// queue (net/profileSync.ts).
//
// Every one of the exports below kept its EXACT signature — still synchronous,
// still returning the same types, still never throwing. That was the whole
// design goal: game.ts, ui/shop.ts and ui/levelMap.ts call these ~27 times
// across hot paths (including inside the frame loop), and threading async
// through all of that would have meant touching the game loop, the shop
// rendering and the level map for no player-visible benefit.
//
// The one semantic shift worth knowing about, called out again at each site:
//   addCoins() and advanceChallengeProgress() are now OPTIMISTIC LOCAL updates.
//   The server is authoritative for both — coins are awarded and challenge
//   progress advanced by the run-submission endpoint in Increment 2 — so these
//   keep the HUD honest during a run and are corrected by the next sync.
//
// Why local storage is gone entirely: sign-in is required before play
// (no guest mode), so there is no local-only state left to persist. The old
// "beagle-chomp:profile" key is intentionally NOT deleted — it costs nothing to
// leave, and it is the only trace of a pre-accounts save if we ever want it.
//
// Browser-only (the cache is memory, but the sync layer touches fetch) yet
// three-free, so it stays importable from src/game/*, src/ui/* and src/render/*.

import {
  BEAGLE_SKINS,
  DEFAULT_BEAGLE_SKIN_ID,
  setEquippedBeagleSkinId,
  getBeagleSkinPrice,
  ENEMY_SKINS,
  DEFAULT_ENEMY_SKIN_ID,
  setEquippedEnemySkinId,
  getEnemySkinPrice,
} from "./cosmetics";
import { CHALLENGE_LEVEL_COUNT } from "./challenges";
import {
  MAZE_THEMES,
  DEFAULT_MAZE_THEME_ID,
  setEquippedMazeThemeId,
  getMazeThemePrice,
} from "./themes";
import {
  getProfileCache,
  mutateProfileCache,
  isProfileCacheReady,
} from "./profileCache";
import { enqueueEquip, enqueuePurchase, enqueueControlScheme } from "../net/profileSync";

/** The profile shape. Unchanged from the localStorage era so the rest of the
 *  game sees exactly what it always did; the server's own shape is mapped onto
 *  this in profileMapping.ts.
 *
 *  `challengeProgress` convention: the highest challenge LEVEL INDEX (0-based)
 *  the player has UNLOCKED. 0 means only level 1 is playable; N means levels
 *  0..N are. The sentinel CHALLENGE_LEVEL_COUNT (one past the last index) means
 *  "every level cleared" — deliberately distinct from COUNT-1, so clearing the
 *  finale is distinguishable from merely having unlocked it. */
export interface StoredProfile {
  equippedBeagleSkinId: string;
  equippedEnemySkinId: string;
  coins: number;
  ownedBeagleSkinIds: string[];
  ownedEnemySkinIds: string[];
  challengeProgress: number;
  equippedMazeThemeId: string;
  ownedMazeThemeIds: string[];
  /** IDEA-038: "swipe" (default) or "dpad". Per-account, so a player who
   *  prefers buttons gets them on every device they sign in from. */
  controlScheme: ControlScheme;
}

export type ControlScheme = "swipe" | "dpad";

// ---------------------------------------------------------------------------
// Validation helpers. Still exported-in-spirit (used by the tests) and still
// applied to everything that enters the cache, because an unknown id reaching
// cosmetics.ts would crash the renderer mid-frame.

function isKnownSkinId(id: unknown): id is string {
  return typeof id === "string" && BEAGLE_SKINS.some((s) => s.id === id);
}

function isKnownEnemySkinId(id: unknown): id is string {
  return typeof id === "string" && ENEMY_SKINS.some((s) => s.id === id);
}

function isKnownMazeThemeId(id: unknown): id is string {
  return typeof id === "string" && MAZE_THEMES.some((t) => t.id === id);
}

/** A valid coin count: finite, non-negative, integral. Anything else degrades
 *  to 0 rather than propagating garbage into the wallet. */
export function sanitizeCoins(value: unknown): number {
  const n = typeof value === "number" ? value : NaN;
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

/** Mirrors sanitizeCoins, plus the upper clamp challengeProgress needs. */
export function sanitizeChallengeProgress(value: unknown): number {
  const n = typeof value === "number" ? value : NaN;
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.floor(n), CHALLENGE_LEVEL_COUNT);
}

/** The shape a brand-new account starts with: nothing owned but the free
 *  defaults, no coins, no challenge progress. Matches the server's column
 *  defaults in 001_init.sql exactly. */
export function defaultProfile(): StoredProfile {
  return {
    equippedBeagleSkinId: DEFAULT_BEAGLE_SKIN_ID,
    equippedEnemySkinId: DEFAULT_ENEMY_SKIN_ID,
    coins: 0,
    ownedBeagleSkinIds: [DEFAULT_BEAGLE_SKIN_ID],
    ownedEnemySkinIds: [DEFAULT_ENEMY_SKIN_ID],
    challengeProgress: 0,
    equippedMazeThemeId: DEFAULT_MAZE_THEME_ID,
    ownedMazeThemeIds: [DEFAULT_MAZE_THEME_ID],
    controlScheme: "swipe",
  };
}

// ---------------------------------------------------------------------------
// Reads. All synchronous, straight off the cache.

/** The current profile. Throws if the cache isn't hydrated — see
 *  profileCache.getProfileCache for why that's deliberate rather than
 *  defaulting silently. */
export function loadProfile(): StoredProfile {
  return getProfileCache();
}

export function getCoins(): number {
  return getProfileCache().coins;
}

export function getChallengeProgress(): number {
  return getProfileCache().challengeProgress;
}

export function getOwnedBeagleSkinIds(): string[] {
  return [...getProfileCache().ownedBeagleSkinIds];
}

export function getOwnedEnemySkinIds(): string[] {
  return [...getProfileCache().ownedEnemySkinIds];
}

export function getOwnedMazeThemeIds(): string[] {
  return [...getProfileCache().ownedMazeThemeIds];
}

/** IDEA-038. Synchronous like every other read here. */
export function getControlScheme(): ControlScheme {
  return getProfileCache().controlScheme;
}

/** Set the control scheme: mutate locally for an instant UI response, then
 *  persist against the account in the background. */
export function setControlScheme(scheme: ControlScheme): void {
  mutateProfileCache((p) => ({ ...p, controlScheme: scheme }));
  enqueueControlScheme(scheme);
}

export function isBeagleSkinOwned(id: string): boolean {
  return getProfileCache().ownedBeagleSkinIds.includes(id);
}

export function isEnemySkinOwned(id: string): boolean {
  return getProfileCache().ownedEnemySkinIds.includes(id);
}

export function isMazeThemeOwned(id: string): boolean {
  return getProfileCache().ownedMazeThemeIds.includes(id);
}

// ---------------------------------------------------------------------------
// Equipping. Local mutation + a background PATCH.

export function saveEquippedBeagleSkinId(id: string): void {
  mutateProfileCache((p) => ({ ...p, equippedBeagleSkinId: id }));
  enqueueEquip({ beagleSkinId: id });
}

export function saveEquippedEnemySkinId(id: string): void {
  mutateProfileCache((p) => ({ ...p, equippedEnemySkinId: id }));
  enqueueEquip({ enemySkinId: id });
}

export function saveEquippedMazeThemeId(id: string): void {
  mutateProfileCache((p) => ({ ...p, equippedMazeThemeId: id }));
  enqueueEquip({ mazeThemeId: id });
}

// ---------------------------------------------------------------------------
// Coins.

/**
 * Adds `n` coins to the LOCAL wallet, floored at 0.
 *
 * SEMANTIC NOTE (IDEA-019): this is now an optimistic, local-only update. The
 * server is authoritative for coins — they are awarded when a run is submitted
 * (Increment 2), recomputed server-side from the accepted score so a client
 * can't mint currency. This call exists so the HUD counter moves the instant a
 * coin is collected mid-run, exactly as it did before; the next profile sync
 * replaces it with the server's number.
 *
 * Consequently: do NOT treat a local coin increase as banked. Purchases are
 * validated server-side against the real balance.
 */
export function addCoins(n: number): void {
  const delta = Number.isFinite(n) ? n : 0;
  mutateProfileCache((p) => ({
    ...p,
    coins: Math.max(0, p.coins + delta),
  }));
}

/**
 * Raises challenge progress to at least `clearedIdx + 1`, never lowering it.
 *
 * SEMANTIC NOTE (IDEA-019): optimistic and local, like addCoins. The server
 * advances the real value only when a challenge clear is submitted AND passes
 * plausibility validation (Increment 2) — otherwise anyone could unlock every
 * level with a single request.
 */
export function advanceChallengeProgress(clearedIdx: number): void {
  const idx = Number.isFinite(clearedIdx) ? Math.floor(clearedIdx) : -1;
  if (idx < 0) return;

  const next = Math.min(idx + 1, CHALLENGE_LEVEL_COUNT);
  mutateProfileCache((p) => ({
    ...p,
    challengeProgress: Math.max(p.challengeProgress, next),
  }));
}

// ---------------------------------------------------------------------------
// Purchases.

/** Why a purchase was refused. Unchanged — ui/shop.ts switches on these. */
export interface BuyResult {
  ok: boolean;
  reason?: "already-owned" | "insufficient-coins" | "unknown";
}

/**
 * Shared purchase path. Validates against the CACHED balance so the shop can
 * respond synchronously (the button state updates on the same frame), then
 * enqueues the real purchase.
 *
 * The local check is an optimisation, not the authority: the server re-checks
 * ownership and affordability against its own catalog price, and a rejection
 * triggers a resync that corrects the cache. So the worst case for a client
 * that lies to itself is a purchase that briefly appears to work and then
 * reverts — never a free item.
 */
function buyCosmetic(
  id: string,
  kind: "beagle" | "enemy" | "theme",
  isKnown: (id: unknown) => boolean,
  price: (id: string) => number,
  ownedKey: keyof Pick<
    StoredProfile,
    "ownedBeagleSkinIds" | "ownedEnemySkinIds" | "ownedMazeThemeIds"
  >,
): BuyResult {
  if (!isKnown(id)) return { ok: false, reason: "unknown" };

  const profile = getProfileCache();
  if (profile[ownedKey].includes(id)) return { ok: false, reason: "already-owned" };

  const cost = price(id);
  if (profile.coins < cost) return { ok: false, reason: "insufficient-coins" };

  // Deduct and grant together, so no caller can observe one without the other
  // — the same atomicity the old localStorage read-modify-write guaranteed.
  mutateProfileCache((p) => ({
    ...p,
    coins: p.coins - cost,
    [ownedKey]: [...p[ownedKey], id],
  }));

  enqueuePurchase(kind, id);
  return { ok: true };
}

export function buyBeagleSkin(id: string): BuyResult {
  return buyCosmetic(id, "beagle", isKnownSkinId, getBeagleSkinPrice, "ownedBeagleSkinIds");
}

export function buyEnemySkin(id: string): BuyResult {
  return buyCosmetic(id, "enemy", isKnownEnemySkinId, getEnemySkinPrice, "ownedEnemySkinIds");
}

export function buyMazeTheme(id: string): BuyResult {
  return buyCosmetic(id, "theme", isKnownMazeThemeId, getMazeThemePrice, "ownedMazeThemeIds");
}

// ---------------------------------------------------------------------------
// Equip operations (ownership-gated), and boot wiring.

export function equipBeagleSkin(id: string): boolean {
  if (!isKnownSkinId(id) || !isBeagleSkinOwned(id)) return false;
  setEquippedBeagleSkinId(id);
  saveEquippedBeagleSkinId(id);
  return true;
}

export function equipEnemySkin(id: string): boolean {
  if (!isKnownEnemySkinId(id) || !isEnemySkinOwned(id)) return false;
  setEquippedEnemySkinId(id);
  saveEquippedEnemySkinId(id);
  return true;
}

export function equipMazeTheme(id: string): boolean {
  if (!isKnownMazeThemeId(id) || !isMazeThemeOwned(id)) return false;
  setEquippedMazeThemeId(id);
  saveEquippedMazeThemeId(id);
  return true;
}

/**
 * Pushes the hydrated profile's equipped ids into cosmetics.ts/themes.ts's
 * in-memory state. Called as the FIRST statement of the Game constructor,
 * because createMenuScene() bakes the showcase beagle from the equipped skin at
 * construction time (the IDEA-021 v3 bug: the menu showed the default dog
 * because the profile hadn't loaded yet).
 *
 * Renamed from initProfileFromStorage — the profile no longer comes from
 * storage, and a name that says otherwise would send the next reader looking
 * for localStorage that isn't there.
 *
 * PRECONDITION: the cache must already be hydrated. main.ts guarantees this by
 * awaiting sign-in before constructing Game; if it's ever violated this throws
 * loudly rather than silently equipping defaults.
 */
export function initProfileFromCache(): void {
  const profile = getProfileCache();

  // Belt-and-braces: an equipped id must also be owned. fromServerProfile
  // already enforces this, but repeating it here means a future code path that
  // writes the cache directly still can't leave the player equipped with
  // something they don't own.
  const beagle = isBeagleSkinOwned(profile.equippedBeagleSkinId)
    ? profile.equippedBeagleSkinId
    : DEFAULT_BEAGLE_SKIN_ID;
  const enemy = isEnemySkinOwned(profile.equippedEnemySkinId)
    ? profile.equippedEnemySkinId
    : DEFAULT_ENEMY_SKIN_ID;
  const theme = isMazeThemeOwned(profile.equippedMazeThemeId)
    ? profile.equippedMazeThemeId
    : DEFAULT_MAZE_THEME_ID;

  setEquippedBeagleSkinId(beagle);
  setEquippedEnemySkinId(enemy);
  setEquippedMazeThemeId(theme);
}

/** @deprecated Kept as a thin alias so any missed call site still compiles and
 *  behaves correctly. Prefer initProfileFromCache. */
export function initProfileFromStorage(): void {
  initProfileFromCache();
}

/** True once a profile is loaded. Lets UI code check before reading rather than
 *  catching a throw. */
export function isProfileReady(): boolean {
  return isProfileCacheReady();
}
