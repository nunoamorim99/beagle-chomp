// OWNER: gameplay-engineer (IDEA-020 — never lose a finished run)
//
// Submitting a finished run, durably.
//
// THE PROBLEM THIS SOLVES. The original submit was a single fetch with no
// retry: one dropped packet at the moment the beagle lost its last life and the
// score was gone for good, with nothing on screen to say so. That is the worst
// possible moment for a network blip, because it is exactly when a player has
// something they care about — and phones drop connections constantly (leaving
// wifi, a lift, a tunnel, the browser backgrounding the tab).
//
// THE APPROACH:
//
//   1. PERSIST FIRST. The run is written to localStorage synchronously at game
//      over, before the first network attempt — so dying and swiping the app
//      away in the same second (the normal rage-quit) cannot lose it.
//   2. Retry with backoff. Most failures are transient; three quick attempts
//      fix them invisibly, and success removes the persisted entry.
//   3. Whatever is still unsent keeps retrying in the background — on
//      reconnect, on tab re-focus, and at the next app boot.
//   4. Only a considered answer from the server (a validation rejection,
//      "already finished", or a refused request) stops the retrying. Those
//      are decisions, not failures.
//
// WHY RETRYING IS SAFE. The server's replay guard (scoreService.finishSession,
// under a SELECT … FOR UPDATE row lock) accepts a session exactly once and
// answers 409 SESSION_ALREADY_FINISHED to every later attempt. So a retry after
// a request that actually succeeded but lost its RESPONSE cannot double-count —
// it is reported here as "already-finished", which is a success, not an error.
//
// WHAT THIS DELIBERATELY DOES NOT DO: queue *gameplay* offline. The game stays
// online-only (a run can't even start without a server session). This queue
// exists solely so a run that ALREADY happened, and was already validated as
// real by the server issuing its session, isn't lost on the last step.

import { ApiError, getToken } from "./api";
import {
  finishSession,
  type FinishResponse,
  type FinishAccepted,
  type FinishRejected,
  type RunSubmissionPayload,
} from "./endpoints";

/** Where pending runs live. Same naming convention as the token and the old
 *  profile blob. */
const PENDING_KEY = "beagle-chomp:pending-runs";

/** Attempts made while the player is watching the game-over panel. Kept small
 *  and quick — anything longer belongs in the background queue. */
const FOREGROUND_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 700;

/** Cap on stored runs. A player who plays a dozen games on a train should keep
 *  them all; a corrupted or runaway store should not grow without bound. */
const MAX_PENDING = 25;

/** Runs older than this are dropped unsent. The server rejects any session
 *  older than 4 hours (SESSION_TOO_OLD), so keeping them longer would only
 *  produce guaranteed-failing requests forever. */
const MAX_AGE_MS = 4 * 60 * 60 * 1000;

export interface PendingRun {
  sessionId: string;
  payload: RunSubmissionPayload;
  /** When the run finished, so stale entries can be dropped. */
  queuedAt: number;
  /**
   * The token that owns this run, so it is only ever submitted by the account
   * that played it.
   *
   * Without this, signing out and signing in as someone else would post the
   * queued run under the NEW token. The server scopes sessions by user_id and
   * would answer 404 — a non-retryable 4xx — silently binning a real score.
   * Matching first keeps it queued until its owner signs back in.
   */
  token: string;
}

export type SubmitOutcome =
  | { kind: "accepted"; result: FinishAccepted }
  | { kind: "rejected"; result: FinishRejected }
  | { kind: "already-finished" }
  /** Queued on-device; will be retried until the server answers. */
  | { kind: "pending" }
  /** The server refused the request itself (a 4xx). Nothing is queued —
   *  telling the player it was "saved for later" would be a lie. */
  | { kind: "refused" };

// --- the durable store ------------------------------------------------------

function readPending(): PendingRun[] {
  try {
    const raw = window.localStorage.getItem(PENDING_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Defensive: this data outlives releases, so treat it as untrusted.
    return parsed.filter(
      (entry): entry is PendingRun =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as PendingRun).sessionId === "string" &&
        typeof (entry as PendingRun).queuedAt === "number" &&
        typeof (entry as PendingRun).payload === "object" &&
        (entry as PendingRun).payload !== null,
    );
  } catch {
    // Private browsing, quota, or corrupt JSON. A lost queue is bad; a crash
    // on the game-over screen is worse.
    return [];
  }
}

function writePending(runs: PendingRun[]): void {
  try {
    window.localStorage.setItem(PENDING_KEY, JSON.stringify(runs.slice(-MAX_PENDING)));
  } catch {
    /* nothing more we can do — the in-flight retry still has its copy */
  }
}

function enqueue(run: PendingRun): void {
  const runs = readPending();
  // A session id is unique per run, so this also de-duplicates a double call.
  if (runs.some((r) => r.sessionId === run.sessionId)) return;
  runs.push(run);
  writePending(runs);
}

function dequeue(sessionId: string): void {
  writePending(readPending().filter((r) => r.sessionId !== sessionId));
}

/** How many runs are waiting to be sent. Exposed for tests and diagnostics. */
export function pendingRunCount(): number {
  return readPending().length;
}

// --- classifying a failure --------------------------------------------------

