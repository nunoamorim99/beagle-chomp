-- IDEA-078: challenges — goals with rewards.
--
-- THE ONLY NEW STATE THIS FEATURE ADDS, and that is the design rather than an
-- economy.
--
-- Every number a challenge is judged on already exists. `run_stats` (migration
-- 006) keeps one row per finished run carrying the validated telemetry, keyed
-- to the account: coins collected, enemies eaten, fruit, bones, levels cleared,
-- lives lost, the mode and — for a Journey run — which level it was. So a
-- lifetime total is a SUM over rows this server is already writing and a
-- personal best is a MAX. A per-challenge progress counter maintained at run
-- finish would be a SECOND copy of a truth that table already holds, free to
-- disagree with it, and this project has spent whole releases hunting exactly
-- that kind of divergence.
--
-- What CANNOT be derived is whether a reward has been taken. Hence this table,
-- and nothing else.
--
-- ---------------------------------------------------------------------------
-- WHY CLAIMED RATHER THAN AUTO-PAID
-- ---------------------------------------------------------------------------
-- Nuno's call. Auto-paying at run finish would need no table at all, and it
-- would leave the Challenges screen with no job: a list you can only read is a
-- list nobody opens twice. A claim gives the screen an action, gives the menu
-- chip a badge with a real number on it, and lets a player see what they earned
-- instead of finding coins already in the wallet.

CREATE TABLE challenge_claims (
  user_id      uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The challenge id from src/game/challenges.ts, carried here through
  -- catalog.generated.ts. Deliberately NOT a foreign key to anything: the
  -- definition list is code, not data, and it has to be free to gain entries on
  -- a deploy without a migration.
  --
  -- The consequence is the reason ids are documented as never reused: a
  -- retired id leaves its claim rows behind, and reusing it would hand somebody
  -- a reward they had already taken -- or refuse one they had not.
  challenge_id text        NOT NULL,

  -- WHAT THEY WERE ACTUALLY PAID, not what the challenge is worth today.
  -- Rebalancing a reward must not rewrite history: without this column the
  -- ledger below would silently restate every past payout at the new price, and
  -- "why do my coins not add up" becomes unanswerable.
  reward_coins integer     NOT NULL,
  claimed_at   timestamptz NOT NULL DEFAULT now(),

  -- One claim per player per challenge, enforced by the shape rather than by
  -- the service remembering to check. The claim path reads the existing rows,
  -- decides, and inserts inside one transaction -- but two requests racing each
  -- other would both read "not claimed", and only this key stops both of them
  -- paying out. ON CONFLICT DO NOTHING plus a rowCount check is what turns the
  -- loser of that race into "already claimed" instead of a duplicate payment.
  PRIMARY KEY (user_id, challenge_id)
);

-- The only access pattern: every claim this player holds, read on the
-- Challenges screen and again at claim time. The primary key already leads with
-- user_id, so that index serves it and no second one is needed.

-- Privacy: this table is covered by 006's amendment. No personal data -- an
-- account id and the id of a goal they reached -- and "delete my account" stays
-- a single DELETE FROM users, because the foreign key cascades.
