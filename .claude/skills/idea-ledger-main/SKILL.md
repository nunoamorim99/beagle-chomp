---
name: idea-ledger
description: >-
  Two-file, plain-Markdown product management: capture ideas, track how each feature evolves
  (v1, v2, v3…), and record what ships into versioned releases (Backlog.md + VersionControl.md
  in an Idea-Ledger/ folder). Use it proactively — it is the project's source of truth for ideas
  and releases. Trigger it whenever the user mentions an idea, feature, backlog item, plan,
  build, ship, delivery, or release, even without the word "backlog" or a command: capturing an
  idea ("new idea", "remember this"), triaging the backlog, starting work ("let's build X",
  "implement IDEA-xxx"), recording a delivery ("we shipped", "log it"), or planning/cutting a
  release. Always run it at the start of a session in any project that already has an
  Idea-Ledger/ folder, reading both files first. The commands /idea, /idea-triage, /buildi,
  /ship, and /plan-version always mean this skill. Stack-agnostic — it owns the bookkeeping and
  adapts to the project's git/deploy flow.
---

# Idea-Ledger

A product-management system made of **two plain-Markdown files that work as a pair**.
No database, no dependencies. The simplicity is the point — keep it.

| File | Answers | Granularity |
|---|---|---|
| `Idea-Ledger/Backlog.md` | "What's left to do, and how has each idea evolved?" | Idea (`IDEA-xxx`), each carrying its own version history |
| `Idea-Ledger/VersionControl.md` | "What has actually shipped, grouped into releases?" | Release (`v1.0`, `v2.0`, `v2.1`…) |

**The invariant that makes it work: nothing is ever deleted.** A delivered idea stays in
the backlog forever, accumulating a `v1, v2, v3…` history. So you can always return to any
idea and add another iteration — and see at a glance how many times it was touched and why.
Paused and discarded ideas stay too (a discarded idea keeps the *reason* it was rejected).

Both files live in a dedicated `Idea-Ledger/` folder so anyone on the project knows exactly
where to look.

---

## First action every session

When this skill activates, **check for `Idea-Ledger/Backlog.md` and `Idea-Ledger/VersionControl.md` first.**

- If they exist → **read both before doing anything else**, and load the state silently:
  what's currently In progress, the true `Next free ID`, any blocking dependencies, and the latest
  release. Use that context to ground everything that follows. Don't dump the file contents back at
  the user unless they ask — just act informed. A one-line orientation is welcome
  ("You've got 2 ideas in progress and the next id is IDEA-014") but keep it brief.
- If they don't exist → scaffold them (see *Scaffold* below) before proceeding.

---

## The operations

Each maps to a slash command, but also triggers from natural language. The full lifecycle:

```
/idea  →  Inbox  ──/idea-triage──▶  Backlog  ──/buildi──▶  In progress  ──/ship──▶  Delivered
                                       │                                              │
                                  /plan-version ──▶ VersionControl.md  ◀──/ship──┘
                                                    (Unreleased) ──/release──▶ vX.Y
```

### 1. Scaffold (automatic, when the folder is missing)

Create the `Idea-Ledger/` folder and both files from the templates in
`references/Backlog.template.md` and `references/VersionControl.template.md`. Set
`Next free ID: IDEA-001` and leave all sections empty. Use the reference files verbatim — don't
re-derive the shape.

**Project name — resolve in this order, stop at the first hit:**
1. An explicit name the user gives.
2. `name` in `package.json`, `pyproject.toml`/`[project].name`, `Cargo.toml`, or similar manifest.
3. The git remote's repo name (`git remote get-url origin` → strip to the repo slug).
4. The current directory name.
5. If all of the above are missing or look like a generic placeholder (e.g. `app`, `src`, `tmp`),
   ask the user for the project name rather than guessing.

### 2. `/idea` — capture (instant, dumb, append-only)

This exists so an idea is never lost mid-work. Do the **minimum**: append the user's raw text
+ today's absolute date to the **Inbox** section at the top of `Backlog.md`. No ID, no dedup,
no rewriting, no questions. One tiny append, then stop. (This is deliberately safe to fire
while other work is in progress — see *Capture vs. triage* below.)

### 3. `/idea-triage` — turn raw captures into registered ideas

Process every entry currently in the Inbox, one at a time. For each:

1. **Duplicate check first** (see *Duplicate detection*). Resolve to one of four outcomes
   before writing anything.
