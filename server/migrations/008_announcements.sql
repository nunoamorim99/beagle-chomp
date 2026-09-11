-- IDEA-052: release notes and notices, published from the portal.
--
-- The game has shipped seven versions with no way to tell anyone what changed.
-- This is that channel: the operator writes a note in the metrics portal, and
-- it appears behind the bell in the game's menu bar.
--
-- WHAT IS NOT HERE, deliberately: a per-user read RECEIPT table. The only
-- question the game asks is "is there anything I haven't seen", and one
-- timestamp on the user row answers it with a comparison instead of a join —
-- see users.announcements_seen_at below. A receipts table would also grow with
-- players x announcements forever to answer a question nobody asks
-- ("who read note #3"), and would need its own cascade to keep the
-- delete-my-account promise.

CREATE TABLE announcements (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 'release' is "here is what changed in v8.0"; 'notice' is anything else
  -- (maintenance, an event, an apology). They are rendered differently and
  -- that is the whole reason the column exists.
  kind         text        NOT NULL CHECK (kind IN ('release','notice')),

  -- "v8.0" for a release note, NULL for a notice. Free text rather than a
  -- foreign key: VersionControl.md is the source of truth for versions and it
  -- is a Markdown file, not a table.
  version      text,

  title        text        NOT NULL CHECK (length(title) BETWEEN 1 AND 120),

  -- PLAIN TEXT. Not markdown, not HTML.
  --
  -- The client renders this with createElement + textContent (the pattern
  -- src/ui/leaderboard.ts uses for usernames), so markup here would be shown
  -- as literal characters rather than interpreted — which is the safe failure,
  -- and the reason this column carries no formatting. "Admin-authored" is not
  -- a safety property: to the renderer this is a server-controlled string
  -- landing in a DOM sink, exactly like a username, and `innerHTML` appears
  -- three dozen times across src/ui/. Blank lines separate paragraphs; that is
  -- the entire formatting vocabulary.
  body         text        NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),

  -- NULL means DRAFT. A draft is invisible to players and editable; publishing
  -- is setting this, and it is what every player-facing query filters on.
  -- Kept as a timestamp rather than a boolean so "published at" is answerable
  -- without a second column, and so the feed can order by it.
  published_at timestamptz,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- The player-facing read: published notes, newest first. Partial, so drafts
-- stay out of the index entirely.
CREATE INDEX announcements_published_idx
  ON announcements (published_at DESC)
  WHERE published_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- The unread mark.
--
-- NULL means "has never opened the News screen", which is every existing
-- player. That deliberately reads as "everything published is unread" rather
-- than "nothing is" — a player who has never seen the screen has, in fact, not
-- seen any of it. The alternative (backfilling now()) would hide the very first
-- note from everyone who already plays, which is precisely the audience for it.
ALTER TABLE users
  ADD COLUMN announcements_seen_at timestamptz;
