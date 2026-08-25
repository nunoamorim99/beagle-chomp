// OWNER: backend
//
// P1 of IDEA-039: per-request timing, so the first real bottleneck is found on
// a graph instead of by a player complaining that the game feels slow.
//
// Everything here is in-memory and per-process, exactly like rate-limit.ts and
// boardCache.ts, and for the same reason: one container, nothing to share state
// with. Unlike those two, this one does not even need to be shared — timings
// from a second replica would be a SEPARATE series anyway, not a merged one.
//
// COST PER REQUEST: two Date.now() calls and one array write. That is the whole
// budget. Anything that needed a sort, an allocation, or a string concat per
// request would defeat the purpose of measuring in the first place — so the
// sorting happens once per flush, over at most RING_CAPACITY samples.
//
// This module is PURE: no Hono, no pg, no clock beyond Date.now(). That is what
// lets scripts/test-metrics.ts exercise the percentile maths, the ring wrap and
// the cardinality guard without a server or a database.

/** Per-key sample capacity. The percentile is therefore over "the last 512
 *  requests to this route", which for a low-traffic API is effectively the
 *  whole flush window, and for a busy one is a recency window — the useful
 *  behaviour in both cases. 512 doubles as the cost ceiling: 64 routes × 512
 *  float64 ≈ 256 KB, bounded no matter how long the process runs. */
const RING_CAPACITY = 512;

/** Distinct route keys we will track. Route keys come from Hono's matched
 *  PATTERN (`/sessions/:id/finish`), never the raw URL, so this cap should
 *  never be approached — it exists so that a future routing mistake that leaks
 *  ids into keys degrades into one "(other)" bucket instead of into unbounded
 *  memory growth. */
const MAX_KEYS = 64;

/** Bucket for keys beyond MAX_KEYS. Its presence in a snapshot is itself the
 *  alarm: it means route keys are not the low-cardinality patterns we assume. */
export const OVERFLOW_KEY = "(other)";

/** Requests that matched no route at all — 404s, scanners, probes. Grouped so
 *  that a bot walking /wp-admin, /.env and friends cannot create a key each. */
export const UNMATCHED_KEY = "(unmatched)";

interface RouteStats {
  /** Requests seen in this window (may exceed the ring's sample count). */
  count: number;
  /** Ring of the most recent durations, in ms. Fixed length RING_CAPACITY. */
  durations: Float64Array;
  /** Next write index into `durations`. */
  cursor: number;
  /** How many slots of `durations` hold a real sample (< RING_CAPACITY until
   *  the ring first wraps). */
  filled: number;
  /** Worst single request in the window — kept exactly, because the ring can
   *  lose the outlier that matters most before the next flush. */
  maxMs: number;
  /** Total duration, for the mean. Cheap and useful next to p95: a p95 far
   *  above the mean means a few slow requests, not a slow route. */
  totalMs: number;
  status2xx: number;
  status3xx: number;
  status4xx: number;
  status5xx: number;
}

const routes = new Map<string, RouteStats>();

/** Set by resetWindow(); a snapshot reports "since this moment". */
let windowStartedAt = Date.now();

/** Lifetime counters, deliberately NOT reset by the flush — a window can be
 *  quiet while the process has served a million requests, and both facts are
 *  worth having in the same view. */
let lifetimeRequests = 0;
let lifetimeSlowRequests = 0;

function blankStats(): RouteStats {
  return {
    count: 0,
    durations: new Float64Array(RING_CAPACITY),
    cursor: 0,
    filled: 0,
    maxMs: 0,
    totalMs: 0,
    status2xx: 0,
    status3xx: 0,
    status4xx: 0,
    status5xx: 0,
  };
}

/**
 * Record one finished request.
 *
 * `key` must be a bounded-cardinality label — a route PATTERN, or one of the
 * two exported sentinels. Callers that cannot guarantee that should pass
 * UNMATCHED_KEY rather than a raw path.
 */
export function recordRequest(key: string, status: number, durationMs: number): void {
  let stats = routes.get(key);
  if (!stats) {
    // Cardinality guard: never grow past MAX_KEYS distinct buckets.
    if (routes.size >= MAX_KEYS) {
      stats = routes.get(OVERFLOW_KEY);
      if (!stats) {
        // Pathological but possible: the map is full of real keys and the
        // overflow bucket does not exist yet. Drop the sample rather than
        // exceed the cap — losing one measurement beats an unbounded map.
        lifetimeRequests++;
        return;
      }
    } else {
      stats = blankStats();
      routes.set(key, stats);
    }
  }

  stats.count++;
  stats.durations[stats.cursor] = durationMs;
  stats.cursor = (stats.cursor + 1) % RING_CAPACITY;
  if (stats.filled < RING_CAPACITY) stats.filled++;
  if (durationMs > stats.maxMs) stats.maxMs = durationMs;
  stats.totalMs += durationMs;

  if (status >= 500) stats.status5xx++;
  else if (status >= 400) stats.status4xx++;
  else if (status >= 300) stats.status3xx++;
  else stats.status2xx++;

  lifetimeRequests++;
}

