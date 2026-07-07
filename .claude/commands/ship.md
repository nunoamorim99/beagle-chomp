---
description: Record a delivery in the Idea-Ledger — moves to Delivered, adds a vN line, logs to VersionControl.
argument-hint: IDEA-xxx
---

Run the `idea-ledger` skill's **ship & log** operation for `$ARGUMENTS`. This writes BOTH files.

On the user's confirmation that the work is good:
1. **Move** `$ARGUMENTS` from `In progress` → `Delivered ✅` in `Backlog.md` (or update it if it's
   already delivered).
2. Add a dated `vN` history line describing **what changed** (oldest-first within the idea). `v1`
   on first ship; each later improvement adds the next `vN` **to the same idea** — never a new id.
3. Drop a one-line entry into the `🚧 Unreleased` section of `VersionControl.md`:
   `- (YYYY-MM-DD) $ARGUMENTS vN — what shipped.`
4. Handle git only with explicit confirmation — **merge and branch deletion always require a yes.**
5. Use absolute dates and never delete prior history.

If this delivery completes a `📌 Planned` version — or is a standalone feature worth recording on
its own — offer to cut it with `/release` (which mints the numbered `Major.Minor` entry, newest at
top, and clears the released lines from `🚧 Unreleased`).
