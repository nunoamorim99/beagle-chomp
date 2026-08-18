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
