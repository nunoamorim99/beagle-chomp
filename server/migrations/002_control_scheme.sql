-- IDEA-038: optional on-screen D-pad for mobile.
--
-- The control scheme is a per-PLAYER preference, not a per-device one: someone
-- who prefers buttons prefers them on every phone they sign in from. Since
-- IDEA-019 moved profile state to the account, this belongs here rather than in
-- another localStorage key that wouldn't follow them.
--
-- 'swipe' stays the default — it's what every existing player already uses, and
-- what the game shipped with (IDEA-005).
ALTER TABLE users
  ADD COLUMN control_scheme text NOT NULL DEFAULT 'swipe'
    CHECK (control_scheme IN ('swipe', 'dpad'));
