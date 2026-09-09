// OWNER: qa-test-engineer (IDEA-052b)
//
// The push data layer and the rank-alert TRIGGER, against a real database.
//
// The pure selection logic is covered by test-rank-alert.ts. What this suite
// checks is the wiring that file cannot see: that the preference join actually
// filters, that a re-subscribe upserts instead of duplicating, that the
// subscription cascades with the account (the privacy promise), and — the one
// that matters most — that finishSession picks the right people at the moment a
// personal best is beaten.
//
// NEEDS POSTGRES. Not in `npm test`.
//   docker compose up -d db
//   DATABASE_URL=... npm run test:push

import { pool, closeDb } from "../src/db.js";
import * as authService from "../src/services/authService.js";
import * as scoreService from "../src/services/scoreService.js";
import * as usersRepo from "../src/repo/users.js";
import * as subs from "../src/repo/pushSubscriptions.js";
import { randomBytes, createECDH } from "node:crypto";

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

/** A subscription whose keys are the RIGHT SHAPE — a real P-256 public point
 *  and a 16-byte auth secret. web-push encrypts against these before it sends,
 *  so garbage here fails locally with a crypto error rather than exercising the
 *  send path at all. */
function fakeSubscription(endpointSuffix: string): {
  endpoint: string;
  p256dh: string;
  auth: string;
} {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/${endpointSuffix}`,
    p256dh: ecdh.getPublicKey().toString("base64url"),
    auth: randomBytes(16).toString("base64url"),
  };
}

let counter = 0;
async function newUser(highScore = 0) {
  counter++;
  const username = `push${Date.now().toString().slice(-6)}x${counter}`;
  const res = await authService.signup(username, "push-test-pass-1");
  createdUserIds.push(res.user.id);
  if (highScore > 0) {
    await pool.query(
      `UPDATE users SET high_score = $2, high_score_at = now() - interval '1 day' WHERE id = $1`,
      [res.user.id, highScore],
    );
  }
  return res.user.id;
}

async function main(): Promise<void> {
  // --- the repo -------------------------------------------------------------
  section("Subscriptions");

  const userA = await newUser();
  const userB = await newUser();
  const subA = fakeSubscription("device-a");

  await subs.save({ endpoint: subA.endpoint, userId: userA, p256dh: subA.p256dh, auth: subA.auth });
  let rows = await subs.findForUsers([userA], "rank");
  ok("a subscription is saved", rows.length === 1);

  // A browser re-subscribing returns the SAME endpoint. It must update, not
  // accumulate a second row for one device.
  await subs.save({ endpoint: subA.endpoint, userId: userA, p256dh: "newkey", auth: "newauth" });
  rows = await subs.findForUsers([userA], "rank");
  ok("re-subscribing the same endpoint upserts", rows.length === 1, `${rows.length} rows`);
  ok("…and refreshes the keys", rows[0]?.p256dh === "newkey");

  // A shared machine: the same endpoint, a different player signed in. The
  // subscription must follow whoever is actually signed in, or one player's
  // alerts land on another's browser.
  await subs.save({ endpoint: subA.endpoint, userId: userB, p256dh: "k", auth: "a" });
  ok("…and follows the signed-in user", (await subs.findForUsers([userA], "rank")).length === 0);
  ok("…to the new owner", (await subs.findForUsers([userB], "rank")).length === 1);
  await subs.save({ endpoint: subA.endpoint, userId: userA, p256dh: "k", auth: "a" });

  // --- preferences ----------------------------------------------------------
  section("Preferences are joined in SQL, not filtered by a caller");

  await pool.query(`UPDATE users SET notify_rank = false WHERE id = $1`, [userA]);
  ok("a player who turned rank alerts off is not returned", (await subs.findForUsers([userA], "rank")).length === 0);
  ok(
    "…but still gets announcements, which is a separate switch",
    (await subs.findForUsers([userA], "announcements")).length === 1,
  );

  await pool.query(`UPDATE users SET notify_announcements = false WHERE id = $1`, [userA]);
  ok("…and turning THAT off removes them too", (await subs.findAllForAnnouncements()).every((r) => r.user_id !== userA));

  await pool.query(`UPDATE users SET notify_rank = true, notify_announcements = true WHERE id = $1`, [userA]);

  // --- unsubscribe is scoped ------------------------------------------------
  section("Unsubscribe is scoped to the owner");

  await subs.removeForUser(subA.endpoint, userB);
  ok("another user cannot remove your device", (await subs.findForUsers([userA], "rank")).length === 1);
  await subs.removeForUser(subA.endpoint, userA);
  ok("…but you can remove your own", (await subs.findForUsers([userA], "rank")).length === 0);

  // --- the privacy promise --------------------------------------------------
  section("Deleting the account takes the device with it");

  const subB = fakeSubscription("device-b");
  await subs.save({ endpoint: subB.endpoint, userId: userB, p256dh: subB.p256dh, auth: subB.auth });
  await pool.query(`DELETE FROM users WHERE id = $1`, [userB]);
  const { rows: left } = await pool.query<{ count: string }>(
    `SELECT count(*) AS count FROM push_subscriptions WHERE endpoint = $1`,
    [subB.endpoint],
  );
  // A push endpoint is a device identifier — the first genuinely device-linked
  // datum this project stores. It must not outlive the account.
  ok("a deleted account leaves no subscription behind", Number(left[0].count) === 0, left[0].count);

  // --- the trigger ----------------------------------------------------------
  section("Beating a personal best selects the right people");

  // The run below scores 3350, so the victim must sit BELOW that to be passed
  // and the bystander above it. The first draft put the victim on 4000 — above
  // the run — and then asserted they were notified, which the code correctly
  // refused to do.
  const victim = await newUser(2000);
  const bystander = await newUser(9000); // above the new score — never moves
  const runner = await newUser(1000);

  const vSub = fakeSubscription("victim-device");
  await subs.save({ endpoint: vSub.endpoint, userId: victim, p256dh: vSub.p256dh, auth: vSub.auth });
  const bSub = fakeSubscription("bystander-device");
  await subs.save({ endpoint: bSub.endpoint, userId: bystander, p256dh: bSub.p256dh, auth: bSub.auth });

  const runnerRow = await usersRepo.findById(runner);
  if (!runnerRow) throw new Error("runner vanished");

  const session = await scoreService.startSession(runnerRow, "classic", null);
  await pool.query(
    `UPDATE game_sessions SET started_at = now() - interval '300 seconds' WHERE id = $1`,
    [session.sessionId],
  );

  // A run that beats the victim's 2000 but not the bystander's 9000.
  const result = await scoreService.finishSession(runnerRow, session.sessionId, {
    score: 175 * 10 + 4 * 50 + 2 * 100 + 6 * 200,
    levelsCleared: 1,
    mazeIdxSequence: [0],
    pelletsEaten: 175,
    bonesEaten: 4,
    fruitEaten: 2,
    fruitPoints: 200,
    ghostsEaten: 6,
    coinsCollected: 2,
    livesLost: 0,
    playSeconds: 200,
  });

  ok("the run was accepted", result.accepted, result.accepted ? "" : result.reasonCode);
  if (result.accepted) {
    ok("…and set a new high score", result.isNewHighScore && result.score === 3350, result.score);
  }

  // The send goes to an unreachable endpoint, so nothing is delivered — which
  // is the point of the next two checks. The cooldown is stamped ONLY for
  // players actually reached, so a failed send must NOT silence anyone.
  await new Promise((r) => setTimeout(r, 2500));

  const { rows: vRow } = await pool.query<{ last_rank_alert_at: Date | null }>(
    `SELECT last_rank_alert_at FROM users WHERE id = $1`,
    [victim],
  );
  ok(
    "a player we could not reach is NOT put on cooldown",
    vRow[0].last_rank_alert_at === null,
    String(vRow[0].last_rank_alert_at),
  );

  // The subscription was attempted: either the push service said it was gone
  // (row deleted) or the attempt failed softly (failure_count raised). Both
  // prove the fan-out selected this player and tried.
  const { rows: vSubRow } = await pool.query<{ failure_count: number }>(
    `SELECT failure_count FROM push_subscriptions WHERE endpoint = $1`,
    [vSub.endpoint],
  );
  const attempted = vSubRow.length === 0 || vSubRow[0].failure_count > 0;
  ok("the overtaken player's device WAS attempted", attempted, JSON.stringify(vSubRow));

  // The bystander was above the new score and never moved.
  const { rows: bSubRow } = await pool.query<{ failure_count: number }>(
    `SELECT failure_count FROM push_subscriptions WHERE endpoint = $1`,
    [bSub.endpoint],
  );
  ok(
    "a player ABOVE the new score is never contacted",
    bSubRow.length === 1 && bSubRow[0].failure_count === 0,
    JSON.stringify(bSubRow),
  );

  // --- cleanup --------------------------------------------------------------
  section("Cleanup");
  const { rowCount } = await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [createdUserIds]);
  ok(`removed ${rowCount ?? 0} test accounts`, true);
  const { rows: orphans } = await pool.query<{ count: string }>(
    `SELECT count(*) AS count FROM push_subscriptions WHERE user_id = ANY($1::uuid[])`,
    [createdUserIds],
  );
  ok("their subscriptions cascaded away", Number(orphans[0].count) === 0, orphans[0].count);

  console.log(`\n${"-".repeat(60)}`);
  console.log(`PUSH: ${passed} passed, ${failed} failed`);

  await closeDb();
  if (failed > 0) process.exit(1);
}

main().catch(async (err: unknown) => {
  console.error("\ntest-push crashed:", err);
  try {
    if (createdUserIds.length > 0) {
      await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [createdUserIds]);
    }
    await closeDb();
  } catch {
    /* already failing */
  }
  process.exit(1);
});