2. If it's genuinely new: assign the next free `IDEA-xxx` (see *ID system*), write it into the
   **Backlog (open ideas)** section using the idea template in `references/entry-templates.md`,
   **in English, in the user's own voice** (preserve their reasoning and context — translate if the
   capture was in another language, but don't sanitize it into generic PM-speak), set priority,
   dependencies, and an optional `Area` (a short tag like `auth`, `maps`, `billing` for slicing the
   backlog later) if known, and **recompute** `Next free ID`.
3. Remove the processed line from the Inbox (it has now become a real entry — this is a *move*,
   not a deletion of history).

### 4. `/buildi IDEA-xxx` — start building an idea

1. Open the referenced idea and confirm it exists. Run a duplicate/awareness check in case the
   work overlaps something already delivered.
2. **Dependency gate.** Read the idea's `Dependencies`. For each `[[IDEA-00Y]]` listed, check whether
   that idea is in **Delivered**. If any dependency has NOT shipped, stop and warn the user clearly
   — name the unshipped dependency and ask whether to proceed anyway or build the dependency first.
   Don't silently build on top of something that isn't there.
3. **Move** the entry from Backlog → **In progress** (physically move it between sections; don't
   just change the emoji — the section an entry lives in is the state-at-a-glance signal).
4. Propose a **short plan** and wait for the user's go-ahead. Do **not** autonomously write code
   first — confirm before any big push.
5. If git execution is enabled (see *Git execution policy*), offer to create the feature branch.
6. Build. Then hand back for testing with changes **left unstaged** — that unstaged diff is the
   user's review moment.

### 5. `/ship IDEA-xxx` — record a delivery (writes BOTH files)

This is the moment the pair stays in sync. On the user's confirmation that the work is good:

1. **Move** the idea from In progress → **Delivered ✅** (or update it if already delivered).
   **Preserve its `Notes` and `Dependencies`** — carry them over to the delivered entry; don't
   strip them. The reasoning behind a shipped feature is worth keeping.
2. Add a dated `vN` history line describing *what changed* (use the delivered template). `v1` on
   first ship; each later improvement adds `v2`, `v3`… **to the same idea** — never a new id. The
   number of `vN` lines = how many times that idea shipped. **If git execution ran**, fill the
   `_(commit/PR)_` slot automatically with the real commit hash or PR URL instead of a placeholder.
3. Drop a one-line entry into the **Unreleased** section of `VersionControl.md` so no shipped work
   is ever uncounted.
4. Handle git only with explicit confirmation (merge and branch-deletion **always** need a yes).

### 6. `/plan-version` — plan a release

Collect the IDEAs the user names into a forward-looking **Planned** entry in `VersionControl.md`
(e.g. `v2.0 — [planned]`) as a checklist. As each item ships it lands in Unreleased; when the
plan is fulfilled, **cut it** with `/release` (below).

### 7. `/release` — cut a numbered version (planned OR ad-hoc)

Turn shipped work into a real `Major.Minor` entry in `VersionControl.md`'s **Version history**.
This is the only operation that mints a version number, and it works **whether or not the work was
ever planned** — so an idea that appeared from nowhere, got built, and shipped still gets recorded
instead of languishing in Unreleased.

- **Scope.** `/release` with no argument cuts **everything currently in Unreleased**. `/release IDEA-xxx`
  (one or more ids) cuts only those, leaving the rest of Unreleased for later — this is the ad-hoc
  case: a single unplanned feature you want recorded now.
- **Number.** Confirm the bump: **minor** (e.g. 1.0 → 1.1) for an increment or a single standalone
  addition — the natural choice for an ad-hoc one-off; **major** (e.g. 1.0 → 2.0) for a group of new
  features / a planned release. Default a single ad-hoc idea to a minor.
- **Write it** at the **top** of Version history (newest first) using the release template: name +
  absolute date + the IDEA(s) it bundles.
- **Clear** the released lines from Unreleased. If the release fulfils a `📌 Planned` entry, check it
  off / remove it from Planned.

### Utility commands (read-only / export — they never change lifecycle state)

**8. `/status` — a snapshot on demand.** Read the ledger and report, briefly: counts by state
(open / in progress / delivered / paused / discarded), what's currently In progress, anything
**blocked** by a dependency that hasn't shipped, what's sitting in `🚧 Unreleased` awaiting a release,
and the latest cut version. Group open work by `Area` if areas are in use. This is the session-start
orientation, callable any time. Don't modify anything.

