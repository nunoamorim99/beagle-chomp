// OWNER: backend
//
// Password and recovery-code hashing. The ONLY module that knows which
// algorithm is in use — everything else calls hashSecret/verifySecret.
//
// Algorithm: argon2id (memory-hard, resistant to GPU cracking, the current
// OWASP recommendation). Defaults from @node-rs/argon2 are m=19456 KiB, t=2,
// p=1 — roughly 19 MB and ~50 ms per hash. Deliberately NOT raised: on a CX23
// with a 384 MB container limit, ten concurrent logins at the default already
// touch ~190 MB transient. The login rate limiter is what actually stops
// brute-force here; inflating the cost factor would trade real availability for
// theoretical hardening.
//
// The hash string is self-describing ("$argon2id$v=19$m=19456,t=2,p=1$..."), so
// swapping algorithms later is a one-file change plus opportunistic rehashing
// on next successful login. If @node-rs/argon2 ever becomes awkward (it ships
// glibc-only prebuilds — the reason the Docker image is bookworm-slim, not
// alpine), node:crypto's scrypt is the fallback and only this file changes.

import { hash, verify } from "@node-rs/argon2";

/** Hash a secret (password or recovery code) for storage. */
export async function hashSecret(plaintext: string): Promise<string> {
  return hash(plaintext);
}

/** Verify a secret against a stored hash. Never throws on a malformed or
 *  corrupt stored hash — a garbage row must read as "wrong password", not as a
 *  500 that tells an attacker something unusual happened. */
export async function verifySecret(
  storedHash: string,
  plaintext: string,
): Promise<boolean> {
  try {
    return await verify(storedHash, plaintext);
  } catch {
    return false;
  }
}

/** A hash of a value nobody knows, computed once at startup.
 *
 *  Used by the login path when the username doesn't exist: without it, "unknown
 *  user" returns in ~1 ms while "wrong password" takes ~50 ms, and that timing
 *  difference is a reliable username oracle — an attacker can enumerate which
 *  accounts exist. Verifying against this dummy makes both paths cost the same.
 *
 *  Computed lazily so module import stays cheap, then cached. */
let dummyHashPromise: Promise<string> | null = null;

export function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hashSecret(
    "verify-against-this-when-the-user-does-not-exist",
  );
  return dummyHashPromise;
}

/** Burn the same CPU time a real verification would, and always fail.
 *  Call this on the "no such user" branch of login. */
export async function verifyDummy(plaintext: string): Promise<false> {
  await verifySecret(await getDummyHash(), plaintext);
  return false;
}
