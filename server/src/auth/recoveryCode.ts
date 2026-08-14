// OWNER: backend
//
// Recovery codes — the core of IDEA-019, and the ONLY way back into an account.
//
// There is no email on file, by design (the brief: "no email, ever"), so there
// is no password-reset link and no support channel. If a player loses both
// their password and this code, the account is gone permanently. That makes the
// code's usability a security property, not a cosmetic one: a code that gets
// mis-transcribed is a lost account.
//
// Format: BEAGLE-XXXX-XXXX-XXXX, e.g. BEAGLE-7K2M-9QX4-P3RT
//
//   - A fixed "BEAGLE-" prefix so a player finding it in their notes months
//     later knows what it belongs to.
//   - 12 characters from a 32-symbol alphabet = 60 bits of entropy. Well beyond
//     brute force, especially behind the 5-per-hour rate limit on /auth/recover.
//   - Crockford-style alphabet: no I, L, O, U. Removes the 1/I/l and 0/O
//     confusions that break hand-transcribed codes, and dropping U avoids
//     accidental profanity.
//   - Grouped in fours, which is markedly easier to read back from a
//     screenshot than a 12-character run.
//
// Only the HASH is stored (users.recovery_code_hash), like a password. The
// plaintext is shown exactly once, on the blocking post-signup screen, and can
// never be recovered afterwards — not even by us.

import { randomInt } from "node:crypto";

/** Crockford base32 minus I, L, O, U. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const GROUPS = 3;
const GROUP_LEN = 4;
const PREFIX = "BEAGLE";

/** Generate a fresh plaintext recovery code.
 *
 *  Uses crypto.randomInt (CSPRNG, and rejection-sampled internally so the
 *  distribution stays uniform) rather than Math.random — this value is the sole
 *  credential protecting an account. */
export function generateRecoveryCode(): string {
  const groups: string[] = [];

  for (let g = 0; g < GROUPS; g++) {
    let group = "";
    for (let i = 0; i < GROUP_LEN; i++) {
      group += ALPHABET[randomInt(ALPHABET.length)];
    }
    groups.push(group);
  }

  return `${PREFIX}-${groups.join("-")}`;
}

/** Normalise user input before comparing against the stored hash.
 *
 *  Players will retype these from a screenshot or a note, so we accept the
 *  obvious variations rather than failing someone out of their own account on a
 *  formatting technicality:
 *    - any case            → upper
 *    - spaces for dashes   → dashes
 *    - missing dashes      → regrouped
 *    - missing prefix      → added
 *    - O/o → 0, I/i/L/l → 1   (the characters the alphabet deliberately omits,
 *                              so these substitutions are unambiguous)
 *
 *  Returns null if the input can't be a valid code, so callers can reject
 *  without a database round-trip. */
export function normalizeRecoveryCode(input: string): string | null {
  if (typeof input !== "string") return null;

  let s = input.trim().toUpperCase();

  // Strip the prefix if present; re-added below so both forms converge.
  s = s.replace(/^BEAGLE[\s-]*/, "");

  // Keep only alphanumerics — drops dashes, spaces, and stray punctuation.
  s = s.replace(/[^A-Z0-9]/g, "");

  // Map the omitted-by-design lookalikes onto what the user meant. Safe
  // precisely because O, I, L and U never appear in a generated code.
  s = s.replace(/O/g, "0").replace(/[IL]/g, "1");

  if (s.length !== GROUPS * GROUP_LEN) return null;
  for (const ch of s) {
    if (!ALPHABET.includes(ch)) return null;
  }

  const groups: string[] = [];
  for (let i = 0; i < s.length; i += GROUP_LEN) {
    groups.push(s.slice(i, i + GROUP_LEN));
  }
  return `${PREFIX}-${groups.join("-")}`;
}
