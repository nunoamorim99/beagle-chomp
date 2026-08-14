// OWNER: backend
//
// Signup, login, recovery and logout. Routes handle HTTP; this file owns the
// rules.
//
// The design constraint that shapes everything here: THERE IS NO EMAIL. No
// reset link, no support channel, no way for us to identify a user out of band.
// A recovery code is the only path back into an account, which makes its
// correctness the single most important thing in this file.

import { withTransaction } from "../db.js";
import { hashSecret, verifySecret, verifyDummy } from "../auth/hash.js";
import {
  generateToken,
  hashToken,
  expiryFromNow,
} from "../auth/tokens.js";
import {
  generateRecoveryCode,
  normalizeRecoveryCode,
} from "../auth/recoveryCode.js";
import * as usersRepo from "../repo/users.js";
import * as tokensRepo from "../repo/tokens.js";
import {
  toPublicProfile,
  toPublicUser,
  type PublicProfile,
  type PublicUser,
  type UserRow,
} from "../repo/types.js";
import { ApiError } from "../http/errors.js";
import { env } from "../env.js";

export interface AuthResult {
  token: string;
  expiresAt: string;
  user: PublicUser;
  profile: PublicProfile;
  /** Present ONLY on signup and recovery — the one time a code is revealed. */
  recoveryCode?: string;
}

// --- validation -------------------------------------------------------------

/** 3–20 chars, letters/digits/underscore/hyphen only.
 *
 *  This regex is also the primary XSS defence for the leaderboard: the whole
 *  frontend renders via innerHTML, and a username is the first server-supplied
 *  string to enter that pipeline. Excluding < > " & ' and whitespace means a
 *  username cannot carry markup at all. The client escapes as well, but this is
 *  the layer that actually makes injection impossible. Do not loosen it without
 *  revisiting src/ui/leaderboard.ts. */
const USERNAME_RE = /^[A-Za-z0-9_-]{3,20}$/;

/** Names that would let someone impersonate the operator or a system account. */
const RESERVED_USERNAMES = new Set([
  "admin",
  "administrator",
  "mod",
  "moderator",
  "system",
  "root",
  "support",
  "beaglechomp",
  "beagle-chomp",
  "nuno",
]);

const MIN_PASSWORD_LENGTH = 8;
/** Argon2 hashes its input regardless of length; capping it stops someone
 *  making the server chew on a megabyte-long "password". */
const MAX_PASSWORD_LENGTH = 200;

export function validateUsername(username: unknown): string {
  if (typeof username !== "string") {
    throw new ApiError(400, "VALIDATION_FAILED", "Username is required.");
  }
  const trimmed = username.trim();

  if (!USERNAME_RE.test(trimmed)) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      "Username must be 3–20 characters, using only letters, numbers, hyphens and underscores.",
    );
  }
  if (RESERVED_USERNAMES.has(trimmed.toLowerCase())) {
    throw new ApiError(400, "VALIDATION_FAILED", "That username isn't available.");
  }
  return trimmed;
}

