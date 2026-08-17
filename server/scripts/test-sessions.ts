// OWNER: backend
//
// Database-backed tests for run sessions and score submission (Increment 2).
// Needs Postgres:  docker compose up -d db  →  npm run test:sessions
//
// The pure bounds are covered exhaustively in test-plausibility.ts. What THIS
// file covers is everything that only exists once a database is involved:
// the replay guard, server-clock timing, high_score being classic-only,
// challenge progression, coin awards, and the rejection log.

import { pool, closeDb } from "../src/db.js";
import * as authService from "../src/services/authService.js";
import * as scoreService from "../src/services/scoreService.js";
import * as usersRepo from "../src/repo/users.js";
import * as profileService from "../src/services/profileService.js";
import { ApiError } from "../src/http/errors.js";
import { CHALLENGE_LEVELS } from "../src/catalog.generated.js";

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

const uniqueName = (): string =>
  `s${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`.slice(0, 20);

async function newUser() {
  const result = await authService.signup(uniqueName(), "a-good-test-password");
  createdUserIds.push(result.user.id);
  return (await usersRepo.findById(result.user.id))!;
}

/** Backdate a session so time-dependent bounds can be exercised without
 *  actually waiting. Writes to started_at directly — the one place a test is
 *  allowed to touch the clock the client can't. */
async function backdateSession(sessionId: string, seconds: number): Promise<void> {
  await pool.query(
    `UPDATE game_sessions SET started_at = now() - ($2 || ' seconds')::interval WHERE id = $1`,
    [sessionId, String(seconds)],
  );
}

/** A plausible single-level classic run on maze 0. */
function goodRun(over: Record<string, unknown> = {}) {
  return {
    score: 175 * 10 + 4 * 50 + 2 * 100 + 6 * 200, // 3350
    levelsCleared: 1,
    mazeIdxSequence: [0],
    pelletsEaten: 175,
    bonesEaten: 4,
    fruitEaten: 2,
    ghostsEaten: 6,
    coinsCollected: 2,
    livesLost: 0,
    playSeconds: 200,
    ...over,
  };
}

