// OWNER: gameplay-engineer (IDEA-019 accounts, IDEA-020 leaderboard)
//
// Typed wrappers for every API endpoint. Shapes mirror the server's
// repo/types.ts — if one side changes, this is the file to change with it.

import { apiRequest } from "./api.js";

export interface ServerProfile {
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
  /** IDEA-038: "swipe" (default) or "dpad". */
  controlScheme: string;
}

export interface ServerUser {
  id: string;
  username: string;
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  expiresAt: string;
  user: ServerUser;
  profile: ServerProfile;
  /** Present ONLY on signup and recovery. The plaintext is shown once and can
   *  never be retrieved again — the client MUST display it on the blocking
   *  recovery screen before doing anything else. */
  recoveryCode?: string;
}

// --- auth -------------------------------------------------------------------

export function signup(username: string, password: string): Promise<AuthResponse> {
  return apiRequest<AuthResponse>("/api/v1/auth/signup", {
    method: "POST",
    body: { username, password },
    auth: false,
  });
}

export function login(username: string, password: string): Promise<AuthResponse> {
  return apiRequest<AuthResponse>("/api/v1/auth/login", {
    method: "POST",
    body: { username, password },
    auth: false,
  });
}

/** Consume a recovery code. Omit `newPassword` to sign in on a new device;
 *  supply it to also reset a forgotten password (which signs out every other
 *  device). Either way the response carries a NEW single-use code. */
export function recover(
  username: string,
  recoveryCode: string,
  newPassword?: string,
): Promise<AuthResponse> {
  return apiRequest<AuthResponse>("/api/v1/auth/recover", {
    method: "POST",
    body: {
      username,
      recoveryCode,
      ...(newPassword ? { newPassword } : {}),
    },
    auth: false,
  });
}

export function logout(): Promise<void> {
  return apiRequest<void>("/api/v1/auth/logout", { method: "POST" });
}

export function me(): Promise<{ user: ServerUser; profile: ServerProfile }> {
  return apiRequest<{ user: ServerUser; profile: ServerProfile }>("/api/v1/auth/me");
}

// --- profile ----------------------------------------------------------------

export function fetchProfile(): Promise<{ profile: ServerProfile }> {
  return apiRequest<{ profile: ServerProfile }>("/api/v1/profile");
}

export interface EquipPayload {
  beagleSkinId?: string;
  enemySkinId?: string;
  mazeThemeId?: string;
}

export function equipRemote(payload: EquipPayload): Promise<{ profile: ServerProfile }> {
  return apiRequest<{ profile: ServerProfile }>("/api/v1/profile/equipped", {
    method: "PATCH",
    body: payload,
  });
}

export type PurchaseKind = "beagle" | "enemy" | "theme";

/** Note what is NOT sent: a price. The server charges from its own catalog. */
export function purchaseRemote(
  kind: PurchaseKind,
  id: string,
): Promise<{ profile: ServerProfile }> {
  return apiRequest<{ profile: ServerProfile }>("/api/v1/profile/purchase", {
    method: "POST",
    body: { kind, id },
  });
}

/** IDEA-038: persist the control-scheme preference against the account, so it
 *  follows the player to any device. */
export function setControlSchemeRemote(
  controlScheme: "swipe" | "dpad",
): Promise<{ profile: ServerProfile }> {
  return apiRequest<{ profile: ServerProfile }>("/api/v1/profile/settings", {
    method: "PATCH",
    body: { controlScheme },
  });
}

export function deleteAccount(confirmUsername: string): Promise<void> {
  return apiRequest<void>("/api/v1/profile", {
    method: "DELETE",
    body: { confirmUsername },
  });
}

// --- leaderboard ------------------------------------------------------------

export interface LeaderboardEntry {
  rank: number;
  username: string;
  highScore: number;
  /** Server-decided, by user id — never by comparing usernames on the client. */
  isMe: boolean;
}

export interface LeaderboardResponse {
  top: LeaderboardEntry[];
  /** null when the player has never posted a classic score. */
  me: LeaderboardEntry | null;
  /** Total ranked players, so the UI knows if "show all" reveals anything. */
  total: number;
}

/** Classic mode only — challenge runs are deliberately unranked. */
export function fetchLeaderboard(limit = 50): Promise<LeaderboardResponse> {
  return apiRequest<LeaderboardResponse>(`/api/v1/leaderboard?limit=${limit}`);
}

/** One row per RUN rather than per player, so the same player can appear
 *  several times — including holding more than one podium place. */
export interface RunBoardEntry {
  rank: number;
  username: string;
  score: number;
  /** ISO timestamp of when the run ended. */
  finishedAt: string;
  isMe: boolean;
}

export interface RunBoardResponse {
  runs: RunBoardEntry[];
  total: number;
  myBest: RunBoardEntry | null;
}

export function fetchRunBoard(limit = 50): Promise<RunBoardResponse> {
  return apiRequest<RunBoardResponse>(`/api/v1/leaderboard/runs?limit=${limit}`);
}

// --- game sessions (Increment 2) --------------------------------------------

export interface StartSessionResponse {
  sessionId: string;
  /** The server's own clock at issue time. Display only — never compare the
   *  local clock against it for anything load-bearing. */
  serverTime: string;
}

export function startSession(
  mode: "classic" | "challenge",
  challengeIdx?: number,
): Promise<StartSessionResponse> {
  return apiRequest<StartSessionResponse>("/api/v1/sessions/start", {
    method: "POST",
    body: mode === "challenge" ? { mode, challengeIdx } : { mode },
  });
}

export interface RunSubmissionPayload {
  score: number;
  levelsCleared: number;
  mazeIdxSequence: number[];
  pelletsEaten: number;
  bonesEaten: number;
  fruitEaten: number;
  ghostsEaten: number;
  coinsCollected: number;
  livesLost: number;
  playSeconds: number;
}

export interface FinishAccepted {
  accepted: true;
  score: number;
  /** Always false for challenge runs — they're deliberately unranked. */
  isNewHighScore: boolean;
  highScore: number;
  coinsAwarded: number;
  profile: ServerProfile;
}

export interface FinishRejected {
  accepted: false;
  reasonCode: string;
  message: string;
  profile: ServerProfile;
}

export type FinishResponse = FinishAccepted | FinishRejected;

/** Submit a finished run. A rejection comes back as HTTP 200 with
 *  `accepted: false` — an implausible score is a normal outcome, not an error,
 *  so this resolves rather than throwing. */
export function finishSession(
  sessionId: string,
  payload: RunSubmissionPayload,
): Promise<FinishResponse> {
  return apiRequest<FinishResponse>(
    `/api/v1/sessions/${encodeURIComponent(sessionId)}/finish`,
    // keepalive: if the player closes the tab the moment they die, the
    // browser is allowed to finish sending this anyway. The persisted run
    // queue (net/runSubmit.ts) is the guarantee; this is the fast path.
    { method: "POST", body: payload, keepalive: true },
  );
}
