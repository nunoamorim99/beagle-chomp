// OWNER: backend
//
// Profile reads and mutations: equipping cosmetics, purchasing them, and
// deleting the account.
//
// The rule that matters here: PRICES COME FROM THE SERVER'S OWN CATALOG
// (catalog.generated.ts, generated from the real src/game registries). The
// client never sends a price, so it cannot buy a 10-coin theme for 0.

import { withTransaction } from "../db.js";
import * as usersRepo from "../repo/users.js";
import * as tokensRepo from "../repo/tokens.js";
import {
  toPublicProfile,
  type PublicProfile,
  type UserRow,
} from "../repo/types.js";
import { ApiError } from "../http/errors.js";
import {
  BEAGLE_SKINS,
  ENEMY_SKINS,
  MAZE_THEMES,
  type CatalogItem,
} from "../catalog.generated.js";
import type { CosmeticKind, EquipUpdate } from "../repo/users.js";

const CATALOG: Record<CosmeticKind, readonly CatalogItem[]> = {
  beagle: BEAGLE_SKINS,
  enemy: ENEMY_SKINS,
  theme: MAZE_THEMES,
};

const OWNED_FIELD: Record<CosmeticKind, keyof UserRow> = {
  beagle: "owned_beagle_skin_ids",
  enemy: "owned_enemy_skin_ids",
  theme: "owned_maze_theme_ids",
};

function lookupItem(kind: CosmeticKind, id: unknown): CatalogItem {
  if (typeof id !== "string") {
    throw new ApiError(400, "UNKNOWN_ITEM", "Unknown item.");
  }
  const item = CATALOG[kind].find((entry) => entry.id === id);
  if (!item) {
    throw new ApiError(400, "UNKNOWN_ITEM", "Unknown item.");
  }
  return item;
}

function ownedIds(row: UserRow, kind: CosmeticKind): string[] {
  return row[OWNED_FIELD[kind]] as string[];
}

export function getProfile(row: UserRow): PublicProfile {
  return toPublicProfile(row);
}

// --- equipping --------------------------------------------------------------

export interface EquipRequest {
  beagleSkinId?: unknown;
  enemySkinId?: unknown;
  mazeThemeId?: unknown;
}

/** Equip any subset of the three slots. Every requested id must exist AND be
 *  owned — otherwise a client could equip something it never bought. */
export async function equip(
  row: UserRow,
  request: EquipRequest,
): Promise<PublicProfile> {
  const update: EquipUpdate = {};

  const slots: Array<[CosmeticKind, keyof EquipRequest, keyof EquipUpdate]> = [
    ["beagle", "beagleSkinId", "beagleSkinId"],
    ["enemy", "enemySkinId", "enemySkinId"],
    ["theme", "mazeThemeId", "mazeThemeId"],
  ];

  for (const [kind, requestKey, updateKey] of slots) {
    const requested = request[requestKey];
    if (requested === undefined) continue;

    const item = lookupItem(kind, requested);
    if (!ownedIds(row, kind).includes(item.id)) {
      throw new ApiError(409, "NOT_OWNED", "You don't own that yet.");
    }
    update[updateKey] = item.id;
  }

  if (Object.keys(update).length === 0) {
    throw new ApiError(400, "VALIDATION_FAILED", "Nothing to equip.");
  }

  const updated = await usersRepo.updateEquipped(row.id, update);
  return toPublicProfile(updated);
}

// --- purchasing -------------------------------------------------------------

export async function purchase(
  userId: string,
  kindInput: unknown,
  itemIdInput: unknown,
): Promise<PublicProfile> {
  if (kindInput !== "beagle" && kindInput !== "enemy" && kindInput !== "theme") {
    throw new ApiError(400, "VALIDATION_FAILED", "Unknown item kind.");
  }
  const kind: CosmeticKind = kindInput;
  const item = lookupItem(kind, itemIdInput);

  // Lock the row for the whole check-then-deduct so two concurrent purchases
  // can't both pass the affordability check against the same balance and
  // overdraw the wallet.
  const updated = await withTransaction(async (client) => {
    const row = await usersRepo.findByIdForUpdate(userId, client);
    if (!row) {
      throw new ApiError(401, "UNAUTHORIZED", "Sign in to continue.");
    }

    if (ownedIds(row, kind).includes(item.id)) {
      throw new ApiError(409, "ALREADY_OWNED", "You already own that.");
    }
    // Price from OUR catalog, never from the request body.
    if (row.coins < item.price) {
      throw new ApiError(409, "INSUFFICIENT_COINS", "Not enough coins yet.");
    }

    return usersRepo.purchaseItem(row.id, kind, item.id, item.price, client);
  });

  return toPublicProfile(updated);
}

// --- settings ---------------------------------------------------------------

/** IDEA-038: the player's control scheme ('swipe' | 'dpad').
 *
 *  Stored per ACCOUNT rather than per device: someone who prefers buttons
 *  prefers them on every phone they sign in from. */
export async function setControlScheme(
  userId: string,
  schemeInput: unknown,
): Promise<PublicProfile> {
  if (schemeInput !== "swipe" && schemeInput !== "dpad") {
    throw new ApiError(400, "VALIDATION_FAILED", "Unknown control scheme.");
  }
  const updated = await usersRepo.updateControlScheme(userId, schemeInput);
  return toPublicProfile(updated);
}

// --- account deletion -------------------------------------------------------

/** Hard-delete the account. Requires the username as typed confirmation, since
 *  this is irreversible and takes coins, cosmetics and leaderboard place with
 *  it. Cascades remove tokens, sessions and rejection logs — nothing is
 *  retained, exactly as the privacy notice promises. */
export async function deleteAccount(
  row: UserRow,
  confirmUsername: unknown,
): Promise<void> {
  if (
    typeof confirmUsername !== "string" ||
    confirmUsername.trim().toLowerCase() !== row.username_lower
  ) {
    throw new ApiError(
      400,
      "CONFIRMATION_MISMATCH",
      "Type your username exactly to confirm deletion.",
    );
  }

  await withTransaction(async (client) => {
    // Tokens would cascade anyway; deleting them explicitly first means that if
    // anything below fails, the account is already unreachable rather than
    // half-deleted and still usable.
    await tokensRepo.deleteAllTokensForUser(row.id, client);
    await usersRepo.deleteUser(row.id, client);
  });
}

// --- leaderboard ------------------------------------------------------------

export interface LeaderboardResponse {
  top: Array<{ rank: number; username: string; highScore: number }>;
  me: { rank: number; username: string; highScore: number } | null;
}

/** Classic-mode leaderboard. `me` is null for a player who has never posted a
 *  classic score, so the UI can show "play a game to get on the board" rather
 *  than a meaningless last place. */
export async function leaderboard(
  row: UserRow,
  limitInput: unknown,
): Promise<LeaderboardResponse> {
  const parsed = Number(limitInput);
  const limit = Number.isFinite(parsed)
    ? Math.min(Math.max(Math.floor(parsed), 1), 100)
    : 50;

  const entries = await usersRepo.topScores(limit);
  const top = entries.map((entry, idx) => ({
    rank: idx + 1,
    username: entry.username,
    highScore: entry.highScore,
  }));

  let me: LeaderboardResponse["me"] = null;
  if (row.high_score > 0) {
    const existing = top.find((entry) => entry.username === row.username);
    me = existing ?? {
      rank: await usersRepo.rankForScore(row.high_score),
      username: row.username,
      highScore: row.high_score,
    };
  }

  return { top, me };
}
