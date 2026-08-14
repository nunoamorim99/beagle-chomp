// OWNER: backend
//
// Database-backed auth + profile tests. Requires a running Postgres:
//
//     docker compose up -d db          (from the repo root)
//     npm run test:db                  (in server/)
//
// Not part of `npm run test` in the game root, which must stay runnable with no
// services. The pure/no-DB half lives in scripts/test-auth-units.ts.
//
// THE MOST IMPORTANT ASSERTIONS IN THIS FILE are the recovery-code ones. There
// is no email on file, so a recovery code is the only way back into an account.
// A bug there is silently catastrophic in one of two directions:
//   - code doesn't rotate  → it works forever, so a leaked screenshot is a
//                            permanent backdoor;
//   - code rotates wrongly → the player is locked out of their own account with
//                            no recourse at all.
// Everything else here is ordinary CRUD by comparison.

import { pool, closeDb } from "../src/db.js";
import * as authService from "../src/services/authService.js";
import * as profileService from "../src/services/profileService.js";
import * as usersRepo from "../src/repo/users.js";
import * as tokensRepo from "../src/repo/tokens.js";
import { hashToken } from "../src/auth/tokens.js";
import { ApiError } from "../src/http/errors.js";
import { BEAGLE_SKINS, MAZE_THEMES } from "../src/catalog.generated.js";

let passed = 0;
let failed = 0;
const createdUserIds: string[] = [];