export function validatePassword(password: unknown): string {
  if (typeof password !== "string") {
    throw new ApiError(400, "VALIDATION_FAILED", "Password is required.");
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`,
    );
  }
  return password;
}

// --- token issuing ----------------------------------------------------------

async function issueToken(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const { plaintext, hash } = generateToken();
  const expiresAt = expiryFromNow(env.TOKEN_TTL_DAYS);
  await tokensRepo.createToken(userId, hash, expiresAt);
  return { token: plaintext, expiresAt };
}

function authResult(
  row: UserRow,
  token: string,
  expiresAt: Date,
  recoveryCode?: string,
): AuthResult {
  return {
    token,
    expiresAt: expiresAt.toISOString(),
    user: toPublicUser(row),
    profile: toPublicProfile(row),
    ...(recoveryCode ? { recoveryCode } : {}),
  };
}

// --- signup -----------------------------------------------------------------

export async function signup(
  usernameInput: unknown,
  passwordInput: unknown,
): Promise<AuthResult> {
  const username = validateUsername(usernameInput);
  const password = validatePassword(passwordInput);

  const recoveryCode = generateRecoveryCode();
  const [passwordHash, recoveryCodeHash] = await Promise.all([
    hashSecret(password),
    hashSecret(recoveryCode),
  ]);

  let row: UserRow;
  try {
    row = await usersRepo.createUser({ username, passwordHash, recoveryCodeHash });
  } catch (err) {
    // Insert-and-catch rather than check-then-insert: a pre-check races with a
    // concurrent signup for the same name, and the unique index is the real
    // arbiter anyway.
    if (usersRepo.isUniqueViolation(err)) {
      throw new ApiError(409, "USERNAME_TAKEN", "That username is already taken.");
    }
    throw err;
  }

  const { token, expiresAt } = await issueToken(row.id);

  // The ONLY response that ever contains the plaintext recovery code. The
  // client must show it on a blocking screen before proceeding.
  return authResult(row, token, expiresAt, recoveryCode);
}

// --- login ------------------------------------------------------------------

export async function login(
  usernameInput: unknown,
  passwordInput: unknown,
): Promise<AuthResult> {
  // Deliberately NOT validateUsername/validatePassword here: a login attempt
  // with a malformed username should fail exactly like a wrong password, or the
  // error message becomes an oracle for which names could exist.
  const username = typeof usernameInput === "string" ? usernameInput.trim() : "";
  const password = typeof passwordInput === "string" ? passwordInput : "";

  const row = await usersRepo.findByUsername(username);

  if (!row) {
    // Burn equivalent CPU so "no such user" and "wrong password" take the same
    // time — otherwise response latency enumerates which accounts exist.
    await verifyDummy(password);
    throw new ApiError(401, "INVALID_CREDENTIALS", "Username or password is wrong.");
  }

  if (!(await verifySecret(row.password_hash, password))) {
    throw new ApiError(401, "INVALID_CREDENTIALS", "Username or password is wrong.");
  }

  const { token, expiresAt } = await issueToken(row.id);
  return authResult(row, token, expiresAt);
}

// --- recovery ---------------------------------------------------------------

/** Consume a recovery code. Covers BOTH brief use cases in one endpoint:
 *  signing in on a new device (no newPassword) and resetting a forgotten
 *  password (newPassword supplied).
 *
 *  Single-use is the load-bearing property, and it is enforced by a row lock,
 *  not by timing: the whole verify-then-rotate sequence runs inside one
 *  transaction against `SELECT ... FOR UPDATE`, so two concurrent requests
 *  presenting the same code cannot both observe it as valid. The old code is
 *  dead the instant this commits, and a NEW one is returned — which the client
 *  must display with the same prominence as the original. */
export async function recover(
  usernameInput: unknown,
  recoveryCodeInput: unknown,
  newPasswordInput: unknown,
): Promise<AuthResult> {
  const username = typeof usernameInput === "string" ? usernameInput.trim() : "";
  const submittedCode =
    typeof recoveryCodeInput === "string"
      ? normalizeRecoveryCode(recoveryCodeInput)
      : null;

  // Validate the new password BEFORE consuming the code. Otherwise a too-short
  // password would burn the user's single-use code and leave them locked out
  // holding a code that no longer works — the worst possible failure here.
  const newPassword =
    newPasswordInput === undefined || newPasswordInput === null
      ? null
      : validatePassword(newPasswordInput);

  const invalid = new ApiError(
    401,
    "INVALID_RECOVERY_CODE",
    "That recovery code isn't valid for this account.",
  );

  if (!submittedCode) {
    await verifyDummy(String(recoveryCodeInput ?? ""));
    throw invalid;
  }

  const result = await withTransaction(async (client) => {
    const row = await usersRepo.findByUsernameForUpdate(username, client);
    if (!row) {
      await verifyDummy(submittedCode);
      throw invalid;
    }

    if (!(await verifySecret(row.recovery_code_hash, submittedCode))) {
      throw invalid;
    }

    // Valid. Rotate immediately — the presented code must never work twice.
    const nextCode = generateRecoveryCode();
    const nextCodeHash = await hashSecret(nextCode);
    await usersRepo.rotateRecoveryCode(row.id, nextCodeHash, client);

    if (newPassword !== null) {
      await usersRepo.updatePasswordHash(row.id, await hashSecret(newPassword), client);
      // A password reset must sign out every other device: the reason to reset
      // is that the old password may be compromised, so leaving other sessions
      // alive would defeat the point. Without a new password this is a
      // new-device sign-in, and existing sessions stay valid.
      await tokensRepo.deleteAllTokensForUser(row.id, client);
    }

    const fresh = await usersRepo.findById(row.id, client);
    return { row: fresh ?? row, nextCode };
  });

  const { token, expiresAt } = await issueToken(result.row.id);
  return authResult(result.row, token, expiresAt, result.nextCode);
}

// --- logout -----------------------------------------------------------------

export async function logout(tokenPlaintext: string): Promise<void> {
  await tokensRepo.deleteToken(hashToken(tokenPlaintext));
}