async function main(): Promise<void> {
  // --- issuing sessions -----------------------------------------------------
  section("Starting a run");

  const user = await newUser();
  const started = await scoreService.startSession(user, "classic", null);

  ok("returns a session id", typeof started.sessionId === "string" && started.sessionId.length > 20);
  ok("returns the server's own timestamp", !Number.isNaN(Date.parse(started.serverTime)));

  await expectApiError("unknown mode rejected", "VALIDATION_FAILED", () =>
    scoreService.startSession(user, "sandbox", null));
  await expectApiError("challenge without an index rejected", "VALIDATION_FAILED", () =>
    scoreService.startSession(user, "challenge", null));
  await expectApiError("out-of-range challenge index rejected", "VALIDATION_FAILED", () =>
    scoreService.startSession(user, "challenge", 99));

  // A fresh account has progress 0, so only level 0 is startable.
  await expectApiError("can't start a locked challenge level", "LEVEL_LOCKED", () =>
    scoreService.startSession(user, "challenge", 5));

  section("Open-session cap");
  {
    const capUser = await newUser();
    await scoreService.startSession(capUser, "classic", null);
    await scoreService.startSession(capUser, "classic", null);
    await scoreService.startSession(capUser, "classic", null);
    await expectApiError("a 4th concurrent run is refused", "TOO_MANY_OPEN_SESSIONS", () =>
      scoreService.startSession(capUser, "classic", null));

    // Stale sessions are swept when a new one is requested, so a player who
    // quit three times isn't locked out of playing again.
    await pool.query(
      `UPDATE game_sessions SET started_at = now() - interval '30 minutes'
        WHERE user_id = $1 AND status = 'open'`,
      [capUser.id],
    );
    const afterSweep = await scoreService.startSession(capUser, "classic", null);
    ok("stale sessions are swept, so a new run is allowed", typeof afterSweep.sessionId === "string");
  }

  // --- accepting a good run -------------------------------------------------
  section("A plausible run is accepted");
  {
    const player = await newUser();
    const session = await scoreService.startSession(player, "classic", null);
    await backdateSession(session.sessionId, 300);

    const result = await scoreService.finishSession(player, session.sessionId, goodRun());

    if (!result.accepted) {
      ok("accepted", false, result.reasonCode);
    } else {
      ok("accepted", true);
      ok("reports the score back", result.score === 3350, result.score);
      ok("flags a new high score", result.isNewHighScore);
      ok("high score is stored", result.highScore === 3350, result.highScore);
      // floor(3350/1000)=3 milestone coins + 2 collected
      ok("coins awarded server-side (3 milestones + 2 pickups)", result.coinsAwarded === 5, result.coinsAwarded);
      ok("the profile reflects the new coins", result.profile.coins === 5, result.profile.coins);
    }
  }

  // --- the replay guard -----------------------------------------------------
  section("Replay guard");
  {
    const player = await newUser();
    const session = await scoreService.startSession(player, "classic", null);
    await backdateSession(session.sessionId, 300);

    await scoreService.finishSession(player, session.sessionId, goodRun());
    await expectApiError("the same session can't be finished twice", "SESSION_ALREADY_FINISHED", () =>
      scoreService.finishSession(player, session.sessionId, goodRun()));

    // Another player's session id must be indistinguishable from a fake one.
    const stranger = await newUser();
    await expectApiError("can't finish someone else's session", "NOT_FOUND", () =>
      scoreService.finishSession(stranger, session.sessionId, goodRun()));
    await expectApiError("unknown session id", "NOT_FOUND", () =>
      scoreService.finishSession(player, "00000000-0000-0000-0000-000000000000", goodRun()));
  }

  // --- rejection ------------------------------------------------------------
  section("An implausible run is rejected and logged");
  {
    const player = await newUser();
    const session = await scoreService.startSession(player, "classic", null);
    await backdateSession(session.sessionId, 300);

    const result = await scoreService.finishSession(
      player,
      session.sessionId,
      goodRun({ score: 9_999_999 }),
    );

    ok("rejected", !result.accepted);
    if (!result.accepted) {
      ok("with a reason code", result.reasonCode === "LEVEL_SCORE_CAP_EXCEEDED", result.reasonCode);
    }

    const fresh = (await usersRepo.findById(player.id))!;
    ok("high score is NOT updated on rejection", fresh.high_score === 0, fresh.high_score);
    ok("no coins are awarded on rejection", fresh.coins === 0, fresh.coins);

    const { rows } = await pool.query<{ count: string; reason_code: string }>(
      `SELECT count(*) AS count, max(reason_code) AS reason_code
         FROM score_rejections WHERE user_id = $1`,
      [player.id],
    );
    ok("the rejection is logged", Number(rows[0].count) === 1, rows[0].count);
    ok("the log records why", rows[0].reason_code === "LEVEL_SCORE_CAP_EXCEEDED", rows[0].reason_code);

    // A rejected run still closes its session — it can't be retried with
    // different numbers until one sticks.
    const { rows: sess } = await pool.query<{ status: string }>(
      `SELECT status FROM game_sessions WHERE id = $1`,
      [session.sessionId],
    );
    ok("the session is closed as rejected", sess[0].status === "rejected", sess[0].status);
  }

  section("Server-clock timing can't be forged");
  {
    const player = await newUser();
    const session = await scoreService.startSession(player, "classic", null);
    // NOT backdated: the run "finishes" immediately, so the time floor bites
    // regardless of what playSeconds claims.
    const result = await scoreService.finishSession(
      player,
      session.sessionId,
      goodRun({ playSeconds: 9999 }),
    );

    ok("an instant run is rejected", !result.accepted);
    if (!result.accepted) {
      ok("...for being too fast", result.reasonCode === "RUN_TOO_FAST", result.reasonCode);
    }
  }

  // --- high score is classic-only -------------------------------------------
  section("Leaderboard is CLASSIC ONLY");
  {
    const player = await newUser();

    // First set a modest classic high score.
    const classicSession = await scoreService.startSession(player, "classic", null);
    await backdateSession(classicSession.sessionId, 300);
    await scoreService.finishSession(player, classicSession.sessionId, goodRun());

    const afterClassic = (await usersRepo.findById(player.id))!;
    ok("classic run sets the high score", afterClassic.high_score === 3350, afterClassic.high_score);

    // Now a challenge run that scores HIGHER. It must not touch high_score.
    const level0 = CHALLENGE_LEVELS[0];
    const chSession = await scoreService.startSession(afterClassic, "challenge", 0);
    await backdateSession(chSession.sessionId, 300);

    const chResult = await scoreService.finishSession(afterClassic, chSession.sessionId, {
      ...goodRun(),
      mazeIdxSequence: [level0.mazeIdx],
      score: 5000, // higher than the classic 3350
      pelletsEaten: 175,
      bonesEaten: 4,
      fruitEaten: 2,
      ghostsEaten: 12,
      levelsCleared: 1,
    });

    if (!chResult.accepted) {
      ok("the challenge run is accepted", false, chResult.reasonCode);
    } else {
      ok("the challenge run is accepted", true);
      // THE assertion this section exists for.
      ok("a challenge run NEVER reports a new high score", chResult.isNewHighScore === false);
      ok("high score is unchanged by the challenge run", chResult.highScore === 3350, chResult.highScore);
      ok("but coins ARE still awarded", chResult.coinsAwarded > 0, chResult.coinsAwarded);
    }

    const afterChallenge = (await usersRepo.findById(player.id))!;
    ok("high_score column untouched by challenge", afterChallenge.high_score === 3350, afterChallenge.high_score);
    ok("challenge progress advanced to 1", afterChallenge.challenge_progress === 1, afterChallenge.challenge_progress);
  }

  section("Challenge progression can't be forged");
  {
    const player = await newUser();
    // Progress is 0, so level 0 is the only startable one — but the finish path
    // must ALSO refuse a clear for a locked level, in case a session was
    // obtained some other way.
    const session = await scoreService.startSession(player, "challenge", 0);
    await backdateSession(session.sessionId, 300);

    // Claim a clear of level 7 using a level-0 session: the maze won't match.
    const result = await scoreService.finishSession(player, session.sessionId, {
      ...goodRun(),
      mazeIdxSequence: [CHALLENGE_LEVELS[7].mazeIdx],
      levelsCleared: 1,
    });
    ok("a mismatched maze is rejected", !result.accepted);

    const fresh = (await usersRepo.findById(player.id))!;
    ok("progress does NOT advance on a rejected clear", fresh.challenge_progress === 0, fresh.challenge_progress);
  }

  section("High score only improves");
  {
    const player = await newUser();

    const s1 = await scoreService.startSession(player, "classic", null);
    await backdateSession(s1.sessionId, 300);
    await scoreService.finishSession(player, s1.sessionId, goodRun());

    const mid = (await usersRepo.findById(player.id))!;
    const s2 = await scoreService.startSession(mid, "classic", null);
    await backdateSession(s2.sessionId, 300);
    const worse = await scoreService.finishSession(mid, s2.sessionId, goodRun({
      score: 1000, pelletsEaten: 100, bonesEaten: 0, fruitEaten: 0, ghostsEaten: 0, coinsCollected: 0,
    }));

    ok("a worse run is still accepted", worse.accepted);
    if (worse.accepted) {
      ok("but it isn't a new high score", worse.isNewHighScore === false);
      ok("the high score stands", worse.highScore === 3350, worse.highScore);
    }

    // The reported complaint: "I scored more on a later run but the board still
    // shows my old record." A BETTER run through the real submit path must
    // raise high_score — the direction the suite did not previously cover.
    const afterWorse = (await usersRepo.findById(player.id))!;
    const s3 = await scoreService.startSession(afterWorse, "classic", null);
    await backdateSession(s3.sessionId, 900);
    // Items: 550 biscuits + 6 bones + 3 fruit + 5 ghosts ⇒ the score must land
    // between the all-200 floor (7100) and the all-1600 chain ceiling (14100).
    const better = await scoreService.finishSession(afterWorse, s3.sessionId, goodRun({
      score: 8000,
      mazeIdxSequence: [0, 1, 2],
      levelsCleared: 3,
      pelletsEaten: 550,
      bonesEaten: 6,
      fruitEaten: 3,
      ghostsEaten: 5,
      coinsCollected: 2,
      livesLost: 2,
    }));

    ok("a better later run is accepted", better.accepted,
      better.accepted ? "" : (better as { reasonCode: string }).reasonCode);
    if (better.accepted) {
      ok("it IS flagged as a new high score", better.isNewHighScore === true);
      ok("the returned high score is the new one", better.highScore === 8000, better.highScore);
    }
    const afterBetter = (await usersRepo.findById(player.id))!;
    ok("high_score column really rose", afterBetter.high_score === 8000, afterBetter.high_score);
  }

  section("All-runs board");
  {
    const player = await newUser();

    // Three runs of different scores, all accepted. The scores sit inside the
    // 4200–7000 window those item counts allow (see the floor/ceiling in
    // plausibility.ts MAX-5), deliberately out of order so the sort is tested.
    for (const score of [4500, 6800, 5200]) {
      const s = await scoreService.startSession(
        (await usersRepo.findById(player.id))!, "classic", null);
      await backdateSession(s.sessionId, 600);
      await scoreService.finishSession(
        (await usersRepo.findById(player.id))!, s.sessionId,
        goodRun({
          score, mazeIdxSequence: [0, 1], levelsCleared: 2,
          pelletsEaten: 340, bonesEaten: 4, fruitEaten: 2,
          ghostsEaten: 2, coinsCollected: 1, livesLost: 1,
        }));
    }

    const fresh = (await usersRepo.findById(player.id))!;
    const board = await profileService.runBoard(fresh, "200");
    const mine = board.runs.filter((r) => r.isMe);

    // The whole point of this board: one player, several rows.
    ok("every attempt gets its own row", mine.length === 3, mine.length);
    ok("runs are sorted best first",
      mine.every((r, i) => i === 0 || mine[i - 1].score >= r.score));
    ok("the player's best run leads their rows", mine[0]?.score === 6800, mine[0]?.score);
    ok("myBest points at that run", board.myBest?.score === 6800, board.myBest?.score);
    ok("ranks are contiguous from 1",
      board.runs.every((r, i) => r.rank === i + 1));
    ok("total counts every accepted run", board.total >= 3, board.total);

    // The players board must still fold this same player to ONE row — the
    // difference between the two boards is the feature.
    const players = await profileService.leaderboard(fresh, "100");
    ok("the players board still shows one row per player",
      players.top.filter((e) => e.isMe).length === 1);
  }

  // --- cleanup --------------------------------------------------------------
  section("Cleanup");
  const { rowCount } = await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [createdUserIds]);
  ok(`removed ${rowCount ?? 0} test accounts (sessions + rejections cascade)`, true);

  const { rows: orphans } = await pool.query<{ count: string }>(
    `SELECT count(*) AS count FROM game_sessions WHERE user_id = ANY($1::uuid[])`,
    [createdUserIds],
  );
  ok("their sessions cascaded away", Number(orphans[0].count) === 0, orphans[0].count);

  console.log(`\n${"-".repeat(60)}`);
  console.log(`SESSION TESTS: ${passed} passed, ${failed} failed`);

  await closeDb();
  if (failed > 0) process.exit(1);
}

main().catch(async (err: unknown) => {
  console.error("\ntest-sessions crashed:", err);
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