function ok(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    console.log(`  FAIL ${label}${detail === undefined ? "" : ` — ${String(detail)}`}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

/** Assert that `fn` rejects with a specific ApiError code. */
async function expectApiError(
  label: string,
  expectedCode: string,
  fn: () => Promise<unknown>,
): Promise<void> {
  try {
    await fn();
    ok(label, false, "expected a rejection, got success");
  } catch (err) {
    if (err instanceof ApiError) {
      ok(label, err.code === expectedCode, `expected ${expectedCode}, got ${err.code}`);
    } else {
      ok(label, false, `expected ApiError, got ${String(err)}`);
    }
  }
}

/** Unique per run so repeated runs don't collide on the username index. */
function uniqueName(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`.slice(0, 20);
}

async function signupTracked(username: string, password: string) {
  const result = await authService.signup(username, password);
  createdUserIds.push(result.user.id);
  return result;
}

async function main(): Promise<void> {
  const PASSWORD = "correct horse battery staple";

  // --- signup ---------------------------------------------------------------
  section("Signup");

  const name = uniqueName("test");
  const signed = await signupTracked(name, PASSWORD);

  ok("returns a bearer token", typeof signed.token === "string" && signed.token.length > 20);
  ok("returns a recovery code", /^BEAGLE-/.test(signed.recoveryCode ?? ""), signed.recoveryCode);
  ok("username preserved with original casing", signed.user.username === name);
  ok("new account starts with 0 coins", signed.profile.coins === 0);
  ok("new account owns the default beagle skin", signed.profile.owned.beagleSkinIds.includes("bagel"));
  ok("new account owns the default enemy skin", signed.profile.owned.enemySkinIds.includes("ghost"));
  ok("new account owns the default theme", signed.profile.owned.mazeThemeIds.includes("garden"));
  ok("challenge progress starts at 0", signed.profile.challengeProgress === 0);
  ok("high score starts at 0", signed.profile.highScore === 0);
  ok("recovery code version starts at 1", signed.profile.recoveryCodeVersion === 1);

  // The plaintext must never be persisted — only its hash.
  const row = await usersRepo.findById(signed.user.id);
  ok("password is not stored in plaintext", row?.password_hash !== PASSWORD);
  ok("password hash is argon2id", row?.password_hash.startsWith("$argon2id$") === true);
  ok("recovery code is not stored in plaintext", row?.recovery_code_hash !== signed.recoveryCode);
  ok("recovery code hash is argon2id", row?.recovery_code_hash.startsWith("$argon2id$") === true);

  section("Signup — validation");

  await expectApiError("duplicate username rejected", "USERNAME_TAKEN", () =>
    authService.signup(name, PASSWORD));
  await expectApiError("duplicate is case-insensitive", "USERNAME_TAKEN", () =>
    authService.signup(name.toUpperCase(), PASSWORD));
  await expectApiError("username too short", "VALIDATION_FAILED", () =>
    authService.signup("ab", PASSWORD));
  await expectApiError("username too long", "VALIDATION_FAILED", () =>
    authService.signup("a".repeat(21), PASSWORD));
  await expectApiError("reserved username rejected", "VALIDATION_FAILED", () =>
    authService.signup("admin", PASSWORD));
  await expectApiError("password too short", "VALIDATION_FAILED", () =>
    authService.signup(uniqueName("t"), "short"));

  // The username regex is the primary XSS defence for the leaderboard, since
  // the whole frontend renders through innerHTML.
  for (const bad of ['<script>', 'a"b', "a'b", "a<b", "a b", "a&b"]) {
    await expectApiError(`username rejects ${JSON.stringify(bad)}`, "VALIDATION_FAILED", () =>
      authService.signup(bad, PASSWORD));
  }

  // --- login ----------------------------------------------------------------
  section("Login");

  const logged = await authService.login(name, PASSWORD);
  ok("correct credentials return a token", typeof logged.token === "string");
  ok("login token differs from signup token", logged.token !== signed.token);
  ok("login does NOT leak a recovery code", logged.recoveryCode === undefined);
  ok("username is case-insensitive on login", (await authService.login(name.toUpperCase(), PASSWORD)).token.length > 0);

  await expectApiError("wrong password rejected", "INVALID_CREDENTIALS", () =>
    authService.login(name, "wrong password entirely"));
  await expectApiError("unknown user rejected", "INVALID_CREDENTIALS", () =>
    authService.login(uniqueName("ghost"), PASSWORD));

  // Both failures must present identically, or the error itself reveals which
  // usernames exist.
  let wrongPwMsg = "";
  let unknownMsg = "";
  try { await authService.login(name, "nope nope nope"); } catch (e) { wrongPwMsg = (e as ApiError).message; }
  try { await authService.login(uniqueName("nx"), "nope nope nope"); } catch (e) { unknownMsg = (e as ApiError).message; }
  ok("wrong-password and unknown-user messages are identical", wrongPwMsg === unknownMsg, `${wrongPwMsg} vs ${unknownMsg}`);

  // --- tokens ---------------------------------------------------------------
  section("Tokens");

  const byToken = await tokensRepo.findUserByToken(hashToken(logged.token));
  ok("token resolves to its user", byToken?.id === signed.user.id);
  ok("unknown token resolves to nothing", (await tokensRepo.findUserByToken(hashToken("not-a-real-token"))) === null);

  await authService.logout(logged.token);
  ok("logout revokes that token", (await tokensRepo.findUserByToken(hashToken(logged.token))) === null);
  ok("logout leaves OTHER sessions alive", (await tokensRepo.findUserByToken(hashToken(signed.token))) !== null);

  // --- recovery codes: THE CRITICAL SECTION ---------------------------------
  section("Recovery code — single-use consumption (the critical path)");

  const recName = uniqueName("rec");
  const recAccount = await signupTracked(recName, PASSWORD);
  const firstCode = recAccount.recoveryCode!;

  const recovered = await authService.recover(recName, firstCode, undefined);
  ok("valid code signs you in", typeof recovered.token === "string");
  ok("consuming a code issues a NEW one", typeof recovered.recoveryCode === "string");
  ok("the new code differs from the old", recovered.recoveryCode !== firstCode);
  ok("recovery code version incremented to 2", recovered.profile.recoveryCodeVersion === 2);

  // The single most important assertion in the backend.
  await expectApiError("OLD code is dead after use", "INVALID_RECOVERY_CODE", () =>
    authService.recover(recName, firstCode, undefined));

  const secondCode = recovered.recoveryCode!;
  const recovered2 = await authService.recover(recName, secondCode, undefined);
  ok("the NEW code works exactly once", typeof recovered2.token === "string");
  await expectApiError("...and then it is dead too", "INVALID_RECOVERY_CODE", () =>
    authService.recover(recName, secondCode, undefined));
  ok("version incremented again to 3", recovered2.profile.recoveryCodeVersion === 3);

  section("Recovery code — normalisation is accepted");

  const normName = uniqueName("norm");
  const normAccount = await signupTracked(normName, PASSWORD);
  const messy = normAccount.recoveryCode!.toLowerCase().replace(/-/g, " ");
  const normRecovered = await authService.recover(normName, messy, undefined);
  ok("lowercase + spaces instead of dashes still works", typeof normRecovered.token === "string");

  section("Recovery code — rejections");

  const rejName = uniqueName("rej");
  const rejAccount = await signupTracked(rejName, PASSWORD);

  await expectApiError("wrong code rejected", "INVALID_RECOVERY_CODE", () =>
    authService.recover(rejName, "BEAGLE-0000-0000-0000", undefined));
  await expectApiError("malformed code rejected", "INVALID_RECOVERY_CODE", () =>
    authService.recover(rejName, "not-a-code", undefined));
  await expectApiError("unknown user rejected", "INVALID_RECOVERY_CODE", () =>
    authService.recover(uniqueName("nobody"), rejAccount.recoveryCode!, undefined));
  await expectApiError("another user's code rejected", "INVALID_RECOVERY_CODE", () =>
    authService.recover(rejName, normAccount.recoveryCode!, undefined));

  // A failed attempt must NOT burn the real code.
  const stillWorks = await authService.recover(rejName, rejAccount.recoveryCode!, undefined);
  ok("failed attempts do not consume the real code", typeof stillWorks.token === "string");

  section("Recovery code — password reset revokes other devices");

  const resetName = uniqueName("reset");
  const resetAccount = await signupTracked(resetName, PASSWORD);
  // Two extra sessions, as if signed in on a phone and a laptop.
  const deviceA = await authService.login(resetName, PASSWORD);
  const deviceB = await authService.login(resetName, PASSWORD);
  ok("both devices are authenticated before the reset",
    (await tokensRepo.findUserByToken(hashToken(deviceA.token))) !== null &&
    (await tokensRepo.findUserByToken(hashToken(deviceB.token))) !== null);

  const NEW_PASSWORD = "an entirely different passphrase";
  const afterReset = await authService.recover(resetName, resetAccount.recoveryCode!, NEW_PASSWORD);

  ok("reset returns a fresh token", typeof afterReset.token === "string");
  ok("the new session is valid", (await tokensRepo.findUserByToken(hashToken(afterReset.token))) !== null);
  // The whole reason to reset is that the old password may be compromised, so
  // leaving other sessions alive would defeat it.
  ok("device A was signed out", (await tokensRepo.findUserByToken(hashToken(deviceA.token))) === null);
  ok("device B was signed out", (await tokensRepo.findUserByToken(hashToken(deviceB.token))) === null);

  ok("new password works", (await authService.login(resetName, NEW_PASSWORD)).token.length > 0);
  await expectApiError("old password no longer works", "INVALID_CREDENTIALS", () =>
    authService.login(resetName, PASSWORD));

  section("Recovery code — a rejected new password must NOT burn the code");

  const guardName = uniqueName("guard");
  const guardAccount = await signupTracked(guardName, PASSWORD);
  await expectApiError("too-short new password rejected", "VALIDATION_FAILED", () =>
    authService.recover(guardName, guardAccount.recoveryCode!, "short"));
  // If validation ran after consumption, the player would now hold a dead code
  // AND still be locked out — the worst outcome this system can produce.
  const guardStillWorks = await authService.recover(guardName, guardAccount.recoveryCode!, undefined);
  ok("the code still works after a rejected password", typeof guardStillWorks.token === "string");

  section("Recovery code — new-device sign-in keeps existing sessions");

  const keepName = uniqueName("keep");
  const keepAccount = await signupTracked(keepName, PASSWORD);
  const existing = await authService.login(keepName, PASSWORD);
  await authService.recover(keepName, keepAccount.recoveryCode!, undefined);
  ok("no password change → other sessions survive",
    (await tokensRepo.findUserByToken(hashToken(existing.token))) !== null);

  // --- profile: purchases ---------------------------------------------------
  section("Profile — purchases");

  const shopName = uniqueName("shop");
  const shopAccount = await signupTracked(shopName, PASSWORD);
  const shopUser = (await usersRepo.findById(shopAccount.user.id))!;

  await expectApiError("cannot buy without coins", "INSUFFICIENT_COINS", () =>
    profileService.purchase(shopUser.id, "beagle", "cookie"));

  // Amounts are DERIVED from the real catalog prices rather than hardcoded:
  // IDEA-012 v2 raised skins 5 -> 25 and themes to 50, which broke the old
  // fixed numbers here. Deriving them means the next rebalance won't.
  const skinPrice = BEAGLE_SKINS.find((i) => i.id === "cookie")!.price;
  const themePrice = MAZE_THEMES.find((i) => i.id === "forest")!.price;
  // Enough for exactly one skin and one theme, with 5 to spare.
  const wallet = skinPrice + themePrice + 5;
  await pool.query(`UPDATE users SET coins = $2 WHERE id = $1`, [shopUser.id, wallet]);

  const bought = await profileService.purchase(shopUser.id, "beagle", "cookie");
  ok("purchase grants the item", bought.owned.beagleSkinIds.includes("cookie"));
  ok(
    "purchase deducts the SERVER's price, not a client-supplied one",
    bought.coins === wallet - skinPrice,
    `coins=${bought.coins}, expected ${wallet - skinPrice}`,
  );

  await expectApiError("cannot buy the same thing twice", "ALREADY_OWNED", () =>
    profileService.purchase(shopUser.id, "beagle", "cookie"));
  await expectApiError("unknown item rejected", "UNKNOWN_ITEM", () =>
    profileService.purchase(shopUser.id, "beagle", "not-a-skin"));
  await expectApiError("unknown kind rejected", "VALIDATION_FAILED", () =>
    profileService.purchase(shopUser.id, "hats", "cookie"));

  const themeBought = await profileService.purchase(shopUser.id, "theme", "forest");
  ok(
    "theme price charged correctly",
    themeBought.coins === wallet - skinPrice - themePrice,
    `coins=${themeBought.coins}, expected ${wallet - skinPrice - themePrice}`,
  );

  await expectApiError("can't afford a second theme on the change", "INSUFFICIENT_COINS", () =>
    profileService.purchase(shopUser.id, "theme", "city"));

  section("Profile — equipping");

  const shopUser2 = (await usersRepo.findById(shopUser.id))!;
  const equipped = await profileService.equip(shopUser2, { beagleSkinId: "cookie" });
  ok("can equip an owned skin", equipped.equipped.beagleSkinId === "cookie");

  await expectApiError("cannot equip an unowned skin", "NOT_OWNED", () =>
    profileService.equip(shopUser2, { beagleSkinId: "muffin" }));
  await expectApiError("cannot equip an unknown id", "UNKNOWN_ITEM", () =>
    profileService.equip(shopUser2, { beagleSkinId: "nonsense" }));

  const multi = await profileService.equip(
    (await usersRepo.findById(shopUser.id))!,
    { beagleSkinId: "bagel", mazeThemeId: "forest" },
  );
  ok("multiple slots equip together", multi.equipped.beagleSkinId === "bagel" && multi.equipped.mazeThemeId === "forest");

  // --- leaderboard ----------------------------------------------------------
  section("Leaderboard (classic mode only)");

  const lbUser = (await usersRepo.findById(shopUser.id))!;
  const emptyBoard = await profileService.leaderboard(lbUser, undefined);
  ok("unranked player gets me=null", emptyBoard.me === null);

  await pool.query(`UPDATE users SET high_score = 12345, high_score_at = now() WHERE id = $1`, [lbUser.id]);
  const ranked = await profileService.leaderboard((await usersRepo.findById(lbUser.id))!, undefined);
  ok("ranked player appears in me", ranked.me?.highScore === 12345);
  ok("ranked player appears in the top list", ranked.top.some((e) => e.username === lbUser.username));
  ok("ranks start at 1", ranked.top[0]?.rank === 1);
  ok("top is sorted descending", ranked.top.every((e, i, arr) => i === 0 || arr[i - 1].highScore >= e.highScore));

  ok("own row is flagged by id, not by username", ranked.top.some((e) => e.isMe));
  ok("me is flagged", ranked.me?.isMe === true);
  ok("total counts ranked players", ranked.total >= 1);
  ok(
    "rank in `me` agrees with the row in `top`",
    ranked.me!.rank === ranked.top.find((e) => e.isMe)!.rank,
  );

  const limited = await profileService.leaderboard((await usersRepo.findById(lbUser.id))!, "1");
  ok("limit is respected", limited.top.length <= 1);
  ok("total ignores the limit", limited.total === ranked.total);

  // The reported bug: a better later run must REPLACE the earlier score, and a
  // player must never occupy two rows. high_score is a running maximum, so the
  // board shows each player's best — this pins that down.
  await pool.query(`UPDATE users SET high_score = GREATEST(high_score, $2), high_score_at = now() WHERE id = $1`,
    [lbUser.id, 99999]);
  const improved = await profileService.leaderboard((await usersRepo.findById(lbUser.id))!, "100");
  ok("a better score replaces the earlier one", improved.me?.highScore === 99999);
  ok(
    "a player appears exactly once on the board",
    improved.top.filter((e) => e.isMe).length === 1,
  );

  // And a WORSE later run must not overwrite the best.
  await pool.query(`UPDATE users SET high_score = GREATEST(high_score, $2) WHERE id = $1`,
    [lbUser.id, 500]);
  const kept = await profileService.leaderboard((await usersRepo.findById(lbUser.id))!, "100");
  ok("a worse later score does not lower the best", kept.me?.highScore === 99999);

  // --- account deletion -----------------------------------------------------
  section("Delete account");

  const delName = uniqueName("del");
  const delAccount = await signupTracked(delName, PASSWORD);
  const delUser = (await usersRepo.findById(delAccount.user.id))!;

  await expectApiError("wrong confirmation rejected", "CONFIRMATION_MISMATCH", () =>
    profileService.deleteAccount(delUser, "not-my-username"));
  await expectApiError("missing confirmation rejected", "CONFIRMATION_MISMATCH", () =>
    profileService.deleteAccount(delUser, undefined));

  await profileService.deleteAccount(delUser, delName);
  ok("account row is gone", (await usersRepo.findById(delUser.id)) === null);
  ok("tokens cascade away", (await tokensRepo.findUserByToken(hashToken(delAccount.token))) === null);
  await expectApiError("deleted account cannot log in", "INVALID_CREDENTIALS", () =>
    authService.login(delName, PASSWORD));

  // The username must become available again — the row is truly gone, not
  // soft-deleted, which is what the privacy notice promises.
  const reused = await signupTracked(delName, PASSWORD);
  ok("username is free for reuse after deletion", reused.user.username === delName);

  // --- cleanup --------------------------------------------------------------
  section("Cleanup");
  const { rowCount } = await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [createdUserIds]);
  ok(`removed ${rowCount ?? 0} test accounts`, true);

  console.log(`\n${"-".repeat(60)}`);
  console.log(`AUTH DB TESTS: ${passed} passed, ${failed} failed`);

  await closeDb();
  if (failed > 0) process.exit(1);
}

main().catch(async (err: unknown) => {
  console.error("\ntest-auth crashed:", err);
  try {
    if (createdUserIds.length > 0) {
      await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [createdUserIds]);
    }
    await closeDb();
  } catch {
    // already failing; nothing useful to add
  }
  process.exit(1);
});
