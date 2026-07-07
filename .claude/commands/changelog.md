---
description: Generate a user-facing CHANGELOG.md or release notes from the Idea-Ledger version history.
argument-hint: (optional) a version like v2.0 for notes on just that release
---

Run the `idea-ledger` skill's **changelog** operation.

- Read the **Version history** in `Idea-Ledger/VersionControl.md`.
- If `$ARGUMENTS` names a version (e.g. `v2.0`), produce release notes for just that one; otherwise
  produce a full `CHANGELOG.md`, newest version first.
- Write it in clean, plain user-facing language grouped by version with its date — not raw IDEA ids
  unless useful. This is a **derived export**: it never edits `Backlog.md` or `VersionControl.md`,
  which stay the source of truth.

Confirm where to save it (default `CHANGELOG.md` at the project root) before writing.
