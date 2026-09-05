-- IDEA-049: the thumbstick, a third touch control scheme.
--
-- 002 added control_scheme with a CHECK constraint listing the two schemes that
-- existed then. The CHECK is the right call — it is what stops a typo or an
-- unknown client leaving a profile the game cannot read — but it does mean a
-- new scheme is a MIGRATION, not just a server-side string comparison. Postgres
-- has no ALTER ... CHECK, so the old constraint has to go and a new one take
-- its place.
--
-- Dropped by LOOKUP rather than by name. 002 declared the constraint inline, so
-- its name was generated (users_control_scheme_check on this Postgres) — and a
-- plain `DROP CONSTRAINT IF EXISTS <guessed name>` is the failure mode worth
-- avoiding here: if the guess is wrong the DROP quietly does nothing, the ADD
-- below still succeeds under that name, and the database ends up with BOTH
-- constraints. Every 'stick' write would then fail against the old one, in
-- production only, with a violation naming a constraint nobody wrote. Finding
-- whatever CHECK actually mentions the column cannot get that wrong.
--
-- 'swipe' stays the default and the column keeps its NOT NULL.
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
       AND pg_get_constraintdef(c.oid) ILIKE '%control_scheme%'
  LOOP
    EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', con_name);
  END LOOP;
END
$$;

ALTER TABLE users
  ADD CONSTRAINT users_control_scheme_check
    CHECK (control_scheme IN ('swipe', 'dpad', 'stick'));
