// OWNER: backend
//
// P2 of the scale assessment (2026-08-18): a tiny TTL cache for the two
// leaderboard reads — the hottest queries in the app and identical for every
// viewer. Only the "that's you" highlight differs per player, and that is
// DERIVED per-request from these cached rows (profileService), never stored
// here. So the cache holds raw repo data only, and a crowd opening the board
// at once costs the database one query per 15 seconds instead of one per
// viewer.
//
// db.ts's header promised this exact seam: "data access behind a
// service/repository layer, so adding a cache later is a one-file change."
// This is that file.
//
// STALENESS CONTRACT: at most TTL_MS, EXCEPT after a classic run is accepted
// or an account is deleted — both invalidate immediately. The accept case is
// load-bearing for UX: the game-over panel's 🏆 button opens the board
// straight after a run, and the player must see that run on it (the
// production verification asserts exactly this).
//
// In-memory and per-process, like the rate limiter: with a single container
// there is nothing to share state with. If this ever runs multiple replicas,
// invalidation stops crossing processes and the TTL becomes the only bound —
// that is the moment Redis earns its place (STACK.md §6), not before.

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

const TTL_MS = 15_000;

/** Keys are `${board}:${limit}` — the client only ever uses one limit per
 *  board, and limits are clamped in the service, so this stays tiny. */
const entries = new Map<string, CacheEntry>();

export function boardCacheGet<T>(board: "players" | "runs", limit: number): T | null {
  const key = `${board}:${limit}`;
  const entry = entries.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    entries.delete(key);
    return null;
  }
  return entry.value as T;
}

export function boardCacheSet(board: "players" | "runs", limit: number, value: unknown): void {
  entries.set(`${board}:${limit}`, { value, expiresAt: Date.now() + TTL_MS });
}

/** Called when the underlying data changes: a classic run accepted (new row on
 *  the runs board, possibly a new personal best on the players board) or an
 *  account deleted (its rows must vanish NOW — "hard delete" is a privacy
 *  promise, and a 15-second ghost on a public board would break its spirit). */
export function invalidateBoardCache(): void {
  entries.clear();
}

/** Test-only, mirroring __resetRateLimits: tests that write scores with raw
 *  SQL (bypassing the services, so no invalidation fires) call this before
 *  reading the board. Never called in production. */
export function __resetBoardCache(): void {
  entries.clear();
}
