-- IDEA-050: keep what actually happened in a run, not just what it scored.
--
-- Until now every finished run was judged and then FORGOTTEN. The client sends
-- a full telemetry payload (pellets, bones, fruit and its exact points,
-- power-up ids, ghosts eaten, coins, lives lost, play seconds, the maze and
-- level sequences), validation/plausibility.ts checks it, and
-- services/scoreService.ts wrote reported_score/accepted_score and dropped the
-- rest on the floor. The detail survived ONLY for REJECTED runs, in
-- score_rejections.detail — so the server knew more about the games it refused
-- than about the games it accepted.
--
-- This table is the fix, and it is deliberately NOT new collection: every
-- column below except the four stamped ones already crossed the wire.
--
-- ---------------------------------------------------------------------------
-- AMENDMENT TO THE PRIVACY CONTRACT IN 001_init.sql
-- ---------------------------------------------------------------------------
-- 001_init.sql opens by stating that the only data stored per account is a
-- username, a password hash, a recovery code hash, a high score, credits and
-- unlocked cosmetics — "no analytics". That sentence stops being true with this
-- migration, and it is amended HERE rather than edited there: scripts/migrate.ts
-- checksums every applied migration and aborts the runner on a mismatch, and the
-- runner executes from the Dockerfile CMD before the server binds. Editing an
-- applied file would therefore not correct a comment; it would break every
-- deploy. 001 stays byte-for-byte as it shipped.
--
-- What is true now:
--   * Per-run gameplay statistics ARE stored, keyed to the account.
--   * Still NO personal data: no email, no name, no IP address, no device id,
--     no third party, no ad network, no cross-site anything. The key is the
--     same username already printed on the public leaderboard.
--   * "Delete my account" is still a single DELETE FROM users. Both foreign
--     keys below cascade, so this table cannot outlive the account it
--     describes. That is why user_id is stored directly rather than being
--     reached only through game_sessions.
--   * The purpose is honest and player-facing: balance the game, see which
--     enemy keeps killing people, and give each player a year-end summary of
--     their own play.
-- src/ui/privacy.ts and STACK.md §8 are updated in the same change; a promise
-- kept in the schema and broken in the copy is still a broken promise.

CREATE TABLE run_stats (
  -- One row per FINISHED run. The session id is the primary key, so the replay
  -- guard in scoreService (a session can only be finished once) is also what
  -- makes double-counting a run impossible here.
  session_id      uuid        PRIMARY KEY REFERENCES game_sessions(id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL    REFERENCES users(id)         ON DELETE CASCADE,

  finished_at     timestamptz NOT NULL,
  -- Rejected runs are recorded too. Without them the rejection RATE is
  -- unmeasurable from this table, and that rate is the alarm for a forgotten
  -- `npm run sync`: a config.ts change that isn't synced makes the validator
  -- refuse honest runs, which has already cost real scores once (IDEA-040 v3).
  accepted        boolean     NOT NULL,

  mode            text        NOT NULL CHECK (mode IN ('classic','challenge')),
  challenge_idx   smallint,

  score           integer     NOT NULL,
  -- Server clock at both ends, same number the validator judged the run on.
  -- Distinct from play_seconds below, which is the CLIENT's advisory figure —
  -- keeping both is what lets a future diagnostic compare them.
  elapsed_seconds integer     NOT NULL,

  -- --- telemetry, exactly as reported ---------------------------------------
  levels_played      smallint NOT NULL DEFAULT 0,
  levels_cleared     smallint NOT NULL DEFAULT 0,
  max_level_idx      smallint,
  pellets_eaten      integer  NOT NULL DEFAULT 0,
  bones_eaten        integer  NOT NULL DEFAULT 0,
  fruit_eaten        integer  NOT NULL DEFAULT 0,
  fruit_points       integer  NOT NULL DEFAULT 0,
  -- Indexed by position in FRUITS (apple..mango). NULL for a run from a client
  -- that predates the field — distinct from '{}', which means "ate no fruit".
  fruit_kind_counts  smallint[],
  powerups_collected integer  NOT NULL DEFAULT 0,
  powerup_ids        text[]   NOT NULL DEFAULT '{}',
  ghosts_eaten       integer  NOT NULL DEFAULT 0,
  coins_collected    integer  NOT NULL DEFAULT 0,
  lives_lost         integer  NOT NULL DEFAULT 0,
  -- Indexed by position in GHOST_DEFS (rose, teal, amber, violet, leaf). Same
  -- NULL-vs-empty distinction as fruit_kind_counts.
  deaths_by_ghost    smallint[],
  play_seconds       integer  NOT NULL DEFAULT 0,

  -- --- stamped SERVER-SIDE from the users row, never sent by the client ------
  -- These were already loaded by requireAuth and held open by the finish
  -- transaction, so they cost nothing and cannot be forged. They are what make
  -- "which skin/theme was actually being PLAYED" answerable over time, rather
  -- than only "what is equipped right now", which is all the users table says.
  beagle_skin_id  text,
  enemy_skin_id   text,
  maze_theme_id   text,
  control_scheme  text,

  created_at      timestamptz NOT NULL DEFAULT now()
);

-- The two axes every dashboard query uses: a global window over time, and one
-- player's history for their year-end rewind.
CREATE INDEX run_stats_time_idx ON run_stats (finished_at DESC);
CREATE INDEX run_stats_user_idx ON run_stats (user_id, finished_at DESC);

-- Backfill what can be known honestly, and nothing more.
--
-- Every accepted or rejected run ever played is already in game_sessions with
-- its mode, score and server-clocked duration, so those columns are real
-- history. The telemetry columns are NOT backfilled: that detail was discarded
-- and inventing a zero for it would be indistinguishable, to every later query,
-- from a run where the player genuinely ate nothing. The defaults above would
-- do exactly that, so this insert leaves them NULL-equivalent by writing only
-- what it actually knows -- and the four skin/theme columns stay NULL, since
-- today's equipped cosmetics say nothing about what was worn last March.
--
-- Consequence to remember when writing dashboard queries: rows older than this
-- migration have score/time/mode but zeroed item counts. Filter on
-- `pellets_eaten > 0` or on `finished_at` when charting gameplay detail, and
-- use the full table only for retention and scoring.
INSERT INTO run_stats (
  session_id, user_id, finished_at, accepted, mode, challenge_idx,
  score, elapsed_seconds
)
SELECT
  s.id,
  s.user_id,
  s.finished_at,
  s.status = 'accepted',
  s.mode,
  s.challenge_idx,
  COALESCE(s.accepted_score, s.reported_score, 0),
  GREATEST(0, EXTRACT(EPOCH FROM (s.finished_at - s.started_at))::integer)
FROM game_sessions s
WHERE s.status IN ('accepted', 'rejected')
  AND s.finished_at IS NOT NULL;
