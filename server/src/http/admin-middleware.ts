// OWNER: backend
//
// The admin gate (IDEA-051).
//
// WHY THIS IS ITS OWN FILE, and not four lines in auth-middleware.ts: that
// module imports repo/tokens.js, which imports db.js, which OPENS A POSTGRES
// POOL THE MOMENT IT IS IMPORTED. Anything reachable from there is unreachable
// from `npm test`, and this project has already paid for that once — the whole
// reason validation/wire.ts exists as a separate module is that a parser hidden
// behind the pool went untested and silently dropped a field for a release
// (IDEA-040 v3).
//
// This gate decides who may read every player's statistics. It is exactly the
// kind of code that must be tested with no services running, so it imports
// nothing that touches the database: an error helper and two types.

import type { MiddlewareHandler } from "hono";
import type { UserRow } from "../repo/types.js";
import { notFound } from "./errors.js";

/** What requireAuth hangs on the context. Declared here rather than imported
 *  from auth-middleware.js so this module keeps its clean import graph — the
 *  shape is two fields and duplicating the contract is cheaper than dragging a
 *  Postgres pool into the test suite. auth-middleware re-exports its own. */
export interface AdminVars {
  user: UserRow;
}

/**
 * Gate the metrics portal. Runs AFTER requireAuth.
 *
 * Answers 404, never 403 — and the distinction is the whole point. A 403 says
 * "this endpoint is real, you are simply not allowed", which hands a map of the
 * admin surface to anyone holding a game account. A 404 is indistinguishable
 * from a path that does not exist. Same reasoning as GET /metrics answering 404
 * to a wrong METRICS_TOKEN (routes/metrics.ts).
 *
 * `undefined` must read as "not an admin", never as "unknown, allow" — and that
 * is not hypothetical. `is_admin` was missing from findUserByToken's SELECT on
 * the first cut of this feature, so the flag arrived undefined on every request
 * while being perfectly true in the database. `query<UserRow>` is an unchecked
 * cast, so nothing failed; the feature simply did not work. The optional chain
 * below is what makes the safe direction the default one.
 *
 * There is deliberately no endpoint anywhere that SETS is_admin — see
 * migrations/007_admin.sql.
 */
export const requireAdmin: MiddlewareHandler<{ Variables: AdminVars }> = async (
  c,
  next,
) => {
  const user = c.get("user");
  if (!user?.is_admin) throw notFound();
  await next();
};
