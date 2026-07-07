---
description: Turn raw Inbox captures into registered Idea-Ledger ideas (dedup, IDs, voice).
argument-hint: (optional) a specific capture to focus on
---

Run the `idea-ledger` skill's **triage** operation on `Idea-Ledger/Backlog.md`.

For each entry in the `📥 Inbox` (or the one indicated by `$ARGUMENTS`):
1. Run duplicate detection across **every** section, including Paused/Discarded. Tell the user
   the outcome: exact match / same-but-improved / related-distinct / genuinely new.
2. For genuinely new ideas: assign the next free `IDEA-xxx` (recompute by scanning the max id
   across all sections), write it into `Backlog (open ideas)` using the idea template, **in English,
   in the user's own voice** (translate the capture if it was in another language), with priority +
   dependencies if known, and update `Next free ID`.
3. For same-but-improved: record it as a new `vN` on the existing feature instead.
4. For related-distinct: register new and cross-link with `[[IDEA-xxx]]`.
5. Remove the processed line from the Inbox.

Show a short summary of what was registered, merged, or flagged as a duplicate.
