// OWNER: backend
//
// Reading and judging an announcement off the wire.
//
// PURE — no database, no clock — and for the same reason validation/wire.ts is:
// the service layer imports db.ts, which opens a Postgres pool the moment it is
// imported, so anything living there is unreachable from `npm test`. That is
// exactly how a field went unread for a whole release (IDEA-040 v3).
//
// What this file is really guarding is the RENDERER. An announcement body is
// the first server-controlled, free-form string this project has ever sent to
// the game — every other one (usernames, skin ids) is constrained to a tight
// character class. The client renders it with createElement + textContent, so
// markup is shown rather than interpreted; these limits are the second layer,
// not the only one.

export type AnnouncementKind = "release" | "notice";

export const MAX_TITLE = 120;
export const MAX_BODY = 4000;
export const MAX_VERSION = 20;

export interface AnnouncementInput {
  kind: AnnouncementKind;
  version: string | null;
  title: string;
  body: string;
}

export type AnnouncementProblem =
  | "KIND_INVALID"
  | "TITLE_EMPTY"
  | "TITLE_TOO_LONG"
  | "BODY_EMPTY"
  | "BODY_TOO_LONG"
  | "VERSION_TOO_LONG"
  | "VERSION_REQUIRED";

export type ParseResult =
  | { ok: true; value: AnnouncementInput }
  | { ok: false; problem: AnnouncementProblem };

/**
 * Strip control characters, normalise newlines, collapse runs of blank lines.
 *
 * NOT a sanitiser and not pretending to be one — `<script>` passes through here
 * untouched, because the renderer's job is to show it as text, not this one's to
 * guess at markup. What it removes is the stuff that has no visible meaning and
 * only causes trouble: CR (so a Windows paste does not double-space every line),
 * NUL and other C0 controls (Postgres rejects NUL in text outright, with an
 * error that reads like a driver bug), and stacks of blank lines that would
 * render as a wall of whitespace.
 */
export function normaliseText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    // Keep \n and \t; drop the rest of C0 and DEL.
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Shape and judge a create/update body.
 *
 * Returns a PROBLEM rather than throwing, so the route can map it to a message
 * and the tests can assert every branch without constructing an error.
 */
export function parseAnnouncement(body: Record<string, unknown>): ParseResult {
  const kind = asString(body.kind);
  if (kind !== "release" && kind !== "notice") return { ok: false, problem: "KIND_INVALID" };

  const title = normaliseText(asString(body.title));
  if (title.length === 0) return { ok: false, problem: "TITLE_EMPTY" };
  if (title.length > MAX_TITLE) return { ok: false, problem: "TITLE_TOO_LONG" };

  const text = normaliseText(asString(body.body));
  if (text.length === 0) return { ok: false, problem: "BODY_EMPTY" };
  if (text.length > MAX_BODY) return { ok: false, problem: "BODY_TOO_LONG" };

  // A title is one line by definition; a pasted multi-line heading is a
  // mistake worth flattening rather than refusing.
  const flatTitle = title.replace(/\s*\n\s*/g, " ");

  const rawVersion = normaliseText(asString(body.version));
  if (rawVersion.length > MAX_VERSION) return { ok: false, problem: "VERSION_TOO_LONG" };
  // A release note with no version is almost certainly a mis-set kind, and it
  // would render a card headed by nothing. A notice with a version is fine to
  // ignore — it just has none.
  if (kind === "release" && rawVersion.length === 0) {
    return { ok: false, problem: "VERSION_REQUIRED" };
  }

  return {
    ok: true,
    value: {
      kind,
      version: kind === "release" ? rawVersion : null,
      title: flatTitle,
      body: text,
    },
  };
}

/** A human message per problem, for the portal's composer. */
export const PROBLEM_MESSAGE: Record<AnnouncementProblem, string> = {
  KIND_INVALID: "Pick either a release note or a notice.",
  TITLE_EMPTY: "A title is required.",
  TITLE_TOO_LONG: `Titles are at most ${MAX_TITLE} characters.`,
  BODY_EMPTY: "The note needs something in it.",
  BODY_TOO_LONG: `Notes are at most ${MAX_BODY} characters.`,
  VERSION_TOO_LONG: `Versions are at most ${MAX_VERSION} characters.`,
  VERSION_REQUIRED: "A release note needs a version, like v8.0.",
};
