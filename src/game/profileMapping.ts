// OWNER: gameplay-engineer (IDEA-019 accounts)
//
// Converts the server's profile shape into the game's StoredProfile.
//
// Separate from profileCache.ts so that module stays free of any network types,
// and separate from profileStore.ts to avoid an import cycle (profileSync needs
// this, profileStore needs profileCache).
//
// The sanitisation here is deliberate even though the data comes from our own
// server: an id the client doesn't recognise (a cosmetic added server-side and
// not yet shipped to this build, or an old build talking to a new API) would
// otherwise reach cosmetics.ts and produce a missing-skin crash mid-render.
// Same defensive posture profileStore.ts has always applied to localStorage.

import {
  BEAGLE_SKINS,
  DEFAULT_BEAGLE_SKIN_ID,
  ENEMY_SKINS,
  DEFAULT_ENEMY_SKIN_ID,
} from "./cosmetics";
import { MAZE_THEMES, DEFAULT_MAZE_THEME_ID } from "./themes";
import { CHALLENGE_LEVEL_COUNT } from "./challenges";
import type { StoredProfile } from "./profileStore";
import type { ServerProfile } from "../net/endpoints";

function knownBeagle(id: unknown): id is string {
  return typeof id === "string" && BEAGLE_SKINS.some((s) => s.id === id);
}

function knownEnemy(id: unknown): id is string {
  return typeof id === "string" && ENEMY_SKINS.some((s) => s.id === id);
}

function knownTheme(id: unknown): id is string {
  return typeof id === "string" && MAZE_THEMES.some((t) => t.id === id);
}

function sanitizeCount(value: unknown, max?: number): number {
  const n = typeof value === "number" ? value : NaN;
  if (!Number.isFinite(n) || n < 0) return 0;
  const floored = Math.floor(n);
  return max === undefined ? floored : Math.min(floored, max);
}

/** Filter to ids this build knows about, and always union in the default so a
 *  player can never end up unable to equip anything. */
function sanitizeOwned(
  value: unknown,
  isKnown: (id: unknown) => boolean,
  defaultId: string,
): string[] {
  const known = Array.isArray(value) ? value.filter(isKnown) : [];
  return Array.from(new Set([defaultId, ...(known as string[])]));
}

export function fromServerProfile(profile: ServerProfile): StoredProfile {
  const ownedBeagle = sanitizeOwned(
    profile.owned?.beagleSkinIds,
    knownBeagle,
    DEFAULT_BEAGLE_SKIN_ID,
  );
  const ownedEnemy = sanitizeOwned(
    profile.owned?.enemySkinIds,
    knownEnemy,
    DEFAULT_ENEMY_SKIN_ID,
  );
  const ownedThemes = sanitizeOwned(
    profile.owned?.mazeThemeIds,
    knownTheme,
    DEFAULT_MAZE_THEME_ID,
  );

  // An equipped id must be both known AND owned. Falling back to the default
  // rather than trusting it keeps a stale build from rendering a skin it can't
  // build — the same guard initProfileFromStorage has always applied.
  const equippedBeagle = profile.equipped?.beagleSkinId;
  const equippedEnemy = profile.equipped?.enemySkinId;
  const equippedTheme = profile.equipped?.mazeThemeId;

  return {
    equippedBeagleSkinId:
      knownBeagle(equippedBeagle) && ownedBeagle.includes(equippedBeagle)
        ? equippedBeagle
        : DEFAULT_BEAGLE_SKIN_ID,
    equippedEnemySkinId:
      knownEnemy(equippedEnemy) && ownedEnemy.includes(equippedEnemy)
        ? equippedEnemy
        : DEFAULT_ENEMY_SKIN_ID,
    equippedMazeThemeId:
      knownTheme(equippedTheme) && ownedThemes.includes(equippedTheme)
        ? equippedTheme
        : DEFAULT_MAZE_THEME_ID,
    coins: sanitizeCount(profile.coins),
    ownedBeagleSkinIds: ownedBeagle,
    ownedEnemySkinIds: ownedEnemy,
    ownedMazeThemeIds: ownedThemes,
    challengeProgress: sanitizeCount(profile.challengeProgress, CHALLENGE_LEVEL_COUNT),
    // Anything unrecognised degrades to the default rather than reaching the
    // input layer, same defensive posture as the cosmetic ids above.
    controlScheme: profile.controlScheme === "dpad" ? "dpad" : "swipe",
  };
}
