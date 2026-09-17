// OWNER: backend (IDEA-078)
//
// Reading the challenge ladder, and paying out a claim.
//
// The split here mirrors scoreService's: this module holds the DECISION and the
// transaction, repo/challenges.ts holds the SQL, validation/challenges.ts holds
// the pure rule. All three exist so the interesting part — what counts as done
// — is testable with no database.

import { withTransaction } from "../db.js";
import * as challengeRepo from "../repo/challenges.js";
import * as usersRepo from "../repo/users.js";
import { toPublicProfile, type PublicProfile, type UserRow } from "../repo/types.js";
import {
  canClaim,
  evaluateChallenges,
  type ChallengeRow,
} from "../validation/challenges.js";
import { ApiError } from "../http/errors.js";

export interface ChallengeList {
  challenges: ChallengeRow[];
}

/** The Challenges screen's whole payload. */
export async function list(user: UserRow): Promise<ChallengeList> {
  const [stats, claims] = await Promise.all([
    challengeRepo.statsForUser(user.id, user.challenge_progress),
    challengeRepo.claimsForUser(user.id),
  ]);
  return {
    challenges: evaluateChallenges(
      stats,
      claims.map((c) => c.challenge_id),
    ),
  };
}

export interface ClaimResult {
  challengeId: string;
  coinsAwarded: number;
  profile: PublicProfile;
}

/**
 * Take one reward.
 *
 * EVERYTHING IS RE-DERIVED INSIDE THE TRANSACTION, and that is the point: the
 * client's opinion that a challenge is done never reaches this function. It
 * sends an id; the server recomputes the player's stats from `run_stats`, reads
 * their existing claims, and decides. A patched client can ask for any id it
 * likes and gets NOT_COMPLETE.
 *
 * The user row is re-read inside the transaction too (FOR UPDATE), rather than
 * using the one requireAuth loaded: `challenge_progress` feeds
 * `journeyUnlocked`, and the row the middleware fetched could be a few hundred
 * milliseconds stale — a run finishing in that window would be judged against
 * the old ladder position. The lock also serialises two claims from the same
 * player, so their coin updates cannot interleave.
 */
export async function claim(userId: string, challengeId: string): Promise<ClaimResult> {
  return withTransaction(async (client) => {
    const user = await usersRepo.findByIdForUpdate(userId, client);
    if (!user) throw new ApiError(401, "UNAUTHORIZED", "Sign in to continue.");

    // Sequential: both go through the ONE transaction client, and a PoolClient
    // cannot run two queries at once (pg queues them today and throws in
    // pg@9). The list path above has no client and is genuinely concurrent.
    const stats = await challengeRepo.statsForUser(user.id, user.challenge_progress, client);
    const claims = await challengeRepo.claimsForUser(user.id, client);

    const verdict = canClaim(
      challengeId,
      stats,
      claims.map((c) => c.challenge_id),
    );

    if (!verdict.ok) {
      if (verdict.reason === "UNKNOWN_CHALLENGE") {
        throw new ApiError(404, "UNKNOWN_ITEM", "That challenge does not exist.");
      }
      if (verdict.reason === "ALREADY_CLAIMED") {
        throw new ApiError(409, "ALREADY_OWNED", "You have already claimed that reward.");
      }
      throw new ApiError(409, "NOT_COMPLETE", "That challenge is not finished yet.");
    }

    // The primary key is the real guard against a double payout — two requests
    // racing each other both read "not claimed" above, and only the insert can
    // decide. A loser here is not an error the player did anything wrong to
    // cause, so it reports as ALREADY_CLAIMED rather than as a conflict.
    const inserted = await challengeRepo.insertClaim(
      user.id,
      verdict.def.id,
      verdict.def.reward,
      client,
    );
    if (!inserted) {
      throw new ApiError(409, "ALREADY_OWNED", "You have already claimed that reward.");
    }

    await client.query(`UPDATE users SET coins = coins + $2 WHERE id = $1`, [
      user.id,
      verdict.def.reward,
    ]);

    const fresh = (await usersRepo.findById(user.id, client)) ?? user;
    return {
      challengeId: verdict.def.id,
      coinsAwarded: verdict.def.reward,
      profile: toPublicProfile(fresh),
    };
  });
}
