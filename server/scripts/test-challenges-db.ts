// OWNER: backend (IDEA-078)
//
// Database-backed tests for the challenge ladder.
//   docker compose up -d db  →  npm run test:challenges:db
//
// test-challenges.ts covers the pure rule exhaustively with no database. What
// THIS file covers is everything that only exists once Postgres is involved,
// and every one of them is a place the pure test cannot see:
//
//   * THE AGGREGATE ITSELF. A SUM/MAX over run_stats is where "in general" and
//     "in one run" actually come from. Get a column name wrong, forget the
//     `accepted` filter, or group by the wrong thing, and the pure evaluator
//     receives perfectly-shaped zeroes and reports a player who has done
//     nothing. Nothing throws.
//
//   * bigint COMES BACK AS A STRING. node-postgres returns SUM()/COUNT() as
//     text, and `"120" >= 100` is TRUE by string comparison while `"90" >= 100`
//     is also true ("9" > "1"). A missing Number() would therefore pass some
//     challenges and fail others at random, which is the worst possible
//     symptom. Only a real query can catch it.
//
//   * THE MODE MAPPING. run_stats stores the Journey as mode='challenge' — the
//     wire/DB name IDEA-077 deliberately did not rename — so the repo maps it
//     to the `journey` bag. A typo there silently zeroes 23 challenges.
//
//   * THE CLAIM TRANSACTION. That the coins land, that the primary key makes a
//     second claim impossible, and that a rejected run pays nothing.
import { pool, closeDb } from "../src/db.js";
import * as authService from "../src/services/authService.js";
import * as challengeService from "../src/services/challengeService.js";
import * as challengeRepo from "../src/repo/challenges.js";
import * as usersRepo from "../src/repo/users.js";
import { ApiError } from "../src/http/errors.js";

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
    ok(label, false, "no error thrown");
  } catch (err) {
    if (err instanceof ApiError) ok(label, err.code === expectedCode, err.code);
    else ok(label, false, String(err));
  }
}

const uniq = (): string => `ch${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`.slice(0, 20);

async function makeUser(): Promise<string> {
  const { user } = await authService.signup(uniq(), "a-decent-password");
  createdUserIds.push(user.id);
  return user.id;
}

/**
 * Write a finished run straight into run_stats.
 *
 * Deliberately NOT played through scoreService: that path is covered by
 * test-sessions.ts, it needs a session and a plausible score, and driving it
 * here would make every assertion below depend on the validator's bounds rather
 * than on the aggregate under test. What matters for a challenge is what landed
 * in the table, so that is what this writes.
 *
 * `session_id` is a real uuid but references nothing, so the row needs a
 * session — game_sessions.id is a FK. One is created per run for that reason
 * alone.
 */