**9. `/ledger-check` — integrity audit.** Hand-edited Markdown drifts; this scans both files (and
`Delivered.md` if it exists) and **reports** inconsistencies without fixing anything unless asked:
duplicate `IDEA-` ids; a `[[IDEA-xxx]]` cross-link that points to no entry; the same id appearing in
two sections; an `🚧 Unreleased` line with no matching Delivered entry; a `Next free ID` that's lower
than the real max id; a delivered idea missing its `History`. List what it found and offer to fix.

**10. `/changelog` — export release notes.** Generate a clean, user-facing `CHANGELOG.md` (or release
notes for a single version) from `VersionControl.md`'s Version history — newest first, grouped by
version, in plain language. This is a derived export: it never edits the ledger, and the ledger
stays the source of truth.


---

## Capture vs. triage (why they're split)

The reason ideas get lost is the *friction* of full registration. So capture (`/idea`) is
intentionally trivial and safe to interrupt with; the smart work (dedup, IDs, voice, dependencies)
happens later in triage when the user can actually look at it. **Tip for the user:** a second,
dedicated Claude Code session works well purely for capture — `/idea` appends to the ledger there
while the main build session is never touched, since the build session isn't editing the backlog
mid-task anyway.

---

## ID system

- **`IDEA-xxx`** — one lifelong, sequential, **never-reused** id per idea, assigned at triage.
- **Recompute, don't trust blindly.** The `Next free ID` header is a hint. On every registration,
  scan **all** sections for the highest existing `IDEA-` number and use max+1, then reconcile the
  header. This survives manual edits that would otherwise drift the counter.
- **Improvements never mint a new id.** A better version of an existing idea is a new `vN` line on
  that same idea. A *related but distinct* idea gets its own new id and cross-links back with
  `[[IDEA-xxx]]`.
- **`vN` starts at first ship.** Refining an idea that hasn't shipped yet edits its text in place
  (no version line). Versioning counts *deliveries*.

## State machine

```
💡 Idea (captured) → 🔨 In progress → ✅ Delivered (kept forever, with history)
                                       ↘ ❄️ Paused (deferred, kept)
                                       ↘ 🗑️ Discarded (rejected, kept WITH the reason)
```

- 💡→🔨 when the user decides to build it (`/buildi`).
- 🔨→✅ on delivery (`/ship`): the entry **moves** to the Delivered section and gets `v1`.
- ❄️ and 🗑️ entries are **never removed** — paused so they aren't lost, discarded so the *reason*
  is preserved. Use the paused/discarded template (it has a `Reason:` line).
- **Resuming a Paused idea** (❄️→💡/🔨): move it back to Backlog (or straight to In progress if
  building now), restore the 💡/🔨 marker, and append a dated note that it was un-paused.
- **Reviving a Discarded idea** (🗑️→💡): move it back to Backlog as an open idea, but **keep the
  original discard reason** — fold it into Notes as "Previously discarded (YYYY-MM-DD): <reason>".
  The recorded reason is exactly why duplicate-detection surfaces discarded items: you can see why it
  was dropped before deciding to revive it.
- A state change is a **physical move** between sections, not just an emoji swap.

## Priority rules

- 🔴 high · 🟡 medium · 🟢 low — optional but encouraged.
- Priority is **descriptive, not a strict queue**: the human picks what to build; priority +
  dependencies *inform* the choice.
- **Dependencies gate order** — an idea with `Dependencies: [[IDEA-003]]` shouldn't be built before
  IDEA-003 ships. Surface this if the user tries.
- Capture the *rationale* for the priority — the "why" is part of the discipline.

## Versioning rules (`VersionControl.md`)

Scheme: **`Major.Minor`**.
- **Major** (1.0 → 2.0) = a group of new features chosen from the backlog — a planned release.
- **Minor** (2.0 → 2.1) = an increment/improvement to an existing feature.
- Each release entry lists the ideas it bundled (`IDEA-0xx`) so it cross-references the backlog.
- **Ordering:** newest release at the **top** (the top entry is "where the project is"); within a
  single idea's own history, list `v1 → v2 → v3` oldest-first (reads as evolution).
