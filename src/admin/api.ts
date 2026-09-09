// OWNER: backend / tooling (IDEA-051)
//
// The portal's API client.
//
// Deliberately NOT a copy of src/net/api.ts. That module carries the game's
// concerns — a persisted run queue, optimistic profile sync, an auth gate that
// re-opens on 401 — none of which mean anything here. What it shares is the
// SHAPE: bearer token in the Authorization header, JSON in and out, an
// {error:{code,message}} envelope, and a hard timeout so a hung request cannot
// leave a panel spinning forever.
//
// The token lives under its own localStorage key. If the portal and the game
// are ever opened on the same origin (they are not, and should not be), the
// keys still cannot collide.

const TOKEN_KEY = "beagle-chomp-admin:token";

function readApiUrl(): string {
  try {
    const url = import.meta.env?.VITE_API_URL as string | undefined;
    return url ?? "";
  } catch {
    return "";
  }
}

export const API_URL = readApiUrl();

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    // A browser with site data blocked. The portal still works for the session;
    // it just cannot remember the login.
    return null;
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* see getToken */
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* see getToken */
  }
}

export class AdminApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
}

const TIMEOUT_MS = 20_000;

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  if (!API_URL) {
    throw new AdminApiError(
      "NOT_CONFIGURED",
      0,
      "VITE_API_URL is not set — this build cannot reach the API.",
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.auth !== false) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      credentials: "omit",
      signal: controller.signal,
    });
  } catch {
    throw new AdminApiError("NETWORK_ERROR", 0, "Couldn't reach the API.");
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const parsed: unknown = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const body = parsed as { error?: { code?: string; message?: string } } | null;
    // A 404 from an /admin/* path is almost never a typo — it is requireAdmin
    // refusing an account that is not flagged, deliberately indistinguishable
    // from a path that does not exist. Say so, because the alternative is an
    // operator staring at "Not found" wondering if they mistyped a URL.
    if (res.status === 404 && path.startsWith("/api/v1/admin")) {
      throw new AdminApiError(
        "NOT_ADMIN",
        404,
        "This account isn't an admin. Grant it with the UPDATE in migrations/007_admin.sql.",
      );
    }
    throw new AdminApiError(
      body?.error?.code ?? "UNKNOWN",
      res.status,
      body?.error?.message ?? `Request failed (${res.status}).`,
    );
  }

  return parsed as T;
}

// --- auth -------------------------------------------------------------------

interface LoginResponse {
  token: string;
  user: { id: string; username: string; createdAt: string };
}

export async function login(username: string, password: string): Promise<string> {
  const res = await request<LoginResponse>("/api/v1/auth/login", {
    method: "POST",
    body: { username, password },
    auth: false,
  });
  setToken(res.token);
  return res.user.username;
}

/**
 * Who is this token? Called once on boot when a stored token is found.
 *
 * Needed because the username is only known as a side effect of logging IN, and
 * a reload skips that — the header rendered "metrics ·" with nothing after it
 * on every refresh. It doubles as the liveness check on a stored token: if it
 * has expired or been revoked this 401s and the app drops to the login form,
 * instead of painting a shell whose panels then all fail one by one.
 */
export async function me(): Promise<string> {
  const res = await request<{ user: { username: string } }>("/api/v1/auth/me");
  return res.user.username;
}

export async function logout(): Promise<void> {
  try {
    await request<void>("/api/v1/auth/logout", { method: "POST" });
  } catch {
    // Revoking server-side is a courtesy; dropping the local token is the part
    // that matters and must happen either way.
  }
  clearToken();
}

// --- dashboard --------------------------------------------------------------

export interface Overview {
  totals: {
    players_today: number;
    players_7d: number;
    players_30d: number;
    total_players: number;
    signups_7d: number;
    runs_7d: number;
    play_hours_7d: number;
  };
  activity: { day: string; players: number; runs: number; playSeconds: number }[];
}

export interface CohortCell {
  dayOffset: number;
  returned: number;
  rate: number;
  /** false = this cohort has not lived long enough for this offset. Never 0%. */
  reached: boolean;
}
export interface Retention {
  matrix: { cohortDay: string; cohortSize: number; cells: CohortCell[] }[];
  headline: Record<string, number | null>;
}

export interface ChallengeStanding {
  challengeIdx: number;
  attempts: number;
  clears: number;
  clearRate: number | null;
  playersAttempted: number;
  playersCleared: number;
  attemptsPerClear: number | null;
  medianClearSeconds: number | null;
  avgDeaths: number | null;
}
export interface Challenges {
  standings: ChallengeStanding[];
  ranked: ChallengeStanding[];
  insufficient: ChallengeStanding[];
  depth: { levels_played: number; runs: number }[];
}

