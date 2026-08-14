-- Beagle Chomp — initial schema (IDEA-019 accounts + IDEA-020 leaderboard)
--
-- Privacy contract (the brief, and STACK.md §8's no-PII stance):
-- the ONLY data stored per account is a username, a password hash, a recovery
-- code hash, a high score, credits, and unlocked cosmetics. No email, no IP
-- addresses, no analytics, no third-party anything. "Delete my account" is a
-- single DELETE FROM users — every foreign key below cascades so nothing is
-- left behind.

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- users — the entire personal-data surface, and the profile the game reads.
--
-- Columns map 1:1 onto StoredProfile in src/game/profileStore.ts, plus
-- high_score (new, IDEA-020). The CHECK constraints mirror that module's
-- existing sanitizeCoins / sanitizeChallengeProgress guards, so a corrupt value
-- can't enter from either side.
CREATE TABLE users (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The player's chosen casing, shown on the leaderboard.
  username                text        NOT NULL,
  -- Case-insensitive uniqueness without CITEXT: fold once, unique-index that.
  -- Prevents "Bagel" and "bagel" both existing and confusing sign-in.
  username_lower          text        NOT NULL,

  password_hash           text        NOT NULL,

  -- Only the HASH of the recovery code is ever stored. The plaintext is shown
  -- exactly once, on the blocking post-signup screen, and never again — losing
  -- it is unrecoverable by design (there is no email fallback).
  recovery_code_hash      text        NOT NULL,
  -- Bumped each time a code is consumed and reissued. Diagnostic only
  -- ("reissued 2x" on the profile screen); never treated as a secret.
  recovery_code_version   integer     NOT NULL DEFAULT 1,

  -- --- StoredProfile.coins (IDEA-016/IDEA-017)
  -- Earned in-game only. There is no purchase path and none will be added.
  coins                   integer     NOT NULL DEFAULT 0 CHECK (coins >= 0),

  -- --- StoredProfile.challengeProgress (IDEA-013)
  -- Highest 0-based challenge level index UNLOCKED. The sentinel 8
  -- (== CHALLENGE_LEVEL_COUNT, one past the last index) means "all cleared" —
  -- deliberately distinct from 7, so clearing the finale is distinguishable
  -- from merely having unlocked it. Keep the upper bound in step with
  -- CHALLENGE_LEVELS in src/game/challenges.ts.
  challenge_progress      smallint    NOT NULL DEFAULT 0
                            CHECK (challenge_progress BETWEEN 0 AND 8),

  -- --- StoredProfile.equipped* — ids validated in the service layer against
  --     the cosmetics/themes registries, NOT by a FK (the registry is code, not
  --     a table). Defaults match DEFAULT_BEAGLE_SKIN_ID / DEFAULT_ENEMY_SKIN_ID
  --     / DEFAULT_MAZE_THEME_ID.
  equipped_beagle_skin_id text        NOT NULL DEFAULT 'bagel',
  equipped_enemy_skin_id  text        NOT NULL DEFAULT 'ghost',
  equipped_maze_theme_id  text        NOT NULL DEFAULT 'garden',

  -- --- StoredProfile.owned*Ids. text[] rather than a join table: these sets are
  --     tiny, always read whole, and never queried across users.
  owned_beagle_skin_ids   text[]      NOT NULL DEFAULT ARRAY['bagel'],
  owned_enemy_skin_ids    text[]      NOT NULL DEFAULT ARRAY['ghost'],
  owned_maze_theme_ids    text[]      NOT NULL DEFAULT ARRAY['garden'],

  -- --- CLASSIC MODE ONLY (IDEA-020). Challenge runs never write here: their
  --     modifiers (up to 5 ghosts at 2x speed) make scores incomparable with
  --     classic, so ranking them together would be meaningless. Challenge runs
  --     still advance challenge_progress and still pay coins.
  high_score              integer     NOT NULL DEFAULT 0 CHECK (high_score >= 0),
  high_score_at           timestamptz,

  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX users_username_lower_key ON users (username_lower);

-- The leaderboard read path: top N. Partial — an unranked player (never played
-- classic) stays out of the index entirely. Ties break by who got there first.
CREATE INDEX users_high_score_idx
  ON users (high_score DESC, high_score_at ASC)
  WHERE high_score > 0;

-- ---------------------------------------------------------------------------
-- auth_tokens — opaque bearer tokens (STACK.md §2.2: bearer, not cookies, so
-- the same API can serve a native app later without rework).
--
-- The plaintext token is NEVER stored: the primary key is sha256(token), so a
-- database dump grants an attacker nothing usable. Lookup hashes the presented
-- token and probes the PK.
CREATE TABLE auth_tokens (
  token_hash   bytea       PRIMARY KEY,
  user_id      uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  last_used_at timestamptz NOT NULL DEFAULT now()
);

-- Needed for "log out every other device", which a password reset via recovery
-- code must do.
CREATE INDEX auth_tokens_user_idx    ON auth_tokens (user_id);
CREATE INDEX auth_tokens_expires_idx ON auth_tokens (expires_at);

-- ---------------------------------------------------------------------------
-- game_sessions — server-issued, server-timestamped run tickets.
--
-- The client never supplies a start time: started_at below IS the clock, so a
-- run's duration cannot be forged client-side. This is what makes the
-- plausibility checks (score vs elapsed time) meaningful.
CREATE TABLE game_sessions (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  mode           text        NOT NULL CHECK (mode IN ('classic','challenge')),
  -- NULL for classic; 0..7 identifies the challenge level being attempted.
  challenge_idx  smallint    CHECK (challenge_idx BETWEEN 0 AND 7),

  started_at     timestamptz NOT NULL DEFAULT now(),
  -- Set on the first accepted finish. A second finish on the same row is
  -- refused — this is the replay guard.
  finished_at    timestamptz,

  status         text        NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open','accepted','rejected','abandoned')),

  reported_score integer,
  accepted_score integer,

  CONSTRAINT challenge_idx_matches_mode CHECK (
    (mode = 'challenge' AND challenge_idx IS NOT NULL) OR
    (mode = 'classic'   AND challenge_idx IS NULL)
  )
);

CREATE INDEX game_sessions_user_idx ON game_sessions (user_id, started_at DESC);
-- Drives the sweeper that abandons stale open sessions (a run quit mid-game
-- never finishes, and stockpiled session ids must not stay usable).
CREATE INDEX game_sessions_open_idx ON game_sessions (started_at)
  WHERE status = 'open';

-- ---------------------------------------------------------------------------
-- score_rejections — the audit log the brief requires ("Reject implausible
-- submissions rather than silently clamping them. Log rejections.").
--
-- Also the tuning input: the plan holds the leaderboard back one increment so
-- real rejection data can be reviewed before anyone sees a ranking, catching
-- false positives before they cost a real player a legitimate score.
CREATE TABLE score_rejections (
  id           bigserial   PRIMARY KEY,
  user_id      uuid        REFERENCES users(id) ON DELETE CASCADE,
  session_id   uuid        REFERENCES game_sessions(id) ON DELETE CASCADE,
  rejected_at  timestamptz NOT NULL DEFAULT now(),
  reason_code  text        NOT NULL,
  -- The submitted payload plus the server's computed bounds, for forensics.
  detail       jsonb       NOT NULL
);

CREATE INDEX score_rejections_time_idx ON score_rejections (rejected_at DESC);
CREATE INDEX score_rejections_user_idx ON score_rejections (user_id);
