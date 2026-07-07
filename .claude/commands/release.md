---
description: Cut a numbered version in the Idea-Ledger from shipped work — planned or ad-hoc.
argument-hint: (optional) IDEA-xxx [IDEA-yyy …] to release just those
---

Run the `idea-ledger` skill's **release** operation. This mints a `Major.Minor` entry in
`VersionControl.md` and works whether or not the work was ever part of a plan.

1. **Scope:**
   - No `$ARGUMENTS` → cut **everything currently in `🚧 Unreleased`**.
   - `$ARGUMENTS` (one or more `IDEA-xxx`) → cut only those, leaving the rest of Unreleased for a
     later release. This is the ad-hoc case: an unplanned feature you built and want recorded now.
2. **Number:** confirm the bump — **minor** (e.g. 1.0 → 1.1) for an increment or a single standalone
   addition (default for a lone ad-hoc idea); **major** (e.g. 1.0 → 2.0) for a group of new features.
3. **Write** the entry at the **top** of `Version history` (newest first) using the release template:
   short name + absolute date + the IDEA(s) it bundles.
4. **Clear** the released lines from `🚧 Unreleased`. If it fulfils a `📌 Planned` entry, check it off
   or remove it from Planned.

Confirm the version number and name with the user before writing.