- **Unreleased** (pinned at the top) catches every ship so nothing goes missing between releases.
- **Planned** entries are forward-looking targets created by `/plan-version`.
- **Cutting a release sweeps Unreleased.** Releases are cut with `/release`. With no argument it
  bundles **everything currently in Unreleased** into the numbered version — not only the items named
  in a Planned checklist — so shipped improvements (e.g. a `vN` bump that wasn't planned) aren't
  orphaned. To record a single unplanned feature on its own, `/release IDEA-xxx` cuts just that one
  (default: a minor bump) and leaves the rest of Unreleased for later. The Planned checklist *triggers
  and names* a release; the contents are whatever has actually shipped.

## Duplicate detection (run before registering OR building)

Before creating a new idea or starting a build, scan **every** section — Inbox, Backlog, In
progress, Delivered, **and Paused/Discarded** (re-raising a discarded idea is valuable precisely
because its recorded reason is right there). Resolve to one of four outcomes and tell the user
which one:

1. **Exact match** → surface the existing entry; don't duplicate.
2. **Same thing, improved** → record as a new `vN` on that feature instead of a new idea.
3. **Related but distinct** → register a new idea, cross-linked with `[[IDEA-xxx]]`.
4. **Genuinely new** → register fresh.

This is the assessment that prevents re-building things you forgot you already had.

## Git execution policy (optional, configurable, never presumptuous)

Recording the two files is **always** the job. Touching git is **optional** and off-by-default
unless the project/user opts in. When enabled, the reference flow is:

1. Offer to create a feature branch. Default name: `feat/IDEA-0xx-short-slug` (overridable —
   whoever installs the skill can set their own convention).
2. Build, then leave changes **unstaged** and ask the user to test. This is the review moment.
3. Only on the user's go-ahead: stage + commit. (Offer a "just do everything" mode upfront for
   users who prefer it.)
4. **Merge → always requires an explicit yes. Delete branch → always requires an explicit yes.**

Never hard-code a provider. **Detect or ask** the project's actual git + deploy flow (it might be
GitHub + Vercel previews, GitLab, plain git, or none). The bookkeeping is the invariant; the
build/ship mechanics adapt. Pure-record mode (skill touches no git at all) is fully valid.

## Behavioral invariants (always)

- **Absolute dates only.** Resolve "today"/"yesterday" to a real `YYYY-MM-DD` before writing.
- **Write the ledger in English.** All content in `Backlog.md` and `VersionControl.md` — titles,
  descriptions, notes, history lines, release names — is written in English, regardless of the
  language a capture was jotted in. Raw Inbox captures may be in any language; translate them to
  English at triage. (To run the ledger in another language, change this line.)
- **The human's voice.** Descriptions preserve the user's wording, reasoning, and context —
  rendered in clear English. Keep their meaning and emphasis; don't flatten it into generic PM-speak.
- **Never delete** delivered/paused/discarded entries.
- **Update both files together at ship time.**
- **Confirm before merges or any big push.**
- **Re-read immediately before writing.** Always re-read the target file right before appending or
  editing, then write. Captures are append-only, so a fresh read makes the two-session capture habit
  safe: a dedicated capture session and a build session won't clobber each other's changes.

## Keeping the ledger fast as it grows

By default everything stays in `Backlog.md` — open work *and* the full Delivered history — because
nothing is ever deleted and one file is simplest. That's right for a small/medium project. For a
large, long-lived one the Delivered section can dominate the file the skill re-reads each session, so:

- **Offer (don't force) a split when Delivered gets heavy** — rule of thumb, more than ~40 delivered
  entries. The skill proposes moving the Delivered section into its own `Idea-Ledger/Delivered.md`,
  leaving a one-line index in `Backlog.md` (`IDEA-0xx — <title> ✅ → Delivered.md`). Nothing is lost;
  the principle holds. Small projects never see this.
- When `Delivered.md` exists, treat it as part of the ledger: `/status`, `/ledger-check`, duplicate
  detection, and history all read it too.

---

## Reference files

- `references/Backlog.template.md` — scaffold for `Backlog.md` (verbatim shape).
- `references/VersionControl.template.md` — scaffold for `VersionControl.md` (verbatim shape).
- `references/entry-templates.md` — the per-entry shapes: idea, delivered, paused/discarded,
  release, planned. Read this before writing any entry so shapes stay consistent.

## Commands

The `commands/` folder holds the slash-command entry points: the lifecycle commands `idea`,
`idea-triage`, `buildi`, `ship`, `plan-version`, `release`, plus the utility commands `status`,
`ledger-check`, and `changelog`. See `README.md` for where to install them.
