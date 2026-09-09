// OWNER: backend
//
// /api/v1/announcements/* — what the game's News screen reads (IDEA-052).
//
// Player-facing and READ-ONLY except for one thing: marking the feed seen.
// Everything that CREATES or publishes a note lives behind requireAdmin in
// routes/admin.ts, so there is no path from a player's token to the content.
//
// Mounted at its own prefix like the admin app, and for the same reason —
// profileRoutes and sessionRoutes each declare a `use("*")` that Hono turns
// into ALL /api/v1/*, so anything mounted at "/" after them inherits their
// middleware stack.

import { Hono } from "hono";
import { requireAuth, type AuthVars } from "../http/auth-middleware.js";
import { rateLimit } from "../http/rate-limit.js";
import * as repo from "../repo/announcements.js";

export const announcementRoutes = new Hono<{ Variables: AuthVars }>();

announcementRoutes.use("*", rateLimit({ name: "news", limit: 60, windowMs: 60_000 }));
announcementRoutes.use("*", requireAuth);

/** How many notes the feed ever returns. The News screen is a short list of
 *  what changed recently, not an archive — and a player who has been away for a
 *  year does not want fifty cards. */
const FEED_LIMIT = 25;

/**
 * The feed, plus the unread count the bell's dot is drawn from.
 *
 * Both come back in ONE call because the menu needs the count on every boot and
 * the list only when the screen opens — but fetching the count alone would be a
 * second round trip for one integer, and the payload here is a few KB at most.
 */
announcementRoutes.get("/announcements", async (c) => {
  const user = c.get("user");
  const [items, unread] = await Promise.all([
    repo.listPublished(FEED_LIMIT),
    repo.countUnread(user.announcements_seen_at),
  ]);

  return c.json({
    unread,
    items: items.map((a) => ({
      id: a.id,
      kind: a.kind,
      version: a.version,
      title: a.title,
      body: a.body,
      // Date only: a release note is a thing that happened on a day, and a
      // timestamp would invite a client to render a local time that means
      // nothing to anyone.
      publishedAt: a.published_at ? a.published_at.toISOString().slice(0, 10) : null,
      // Whether THIS card is new to THIS player, so the screen can mark the
      // unread ones rather than only counting them.
      isNew:
        user.announcements_seen_at === null ||
        (a.published_at !== null && a.published_at > user.announcements_seen_at),
    })),
  });
});

/**
 * Mark the feed seen. Stamped with the server's clock — a client cannot set
 * this forward and silently suppress a note it never showed anyone.
 *
 * Deliberately NOT idempotent-by-id: there is nothing to mark per note, only
 * "I have now looked", which is what the single timestamp encodes.
 */
announcementRoutes.post("/announcements/seen", async (c) => {
  await repo.markSeen(c.get("user").id);
  return c.body(null, 204);
});
