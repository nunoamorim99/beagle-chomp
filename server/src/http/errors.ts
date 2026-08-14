// OWNER: backend
//
// The single JSON error shape for the whole API.
//
// STACK.md §2.1: "JSON only. No endpoint returns HTML. Every response is JSON,
// including errors." That includes 404s, 500s, and anything Hono itself would
// otherwise render as text — see the app-level handlers in src/index.ts.
//
// Envelope: { "error": { "code": "...", "message": "..." } }
//   - `code`    machine-readable, drives client branching. Stable: treat these
//               as API surface, don't rename one without a reason.
//   - `message` human-readable, safe to show the player verbatim.

import type { ContentfulStatusCode } from "hono/utils/http-status";

/** Every error code the API can return. Kept as one union so the client can
 *  exhaustively switch on it and so renaming one is a compile error here. */
export type ApiErrorCode =
  // generic
  | "VALIDATION_FAILED"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR"
  // auth (Increment 1)
  | "UNAUTHORIZED"
  | "INVALID_CREDENTIALS"
  | "INVALID_RECOVERY_CODE"
  | "USERNAME_TAKEN"
  | "CONFIRMATION_MISMATCH"
  // profile (Increment 1)
  | "ALREADY_OWNED"
  | "INSUFFICIENT_COINS"
  | "UNKNOWN_ITEM"
  | "NOT_OWNED"
  // sessions (Increment 2)
  | "SESSION_ALREADY_FINISHED"
  | "TOO_MANY_OPEN_SESSIONS"
  | "LEVEL_LOCKED";

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
  };
}

/** Throw this from anywhere in a request; the app-level onError turns it into
 *  the JSON envelope with the right status. */
export class ApiError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: ApiErrorCode;
  /** Extra context for the server log only — never sent to the client. */
  readonly detail?: unknown;

  constructor(
    status: ContentfulStatusCode,
    code: ApiErrorCode,
    message: string,
    detail?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.detail = detail;
  }

  toBody(): ApiErrorBody {
    return { error: { code: this.code, message: this.message } };
  }
}

export const badRequest = (message: string, detail?: unknown) =>
  new ApiError(400, "VALIDATION_FAILED", message, detail);

export const unauthorized = (message = "Sign in to continue.") =>
  new ApiError(401, "UNAUTHORIZED", message);

export const notFound = (message = "Not found.") =>
  new ApiError(404, "NOT_FOUND", message);

export const rateLimited = (
  message = "Too many attempts. Please wait a moment and try again.",
) => new ApiError(429, "RATE_LIMITED", message);
