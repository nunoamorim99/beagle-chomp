-- IDEA-040: the first-run tutorial.
--
-- Per-PLAYER, not per-device: someone who has learned the game on their phone
-- should not be coached again when they sign in on a laptop. Same reasoning as
-- control_scheme in 002.
ALTER TABLE users
  ADD COLUMN tutorial_done boolean NOT NULL DEFAULT false;

-- Existing players have obviously already learned the game — coaching them
-- through biscuits and bones on their next run would be irritating rather than
-- helpful. Anyone who has ever started a run counts as taught.
--
-- Deliberately keyed on game_sessions rather than high_score: a player whose
-- runs were all quit or rejected still knows how to play.
UPDATE users u
   SET tutorial_done = true
 WHERE EXISTS (SELECT 1 FROM game_sessions s WHERE s.user_id = u.id);