async function recordRun(
  userId: string,
  opts: {
    mode?: "classic" | "challenge";
    challengeIdx?: number | null;
    accepted?: boolean;
    score?: number;
    coins?: number;
    ghosts?: number;
    fruit?: number;
    bones?: number;
    levelsCleared?: number;
    livesLost?: number;
  },
): Promise<void> {
  const mode = opts.mode ?? "classic";
  const challengeIdx = mode === "challenge" ? (opts.challengeIdx ?? 0) : null;
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO game_sessions (user_id, mode, challenge_idx, beagle_skin_id, status, finished_at)
     VALUES ($1, $2, $3, 'bagel', 'accepted', now()) RETURNING id`,
    [userId, mode, challengeIdx],
  );
  await pool.query(
    `INSERT INTO run_stats (
       session_id, user_id, finished_at, accepted, mode, challenge_idx,
       score, elapsed_seconds, levels_played, levels_cleared,
       ghosts_eaten, coins_collected, fruit_eaten, bones_eaten, lives_lost
     ) VALUES ($1, $2, now(), $3, $4, $5, $6, 60, $7, $7, $8, $9, $10, $11, $12)`,
    [
      rows[0].id,
      userId,
      opts.accepted ?? true,
      mode,
      challengeIdx,
      opts.score ?? 0,
      opts.levelsCleared ?? 0,
      opts.ghosts ?? 0,
      opts.coins ?? 0,
      opts.fruit ?? 0,
      opts.bones ?? 0,
      opts.livesLost ?? 0,
    ],
  );
}

const valueOf = (rows: Awaited<ReturnType<typeof challengeService.list>>["challenges"], id: string) =>
  rows.find((r) => r.id === id);

async function main(): Promise<void> {
  // -------------------------------------------------------------------------
  section("A brand-new player");
  {
    const id = await makeUser();
    const user = (await usersRepo.findById(id))!;
    const { challenges } = await challengeService.list(user);
    ok("gets the whole ladder", challenges.length > 0, challenges.length);
    ok("…every row at zero", challenges.every((r) => r.value === 0));
    ok("…nothing done", challenges.every((r) => !r.done));
    ok("…nothing claimed", challenges.every((r) => !r.claimed));
  }

  // -------------------------------------------------------------------------
  section("In one run: a personal best is a MAX, not a sum");
  {
    const id = await makeUser();
    await recordRun(id, { coins: 6 });
    await recordRun(id, { coins: 4 });
    const user = (await usersRepo.findById(id))!;
    const { challenges } = await challengeService.list(user);

    // Two runs of 6 and 4 total 10, but the best single run is 6. A SUM here
    // would hand over the 10-coin tier for two mediocre runs.
    ok("the 5-coin run tier is done", valueOf(challenges, "classic-run-coins-5")?.done === true);
    ok(
      "the 10-coin run tier is NOT (6 + 4 is not a run of 10)",
      valueOf(challenges, "classic-run-coins-10")?.done === false,
      valueOf(challenges, "classic-run-coins-10")?.value,
    );
    ok(
      "…and its progress shows the best run, 6",
      valueOf(challenges, "classic-run-coins-10")?.value === 6,
      valueOf(challenges, "classic-run-coins-10")?.value,
    );
  }

  // -------------------------------------------------------------------------
  section("In general: a lifetime total IS a sum");
  {
    const id = await makeUser();
    for (let i = 0; i < 6; i++) await recordRun(id, { coins: 9 });
    const user = (await usersRepo.findById(id))!;
    const { challenges } = await challengeService.list(user);
    // 54 across six runs. bigint arrives as a STRING from node-postgres, and
    // "54" >= 50 is true by luck while "54" >= 100 would ALSO be true on a
    // string compare ("5" > "1"). The second assertion is the one that catches
    // a missing Number().
    ok("50 in total is done", valueOf(challenges, "classic-total-coins-50")?.done === true);
    ok(
      "100 in total is not — and would pass on a string compare",
      valueOf(challenges, "classic-total-coins-100")?.done === false,
      valueOf(challenges, "classic-total-coins-100")?.value,
    );
    ok(
      "the total reads 54",
      valueOf(challenges, "classic-total-coins-100")?.value === 54,
      valueOf(challenges, "classic-total-coins-100")?.value,
    );
  }

  // -------------------------------------------------------------------------
  section("A REJECTED run counts for nothing");
  {
    const id = await makeUser();
    await recordRun(id, { coins: 30, ghosts: 30, accepted: false });
    const user = (await usersRepo.findById(id))!;
    const { challenges } = await challengeService.list(user);
    ok(
      "a run the validator refused pays nothing",
      valueOf(challenges, "classic-run-coins-5")?.done === false,
      valueOf(challenges, "classic-run-coins-5")?.value,
    );
  }

  // -------------------------------------------------------------------------
  section("Mode scoping, across the wire/DB name boundary");
  {
    const id = await makeUser();
    // run_stats stores the Journey as mode='challenge'. If the repo mapped that
    // to the wrong bag, this classic challenge would light up and 23 Journey
    // ones would stay dark.
    await recordRun(id, { mode: "challenge", challengeIdx: 0, coins: 5, levelsCleared: 1 });
    const user = (await usersRepo.findById(id))!;
    const { challenges } = await challengeService.list(user);
    ok(
      "a Journey run does not complete a CLASSIC challenge",
      valueOf(challenges, "classic-run-coins-5")?.done === false,
    );
    ok(
      "…and it DOES count for the Journey's all-coins ladder",
      valueOf(challenges, "journey-allcoins-1")?.done === true,
    );
  }

  // -------------------------------------------------------------------------
  section("The Journey's per-level counts are DISTINCT levels");
  {
    const id = await makeUser();
    // Three deathless clears, but two of them are the same level. "Clear 5
    // different levels without dying" must not be farmable by replaying one.
    await recordRun(id, { mode: "challenge", challengeIdx: 0, levelsCleared: 1, livesLost: 0 });
    await recordRun(id, { mode: "challenge", challengeIdx: 0, levelsCleared: 1, livesLost: 0 });
    await recordRun(id, { mode: "challenge", challengeIdx: 1, levelsCleared: 1, livesLost: 0 });
    const stats = await challengeRepo.statsForUser(id, 0);
    ok("three runs over two levels count as 2", stats.journeyDeathless === 2, stats.journeyDeathless);

    // A run that died is not a deathless clear, however far it got.
    await recordRun(id, { mode: "challenge", challengeIdx: 2, levelsCleared: 1, livesLost: 1 });
    const after = await challengeRepo.statsForUser(id, 0);
    ok("a run that lost a life does not count", after.journeyDeathless === 2, after.journeyDeathless);
  }

  // -------------------------------------------------------------------------
  section("Deathless in classic is a whole-RUN property");
  {
    const id = await makeUser();
    await recordRun(id, { levelsCleared: 4, livesLost: 1 });
    let user = (await usersRepo.findById(id))!;
    let list = await challengeService.list(user);
    ok(
      "four maps cleared but a life lost is not 'deathless'",
      valueOf(list.challenges, "classic-deathless-1")?.done === false,
    );

    await recordRun(id, { levelsCleared: 3, livesLost: 0 });
    user = (await usersRepo.findById(id))!;
    list = await challengeService.list(user);
    ok("three maps and no deaths clears the 3 tier", valueOf(list.challenges, "classic-deathless-3")?.done === true);
    ok("…but not the 5 tier", valueOf(list.challenges, "classic-deathless-5")?.done === false);
  }

  // -------------------------------------------------------------------------
  section("journeyUnlocked comes from the users column, not from runs");
  {
    const id = await makeUser();
    await pool.query(`UPDATE users SET challenge_progress = 12 WHERE id = $1`, [id]);
    const user = (await usersRepo.findById(id))!;
    const { challenges } = await challengeService.list(user);
    ok("10 levels cleared is done", valueOf(challenges, "journey-unlocked-10")?.done === true);
    ok("15 is not", valueOf(challenges, "journey-unlocked-15")?.done === false);
    ok("…and shows 12", valueOf(challenges, "journey-unlocked-15")?.value === 12);
  }

  // -------------------------------------------------------------------------
  section("Claiming");
  {
    const id = await makeUser();
    await recordRun(id, { coins: 5 });
    const before = (await usersRepo.findById(id))!;
    const startingCoins = before.coins;

    const result = await challengeService.claim(id, "classic-run-coins-5");
    ok("the claim pays the challenge's reward", result.coinsAwarded === 1, result.coinsAwarded);
    ok(
      "…and the coins are really in the wallet",
      result.profile.coins === startingCoins + 1,
      `${result.profile.coins} vs ${startingCoins}`,
    );

    const after = (await usersRepo.findById(id))!;
    ok("…in the database, not just the response", after.coins === startingCoins + 1, after.coins);

    const { challenges } = await challengeService.list(after);
    ok("the row now reads claimed", valueOf(challenges, "classic-run-coins-5")?.claimed === true);
    ok("…and is still in the list", valueOf(challenges, "classic-run-coins-5") !== undefined);

    await expectApiError("claiming it twice is refused", "ALREADY_OWNED", () =>
      challengeService.claim(id, "classic-run-coins-5"),
    );
    const afterTwice = (await usersRepo.findById(id))!;
    ok("…and pays nothing the second time", afterTwice.coins === startingCoins + 1, afterTwice.coins);

    await expectApiError("an unfinished challenge cannot be claimed", "NOT_COMPLETE", () =>
      challengeService.claim(id, "classic-run-coins-30"),
    );
    await expectApiError("an id nobody has heard of is refused", "UNKNOWN_ITEM", () =>
      challengeService.claim(id, "not-a-real-challenge"),
    );
    const afterFails = (await usersRepo.findById(id))!;
    ok("…and neither refusal moved the wallet", afterFails.coins === startingCoins + 1, afterFails.coins);
  }

  // -------------------------------------------------------------------------
  section("Two claims racing: the primary key decides, not the read");
  {
    const id = await makeUser();
    await recordRun(id, { coins: 5 });
    const before = (await usersRepo.findById(id))!;

    // Both transactions read "not claimed" before either inserts. Without the
    // PRIMARY KEY + ON CONFLICT DO NOTHING, both would pay.
    const results = await Promise.allSettled([
      challengeService.claim(id, "classic-run-coins-5"),
      challengeService.claim(id, "classic-run-coins-5"),
    ]);
    const won = results.filter((r) => r.status === "fulfilled").length;
    ok("exactly one of the two claims succeeds", won === 1, won);

    const after = (await usersRepo.findById(id))!;
    ok("…and the wallet moved by exactly one reward", after.coins === before.coins + 1, `${before.coins} -> ${after.coins}`);
  }
}

main()
  .catch((err) => {
    failed++;
    console.error("\nUNCAUGHT", err);
  })
  .finally(async () => {
    // Cascades take game_sessions, run_stats and challenge_claims with them.
    for (const id of createdUserIds) {
      await pool.query(`DELETE FROM users WHERE id = $1`, [id]).catch(() => {});
    }
    await closeDb();
    console.log(`\n${"-".repeat(60)}`);
    console.log(`CHALLENGES (DB): ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
  });
