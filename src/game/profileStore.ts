// OWNER: gameplay-engineer (IDEA-010 beagle skins — profile persistence)
//
// localStorage persistence for player *profile/preference* state (currently
// just the equipped beagle skin; coins/owned-skins land here later without a
// new storage key). This is UI/profile preference, not core gameplay state
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
} from "./cosmetics";

const PROFILE_STORAGE_KEY = "beagle-chomp:profile";

/** The persisted profile shape. Deliberately small today; add fields (coins,
 *  ownedSkinIds, ...) as optional/defaulted so old saved blobs stay valid —
 *  see loadProfile's read-defensively-and-spread-over-defaults approach. */
export interface StoredProfile {
  equippedBeagleSkinId: string;
}

function defaultProfile(): StoredProfile {
  return { equippedBeagleSkinId: DEFAULT_BEAGLE_SKIN_ID };
}

function isKnownSkinId(id: unknown): id is string {
  return typeof id === "string" && BEAGLE_SKINS.some((s) => s.id === id);
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

    const candidate = (parsed as Record<string, unknown>).equippedBeagleSkinId;
    return {
      ...defaultProfile(),
      equippedBeagleSkinId: isKnownSkinId(candidate) ? candidate : DEFAULT_BEAGLE_SKIN_ID,
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
 *  in that case, so this just re-affirms cosmetics.ts's existing default. */
export function initProfileFromStorage(): void {
  const profile = loadProfile();
  setEquippedBeagleSkinId(profile.equippedBeagleSkinId);
}

/** Equips a skin AND persists the choice, ignoring unknown ids the same way
 *  setEquippedBeagleSkinId does (setEquippedBeagleSkinId clamps to the
 *  default itself, so reading the id back afterwards is always a known-good
 *  value to persist). This is the function UI code (e.g. the temporary cycle
 *  button) should call so a pick survives reload; cosmetics.ts's plain
 *  setEquippedBeagleSkinId stays available for tests/callers that want
 *  in-memory-only state. */
export function equipBeagleSkin(id: string): void {
  setEquippedBeagleSkinId(id);
  saveEquippedBeagleSkinId(getEquippedBeagleSkinId());
}
