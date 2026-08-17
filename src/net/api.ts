// OWNER: gameplay-engineer (IDEA-019 accounts)
//
// The ONLY place the app talks to the network. Everything else calls the
// helpers here, so there is exactly one file that knows about the API base
// URL, the bearer token, and the error envelope.
//
// three-free and DOM-light so it can be imported from src/game/* without
// dragging the render layer along (CLAUDE.md's layer rule).

/** The API base, injected at build time. Cloudflare Pages sets this to
 *  https://beaglechomp-api.nunoamorim.dev; docker-compose sets localhost:3001.
 *
 *  Read through a guard because `import.meta.env` is a Vite transform: it does
 *  not exist under plain Node, where the headless test scripts import this
 *  module transitively (via profileStore). Without the guard those tests crash
 *  at import time on a property of `undefined`.
 *
 *  Deliberately NO default value: a missing URL must fail loudly at boot
 *  (assertApiConfigured) rather than silently resolving relative URLs against
 *  the Pages origin, which would produce confusing 404s that look like server
 *  errors. */
function readApiUrl(): string {
  try {
    return import.meta.env?.VITE_API_URL ?? "";
  } catch {
    return "";
  }
}

const API_URL: string = readApiUrl();

/** localStorage key for the bearer token. Mirrors the naming of the profile
 *  blob and ui/sound.ts's mute flag.
 *
 *  Yes, localStorage is XSS-reachable. Cookies are ruled out by STACK.md §2.2
 *  (bearer tokens, so the same API can serve a native app later), and the real
 *  defence is that a username cannot contain markup — see the username regex in
 *  the server's authService. */
const TOKEN_KEY = "beagle-chomp:token";

/** Error codes the API can return. Kept in step with the server's
 *  ApiErrorCode union in server/src/http/errors.ts. */
export type ApiErrorCode =
  | "VALIDATION_FAILED"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR"
  | "UNAUTHORIZED"
  | "INVALID_CREDENTIALS"
  | "INVALID_RECOVERY_CODE"
  | "USERNAME_TAKEN"
  | "CONFIRMATION_MISMATCH"
  | "ALREADY_OWNED"
  | "INSUFFICIENT_COINS"
  | "UNKNOWN_ITEM"
  | "NOT_OWNED"
  | "SESSION_ALREADY_FINISHED"
  | "TOO_MANY_OPEN_SESSIONS"
  | "LEVEL_LOCKED"
  /** Client-side only: the request never reached the server. */
  | "NETWORK_ERROR";

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;

  constructor(code: ApiErrorCode, message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }

  /** True when the request never got an answer — offline, DNS failure, the
   *  server being down. Distinct from a 4xx, which IS an answer. The UI shows
   *  "can't reach the server, retry" for these and the message itself for
   *  everything else. */
  get isNetworkError(): boolean {
    return this.code === "NETWORK_ERROR";
  }
}

// --- token storage ----------------------------------------------------------

export function getToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    // Private browsing / disabled storage: the session simply won't survive a
    // reload. Degrading like this matches profileStore.ts's long-standing
    // "never throw on storage" convention.
    return null;
  }
}

export function setToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* in-memory for this session only */
  }
}

export function clearToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* nothing to do */
  }
}

// --- unauthorized handling --------------------------------------------------

type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler | null = null;

/** Registered once by the boot flow. Fires when the server rejects our token
 *  (revoked, expired, or the account was deleted on another device), so the app
 *  can drop back to the auth gate instead of retrying forever. */
export function setUnauthorizedHandler(handler: UnauthorizedHandler): void {
  onUnauthorized = handler;
}

// --- the request helper -----------------------------------------------------

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** Set false for signup/login/recover, which have no token yet. */
  auth?: boolean;
  /** Abort after this long. Keeps a hung connection from freezing the UI. */
  timeoutMs?: number;
  /** Let the request outlive its page (fetch keepalive). Used by the run
   *  submit, so closing the tab at game over doesn't kill the score on its
   *  way out. Best-effort: browsers without it just ignore the flag, and the
   *  persisted run queue is the real guarantee. */
  keepalive?: boolean;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export function assertApiConfigured(): void {
  if (!API_URL) {
    throw new Error(
      "VITE_API_URL is not set. The game cannot reach its server. " +
        "Set it in .env for local dev, or in the Cloudflare Pages build settings.",
    );
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  assertApiConfigured();

  const {
    method = "GET",
    body,
    auth = true,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    keepalive = false,
  } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";

  if (auth) {
    const token = getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      keepalive,
      // Bearer tokens, not cookies — no credentials to include.
      credentials: "omit",
    });
  } catch (err) {
    // fetch rejects only for network-level failures; any HTTP status is a
    // resolved promise. So this branch is genuinely "couldn't reach the API".
    const aborted = err instanceof DOMException && err.name === "AbortError";
    throw new ApiError(
      "NETWORK_ERROR",
      aborted
        ? "The server took too long to respond."
        : "Can't reach the server. Check your connection.",
      0,
    );
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 204) return undefined as T;

  let payload: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      // The API is JSON-only (STACK.md §2.1), so non-JSON means something
      // between us and it (a proxy, an error page) answered instead.
      throw new ApiError(
        "INTERNAL_ERROR",
        "The server sent an unexpected response.",
        response.status,
      );
    }
  }

  if (!response.ok) {
    const envelope = payload as
      | { error?: { code?: string; message?: string } }
      | null;
    const code = (envelope?.error?.code ?? "INTERNAL_ERROR") as ApiErrorCode;
    const message = envelope?.error?.message ?? "Something went wrong.";

    // A rejected token means this session is over — drop it and let the app
    // send the player back to the auth gate.
    if (response.status === 401 && auth) {
      clearToken();
      onUnauthorized?.();
    }

    throw new ApiError(code, message, response.status);
  }

  return payload as T;
}