/** Counted separately from recordRequest so the lifetime "slow" tally survives
 *  a window reset — see the slow-request warning in index.ts. */
export function countSlowRequest(): void {
  lifetimeSlowRequests++;
}

/**
 * Nearest-rank percentile over `samples[0..n)`.
 *
 * Nearest-rank rather than interpolated on purpose: with a handful of samples
 * an interpolated p95 invents a duration that no request actually took, which
 * is exactly the kind of number that gets argued with at 3am. This one is
 * always a real observation.
 *
 * MUTATES the array it is given (it sorts in place) — callers pass a scratch
 * copy, never the live ring.
 */
export function percentile(samples: Float64Array, n: number, p: number): number {
  if (n <= 0) return 0;
  const slice = samples.subarray(0, n);
  slice.sort();
  const rank = Math.ceil(p * n);
  const index = Math.min(n - 1, Math.max(0, rank - 1));
  return slice[index];
}

export interface RouteSnapshot {
  route: string;
  count: number;
  p50: number;
  p95: number;
  maxMs: number;
  meanMs: number;
  status2xx: number;
  status3xx: number;
  status4xx: number;
  status5xx: number;
}

export interface MetricsSnapshot {
  /** ms since the window began — i.e. since process start or the last flush. */
  windowMs: number;
  windowStartedAt: string;
  lifetimeRequests: number;
  lifetimeSlowRequests: number;
  /** Busiest first, so the top of the table is the traffic that matters. */
  routes: RouteSnapshot[];
}

/** Read-only view of the current window. Never resets — the periodic logger
 *  calls resetWindow() explicitly after it has logged, so that polling
 *  /metrics cannot silently blank the log's data (or the reverse). */
export function snapshot(now = Date.now()): MetricsSnapshot {
  const scratch = new Float64Array(RING_CAPACITY);
  const out: RouteSnapshot[] = [];

  for (const [route, s] of routes) {
    if (s.count === 0) continue;
    scratch.set(s.durations.subarray(0, s.filled));
    // percentile() sorts its input, so p50 must be taken from a fresh copy —
    // sorting is idempotent here, but reusing the sorted scratch for p95 is
    // only correct because both read the SAME sorted samples. Kept explicit.
    const p50 = percentile(scratch, s.filled, 0.5);
    const p95 = percentile(scratch, s.filled, 0.95);
    out.push({
      route,
      count: s.count,
      p50: round1(p50),
      p95: round1(p95),
      maxMs: round1(s.maxMs),
      meanMs: round1(s.totalMs / s.count),
      status2xx: s.status2xx,
      status3xx: s.status3xx,
      status4xx: s.status4xx,
      status5xx: s.status5xx,
    });
  }

  out.sort((a, b) => b.count - a.count || a.route.localeCompare(b.route));

  return {
    windowMs: now - windowStartedAt,
    windowStartedAt: new Date(windowStartedAt).toISOString(),
    lifetimeRequests,
    lifetimeSlowRequests,
    routes: out,
  };
}

/** Start a fresh window. Drops per-route state entirely (rather than zeroing
 *  it) so a route that stops receiving traffic stops appearing in the table —
 *  a log line per idle route, every ten minutes, forever, is how a useful log
 *  becomes one nobody reads. */
export function resetWindow(now = Date.now()): void {
  routes.clear();
  windowStartedAt = now;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Format the window as fixed-width lines for the container log. Returns an
 *  empty array when nothing was served, so the periodic logger can stay silent
 *  on an idle API instead of printing an empty table every ten minutes. */
export function formatSnapshotLines(snap: MetricsSnapshot): string[] {
  if (snap.routes.length === 0) return [];

  const minutes = (snap.windowMs / 60_000).toFixed(1);
  const width = Math.min(
    44,
    Math.max(12, ...snap.routes.map((r) => r.route.length)),
  );

  const lines = [
    `[metrics] last ${minutes}m — ${snap.lifetimeRequests} req lifetime, ` +
      `${snap.lifetimeSlowRequests} slow`,
    `[metrics] ${"route".padEnd(width)}  ${"n".padStart(6)} ${"p50".padStart(8)} ` +
      `${"p95".padStart(8)} ${"max".padStart(8)}  4xx/5xx`,
  ];

  for (const r of snap.routes) {
    lines.push(
      `[metrics] ${r.route.slice(0, width).padEnd(width)}  ` +
        `${String(r.count).padStart(6)} ${`${r.p50}ms`.padStart(8)} ` +
        `${`${r.p95}ms`.padStart(8)} ${`${r.maxMs}ms`.padStart(8)}  ` +
        `${r.status4xx}/${r.status5xx}`,
    );
  }

  return lines;
}

/** Test-only, mirroring __resetBoardCache / __resetRateLimits. */
export function __resetMetrics(): void {
  routes.clear();
  windowStartedAt = Date.now();
  lifetimeRequests = 0;
  lifetimeSlowRequests = 0;
}
