// OWNER: gameplay-engineer (IDEA-019 accounts)
//
// The in-memory profile. This is what makes the move from localStorage to a
// server survivable: profileStore.ts's 19 SYNCHRONOUS exports read and write
// this object, so game.ts, shop.ts and levelMap.ts keep calling them exactly as
// before — no async plumbing threaded through the game loop, no await in a
// render path, ~27 call sites untouched.
//
// The cache is hydrated once at boot (from GET /auth/me) or at sign-in, and
// thereafter:
//    reads  → straight from here, synchronous, instant
//    writes → mutate here immediately (so the UI updates on the same frame,
//             exactly as localStorage did) AND enqueue a server sync via
//             net/profileSync.ts, whose response replaces the cache with the
//             server's authoritative version.
//
// three-free and storage-free, so it stays importable from src/game/*.

import type { StoredProfile } from "./profileStore";

let cache: StoredProfile | null = null;

/** Set once the server's profile is known — at boot with a valid token, or
 *  immediately after signup/login/recovery. */
export function setProfileCache(profile: StoredProfile): void {
  cache = { ...profile };
}

/** True once the cache is populated. The boot flow uses this to decide between
 *  showing the game and showing the auth gate. */
export function isProfileCacheReady(): boolean {
  return cache !== null;
}

/**
 * The current profile.
 *
 * THROWS if called before hydration, deliberately. The alternative — returning
 * defaults — is how IDEA-021 v3's bug happened: `createMenuScene()` built the
 * showcase dog before the profile loaded, so the menu silently showed the
 * default beagle instead of the equipped skin, and nobody noticed until a
 * player complained. A loud crash in dev is far better than a quiet wrong
 * answer in production.
 *
 * The boot flow in main.ts guarantees this is populated before `new Game()` is
 * ever constructed, so reaching this throw means a real ordering bug.
 */
export function getProfileCache(): StoredProfile {
  if (cache === null) {
    throw new Error(
      "Profile cache read before hydration. The player must be signed in and " +
        "the profile loaded before any game code runs — check the boot order " +
        "in main.ts.",
    );
  }
  return cache;
}

/** Apply a synchronous local change. Returns the updated profile so callers can
 *  respond immediately; the server sync happens separately. */
export function mutateProfileCache(
  fn: (current: StoredProfile) => StoredProfile,
): StoredProfile {
  cache = fn(getProfileCache());
  return cache;
}

/** Replace the cache wholesale with the server's version.
 *
 *  Called after every successful sync, which is what makes optimistic local
 *  writes self-healing: if a purchase was applied locally but the server
 *  disagreed about the balance, the next response silently corrects it. */
export function replaceProfileCache(profile: StoredProfile): void {
  cache = { ...profile };
}

/** Drop everything on sign-out or account deletion. The next read throws, which
 *  is correct — there is no signed-in player any more. */
export function clearProfileCache(): void {
  cache = null;
}
