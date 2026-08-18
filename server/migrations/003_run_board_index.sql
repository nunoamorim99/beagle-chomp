-- P1 of the scale assessment (2026-08-18): the All-runs board query had no
-- supporting index — EXPLAIN showed a sequential scan + sort over
-- game_sessions, a table that grows with every run ever played, executed on
-- every leaderboard open.
--
-- Partial index matching the query's exact predicate AND sort order
-- (repo/gameSessions.ts topRuns), so the planner can walk it top-down and
-- stop at LIMIT. acceptedRunCount() counts over the same predicate, so it is
-- served by this index too. Partial keeps it small: open/abandoned/rejected
-- rows (the majority over time) are excluded entirely.

CREATE INDEX IF NOT EXISTS game_sessions_run_board_idx
  ON game_sessions (accepted_score DESC, finished_at ASC)
  WHERE status = 'accepted' AND mode = 'classic' AND accepted_score > 0;
