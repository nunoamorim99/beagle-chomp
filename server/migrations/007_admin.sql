-- IDEA-051: one operator flag, for the metrics portal.
--
-- The portal signs in through the EXISTING /api/v1/auth/login. There is no
-- second credential system, no second password store, and no admin signup path
-- — which also means revocation already works: deleting the account's tokens
-- (a recovery-code password reset does this) logs the portal out everywhere.
--
-- WHAT ACTUALLY GATES THE DASHBOARD IS THIS COLUMN, not the absence of a signup
-- form. /api/v1/auth/signup exists and always will, because the game needs it.
-- Anyone can make a game account; nobody can make an ADMIN one, because the
-- only way to set this is a hand-written UPDATE against the database. There is
-- deliberately no endpoint that writes it — an admin-granting route is a
-- privilege-escalation surface that buys nothing when the answer is "one person,
-- once, ever".
--
-- requireAdmin answers 404, never 403, for everyone else. Same reasoning as
-- GET /metrics with a wrong METRICS_TOKEN: a 403 confirms the endpoint is real
-- and worth attacking, a 404 says nothing at all.
--
-- GRANTING IT (run once, by hand, after this migration has applied):
--
--   UPDATE users SET is_admin = true WHERE username_lower = lower('<username>');
--
-- Prefer a DEDICATED account that never plays, rather than flagging the account
-- you play on: the password guarding every player's statistics should not also
-- be the one attached to a name on the public leaderboard. An account that
-- never posts a classic score never appears on the board at all
-- (users_high_score_idx is partial: WHERE high_score > 0).
--
-- Note that 'admin', 'administrator', 'root', 'system', 'nuno' and
-- 'beaglechomp' are all in RESERVED_USERNAMES (services/authService.ts) and
-- cannot be registered — pick something else.

ALTER TABLE users
  ADD COLUMN is_admin boolean NOT NULL DEFAULT false;

-- Partial: there is exactly one of these rows, so an index over the whole table
-- would be waste. This one holds a single entry and answers "who is an admin"
-- directly, which is the only question ever asked of it.
CREATE INDEX users_admin_idx ON users (id) WHERE is_admin;
