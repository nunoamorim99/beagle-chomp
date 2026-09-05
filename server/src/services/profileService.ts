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
import * as sessionsRepo from "../repo/gameSessions.js";
import { boardCacheGet, boardCacheSet, invalidateBoardCache } from "./boardCache.js";
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

/** IDEA-038/049: the player's control scheme ('swipe' | 'dpad' | 'stick').
 *
 *  Stored per ACCOUNT rather than per device: someone who prefers buttons — or
 *  the thumbstick — prefers them on every phone they sign in from.
 *
 *  CONTROL_SCHEMES has to stay in step with the CHECK constraint on
 *  users.control_scheme (migrations 002, then 005 for 'stick'). Failing here
 *  rather than at the database is deliberate: a scheme the column rejects comes
 *  back as a 500 with a constraint name in it, where this is a 400 that says
 *  what was wrong. */
const CONTROL_SCHEMES = ["swipe", "dpad", "stick"] as const;
type ControlScheme = (typeof CONTROL_SCHEMES)[number];

export async function setControlScheme(
  userId: string,
  schemeInput: unknown,
): Promise<PublicProfile> {
  if (!CONTROL_SCHEMES.includes(schemeInput as ControlScheme)) {
    throw new ApiError(400, "VALIDATION_FAILED", "Unknown control scheme.");
  }
  const updated = await usersRepo.updateControlScheme(userId, schemeInput as ControlScheme);
  return toPublicProfile(updated);
}

/** IDEA-040: mark the first-run tutorial finished (or replay it from the
 *  account screen by setting it back to false). */
export async function setTutorialDone(
  userId: string,
  doneInput: unknown,
): Promise<PublicProfile> {
  if (typeof doneInput !== "boolean") {
    throw new ApiError(400, "VALIDATION_FAILED", "tutorialDone must be true or false.");
  }
  const updated = await usersRepo.updateTutorialDone(userId, doneInput);
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

  // "Hard delete" is a privacy promise — the account must vanish from the
  // boards NOW, not up to 15 seconds later when the cache expires.
  invalidateBoardCache();
}

// --- leaderboard ------------------------------------------------------------

export interface LeaderboardResponse {
  top: Array<{ rank: number; username: string; highScore: number; isMe: boolean }>;
  me: { rank: number; username: string; highScore: number; isMe: true } | null;
  /** How many players are ranked in total, so the client can decide whether a
   *  "show all" affordance has anything left to reveal. */
  total: number;
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

  // The cache holds RAW repo rows only — everything player-specific (isMe,
  // me) is derived below, per request, so one cached board serves every
  // viewer without ever leaking one player's highlight to another.
  type PlayersBoardData = { entries: usersRepo.LeaderboardEntry[]; total: number };
  let data = boardCacheGet<PlayersBoardData>("players", limit);
  if (!data) {
    const [entries, total] = await Promise.all([
      usersRepo.topScores(limit),
      usersRepo.rankedPlayerCount(),
    ]);
    data = { entries, total };
    boardCacheSet("players", limit, data);
  }
  const { entries, total } = data;

  // Identify the player's own row by ID, not by username. Matching on the
  // display string worked only by accident of usernames being unique, and it
  // compared the one field on this screen that is untrusted player input.
  const top = entries.map((entry, idx) => ({
    rank: idx + 1,
    username: entry.username,
    highScore: entry.highScore,
    isMe: entry.id === row.id,
  }));

  let me: LeaderboardResponse["me"] = null;
  if (row.high_score > 0) {
    const existing = top.find((entry) => entry.isMe);
    me = {
      rank: existing?.rank ?? (await usersRepo.rankForScore(row.high_score)),
      username: row.username,
      highScore: row.high_score,
      isMe: true,
    };
  }

  return { top, me, total };
}

// --- all-attempts board -----------------------------------------------------

export interface RunBoardEntry {
  rank: number;
  username: string;
  score: number;
  finishedAt: string;
  isMe: boolean;
}

export interface RunBoardResponse {
  runs: RunBoardEntry[];
  /** Total accepted classic runs, so the client knows if "show all" reveals
   *  anything beyond the page it already has. */
  total: number;
  /** The player's own best single run, even when it falls outside the page. */
  myBest: RunBoardEntry | null;
}

/**
 * Every accepted classic RUN, best first — one row per attempt.
 *
 * The same player can hold several rows, podium included: these are runs, not
 * people. That is the whole difference from `leaderboard()` above, which folds
 * each player down to their single personal best.
 */
export async function runBoard(
  row: UserRow,
  limitInput: unknown,
): Promise<RunBoardResponse> {
  const parsed = Number(limitInput);
  const limit = Number.isFinite(parsed)
    ? Math.min(Math.max(Math.floor(parsed), 1), 200)
    : 50;

  // Same shape as the players board: raw rows cached, isMe/myBest derived
  // per request.
  type RunsBoardData = { entries: sessionsRepo.RunEntry[]; total: number };
  let data = boardCacheGet<RunsBoardData>("runs", limit);
  if (!data) {
    const [entries, total] = await Promise.all([
      sessionsRepo.topRuns(limit),
      sessionsRepo.acceptedRunCount(),
    ]);
    data = { entries, total };
    boardCacheSet("runs", limit, data);
  }
  const { entries, total } = data;

  const runs = entries.map((entry, idx) => ({
    rank: idx + 1,
    username: entry.username,
    score: entry.score,
    finishedAt: entry.finishedAt.toISOString(),
    isMe: entry.userId === row.id,
  }));

  // The player's best run may sit outside the page, so the UI can still show
  // where they stand without loading the whole board.
  const myBest = runs.find((entry) => entry.isMe) ?? null;

  return { runs, total, myBest };
}