export interface SlotTally {
  slot: number;
  label: string;
  count: number;
  share: number;
}
export interface Gameplay {
  enemies: SlotTally[];
  fruits: SlotTally[];
  nemesis: SlotTally | null;
  favouriteFruit: SlotTally | null;
}

export interface Share {
  value: string;
  runs: number;
  players: number;
  share: number;
}
export interface Content {
  beagleSkins: Share[];
  enemySkins: Share[];
  mazeThemes: Share[];
  controlSchemes: Share[];
}

export interface RouteStat {
  route: string;
  count: number;
  p50: number;
  p95: number;
  maxMs: number;
  status2xx: number;
  status4xx: number;
  status5xx: number;
}
export interface Health {
  version: string;
  uptimeSeconds: number;
  requests: { lifetimeRequests: number; lifetimeSlowRequests: number; routes: RouteStat[] };
  rejections: {
    reasons: { reason_code: string; count: number; players: number; last_seen: string }[];
    byDay: { day: string; accepted: number; rejected: number }[];
    totalAccepted: number;
    totalRejected: number;
    rejectionRate: number | null;
    alarming: boolean;
  };
}

export interface PlayerSummary {
  username: string;
  created_at: string;
  high_score: number;
  runs: number;
  last_played: string | null;
}

export interface Rewind {
  username: string;
  since: string;
  joined: string;
  highScore: number;
  coins: number;
  challengeProgress: number;
  runs: number;
  daysPlayed: number;
  playSeconds: number;
  longestRunSeconds: number;
  pelletsEaten: number;
  fruitEaten: number;
  coinsCollected: number;
  ghostsEaten: number;
  livesLost: number;
  levelsCleared: number;
  enemies: SlotTally[];
  fruits: SlotTally[];
  nemesis: SlotTally | null;
  favouriteFruit: SlotTally | null;
  favouriteTheme: string | null;
  favouriteBeagleSkin: string | null;
}

export const fetchOverview = (days = 30): Promise<Overview> =>
  request(`/api/v1/admin/overview?days=${days}`);
export const fetchRetention = (): Promise<Retention> => request("/api/v1/admin/retention");
export const fetchChallenges = (): Promise<Challenges> => request("/api/v1/admin/challenges");
export const fetchGameplay = (): Promise<Gameplay> => request("/api/v1/admin/gameplay");
export const fetchContent = (): Promise<Content> => request("/api/v1/admin/content");
export const fetchHealth = (): Promise<Health> => request("/api/v1/admin/health");
export const fetchPlayers = (q: string): Promise<{ players: PlayerSummary[] }> =>
  request(`/api/v1/admin/players${q ? `?q=${encodeURIComponent(q)}` : ""}`);
export const fetchRewind = (username: string): Promise<Rewind> =>
  request(`/api/v1/admin/players/${encodeURIComponent(username)}/rewind`);

// --- announcements (IDEA-052) -----------------------------------------------

export interface AdminAnnouncement {
  id: string;
  kind: "release" | "notice";
  version: string | null;
  title: string;
  body: string;
  publishedAt: string | null;
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AnnouncementDraft {
  kind: "release" | "notice";
  version: string | null;
  title: string;
  body: string;
}

export const listAnnouncements = (): Promise<{ items: AdminAnnouncement[] }> =>
  request("/api/v1/admin/announcements");

export const createAnnouncement = (
  draft: AnnouncementDraft,
): Promise<{ announcement: AdminAnnouncement }> =>
  request("/api/v1/admin/announcements", { method: "POST", body: draft });

export const updateAnnouncement = (
  id: string,
  draft: AnnouncementDraft,
): Promise<{ announcement: AdminAnnouncement }> =>
  request(`/api/v1/admin/announcements/${id}`, { method: "PATCH", body: draft });

/** Go live, or pull it back to draft. Separate from saving on purpose — the
 *  composer's Save must never be one mis-click from every player's screen. */
export const publishAnnouncement = (
  id: string,
  published: boolean,
): Promise<{ announcement: AdminAnnouncement }> =>
  request(`/api/v1/admin/announcements/${id}/publish`, {
    method: "POST",
    body: { published },
  });

export const deleteAnnouncement = (id: string): Promise<void> =>
  request(`/api/v1/admin/announcements/${id}`, { method: "DELETE" });

/** Mirrors the server's limits (validation/announcement.ts) so the composer can
 *  show a live counter instead of discovering them on submit. The SERVER is
 *  still the authority — these are for the operator's benefit, not a check. */
export const LIMITS = { title: 120, body: 4000, version: 20 } as const;
