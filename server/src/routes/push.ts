// OWNER: backend
//
// /api/v1/push/* — subscribing a browser to notifications (IDEA-052b).
//
// THE WHOLE SUB-APP IS ONLY REGISTERED WHEN VAPID KEYS EXIST. Without them
// these paths 404 exactly like any unknown one, which is the same construction
// GET /metrics uses: a feature that is off is a feature that does not exist,
// rather than one that answers "not configured" and advertises itself. It also
// means local dev needs no keys, and push can be turned off in Dokploy by
// clearing an env var rather than by a deploy.
//
// MOUNTED AT ITS OWN PREFIX (/api/v1/push), and that is not cosmetic. The
// routes here declare their own `use(...)` stack, and so do profileRoutes,
// sessionRoutes and announcementRoutes — all mounted at "/". Hono turns each of
// those into `ALL /api/v1/*` running in registration order, so mounting this at
// "/" after them put announcementRoutes' requireAuth in front of
// /push/vapid-key, which is deliberately PUBLIC. It answered 401, and an
// unknown /push/* path answered 401 rather than 404. Same trap that makes a
// /sessions request authenticate twice.

import { Hono } from "hono";
import { requireAuth, type AuthVars } from "../http/auth-middleware.js";
import { rateLimit } from "../http/rate-limit.js";
import { readBody } from "../http/body.js";
import { badRequest } from "../http/errors.js";
import { env } from "../env.js";
import * as subs from "../repo/pushSubscriptions.js";

export const pushRoutes = new Hono<{ Variables: AuthVars }>();

if (env.pushEnabled) {
  /**
   * The public VAPID key the browser needs to subscribe.
   *
   * Served rather than baked into the client bundle with a VITE_ variable, so
   * rotating the keypair is a Dokploy change and a restart — not a Cloudflare
   * Pages rebuild of the game. Public by definition; it is in every push
   * subscription request the browser makes.
   *
   * Unauthenticated on purpose: the client needs it before it can sensibly ask
   * for permission, and it is not a secret.
   */
  pushRoutes.get("/vapid-key", (c) => c.json({ key: env.VAPID_PUBLIC_KEY }));

  pushRoutes.use("/subscribe", rateLimit({ name: "push", limit: 30, windowMs: 60_000 }));
  pushRoutes.use("/subscribe", requireAuth);
  pushRoutes.use("/unsubscribe", rateLimit({ name: "push", limit: 30, windowMs: 60_000 }));
  pushRoutes.use("/unsubscribe", requireAuth);

  /**
   * Register (or refresh) this browser's subscription.
   *
   * The client calls this on EVERY boot, not only when the toggle is switched
   * on — browsers rotate subscriptions on their own schedule, and this project
   * has a specific reason besides: index.html's stale-shell recovery script
   * unregisters every service worker after a failed asset load, which silently
   * destroys the subscription with it. Treating the row as disposable and
   * re-asserting it is cheaper than detecting that.
   */
  pushRoutes.post("/subscribe", async (c) => {
    const body = await readBody(c);
    const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
    const keys = (body.keys ?? {}) as Record<string, unknown>;
    const p256dh = typeof keys.p256dh === "string" ? keys.p256dh : "";
    const auth = typeof keys.auth === "string" ? keys.auth : "";

    // Shape only. The push service is the authority on whether an endpoint is
    // real, and it tells us by returning 404/410 on the first send — at which
    // point the row is deleted. Guessing here would only reject valid
    // endpoints from a provider we had not thought of.
    if (!endpoint.startsWith("https://") || p256dh.length === 0 || auth.length === 0) {
      throw badRequest("That subscription didn't look valid.");
    }
    if (endpoint.length > 2000) throw badRequest("That subscription didn't look valid.");

    await subs.save({ endpoint, userId: c.get("user").id, p256dh, auth });
    return c.body(null, 204);
  });

  /** Drop this browser's subscription. Scoped to the signed-in user, so a
   *  guessed endpoint cannot unsubscribe somebody else's device. */
  pushRoutes.post("/unsubscribe", async (c) => {
    const body = await readBody(c);
    const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
    if (endpoint.length > 0) {
      await subs.removeForUser(endpoint, c.get("user").id);
    }
    return c.body(null, 204);
  });
}
