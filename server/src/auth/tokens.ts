// OWNER: backend
//
// Opaque bearer tokens (STACK.md §2.2 — bearer, not cookie sessions, so the
// same API can serve a Capacitor app later without rework).
//
// Deliberately NOT JWTs. A JWT would let us skip a database lookup per request,
// but it cannot be revoked before expiry — and this API must revoke on demand:
// "delete my account" and "reset my password via recovery code" both have to
// invalidate every other device immediately. A random opaque token plus a row
// is simpler, revocable, and a single indexed lookup on a personal game's
// traffic is free.
//
// SECURITY: the plaintext token is never stored. The table's primary key is
// sha256(token), so a database dump yields nothing an attacker can present.
// sha256 (not argon2) is correct here: the token is 256 bits of CSPRNG output,
// so there is no dictionary to attack — slow hashing would only add latency to
// every authenticated request.

import { createHash, randomBytes } from "node:crypto";

/** 32 bytes = 256 bits of entropy. base64url so it survives an HTTP header
 *  and a URL without escaping. */
const TOKEN_BYTES = 32;

export interface GeneratedToken {
  /** Return to the client ONCE. Never stored, never logged. */
  plaintext: string;
  /** What goes in auth_tokens.token_hash. */
  hash: Buffer;
}

export function generateToken(): GeneratedToken {
  const plaintext = randomBytes(TOKEN_BYTES).toString("base64url");
  return { plaintext, hash: hashToken(plaintext) };
}

/** sha256 of a token, as bytea. Used both when storing a new token and when
 *  looking up a presented one. */
export function hashToken(plaintext: string): Buffer {
  return createHash("sha256").update(plaintext).digest();
}

/** Extract the token from an `Authorization: Bearer <token>` header.
 *  Returns null for a missing, malformed, or non-Bearer header. */
export function parseBearerHeader(header: string | undefined): string | null {
  if (!header) return null;

  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

export function expiryFromNow(ttlDays: number): Date {
  return new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
}
