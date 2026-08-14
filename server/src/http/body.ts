// OWNER: backend
//
// JSON body parsing, shared by every route that takes one.

import type { Context } from "hono";
import { ApiError, badRequest } from "./errors.js";

/** Parse a JSON object body.
 *
 *  Turns malformed JSON into a clean 400 rather than letting a SyntaxError
 *  reach the global handler as a 500 — a client sending bad JSON is a client
 *  error, not a server fault.
 *
 *  An empty body is treated as `{}` so endpoints whose fields are all optional
 *  (e.g. DELETE with a confirmation field) don't require one. */
export async function readBody(c: Context): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = await c.req.json();
  } catch {
    throw badRequest("Invalid JSON body.");
  }

  if (parsed === undefined || parsed === null) return {};

  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw badRequest("Expected a JSON object.");
  }

  return parsed as Record<string, unknown>;
}

/** Re-exported so route modules can throw the shared error type without also
 *  importing errors.js directly. */
export { ApiError };
