// OWNER: backend
//
// Row shapes and the client-facing profile DTO.
//
// The DTO is deliberately close to StoredProfile in src/game/profileStore.ts
// (plus highScore) so the frontend's in-memory cache is a near-identity mapping
// and the existing synchronous read API can survive the move to a server —
// see the plan's client-refactor section.

import type { PoolClient } from "pg";

/** A row of `users`, snake_case exactly as Postgres returns it. Stays inside
 *  the repo/service layer; routes only ever see PublicProfile. */
export interface UserRow {
  id: string;
  username: string;
  username_lower: string;
  password_hash: string;
  recovery_code_hash: string;
  recovery_code_version: number;
  coins: number;
  challenge_progress: number;
  equipped_beagle_skin_id: string;
  equipped_enemy_skin_id: string;
  equipped_maze_theme_id: string;
  owned_beagle_skin_ids: string[];
  owned_enemy_skin_ids: string[];
  owned_maze_theme_ids: string[];
  high_score: number;
  high_score_at: Date | null;
  /** IDEA-038: 'swipe' (default) or 'dpad'. A per-player preference, so it
   *  follows the account rather than the device. */
  control_scheme: string;
  tutorial_done: boolean;
  notify_announcements: boolean;
  notify_rank: boolean;
  last_rank_alert_at: Date | null;
  /** IDEA-051: may read the metrics portal. Set ONLY by a hand-written UPDATE
   *  — there is deliberately no endpoint that writes it. */
  is_admin: boolean;
  /** IDEA-052: when this player last opened the News screen. NULL means never,
   *  which counts everything published as unread — a player who has not seen
   *  the screen has genuinely not seen any of it. */
  announcements_seen_at: Date | null;
  created_at: Date;
}

/** What the client receives. Note what is ABSENT: no password hash, no recovery
 *  code hash, no id-adjacent secrets. `recoveryCodeVersion` is included only so
 *  the profile screen can say "reissued N times" — it is a counter, not a
 *  credential. */
export interface PublicProfile {
  coins: number;
  challengeProgress: number;
  highScore: number;
  equipped: {
    beagleSkinId: string;
    enemySkinId: string;
    mazeThemeId: string;
  };
  owned: {
    beagleSkinIds: string[];
    enemySkinIds: string[];
    mazeThemeIds: string[];
  };
  recoveryCodeVersion: number;
  controlScheme: string;
  /** IDEA-040: false until the player finishes (or skips) the first-run coach. */
  tutorialDone: boolean;
  /** IDEA-052b: what a SUBSCRIBED device receives — not whether the player is
   *  asked. Nothing can be sent without browser permission plus a subscription,
   *  which is a separate, explicit, per-device act. */
  notifyAnnouncements: boolean;
  notifyRank: boolean;
}

export interface PublicUser {
  id: string;
  username: string;
  createdAt: string;
}

export function toPublicProfile(row: UserRow): PublicProfile {
  return {
    coins: row.coins,
    challengeProgress: row.challenge_progress,
    highScore: row.high_score,
    equipped: {
      beagleSkinId: row.equipped_beagle_skin_id,
      enemySkinId: row.equipped_enemy_skin_id,
      mazeThemeId: row.equipped_maze_theme_id,
    },
    owned: {
      beagleSkinIds: row.owned_beagle_skin_ids,
      enemySkinIds: row.owned_enemy_skin_ids,
      mazeThemeIds: row.owned_maze_theme_ids,
    },
    recoveryCodeVersion: row.recovery_code_version,
    controlScheme: row.control_scheme,
    tutorialDone: row.tutorial_done,
    notifyAnnouncements: row.notify_announcements,
    notifyRank: row.notify_rank,
  };
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    createdAt: row.created_at.toISOString(),
  };
}

/** Repo functions accept an optional client so a caller can run them inside an
 *  existing transaction (withTransaction). Omitted → the pool. */
export type Executor = PoolClient | undefined;

/**
 * Every column of `users`, in one place (IDEA-051).
 *
 * THIS EXISTS BECAUSE THE LIST WAS WRITTEN TWICE AND DRIFTED. `repo/users.ts`
 * had a `USER_COLUMNS` constant and `repo/tokens.ts` hand-listed the same
 * columns again inside `findUserByToken`'s JOIN. Adding `is_admin` to the first
 * and not the second produced a bug with no symptom a compiler could see:
 * `query<UserRow>` is an unchecked CAST, not a validation, so the returned row
 * simply had `is_admin: undefined` — falsy — and every admin request 404'd as
 * though the account had never been granted anything. Nothing failed; the
 * feature just did not work.
 *
 * It is the same shape as the IDEA-040 v3 bug (a field understood at both ends
 * and dropped by the layer between them) and as `boardCodegen.ts`'s
 * hand-written palette writer. One list, one place.
 *
 * `alias` prefixes each column for a JOIN — `userColumns("u")` yields
 * `u.id, u.username, …`.
 */
export function userColumns(alias?: string): string {
  const p = alias ? `${alias}.` : "";
  return [
    "id",
    "username",
    "username_lower",
    "password_hash",
    "recovery_code_hash",
    "recovery_code_version",
    "coins",
    "challenge_progress",
    "equipped_beagle_skin_id",
    "equipped_enemy_skin_id",
    "equipped_maze_theme_id",
    "owned_beagle_skin_ids",
    "owned_enemy_skin_ids",
    "owned_maze_theme_ids",
    "high_score",
    "high_score_at",
    "control_scheme",
    "tutorial_done",
    "is_admin",
    "notify_announcements",
    "notify_rank",
    "last_rank_alert_at",
    "announcements_seen_at",
    "created_at",
  ]
    .map((c) => p + c)
    .join(", ");
}
