-- IDEA-064: the Ghost is a secret, and the database never agreed.
--
-- THE BUG, and it has been shipping since v5.0. These column defaults were
-- written when the Ghost WAS the default enemy skin. It stopped being the
-- default twice since — the beetle took it (IDEA-053 era), and now the flea
-- takes it — and both times only the game's own DEFAULT_ENEMY_SKIN_ID moved.
-- So every account ever created on this server was handed the Ghost, owned
-- and equipped, by Postgres.
--
-- The client has had the gate the whole time and it was working exactly as
-- written: cosmetics.ts's visibleEnemySkins hides a secret skin UNLESS the
-- player owns the tribute coat OR already owns the skin — and that second
-- clause, which exists to be kind to legacy accounts, matched literally
-- everybody. "Buy the Pac-Beagle to unlock the Ghost" was unreachable copy for
-- a thing every player already had.
--
-- Three changes, and the second is the one that actually fixes it.

-- 1. The defaults follow the game again. Keeping these in step with
--    DEFAULT_ENEMY_SKIN_ID is exactly what was forgotten twice, so it is worth
--    saying plainly: CHANGING THE DEFAULT SKIN IN src/game/cosmetics.ts IS A
--    MIGRATION. The client's initProfileFromCache grants the current default
--    for free on the next boot, which is what has been quietly covering for
--    this — it grants the NEW default without ever revoking the old one.
ALTER TABLE users
  ALTER COLUMN equipped_enemy_skin_id SET DEFAULT 'flea',
  ALTER COLUMN owned_enemy_skin_ids   SET DEFAULT ARRAY['flea'];

-- 2. Take the Ghost back from everyone who was handed it rather than earning
--    it. Owning the tribute coat IS earning it, so those accounts keep it —
--    that is the same rule buyBeagleSkin applies, applied retroactively.
--
--    Revoking a cosmetic is not something to do lightly, and it is right here
--    for one reason: nobody chose it. It was never bought, never granted by a
--    purchase, and never shown as a reward — it arrived as a column default.
--    Leaving it would mean the unlock stays meaningless for every account that
--    exists today, which is the bug rather than a side effect of it.
UPDATE users
   SET owned_enemy_skin_ids = array_remove(owned_enemy_skin_ids, 'ghost')
 WHERE 'ghost' = ANY (owned_enemy_skin_ids)
   AND NOT ('pacbeagle' = ANY (owned_beagle_skin_ids));

-- 3. Nobody may be left EQUIPPED to something they no longer own.
--    The client repairs this on its own (initProfileFromCache falls back to the
--    default when the equipped id is not owned), but repairing it here means
--    the server's own copy is never in a state it would refuse to write.
UPDATE users
   SET equipped_enemy_skin_id = 'flea'
 WHERE NOT (equipped_enemy_skin_id = ANY (owned_enemy_skin_ids));

-- The Arcade Night board needs no equivalent. It was never a default and could
-- only ever be reached by paying 50 coins for it, so every account that owns it
-- bought it — and visibleMazeThemes lists a secret theme its owner already has.
