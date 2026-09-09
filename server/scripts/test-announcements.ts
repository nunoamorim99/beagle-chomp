// OWNER: qa-test-engineer (IDEA-052)
//
// The announcement parser. DB-FREE — `validation/announcement.ts` imports
// nothing, for the same reason `validation/wire.ts` doesn't: the service layer
// pulls in db.ts, which opens a Postgres pool on import, and anything behind
// that is out of `npm test`'s reach.
//
// The thing to be clear about while reading this suite: NONE OF IT IS THE XSS
// DEFENCE. A body containing `<script>` is stored verbatim and must be — the
// client renders announcements with createElement + textContent (the pattern
// leaderboard.ts uses for usernames), so markup arrives as visible characters
// rather than as markup. Escaping here as well would double-escape and show
// `&lt;script&gt;` to the player. What this file guards is the OTHER failure:
// input that cannot be stored (NUL), input that renders as a mess (CR, walls of
// blank lines), and input that is internally contradictory (a release note with
// no version).

import {
  parseAnnouncement,
  normaliseText,
  MAX_TITLE,
  MAX_BODY,
  MAX_VERSION,
} from "../src/validation/announcement.js";

let passed = 0;
let failed = 0;

function ok(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    console.log(`  FAIL ${label}${detail === undefined ? "" : ` — ${String(detail)}`}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

const good = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  kind: "notice",
  title: "Down for a bit",
  body: "Back shortly.",
  ...over,
});

// ---------------------------------------------------------------------------
section("a well-formed note is accepted");

{
  const r = parseAnnouncement(good());
  ok("a notice passes", r.ok);
  if (r.ok) {
    ok("…and carries no version", r.value.version === null);
    ok("…with its kind", r.value.kind === "notice");
  }

  const rel = parseAnnouncement(good({ kind: "release", version: "v8.0", title: "Worth It" }));
  ok("a release note passes with a version", rel.ok);
  if (rel.ok) ok("…and keeps it", rel.value.version === "v8.0");
}

// ---------------------------------------------------------------------------
section("markup is NOT the parser's business");

{
  // The renderer is the defence. If this file ever starts escaping, the player
  // sees &lt;script&gt; instead of the text the operator typed.
  const r = parseAnnouncement(good({ body: "<script>alert(1)</script>" }));
  ok("a script tag is accepted", r.ok);
  if (r.ok) ok("…and passes through untouched", r.value.body === "<script>alert(1)</script>");

  const amp = parseAnnouncement(good({ body: "fish & chips < 5" }));
  ok("ampersands and angle brackets are left alone", amp.ok && amp.value.body === "fish & chips < 5");
}

// ---------------------------------------------------------------------------
section("normaliseText removes what has no visible meaning");

{
  ok("CRLF becomes LF", normaliseText("a\r\nb") === "a\nb");
  ok("a bare CR becomes LF", normaliseText("a\rb") === "a\nb");
  // Postgres refuses NUL in a text column outright, with an error that reads
  // like a driver bug rather than bad input.
  ok("NUL is dropped", normaliseText("a\x00b") === "ab");
  ok("other C0 controls are dropped", normaliseText("a\x07\x1Bb") === "ab");
  ok("DEL is dropped", normaliseText("a\x7Fb") === "ab");
  // Tabs and newlines survive — they are the only formatting there is.
  ok("tabs survive", normaliseText("a\tb") === "a\tb");
  ok("a blank line survives", normaliseText("a\n\nb") === "a\n\nb");
  ok("a wall of blank lines collapses to one", normaliseText("a\n\n\n\n\nb") === "a\n\nb");
  ok("surrounding whitespace is trimmed", normaliseText("  hi  ") === "hi");
  ok("emoji and accents survive", normaliseText("café 🐶") === "café 🐶");
}

// ---------------------------------------------------------------------------
section("what gets refused");

{
  const cases: [string, Record<string, unknown>, string][] = [
    ["an unknown kind", good({ kind: "shout" }), "KIND_INVALID"],
    ["a missing kind", { title: "t", body: "b" }, "KIND_INVALID"],
    ["an empty title", good({ title: "" }), "TITLE_EMPTY"],
    ["a whitespace-only title", good({ title: "   \n  " }), "TITLE_EMPTY"],
    ["an empty body", good({ body: "" }), "BODY_EMPTY"],
    ["a body of only control characters", good({ body: "\x00\x07" }), "BODY_EMPTY"],
    ["an over-long title", good({ title: "x".repeat(MAX_TITLE + 1) }), "TITLE_TOO_LONG"],
    ["an over-long body", good({ body: "x".repeat(MAX_BODY + 1) }), "BODY_TOO_LONG"],
    [
      "an over-long version",
      good({ kind: "release", version: "v".repeat(MAX_VERSION + 1) }),
      "VERSION_TOO_LONG",
    ],
    ["a release note with no version", good({ kind: "release" }), "VERSION_REQUIRED"],
    ["a release note with a blank version", good({ kind: "release", version: "  " }), "VERSION_REQUIRED"],
  ];
  for (const [label, body, problem] of cases) {
    const r = parseAnnouncement(body);
    ok(label, !r.ok && r.problem === problem, r.ok ? "ACCEPTED" : r.problem);
  }

  // Exactly at the limit is fine — an off-by-one here would reject a note the
  // composer's own character counter said was legal.
  ok("a title at exactly the limit passes", parseAnnouncement(good({ title: "x".repeat(MAX_TITLE) })).ok);
  ok("a body at exactly the limit passes", parseAnnouncement(good({ body: "x".repeat(MAX_BODY) })).ok);
}

// ---------------------------------------------------------------------------
section("shapes that are not strings");

{
  // Nothing here may throw — the route turns a problem into a message, and a
  // parser that throws on a number would surface as a 500.
  for (const bad of [
    { kind: "notice", title: 42, body: "b" },
    { kind: "notice", title: "t", body: { nested: true } },
    { kind: "notice", title: null, body: "b" },
    { kind: 7, title: "t", body: "b" },
    {},
  ]) {
    let threw = false;
    try {
      parseAnnouncement(bad as Record<string, unknown>);
    } catch {
      threw = true;
    }
    ok(`${JSON.stringify(bad)} is judged, not thrown at`, !threw);
  }
}

// ---------------------------------------------------------------------------
section("tidying that changes the value");

{
  // A title is one line by definition; a pasted multi-line heading is a
  // mistake worth flattening rather than refusing outright.
  const r = parseAnnouncement(good({ title: "Two\nlines" }));
  ok("a multi-line title is flattened", r.ok && r.value.title === "Two lines", r.ok ? r.value.title : r.problem);

  // A version on a notice is meaningless and is dropped, not stored to confuse
  // a later reader into thinking the kind was wrong.
  const n = parseAnnouncement(good({ kind: "notice", version: "v9.9" }));
  ok("a notice's version is discarded", n.ok && n.value.version === null);
}

console.log(`\n${"-".repeat(60)}`);
console.log(`ANNOUNCEMENTS: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
