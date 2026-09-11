-- IDEA-063: the challenge ladder goes from 8 levels to 40.
--
-- TWO columns bound the old count, and missing either one breaks the mode in
-- production only:
--
--   users.challenge_progress        CHECK (BETWEEN 0 AND 8)   -- 001_init
--   game_sessions.challenge_idx     CHECK (BETWEEN 0 AND 7)   -- 001_init
--
-- The second is the dangerous one. It is checked when a run STARTS, so without
-- this migration every attempt at level 9 or beyond would fail at
-- beginRunSession — the player taps Play on stone 9 and nothing happens, with
-- the error nowhere near the level map that produced the index. The first only
-- bites at the end of a run, when the clear is banked.
--
-- Both are dropped by LOOKUP rather than by guessed name, for the reason
-- 005_control_scheme_stick.sql sets out at length: 001 declared them inline, so
-- their names are generated, and a wrong guess makes `DROP CONSTRAINT IF
-- EXISTS` a silent no-op that leaves BOTH constraints in place — every write of
-- a new value then fails against the old one, in production, naming a
-- constraint nobody wrote. The lookup matches on the column name appearing in
-- the constraint definition, which is exactly what cannot be guessed wrong.
--
-- The lookup for challenge_idx deliberately EXCLUDES the named
-- `challenge_idx_matches_mode` constraint, which also mentions the column but
-- says something else entirely (challenge runs carry an index, classic runs do
-- not). Dropping that one would let a classic session store a challenge index
-- and a challenge session store none — a real hole in the validator's own
-- assumptions, opened by a migration that was only supposed to widen a range.

DO $$
DECLARE
  con_name text;
BEGIN
  FOR con_name IN
    SELECT c.conname
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
     WHERE t.relname = 'users'
       AND c.contype = 'c'
       AND pg_get_constraintdef(c.oid) ILIKE '%challenge_progress%'
  LOOP
    EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', con_name);
  END LOOP;

  FOR con_name IN
    SELECT c.conname
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
     WHERE t.relname = 'game_sessions'
       AND c.contype = 'c'
       AND pg_get_constraintdef(c.oid) ILIKE '%challenge_idx%'
       AND c.conname <> 'challenge_idx_matches_mode'
  LOOP
    EXECUTE format('ALTER TABLE game_sessions DROP CONSTRAINT %I', con_name);
  END LOOP;
END
$$;

-- EVERY ACCOUNT'S CHALLENGE PROGRESS GOES BACK TO ZERO (Nuno's call).
--
-- The stored number means "how many levels of the ladder you have cleared", and
-- IDEA-063 rebuilt the ladder underneath it: levels 1-8 used to be the twists
-- and are now the first eight stops of the grand tour. Leaving the number alone
-- would silently relabel a player's eight hard-won twist clears as eight easy
-- tour clears, which is the one option that quietly LIES about what was played.
--
-- The alternative considered and rejected was `progress + 30`, which preserves
-- the twist clears exactly and hands over the thirty tour levels for free.
-- Nuno chose the reset: the tour is the new front door and everyone walks in
-- through it, including the people who were here first. It costs a strong
-- player thirty short runs at classic pace to get back to Warm-Up Walkies.
--
-- Nothing else is touched. High scores, coins, cosmetics and the per-run
-- history in game_sessions/run_stats are all independent of this column, and a
-- challenge score already on the board stays on it.
UPDATE users SET challenge_progress = 0 WHERE challenge_progress <> 0;

ALTER TABLE users
  ADD CONSTRAINT users_challenge_progress_check
    CHECK (challenge_progress BETWEEN 0 AND 40);

ALTER TABLE game_sessions
  ADD CONSTRAINT game_sessions_challenge_idx_check
    CHECK (challenge_idx BETWEEN 0 AND 39);
