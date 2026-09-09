-- IDEA-052b: Web Push — a message that arrives when the game is closed.
--
-- This LIFTS A DELIBERATE DEFERRAL. STACK.md §6 lists "Push notifications |
-- História actually goes native" under "do NOT add unless I ask", and §0 says a
-- new moving part gets flagged rather than slipped in. Nuno asked for it
-- explicitly (2026-09-09), so §6 is amended in the same change rather than left
-- contradicting the code.
--
-- ---------------------------------------------------------------------------
-- A PUSH ENDPOINT IS A DEVICE IDENTIFIER, and it is the first genuinely
-- device-linked datum this project has ever stored.
-- ---------------------------------------------------------------------------
-- Everything else about an account is either chosen (a username, already public
-- on the leaderboard) or derived from play. An endpoint URL is issued by
-- Google/Apple/Mozilla and identifies one browser install. So:
--   * it cascades with the account, like everything else;
--   * it is deleted the moment the push service says the subscription is dead
--     (404/410), rather than lingering as a record of a device that is gone;
--   * and it is named in src/ui/privacy.ts, because "no device id" was true
--     before this and would otherwise silently stop being true.

CREATE TABLE push_subscriptions (
  -- The endpoint IS the identity — the push service guarantees it unique per
  -- subscription, and re-subscribing the same browser returns the same URL.
  -- Primary key rather than a surrogate id so a re-subscribe is an upsert and
  -- cannot accumulate duplicates for one device.
  endpoint     text        PRIMARY KEY,
  user_id      uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- RFC 8291 payload encryption keys, exactly as the browser handed them over.
  -- Opaque to us: they go straight to the web-push library.
  p256dh       text        NOT NULL,
  auth         text        NOT NULL,

  created_at   timestamptz NOT NULL DEFAULT now(),
  -- Last time the push service ACCEPTED a message for this endpoint. A
  -- subscription that has not been reachable for months is a candidate for
  -- tidying, though nothing sweeps them yet — at this volume there is nothing
  -- to sweep.
  last_ok_at   timestamptz,
  -- Consecutive failures that were NOT a definite 404/410. A transient outage
  -- must not delete a real subscription, so soft failures count here and only a
  -- definite gone-response deletes.
  failure_count integer    NOT NULL DEFAULT 0
);

-- The fan-out read: every device belonging to a set of users.
CREATE INDEX push_subscriptions_user_idx ON push_subscriptions (user_id);

-- ---------------------------------------------------------------------------
-- Preferences. TWO kinds of notification means two switches.
--
-- Defaulting both to TRUE is safe and is not a dark pattern: nothing can be
-- sent to a player who has not granted browser permission AND completed a
-- subscription, which is an explicit, per-device act. These columns decide what
-- a SUBSCRIBED player receives, not whether they are asked.
ALTER TABLE users
  ADD COLUMN notify_announcements boolean NOT NULL DEFAULT true,
  ADD COLUMN notify_rank          boolean NOT NULL DEFAULT true,
  -- When this player was last told their score had been beaten. The cooldown
  -- reads it, so one player having a good evening cannot fire ten alerts at the
  -- same victim.
  ADD COLUMN last_rank_alert_at   timestamptz;
