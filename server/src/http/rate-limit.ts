// OWNER: backend
//
// In-memory rate limiting. STACK.md §6 defers Redis, and with a single
// container there is nothing to share state with — a Map is the correct amount
// of machinery here. If this ever runs multiple replicas the limits become
// per-replica, which is the point at which Redis earns its place.
//
// This is the primary brute-force defence. It matters more than usual because
// argon2's cost parameters are deliberately kept modest (see auth/hash.ts) to
// fit a 384 MB container — the rate limiter, not the hash cost, is what makes
// guessing impractical.

import type { Context, MiddlewareHandler } from "hono";
import { rateLimited } from "./errors.js";

interface Bucket {
  count: number;
  /** Epoch ms when this window ends and the count resets. */
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Without eviction the Map grows one entry per distinct IP/username forever —
// a slow memory leak that a scanner sweeping usernames would accelerate.
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, SWEEP_INTERVAL_MS);
// Don't hold the event loop open on shutdown.
sweeper.unref();

/** Client IP. Cloudflare sits in front of everything (orange cloud), so
 *  CF-Connecting-IP is authoritative and cannot be spoofed by a client — it is
 *  set by the proxy. X-Forwarded-For is the fallback for a direct/grey-cloud
 *  request; its FIRST entry is the original client. */
function clientIp(c: Context): string {
  const cf = c.req.header("CF-Connecting-IP");
  if (cf) return cf;

  const xff = c.req.header("X-Forwarded-For");
  if (xff) return xff.split(",")[0].trim();

  return "unknown";
}

export interface RateLimitOptions {
  /** Requests allowed per window. */
  limit: number;
  windowMs: number;
  /** Distinguishes buckets between endpoints so login and signup don't share. */
  name: string;
  /** Extra key component, e.g. the submitted username — so one attacker can't
   *  lock every account by hammering from one IP, and one account can't be
   *  hammered from many IPs. May be async (reading the JSON body). */
  keyFrom?: (c: Context) => string | undefined | Promise<string | undefined>;
}

export function rateLimit(options: RateLimitOptions): MiddlewareHandler {
  const { limit, windowMs, name, keyFrom } = options;

  return async (c, next) => {
    const extra = keyFrom ? await keyFrom(c) : undefined;
    const key = `${name}:${clientIp(c)}${extra ? `:${extra.toLowerCase()}` : ""}`;
    const now = Date.now();

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count++;

    if (bucket.count > limit) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      c.header("Retry-After", String(retryAfter));
      throw rateLimited(
        `Too many attempts. Try again in ${retryAfter > 60 ? `${Math.ceil(retryAfter / 60)} minutes` : `${retryAfter} seconds`}.`,
      );
    }

    await next();
  };
}

/** Read a field from the JSON body for keying, without consuming the stream for
 *  the handler. Hono caches the parsed body, so this is safe to call first. */
export function bodyField(field: string): (c: Context) => Promise<string | undefined> {
  return async (c: Context) => {
    try {
      const body = await c.req.json();
      const value = (body as Record<string, unknown>)[field];
      return typeof value === "string" ? value : undefined;
    } catch {
      return undefined;
    }
  };
}

/** Test-only: reset all buckets so one test's attempts don't rate-limit the
 *  next. Never called in production. */
export function __resetRateLimits(): void {
  buckets.clear();
}