/**
 * Should this error be retried?
 *
 * Network errors and 5xx are transient — the request never got a considered
 * answer, so trying again is the right move. A 4xx other than 409 is the
 * server's decision about this exact payload, and repeating it would just
 * produce the same answer.
 */
function isRetryable(err: unknown): boolean {
  if (!(err instanceof ApiError)) return true; // unknown shape: assume transient
  if (err.isNetworkError) return true;
  // 429 is "not now", not "no" — the background flush retries after cooldown.
  if (err.status === 429) return true;
  return err.status >= 500;
}

function isAlreadyFinished(err: unknown): boolean {
  return err instanceof ApiError && err.code === "SESSION_ALREADY_FINISHED";
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// --- one submit attempt chain -----------------------------------------------

/**
 * Submit a finished run, retrying transient failures.
 *
 * PERSISTS BEFORE THE FIRST ATTEMPT — synchronously, so the run is durable on
 * disk the instant the game ends. The obvious order (try first, persist only
 * on failure) has a hole exactly where players live: die, swipe the app away
 * in the same second. The tab dies, the in-flight fetch dies with it, and the
 * not-yet-persisted run is gone. Persist-first means the worst a killed tab
 * can do is leave an entry the next boot's flush will send. On success the
 * entry is removed again; one extra localStorage write per game is free.
 *
 * Never throws: the caller is a game-over screen, and an exception there would
 * replace a disappointing message with a broken one. Anything unresolved stays
 * persisted and is reported as "pending".
 */
export async function submitRunWithRetry(
  sessionId: string,
  payload: RunSubmissionPayload,
): Promise<SubmitOutcome> {
  enqueue({ sessionId, payload, queuedAt: Date.now(), token: getToken() ?? "" });

  for (let attempt = 1; attempt <= FOREGROUND_ATTEMPTS; attempt++) {
    try {
      const result: FinishResponse = await finishSession(sessionId, payload);
      dequeue(sessionId);
      return result.accepted
        ? { kind: "accepted", result }
        : { kind: "rejected", result };
    } catch (err) {
      // The first attempt actually landed; only its response was lost.
      if (isAlreadyFinished(err)) {
        dequeue(sessionId);
        return { kind: "already-finished" };
      }

      if (!isRetryable(err)) {
        // A considered 4xx. Retrying sends the same rejected request again, so
        // drop it — and SAY it was refused. Reporting this as "pending" would
        // promise a delivery that is never coming.
        dequeue(sessionId);
        console.warn("[run] submit refused:", err);
        return { kind: "refused" };
      }

      if (attempt === FOREGROUND_ATTEMPTS) break;
      await sleep(BASE_BACKOFF_MS * attempt); // 700ms, 1400ms
    }
  }

  // Out of foreground attempts. Already persisted; the background flush owns
  // it from here — on reconnect, on tab re-focus, and at the next boot.
  scheduleFlush();
  return { kind: "pending" };
}

// --- the background flush ---------------------------------------------------

let flushing = false;

/**
 * Try to send everything still queued.
 *
 * Safe to call at any time: it self-serialises, drops entries too old for the
 * server to accept, and removes each run the moment it gets a definitive answer
 * (accepted, rejected, or already-finished — all three mean "stop asking").
 */
export async function flushPendingRuns(): Promise<void> {
  if (flushing) return;
  flushing = true;

  try {
    const currentToken = getToken() ?? "";

    for (const run of readPending()) {
      if (Date.now() - run.queuedAt > MAX_AGE_MS) {
        // The server would answer SESSION_TOO_OLD; don't waste the request.
        console.warn("[run] dropping a run too old to submit:", run.sessionId);
        dequeue(run.sessionId);
        continue;
      }

      // Someone else is signed in (or nobody is). Leave it for its owner —
      // sending it now would 404 and bin a real score. It still expires via
      // MAX_AGE_MS, so this can't wedge the queue forever.
      if (!currentToken || run.token !== currentToken) continue;

      try {
        await finishSession(run.sessionId, run.payload);
        dequeue(run.sessionId);
      } catch (err) {
        if (isAlreadyFinished(err) || !isRetryable(err)) {
          dequeue(run.sessionId);
          continue;
        }
        // Still offline. Leave it queued and stop — the next trigger retries.
        return;
      }
    }
  } finally {
    flushing = false;
  }
}

let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** Retry shortly, without blocking the caller. */
function scheduleFlush(delayMs = 5_000): void {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushPendingRuns();
  }, delayMs);
}

/**
 * Wire the automatic triggers. Called once from the boot flow.
 *
 * `online` is the important one: it fires the moment connectivity returns,
 * which is usually long before the player thinks to reopen the game.
 */
let queueInitialised = false;

export function initRunSubmitQueue(): void {
  if (typeof window === "undefined") return;

  // startApp() re-runs on sign-out and on a mid-session 401, so guard against
  // stacking a duplicate listener set each time.
  if (queueInitialised) {
    if (pendingRunCount() > 0) scheduleFlush(1_500);
    return;
  }
  queueInitialised = true;

  window.addEventListener("online", () => void flushPendingRuns());

  // Coming back to a backgrounded tab is the other common moment for a
  // connection to have quietly returned.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") scheduleFlush(500);
  });

  // And once at boot, for runs stranded by a closed tab.
  if (pendingRunCount() > 0) scheduleFlush(1_500);
}
